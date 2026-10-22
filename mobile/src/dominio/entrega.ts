// Reglas de la confirmación de entrega de remitos (HU #22).
// El backend (backend/src/services/transportistaService.ts) exige hora, transportista y GPS (Regla 1).
import type { EntregaDto, ItemEntregaLote, RechazoDto, Remito, Ubicacion } from '../tipos';

/** Catálogo de motivos preestablecidos para el rechazo de remitos por parte del cliente. */
export const MOTIVOS_RECHAZO_PREESTABLECIDOS = [
  'Comercio cerrado',
  'Mercadería dañada o en mal estado',
  'Pedido duplicado o no solicitado',
  'Diferencia de precio o mercadería',
  'Falta de dinero / No puede pagar',
] as const;

/** Estados que ya no se confirman: entregado, rechazado o devuelto, anulado. */
export const ESTADOS_REMITO_TERMINALES = ['entregado', 'no_entregado', 'devuelto', 'anulado'];

export function puedeConfirmarse(remito: Remito): boolean {
  return !ESTADOS_REMITO_TERMINALES.includes(remito.estado);
}

/**
 * HU: Arma el rechazo de un remito.
 * Requiere obligatoriamente un motivo no vacío (preestablecido o manual).
 * Si no hay ubicación, permite registrarlo con coordenadas nulas.
 */
export function armarRechazo(
  motivo: string,
  ubicacion: Ubicacion | null,
  ahora = new Date()
): RechazoDto | null {
  const limpio = (motivo || '').trim();
  if (!limpio) return null;
  return {
    motivo: limpio,
    timestamp: ahora.toISOString(),
    latitud: ubicacion ? ubicacion.latitud : null,
    longitud: ubicacion ? ubicacion.longitud : null,
  };
}

/**
 * Arma la confirmación con la hora del celular, que se conserva aunque se envíe más tarde sin conexión (Escenario 2).
 * Devuelve null si no hay ubicación: la Regla 1 la exige (ver pregunta pendiente en docs/requerimientos).
 */
/**
 * HU #23: Arma la confirmación en lote de todos los remitos pendientes de la visita.
 * Regla 1: Solo aplica sobre remitos pendientes.
 * Regla 3: Cada remito procesado en lote registra su propio timestamp, GPS y vínculo a su marca/proveedor.
 */
export function armarEntregaLote(
  remitos: Remito[],
  ubicacion: Ubicacion | null,
  ahora = new Date()
): { entregas: ItemEntregaLote[]; cuerpoGeneral: EntregaDto } | null {
  const base = armarEntrega(ubicacion, ahora);
  if (!base) return null;

  const pendientes = remitos.filter(puedeConfirmarse);
  if (pendientes.length === 0) return null;

  return {
    cuerpoGeneral: base,
    entregas: pendientes.map((remito) => ({
      remitoId: remito.id,
      cuerpo: { ...base },
    })),
  };
}

export function armarEntrega(ubicacion: Ubicacion | null, ahora = new Date()): EntregaDto | null {
  if (!ubicacion) return null;
  return { timestamp: ahora.toISOString(), latitud: ubicacion.latitud, longitud: ubicacion.longitud };
}
