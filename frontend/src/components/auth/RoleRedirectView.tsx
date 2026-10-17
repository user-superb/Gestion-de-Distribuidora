import React, { useEffect, useState } from 'react';
import { UserSession } from '../../types/auth';
import {
  Truck,
  Building2,
  ShieldCheck,
  BarChart3,
  Key,
  Clock,
  Smartphone,
  Package,
  Route,
  Landmark,
  Banknote,
  ChartNoAxesCombined,
  Settings,
} from 'lucide-react';
import { AgrupadorRemitos } from '../dashboard/AgrupadorRemitos';
import { ConciliadorMovimientos } from '../dashboard/ConciliadorMovimientos';
import { Configuracion } from '../dashboard/Configuracion';
import { ProfileMenu } from './ProfileMenu';

interface RoleRedirectViewProps {
  session: UserSession;
  redirectUrl: string;
  onLogout: () => void;
}

export const RoleRedirectView: React.FC<RoleRedirectViewProps> = ({
  session,
  redirectUrl,
  onLogout,
}) => {
  type Seccion = 'hojas' | 'conciliacion' | 'configuracion';
  const [seccion, setSeccion] = useState<Seccion>(() => {
    const path = window.location.pathname;
    if (path.endsWith('/conciliacion')) return 'conciliacion';
    if ((path.endsWith('/configuracion') || path.endsWith('/usuarios')) && session.role === 'Administrador del sistema') return 'configuracion';
    return 'hojas';
  });

  useEffect(() => {
    const syncSection = () => {
      const path = window.location.pathname;
      setSeccion(path.endsWith('/conciliacion')
        ? 'conciliacion'
        : (path.endsWith('/configuracion') || path.endsWith('/usuarios')) && session.role === 'Administrador del sistema'
          ? 'configuracion'
          : 'hojas');
    };
    window.addEventListener('popstate', syncSection);
    return () => window.removeEventListener('popstate', syncSection);
  }, [session.role]);

  const getRoleBadge = () => {
    switch (session.role) {
      case 'Administrador del sistema':
        return {
          icon: <ShieldCheck className="w-4 h-4 text-indigo-600" />,
          color: 'bg-indigo-50 border-indigo-200 text-indigo-800',
          title: 'Administrador del sistema',
          desc: 'Administración de usuarios, roles y sucursales, además de acceso a los módulos administrativos.',
        };
      case 'Administrativo':
        return {
          icon: <Building2 className="w-4 h-4 text-blue-600" />,
          color: 'bg-blue-50 border-blue-200 text-blue-800',
          title: 'Panel Administrativo General (/dashboard)',
          desc: 'Gestión de pedidos de comercios, importación de remitos y armado de visitas de hojas de ruta.',
        };
      case 'Transportista':
        return {
          icon: <Truck className="w-4 h-4 text-emerald-600" />,
          color: 'bg-emerald-50 border-emerald-200 text-emerald-800',
          title: 'Portal Móvil de Transporte (/mobile-dispatch)',
          desc: 'Módulo optimizado para dispositivos móviles: visualización de hoja de ruta activa y firmas de remito.',
        };
      case 'Supervisor':
        return {
          icon: <ShieldCheck className="w-4 h-4 text-purple-600" />,
          color: 'bg-purple-50 border-purple-200 text-purple-800',
          title: 'Centro de Monitoreo Operativo (/operations/routes)',
          desc: 'Supervisión de flota en tránsito, resolución de desvíos y validación de efectivo.',
        };
      case 'Gerente':
        return {
          icon: <BarChart3 className="w-4 h-4 text-amber-600" />,
          color: 'bg-amber-50 border-amber-200 text-amber-800',
          title: 'Módulo de Gestión Estratégica (/management/metrics)',
          desc: 'Conciliación bancaria consolidada, costos y métricas operativas.',
        };
    }
  };

  const badge = getRoleBadge();
  const isAdmin = session.role === 'Administrativo' || session.role === 'Administrador del sistema';

  const navigate = (next: Seccion) => {
    const path = next === 'conciliacion' ? '/dashboard/conciliacion' : next === 'configuracion' ? '/dashboard/configuracion' : '/dashboard';
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setSeccion(next);
  };

  if (isAdmin) {
    const navItems = [
      { id: 'hojas' as const, label: 'Hojas de ruta', icon: Route, path: '/dashboard' },
      { id: 'conciliacion' as const, label: 'Conciliación', icon: Landmark, path: '/dashboard/conciliacion' },
      ...(session.role === 'Administrador del sistema' ? [{ id: 'configuracion' as const, label: 'Configuración', icon: Settings, path: '/dashboard/configuracion' }] : []),
    ];

    return (
      <div className="min-h-screen bg-slate-100">
        <header className="bg-slate-900 text-white shadow-sm">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
            <div className="flex shrink-0 items-center gap-2 text-xs font-bold tracking-[0.16em]">
              <Package className="h-5 w-5 text-emerald-400" />
              <span>DISTRIBUIDORA</span>
            </div>

            <nav aria-label="Navegación principal" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-2 sm:w-auto">
              {navItems.map(({ id, label, icon: Icon, path }) => (
                <a
                  key={id}
                  href={path}
                  aria-current={seccion === id ? 'page' : undefined}
                  onClick={(event) => { event.preventDefault(); navigate(id); }}
                  className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
                    seccion === id
                      ? 'border-emerald-400 text-white'
                      : 'border-transparent text-slate-400 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </a>
              ))}
              {[
                { label: 'Efectivo', icon: Banknote },
                { label: 'Reportes', icon: ChartNoAxesCombined },
              ].map(({ label, icon: Icon }) => (
                <span key={label} aria-disabled="true" title="Módulo aún no disponible" className="flex shrink-0 cursor-not-allowed items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-slate-600">
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-4 sm:order-3">
              <div className="hidden items-center gap-2 text-xs text-slate-300 md:flex">
                <Building2 className="h-4 w-4 text-slate-400" />
                <span>{session.branch}</span>
              </div>
              <ProfileMenu session={session} onLogout={onLogout} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:py-8">
          <div className="mb-5">
            <h1 className="text-xl font-semibold text-slate-900">
              {seccion === 'hojas' ? 'Armado de hoja de ruta' : seccion === 'conciliacion' ? 'Conciliación de transferencias' : 'Configuración'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {seccion === 'hojas'
                ? 'Organizá los remitos y las visitas de reparto.'
                : seccion === 'conciliacion' ? 'Imputá los movimientos de la cuenta a los remitos pendientes.' : 'Administrá usuarios, marcas, comercios, sucursales y permisos.'}
            </p>
          </div>
          {seccion === 'hojas'
            ? <AgrupadorRemitos />
            : seccion === 'conciliacion'
              ? <ConciliadorMovimientos session={session} />
              : <Configuracion session={session} />}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 selection:bg-slate-900 selection:text-white">
      <div
        className={`w-full ${
          isAdmin ? 'max-w-5xl' : 'max-w-2xl'
        } bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden`}
      >
        {/* Cabecera institucional con Menú de Perfil (Escenario 1) */}
        <div className="bg-slate-900 text-white px-6 py-3.5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <span className="text-sm font-semibold tracking-wide">
              Gestión de Distribuidora - Tutucas
            </span>
          </div>
          <ProfileMenu session={session} onLogout={onLogout} />
        </div>

        <div className="p-6 space-y-6">
          {/* Información del Usuario y Rol */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border border-slate-200 rounded-md bg-slate-50/50 space-y-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Operador y Sucursal
              </span>
              <div className="text-sm font-semibold text-slate-900">{session.name}</div>
              <div className="text-xs text-slate-600 font-mono">{session.email}</div>
              <div className="text-xs text-slate-700 font-medium pt-1 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-slate-500" />
                <span>{session.branch}</span>
              </div>
            </div>

            <div className="p-4 border border-slate-200 rounded-md bg-slate-50/50 space-y-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Rol Asignado y Ruta ({redirectUrl})
              </span>
              <div
                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded border text-xs font-semibold ${badge.color}`}
              >
                {badge.icon}
                <span>{session.role}</span>
              </div>
              <div className="text-xs text-slate-600 leading-relaxed pt-1">{badge.desc}</div>
            </div>
          </div>

          {/* Módulo de Administrativo: Agrupador de Remitos en Visitas */}
          {isAdmin && <AgrupadorRemitos />}
          {isAdmin && <ConciliadorMovimientos session={session} />}

          {/* Si es transportista, mostramos la simulación de acceso móvil */}
          {session.role === 'Transportista' && (
            <div className="border border-slate-200 rounded-md p-4 bg-slate-50 space-y-3">
              <div className="flex items-center gap-2 text-slate-800 text-xs font-semibold uppercase tracking-wider">
                <Smartphone className="w-4 h-4 text-emerald-600" />
                <span>Vista Informativa: Acceso Móvil Transportistas</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Has iniciado sesión con el perfil de <strong>Transportista</strong>. En el flujo
                real de campo de Tutucas, esta pantalla sincroniza la planilla de carga vehicular
                con el dispositivo del chofer y habilita la firma digital sin conexión.
              </p>
            </div>
          )}

          {/* Detalle Técnico de Sesión Guardada */}
          <div className="border border-slate-200 rounded-md p-4 bg-slate-900 text-slate-100 font-mono text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-[11px] pb-1 border-b border-slate-800">
              <div className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>TOKEN DE SESIÓN GUARDADO (sessionStorage)</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{session.authenticatedAt}</span>
              </div>
            </div>
            <div className="truncate text-slate-300 text-[11px]">{session.token}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3.5 flex items-center justify-between text-xs text-slate-600">
          <span>
            Sesión activa para el rol <strong>{session.role}</strong>.
          </span>
          <button
            onClick={onLogout}
            className="text-slate-900 font-medium hover:underline flex items-center gap-1"
          >
            Volver al Login y probar otro usuario
          </button>
        </div>
      </div>
    </div>
  );
};
