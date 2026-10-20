import React, { useState } from 'react';
import { authService } from '../../services/authService';
import { LoginCredentials, UserRole } from '../../types/auth';
import { Terminal, Shield, RefreshCw, KeyRound, ChevronUp, ChevronDown, Check, Clock, Database } from 'lucide-react';

interface DevTestingDrawerProps {
  onSelectCredentials: (creds: LoginCredentials) => void;
  onResetLockout: () => void;
  onSimulateInactivity?: () => void;
  isAuthenticated?: boolean;
}

// Credenciales registradas en la base de datos PostgreSQL (seed.sql)
const SEED_USERS_DB: Array<{
  email: string;
  password: string;
  name: string;
  role: UserRole;
  branch: string;
}> = [
  {
    email: 'admin@tutucas.com.ar',
    password: 'Password123!',
    name: 'Martín Jirafales Coordinador',
    role: 'Administrativo',
    branch: 'Sucursal Central - La Plata',
  },
  {
    email: 'admin.sistema@tutucas.com.ar',
    password: 'Password123!',
    name: 'Administrador del Sistema',
    role: 'Administrador del sistema',
    branch: 'Sucursal Central - La Plata',
  },
  {
    email: 'chofer@tutucas.com.ar',
    password: 'Password123!',
    name: 'Carlos Repartidor',
    role: 'Transportista',
    branch: 'Depósito Sur - Berisso',
  },
  {
    email: 'supervisor@tutucas.com.ar',
    password: 'Password123!',
    name: 'Valeria Logística',
    role: 'Supervisor',
    branch: 'Hub Central - Distribución',
  },
  {
    email: 'gerencia@tutucas.com.ar',
    password: 'Password123!',
    name: 'Roberto Gerente',
    role: 'Gerente',
    branch: 'Sede Administrativa Central',
  },
];

export const DevTestingDrawer: React.FC<DevTestingDrawerProps> = ({
  onSelectCredentials,
  onResetLockout,
  onSimulateInactivity,
  isAuthenticated = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedRole, setCopiedRole] = useState<string | null>(null);

  const lockoutStatus = authService.getLockoutStatus();

  const handleSelectRole = (role: UserRole) => {
    const user = SEED_USERS_DB.find((u) => u.role === role);
    if (user) {
      onSelectCredentials({
        identifier: user.email,
        password: user.password,
      });
      setCopiedRole(role);
      setTimeout(() => setCopiedRole(null), 2000);
    }
  };

  const handleInvalidCredentials = () => {
    onSelectCredentials({
      identifier: 'usuario.invalido@tutucas.com.ar',
      password: 'ClaveIncorrecta999!',
    });
    setCopiedRole('invalido');
    setTimeout(() => setCopiedRole(null), 2000);
  };

  const handleForceLockout = async () => {
    for (let i = 0; i < 5; i++) {
      await authService.login({
        identifier: 'bloqueo@tutucas.com.ar',
        password: 'wrong',
      });
    }
    window.location.reload();
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-slate-900 border-t border-slate-700 text-slate-200 shadow-xl transition-all">
      {/* Botón de alternar / Banner colapsable */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-mono">
          <Terminal className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold text-white">PANEL DE TESTING QA</span>
          <span className="text-slate-400 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden sm:inline flex items-center gap-1">
            <Database className="w-3 h-3 text-emerald-400 inline" />
            <span>Entorno de Pruebas</span>
          </span>
          {lockoutStatus.isLocked && (
            <span className="px-1.5 py-0.5 rounded bg-red-950 border border-red-800 text-red-300 text-[10px] uppercase font-bold">
              Bloqueado
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{isOpen ? 'Ocultar panel' : 'Probar Escenarios (1 clic)'}</span>
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </div>
      </div>

      {/* Contenido expandible */}
      {isOpen && (
        <div className="p-4 border-t border-slate-800 bg-slate-950 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-sans">
          {/* Escenario 1: Roles de prueba en PostgreSQL */}
          <div className="space-y-2">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5 font-mono text-[11px] uppercase">
              <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
              <span>Roles en PostgreSQL</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(['Administrador del sistema', 'Administrativo', 'Transportista', 'Supervisor', 'Gerente'] as UserRole[]).map(
                (role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleSelectRole(role)}
                    className="p-1.5 text-left rounded bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 text-slate-200 transition-all flex items-center justify-between"
                  >
                    <span>{role}</span>
                    {copiedRole === role ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : null}
                  </button>
                )
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Contraseña en BD (bcrypt): <code className="text-slate-300 font-mono">Password123!</code>
            </p>
          </div>

          {/* Escenario 2: Simulación de fallo */}
          <div className="space-y-2">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5 font-mono text-[11px] uppercase">
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              <span>Fallo de Credenciales</span>
            </div>
            <button
              type="button"
              onClick={handleInvalidCredentials}
              className="w-full p-2 rounded bg-slate-900 border border-slate-800 hover:border-amber-600/50 hover:bg-slate-850 text-amber-300 text-left transition-all"
            >
              Cargar credenciales inválidas
            </button>
            <p className="text-[11px] text-slate-400">
              Dispara el banner <code className="text-amber-300 font-mono">"Credenciales incorrectas"</code>.
            </p>
          </div>

          {/* HU Cierre de sesión: Inactividad */}
          <div className="space-y-2">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5 font-mono text-[11px] uppercase">
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              <span>Inactividad (30 min)</span>
            </div>
            <button
              type="button"
              disabled={!isAuthenticated || !onSimulateInactivity}
              onClick={onSimulateInactivity}
              className="w-full p-2 rounded bg-slate-900 border border-purple-800/60 hover:bg-purple-950/40 text-purple-300 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Simular Inactividad (Timeout)
            </button>
            <p className="text-[11px] text-slate-400">
              Revoca el token en BD y solicita reingresar credenciales ante cualquier nuevo clic.
            </p>
          </div>

          {/* Bloqueo y reset */}
          <div className="space-y-2">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5 font-mono text-[11px] uppercase">
              <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
              <span>Bloqueo y Reset</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleForceLockout}
                className="flex-1 p-2 rounded bg-red-950/60 border border-red-900 text-red-200 hover:bg-red-900/50 transition-all text-center"
              >
                Forzar 5 fallos
              </button>
              <button
                type="button"
                onClick={onResetLockout}
                className="flex-1 p-2 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 transition-all text-center"
              >
                Resetear
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Limpia el estado y los intentos fallidos.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
