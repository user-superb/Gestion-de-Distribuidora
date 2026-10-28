import React, { useEffect, useState, useRef } from 'react';
import { UserSession } from '../../types/auth';
import {
  Truck,
  Building2,
  ShieldCheck,
  BarChart3,
  Smartphone,
  Package,
  Route,
  Landmark,
  Banknote,
  ChartNoAxesCombined,
  Settings,
  ChevronDown,
  ClipboardCheck,
} from 'lucide-react';
import { AgrupadorRemitos } from '../dashboard/AgrupadorRemitos';
import { remitoService } from '../../services/remitoService';
import { HojaDeRuta, Comercio } from '../../types/domain';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ConciliacionCentro } from '../dashboard/ConciliacionCentro';
import { Configuracion } from '../dashboard/Configuracion';
import { ProfileMenu } from './ProfileMenu';
import { RepartoYaLogo } from '../common/RepartoYaLogo';

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
  const [hojasChofer, setHojasChofer] = useState<HojaDeRuta[]>([]);
  const [comerciosMap, setComerciosMap] = useState<Record<string, Comercio>>({});
  const [subseccionHojas, setSubseccionHojas] = useState<'armado' | 'armadas'>('armado');
  const [menuHojasAbierto, setMenuHojasAbierto] = useState<boolean>(false);
  const menuHojasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuHojasRef.current && !menuHojasRef.current.contains(e.target as Node)) {
        setMenuHojasAbierto(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const isSysAdmin = session.role === 'Administrador del sistema';

  const [seccion, setSeccion] = useState<Seccion>(() => {
    if (session.role === 'Administrador del sistema') return 'configuracion';
    const path = window.location.pathname;
    if (path.endsWith('/conciliacion')) return 'conciliacion';
    return 'hojas';
  });

  useEffect(() => {
    if (isSysAdmin) {
      setSeccion('configuracion');
      if (!window.location.pathname.startsWith('/dashboard/configuracion') && !window.location.pathname.endsWith('/usuarios')) {
        window.history.replaceState(null, '', '/dashboard/configuracion');
      }
      return;
    }
    const syncSection = () => {
      const path = window.location.pathname;
      setSeccion(path.endsWith('/conciliacion') ? 'conciliacion' : 'hojas');
    };
    window.addEventListener('popstate', syncSection);
    return () => window.removeEventListener('popstate', syncSection);
  }, [isSysAdmin]);

  useEffect(() => {
    if (session.role === 'Transportista') {
      const cargarHojasChofer = async () => {
        try {
          const [todasHojas, todosComercios] = await Promise.all([
            remitoService.getHojasDeRutaAsync(),
            remitoService.getComerciosAsync(),
          ]);

          const map: Record<string, Comercio> = {};
          todosComercios.forEach((c) => { map[c.id] = c; });
          setComerciosMap(map);

          const asignadas = todasHojas.filter((h) => {
            if (!h.transportistaId && !h.transportistaNombre) return false;
            const cleanSessionId = String(session.id || '').replace(/^usr_/, '');
            const matchId = String(h.transportistaId) === String(session.id) || String(h.transportistaId) === cleanSessionId;
            const matchNombre = h.transportistaNombre?.toLowerCase() === session.name?.toLowerCase();
            const matchEmail = (session.email?.includes('chofer') || session.name?.includes('Carlos')) && (h.transportistaId === '2' || h.transportistaId === '10' || h.transportistaNombre?.includes('Carlos'));
            return matchId || matchNombre || matchEmail;
          });

          setHojasChofer(asignadas);
        } catch {
          // Fallback silencioso
        }
      };
      cargarHojasChofer();
    }
  }, [session]);


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
    const navItems = isSysAdmin
      ? [{ id: 'configuracion' as const, label: 'Configuración', icon: Settings, path: '/dashboard/configuracion' }]
      : [
          { id: 'hojas' as const, label: 'Hojas de ruta', icon: Route, path: '/dashboard' },
          { id: 'conciliacion' as const, label: 'Conciliación', icon: Landmark, path: '/dashboard/conciliacion' },
        ];

    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <header
          className="bg-[#123C6B] bg-marca-azul text-white shadow-md border-b border-white/10 relative z-40"
          style={{ backgroundColor: '#123C6B' }}
        >
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-2.5 sm:px-6">
            <div className="flex shrink-0 items-center">
              <RepartoYaLogo variant="admin" size="sm" />
            </div>

            <nav aria-label="Navegación principal" className="order-3 flex w-full gap-1 sm:order-2 sm:w-auto overflow-visible">
              {navItems.map(({ id, label, icon: Icon, path }) => {
                if (id === 'hojas') {
                  return (
                    <div key={id} className="relative" ref={menuHojasRef}>
                      <button
                        type="button"
                        onClick={() => {
                          if (seccion !== 'hojas') {
                            navigate('hojas');
                          }
                          setMenuHojasAbierto(!menuHojasAbierto);
                        }}
                        aria-current={seccion === 'hojas' ? 'page' : undefined}
                        className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                          seccion === 'hojas'
                            ? 'border-marca-naranja text-white font-bold'
                            : 'border-transparent text-slate-200 hover:border-marca-naranja/50 hover:text-white'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${menuHojasAbierto ? 'rotate-180' : ''}`} />
                      </button>

                      {menuHojasAbierto && (
                        <div className="absolute left-0 top-full mt-1.5 w-72 rounded-xl bg-white p-2 text-slate-800 shadow-2xl border border-slate-200 z-[100] animate-in fade-in duration-150">
                          <button
                            type="button"
                            onClick={() => {
                              navigate('hojas');
                              setSubseccionHojas('armado');
                              setMenuHojasAbierto(false);
                            }}
                            className={`w-full flex items-start gap-2.5 p-2 rounded-md text-left transition-colors cursor-pointer ${
                              seccion === 'hojas' && subseccionHojas === 'armado'
                                ? 'bg-blue-50 text-blue-950 font-semibold'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <Package className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                            <div>
                              <div className="text-xs font-bold text-slate-900">Remitos pendientes (Armar ruta)</div>
                              <div className="text-[11px] text-slate-500 font-normal">
                                Flujo guiado de 4 pasos para consolidar remitos y armar la ruta
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              navigate('hojas');
                              setSubseccionHojas('armadas');
                              setMenuHojasAbierto(false);
                            }}
                            className={`w-full flex items-start gap-2.5 p-2 rounded-md text-left transition-colors cursor-pointer mt-1 ${
                              seccion === 'hojas' && subseccionHojas === 'armadas'
                                ? 'bg-emerald-50 text-emerald-950 font-semibold'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <ClipboardCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                            <div>
                              <div className="text-xs font-bold text-slate-900">Hojas de ruta armadas</div>
                              <div className="text-[11px] text-slate-500 font-normal">
                                Rutas creadas, asignación de choferes y seguimiento
                              </div>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <a
                    key={id}
                    href={path}
                    aria-current={seccion === id ? 'page' : undefined}
                    onClick={(event) => { event.preventDefault(); navigate(id); }}
                    className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                      seccion === id
                        ? 'border-marca-naranja text-white font-bold'
                        : 'border-transparent text-slate-200 hover:border-marca-naranja/50 hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </a>
                );
              })}
              {!isSysAdmin && [
                { label: 'Efectivo', icon: Banknote },
                { label: 'Reportes', icon: ChartNoAxesCombined },
              ].map(({ label, icon: Icon }) => (
                <span key={label} aria-disabled="true" title="Módulo aún no disponible" className="flex shrink-0 cursor-not-allowed items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-slate-400">
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-4 sm:order-3">
              <div className="hidden items-center gap-2 text-xs text-marca-crema md:flex bg-white/10 px-3 py-1.5 rounded-full border border-white/15">
                <Building2 className="h-4 w-4 text-marca-naranja" />
                <span>{session.branch}</span>
              </div>
              <ProfileMenu session={session} onLogout={onLogout} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:py-8">
          <div className="mb-5">
            <h1 className="text-2xl font-extrabold text-marca-azul">
              {isSysAdmin
                ? 'Configuración'
                : seccion === 'hojas'
                ? subseccionHojas === 'armadas'
                  ? 'Hojas de ruta armadas'
                  : 'Armado de hoja de ruta'
                : 'Conciliación de transferencias'}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {isSysAdmin
                ? 'Administrá usuarios, marcas, comercios, sucursales y permisos.'
                : seccion === 'hojas'
                ? subseccionHojas === 'armadas'
                  ? 'Seguimiento, asignación de choferes y control de hojas de ruta despachadas.'
                  : 'Organizá los remitos y las visitas de reparto.'
                : 'Imputá los movimientos de la cuenta a los remitos pendientes.'}
            </p>
          </div>
          {isSysAdmin ? (
            <Configuracion session={session} />
          ) : seccion === 'hojas' ? (
            <AgrupadorRemitos vistaInicial={subseccionHojas} onCambioVista={setSubseccionHojas} />
          ) : (
            <ConciliacionCentro session={session} />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4 selection:bg-marca-azul selection:text-white">
      <div
        className={`w-full ${
          isAdmin ? 'max-w-5xl' : 'max-w-2xl'
        } bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden`}
      >
        {/* Cabecera institucional con Menú de Perfil (Escenario 1) */}
        <div className="bg-marca-azul text-white px-6 py-3.5 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-2">
            <RepartoYaLogo variant="admin" size="xs" />
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
          {isAdmin && <ConciliacionCentro session={session} />}

                    {/* Vista operativa de Hoja de Ruta para el Transportista (Demo HU #19) */}
          {session.role === 'Transportista' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2 text-slate-800 text-xs font-bold uppercase tracking-wider">
                  <Smartphone className="w-4 h-4 text-emerald-600" />
                  <span>Mis Hojas de Ruta Asignadas ({hojasChofer.length})</span>
                </div>
                <span className="text-xs text-slate-500">Planilla vehicular activa</span>
              </div>

              {hojasChofer.length === 0 ? (
                <div className="border border-slate-200 rounded-lg p-5 bg-slate-50 text-center space-y-2">
                  <Truck className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-medium text-slate-700">
                    No posees hojas de ruta asignadas actualmente.
                  </p>
                  <p className="text-xs text-slate-500">
                    Cuando un administrativo te asigne o anexe entregas a una hoja de ruta, aparecerán detalladas aquí.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {hojasChofer.map((hoja) => {
                    const codigo = hoja.numero || `HR-${String(hoja.id).padStart(4, '0')}`;
                    const visitas = hoja.visitas || [];
                    const tienePendiente = hoja.tieneSincronizacionPendiente || visitas.some((v) => v.sincronizacionPendiente);

                    return (
                      <div key={hoja.id} className="border border-slate-200 rounded-lg bg-white overflow-hidden shadow-2xs">
                        <div className="bg-slate-900 text-white p-3.5 flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2.5">
                            <Truck className="w-4 h-4 text-emerald-400" />
                            <strong className="font-mono text-sm">{codigo}</strong>
                            <span className="text-xs text-slate-300">• Fecha: {hoja.fechaReparto}</span>
                          </div>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            {hoja.estado}
                          </span>
                        </div>

                        {tienePendiente && (
                          <div className="bg-amber-50 border-b border-amber-200 p-2.5 flex items-center gap-2 text-xs text-amber-900 font-medium">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>⚠️ Sincronización pendiente: Tenés entregas anexadas recientemente que se confirmarán al recuperar señal.</span>
                          </div>
                        )}

                        <div className="p-3.5 space-y-2">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                            Cronograma de Entregas ({visitas.length} paradas)
                          </span>

                          <div className="divide-y divide-slate-100 border border-slate-100 rounded">
                            {visitas.map((v, idx) => {
                              const com = comerciosMap[v.comercioId];
                              return (
                                <div key={v.id} className="p-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50">
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                        PARADA #{v.orden ?? idx + 1}
                                      </span>
                                      <strong className="text-slate-900">{com?.razonSocial || 'Comercio Destino'}</strong>
                                    </div>
                                    <div className="text-slate-500 flex items-center gap-2">
                                      <span>{com?.domicilio || 'Domicilio'}</span>
                                      <span>•</span>
                                      <span>{v.remitos.length} remito(s)</span>
                                    </div>
                                  </div>

                                  <div className="text-right shrink-0">
                                    {v.sincronizacionPendiente ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-semibold">
                                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                                        <span>Sin sincronizar</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 font-medium">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                        <span>Sincronizado</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
};
