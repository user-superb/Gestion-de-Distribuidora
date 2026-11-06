import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authRouter } from '../routes/authRoutes.js';
import { conciliacionRouter } from '../routes/conciliacionRoutes.js';
import { configuracionRouter } from '../routes/configuracionRoutes.js';
import { usuarioRouter } from '../routes/usuarioRoutes.js';

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
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function dispatch(router: any, method: string, path: string, body?: any, token?: string) {
  const req: any = {
    method, url: path, body, params: {}, query: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  };

  const queryIndex = path.indexOf('?');
  let cleanPath = path;
  if (queryIndex !== -1) {
    const queryString = path.slice(queryIndex + 1);
    cleanPath = path.slice(0, queryIndex);
    const searchParams = new URLSearchParams(queryString);
    for (const [key, val] of searchParams.entries()) {
      req.query[key] = val;
    }
  }

  const res = responseMock();
  for (const layer of router.stack.filter((item: any) => !item.route)) {
    let continued = false;
    await layer.handle(req, res, (error?: unknown) => {
      if (error) throw error;
      continued = true;
    });
    if (!continued) return res;
  }

  const id = cleanPath.match(/^\/(?:usuarios|configuracion\/(?:marcas|comercios|sucursales))\/(\d+)/)?.[1];
  const permissionIds = cleanPath.match(/^\/configuracion\/permisos-sucursal\/(\d+)\/(\d+)/);
  const userBranchIds = cleanPath.match(/^\/usuarios\/(\d+)\/sucursales\/(\d+)/);
  if (id) req.params.id = id;
  if (permissionIds) [req.params.usuarioId, req.params.sucursalId] = permissionIds.slice(1);
  if (userBranchIds) [req.params.id, req.params.sucursalId] = userBranchIds.slice(1);

  const routePath = cleanPath
    .replace(/^\/usuarios\/\d+\/sucursales\/\d+/, '/usuarios/:id/sucursales/:sucursalId')
    .replace(/^\/usuarios\/\d+\/estado/, '/usuarios/:id/estado')
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

async function userToken(identifier: string) {
  const result = await login(identifier);
  assert.equal(result.statusCode, 200, `Login falló para ${identifier}`);
  return result.body.session.token;
}

describe('HU #54: Revocar Permiso de Usuario de Sucursal (Épica 2.4: Modelo Multi-sucursal y Cuentas de Recepción)', () => {
  beforeEach(async () => {
    const memory = newDb();
    memory.public.none(`
      CREATE TABLE sucursal (
        id serial PRIMARY KEY,
        codigo text UNIQUE,
        nombre text NOT NULL UNIQUE,
        domicilio text,
        activa boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE cuenta_recepcion (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL,
        nombre_fantasia text,
        alias text NOT NULL,
        cbu char(22),
        banco text,
        cuit_titular char(11),
        moneda text NOT NULL DEFAULT 'ARS',
        activa boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now(),
        UNIQUE (sucursal_id, alias)
      );

      CREATE TABLE movimiento_bancario (
        id serial PRIMARY KEY,
        cuenta_id bigint NOT NULL,
        fecha_hora timestamp DEFAULT now(),
        ordenante text NOT NULL,
        ordenante_cuit char(11),
        concepto text,
        referencia_externa text,
        importe_centavos bigint NOT NULL,
        origen text NOT NULL DEFAULT 'Extracto Bancario',
        estado text NOT NULL DEFAULT 'sin_imputar',
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS movimiento_bancario_comprobante (
        movimiento_id bigint PRIMARY KEY,
        nombre_archivo text NOT NULL,
        tipo_mime text NOT NULL,
        contenido bytea NOT NULL,
        tamano_bytes bigint NOT NULL,
        subido_en timestamp DEFAULT now()
      );

      CREATE TABLE imputacion (
        id serial PRIMARY KEY,
        movimiento_bancario_id bigint,
        remito_id bigint,
        importe_centavos bigint NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS liquidacion (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL,
        estado text NOT NULL DEFAULT 'abierta'
      );

      CREATE TABLE IF NOT EXISTS discrepancia_conciliacion (
        id serial PRIMARY KEY,
        movimiento_id bigint,
        estado text NOT NULL DEFAULT 'pendiente'
      );

      CREATE TABLE usuario (
        id serial PRIMARY KEY,
        usuario text NOT NULL UNIQUE,
        nombre text NOT NULL,
        email text,
        password_hash text NOT NULL,
        rol text NOT NULL DEFAULT 'Administrativo',
        limite_autorizacion_centavos bigint NOT NULL DEFAULT 0,
        es_transportista boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        dispositivo_conectado boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now(),
        actualizado_en timestamp DEFAULT now()
      );

      CREATE TABLE sesion_usuario (
        id text PRIMARY KEY,
        usuario_id bigint NOT NULL,
        token text NOT NULL UNIQUE,
        ip_address text,
        user_agent text,
        creado_en timestamp DEFAULT now(),
        ultimo_acceso timestamp DEFAULT now(),
        expira_en timestamp NOT NULL,
        revocado boolean NOT NULL DEFAULT false,
        revocado_en timestamp,
        motivo_cierre text
      );

      CREATE TABLE usuario_sucursal (
        usuario_id bigint NOT NULL,
        sucursal_id bigint NOT NULL,
        PRIMARY KEY (usuario_id, sucursal_id)
      );

      CREATE TABLE permiso (
        codigo text PRIMARY KEY,
        descripcion text NOT NULL
      );

      CREATE TABLE usuario_sucursal_permiso (
        usuario_id bigint NOT NULL,
        sucursal_id bigint NOT NULL,
        permiso_codigo text NOT NULL,
        PRIMARY KEY (usuario_id, sucursal_id, permiso_codigo)
      );

      INSERT INTO sucursal (codigo, nombre, domicilio, activa) VALUES
        ('SUC-CEN', 'Sucursal Central - La Plata', 'Calle 12 N° 500, La Plata', true),
        ('SUC-SUR', 'Depósito Sur - Berisso', 'Av. Río de la Plata 1240, Berisso', true),
        ('SUC-NOR', 'Hub Norte - City Bell', 'Camino Centenario 1500, City Bell', true);

      INSERT INTO cuenta_recepcion (id, sucursal_id, alias, banco, activa) VALUES
        (10, 1, 'tutucas.central', 'Banco Provincia', true),
        (20, 2, 'tutucas.sur', 'Banco Santander', true),
        (30, 3, 'tutucas.norte', 'Banco Galicia', true);

      INSERT INTO permiso (codigo, descripcion) VALUES
        ('usuario.administrar', 'Administrar usuarios y permisos'),
        ('comercio.ver', 'Consultar comercios'),
        ('remito.cargar', 'Cargar entregas manuales');
    `);

    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    db.setPool(pool);

    const hash = await bcryptjs.hash(password, 10);
    await db.query(`
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo) VALUES
        (1, 'admin', 'Admin Corporativo', 'admin@example.com', '${hash}', 'Administrador del sistema', true),
        (2, 'operador_multi', 'Operador Multi-Sucursal', 'operador@example.com', '${hash}', 'Administrativo', true),
        (3, 'admin_norte', 'Administrador Hub Norte', 'admin.norte@example.com', '${hash}', 'Supervisor', true),
        (4, 'segundo_admin_norte', 'Segundo Admin Hub Norte', 'segundo.norte@example.com', '${hash}', 'Supervisor', true);

      -- Extractos bancarios (movimientos)
      INSERT INTO movimiento_bancario (id, cuenta_id, fecha_hora, ordenante, importe_centavos, estado) VALUES
        (101, 10, now(), 'Mayorista San Cayetano (Central)', 15000000, 'sin_imputar'),
        (201, 20, now(), 'Supermercado Berisso (Sur)', 22000000, 'sin_imputar'),
        (301, 30, now(), 'Distribuidora City Bell (Norte)', 38000000, 'sin_imputar');
    `);
  });

  afterEach(async () => {
    if (pool?.end) await pool.end();
  });

  it('ESCENARIO 1: Revocación exitosa: Se retira el permiso y el usuario pierde visibilidad sobre las cuentas receptoras vinculadas a esa sucursal.', async () => {
    const adminTok = await userToken('admin@example.com');

    // 1. Asignar al operador_multi (id: 2) a Sucursal Central (1) y a Depósito Sur (2)
    await db.query('DELETE FROM usuario_sucursal WHERE usuario_id = 2');
    await db.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (2, 1), (2, 2)');
    await db.query(`
      INSERT INTO usuario_sucursal_permiso (usuario_id, sucursal_id, permiso_codigo) VALUES
        (2, 1, 'comercio.ver'),
        (2, 2, 'comercio.ver')
    `);

    const operadorTok = await userToken('operador@example.com');

    // 2. Antes de la revocación: el usuario tiene visibilidad sobre las cuentas receptoras de Sucursal Central y Depósito Sur
    const resInicial = await dispatch(configuracionRouter, 'get', '/configuracion/cuentas-recepcion', undefined, operadorTok);
    assert.equal(resInicial.statusCode, 200);
    assert.ok(Array.isArray(resInicial.body));
    const aliasIniciales = resInicial.body.map((c: any) => c.alias);
    assert.ok(aliasIniciales.includes('tutucas.central'), 'Debe ver la cuenta de Sucursal Central');
    assert.ok(aliasIniciales.includes('tutucas.sur'), 'Debe ver la cuenta de Depósito Sur');
    assert.equal(aliasIniciales.includes('tutucas.norte'), false, 'No debe ver la cuenta de Hub Norte');

    // 3. El Administrador revoca el permiso y acceso del usuario a la Sucursal 2 (Depósito Sur)
    const resRevocar = await dispatch(configuracionRouter, 'delete', '/configuracion/permisos-sucursal/2/2', undefined, adminTok);
    assert.equal(resRevocar.statusCode, 200);
    assert.equal(resRevocar.body.success, true);

    // 4. El usuario vuelve a consultar las cuentas receptoras:
    // Automáticamente deja de ver las cuentas receptoras vinculadas a Depósito Sur
    const resFinal = await dispatch(configuracionRouter, 'get', '/configuracion/cuentas-recepcion', undefined, operadorTok);
    assert.equal(resFinal.statusCode, 200);
    const aliasFinales = resFinal.body.map((c: any) => c.alias);
    assert.ok(aliasFinales.includes('tutucas.central'), 'Conserva visibilidad sobre la cuenta de Sucursal Central');
    assert.equal(aliasFinales.includes('tutucas.sur'), false, 'Debe haber perdido visibilidad sobre la cuenta de Depósito Sur');

    // 5. También pierde visibilidad sobre los extractos bancarios de la cuenta revocada
    const resMov = await dispatch(conciliacionRouter, 'get', '/movimientos', undefined, operadorTok);
    assert.equal(resMov.statusCode, 200);
    const movIds = resMov.body.map((m: any) => m.id);
    assert.ok(movIds.includes('101'), 'Debe ver movimientos de Sucursal Central');
    assert.equal(movIds.includes('201'), false, 'Debe dejar de ver movimientos de la sucursal revocada');

    // 6. Comprobamos que el registro fue removido de usuario_sucursal y usuario_sucursal_permiso
    const usRows = await db.query('SELECT * FROM usuario_sucursal WHERE usuario_id = 2 AND sucursal_id = 2');
    assert.equal(usRows.rows.length, 0);
    const uspRows = await db.query('SELECT * FROM usuario_sucursal_permiso WHERE usuario_id = 2 AND sucursal_id = 2');
    assert.equal(uspRows.rows.length, 0);
  });

  it('ESCENARIO 2: Fallo por carencia de administrador: Se intenta quitar el permiso al único administrador de seguridad asignado a esa sucursal. El sistema bloquea para evitar dejar una sucursal sin gestión.', async () => {
    const adminTok = await userToken('admin@example.com');

    // 1. Configurar admin_norte (id: 3) como el ÚNICO administrador de seguridad en Hub Norte (sucursal 3)
    await db.query('DELETE FROM usuario_sucursal WHERE sucursal_id = 3');
    await db.query('DELETE FROM usuario_sucursal_permiso WHERE sucursal_id = 3');
    await db.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (3, 3)');
    await db.query("INSERT INTO usuario_sucursal_permiso (usuario_id, sucursal_id, permiso_codigo) VALUES (3, 3, 'usuario.administrar')");

    // CASO A: Se intenta quitar el permiso de administración mediante PUT /permisos-sucursal quitando 'usuario.administrar'
    const resPutQuitarPermiso = await dispatch(
      configuracionRouter,
      'put',
      '/configuracion/permisos-sucursal/3/3',
      { permisos: ['comercio.ver'] },
      adminTok
    );
    assert.equal(resPutQuitarPermiso.statusCode, 409, 'Debe responder 409 Conflict al intentar quitar el permiso al único admin de seguridad');
    assert.equal(resPutQuitarPermiso.body.error, 'CARENCIA_ADMINISTRADOR');
    assert.ok(resPutQuitarPermiso.body.message.includes('sin gestión'));

    // CASO B: Se intenta revocar totalmente el acceso mediante DELETE /permisos-sucursal
    const resDeleteBloqueado = await dispatch(
      configuracionRouter,
      'delete',
      '/configuracion/permisos-sucursal/3/3',
      undefined,
      adminTok
    );
    assert.equal(resDeleteBloqueado.statusCode, 409, 'Debe responder 409 Conflict');
    assert.equal(resDeleteBloqueado.body.error, 'CARENCIA_ADMINISTRADOR');

    // CASO C: Se intenta revocar mediante DELETE /usuarios/:id/sucursales/:sucursalId
    const resDeleteUsuarioSucursal = await dispatch(
      usuarioRouter,
      'delete',
      '/usuarios/3/sucursales/3',
      undefined,
      adminTok
    );
    assert.equal(resDeleteUsuarioSucursal.statusCode, 409, 'Debe bloquear la baja de sucursal por carencia de administrador');

    // CASO D: Se intenta desactivar al único administrador de seguridad de la sucursal
    const resDesactivar = await dispatch(
      usuarioRouter,
      'patch',
      '/usuarios/3/estado',
      { activo: false },
      adminTok
    );
    assert.equal(resDesactivar.statusCode, 409, 'Debe bloquear la desactivación del único admin de seguridad');

    // CASO E: Si se asigna previamente OTRO administrador de seguridad a la sucursal, entonces SÍ se permite revocar
    await db.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (4, 3)');
    await db.query("INSERT INTO usuario_sucursal_permiso (usuario_id, sucursal_id, permiso_codigo) VALUES (4, 3, 'usuario.administrar')");

    // Ahora hay 2 administradores de seguridad en Hub Norte (3 y 4). Al revocar el usuario 3, la sucursal NO queda sin gestión
    const resRevocarConSegundoAdmin = await dispatch(
      configuracionRouter,
      'delete',
      '/configuracion/permisos-sucursal/3/3',
      undefined,
      adminTok
    );
    assert.equal(resRevocarConSegundoAdmin.statusCode, 200, 'Debe permitir la revocación ya que la sucursal conserva gestión');
    assert.equal(resRevocarConSegundoAdmin.body.success, true);
  });

  it('SEGURIDAD: Solo el Administrador del sistema puede revocar permisos de sucursal', async () => {
    // Un administrativo autenticado intenta revocar un permiso de sucursal
    const operadorTok = await userToken('operador@example.com');
    const resForbidden = await dispatch(
      configuracionRouter,
      'delete',
      '/configuracion/permisos-sucursal/3/1',
      undefined,
      operadorTok
    );
    assert.equal(resForbidden.statusCode, 403, 'Debe denegar acceso con 403 Forbidden a un no-administrador');
  });
});
