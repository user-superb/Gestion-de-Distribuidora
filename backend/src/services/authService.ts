// backend/src/services/authService.ts
import crypto from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { db } from '../db.js';

export interface LoginDto {
  identifier: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

export interface UserSessionData {
  id: string;
  name: string;
  email: string;
  role: 'Administrativo' | 'Transportista' | 'Supervisor' | 'Gerente';
  branch: string;
  token: string;
  authenticatedAt: string;
}

const MAX_FAILED_ATTEMPTS = 5;
// Mapa en memoria para auditar intentos fallidos por usuario/ip
const failedAttemptsMap = new Map<string, { count: number; lockedUntil?: number }>();

export const authService = {
  /**
   * Autenticación contra base de datos PostgreSQL
   */
  async login(dto: LoginDto): Promise<{
    success: boolean;
    session?: UserSessionData;
    redirectUrl?: string;
    error?: {
      type: 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'SERVER_ERROR';
      message: string;
      remainingAttempts?: number;
    };
  }> {
    const cleanId = dto.identifier.trim().toLowerCase();
    const attempts = failedAttemptsMap.get(cleanId) || { count: 0 };

    // 1. Verificar si está bloqueado por intentos previos
    if (attempts.count >= MAX_FAILED_ATTEMPTS) {
      return {
        success: false,
        error: {
          type: 'ACCOUNT_LOCKED',
          message: 'Cuenta bloqueada preventivamente por reiterados intentos fallidos.',
          remainingAttempts: 0,
        },
      };
    }

    try {
      // 2. Consulta en PostgreSQL buscando por usuario o email
      const result = await db.query(
        `SELECT u.id, u.usuario, u.nombre, u.email, u.password_hash, u.rol, u.activo, s.nombre as sucursal_nombre
         FROM usuario u
         LEFT JOIN usuario_sucursal us ON us.usuario_id = u.id
         LEFT JOIN sucursal s ON s.id = us.sucursal_id
         WHERE LOWER(u.usuario) = $1 OR LOWER(u.email) = $1
         LIMIT 1`,
        [cleanId]
      );

      const user = result.rows[0];

      // 3. Si no existe usuario o está inactivo
      if (!user || !user.activo) {
        attempts.count += 1;
        failedAttemptsMap.set(cleanId, attempts);

        const isLocked = attempts.count >= MAX_FAILED_ATTEMPTS;
        return {
          success: false,
          error: {
            type: isLocked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
            // Criterio de aceptación 2: Texto exacto
            message: isLocked
              ? 'Cuenta bloqueada preventivamente por reiterados intentos fallidos.'
              : 'Credenciales incorrectas',
            remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - attempts.count),
          },
        };
      }

      // 4. Validar contraseña con bcrypt
      const passwordMatches = await bcryptjs.compare(dto.password, user.password_hash);

      if (!passwordMatches) {
        attempts.count += 1;
        failedAttemptsMap.set(cleanId, attempts);

        const isLocked = attempts.count >= MAX_FAILED_ATTEMPTS;
        return {
          success: false,
          error: {
            type: isLocked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
            message: isLocked
              ? 'Cuenta bloqueada preventivamente por reiterados intentos fallidos.'
              : 'Credenciales incorrectas',
            remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - attempts.count),
          },
        };
      }

      // 5. Éxito: Resetear intentos fallidos
      failedAttemptsMap.delete(cleanId);

      // 6. Generar token criptográfico y sesión en PostgreSQL
      const token = `tutucas_tok_${crypto.randomBytes(32).toString('hex')}`;
      const sessionId = `ses_${crypto.randomUUID()}`;
      const authenticatedAt = new Date().toISOString();
      // Expiración por inactividad: 30 minutos por política corporativa
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await db.query(
        `INSERT INTO sesion_usuario (id, usuario_id, token, ip_address, user_agent, expira_en, revocado)
         VALUES ($1, $2, $3, $4, $5, $6, false)`,
        [sessionId, user.id, token, dto.ip || null, dto.userAgent || null, expiresAt]
      );

      // 7. Determinar redirección según rol
      const redirectMap: Record<string, string> = {
        Administrativo: '/dashboard',
        Transportista: '/mobile-dispatch',
        Supervisor: '/operations/routes',
        Gerente: '/management/metrics',
      };

      return {
        success: true,
        session: {
          id: `usr_${user.id}`,
          name: user.nombre,
          email: user.email,
          role: user.rol,
          branch: user.sucursal_nombre || 'Sucursal Central - La Plata',
          token,
          authenticatedAt,
        },
        redirectUrl: redirectMap[user.rol] || '/dashboard',
      };
    } catch (error: any) {
      console.error('Error en autenticación en PostgreSQL:', error);
      return {
        success: false,
        error: {
          type: 'SERVER_ERROR',
          message: 'Error interno del servidor al procesar la autenticación.',
        },
      };
    }
  },

  /**
   * ESCENARIO 1: Cierre de sesión voluntario
   * Invalida inmediatamente el token en PostgreSQL
   */
  async logout(token: string, reason: 'manual' | 'inactividad' = 'manual'): Promise<{ success: boolean; message: string }> {
    try {
      const cleanToken = token.replace('Bearer ', '').trim();
      await db.query(
        `UPDATE sesion_usuario
         SET revocado = true, revocado_en = now(), motivo_cierre = $1
         WHERE token = $2 AND revocado = false`,
        [reason, cleanToken]
      );

      return {
        success: true,
        message: 'Sesión revocada e invalidada en el servidor de forma inmediata.',
      };
    } catch (error: any) {
      console.error('Error revocando sesión en PostgreSQL:', error);
      return {
        success: false,
        message: 'Error al revocar la sesión en el servidor.',
      };
    }
  },

  /**
   * ESCENARIO 2: Verificación de sesión y sliding window de inactividad (30 min)
   */
  async verifySession(token: string): Promise<{
    valid: boolean;
    session?: UserSessionData;
    error?: { type: 'SESSION_REVOKED' | 'SESSION_EXPIRED' | 'NOT_FOUND'; message: string };
  }> {
    try {
      const cleanToken = token.replace('Bearer ', '').trim();

      const result = await db.query(
        `SELECT s.id, s.token, s.expira_en, s.revocado, s.creado_en,
                u.id as user_id, u.usuario, u.nombre, u.email, u.rol, u.activo, suc.nombre as sucursal_nombre
         FROM sesion_usuario s
         JOIN usuario u ON u.id = s.usuario_id
         LEFT JOIN usuario_sucursal us ON us.usuario_id = u.id
         LEFT JOIN sucursal suc ON suc.id = us.sucursal_id
         WHERE s.token = $1
         LIMIT 1`,
        [cleanToken]
      );

      const row = result.rows[0];

      if (!row) {
        return {
          valid: false,
          error: { type: 'NOT_FOUND', message: 'Token de sesión no encontrado.' },
        };
      }

      // Si fue revocada explícitamente (Escenario 1)
      if (row.revocado) {
        return {
          valid: false,
          error: { type: 'SESSION_REVOKED', message: 'La sesión ha sido revocada explícitamente.' },
        };
      }

      // Si expiró por inactividad (Escenario 2)
      const now = new Date();
      const expiresAt = new Date(row.expira_en);

      if (now > expiresAt) {
        // Marcar en PostgreSQL como revocada por inactividad
        await db.query(
          `UPDATE sesion_usuario
           SET revocado = true, revocado_en = now(), motivo_cierre = 'inactividad'
           WHERE id = $1`,
          [row.id]
        );

        return {
          valid: false,
          error: {
            type: 'SESSION_EXPIRED',
            message: 'Sesión expirada automáticamente por inactividad (30 minutos sin interacción).',
          },
        };
      }

      // Sesión válida: Extender expiración por sliding-window de actividad (30 minutos más)
      const nextExpiration = new Date(Date.now() + 30 * 60 * 1000);
      await db.query(
        `UPDATE sesion_usuario
         SET ultimo_acceso = now(), expira_en = $1
         WHERE id = $2`,
        [nextExpiration, row.id]
      );

      return {
        valid: true,
        session: {
          id: `usr_${row.user_id}`,
          name: row.nombre,
          email: row.email,
          role: row.rol,
          branch: row.sucursal_nombre || 'Sucursal Central - La Plata',
          token: row.token,
          authenticatedAt: new Date(row.creado_en).toISOString(),
        },
      };
    } catch (error: any) {
      console.error('Error verificando sesión en PostgreSQL:', error);
      return {
        valid: false,
        error: { type: 'NOT_FOUND', message: 'Error validando estado de sesión.' },
      };
    }
  },

  /**
   * Resetear intentos fallidos (para pruebas de QA)
   */
  resetLockout(identifier?: string) {
    if (identifier) {
      failedAttemptsMap.delete(identifier.trim().toLowerCase());
    } else {
      failedAttemptsMap.clear();
    }
  },

  /**
   * Obtener estado de bloqueo para un identificador
   */
  getLockoutStatus(identifier: string) {
    const cleanId = identifier.trim().toLowerCase();
    const attempts = failedAttemptsMap.get(cleanId) || { count: 0 };
    return {
      isLocked: attempts.count >= MAX_FAILED_ATTEMPTS,
      failedAttempts: attempts.count,
      maxAttempts: MAX_FAILED_ATTEMPTS,
    };
  },
};
