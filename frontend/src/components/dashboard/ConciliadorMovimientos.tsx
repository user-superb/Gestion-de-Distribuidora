import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserSession } from '../../types/auth';

interface ConciliadorMovimientosProps {
  session: UserSession;
  initialSelection?: { movimientoId: string; remitoId: string; fecha: string } | null;
}

interface Movimiento {
  id: string;
  fecha_hora: string;
  ordenante: string | null;
  importe_centavos: string;
  cuenta: string;
  cuenta_id: string;
}

interface RemitoPendiente {
  id: string;
  numero: string;
  razon_social: string;
  marca: string;
  sucursal: string;
  fecha_entrega: string | null;
  saldo_centavos: string;
}

interface Discrepancia {
  id: string;
  movimiento_id: string;
  movimiento_ids: string;
  fecha_hora: string;
  ordenante: string | null;
  diferencia_centavos: string;
  nota: string;
  remito_ids: string;
  motivo_tipificado?: string | null;
  comprobante_nombre?: string | null;
  dentro_de_tolerancia?: boolean;
  estado?: string;
}

interface PoliticaTolerancia {
  toleranciaNominalCentavos: string;
  toleranciaNominalPesos: number;
  toleranciaPorcentual: number;
  motivosTipificados: string[];
}

import { API_BASE } from '../../config/api';

function fechaLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatoARS(centavos: string | bigint): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(centavos) / 100);
}

export const ConciliadorMovimientos: React.FC<ConciliadorMovimientosProps> = ({ session, initialSelection }) => {
  const [fecha, setFecha] = useState(() => initialSelection?.fecha || fechaLocal());
  const [cuentaId, setCuentaId] = useState('todas');
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [remitos, setRemitos] = useState<RemitoPendiente[]>([]);
  const [filtroRemitos, setFiltroRemitos] = useState({ texto: '', comercio: '', sucursal: '', marca: '', antiguedad: '' });
  const [discrepancias, setDiscrepancias] = useState<Discrepancia[]>([]);
  const [movimientosSeleccionados, setMovimientosSeleccionados] = useState<Set<string>>(() => new Set(initialSelection ? [initialSelection.movimientoId] : []));
  const [remitosSeleccionados, setRemitosSeleccionados] = useState<Set<string>>(() => new Set(initialSelection ? [initialSelection.remitoId] : []));
  const [nota, setNota] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // Estados para justificación de diferencia monetaria (HU Conciliación)
  const [politicaTolerancia, setPoliticaTolerancia] = useState<PoliticaTolerancia>({
    toleranciaNominalCentavos: '500000',
    toleranciaNominalPesos: 5000,
    toleranciaPorcentual: 5,
    motivosTipificados: [
      'Retenciones impositivas',
      'Descuentos comerciales',
      'Diferencias de cambio',
      'Comisiones bancarias',
      'Otros conceptos autorizados',
    ],
  });
  const [motivoTipificado, setMotivoTipificado] = useState('');
  const [comprobanteNombre, setComprobanteNombre] = useState('');
  const [camposFaltantes, setCamposFaltantes] = useState<string[]>([]);

  const headers = useMemo(() => ({
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  }), [session.token]);

  const cargar = useCallback(async (dia = fecha) => {
    setCargando(true);
    setError('');
    try {
      const [movRes, remRes, discRes] = await Promise.all([
        fetch(`${API_BASE}/conciliacion/movimientos?fecha=${encodeURIComponent(dia)}`, { headers }),
        fetch(`${API_BASE}/conciliacion/remitos-pendientes`, { headers }),
        fetch(`${API_BASE}/conciliacion/discrepancias`, { headers }),
      ]);
      const responses = [movRes, remRes, discRes];
      if (responses.some((response) => !response.ok)) {
        throw new Error('No se pudieron cargar los datos de conciliación. Verificá tu sesión y PostgreSQL.');
      }
      const [movData, remData, discData] = await Promise.all(responses.map((response) => response.json()));
      setMovimientos(movData);
      setRemitos(remData);
      setDiscrepancias(discData);
      setCuentaId((current) => current === 'todas' || movData.some((item: Movimiento) => item.cuenta_id === current) ? current : 'todas');
      setMovimientosSeleccionados((current) => new Set([...current].filter((id) => movData.some((item: Movimiento) => item.id === id))));

      // Cargar políticas de tolerancia configuradas
      try {
        const tolRes = await fetch(`${API_BASE}/conciliacion/tolerancia`, { headers });
        if (tolRes.ok) {
          const tolData = await tolRes.json();
          if (tolData?.motivosTipificados) {
            setPoliticaTolerancia(tolData);
          }
        }
      } catch {
        // Usa defaults definidos
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar la conciliación.');
    } finally {
      setCargando(false);
    }
  }, [fecha, headers]);

  useEffect(() => { void cargar(); }, [cargar]);

  const movimientosVisibles = cuentaId === 'todas' ? movimientos : movimientos.filter((item) => item.cuenta_id === cuentaId);
  const cuentas = [...new Map(movimientos.map((item) => [item.cuenta_id, item.cuenta] as const)).entries()];
  const movimientosElegidos = movimientosVisibles.filter((item) => movimientosSeleccionados.has(item.id));
  const remitosElegidos = remitos.filter((item) => remitosSeleccionados.has(item.id));
  const importe = movimientosElegidos.reduce((total, item) => total + BigInt(item.importe_centavos), 0n);
  const suma = remitosElegidos.reduce((total, item) => total + BigInt(item.saldo_centavos), 0n);
  const diferencia = importe - suma;

  // Cálculos de desvío y tolerancia cuando el movimiento es inferior al remito
  const desvioCentavos = diferencia < 0n ? -diferencia : 0n;
  const porcentajeDesvio = suma > 0n && diferencia < 0n
    ? Number((desvioCentavos * 10000n) / suma) / 100
    : 0;
  const toleranciaNominalCentavos = BigInt(politicaTolerancia.toleranciaNominalCentavos || '500000');
  const toleranciaPorcentualMax = politicaTolerancia.toleranciaPorcentual || 5;

  const excedeTolerancia = diferencia < 0n && (
    desvioCentavos > toleranciaNominalCentavos ||
    porcentajeDesvio > toleranciaPorcentualMax
  );

  const remitosVisibles = remitos.filter((item) => {
    const texto = filtroRemitos.texto.trim().toLocaleLowerCase('es-AR');
    const contenido = `${item.numero} ${item.razon_social} ${item.marca}`.toLocaleLowerCase('es-AR');
    const dias = item.fecha_entrega ? Math.max(0, Math.floor((Date.now() - new Date(item.fecha_entrega).getTime()) / 86400000)) : null;
    const antiguedadCoincide = !filtroRemitos.antiguedad || (dias !== null && (
      filtroRemitos.antiguedad === '0-30' ? dias <= 30 :
      filtroRemitos.antiguedad === '31-60' ? dias >= 31 && dias <= 60 :
      filtroRemitos.antiguedad === '61-90' ? dias >= 61 && dias <= 90 : dias > 90
    ));
    return (!texto || contenido.includes(texto)) &&
      (!filtroRemitos.comercio || item.razon_social === filtroRemitos.comercio) &&
      (!filtroRemitos.sucursal || item.sucursal === filtroRemitos.sucursal) &&
      (!filtroRemitos.marca || item.marca === filtroRemitos.marca) && antiguedadCoincide;
  });

  const toggleSeleccion = (id: string, seleccion: Set<string>, actualizar: (value: Set<string>) => void) => {
    const next = new Set(seleccion);
    if (next.has(id)) next.delete(id); else next.add(id);
    actualizar(next);
    setMensaje('');
    setError('');
    setCamposFaltantes([]);
  };

  const ejecutar = async () => {
    if (!movimientosSeleccionados.size || !remitosSeleccionados.size) return;
    const derivar = diferencia > 0n;
    if (derivar && !nota.trim()) {
      setError('Agregá una nota para derivar la diferencia a la bandeja.');
      return;
    }

    // ESCENARIO 3: Validación obligatoria de motivo tipificado y comprobante para diferencias monetarias
    if (diferencia < 0n) {
      const faltantes: string[] = [];
      if (!motivoTipificado) faltantes.push('motivoTipificado');
      if (!comprobanteNombre.trim()) faltantes.push('comprobanteNombre');

      if (faltantes.length > 0) {
        setCamposFaltantes(faltantes);
        setError('Toda diferencia entre el valor del movimiento bancario y el saldo de los remitos debe clasificarse obligatoriamente bajo un motivo tipificado con comprobante de respaldo adjunto.');
        return;
      }
    }

    setCamposFaltantes([]);
    setError('');
    setMensaje('');
    setCargando(true);
    try {
      const bodyPayload: Record<string, unknown> = {
        movimientoIds: movimientosElegidos.map((item) => item.id),
        remitoIds: remitosElegidos.map((item) => item.id),
        ...(derivar ? { nota } : {}),
      };

      if (diferencia < 0n) {
        bodyPayload.justificacion = {
          motivoTipificado,
          comprobanteNombre: comprobanteNombre.trim(),
          nota: nota.trim() || undefined,
        };
      }

      const response = await fetch(
        `${API_BASE}/conciliacion/${derivar ? 'discrepancias' : 'imputaciones'}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyPayload),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        if (data.details?.camposFaltantes) {
          setCamposFaltantes(data.details.camposFaltantes);
        }
        const noElegibles = [
          ...(Array.isArray(data.remitosNoElegibles) ? data.remitosNoElegibles.map((item: any) => typeof item === 'object' ? item.numero || item.id : item) : []),
          ...(Array.isArray(data.movimientosNoElegibles) ? data.movimientosNoElegibles : []),
        ];
        throw new Error(`${data.message || 'No se pudo completar la operación.'}${noElegibles.length ? ` No elegibles: ${noElegibles.join(', ')}.` : ''}`);
      }

      // Notificaciones según escenarios
      if (data.bloqueadoPorTolerancia || data.escaladoGerencia) {
        setMensaje(`⚠️ ${data.message || 'El desvío excede la tolerancia permitida. La conciliación directa fue bloqueada y el caso se derivó a la bandeja de aprobación gerencial.'}`);
      } else if (data.ajusteAsentado) {
        setMensaje(`✅ ${data.message || 'Conciliación asentada con ajuste contable por diferencia justificada y comprobantes saldados.'}`);
      } else {
        setMensaje(derivar ? 'La diferencia quedó en la bandeja de resolución.' : 'Movimiento conciliado; los saldos de los remitos quedaron actualizados.');
      }

      setMovimientosSeleccionados(new Set());
      setRemitosSeleccionados(new Set());
      setNota('');
      setMotivoTipificado('');
      setComprobanteNombre('');
      setCamposFaltantes([]);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <section className="border border-slate-200 rounded-md bg-white p-4 shadow-sm space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Conciliación bancaria</h2>
          <p className="text-xs text-slate-500">Seleccioná movimientos y remitos; el sistema distribuye los pagos automáticamente según los saldos pendientes.</p>
        </div>
        <label className="text-xs text-slate-600 flex items-center gap-2">
          Cuenta
          <select value={cuentaId} onChange={(event) => { setCuentaId(event.target.value); setMovimientosSeleccionados(new Set()); setRemitosSeleccionados(new Set()); }} className="border border-slate-300 rounded px-2 py-1.5 text-slate-800">
            <option value="todas">Todas</option>
            {cuentas.map(([id, alias]) => <option key={id} value={id}>{alias}</option>)}
          </select>
          Fecha
          <input type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-slate-800" />
        </label>
      </header>

      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
      {mensaje && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{mensaje}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Movimientos pendientes ({movimientosVisibles.length}) · Seleccionados: {movimientosSeleccionados.size}</h3>
          <div className="max-h-64 overflow-auto rounded border border-slate-200 divide-y divide-slate-100">
            {movimientosVisibles.length === 0 ? <p className="p-3 text-xs text-slate-500">No hay movimientos pendientes para esta fecha y cuenta.</p> : movimientosVisibles.map((item) => (
              <label key={item.id} className={`flex cursor-pointer items-center justify-between gap-3 p-3 text-xs transition-colors ${movimientosSeleccionados.has(item.id) ? 'bg-marca-crema/70 border-l-4 border-marca-naranja' : 'hover:bg-slate-50'}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" checked={movimientosSeleccionados.has(item.id)} onChange={() => toggleSeleccion(item.id, movimientosSeleccionados, setMovimientosSeleccionados)} className="rounded text-marca-naranja focus:ring-marca-naranja" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-800">{item.ordenante || 'Ordenante no informado'}</span>
                    <span className="text-slate-500">{new Date(item.fecha_hora).toLocaleString('es-AR')} · {item.cuenta}</span>
                  </span>
                </span>
                <strong className="whitespace-nowrap text-slate-900">{formatoARS(item.importe_centavos)}</strong>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Remitos pendientes de cobro ({remitosVisibles.length})</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label="Buscar remito o cliente" value={filtroRemitos.texto} onChange={(event) => setFiltroRemitos({ ...filtroRemitos, texto: event.target.value })} placeholder="Buscar remito, cliente o marca" className="min-w-0 rounded border border-slate-300 px-2 py-1.5 text-xs" />
              <select aria-label="Filtrar por cliente" value={filtroRemitos.comercio} onChange={(event) => setFiltroRemitos({ ...filtroRemitos, comercio: event.target.value })} className="rounded border border-slate-300 px-2 py-1.5 text-xs"><option value="">Todos los clientes</option>{[...new Set(remitos.map((item) => item.razon_social))].sort().map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Filtrar por sucursal" value={filtroRemitos.sucursal} onChange={(event) => setFiltroRemitos({ ...filtroRemitos, sucursal: event.target.value })} className="rounded border border-slate-300 px-2 py-1.5 text-xs"><option value="">Todas las sucursales</option>{[...new Set(remitos.map((item) => item.sucursal))].sort().map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Filtrar por marca" value={filtroRemitos.marca} onChange={(event) => setFiltroRemitos({ ...filtroRemitos, marca: event.target.value })} className="rounded border border-slate-300 px-2 py-1.5 text-xs"><option value="">Todas las marcas</option>{[...new Set(remitos.map((item) => item.marca))].sort().map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Filtrar por antigüedad" value={filtroRemitos.antiguedad} onChange={(event) => setFiltroRemitos({ ...filtroRemitos, antiguedad: event.target.value })} className="rounded border border-slate-300 px-2 py-1.5 text-xs"><option value="">Cualquier antigüedad</option><option value="0-30">Hasta 30 días</option><option value="31-60">31 a 60 días</option><option value="61-90">61 a 90 días</option><option value="90+">Más de 90 días</option></select>
            </div>
          </div>
          <div className="max-h-64 overflow-auto rounded border border-slate-200 divide-y divide-slate-100">
            {remitosVisibles.length === 0 ? <p className="p-3 text-xs text-slate-500">No se registran remitos pendientes de cobro</p> : remitosVisibles.map((item) => (
              <label key={item.id} className={`flex cursor-pointer items-center justify-between gap-3 p-3 text-xs transition-colors ${remitosSeleccionados.has(item.id) ? 'bg-marca-crema/70 border-l-4 border-marca-naranja' : 'hover:bg-slate-50'}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" aria-label={`Seleccionar remito ${item.numero}`} checked={remitosSeleccionados.has(item.id)} onChange={() => toggleSeleccion(item.id, remitosSeleccionados, setRemitosSeleccionados)} className="rounded text-marca-naranja focus:ring-marca-naranja" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-800">{item.numero} · {item.razon_social}</span>
                    <span className="text-slate-500">{item.marca} · {item.sucursal} · Entregado: {item.fecha_entrega ? new Date(item.fecha_entrega).toLocaleDateString('es-AR') : 'Sin fecha'}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <strong className="whitespace-nowrap text-slate-900">Saldo {formatoARS(item.saldo_centavos)}</strong>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {movimientosSeleccionados.size > 0 && remitosSeleccionados.size > 0 && (
        <div className={`rounded border p-3.5 space-y-3 ${
          diferencia === 0n
            ? 'border-emerald-200 bg-emerald-50/50'
            : diferencia > 0n
            ? 'border-amber-200 bg-amber-50/50'
            : excedeTolerancia
            ? 'border-red-300 bg-red-50/40'
            : 'border-blue-200 bg-blue-50/40'
        }`}>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div>{movimientosSeleccionados.size} movimiento(s): <strong>{formatoARS(importe)}</strong></div>
            <div>{remitosSeleccionados.size} remito(s) seleccionado(s): <strong>{formatoARS(suma)}</strong></div>
            <div>
              {diferencia > 0n ? 'Sobrante sin imputar: ' : diferencia < 0n ? 'Diferencia / Desvío: ' : 'Diferencia: '}
              <strong>{diferencia > 0n ? formatoARS(diferencia) : diferencia < 0n ? `${formatoARS(desvioCentavos)} (${porcentajeDesvio.toFixed(2)}%)` : 'Exacta ($0,00)'}</strong>
            </div>
          </div>

          {/* ESCENARIO 1 y 2: Panel de Justificación de Diferencia Monetaria */}
          {diferencia < 0n && (
            <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3 shadow-xs">
              {/* Alerta de estado según tolerancia */}
              {!excedeTolerancia ? (
                <div className="flex items-start gap-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
                  <span className="text-base leading-none">ℹ️</span>
                  <div>
                    <strong>Diferencia dentro de tolerancia operativa:</strong> El desvío de {formatoARS(desvioCentavos)} ({porcentajeDesvio.toFixed(2)}%) no supera la tolerancia parametrizada (hasta {formatoARS(toleranciaNominalCentavos)} o {toleranciaPorcentualMax}%).
                    Al clasificar la causa y adjuntar el comprobante, el sistema asentará el ajuste contable y saldará los remitos al 100%.
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  <span className="text-base leading-none">⚠️</span>
                  <div>
                    <strong>Desvío excede la tolerancia permitida:</strong> La diferencia de {formatoARS(desvioCentavos)} ({porcentajeDesvio.toFixed(2)}%) supera el límite fijado por política financiera (máx. {formatoARS(toleranciaNominalCentavos)} o {toleranciaPorcentualMax}%).
                    La conciliación automática directa será <strong>bloqueada</strong> y se remitirá el expediente con su justificación a la <strong>bandeja de aprobación gerencial</strong>.
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Motivo tipificado obligatorio <span className="text-red-500">*</span>
                  </label>
                  <select
                    aria-label="Motivo tipificado"
                    value={motivoTipificado}
                    onChange={(e) => {
                      setMotivoTipificado(e.target.value);
                      setCamposFaltantes((prev) => prev.filter((c) => c !== 'motivoTipificado'));
                    }}
                    className={`mt-1 w-full rounded border px-2.5 py-1.5 text-xs text-slate-800 transition-colors ${
                      camposFaltantes.includes('motivoTipificado')
                        ? 'border-red-500 ring-2 ring-red-200 bg-red-50/50'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    <option value="">-- Seleccioná el motivo tipificado --</option>
                    {politicaTolerancia.motivosTipificados.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {camposFaltantes.includes('motivoTipificado') && (
                    <p className="mt-1 text-[11px] font-medium text-red-600">Seleccioná una causal obligatoria.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Comprobante o certificado de respaldo <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      aria-label="Comprobante de respaldo"
                      type="text"
                      placeholder="Ej. Certificado_Retencion_AFIP.pdf o Cert. Nº 984"
                      value={comprobanteNombre}
                      onChange={(e) => {
                        setComprobanteNombre(e.target.value);
                        setCamposFaltantes((prev) => prev.filter((c) => c !== 'comprobanteNombre'));
                      }}
                      className={`flex-1 rounded border px-2.5 py-1.5 text-xs text-slate-800 transition-colors ${
                        camposFaltantes.includes('comprobanteNombre')
                          ? 'border-red-500 ring-2 ring-red-200 bg-red-50/50'
                          : 'border-slate-300 bg-white'
                      }`}
                    />
                    <label className="cursor-pointer rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
                      Adjuntar
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setComprobanteNombre(file.name);
                            setCamposFaltantes((prev) => prev.filter((c) => c !== 'comprobanteNombre'));
                          }
                        }}
                      />
                    </label>
                  </div>
                  {camposFaltantes.includes('comprobanteNombre') && (
                    <p className="mt-1 text-[11px] font-medium text-red-600">Adjuntá o referenciá el respaldo documental.</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Nota / Justificación aclaratoria
                  <textarea
                    value={nota}
                    onChange={(event) => setNota(event.target.value)}
                    rows={2}
                    maxLength={500}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                    placeholder="Detalles adicionales sobre la retención impositiva o causal de la diferencia..."
                  />
                </label>
              </div>
            </div>
          )}

          {diferencia > 0n && (
            <label className="block text-xs text-slate-700">
              Nota para la bandeja de discrepancias
              <textarea
                value={nota}
                onChange={(event) => setNota(event.target.value)}
                rows={2}
                maxLength={500}
                className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                placeholder="Explicá la diferencia encontrada para su derivación"
              />
            </label>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void ejecutar()}
              disabled={cargando || (diferencia > 0n && !nota.trim())}
              className={`rounded-md px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                excedeTolerancia
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-marca-naranja hover:bg-marca-naranja-hover'
              }`}
            >
              {cargando
                ? 'Procesando…'
                : diferencia > 0n
                ? 'Derivar discrepancia'
                : excedeTolerancia
                ? 'Derivar a aprobación gerencial'
                : diferencia < 0n
                ? 'Conciliar con ajuste contable'
                : 'Conciliar selección'}
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Bandeja de discrepancias y aprobaciones ({discrepancias.length})</h3>
        {discrepancias.length === 0 ? <p className="text-xs text-slate-500">Sin casos pendientes.</p> : discrepancias.map((item) => (
          <div
            key={item.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded border p-2.5 text-xs ${
              item.estado === 'pendiente_aprobacion'
                ? 'border-amber-300 bg-amber-50/60'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800">
                  Movimientos #{item.movimiento_ids.replace(/[{}]/g, '').replace(/,/g, ', #')} · Remitos: {item.remito_ids.replace(/[{}]/g, '')}
                </span>
                {item.estado === 'pendiente_aprobacion' && (
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                    Pendiente Aprobación Gerencial
                  </span>
                )}
              </div>
              <div className="text-slate-600">
                {item.ordenante || 'Ordenante sin informar'} · {item.nota}
                {item.motivo_tipificado && (
                  <span className="ml-2 font-medium text-slate-800">
                    · Causal: {item.motivo_tipificado} ({item.comprobante_nombre || 'Sin comprobante'})
                  </span>
                )}
              </div>
            </div>
            <strong className="whitespace-nowrap text-slate-900">
              {item.diferencia_centavos.startsWith('-') ? 'Faltante ' : 'Sobrante '}
              {formatoARS(item.diferencia_centavos.startsWith('-') ? item.diferencia_centavos.slice(1) : item.diferencia_centavos)}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
};
