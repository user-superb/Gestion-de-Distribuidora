// src/components/dashboard/ModalAnexarEntrega.tsx
import React, { useState, useEffect } from 'react';
import {
  X,
  Truck,
  AlertTriangle,
  CheckCircle2,
  Wifi,
  WifiOff,
  Layers,
  ArrowRight,
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
  marcas,
  preselectedHojaId,
  onSuccess,
}) => {
  const [selectedHojaId, setSelectedHojaId] = useState<string>('');
  const [simularConexion, setSimularConexion] = useState<boolean>(true);
  const [usarSimulacion, setUsarSimulacion] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filtrar hojas de ruta abiertas (no cerradas ni anuladas)
  const hojasAbiertas = hojasDeRuta.filter(
    (h) => h.estado !== 'cerrada' && h.estado !== 'anulada'
  );

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSubmitting(false);
      setUsarSimulacion(false);

      if (preselectedHojaId && hojasAbiertas.some((h) => h.id === preselectedHojaId)) {
        setSelectedHojaId(preselectedHojaId);
      } else if (hojasAbiertas.length > 0) {
        setSelectedHojaId(hojasAbiertas[0].id);
      } else {
        setSelectedHojaId('');
      }
    }
  }, [isOpen, preselectedHojaId, hojasDeRuta]);

  if (!isOpen || !remito) return null;

  const hojaSeleccionada = hojasAbiertas.find((h) => h.id === selectedHojaId);
  const choferAsignado = hojaSeleccionada?.transportistaId
    ? transportistas.find((t) => t.id === hojaSeleccionada.transportistaId)
    : null;

  // Estado real de conectividad del chofer asignado (o fallback a true)
  const conexionReal = choferAsignado?.dispositivoConectado ?? true;
  const conexionEfectiva = usarSimulacion ? simularConexion : conexionReal;

  // Calcular el número de parada que ocupará (al final de la secuencia)
  const paradasActuales = hojaSeleccionada?.visitas?.length ?? hojaSeleccionada?.cantidadVisitas ?? 0;
  const ordenFinal = paradasActuales + 1;

  const comercio = comercios.find((c) => c.id === remito.comercioId);
  const marca = marcas.find((m) => m.id === remito.marcaId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHojaId) {
      setErrorMsg('Debe seleccionar una hoja de ruta de destino abierta.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    const opciones = usarSimulacion ? { dispositivoConectado: simularConexion } : undefined;
    const resultado = await remitoService.anexarEntregaARutaAsync(
      remito.id,
      selectedHojaId,
      opciones
    );

    setSubmitting(false);

    if (resultado.success) {
      const nombreHoja =
        resultado.hojaDeRuta?.numero ||
        `HR-${String(resultado.hojaDeRuta?.id || selectedHojaId).padStart(4, '0')}`;
      const mensajeTexto = resultado.sincronizacionPendiente
        ? `Remito ${remito.numeroRemito} anexado como Parada #${resultado.ordenParada ?? ordenFinal} a la hoja ${nombreHoja}. ⚠️ El chofer está desconectado: alerta de "Sincronización pendiente" activa.`
        : `Remito ${remito.numeroRemito} anexado exitosamente como Parada #${resultado.ordenParada ?? ordenFinal} a la hoja ${nombreHoja} y sincronizado con el transportista.`;

      onSuccess(resultado, mensajeTexto);
      onClose();
    } else {
      setErrorMsg(resultado.error || 'No se pudo anexar la entrega a la hoja de ruta.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-200">
        {/* Cabecera */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Anexar Entrega a Ruta</h2>
              <p className="text-xs text-slate-500">
                HU #19 • Anexión dinámica al final de la secuencia
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Tarjeta de Resumen del Remito a Anexar */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Datos de la Entrega a Anexar
            </span>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {remito.numeroRemito}
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                    {marca?.nombre || 'Marca registrada'}
                  </span>
                </div>
                <strong className="text-sm text-slate-900 block">
                  {comercio?.razonSocial || 'Comercio Destinatario'}
                </strong>
                <p className="text-xs text-slate-500">{comercio?.domicilio || 'Domicilio registrado'}</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs text-slate-400 block">Importe</span>
                <span className="font-mono text-base font-bold text-slate-900">
                  ${remito.importe.toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          </div>

          {/* Selector de Hoja de Ruta de Destino */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Hoja de Ruta de Destino (Solo Rutas Abiertas)
            </label>
            {hojasAbiertas.length === 0 ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  No hay hojas de ruta abiertas disponibles en el sistema. Debe programar una hoja de ruta en Sección 2 primero.
                </span>
              </div>
            ) : (
              <select
                value={selectedHojaId}
                onChange={(e) => setSelectedHojaId(e.target.value)}
                className="w-full text-sm bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
              >
                {hojasAbiertas.map((h) => {
                  const nombreCodigo = h.numero || `HR-${String(h.id).padStart(4, '0')}`;
                  const cantParadas = h.visitas?.length ?? h.cantidadVisitas ?? 0;
                  const chofer = h.transportistaNombre || 'Sin transportista';
                  const fecha = formatearFechaCorta(h.fechaReparto);
                  return (
                    <option key={h.id} value={h.id}>
                      {nombreCodigo} • Fecha: {fecha} • Chofer: {chofer} • {cantParadas} parada(s) [{h.estado}]
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Previsualización del Impacto Operativo */}
          {hojaSeleccionada && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-blue-50/50 border border-blue-200 rounded-lg p-2.5">
                  <span className="text-slate-500 block">Posición en la Secuencia:</span>
                  <div className="mt-1 flex items-center gap-1 font-bold text-blue-900 text-sm">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>PARADA #{ordenFinal}</span>
                    <span className="text-xs font-normal text-slate-500">(Al final)</span>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <span className="text-slate-500 block">Transportista Asignado:</span>
                  <strong className="mt-1 text-slate-900 block truncate" title={hojaSeleccionada.transportistaNombre || 'Sin asignar'}>
                    {hojaSeleccionada.transportistaNombre || 'Sin chofer'}
                  </strong>
                </div>
              </div>

              {/* Panel de Conexión del Transportista */}
              <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {conexionEfectiva ? (
                      <Wifi className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-amber-600" />
                    )}
                    <span className="text-xs font-bold text-slate-700">
                      Conexión del Dispositivo Móvil
                    </span>
                  </div>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded border ${
                      conexionEfectiva
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-amber-50 text-amber-700 border-amber-300'
                    }`}
                  >
                    {conexionEfectiva ? 'Conectado (Online)' : 'Desconectado (Offline)'}
                  </span>
                </div>

                {/* Simulador de conectividad para probar Escenario 1 y Escenario 2 */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <label className="text-slate-600 cursor-pointer flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={usarSimulacion}
                      onChange={(e) => setUsarSimulacion(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Probar escenario con simulación</span>
                  </label>

                  {usarSimulacion && (
                    <button
                      type="button"
                      onClick={() => setSimularConexion(!simularConexion)}
                      className={`px-2 py-0.5 rounded font-semibold text-xs border transition-colors ${
                        simularConexion
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : 'bg-amber-100 text-amber-800 border-amber-300'
                      }`}
                    >
                      {simularConexion ? 'Simular Conectado' : 'Simular Desconectado'}
                    </button>
                  )}
                </div>

                {/* Feedback según el Escenario resultante */}
                {conexionEfectiva ? (
                  <div className="bg-emerald-50/70 border border-emerald-200 rounded p-2 text-xs text-emerald-800 flex items-start gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Escenario 1 (Exitoso):</strong> El transportista tiene conexión activa. La parada se añadirá al final de la secuencia y se sincronizará inmediatamente con el móvil.
                    </span>
                  </div>
                ) : (
                  <div className="bg-amber-50/70 border border-amber-200 rounded p-2 text-xs text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Escenario 2 (Chofer desconectado):</strong> El dispositivo no reporta conexión. La parada se añadirá al final de la secuencia y el sistema generará una alerta de <strong>"Sincronización pendiente"</strong>.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mensaje de error si falla */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Botones de acción */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || hojasAbiertas.length === 0 || !selectedHojaId}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting ? (
                <span>Anexando entrega...</span>
              ) : (
                <>
                  <span>Confirmar Anexión</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
