// frontend/src/components/dashboard/TableroGerencia.tsx
// Tablero de Control Gerencial para monitoreo de la composición de recaudación.
import React, { useState, useEffect, useCallback } from 'react';
import { UserSession } from '../../types/auth';
import { ComposicionRecaudacion, TableroFiltros } from '../../types/tablero';
import { MetricasEntregasDiarias } from '../../types/entregas';
import { tableroService, formatearMoneda, formatearPorcentaje } from '../../services/tableroService';
import { GraficoRecaudacion } from './GraficoRecaudacion';
import { GraficoEntregasDiarias } from './GraficoEntregasDiarias';
import {
  BarChart3,
  Banknote,
  Landmark,
  QrCode,
  DollarSign,
  RefreshCw,
  Filter,
  AlertCircle,
  Truck,
  Building2,
  ShieldAlert,
} from 'lucide-react';

interface TableroGerenciaProps {
  session: UserSession;
}

export const TableroGerencia: React.FC<TableroGerenciaProps> = ({ session }) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const hoyStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  // Submódulo activo dentro de Reportes (persistido durante la sesión en el navegador)
  const [subVista, setSubVista] = useState<'recaudacion' | 'entregas'>(() => {
    try {
      const guardada = sessionStorage.getItem('tutucas_reportes_subvista');
      if (guardada === 'recaudacion' || guardada === 'entregas') {
        return guardada;
      }
    } catch {
      // Fallback si no está disponible sessionStorage
    }
    return 'recaudacion';
  });

  const cambiarSubVista = (nueva: 'recaudacion' | 'entregas') => {
    setSubVista(nueva);
    try {
      sessionStorage.setItem('tutucas_reportes_subvista', nueva);
    } catch {
      // Fallback silencioso
    }
  };

  // Estado para Módulo 1: Recaudación por Medio de Pago
  const [data, setData] = useState<ComposicionRecaudacion | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Estado para Módulo 2: Eficiencia de Entregas Diarias
  const [dataEntregas, setDataEntregas] = useState<MetricasEntregasDiarias | null>(null);
  const [fechaEntregas, setFechaEntregas] = useState<string>(hoyStr);
  const [cargandoEntregas, setCargandoEntregas] = useState<boolean>(false);
  const [errorEntregas, setErrorEntregas] = useState<string | null>(null);

  // Sucursales para el filtro y control de alcance (global vs sectorizado)
  const [sucursales, setSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [esGlobal, setEsGlobal] = useState<boolean>(true);

  // Filtros de búsqueda
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState<string>('');
  const [rangoRapido, setRangoRapido] = useState<'hoy' | '7dias' | '30dias' | 'todo'>('todo');
  const [fechaDesde, setFechaDesde] = useState<string>('');
  const [fechaHasta, setFechaHasta] = useState<string>('');
  const [soloConfirmados] = useState<boolean>(true);

  // Cargar lista de sucursales autorizadas para el usuario actual
  useEffect(() => {
    tableroService
      .obtenerSucursalesPermitidas(session.token)
      .then((res) => {
        setEsGlobal(res.esGlobal);
        setSucursales(res.sucursales);
        if (!res.esGlobal && res.sucursales.length > 0) {
          setSucursalSeleccionada((prev) => {
            const existe = res.sucursales.some((s) => s.id === prev);
            return existe ? prev : res.sucursales[0].id;
          });
        }
      })
      .catch((err) => {
        console.error('Error al consultar sucursales permitidas para el tablero:', err);
      });
  }, [session.token]);

  // Ajustar fechas según rango rápido
  const aplicarRangoRapido = (tipo: 'hoy' | '7dias' | '30dias' | 'todo') => {
    setRangoRapido(tipo);
    const hoy = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (tipo === 'hoy') {
      const hoyStr = toYMD(hoy);
      setFechaDesde(hoyStr);
      setFechaHasta(hoyStr);
    } else if (tipo === '7dias') {
      const sieteDiasAtras = new Date(hoy.getTime() - 7 * 86400000);
      setFechaDesde(toYMD(sieteDiasAtras));
      setFechaHasta(toYMD(hoy));
    } else if (tipo === '30dias') {
      const treintaDiasAtras = new Date(hoy.getTime() - 30 * 86400000);
      setFechaDesde(toYMD(treintaDiasAtras));
      setFechaHasta(toYMD(hoy));
    } else {
      setFechaDesde('');
      setFechaHasta('');
    }
  };

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const filtros: TableroFiltros = {
        sucursalId: sucursalSeleccionada || undefined,
        fechaDesde: fechaDesde || undefined,
        fechaHasta: fechaHasta || undefined,
        soloConfirmados,
      };

      const res = await tableroService.obtenerRecaudacion(session.token, filtros);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar las métricas de recaudación.');
    } finally {
      setCargando(false);
    }
  }, [session.token, sucursalSeleccionada, fechaDesde, fechaHasta, soloConfirmados]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const cargarDatosEntregas = useCallback(async () => {
    setCargandoEntregas(true);
    setErrorEntregas(null);
    try {
      const res = await tableroService.obtenerMetricasEntregasDiarias(session.token, {
        fecha: fechaEntregas,
        sucursalId: sucursalSeleccionada || undefined,
      });
      setDataEntregas(res);
    } catch (err: any) {
      setErrorEntregas(err?.message || 'No se pudieron cargar las métricas de entregas diarias.');
    } finally {
      setCargandoEntregas(false);
    }
  }, [session.token, fechaEntregas, sucursalSeleccionada]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  useEffect(() => {
    cargarDatosEntregas();
  }, [cargarDatosEntregas]);

  // Totales y cálculos para tarjetas KPI
  const totalPesos = data?.totalRecaudadoPesos || 0;
  const cantidadPagos = data?.cantidadTotalPagos || 0;
  const ticketPromedio = cantidadPagos > 0 ? totalPesos / cantidadPagos : 0;

  const efectivoItem = data?.desglose.find((d) => d.medioPago === 'efectivo');
  const transferenciaItem = data?.desglose.find((d) => d.medioPago === 'transferencia');
  const qrItem = data?.desglose.find((d) => d.medioPago === 'qr');

  return (
    <div className="space-y-6 max-w-screen-2xl mx-auto">
      {/* Cabecera Superior: Selector de Módulo y Filtro Global por Sucursal */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-2 gap-4">
        {/* Selector de Módulo Gerencial */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => cambiarSubVista('recaudacion')}
            className={`flex items-center gap-2 px-3 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer ${
              subVista === 'recaudacion'
                ? 'border-marca-azul text-marca-azul'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span>Recaudación</span>
          </button>

          <button
            type="button"
            onClick={() => cambiarSubVista('entregas')}
            className={`flex items-center gap-2 px-3 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer ${
              subVista === 'entregas'
                ? 'border-marca-azul text-marca-azul'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>Entregas diarias</span>
          </button>
        </div>

        {/* Filtro General por Sucursal (aplica tanto a gráficos financieros como logísticos) */}
        <div className="flex items-center gap-2 pb-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
            <Building2 className="w-4 h-4 text-marca-azul" />
            <span>Sucursal:</span>
          </div>

          <div className="relative">
            <select
              value={sucursalSeleccionada}
              onChange={(e) => setSucursalSeleccionada(e.target.value)}
              className="text-xs font-semibold bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 hover:border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-marca-azul/20 shadow-2xs"
              aria-label="Filtrar por sucursal"
            >
              {esGlobal && <option value="">Todas las Sucursales</option>}
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {subVista === 'entregas' ? (
        <div className="space-y-6">
          {errorEntregas && (
            <div
              className={`p-4 rounded-xl border text-sm flex items-center justify-between gap-3 ${
                errorEntregas.toLowerCase().includes('permiso') || errorEntregas.toLowerCase().includes('denegado')
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {errorEntregas.toLowerCase().includes('permiso') || errorEntregas.toLowerCase().includes('denegado') ? (
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                )}
                <span>{errorEntregas}</span>
              </div>
              <button
                type="button"
                onClick={cargarDatosEntregas}
                className="text-xs font-bold underline hover:no-underline text-current"
              >
                Reintentar
              </button>
            </div>
          )}

          <GraficoEntregasDiarias
            data={dataEntregas}
            fechaSeleccionada={fechaEntregas}
            onCambioFecha={setFechaEntregas}
            cargando={cargandoEntregas}
            onRecargar={cargarDatosEntregas}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Barra de Filtros Operativos */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider mr-1">
                <Filter className="w-3.5 h-3.5 text-marca-azul" />
                <span>Período:</span>
              </div>

              {/* Botones de Rango Rápido */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => aplicarRangoRapido('todo')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    rangoRapido === 'todo'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Histórico
                </button>
                <button
                  type="button"
                  onClick={() => aplicarRangoRapido('30dias')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    rangoRapido === '30dias'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Últimos 30d
                </button>
                <button
                  type="button"
                  onClick={() => aplicarRangoRapido('7dias')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    rangoRapido === '7dias'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Últimos 7d
                </button>
                <button
                  type="button"
                  onClick={() => aplicarRangoRapido('hoy')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    rangoRapido === 'hoy'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Hoy
                </button>
              </div>
            </div>

            {/* Botón Refrescar */}
            <button
              type="button"
              onClick={cargarDatos}
              disabled={cargando}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${cargando ? 'animate-spin text-marca-azul' : ''}`} />
              <span>Actualizar</span>
            </button>
          </div>

          {/* Manejo de Error */}
          {error && (
            <div
              className={`p-4 rounded-xl border text-sm flex items-center justify-between gap-3 ${
                error.toLowerCase().includes('permiso') || error.toLowerCase().includes('denegado')
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {error.toLowerCase().includes('permiso') || error.toLowerCase().includes('denegado') ? (
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                )}
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={cargarDatos}
                className="text-xs font-bold underline hover:no-underline text-current"
              >
                Reintentar
              </button>
            </div>
          )}

      {/* Tarjetas KPI de Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI Total */}
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Total Recaudado</span>
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {formatearMoneda(totalPesos)}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
            <span>{cantidadPagos} cobros totales</span>
            <span>Prom: {formatearMoneda(ticketPromedio)}</span>
          </div>
        </div>

        {/* KPI Efectivo */}
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-xs font-bold uppercase tracking-wider">Efectivo</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-950 tracking-tight">
            {formatearMoneda(efectivoItem?.totalPesos || 0)}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
            <span className="font-semibold text-emerald-700">
              {formatearPorcentaje(efectivoItem?.porcentaje || 0)} del total
            </span>
            <span>{efectivoItem?.cantidadPagos || 0} cobros</span>
          </div>
        </div>

        {/* KPI Transferencia */}
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-blue-700">
            <span className="text-xs font-bold uppercase tracking-wider">Transferencia Bancaria</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
              <Landmark className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-blue-950 tracking-tight">
            {formatearMoneda(transferenciaItem?.totalPesos || 0)}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
            <span className="font-semibold text-blue-700">
              {formatearPorcentaje(transferenciaItem?.porcentaje || 0)} del total
            </span>
            <span>{transferenciaItem?.cantidadPagos || 0} cobros</span>
          </div>
        </div>

        {/* KPI QR */}
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-orange-700">
            <span className="text-xs font-bold uppercase tracking-wider">Cobros QR</span>
            <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
              <QrCode className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-orange-950 tracking-tight">
            {formatearMoneda(qrItem?.totalPesos || 0)}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
            <span className="font-semibold text-orange-700">
              {formatearPorcentaje(qrItem?.porcentaje || 0)} del total
            </span>
            <span>{qrItem?.cantidadPagos || 0} cobros</span>
          </div>
        </div>
      </div>

      {/* Gráfico de Recaudación (ESCENARIO 1) */}
      {data && <GraficoRecaudacion data={data} />}

      {/* Tabla Comparativa Ejecutiva */}
      {data && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-slate-700" />
              <h4 className="text-sm font-bold text-slate-900">Desglose Consolidado por Medio de Pago</h4>
            </div>
            <span className="text-xs text-slate-500">Valores auditados contra PostgreSQL</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Medio de Pago</th>
                  <th className="py-3 px-4 text-right">Cantidad de Cobros</th>
                  <th className="py-3 px-4 text-right">Ticket Promedio</th>
                  <th className="py-3 px-4 text-right">Volumen Total ($)</th>
                  <th className="py-3 px-4 text-right">Participación (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.desglose.map((item) => {
                  const prom = item.cantidadPagos > 0 ? item.totalPesos / item.cantidadPagos : 0;
                  return (
                    <tr key={item.medioPago} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span>{item.etiqueta}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-slate-700">
                        {item.cantidadPagos}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-600">
                        {formatearMoneda(prom)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-extrabold text-slate-900">
                        {formatearMoneda(item.totalPesos)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-marca-azul">
                        {formatearPorcentaje(item.porcentaje)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t border-slate-200 text-slate-900">
                  <td className="py-3 px-4">
                    Total Consolidado
                  </td>
                  <td className="py-3 px-4 text-right font-mono">{cantidadPagos}</td>
                  <td className="py-3 px-4 text-right font-mono">{formatearMoneda(ticketPromedio)}</td>
                  <td className="py-3 px-4 text-right font-mono text-sm text-marca-azul">
                    {formatearMoneda(totalPesos)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm">100,0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
};
