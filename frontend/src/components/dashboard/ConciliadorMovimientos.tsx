import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, X, Landmark, QrCode, FileText } from 'lucide-react';
import { UserSession } from '../../types/auth';

interface ConciliadorMovimientosProps {
  session: UserSession;
  initialSelection?: { movimientoId: string; remitoId: string; fecha: string } | null;
}

interface CuentaRecepcionDisponible {
  id: string;
  sucursal_id: string;
  sucursal: string;
  nombre_fantasia: string | null;
  alias: string;
  cbu: string | null;
  banco: string | null;
  moneda: string;
}

interface ComercioOpcion {
  id: string;
  razon_social: string;
  nombre_fantasia?: string | null;
  cuit?: string | null;
}

interface ResumenImportacionExtracto {
  cuentaId: string;
  cuentaAlias: string;
  moneda: string;
  archivo: string;
  totalProcesados: number;
  insertados: number;
  omitidosDuplicados: number;
  mensaje: string;
}

interface Movimiento {
  id: string;
  fecha_hora: string;
  ordenante: string | null;
  ordenante_cuit?: string | null;
  concepto?: string | null;
  referencia_externa?: string | null;
  origen?: string;
  comprobante_nombre?: string | null;
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
  motivo_codigo: string;
  estado: string;
  creada_por: string;
  comprobante_nombre: string;
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
  const [motivo, setMotivo] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [observacionResolucion, setObservacionResolucion] = useState('');
  const [notificaciones, setNotificaciones] = useState<{ id: string; mensaje: string }[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // Estado para HU: Importación de extracto bancario digital y Cargas Manuales (Transferencia y QR)
  const [cuentasRecepcion, setCuentasRecepcion] = useState<CuentaRecepcionDisponible[]>([]);
  const [comerciosCatalogo, setComerciosCatalogo] = useState<ComercioOpcion[]>([]);
  const [mostrarSugerenciasComercio, setMostrarSugerenciasComercio] = useState(false);
  const [indiceComercioActivo, setIndiceComercioActivo] = useState(0);
  const [panelCargaActiva, setPanelCargaActiva] = useState<'ninguno' | 'extracto' | 'transferencia' | 'qr'>('ninguno');
  const [cuentaImportacionId, setCuentaImportacionId] = useState('');
  const [archivoExtracto, setArchivoExtracto] = useState<File | null>(null);
  const [importandoExtracto, setImportandoExtracto] = useState(false);
  const [errorImportacion, setErrorImportacion] = useState('');
  const [resumenImportacion, setResumenImportacion] = useState<ResumenImportacionExtracto | null>(null);

  // Estado compartido/homogéneo para Carga Manual (Transferencia y Cobro QR)
  const [cuentaManualId, setCuentaManualId] = useState('');
  const [fechaManual, setFechaManual] = useState(() => fechaLocal());
  const [importeManual, setImporteManual] = useState('');
  const [referenciaManual, setReferenciaManual] = useState('');
  const [ordenanteManual, setOrdenanteManual] = useState('');
  const [cuitManual, setCuitManual] = useState('');
  const [conceptoManual, setConceptoManual] = useState('');
  const [comprobanteManual, setComprobanteManual] = useState<File | null>(null);
  const [guardandoManual, setGuardandoManual] = useState(false);
  const [errorManual, setErrorManual] = useState('');
  const [exitoManual, setExitoManual] = useState('');
  const [camposInvalidosManual, setCamposInvalidosManual] = useState<Set<string>>(new Set());

  const headers = useMemo(() => ({
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  }), [session.token]);

  const cargar = useCallback(async (dia = fecha) => {
    setCargando(true);
    setError('');
    try {
      const [movRes, remRes, discRes, notifRes] = await Promise.all([
        fetch(`${API_BASE}/conciliacion/movimientos?fecha=${encodeURIComponent(dia)}`, { headers }),
        fetch(`${API_BASE}/conciliacion/remitos-pendientes`, { headers }),
        fetch(`${API_BASE}/conciliacion/discrepancias`, { headers }),
        fetch(`${API_BASE}/conciliacion/notificaciones`, { headers }),
      ]);
      const responses = [movRes, remRes, discRes, notifRes];
      if (responses.some((response) => !response.ok)) {
        throw new Error('No se pudieron cargar los datos de conciliación. Verificá tu sesión y PostgreSQL.');
      }
      const [movData, remData, discData, notifData] = await Promise.all(responses.map((response) => response.json()));
      setMovimientos(movData);
      setRemitos(remData);
      setDiscrepancias(discData);
      setNotificaciones(notifData);
      setCuentaId((current) => current === 'todas' || movData.some((item: Movimiento) => item.cuenta_id === current) ? current : 'todas');
      setMovimientosSeleccionados((current) => new Set([...current].filter((id) => movData.some((item: Movimiento) => item.id === id))));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar la conciliación.');
    } finally {
      setCargando(false);
    }
  }, [fecha, headers]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    let active = true;
    const cargarCuentasYComercios = async () => {
      try {
        const [cuentasRes, comerciosRes] = await Promise.all([
          fetch(`${API_BASE}/conciliacion/cuentas-recepcion`, { headers }),
          fetch(`${API_BASE}/conciliacion/comercios`, { headers }),
        ]);
        if (cuentasRes.ok && active) {
          const data: CuentaRecepcionDisponible[] = await cuentasRes.json();
          setCuentasRecepcion(data);
          if (data.length > 0) {
            setCuentaImportacionId((prev) => prev || String(data[0].id));
            setCuentaManualId((prev) => prev || String(data[0].id));
          }
        }
        if (comerciosRes.ok && active) {
          const dataComercios: ComercioOpcion[] = await comerciosRes.json();
          setComerciosCatalogo(dataComercios);
        }
      } catch {
        // Ignorar en carga inicial si el endpoint no responde en tests antiguos
      }
    };
    void cargarCuentasYComercios();
    return () => { active = false; };
  }, [headers]);

  const opcionesComercioDisponibles = useMemo(() => {
    const mapa = new Map<string, ComercioOpcion>();
    for (const c of comerciosCatalogo) {
      if (c.razon_social) {
        mapa.set(c.razon_social.toLocaleLowerCase('es-AR'), c);
      }
    }
    for (const r of remitos) {
      const clave = (r.razon_social || '').trim().toLocaleLowerCase('es-AR');
      if (clave && !mapa.has(clave)) {
        mapa.set(clave, { id: `rem-${r.id}`, razon_social: r.razon_social.trim(), cuit: null });
      }
    }
    return [...mapa.values()].sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es-AR'));
  }, [comerciosCatalogo, remitos]);

  const comerciosFiltradosAutocomplete = useMemo(() => {
    const busqueda = ordenanteManual
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();

    if (!busqueda) {
      return opcionesComercioDisponibles.slice(0, 8);
    }

    return opcionesComercioDisponibles
      .filter((c) => {
        const rs = (c.razon_social || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
        const nf = (c.nombre_fantasia || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
        const cuit = c.cuit || '';
        return rs.includes(busqueda) || nf.includes(busqueda) || cuit.includes(busqueda);
      })
      .slice(0, 8);
  }, [opcionesComercioDisponibles, ordenanteManual]);

  const seleccionarComercioAutocomplete = (opcion: ComercioOpcion) => {
    setOrdenanteManual(opcion.razon_social);
    if (opcion.cuit && opcion.cuit.trim().length === 11) {
      setCuitManual(opcion.cuit.trim());
      limpiarCampoInvalido('ordenanteCuit');
    }
    setMostrarSugerenciasComercio(false);
    setIndiceComercioActivo(0);
  };

  const importarExtracto = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorImportacion('');
    setResumenImportacion(null);

    if (!cuentaImportacionId) {
      setErrorImportacion('Seleccioná la cuenta bancaria de recepción a la que corresponde el extracto.');
      return;
    }
    if (!archivoExtracto) {
      setErrorImportacion('Seleccioná un archivo de extracto bancario (.CSV o .XLS).');
      return;
    }

    setImportandoExtracto(true);
    try {
      const formData = new FormData();
      formData.set('cuentaId', cuentaImportacionId);
      formData.set('archivo', archivoExtracto);

      const response = await fetch(`${API_BASE}/conciliacion/extractos/importar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'No se pudo importar el extracto bancario.');
      }

      setResumenImportacion({
        cuentaId: data.cuentaId,
        cuentaAlias: data.cuentaAlias,
        moneda: data.moneda,
        archivo: data.archivo,
        totalProcesados: data.totalProcesados,
        insertados: data.insertados,
        omitidosDuplicados: data.omitidosDuplicados,
        mensaje: data.mensaje,
      });
      setArchivoExtracto(null);
      await cargar();
    } catch (e) {
      setErrorImportacion(e instanceof Error ? e.message : 'Error al importar el extracto bancario.');
    } finally {
      setImportandoExtracto(false);
    }
  };

  const limpiarCampoInvalido = (campo: string) => {
    setCamposInvalidosManual((prev) => {
      if (!prev.has(campo)) return prev;
      const next = new Set(prev);
      next.delete(campo);
      return next;
    });
    setErrorManual('');
  };

  const registrarMovimientoManual = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorManual('');
    setExitoManual('');
    setCamposInvalidosManual(new Set());

    const esQr = panelCargaActiva === 'qr';
    const hoy = fechaLocal();
    const invalidosLocal = new Set<string>();
    const mensajesError: string[] = [];

    if (!cuentaManualId) {
      invalidosLocal.add('cuentaId');
      mensajesError.push(esQr ? 'Seleccioná una cuenta o billetera de acreditación activa.' : 'Seleccioná una cuenta bancaria de recepción activa.');
    }

    if (!fechaManual || fechaManual > hoy) {
      invalidosLocal.add('fechaContable');
      mensajesError.push('No se admiten movimientos bancarios anticipados: la fecha contable no puede ser posterior al día de la carga.');
    }

    const importeLimpio = importeManual.trim().replace(',', '.');
    const montoNum = Number(importeLimpio);
    if (!importeLimpio || Number.isNaN(montoNum) || montoNum <= 0) {
      invalidosLocal.add('importe');
      mensajesError.push('El importe debe ser un monto positivo mayor a cero.');
    }

    if (!referenciaManual.trim()) {
      invalidosLocal.add(esQr ? 'idTransaccion' : 'numeroOperacion');
      mensajesError.push(esQr ? 'Ingresá el ID de transacción provisto por la pasarela de pagos.' : 'Ingresá el número de operación o referencia bancaria.');
    }

    if (!esQr && !comprobanteManual) {
      invalidosLocal.add('comprobante');
      mensajesError.push('Adjuntá el comprobante de respaldo obligatorio (PDF, JPG o PNG).');
    }

    if (invalidosLocal.size > 0) {
      setCamposInvalidosManual(invalidosLocal);
      setErrorManual(mensajesError.join(' '));
      return;
    }

    setGuardandoManual(true);
    try {
      let response: Response;
      if (esQr) {
        response = await fetch(`${API_BASE}/conciliacion/movimientos/manual/qr`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            cuentaId: cuentaManualId,
            fechaContable: fechaManual,
            importe: importeManual,
            idTransaccion: referenciaManual.trim(),
            ordenante: ordenanteManual.trim(),
            ordenanteCuit: cuitManual.trim(),
            concepto: conceptoManual.trim(),
          }),
        });
      } else {
        const formData = new FormData();
        formData.set('cuentaId', cuentaManualId);
        formData.set('fechaContable', fechaManual);
        formData.set('importe', importeManual);
        formData.set('numeroOperacion', referenciaManual.trim());
        if (ordenanteManual.trim()) formData.set('ordenante', ordenanteManual.trim());
        if (cuitManual.trim()) formData.set('ordenanteCuit', cuitManual.trim());
        if (conceptoManual.trim()) formData.set('concepto', conceptoManual.trim());
        if (comprobanteManual) formData.set('comprobante', comprobanteManual);

        response = await fetch(`${API_BASE}/conciliacion/movimientos/manual/transferencia`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}` },
          body: formData,
        });
      }

      const data = await response.json();
      if (!response.ok) {
        if (Array.isArray(data.camposInvalidos)) {
          setCamposInvalidosManual(new Set(data.camposInvalidos));
        }
        throw new Error(data.message || 'No se pudo registrar el movimiento manual.');
      }

      setExitoManual(data.mensaje || 'Movimiento manual registrado y enviado a la bandeja de pendientes de conciliación.');
      setImporteManual('');
      setReferenciaManual('');
      setOrdenanteManual('');
      setCuitManual('');
      setConceptoManual('');
      setComprobanteManual(null);
      if (fechaManual !== fecha) {
        setFecha(fechaManual);
      } else {
        await cargar(fechaManual);
      }
    } catch (e) {
      setErrorManual(e instanceof Error ? e.message : 'Error al registrar el movimiento manual.');
    } finally {
      setGuardandoManual(false);
    }
  };

  const verComprobanteMovimiento = async (item: Movimiento, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const response = await fetch(`${API_BASE}/conciliacion/movimientos/${item.id}/comprobante`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) {
      setError('No se pudo abrir el comprobante del movimiento.');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = item.comprobante_nombre || 'comprobante_transferencia';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const movimientosVisibles = cuentaId === 'todas' ? movimientos : movimientos.filter((item) => item.cuenta_id === cuentaId);
  const cuentas = [...new Map(movimientos.map((item) => [item.cuenta_id, item.cuenta] as const)).entries()];
  const movimientosElegidos = movimientosVisibles.filter((item) => movimientosSeleccionados.has(item.id));
  const remitosElegidos = remitos.filter((item) => remitosSeleccionados.has(item.id));
  const importe = movimientosElegidos.reduce((total, item) => total + BigInt(item.importe_centavos), 0n);
  const suma = remitosElegidos.reduce((total, item) => total + BigInt(item.saldo_centavos), 0n);
  const diferencia = importe - suma;
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
  };

  const ejecutar = async () => {
    if (!movimientosSeleccionados.size || !remitosSeleccionados.size) return;
    const derivar = diferencia !== 0n;
    if (derivar && (!nota.trim() || !motivo || !comprobante)) {
      setError('Para justificar la diferencia, indicá el motivo, agregá una explicación y adjuntá el comprobante.');
      return;
    }
    setError('');
    setMensaje('');
    setCargando(true);
    try {
      const body = derivar ? new FormData() : JSON.stringify({
        movimientoIds: movimientosElegidos.map((item) => item.id), remitoIds: remitosElegidos.map((item) => item.id),
      });
      if (derivar && body instanceof FormData) {
        body.set('movimientoIds', JSON.stringify(movimientosElegidos.map((item) => item.id)));
        body.set('remitoIds', JSON.stringify(remitosElegidos.map((item) => item.id)));
        body.set('nota', nota); body.set('motivo', motivo); body.set('comprobante', comprobante!);
      }
      const response = await fetch(`${API_BASE}/conciliacion/${derivar ? 'discrepancias' : 'imputaciones'}`, {
        method: 'POST', headers: derivar ? { Authorization: `Bearer ${session.token}` } : headers, body,
      });
      const data = await response.json();
      if (!response.ok) {
        const noElegibles = [
          ...(Array.isArray(data.remitosNoElegibles) ? data.remitosNoElegibles.map((item: any) => typeof item === 'object' ? item.numero || item.id : item) : []),
          ...(Array.isArray(data.movimientosNoElegibles) ? data.movimientosNoElegibles : []),
        ];
        throw new Error(`${data.message || 'No se pudo completar la operación.'}${noElegibles.length ? ` No elegibles: ${noElegibles.join(', ')}.` : ''}`);
      }
      setMensaje(derivar ? (data.estado === 'aprobada' ? 'Diferencia dentro de tolerancia: imputación aprobada.' : 'La diferencia quedó en la bandeja para revisión.') : 'Movimiento conciliado; los saldos de los remitos quedaron actualizados.');
      setMovimientosSeleccionados(new Set());
      setRemitosSeleccionados(new Set());
      setNota('');
      setMotivo(''); setComprobante(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
    } finally {
      setCargando(false);
    }
  };

  const resolver = async (item: Discrepancia, accion: 'aprobar' | 'rechazar') => {
    if (accion === 'rechazar' && !observacionResolucion.trim()) { setError('Escribí el motivo del rechazo.'); return; }
    setError(''); setMensaje(''); setCargando(true);
    try {
      const response = await fetch(`${API_BASE}/conciliacion/discrepancias/${item.id}/${accion}`, {
        method: 'POST', headers,
        body: JSON.stringify({ observacion: observacionResolucion }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo resolver la discrepancia.');
      setMensaje(data.mensaje || (accion === 'aprobar' ? 'Discrepancia aprobada e imputada.' : 'Discrepancia rechazada; se notificó al administrativo.'));
      setObservacionResolucion(''); await cargar();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo resolver la discrepancia.'); }
    finally { setCargando(false); }
  };

  const verComprobante = async (item: Discrepancia) => {
    const response = await fetch(`${API_BASE}/conciliacion/discrepancias/${item.id}/comprobante`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (!response.ok) { setError('No se pudo abrir el comprobante.'); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = item.comprobante_nombre || 'comprobante'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <section className="border border-slate-200 rounded-md bg-white p-4 shadow-sm space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Conciliación bancaria</h2>
          <p className="text-xs text-slate-500">Seleccioná movimientos y remitos; el sistema distribuye los pagos automáticamente según los saldos pendientes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPanelCargaActiva((v) => (v === 'extracto' ? 'ninguno' : 'extracto'));
              setErrorImportacion('');
            }}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              panelCargaActiva === 'extracto'
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Importar extracto</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPanelCargaActiva((v) => (v === 'transferencia' ? 'ninguno' : 'transferencia'));
              setErrorManual('');
              setExitoManual('');
              setCamposInvalidosManual(new Set());
            }}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              panelCargaActiva === 'transferencia'
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
            }`}
          >
            <Landmark className="h-3.5 w-3.5" />
            <span>Cargar transferencia</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPanelCargaActiva((v) => (v === 'qr' ? 'ninguno' : 'qr'));
              setErrorManual('');
              setExitoManual('');
              setCamposInvalidosManual(new Set());
            }}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              panelCargaActiva === 'qr'
                ? 'border-purple-600 bg-purple-600 text-white'
                : 'border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100'
            }`}
          >
            <QrCode className="h-3.5 w-3.5" />
            <span>Cargar cobro QR</span>
          </button>
          <label className="text-xs text-slate-600 flex items-center gap-2 ml-1">
            Cuenta
            <select value={cuentaId} onChange={(event) => { setCuentaId(event.target.value); setMovimientosSeleccionados(new Set()); setRemitosSeleccionados(new Set()); }} className="border border-slate-300 rounded px-2 py-1.5 text-slate-800">
              <option value="todas">Todas</option>
              {cuentas.map(([id, alias]) => <option key={id} value={id}>{alias}</option>)}
            </select>
            Fecha
            <input type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-slate-800" />
          </label>
        </div>
      </header>

      {panelCargaActiva === 'extracto' && (
        <form onSubmit={importarExtracto} className="rounded-md border border-blue-200 bg-blue-50/40 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4 text-blue-700" />
                Importar extracto bancario en archivo digital
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-600">
                Cargá un archivo <strong>.CSV</strong> o <strong>.XLS</strong> con las columnas obligatorias (<code>fecha</code>, <code>concepto</code>, <code>importe</code>, <code>referencia</code>). Los movimientos duplicados se omitirán automáticamente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelCargaActiva('ninguno')}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Cerrar importador"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-700 font-medium">
              Cuenta bancaria de recepción destino *
              <select
                required
                aria-label="Cuenta bancaria de recepción destino"
                value={cuentaImportacionId}
                onChange={(e) => {
                  setCuentaImportacionId(e.target.value);
                  setErrorImportacion('');
                }}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
              >
                <option value="">Seleccionar cuenta receptora...</option>
                {cuentasRecepcion.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.alias} ({c.banco || 'Banco'} · {c.moneda || 'ARS'} · {c.sucursal})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-700 font-medium">
              Archivo de extracto (.CSV / .XLS) *
              <input
                required
                type="file"
                aria-label="Archivo de extracto bancario"
                accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel"
                onChange={(e) => {
                  setArchivoExtracto(e.target.files?.[0] || null);
                  setErrorImportacion('');
                }}
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              />
            </label>
          </div>

          {errorImportacion && (
            <div role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <span>{errorImportacion}</span>
            </div>
          )}

          {resumenImportacion && (
            <div role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Resumen consolidado de importación ({resumenImportacion.archivo})</span>
              </div>
              <p>{resumenImportacion.mensaje}</p>
              <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                <div className="rounded bg-white/80 px-2.5 py-1.5 border border-emerald-200">
                  <span className="text-slate-500 block">Total leídos</span>
                  <strong className="text-sm text-slate-900">{resumenImportacion.totalProcesados}</strong>
                </div>
                <div className="rounded bg-white/80 px-2.5 py-1.5 border border-emerald-200">
                  <span className="text-slate-500 block">Registros insertados</span>
                  <strong className="text-sm text-emerald-700">{resumenImportacion.insertados}</strong>
                </div>
                <div className="rounded bg-white/80 px-2.5 py-1.5 border border-emerald-200">
                  <span className="text-slate-500 block">Duplicados descartados</span>
                  <strong className="text-sm text-amber-700">{resumenImportacion.omitidosDuplicados}</strong>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={importandoExtracto}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 hover:bg-blue-800 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{importandoExtracto ? 'Importando extracto…' : 'Procesar extracto'}</span>
            </button>
          </div>
        </form>
      )}

      {(panelCargaActiva === 'transferencia' || panelCargaActiva === 'qr') && (
        <form
          noValidate
          onSubmit={registrarMovimientoManual}
          className={`rounded-md border p-4 space-y-3 ${
            panelCargaActiva === 'qr' ? 'border-purple-200 bg-purple-50/40' : 'border-indigo-200 bg-indigo-50/40'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                {panelCargaActiva === 'qr' ? (
                  <>
                    <QrCode className="h-4 w-4 text-purple-700" />
                    Cargar manualmente un ingreso por cobro QR
                  </>
                ) : (
                  <>
                    <Landmark className="h-4 w-4 text-indigo-700" />
                    Cargar manualmente un movimiento de transferencia bancaria
                  </>
                )}
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-600">
                {panelCargaActiva === 'qr' ? (
                  <>
                    Incorporá acreditaciones de billeteras virtuales no procesadas en línea. Quedará registrado bajo la etiqueta{' '}
                    <strong>&quot;QR - Carga Manual&quot;</strong> en la bandeja de pendientes de conciliación.
                  </>
                ) : (
                  <>
                    Asentá ingresos por transferencia no contemplados en extractos automáticos adjuntando el comprobante de respaldo. Quedará auditado bajo{' '}
                    <strong>&quot;Carga Manual&quot;</strong> en estado pendiente de conciliación.
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelCargaActiva('ninguno')}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Cerrar carga manual"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-700 font-medium">
              {panelCargaActiva === 'qr' ? 'Cuenta / billetera de acreditación *' : 'Cuenta de recepción activa *'}
              <select
                aria-label={panelCargaActiva === 'qr' ? 'Cuenta o billetera de acreditación' : 'Cuenta de recepción activa'}
                aria-invalid={camposInvalidosManual.has('cuentaId')}
                value={cuentaManualId}
                onChange={(e) => {
                  setCuentaManualId(e.target.value);
                  limpiarCampoInvalido('cuentaId');
                }}
                className={`mt-1 w-full rounded border bg-white px-2.5 py-1.5 text-xs text-slate-800 ${
                  camposInvalidosManual.has('cuentaId') ? 'border-red-500 ring-1 ring-red-500 bg-red-50/40' : 'border-slate-300'
                }`}
              >
                <option value="">Seleccionar cuenta activa...</option>
                {cuentasRecepcion.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.alias} ({c.banco || 'Banco'} · {c.moneda || 'ARS'} · {c.sucursal})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-700 font-medium">
              Fecha contable (no futura) *
              <input
                type="date"
                max={fechaLocal()}
                aria-label="Fecha contable"
                aria-invalid={camposInvalidosManual.has('fechaContable')}
                value={fechaManual}
                onChange={(e) => {
                  setFechaManual(e.target.value);
                  limpiarCampoInvalido('fechaContable');
                }}
                className={`mt-1 w-full rounded border bg-white px-2.5 py-1.5 text-xs text-slate-800 ${
                  camposInvalidosManual.has('fechaContable') ? 'border-red-500 ring-1 ring-red-500 bg-red-50/40' : 'border-slate-300'
                }`}
              />
            </label>

            <label className="text-xs text-slate-700 font-medium">
              Importe positivo ($) *
              <input
                type="text"
                inputMode="decimal"
                placeholder="Ej: 150000.00"
                aria-label="Importe del movimiento"
                aria-invalid={camposInvalidosManual.has('importe')}
                value={importeManual}
                onChange={(e) => {
                  setImporteManual(e.target.value);
                  limpiarCampoInvalido('importe');
                }}
                className={`mt-1 w-full rounded border bg-white px-2.5 py-1.5 text-xs text-slate-800 ${
                  camposInvalidosManual.has('importe') ? 'border-red-500 ring-1 ring-red-500 bg-red-50/40' : 'border-slate-300'
                }`}
              />
            </label>

            <label className="text-xs text-slate-700 font-medium">
              {panelCargaActiva === 'qr' ? 'ID de transacción (pasarela QR) *' : 'N° de operación / referencia *'}
              <input
                type="text"
                placeholder={panelCargaActiva === 'qr' ? 'Ej: MP-QR-99887766' : 'Ej: OP-2026-00451'}
                aria-label={panelCargaActiva === 'qr' ? 'ID de transacción QR' : 'Número de operación bancaria'}
                aria-invalid={camposInvalidosManual.has('idTransaccion') || camposInvalidosManual.has('numeroOperacion')}
                value={referenciaManual}
                onChange={(e) => {
                  setReferenciaManual(e.target.value);
                  limpiarCampoInvalido('idTransaccion');
                  limpiarCampoInvalido('numeroOperacion');
                }}
                className={`mt-1 w-full rounded border bg-white px-2.5 py-1.5 text-xs text-slate-800 ${
                  camposInvalidosManual.has('idTransaccion') || camposInvalidosManual.has('numeroOperacion')
                    ? 'border-red-500 ring-1 ring-red-500 bg-red-50/40'
                    : 'border-slate-300'
                }`}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative text-xs text-slate-700 font-medium">
              <label className="block">
                Comercio / ordenante (para matching)
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="Hacé clic o escribí para buscar comercio..."
                  aria-label="Comercio u ordenante"
                  aria-expanded={mostrarSugerenciasComercio}
                  aria-autocomplete="list"
                  value={ordenanteManual}
                  onFocus={() => {
                    setMostrarSugerenciasComercio(true);
                    setIndiceComercioActivo(0);
                  }}
                  onClick={() => {
                    setMostrarSugerenciasComercio(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setMostrarSugerenciasComercio(false), 150);
                  }}
                  onChange={(e) => {
                    setOrdenanteManual(e.target.value);
                    setMostrarSugerenciasComercio(true);
                    setIndiceComercioActivo(0);
                  }}
                  onKeyDown={(e) => {
                    if (!mostrarSugerenciasComercio || comerciosFiltradosAutocomplete.length === 0) return;

                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setIndiceComercioActivo((prev) => (prev + 1) % comerciosFiltradosAutocomplete.length);
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setIndiceComercioActivo((prev) => (prev - 1 + comerciosFiltradosAutocomplete.length) % comerciosFiltradosAutocomplete.length);
                    } else if (e.key === 'Enter') {
                      const elegido = comerciosFiltradosAutocomplete[indiceComercioActivo] || comerciosFiltradosAutocomplete[0];
                      if (elegido) {
                        e.preventDefault();
                        seleccionarComercioAutocomplete(elegido);
                      }
                    } else if (e.key === 'Tab') {
                      // Si escribió algo y quedó una coincidencia (o eligió con flechas), autocompleta con el nombre exacto al apretar Tab
                      if (comerciosFiltradosAutocomplete.length === 1) {
                        seleccionarComercioAutocomplete(comerciosFiltradosAutocomplete[0]);
                      } else if (ordenanteManual.trim().length > 0 && comerciosFiltradosAutocomplete[indiceComercioActivo]) {
                        seleccionarComercioAutocomplete(comerciosFiltradosAutocomplete[indiceComercioActivo]);
                      } else {
                        setMostrarSugerenciasComercio(false);
                      }
                    } else if (e.key === 'Escape') {
                      setMostrarSugerenciasComercio(false);
                    }
                  }}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                />
              </label>

              {mostrarSugerenciasComercio && comerciosFiltradosAutocomplete.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Sugerencias de comercios"
                  className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg divide-y divide-slate-100"
                >
                  {comerciosFiltradosAutocomplete.map((opcion, idx) => {
                    const activo = idx === indiceComercioActivo;
                    return (
                      <li
                        key={opcion.id}
                        role="option"
                        aria-selected={activo}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          seleccionarComercioAutocomplete(opcion);
                        }}
                        onMouseEnter={() => setIndiceComercioActivo(idx)}
                        className={`flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors ${
                          activo ? 'bg-indigo-50 text-indigo-900 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate">{opcion.razon_social}</span>
                        {opcion.cuit && (
                          <span className="shrink-0 text-[10px] font-normal text-slate-400">CUIT {opcion.cuit}</span>
                        )}
                      </li>
                    );
                  })}
                  {opcionesComercioDisponibles.length > 8 && !ordenanteManual.trim() && (
                    <li className="px-2.5 py-1 text-[10px] text-slate-400 bg-slate-50/70 italic">
                      Mostrando primeros 8 de {opcionesComercioDisponibles.length} comercios. Escribí para filtrar o apretá Tab para autocompletar…
                    </li>
                  )}
                </ul>
              )}
            </div>

            <label className="text-xs text-slate-700 font-medium">
              CUIT ordenante (11 dígitos, opcional)
              <input
                type="text"
                maxLength={11}
                placeholder="Ej: 30111222334"
                aria-label="CUIT del ordenante"
                aria-invalid={camposInvalidosManual.has('ordenanteCuit')}
                value={cuitManual}
                onChange={(e) => {
                  setCuitManual(e.target.value.replace(/\D/g, ''));
                  limpiarCampoInvalido('ordenanteCuit');
                }}
                className={`mt-1 w-full rounded border bg-white px-2.5 py-1.5 text-xs text-slate-800 ${
                  camposInvalidosManual.has('ordenanteCuit') ? 'border-red-500 ring-1 ring-red-500 bg-red-50/40' : 'border-slate-300'
                }`}
              />
            </label>

            {panelCargaActiva === 'transferencia' ? (
              <label className="text-xs text-slate-700 font-medium">
                Comprobante de respaldo (PDF/JPG/PNG) *
                <input
                  type="file"
                  aria-label="Comprobante de respaldo"
                  aria-invalid={camposInvalidosManual.has('comprobante')}
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => {
                    setComprobanteManual(e.target.files?.[0] || null);
                    limpiarCampoInvalido('comprobante');
                  }}
                  className={`mt-1 block w-full rounded border bg-white px-2 py-1 text-xs text-slate-700 ${
                    camposInvalidosManual.has('comprobante') ? 'border-red-500 ring-1 ring-red-500 bg-red-50/40' : 'border-slate-300'
                  }`}
                />
              </label>
            ) : (
              <label className="text-xs text-slate-700 font-medium">
                Concepto / observación (opcional)
                <input
                  type="text"
                  placeholder="Ej: Acreditación QR Mercado Pago"
                  aria-label="Concepto del cobro QR"
                  value={conceptoManual}
                  onChange={(e) => setConceptoManual(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                />
              </label>
            )}
          </div>

          {errorManual && (
            <div role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <span>{errorManual}</span>
            </div>
          )}

          {exitoManual && (
            <div role="status" className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <span>{exitoManual}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={guardandoManual}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold text-white shadow-sm disabled:opacity-50 ${
                panelCargaActiva === 'qr' ? 'bg-purple-700 hover:bg-purple-800' : 'bg-indigo-700 hover:bg-indigo-800'
              }`}
            >
              {panelCargaActiva === 'qr' ? <QrCode className="h-3.5 w-3.5" /> : <Landmark className="h-3.5 w-3.5" />}
              <span>
                {guardandoManual
                  ? 'Guardando movimiento…'
                  : panelCargaActiva === 'qr'
                    ? 'Registrar cobro QR manual'
                    : 'Registrar transferencia manual'}
              </span>
            </button>
          </div>
        </form>
      )}

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
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-semibold text-slate-800">{item.ordenante || 'Ordenante no informado'}</span>
                      {item.origen && item.origen !== 'Extracto Bancario' && (
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            item.origen === 'QR - Carga Manual'
                              ? 'bg-purple-100 text-purple-800 border border-purple-200'
                              : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                          }`}
                        >
                          {item.origen}
                        </span>
                      )}
                    </span>
                    <span className="block text-slate-500">
                      {new Date(item.fecha_hora).toLocaleString('es-AR')} · {item.cuenta}
                      {item.referencia_externa ? ` · Ref: ${item.referencia_externa}` : ''}
                    </span>
                    {item.comprobante_nombre && (
                      <button
                        type="button"
                        onClick={(e) => void verComprobanteMovimiento(item, e)}
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 hover:underline"
                      >
                        <FileText className="h-3 w-3" />
                        <span>Ver comprobante ({item.comprobante_nombre})</span>
                      </button>
                    )}
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
        <div className={`rounded border p-3 space-y-3 ${diferencia <= 0n ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div>{movimientosSeleccionados.size} movimiento(s): <strong>{formatoARS(importe)}</strong></div>
            <div>{remitosSeleccionados.size} saldo(s) seleccionado(s): <strong>{formatoARS(suma)}</strong></div>
            <div>{diferencia > 0n ? 'Sobrante sin imputar: ' : diferencia < 0n ? 'Saldo que queda pendiente: ' : 'Diferencia: '}<strong>{diferencia > 0n ? formatoARS(diferencia) : diferencia < 0n ? formatoARS(-diferencia) : 'Exacta'}</strong></div>
          </div>
          {diferencia !== 0n && (
            <label className="block text-xs text-slate-700">
              Justificación de diferencia
              <select required value={motivo} onChange={(event) => setMotivo(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="">Seleccionar motivo</option><option value="retenciones_impositivas">Retenciones impositivas</option><option value="descuento_comercial">Descuento comercial</option><option value="diferencia_cambio">Diferencia de cambio</option><option value="comision_bancaria">Comisión bancaria</option><option value="otro">Otro</option></select>
              <textarea value={nota} onChange={(event) => setNota(event.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded border border-slate-300 p-2" placeholder="Explicá la diferencia encontrada" />
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setComprobante(event.target.files?.[0] || null)} className="mt-2 block w-full" />
            </label>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={() => void ejecutar()} disabled={cargando || (diferencia !== 0n && (!nota.trim() || !motivo || !comprobante))} className="rounded-md bg-marca-naranja hover:bg-marca-naranja-hover px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50">
              {cargando ? 'Procesando…' : diferencia !== 0n ? 'Enviar justificación' : 'Conciliar selección'}
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 pt-3 space-y-2">
        {notificaciones.map((item) => <p key={item.id} role="status" className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">{item.mensaje}</p>)}
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Bandeja de discrepancias ({discrepancias.length})</h3>
        {discrepancias.length === 0 ? <p className="text-xs text-slate-500">Sin casos pendientes.</p> : discrepancias.map((item) => (
          <div key={item.id} className="rounded border border-amber-200 bg-amber-50 p-2.5 text-xs space-y-2">
            <div className="flex flex-wrap justify-between gap-2"><span>Movimientos #{item.movimiento_ids.replace(/[{}]/g, '').replace(/,/g, ', #')} · {item.ordenante || 'Ordenante sin informar'} · Remitos: {item.remito_ids.replace(/[{}]/g, '')}<br />{item.motivo_codigo}: {item.nota} · Estado: {item.estado}</span><strong>{item.diferencia_centavos.startsWith('-') ? 'Faltante ' : 'Sobrante '}{formatoARS(item.diferencia_centavos.startsWith('-') ? item.diferencia_centavos.slice(1) : item.diferencia_centavos)}</strong></div>
            <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void verComprobante(item)} className="text-blue-700 underline">Descargar {item.comprobante_nombre || 'comprobante'}</button><input aria-label="Observación de revisión" value={observacionResolucion} onChange={(event) => setObservacionResolucion(event.target.value)} maxLength={500} placeholder="Observación (obligatoria al rechazar)" className="min-w-48 flex-1 rounded border border-slate-300 px-2 py-1" /><button type="button" disabled={cargando || item.creada_por === session.id.replace(/^usr_/, '')} onClick={() => void resolver(item, 'aprobar')} className="rounded bg-emerald-700 px-2 py-1 font-semibold text-white disabled:opacity-50">Aprobar</button><button type="button" disabled={cargando || !observacionResolucion.trim()} onClick={() => void resolver(item, 'rechazar')} className="rounded bg-red-700 px-2 py-1 font-semibold text-white disabled:opacity-50">Rechazar</button></div>
          </div>
        ))}
      </div>
    </section>
  );
};
