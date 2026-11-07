// frontend/src/types/tablero.ts
// Tipos para el Tablero de Control de Gerencia y Métricas de Recaudación.

export type MedioPago = 'efectivo' | 'transferencia' | 'qr';

export interface DesgloseMedioPago {
  medioPago: MedioPago;
  etiqueta: string;
  totalCentavos: number;
  totalPesos: number;
  cantidadPagos: number;
  porcentaje: number;
  color: string;
}

export interface ComposicionRecaudacion {
  totalRecaudadoCentavos: number;
  totalRecaudadoPesos: number;
  cantidadTotalPagos: number;
  desglose: DesgloseMedioPago[];
  filtrosAplicados: {
    sucursalId: string | null;
    fechaDesde: string | null;
    fechaHasta: string | null;
    soloConfirmados: boolean;
  };
}

export interface TableroFiltros {
  sucursalId?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  soloConfirmados?: boolean;
}
