// HU #46 · Declarar efectivo recaudado: reglas de la rendición en el celular, sin React.
// Detalle en docs/requerimientos/epica-2.3-rendicion-efectivo.md
import type { ItemCola } from '../sincronizacion/cola';
import type { HojaDeRuta, ParadaConsolidada, RendicionDto } from '../tipos';
import type { ColaPorClave } from './estadoVisita';
import { separarParadas } from './organizacion';

export type EstadoDeclaracion =
  | { estado: 'sin_declarar'; motivoRechazo?: string }
  | {
      /** sin_sincronizar: guardada en el celular (E2) · pendiente: en la caja, sin contar · con_diferencia / validada: la procesó el supervisor */
      estado: 'sin_sincronizar' | 'pendiente' | 'con_diferencia' | 'validada';
      declaradoCentavos: number;
      claveIdempotencia: string | null;
      declaradoEn: string | null;
    };

/**
 * Efectivo cobrado en la jornada según el celular: los cobros que siguen en la cola (enviados o no)
 * y, para las visitas cobradas desde otro lado, lo que informa el servidor.
 */
export function efectivoCobrado(hoja: HojaDeRuta, cola: ColaPorClave): number {
  let total = 0;
  for (const visita of hoja.visitas) {
    const enCola = cola.get(`cobro:${visita.id}`);
    if (enCola?.tipo === 'cobro' && enCola.estado !== 'rechazado') {
      total += enCola.cuerpo.pagos.filter((pago) => pago.medioPago === 'efectivo').reduce((suma, pago) => suma + pago.importeCentavos, 0);
    } else if (visita.cobrada) {
      total += visita.efectivoCobradoCentavos ?? 0;
    }
  }
  return total;
}

/** ESCENARIO 3: paradas que siguen pendientes en el celular (sin entregar, sin rechazar o sin cobrar). */
export function paradasPendientes(paradas: ParadaConsolidada[], cola: ColaPorClave): ParadaConsolidada[] {
  return separarParadas(paradas, cola).porEntregar;
}

function anulacionVigente(cola: ColaPorClave, clave: string | null | undefined): boolean {
  if (!clave) return false;
  const anulacion = cola.get(`anulacion_rendicion:${clave}`);
  return !!anulacion && anulacion.estado !== 'rechazado';
}

/** Estado de la declaración de la hoja, combinando el servidor con lo que todavía está en el celular. */
export function estadoDeclaracion(hoja: HojaDeRuta, cola: ColaPorClave): EstadoDeclaracion {
  const servidor = hoja.rendicion ?? null;
  const local = cola.get(`rendicion:${hoja.id}`) as (ItemCola & { tipo: 'rendicion' }) | undefined;

  if (local?.tipo === 'rendicion' && !anulacionVigente(cola, local.cuerpo.claveIdempotencia)) {
    const { declaradoCentavos, claveIdempotencia, declaradoEn } = local.cuerpo;
    if (local.estado === 'rechazado') return { estado: 'sin_declarar', motivoRechazo: local.motivo };
    if (local.estado === 'pendiente') return { estado: 'sin_sincronizar', declaradoCentavos, claveIdempotencia, declaradoEn };
    if (servidor && servidor.claveIdempotencia === claveIdempotencia && servidor.estado !== 'rechazada') {
      return { estado: servidor.estado, declaradoCentavos: servidor.declaradoCentavos, claveIdempotencia, declaradoEn: servidor.declaradoEn };
    }
    // Ya se envió, pero la hoja guardada todavía no lo refleja.
    return { estado: 'pendiente', declaradoCentavos, claveIdempotencia, declaradoEn };
  }

  if (servidor && servidor.estado !== 'rechazada' && !anulacionVigente(cola, servidor.claveIdempotencia)) {
    return {
      estado: servidor.estado,
      declaradoCentavos: servidor.declaradoCentavos,
      claveIdempotencia: servidor.claveIdempotencia,
      declaradoEn: servidor.declaradoEn,
    };
  }
  return { estado: 'sin_declarar' };
}

/** Se puede anular mientras el supervisor no empezó a contar (HU #47 E2). */
export function puedeAnular(declaracion: EstadoDeclaracion): boolean {
  return (declaracion.estado === 'sin_sincronizar' || declaracion.estado === 'pendiente') && !!declaracion.claveIdempotencia;
}

export type ResultadoValidacionRendicion = { ok: true } | { ok: false; error: string };

/** Validaciones antes de declarar: E3 (visitas pendientes) y el monto. */
export function validarDeclaracion(
  pendientes: ParadaConsolidada[],
  declaradoCentavos: number | null,
  declaracion: EstadoDeclaracion
): ResultadoValidacionRendicion {
  if (declaracion.estado !== 'sin_declarar') return { ok: false, error: 'Ya declaraste el efectivo de esta hoja de ruta.' };
  if (pendientes.length > 0) {
    return {
      ok: false,
      error: `No podés rendir todavía: te ${pendientes.length === 1 ? 'queda 1 parada pendiente' : `quedan ${pendientes.length} paradas pendientes`} en la hoja de ruta.`,
    };
  }
  if (declaradoCentavos === null) return { ok: false, error: 'Ingresá el efectivo que llevás, por ejemplo 45000 o 45.000,50.' };
  return { ok: true };
}

export function armarDeclaracion(hojaId: string, declaradoCentavos: number, claveIdempotencia: string, ahora = new Date()): RendicionDto {
  return { hojaDeRutaId: hojaId, declaradoCentavos, claveIdempotencia, declaradoEn: ahora.toISOString() };
}

/** Texto corto del estado para la hoja de ruta y la pantalla de rendición. */
export function textoEstadoDeclaracion(declaracion: EstadoDeclaracion): string {
  switch (declaracion.estado) {
    case 'sin_declarar': return 'Sin declarar';
    case 'sin_sincronizar': return 'Declarado · sin sincronizar';
    case 'pendiente': return 'Declarado · pendiente de conteo';
    case 'con_diferencia': return 'En revisión · con diferencia';
    case 'validada': return 'Rendición aprobada';
  }
}
