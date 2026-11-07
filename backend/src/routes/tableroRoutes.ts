// backend/src/routes/tableroRoutes.ts
// Rutas de analítica y tablero de control para Gerencia.
import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from './authRoutes.js';
import { tableroService } from '../services/tableroService.js';
import { db } from '../db.js';

export const tableroRouter = Router();

export const ROLES_TABLERO = ['Gerente', 'Administrativo', 'Administrador del sistema', 'CEO'];

/**
 * Valida si el usuario tiene visibilidad global o permisos específicos sobre la sucursal.
 * Regla de negocio: El Gerente (y CEO / Administrador) posee visibilidad global irrestricta.
 * Los usuarios sectorizados (ej. Jefes de Área o Administrativos) solo pueden ver sus filiales asignadas.
 */
export async function validarAccesoSucursal(
  userId: number,
  role: string,
  sucursalId?: string
): Promise<{ permitido: boolean; sucursalFinalId?: string }> {
  const esGlobal = role === 'Gerente' || role === 'CEO' || role === 'Administrador del sistema';

  if (esGlobal) {
    return { permitido: true, sucursalFinalId: sucursalId };
  }

  // Usuario sectorizado
  const userBranchesRes = await db.query(
    'SELECT sucursal_id::text FROM usuario_sucursal WHERE usuario_id = $1 ORDER BY sucursal_id',
    [userId]
  );
  const sucursalesPermitidas = userBranchesRes.rows.map((r: any) => String(r.sucursal_id));

  if (sucursalesPermitidas.length === 0) {
    return { permitido: false };
  }

  // Si especificó sucursalId, debe estar en su lista de permitidas
  if (sucursalId) {
    if (!sucursalesPermitidas.includes(String(sucursalId))) {
      return { permitido: false };
    }
    return { permitido: true, sucursalFinalId: sucursalId };
  }

  // Si no especificó sucursalId, se le restringe automáticamente a su primera sucursal autorizada
  return { permitido: true, sucursalFinalId: sucursalesPermitidas[0] };
}

tableroRouter.use(requireAuth, (req: Request, res: Response, next: NextFunction) => {
  const rol = (req as any).userSession?.role;
  if (!ROLES_TABLERO.includes(rol)) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Solo el personal de gerencia y administración puede acceder al tablero de recaudación.',
    });
  }
  next();
});

/**
 * GET /api/tablero/sucursales-permitidas
 * Retorna las filiales a las que el usuario autenticado tiene visibilidad habilitada.
 */
tableroRouter.get('/sucursales-permitidas', async (req: Request, res: Response) => {
  try {
    const rol = (req as any).userSession?.role;
    const userId = Number(String((req as any).userSession?.id || '').replace(/^usr_/, ''));
    const esGlobal = rol === 'Gerente' || rol === 'CEO' || rol === 'Administrador del sistema';

    let query: string;
    let params: any[];

    if (esGlobal) {
      query = `SELECT id::text, nombre, activa FROM sucursal WHERE activa = true ORDER BY nombre`;
      params = [];
    } else {
      query = `
        SELECT s.id::text, s.nombre, s.activa
        FROM sucursal s
        JOIN usuario_sucursal us ON us.sucursal_id = s.id
        WHERE us.usuario_id = $1 AND s.activa = true
        ORDER BY s.nombre
      `;
      params = [userId];
    }

    const result = await db.query(query, params);
    return res.json({
      esGlobal,
      sucursales: result.rows.map((r: any) => ({ id: String(r.id), nombre: r.nombre })),
    });
  } catch (error) {
    console.error('Error al consultar sucursales permitidas para el tablero:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'No se pudieron consultar las sucursales habilitadas.',
    });
  }
});

/**
 * GET /api/tablero/recaudacion
 * Query params opcionales:
 * - sucursalId: string
 * - fechaDesde: AAAA-MM-DD
 * - fechaHasta: AAAA-MM-DD
 * - confirmados: boolean ("true" | "false")
 */
tableroRouter.get('/recaudacion', async (req: Request, res: Response) => {
  try {
    const rawSucursalId = typeof req.query.sucursalId === 'string' && req.query.sucursalId ? req.query.sucursalId : undefined;
    const userId = Number(String((req as any).userSession?.id || '').replace(/^usr_/, ''));
    const rol = (req as any).userSession?.role;

    // Regla & Escenario 2: Validar permiso de visualización sobre la sucursal solicitada
    const acceso = await validarAccesoSucursal(userId, rol, rawSucursalId);
    if (!acceso.permitido) {
      return res.status(403).json({
        error: 'ACCESO_DENEGADO_SUCURSAL',
        message: 'No posees permisos de visualización para las métricas de esta sucursal.',
      });
    }

    const sucursalId = acceso.sucursalFinalId;
    const fechaDesde = typeof req.query.fechaDesde === 'string' && req.query.fechaDesde ? req.query.fechaDesde : undefined;
    const fechaHasta = typeof req.query.fechaHasta === 'string' && req.query.fechaHasta ? req.query.fechaHasta : undefined;

    if (fechaDesde && !/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde)) {
      return res.status(400).json({ error: 'INVALID_DATE', message: 'fechaDesde debe tener formato AAAA-MM-DD.' });
    }
    if (fechaHasta && !/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
      return res.status(400).json({ error: 'INVALID_DATE', message: 'fechaHasta debe tener formato AAAA-MM-DD.' });
    }

    const soloConfirmados = req.query.confirmados === 'false' ? false : true;

    const data = await tableroService.obtenerComposicionRecaudacion({
      sucursalId,
      fechaDesde,
      fechaHasta,
      soloConfirmados,
    });

    return res.json(data);
  } catch (error) {
    console.error('Error al generar métricas del tablero de recaudación:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'No se pudieron calcular las métricas de recaudación.',
    });
  }
});

/**
 * GET /api/tablero/entregas-diarias
 * Query params:
 * - fecha: AAAA-MM-DD (opcional, default hoy)
 * - sucursalId: string (opcional)
 */
tableroRouter.get('/entregas-diarias', async (req: Request, res: Response) => {
  try {
    const rawSucursalId = typeof req.query.sucursalId === 'string' && req.query.sucursalId ? req.query.sucursalId : undefined;
    const userId = Number(String((req as any).userSession?.id || '').replace(/^usr_/, ''));
    const rol = (req as any).userSession?.role;

    // Regla & Escenario 2: Validar permiso de visualización sobre la sucursal solicitada
    const acceso = await validarAccesoSucursal(userId, rol, rawSucursalId);
    if (!acceso.permitido) {
      return res.status(403).json({
        error: 'ACCESO_DENEGADO_SUCURSAL',
        message: 'No posees permisos de visualización para las métricas de esta sucursal.',
      });
    }

    const sucursalId = acceso.sucursalFinalId;
    const fecha = typeof req.query.fecha === 'string' && req.query.fecha ? req.query.fecha : undefined;

    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'INVALID_DATE', message: 'fecha debe tener formato AAAA-MM-DD.' });
    }

    const data = await tableroService.obtenerMetricasEntregasDiarias({
      fecha,
      sucursalId,
    });

    return res.json(data);
  } catch (error) {
    console.error('Error al generar métricas de entregas diarias:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'No se pudieron calcular las métricas de entregas diarias.',
    });
  }
});
