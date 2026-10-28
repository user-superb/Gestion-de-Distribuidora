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
  estado: 'PENDIENTE' | 'AGRUPADO' | 'pendiente' | 'en_ruta' | 'entregado' | 'no_entregado' | 'anulado' | 'devuelto' | string;
  visitaId?: string | null;
}

export interface Visita {
  id: string;
  comercioId: string;
  remitos: Remito[];
  importeTotal: number;
  orden?: number;
  hojaDeRutaId?: string | null;
  estado?: string;
  sincronizacionPendiente?: boolean;
}

export interface HojaDeRuta {
  id: string;
  numero?: string;
  sucursalId?: string;
  transportistaId?: string | null;
  transportistaNombre?: string | null;
  transportistaConectado?: boolean;
  fechaReparto: string;
  patente?: string;
  estado: 'borrador' | 'pendiente_de_despacho' | 'publicada' | 'en_curso' | 'cerrada' | 'anulada';
  visitas?: Visita[];
  cantidadVisitas?: number;
  cantidadRemitos?: number;
  importeTotal?: number;
  tieneSincronizacionPendiente?: boolean;
}

export interface Transportista {
  id: string;
  nombre: string;
  usuario: string;
  email?: string | null;
  rol?: string;
  activo: boolean;
  esTransportista?: boolean;
  dispositivoConectado?: boolean;
}

export interface NuevoComercioDto {
  razonSocial: string;
  domicilio: string;
  localidad?: string;
  telefono?: string;
  cuit?: string;
}

export interface CargaEntregaManualDto {
  comercioId?: string;
  nuevoComercio?: NuevoComercioDto;
  marcaId: string;
  importe: number;
  numeroRemito?: string;
  fechaEmision?: string;
  sucursalId?: string;
}

export interface AnexarEntregaResultado {
  success: boolean;
  parada?: Visita;
  ordenParada?: number;
  hojaDeRuta?: HojaDeRuta;
  sincronizacionPendiente?: boolean;
  alerta?: string;
  mensaje?: string;
  error?: string;
  status?: number;
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
