import React, { useEffect, useState } from 'react';
import { Check, Edit2, Plus, X } from 'lucide-react';
import { UserSession } from '../../types/auth';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
type Comercio = { id: number; razon_social: string; nombre_fantasia: string | null; cuit: string | null; domicilio: string; localidad: string | null; contacto: string | null; telefono: string | null; activo: boolean };
type Draft = { id?: number; razon_social: string; nombre_fantasia: string; cuit: string; domicilio: string; localidad: string; contacto: string; telefono: string };
const emptyDraft = (): Draft => ({ razon_social: '', nombre_fantasia: '', cuit: '', domicilio: '', localidad: '', contacto: '', telefono: '' });

export const GestionComercios: React.FC<{ session: UserSession }> = ({ session }) => {
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

  const load = async () => {
    const response = await fetch(`${API}/api/configuracion/comercios`, { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudieron cargar los comercios.');
    setComercios(data);
  };

  useEffect(() => { load().catch((e) => setError(e.message)); }, [session.token]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/configuracion/comercios${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PUT' : 'POST', headers, body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar el comercio.');
      setDraft(null); await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const toggle = async (comercio: Comercio) => {
    setError('');
    try {
      const response = await fetch(`${API}/api/configuracion/comercios/${comercio.id}/estado`, {
        method: 'PATCH', headers, body: JSON.stringify({ activo: !comercio.activo }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo cambiar el estado.');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const input = (label: string, key: keyof Draft, required = false, type = 'text') => <label key={key} className="text-sm text-slate-700">{label}<input required={required} type={type} maxLength={key === 'cuit' ? 11 : undefined} value={draft?.[key] || ''} onChange={(e) => setDraft({ ...draft!, [key]: key === 'cuit' ? e.target.value.replace(/\D/g, '') : e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>;

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Comercios</h2><p className="mt-1 text-sm text-slate-500">Administrá clientes, domicilios y datos de contacto.</p></div>
      <button type="button" onClick={() => { setError(''); setDraft(emptyDraft()); }} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800"><Plus className="h-4 w-4" />Nuevo comercio</button>
    </div>
    {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
    {draft && <form onSubmit={save} className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
      {input('Razón social', 'razon_social', true)}{input('Nombre de fantasía', 'nombre_fantasia')}{input('CUIT (opcional)', 'cuit')}{input('Domicilio', 'domicilio', true)}{input('Localidad', 'localidad')}{input('Contacto', 'contacto')}{input('Teléfono', 'telefono', false, 'tel')}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button disabled={busy} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"><Check className="h-4 w-4" />Guardar</button><button type="button" onClick={() => setDraft(null)} className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm"><X className="h-4 w-4" />Cancelar</button></div>
    </form>}
    <div className="overflow-x-auto rounded border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Comercio</th><th className="px-4 py-3">CUIT</th><th className="px-4 py-3">Domicilio</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">
      {comercios.map((comercio) => <tr key={comercio.id}><td className="px-4 py-3"><div className="font-medium text-slate-900">{comercio.razon_social}</div>{comercio.nombre_fantasia && <div className="text-xs text-slate-500">{comercio.nombre_fantasia}</div>}</td><td className="px-4 py-3 text-slate-600">{comercio.cuit?.trim() || '—'}</td><td className="px-4 py-3 text-slate-600">{comercio.domicilio}{comercio.localidad ? `, ${comercio.localidad}` : ''}</td><td className="px-4 py-3"><span className={comercio.activo ? 'text-emerald-700' : 'text-slate-400'}>{comercio.activo ? 'Activo' : 'Inactivo'}</span></td><td className="px-4 py-3"><div className="flex gap-3"><button type="button" onClick={() => setDraft({ id: comercio.id, razon_social: comercio.razon_social, nombre_fantasia: comercio.nombre_fantasia || '', cuit: comercio.cuit?.trim() || '', domicilio: comercio.domicilio, localidad: comercio.localidad || '', contacto: comercio.contacto || '', telefono: comercio.telefono || '' })} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Edit2 className="h-3.5 w-3.5" />Editar</button><button type="button" onClick={() => toggle(comercio)} className="text-slate-600 hover:underline">{comercio.activo ? 'Desactivar' : 'Activar'}</button></div></td></tr>)}
      {!comercios.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No hay comercios para mostrar.</td></tr>}
    </tbody></table></div>
  </section>;
};
