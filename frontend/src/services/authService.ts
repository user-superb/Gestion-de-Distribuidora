import { AuthResult, LoginCredentials, LockoutStatus, UserRole, UserSession } from '../types/auth';

/**
 * Usuarios de prueba preconfigurados para validar los diferentes roles del ERP Tutucas.
 */
export const MOCK_USERS: Array<{
  email: string;
  username: string;
  password: string;
  name: string;
  role: UserRole;
  branch: string;
  redirectUrl: string;
}> = [
  {
    email: 'admin@tutucas.com.ar',
    username: 'admin',
    password: 'Password123!',
    name: 'Martín Coordinador',
    role: 'Administrativo',
    branch: 'Sucursal Central - La Plata',
    redirectUrl: '/dashboard',
  },
  {
    email: 'chofer@tutucas.com.ar',
    username: 'chofer',
    password: 'Password123!',
    name: 'Carlos Repartidor',
    role: 'Transportista',
    branch: 'Depósito Sur - Berisso',
    redirectUrl: '/mobile-dispatch',
  },
  {
    email: 'supervisor@tutucas.com.ar',
    username: 'supervisor',
    password: 'Password123!',
    name: 'Valeria Logística',
    role: 'Supervisor',
    branch: 'Hub Central - Distribución',
    redirectUrl: '/operations/routes',
  },
  {
    email: 'gerencia@tutucas.com.ar',
    username: 'gerencia',
    password: 'Password123!',
    name: 'Roberto Gerente',
    role: 'Gerente',
    branch: 'Sede Administrativa Central',
    redirectUrl: '/management/metrics',
  },
];

const MAX_FAILED_ATTEMPTS = 5;
const STORAGE_KEY_ATTEMPTS = 'tutucas_auth_failed_attempts';
const STORAGE_KEY_SESSION = 'tutucas_auth_session';

class AuthService {
  private failedAttempts: number = 0;

  constructor() {
    this.loadState();
  }

  private loadState(): void {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_ATTEMPTS);
      if (stored) {
        this.failedAttempts = parseInt(stored, 10) || 0;
      }
    } catch {
      this.failedAttempts = 0;
    }
  }

  private persistAttempts(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY_ATTEMPTS, this.failedAttempts.toString());
    } catch {
      // Ignorar fallback en entornos sin storage
    }
  }

  /**
   * Obtiene el estado actual de intentos y bloqueo
   */
  public getLockoutStatus(): LockoutStatus {
    return {
      isLocked: this.failedAttempts >= MAX_FAILED_ATTEMPTS,
      failedAttempts: this.failedAttempts,
      maxAttempts: MAX_FAILED_ATTEMPTS,
    };
  }

  /**
   * Simula el proceso de autenticación con latencia de red controlada (600-800ms)
   */
  public async login(credentials: LoginCredentials): Promise<AuthResult> {
    // 1. Simulación de latencia de red realista
    await new Promise((resolve) => setTimeout(resolve, 750));

    // 2. Verificar si el usuario ya está bloqueado preventivamente
    if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      return {
        success: false,
        error: {
          type: 'ACCOUNT_LOCKED',
          message: 'Cuenta bloqueada preventivamente por reiterados intentos fallidos.',
          remainingAttempts: 0,
        },
      };
    }

    const cleanIdentifier = credentials.identifier.trim().toLowerCase();
    const cleanPassword = credentials.password;

    // 3. Buscar coincidencia por email o username
    const foundUser = MOCK_USERS.find(
      (u) =>
        (u.email.toLowerCase() === cleanIdentifier || u.username.toLowerCase() === cleanIdentifier) &&
        u.password === cleanPassword
    );

    // 4. Caso credenciales incorrectas
    if (!foundUser) {
      this.failedAttempts += 1;
      this.persistAttempts();

      const isNowLocked = this.failedAttempts >= MAX_FAILED_ATTEMPTS;

      if (isNowLocked) {
        return {
          success: false,
          error: {
            type: 'ACCOUNT_LOCKED',
            message: 'Cuenta bloqueada preventivamente por reiterados intentos fallidos.',
            remainingAttempts: 0,
          },
        };
      }

      return {
        success: false,
        error: {
          type: 'INVALID_CREDENTIALS',
          // Texto estricto requerido por el Criterio de Aceptación 2
          message: 'Credenciales incorrectas',
          remainingAttempts: MAX_FAILED_ATTEMPTS - this.failedAttempts,
        },
      };
    }

    // 5. Caso éxito: resetear intentos fallidos y generar token de sesión
    this.failedAttempts = 0;
    this.persistAttempts();

    const timestamp = new Date().toISOString();
    const simulatedToken = `tutucas_jwt_${btoa(`${foundUser.email}:${timestamp}`)}`;

    const session: UserSession = {
      id: `usr_${Math.random().toString(36).substring(2, 9)}`,
      name: foundUser.name,
      email: foundUser.email,
      role: foundUser.role,
      branch: foundUser.branch,
      token: simulatedToken,
      authenticatedAt: timestamp,
    };

    // Guardar en sesión
    try {
      sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    } catch {
      // Ignorar fallback
    }

    return {
      success: true,
      session,
      redirectUrl: foundUser.redirectUrl,
    };
  }

  /**
   * Obtiene la sesión activa si existe
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
   * Cierra sesión
   */
  public logout(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY_SESSION);
    } catch {
      // Fallback
    }
  }

  /**
   * Restablece los intentos fallidos (para pruebas de QA y soporte)
   */
  public resetLockout(): void {
    this.failedAttempts = 0;
    this.persistAttempts();
  }
}

export const authService = new AuthService();
