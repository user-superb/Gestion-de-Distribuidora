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

/** Determina si un remito ya alcanzó estado terminal en el servidor o en la cola local. */
export function esRemitoResuelto(remito: Remito, cola: ColaPorClave): boolean {
  if (ESTADOS_REMITO_TERMINALES.includes(remito.estado)) return true;
  const enEntrega = cola.get(`entrega:${remito.id}`);
  if (enEntrega && (enEntrega.estado === 'pendiente' || enEntrega.estado === 'sincronizado')) return true;
  const enRechazo = cola.get(`rechazo:${remito.id}`);
  if (enRechazo && (enRechazo.estado === 'pendiente' || enRechazo.estado === 'sincronizado')) return true;
  return false;
}

/** Determina si un remito fue rechazado por el cliente (o devuelto), en el servidor o en la cola local. */
export function esRemitoRechazado(remito: Remito, cola: ColaPorClave): boolean {
  if (remito.estado === 'no_entregado' || remito.estado === 'devuelto') return true;
  const enRechazo = cola.get(`rechazo:${remito.id}`);
  return !!enRechazo && (enRechazo.estado === 'pendiente' || enRechazo.estado === 'sincronizado');
}

export interface InfoEstadoRemito {
  texto: string;
  color: string;
  puedeOperar: boolean;
  esRechazado: boolean;
  motivo?: string | null;
}

export function infoEstadoRemito(remito: Remito, cola: ColaPorClave): InfoEstadoRemito {
  if (remito.estado === 'no_entregado') {
    return {
      texto: 'No entregado',
      color: '#6c757d',
      puedeOperar: false,
      esRechazado: true,
      motivo: remito.motivoNoEntrega,
    };
  }
  if (remito.estado === 'devuelto') {
    return {
      texto: 'Devuelto',
      color: '#6c757d',
      puedeOperar: false,
      esRechazado: true,
      motivo: remito.motivoNoEntrega,
    };
  }
  if (remito.estado === 'anulado') {
    return { texto: 'Anulado', color: '#6c757d', puedeOperar: false, esRechazado: false };
  }
  if (remito.estado === 'entregado') {
    return { texto: 'Entregado', color: '#198754', puedeOperar: false, esRechazado: false };
  }

  const enRechazo = cola.get(`rechazo:${remito.id}`);
  if (enRechazo && enRechazo.tipo === 'rechazo') {
    if (enRechazo.estado === 'pendiente') {
      return {
        texto: 'Rechazado · sin sincronizar',
        color: '#d97706',
        puedeOperar: false,
        esRechazado: true,
        motivo: enRechazo.cuerpo.motivo,
      };
    }
    if (enRechazo.estado === 'sincronizado') {
      return {
        texto: 'No entregado',
        color: '#6c757d',
        puedeOperar: false,
        esRechazado: true,
        motivo: enRechazo.cuerpo.motivo,
      };
    }
    if (enRechazo.estado === 'rechazado') {
      return {
        texto: 'Rechazo rechazado',
        color: '#dc3545',
        puedeOperar: true,
        esRechazado: false,
        motivo: enRechazo.motivo,
      };
    }
  }

  const enEntrega = cola.get(`entrega:${remito.id}`);
  if (enEntrega) {
    if (enEntrega.estado === 'pendiente') {
      return { texto: 'Entregado · sin sincronizar', color: '#d97706', puedeOperar: false, esRechazado: false };
    }
    if (enEntrega.estado === 'sincronizado') {
      return { texto: 'Entregado', color: '#198754', puedeOperar: false, esRechazado: false };
    }
    if (enEntrega.estado === 'rechazado') {
      return {
        texto: 'Entrega rechazada',
        color: '#dc3545',
        puedeOperar: true,
        esRechazado: false,
        motivo: enEntrega.motivo,
      };
    }
  }

  return { texto: 'Por entregar', color: '#6c757d', puedeOperar: true, esRechazado: false };
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
  const pendientes = visita.remitos.filter((r) => !esRemitoResuelto(r, cola)).length;
  const tieneRechazosPrevios = visita.remitos.some((r) => esRemitoRechazado(r, cola));
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
