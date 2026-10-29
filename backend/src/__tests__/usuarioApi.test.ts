import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authRouter } from '../routes/authRoutes.js';
import { usuarioRouter } from '../routes/usuarioRoutes.js';
import { configuracionRouter } from '../routes/configuracionRoutes.js';

const password = 'Password123!';
let pool: any;

function responseMock() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    setHeader() { return this; },
  };
}

function routeHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((item: any) => item.route?.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `No route ${method} ${path}`);
  return layer.route.stack[0].handle;
}

async function dispatch(router: any, method: string, path: string, body?: any, token?: string) {
  const req: any = {
    method, url: path, body, params: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  };
  const res = responseMock();
  for (const layer of router.stack.filter((item: any) => !item.route)) {
    let continued = false;
    await layer.handle(req, res, (error?: unknown) => {
      if (error) throw error;
      continued = true;
    });
    if (!continued) return res;
  }
  const id = path.match(/^\/usuarios\/(\d+)/)?.[1] || path.match(/^\/configuracion\/(?:marcas|comercios|sucursales)\/(\d+)/)?.[1];
  const permissionIds = path.match(/^\/configuracion\/permisos-sucursal\/(\d+)\/(\d+)/);
  if (id) req.params.id = id;
  if (permissionIds) [req.params.usuarioId, req.params.sucursalId] = permissionIds.slice(1);
  const routePath = path
    .replace(/^\/usuarios\/\d+/, '/usuarios/:id')
    .replace(/^\/configuracion\/(marcas|comercios|sucursales)\/\d+/, '/configuracion/$1/:id')
    .replace(/^\/configuracion\/permisos-sucursal\/\d+\/\d+/, '/configuracion/permisos-sucursal/:usuarioId/:sucursalId');
  await routeHandler(router, method, routePath)(req, res, () => undefined);
  return res;
}

async function login(identifier: string) {
  const req = {
    body: { identifier, password }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test' },
  };
  const res = responseMock();
  await routeHandler(authRouter, 'post', '/auth/login')(req, res);
  return res;
}

async function adminToken() {
  const result = await login('admin@example.com');
  assert.equal(result.statusCode, 200);
  return result.body.session.token;
}

describe('API de administración de usuarios', () => {
  beforeEach(async () => {
    const memory = newDb();
    memory.public.none(`
      CREATE TABLE sucursal (id serial PRIMARY KEY, nombre text NOT NULL UNIQUE, domicilio text, activa boolean NOT NULL DEFAULT true);
      CREATE TABLE usuario (
        id serial PRIMARY KEY, usuario text NOT NULL UNIQUE, nombre text NOT NULL, email text,
        password_hash text NOT NULL, rol text NOT NULL DEFAULT 'Administrativo',
        limite_autorizacion_centavos bigint NOT NULL DEFAULT 0,
        es_transportista boolean NOT NULL DEFAULT false, activo boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now(), actualizado_en timestamp DEFAULT now(),
        CHECK (rol IN ('Administrador del sistema', 'Administrativo', 'Transportista', 'Supervisor', 'Gerente'))
      );
      CREATE UNIQUE INDEX usuario_nombre_login_unico ON usuario (lower(usuario));
      CREATE UNIQUE INDEX usuario_email_login_unico ON usuario (lower(email)) WHERE email IS NOT NULL;
      CREATE TABLE usuario_sucursal (usuario_id bigint NOT NULL, sucursal_id bigint NOT NULL, PRIMARY KEY (usuario_id, sucursal_id));
      CREATE TABLE permiso (codigo text PRIMARY KEY, descripcion text NOT NULL);
      CREATE TABLE usuario_sucursal_permiso (usuario_id bigint NOT NULL, sucursal_id bigint NOT NULL, permiso_codigo text NOT NULL, PRIMARY KEY (usuario_id, sucursal_id, permiso_codigo));
      CREATE TABLE marca (id serial PRIMARY KEY, nombre text NOT NULL UNIQUE, cuit char(11), activa boolean NOT NULL DEFAULT true);
      CREATE TABLE comercio (id serial PRIMARY KEY, razon_social text NOT NULL, nombre_fantasia text, cuit char(11), domicilio text NOT NULL, localidad text, contacto text, telefono text, activo boolean NOT NULL DEFAULT true, actualizado_en timestamp DEFAULT now());
      CREATE TABLE sesion_usuario (
        id text PRIMARY KEY, usuario_id bigint NOT NULL, token text NOT NULL UNIQUE,
        ip_address text, user_agent text, creado_en timestamp DEFAULT now(), ultimo_acceso timestamp DEFAULT now(),
        expira_en timestamp NOT NULL, revocado boolean NOT NULL DEFAULT false, revocado_en timestamp, motivo_cierre text
      );
      INSERT INTO sucursal (nombre) VALUES ('Central'), ('Depósito');
      INSERT INTO permiso (codigo, descripcion) VALUES ('comercio.ver', 'Consultar comercios'), ('imputacion.crear', 'Imputar cobros a remitos');
    `);
    const hash = bcryptjs.hashSync(password, 10);
    memory.public.none(`
      INSERT INTO usuario (usuario, nombre, email, password_hash, rol) VALUES
        ('admin', 'Admin Sistema', 'admin@example.com', '${hash}', 'Administrador del sistema'),
        ('operador', 'Operador', 'operador@example.com', '${hash}', 'Administrativo'),
        ('admin2', 'Otro Admin', 'admin2@example.com', '${hash}', 'Administrador del sistema');
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (1, 1), (2, 1), (3, 2);
    `);
    pool = new (memory.adapters.createPg().Pool)();
    db.setPool(pool);

  });

  afterEach(async () => {
    await pool.end();
  });

  it('restringe el ABM al administrador del sistema', async () => {
    const anonymous = await dispatch(usuarioRouter, 'get', '/usuarios');
    assert.equal(anonymous.statusCode, 401);

    const operator = await login('operador@example.com');
    assert.equal(operator.statusCode, 200);
    const forbidden = await dispatch(usuarioRouter, 'get', '/usuarios', undefined, operator.body.session.token);
    assert.equal(forbidden.statusCode, 403);
  });

  it('lista usuarios y sucursales sin exponer hashes de contraseña', async () => {
    const response = await dispatch(usuarioRouter, 'get', '/usuarios', undefined, await adminToken());
    const data = response.body;
    assert.equal(response.statusCode, 200);
    assert.equal(data.usuarios.length, 3);
    assert.equal(data.sucursales.length, 2);
    assert.equal(data.usuarios[0].password_hash, undefined);
    assert.deepEqual(data.usuarios.find((user: any) => user.usuario === 'admin').sucursal_ids, ['1']);
  });

  it('crea usuario con rol y sucursales y guarda la contraseña como hash', async () => {
    const response = await dispatch(usuarioRouter, 'post', '/usuarios', { usuario: 'nuevo', nombre: 'Usuario Nuevo', email: 'nuevo@example.com', password, rol: 'Transportista', sucursalIds: [1, 2], limiteAutorizacionCentavos: 250000 }, await adminToken());
    assert.equal(response.statusCode, 201);
    const user = await db.query("SELECT id, password_hash, rol, es_transportista, limite_autorizacion_centavos FROM usuario WHERE usuario = 'nuevo'");
    assert.equal(user.rows[0].rol, 'Transportista');
    assert.equal(user.rows[0].es_transportista, true);
    assert.equal(Number(user.rows[0].limite_autorizacion_centavos), 250000);
    assert.notEqual(user.rows[0].password_hash, password);
    assert.equal(await bcryptjs.compare(password, user.rows[0].password_hash), true);
    const branches = await db.query('SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = $1 ORDER BY sucursal_id', [user.rows[0].id]);
    assert.deepEqual(branches.rows.map((row) => Number(row.sucursal_id)), [1, 2]);
  });

  it('rechaza datos inválidos, sucursales inactivas y nombres duplicados', async () => {
    const token = await adminToken();
    const invalid = await dispatch(usuarioRouter, 'post', '/usuarios', { usuario: 'nuevo', nombre: 'Nuevo', password: 'corta', rol: 'Administrativo', sucursalIds: [1] }, token);
    assert.equal(invalid.statusCode, 400);

    const missingBranch = await dispatch(usuarioRouter, 'post', '/usuarios', { usuario: 'nuevo', nombre: 'Nuevo', password, rol: 'Administrativo', sucursalIds: [999] }, token);
    assert.equal(missingBranch.statusCode, 400);

    const duplicate = await dispatch(usuarioRouter, 'post', '/usuarios', { usuario: 'ADMIN', nombre: 'Duplicado', password, rol: 'Administrativo', sucursalIds: [1] }, token);
    assert.equal(duplicate.statusCode, 409);
  });

  it('edita datos, rol, sucursales y contraseña de un usuario', async () => {
    const response = await dispatch(usuarioRouter, 'put', '/usuarios/2', { usuario: 'operador2', nombre: 'Operador Editado', email: 'operador2@example.com', password: 'NuevaClave123!', rol: 'Transportista', sucursalIds: [2] }, await adminToken());
    assert.equal(response.statusCode, 200);
    const user = await db.query('SELECT usuario, nombre, password_hash, rol, es_transportista FROM usuario WHERE id = 2');
    assert.equal(user.rows[0].usuario, 'operador2');
    assert.equal(user.rows[0].nombre, 'Operador Editado');
    assert.equal(user.rows[0].rol, 'Transportista');
    assert.equal(user.rows[0].es_transportista, true);
    assert.equal(await bcryptjs.compare('NuevaClave123!', user.rows[0].password_hash), true);
    const branches = await db.query('SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = 2');
    assert.deepEqual(branches.rows.map((row) => Number(row.sucursal_id)), [2]);
  });

  it('desactivar revoca sesiones e impide iniciar sesión', async () => {
    const operator = await login('operador@example.com');
    assert.equal(operator.statusCode, 200);
    const response = await dispatch(usuarioRouter, 'patch', '/usuarios/2/estado', { activo: false }, await adminToken());
    assert.equal(response.statusCode, 200);
    const verifyReq: any = { headers: { authorization: `Bearer ${operator.body.session.token}` } };
    const verifyRes = responseMock();
    await routeHandler(authRouter, 'get', '/auth/verify')(verifyReq, verifyRes);
    assert.equal(verifyRes.statusCode, 401);
    const disabledLogin = await login('operador@example.com');
    assert.equal(disabledLogin.statusCode, 401);
  });

  it('permite desactivar otro administrador pero protege la propia cuenta y deja un administrador activo', async () => {
    const token = await adminToken();
    assert.equal((await db.query("SELECT id FROM usuario WHERE rol = 'Administrador del sistema' AND activo = true")).rows.length, 2);
    const disable = await dispatch(usuarioRouter, 'patch', '/usuarios/1/estado', { activo: false }, token);
    assert.equal(disable.statusCode, 400);

    const disableOther = await dispatch(usuarioRouter, 'patch', '/usuarios/3/estado', { activo: false }, token);
    assert.equal(disableOther.statusCode, 200);
    assert.equal((await db.query("SELECT id FROM usuario WHERE rol = 'Administrador del sistema' AND activo = true")).rows.length, 1);

    const demote = await dispatch(usuarioRouter, 'put', '/usuarios/1', { usuario: 'admin', nombre: 'Admin Sistema', email: 'admin@example.com', rol: 'Administrativo', sucursalIds: [1] }, token);
    assert.equal(demote.statusCode, 400);
    assert.equal((await db.query('SELECT activo, rol FROM usuario WHERE id = 1')).rows[0].rol, 'Administrador del sistema');
  });

  it('administra marcas, comercios y sucursales desde configuración', async () => {
    const token = await adminToken();
    const operator = await login('operador@example.com');
    const forbidden = await dispatch(configuracionRouter, 'get', '/configuracion/marcas', undefined, operator.body.session.token);
    assert.equal(forbidden.statusCode, 403);

    const brand = await dispatch(configuracionRouter, 'post', '/configuracion/marcas', { nombre: 'Marca nueva', cuit: '20304050602' }, token);
    assert.equal(brand.statusCode, 201);
    const brands = await dispatch(configuracionRouter, 'get', '/configuracion/marcas', undefined, token);
    assert.equal(brands.body[0].nombre, 'Marca nueva');
    const updatedBrand = await dispatch(configuracionRouter, 'put', `/configuracion/marcas/${brands.body[0].id}`, { nombre: 'Marca editada', cuit: '' }, token);
    assert.equal(updatedBrand.statusCode, 200);

    const commerce = await dispatch(configuracionRouter, 'post', '/configuracion/comercios', { razon_social: 'Comercio nuevo', domicilio: 'Calle 1', localidad: 'La Plata' }, token);
    assert.equal(commerce.statusCode, 201);
    const commerces = await dispatch(configuracionRouter, 'get', '/configuracion/comercios', undefined, token);
    assert.equal(commerces.body[0].razon_social, 'Comercio nuevo');

    const branch = await dispatch(configuracionRouter, 'post', '/configuracion/sucursales', { nombre: 'Sucursal nueva', domicilio: 'Calle 2' }, token);
    assert.equal(branch.statusCode, 201);
    const branches = await dispatch(configuracionRouter, 'get', '/configuracion/sucursales', undefined, token);
    const createdBranch = branches.body.find((item: any) => item.nombre === 'Sucursal nueva');
    assert.ok(createdBranch);
    const deactivated = await dispatch(configuracionRouter, 'patch', `/configuracion/sucursales/${createdBranch.id}/estado`, { activa: false }, token);
    assert.equal(deactivated.statusCode, 200);
  });

  it('asigna permisos a un usuario por sucursal y los reemplaza al guardar', async () => {
    const token = await adminToken();
    const saved = await dispatch(configuracionRouter, 'put', '/configuracion/permisos-sucursal/2/2', { permisos: ['comercio.ver', 'imputacion.crear'] }, token);
    assert.equal(saved.statusCode, 200);
    const state = await dispatch(configuracionRouter, 'get', '/configuracion/permisos-sucursal', undefined, token);
    const assignment = state.body.asignaciones.find((item: any) => String(item.usuario_id) === '2' && String(item.sucursal_id) === '2');
    assert.deepEqual(assignment.permisos.sort(), ['comercio.ver', 'imputacion.crear']);
    assert.equal((await db.query('SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = 2 AND sucursal_id = 2')).rows.length, 1);

    const cleared = await dispatch(configuracionRouter, 'put', '/configuracion/permisos-sucursal/2/2', { permisos: [] }, token);
    assert.equal(cleared.statusCode, 200);
    assert.equal((await db.query('SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = 2 AND sucursal_id = 2')).rows.length, 0);
  });
});
