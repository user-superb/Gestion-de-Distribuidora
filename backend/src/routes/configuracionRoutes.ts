import { NextFunction, Request, Response, Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from './authRoutes.js';

export const configuracionRouter = Router();

const requireSystemAdmin = (req: Request, res: Response, next: NextFunction) => {
  if ((req as any).userSession?.role !== 'Administrador del sistema') {
    return res.status(403).json({ message: 'Solo el Administrador del sistema puede administrar la configuración.' });
  }
  next();
};

configuracionRouter.use('/configuracion', requireAuth, requireSystemAdmin);

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value: unknown) => text(value) || null;
const idIsValid = (id: number) => Number.isSafeInteger(id) && id > 0;
const cuitIsValid = (value: unknown) => !text(value) || /^\d{11}$/.test(text(value));

function reportError(res: Response, error: any, entity: string) {
  if (error?.code === '23505') return res.status(409).json({ message: `Ya existe ${entity} con esos datos.` });
  if (error?.code === '23503') return res.status(409).json({ message: `No se puede modificar ${entity} porque está en uso.` });
  console.error(`Error al administrar ${entity}:`, error);
  return res.status(500).json({ message: `No se pudo guardar ${entity}.` });
}

configuracionRouter.get('/configuracion/marcas', async (_req, res) => {
  try {
    const result = await db.query('SELECT id, nombre, cuit, activa FROM marca ORDER BY nombre');
    res.json(result.rows);
  } catch (error) { reportError(res, error, 'marcas'); }
});

configuracionRouter.post('/configuracion/marcas', async (req, res) => {
  const nombre = text(req.body?.nombre);
  const cuit = optionalText(req.body?.cuit);
  if (!nombre || !cuitIsValid(cuit)) return res.status(400).json({ message: 'Ingresá un nombre y un CUIT de 11 dígitos válido.' });
  try {
    await db.query('INSERT INTO marca (nombre, cuit) VALUES ($1, $2)', [nombre, cuit]);
    res.status(201).json({ success: true });
  } catch (error) { reportError(res, error, 'la marca'); }
});

configuracionRouter.put('/configuracion/marcas/:id', async (req, res) => {
  const id = Number(req.params.id);
  const nombre = text(req.body?.nombre);
  const cuit = optionalText(req.body?.cuit);
  if (!idIsValid(id) || !nombre || !cuitIsValid(cuit)) return res.status(400).json({ message: 'Revisá el nombre y el CUIT de 11 dígitos.' });
  try {
    const result = await db.query('UPDATE marca SET nombre = $1, cuit = $2 WHERE id = $3 RETURNING id', [nombre, cuit, id]);
    if (!result.rowCount) return res.status(404).json({ message: 'No se encontró la marca.' });
    res.json({ success: true });
  } catch (error) { reportError(res, error, 'la marca'); }
});

configuracionRouter.patch('/configuracion/marcas/:id/estado', async (req, res) => {
  const id = Number(req.params.id);
  if (!idIsValid(id) || typeof req.body?.activa !== 'boolean') return res.status(400).json({ message: 'Indicá el estado de la marca.' });
  try {
    const result = await db.query('UPDATE marca SET activa = $1 WHERE id = $2 RETURNING id', [req.body.activa, id]);
    if (!result.rowCount) return res.status(404).json({ message: 'No se encontró la marca.' });
    res.json({ success: true });
  } catch (error) { reportError(res, error, 'la marca'); }
});

configuracionRouter.get('/configuracion/comercios', async (_req, res) => {
  try {
    const result = await db.query(`SELECT id, razon_social, nombre_fantasia, cuit, domicilio, localidad, contacto, telefono, activo
                                   FROM comercio ORDER BY razon_social`);
    res.json(result.rows);
  } catch (error) { reportError(res, error, 'comercios'); }
});

function commerceValues(body: any) {
  const razonSocial = text(body?.razon_social);
  const domicilio = text(body?.domicilio);
  const cuit = optionalText(body?.cuit);
  if (!razonSocial || !domicilio || !cuitIsValid(cuit)) return null;
  return [razonSocial, optionalText(body?.nombre_fantasia), cuit, domicilio, optionalText(body?.localidad), optionalText(body?.contacto), optionalText(body?.telefono)];
}

configuracionRouter.post('/configuracion/comercios', async (req, res) => {
  const values = commerceValues(req.body);
  if (!values) return res.status(400).json({ message: 'Ingresá razón social, domicilio y un CUIT válido de 11 dígitos.' });
  try {
    await db.query(`INSERT INTO comercio (razon_social, nombre_fantasia, cuit, domicilio, localidad, contacto, telefono)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)`, values);
    res.status(201).json({ success: true });
  } catch (error) { reportError(res, error, 'el comercio'); }
});

configuracionRouter.put('/configuracion/comercios/:id', async (req, res) => {
  const id = Number(req.params.id);
  const values = commerceValues(req.body);
  if (!idIsValid(id) || !values) return res.status(400).json({ message: 'Revisá razón social, domicilio y CUIT.' });
  try {
    const result = await db.query(`UPDATE comercio SET razon_social = $1, nombre_fantasia = $2, cuit = $3,
                                   domicilio = $4, localidad = $5, contacto = $6, telefono = $7,
                                   actualizado_en = now() WHERE id = $8 RETURNING id`, [...values, id]);
    if (!result.rowCount) return res.status(404).json({ message: 'No se encontró el comercio.' });
    res.json({ success: true });
  } catch (error) { reportError(res, error, 'el comercio'); }
});

configuracionRouter.patch('/configuracion/comercios/:id/estado', async (req, res) => {
  const id = Number(req.params.id);
  if (!idIsValid(id) || typeof req.body?.activo !== 'boolean') return res.status(400).json({ message: 'Indicá el estado del comercio.' });
  try {
    const result = await db.query('UPDATE comercio SET activo = $1, actualizado_en = now() WHERE id = $2 RETURNING id', [req.body.activo, id]);
    if (!result.rowCount) return res.status(404).json({ message: 'No se encontró el comercio.' });
    res.json({ success: true });
  } catch (error) { reportError(res, error, 'el comercio'); }
});

configuracionRouter.get('/configuracion/sucursales', async (_req, res) => {
  try {
    const result = await db.query('SELECT id, nombre, domicilio, activa FROM sucursal ORDER BY nombre');
    res.json(result.rows);
  } catch (error) { reportError(res, error, 'sucursales'); }
});

configuracionRouter.post('/configuracion/sucursales', async (req, res) => {
  const nombre = text(req.body?.nombre);
  if (!nombre) return res.status(400).json({ message: 'Ingresá el nombre de la sucursal.' });
  try {
    await db.query('INSERT INTO sucursal (nombre, domicilio) VALUES ($1, $2)', [nombre, optionalText(req.body?.domicilio)]);
    res.status(201).json({ success: true });
  } catch (error) { reportError(res, error, 'la sucursal'); }
});

configuracionRouter.put('/configuracion/sucursales/:id', async (req, res) => {
  const id = Number(req.params.id);
  const nombre = text(req.body?.nombre);
  if (!idIsValid(id) || !nombre) return res.status(400).json({ message: 'Ingresá el nombre de la sucursal.' });
  try {
    const result = await db.query('UPDATE sucursal SET nombre = $1, domicilio = $2 WHERE id = $3 RETURNING id', [nombre, optionalText(req.body?.domicilio), id]);
    if (!result.rowCount) return res.status(404).json({ message: 'No se encontró la sucursal.' });
    res.json({ success: true });
  } catch (error) { reportError(res, error, 'la sucursal'); }
});

configuracionRouter.patch('/configuracion/sucursales/:id/estado', async (req, res) => {
  const id = Number(req.params.id);
  if (!idIsValid(id) || typeof req.body?.activa !== 'boolean') return res.status(400).json({ message: 'Indicá el estado de la sucursal.' });
  try {
    const result = await db.query('UPDATE sucursal SET activa = $1 WHERE id = $2 RETURNING id', [req.body.activa, id]);
    if (!result.rowCount) return res.status(404).json({ message: 'No se encontró la sucursal.' });
    res.json({ success: true });
  } catch (error) { reportError(res, error, 'la sucursal'); }
});

configuracionRouter.get('/configuracion/cuentas-recepcion', async (_req, res) => {
  try {
    const result = await db.query(`SELECT cr.id, cr.sucursal_id, s.nombre AS sucursal, cr.alias, cr.cbu, cr.banco, cr.activa
                                   FROM cuenta_recepcion cr JOIN sucursal s ON s.id = cr.sucursal_id
                                   ORDER BY s.nombre, cr.alias`);
    res.json(result.rows);
  } catch (error) { reportError(res, error, 'las cuentas de recepción'); }
});

configuracionRouter.post('/configuracion/cuentas-recepcion', async (req, res) => {
  const sucursalId = Number(req.body?.sucursal_id);
  const alias = text(req.body?.alias);
  const cbu = optionalText(req.body?.cbu);
  if (!idIsValid(sucursalId) || !alias || (cbu && !/^\d{22}$/.test(cbu))) {
    return res.status(400).json({ message: 'Indicá sucursal, alias y un CBU válido de 22 dígitos si lo cargás.' });
  }
  try {
    const branch = await db.query('SELECT id FROM sucursal WHERE id = $1 AND activa = true', [sucursalId]);
    if (!branch.rowCount) return res.status(400).json({ message: 'Seleccioná una sucursal activa.' });
    await db.query('INSERT INTO cuenta_recepcion (sucursal_id, alias, cbu, banco) VALUES ($1, $2, $3, $4)',
      [sucursalId, alias, cbu, optionalText(req.body?.banco)]);
    res.status(201).json({ success: true });
  } catch (error) { reportError(res, error, 'la cuenta de recepción'); }
});

configuracionRouter.put('/configuracion/cuentas-recepcion/:id', async (req, res) => {
  const id = Number(req.params.id);
  const alias = text(req.body?.alias);
  const cbu = optionalText(req.body?.cbu);
  if (!idIsValid(id) || !alias || (cbu && !/^\d{22}$/.test(cbu))) {
    return res.status(400).json({ message: 'Indicá un alias y un CBU válido de 22 dígitos si lo cargás.' });
  }
  try {
    const result = await db.query('UPDATE cuenta_recepcion SET alias = $1, cbu = $2, banco = $3 WHERE id = $4 RETURNING id',
      [alias, cbu, optionalText(req.body?.banco), id]);
    if (!result.rowCount) return res.status(404).json({ message: 'No se encontró la cuenta de recepción.' });
    res.json({ success: true });
  } catch (error) { reportError(res, error, 'la cuenta de recepción'); }
});

configuracionRouter.patch('/configuracion/cuentas-recepcion/:id/estado', async (req, res) => {
  const id = Number(req.params.id);
  if (!idIsValid(id) || typeof req.body?.activa !== 'boolean') return res.status(400).json({ message: 'Indicá el estado de la cuenta.' });
  try {
    const result = await db.query('UPDATE cuenta_recepcion SET activa = $1 WHERE id = $2 RETURNING id', [req.body.activa, id]);
    if (!result.rowCount) return res.status(404).json({ message: 'No se encontró la cuenta de recepción.' });
    res.json({ success: true });
  } catch (error) { reportError(res, error, 'la cuenta de recepción'); }
});

configuracionRouter.get('/configuracion/permisos-sucursal', async (_req, res) => {
  try {
    const [users, branches, permissions, assignments] = await Promise.all([
      db.query("SELECT id, usuario, nombre, rol FROM usuario WHERE activo = true AND rol <> 'Administrador del sistema' ORDER BY nombre"),
      db.query('SELECT id, nombre FROM sucursal WHERE activa = true ORDER BY nombre'),
      db.query('SELECT codigo, descripcion FROM permiso ORDER BY codigo'),
      db.query(`SELECT us.usuario_id, us.sucursal_id,
                       COALESCE(array_agg(usp.permiso_codigo) FILTER (WHERE usp.permiso_codigo IS NOT NULL), '{}') AS permisos
                FROM usuario_sucursal us
                LEFT JOIN usuario_sucursal_permiso usp USING (usuario_id, sucursal_id)
                GROUP BY us.usuario_id, us.sucursal_id`),
    ]);
    res.json({ usuarios: users.rows, sucursales: branches.rows, permisos: permissions.rows, asignaciones: assignments.rows });
  } catch (error) { reportError(res, error, 'los permisos por sucursal'); }
});

configuracionRouter.put('/configuracion/permisos-sucursal/:usuarioId/:sucursalId', async (req, res) => {
  const usuarioId = Number(req.params.usuarioId);
  const sucursalId = Number(req.params.sucursalId);
  const codes = [...new Set(Array.isArray(req.body?.permisos) ? req.body.permisos.filter((code: unknown) => typeof code === 'string') : [])] as string[];
  if (!idIsValid(usuarioId) || !idIsValid(sucursalId) || !Array.isArray(req.body?.permisos)) {
    return res.status(400).json({ message: 'Indicá usuario, sucursal y una lista de permisos.' });
  }

  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const validUser = await client.query("SELECT id FROM usuario WHERE id = $1 AND activo = true AND rol <> 'Administrador del sistema'", [usuarioId]);
    const validBranch = await client.query('SELECT id FROM sucursal WHERE id = $1 AND activa = true', [sucursalId]);
    const validCodes = await Promise.all(codes.map((code) => client.query('SELECT codigo FROM permiso WHERE codigo = $1', [code])));
    if (!validUser.rows.length || !validBranch.rows.length || validCodes.some((result) => !result.rows.length)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El usuario, la sucursal o algún permiso no es válido.' });
    }

    await client.query('DELETE FROM usuario_sucursal_permiso WHERE usuario_id = $1 AND sucursal_id = $2', [usuarioId, sucursalId]);
    if (codes.length) {
      await client.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [usuarioId, sucursalId]);
      for (const code of codes) {
        await client.query('INSERT INTO usuario_sucursal_permiso (usuario_id, sucursal_id, permiso_codigo) VALUES ($1, $2, $3)', [usuarioId, sucursalId, code]);
      }
    } else {
      await client.query('DELETE FROM usuario_sucursal WHERE usuario_id = $1 AND sucursal_id = $2', [usuarioId, sucursalId]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    reportError(res, error, 'los permisos por sucursal');
  } finally {
    client.release();
  }
});
