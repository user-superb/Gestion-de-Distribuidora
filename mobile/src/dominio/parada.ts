// Dominio: Gestión de paradas (comercios), consolidación de carga y estados operativos.
import type { ColaPorClave } from './estadoVisita';
import type {
  DocumentoAsociado,
  EstadoOperativoParada,
  HojaDeRuta,
  ParadaConsolidada,
  Remito,
  ResumenCargaMarca,
  Visita,
} from '../tipos';

/** Fecha operativa actual en Argentina (YYYY-MM-DD) */
export function fechaOperativaHoy(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora);
}

/** Verifica si la hoja de ruta corresponde a la fecha actual y se encuentra en estado habilitado para ejecución */
export function esHojaOperativaVigente(hoja: HojaDeRuta | null | undefined, fechaHoy = fechaOperativaHoy()): boolean {
  if (!hoja) return false;
  if (hoja.fechaReparto !== fechaHoy) return false;
  const estadosHabilitados = ['publicada', 'asignada', 'en_curso'];
  return estadosHabilitados.includes(hoja.estado.toLowerCase().trim());
}

/** Evalúa si un remito está activo (no cancelado ni anulado administrativamente) */
export function esRemitoActivo(remito: Remito): boolean {
  if (!remito) return false;
  const estado = (remito.estado || '').toLowerCase().trim();
  return estado !== 'anulado' && estado !== 'cancelado';
}

/**
 * Evalúa si una visita se encuentra activa y habilitada para operar.
 * Se considera inactiva/cancelada si administración la canceló/anuló
 * o si todos sus remitos asociados fueron cancelados o anulados.
 */
export function esVisitaActiva(visita: Visita): boolean {
  if (!visita) return false;
  const estado = (visita.estado || '').toLowerCase().trim();
  if (estado === 'cancelada' || estado === 'anulada') {
    return false;
  }
  const remitos = visita.remitos || [];
  // Si tiene remitos y todos están anulados/cancelados, la visita no es operable
  if (remitos.length > 0 && remitos.every((r) => !esRemitoActivo(r))) {
    return false;
  }
  return true;
}

/** Determina el estado operativo individual de un documento/remito */
export function estadoDocumento(remito: Remito, cola: ColaPorClave): 'Pendiente' | 'Entregado' | 'Rechazado' {
  if (remito.estado === 'entregado') return 'Entregado';
  if (remito.estado === 'no_entregado' || remito.estado === 'devuelto' || remito.estado === 'anulado') return 'Rechazado';

  const enEntrega = cola.get(`entrega:${remito.id}`);
  if (enEntrega && (enEntrega.estado === 'pendiente' || enEntrega.estado === 'sincronizado')) {
    return 'Entregado';
  }

  const enRechazo = cola.get(`rechazo:${remito.id}`);
  if (enRechazo && (enRechazo.estado === 'pendiente' || enRechazo.estado === 'sincronizado')) {
    return 'Rechazado';
  }

  // Verificar si está incluido en un lote de entrega sincronizado o encolado
  for (const item of cola.values()) {
    if (item.tipo === 'entrega_lote' && (item.estado === 'pendiente' || item.estado === 'sincronizado')) {
      if (item.entregas.some((e) => e.remitoId === remito.id)) {
        return 'Entregado';
      }
    }
  }

  return 'Pendiente';
}

/**
 * Calcula el estado operativo de una parada (Pendiente, En curso, Entregado, Rechazado).
 * Evalúa los remitos y su sincronización en el celular o el servidor.
 */
export function calcularEstadoOperativoParada(visitas: Visita | Visita[], cola: ColaPorClave): EstadoOperativoParada {
  const listaVisitas = Array.isArray(visitas) ? visitas : [visitas];
  if (listaVisitas.length === 0) return 'Pendiente';

  // Si todas las visitas están en estado 'no_realizada'
  if (listaVisitas.every((v) => v.estado === 'no_realizada')) {
    return 'Rechazado';
  }

  const todosRemitos = listaVisitas.flatMap((v) => v.remitos);
  if (todosRemitos.length === 0) {
    if (listaVisitas.every((v) => v.estado === 'completada')) return 'Entregado';
    if (listaVisitas.some((v) => v.estado === 'en_curso')) return 'En curso';
    return 'Pendiente';
  }

  let totalEntregados = 0;
  let totalRechazados = 0;
  let totalPendientes = 0;

  for (const remito of todosRemitos) {
    const estado = estadoDocumento(remito, cola);
    if (estado === 'Entregado') totalEntregados++;
    else if (estado === 'Rechazado') totalRechazados++;
    else totalPendientes++;
  }

  // Todos resueltos
  if (totalPendientes === 0) {
    if (totalEntregados > 0) return 'Entregado';
    if (totalRechazados > 0) return 'Rechazado';
  }

  // Si hubo al menos una gestión (entrega o rechazo) o la visita está en curso en backend
  if (totalEntregados > 0 || totalRechazados > 0 || listaVisitas.some((v) => v.estado === 'en_curso')) {
    return 'En curso';
  }

  return 'Pendiente';
}

export interface GrupoRemitosMarca {
  marca: string;
  documentos: DocumentoAsociado[];
  totalBultos: number;
  totalRemitos: number;
  totalImporteCentavos: number;
}

/**
 * Agrupa los documentos asociados por marca para su despliegue clasificado.
 */
export function agruparRemitosPorMarca(documentos: DocumentoAsociado[]): GrupoRemitosMarca[] {
  const mapa = new Map<string, DocumentoAsociado[]>();
  for (const doc of documentos) {
    const marca = (doc.marca || 'Sin marca').trim();
    const lista = mapa.get(marca);
    if (lista) {
      lista.push(doc);
    } else {
      mapa.set(marca, [doc]);
    }
  }

  return Array.from(mapa.entries())
    .map(([marca, docs]) => ({
      marca,
      documentos: docs,
      totalBultos: docs.reduce((sum, d) => sum + d.bultos, 0),
      totalRemitos: docs.length,
      totalImporteCentavos: docs.reduce((sum, d) => sum + d.importeCentavos, 0),
    }))
    .sort((a, b) => a.marca.localeCompare(b.marca));
}

/**
 * Agrupa y consolida las visitas activas por punto de entrega (comercio),
 * garantizando el orden de secuencia planificado y consolidando carga, totalizadores por marca y documentos.
 * Oculta forzosamente las visitas canceladas o con remitos anulados.
 */
export function consolidarParadas(visitas: Visita[], cola: ColaPorClave): ParadaConsolidada[] {
  if (!visitas || visitas.length === 0) return [];

  // Filtrar únicamente visitas activas (oculta visitas canceladas o con todos los remitos cancelados)
  const visitasActivas = visitas.filter((v) => esVisitaActiva(v));
  if (visitasActivas.length === 0) return [];

  // 1. Ordenar visitas de entrada según la secuencia planificada
  const visitasOrdenadas = [...visitasActivas].sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999));

  // 2. Agrupar por comercio
  const grupos = new Map<string, Visita[]>();
  for (const visita of visitasOrdenadas) {
    const c = visita.comercio;
    const clave = c.id
      ? `id:${c.id}`
      : `${(c.razonSocial || '').trim().toLowerCase()}::${(c.domicilio || '').trim().toLowerCase()}`;

    const existentes = grupos.get(clave);
    if (existentes) {
      existentes.push(visita);
    } else {
      grupos.set(clave, [visita]);
    }
  }

  // 3. Crear paradas consolidadas
  const paradas: ParadaConsolidada[] = [];

  for (const visitasComercio of grupos.values()) {
    const principal = visitasComercio[0];
    const remitos = visitasComercio.flatMap((v) => v.remitos);

    // Documentos asociados desglosados (excluyendo remitos individualmente cancelados/anulados si los hubiera)
    const remitosVisibles = remitos.filter((r) => esRemitoActivo(r));

    // Marcas únicas
    const marcasSet = new Set<string>();
    for (const r of remitosVisibles) {
      if (r.marca) marcasSet.add(r.marca);
    }
    const marcas = Array.from(marcasSet).sort();

    const documentos: DocumentoAsociado[] = remitosVisibles.map((r) => {
      const enRechazo = cola.get(`rechazo:${r.id}`);
      const motivoEnCola = enRechazo && enRechazo.tipo === 'rechazo' ? enRechazo.cuerpo.motivo : null;
      return {
        id: r.id,
        numero: r.numero,
        marca: r.marca,
        bultos: r.bultos && r.bultos > 0 ? r.bultos : 1,
        importeCentavos: r.importeCentavos,
        estadoOperativo: estadoDocumento(r, cola),
        motivoNoEntrega: r.motivoNoEntrega || motivoEnCola,
      };
    });

    const totalBultos = documentos.reduce((sum, d) => sum + d.bultos, 0);
    const totalImporteCentavos = visitasComercio.reduce((sum, v) => sum + (v.importe?.totalCentavos || 0), 0);
    const sinCobroEnDestino = totalImporteCentavos === 0;

    // Totalizadores por marca
    const mapaMarca = new Map<string, { totalRemitos: number; totalBultos: number; totalImporteCentavos: number }>();
    for (const doc of documentos) {
      const m = (doc.marca || 'Sin marca').trim();
      const actual = mapaMarca.get(m) || { totalRemitos: 0, totalBultos: 0, totalImporteCentavos: 0 };
      actual.totalRemitos += 1;
      actual.totalBultos += doc.bultos;
      actual.totalImporteCentavos += doc.importeCentavos;
      mapaMarca.set(m, actual);
    }

    const resumenPorMarca: ResumenCargaMarca[] = Array.from(mapaMarca.entries())
      .map(([marca, datos]) => ({
        marca,
        totalRemitos: datos.totalRemitos,
        totalBultos: datos.totalBultos,
        totalImporteCentavos: datos.totalImporteCentavos,
      }))
      .sort((a, b) => a.marca.localeCompare(b.marca));

    const estadoOperativo = calcularEstadoOperativoParada(visitasComercio, cola);

    paradas.push({
      id: principal.id,
      visitaPrincipal: principal,
      visitas: visitasComercio,
      orden: principal.orden ?? 9999,
      comercio: principal.comercio,
      estadoOperativo,
      marcas,
      totalRemitos: documentos.length,
      totalBultos,
      totalImporteCentavos,
      sinCobroEnDestino,
      documentos,
      resumenPorMarca,
    });
  }

  // 4. Ordenar paradas estrictamente por la secuencia planificada
  return paradas.sort((a, b) => a.orden - b.orden);
}

export interface ResultadoVerificacionParada {
  activa: boolean;
  paradaActualizada?: ParadaConsolidada;
  motivo?: string;
}

/**
 * Verifica si una parada o sus visitas continúan activas en la hoja de ruta provista.
 * Si fue cancelada, eliminada o sus remitos anulados por administración, retorna activa = false.
 */
export function verificarParadaActiva(
  paradaOId: ParadaConsolidada | string,
  hoja: HojaDeRuta | null | undefined,
  cola: ColaPorClave = new Map()
): ResultadoVerificacionParada {
  if (!hoja || !hoja.visitas || hoja.visitas.length === 0) {
    return {
      activa: false,
      motivo: 'No se encontraron visitas activas en la hoja de ruta.',
    };
  }

  const paradaId = typeof paradaOId === 'string' ? paradaOId : paradaOId.id;
  const idsVisitasParada =
    typeof paradaOId === 'object' && paradaOId.visitas
      ? paradaOId.visitas.map((v) => v.id)
      : [paradaId];

  const comercioId = typeof paradaOId === 'object' ? paradaOId.comercio?.id : undefined;

  // Buscar visitas que coincidan con la parada
  const visitasCoincidentes = hoja.visitas.filter((v) => {
    if (idsVisitasParada.includes(v.id)) return true;
    if (comercioId && v.comercio?.id === comercioId) return true;
    return false;
  });

  if (visitasCoincidentes.length === 0) {
    return {
      activa: false,
      motivo: 'Esta parada fue eliminada de la hoja de ruta por administración.',
    };
  }

  const visitasActivas = visitasCoincidentes.filter(esVisitaActiva);
  if (visitasActivas.length === 0) {
    return {
      activa: false,
      motivo: 'Esta parada o sus remitos fueron cancelados recientemente por administración.',
    };
  }

  // Consolidar para obtener la versión actualizada de la parada
  const paradasConsolidadas = consolidarParadas(hoja.visitas, cola);
  const paradaActualizada = paradasConsolidadas.find(
    (p) => p.id === paradaId || (comercioId && p.comercio?.id === comercioId)
  );

  if (!paradaActualizada) {
    return {
      activa: false,
      motivo: 'La parada ya no se encuentra disponible.',
    };
  }

  return {
    activa: true,
    paradaActualizada,
  };
}

