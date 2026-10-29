// Organización de la hoja de ruta y de los remitos según las correcciones del cliente (revisión del 24/10/2026).
// Detalle en docs/requerimientos/epica-1.4-cobro-movil.md · "Correcciones de Martín".
import { calcularImporteVisitaLocal } from './cobro';
import { ColaPorClave, esRemitoResuelto, estadoCobro } from './estadoVisita';
import type { ParadaConsolidada, Remito } from '../tipos';

/**
 * Una parada está terminada cuando sus remitos ya se resolvieron (entregados o rechazados)
 * y no queda nada por cobrar. Si se entregó pero falta el cobro, sigue en "Por entregar".
 */
export function esParadaTerminada(parada: ParadaConsolidada, cola: ColaPorClave): boolean {
  if (parada.estadoOperativo !== 'Entregado' && parada.estadoOperativo !== 'Rechazado') return false;
  return parada.visitas.every((visita) => {
    const cobro = estadoCobro(visita, cola);
    if (cobro === 'hecho' || cobro === 'sin_sincronizar') return true;
    return calcularImporteVisitaLocal(visita, cola).sinCobroEnDestino;
  });
}

/** Corrección 7: la hoja se divide en dos pantallas, "Por entregar" y "Entregadas". Respeta el orden planificado. */
export function separarParadas(paradas: ParadaConsolidada[], cola: ColaPorClave) {
  const porEntregar: ParadaConsolidada[] = [];
  const entregadas: ParadaConsolidada[] = [];
  for (const parada of paradas) (esParadaTerminada(parada, cola) ? entregadas : porEntregar).push(parada);
  return { porEntregar, entregadas };
}

/** Una parada entregada a la que todavía le falta el cobro. */
export function faltaCobrar(parada: ParadaConsolidada, cola: ColaPorClave): boolean {
  return parada.estadoOperativo === 'Entregado' && !esParadaTerminada(parada, cola);
}

/** Corrección 4: los remitos por entregar arriba y los ya resueltos abajo, sin cambiar el orden dentro de cada grupo. */
export function ordenarRemitosParaEntrega(remitos: Remito[], cola: ColaPorClave): Remito[] {
  const pendientes = remitos.filter((remito) => !esRemitoResuelto(remito, cola));
  const resueltos = remitos.filter((remito) => esRemitoResuelto(remito, cola));
  return [...pendientes, ...resueltos];
}

/**
 * Corrección 5: el transportista elige qué remitos entrega.
 * La API de lote (HU #23) confirma TODOS los pendientes de la visita, así que solo se usa si se eligieron todos;
 * si eligió algunos, se confirma cada uno por separado (HU #22).
 */
export function planificarEntrega(seleccionados: Remito[], porEntregar: Remito[]): 'lote' | 'individual' | 'nada' {
  if (seleccionados.length === 0) return 'nada';
  const ids = new Set(seleccionados.map((remito) => remito.id));
  const todos = porEntregar.length > 1 && porEntregar.every((remito) => ids.has(remito.id));
  return todos ? 'lote' : 'individual';
}
