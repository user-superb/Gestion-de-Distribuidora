// frontend/src/components/auth/ProfileMenu.tsx
import React, { useState, useRef, useEffect } from 'react';
import { UserSession } from '../../types/auth';
import { LogOut, ChevronDown, ShieldCheck, Building, Key } from 'lucide-react';

interface ProfileMenuProps {
  session: UserSession;
  onLogout: () => void;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ session, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Iniciales del usuario para el avatar
  const initials = session.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  return (
    <div className="relative" ref={menuRef}>
      {/* Botón trigger del menú de perfil */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="flex items-center gap-2.5 p-1.5 pl-2.5 rounded-md bg-slate-800 hover:bg-slate-750 text-white border border-slate-700/80 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        <div className="w-6 h-6 rounded bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center font-mono">
          {initials || 'U'}
        </div>
        <div className="text-left hidden sm:block leading-tight">
          <span className="text-xs font-medium block truncate max-w-[130px]">
            {session.name}
          </span>
          <span className="text-[10px] text-slate-400 block font-mono">
            {session.role}
          </span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
      </button>

      {/* Menú desplegable institucional */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-md bg-white border border-slate-200 shadow-xl py-2 z-50 text-slate-800 animate-in fade-in zoom-in-95 duration-100">
          {/* Header del perfil */}
          <div className="px-3.5 py-2.5 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-900 truncate">{session.name}</p>
            <p className="text-[11px] text-slate-500 font-mono truncate">{session.email}</p>
            
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-50 p-1.5 rounded border border-slate-100">
              <Building className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="truncate">{session.branch}</span>
            </div>
          </div>

          {/* Información de seguridad */}
          <div className="px-3.5 py-2 text-[11px] text-slate-500 space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-700">
              <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-medium">Sesión activa y auditada</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <Key className="w-3 h-3" />
              <span>Token activo en PostgreSQL</span>
            </div>
          </div>

          <div className="border-t border-slate-100 my-1" />

          {/* Opción explícita de Cierre de Sesión (Criterio Escenario 1) */}
          <div className="px-1.5">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 hover:text-red-900 rounded transition-colors"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
