import React, { useState } from 'react';
import { UserSession } from '../../types/auth';
import { GestionUsuarios } from './GestionUsuarios';
import { GestionMarcas } from './GestionMarcas';
import { GestionComercios } from './GestionComercios';
import { GestionSucursales } from './GestionSucursales';
import { GestionPermisosSucursal } from './GestionPermisosSucursal';
import { GestionCuentasRecepcion } from './GestionCuentasRecepcion';

const tabs = [
  { id: 'usuarios', label: 'Usuarios', description: 'Cuentas y roles' },
  { id: 'marcas', label: 'Marcas', description: 'Marcas proveedoras' },
  { id: 'comercios', label: 'Comercios', description: 'Clientes y domicilios' },
  { id: 'sucursales', label: 'Sucursales', description: 'Sedes y depósitos' },
  { id: 'cuentas', label: 'Cuentas de recepción', description: 'Cuentas bancarias por sede' },
  { id: 'permisos', label: 'Permisos por sucursal', description: 'Accesos y acciones' },
] as const;

type TabId = typeof tabs[number]['id'];
const storageKey = 'tutucas.configuracion.abm';

function initialTab(): TabId {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (tabs.some((tab) => tab.id === saved)) return saved as TabId;
  } catch { /* usar la primera opción si el almacenamiento del navegador está bloqueado */ }
  return tabs[0].id;
}

export const Configuracion: React.FC<{ session: UserSession }> = ({ session }) => {
  const [selected, setSelected] = useState<TabId>(initialTab);
  const select = (tab: TabId) => {
    setSelected(tab);
    try { window.localStorage.setItem(storageKey, tab); } catch { /* la selección sigue vigente durante esta sesión */ }
  };

  return <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
    <nav role="tablist" aria-label="ABM de configuración" className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
      {tabs.map((tab) => <button
        key={tab.id}
        type="button"
        role="tab"
        id={`configuracion-tab-${tab.id}`}
        aria-controls={`configuracion-panel-${tab.id}`}
        aria-selected={selected === tab.id}
        onClick={() => select(tab.id)}
        className={`min-w-48 rounded-md border px-4 py-3 text-left transition-colors lg:min-w-0 ${selected === tab.id ? 'border-blue-200 bg-white text-slate-900 shadow-sm' : 'border-transparent text-slate-600 hover:bg-white/70 hover:text-slate-900'}`}
      ><span className="block text-sm font-medium">{tab.label}</span><span className="mt-1 block text-xs text-slate-500">{tab.description}</span></button>)}
    </nav>
    <div id={`configuracion-panel-${selected}`} role="tabpanel" aria-labelledby={`configuracion-tab-${selected}`} className="min-w-0">
      {selected === 'usuarios' && <GestionUsuarios session={session} />}
      {selected === 'marcas' && <GestionMarcas session={session} />}
      {selected === 'comercios' && <GestionComercios session={session} />}
      {selected === 'sucursales' && <GestionSucursales session={session} />}
      {selected === 'cuentas' && <GestionCuentasRecepcion session={session} />}
      {selected === 'permisos' && <GestionPermisosSucursal session={session} />}
    </div>
  </div>;
};
