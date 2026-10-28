import { sendPasswordResetEmail } from './emailService.js';
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
  role: 'Administrador del sistema' | 'Administrativo' | 'Transportista' | 'Supervisor' | 'Gerente';
  branch: string;
  token: string;
  authenticatedAt: string;
}

const MAX_FAILED_ATTEMPTS = 5;
// Mapa en memoria para auditar intentos fallidos por usuario/ip
const failedAttemptsMap = new Map<string, { count: number; lockedUntil?: number }>();

export const authService = {
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{
    success: boolean;
    error?: 'USER_NOT_FOUND' | 'INVALID_CURRENT_PASSWORD' | 'PASSWORD_REUSED';
  }> {
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        'SELECT password_hash FROM usuario WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const user = userResult.rows[0];
      if (!user) {
        await client.query('ROLLBACK');
        return { success: false, error: 'USER_NOT_FOUND' };
      }

      if (!(await bcryptjs.compare(currentPassword, user.password_hash))) {
        await client.query('ROLLBACK');
        return { success: false, error: 'INVALID_CURRENT_PASSWORD' };
      }

      if (await bcryptjs.compare(newPassword, user.password_hash)) {
        await client.query('ROLLBACK');
        return { success: false, error: 'PASSWORD_REUSED' };
      }

      const nextHash = await bcryptjs.hash(newPassword, 10);
      await client.query(
        'UPDATE usuario SET password_hash = $1, actualizado_en = now() WHERE id = $2',
        [nextHash, userId]
      );
      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

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
        'Administrador del sistema': '/dashboard/configuracion',
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

  /**
   * Valida la política de robustez de contraseñas
   */
  validatePasswordPolicy(password: string): { valid: boolean; error?: string } {
    if (!password || typeof password !== 'string') {
      return { valid: false, error: 'La contraseña es obligatoria.' };
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return { valid: false, error: 'La contraseña no puede exceder 72 bytes.' };
    }
    if (password.length < 12) {
      return { valid: false, error: 'La contraseña debe contener al menos 12 caracteres.' };
    }
    if (!/\d/.test(password)) {
      return { valid: false, error: 'La contraseña debe incluir al menos un número.' };
    }
    if (!/[^a-zA-Z0-9]/.test(password)) {
      return { valid: false, error: 'La contraseña debe incluir al menos un carácter especial (ej. !@#$%^&*).' };
    }
    return { valid: true };
  },

  /**
   * ESCENARIO 1: Solicitud de restablecimiento de contraseña
   * Respuesta genérica para evitar enumeración de usuarios
   */
  async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const genericResponse = {
      success: true,
      message: 'Si el correo electrónico coincide con una cuenta activa, recibirá las instrucciones para restablecer su contraseña en su casilla de correo.',
    };

    if (!email || typeof email !== 'string') {
      return genericResponse;
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
      const userResult = await db.query(
        'SELECT id, email, activo FROM usuario WHERE LOWER(email) = $1 LIMIT 1',
        [cleanEmail]
      );
      const user = userResult.rows[0];

      if (!user || !user.activo) {
        return genericResponse;
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

      await db.query(
        'INSERT INTO token_recuperacion_contrasena (usuario_id, token_hash, expira_en, usado) VALUES ($1, $2, $3, false)',
        [user.id, tokenHash, expiresAt]
      );

      const frontendBaseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
      const resetUrl = `${frontendBaseUrl}/reset-password?token=${rawToken}`;

      await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
      });

      return genericResponse;
    } catch (error: any) {
      console.error('Error al solicitar restablecimiento de contraseña:', error?.message || error);
      return genericResponse;
    }
  },

  /**
   * ESCENARIO 2 y 3: Validación previa del token de recuperación
   */
  async validateResetToken(rawToken: string): Promise<{
    valid: boolean;
    error?: 'TOKEN_INVALIDO' | 'TOKEN_EXPIRADO' | 'TOKEN_YA_UTILIZADO' | 'USUARIO_INACTIVO';
    message: string;
  }> {
    if (!rawToken || typeof rawToken !== 'string') {
      return {
        valid: false,
        error: 'TOKEN_INVALIDO',
        message: 'El enlace de recuperación es inválido.',
      };
    }

    try {
      const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
      const result = await db.query(
        'SELECT t.id, t.expira_en, t.usado, u.activo FROM token_recuperacion_contrasena t JOIN usuario u ON u.id = t.usuario_id WHERE t.token_hash = $1 LIMIT 1',
        [tokenHash]
      );

      const record = result.rows[0];
      if (!record) {
        return {
          valid: false,
          error: 'TOKEN_INVALIDO',
          message: 'El enlace de recuperación no es válido o no existe.',
        };
      }

      if (record.usado) {
        return {
          valid: false,
          error: 'TOKEN_YA_UTILIZADO',
          message: 'El enlace de recuperación ya ha sido utilizado. Por favor genere uno nuevo.',
        };
      }

      const now = new Date();
      if (now > new Date(record.expira_en)) {
        return {
          valid: false,
          error: 'TOKEN_EXPIRADO',
          message: 'El enlace de recuperación ha caducado por superar el tiempo límite de 20 minutos. Por favor genere uno nuevo.',
        };
      }

      if (!record.activo) {
        return {
          valid: false,
          error: 'USUARIO_INACTIVO',
          message: 'El usuario asociado se encuentra inactivo.',
        };
      }

      return {
        valid: true,
        message: 'Token válido.',
      };
    } catch (error: any) {
      console.error('Error al validar token de recuperación:', error?.message || error);
      return {
        valid: false,
        error: 'TOKEN_INVALIDO',
        message: 'Error al comprobar la validez del enlace.',
      };
    }
  },

  /**
   * ESCENARIOS 2 y 3: Consumo del token y restablecimiento atómico de contraseña
   */
  async resetPasswordWithToken(rawToken: string, newPassword: string): Promise<{
    success: boolean;
    error?: 'POLITICA_NO_CUMPLIDA' | 'TOKEN_INVALIDO' | 'TOKEN_EXPIRADO' | 'TOKEN_YA_UTILIZADO' | 'USUARIO_INACTIVO';
    message: string;
  }> {
    const policy = authService.validatePasswordPolicy(newPassword);
    if (!policy.valid) {
      return {
        success: false,
        error: 'POLITICA_NO_CUMPLIDA',
        message: policy.error || 'La contraseña no cumple con los requisitos de seguridad.',
      };
    }

    if (!rawToken || typeof rawToken !== 'string') {
      return {
        success: false,
        error: 'TOKEN_INVALIDO',
        message: 'El enlace de recuperación es inválido.',
      };
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const client = await db.getPool().connect();

    try {
      await client.query('BEGIN');

      const tokenResult = await client.query(
        'SELECT t.id, t.usuario_id, t.expira_en, t.usado, u.activo FROM token_recuperacion_contrasena t JOIN usuario u ON u.id = t.usuario_id WHERE t.token_hash = $1 FOR UPDATE',
        [tokenHash]
      );

      const record = tokenResult.rows[0];
      if (!record) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'TOKEN_INVALIDO',
          message: 'El enlace de recuperación no es válido o no existe.',
        };
      }

      if (record.usado) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'TOKEN_YA_UTILIZADO',
          message: 'El enlace de recuperación ya ha sido utilizado. Por favor genere uno nuevo.',
        };
      }

      const now = new Date();
      if (now > new Date(record.expira_en)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'TOKEN_EXPIRADO',
          message: 'El enlace de recuperación ha caducado por superar el tiempo límite de 20 minutos. Por favor genere uno nuevo.',
        };
      }

      if (!record.activo) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'USUARIO_INACTIVO',
          message: 'El usuario asociado se encuentra inactivo.',
        };
      }

      // Invalidación atómica del token de un solo uso
      const updateTokenResult = await client.query(
        'UPDATE token_recuperacion_contrasena SET usado = true, usado_en = now() WHERE id = $1 AND usado = false RETURNING id',
        [record.id]
      );

      if (!updateTokenResult.rowCount || updateTokenResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'TOKEN_YA_UTILIZADO',
          message: 'El enlace de recuperación ya ha sido utilizado. Por favor genere uno nuevo.',
        };
      }

      const newHash = await bcryptjs.hash(newPassword, 10);

      await client.query(
        'UPDATE usuario SET password_hash = $1, actualizado_en = now() WHERE id = $2',
        [newHash, record.usuario_id]
      );

      await client.query(
        'UPDATE sesion_usuario SET revocado = true, revocado_en = now(), motivo_cierre = \'manual\' WHERE usuario_id = $1 AND revocado = false',
        [record.usuario_id]
      );

      await client.query('COMMIT');

      return {
        success: true,
        message: 'Contraseña actualizada exitosamente.',
      };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('Error restableciendo contraseña:', error?.message || error);
      throw error;
    } finally {
      client.release();
    }
  },
};
