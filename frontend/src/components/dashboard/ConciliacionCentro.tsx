import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

type Vista = 'conciliar' | 'sugerencias' | 'huerfanos';

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
  const tabs: Array<{ id: Vista; label: string }> = [
    { id: 'conciliar', label: 'Conciliar' },
    { id: 'sugerencias', label: 'Sugerencias de imputación' },
    { id: 'huerfanos', label: 'Movimientos huérfanos' },
  ];

  return (
    <section className="space-y-4">
      <nav aria-label="Vistas de conciliación" role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((tab) => (
          <button key={tab.id} role="tab" aria-selected={vista === tab.id} type="button" onClick={() => setVista(tab.id)} className={`shrink-0 border-b-2 px-3 py-2 text-sm ${vista === tab.id ? 'border-blue-700 font-semibold text-blue-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {tab.label}
          </button>
        ))}
      </nav>
      {vista === 'conciliar' && <ConciliadorMovimientos key={seleccionInicial ? `${seleccionInicial.movimientoId}-${seleccionInicial.remitoId}` : 'manual'} session={session} initialSelection={seleccionInicial} />}
      {vista === 'sugerencias' && (
        <SugerenciasImputacion
          session={session}
          onReview={(suggestion) => {
            setSeleccionInicial({ movimientoId: suggestion.movimiento_id, remitoId: suggestion.remito_id, fecha: fechaLocal(suggestion.fecha_hora) });
            setVista('conciliar');
          }}
        />
      )}
      {vista === 'huerfanos' && <BandejaMovimientosHuerfanos session={session} />}
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
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-sm font-bold text-slate-900">Sugerencias automáticas</h2><p className="mt-1 text-xs text-slate-500">Coincidencias por cliente, importe y fecha cercana (hasta 7 días).</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50">Actualizar</button>
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
                <button type="button" onClick={() => void accept(item)} disabled={!!accepting} className="rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{accepting === item.movimiento_id ? 'Aceptando…' : 'Aceptar sugerencia'}</button>
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
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <header><h2 className="text-sm font-bold text-slate-900">Bandeja de movimientos huérfanos</h2><p className="mt-1 text-xs text-slate-500">Ingresos pendientes de imputación, sin sugerencias vigentes y con más de {horasUmbral} horas desde su acreditación.</p></header>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-600">Sucursal<select value={sucursal} onChange={(event) => setSucursal(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"><option value="">Todas</option>{sucursales.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-slate-600">Cuenta<select value={cuenta} onChange={(event) => setCuenta(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"><option value="">Todas</option>{cuentas.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-slate-600">Desde<input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" /></label>
        <label className="text-xs text-slate-600">Hasta<input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" /></label>
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
