// Reglas de la confirmación de entrega de remitos (HU #22).
// El backend (backend/src/services/transportistaService.ts) exige hora, transportista y GPS (Regla 1).
import type { EntregaDto, Remito, Ubicacion } from '../tipos';

/** Estados que ya no se confirman: entregado, rechazado o devuelto, anulado. */
export const ESTADOS_REMITO_TERMINALES = ['entregado', 'no_entregado', 'devuelto', 'anulado'];

export function puedeConfirmarse(remito: Remito): boolean {
  return !ESTADOS_REMITO_TERMINALES.includes(remito.estado);
}

/**
 * Arma la confirmación con la hora del celular, que se conserva aunque se envíe más tarde sin conexión (Escenario 2).
 * Devuelve null si no hay ubicación: la Regla 1 la exige (ver pregunta pendiente en docs/requerimientos).
 */
export function armarEntrega(ubicacion: Ubicacion | null, ahora = new Date()): EntregaDto | null {
  if (!ubicacion) return null;
  return { timestamp: ahora.toISOString(), latitud: ubicacion.latitud, longitud: ubicacion.longitud };
}
