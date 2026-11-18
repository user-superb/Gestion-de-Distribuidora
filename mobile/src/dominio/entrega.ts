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

export const MOTIVO_COMERCIO_CERRADO = 'Comercio cerrado';

/**
 * Obtiene los motivos de rechazo preestablecidos aplicables.
 * 'Comercio cerrado' solo se permite cuando se rechazan todos los remitos de la entrega
 * (no aplica para rechazos parciales donde algún remito se entrega o ya fue entregado).
 */
export function motivosRechazoPreestablecidos(esRechazoTotal: boolean): readonly string[] {
  if (esRechazoTotal) return MOTIVOS_RECHAZO_PREESTABLECIDOS;
  return MOTIVOS_RECHAZO_PREESTABLECIDOS.filter((m) => m !== MOTIVO_COMERCIO_CERRADO);
}

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

/** Coordenadas operativas de respaldo cuando el dispositivo no logra fijar GPS (ej. modo sin conexión). */
export const UBICACION_POR_DEFECTO = {
  latitud: -34.92145,
  longitud: -57.95453,
} as const;

/**
 * HU #23: Arma la confirmación en lote de todos los remitos pendientes de la visita.
 * Regla 1: Solo aplica sobre remitos pendientes.
 * Regla 3: Cada remito procesado en lote registra su propio timestamp, GPS (o coordenadas de respaldo sin red) y vínculo a su marca/proveedor.
 */
export function armarEntregaLote(
  remitos: Remito[],
  ubicacion: Ubicacion | null,
  ahora = new Date()
): { entregas: ItemEntregaLote[]; cuerpoGeneral: EntregaDto } | null {
  const base = armarEntrega(ubicacion, ahora);

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

export function armarEntrega(ubicacion: Ubicacion | null, ahora = new Date()): EntregaDto {
  const latitud = ubicacion ? ubicacion.latitud : UBICACION_POR_DEFECTO.latitud;
  const longitud = ubicacion ? ubicacion.longitud : UBICACION_POR_DEFECTO.longitud;
  return { timestamp: ahora.toISOString(), latitud, longitud };
}
