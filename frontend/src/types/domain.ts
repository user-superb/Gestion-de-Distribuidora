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
  numero?: string;
  sucursalId?: string;
  transportistaId?: string | null;
  transportistaNombre?: string | null;
  fechaReparto: string;
  patente?: string;
  estado: 'borrador' | 'pendiente_de_despacho' | 'publicada' | 'en_curso' | 'cerrada' | 'anulada';
  visitas?: Visita[];
  cantidadVisitas?: number;
  cantidadRemitos?: number;
  importeTotal?: number;
}

export interface Transportista {
  id: string;
  nombre: string;
  usuario: string;
  email?: string | null;
  rol?: string;
  activo: boolean;
  esTransportista?: boolean;
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
