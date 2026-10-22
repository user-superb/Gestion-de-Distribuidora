import React, { useEffect, useState } from 'react';
import { Check, Edit2, Plus, X } from 'lucide-react';
import { UserSession } from '../../types/auth';

import { API_ROOT as API } from '../../config/api';
type Cuenta = { id: number; sucursal_id: number; sucursal: string; alias: string; cbu: string | null; banco: string | null; activa: boolean };
type Sucursal = { id: number; nombre: string };
type Draft = { id?: number; sucursal_id: string; sucursal?: string; alias: string; cbu: string; banco: string };

export const GestionCuentasRecepcion: React.FC<{ session: UserSession }> = ({ session }) => {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

  const load = async () => {
    const [accountsResponse, branchesResponse] = await Promise.all([
      fetch(`${API}/api/configuracion/cuentas-recepcion`, { headers }),
      fetch(`${API}/api/configuracion/sucursales`, { headers }),
    ]);
    const [accounts, branches] = await Promise.all([accountsResponse.json(), branchesResponse.json()]);
    if (!accountsResponse.ok) throw new Error(accounts.message || 'No se pudieron cargar las cuentas.');
    if (!branchesResponse.ok) throw new Error(branches.message || 'No se pudieron cargar las sucursales.');
    setCuentas(accounts);
    setSucursales(branches.filter((branch: any) => branch.activa));
  };

  useEffect(() => { load().catch((e) => setError(e.message)); }, [session.token]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/configuracion/cuentas-recepcion${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PUT' : 'POST', headers,
        body: JSON.stringify({ ...draft, sucursal_id: Number(draft.sucursal_id) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la cuenta.');
      setDraft(null); await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const toggle = async (cuenta: Cuenta) => {
    setError('');
    try {
      const response = await fetch(`${API}/api/configuracion/cuentas-recepcion/${cuenta.id}/estado`, {
        method: 'PATCH', headers, body: JSON.stringify({ activa: !cuenta.activa }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo cambiar el estado.');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Cuentas de recepción</h2><p className="mt-1 text-sm text-slate-500">Administrá las cuentas bancarias que reciben transferencias por sucursal.</p></div>
      <button type="button" onClick={() => { setError(''); setDraft({ sucursal_id: '', alias: '', cbu: '', banco: '' }); }} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800"><Plus className="h-4 w-4" />Nueva cuenta</button>
    </div>
    {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
    {draft && <form onSubmit={save} className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2">
      {!draft.id && <label className="text-sm text-slate-700">Sucursal<select required value={draft.sucursal_id} onChange={(e) => setDraft({ ...draft, sucursal_id: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2"><option value="">Seleccioná una sucursal</option>{sucursales.map((sucursal) => <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>)}</select></label>}
      {draft.id && <div className="text-sm text-slate-700">Sucursal<div className="mt-1 rounded border border-slate-200 bg-slate-50 px-3 py-2">{draft.sucursal}</div></div>}
      <label className="text-sm text-slate-700">Alias<input required value={draft.alias} onChange={(e) => setDraft({ ...draft, alias: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm text-slate-700">Banco<input value={draft.banco} onChange={(e) => setDraft({ ...draft, banco: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm text-slate-700">CBU (opcional)<input inputMode="numeric" maxLength={22} value={draft.cbu} onChange={(e) => setDraft({ ...draft, cbu: e.target.value.replace(/\D/g, '') })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
      <div className="flex gap-2 sm:col-span-2"><button disabled={busy} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"><Check className="h-4 w-4" />Guardar</button><button type="button" onClick={() => setDraft(null)} className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm"><X className="h-4 w-4" />Cancelar</button></div>
    </form>}
    <div className="overflow-x-auto rounded border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Cuenta</th><th className="px-4 py-3">Sucursal</th><th className="px-4 py-3">CBU</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">
      {cuentas.map((cuenta) => <tr key={cuenta.id}><td className="px-4 py-3"><div className="font-medium text-slate-900">{cuenta.alias}</div><div className="text-xs text-slate-500">{cuenta.banco || 'Banco sin especificar'}</div></td><td className="px-4 py-3 text-slate-600">{cuenta.sucursal}</td><td className="px-4 py-3 text-slate-600">{cuenta.cbu?.trim() || '—'}</td><td className="px-4 py-3"><span className={cuenta.activa ? 'text-emerald-700' : 'text-slate-400'}>{cuenta.activa ? 'Activa' : 'Inactiva'}</span></td><td className="px-4 py-3"><div className="flex gap-3"><button type="button" onClick={() => setDraft({ id: cuenta.id, sucursal_id: String(cuenta.sucursal_id), sucursal: cuenta.sucursal, alias: cuenta.alias, cbu: cuenta.cbu?.trim() || '', banco: cuenta.banco || '' })} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Edit2 className="h-3.5 w-3.5" />Editar</button><button type="button" onClick={() => toggle(cuenta)} className="text-slate-600 hover:underline">{cuenta.activa ? 'Desactivar' : 'Activar'}</button></div></td></tr>)}
      {!cuentas.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No hay cuentas para mostrar.</td></tr>}
    </tbody></table></div>
  </section>;
};
