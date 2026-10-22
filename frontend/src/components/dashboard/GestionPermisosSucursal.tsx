import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { UserSession } from '../../types/auth';

import { API_ROOT as API } from '../../config/api';
type User = { id: string; nombre: string; usuario: string; rol: string };
type Branch = { id: string; nombre: string };
type Permission = { codigo: string; descripcion: string };
type Assignment = { usuario_id: string; sucursal_id: string; permisos: string[] };

export const GestionPermisosSucursal: React.FC<{ session: UserSession }> = ({ session }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

  const load = async () => {
    const response = await fetch(`${API}/api/configuracion/permisos-sucursal`, { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudieron cargar los permisos.');
    setUsers(data.usuarios.map((user: User) => ({ ...user, id: String(user.id) })));
    setBranches(data.sucursales.map((branch: Branch) => ({ ...branch, id: String(branch.id) })));
    setPermissions(data.permisos);
    setAssignments(data.asignaciones.map((assignment: Assignment) => ({
      ...assignment,
      usuario_id: String(assignment.usuario_id),
      sucursal_id: String(assignment.sucursal_id),
      permisos: assignment.permisos || [],
    })));
    setUserId((current) => current || String(data.usuarios[0]?.id || ''));
    setBranchId((current) => current || String(data.sucursales[0]?.id || ''));
  };

  useEffect(() => { load().catch((e) => setError(e.message)); }, [session.token]);
  useEffect(() => {
    const assignment = assignments.find((item) => item.usuario_id === userId && item.sucursal_id === branchId);
    setSelected(assignment?.permisos || []);
  }, [assignments, userId, branchId]);

  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`${API}/api/configuracion/permisos-sucursal/${userId}/${branchId}`, {
        method: 'PUT', headers, body: JSON.stringify({ permisos: selected }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudieron guardar los permisos.');
      await load(); setSaved(true);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const assignmentExists = assignments.some((item) => item.usuario_id === userId && item.sucursal_id === branchId);

  return <section className="space-y-4">
    <div><h2 className="text-lg font-semibold text-slate-900">Permisos por sucursal</h2><p className="mt-1 text-sm text-slate-500">Elegí qué puede hacer cada usuario en cada sucursal. Sin permisos seleccionados, no tendrá acceso a esa sucursal.</p></div>
    {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
    {users.length && branches.length ? <>
      <div className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="text-sm text-slate-700">Usuario<select value={userId} onChange={(e) => { setSaved(false); setUserId(e.target.value); }} className="mt-1 w-full rounded border border-slate-300 px-3 py-2">{users.map((user) => <option key={user.id} value={user.id}>{user.nombre} · {user.rol}</option>)}</select></label>
        <label className="text-sm text-slate-700">Sucursal<select value={branchId} onChange={(e) => { setSaved(false); setBranchId(e.target.value); }} className="mt-1 w-full rounded border border-slate-300 px-3 py-2">{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nombre}</option>)}</select></label>
      </div>
      <fieldset className="rounded border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-medium text-slate-800">Acciones permitidas</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {permissions.map((permission) => <label key={permission.codigo} className="flex items-start gap-2 rounded border border-slate-100 p-3 text-sm hover:bg-slate-50"><input type="checkbox" checked={selected.includes(permission.codigo)} onChange={(e) => setSelected(e.target.checked ? [...selected, permission.codigo] : selected.filter((code) => code !== permission.codigo))} className="mt-0.5" /><span><span className="block font-medium text-slate-800">{permission.descripcion}</span><span className="mt-0.5 block font-mono text-xs text-slate-500">{permission.codigo}</span></span></label>)}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"><Check className="h-4 w-4" />Guardar permisos</button>{saved && <span role="status" className="text-sm text-emerald-700">Permisos guardados.</span>}<span className="text-xs text-slate-500">{assignmentExists ? 'El usuario ya está asignado a esta sucursal.' : 'Guardar al menos un permiso también habilita esta sucursal para el usuario.'}</span></div>
    </> : <div className="rounded border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Necesitás al menos un usuario activo y una sucursal activa.</div>}
  </section>;
};
