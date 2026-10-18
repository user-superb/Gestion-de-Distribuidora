// Cliente HTTP de la API móvil.
import { ErrorApi, ErrorRed } from './errores';
import type { CobroDto, EntregaDto, HojaDeRuta, Sesion } from './tipos';

// En el celular, "localhost" es el propio teléfono: hay que poner la IP de la PC en mobile/.env
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001/api';
const TIMEOUT_MS = 10000;

async function pedir<T>(ruta: string, opciones: RequestInit = {}, token?: string): Promise<T> {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  let respuesta: Response;
  try {
    respuesta = await fetch(`${API_URL}${ruta}`, {
      ...opciones,
      signal: controlador.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ErrorRed();
  } finally {
    clearTimeout(timeout);
  }

  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const { message, error, ...detalles } = cuerpo || {};
    const mensaje = message || (typeof error === 'string' ? error : error?.message);
    throw new ErrorApi(mensaje || 'El servidor rechazó la operación.', respuesta.status, detalles);
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

export function obtenerHojaDeRuta(token: string): Promise<HojaDeRuta> {
  return pedir<HojaDeRuta>('/movil/hoja-de-ruta', {}, token);
}

/** HU #22: confirma la entrega de un remito (API de backend/src/routes/transportistaRoutes.ts). */
export async function confirmarEntrega(token: string, remitoId: string, cuerpo: EntregaDto): Promise<void> {
  await pedir(`/transportista/remitos/${remitoId}/confirmar`, { method: 'POST', body: JSON.stringify(cuerpo) }, token);
}

export async function enviarCobro(token: string, visitaId: string, cuerpo: CobroDto): Promise<void> {
  await pedir(`/movil/visitas/${visitaId}/cobro`, { method: 'POST', body: JSON.stringify(cuerpo) }, token);
}
