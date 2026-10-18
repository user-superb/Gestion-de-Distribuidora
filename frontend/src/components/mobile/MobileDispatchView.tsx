// frontend/src/components/mobile/MobileDispatchView.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { UserSession } from '../../types/auth';
import { HojaDeRutaActiva, RemitoEntrega, VisitaParada } from '../../types/domain';
import { transportistaService } from '../../services/transportistaService';
import { offlineSyncService } from '../../services/offlineSyncService';
import {
  Truck,
  CheckCircle2,
  Clock,
  Wifi,
  WifiOff,
  RefreshCw,
  MapPin,
  Building2,
  AlertCircle,
  CloudUpload,
  RotateCcw,
  Navigation,
} from 'lucide-react';

interface MobileDispatchViewProps {
  session: UserSession;
}

export const MobileDispatchView: React.FC<MobileDispatchViewProps> = ({ session }) => {
  const [hoja, setHoja] = useState<HojaDeRutaActiva | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(offlineSyncService.isOnline());
  const [colaCount, setColaCount] = useState<number>(offlineSyncService.obtenerCantidadEnCola());
  const [alerta, setAlerta] = useState<{ tipo: 'info' | 'success' | 'warning'; mensaje: string } | null>(null);

  // Cargar hoja de ruta activa
  const cargarHoja = useCallback(async () => {
    setLoading(true);
    try {
      const data = await transportistaService.getHojaActiva(session.id || '2');
      setHoja(data);
    } catch (err: any) {
      setAlerta({ tipo: 'warning', mensaje: `Error al cargar hoja de ruta: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    cargarHoja();

    // Suscribirse a cambios en la conectividad y en la cola offline
    const unsubsRed = offlineSyncService.suscribirAEstadoRed((online) => {
      setIsOnline(online);
      if (online) {
        setAlerta({
          tipo: 'info',
          mensaje: 'Conexión a internet restablecida. Sincronizando entregas en segundo plano...',
        });
      }
    });

    const unsubsCola = offlineSyncService.suscribirACola((cola) => {
      setColaCount(cola.length);
      // Recargar hoja con los estados unificados de la cola
      transportistaService.getHojaActiva(session.id || '2').then(setHoja);
    });

    return () => {
      unsubsRed();
      unsubsCola();
    };
  }, [cargarHoja, session.id]);

  // Alternar simulación offline (para QA de Escenario 2)
  const handleToggleOffline = () => {
    const nuevoEstado = offlineSyncService.toggleSimulatedOffline();
    setIsOnline(!nuevoEstado);
    if (nuevoEstado) {
      setAlerta({
        tipo: 'warning',
        mensaje: 'Modo Offline activado. Las confirmaciones de entrega se guardarán en el dispositivo con su hora exacta (Escenario 2).',
      });
    } else {
      setAlerta({
        tipo: 'success',
        mensaje: 'Modo Online restablecido. El sistema sincronizará la cola en segundo plano.',
      });
      handleSincronizarAhora();
    }
  };

  // Forzar sincronización manual
  const handleSincronizarAhora = async () => {
    setAlerta({ tipo: 'info', mensaje: 'Sincronizando entregas con el servidor...' });
    const res = await offlineSyncService.sincronizarCola();
    if (res.success && res.sincronizados > 0) {
      setAlerta({
        tipo: 'success',
        mensaje: `¡Sincronización exitosa! ${res.sincronizados} remito(s) sincronizados en PostgreSQL con su fecha/hora original.`,
      });
      cargarHoja();
    } else if (res.errores.length > 0) {
      setAlerta({ tipo: 'warning', mensaje: res.errores.join(', ') });
    } else {
      setAlerta(null);
    }
  };

  // HU #22: Confirmar entrega de un remito individual
  const handleConfirmarEntrega = async (remito: RemitoEntrega) => {
    setConfirmandoId(remito.id);
    setAlerta(null);

    try {
      const res = await transportistaService.confirmarEntrega(remito.id, session.id || '2');

      if (res.success) {
        if (res.modo === 'online') {
          setAlerta({
            tipo: 'success',
            mensaje: `Remito ${remito.numeroRemito} entregado con éxito. Hora y coordenadas GPS selladas en el servidor.`,
          });
        } else {
          // ESCENARIO 2
          setAlerta({
            tipo: 'warning',
            mensaje: `Remito ${remito.numeroRemito} confirmado sin conexión. Queda guardado localmente aguardando conexión en segundo plano (Escenario 2).`,
          });
        }
        // Refrescar vista
        await cargarHoja();
      } else {
        setAlerta({ tipo: 'warning', mensaje: res.error || 'No se pudo confirmar la entrega.' });
      }
    } catch (err: any) {
      setAlerta({ tipo: 'warning', mensaje: `Error inesperado: ${err.message}` });
    } finally {
      setConfirmandoId(null);
    }
  };

  // Reiniciar datos de prueba
  const handleResetearPrueba = async () => {
    transportistaService.limpiarDatosLocales();
    await cargarHoja();
    setAlerta({ tipo: 'info', mensaje: 'Datos de prueba reiniciados a valores por defecto.' });
  };

  const formatearFechaHora = (isoString?: string | null) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  if (loading && !hoja) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mb-2" />
        <p className="text-sm">Cargando hoja de ruta activa...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Cabecera Móvil del Chofer y Estado de Conexión */}
      <div className="bg-slate-900 text-white rounded-lg p-4 shadow-sm border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Transporte de Carga
              </div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span>{session.name}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                  {hoja?.patente || 'AF-321-JK'}
                </span>
              </div>
            </div>
          </div>

          {/* Toggle de Simulación de Red (QA Escenario 2) */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleOffline}
              type="button"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                isOnline
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700 hover:bg-emerald-900'
                  : 'bg-amber-950/80 text-amber-300 border border-amber-600 animate-pulse'
              }`}
              title="Presione para simular desconexión de red y probar el Escenario 2"
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span>En Línea (Normal)</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                  <span>Sin Conexión (Offline Simulado)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Barra de Estadísticas de la Jornada */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800 text-center">
          <div className="bg-slate-800/60 p-2 rounded">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Paradas</div>
            <div className="text-sm font-bold text-slate-200">
              {hoja?.resumen.visitasCompletadas} / {hoja?.resumen.totalVisitas}
            </div>
          </div>
          <div className="bg-slate-800/60 p-2 rounded">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Remitos Entregados</div>
            <div className="text-sm font-bold text-emerald-400">
              {hoja?.resumen.remitosEntregados} / {hoja?.resumen.totalRemitos}
            </div>
          </div>
          <div className="bg-slate-800/60 p-2 rounded">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Cola Offline</div>
            <div className={`text-sm font-bold ${colaCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
              {colaCount} {colaCount === 1 ? 'evento' : 'eventos'}
            </div>
          </div>
          <div className="bg-slate-800/60 p-2 rounded">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Fecha</div>
            <div className="text-xs font-mono text-slate-300 mt-0.5">
              {hoja?.fechaReparto || 'Hoy'}
            </div>
          </div>
        </div>

        {/* Botón de sincronización si hay cola pendiente */}
        {colaCount > 0 && (
          <div className="bg-amber-950/60 border border-amber-800/60 rounded p-2.5 flex items-center justify-between gap-3 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>{colaCount} entrega(s)</strong> pendientes de sincronizar con el servidor.
              </span>
            </div>
            {isOnline && (
              <button
                onClick={handleSincronizarAhora}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium text-xs transition-colors shrink-0"
              >
                Sincronizar Ahora
              </button>
            )}
          </div>
        )}
      </div>

      {/* Alerta de Estado / Notificación */}
      {alerta && (
        <div
          className={`p-3 rounded-md text-xs flex items-start gap-2 border ${
            alerta.tipo === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : alerta.tipo === 'warning'
              ? 'bg-amber-50 text-amber-900 border-amber-200'
              : 'bg-blue-50 text-blue-900 border-blue-200'
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{alerta.mensaje}</div>
          <button
            onClick={() => setAlerta(null)}
            className="text-slate-400 hover:text-slate-600 text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Listado de Paradas (Visitas) */}
      <div className="space-y-4">
        {hoja?.visitas.map((visita: VisitaParada) => {
          const esVisitaCompleta = visita.estado === 'completada' || visita.todosEntregados;
          const remitosPendientes = visita.remitos.filter((r) => r.estado !== 'entregado').length;

          return (
            <div
              key={visita.id}
              className={`bg-white rounded-lg border shadow-sm transition-all overflow-hidden ${
                esVisitaCompleta
                  ? 'border-emerald-200 bg-emerald-50/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Cabecera de la Parada */}
              <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      esVisitaCompleta
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-700 text-white'
                    }`}
                  >
                    {visita.orden}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>{visita.comercioNombre}</span>
                    </h3>
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      <span>{visita.comercioDomicilio}</span>
                    </p>
                  </div>
                </div>

                {/* Badge de Estado de la Visita (Regla 3) */}
                <div>
                  {esVisitaCompleta ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Parada Completada</span>
                    </span>
                  ) : remitosPendientes < visita.remitos.length ? (
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300"
                      title="Regla 3: La visita permanece abierta hasta que todos los remitos se entreguen"
                    >
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      <span>En Curso (Faltan {remitosPendientes})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                      <span>Pendiente ({visita.remitos.length} remitos)</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Lista de Remitos de la Parada */}
              <div className="p-3.5 space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Remitos de la Parada ({visita.remitos.length})
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {visita.remitos.map((remito: RemitoEntrega) => {
                    const estaEntregado = remito.estado === 'entregado';
                    const estaEnCola = remito.enColaOffline || offlineSyncService.estaEnCola(remito.id);
                    const isProcessing = confirmandoId === remito.id;

                    return (
                      <div
                        key={remito.id}
                        className={`p-3 rounded-md border transition-all ${
                          estaEntregado
                            ? estaEnCola
                              ? 'bg-amber-50/50 border-amber-300'
                              : 'bg-emerald-50/50 border-emerald-200'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-bold text-slate-900">
                                {remito.numeroRemito}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                {remito.marcaNombre}
                              </span>
                            </div>
                            <div className="text-xs text-slate-600">
                              Importe:{' '}
                              <strong className="text-slate-800">
                                ${remito.importe.toLocaleString('es-AR')}
                              </strong>
                            </div>
                          </div>

                          {/* Acciones y Estados del Remito */}
                          <div>
                            {estaEntregado ? (
                              <div className="text-right space-y-1">
                                {estaEnCola ? (
                                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold">
                                    <Clock className="w-3.5 h-3.5 text-amber-700" />
                                    <span>Guardado Local (Cola Offline)</span>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-semibold">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                                    <span>Entregado en Destino</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={() => handleConfirmarEntrega(remito)}
                                disabled={isProcessing}
                                type="button"
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-md text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                              >
                                {isProcessing ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>Confirmando...</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>Confirmar Entrega</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Metadatos de la Entrega (Timestamp y GPS) */}
                        {estaEntregado && (
                          <div className="mt-2.5 pt-2 border-t border-slate-200/80 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 font-mono">
                            <div className="flex items-center gap-1 text-slate-700">
                              <Clock className="w-3 h-3 text-slate-500" />
                              <span>
                                Hora captura: <strong>{formatearFechaHora(remito.entregadoEn)}</strong>
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-slate-700">
                              <Navigation className="w-3 h-3 text-emerald-600" />
                              <span>
                                GPS: {remito.latitud || -34.92145}, {remito.longitud || -57.95453}
                              </span>
                            </div>
                            {estaEnCola && (
                              <span className="text-amber-800 font-sans text-[10px] font-medium">
                                (Timestamp sellado localmente, se mantendrá intacto al sincronizar)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pie de Panel con Acciones de Soporte y Pruebas */}
      <div className="p-3 bg-slate-100 rounded-md border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-slate-500" />
          <span>Sucursal de Despacho: <strong>{session.branch}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cargarHoja}
            className="hover:underline flex items-center gap-1 text-slate-700 font-medium"
          >
            <RefreshCw className="w-3 h-3" />
            Actualizar Hoja
          </button>
          <span>•</span>
          <button
            onClick={handleResetearPrueba}
            className="hover:underline flex items-center gap-1 text-slate-700 font-medium"
            title="Restaura la hoja y limpia la cola de prueba"
          >
            <RotateCcw className="w-3 h-3" />
            Reiniciar Demo
          </button>
        </div>
      </div>
    </div>
  );
};
