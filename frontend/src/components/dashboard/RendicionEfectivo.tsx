// Épica 2.3 · Rendición y control de efectivo, escritorio del supervisor.
// HU #47 visualizar la declaración · HU #48 aprobar coincidente · HU #49 registrar diferencia · HU #50 aprobar con diferencia.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, Plus, RefreshCw, Scale, X } from 'lucide-react';
import { UserSession } from '../../types/auth';
import {
  analizarConteo,
  compararConDeclarado,
  DENOMINACIONES_PESOS,
  DetalleRendicion,
  EstadoRendicion,
  ETIQUETA_ESTADO,
  FormConteo,
  formConteoVacio,
  formDesdeConteo,
  formatoFecha,
  formatoPesos,
  HojaPendienteArqueo,
  justificacionValida,
  LARGO_MINIMO_JUSTIFICACION,
  Rendicion,
  rendicionEfectivoService,
  RendicionRetractadaError,
} from '../../services/rendicionEfectivoService';

type Filtro = 'por_procesar' | 'aprobadas' | 'retractadas' | 'todas';

const FILTROS: Array<{ id: Filtro; label: string; estado?: string }> = [
  { id: 'por_procesar', label: 'Por procesar', estado: 'pendiente,con_diferencia' },
  { id: 'aprobadas', label: 'Aprobadas', estado: 'validada' },
  { id: 'retractadas', label: 'Retractadas', estado: 'anulada' },
  { id: 'todas', label: 'Todas' },
];

const COLOR_ESTADO: Record<EstadoRendicion, string> = {
  pendiente: 'bg-amber-100 text-amber-900 border-amber-300',
  con_diferencia: 'bg-orange-100 text-orange-900 border-orange-300',
  validada: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  rechazada: 'bg-red-100 text-red-800 border-red-300',
  anulada: 'bg-slate-200 text-slate-700 border-slate-300',
};

function horaLocal(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function EstadoBadge({ estado }: { estado: EstadoRendicion }) {
  return <span className={`inline-flex shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold ${COLOR_ESTADO[estado]}`}>{ETIQUETA_ESTADO[estado]}</span>;
}

export const RendicionEfectivo: React.FC<{ session: UserSession }> = ({ session }) => {
  const [filtro, setFiltro] = useState<Filtro>('por_procesar');
  const [fecha, setFecha] = useState('');
  const [items, setItems] = useState<Rendicion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');

  // Modal para iniciar arqueo directamente desde el escritorio (Opción 1)
  const [modalIniciar, setModalIniciar] = useState(false);
  const [hojasPendientes, setHojasPendientes] = useState<HojaPendienteArqueo[]>([]);
  const [cargandoHojas, setCargandoHojas] = useState(false);
  const [errorIniciar, setErrorIniciar] = useState('');
  const [iniciandoId, setIniciandoId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const estado = FILTROS.find((f) => f.id === filtro)?.estado;
      setItems(await rendicionEfectivoService.listar(session.token, { estado, fecha: fecha || undefined }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las declaraciones.');
    } finally {
      setCargando(false);
    }
  }, [filtro, fecha, session.token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const abrirModalIniciar = async () => {
    setModalIniciar(true);
    setCargandoHojas(true);
    setErrorIniciar('');
    try {
      setHojasPendientes(await rendicionEfectivoService.listarHojasPendientes(session.token, fecha || undefined));
    } catch (err: any) {
      setErrorIniciar(err.message || 'Error al cargar hojas de ruta pendientes.');
    } finally {
      setCargandoHojas(false);
    }
  };

  const ejecutarIniciarArqueo = async (hoja: HojaPendienteArqueo, forzar = false) => {
    setIniciandoId(hoja.hojaId);
    setErrorIniciar('');
    try {
      const nueva = await rendicionEfectivoService.iniciarArqueo(session.token, hoja.hojaId, undefined, forzar);
      setModalIniciar(false);
      setAviso(`Arqueo iniciado para la hoja ${hoja.codigoHoja} (${hoja.transportista.nombre}).`);
      await cargar();
      setSeleccionada(nueva.id);
    } catch (err: any) {
      setErrorIniciar(err.message || 'No se pudo iniciar el arqueo de la hoja.');
    } finally {
      setIniciandoId(null);
    }
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Rendiciones y arqueo de efectivo</h2>
            <p className="mt-0.5 text-xs text-slate-500">Las hojas finalizadas se auto-generan listas para conteo. Podés forzar arqueos manuales con "+ Iniciar Arqueo".</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={abrirModalIniciar}
              className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 shadow-sm transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Iniciar Arqueo
            </button>
            <button type="button" onClick={() => void cargar()} disabled={cargando} className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-2">
          <nav role="tablist" aria-label="Filtrar declaraciones" className="flex flex-wrap gap-1">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filtro === f.id}
                onClick={() => setFiltro(f.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${filtro === f.id ? 'border-marca-azul bg-marca-azul text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              >
                {f.label}
              </button>
            ))}
          </nav>
          <label className="ml-auto text-xs text-slate-600">
            Fecha de la hoja
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="ml-2 rounded border border-slate-300 px-2 py-1 text-xs" />
          </label>
        </div>

        {aviso && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{aviso}</p>}
        {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}

        {cargando && items.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">Cargando declaraciones…</p>
        ) : items.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No hay declaraciones de efectivo para este filtro.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setAviso('');
                    setSeleccionada(item.id);
                  }}
                  aria-current={seleccionada === item.id ? 'true' : undefined}
                  className={`flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-slate-50 ${seleccionada === item.id ? 'bg-blue-50/70' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-sm text-slate-900">{item.transportista.nombre}</strong>
                      <EstadoBadge estado={item.estado} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Hoja {item.codigoHoja} · {formatoFecha(item.fechaReparto)} · {item.sucursal}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-sm font-bold ${item.estado === 'anulada' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{formatoPesos(item.declaradoCentavos)}</div>
                    <div className="text-[11px] text-slate-500">{horaLocal(item.declaradoEn)}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        {seleccionada ? (
          <DetalleDeclaracion
            key={seleccionada}
            session={session}
            id={seleccionada}
            onProcesada={(mensaje) => {
              setAviso(mensaje);
              void cargar();
            }}
            onRetractada={() => void cargar()}
          />
        ) : (
          <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 text-center text-slate-500">
            <Banknote className="h-10 w-10 text-slate-300" />
            <p className="text-sm font-medium">Elegí una declaración para ver el detalle y contar el efectivo.</p>
          </div>
        )}
      </div>

      {modalIniciar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Iniciar arqueo de efectivo</h3>
                <p className="text-xs text-slate-500">Seleccioná la hoja de ruta del transportista para comenzar el conteo.</p>
              </div>
              <button
                type="button"
                onClick={() => setModalIniciar(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {errorIniciar && (
              <p className="mt-3 rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{errorIniciar}</p>
            )}

            <div className="mt-4 max-h-96 overflow-y-auto">
              {cargandoHojas ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-slate-400" />
                  Buscando hojas de ruta disponibles…
                </div>
              ) : hojasPendientes.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500">
                  No hay hojas de ruta pendientes de arqueo para la fecha seleccionada.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {hojasPendientes.map((hoja) => {
                    const tienePendientes = hoja.visitasPendientesCount > 0;
                    return (
                      <li key={hoja.hojaId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-slate-900">{hoja.codigoHoja}</span>
                            <span className="text-xs text-slate-600 font-medium">{hoja.transportista.nombre}</span>
                            {hoja.patente && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{hoja.patente}</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span>{formatoFecha(hoja.fechaReparto)}</span>
                            <span>·</span>
                            <span>{hoja.sucursal}</span>
                            <span>·</span>
                            <span className="font-medium text-emerald-700">
                              Cobrado en efectivo: {formatoPesos(hoja.efectivoCobradoCentavos)} ({hoja.cantidadCobrosEfectivo} pagos)
                            </span>
                          </div>
                          {tienePendientes && (
                            <p className="mt-1 text-[11px] text-amber-600">
                              ⚠️ Tiene {hoja.visitasPendientesCount} parada(s) con remitos o cobros pendientes. Debe completarse antes del arqueo.
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {tienePendientes ? (
                            <button
                              type="button"
                              onClick={() => void ejecutarIniciarArqueo(hoja, true)}
                              disabled={iniciandoId === hoja.hojaId}
                              className="shrink-0 rounded border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                              title="Forzar el arqueo manual con paradas pendientes"
                            >
                              {iniciandoId === hoja.hojaId ? 'Iniciando…' : 'Forzar Arqueo Anticipado'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void ejecutarIniciarArqueo(hoja, false)}
                              disabled={iniciandoId === hoja.hojaId}
                              className="shrink-0 rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:bg-slate-200 transition-colors"
                            >
                              {iniciandoId === hoja.hojaId ? 'Iniciando…' : 'Iniciar Arqueo'}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-5 flex justify-end border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setModalIniciar(false)}
                className="rounded border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const DetalleDeclaracion: React.FC<{
  session: UserSession;
  id: string;
  onProcesada: (mensaje: string) => void;
  onRetractada: () => void;
}> = ({ session, id, onProcesada, onRetractada }) => {
  const [detalle, setDetalle] = useState<DetalleRendicion | null>(null);
  const [retractada, setRetractada] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [form, setForm] = useState<FormConteo>(formConteoVacio());
  const [justificacion, setJustificacion] = useState('');
  const [enviando, setEnviando] = useState<'' | 'aprobar' | 'diferencia' | 'aprobar_diferencia'>('');
  const [errorAccion, setErrorAccion] = useState('');

  const abrir = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const data = await rendicionEfectivoService.detalle(session.token, id);
      setDetalle(data);
      setRetractada(null);
      if (data.estado === 'con_diferencia') {
        setForm(formDesdeConteo(data.rendidoCentavos, data.conteo));
        setJustificacion(data.motivoDiferencia ?? '');
      }
    } catch (cause) {
      if (cause instanceof RendicionRetractadaError) {
        // HU #47 E2: el sistema advierte que fue retractada.
        setDetalle(null);
        setRetractada(cause.message);
        onRetractada();
      } else {
        setError(cause instanceof Error ? cause.message : 'No se pudo abrir la declaración.');
      }
    } finally {
      setCargando(false);
    }
  }, [id, session.token, onRetractada]);

  useEffect(() => {
    void abrir();
    // Solo al abrir otra declaración.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const analisis = useMemo(() => analizarConteo(form), [form]);
  const comparacion = detalle && analisis.ok ? compararConDeclarado(detalle.declaradoCentavos, analisis.rendidoCentavos) : null;
  const procesable = detalle && (detalle.estado === 'pendiente' || detalle.estado === 'con_diferencia');

  async function ejecutar(accion: 'aprobar' | 'diferencia' | 'aprobar_diferencia') {
    if (!detalle || !analisis.ok) return;
    setEnviando(accion);
    setErrorAccion('');
    try {
      const { rendidoCentavos, conteo } = analisis;
      const nombre = detalle.transportista.nombre;
      if (accion === 'aprobar') {
        await rendicionEfectivoService.aprobar(session.token, detalle.id, rendidoCentavos, conteo);
        onProcesada(`Rendición de ${nombre} aprobada sin diferencias. La hoja ${detalle.codigoHoja} quedó cerrada.`);
      } else if (accion === 'diferencia') {
        await rendicionEfectivoService.registrarDiferencia(session.token, detalle.id, rendidoCentavos, conteo, justificacion);
        onProcesada(`Diferencia registrada en la rendición de ${nombre}. Queda pendiente de aprobación.`);
      } else {
        await rendicionEfectivoService.aprobarConDiferencia(session.token, detalle.id, rendidoCentavos, conteo, justificacion);
        onProcesada(`Rendición de ${nombre} aprobada con diferencia. El descuadre quedó asentado y la hoja ${detalle.codigoHoja} cerrada.`);
      }
      await abrir();
    } catch (cause) {
      if (cause instanceof RendicionRetractadaError) {
        setDetalle(null);
        setRetractada(cause.message);
        onRetractada();
      } else {
        setErrorAccion(cause instanceof Error ? cause.message : 'No se pudo completar la operación.');
      }
    } finally {
      setEnviando('');
    }
  }

  if (cargando && !detalle) return <p className="py-10 text-center text-xs text-slate-500">Abriendo declaración…</p>;

  if (retractada) {
    return (
      <div role="alert" className="flex gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="space-y-1">
          <p className="text-sm font-bold">Declaración retractada</p>
          <p className="text-sm">{retractada}</p>
        </div>
      </div>
    );
  }

  if (error || !detalle) return <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error || 'No se encontró la declaración.'}</p>;

  const justificacionOk = justificacionValida(justificacion);

  return (
    <div className="space-y-4">
      {/* HU #47 E1: transportista, monto declarado y fecha de la hoja de ruta */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Transportista</p>
          <h2 className="text-xl font-extrabold text-marca-azul">{detalle.transportista.nombre}</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Hoja de ruta {detalle.codigoHoja} del <strong>{formatoFecha(detalle.fechaReparto)}</strong> · {detalle.sucursal}
            {detalle.patente ? ` · ${detalle.patente}` : ''}
          </p>
        </div>
        <EstadoBadge estado={detalle.estado} />
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-marca-naranja/40 bg-orange-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Efectivo declarado</p>
          <p className="text-2xl font-extrabold text-slate-900">{formatoPesos(detalle.declaradoCentavos)}</p>
          <p className="text-[11px] text-slate-500">Declarado desde la app: {horaLocal(detalle.declaradoEn)}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Cobrado en efectivo según sistema</p>
          <p className="text-2xl font-extrabold text-slate-700">{formatoPesos(detalle.efectivoCobradoCentavos)}</p>
          <details className="text-[11px] text-slate-500">
            <summary className="cursor-pointer">{detalle.cobrosEfectivo.length} cobro(s) en efectivo</summary>
            <ul className="mt-1 space-y-0.5">
              {detalle.cobrosEfectivo.map((cobro) => (
                <li key={cobro.id} className="flex justify-between gap-2">
                  <span>#{cobro.orden ?? '—'} {cobro.comercio}</span>
                  <span className="font-semibold">{formatoPesos(cobro.importeCentavos)}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>

      {detalle.estado === 'con_diferencia' && detalle.diferenciaCentavos !== null && (
        <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-xs text-orange-950">
          <p className="font-bold">
            Diferencia registrada: {detalle.tipoDiferencia} de {formatoPesos(Math.abs(detalle.diferenciaCentavos))} (contado {formatoPesos(detalle.rendidoCentavos ?? 0)})
          </p>
          <p className="mt-1">Justificación: {detalle.motivoDiferencia}</p>
          <p className="mt-1 text-orange-800">Registrada por {detalle.diferenciaRegistradaPor ?? '—'} · {horaLocal(detalle.diferenciaRegistradaEn)}</p>
        </div>
      )}

      {detalle.estado === 'validada' && (
        <div className="flex gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="space-y-1">
            <p className="font-bold">
              {detalle.diferenciaCentavos ? `Aprobada con ${detalle.tipoDiferencia} de ${formatoPesos(Math.abs(detalle.diferenciaCentavos))}` : 'Aprobada sin diferencias'}
            </p>
            <p className="text-xs">Contado: {formatoPesos(detalle.rendidoCentavos ?? 0)} · Aprobó {detalle.validadoPor ?? '—'} el {horaLocal(detalle.validadoEn)} · Hoja cerrada.</p>
            {detalle.motivoDiferencia && <p className="text-xs">Motivo del descuadre: {detalle.motivoDiferencia}</p>}
          </div>
        </div>
      )}

      {procesable && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Scale className="h-4 w-4 text-marca-azul" /> Conteo físico</h3>
            <div role="radiogroup" aria-label="Forma de carga" className="flex gap-1 text-xs">
              {(['billetes', 'total'] as const).map((modo) => (
                <button
                  key={modo}
                  type="button"
                  role="radio"
                  aria-checked={form.modo === modo}
                  onClick={() => setForm({ ...form, modo })}
                  className={`rounded border px-2.5 py-1 font-semibold ${form.modo === modo ? 'border-marca-azul bg-marca-azul text-white' : 'border-slate-300 text-slate-600'}`}
                >
                  {modo === 'billetes' ? 'Contar billetes' : 'Ingresar total'}
                </button>
              ))}
            </div>
          </div>

          {form.modo === 'billetes' ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {DENOMINACIONES_PESOS.map((denominacion) => (
                <label key={denominacion} className="text-xs text-slate-600">
                  Billetes de {formatoPesos(denominacion * 100).replace(',00', '')}
                  <input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    value={form.billetes[denominacion] ?? ''}
                    onChange={(e) => setForm({ ...form, billetes: { ...form.billetes, [denominacion]: e.target.value } })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="0"
                  />
                </label>
              ))}
              <label className="text-xs text-slate-600">
                Monedas ($)
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.monedas}
                  onChange={(e) => setForm({ ...form, monedas: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="0,00"
                />
              </label>
            </div>
          ) : (
            <label className="block text-xs text-slate-600">
              Monto físico contado ($)
              <input
                type="text"
                inputMode="decimal"
                value={form.total}
                onChange={(e) => setForm({ ...form, total: e.target.value })}
                className="mt-1 w-full max-w-xs rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="45.000,50"
              />
            </label>
          )}

          {/* Resultado del conteo contra lo declarado */}
          {!analisis.ok ? (
            <p role={analisis.negativo ? 'alert' : undefined} className={`rounded px-3 py-2 text-xs ${analisis.negativo ? 'border border-red-300 bg-red-50 font-semibold text-red-800' : 'bg-slate-50 text-slate-500'}`}>
              {analisis.negativo ? `Registro bloqueado: ${analisis.error}` : analisis.error}
            </p>
          ) : comparacion && (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded px-3 py-2 text-sm font-bold ${
                comparacion.tipo === 'coincide' ? 'bg-emerald-50 text-emerald-800' : comparacion.tipo === 'faltante' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
              }`}
            >
              <span>Total contado: {formatoPesos(analisis.rendidoCentavos)}</span>
              <span>
                {comparacion.tipo === 'coincide'
                  ? 'Coincide con lo declarado'
                  : `${comparacion.tipo === 'faltante' ? 'Faltante' : 'Sobrante'} de ${formatoPesos(Math.abs(comparacion.diferenciaCentavos))}`}
              </span>
            </div>
          )}

          {errorAccion && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{errorAccion}</p>}

          {comparacion?.tipo === 'coincide' ? (
            // HU #48: solo coincidente si es exactamente igual
            <button
              type="button"
              onClick={() => void ejecutar('aprobar')}
              disabled={!!enviando}
              className="w-full rounded-md bg-marca-naranja px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-marca-naranja-hover disabled:opacity-50"
            >
              {enviando === 'aprobar' ? 'Aprobando…' : 'Aprobar rendición'}
            </button>
          ) : comparacion ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Justificación de la diferencia (obligatoria)
                <textarea
                  value={justificacion}
                  onChange={(e) => setJustificacion(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
                  placeholder="Ej.: faltan dos billetes de $1.000; el chofer reconoce el faltante."
                />
              </label>
              {!justificacionOk && (
                <p className="text-[11px] text-slate-500">Escribí al menos {LARGO_MINIMO_JUSTIFICACION} caracteres para registrar o aprobar con diferencia.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {/* HU #49 */}
                <button
                  type="button"
                  onClick={() => void ejecutar('diferencia')}
                  disabled={!!enviando || !justificacionOk}
                  className="flex-1 rounded-md border-2 border-marca-azul px-4 py-2 text-sm font-bold text-marca-azul hover:bg-blue-50 disabled:opacity-50"
                >
                  {enviando === 'diferencia' ? 'Registrando…' : 'Registrar diferencia'}
                </button>
                {/* HU #50 */}
                <button
                  type="button"
                  onClick={() => void ejecutar('aprobar_diferencia')}
                  disabled={!!enviando || !justificacionOk}
                  className="flex-1 rounded-md bg-marca-naranja px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-marca-naranja-hover disabled:opacity-50"
                >
                  {enviando === 'aprobar_diferencia' ? 'Aprobando…' : 'Aprobar con diferencia'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
