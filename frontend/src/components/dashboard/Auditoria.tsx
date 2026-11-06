import React, { useCallback, useEffect, useState } from 'react';
import { API_ROOT } from '../../config/api';
import { UserSession } from '../../types/auth';

type Datos = Record<string, any> | null;
type Registro = { id: string; ocurrido_en: string; accion: string; entidad: string; entidad_id: string; nombre: string; email: string | null; observacion: string | null; valores_antes: Datos; valores_despues: Datos; cuenta_alias: string | null; hoja_id: string | null; declarado_actual: string | null; rendido_actual: string | null; movimiento_actual: string | null; seleccionado_actual: string | null };
type Filtros = { email: string; accion: string; cuenta: string; desde: string; hasta: string };
const vacios: Filtros = { email: '', accion: '', cuenta: '', desde: '', hasta: '' };
const acciones: Record<string, string> = { importacion_extracto: 'Importación de extracto', validacion: 'Validación', aprobada: 'Validación aprobada', anulacion: 'Anulación', reasignacion: 'Reasignación', alta: 'Alta', modificacion: 'Modificación', conciliacion: 'Conciliación', rechazada: 'Rechazo' };
const entidades: Record<string, string> = { cuenta_recepcion: 'Cuenta receptora', rendicion_efectivo: 'Rendición', discrepancia_conciliacion: 'Discrepancia de conciliación', hoja_de_ruta: 'Hoja de ruta', movimiento_bancario: 'Movimiento bancario', imputacion: 'Imputación', cobro: 'Cobro' };
const pesos = (valor: unknown) => valor === null || valor === undefined ? 'No disponible' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(valor) / 100);
const mostrar = (valor: unknown) => valor === null || valor === undefined || valor === '' ? 'No disponible' : String(valor);

function Detalle({ registro: r }: { registro: Registro }) {
  const d = r.valores_despues || {};
  const anterior = r.valores_antes || {};
  const esImportacion = r.accion === 'importacion_extracto';
  const esRendicion = r.entidad === 'rendicion_efectivo' && r.accion === 'validacion';
  const esConciliacion = r.entidad === 'discrepancia_conciliacion' && r.accion === 'aprobada';
  const anteriorComoRespaldo = (esRendicion && (d.declaradoCentavos == null || d.rendidoCentavos == null)) || (esConciliacion && (d.importeMovimiento == null || d.importeSeleccionado == null));
  return <details><summary className="cursor-pointer text-blue-700">Ver detalle</summary><dl className="mt-2 space-y-1 text-xs text-slate-700">
    {esImportacion && <><div><dt className="inline font-semibold">Archivo: </dt><dd className="inline">{mostrar(d.archivo)}</dd></div><div><dt className="inline font-semibold">Cuenta: </dt><dd className="inline">{r.cuenta_alias || `#${r.entidad_id}`}</dd></div><div><dt className="inline font-semibold">Nuevas: </dt><dd className="inline">{mostrar(d.insertados)}</dd></div><div><dt className="inline font-semibold">Duplicados omitidos: </dt><dd className="inline">{mostrar(d.omitidosDuplicados)}</dd></div></>}
    {esRendicion && <><div>Hoja de ruta: {mostrar(d.hojaDeRutaId ?? r.hoja_id)}</div><div>Declarado: {pesos(d.declaradoCentavos ?? r.declarado_actual)}</div><div>Rendido: {pesos(d.rendidoCentavos ?? r.rendido_actual)}</div></>}
    {esConciliacion && <><div>Movimiento: {pesos(d.importeMovimiento ?? r.movimiento_actual)}</div><div>Seleccionado: {pesos(d.importeSeleccionado ?? r.seleccionado_actual)}</div><div>Comprobantes: {Array.isArray(d.remitoIds) ? d.remitoIds.join(', ') : 'No disponible'}</div></>}
    {anteriorComoRespaldo && <div className="text-slate-500">Los montos faltantes en el registro se muestran desde la entidad actual, si están disponibles.</div>}
    {r.accion === 'reasignacion' && <><div>Hoja anterior: {mostrar(anterior.hoja_de_ruta_id ?? r.entidad_id)}</div><div>Hoja nueva: {mostrar(d.hoja_de_ruta_id ?? r.entidad_id)}</div><div>Transportista anterior: {mostrar(anterior.transportista_id)}</div><div>Transportista nuevo: {mostrar(d.transportista_id)}</div></>}
    <div><dt className="inline font-semibold">Observación o justificación: </dt><dd className="inline">{r.observacion || 'No registrada'}</dd></div>
  </dl></details>;
}

export const Auditoria: React.FC<{ session: UserSession }> = ({ session }) => {
  const [filtros, setFiltros] = useState<Filtros>(vacios);
  const [aplicados, setAplicados] = useState<Filtros>(vacios);
  const [pagina, setPagina] = useState(1);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [cuentas, setCuentas] = useState<{ id: string; alias: string }[]>([]);
  const [error, setError] = useState('');
  const [errorCuentas, setErrorCuentas] = useState('');
  const [cargando, setCargando] = useState(false);
  const [consultado, setConsultado] = useState(false);
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const cargar = useCallback(async (valores: Filtros, page: number, signal?: AbortSignal) => {
    setError(''); setCargando(true);
    try {
      const params = new URLSearchParams({ ...valores, email: valores.email.trim(), pagina: String(page) });
      const response = await fetch(`${API_ROOT}/api/auditoria?${params}`, { headers: { Authorization: `Bearer ${session.token}` }, signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo consultar la auditoría.');
      setRegistros(data.registros); setHayMas(data.hayMas); setConsultado(true);
    } catch (e) { if (!signal?.aborted) { setRegistros([]); setConsultado(false); setError(e instanceof Error ? e.message : 'No se pudo consultar la auditoría.'); } }
    finally { if (!signal?.aborted) setCargando(false); }
  }, [session.token]);
  useEffect(() => {
    const controller = new AbortController();
    cargar(aplicados, pagina, controller.signal);
    return () => controller.abort();
  }, [aplicados, pagina, cargar]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_ROOT}/api/auditoria/cuentas`, { headers: { Authorization: `Bearer ${session.token}` }, signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => setCuentas(data.cuentas))
      .catch(() => { if (!controller.signal.aborted) setErrorCuentas('No se pudieron cargar las cuentas para filtrar.'); });
    return () => controller.abort();
  }, [session.token]);
  const cambiar = (campo: keyof Filtros, valor: string) => setFiltros(f => ({ ...f, [campo]: valor }));
  const buscar = (event: React.FormEvent) => {
    event.preventDefault();
    if ((filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) || filtros.desde > hoy || filtros.hasta > hoy) { setError('El rango de fechas es inválido: revisá el orden y evitá fechas futuras.'); return; }
    setPagina(1); setAplicados({ ...filtros });
  };
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <form onSubmit={buscar} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2"><label className="text-sm font-medium text-slate-700">Correo del usuario<input type="email" value={filtros.email} onChange={e => cambiar('email', e.target.value)} placeholder="nombre@ejemplo.com" className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Acción<select value={filtros.accion} onChange={e => cambiar('accion', e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"><option value="">Todas las acciones</option><option value="importacion_extracto">Importaciones</option><option value="validacion">Validaciones aprobadas</option><option value="anulacion">Anulaciones</option><option value="reasignacion">Reasignaciones</option></select></label></div>
      <details><summary className="cursor-pointer text-sm font-medium text-blue-700">Más filtros</summary><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-sm">Desde<input type="date" max={hoy} value={filtros.desde} onChange={e => cambiar('desde', e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm">Hasta<input type="date" max={hoy} value={filtros.hasta} onChange={e => cambiar('hasta', e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm">Cuenta receptora (importaciones)<select value={filtros.cuenta} onChange={e => cambiar('cuenta', e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"><option value="">Todas las cuentas</option>{cuentas.map(c => <option key={c.id} value={c.id}>{c.alias} (#{c.id})</option>)}</select></label></div>{errorCuentas && <p role="alert" className="mt-2 text-sm text-red-700">{errorCuentas}</p>}</details>
      <div className="flex gap-3"><button type="submit" disabled={cargando} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{cargando ? 'Buscando…' : 'Buscar'}</button><button type="button" onClick={() => { setFiltros(vacios); setPagina(1); setAplicados({ ...vacios }); }} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Limpiar filtros</button></div>
    </form>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {consultado && !cargando && registros.length === 0 && <p role="status" className="mt-4 text-sm text-slate-600">{aplicados.email ? 'El usuario no arrojó actividad para los criterios seleccionados.' : aplicados.accion === 'importacion_extracto' || aplicados.cuenta ? 'No se registran importaciones para los criterios seleccionados.' : 'No se registra actividad para los criterios seleccionados.'}</p>}
    {registros.length > 0 && <><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-2">Fecha y hora</th><th className="p-2">Usuario</th><th className="p-2">Acción</th><th className="p-2">Entidad</th><th className="p-2">Detalle</th></tr></thead><tbody>{registros.map(r => <tr key={r.id} className="border-b align-top"><td className="p-2 whitespace-nowrap">{new Date(r.ocurrido_en).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td><td className="p-2">{r.nombre}<br /><span className="text-slate-500">{r.email || 'Sin correo'}</span></td><td className="p-2">{acciones[r.accion] || r.accion}</td><td className="p-2">{entidades[r.entidad] || r.entidad} #{r.entidad_id}</td><td className="p-2"><Detalle registro={r} /></td></tr>)}</tbody></table></div><div className="mt-4 flex items-center gap-3 text-sm"><button type="button" disabled={pagina === 1 || cargando} onClick={() => setPagina(p => p - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Anterior</button><span>Página {pagina}</span><button type="button" disabled={!hayMas || cargando} onClick={() => setPagina(p => p + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Siguiente</button></div></>}
  </section>;
};
