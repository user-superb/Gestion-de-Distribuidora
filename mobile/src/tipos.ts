// Tipos que devuelve la API móvil (backend/src/routes/movilRoutes.ts).
import type { MedioPago } from './dominio/cobro';

export interface Sesion {
  token: string;
  nombre: string;
  rol: string;
}

export interface Remito {
  id: string;
  numero: string;
  marca: string;
  importeCentavos: number;
  estado: string;
}

export interface ImporteVisita {
  totalCentavos: number;
  subtotalesPorMarca: { marca: string; importeCentavos: number }[];
  remitosExcluidos: string[];
  sinCobroEnDestino: boolean;
}

export interface Visita {
  id: string;
  orden: number | null;
  estado: string;
  comercio: {
    razonSocial: string;
    nombreFantasia: string | null;
    domicilio: string;
    localidad: string | null;
    ventanaDesde: string | null;
    ventanaHasta: string | null;
    telefono: string | null;
  };
  remitos: Remito[];
  importe: ImporteVisita;
}

export interface HojaDeRuta {
  id: string;
  fechaReparto: string;
  patente: string | null;
  estado: string;
  sucursal: string;
  visitas: Visita[];
}

export interface PagoDto {
  claveIdempotencia: string;
  medioPago: MedioPago;
  importeCentavos: number;
  referenciaTransferencia?: string;
}

export interface Ubicacion {
  latitud: number;
  longitud: number;
  precisionMetros: number | null;
}

/** Cuerpo de POST /api/movil/visitas/:id/cobro */
export interface CobroDto {
  pagos: PagoDto[];
  registradoEn: string;
  ubicacion: Ubicacion | null;
}
