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
  return layer.route.stack[0].handle;
}

async function dispatch(router: any, method: string, path: string, body?: any, token?: string) {
  const req: any = {
    method, url: path, body, params: {}, query: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  };

  // Extraer query params si existen
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
  if (id) req.params.id = id;
  if (permissionIds) [req.params.usuarioId, req.params.sucursalId] = permissionIds.slice(1);

  const routePath = cleanPath
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

describe('HU #53: Asignar Permisos de Operador de Sucursal (Épica 2.4: Modelo Multi-sucursal y Cuentas de Recepción)', () => {
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
        alias text NOT NULL,
        cbu char(22),
        banco text,
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
        referencia_externa text,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'sin_imputar',
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE imputacion (
        id serial PRIMARY KEY,
        movimiento_bancario_id bigint,
        remito_id bigint,
        importe_centavos bigint NOT NULL DEFAULT 0
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
        ('movimientos.ver', 'Ver extractos bancarios de la sucursal'),
        ('conciliacion.operar', 'Operar conciliación bancaria');
    `);

    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    db.setPool(pool);

    const hash = await bcryptjs.hash(password, 10);
    await db.query(`
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo) VALUES
        (1, 'admin', 'Admin Corporativo', 'admin@example.com', '${hash}', 'Administrador del sistema', true),
        (2, 'operador_central', 'Operador Central', 'operador.central@example.com', '${hash}', 'Administrativo', true),
        (3, 'operador_sur', 'Operador Sur', 'operador.sur@example.com', '${hash}', 'Administrativo', true),
        (4, 'director_ceo', 'Director General CEO', 'ceo@example.com', '${hash}', 'CEO', true),
        (5, 'gerente_finanzas', 'Gerente de Finanzas', 'gerente@example.com', '${hash}', 'Gerente', true);

      -- Extractos bancarios (movimientos) de cada sucursal:
      -- Cuenta 10 (Sucursal Central):
      INSERT INTO movimiento_bancario (id, cuenta_id, fecha_hora, ordenante, importe_centavos, estado) VALUES
        (101, 10, now(), 'Mayorista San Cayetano (Central)', 15000000, 'sin_imputar'),
        (102, 10, now(), 'Autoservicio Centro (Central)', 7500000, 'sin_imputar');

      -- Cuenta 20 (Depósito Sur):
      INSERT INTO movimiento_bancario (id, cuenta_id, fecha_hora, ordenante, importe_centavos, estado) VALUES
        (201, 20, now(), 'Supermercado Berisso (Sur)', 22000000, 'sin_imputar');

      -- Cuenta 30 (Hub Norte):
      INSERT INTO movimiento_bancario (id, cuenta_id, fecha_hora, ordenante, importe_centavos, estado) VALUES
        (301, 30, now(), 'Distribuidora City Bell (Norte)', 38000000, 'sin_imputar');
    `);
  });

  afterEach(async () => {
    if (pool?.end) await pool.end();
  });

  it('ESCENARIO 1: Sectorización de usuario exitosa: Se restringe a un administrativo solo para determinada sucursal. Automáticamente deja de ver los extractos bancarios de las demás sucursales.', async () => {
    // 1. El Administrador asigna al usuario administrativo (id: 2) ÚNICAMENTE a la Sucursal Central (id: 1)
    await db.query('DELETE FROM usuario_sucursal WHERE usuario_id = 2');
    await db.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (2, 1)');

    const operadorToken = await userToken('operador.central@example.com');

    // 2. El administrativo consulta los extractos bancarios disponibles
    const response = await dispatch(conciliacionRouter, 'get', '/movimientos', undefined, operadorToken);

    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray(response.body));

    // Debe ver solo los movimientos de la sucursal asignada (Sucursal Central, cuenta 10)
    assert.equal(response.body.length, 2);
    const movIds = response.body.map((m: any) => m.id);
    assert.ok(movIds.includes('101'));
    assert.ok(movIds.includes('102'));

    // Automáticamente deja de ver los extractos de las demás sucursales (Depósito Sur y Hub Norte)
    assert.equal(movIds.includes('201'), false, 'No debe ver movimientos de Depósito Sur');
    assert.equal(movIds.includes('301'), false, 'No debe ver movimientos de Hub Norte');

    // Comprobamos que las cuentas corresponden únicamente a la sucursal asignada
    for (const mov of response.body) {
      assert.equal(mov.cuenta_id, '10');
      assert.equal(mov.sucursal_id, '1');
    }
  });

  it('ESCENARIO 2: Fallo por rol global: Se intenta restringir geográficamente la vista a un usuario con perfil jerárquico global inamovible (Ej. CEO). El sistema ignora la restricción local.', async () => {
    // 1. Se intenta restringir geográficamente la vista del CEO (id: 4) asignándole localmente solo la Sucursal Central (id: 1)
    await db.query('DELETE FROM usuario_sucursal WHERE usuario_id = 4');
    await db.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (4, 1)');

    const ceoToken = await userToken('ceo@example.com');

    // 2. El CEO consulta los extractos bancarios
    const response = await dispatch(conciliacionRouter, 'get', '/movimientos', undefined, ceoToken);

    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray(response.body));

    // El sistema ignora la restricción local: el CEO ve los extractos de TODAS las sucursales
    assert.equal(response.body.length, 4, 'El CEO debe tener visibilidad irrestricta de todos los extractos');
    const movIds = response.body.map((m: any) => m.id);
    assert.ok(movIds.includes('101'), 'Debe ver movimientos de Sucursal Central');
    assert.ok(movIds.includes('102'), 'Debe ver movimientos de Sucursal Central');
    assert.ok(movIds.includes('201'), 'Debe ver movimientos de Depósito Sur');
    assert.ok(movIds.includes('301'), 'Debe ver movimientos de Hub Norte');

    // Lo mismo ocurre con el Gerente (perfil jerárquico global)
    await db.query('DELETE FROM usuario_sucursal WHERE usuario_id = 5');
    await db.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (5, 2)'); // Se le asigna solo Sur
    const gerenteToken = await userToken('gerente@example.com');

    const resGerente = await dispatch(conciliacionRouter, 'get', '/movimientos', undefined, gerenteToken);
    assert.equal(resGerente.statusCode, 200);
    assert.equal(resGerente.body.length, 4, 'El Gerente también posee visibilidad corporativa global irrestricta');
  });

  it('REGLAS A CONSIDERAR: Los permisos son granulares; el tipo de usuario no determina automáticamente a qué sucursal tiene acceso.', async () => {
    // Dos usuarios con el mismo rol 'Administrativo':
    // Operador Central (id: 2) -> asignado a Sucursal Central (1)
    await db.query('DELETE FROM usuario_sucursal WHERE usuario_id = 2');
    await db.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (2, 1)');

    // Operador Sur (id: 3) -> asignado a Depósito Sur (2)
    await db.query('DELETE FROM usuario_sucursal WHERE usuario_id = 3');
    await db.query('INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (3, 2)');

    const tokenCentral = await userToken('operador.central@example.com');
    const tokenSur = await userToken('operador.sur@example.com');

    const resCentral = await dispatch(conciliacionRouter, 'get', '/movimientos', undefined, tokenCentral);
    const resSur = await dispatch(conciliacionRouter, 'get', '/movimientos', undefined, tokenSur);

    assert.equal(resCentral.statusCode, 200);
    assert.equal(resSur.statusCode, 200);

    // Operador Central solo ve extractos de Sucursal Central (101 y 102)
    const idsCentral = resCentral.body.map((m: any) => m.id);
    assert.deepEqual(idsCentral.sort(), ['101', '102']);

    // Operador Sur solo ve extractos de Depósito Sur (201)
    const idsSur = resSur.body.map((m: any) => m.id);
    assert.deepEqual(idsSur, ['201']);

    // No comparten automáticamente vista a pesar de tener el mismo rol 'Administrativo'
    assert.notDeepEqual(idsCentral, idsSur);
  });

  it('ADMINISTRACIÓN: El administrador puede actualizar las sucursales asignadas a un administrativo mediante la API de usuarios', async () => {
    const adminTok = await userToken('admin@example.com');

    // 1. Asignamos al operador a dos sucursales (1 y 3) mediante PUT /usuarios/:id
    const putRes = await dispatch(
      usuarioRouter,
      'put',
      '/usuarios/2',
      {
        usuario: 'operador_central',
        nombre: 'Operador Central Modificado',
        email: 'operador.central@example.com',
        rol: 'Administrativo',
        sucursalIds: [1, 3],
      },
      adminTok
    );
    assert.equal(putRes.statusCode, 200);
    assert.equal(putRes.body.success, true);

    // 2. El operador ahora debe ver los extractos de Sucursal 1 y Sucursal 3 (101, 102, 301)
    const operadorToken = await userToken('operador.central@example.com');
    const resMovs = await dispatch(conciliacionRouter, 'get', '/movimientos', undefined, operadorToken);
    assert.equal(resMovs.statusCode, 200);
    assert.equal(resMovs.body.length, 3);
    const ids = resMovs.body.map((m: any) => m.id);
    assert.ok(ids.includes('101'));
    assert.ok(ids.includes('102'));
    assert.ok(ids.includes('301'));
    assert.equal(ids.includes('201'), false, 'Depósito Sur sigue sin estar asignado, no debe figurar');
  });

  it('SEGURIDAD: Solo el Administrador del sistema puede configurar permisos de sucursal', async () => {
    const operadorToken = await userToken('operador.central@example.com');

    const forbiddenPut = await dispatch(
      configuracionRouter,
      'put',
      '/configuracion/permisos-sucursal/2/1',
      { permisos: ['movimientos.ver'] },
      operadorToken
    );
    assert.equal(forbiddenPut.statusCode, 403);
    assert.match(forbiddenPut.body.message, /Solo el Administrador del sistema/i);
  });
});
