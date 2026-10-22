// frontend/src/components/auth/ProfileMenu.tsx
import React, { useState, useRef, useEffect } from 'react';
import { UserSession } from '../../types/auth';
import { LogOut, ChevronDown, Building, KeyRound, X } from 'lucide-react';
import { authService } from '../../services/authService';

interface ProfileMenuProps {
  session: UserSession;
  onLogout: () => void;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ session, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const submitPasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword !== repeatPassword) {
      setPasswordError('Las nuevas contraseñas no coinciden.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setIsSavingPassword(true);
    const result = await authService.changePassword(currentPassword, newPassword);
    setIsSavingPassword(false);
    if (result.success) {
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setPasswordSuccess(result.message);
    } else {
      setPasswordError(result.message);
    }
  };

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

          <div className="border-t border-slate-100 my-1" />

          <div className="px-1.5">
            <button
              type="button"
              onClick={() => { setIsOpen(false); setShowPasswordForm(true); setPasswordError(''); setPasswordSuccess(''); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded transition-colors"
            >
              <KeyRound className="w-4 h-4 flex-shrink-0" />
              <span>Cambiar contraseña</span>
            </button>
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
      {showPasswordForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSavingPassword) setShowPasswordForm(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="change-password-title" className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl text-slate-900">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 id="change-password-title" className="text-lg font-semibold">Cambiar contraseña</h2>
                <p className="mt-1 text-sm text-slate-500">Elegí una clave nueva para tu cuenta.</p>
              </div>
              <button type="button" aria-label="Cerrar" disabled={isSavingPassword} onClick={() => setShowPasswordForm(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
            </div>
            {passwordSuccess ? (
              <div>
                <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{passwordSuccess}</p>
                <button type="button" onClick={() => setShowPasswordForm(false)} className="mt-5 w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">Listo</button>
              </div>
            ) : (
              <form onSubmit={submitPasswordChange} className="space-y-4">
                <label className="block text-sm font-medium">Contraseña actual<input required autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
                <label className="block text-sm font-medium">Nueva contraseña<input required minLength={8} autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100" /><span className="mt-1 block text-xs font-normal text-slate-500">Mínimo 8 caracteres.</span></label>
                <label className="block text-sm font-medium">Repetir nueva contraseña<input required minLength={8} autoComplete="new-password" type="password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
                {passwordError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{passwordError}</p>}
                <button type="submit" disabled={isSavingPassword || !currentPassword || !newPassword || !repeatPassword} className="w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{isSavingPassword ? 'Guardando…' : 'Guardar contraseña'}</button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
