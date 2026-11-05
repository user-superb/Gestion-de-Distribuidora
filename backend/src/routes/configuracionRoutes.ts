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

// HU: Sectorizar los fondos recaudados y limitar su disponibilidad a los operadores autorizados.
// Endpoint para consultar cuentas de recepción disponibles según la sucursal del operador autorizado.
// - Administrador del sistema: puede ver todas las cuentas activas de todas las sucursales operativas vigentes (o filtrar por ?sucursal_id).
// - Administrativo / Operador / Transportista: restringido automáticamente a las sucursales asignadas en `usuario_sucursal`.
configuracionRouter.get('/cuentas-recepcion-operativas', requireAuth, async (req, res) => {
  try {
    const user = (req as any).userSession;
    if (!user) return res.status(401).json({ message: 'No autenticado.' });

    const userId = Number(String(user.id || '').replace(/^usr_/, ''));
    const isSystemAdmin = user.role === 'Administrador del sistema';
    const sucursalIdParam = req.query.sucursal_id ? Number(req.query.sucursal_id) : undefined;

    let query: string;
    let params: any[];

    if (isSystemAdmin) {
      if (sucursalIdParam && idIsValid(sucursalIdParam)) {
        query = `
          SELECT cr.id, cr.sucursal_id, s.nombre AS sucursal, cr.nombre_fantasia, cr.alias, cr.cbu, cr.banco, cr.moneda, cr.activa
          FROM cuenta_recepcion cr
          JOIN sucursal s ON s.id = cr.sucursal_id
          WHERE cr.activa = true AND s.activa = true AND cr.sucursal_id = $1
          ORDER BY s.nombre, cr.alias
        `;
        params = [sucursalIdParam];
      } else {
        query = `
          SELECT cr.id, cr.sucursal_id, s.nombre AS sucursal, cr.nombre_fantasia, cr.alias, cr.cbu, cr.banco, cr.moneda, cr.activa
          FROM cuenta_recepcion cr
          JOIN sucursal s ON s.id = cr.sucursal_id
          WHERE cr.activa = true AND s.activa = true
          ORDER BY s.nombre, cr.alias
        `;
        params = [];
      }
    } else {
      query = `
        SELECT cr.id, cr.sucursal_id, s.nombre AS sucursal, cr.nombre_fantasia, cr.alias, cr.cbu, cr.banco, cr.moneda, cr.activa
        FROM cuenta_recepcion cr
        JOIN sucursal s ON s.id = cr.sucursal_id
        JOIN usuario_sucursal us ON us.sucursal_id = cr.sucursal_id
        WHERE us.usuario_id = $1 AND cr.activa = true AND s.activa = true
        ${sucursalIdParam && idIsValid(sucursalIdParam) ? 'AND cr.sucursal_id = $2' : ''}
        ORDER BY s.nombre, cr.alias
      `;
      params = sucursalIdParam && idIsValid(sucursalIdParam) ? [userId, sucursalIdParam] : [userId];
    }

    const result = await db.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    reportError(res, error, 'las cuentas de recepción operativas');
  }
});

configuracionRouter.use('/configuracion', requireAuth, requireSystemAdmin);

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value: unknown) => text(value) || null;
const idIsValid = (id: number) => Number.isSafeInteger(id) && id > 0;
const cuitIsValid = (value: unknown) => !text(value) || /^\d{11}$/.test(text(value));

export function validarCbuChecksum(cbu: string): boolean {
  if (typeof cbu !== 'string' || !/^\d{22}$/.test(cbu)) return false;
  const p1 = cbu.slice(0, 8);
  const p2 = cbu.slice(8, 22);

  const coef1 = [7, 1, 3, 9, 7, 1, 3];
  let sum1 = 0;
  for (let i = 0; i < 7; i++) {
    sum1 += parseInt(p1[i], 10) * coef1[i];
  }
  const dv1 = (10 - (sum1 % 10)) % 10;
  if (dv1 !== parseInt(p1[7], 10)) return false;

  const coef2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  let sum2 = 0;
  for (let i = 0; i < 13; i++) {
    sum2 += parseInt(p2[i], 10) * coef2[i];
  }
  const dv2 = (10 - (sum2 % 10)) % 10;
  if (dv2 !== parseInt(p2[13], 10)) return false;

  return true;
}

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
    const result = await db.query(`SELECT cr.id, cr.sucursal_id, s.nombre AS sucursal,
                                          cr.nombre_fantasia, cr.alias, cr.cbu, cr.banco,
                                          cr.cuit_titular, cr.moneda, cr.activa,
                                          (mov.cuenta_id IS NOT NULL) AS tiene_movimientos,
                                          (disc.cuenta_id IS NOT NULL) AS en_conciliacion_activa,
                                          (liq.sucursal_id IS NOT NULL) AS periodo_contable_bloqueado
                                   FROM cuenta_recepcion cr
                                   JOIN sucursal s ON s.id = cr.sucursal_id
                                   LEFT JOIN (
                                     SELECT DISTINCT cuenta_id FROM movimiento_bancario
                                   ) mov ON mov.cuenta_id = cr.id
                                   LEFT JOIN (
                                     SELECT DISTINCT mb.cuenta_id
                                     FROM discrepancia_conciliacion dc
                                     JOIN movimiento_bancario mb ON mb.id = dc.movimiento_id
                                     WHERE dc.estado IN ('pendiente', 'escalada')
                                   ) disc ON disc.cuenta_id = cr.id
                                   LEFT JOIN (
                                     SELECT DISTINCT sucursal_id
                                     FROM liquidacion
                                     WHERE estado IN ('cerrada', 'rendida')
                                   ) liq ON liq.sucursal_id = cr.sucursal_id
                                   ORDER BY s.nombre, cr.alias`);
    res.json(result.rows);
  } catch (error) { reportError(res, error, 'las cuentas de recepción'); }
});

configuracionRouter.post('/configuracion/cuentas-recepcion', async (req, res) => {
  const sucursalId = Number(req.body?.sucursal_id);
  const alias = text(req.body?.alias);
  const cbu = text(req.body?.cbu);
  const banco = text(req.body?.banco);
  const cuitTitular = text(req.body?.cuit_titular);
  const moneda = text(req.body?.moneda || 'ARS').toUpperCase() || 'ARS';

  // Obligatoriedad según HU: CBU, Alias, Banco emisor, CUIT/CUIL del titular y Tipo/Moneda
  if (!idIsValid(sucursalId) || !alias || !banco || !cuitTitular) {
    return res.status(400).json({
      error: 'DATOS_REQUERIDOS',
      message: 'Indicá sucursal, alias, banco emisor y CUIT/CUIL del titular de la cuenta.',
    });
  }

  // CUIT/CUIL numérico de 11 dígitos
  if (!/^\d{11}$/.test(cuitTitular)) {
    return res.status(400).json({
      error: 'FORMATO_CUIT_INVALIDO',
      field: 'cuit_titular',
      message: 'El CUIT/CUIL del titular debe contener exactamente 11 dígitos numéricos.',
    });
  }

  // ESCENARIO 3: Fallo por formato de CBU inválido (22 dígitos numéricos + checksum bancario)
  if (!cbu || !/^\d{22}$/.test(cbu) || !validarCbuChecksum(cbu)) {
    return res.status(400).json({
      error: 'FORMATO_CBU_INVALIDO',
      field: 'cbu',
      message: 'El CBU ingresado no es válido: debe contener exactamente 22 dígitos numéricos y superar la verificación de checksum bancario.',
    });
  }

  if (!['ARS', 'USD'].includes(moneda)) {
    return res.status(400).json({ message: 'La moneda debe ser ARS o USD.' });
  }

  try {
    const branch = await db.query('SELECT id FROM sucursal WHERE id = $1 AND activa = true', [sucursalId]);
    if (!branch.rowCount) {
      return res.status(422).json({
        error: 'SUCURSAL_INACTIVA',
        message: 'La sucursal se encuentra deshabilitada o dada de baja en el catálogo general.',
      });
    }

    // ESCENARIO 2: Fallo por CBU o Alias duplicado globalmente entre cuentas del sistema
    const duplicateGlobal = await db.query(
      `SELECT alias, cbu FROM cuenta_recepcion
       WHERE lower(alias) = lower($1) OR cbu = $2`,
      [alias, cbu]
    );

    if (duplicateGlobal.rowCount) {
      const existing = duplicateGlobal.rows[0];
      const esAliasDuplicado = existing.alias.toLowerCase() === alias.toLowerCase();
      const esCbuDuplicado = existing.cbu === cbu;

      const detalleDuplicado = esAliasDuplicado && esCbuDuplicado
        ? 'el CBU y el Alias ya se encuentran registrados'
        : esCbuDuplicado
          ? 'el CBU ya se encuentra registrado'
          : 'el Alias ya se encuentra registrado';

      return res.status(409).json({
        error: 'DATO_BANCARIO_DUPLICADO',
        message: `No se pudo registrar la cuenta porque ${detalleDuplicado} en otra cuenta existente del sistema.`,
      });
    }

    // ESCENARIO 1: Alta exitosa de cuenta receptora (activa = true por defecto)
    const result = await db.query(
      `INSERT INTO cuenta_recepcion (sucursal_id, nombre_fantasia, alias, cbu, banco, cuit_titular, moneda, activa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id, sucursal_id, nombre_fantasia, alias, cbu, banco, cuit_titular, moneda, activa`,
      [
        sucursalId,
        optionalText(req.body?.nombre_fantasia),
        alias,
        cbu,
        banco,
        cuitTitular,
        moneda,
      ]
    );

    res.status(201).json({
      success: true,
      cuenta: result.rows[0],
      message: 'Cuenta bancaria de recepción dada de alta exitosamente en estado activa.',
    });
  } catch (error) { reportError(res, error, 'la cuenta de recepción'); }
});

configuracionRouter.put('/configuracion/cuentas-recepcion/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!idIsValid(id)) return res.status(400).json({ message: 'ID de cuenta inválido.' });

  const alias = text(req.body?.alias);
  const cbu = optionalText(req.body?.cbu);
  const cuitTitular = optionalText(req.body?.cuit_titular);
  const moneda = text(req.body?.moneda || '').toUpperCase();
  const sucursalId = req.body?.sucursal_id !== undefined ? Number(req.body?.sucursal_id) : undefined;
  const nombreFantasia = req.body?.nombre_fantasia !== undefined ? optionalText(req.body?.nombre_fantasia) : undefined;
  const banco = req.body?.banco !== undefined ? optionalText(req.body?.banco) : undefined;

    if (!alias) {
      return res.status(400).json({ message: 'Indicá un alias para la cuenta.' });
    }
    if (cbu) {
      if (!/^\d{22}$/.test(cbu) || !validarCbuChecksum(cbu)) {
        return res.status(400).json({
          error: 'FORMATO_CBU_INVALIDO',
          field: 'cbu',
          message: 'El CBU ingresado no es válido: debe contener exactamente 22 dígitos numéricos y superar la verificación de checksum bancario.',
        });
      }
    }
    if (cuitTitular && !/^\d{11}$/.test(cuitTitular)) {
      return res.status(400).json({ message: 'El CUIT del titular debe tener 11 dígitos numéricos.' });
    }
    if (moneda && !['ARS', 'USD'].includes(moneda)) {
      return res.status(400).json({ message: 'La moneda debe ser ARS o USD.' });
    }
    if (sucursalId !== undefined && !idIsValid(sucursalId)) {
      return res.status(400).json({ message: 'La sucursal asignada no es válida.' });
    }

  try {
    const existing = await db.query(
      `SELECT cr.*, s.nombre AS sucursal_nombre
       FROM cuenta_recepcion cr
       JOIN sucursal s ON s.id = cr.sucursal_id
       WHERE cr.id = $1`,
      [id]
    );
    if (!existing.rowCount) return res.status(404).json({ message: 'No se encontró la cuenta de recepción.' });
    const current = existing.rows[0];

    // ESCENARIO 2: Fallo por cuenta en conciliación o cierre contable bloqueado
    // Verificar si participa en una conciliación en curso o período mensual cerrado/bloqueado
    const enConciliacionRes = await db.query(
      `SELECT 1
       FROM discrepancia_conciliacion dc
       JOIN movimiento_bancario mb ON mb.id = dc.movimiento_id
       WHERE mb.cuenta_id = $1 AND dc.estado IN ('pendiente', 'escalada')
       LIMIT 1`,
      [id]
    );
    const periodoBloqueadoRes = await db.query(
      `SELECT 1
       FROM liquidacion l
       WHERE l.sucursal_id = $1 AND l.estado IN ('cerrada', 'rendida')
       LIMIT 1`,
      [current.sucursal_id]
    );

    const cuentaInmovilizada = Boolean(enConciliacionRes.rowCount || periodoBloqueadoRes.rowCount);
    if (cuentaInmovilizada) {
      return res.status(422).json({
        error: 'CUENTA_INMOVILIZADA',
        message: 'La cuenta se encuentra temporalmente inmovilizada para cambios debido a un proceso de conciliación activo o un período contable bloqueado por auditoría.',
      });
    }

    // ESCENARIO 3: Bloqueo de edición sobre datos estructurales con histórico
    // Si la cuenta posee movimientos bancarios o cobros asentados previamente, no se pueden alterar CBU, CUIT titular ni moneda.
    const movimientosRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM movimiento_bancario WHERE cuenta_id = $1`,
      [id]
    );
    const cobrosRes = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM cobro c
       JOIN movimiento_bancario mb ON mb.id = c.movimiento_bancario_id
       WHERE mb.cuenta_id = $1`,
      [id]
    );
    const tieneHistorico = (movimientosRes.rows[0]?.count || 0) > 0 || (cobrosRes.rows[0]?.count || 0) > 0;

    const normalizar = (val: string | null | undefined) => (val || '').trim();
    const cbuActual = normalizar(current.cbu);
    const cuitActual = normalizar(current.cuit_titular);
    const monedaActual = normalizar(current.moneda || 'ARS');

    const cbuNuevo = normalizar(cbu);
    const cuitNuevo = normalizar(cuitTitular);
    const monedaNueva = normalizar(moneda || monedaActual);

    if (tieneHistorico) {
      const intentoCambiarCbu = cbu !== undefined && cbuNuevo !== cbuActual;
      const intentoCambiarCuit = cuitTitular !== undefined && cuitNuevo !== cuitActual;
      const intentoCambiarMoneda = moneda !== '' && monedaNueva !== monedaActual;

      if (intentoCambiarCbu || intentoCambiarCuit || intentoCambiarMoneda) {
        return res.status(409).json({
          error: 'DATOS_ESTRUCTURALES_BLOQUEADOS',
          message: 'No está permitido modificar datos estructurales (CBU, CUIT del titular o moneda) en una cuenta con movimientos históricos asentados.',
        });
      }
    }

    // Validar sucursal si se desea cambiar o asociar
    const nuevaSucursalId = sucursalId !== undefined ? sucursalId : current.sucursal_id;
    if (sucursalId !== undefined && sucursalId !== current.sucursal_id) {
      const branchCheck = await db.query('SELECT id, activa FROM sucursal WHERE id = $1', [nuevaSucursalId]);
      if (!branchCheck.rowCount || !branchCheck.rows[0].activa) {
        return res.status(422).json({
          error: 'SUCURSAL_INACTIVA',
          message: 'La sucursal se encuentra deshabilitada o dada de baja en el catálogo general.',
        });
      }
    }

    // Validar unicidad global de CBU y Alias si cambian
    const aliasCheck = await db.query(
      'SELECT id FROM cuenta_recepcion WHERE lower(alias) = lower($1) AND id <> $2',
      [alias, id]
    );
    if (aliasCheck.rowCount) {
      return res.status(409).json({
        error: 'ALIAS_DUPLICADO',
        message: 'No se pudo guardar la cuenta porque el Alias ya se encuentra registrado en otra cuenta del sistema.',
      });
    }

    if (cbuNuevo && !tieneHistorico) {
      const cbuCheck = await db.query(
        'SELECT id FROM cuenta_recepcion WHERE cbu = $1 AND id <> $2',
        [cbuNuevo, id]
      );
      if (cbuCheck.rowCount) {
        return res.status(409).json({
          error: 'CBU_DUPLICADO',
          message: 'No se pudo guardar la cuenta porque el CBU ya se encuentra registrado en otra cuenta del sistema.',
        });
      }
    }

    // ESCENARIO 1: Modificación exitosa de datos operativos
    const finalCbu = tieneHistorico ? current.cbu : cbu;
    const finalCuit = tieneHistorico ? current.cuit_titular : cuitTitular;
    const finalMoneda = tieneHistorico ? current.moneda : (moneda || current.moneda || 'ARS');
    const finalNombreFantasia = nombreFantasia !== undefined ? nombreFantasia : current.nombre_fantasia;
    const finalBanco = banco !== undefined ? banco : current.banco;

    const result = await db.query(
      `UPDATE cuenta_recepcion
       SET alias = $1,
           nombre_fantasia = $2,
           sucursal_id = $3,
           banco = $4,
           cbu = $5,
           cuit_titular = $6,
           moneda = $7,
           actualizado_en = now()
       WHERE id = $8
       RETURNING id, sucursal_id, alias, nombre_fantasia, banco, cbu, cuit_titular, moneda, activa`,
      [alias, finalNombreFantasia, nuevaSucursalId, finalBanco, finalCbu, finalCuit, finalMoneda, id]
    );

    res.json({
      success: true,
      cuenta: result.rows[0],
      message: 'Cuenta de recepción actualizada exitosamente.',
    });
  } catch (error) { reportError(res, error, 'la cuenta de recepción'); }
});

configuracionRouter.post('/configuracion/cuentas-recepcion/:id/asociar', async (req, res) => {
  const id = Number(req.params.id);
  const sucursalId = Number(req.body?.sucursal_id);

  if (!idIsValid(id)) {
    return res.status(400).json({ message: 'ID de cuenta inválido.' });
  }
  if (!idIsValid(sucursalId)) {
    return res.status(400).json({ message: 'Indicá una sucursal válida.' });
  }

  try {
    const accountRes = await db.query(
      `SELECT cr.*, s.nombre AS sucursal_nombre
       FROM cuenta_recepcion cr
       JOIN sucursal s ON s.id = cr.sucursal_id
       WHERE cr.id = $1`,
      [id]
    );

    if (!accountRes.rowCount) {
      return res.status(404).json({ message: 'No se encontró la cuenta de recepción.' });
    }

    const account = accountRes.rows[0];

    // Regla: La cuenta receptora debe encontrarse activa para asociarse
    if (!account.activa) {
      return res.status(422).json({
        error: 'CUENTA_INACTIVA',
        message: 'La cuenta receptora debe encontrarse activa para asociarse a una sucursal.',
      });
    }

    // ESCENARIO 3: Fallo por cuenta previamente asociada a la sucursal
    if (Number(account.sucursal_id) === sucursalId) {
      return res.status(409).json({
        error: 'CUENTA_PREVIAMENTE_ASOCIADA',
        message: 'La cuenta ya se encuentra configurada para esa unidad operativa.',
      });
    }

    // ESCENARIO 2: Fallo por sucursal inactiva o dada de baja
    const branchRes = await db.query('SELECT id, nombre, activa FROM sucursal WHERE id = $1', [sucursalId]);
    if (!branchRes.rowCount || !branchRes.rows[0].activa) {
      return res.status(422).json({
        error: 'SUCURSAL_INACTIVA',
        message: 'La sucursal se encuentra deshabilitada o dada de baja en el catálogo general.',
      });
    }

    // Verificar si en la sucursal destino ya existe otra cuenta con el mismo alias
    const aliasClash = await db.query(
      'SELECT id FROM cuenta_recepcion WHERE lower(alias) = lower($1) AND id <> $2',
      [account.alias, id]
    );
    if (aliasClash.rowCount) {
      return res.status(409).json({
        error: 'ALIAS_DUPLICADO_SUCURSAL',
        message: 'Ya existe una cuenta con ese alias en el sistema.',
      });
    }

    // ESCENARIO 1: Asociación exitosa a sucursal activa
    const updateRes = await db.query(
      `UPDATE cuenta_recepcion
       SET sucursal_id = $1, actualizado_en = now()
       WHERE id = $2
       RETURNING id, sucursal_id, alias, nombre_fantasia, banco, cbu, cuit_titular, moneda, activa`,
      [sucursalId, id]
    );

    return res.status(200).json({
      success: true,
      cuenta: updateRes.rows[0],
      message: 'Cuenta asociada a la sucursal exitosamente.',
    });
  } catch (error) {
    reportError(res, error, 'la asociación de cuenta bancaria');
  }
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
