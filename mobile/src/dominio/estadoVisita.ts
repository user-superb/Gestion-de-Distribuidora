import type { CobroEnCola } from '../sincronizacion/cola';

export type EstadoVisitaLocal = 'pendiente' | 'cobrada' | 'sin_sincronizar' | 'rechazada';

export const ETIQUETA_ESTADO: Record<EstadoVisitaLocal, string> = {
  pendiente: 'Pendiente',
  cobrada: 'Cobrada',
  sin_sincronizar: 'Cobrada · sin sincronizar',
  rechazada: 'Cobro rechazado',
};

/** Combina lo que dice el servidor con lo que el celular tiene en la cola. Si el servidor ya la liquidó, manda el servidor. */
export function estadoVisitaLocal(estadoServidor: string, enCola?: CobroEnCola): EstadoVisitaLocal {
  if (estadoServidor === 'completada') return 'cobrada';
  if (enCola?.estado === 'pendiente') return 'sin_sincronizar';
  if (enCola?.estado === 'sincronizado') return 'cobrada';
  if (enCola?.estado === 'rechazado') return 'rechazada';
  return 'pendiente';
}
