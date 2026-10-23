// Cliente HTTP de la API móvil.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ErrorApi, ErrorRed } from './errores';
import type { CobroDto, EntregaDto, HojaDeRuta, ItemEntregaLote, RechazoDto, Sesion } from './tipos';

// En el celular, "localhost" es el propio teléfono: hay que poner la IP de la PC en mobile/.env
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001/api';
export let API_URL = DEFAULT_API_URL;
const CLAVE_STORAGE_API_URL = 'api-url-personalizada';
const TIMEOUT_MS = 10000;

export function normalizarApiUrl(url: string): string {
  let limpia = (url || '').trim().replace(/\/+$/, '');
  if (!limpia) return DEFAULT_API_URL;
  if (!/^https?:\/\//i.test(limpia)) {
    limpia = `http://${limpia}`;
  }
  if (!limpia.endsWith('/api')) {
    limpia = `${limpia}/api`;
  }
  return limpia;
}

export function obtenerApiUrl(): string {
  return API_URL;
}

export function configurarApiUrl(nuevaUrl: string): string {
  API_URL = normalizarApiUrl(nuevaUrl);
  return API_URL;
}

export async function leerApiUrlGuardada(): Promise<string> {
  try {
    const guardada = await AsyncStorage.getItem(CLAVE_STORAGE_API_URL);
    if (guardada) {
      API_URL = normalizarApiUrl(guardada);
      return API_URL;
    }
  } catch {
    // Si falla el almacenamiento local, se mantiene el valor por defecto
  }
  API_URL = DEFAULT_API_URL;
  return API_URL;
}

export async function guardarApiUrl(nuevaUrl: string): Promise<string> {
  const normalizada = normalizarApiUrl(nuevaUrl);
  API_URL = normalizada;
  try {
    await AsyncStorage.setItem(CLAVE_STORAGE_API_URL, normalizada);
  } catch {
    // Si falla la persistencia, al menos queda en memoria
  }
  return normalizada;
}

export async function restablecerApiUrl(): Promise<string> {
  API_URL = DEFAULT_API_URL;
  try {
    await AsyncStorage.removeItem(CLAVE_STORAGE_API_URL);
  } catch {
    // Ignorar error al limpiar
  }
  return DEFAULT_API_URL;
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}, token?: string): Promise<T> {
  const urlBase = API_URL.replace(/\/+$/, '');
  const rutaLimpia = ruta.startsWith('/') ? ruta : `/${ruta}`;
  const urlCompleta = `${urlBase}${rutaLimpia}`;

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  let respuesta: Response;

  try {
    respuesta = await fetch(urlCompleta, {
      ...opciones,
      signal: controlador.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opciones.headers,
      },
    });
  } catch (err: unknown) {
    if (controlador.signal.aborted) {
      throw new ErrorRed(`Tiempo de espera agotado (${TIMEOUT_MS / 1000}s) al conectar con ${urlCompleta}.`);
    }
    const causa = err instanceof Error ? `: ${err.message}` : '';
    throw new ErrorRed(`No se pudo conectar con el servidor en ${urlBase}${causa}.`);
  } finally {
    clearTimeout(timeout);
  }

  const contentType = respuesta.headers?.get?.('content-type') || '';
  const esJson = contentType.includes('application/json');

  let cuerpo: any = null;
  if (esJson) {
    cuerpo = await respuesta.json().catch(() => ({}));
  } else {
    const texto = await respuesta.text().catch(() => '');
    if (!respuesta.ok) {
      if (respuesta.status === 401 || respuesta.status === 403 || texto.includes('<!DOCTYPE') || texto.includes('<html')) {
        throw new ErrorApi(
          `El túnel de VS Code o servidor devolvió autenticación requerida o HTML (HTTP ${respuesta.status}). Si usás VS Code Port Forwarding, cambiá la visibilidad del puerto 3001 a "Public" (Público).`,
          respuesta.status,
          { textoBruto: texto.slice(0, 300) }
        );
      }
      throw new ErrorApi(`El servidor respondió con código HTTP ${respuesta.status}.`, respuesta.status);
    }
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = texto as unknown as T;
    }
  }

  if (!respuesta.ok) {
    const { message, error, ...detalles } = cuerpo || {};
    const mensaje = message || (typeof error === 'string' ? error : error?.message);
    throw new ErrorApi(mensaje || `El servidor rechazó la operación (HTTP ${respuesta.status}).`, respuesta.status, detalles);
  }
  return cuerpo as T;
}

export async function iniciarSesion(identificador: string, password: string): Promise<Sesion> {
  const resultado = await pedir<{ session: { token: string; name: string; role: string } }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: identificador, password }),
  });
  return { token: resultado.session.token, nombre: resultado.session.name, rol: resultado.session.role };
}

export async function cerrarSesion(token: string): Promise<void> {
  await pedir('/auth/logout', { method: 'POST', body: JSON.stringify({ reason: 'manual' }) }, token).catch(() => undefined);
}

export async function obtenerHojaDeRuta(token: string): Promise<HojaDeRuta | null> {
  try {
    const resultado = await pedir<HojaDeRuta | null>('/movil/hoja-de-ruta', {}, token);
    return resultado || null;
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/** HU #22: confirma la entrega de un remito (API de backend/src/routes/transportistaRoutes.ts). */
export async function confirmarEntrega(token: string, remitoId: string, cuerpo: EntregaDto): Promise<void> {
  await pedir(`/transportista/remitos/${remitoId}/confirmar`, { method: 'POST', body: JSON.stringify(cuerpo) }, token);
}

/** HU: registra el rechazo de un remito (API de backend/src/routes/transportistaRoutes.ts). */
export async function rechazarRemito(token: string, remitoId: string, cuerpo: RechazoDto): Promise<void> {
  await pedir(`/transportista/remitos/${remitoId}/rechazar`, { method: 'POST', body: JSON.stringify(cuerpo) }, token);
}

/** HU #23: confirma la entrega masiva de remitos multimarca de toda la visita. */
export async function confirmarTodaLaVisita(
  token: string,
  visitaId: string,
  cuerpo: { timestamp: string; latitud: number; longitud: number; entregas: ItemEntregaLote[] }
): Promise<void> {
  await pedir(`/transportista/visitas/${visitaId}/confirmar-todo`, { method: 'POST', body: JSON.stringify(cuerpo) }, token);
}

export async function enviarCobro(token: string, visitaId: string, cuerpo: CobroDto): Promise<void> {
  await pedir(`/movil/visitas/${visitaId}/cobro`, { method: 'POST', body: JSON.stringify(cuerpo) }, token);
}
