import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, Check, X, AlertTriangle, CheckCircle2, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService';

interface ResetPasswordViewProps {
  token: string;
  onNavigateToLogin: () => void;
  onRequestNewLink: () => void;
}

export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({
  token,
  onNavigateToLogin,
  onRequestNewLink,
}) => {
  const [isValidating, setIsValidating] = useState(true);
  const [tokenStatus, setTokenStatus] = useState<{
    valid: boolean;
    error?: string;
    message?: string;
  }>({ valid: false });

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Validar token al cargar la vista
  useEffect(() => {
    let isMounted = true;

    async function checkToken() {
      if (!token) {
        if (isMounted) {
          setIsValidating(false);
          setTokenStatus({
            valid: false,
            error: 'TOKEN_INVALIDO',
            message: 'No se ha provisto un token de restablecimiento de contraseña válido.',
          });
        }
        return;
      }

      setIsValidating(true);
      const res = await authService.validateResetToken(token);
      if (isMounted) {
        setTokenStatus({
          valid: res.valid,
          error: res.error,
          message: res.message,
        });
        setIsValidating(false);
      }
    }

    checkToken();
    return () => {
      isMounted = false;
    };
  }, [token]);

  // Validaciones en tiempo real de política de seguridad
  const hasMinLength = newPassword.length >= 12;
  const hasNumber = /\d/.test(newPassword);
  const hasSpecialChar = /[^a-zA-Z0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isFormValid = hasMinLength && hasNumber && hasSpecialChar && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await authService.resetPassword(token, newPassword);
      if (res.success) {
        setSubmitSuccess(true);
        setTimeout(() => {
          onNavigateToLogin();
        }, 3000);
      } else {
        setSubmitError(res.message || 'No se pudo restablecer la contraseña.');
        if (res.error === 'TOKEN_EXPIRADO' || res.error === 'TOKEN_YA_UTILIZADO') {
          setTokenStatus({
            valid: false,
            error: res.error,
            message: res.message,
          });
        }
      }
    } catch {
      setSubmitError('Error al comunicarse con el servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1. Estado de carga / validación
  if (isValidating) {
    return (
      <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm text-center space-y-4 max-w-md mx-auto">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
        <p className="text-sm text-slate-600">Verificando enlace de restablecimiento...</p>
      </div>
    );
  }

  // 2. ESCENARIO 3: Token inválido, expirado o ya utilizado
  if (!tokenStatus.valid) {
    const isExpiredOrUsed = tokenStatus.error === 'TOKEN_EXPIRADO' || tokenStatus.error === 'TOKEN_YA_UTILIZADO';

    return (
      <div className="bg-white p-8 rounded-xl border border-red-200 shadow-sm space-y-5 max-w-md mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-bold text-slate-900">
            {isExpiredOrUsed ? 'El vínculo ha caducado o ya fue utilizado' : 'Enlace no válido'}
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            {tokenStatus.message ||
              'Por motivos de seguridad, los enlaces de recuperación son de un solo uso y vencen a los 20 minutos de su emisión.'}
          </p>
        </div>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
          Para restablecer tu contraseña y recuperar el acceso, por favor generá una nueva solicitud desde la pantalla de inicio.
        </div>

        <div className="pt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onRequestNewLink}
            className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#F4661B] hover:bg-[#DE5510] rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Generar nuevo enlace de recuperación</span>
          </button>
          <button
            type="button"
            onClick={onNavigateToLogin}
            className="w-full py-2 px-4 text-xs font-medium text-slate-600 hover:text-slate-800 transition-colors cursor-pointer"
          >
            Volver al inicio de sesión
          </button>
        </div>
      </div>
    );
  }

  // 3. Éxito tras actualizar contraseña
  if (submitSuccess) {
    return (
      <div className="bg-white p-8 rounded-xl border border-emerald-200 shadow-sm space-y-5 max-w-md mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-bold text-slate-900">
            Contraseña restablecida exitosamente
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Tu nueva clave ha sido actualizada y el enlace ha sido invalidado. Serás redirigido al formulario de inicio de sesión en unos instantes.
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={onNavigateToLogin}
            className="w-full py-2.5 px-4 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Iniciar sesión ahora</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // 4. ESCENARIO 2: Formulario de cambio de contraseña
  return (
    <div className="bg-white p-6 sm:p-8 rounded-xl border border-slate-200 shadow-sm space-y-6 max-w-md mx-auto">
      <div className="space-y-1 text-center">
        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-2">
          <Lock className="w-5 h-5" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">
          Establecé tu nueva contraseña
        </h1>
        <p className="text-xs text-slate-600">
          Ingresá una clave segura que cumpla con los estándares de seguridad corporativos.
        </p>
      </div>

      {submitError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Nueva Contraseña */}
        <div className="space-y-1.5">
          <label htmlFor="new-password" className="block text-xs font-semibold text-slate-700">
            Nueva contraseña
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              required
              disabled={isSubmitting}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full pl-9 pr-10 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors disabled:bg-slate-100"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Confirmar Contraseña */}
        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="block text-xs font-semibold text-slate-700">
            Confirmar nueva contraseña
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              required
              disabled={isSubmitting}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full pl-9 pr-10 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors disabled:bg-slate-100"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Requisitos de seguridad interactivos */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
          <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            Requisitos de la contraseña:
          </p>
          <ul className="space-y-1.5 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              {hasMinLength ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <X className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className={hasMinLength ? 'text-emerald-700 font-medium' : ''}>
                Al menos 12 caracteres
              </span>
            </li>
            <li className="flex items-center gap-2">
              {hasNumber ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <X className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className={hasNumber ? 'text-emerald-700 font-medium' : ''}>
                Al menos un número
              </span>
            </li>
            <li className="flex items-center gap-2">
              {hasSpecialChar ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <X className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className={hasSpecialChar ? 'text-emerald-700 font-medium' : ''}>
                Al menos un carácter especial (ej. !@#$%^&*)
              </span>
            </li>
            <li className="flex items-center gap-2">
              {passwordsMatch ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <X className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className={passwordsMatch ? 'text-emerald-700 font-medium' : ''}>
                Las contraseñas coinciden
              </span>
            </li>
          </ul>
        </div>

        {/* Botón de Submit */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={!isFormValid || isSubmitting}
            className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#F4661B] hover:bg-[#DE5510] rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Actualizando contraseña...</span>
              </>
            ) : (
              <>
                <span>Guardar nueva contraseña</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
