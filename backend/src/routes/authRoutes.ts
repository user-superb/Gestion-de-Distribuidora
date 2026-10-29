// backend/src/routes/authRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService.js';

export const authRouter = Router();

/**
 * Middleware para proteger rutas que requieren sesión activa
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Falta cabecera Authorization con token de sesión.',
    });
  }

  const result = await authService.verifySession(authHeader);
  if (!result.valid) {
    return res.status(401).json({
      error: result.error?.type || 'UNAUTHORIZED',
      message: result.error?.message || 'Sesión no válida o expirada.',
    });
  }

  (req as any).userSession = result.session;
  next();
}

/**
 * POST /api/auth/login
 * Autentica al usuario contra PostgreSQL
 */
authRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({
      success: false,
      error: {
        type: 'INVALID_CREDENTIALS',
        message: 'Identificador y contraseña requeridos.',
      },
    });
  }

  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  const result = await authService.login({
    identifier,
    password,
    ip,
    userAgent,
  });

  if (!result.success) {
    const status = result.error?.type === 'ACCOUNT_LOCKED' ? 423 : 401;
    return res.status(status).json(result);
  }

  // Prevenir almacenamiento en caché de respuestas de autenticación
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  return res.json(result);
});

authRouter.post('/auth/change-password', requireAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword ||
      typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).json({ success: false, message: 'La nueva contraseña debe tener al menos 8 caracteres y no superar 72 bytes.' });
  }

  const sessionId = (req as any).userSession?.id;
  const userId = typeof sessionId === 'string' ? Number(sessionId.replace(/^usr_/, '')) : NaN;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ success: false, message: 'La sesión no identifica un usuario válido.' });
  }

  const result = await authService.changePassword(userId, currentPassword, newPassword);
  res.setHeader('Cache-Control', 'no-store');
  if (!result.success) {
    const message = result.error === 'INVALID_CURRENT_PASSWORD'
      ? 'La contraseña actual es incorrecta.'
      : result.error === 'PASSWORD_REUSED'
        ? 'La nueva contraseña debe ser distinta de la contraseña actual.'
        : 'No se encontró el usuario de la sesión.';
    return res.status(result.error === 'USER_NOT_FOUND' ? 404 : 400).json({ success: false, message });
  }

  return res.json({ success: true, message: 'La contraseña se actualizó correctamente.' });
});

/**
 * POST /api/auth/logout
 * ESCENARIO 1: Cierre de sesión voluntario
 * Revoca el token en PostgreSQL y confirma la invalidación en el servidor
 */
authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const bodyToken = req.body.token;
  const reason = req.body.reason || 'manual';

  const token = authHeader || bodyToken;

  if (!token) {
    return res.status(200).json({
      success: true,
      message: 'Sesión local cerrada.',
    });
  }

  const result = await authService.logout(token, reason);

  // Headers de seguridad para evitar caché en clientes y navegadores
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  return res.json(result);
});

/**
 * GET /api/auth/verify
 * ESCENARIO 2: Verificación de sesión y sliding window de inactividad
 */
authRouter.get('/auth/verify', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      valid: false,
      error: { type: 'NOT_FOUND', message: 'Token no provisto.' },
    });
  }

  const result = await authService.verifySession(authHeader);

  if (!result.valid) {
    return res.status(401).json(result);
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.json(result);
});

/**
 * POST /api/auth/reset-lockout
 * Soporte para QA / Testing drawer
 */
authRouter.post('/auth/reset-lockout', (req: Request, res: Response) => {
  const { identifier } = req.body;
  authService.resetLockout(identifier);
  return res.json({ success: true, message: 'Intentos fallidos reseteados.' });
});

/**
 * POST /api/auth/forgot-password
 * ESCENARIO 1: Solicitud de restablecimiento de contraseña
 */
authRouter.post('/auth/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body || {};
  const result = await authService.requestPasswordReset(email);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.json(result);
});

/**
 * GET /api/auth/reset-password/validate
 * ESCENARIOS 2 y 3: Pre-validación del token para mostrar u ocultar el formulario
 */
authRouter.get('/auth/reset-password/validate', async (req: Request, res: Response) => {
  const token = req.query.token as string;
  const result = await authService.validateResetToken(token);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (!result.valid) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

/**
 * POST /api/auth/reset-password
 * ESCENARIOS 2 y 3: Establecimiento de la nueva contraseña con invalidación atómica
 */
authRouter.post('/auth/reset-password', async (req: Request, res: Response) => {
  const { token, newPassword } = req.body || {};
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const result = await authService.resetPasswordWithToken(token, newPassword);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch {
    return res.status(500).json({ success: false, message: 'No se pudo restablecer la contraseña. Intente nuevamente.' });
  }
});
