import { Router } from 'express';
import bcryptjs from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth } from './authRoutes.js';

export const usuarioRouter = Router();

const roles = ['Administrador del sistema', 'Administrativo', 'Transportista', 'Supervisor', 'Gerente'];
const requireSystemAdmin = (req: any, res: any, next: any) => {
  if (req.userSession?.role !== 'Administrador del sistema') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo el administrador del sistema puede administrar usuarios.' });
  }
  next();
};

usuarioRouter.use('/usuarios', requireAuth, requireSystemAdmin);

usuarioRouter.get('/usuarios', async (_req, res) => {
  try {
    const [users, assignments, branches] = await Promise.all([
      db.query('SELECT id, usuario, nombre, email, rol, activo FROM usuario ORDER BY nombre'),
      db.query(`SELECT us.usuario_id, us.sucursal_id, s.nombre
                FROM usuario_sucursal us JOIN sucursal s ON s.id = us.sucursal_id
                ORDER BY s.nombre`),
      db.query('SELECT id, nombre FROM sucursal WHERE activa = true ORDER BY nombre'),
    ]);
    const assigned = new Map<string, { ids: string[]; names: string[] }>();
    for (const row of assignments.rows) {
      const values = assigned.get(String(row.usuario_id)) || { ids: [], names: [] };
      values.ids.push(String(row.sucursal_id));
      values.names.push(row.nombre);
      assigned.set(String(row.usuario_id), values);
    }
    res.json({
      usuarios: users.rows.map((user) => ({
        ...user,
        sucursal_ids: assigned.get(String(user.id))?.ids || [],
        sucursales: assigned.get(String(user.id))?.names.join(', ') || '',
      })),
      sucursales: branches.rows,
    });
  } catch {
    res.status(500).json({ message: 'No se pudieron cargar los usuarios.' });
  }
});

usuarioRouter.post('/usuarios', async (req, res) => {
  const { usuario, nombre, email, password, rol, sucursalIds } = req.body;
  const branches = [...new Set((Array.isArray(sucursalIds) ? sucursalIds : []).map(Number))];
  if (typeof usuario !== 'string' || !usuario.trim() || typeof nombre !== 'string' || !nombre.trim() ||
      typeof password !== 'string' || password.length < 8 || !roles.includes(rol) || !branches.length ||
      (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
    return res.status(400).json({ message: 'Ingresá usuario, nombre, contraseña de al menos 8 caracteres, rol y sucursal válida.' });
  }

  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    for (const branchId of branches) {
      const validBranch = await client.query('SELECT id FROM sucursal WHERE activa = true AND id = $1', [branchId]);
      if (!validBranch.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Una o más sucursales no existen o están inactivas.' });
      }
    }
    const passwordHash = await bcryptjs.hash(password, 10);
    const created = await client.query(
      `INSERT INTO usuario (usuario, nombre, email, password_hash, rol, es_transportista)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [usuario.trim(), nombre.trim(), email?.trim() || null, passwordHash, rol, rol === 'Transportista']
    );
    for (const branchId of branches) {
      await client.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES ($1, $2)', [created.rows[0].id, branchId]);
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error.code === '23505' ? 409 : 500).json({ message: error.code === '23505' ? 'El usuario o correo ya existe.' : 'No se pudo crear el usuario.' });
  } finally {
    client.release();
  }
});

usuarioRouter.put('/usuarios/:id', async (req: any, res) => {
  const id = Number(req.params.id);
  const { usuario, nombre, email, password, rol, sucursalIds } = req.body;
  const branches = [...new Set((Array.isArray(sucursalIds) ? sucursalIds : []).map(Number))];
  if (!Number.isSafeInteger(id) || id <= 0 || typeof usuario !== 'string' || !usuario.trim() ||
      typeof nombre !== 'string' || !nombre.trim() || !roles.includes(rol) || !branches.length ||
      (password && (typeof password !== 'string' || password.length < 8)) ||
      (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
    return res.status(400).json({ message: 'Revisá los datos del usuario, rol y sucursales.' });
  }
  if (id === Number(String(req.userSession.id).replace('usr_', '')) && rol !== 'Administrador del sistema') {
    return res.status(400).json({ message: 'No podés quitarte el rol de administrador del sistema.' });
  }

  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT id, rol, activo FROM usuario WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No se encontró el usuario.' });
    }
    if (current.rows[0].rol === 'Administrador del sistema' && current.rows[0].activo && rol !== 'Administrador del sistema') {
      const admins = await client.query("SELECT id FROM usuario WHERE rol = 'Administrador del sistema' AND activo = true FOR UPDATE");
      if (admins.rows.length === 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Debe quedar al menos un administrador del sistema activo.' });
      }
    }
    for (const branchId of branches) {
      const validBranch = await client.query('SELECT id FROM sucursal WHERE activa = true AND id = $1', [branchId]);
      if (!validBranch.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Una o más sucursales no existen o están inactivas.' });
      }
    }
    const params: unknown[] = [usuario.trim(), nombre.trim(), email?.trim() || null, rol, rol === 'Transportista', id];
    const passwordSql = password ? ', password_hash = $7' : '';
    if (password) params.push(await bcryptjs.hash(password, 10));
    await client.query(
      `UPDATE usuario SET usuario = $1, nombre = $2, email = $3, rol = $4,
       es_transportista = $5, actualizado_en = now()${passwordSql} WHERE id = $6`, params
    );
    await client.query('DELETE FROM usuario_sucursal WHERE usuario_id = $1', [id]);
    for (const branchId of branches) {
      await client.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES ($1, $2)', [id, branchId]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error.code === '23505' ? 409 : 500).json({ message: error.code === '23505' ? 'El usuario o correo ya existe.' : 'No se pudo actualizar el usuario.' });
  } finally {
    client.release();
  }
});

usuarioRouter.patch('/usuarios/:id/estado', async (req: any, res) => {
  const id = Number(req.params.id);
  const activo = req.body.activo;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof activo !== 'boolean') {
    return res.status(400).json({ message: 'Indicá un usuario y su estado activo.' });
  }
  if (id === Number(String(req.userSession.id).replace('usr_', '')) && !activo) {
    return res.status(400).json({ message: 'No podés desactivar tu propio usuario.' });
  }
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT rol, activo FROM usuario WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No se encontró el usuario.' });
    }
    if (!activo && current.rows[0].rol === 'Administrador del sistema' && current.rows[0].activo) {
      const admins = await client.query("SELECT id FROM usuario WHERE rol = 'Administrador del sistema' AND activo = true FOR UPDATE");
      if (admins.rows.length === 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Debe quedar al menos un administrador del sistema activo.' });
      }
    }
    await client.query('UPDATE usuario SET activo = $1, actualizado_en = now() WHERE id = $2', [activo, id]);
    if (!activo) await client.query("UPDATE sesion_usuario SET revocado = true, revocado_en = now(), motivo_cierre = 'manual' WHERE usuario_id = $1 AND revocado = false", [id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'No se pudo cambiar el estado del usuario.' });
  } finally {
    client.release();
  }
});
