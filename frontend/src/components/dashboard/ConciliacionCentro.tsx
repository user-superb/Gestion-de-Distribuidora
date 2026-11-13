import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, GitCompareArrows, ClockAlert, RefreshCw, History, Download, Search, CheckCircle2 } from 'lucide-react';
import { UserSession } from '../../types/auth';
import { API_BASE } from '../../config/api';
import { ConciliadorMovimientos } from './ConciliadorMovimientos';

interface Sugerencia {
  tipo: 'exacta' | 'parcial';
  motivo: string;
  diferencia_centavos: string;
  movimiento_id: string;
  fecha_hora: string;
  ordenante: string | null;
  importe_disponible_centavos: string;
  cuenta: string;
  remito_id: string;
  numero: string;
  razon_social: string;
  saldo_centavos: string;
}

interface MovimientoHuerfano {
  id: string;
  fecha_hora: string;
  ordenante: string | null;
  importe_centavos: string;
  cuenta_id: string;
  cuenta: string;
  sucursal_id: string;
  sucursal: string;
  antiguedad_horas: number;
}

interface ImputacionHistorial {
  id: string;
  remitoId: string;
  remitoNumero: string;
  comercio: string;
  comercioCuit: string;
  importeCentavos: string;
  imputadoEn: string;
  imputadoPor: string;
}

interface MovimientoConciliado {
  id: string;
  fecha_hora: string;
  ordenante: string | null;
  ordenante_cuit: string | null;
  concepto: string | null;
  referencia_externa: string | null;
  origen: string;
  importe_centavos: string;
  estado: string;
  cuenta_id: string;
  cuenta: string;
  sucursal_id: string;
  sucursal: string;
  comprobante_nombre: string | null;
  imputado_en: string;
  imputaciones: ImputacionHistorial[];
}

type Vista = 'conciliar' | 'sugerencias' | 'huerfanos' | 'historial';

function formatoARS(centavos: string): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(centavos) / 100);
}

function fechaLocal(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mensajeError(data: any, fallback: string): string {
  return typeof data?.message === 'string' ? data.message : fallback;
}

export const ConciliacionCentro: React.FC<{ session: UserSession }> = ({ session }) => {
  const [vista, setVista] = useState<Vista>('conciliar');
  const [seleccionInicial, setSeleccionInicial] = useState<{ movimientoId: string; remitoId: string; fecha: string } | null>(null);
  const [infoPaso, setInfoPaso] = useState<{ paso: number; total: number; titulo: string }>({
    paso: 1,
    total: 3,
    titulo: 'Seleccionar movimientos',
  });

  const handleStepChange = useCallback((paso: number, total: number, titulo: string) => {
    setInfoPaso({ paso, total, titulo });
  }, []);

  return (
    <section className="space-y-6 mt-2">
      {/* Selector de subvista homólogo a Hojas de Ruta */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div
          role="tablist"
          aria-label="Vistas de conciliación"
          className="inline-flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200 text-xs sm:text-sm"
        >
          <button
            role="tab"
            aria-selected={vista === 'conciliar'}
            type="button"
            onClick={() => setVista('conciliar')}
            className={`px-3 py-1.5 font-bold rounded-md transition-all flex items-center gap-2 cursor-pointer ${
              vista === 'conciliar'
                ? 'bg-white text-marca-azul shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Landmark className="w-4 h-4 text-blue-600" />
            <span>Conciliar</span>
          </button>

          <button
            role="tab"
            aria-selected={vista === 'sugerencias'}
            type="button"
            onClick={() => setVista('sugerencias')}
            className={`px-3 py-1.5 font-bold rounded-md transition-all flex items-center gap-2 cursor-pointer ${
              vista === 'sugerencias'
                ? 'bg-white text-marca-azul shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GitCompareArrows className="w-4 h-4 text-emerald-600" />
            <span>Sugerencias de imputación</span>
          </button>

          <button
            role="tab"
            aria-selected={vista === 'huerfanos'}
            type="button"
            onClick={() => setVista('huerfanos')}
            className={`px-3 py-1.5 font-bold rounded-md transition-all flex items-center gap-2 cursor-pointer ${
              vista === 'huerfanos'
                ? 'bg-white text-marca-azul shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClockAlert className="w-4 h-4 text-amber-600" />
            <span>Movimientos huérfanos</span>
          </button>

          <button
            role="tab"
            aria-selected={vista === 'historial'}
            type="button"
            onClick={() => setVista('historial')}
            className={`px-3 py-1.5 font-bold rounded-md transition-all flex items-center gap-2 cursor-pointer ${
              vista === 'historial'
                ? 'bg-white text-marca-azul shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4 text-purple-600" />
            <span>Historial de conciliaciones</span>
          </button>
        </div>

        {vista === 'conciliar' ? (
          <span className="text-xs text-slate-500">
            Paso {infoPaso.paso} de {infoPaso.total}: {infoPaso.titulo}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setVista('conciliar')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-marca-naranja hover:bg-marca-naranja-hover text-white rounded-md transition-colors shadow-xs cursor-pointer self-start sm:self-auto"
          >
            <Landmark className="w-3.5 h-3.5" />
            <span>Ir a conciliar movimientos</span>
          </button>
        )}
      </div>

      {vista === 'conciliar' && (
        <ConciliadorMovimientos
          key={seleccionInicial ? `${seleccionInicial.movimientoId}-${seleccionInicial.remitoId}` : 'manual'}
          session={session}
          initialSelection={seleccionInicial}
          onStepChange={handleStepChange}
        />
      )}
      {vista === 'sugerencias' && (
        <SugerenciasImputacion
          session={session}
          onReview={(suggestion) => {
            setSeleccionInicial({
              movimientoId: suggestion.movimiento_id,
              remitoId: suggestion.remito_id,
              fecha: fechaLocal(suggestion.fecha_hora),
            });
            setVista('conciliar');
          }}
        />
      )}
      {vista === 'huerfanos' && <BandejaMovimientosHuerfanos session={session} />}
      {vista === 'historial' && <HistorialConciliaciones session={session} />}
    </section>
  );
};

const SugerenciasImputacion: React.FC<{
  session: UserSession;
  onReview: (suggestion: Sugerencia) => void;
}> = ({ session, onReview }) => {
  const [items, setItems] = useState<Sugerencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accepting, setAccepting] = useState('');
  const headers = useMemo(() => ({ Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }), [session.token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/conciliacion/sugerencias`, { headers });
      const data = await response.json();
      if (!response.ok) throw new Error(mensajeError(data, 'No se pudieron cargar las sugerencias.'));
      setItems(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las sugerencias.');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const accept = async (item: Sugerencia) => {
    setAccepting(item.movimiento_id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API_BASE}/conciliacion/sugerencias/aceptar`, {
        method: 'POST', headers,
        body: JSON.stringify({ movimientoId: item.movimiento_id, remitoId: item.remito_id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(mensajeError(data, 'La sugerencia ya no se puede aceptar.'));
      setNotice(`Imputación realizada: ${item.numero} quedó saldado.`);
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'La sugerencia ya no se puede aceptar.';
      await load();
      setError(message);
    } finally {
      setAccepting('');
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <h2 className="text-base font-bold text-slate-900">Sugerencias automáticas</h2>
            <p className="text-xs text-slate-500">Coincidencias por cliente, importe y fecha cercana (hasta 7 días).</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </header>
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}
      {loading ? <p className="py-6 text-center text-xs text-slate-500">Buscando coincidencias…</p> : items.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Sin coincidencias automáticas detectadas. Podés continuar con la búsqueda manual.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded border border-slate-200">
          {items.map((item) => (
            <article key={`${item.movimiento_id}-${item.remito_id}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${item.tipo === 'exacta' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{item.tipo === 'exacta' ? 'Coincidencia exacta' : 'Coincidencia parcial'}</span>
                  <span className="text-xs font-semibold text-slate-800">{item.ordenante || 'Ordenante sin informar'} → {item.numero} · {item.razon_social}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Movimiento {formatoARS(item.importe_disponible_centavos)} · Saldo {formatoARS(item.saldo_centavos)} · {new Date(item.fecha_hora).toLocaleDateString('es-AR')} · {item.cuenta}</p>
                <p className="mt-1 text-xs text-slate-600">{item.motivo}</p>
              </div>
              {item.tipo === 'exacta' ? (
                <button type="button" onClick={() => void accept(item)} disabled={!!accepting} className="rounded-md bg-marca-naranja hover:bg-marca-naranja-hover px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors disabled:opacity-50">{accepting === item.movimiento_id ? 'Aceptando…' : 'Aceptar sugerencia'}</button>
              ) : (
                <button type="button" onClick={() => onReview(item)} className="rounded border border-amber-400 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-50">Revisar manualmente</button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

const BandejaMovimientosHuerfanos: React.FC<{ session: UserSession }> = ({ session }) => {
  const [items, setItems] = useState<MovimientoHuerfano[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [horasUmbral, setHorasUmbral] = useState(48);
  const [sucursal, setSucursal] = useState('');
  const [cuenta, setCuenta] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`${API_BASE}/conciliacion/movimientos-huerfanos`, { headers: { Authorization: `Bearer ${session.token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(mensajeError(data, 'No se pudieron cargar los movimientos huérfanos.'));
        if (active) {
          setItems(data.movimientos || []);
          setHorasUmbral(data.horasUmbral || 48);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los movimientos huérfanos.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [session.token]);

  const sucursales = [...new Map(items.map((item) => [item.sucursal_id, item.sucursal])).entries()];
  const cuentas = [...new Map(items.map((item) => [item.cuenta_id, item.cuenta])).entries()];
  const visibles = items.filter((item) => {
    const dia = new Date(item.fecha_hora).toISOString().slice(0, 10);
    return (!sucursal || item.sucursal_id === sucursal) && (!cuenta || item.cuenta_id === cuenta) && (!desde || dia >= desde) && (!hasta || dia <= hasta);
  });

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <header className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <ClockAlert className="w-5 h-5 text-amber-600 shrink-0" />
        <div>
          <h2 className="text-base font-bold text-slate-900">Bandeja de movimientos huérfanos</h2>
          <p className="text-xs text-slate-500">Ingresos pendientes de imputación, sin sugerencias vigentes y con más de {horasUmbral} horas desde su acreditación.</p>
        </div>
      </header>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 bg-slate-50 p-2.5 rounded-md border border-slate-200/80">
        <label className="text-xs text-slate-600">Sucursal<select value={sucursal} onChange={(event) => setSucursal(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5"><option value="">Todas</option>{sucursales.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-slate-600">Cuenta<select value={cuenta} onChange={(event) => setCuenta(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5"><option value="">Todas</option>{cuentas.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-slate-600">Desde<input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5" /></label>
        <label className="text-xs text-slate-600">Hasta<input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5" /></label>
      </div>
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
      {loading ? <p className="py-6 text-center text-xs text-slate-500">Cargando movimientos…</p> : visibles.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Sin movimientos huérfanos que coincidan con los filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Ordenante</th><th className="px-3 py-2">Sucursal / cuenta</th><th className="px-3 py-2 text-right">Importe disponible</th><th className="px-3 py-2 text-right">Antigüedad</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{visibles.map((item) => <tr key={item.id}><td className="px-3 py-2 text-slate-600">{new Date(item.fecha_hora).toLocaleString('es-AR')}</td><td className="px-3 py-2 font-medium text-slate-800">{item.ordenante || 'Ordenante no informado'}</td><td className="px-3 py-2 text-slate-600">{item.sucursal} · {item.cuenta}</td><td className="px-3 py-2 text-right font-semibold text-slate-900">{formatoARS(item.importe_centavos)}</td><td className="px-3 py-2 text-right text-amber-800">{item.antiguedad_horas} h</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
};

const HistorialConciliaciones: React.FC<{ session: UserSession }> = ({ session }) => {
  const [items, setItems] = useState<MovimientoConciliado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [cuenta, setCuenta] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [descargandoId, setDescargandoId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (sucursal) params.set('sucursalId', sucursal);
      if (cuenta && cuenta !== 'todas') params.set('cuentaId', cuenta);
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      if (busqueda.trim()) params.set('busqueda', busqueda.trim());

      const url = `${API_BASE}/conciliacion/historial?${params.toString()}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(mensajeError(data, 'No se pudo cargar el historial de conciliaciones.'));
      setItems(Array.isArray(data) ? data : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el historial de conciliaciones.');
    } finally {
      setLoading(false);
    }
  }, [session.token, sucursal, cuenta, desde, hasta, busqueda]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const descargarComprobante = async (mov: MovimientoConciliado) => {
    setDescargandoId(mov.id);
    try {
      const response = await fetch(`${API_BASE}/conciliacion/movimientos/${mov.id}/comprobante`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) throw new Error('No se pudo descargar el comprobante.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = mov.comprobante_nombre || `comprobante-mov-${mov.id}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      alert(err.message || 'Error al descargar comprobante.');
    } finally {
      setDescargandoId(null);
    }
  };

  const sucursales = useMemo(
    () => [...new Map(items.map((item) => [item.sucursal_id, item.sucursal])).entries()],
    [items]
  );
  const cuentas = useMemo(
    () => [...new Map(items.map((item) => [item.cuenta_id, item.cuenta])).entries()],
    [items]
  );

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-purple-600 shrink-0" />
          <div>
            <h2 className="text-base font-bold text-slate-900">Historial de conciliaciones</h2>
            <p className="text-xs text-slate-500">
              Movimientos bancarios imputados y remitos saldados.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50 cursor-pointer shadow-2xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </header>

      {/* Barra de Filtros */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-6 bg-slate-50 p-3 rounded-md border border-slate-200/80 text-xs">
        <div className="lg:col-span-2">
          <label className="text-slate-600 font-medium block mb-1">Buscar</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Comercio, remito, ordenante o referencia..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 placeholder:text-slate-400"
            />
          </div>
        </div>
        <div>
          <label className="text-slate-600 font-medium block mb-1">Sucursal</label>
          <select
            value={sucursal}
            onChange={(e) => setSucursal(e.target.value)}
            className="w-full border border-slate-300 rounded bg-white px-2 py-1.5 text-slate-800"
          >
            <option value="">Todas</option>
            {sucursales.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-slate-600 font-medium block mb-1">Cuenta</label>
          <select
            value={cuenta}
            onChange={(e) => setCuenta(e.target.value)}
            className="w-full border border-slate-300 rounded bg-white px-2 py-1.5 text-slate-800"
          >
            <option value="">Todas</option>
            {cuentas.map(([id, alias]) => (
              <option key={id} value={id}>
                {alias}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-slate-600 font-medium block mb-1">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="w-full border border-slate-300 rounded bg-white px-2 py-1.5 text-slate-800"
          />
        </div>
        <div>
          <label className="text-slate-600 font-medium block mb-1">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="w-full border border-slate-300 rounded bg-white px-2 py-1.5 text-slate-800"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-xs text-slate-500">Cargando historial de conciliaciones…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">No se encontraron movimientos conciliados</p>
          <p className="text-xs text-slate-500 mt-1">
            Los movimientos imputados desde las pestañas "Conciliar" o "Sugerencias" se listarán aquí.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((mov) => {
            const origenEsManual = mov.origen.includes('Manual');
            const origenEsQr = mov.origen.includes('QR');
            const origenEsMovil = mov.origen.includes('Móvil') || mov.origen.includes('Movil');

            return (
              <article
                key={mov.id}
                className="border border-slate-200 rounded-lg p-3.5 sm:p-4 hover:border-slate-300 transition-all bg-white shadow-2xs space-y-3"
              >
                {/* Cabecera del Movimiento */}
                <div className="flex flex-wrap items-start justify-between gap-2.5 pb-2.5 border-b border-slate-100">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Imputado</span>
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          origenEsQr
                            ? 'bg-purple-100 text-purple-800 border border-purple-200'
                            : origenEsMovil
                            ? 'bg-teal-100 text-teal-800 border border-teal-200'
                            : origenEsManual
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {mov.origen}
                      </span>
                      <span className="text-xs font-bold text-slate-800">
                        {mov.ordenante || 'Ordenante no informado'}
                      </span>
                      {mov.ordenante_cuit && (
                        <span className="text-[11px] text-slate-500">CUIT: {mov.ordenante_cuit}</span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      <span>Cuenta: <strong className="text-slate-700">{mov.cuenta}</strong> ({mov.sucursal})</span>
                      {mov.referencia_externa && (
                        <span>Ref / Op: <strong className="font-mono text-slate-700">{mov.referencia_externa}</strong></span>
                      )}
                      <span>Acreditado: {new Date(mov.fecha_hora).toLocaleDateString('es-AR')}</span>
                      <span>Imputado: {new Date(mov.imputado_en).toLocaleString('es-AR')}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-xs text-slate-500">Monto total</span>
                    <strong className="font-mono text-base text-slate-900">
                      {formatoARS(mov.importe_centavos)}
                    </strong>
                    {mov.comprobante_nombre && (
                      <button
                        type="button"
                        onClick={() => void descargarComprobante(mov)}
                        disabled={descargandoId === mov.id}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 hover:underline cursor-pointer"
                        title={mov.comprobante_nombre}
                      >
                        <Download className="w-3 h-3" />
                        <span>{descargandoId === mov.id ? 'Descargando…' : 'Comprobante'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Desglose de Remitos Imputados */}
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                    Remitos saldados ({mov.imputaciones.length}):
                  </span>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {mov.imputaciones.map((imp) => (
                      <div
                        key={imp.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-md bg-slate-50 border border-slate-200/80 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[11px]">
                              {imp.remitoNumero}
                            </span>
                            <span className="font-semibold text-slate-700 truncate" title={imp.comercio}>
                              {imp.comercio}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Por: {imp.imputadoPor}
                          </div>
                        </div>
                        <strong className="font-mono text-xs text-emerald-700 shrink-0">
                          {formatoARS(imp.importeCentavos)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
