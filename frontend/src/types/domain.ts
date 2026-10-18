// src/types/domain.ts

export interface Comercio {
  id: string;
  razonSocial: string;
  domicilio: string;
}

export interface Marca {
  id: string;
  nombre: string;
}

export interface Remito {
  id: string;
  numeroRemito: string;
  comercioId: string;
  marcaId: string;
  importe: number;
  estado: 'PENDIENTE' | 'AGRUPADO';
}

export interface Visita {
  id: string;
  comercioId: string;
  remitos: Remito[];
  importeTotal: number;
  orden?: number;
  hojaDeRutaId?: string | null;
  estado?: string;
}

export interface HojaDeRuta {
  id: string;
  sucursalId?: string;
  transportistaId?: string;
  fechaReparto: string;
  patente?: string;
  estado: 'borrador' | 'publicada' | 'en_curso' | 'cerrada' | 'anulada';
  visitas?: Visita[];
}

// -------------------------------------------------------------
// Tipos para HU #22: Ejecución Móvil de Repartos y Entregas
// -------------------------------------------------------------

export interface RemitoEntrega {
  id: string;
  numeroRemito: string;
  marcaId: string;
  marcaNombre: string;
  comercioId: string;
  importe: number;
  importeCentavos: number;
  estado: 'pendiente' | 'en_ruta' | 'entregado' | 'no_entregado' | 'anulado';
  visitaId?: string | null;
  entregadoEn?: string | null;
  entregadoPor?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  enColaOffline?: boolean;
}

export interface VisitaParada {
  id: string;
  comercioId: string;
  comercioNombre: string;
  comercioDomicilio: string;
  comercioLocalidad?: string;
  orden: number;
  estado: 'pendiente' | 'en_curso' | 'completada' | 'no_realizada';
  registradaEn?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  remitos: RemitoEntrega[];
  todosEntregados: boolean;
}

export interface HojaDeRutaActiva {
  id: string;
  transportistaId: string;
  fechaReparto: string;
  patente: string;
  estado: string;
  visitas: VisitaParada[];
  resumen: {
    totalVisitas: number;
    visitasCompletadas: number;
    totalRemitos: number;
    remitosEntregados: number;
  };
}

export interface EntregaOfflineItem {
  remitoId: string;
  timestamp: string;
  transportistaId: string;
  latitud: number;
  longitud: number;
  guardadoEn: string;
  intentos?: number;
}