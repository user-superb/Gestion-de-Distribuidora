// frontend/src/services/rendicionEfectivoService.ts
// Épica 2.3 · Escritorio del supervisor de efectivo (HU #47 a #50).
// API: backend/src/routes/efectivoRoutes.ts. Importes en centavos.
import { API_BASE } from '../config/api';

export type EstadoRendicion = 'pendiente' | 'con_diferencia' | 'validada' | 'rechazada' | 'anulada';

export interface ConteoBilletes {
  billetes: Record<string, number>;
  monedasCentavos: number;
}

export interface Rendicion {
  id: string;
  hojaDeRutaId: string;
  codigoHoja: string;
  fechaReparto: string | null;
  patente: string | null;
  estadoHoja: string;
  sucursal: string;
  transportista: { id: string; nombre: string };
  estado: EstadoRendicion;
  declaradoCentavos: number;
  declaradoEn: string | null;
  anuladaEn: string | null;
  rendidoCentavos: number | null;
  conteo: ConteoBilletes | null;
  diferenciaCentavos: number | null;
  tipoDiferencia: 'coincide' | 'faltante' | 'sobrante' | null;
  motivoDiferencia: string | null;
  diferenciaRegistradaEn: string | null;
  diferenciaRegistradaPor: string | null;
  validadoEn: string | null;
  validadoPor: string | null;
}

export interface DetalleRendicion extends Rendicion {
  cobrosEfectivo: { id: string; orden: number | null; comercio: string; importeCentavos: number; registradoEn: string | null }[];
  efectivoCobradoCentavos: number;
}

export interface HojaPendienteArqueo {
  hojaId: string;
  codigoHoja: string;
  fechaReparto: string | null;
  patente: string | null;
  estadoHoja: string;
  sucursal: string;
  transportista: { id: string; nombre: string };
  efectivoCobradoCentavos: number;
  cantidadCobrosEfectivo: number;
  visitasPendientesCount: number;
  visitasPendientes: { visitaId: string; orden: number | null; comercio: string; motivo: string }[];
}

/** HU #47 E2: la declaración fue retractada por el transportista. */
export class RendicionRetractadaError extends Error {
  constructor(message: string, public anuladaEn: string | null) {
    super(message);
  }
}

/** Billetes que cuenta el supervisor, en pesos (de mayor a menor). */
export const DENOMINACIONES_PESOS = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];

export const ETIQUETA_ESTADO: Record<EstadoRendicion, string> = {
  pendiente: 'Pendiente de conteo',
  con_diferencia: 'Con diferencia registrada',
  validada: 'Aprobada',
  rechazada: 'Rechazada',
  anulada: 'Retractada',
};

export const LARGO_MINIMO_JUSTIFICACION = 10;

export function formatoPesos(centavos: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(centavos / 100);
}

/** "2026-11-02" → "02/11/2026" */
export function formatoFecha(fecha: string | null): string {
  return fecha ? fecha.split('-').reverse().join('/') : '—';
}

export type LecturaImporte = { centavos: number } | { error: 'vacio' | 'negativo' | 'invalido' };

/**
 * Lo que tipea el supervisor → centavos. Acepta "45000", "45000,5", "45.000,50".
 * La coma es el separador decimal y los puntos, separadores de miles.
 */
export function leerPesos(texto: string): LecturaImporte {
  const limpio = texto.trim().replace(/^\$\s*/, '');
  if (!limpio) return { error: 'vacio' };
  if (limpio.startsWith('-')) return { error: 'negativo' };
  const sinMiles = limpio.replace(/\./g, '');
  if (!/^\d+(,\d{1,2})?$/.test(sinMiles)) return { error: 'invalido' };
  const [enteros, decimales = ''] = sinMiles.split(',');
  return { centavos: Number(enteros) * 100 + Number(decimales.padEnd(2, '0')) };
}

export interface FormConteo {
  modo: 'billetes' | 'total';
  /** Cantidad de billetes por denominación en pesos, tal como se tipeó. */
  billetes: Record<number, string>;
  monedas: string;
  total: string;
}

export const formConteoVacio = (): FormConteo => ({ modo: 'billetes', billetes: {}, monedas: '', total: '' });

export type AnalisisConteo =
  | { ok: true; rendidoCentavos: number; conteo: ConteoBilletes | null }
  | { ok: false; error: string; negativo: boolean };

/**
 * Total contado a partir del formulario. HU #49 E2: un valor negativo en el conteo bloquea el registro.
 */
export function analizarConteo(form: FormConteo): AnalisisConteo {
  if (form.modo === 'total') {
    const lectura = leerPesos(form.total);
    if ('error' in lectura) {
      return lectura.error === 'negativo'
        ? { ok: false, negativo: true, error: 'El monto contado no puede ser negativo.' }
        : { ok: false, negativo: false, error: 'Ingresá el monto físico contado, por ejemplo 45.000,50.' };
    }
    return { ok: true, rendidoCentavos: lectura.centavos, conteo: null };
  }

  const billetes: Record<string, number> = {};
  let total = 0;
  let algo = false;
  for (const denominacion of DENOMINACIONES_PESOS) {
    const texto = (form.billetes[denominacion] ?? '').trim();
    if (!texto) continue;
    algo = true;
    if (texto.startsWith('-') || Number(texto) < 0) {
      return { ok: false, negativo: true, error: `El conteo no admite valores negativos (billetes de ${formatoPesos(denominacion * 100)}).` };
    }
    if (!/^\d+$/.test(texto)) {
      return { ok: false, negativo: false, error: `La cantidad de billetes de ${formatoPesos(denominacion * 100)} debe ser un número entero.` };
    }
    const cantidad = Number(texto);
    if (cantidad > 0) billetes[String(denominacion * 100)] = cantidad;
    total += cantidad * denominacion * 100;
  }
  let monedasCentavos = 0;
  if (form.monedas.trim()) {
    algo = true;
    const lectura = leerPesos(form.monedas);
    if ('error' in lectura) {
      return lectura.error === 'negativo'
        ? { ok: false, negativo: true, error: 'El conteo no admite valores negativos (monedas).' }
        : { ok: false, negativo: false, error: 'El importe en monedas es inválido.' };
    }
    monedasCentavos = lectura.centavos;
  }
  if (!algo) return { ok: false, negativo: false, error: 'Cargá la cantidad de billetes contados.' };
  return { ok: true, rendidoCentavos: total + monedasCentavos, conteo: { billetes, monedasCentavos } };
}

/** Lo contado contra lo declarado: negativa = faltante, positiva = sobrante (HU #48 a #50). */
export function compararConDeclarado(declaradoCentavos: number, rendidoCentavos: number) {
  const diferenciaCentavos = rendidoCentavos - declaradoCentavos;
  const tipo = diferenciaCentavos === 0 ? 'coincide' : diferenciaCentavos < 0 ? 'faltante' : 'sobrante';
  return { diferenciaCentavos, tipo } as const;
}

export function justificacionValida(texto: string): boolean {
  return texto.trim().length >= LARGO_MINIMO_JUSTIFICACION;
}

/** Precarga el formulario con un conteo ya registrado (HU #49 → HU #50). */
export function formDesdeConteo(rendidoCentavos: number | null, conteo: ConteoBilletes | null): FormConteo {
  if (conteo) {
    const billetes: Record<number, string> = {};
    for (const [centavos, cantidad] of Object.entries(conteo.billetes)) billetes[Number(centavos) / 100] = String(cantidad);
    const monedas = conteo.monedasCentavos ? (conteo.monedasCentavos / 100).toFixed(2).replace('.', ',') : '';
    return { modo: 'billetes', billetes, monedas, total: '' };
  }
  if (rendidoCentavos !== null) return { modo: 'total', billetes: {}, monedas: '', total: (rendidoCentavos / 100).toFixed(2).replace('.', ',') };
  return formConteoVacio();
}

async function pedir<T>(token: string, ruta: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/efectivo${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 410) throw new RendicionRetractadaError(data?.message || 'El transportista retractó esta declaración.', data?.anuladaEn ?? null);
  if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'No se pudo completar la operación.');
  return data as T;
}

export const rendicionEfectivoService = {
  async listar(token: string, filtros: { estado?: string; fecha?: string } = {}): Promise<Rendicion[]> {
    const params = new URLSearchParams();
    if (filtros.estado) params.set('estado', filtros.estado);
    if (filtros.fecha) params.set('fecha', filtros.fecha);
    const query = params.toString();
    const data = await pedir<{ rendiciones: Rendicion[] }>(token, `/rendiciones${query ? `?${query}` : ''}`);
    return data.rendiciones;
  },

  detalle(token: string, id: string): Promise<DetalleRendicion> {
    return pedir(token, `/rendiciones/${id}`);
  },

  /** Opción 1: Hojas disponibles para iniciar arqueo desde el escritorio */
  async listarHojasPendientes(token: string, fecha?: string): Promise<HojaPendienteArqueo[]> {
    const params = new URLSearchParams();
    if (fecha) params.set('fecha', fecha);
    const query = params.toString();
    const data = await pedir<{ hojas: HojaPendienteArqueo[] }>(token, `/hojas-pendientes${query ? `?${query}` : ''}`);
    return data.hojas;
  },

  /** Opción 1 & Opción B: Iniciar arqueo de una hoja (permite forzar con paradas pendientes) */
  async iniciarArqueo(token: string, hojaDeRutaId: string, declaradoCentavos?: number, forzar?: boolean): Promise<Rendicion> {
    const data = await pedir<{ rendicion: Rendicion }>(token, '/iniciar', {
      method: 'POST',
      body: JSON.stringify({ hojaDeRutaId, declaradoCentavos, forzar }),
    });
    return data.rendicion;
  },

  /** HU #48 */
  aprobar(token: string, id: string, rendidoCentavos: number, conteo: ConteoBilletes | null): Promise<Rendicion> {
    return pedir(token, `/rendiciones/${id}/aprobar`, { method: 'POST', body: JSON.stringify({ rendidoCentavos, conteo }) });
  },

  /** HU #49 */
  registrarDiferencia(token: string, id: string, rendidoCentavos: number, conteo: ConteoBilletes | null, justificacion: string): Promise<Rendicion> {
    return pedir(token, `/rendiciones/${id}/diferencia`, { method: 'POST', body: JSON.stringify({ rendidoCentavos, conteo, justificacion }) });
  },

  /** HU #50 */
  aprobarConDiferencia(token: string, id: string, rendidoCentavos: number, conteo: ConteoBilletes | null, motivo: string): Promise<Rendicion> {
    return pedir(token, `/rendiciones/${id}/aprobar-con-diferencia`, { method: 'POST', body: JSON.stringify({ rendidoCentavos, conteo, motivo }) });
  },
};
