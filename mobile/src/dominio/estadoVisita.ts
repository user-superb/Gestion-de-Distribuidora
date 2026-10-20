// Estado de visitas y remitos en el celular: combina lo que dice el servidor con la cola local.
// Si el servidor ya lo registró, manda el servidor.
import { ESTADOS_REMITO_TERMINALES } from './entrega';
import type { ItemCola } from '../sincronizacion/cola';
import type { Remito, Visita } from '../tipos';

export type EstadoLocal = 'pendiente' | 'hecho' | 'sin_sincronizar' | 'rechazado';

export type ColaPorClave = Map<string, ItemCola>;

function combinar(hechoEnServidor: boolean, enCola?: ItemCola): EstadoLocal {
  if (hechoEnServidor) return 'hecho';
  if (enCola?.estado === 'pendiente') return 'sin_sincronizar';
  if (enCola?.estado === 'sincronizado') return 'hecho';
  if (enCola?.estado === 'rechazado') return 'rechazado';
  return 'pendiente';
}

/** Cobro de la visita (HU #25 a #29). */
export function estadoCobro(visita: Visita, cola: ColaPorClave): EstadoLocal {
  return combinar(visita.cobrada, cola.get(`cobro:${visita.id}`));
}

/** Entrega de un remito por entregar (HU #22). Los rechazados, devueltos o anulados no se muestran con este estado. */
export function estadoEntrega(remito: Remito, cola: ColaPorClave): EstadoLocal {
  return combinar(remito.estado === 'entregado', cola.get(`entrega:${remito.id}`));
}

/** Cuántos remitos entregables de la visita ya están confirmados (en el servidor o en el celular). */
export function resumenEntregas(visita: Visita, cola: ColaPorClave): { confirmados: number; total: number } {
  const entregables = visita.remitos.filter((remito) => remito.estado === 'entregado' || !ESTADOS_REMITO_TERMINALES.includes(remito.estado));
  const confirmados = entregables.filter((remito) => ['hecho', 'sin_sincronizar'].includes(estadoEntrega(remito, cola))).length;
  return { confirmados, total: entregables.length };
}

export interface ResumenVisitaEntrega {
  confirmados: number;
  total: number;
  pendientes: number;
  conExcepciones: boolean;
  completada: boolean;
  etiqueta: string;
}

/**
 * HU #23 Regla 2: Evalúa el estado global de entregas de la visita.
 * Si no quedan remitos pendientes y hubo excepciones (rechazos/devoluciones): "Entregada con excepciones".
 * Si no quedan remitos pendientes y todos están entregados: "Completada".
 * Si aún quedan pendientes: "X/Y entregados".
 */
export function resumenVisitaEntrega(visita: Visita, cola: ColaPorClave): ResumenVisitaEntrega {
  const { confirmados, total } = resumenEntregas(visita, cola);
  const pendientes = total - confirmados;
  const tieneRechazosPrevios = visita.remitos.some((r) => r.estado === 'no_entregado' || r.estado === 'devuelto');
  const completada = pendientes === 0 && (total > 0 || tieneRechazosPrevios);

  let etiqueta = `${confirmados}/${total} entregados`;
  if (completada) {
    etiqueta = tieneRechazosPrevios ? 'Entregada con excepciones' : 'Completada';
  } else if (confirmados === 0 && total > 0) {
    etiqueta = 'Pendiente';
  }

  return {
    confirmados,
    total,
    pendientes,
    conExcepciones: tieneRechazosPrevios,
    completada,
    etiqueta,
  };
}

export const ETIQUETA_COBRO: Record<EstadoLocal, string> = {
  pendiente: 'Sin cobrar',
  hecho: 'Cobrada',
  sin_sincronizar: 'Cobrada · sin sincronizar',
  rechazado: 'Cobro rechazado',
};

export const ETIQUETA_ENTREGA: Record<EstadoLocal, string> = {
  pendiente: 'Por entregar',
  hecho: 'Entregado',
  sin_sincronizar: 'Entregado · sin sincronizar',
  rechazado: 'Entrega rechazada',
};
