// frontend/src/components/dashboard/GraficoEntregasDiarias.tsx
// Gráfico y panel de métricas de entregas diarias para evaluar la eficiencia de la flota logística.
import React from 'react';
import { MetricasEntregasDiarias } from '../../types/entregas';
import { formatearPorcentaje } from '../../services/tableroService';
import {
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  Calendar,
  RefreshCw,
  TrendingUp,
  Inbox,
} from 'lucide-react';

interface GraficoEntregasDiariasProps {
  data: MetricasEntregasDiarias | null;
  fechaSeleccionada: string;
  onCambioFecha: (fecha: string) => void;
  cargando: boolean;
  onRecargar: () => void;
}

export const GraficoEntregasDiarias: React.FC<GraficoEntregasDiariasProps> = ({
  data,
  fechaSeleccionada,
  onCambioFecha,
  cargando,
  onRecargar,
}) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const hoyStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  const ayerStr = (() => {
    const d = new Date(Date.now() - 86400000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  const esOperacionInactiva = !data || data.operacionInactiva || data.totalDespachados === 0;

  return (
    <div className="space-y-6" data-testid="modulo-entregas-diarias">
      {/* Barra de Filtro de Fecha Diario */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-marca-azul" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Fecha de Análisis Operativo</h3>
            <p className="text-xs text-slate-500">Evaluación diaria de despacho y efectividad de flota</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onCambioFecha(hoyStr)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
              fechaSeleccionada === hoyStr
                ? 'bg-marca-azul text-white border-marca-azul'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => onCambioFecha(ayerStr)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
              fechaSeleccionada === ayerStr
                ? 'bg-marca-azul text-white border-marca-azul'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Ayer
          </button>

          <input
            type="date"
            value={fechaSeleccionada}
            onChange={(e) => onCambioFecha(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 font-mono bg-white focus:outline-none focus:ring-2 focus:ring-marca-azul/20 focus:border-marca-azul"
          />

          <button
            type="button"
            onClick={onRecargar}
            disabled={cargando}
            aria-label="Actualizar métricas"
            className="p-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            title="Recargar datos"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin text-marca-azul' : ''}`} />
          </button>
        </div>
      </div>

      {/* ESCENARIO 2: Fallo visual por inactividad comercial */}
      {esOperacionInactiva ? (
        <div className="space-y-6" data-testid="inactividad-comercial">
          {/* Tarjeta de métrica plana de inactividad */}
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-8 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
              <Inbox className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-extrabold text-amber-950 tracking-tight">
                Operación inactiva en la fecha
              </h4>
              <p className="text-xs text-amber-800 max-w-md mx-auto mt-1 leading-relaxed">
                No se registraron despachos ni hojas de ruta activas para el día{' '}
                <strong className="font-mono font-semibold">{fechaSeleccionada}</strong>.
              </p>
            </div>
            <p className="text-[11px] text-amber-700">
              Probá seleccionando otra fecha en el selector superior para analizar la actividad de la flota.
            </p>
          </div>

          {/* Métricas planas en cero */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs text-center opacity-60">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Total Despachados
              </span>
              <div className="text-2xl font-black text-slate-700 mt-1">0</div>
              <span className="text-[11px] text-slate-400">Sin remitos</span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs text-center opacity-60">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Entregas Exitosas
              </span>
              <div className="text-2xl font-black text-slate-700 mt-1">0</div>
              <span className="text-[11px] text-slate-400">0,0% del total</span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs text-center opacity-60">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Remitos Pendientes
              </span>
              <div className="text-2xl font-black text-slate-700 mt-1">0</div>
              <span className="text-[11px] text-slate-400">0,0% del total</span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs text-center opacity-60">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Remitos Rechazados
              </span>
              <div className="text-2xl font-black text-slate-700 mt-1">0</div>
              <span className="text-[11px] text-slate-400">0,0% del total</span>
            </div>
          </div>
        </div>
      ) : (
        /* ESCENARIO 1: Carga de métricas exitosa */
        <div className="space-y-6" data-testid="metricas-exitosas">
          {/* Tarjetas KPI de Entregas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Despachados */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Total Despachados
                </span>
                <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
                  <Truck className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900 mt-2 font-mono">
                {data.totalDespachados}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Remitos asignados a rutas del día
              </div>
            </div>

            {/* Entregas Exitosas */}
            <div className="bg-white rounded-xl border border-emerald-200 shadow-xs p-5 relative overflow-hidden bg-emerald-50/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Entregas Exitosas
                </span>
                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-emerald-700 mt-2 font-mono">
                {data.exitosas}
              </div>
              <div className="text-xs font-semibold text-emerald-600 mt-1 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{formatearPorcentaje(data.porcentajeExitosas)} efectividad</span>
              </div>
            </div>

            {/* Remitos Pendientes */}
            <div className="bg-white rounded-xl border border-blue-200 shadow-xs p-5 relative overflow-hidden bg-blue-50/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-800">
                  Pendientes en Ruta
                </span>
                <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-blue-700 mt-2 font-mono">
                {data.pendientes}
              </div>
              <div className="text-xs text-blue-600 mt-1">
                {formatearPorcentaje(data.porcentajePendientes)} sin completar aún
              </div>
            </div>

            {/* Remitos Rechazados */}
            <div className="bg-white rounded-xl border border-rose-200 shadow-xs p-5 relative overflow-hidden bg-rose-50/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
                  Rechazados / Devueltos
                </span>
                <div className="p-2 rounded-lg bg-rose-100 text-rose-700">
                  <XCircle className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-rose-700 mt-2 font-mono">
                {data.rechazadas}
              </div>
              <div className="text-xs text-rose-600 mt-1">
                {formatearPorcentaje(data.porcentajeRechazadas)} entregas fallidas
              </div>
            </div>
          </div>

          {/* Gráfico Comparativo y Barra Proporcional */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Truck className="w-5 h-5 text-marca-azul" />
                  <span>Contraste de Eficiencia de Flota</span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Balance entre remitos completados con éxito frente a pendientes y rechazos.
                </p>
              </div>

              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                <span className="text-xs text-slate-600 font-medium">Tasa de efectividad:</span>
                <span className="text-sm font-extrabold text-emerald-700 font-mono">
                  {formatearPorcentaje(data.tasaEfectividad)}
                </span>
              </div>
            </div>

            {/* Barra de Distribución 100% Apilada */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
                <span>Composición de despachos del día</span>
                <span className="font-mono text-slate-800">{data.totalDespachados} remitos totales</span>
              </div>
              <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                {data.exitosas > 0 && (
                  <div
                    style={{ width: `${data.porcentajeExitosas}%` }}
                    className="h-full bg-emerald-500 transition-all duration-300"
                    title={`Exitosas: ${data.exitosas} (${formatearPorcentaje(data.porcentajeExitosas)})`}
                  />
                )}
                {data.pendientes > 0 && (
                  <div
                    style={{ width: `${data.porcentajePendientes}%` }}
                    className="h-full bg-blue-500 transition-all duration-300"
                    title={`Pendientes: ${data.pendientes} (${formatearPorcentaje(data.porcentajePendientes)})`}
                  />
                )}
                {data.rechazadas > 0 && (
                  <div
                    style={{ width: `${data.porcentajeRechazadas}%` }}
                    className="h-full bg-rose-500 transition-all duration-300"
                    title={`Rechazadas: ${data.rechazadas} (${formatearPorcentaje(data.porcentajeRechazadas)})`}
                  />
                )}
              </div>
            </div>

            {/* Barras de Contraste Detallado */}
            <div className="space-y-4 pt-2">
              {/* Exitosas */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    Entregas Realizadas Exitosamente
                  </span>
                  <span className="font-mono font-bold text-emerald-700">
                    {data.exitosas} remitos ({formatearPorcentaje(data.porcentajeExitosas)})
                  </span>
                </div>
                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${data.porcentajeExitosas}%` }}
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  />
                </div>
              </div>

              {/* Pendientes */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    Remitos Pendientes de Entrega
                  </span>
                  <span className="font-mono font-bold text-blue-700">
                    {data.pendientes} remitos ({formatearPorcentaje(data.porcentajePendientes)})
                  </span>
                </div>
                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${data.porcentajePendientes}%` }}
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  />
                </div>
              </div>

              {/* Rechazadas */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    Remitos Rechazados o No Entregados
                  </span>
                  <span className="font-mono font-bold text-rose-700">
                    {data.rechazadas} remitos ({formatearPorcentaje(data.porcentajeRechazadas)})
                  </span>
                </div>
                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${data.porcentajeRechazadas}%` }}
                    className="h-full bg-rose-500 rounded-full transition-all duration-500"
                  />
                </div>
              </div>
            </div>

            {/* Tabla resumen consolidada */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-2.5 px-3">Estado de Entrega</th>
                    <th className="py-2.5 px-3 text-right">Cantidad de Remitos</th>
                    <th className="py-2.5 px-3 text-right">Participación (%)</th>
                    <th className="py-2.5 px-3">Impacto Operativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Exitosas</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {data.exitosas}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                      {formatearPorcentaje(data.porcentajeExitosas)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      Entregas completadas y remitos conformados
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      <span>Pendientes</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {data.pendientes}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700">
                      {formatearPorcentaje(data.porcentajePendientes)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      En tránsito o pendientes de visita por el chofer
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5 text-rose-600" />
                      <span>Rechazadas</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {data.rechazadas}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700">
                      {formatearPorcentaje(data.porcentajeRechazadas)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      Mercadería no entregada, devuelta o rechazada
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t border-slate-200 text-slate-900">
                    <td className="py-2.5 px-3">Total Despachados</td>
                    <td className="py-2.5 px-3 text-right font-mono">{data.totalDespachados}</td>
                    <td className="py-2.5 px-3 text-right font-mono">100,0%</td>
                    <td className="py-2.5 px-3 text-slate-700 font-semibold">
                      Efectividad: {formatearPorcentaje(data.tasaEfectividad)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
