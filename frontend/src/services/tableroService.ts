// frontend/src/services/tableroService.ts
// Servicio para consultar el Tablero Gerencial y composición de recaudación.
import { API_BASE } from '../config/api';
import { ComposicionRecaudacion, TableroFiltros } from '../types/tablero';
import { MetricasEntregasDiarias, EntregasFiltros } from '../types/entregas';

export interface SucursalesPermitidasResponse {
  esGlobal: boolean;
  sucursales: { id: string; nombre: string }[];
}

export class TableroServiceError extends Error {
  constructor(message: string, public status = 500, public details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TableroServiceError';
  }
}

export function formatearMoneda(monto: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto);
}

export function formatearCentavos(centavos: number): string {
  return formatearMoneda(centavos / 100);
}

export function formatearPorcentaje(porcentaje: number): string {
  return `${porcentaje.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export const tableroService = {
  async obtenerRecaudacion(token: string, filtros: TableroFiltros = {}): Promise<ComposicionRecaudacion> {
    const params = new URLSearchParams();

    if (filtros.sucursalId) params.set('sucursalId', filtros.sucursalId);
    if (filtros.fechaDesde) params.set('fechaDesde', filtros.fechaDesde);
    if (filtros.fechaHasta) params.set('fechaHasta', filtros.fechaHasta);
    if (filtros.soloConfirmados !== undefined) {
      params.set('confirmados', filtros.soloConfirmados ? 'true' : 'false');
    }

    const queryString = params.toString();
    const url = `${API_BASE}/tablero/recaudacion${queryString ? `?${queryString}` : ''}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      let errorBody: any = {};
      try {
        errorBody = await res.json();
      } catch {
        // Fallback si no es JSON
      }
      throw new TableroServiceError(
        errorBody.message || 'Error al obtener la composición de recaudación.',
        res.status,
        errorBody
      );
    }

    return (await res.json()) as ComposicionRecaudacion;
  },

  async obtenerMetricasEntregasDiarias(
    token: string,
    filtros: EntregasFiltros = {}
  ): Promise<MetricasEntregasDiarias> {
    const params = new URLSearchParams();

    if (filtros.fecha) params.set('fecha', filtros.fecha);
    if (filtros.sucursalId) params.set('sucursalId', filtros.sucursalId);

    const queryString = params.toString();
    const url = `${API_BASE}/tablero/entregas-diarias${queryString ? `?${queryString}` : ''}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      let errorBody: any = {};
      try {
        errorBody = await res.json();
      } catch {
        // Fallback si no es JSON
      }
      throw new TableroServiceError(
        errorBody.message || 'Error al obtener las métricas de entregas diarias.',
        res.status,
        errorBody
      );
    }

    return (await res.json()) as MetricasEntregasDiarias;
  },

  async obtenerSucursalesPermitidas(token: string): Promise<SucursalesPermitidasResponse> {
    const url = `${API_BASE}/tablero/sucursales-permitidas`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      let errorBody: any = {};
      try {
        errorBody = await res.json();
      } catch {
        // Fallback si no es JSON
      }
      throw new TableroServiceError(
        errorBody.message || 'Error al consultar las sucursales permitidas.',
        res.status,
        errorBody
      );
    }

    return (await res.json()) as SucursalesPermitidasResponse;
  },
};
