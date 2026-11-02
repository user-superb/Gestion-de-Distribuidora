// backend/src/routes/efectivoRoutes.ts
// Épica 2.3 · Escritorio del supervisor de efectivo (HU #47 a #50).
import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from './authRoutes.js';
import { RendicionError, rendicionService } from '../services/rendicionService.js';

export const efectivoRouter = Router();

// Supuesto: el "supervisor de efectivo" es el rol Supervisor. El administrador del sistema también accede.
export const ROLES_EFECTIVO = ['Supervisor', 'Administrador del sistema'];

efectivoRouter.use(requireAuth, (req: Request, res: Response, next: NextFunction) => {
  if (!ROLES_EFECTIVO.includes((req as any).userSession?.role)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo un supervisor de efectivo puede validar rendiciones.' });
  }
  next();
});

function getUsuarioId(req: Request): number {
  const id = Number(String((req as any).userSession?.id || '').replace(/^usr_/, ''));
  if (!Number.isSafeInteger(id) || id <= 0) throw new RendicionError('No se pudo identificar al usuario de la sesión.', 401);
  return id;
}

function responderError(error: unknown, res: Response) {
  if (error instanceof RendicionError) {
    return res.status(error.status).json({ error: error.status === 410 ? 'RENDICION_RETRACTADA' : 'RENDICION_INVALIDA', message: error.message, ...error.details });
  }
  console.error('Error en rendición de efectivo:', error);
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'No se pudo procesar la operación.' });
}

/** GET /api/efectivo/rendiciones?estado=pendiente,con_diferencia&fecha=AAAA-MM-DD · HU #47 */
efectivoRouter.get('/rendiciones', async (req, res) => {
  const fecha = typeof req.query.fecha === 'string' && req.query.fecha ? req.query.fecha : undefined;
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'INVALID_DATE', message: 'La fecha debe tener formato AAAA-MM-DD.' });
  }
  const estado = typeof req.query.estado === 'string' && req.query.estado ? req.query.estado : undefined;
  try {
    return res.json({ rendiciones: await rendicionService.listar({ estado, fecha }) });
  } catch (error) {
    return responderError(error, res);
  }
});

/** GET /api/efectivo/rendiciones/:id · HU #47 (410 si el transportista la retractó) */
efectivoRouter.get('/rendiciones/:id', async (req, res) => {
  try {
    return res.json(await rendicionService.detalle(String(req.params.id)));
  } catch (error) {
    return responderError(error, res);
  }
});

/** POST /api/efectivo/rendiciones/:id/aprobar · HU #48 */
efectivoRouter.post('/rendiciones/:id/aprobar', async (req, res) => {
  try {
    return res.json(await rendicionService.aprobar(getUsuarioId(req), String(req.params.id), req.body));
  } catch (error) {
    return responderError(error, res);
  }
});

/** POST /api/efectivo/rendiciones/:id/diferencia · HU #49 */
efectivoRouter.post('/rendiciones/:id/diferencia', async (req, res) => {
  try {
    return res.json(await rendicionService.registrarDiferencia(getUsuarioId(req), String(req.params.id), req.body));
  } catch (error) {
    return responderError(error, res);
  }
});

/** POST /api/efectivo/rendiciones/:id/aprobar-con-diferencia · HU #50 */
efectivoRouter.post('/rendiciones/:id/aprobar-con-diferencia', async (req, res) => {
  try {
    return res.json(await rendicionService.aprobarConDiferencia(getUsuarioId(req), String(req.params.id), req.body));
  } catch (error) {
    return responderError(error, res);
  }
});
