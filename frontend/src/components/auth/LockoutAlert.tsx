import React from 'react';
import { ShieldAlert, Mail, KeyRound } from 'lucide-react';

interface LockoutAlertProps {
  onRecoveryClick?: () => void;
}

export const LockoutAlert: React.FC<LockoutAlertProps> = ({ onRecoveryClick }) => {
  return (
    <div
      role="alert"
      className="bg-amber-50 border border-amber-300/80 rounded-md p-4 text-amber-900 transition-all shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="p-1.5 bg-amber-100 rounded-md text-amber-700 flex-shrink-0 mt-0.5">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div className="space-y-2 flex-1">
          <h4 className="text-sm font-semibold text-amber-900 leading-tight">
            Acceso bloqueado por seguridad
          </h4>
          <p className="text-xs text-amber-800 leading-relaxed">
            Se ha superado el límite de 5 intentos fallidos consecutivos permitidos por la política de seguridad corporativa.
            El formulario ha sido deshabilitado temporalmente para salvaguardar la integridad de las cuentas del sistema.
          </p>

          <div className="pt-2 border-t border-amber-200/80 space-y-1.5 text-xs text-amber-800">
            <p className="font-medium text-amber-900">¿Qué debes hacer?</p>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li>
                Comunícate con el <strong className="font-semibold text-amber-950">Administrador del Sistema</strong> en tu sucursal para solicitar el desbloqueo o restablecimiento manual.
              </li>
              <li>
                O inicia el proceso formal de{' '}
                <button
                  type="button"
                  onClick={onRecoveryClick}
                  className="inline-flex items-center gap-1 font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950 focus:outline-none focus:ring-1 focus:ring-amber-500 rounded"
                >
                  <KeyRound className="w-3 h-3 inline" />
                  recuperación de clave
                </button>.
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-2 pt-2 text-[11px] text-amber-700">
            <Mail className="w-3.5 h-3.5" />
            <span>Mesa de ayuda: soporte@distribuidora.com.ar | Int. 104</span>
          </div>
        </div>
      </div>
    </div>
  );
};
