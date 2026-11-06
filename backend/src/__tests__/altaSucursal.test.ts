import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authRouter } from '../routes/authRoutes.js';
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
  const id = path.match(/^\/configuracion\/(?:marcas|comercios|sucursales)\/(\d+)/)?.[1];
  if (id) req.params.id = id;
  const routePath = path
    .replace(/^\/configuracion\/(marcas|comercios|sucursales)\/\d+/, '/configuracion/$1/:id');
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

describe('HU #51: Dar Sucursal de Alta (Épica 2.4: Modelo Multi-sucursal y Cuentas de Recepción)', () => {
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
      CREATE TABLE usuario (
        id serial PRIMARY KEY, usuario text NOT NULL UNIQUE, nombre text NOT NULL, email text,
        password_hash text NOT NULL, rol text NOT NULL DEFAULT 'Administrativo',
        limite_autorizacion_centavos bigint NOT NULL DEFAULT 0,
        es_transportista boolean NOT NULL DEFAULT false, activo boolean NOT NULL DEFAULT true,
        dispositivo_conectado boolean NOT NULL DEFAULT true, creado_en timestamp DEFAULT now(), actualizado_en timestamp DEFAULT now()
      );
      CREATE TABLE sesion_usuario (
        id text PRIMARY KEY, usuario_id bigint NOT NULL, token text NOT NULL UNIQUE,
        ip_address text, user_agent text, creado_en timestamp DEFAULT now(),
        ultimo_acceso timestamp DEFAULT now(), expira_en timestamp NOT NULL,
        revocado boolean NOT NULL DEFAULT false, revocado_en timestamp, motivo_cierre text
      );
      CREATE TABLE usuario_sucursal (
        usuario_id bigint NOT NULL, sucursal_id bigint NOT NULL, PRIMARY KEY (usuario_id, sucursal_id)
      );
      CREATE TABLE cuenta_recepcion (
        id serial PRIMARY KEY, sucursal_id bigint NOT NULL, alias text NOT NULL,
        cbu char(22), banco text, activa boolean NOT NULL DEFAULT true, creado_en timestamp DEFAULT now(),
        UNIQUE (sucursal_id, alias)
      );

      INSERT INTO sucursal (codigo, nombre, domicilio, activa) VALUES
        ('SUC-CEN', 'Sucursal Central', 'Calle 12 N° 500, La Plata', true),
        ('SUC-SUR', 'Depósito Sur', 'Av. Río de la Plata 1240, Berisso', true);
    `);

    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    db.setPool(pool);

    const hash = await bcryptjs.hash(password, 10);
    await db.query(`
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo)
      VALUES (1, 'admin', 'Admin Sistema', 'admin@example.com', '${hash}', 'Administrador del sistema', true),
             (2, 'operador', 'Operador Sucursal', 'operador@example.com', '${hash}', 'Administrativo', true);
    `);
  });

  afterEach(async () => {
    if (pool?.end) await pool.end();
  });

  it('ESCENARIO 1: Creación de sucursal exitosa: Se cargan los datos y la nueva entidad queda operativa para recibir cuentas y personal.', async () => {
    const token = await adminToken();

    // 1. Damos de alta una nueva sucursal con código unívoco, nombre y domicilio
    const response = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/sucursales',
      {
        codigo: 'SUC-NORTE',
        nombre: 'Sucursal Norte - City Bell',
        domicilio: 'Camino Centenario 1500',
      },
      token
    );

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.success, true);
    assert.ok(response.body.sucursal);
    assert.equal(response.body.sucursal.codigo, 'SUC-NORTE');
    assert.equal(response.body.sucursal.nombre, 'Sucursal Norte - City Bell');
    assert.equal(response.body.sucursal.activa, true);

    // 2. Comprobar que en la base de datos la entidad está guardada y operativa (activa = true)
    const checkDb = await db.query('SELECT * FROM sucursal WHERE codigo = $1', ['SUC-NORTE']);
    assert.equal(checkDb.rows.length, 1);
    const nuevaSucursal = checkDb.rows[0];
    assert.equal(nuevaSucursal.activa, true);
    assert.equal(nuevaSucursal.domicilio, 'Camino Centenario 1500');

    // 3. Comprobar que la entidad queda operativa para recibir personal (usuario_sucursal)
    await db.query(
      'INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES ($1, $2)',
      [2, nuevaSucursal.id]
    );
    const personal = await db.query(
      'SELECT usuario_id FROM usuario_sucursal WHERE sucursal_id = $1',
      [nuevaSucursal.id]
    );
    assert.equal(personal.rows.length, 1);
    assert.equal(personal.rows[0].usuario_id, 2);

    // 4. Comprobar que la entidad queda operativa para recibir cuentas de recepción (cuenta_recepcion)
    await db.query(
      'INSERT INTO cuenta_recepcion (sucursal_id, alias, banco, activa) VALUES ($1, $2, $3, true)',
      [nuevaSucursal.id, 'tutucas.norte', 'Banco Provincia']
    );
    const cuentas = await db.query(
      'SELECT alias, activa FROM cuenta_recepcion WHERE sucursal_id = $1',
      [nuevaSucursal.id]
    );
    assert.equal(cuentas.rows.length, 1);
    assert.equal(cuentas.rows[0].alias, 'tutucas.norte');
    assert.equal(cuentas.rows[0].activa, true);
  });

  it('ESCENARIO 2: Fallo por código duplicado: Se ingresa un identificador ya utilizado por otra sucursal. El sistema rechaza el alta operativa.', async () => {
    const token = await adminToken();

    // 'SUC-CEN' ya existe en el seed
    const response = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/sucursales',
      {
        codigo: 'SUC-CEN',
        nombre: 'Otra Sucursal Duplicada',
        domicilio: 'Calle Falsa 123',
      },
      token
    );

    // El sistema rechaza el alta operativa
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error, 'CODIGO_DUPLICADO');
    assert.match(response.body.message, /Ya existe una sucursal con el código/i);

    // Verificamos que no se haya insertado en la base de datos
    const checkDb = await db.query('SELECT * FROM sucursal WHERE nombre = $1', ['Otra Sucursal Duplicada']);
    assert.equal(checkDb.rows.length, 0);
  });

  it('REGLAS A CONSIDERAR: Unicidad de código insensible a mayúsculas/minúsculas (case-insensitive)', async () => {
    const token = await adminToken();

    // 'SUC-SUR' ya existe en mayúsculas; intentamos con minúsculas 'suc-sur'
    const response = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/sucursales',
      {
        codigo: 'suc-sur',
        nombre: 'Sucursal Sur Duplicada Minúsculas',
      },
      token
    );

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, 'CODIGO_DUPLICADO');
  });

  it('CATÁLOGO: GET /configuracion/sucursales expone el código unívoco de cada sucursal', async () => {
    const token = await adminToken();

    const response = await dispatch(configuracionRouter, 'get', '/configuracion/sucursales', undefined, token);
    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray(response.body));
    assert.ok(response.body.length >= 2);

    const cen = response.body.find((s: any) => s.codigo === 'SUC-CEN');
    assert.ok(cen);
    assert.equal(cen.nombre, 'Sucursal Central');
    assert.equal(cen.activa, true);
  });

  it('SEGURIDAD: Solo el Administrador del sistema puede dar de alta o consultar sucursales', async () => {
    // Intentar con un usuario con rol 'Administrativo'
    const operator = await login('operador@example.com');
    const operatorToken = operator.body.session.token;

    const forbiddenPost = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/sucursales',
      { codigo: 'SUC-HACK', nombre: 'Sucursal Ilegal' },
      operatorToken
    );
    assert.equal(forbiddenPost.statusCode, 403);
    assert.match(forbiddenPost.body.message, /Solo el Administrador del sistema/i);
  });
});
