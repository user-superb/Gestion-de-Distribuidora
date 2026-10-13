import React, { useState, useEffect } from 'react';
import { AuthLayout } from './components/auth/AuthLayout';
import { LoginForm } from './components/auth/LoginForm';
import { RoleRedirectView } from './components/auth/RoleRedirectView';
import { DevTestingDrawer } from './components/auth/DevTestingDrawer';
import { authService } from './services/authService';
import { AuthResult, LoginCredentials, UserSession } from './types/auth';

export const App: React.FC = () => {
  const [currentSession, setCurrentSession] = useState<UserSession | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string>('/dashboard');
  const [prefillCredentials, setPrefillCredentials] = useState<LoginCredentials | undefined>(undefined);
  const [, setLockoutKey] = useState(0); // Trigger para re-render de componentes al resetear

  useEffect(() => {
    // Verificar si ya hay una sesión existente en sessionStorage
    const existing = authService.getCurrentSession();
    if (existing) {
      setCurrentSession(existing);
      // Mapear url basada en el rol existente
      const roleUrls: Record<string, string> = {
        Administrativo: '/dashboard',
        Transportista: '/mobile-dispatch',
        Supervisor: '/operations/routes',
        Gerente: '/management/metrics',
      };
      setRedirectUrl(roleUrls[existing.role] || '/dashboard');
    }
  }, []);

  const handleLoginSuccess = (result: AuthResult) => {
    if (result.session) {
      setCurrentSession(result.session);
      setRedirectUrl(result.redirectUrl || '/dashboard');
    }
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentSession(null);
  };

  const handleResetLockout = () => {
    authService.resetLockout();
    setLockoutKey((k) => k + 1);
    // Disparar recarga suave para reiniciar formulario y estado limpio
    window.location.reload();
  };

  // Si el usuario ya está autenticado (Escenario 1 completado)
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
        <LoginForm
          onSuccess={handleLoginSuccess}
          prefillCredentials={prefillCredentials}
        />
      </AuthLayout>

      {/* Drawer inferior para QA / Criterios de Aceptación */}
      <DevTestingDrawer
        onSelectCredentials={(creds) => setPrefillCredentials(creds)}
        onResetLockout={handleResetLockout}
      />
    </>
  );
};

export default App;
