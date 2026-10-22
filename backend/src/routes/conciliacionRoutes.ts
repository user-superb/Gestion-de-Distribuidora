import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from './authRoutes.js';
import { ConciliacionError, conciliacionService } from '../services/conciliacionService.js';

export const conciliacionRouter = Router();

conciliacionRouter.use(requireAuth, (req: Request, res: Response, next: NextFunction) => {
  if (!['Administrativo', 'Administrador del sistema'].includes((req as any).userSession?.role)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo un usuario administrativo puede conciliar movimientos.' });
  }
  next();
});

function getUsuarioId(req: Request): number {
  const id = Number(String((req as any).userSession?.id || '').replace(/^usr_/, ''));
  if (!Number.isSafeInteger(id) || id <= 0) throw new ConciliacionError('No se pudo identificar al usuario de la sesión.', 401);
  return id;
}

function responderError(error: unknown, res: Response) {
  if (error instanceof ConciliacionError) {
    return res.status(error.status).json({ error: 'CONCILIACION_INVALIDA', message: error.message, ...error.details });
  }
  console.error('Error en conciliación bancaria:', error);
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'No se pudo procesar la operación.' });
}

conciliacionRouter.get('/movimientos', async (req, res) => {
  const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : undefined;
  const parsedDate = fecha ? new Date(`${fecha}T00:00:00.000Z`) : null;
  if (fecha && (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(parsedDate?.getTime()) || parsedDate?.toISOString().slice(0, 10) !== fecha)) {
    return res.status(400).json({ error: 'INVALID_DATE', message: 'La fecha debe tener formato AAAA-MM-DD.' });
  }
  try {
    return res.json(await conciliacionService.getMovimientosPendientes(fecha));
  } catch (error) {
    return responderError(error, res);
  }
});

conciliacionRouter.get('/remitos-pendientes', async (_req, res) => {
  try {
    return res.json(await conciliacionService.getRemitosPendientes());
  } catch (error) {
    return responderError(error, res);
  }
});

conciliacionRouter.get('/discrepancias', async (_req, res) => {
  try {
    return res.json(await conciliacionService.getDiscrepanciasPendientes());
  } catch (error) {
    return responderError(error, res);
  }
});

conciliacionRouter.get('/sugerencias', async (_req, res) => {
  try {
    return res.json(await conciliacionService.getSugerencias());
  } catch (error) {
    return responderError(error, res);
  }
});

conciliacionRouter.get('/movimientos-huerfanos', async (req, res) => {
  const { sucursalId, cuentaId, desde, hasta } = req.query;
  const idValido = (value: unknown) => value === undefined || (typeof value === 'string' && /^[1-9]\d*$/.test(value));
  const fechaValida = (value: unknown) => {
    if (value === undefined) return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!idValido(sucursalId) || !idValido(cuentaId) || !fechaValida(desde) || !fechaValida(hasta) ||
      (typeof desde === 'string' && typeof hasta === 'string' && desde > hasta)) {
    return res.status(400).json({ error: 'INVALID_FILTER', message: 'Revisá sucursal, cuenta y rango de fechas.' });
  }
  try {
    return res.json(await conciliacionService.getMovimientosHuerfanos({
      sucursalId: sucursalId as string | undefined,
      cuentaId: cuentaId as string | undefined,
      desde: desde as string | undefined,
      hasta: hasta as string | undefined,
    }));
  } catch (error) {
    return responderError(error, res);
  }
});

conciliacionRouter.post('/imputaciones', async (req, res) => {
  try {
    const result = await conciliacionService.conciliar(req.body?.movimientoIds, req.body?.remitoIds, getUsuarioId(req));
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return responderError(error, res);
  }
});

conciliacionRouter.post('/sugerencias/aceptar', async (req, res) => {
  try {
    const result = await conciliacionService.conciliar(
      [req.body?.movimientoId], [req.body?.remitoId], getUsuarioId(req), true
    );
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return responderError(error, res);
  }
});

conciliacionRouter.post('/discrepancias', async (req, res) => {
  try {
    const result = await conciliacionService.derivarDiscrepancia(
      req.body?.movimientoIds, req.body?.remitoIds, req.body?.nota, getUsuarioId(req)
    );
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return responderError(error, res);
  }
});
