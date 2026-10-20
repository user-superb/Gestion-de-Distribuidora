// backend/src/routes/transportistaRoutes.ts
import { Router, Request, Response } from 'express';
import { transportistaService } from '../services/transportistaService.js';
import { authService } from '../services/authService.js';

export const transportistaRouter = Router();

/**
 * Helper para resolver el ID del transportista a partir del token o de los parámetros
 */
async function resolverTransportistaId(req: Request): Promise<string> {
  const queryId = req.query.transportistaId as string;
  if (queryId) return String(queryId).replace(/^usr_/, '').trim() || '2';

  const authHeader = req.headers.authorization;
  if (authHeader) {
    const verified = await authService.verifySession(authHeader);
    if (verified.valid && verified.session?.id) {
      return String(verified.session.id).replace(/^usr_/, '').trim() || '2';
    }
  }

  // Fallback para testing o desarrollo: ID del chofer Carlos Repartidor
  return '2';
}

/**
 * GET /api/transportista/hoja-activa
 * Retorna la hoja de ruta en curso con sus visitas y remitos asociados
 */
transportistaRouter.get('/hoja-activa', async (req: Request, res: Response) => {
  try {
    const transportistaId = await resolverTransportistaId(req);
    const hoja = await transportistaService.getHojaActiva(transportistaId);
    if (!hoja) {
      return res.status(404).json({
        success: false,
        message: 'No se encontró una hoja de ruta activa para este transportista.',
      });
    }
    return res.json({ success: true, hoja });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/transportista/remitos/:id/confirmar
 * HU #22: Confirmar la entrega individual de un remito
 */
transportistaRouter.post('/remitos/:id/confirmar', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { timestamp, transportistaId, latitud, longitud } = req.body;

    const resolvedTransportistaId = transportistaId || (await resolverTransportistaId(req));

    const resultado = await transportistaService.confirmarEntregaRemito(id, {
      timestamp: timestamp || new Date().toISOString(),
      transportistaId: resolvedTransportistaId,
      latitud: Number(latitud),
      longitud: Number(longitud),
    });

    if (!resultado.success) {
      return res.status(422).json(resultado);
    }

    return res.status(200).json(resultado);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/transportista/visitas/:id/confirmar-todo
 * HU #23: Confirmar la entrega masiva de remitos multimarca de toda la visita
 */
transportistaRouter.post('/visitas/:id/confirmar-todo', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { timestamp, transportistaId, latitud, longitud, entregas } = req.body;

    const resolvedTransportistaId = transportistaId || (await resolverTransportistaId(req));

    const resultado = await transportistaService.confirmarTodaLaVisita(id, {
      timestamp: timestamp || new Date().toISOString(),
      transportistaId: resolvedTransportistaId,
      latitud: Number(latitud),
      longitud: Number(longitud),
      entregas,
    });

    if (!resultado.success) {
      return res.status(422).json(resultado);
    }

    return res.status(200).json(resultado);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/transportista/sincronizar
 * Sincronización en lote de entregas registradas sin conexión (Escenario 2)
 */
transportistaRouter.post('/sincronizar', async (req: Request, res: Response) => {
  try {
    const { entregas } = req.body;
    if (!Array.isArray(entregas) || entregas.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El cuerpo debe incluir un arreglo de entregas a sincronizar.',
      });
    }

    const resultado = await transportistaService.sincronizarEntregas(entregas);
    return res.json(resultado);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
