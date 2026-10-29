// frontend/src/services/__tests__/authService.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from '../authService';

// Polyfill de sessionStorage para entorno de tests sin browser
const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

const storageMock = createStorageMock();
Object.defineProperty(globalThis, 'sessionStorage', {
  value: storageMock,
  writable: true,
});

describe('Frontend authService - Autenticación y Cierre de Sesión', () => {
  beforeEach(() => {
    storageMock.clear();
    vi.restoreAllMocks();
  });

  it('ESCENARIO 1 (Login Éxito): Guarda sesión en sessionStorage al autenticar con el backend', async () => {
    const mockSession = {
      id: 'usr_1',
      name: 'Martín Jirafales Coordinador',
      email: 'admin@tutucas.com.ar',
      role: 'Administrativo',
      branch: 'Sucursal Central - La Plata',
      token: 'tutucas_tok_abc123',
      authenticatedAt: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        session: mockSession,
        redirectUrl: '/dashboard',
      }),
    } as any);

    const result = await authService.login({
      identifier: 'admin@tutucas.com.ar',
      password: 'Password123!',
    });

    expect(result.success).toBe(true);
    expect(result.session?.token).toBe('tutucas_tok_abc123');

    const stored = authService.getCurrentSession();
    expect(stored?.email).toBe('admin@tutucas.com.ar');
    expect(stored?.role).toBe('Administrativo');
  });

  it('ESCENARIO 2 (Fallo de Credenciales): Retorna texto exacto "Credenciales incorrectas"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: {
          type: 'INVALID_CREDENTIALS',
          message: 'Credenciales incorrectas',
          remainingAttempts: 4,
        },
      }),
    } as any);

    const result = await authService.login({
      identifier: 'admin@tutucas.com.ar',
      password: 'wrong_password',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('INVALID_CREDENTIALS');
    expect(result.error?.message).toBe('Credenciales incorrectas');
    expect(result.error?.remainingAttempts).toBe(4);
  });

  it('HU LOGOUT - ESCENARIO 1: Cierre voluntario revoca token en backend y limpia sessionStorage', async () => {
    storageMock.setItem(
      'tutucas_auth_session',
      JSON.stringify({
        id: 'usr_1',
        token: 'tutucas_tok_test_logout',
        name: 'Martín',
      })
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Revocado' }),
    } as any);
    globalThis.fetch = fetchMock;

    await authService.logout('manual');

    // Verifica que se haya limpiado el storage local
    expect(authService.getCurrentSession()).toBeNull();

    // Verifica que se haya notificado al backend
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/logout'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tutucas_tok_test_logout',
        }),
      })
    );
  });

  it('HU LOGOUT - ESCENARIO 2: Verificación de sesión detecta expiración por inactividad', async () => {
    storageMock.setItem(
      'tutucas_auth_session',
      JSON.stringify({
        id: 'usr_1',
        token: 'tutucas_tok_expired',
      })
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        valid: false,
        error: {
          type: 'SESSION_EXPIRED',
          message: 'Sesión expirada automáticamente por inactividad.',
        },
      }),
    } as any);

    const check = await authService.verifySession();
    expect(check.valid).toBe(false);
    expect(check.expired).toBe(true);

    // Debe haber limpiado la sesión local
    expect(authService.getCurrentSession()).toBeNull();
  });

  it('HU RECUPERACIÓN - ESCENARIO 1: Solicitud de restablecimiento envía email y devuelve respuesta genérica', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        message: 'Si el correo electrónico coincide con una cuenta activa, recibirá las instrucciones para restablecer su contraseña en su casilla de correo.',
      }),
    } as any);
    globalThis.fetch = fetchMock;

    const res = await authService.requestPasswordReset('almeida.christian.writing@gmail.com');
    expect(res.success).toBe(true);
    expect(res.message).toContain('correo');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/forgot-password'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'almeida.christian.writing@gmail.com' }),
      })
    );
  });

  it('HU RECUPERACIÓN - ESCENARIO 2 y 3: Pre-validación de token distingue tokens válidos y caducados', async () => {
    // Token válido
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ valid: true, message: 'Token válido.' }),
    } as any);

    const validRes = await authService.validateResetToken('token_valido_123');
    expect(validRes.valid).toBe(true);

    // Token caducado o usado
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        valid: false,
        error: 'TOKEN_EXPIRADO',
        message: 'El enlace de recuperación ha caducado.',
      }),
    } as any);

    const expiredRes = await authService.validateResetToken('token_caducado_456');
    expect(expiredRes.valid).toBe(false);
    expect(expiredRes.error).toBe('TOKEN_EXPIRADO');
  });

  it('HU RECUPERACIÓN - ESCENARIOS 2 y 3: Consumo de token para nueva contraseña', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        message: 'Contraseña actualizada exitosamente.',
      }),
    } as any);
    globalThis.fetch = fetchMock;

    const res = await authService.resetPassword('tok_xyz', 'NuevaClaveValida2026!');
    expect(res.success).toBe(true);
    expect(res.message).toBe('Contraseña actualizada exitosamente.');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/reset-password'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'tok_xyz', newPassword: 'NuevaClaveValida2026!' }),
      })
    );
  });
});
