import React, { useEffect, useState } from 'react';
import { Check, Edit2, Plus, X } from 'lucide-react';
import { UserSession } from '../../types/auth';

import { API_ROOT as API } from '../../config/api';
type Sucursal = { id: number; nombre: string; domicilio: string | null; activa: boolean };
type Draft = { id?: number; nombre: string; domicilio: string };

export const GestionSucursales: React.FC<{ session: UserSession }> = ({ session }) => {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

  const load = async () => {
    const response = await fetch(`${API}/api/configuracion/sucursales`, { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudieron cargar las sucursales.');
    setSucursales(data);
  };

  useEffect(() => { load().catch((e) => setError(e.message)); }, [session.token]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/configuracion/sucursales${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PUT' : 'POST', headers, body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la sucursal.');
      setDraft(null); await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const toggle = async (sucursal: Sucursal) => {
    setError('');
    try {
      const response = await fetch(`${API}/api/configuracion/sucursales/${sucursal.id}/estado`, {
        method: 'PATCH', headers, body: JSON.stringify({ activa: !sucursal.activa }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo cambiar el estado.');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Sucursales</h2><p className="mt-1 text-sm text-slate-500">Administrá las sedes y sus domicilios.</p></div>
      <button type="button" onClick={() => { setError(''); setDraft({ nombre: '', domicilio: '' }); }} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800"><Plus className="h-4 w-4" />Nueva sucursal</button>
    </div>
    {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
    {draft && <form onSubmit={save} className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm text-slate-700">Nombre<input required value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm text-slate-700">Domicilio<input value={draft.domicilio} onChange={(e) => setDraft({ ...draft, domicilio: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <div className="flex gap-2 sm:col-span-2"><button disabled={busy} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"><Check className="h-4 w-4" />Guardar</button><button type="button" onClick={() => setDraft(null)} className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm"><X className="h-4 w-4" />Cancelar</button></div>
    </form>}
    <div className="overflow-x-auto rounded border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Sucursal</th><th className="px-4 py-3">Domicilio</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">
      {sucursales.map((sucursal) => <tr key={sucursal.id}><td className="px-4 py-3 font-medium text-slate-900">{sucursal.nombre}</td><td className="px-4 py-3 text-slate-600">{sucursal.domicilio || '—'}</td><td className="px-4 py-3"><span className={sucursal.activa ? 'text-emerald-700' : 'text-slate-400'}>{sucursal.activa ? 'Activa' : 'Inactiva'}</span></td><td className="px-4 py-3"><div className="flex gap-3"><button type="button" onClick={() => setDraft({ id: sucursal.id, nombre: sucursal.nombre, domicilio: sucursal.domicilio || '' })} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Edit2 className="h-3.5 w-3.5" />Editar</button><button type="button" onClick={() => toggle(sucursal)} className="text-slate-600 hover:underline">{sucursal.activa ? 'Desactivar' : 'Activar'}</button></div></td></tr>)}
      {!sucursales.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No hay sucursales para mostrar.</td></tr>}
    </tbody></table></div>
  </section>;
};
