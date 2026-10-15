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
});
