import React, { useEffect, useState } from 'react';
import { Check, Edit2, Plus, X } from 'lucide-react';
import { UserSession } from '../../types/auth';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
type Marca = { id: number; nombre: string; cuit: string | null; activa: boolean };
type Draft = { id?: number; nombre: string; cuit: string };

export const GestionMarcas: React.FC<{ session: UserSession }> = ({ session }) => {
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

  const load = async () => {
    const response = await fetch(`${API}/api/configuracion/marcas`, { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudieron cargar las marcas.');
    setMarcas(data);
  };

  useEffect(() => { load().catch((e) => setError(e.message)); }, [session.token]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/configuracion/marcas${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PUT' : 'POST', headers, body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la marca.');
      setDraft(null); await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const toggle = async (marca: Marca) => {
    setError('');
    try {
      const response = await fetch(`${API}/api/configuracion/marcas/${marca.id}/estado`, {
        method: 'PATCH', headers, body: JSON.stringify({ activa: !marca.activa }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo cambiar el estado.');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Marcas</h2><p className="mt-1 text-sm text-slate-500">Administrá las marcas y sus datos fiscales.</p></div>
      <button type="button" onClick={() => { setError(''); setDraft({ nombre: '', cuit: '' }); }} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800"><Plus className="h-4 w-4" />Nueva marca</button>
    </div>
    {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
    {draft && <form onSubmit={save} className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm text-slate-700">Nombre<input required value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm text-slate-700">CUIT (opcional)<input inputMode="numeric" maxLength={11} value={draft.cuit} onChange={(e) => setDraft({ ...draft, cuit: e.target.value.replace(/\D/g, '') })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <div className="flex gap-2 sm:col-span-2"><button disabled={busy} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"><Check className="h-4 w-4" />Guardar</button><button type="button" onClick={() => setDraft(null)} className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm"><X className="h-4 w-4" />Cancelar</button></div>
    </form>}
    <div className="overflow-x-auto rounded border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Marca</th><th className="px-4 py-3">CUIT</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">
      {marcas.map((marca) => <tr key={marca.id}><td className="px-4 py-3 font-medium text-slate-900">{marca.nombre}</td><td className="px-4 py-3 text-slate-600">{marca.cuit?.trim() || '—'}</td><td className="px-4 py-3"><span className={marca.activa ? 'text-emerald-700' : 'text-slate-400'}>{marca.activa ? 'Activa' : 'Inactiva'}</span></td><td className="px-4 py-3"><div className="flex gap-3"><button type="button" onClick={() => setDraft({ id: marca.id, nombre: marca.nombre, cuit: marca.cuit?.trim() || '' })} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Edit2 className="h-3.5 w-3.5" />Editar</button><button type="button" onClick={() => toggle(marca)} className="text-slate-600 hover:underline">{marca.activa ? 'Desactivar' : 'Activar'}</button></div></td></tr>)}
      {!marcas.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No hay marcas para mostrar.</td></tr>}
    </tbody></table></div>
  </section>;
};
