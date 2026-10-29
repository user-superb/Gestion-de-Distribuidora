import { ResetPasswordView } from './components/auth/ResetPasswordView';
import { ForgotPasswordModal } from './components/auth/ForgotPasswordModal';
import React, { useState, useEffect, useCallback } from 'react';
import { AuthLayout } from './components/auth/AuthLayout';
import { LoginForm } from './components/auth/LoginForm';
import { RoleRedirectView } from './components/auth/RoleRedirectView';
import { DevTestingDrawer } from './components/auth/DevTestingDrawer';
import { authService } from './services/authService';
import { AuthResult, LoginCredentials, UserSession } from './types/auth';
import { useInactivityTimer } from './hooks/useInactivityTimer';
import { AlertBanner } from './components/common/AlertBanner';

export const App: React.FC = () => {
  const [currentSession, setCurrentSession] = useState<UserSession | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string>('/dashboard');
  const [prefillCredentials, setPrefillCredentials] = useState<LoginCredentials | undefined>(undefined);
  const [, setLockoutKey] = useState(0);
  const [inactivityNotice, setInactivityNotice] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('token');
  });
  const [showDirectRecoveryModal, setShowDirectRecoveryModal] = useState(false);

  // Cierre de sesión automático por inactividad (30 min)
  const handleInactivityTimeout = useCallback(async () => {
    if (!currentSession) return;
    await authService.logout('inactividad');
    setCurrentSession(null);
    setInactivityNotice(
      'Sesión expirada automáticamente por inactividad (30 minutos sin interacción). Por políticas corporativas de seguridad, se solicita reingresar sus credenciales.'
    );
    window.history.replaceState(null, '', '/');
  }, [currentSession]);

  // Hook de inactividad activo únicamente cuando hay una sesión activa
  const { triggerTimeoutNow } = useInactivityTimer({
    timeoutMs: 30 * 60 * 1000, // 30 minutos
    onTimeout: handleInactivityTimeout,
    enabled: !!currentSession,
  });

  // Validar sesión inicial y proteger contra el botón "Atrás" del navegador
  useEffect(() => {
    const existing = authService.getCurrentSession();
    if (existing) {
      setCurrentSession(existing);
      const roleUrls: Record<string, string> = {
        'Administrador del sistema': '/dashboard/configuracion',
        Administrativo: '/dashboard',
        Transportista: '/mobile-dispatch',
        Supervisor: '/operations/routes',
        Gerente: '/management/metrics',
      };
      setRedirectUrl(roleUrls[existing.role] || '/dashboard');

      // Verificar en segundo plano contra PostgreSQL si el token no fue revocado
      authService.verifySession().then((res) => {
        if (!res.valid) {
          setCurrentSession(null);
          if (res.expired) {
            setInactivityNotice(
              'La sesión previa en este equipo ha expirado por inactividad. Por favor, vuelva a identificarse.'
            );
          }
        }
      });
    }

    // Regla de seguridad: Si el usuario presiona botón "Atrás", evitar mostrar datos en caché si no hay sesión
    const handlePopState = () => {
      const active = authService.getCurrentSession();
      if (!active) {
        setCurrentSession(null);
      }
      const params = new URLSearchParams(window.location.search);
      setResetToken(params.get('token'));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleLoginSuccess = (result: AuthResult) => {
    if (result.session) {
      setCurrentSession(result.session);
      setRedirectUrl(result.redirectUrl || '/dashboard');
      setInactivityNotice(null);
      // Evitar que el botón atrás regrese al login estando autenticado
      window.history.pushState(null, '', result.redirectUrl || '/dashboard');
    }
  };

  // ESCENARIO 1: Cierre de sesión voluntario
  const handleLogout = async () => {
    await authService.logout('manual');
    setCurrentSession(null);
    setInactivityNotice(null);
    // Impide que el botón Atrás vuelva a desplegar información operativa
    window.history.replaceState(null, '', '/');
  };

  const handleResetLockout = async () => {
    await authService.resetLockout();
    setLockoutKey((k) => k + 1);
    window.location.reload();
  };

  // Si hay un token en la URL o estamos en la ruta de restablecimiento
  if (resetToken !== null || window.location.pathname === '/reset-password') {
    return (
      <AuthLayout>
        <ResetPasswordView
          token={resetToken || ''}
          onNavigateToLogin={() => {
            setResetToken(null);
            window.history.pushState(null, '', '/');
          }}
          onRequestNewLink={() => {
            setResetToken(null);
            window.history.pushState(null, '', '/');
            setShowDirectRecoveryModal(true);
          }}
        />
        <ForgotPasswordModal
          isOpen={showDirectRecoveryModal}
          onClose={() => setShowDirectRecoveryModal(false)}
        />
      </AuthLayout>
    );
  }

  // Si el usuario está autenticado, mostrar la vista con información operativa y módulo administrativo
  if (currentSession) {
    return (
      <RoleRedirectView
        session={currentSession}
        redirectUrl={redirectUrl}
        onLogout={handleLogout}
      />
    );
  }

  // Si no está autenticado, renderizar Login Split-Screen
  return (
    <>
      <AuthLayout>
        {inactivityNotice && (
          <div className="mb-4">
            <AlertBanner
              type="warning"
              title="Aviso de Seguridad Corporativa"
              message={inactivityNotice}
            />
          </div>
        )}
        <LoginForm
          onSuccess={handleLoginSuccess}
          prefillCredentials={prefillCredentials}
        />
        <ForgotPasswordModal
          isOpen={showDirectRecoveryModal}
          onClose={() => setShowDirectRecoveryModal(false)}
        />
      </AuthLayout>

      {/* Drawer inferior para QA / Criterios de Aceptación */}
      <DevTestingDrawer
        onSelectCredentials={(creds) => setPrefillCredentials(creds)}
        onResetLockout={handleResetLockout}
        onSimulateInactivity={triggerTimeoutNow}
        isAuthenticated={false}
      />
    </>
  );
};

export default App;
