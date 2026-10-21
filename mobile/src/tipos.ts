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
  motivoNoEntrega?: string | null;
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
  /** Lo cierra la entrega de todos los remitos (HU #22). */
  estado: string;
  /** Ya tiene el cobro registrado en el servidor (HU #25 a #29). */
  cobrada: boolean;
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

/** Entrega de un remito individual dentro de un lote (HU #23). */
export interface ItemEntregaLote {
  remitoId: string;
  cuerpo: EntregaDto;
}

/** Cuerpo de POST /api/transportista/visitas/:id/confirmar-todo (HU #23). */
export interface EntregaLoteCuerpo {
  timestamp: string;
  latitud: number;
  longitud: number;
  entregas: ItemEntregaLote[];
}

/** Cuerpo de POST /api/transportista/remitos/:id/rechazar */
export interface RechazoDto {
  motivo: string;
  timestamp: string;
  latitud?: number | null;
  longitud?: number | null;
}

/** Cuerpo de POST /api/transportista/remitos/:id/confirmar (HU #22). La API exige GPS. */
export interface EntregaDto {
  timestamp: string;
  latitud: number;
  longitud: number;
}

/** Cuerpo de POST /api/movil/visitas/:id/cobro */
export interface CobroDto {
  pagos: PagoDto[];
  registradoEn: string;
  ubicacion: Ubicacion | null;
}
