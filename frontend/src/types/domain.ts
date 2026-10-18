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