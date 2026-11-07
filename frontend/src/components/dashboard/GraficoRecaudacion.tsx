// frontend/src/components/dashboard/GraficoRecaudacion.tsx
// Gráfico interactivo de composición de recaudación por medio de pago (Efectivo, Transferencia, QR).
import React, { useState } from 'react';
import { ComposicionRecaudacion, MedioPago } from '../../types/tablero';
import { formatearMoneda, formatearPorcentaje } from '../../services/tableroService';
import { Banknote, Landmark, QrCode, PieChart, Layers } from 'lucide-react';

interface GraficoRecaudacionProps {
  data: ComposicionRecaudacion;
}

export const GraficoRecaudacion: React.FC<GraficoRecaudacionProps> = ({ data }) => {
  const [medioSeleccionado, setMedioSeleccionado] = useState<MedioPago | null>(null);

  const getIcono = (medio: MedioPago) => {
    switch (medio) {
      case 'efectivo':
        return <Banknote className="w-4 h-4 text-emerald-600" />;
      case 'transferencia':
        return <Landmark className="w-4 h-4 text-blue-600" />;
      case 'qr':
        return <QrCode className="w-4 h-4 text-orange-600" />;
    }
  };

  const totalCentavos = data.totalRecaudadoCentavos;
  const sinRecaudacion = totalCentavos === 0;

  // Cálculo de los arcos de la Dona SVG mediante stroke-dasharray
  // Radio r = 40, perímetro = 2 * PI * 40 ~= 251.327
  const RADIO = 40;
  const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
  let offsetAcumulado = 0;

  const segmentosDona = data.desglose.map((item) => {
    const proporcion = totalCentavos > 0 ? item.totalCentavos / totalCentavos : 0;
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

  const detalleActivo = medioSeleccionado
    ? data.desglose.find((d) => d.medioPago === medioSeleccionado)
    : null;

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-6"
      data-testid="grafico-recaudacion"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-marca-azul" />
            <span>Distribución de Recaudación por Medio de Pago</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Volumen consolidado y porcentaje de participación por cada medio.
          </p>
        </div>
      </div>

      {sinRecaudacion ? (
        <div className="py-12 text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
            <Layers className="w-8 h-8" />
          </div>
          <p className="text-sm font-semibold text-slate-700">Sin recaudación en el período seleccionado</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No se encontraron cobros confirmados con los filtros aplicados. Probá modificando el rango de fechas o sucursal.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Gráfico de Dona SVG */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center relative">
            <div className="relative w-64 h-64">
              <svg
                viewBox="0 0 100 100"
                className="w-full h-full transform -rotate-90"
                role="img"
                aria-label="Gráfico circular de recaudación por medio de pago"
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

                {/* Segmentos de los medios de pago */}
                {segmentosDona.map((seg) => {
                  if (seg.totalCentavos === 0) return null;
                  const isHovered = medioSeleccionado === seg.medioPago;

                  return (
                    <circle
                      key={seg.medioPago}
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
                      onMouseEnter={() => setMedioSeleccionado(seg.medioPago)}
                      onMouseLeave={() => setMedioSeleccionado(null)}
                    />
                  );
                })}
              </svg>

              {/* Centro de la Dona con Total Consolidado */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  {detalleActivo ? detalleActivo.etiqueta : 'Total Consolidado'}
                </span>
                <span className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                  {detalleActivo
                    ? formatearMoneda(detalleActivo.totalPesos)
                    : formatearMoneda(data.totalRecaudadoPesos)}
                </span>
                <span className="text-xs text-slate-500 font-medium mt-0.5">
                  {detalleActivo
                    ? `${formatearPorcentaje(detalleActivo.porcentaje)} (${detalleActivo.cantidadPagos} ${detalleActivo.cantidadPagos === 1 ? 'cobro' : 'cobros'})`
                    : `${data.cantidadTotalPagos} ${data.cantidadTotalPagos === 1 ? 'cobro registrado' : 'cobros registrados'}`}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Pasá el cursor sobre cada sector para ver su detalle
            </p>
          </div>

          {/* Tarjetas y Desglose por Medio de Pago */}
          <div className="lg:col-span-7 space-y-4">
            {/* Barra de Distribución Proporcional Apilada */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
                <span>Composición 100% de la recaudación</span>
                <span className="font-mono text-slate-800">{formatearMoneda(data.totalRecaudadoPesos)}</span>
              </div>
              <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                {data.desglose.map((seg) => {
                  if (seg.totalCentavos === 0) return null;
                  return (
                    <div
                      key={seg.medioPago}
                      style={{
                        width: `${seg.porcentaje}%`,
                        backgroundColor: seg.color,
                      }}
                      className="h-full transition-all duration-300 relative group cursor-pointer"
                      title={`${seg.etiqueta}: ${formatearMoneda(seg.totalPesos)} (${formatearPorcentaje(seg.porcentaje)})`}
                      onMouseEnter={() => setMedioSeleccionado(seg.medioPago)}
                      onMouseLeave={() => setMedioSeleccionado(null)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Listado de Medios de Pago Diferenciados */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              {data.desglose.map((item) => {
                const isSelected = medioSeleccionado === item.medioPago;

                return (
                  <div
                    key={item.medioPago}
                    onMouseEnter={() => setMedioSeleccionado(item.medioPago)}
                    onMouseLeave={() => setMedioSeleccionado(null)}
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
                      {getIcono(item.medioPago)}
                    </div>

                    <div className="space-y-0.5">
                      <div className="text-base font-extrabold text-slate-900 tracking-tight">
                        {formatearMoneda(item.totalPesos)}
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                        <span className="font-semibold text-slate-700">
                          {formatearPorcentaje(item.porcentaje)}
                        </span>
                        <span>{item.cantidadPagos} pago(s)</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
