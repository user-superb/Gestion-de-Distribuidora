import React, { useEffect, useState } from 'react';
import { AlertTriangle, Building2, Check, Edit2, Lock, Plus, X } from 'lucide-react';
import { UserSession } from '../../types/auth';

import { API_ROOT as API } from '../../config/api';

type Cuenta = {
  id: number;
  sucursal_id: number;
  sucursal: string;
  nombre_fantasia: string | null;
  alias: string;
  cbu: string | null;
  banco: string | null;
  cuit_titular: string | null;
  moneda: string;
  activa: boolean;
  tiene_movimientos?: boolean;
  en_conciliacion_activa?: boolean;
  periodo_contable_bloqueado?: boolean;
};

type Sucursal = { id: number; nombre: string; activa?: boolean };

type Draft = {
  id?: number;
  sucursal_id: string;
  sucursal?: string;
  nombre_fantasia: string;
  alias: string;
  cbu: string;
  banco: string;
  cuit_titular: string;
  moneda: 'ARS' | 'USD';
  tiene_movimientos?: boolean;
  en_conciliacion_activa?: boolean;
  periodo_contable_bloqueado?: boolean;
};

type AsociarModal = {
  cuenta: Cuenta;
  sucursal_id: string;
};

function validarCbuChecksumFrontend(cbu: string): boolean {
  if (typeof cbu !== 'string' || !/^\d{22}$/.test(cbu)) return false;
  const p1 = cbu.slice(0, 8);
  const p2 = cbu.slice(8, 22);

  const coef1 = [7, 1, 3, 9, 7, 1, 3];
  let sum1 = 0;
  for (let i = 0; i < 7; i++) sum1 += parseInt(p1[i], 10) * coef1[i];
  const dv1 = (10 - (sum1 % 10)) % 10;
  if (dv1 !== parseInt(p1[7], 10)) return false;

  const coef2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  let sum2 = 0;
  for (let i = 0; i < 13; i++) sum2 += parseInt(p2[i], 10) * coef2[i];
  const dv2 = (10 - (sum2 % 10)) % 10;
  if (dv2 !== parseInt(p2[13], 10)) return false;

  return true;
}

export const GestionCuentasRecepcion: React.FC<{ session: UserSession }> = ({ session }) => {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [asociarModal, setAsociarModal] = useState<AsociarModal | null>(null);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
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
    setBusy(true); setError(''); setErrorField(null); setSuccessMsg('');

    // Pre-validación de CBU en cliente
    const cbuTrim = draft.cbu.trim();
    if (cbuTrim && (!/^\d{22}$/.test(cbuTrim) || !validarCbuChecksumFrontend(cbuTrim))) {
      setErrorField('cbu');
      setError('El CBU ingresado no es válido: debe contener exactamente 22 dígitos numéricos y superar la verificación de checksum bancario.');
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(`${API}/api/configuracion/cuentas-recepcion${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify({
          ...draft,
          sucursal_id: Number(draft.sucursal_id),
          nombre_fantasia: draft.nombre_fantasia.trim() || null,
          banco: draft.banco.trim() || null,
          cbu: draft.cbu.trim() || null,
          cuit_titular: draft.cuit_titular.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.field) setErrorField(data.field);
        throw new Error(data.message || 'No se pudo guardar la cuenta.');
      }
      setDraft(null);
      setErrorField(null);
      setSuccessMsg(draft.id ? 'Cuenta actualizada correctamente.' : 'Cuenta creada correctamente.');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAsociar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!asociarModal) return;
    setBusy(true); setError(''); setSuccessMsg('');
    try {
      const response = await fetch(`${API}/api/configuracion/cuentas-recepcion/${asociarModal.cuenta.id}/asociar`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sucursal_id: Number(asociarModal.sucursal_id),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'No se pudo asociar la cuenta a la sucursal.');
      }
      setSuccessMsg(data.message || 'Cuenta asociada a la sucursal exitosamente.');
      setAsociarModal(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (cuenta: Cuenta) => {
    setError('');
    setSuccessMsg('');
    const inmovilizada = Boolean(cuenta.en_conciliacion_activa || cuenta.periodo_contable_bloqueado);
    if (inmovilizada) {
      setError(
        'La cuenta se encuentra temporalmente inmovilizada para cambios debido a un proceso de conciliación activo o un período contable bloqueado por auditoría.'
      );
      return;
    }
    setDraft({
      id: cuenta.id,
      sucursal_id: String(cuenta.sucursal_id),
      sucursal: cuenta.sucursal,
      nombre_fantasia: cuenta.nombre_fantasia || '',
      alias: cuenta.alias,
      cbu: cuenta.cbu?.trim() || '',
      banco: cuenta.banco || '',
      cuit_titular: cuenta.cuit_titular?.trim() || '',
      moneda: (cuenta.moneda === 'USD' ? 'USD' : 'ARS'),
      tiene_movimientos: cuenta.tiene_movimientos,
      en_conciliacion_activa: cuenta.en_conciliacion_activa,
      periodo_contable_bloqueado: cuenta.periodo_contable_bloqueado,
    });
  };

  const startAsociar = (cuenta: Cuenta) => {
    setError('');
    setSuccessMsg('');
    if (!cuenta.activa) {
      setError('La cuenta receptora debe encontrarse activa para poder asociarse a una sucursal.');
      return;
    }
    setAsociarModal({
      cuenta,
      sucursal_id: String(cuenta.sucursal_id),
    });
  };

  const toggle = async (cuenta: Cuenta) => {
    setError('');
    setSuccessMsg('');
    try {
      const response = await fetch(`${API}/api/configuracion/cuentas-recepcion/${cuenta.id}/estado`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ activa: !cuenta.activa }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo cambiar el estado.');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Cuentas de recepción</h2>
          <p className="mt-1 text-sm text-slate-500">
            Administrá las cuentas bancarias que reciben transferencias y cobros por sucursal.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError('');
            setDraft({
              sucursal_id: '',
              nombre_fantasia: '',
              alias: '',
              cbu: '',
              banco: '',
              cuit_titular: '',
              moneda: 'ARS',
              tiene_movimientos: false,
            });
          }}
          className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800"
        >
          <Plus className="h-4 w-4" />
          Nueva cuenta
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {successMsg && (
        <div role="status" className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
          <div>{successMsg}</div>
        </div>
      )}

      {asociarModal && (
        <form onSubmit={handleAsociar} className="grid gap-3 rounded border border-blue-200 bg-blue-50/50 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-blue-700" />
              Asociar cuenta a sucursal habilitada: {asociarModal.cuenta.alias}
            </h3>
            <p className="mt-1 text-xs text-blue-800">
              Sectorizá los fondos recaudados vinculando esta cuenta activa a una sucursal operativa vigente. La visibilidad de la cuenta quedará limitada a los operadores autorizados en dicha sede.
            </p>
          </div>

          <label className="text-sm text-slate-700 sm:col-span-2">
            Seleccionar Sucursal destino
            <select
              required
              value={asociarModal.sucursal_id}
              onChange={(e) => setAsociarModal({ ...asociarModal, sucursal_id: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Seleccioná una sucursal operativa vigente</option>
              {sucursales.map((sucursal) => (
                <option key={sucursal.id} value={sucursal.id}>
                  {sucursal.nombre} {Number(asociarModal.cuenta.sucursal_id) === sucursal.id ? '(Actualmente asociada)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2 sm:col-span-2 pt-1">
            <button
              disabled={busy}
              className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Confirmar asociación
            </button>
            <button
              type="button"
              onClick={() => setAsociarModal(null)}
              className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              Cancelar
            </button>
          </div>
        </form>
      )}

      {draft && (
        <form onSubmit={save} className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h3 className="text-sm font-semibold text-slate-800">
              {draft.id ? `Modificar cuenta: ${draft.alias}` : 'Registrar nueva cuenta de recepción'}
            </h3>
            {draft.id && draft.tiene_movimientos && (
              <p className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                Los datos estructurales (CBU, CUIT del titular y Moneda) se encuentran en <strong>modo solo lectura</strong> porque la cuenta ya registra movimientos contables históricos.
              </p>
            )}
          </div>

          <label className="text-sm text-slate-700">
            Nombre de fantasía / Descriptivo
            <input
              value={draft.nombre_fantasia}
              onChange={(e) => setDraft({ ...draft, nombre_fantasia: e.target.value })}
              placeholder="Ej: Cuenta Cobranza Central"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Alias (Operativo)
            <input
              required
              value={draft.alias}
              onChange={(e) => setDraft({ ...draft, alias: e.target.value })}
              placeholder="Ej: DISTRIBUIDORA.CENTRAL"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono uppercase"
            />
          </label>

          <label className="text-sm text-slate-700">
            Sucursal asignada
            <select
              required
              value={draft.sucursal_id}
              onChange={(e) => setDraft({ ...draft, sucursal_id: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            >
              <option value="">Seleccioná una sucursal</option>
              {sucursales.map((sucursal) => (
                <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Banco emisor *
            <input
              required
              value={draft.banco}
              onChange={(e) => setDraft({ ...draft, banco: e.target.value })}
              placeholder="Ej: Banco Galicia"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            <span className="flex items-center justify-between">
              <span>CBU (estrictamente 22 dígitos con dígito verificador) *</span>
              {draft.id && draft.tiene_movimientos && (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                  <Lock className="h-3 w-3" /> Solo lectura
                </span>
              )}
            </span>
            <input
              required
              inputMode="numeric"
              maxLength={22}
              disabled={Boolean(draft.id && draft.tiene_movimientos)}
              value={draft.cbu}
              onChange={(e) => {
                setErrorField(null);
                setDraft({ ...draft, cbu: e.target.value.replace(/\D/g, '') });
              }}
              placeholder="22 dígitos"
              className={`mt-1 w-full rounded border px-3 py-2 font-mono disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed ${
                errorField === 'cbu' ? 'border-red-500 bg-red-50/50 ring-1 ring-red-500' : 'border-slate-300'
              }`}
            />
            {errorField === 'cbu' && (
              <p className="mt-1 text-xs text-red-600 font-medium">CBU inválido (no supera el checksum o no tiene 22 dígitos)</p>
            )}
          </label>

          <label className="text-sm text-slate-700">
            <span className="flex items-center justify-between">
              <span>CUIT/CUIL del titular (11 dígitos numéricos) *</span>
              {draft.id && draft.tiene_movimientos && (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                  <Lock className="h-3 w-3" /> Solo lectura
                </span>
              )}
            </span>
            <input
              required
              inputMode="numeric"
              maxLength={11}
              disabled={Boolean(draft.id && draft.tiene_movimientos)}
              value={draft.cuit_titular}
              onChange={(e) => {
                if (errorField === 'cuit_titular') setErrorField(null);
                setDraft({ ...draft, cuit_titular: e.target.value.replace(/\D/g, '') });
              }}
              placeholder="Ej: 30712345678"
              className={`mt-1 w-full rounded border px-3 py-2 font-mono disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed ${
                errorField === 'cuit_titular' ? 'border-red-500 bg-red-50/50 ring-1 ring-red-500' : 'border-slate-300'
              }`}
            />
          </label>

          <label className="text-sm text-slate-700">
            <span className="flex items-center justify-between">
              <span>Moneda</span>
              {draft.id && draft.tiene_movimientos && (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                  <Lock className="h-3 w-3" /> Solo lectura
                </span>
              )}
            </span>
            <select
              disabled={Boolean(draft.id && draft.tiene_movimientos)}
              value={draft.moneda}
              onChange={(e) => setDraft({ ...draft, moneda: e.target.value as 'ARS' | 'USD' })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
            >
              <option value="ARS">ARS (Pesos)</option>
              <option value="USD">USD (Dólares)</option>
            </select>
          </label>

          <div className="flex gap-2 sm:col-span-2 pt-2">
            <button
              disabled={busy}
              className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Guardar cambios
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="inline-flex items-center gap-2 rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Cuenta / Alias</th>
              <th className="px-4 py-3">Sucursal</th>
              <th className="px-4 py-3">CBU / CUIT</th>
              <th className="px-4 py-3">Moneda</th>
              <th className="px-4 py-3">Estado / Bloqueo</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cuentas.map((cuenta) => {
              const inmovilizada = Boolean(cuenta.en_conciliacion_activa || cuenta.periodo_contable_bloqueado);
              return (
                <tr key={cuenta.id} className={inmovilizada ? 'bg-slate-50/60' : undefined}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{cuenta.alias}</div>
                    {cuenta.nombre_fantasia && (
                      <div className="text-xs font-medium text-blue-700">{cuenta.nombre_fantasia}</div>
                    )}
                    <div className="text-xs text-slate-500">{cuenta.banco || 'Banco sin especificar'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{cuenta.sucursal}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    <div>CBU: {cuenta.cbu?.trim() || '—'}</div>
                    {cuenta.cuit_titular && <div>CUIT: {cuenta.cuit_titular}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {cuenta.moneda || 'ARS'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1 items-start">
                      <span className={cuenta.activa ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                        {cuenta.activa ? 'Activa' : 'Inactiva'}
                      </span>
                      {cuenta.en_conciliacion_activa && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" title="Discrepancia en verificación activa">
                          <AlertTriangle className="h-3 w-3" /> Conciliación en curso
                        </span>
                      )}
                      {cuenta.periodo_contable_bloqueado && (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800" title="Período contable cerrado o rendido">
                          <Lock className="h-3 w-3" /> Cierre contable
                        </span>
                      )}
                      {cuenta.tiene_movimientos && !inmovilizada && (
                        <span className="text-[11px] text-slate-500">Con histórico contable</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => startAsociar(cuenta)}
                        disabled={!cuenta.activa}
                        className={`inline-flex items-center gap-1 text-sm font-medium ${
                          !cuenta.activa
                            ? 'text-slate-400 cursor-not-allowed'
                            : 'text-indigo-700 hover:underline'
                        }`}
                        title={
                          !cuenta.activa
                            ? 'La cuenta debe estar activa para poder asociarse a una sucursal'
                            : 'Asociar a sucursal habilitada'
                        }
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        Asociar
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(cuenta)}
                        disabled={inmovilizada}
                        className={`inline-flex items-center gap-1 text-sm font-medium ${
                          inmovilizada
                            ? 'text-slate-400 cursor-not-allowed'
                            : 'text-blue-700 hover:underline'
                        }`}
                        title={
                          inmovilizada
                            ? 'Cuenta temporalmente inmovilizada para cambios por conciliación o cierre contable'
                            : 'Modificar datos de la cuenta'
                        }
                      >
                        {inmovilizada ? <Lock className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(cuenta)}
                        className="text-xs text-slate-600 hover:underline"
                      >
                        {cuenta.activa ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!cuentas.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No hay cuentas de recepción para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
