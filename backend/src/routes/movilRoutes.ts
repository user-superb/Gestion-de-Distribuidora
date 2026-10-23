// backend/src/routes/movilRoutes.ts
// API de la aplicación móvil del transportista (Épica 1.4).
import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from './authRoutes.js';
import { CobroError, cobroService, fechaArgentina } from '../services/cobroService.js';

export const movilRouter = Router();

movilRouter.use(requireAuth, (req: Request, res: Response, next: NextFunction) => {
  if ((req as any).userSession?.role !== 'Transportista') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo un transportista puede usar la aplicación móvil.' });
  }
  next();
});

function getUsuarioId(req: Request): number {
  const id = Number(String((req as any).userSession?.id || '').replace(/^usr_/, ''));
  if (!Number.isSafeInteger(id) || id <= 0) throw new CobroError('No se pudo identificar al usuario de la sesión.', 401);
  return id;
}

function responderError(error: unknown, res: Response) {
  if (error instanceof CobroError) {
    return res.status(error.status).json({ error: 'COBRO_INVALIDO', message: error.message, ...error.details });
  }
  console.error('Error en la API móvil:', error);
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'No se pudo procesar la operación.' });
}

/** GET /api/movil/hoja-de-ruta?fecha=AAAA-MM-DD (por defecto, hoy en hora argentina) */
movilRouter.get('/hoja-de-ruta', async (req, res) => {
  const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : fechaArgentina(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'INVALID_DATE', message: 'La fecha debe tener formato AAAA-MM-DD.' });
  }
  try {
    const hoja = await cobroService.getHojaDelDia(getUsuarioId(req), fecha);
    if (!hoja) {
      return res.json(null);
    }
    return res.json(hoja);
  } catch (error) {
    return responderError(error, res);
  }
});

/** POST /api/movil/visitas/:id/cobro · HU #26 a #29 */
movilRouter.post('/visitas/:id/cobro', async (req, res) => {
  try {
    const resultado = await cobroService.registrarCobro(getUsuarioId(req), req.params.id, req.body);
    return res.status(resultado.duplicado ? 200 : 201).json(resultado);
  } catch (error) {
    return responderError(error, res);
  }
});
