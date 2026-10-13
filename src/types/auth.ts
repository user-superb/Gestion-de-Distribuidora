export type UserRole = 'Administrativo' | 'Transportista' | 'Supervisor' | 'Gerente';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  branch: string;
  token: string;
  authenticatedAt: string;
}

export interface LoginCredentials {
  identifier: string;
  password: string;
}

export type AuthErrorType = 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'NETWORK_ERROR';

export interface AuthError {
  type: AuthErrorType;
  message: string;
  remainingAttempts?: number;
}

export interface AuthResult {
  success: boolean;
  session?: UserSession;
  redirectUrl?: string;
  error?: AuthError;
}

export interface LockoutStatus {
  isLocked: boolean;
  failedAttempts: number;
  maxAttempts: number;
  lockUntil?: number | null; // Timestamp en ms si es por tiempo
}
