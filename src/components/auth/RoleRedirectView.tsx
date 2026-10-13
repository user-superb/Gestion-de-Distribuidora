import React from 'react';
import { UserSession } from '../../types/auth';
import {
  Truck,
  Building2,
  ShieldCheck,
  BarChart3,
  LogOut,
  Key,
  Clock,
  Smartphone,
  CheckCircle2,
  Package,
} from 'lucide-react';

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
  const getRoleBadge = () => {
    switch (session.role) {
      case 'Administrativo':
        return {
          icon: <Building2 className="w-4 h-4 text-blue-600" />,
          color: 'bg-blue-50 border-blue-200 text-blue-800',
          title: 'Panel Administrativo General (/dashboard)',
          desc: 'Gestión de pedidos de comercios de barrio, facturación y coordinación de hojas de ruta.',
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
          desc: 'Supervisión de flota en tránsito, resolución de desvíos y balanceo de carga en depósitos.',
        };
      case 'Gerente':
        return {
          icon: <BarChart3 className="w-4 h-4 text-amber-600" />,
          color: 'bg-amber-50 border-amber-200 text-amber-800',
          title: 'Módulo de Gestión Estratégica (/management/metrics)',
          desc: 'Conciliación bancaria consolidada, costos por kilómetro y métricas de cumplimiento SLA.',
        };
    }
  };

  const badge = getRoleBadge();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 selection:bg-slate-900 selection:text-white">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden">
        {/* Cabecera de Simulación de Redirección */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <span className="text-sm font-semibold tracking-wide">
              Sesión Activa - Gestión de Distribuidora Tutucas
            </span>
          </div>
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cerrar sesión</span>
          </button>
        </div>

        {/* Notificación de Redirección Simulada */}
        <div className="p-6 space-y-6">
          <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-900">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-emerald-950">
                Redirección exitosa completada (Escenario 1)
              </h3>
              <p className="text-xs text-emerald-800 leading-relaxed">
                El usuario ha sido autenticado y despachado a la ruta asignada según su rol:
                <code className="ml-1.5 px-1.5 py-0.5 bg-emerald-100 rounded text-emerald-950 font-mono font-bold">
                  {redirectUrl}
                </code>
              </p>
            </div>
          </div>

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
                Rol Asignado
              </span>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded border text-xs font-semibold ${badge.color}">
                {badge.icon}
                <span>{session.role}</span>
              </div>
              <div className="text-xs text-slate-600 leading-relaxed pt-1">
                {badge.desc}
              </div>
            </div>
          </div>

          {/* Si es transportista, mostramos la simulación de acceso móvil requerida en el criterio de aceptación */}
          {session.role === 'Transportista' && (
            <div className="border border-slate-200 rounded-md p-4 bg-slate-50 space-y-3">
              <div className="flex items-center gap-2 text-slate-800 text-xs font-semibold uppercase tracking-wider">
                <Smartphone className="w-4 h-4 text-emerald-600" />
                <span>Vista Informativa: Acceso Móvil Transportistas</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Has iniciado sesión con el perfil de <strong>Transportista</strong>. En el flujo real de campo de Tutucas, esta pantalla sincroniza la planilla de carga vehicular con el dispositivo del chofer y habilita la firma digital sin conexión.
              </p>
              <p className="text-xs text-slate-500 italic">
                Módulo reservado para dispositivos móviles de choferes. Cuando se implemente el módulo de transporte, se sincronizarán aquí las planillas asignadas por la administración.
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
            <div className="truncate text-slate-300 text-[11px]">
              {session.token}
            </div>
          </div>
        </div>

        {/* Footer con llamada a volver a probar */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3.5 flex items-center justify-between text-xs text-slate-600">
          <span>Prueba completada para el rol <strong>{session.role}</strong>.</span>
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
