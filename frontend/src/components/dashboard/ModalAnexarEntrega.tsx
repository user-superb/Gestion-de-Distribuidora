// src/components/dashboard/ModalAnexarEntrega.tsx
import React, { useState, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  Wifi,
  WifiOff,
  User,
  Building,
} from 'lucide-react';
import { Remito, HojaDeRuta, Transportista, Comercio, Marca } from '../../types/domain';
import { remitoService } from '../../services/remitoService';

interface ModalAnexarEntregaProps {
  isOpen: boolean;
  onClose: () => void;
  remito: Remito | null;
  hojasDeRuta: HojaDeRuta[];
  transportistas: Transportista[];
  comercios: Comercio[];
  marcas: Marca[];
  preselectedHojaId?: string | null;
  onSuccess: (resultado: any, mensajeExito: string) => void;
}

function formatearFechaCorta(fechaISO?: string): string {
  if (!fechaISO) return 'Sin fecha';
  const partes = fechaISO.slice(0, 10).split('-');
  if (partes.length !== 3) return fechaISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

export const ModalAnexarEntrega: React.FC<ModalAnexarEntregaProps> = ({
  isOpen,
  onClose,
  remito,
  hojasDeRuta,
  transportistas,
  comercios,
  preselectedHojaId,
  onSuccess,
}) => {
  const [selectedHojaId, setSelectedHojaId] = useState<string>('');
  const [dispositivoConectado, setDispositivoConectado] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Solo rutas operativas ya armadas, no completadas y con visitas del mismo comercio.
  const hojasCandidatas = hojasDeRuta.filter((h) => {
    if (!['pendiente_de_despacho', 'publicada', 'en_curso'].includes(h.estado)) return false;
    if (!remito) return false;
    const visitasDeHoja = h.visitas || [];
    if (visitasDeHoja.length === 0) return false;
    const todasCompletadas = visitasDeHoja.every(
      (v) =>
        v.estado === 'completada' ||
        v.estado === 'no_realizada' ||
        (v.remitos &&
          v.remitos.length > 0 &&
          v.remitos.every((r) => ['entregado', 'no_entregado', 'devuelto'].includes(r.estado)))
    );
    if (todasCompletadas) return false;
    return visitasDeHoja.some((v) => v.comercioId === remito.comercioId);
  });

  const hojaSeleccionada = hojasCandidatas.find((h) => h.id === selectedHojaId) || hojasCandidatas[0];

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSubmitting(false);

      setSelectedHojaId((prev) => {
        // Si el usuario ya tiene seleccionada una hoja candidata válida, mantenerla
        if (prev && hojasCandidatas.some((h) => h.id === prev)) {
          return prev;
        }
        // Si viene una preseleccionada válida, usarla inicialmente
        if (preselectedHojaId && hojasCandidatas.some((h) => h.id === preselectedHojaId)) {
          return preselectedHojaId;
        }
        // Fallback a la primera hoja disponible
        return hojasCandidatas.length > 0 ? hojasCandidatas[0].id : '';
      });
    } else {
      setSelectedHojaId('');
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [isOpen, preselectedHojaId, remito?.id]);

  // Si la hoja seleccionada deja de ser candidata válida en segundo plano, ajustar a la primera disponible
  useEffect(() => {
    if (isOpen && selectedHojaId && !hojasCandidatas.some((h) => h.id === selectedHojaId)) {
      setSelectedHojaId(hojasCandidatas[0]?.id || '');
    }
  }, [isOpen, selectedHojaId, hojasCandidatas]);

  // Actualizar estado de conectividad al cambiar la hoja de ruta seleccionada y consultar en vivo al backend
  useEffect(() => {
    if (!isOpen) return;

    const sincronizarConexion = async () => {
      if (!hojaSeleccionada?.transportistaId) {
        setDispositivoConectado(false);
        return;
      }
      try {
        const listaFresca = await remitoService.getTransportistasAsync();
        const chofer = listaFresca.find((t) => String(t.id) === String(hojaSeleccionada.transportistaId));
        if (chofer) {
          setDispositivoConectado(chofer.dispositivoConectado ?? false);
          return;
        }
      } catch {
        // Fallback al listado en memoria
      }
      const choferLocal = transportistas.find((t) => String(t.id) === String(hojaSeleccionada.transportistaId));
      setDispositivoConectado(choferLocal?.dispositivoConectado ?? false);
    };

    void sincronizarConexion();
    const timer = setInterval(() => {
      void sincronizarConexion();
    }, 2500);

    return () => clearInterval(timer);
  }, [isOpen, selectedHojaId, hojaSeleccionada?.id, hojaSeleccionada?.transportistaId]);

  const handleAlternarConexionManual = async () => {
    const nuevoEstado = !dispositivoConectado;
    setDispositivoConectado(nuevoEstado);
    if (hojaSeleccionada?.transportistaId) {
      await remitoService.actualizarConexionTransportistaAsync(hojaSeleccionada.transportistaId, nuevoEstado);
    }
  };

  if (!isOpen || !remito) return null;

  const comercio = comercios.find((c) => c.id === remito.comercioId);
  const repartidorNombre = hojaSeleccionada?.transportistaNombre || 'Sin chofer asignado';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hojaSeleccionada) {
      setErrorMsg('Debe seleccionar una hoja de ruta de destino válida.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    const resultado = await remitoService.anexarEntregaARutaAsync(
      remito.id,
      hojaSeleccionada.id,
      { dispositivoConectado }
    );

    setSubmitting(false);

    if (resultado.success) {
      const nombreHoja =
        resultado.hojaDeRuta?.numero ||
        `HR-${String(resultado.hojaDeRuta?.id || hojaSeleccionada.id).padStart(4, '0')}`;
      const mensajeTexto = resultado.sincronizacionPendiente
        ? `Remito ${remito.numeroRemito} anexado a la hoja ${nombreHoja}. ⚠️ Dispositivo desconectado: "Sincronización pendiente".`
        : `Remito ${remito.numeroRemito} anexado exitosamente a la hoja ${nombreHoja} y sincronizado con el transportista.`;

      onSuccess(resultado, mensajeTexto);
      onClose();
    } else {
      setErrorMsg(resultado.error || 'No se pudo anexar la entrega.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-sm w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera Compacta */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
            Anexar Entrega a Ruta
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 rounded p-1 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          {/* Datos de la Entrega: Solo código del remito, mayorista y repartidor */}
          <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-blue-700 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                {remito.numeroRemito}
              </span>
              <span className="font-medium text-slate-500">
                ${remito.importe.toLocaleString('es-AR')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 font-semibold text-slate-900 truncate">
              <Building className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">{comercio?.razonSocial || 'Mayorista'}</span>
            </div>

            <div className="flex items-center gap-1.5 text-slate-600 pt-0.5 border-t border-slate-200/80">
              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">Repartidor: <strong className="text-slate-800">{repartidorNombre}</strong></span>
            </div>
          </div>

          {/* Selector de Hoja de Ruta de Destino */}
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Hoja de Ruta de Destino
            </label>
            {hojasCandidatas.length === 0 ? (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  No hay hojas de ruta armadas para <strong>{comercio?.razonSocial || 'este comercio'}</strong>. Primero hay que armar una ruta con visitas del mismo comercio.
                </span>
              </div>
            ) : (
              <select
                value={selectedHojaId || hojaSeleccionada?.id || ''}
                onChange={(e) => setSelectedHojaId(e.target.value)}
                className="w-full text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 font-medium focus:ring-1 focus:ring-blue-500 focus:outline-none cursor-pointer"
              >
                {hojasCandidatas.map((h) => {
                  const nombreCodigo = h.numero || `HR-${String(h.id).padStart(4, '0')}`;
                  const fecha = formatearFechaCorta(h.fechaReparto);
                  const chofer = h.transportistaNombre || 'Sin chofer';
                  return (
                    <option key={h.id} value={h.id}>
                      {nombreCodigo} • {fecha} • {chofer}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Conexión del Dispositivo Móvil: Resumido con icono interactivo */}
          <div className="flex items-center justify-between pt-1 pb-1 px-1">
            <span className="text-xs text-slate-600 font-medium">Conexión del chofer:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleAlternarConexionManual()}
                className={`p-1.5 rounded border transition-colors cursor-pointer flex items-center gap-1 text-xs font-medium ${
                  dispositivoConectado
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                    : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                }`}
                title="Tocar para alternar conexión del chofer (Escenario 1 vs Escenario 2)"
              >
                {dispositivoConectado ? (
                  <>
                    <Wifi className="w-4 h-4 text-emerald-600" />
                    <span>Conectado</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 text-amber-600" />
                    <span>Desconectado</span>
                  </>
                )}
              </button>

              {!dispositivoConectado && (
                <div title="Alerta: Sincronización pendiente" className="flex items-center text-amber-600">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              )}
            </div>
          </div>

          {/* Mensaje de error si falla */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Botones de acción */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-300 rounded transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || hojasCandidatas.length === 0}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
            >
              {submitting ? 'Anexando...' : 'Confirmar Anexión'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
