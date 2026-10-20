import React, { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Loader2, ArrowRight, Lock, User, HelpCircle } from 'lucide-react';
import { authService } from '../../services/authService';
import { AuthResult, LoginCredentials } from '../../types/auth';
import { AlertBanner } from '../common/AlertBanner';
import { LockoutAlert } from './LockoutAlert';

interface LoginFormProps {
  onSuccess: (result: AuthResult) => void;
  prefillCredentials?: LoginCredentials;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onSuccess,
  prefillCredentials,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const identifierInputRef = useRef<HTMLInputElement>(null);

  // Inicializar estado de bloqueo al montar el componente
  useEffect(() => {
    const status = authService.getLockoutStatus();
    setIsLocked(status.isLocked);
    if (!status.isLocked) {
      setRemainingAttempts(status.maxAttempts - status.failedAttempts);
    }
  }, []);

  // Permitir autocompletado desde herramientas de prueba / QA
  useEffect(() => {
    if (prefillCredentials) {
      setIdentifier(prefillCredentials.identifier);
      setPassword(prefillCredentials.password);
      setErrorMessage(null);
    }
  }, [prefillCredentials]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Si ya está bloqueado o cargando, prevenir acción
    if (isLocked || isLoading) return;

    // Validación básica previa a envío
    if (!identifier.trim() || !password) {
      setErrorMessage('Por favor ingrese su usuario o correo y contraseña.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await authService.login({
        identifier: identifier.trim(),
        password,
      });

      if (result.success) {
        // Escenario 1: Éxito
        onSuccess(result);
      } else {
        // Manejo de errores
        if (result.error?.type === 'ACCOUNT_LOCKED') {
          // Escenario 3: Bloqueo de cuenta alcanzado
          setIsLocked(true);
          setPassword('');
          setRemainingAttempts(0);
          setErrorMessage(null);
        } else {
          // Escenario 2: Credenciales incorrectas
          // Texto estricto: "Credenciales incorrectas"
          setErrorMessage(result.error?.message || 'Credenciales incorrectas');
          setRemainingAttempts(result.error?.remainingAttempts ?? null);
          
          // Limpiar campo de contraseña y mantener foco estricto
          setPassword('');
          setTimeout(() => {
            passwordInputRef.current?.focus();
          }, 50);
        }
      }
    } catch {
      setErrorMessage('Error de conexión al servidor central. Intente nuevamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordVisibilityToggle = () => {
    setShowPassword((prev) => !prev);
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Header Institucional */}
      <div className="space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-slate-500">
          <span className="w-2 h-2 rounded-full bg-slate-900 inline-block"></span>
          Sistema de Gestión de Distribución
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Iniciar sesión en la plataforma
        </h1>
        <p className="text-sm text-slate-500">
          Ingresa tus credenciales autorizadas para acceder a tu sucursal y funciones de rol.
        </p>
      </div>

      {/* Alerta de bloqueo preventivo (Escenario 3) */}
      {isLocked && (
        <LockoutAlert onRecoveryClick={() => setShowRecoveryModal(true)} />
      )}

      {/* Alerta de error por credenciales incorrectas (Escenario 2) */}
      {!isLocked && errorMessage && (
        <AlertBanner
          type="error"
          message={errorMessage}
        >
          {remainingAttempts !== null && remainingAttempts > 0 && remainingAttempts < 5 && (
            <p className="text-red-600 font-normal mt-1">
              Intentos restantes antes de bloqueo preventivo: <strong>{remainingAttempts}</strong> de 5.
            </p>
          )}
        </AlertBanner>
      )}

      {/* Formulario de Login */}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Campo Identificador / Email */}
        <div className="space-y-1.5">
          <label
            htmlFor="identifier"
            className="block text-xs font-medium text-slate-700"
          >
            Identificador o correo institucional
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <User className="w-4 h-4" />
            </div>
            <input
              id="identifier"
              ref={identifierInputRef}
              type="text"
              autoComplete="username"
              required
              disabled={isLoading || isLocked}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="ej. admin@tutucas.com.ar o usuario"
              className={`w-full pl-9 pr-3 py-2 text-sm text-slate-900 bg-white border rounded-md transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed ${
                errorMessage && !isLocked ? 'border-red-300' : 'border-slate-300'
              }`}
            />
          </div>
        </div>

        {/* Campo Contraseña */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="block text-xs font-medium text-slate-700"
            >
              Contraseña
            </label>
            <button
              type="button"
              disabled={isLoading || isLocked}
              onClick={() => setShowRecoveryModal(true)}
              className="text-xs text-slate-500 hover:text-slate-900 transition-colors disabled:text-slate-400 disabled:cursor-not-allowed"
            >
              ¿Olvidó su clave?
            </button>
          </div>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="password"
              ref={passwordInputRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              disabled={isLoading || isLocked}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className={`w-full pl-9 pr-10 py-2 text-sm text-slate-900 bg-white border rounded-md transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed ${
                errorMessage && !isLocked ? 'border-red-300' : 'border-slate-300'
              }`}
            />
            <button
              type="button"
              tabIndex={-1}
              disabled={isLoading || isLocked}
              onClick={handlePasswordVisibilityToggle}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none disabled:opacity-40"
              title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Botón de Submit Principal */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isLoading || isLocked || !identifier || !password}
            className="w-full py-2.5 px-4 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Iniciando sesión...</span>
              </>
            ) : (
              <>
                <span>Ingresar al sistema</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Pie institucional / Aviso de auditoría */}
      <div className="pt-4 border-t border-slate-200 text-center">
        <p className="text-[11px] text-slate-400">
          Sistema de uso exclusivo para personal autorizado de distribución y logística. Todas las sesiones son monitoreadas y registradas para auditoría interna.
        </p>
      </div>

      {/* Modal / Diálogo simple de recuperación de clave */}
      {showRecoveryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-none">
          <div className="bg-white border border-slate-300 rounded-md shadow-lg max-w-sm w-full p-5 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
              <HelpCircle className="w-4 h-4 text-slate-700" />
              <span>Restablecimiento de Credenciales</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Por políticas de seguridad en logística de mercaderías, los restablecimientos de contraseña se gestionan mediante el Administrador de sucursal o contactando al Centro de Cómputos:
            </p>
            <div className="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs font-mono text-slate-700 space-y-1">
              <div>Email: <strong>soporte@distribuidora.com.ar</strong></div>
              <div>Tel: <strong>+54 (221) 456-7890</strong></div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowRecoveryModal(false)}
                className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
