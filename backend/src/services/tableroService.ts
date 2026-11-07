// backend/src/services/tableroService.ts
// Historia de Usuario Gerencia: Monitorear composición de recaudación por medio de pago.
import { db } from '../db.js';

export type MedioPago = 'efectivo' | 'transferencia' | 'qr';

export const MEDIOS_PAGO_CONFIG: { medioPago: MedioPago; etiqueta: string; color: string }[] = [
  { medioPago: 'efectivo', etiqueta: 'Efectivo', color: '#10B981' },
  { medioPago: 'transferencia', etiqueta: 'Transferencia bancaria', color: '#2563EB' },
  { medioPago: 'qr', etiqueta: 'Pago QR', color: '#F4661B' },
];

export interface FiltrosRecaudacion {
  sucursalId?: string;
  fechaDesde?: string; // Formato AAAA-MM-DD
  fechaHasta?: string; // Formato AAAA-MM-DD
  soloConfirmados?: boolean; // Por defecto true según la regla de negocio
}

export interface FiltrosEntregasDiarias {
  fecha?: string; // Formato AAAA-MM-DD (por defecto fecha actual)
  sucursalId?: string;
}

export interface MetricasEntregasDiariasResponse {
  fecha: string;
  totalDespachados: number;
  exitosas: number;
  pendientes: number;
  rechazadas: number;
  porcentajeExitosas: number;
  porcentajePendientes: number;
  porcentajeRechazadas: number;
  tasaEfectividad: number;
  operacionInactiva: boolean;
  mensajeEstado?: string;
  filtrosAplicados: {
    fecha: string;
    sucursalId: string | null;
  };
}

export interface DesgloseMedioPago {
  medioPago: MedioPago;
  etiqueta: string;
  totalCentavos: number;
  totalPesos: number;
  cantidadPagos: number;
  porcentaje: number;
  color: string;
}

export interface ComposicionRecaudacionResponse {
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

export class TableroService {
  /**
   * Obtiene la recaudación consolidada y discriminada por medio de pago (Efectivo, Transferencia, QR).
   * Considera por defecto únicamente pagos confirmados (estado = 'validado').
   */
  async obtenerComposicionRecaudacion(
    filtros: FiltrosRecaudacion = {}
  ): Promise<ComposicionRecaudacionResponse> {
    const soloConfirmados = filtros.soloConfirmados !== false;
    const condiciones: string[] = [];
    const params: unknown[] = [];

    // Regla de negocio: pagos confirmados
    if (soloConfirmados) {
      condiciones.push("c.estado = 'validado'");
    } else {
      condiciones.push("c.estado <> 'rechazado'");
    }

    if (filtros.sucursalId) {
      params.push(filtros.sucursalId);
      condiciones.push(`h.sucursal_id::text = $${params.length}`);
    }

    if (filtros.fechaDesde) {
      params.push(`${filtros.fechaDesde}T00:00:00.000Z`);
      condiciones.push(`c.registrado_en >= $${params.length}`);
    }

    if (filtros.fechaHasta) {
      params.push(`${filtros.fechaHasta}T23:59:59.999Z`);
      condiciones.push(`c.registrado_en <= $${params.length}`);
    }

    const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

    const query = `
      SELECT
        c.medio_pago,
        COUNT(c.id) AS cantidad_pagos,
        COALESCE(SUM(c.importe_centavos), 0) AS total_centavos
      FROM cobro c
      LEFT JOIN visita v ON v.id = c.visita_id
      LEFT JOIN hoja_de_ruta h ON h.id = v.hoja_de_ruta_id
      ${whereClause}
      GROUP BY c.medio_pago
    `;

    const res = await db.query(query, params);

    // Mapear los resultados por medio de pago
    const resultadosPorMedio = new Map<string, { totalCentavos: number; cantidad: number }>();
    let totalAcumuladoCentavos = 0;
    let totalCantidadPagos = 0;

    for (const row of res.rows) {
      const medio = String(row.medio_pago).toLowerCase();
      const centavos = Number(row.total_centavos || 0);
      const cantidad = Number(row.cantidad_pagos || 0);
      resultadosPorMedio.set(medio, { totalCentavos: centavos, cantidad });
      totalAcumuladoCentavos += centavos;
      totalCantidadPagos += cantidad;
    }

    // Asegurar que Efectivo, Transferencia y QR siempre estén presentes en el desglose
    const desglose: DesgloseMedioPago[] = MEDIOS_PAGO_CONFIG.map((config) => {
      const datos = resultadosPorMedio.get(config.medioPago) || { totalCentavos: 0, cantidad: 0 };
      const porcentaje =
        totalAcumuladoCentavos > 0
          ? Math.round((datos.totalCentavos / totalAcumuladoCentavos) * 1000) / 10
          : 0;

      return {
        medioPago: config.medioPago,
        etiqueta: config.etiqueta,
        totalCentavos: datos.totalCentavos,
        totalPesos: datos.totalCentavos / 100,
        cantidadPagos: datos.cantidad,
        porcentaje,
        color: config.color,
      };
    });

    return {
      totalRecaudadoCentavos: totalAcumuladoCentavos,
      totalRecaudadoPesos: totalAcumuladoCentavos / 100,
      cantidadTotalPagos: totalCantidadPagos,
      desglose,
      filtrosAplicados: {
        sucursalId: filtros.sucursalId ?? null,
        fechaDesde: filtros.fechaDesde ?? null,
        fechaHasta: filtros.fechaHasta ?? null,
        soloConfirmados,
      },
    };
  }

  /**
   * Obtiene las métricas de entregas diarias contrastando exitosas vs rechazadas vs pendientes.
   * Maneja el escenario de inactividad comercial cuando no hubo despachos en la fecha.
   */
  async obtenerMetricasEntregasDiarias(
    filtros: FiltrosEntregasDiarias = {}
  ): Promise<MetricasEntregasDiariasResponse> {
    const hoy = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fechaDefecto = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
    const fecha = filtros.fecha || fechaDefecto;

    const condiciones: string[] = ['h.fecha_reparto = $1::date', "h.estado <> 'anulada'"];
    const params: unknown[] = [fecha];

    if (filtros.sucursalId) {
      params.push(filtros.sucursalId);
      condiciones.push(`h.sucursal_id::text = $${params.length}`);
    }

    const query = `
      SELECT
        COUNT(r.id)::int AS total_despachados,
        COUNT(CASE WHEN r.estado = 'entregado' THEN 1 END)::int AS exitosas,
        COUNT(CASE WHEN r.estado IN ('no_entregado', 'rechazado', 'devuelto') THEN 1 END)::int AS rechazadas,
        COUNT(CASE WHEN r.estado IN ('pendiente', 'en_ruta') THEN 1 END)::int AS pendientes
      FROM remito r
      JOIN visita v ON v.id = r.visita_id
      JOIN hoja_de_ruta h ON h.id = v.hoja_de_ruta_id
      WHERE ${condiciones.join(' AND ')}
    `;

    const res = await db.query(query, params);
    const row = res.rows[0] || {};
    const totalDespachados = Number(row.total_despachados || 0);
    const exitosas = Number(row.exitosas || 0);
    const rechazadas = Number(row.rechazadas || 0);
    const pendientes = Number(row.pendientes || 0);

    if (totalDespachados === 0) {
      return {
        fecha,
        totalDespachados: 0,
        exitosas: 0,
        pendientes: 0,
        rechazadas: 0,
        porcentajeExitosas: 0,
        porcentajePendientes: 0,
        porcentajeRechazadas: 0,
        tasaEfectividad: 0,
        operacionInactiva: true,
        mensajeEstado: 'Operación inactiva en la fecha',
        filtrosAplicados: {
          fecha,
          sucursalId: filtros.sucursalId ?? null,
        },
      };
    }

    const porcentajeExitosas = Math.round((exitosas / totalDespachados) * 1000) / 10;
    const porcentajePendientes = Math.round((pendientes / totalDespachados) * 1000) / 10;
    const porcentajeRechazadas = Math.round((rechazadas / totalDespachados) * 1000) / 10;
    const tasaEfectividad = porcentajeExitosas;

    return {
      fecha,
      totalDespachados,
      exitosas,
      pendientes,
      rechazadas,
      porcentajeExitosas,
      porcentajePendientes,
      porcentajeRechazadas,
      tasaEfectividad,
      operacionInactiva: false,
      filtrosAplicados: {
        fecha,
        sucursalId: filtros.sucursalId ?? null,
      },
    };
  }
}

export const tableroService = new TableroService();
