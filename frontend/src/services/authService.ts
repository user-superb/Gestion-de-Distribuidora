// frontend/src/services/authService.ts
import { AuthResult, LoginCredentials, LockoutStatus, UserSession } from '../types/auth';

import { API_ROOT } from '../config/api';

const API_BASE_URL = API_ROOT;
const STORAGE_KEY_SESSION = 'tutucas_auth_session';

class AuthService {
  public async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const session = this.getCurrentSession();
    if (!session?.token) return { success: false, message: 'Tu sesión ya no está disponible. Iniciá sesión nuevamente.' };

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      return { success: response.ok && data.success, message: data.message || 'No se pudo cambiar la contraseña.' };
    } catch {
      return { success: false, message: 'No se pudo conectar con el servidor.' };
    }
  }

  private failedAttempts: number = 0;
  private isLocked: boolean = false;

  /**
   * Obtiene el estado actual de intentos y bloqueo
   */
  public getLockoutStatus(): LockoutStatus {
    return {
      isLocked: this.isLocked,
      failedAttempts: this.failedAttempts,
      maxAttempts: 5,
    };
  }

  /**
   * Autenticación real contra el Backend PostgreSQL
   */
  public async login(credentials: LoginCredentials): Promise<AuthResult> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: credentials.identifier.trim(),
          password: credentials.password,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Éxito: Guardar sesión con token en sessionStorage
        this.failedAttempts = 0;
        this.isLocked = false;

        try {
          sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(data.session));
        } catch {
          // Ignorar si storage está deshabilitado
        }

        return {
          success: true,
          session: data.session,
          redirectUrl: data.redirectUrl,
        };
      }

      // Si el backend reporta bloqueo preventivo (HTTP 423)
      if (response.status === 423 || data.error?.type === 'ACCOUNT_LOCKED') {
        this.isLocked = true;
        this.failedAttempts = 5;
        return {
          success: false,
          error: {
            type: 'ACCOUNT_LOCKED',
            message: data.error?.message || 'Cuenta bloqueada preventivamente por reiterados intentos fallidos.',
            remainingAttempts: 0,
          },
        };
      }

      // Si fallaron las credenciales (HTTP 401)
      this.failedAttempts += 1;
      const remaining = data.error?.remainingAttempts ?? Math.max(0, 5 - this.failedAttempts);

      if (this.failedAttempts >= 5) {
        this.isLocked = true;
      }

      return {
        success: false,
        error: {
          type: this.isLocked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
          // Criterio de aceptación 2: Texto exacto
          message: this.isLocked
            ? 'Cuenta bloqueada preventivamente por reiterados intentos fallidos.'
            : (data.error?.message || 'Credenciales incorrectas'),
          remainingAttempts: remaining,
        },
      };
    } catch (err: any) {
      console.error('Error al conectar con la API de autenticación:', err);
      return {
        success: false,
        error: {
          type: 'NETWORK_ERROR',
          message: 'No se pudo conectar con el servidor backend. Verificá que el backend esté iniciado en http://localhost:3001.',
        },
      };
    }
  }

  /**
   * ESCENARIO 1: Cierre de sesión voluntario
   * Revoca inmediatamente el token en PostgreSQL y limpia el almacenamiento local
   */
  public async logout(reason: 'manual' | 'inactividad' = 'manual'): Promise<void> {
    const session = this.getCurrentSession();
    const token = session?.token;

    // 1. Limpieza inmediata de datos sensibles locales
    try {
      sessionStorage.removeItem(STORAGE_KEY_SESSION);
    } catch {
      // Ignorar fallback
    }

    // 2. Prevenir que el botón 'Atrás' del navegador vuelva a mostrar datos operativos
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(null, '', '/');
    }

    // 3. Notificar al backend para invalidación inmediata de la sesión en PostgreSQL
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ token, reason }),
        });
      } catch (err) {
        console.warn('Aviso: No se pudo notificar la revocación al backend (el cliente ya fue limpiado):', err);
      }
    }
  }

  /**
   * ESCENARIO 2: Verificación de sesión activa contra PostgreSQL (detecta expiración por inactividad)
   */
  public async verifySession(): Promise<{ valid: boolean; session?: UserSession; expired?: boolean }> {
    const session = this.getCurrentSession();
    if (!session?.token) {
      return { valid: false };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Si expiró por inactividad o fue revocado
        await this.logout('inactividad');
        return {
          valid: false,
          expired: errorData.error?.type === 'SESSION_EXPIRED',
        };
      }

      const data = await response.json();
      return {
        valid: data.valid,
        session: data.session,
      };
    } catch {
      // Si el backend no responde, conservar sesión local pero reportar
      return { valid: true, session };
    }
  }

  /**
   * Obtiene la sesión activa si existe en sessionStorage
   */
  public getCurrentSession(): UserSession | null {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_SESSION);
      if (stored) {
        return JSON.parse(stored) as UserSession;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Restablece los intentos fallidos (para pruebas de QA y soporte)
   */
  public async resetLockout(): Promise<void> {
    this.failedAttempts = 0;
    this.isLocked = false;
    try {
      await fetch(`${API_BASE_URL}/api/auth/reset-lockout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      // Ignorar fallback
    }
  }

  /**
   * ESCENARIO 1: Solicitud de restablecimiento de contraseña
   */
  public async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json();
      return {
        success: data.success,
        message: data.message || 'Si el correo electrónico coincide con una cuenta activa, recibirá las instrucciones para restablecer su contraseña en su casilla de correo.',
      };
    } catch {
      return {
        success: false,
        message: 'No se pudo conectar con el servidor backend.',
      };
    }
  }

  /**
   * ESCENARIOS 2 y 3: Pre-validación del token de restablecimiento
   */
  public async validateResetToken(token: string): Promise<{ valid: boolean; error?: string; message: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password/validate?token=${encodeURIComponent(token.trim())}`);
      const data = await response.json();
      return {
        valid: response.ok && !!data.valid,
        error: data.error,
        message: data.message || (response.ok ? 'Token válido.' : 'El enlace de recuperación es inválido o ha caducado.'),
      };
    } catch {
      return {
        valid: false,
        error: 'NETWORK_ERROR',
        message: 'No se pudo conectar con el servidor backend.',
      };
    }
  }

  /**
   * ESCENARIOS 2 y 3: Restablecimiento de contraseña con token
   */
  public async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string; message: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), newPassword }),
      });
      const data = await response.json();
      return {
        success: response.ok && !!data.success,
        error: data.error,
        message: data.message || (response.ok ? 'Contraseña actualizada exitosamente.' : 'No se pudo actualizar la contraseña.'),
      };
    } catch {
      return {
        success: false,
        error: 'NETWORK_ERROR',
        message: 'No se pudo conectar con el servidor backend.',
      };
    }
  }

}

export const authService = new AuthService();
