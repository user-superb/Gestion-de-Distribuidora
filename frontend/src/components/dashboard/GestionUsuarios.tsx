import React, { useCallback, useEffect, useState } from 'react';
import { UserRole, UserSession } from '../../types/auth';
import { Check, Edit2, Plus, Shield, UserRound, X } from 'lucide-react';

const roles: UserRole[] = ['Administrador del sistema', 'Administrativo', 'Transportista', 'Supervisor', 'Gerente'];
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface UserRecord {
  id: number;
  usuario: string;
  nombre: string;
  email: string | null;
  rol: UserRole;
  activo: boolean;
  sucursal_ids: string[];
  sucursales: string;
}

interface Branch { id: string; nombre: string }
interface UserDraft {
  id?: number;
  usuario: string;
  nombre: string;
  email: string;
  password: string;
  rol: UserRole;
  sucursalIds: string[];
}

const emptyDraft = (): UserDraft => ({ usuario: '', nombre: '', email: '', password: '', rol: 'Administrativo', sucursalIds: [] });

export const GestionUsuarios: React.FC<{ session: UserSession }> = ({ session }) => {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/api/usuarios`, { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudieron cargar los usuarios.');
    setUsers(data.usuarios);
    setBranches(data.sucursales);
  }, [session.token]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const { id, ...body } = draft;
      const response = await fetch(`${API_BASE_URL}/api/usuarios${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST', headers, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar el usuario.');
      setDraft(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (user: UserRecord) => {
    setError('');
    const response = await fetch(`${API_BASE_URL}/api/usuarios/${user.id}/estado`, {
      method: 'PATCH', headers, body: JSON.stringify({ activo: !user.activo }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.message || 'No se pudo cambiar el estado.');
    else await load();
  };

  const startEdit = (user: UserRecord) => setDraft({
    id: user.id, usuario: user.usuario, nombre: user.nombre, email: user.email || '', password: '',
    rol: user.rol, sucursalIds: user.sucursal_ids.map(String),
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Usuarios del sistema</h2>
          <p className="mt-1 text-sm text-slate-500">Altas, roles fijos y sucursales asignadas.</p>
        </div>
        <button type="button" onClick={() => { setError(''); setDraft(emptyDraft()); }} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800">
          <Plus className="h-4 w-4" /> Nuevo usuario
        </button>
      </div>

      {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      {draft && <form onSubmit={save} className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="text-sm text-slate-700">Usuario<input required value={draft.usuario} onChange={(e) => setDraft({ ...draft, usuario: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm text-slate-700">Nombre completo<input required value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm text-slate-700">Correo electrónico<input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm text-slate-700">{draft.id ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}<input type="password" required={!draft.id} minLength={8} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm text-slate-700">Rol<select value={draft.rol} onChange={(e) => setDraft({ ...draft, rol: e.target.value as UserRole })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2">{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
        <fieldset className="text-sm text-slate-700 sm:col-span-2">
          <legend className="mb-2">Sucursales asignadas</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">{branches.map((branch) => <label key={branch.id} className="flex items-center gap-2"><input type="checkbox" checked={draft.sucursalIds.includes(String(branch.id))} onChange={(e) => setDraft({ ...draft, sucursalIds: e.target.checked ? [...draft.sucursalIds, String(branch.id)] : draft.sucursalIds.filter((id) => id !== String(branch.id)) })} />{branch.nombre}</label>)}</div>
        </fieldset>
        <div className="flex gap-2 sm:col-span-2">
          <button disabled={busy || !draft.sucursalIds.length} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"><Check className="h-4 w-4" />Guardar</button>
          <button type="button" onClick={() => setDraft(null)} className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm"><X className="h-4 w-4" />Cancelar</button>
        </div>
      </form>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3">Sucursales</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Acciones</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{users.map((user) => <tr key={user.id}>
            <td className="px-4 py-3"><div className="flex items-center gap-2 font-medium text-slate-900"><UserRound className="h-4 w-4 text-slate-400" />{user.nombre}</div><div className="pl-6 text-xs text-slate-500">{user.usuario}{user.email ? ` · ${user.email}` : ''}</div></td>
            <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-slate-400" />{user.rol}</span></td>
            <td className="px-4 py-3 text-slate-600">{user.sucursales || 'Sin sucursal'}</td>
            <td className="px-4 py-3"><span className={user.activo ? 'text-emerald-700' : 'text-slate-400'}>{user.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td className="px-4 py-3"><div className="flex items-center gap-3"><button type="button" onClick={() => startEdit(user)} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Edit2 className="h-3.5 w-3.5" />Editar</button><button type="button" disabled={String(user.id) === session.id.replace('usr_', '')} onClick={() => changeStatus(user)} className="text-slate-600 hover:underline disabled:opacity-40">{user.activo ? 'Desactivar' : 'Activar'}</button></div></td>
          </tr>)}{!users.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No hay usuarios para mostrar.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
};
