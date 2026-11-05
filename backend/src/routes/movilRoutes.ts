// backend/src/routes/movilRoutes.ts
// API de la aplicación móvil del transportista (Épica 1.4).
import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from './authRoutes.js';
import { CobroError, cobroService, fechaArgentina } from '../services/cobroService.js';
import { RendicionError, rendicionService } from '../services/rendicionService.js';
import { remitoService } from '../services/remitoService.js';
import { db } from '../db.js';

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
    const usuarioId = getUsuarioId(req);
    // Registrar latido de conexión activa del dispositivo móvil (HU #19)
    await remitoService.registrarLatidoMovil(usuarioId);

    const hoja = await cobroService.getHojaDelDia(usuarioId, fecha);
    if (!hoja) {
      return res.json(null);
    }
    // Al recibir la hoja en el celular conectado, limpiar las alertas de "Sincronización pendiente" (HU #19)
    await db.query(
      'UPDATE visita SET sincronizacion_pendiente = false WHERE hoja_de_ruta_id::text = $1 AND sincronizacion_pendiente = true',
      [String(hoja.id)]
    ).catch(() => undefined);

    // HU #46: la app necesita saber si ya se declaró el efectivo de esta hoja.
    const rendicion = await rendicionService.getRendicionActivaDeHoja(hoja.id).catch(() => null);
    return res.json({ ...hoja, rendicion });
  } catch (error) {
    return responderError(error, res);
  }
});

/** POST /api/movil/latido · HU #19: reporta estado de conectividad en tiempo real desde la app móvil */
movilRouter.post('/latido', async (req, res) => {
  try {
    const usuarioId = getUsuarioId(req);
    await remitoService.registrarLatidoMovil(usuarioId);
    return res.json({ ok: true, conectado: true, timestamp: new Date().toISOString() });
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

function responderErrorRendicion(error: unknown, res: Response) {
  if (error instanceof RendicionError) {
    return res.status(error.status).json({ error: 'RENDICION_INVALIDA', message: error.message, ...error.details });
  }
  return responderError(error, res);
}

/** POST /api/movil/rendicion · HU #46: declaración del efectivo al terminar la ruta. */
movilRouter.post('/rendicion', async (req, res) => {
  try {
    const resultado = await rendicionService.declarar(getUsuarioId(req), req.body);
    return res.status(resultado.duplicado ? 200 : 201).json(resultado);
  } catch (error) {
    return responderErrorRendicion(error, res);
  }
});

/** POST /api/movil/rendicion/anular · HU #47 E2: el transportista retracta su declaración. */
movilRouter.post('/rendicion/anular', async (req, res) => {
  try {
    return res.json(await rendicionService.anular(getUsuarioId(req), req.body));
  } catch (error) {
    return responderErrorRendicion(error, res);
  }
});
