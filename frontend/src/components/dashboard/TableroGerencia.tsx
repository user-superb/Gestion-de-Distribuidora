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
  DollarSign,
  RefreshCw,
  AlertCircle,
  Truck,
  Building2,
  ShieldAlert,
  Calendar,
  CalendarRange,
} from 'lucide-react';

interface TableroGerenciaProps {
  session: UserSession;
}

const STORAGE_KEYS = {
  SUBVISTA: 'tutucas_reportes_subvista',
  SUCURSAL: 'tutucas_reportes_sucursal',
  MODO_RECAUDACION: 'tutucas_reportes_modo_recaudacion',
  FECHA_DIA: 'tutucas_reportes_fecha_dia',
  RANGO_PERIODO: 'tutucas_reportes_rango_periodo',
  DESDE_PERIODO: 'tutucas_reportes_desde_periodo',
  HASTA_PERIODO: 'tutucas_reportes_hasta_periodo',
  FECHA_ENTREGAS: 'tutucas_reportes_fecha_entregas',
};

export const TableroGerencia: React.FC<TableroGerenciaProps> = ({ session }) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const hoyStr = (() => {
    return toYMD(new Date());
  })();

  const ayerStr = (() => {
    return toYMD(new Date(Date.now() - 86400000));
  })();

  // Submódulo activo dentro de Reportes (persistido durante la sesión en el navegador)
  const [subVista, setSubVista] = useState<'recaudacion' | 'entregas'>(() => {
    try {
      const guardada = sessionStorage.getItem(STORAGE_KEYS.SUBVISTA);
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
      sessionStorage.setItem(STORAGE_KEYS.SUBVISTA, nueva);
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
  const [fechaEntregas, setFechaEntregas] = useState<string>(() => {
    try {
      const guardada = sessionStorage.getItem(STORAGE_KEYS.FECHA_ENTREGAS);
      if (guardada && /^\d{4}-\d{2}-\d{2}$/.test(guardada)) {
        return guardada;
      }
    } catch {}
    return hoyStr;
  });
  const [cargandoEntregas, setCargandoEntregas] = useState<boolean>(false);
  const [errorEntregas, setErrorEntregas] = useState<string | null>(null);

  const cambiarFechaEntregas = (fecha: string) => {
    setFechaEntregas(fecha);
    try {
      sessionStorage.setItem(STORAGE_KEYS.FECHA_ENTREGAS, fecha);
    } catch {}
  };

  // Sucursales para el filtro y control de alcance (global vs sectorizado)
  const [sucursales, setSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [esGlobal, setEsGlobal] = useState<boolean>(true);

  // Filtros de búsqueda persistidos en sessionStorage
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState<string>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEYS.SUCURSAL) || '';
    } catch {
      return '';
    }
  });

  const cambiarSucursal = (nuevaSucursalId: string) => {
    setSucursalSeleccionada(nuevaSucursalId);
    try {
      sessionStorage.setItem(STORAGE_KEYS.SUCURSAL, nuevaSucursalId);
    } catch {}
  };

  // Modo de filtro de Recaudación: 'dia' (calendario puntual) o 'periodo' (rango de fechas)
  const [modoRecaudacion, setModoRecaudacion] = useState<'dia' | 'periodo'>(() => {
    try {
      const guardado = sessionStorage.getItem(STORAGE_KEYS.MODO_RECAUDACION);
      if (guardado === 'dia' || guardado === 'periodo') {
        return guardado;
      }
      const r = sessionStorage.getItem(STORAGE_KEYS.RANGO_PERIODO) || sessionStorage.getItem('tutucas_reportes_rango');
      if (r && r !== 'hoy' && r !== 'ayer') {
        return 'periodo';
      }
    } catch {}
    return 'dia';
  });

  // Calendario 1: Por día (estilo idéntico a entregas diarias)
  const [fechaDia, setFechaDia] = useState<string>(() => {
    try {
      const guardada = sessionStorage.getItem(STORAGE_KEYS.FECHA_DIA);
      if (guardada && /^\d{4}-\d{2}-\d{2}$/.test(guardada)) {
        return guardada;
      }
    } catch {}
    return hoyStr;
  });

  // Calendario 2: Por período (rango Desde y Hasta con atajos de período)
  const [rangoPeriodo, setRangoPeriodo] = useState<'7dias' | '30dias' | 'todo' | 'personalizado'>(() => {
    try {
      const guardado = (sessionStorage.getItem(STORAGE_KEYS.RANGO_PERIODO) || sessionStorage.getItem('tutucas_reportes_rango')) as any;
      if (['7dias', '30dias', 'todo', 'personalizado'].includes(guardado)) {
        return guardado;
      }
    } catch {}
    return 'todo';
  });

  const [fechaDesdePeriodo, setFechaDesdePeriodo] = useState<string>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEYS.DESDE_PERIODO) || sessionStorage.getItem('tutucas_reportes_desde') || '';
    } catch {
      return '';
    }
  });

  const [fechaHastaPeriodo, setFechaHastaPeriodo] = useState<string>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEYS.HASTA_PERIODO) || sessionStorage.getItem('tutucas_reportes_hasta') || '';
    } catch {
      return '';
    }
  });

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
            const finalId = existe ? prev : res.sucursales[0].id;
            try {
              sessionStorage.setItem(STORAGE_KEYS.SUCURSAL, finalId);
            } catch {}
            return finalId;
          });
        }
      })
      .catch((err) => {
        console.error('Error al consultar sucursales permitidas para el tablero:', err);
      });
  }, [session.token]);

  // Acciones para Calendario 1: Por día
  const seleccionarDiaRapido = (tipo: 'hoy' | 'ayer') => {
    const f = tipo === 'hoy' ? hoyStr : ayerStr;
    setModoRecaudacion('dia');
    setFechaDia(f);
    try {
      sessionStorage.setItem(STORAGE_KEYS.MODO_RECAUDACION, 'dia');
      sessionStorage.setItem(STORAGE_KEYS.FECHA_DIA, f);
    } catch {}
  };

  const seleccionarDiaInput = (fecha: string) => {
    setModoRecaudacion('dia');
    setFechaDia(fecha);
    try {
      sessionStorage.setItem(STORAGE_KEYS.MODO_RECAUDACION, 'dia');
      sessionStorage.setItem(STORAGE_KEYS.FECHA_DIA, fecha);
    } catch {}
  };

  // Acciones para Calendario 2: Por período
  const aplicarRangoPeriodo = (tipo: '7dias' | '30dias' | 'todo') => {
    setModoRecaudacion('periodo');
    setRangoPeriodo(tipo);
    const hoy = new Date();

    let dDesde = '';
    let dHasta = '';

    if (tipo === '7dias') {
      const sieteDiasAtras = new Date(hoy.getTime() - 7 * 86400000);
      dDesde = toYMD(sieteDiasAtras);
      dHasta = toYMD(hoy);
    } else if (tipo === '30dias') {
      const treintaDiasAtras = new Date(hoy.getTime() - 30 * 86400000);
      dDesde = toYMD(treintaDiasAtras);
      dHasta = toYMD(hoy);
    } else {
      dDesde = '';
      dHasta = '';
    }

    setFechaDesdePeriodo(dDesde);
    setFechaHastaPeriodo(dHasta);

    try {
      sessionStorage.setItem(STORAGE_KEYS.MODO_RECAUDACION, 'periodo');
      sessionStorage.setItem(STORAGE_KEYS.RANGO_PERIODO, tipo);
      sessionStorage.setItem(STORAGE_KEYS.DESDE_PERIODO, dDesde);
      sessionStorage.setItem(STORAGE_KEYS.HASTA_PERIODO, dHasta);
    } catch {}
  };

  const manejarCambioDesdePeriodo = (val: string) => {
    setModoRecaudacion('periodo');
    setRangoPeriodo('personalizado');
    setFechaDesdePeriodo(val);
    try {
      sessionStorage.setItem(STORAGE_KEYS.MODO_RECAUDACION, 'periodo');
      sessionStorage.setItem(STORAGE_KEYS.RANGO_PERIODO, 'personalizado');
      sessionStorage.setItem(STORAGE_KEYS.DESDE_PERIODO, val);
    } catch {}
  };

  const manejarCambioHastaPeriodo = (val: string) => {
    setModoRecaudacion('periodo');
    setRangoPeriodo('personalizado');
    setFechaHastaPeriodo(val);
    try {
      sessionStorage.setItem(STORAGE_KEYS.MODO_RECAUDACION, 'periodo');
      sessionStorage.setItem(STORAGE_KEYS.RANGO_PERIODO, 'personalizado');
      sessionStorage.setItem(STORAGE_KEYS.HASTA_PERIODO, val);
    } catch {}
  };

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      let fDesde: string | undefined;
      let fHasta: string | undefined;

      if (modoRecaudacion === 'dia') {
        fDesde = fechaDia || undefined;
        fHasta = fechaDia || undefined;
      } else {
        fDesde = fechaDesdePeriodo || undefined;
        fHasta = fechaHastaPeriodo || undefined;
      }

      const filtros: TableroFiltros = {
        sucursalId: sucursalSeleccionada || undefined,
        fechaDesde: fDesde,
        fechaHasta: fHasta,
        soloConfirmados,
      };

      const res = await tableroService.obtenerRecaudacion(session.token, filtros);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar las métricas de recaudación.');
    } finally {
      setCargando(false);
    }
  }, [
    session.token,
    sucursalSeleccionada,
    modoRecaudacion,
    fechaDia,
    fechaDesdePeriodo,
    fechaHastaPeriodo,
    soloConfirmados,
  ]);

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

  // Totales y cálculos para resumen
  const totalPesos = data?.totalRecaudadoPesos || 0;
  const cantidadPagos = data?.cantidadTotalPagos || 0;
  const ticketPromedio = cantidadPagos > 0 ? totalPesos / cantidadPagos : 0;

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
              onChange={(e) => cambiarSucursal(e.target.value)}
              className="text-xs font-semibold bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 hover:border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-marca-azul/20 shadow-2xs cursor-pointer"
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
            onCambioFecha={cambiarFechaEntregas}
            cargando={cargandoEntregas}
            onRecargar={cargarDatosEntregas}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Barra de Filtros Operativos de Recaudación (Dos Calendarios: Por Día y Por Período) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
            {/* Cabecera de filtros: Indicador de modo activo y botón de actualización */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-slate-700 uppercase tracking-wider">Filtro aplicado:</span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    modoRecaudacion === 'dia'
                      ? 'bg-blue-100 text-blue-800 border border-blue-200'
                      : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
                  {modoRecaudacion === 'dia'
                    ? `Día puntual: ${fechaDia === hoyStr ? `Hoy (${fechaDia})` : fechaDia === ayerStr ? `Ayer (${fechaDia})` : fechaDia}`
                    : `Período: ${
                        fechaDesdePeriodo || fechaHastaPeriodo
                          ? `${fechaDesdePeriodo || 'Inicio'} al ${fechaHastaPeriodo || 'Hoy'}`
                          : 'Todo el histórico'
                      }`}
                </span>
              </div>

              {/* Botón Refrescar */}
              <button
                type="button"
                onClick={cargarDatos}
                disabled={cargando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                title="Actualizar datos"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${cargando ? 'animate-spin text-marca-azul' : ''}`} />
                <span>Actualizar</span>
              </button>
            </div>

            {/* Los Dos Calendarios Visibles Simultáneamente (Opción B) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
              {/* Calendario 1: Por Día (Estilo idéntico a entregas diarias) */}
              <div
                onClick={() => {
                  if (modoRecaudacion !== 'dia') {
                    setModoRecaudacion('dia');
                    try {
                      sessionStorage.setItem(STORAGE_KEYS.MODO_RECAUDACION, 'dia');
                    } catch {}
                  }
                }}
                className={`lg:col-span-5 p-3 rounded-xl border transition-all cursor-pointer ${
                  modoRecaudacion === 'dia'
                    ? 'border-blue-400 bg-blue-50/40 shadow-xs ring-1 ring-blue-300'
                    : 'border-slate-200 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-300 opacity-90'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <Calendar className="w-4 h-4 text-marca-azul" />
                    <span>Filtrar por día</span>
                  </div>
                  {modoRecaudacion === 'dia' ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-100/90 px-2 py-0.5 rounded-md">
                      Activo
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium">Clic para activar</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      seleccionarDiaRapido('hoy');
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      modoRecaudacion === 'dia' && fechaDia === hoyStr
                        ? 'bg-marca-azul text-white border-marca-azul shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      seleccionarDiaRapido('ayer');
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      modoRecaudacion === 'dia' && fechaDia === ayerStr
                        ? 'bg-marca-azul text-white border-marca-azul shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Ayer
                  </button>
                  <input
                    type="date"
                    value={fechaDia}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => seleccionarDiaInput(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 font-mono bg-white focus:outline-none focus:ring-2 focus:ring-marca-azul/20 focus:border-marca-azul shadow-2xs"
                    aria-label="Seleccionar fecha por día"
                  />
                </div>
              </div>

              {/* Calendario 2: Por Período (Rango Desde y Hasta) */}
              <div
                onClick={() => {
                  if (modoRecaudacion !== 'periodo') {
                    setModoRecaudacion('periodo');
                    try {
                      sessionStorage.setItem(STORAGE_KEYS.MODO_RECAUDACION, 'periodo');
                    } catch {}
                  }
                }}
                className={`lg:col-span-7 p-3 rounded-xl border transition-all cursor-pointer ${
                  modoRecaudacion === 'periodo'
                    ? 'border-indigo-400 bg-indigo-50/40 shadow-xs ring-1 ring-indigo-300'
                    : 'border-slate-200 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-300 opacity-90'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <CalendarRange className="w-4 h-4 text-indigo-600" />
                    <span>Filtrar por período</span>
                  </div>
                  {modoRecaudacion === 'periodo' ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100/90 px-2 py-0.5 rounded-md">
                      Activo
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium">Clic para activar</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Botones de atajo de período */}
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        aplicarRangoPeriodo('todo');
                      }}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        modoRecaudacion === 'periodo' && rangoPeriodo === 'todo'
                          ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Histórico
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        aplicarRangoPeriodo('30dias');
                      }}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        modoRecaudacion === 'periodo' && rangoPeriodo === '30dias'
                          ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Últimos 30d
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        aplicarRangoPeriodo('7dias');
                      }}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        modoRecaudacion === 'periodo' && rangoPeriodo === '7dias'
                          ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Últimos 7d
                    </button>
                  </div>

                  {/* Entradas de fecha Desde y Hasta */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 font-semibold text-[11px]">Desde:</span>
                      <input
                        type="date"
                        value={fechaDesdePeriodo}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => manejarCambioDesdePeriodo(e.target.value)}
                        className="px-2 py-1 text-xs border border-slate-200 rounded-lg text-slate-700 font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                        aria-label="Fecha desde período"
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 font-semibold text-[11px]">Hasta:</span>
                      <input
                        type="date"
                        value={fechaHastaPeriodo}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => manejarCambioHastaPeriodo(e.target.value)}
                        className="px-2 py-1 text-xs border border-slate-200 rounded-lg text-slate-700 font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                        aria-label="Fecha hasta período"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
