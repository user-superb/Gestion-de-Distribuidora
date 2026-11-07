// frontend/src/components/dashboard/GraficoEntregasDiarias.tsx
// Gráfico y panel de métricas de entregas diarias en formato dona y desglose de estados.
import React, { useState } from 'react';
import { MetricasEntregasDiarias } from '../../types/entregas';
import { formatearPorcentaje } from '../../services/tableroService';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Calendar,
  RefreshCw,
  Inbox,
  PieChart,
} from 'lucide-react';

interface GraficoEntregasDiariasProps {
  data: MetricasEntregasDiarias | null;
  fechaSeleccionada: string;
  onCambioFecha: (fecha: string) => void;
  cargando: boolean;
  onRecargar: () => void;
}

type EstadoEntrega = 'exitosas' | 'pendientes' | 'rechazadas';

interface SegmentoEntrega {
  tipo: EstadoEntrega;
  etiqueta: string;
  cantidad: number;
  porcentaje: number;
  color: string;
  icono: React.ComponentType<{ className?: string }>;
  iconColor: string;
  impacto: string;
}

export const GraficoEntregasDiarias: React.FC<GraficoEntregasDiariasProps> = ({
  data,
  fechaSeleccionada,
  onCambioFecha,
  cargando,
  onRecargar,
}) => {
  const [estadoSeleccionado, setEstadoSeleccionado] = useState<EstadoEntrega | null>(null);

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

  const totalDespachados = data?.totalDespachados || 0;

  // Desglose de los 3 estados de entrega
  const itemsDesglose: SegmentoEntrega[] = data
    ? [
        {
          tipo: 'exitosas',
          etiqueta: 'Entregas exitosas',
          cantidad: data.exitosas,
          porcentaje: data.porcentajeExitosas,
          color: '#10B981', // Verde esmeralda
          icono: CheckCircle2,
          iconColor: 'text-emerald-600',
          impacto: 'Entregas completadas y remitos conformados',
        },
        {
          tipo: 'pendientes',
          etiqueta: 'Remitos pendientes',
          cantidad: data.pendientes,
          porcentaje: data.porcentajePendientes,
          color: '#3B82F6', // Azul
          icono: Clock,
          iconColor: 'text-blue-600',
          impacto: 'En tránsito o pendientes de visita por el chofer',
        },
        {
          tipo: 'rechazadas',
          etiqueta: 'Remitos rechazados',
          cantidad: data.rechazadas,
          porcentaje: data.porcentajeRechazadas,
          color: '#F43F5E', // Rosa / rojo
          icono: XCircle,
          iconColor: 'text-rose-600',
          impacto: 'Mercadería no entregada, devuelta o rechazada',
        },
      ]
    : [];

  // Cálculo de los arcos de la Dona SVG mediante stroke-dasharray
  // Radio r = 40, perímetro = 2 * PI * 40 ~= 251.327
  const RADIO = 40;
  const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
  let offsetAcumulado = 0;

  const segmentosDona = itemsDesglose.map((item) => {
    const proporcion = totalDespachados > 0 ? item.cantidad / totalDespachados : 0;
    const dashLength = proporcion * CIRCUNFERENCIA;
    const dashOffset = -offsetAcumulado;
    offsetAcumulado += dashLength;

    return {
      ...item,
      dashLength,
      dashOffset,
      proporcion,
    };
  });

  const detalleActivo = estadoSeleccionado
    ? itemsDesglose.find((d) => d.tipo === estadoSeleccionado)
    : null;

  return (
    <div className="space-y-6" data-testid="modulo-entregas-diarias">
      {/* Barra de Filtro de Fecha Diario */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-marca-azul" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Fecha de Análisis Operativo</h3>
            <p className="text-xs text-slate-500">Evaluación diaria de despacho y estado de entregas</p>
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
        </div>
      ) : (
        /* ESCENARIO 1: Carga de métricas exitosa */
        <div className="space-y-6" data-testid="metricas-exitosas">
          {/* Gráfico de Dona y Desglose Proporcional (Idéntico a Recaudación) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-marca-azul" />
                  <span>Distribución de Entregas del Día</span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Composición consolidada de entregas exitosas, pendientes y rechazadas.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Gráfico de Dona SVG */}
              <div className="lg:col-span-5 flex flex-col items-center justify-center relative">
                <div className="relative w-64 h-64">
                  <svg
                    viewBox="0 0 100 100"
                    className="w-full h-full transform -rotate-90"
                    role="img"
                    aria-label="Gráfico circular de entregas diarias"
                  >
                    {/* Círculo base de fondo */}
                    <circle
                      cx="50"
                      cy="50"
                      r={RADIO}
                      className="stroke-slate-100"
                      strokeWidth="14"
                      fill="none"
                    />

                    {/* Segmentos de la dona */}
                    {segmentosDona.map((seg) => {
                      if (seg.cantidad === 0) return null;
                      const isHovered = estadoSeleccionado === seg.tipo;

                      return (
                        <circle
                          key={seg.tipo}
                          cx="50"
                          cy="50"
                          r={RADIO}
                          fill="none"
                          stroke={seg.color}
                          strokeWidth={isHovered ? 17 : 14}
                          strokeDasharray={`${seg.dashLength} ${CIRCUNFERENCIA}`}
                          strokeDashoffset={seg.dashOffset}
                          className="transition-all duration-300 cursor-pointer"
                          style={{ strokeLinecap: 'butt' }}
                          onMouseEnter={() => setEstadoSeleccionado(seg.tipo)}
                          onMouseLeave={() => setEstadoSeleccionado(null)}
                        />
                      );
                    })}
                  </svg>

                  {/* Centro de la Dona con Total o Detalle Seleccionado */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      {detalleActivo ? detalleActivo.etiqueta : 'Total Despachados'}
                    </span>
                    <span className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono">
                      {detalleActivo ? detalleActivo.cantidad : totalDespachados}
                    </span>
                    <span className="text-xs text-slate-500 font-medium mt-0.5">
                      {detalleActivo
                        ? `${formatearPorcentaje(detalleActivo.porcentaje)} del total`
                        : `${totalDespachados} ${totalDespachados === 1 ? 'remito' : 'remitos'} del día`}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Pasá el cursor sobre cada sector para ver su detalle
                </p>
              </div>

              {/* Tarjetas y Desglose por Estado */}
              <div className="lg:col-span-7 space-y-4">
                {/* Barra de Distribución Proporcional Apilada */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
                    <span>Composición de despachos del día</span>
                    <span className="font-mono text-slate-800">{totalDespachados} remitos totales</span>
                  </div>
                  <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                    {segmentosDona.map((seg) => {
                      if (seg.cantidad === 0) return null;
                      return (
                        <div
                          key={seg.tipo}
                          style={{
                            width: `${seg.porcentaje}%`,
                            backgroundColor: seg.color,
                          }}
                          className="h-full transition-all duration-300 relative group cursor-pointer"
                          title={`${seg.etiqueta}: ${seg.cantidad} (${formatearPorcentaje(seg.porcentaje)})`}
                          onMouseEnter={() => setEstadoSeleccionado(seg.tipo)}
                          onMouseLeave={() => setEstadoSeleccionado(null)}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Listado de Estados Diferenciados */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  {itemsDesglose.map((item) => {
                    const isSelected = estadoSeleccionado === item.tipo;
                    const Icon = item.icono;

                    return (
                      <div
                        key={item.tipo}
                        onMouseEnter={() => setEstadoSeleccionado(item.tipo)}
                        onMouseLeave={() => setEstadoSeleccionado(null)}
                        className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-marca-azul bg-blue-50/50 shadow-xs'
                            : 'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="text-xs font-bold text-slate-800 truncate">
                              {item.etiqueta}
                            </span>
                          </div>
                          <Icon className={`w-4 h-4 ${item.iconColor}`} />
                        </div>

                        <div className="space-y-0.5">
                          <div className="text-xl font-extrabold text-slate-900 tracking-tight font-mono">
                            {item.cantidad}
                          </div>
                          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                            <span className="font-semibold text-slate-700">
                              {formatearPorcentaje(item.porcentaje)}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {item.cantidad === 1 ? 'remito' : 'remitos'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Tabla resumen consolidada */}
            <div className="overflow-x-auto pt-4 border-t border-slate-100">
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
                  {itemsDesglose.map((item) => {
                    const Icon = item.icono;
                    return (
                      <tr key={item.tipo} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${item.iconColor}`} />
                          <span>{item.etiqueta}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {item.cantidad}
                        </td>
                        <td
                          className="py-2.5 px-3 text-right font-mono font-bold"
                          style={{ color: item.color }}
                        >
                          {formatearPorcentaje(item.porcentaje)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{item.impacto}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t border-slate-200 text-slate-900">
                    <td className="py-2.5 px-3">Total Despachados</td>
                    <td className="py-2.5 px-3 text-right font-mono">{totalDespachados}</td>
                    <td className="py-2.5 px-3 text-right font-mono">100,0%</td>
                    <td className="py-2.5 px-3 text-slate-500 font-medium">
                      Total de remitos de la jornada
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
