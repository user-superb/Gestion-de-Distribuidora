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
    method, url: path, body, params: {}, query: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  };
  const res = responseMock();

  // Evaluate query params if present
  if (path.includes('?')) {
    const [, qs] = path.split('?');
    const searchParams = new URLSearchParams(qs);
    for (const [k, v] of searchParams.entries()) {
      req.query[k] = v;
    }
  }

  const cleanPath = path.split('?')[0];

  for (const layer of router.stack.filter((item: any) => !item.route)) {
    // Only apply route middlewares that match the path regex
    if (layer.regexp && !layer.regexp.test(cleanPath)) {
      continue;
    }
    let continued = false;
    await layer.handle(req, res, (error?: unknown) => {
      if (error) throw error;
      continued = true;
    });
    if (!continued) return res;
  }

  const asociarMatch = cleanPath.match(/^\/configuracion\/cuentas-recepcion\/(\d+)\/asociar$/);
  if (asociarMatch) {
    req.params.id = asociarMatch[1];
    await routeHandler(router, method, '/configuracion/cuentas-recepcion/:id/asociar')(req, res, () => undefined);
    return res;
  }

  const idMatch = cleanPath.match(/^\/configuracion\/cuentas-recepcion\/(\d+)$/);
  if (idMatch) {
    req.params.id = idMatch[1];
    await routeHandler(router, method, '/configuracion/cuentas-recepcion/:id')(req, res, () => undefined);
    return res;
  }

  if (cleanPath === '/cuentas-recepcion-operativas') {
    const layer = router.stack.find((item: any) => item.route?.path === '/cuentas-recepcion-operativas');
    assert.ok(layer, 'No route /cuentas-recepcion-operativas');
    const handlers = layer.route.stack.map((s: any) => s.handle);
    for (const h of handlers) {
      let continued = false;
      await h(req, res, (err?: any) => {
        if (err) throw err;
        continued = true;
      });
      if (!continued) break;
    }
    return res;
  }

  if (cleanPath === '/configuracion/cuentas-recepcion') {
    await routeHandler(router, method, '/configuracion/cuentas-recepcion')(req, res, () => undefined);
    return res;
  }

  throw new Error(`Unhandled path in dispatch: ${cleanPath}`);
}

async function login(identifier: string) {
  const req: any = {
    body: { identifier, password },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test' },
  };
  const res = responseMock();
  await routeHandler(authRouter, 'post', '/auth/login')(req, res);
  return res;
}

describe('HU: Asociar una cuenta bancaria a una sucursal habilitada para sectorizar fondos y limitar visibilidad', () => {
  beforeEach(async () => {
    const memDb = newDb();
    memDb.public.registerFunction({
      name: 'now',
      implementation: () => new Date('2026-11-04T12:00:00Z'),
    });

    memDb.public.none(`
      CREATE TABLE sucursal (
        id serial PRIMARY KEY,
        nombre text NOT NULL UNIQUE,
        domicilio text,
        activa boolean NOT NULL DEFAULT true
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
        creado_en timestamp DEFAULT now(),
        actualizado_en timestamp DEFAULT now(),
        CHECK (rol IN ('Administrador del sistema', 'Administrativo', 'Transportista', 'Supervisor', 'Gerente'))
      );
      CREATE UNIQUE INDEX usuario_nombre_login_unico ON usuario (lower(usuario));
      CREATE UNIQUE INDEX usuario_email_login_unico ON usuario (lower(email)) WHERE email IS NOT NULL;

      CREATE TABLE usuario_sucursal (
        usuario_id bigint NOT NULL,
        sucursal_id bigint NOT NULL,
        PRIMARY KEY (usuario_id, sucursal_id)
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

      CREATE TABLE cuenta_recepcion (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL REFERENCES sucursal(id),
        nombre_fantasia text,
        alias text NOT NULL,
        cbu text,
        banco text,
        cuit_titular text,
        moneda text NOT NULL DEFAULT 'ARS',
        activa boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now(),
        actualizado_en timestamp DEFAULT now(),
        CONSTRAINT cuenta_alias_unico UNIQUE (sucursal_id, alias)
      );

      CREATE TABLE intento_login (
        id serial PRIMARY KEY,
        identificador text NOT NULL,
        ip_address text,
        exitoso boolean NOT NULL,
        motivo_fallo text,
        creado_en timestamp DEFAULT now()
      );
    `);

    const hash = bcryptjs.hashSync(password, 10);

    // Admin
    await memDb.public.none(
      `INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo)
       VALUES (1, 'admin', 'Admin Central', 'admin@tutucas.local', '${hash}', 'Administrador del sistema', true)`
    );

    // Administrativo Sede 1
    await memDb.public.none(
      `INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo)
       VALUES (2, 'operador1', 'Operador Sede 1', 'op1@tutucas.local', '${hash}', 'Administrativo', true)`
    );

    // Administrativo Sede 2
    await memDb.public.none(
      `INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo)
       VALUES (3, 'operador2', 'Operador Sede 2', 'op2@tutucas.local', '${hash}', 'Administrativo', true)`
    );

    // Sucursales: 1 = Activa (Centro), 2 = Activa (Norte), 3 = Inactiva / Dada de baja (Sur)
    await memDb.public.none(`
      INSERT INTO sucursal (id, nombre, domicilio, activa) VALUES
        (1, 'Sucursal Centro', 'Av. San Martín 100', true),
        (2, 'Sucursal Norte', 'Ruta 9 Km 5', true),
        (3, 'Sucursal Sur', 'Av. Circunvalación 800', false);
    `);

    // Asignación de usuarios a sucursales
    await memDb.public.none(`
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES
        (2, 1),
        (3, 2);
    `);

    // Cuentas iniciales:
    // Cuenta 1: Activa, en Sucursal 1 (Centro)
    // Cuenta 2: Inactiva, en Sucursal 1 (Centro)
    // Cuenta 3: Activa, en Sucursal 2 (Norte)
    await memDb.public.none(`
      INSERT INTO cuenta_recepcion (id, sucursal_id, nombre_fantasia, alias, cbu, banco, cuit_titular, moneda, activa) VALUES
        (1, 1, 'Cuenta Corriente Centro', 'DISTRIBUIDORA.CENTRO', '1111111111111111111111', 'Banco Galicia', '30700000001', 'ARS', true),
        (2, 1, 'Cuenta Vieja Inactiva', 'CUENTA.INACTIVA', '2222222222222222222222', 'Banco Santander', '30700000001', 'ARS', false),
        (3, 2, 'Cuenta Operativa Norte', 'DISTRIBUIDORA.NORTE', '3333333333333333333333', 'Banco Nación', '30700000001', 'ARS', true);
    `);

    const adapter = memDb.adapters.createPg();
    pool = new adapter.Pool();
    db.setPool(pool as any);
  });

  afterEach(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('ESCENARIO 1: Asociación exitosa a sucursal activa: el administrador asigna una cuenta activa a una sucursal vigente y restringe visibilidad', async () => {
    const adminLogin = await login('admin@tutucas.local');
    assert.equal(adminLogin.statusCode, 200);
    const adminToken = adminLogin.body.session.token;

    // Asociar Cuenta 1 (actualmente en Sucursal 1) a la Sucursal 2 (Norte, activa)
    const resAsociar = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/cuentas-recepcion/1/asociar',
      { sucursal_id: 2 },
      adminToken
    );

    assert.equal(resAsociar.statusCode, 200);
    assert.equal(resAsociar.body.success, true);
    assert.equal(resAsociar.body.cuenta.sucursal_id, 2);

    // Verificar en BD que se persistió
    const cuentaBd = await db.query('SELECT sucursal_id FROM cuenta_recepcion WHERE id = 1');
    assert.equal(cuentaBd.rows[0].sucursal_id, 2);

    // Visibilidad: Operador Sede 2 (Norte) ahora debe ver Cuenta 1 y Cuenta 3
    const op2Login = await login('op2@tutucas.local');
    assert.equal(op2Login.statusCode, 200);
    const op2Token = op2Login.body.session.token;

    const resOp2 = await dispatch(configuracionRouter, 'get', '/cuentas-recepcion-operativas', undefined, op2Token);
    assert.equal(resOp2.statusCode, 200);
    const aliasVistosOp2 = resOp2.body.map((c: any) => c.alias);
    assert.ok(aliasVistosOp2.includes('DISTRIBUIDORA.CENTRO'), 'El operador de Sucursal 2 ahora debe ver la cuenta asociada');
    assert.ok(aliasVistosOp2.includes('DISTRIBUIDORA.NORTE'), 'El operador de Sucursal 2 debe ver la cuenta propia');

    // Visibilidad: Operador Sede 1 (Centro) ya NO debe ver Cuenta 1 (queda sin cuentas activas)
    const op1Login = await login('op1@tutucas.local');
    assert.equal(op1Login.statusCode, 200);
    const op1Token = op1Login.body.session.token;

    const resOp1 = await dispatch(configuracionRouter, 'get', '/cuentas-recepcion-operativas', undefined, op1Token);
    assert.equal(resOp1.statusCode, 200);
    const aliasVistosOp1 = resOp1.body.map((c: any) => c.alias);
    assert.ok(!aliasVistosOp1.includes('DISTRIBUIDORA.CENTRO'), 'El operador de Sucursal 1 ya no debe ver la cuenta sectorizada');
  });

  it('ESCENARIO 2: Fallo por sucursal inactiva o dada de baja: rechaza la asociación y no concreta la vinculación', async () => {
    const adminLogin = await login('admin@tutucas.local');
    const adminToken = adminLogin.body.session.token;

    // Intentar asociar Cuenta 1 a Sucursal 3 (inactiva / dada de baja)
    const resAsociar = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/cuentas-recepcion/1/asociar',
      { sucursal_id: 3 },
      adminToken
    );

    assert.equal(resAsociar.statusCode, 422);
    assert.equal(resAsociar.body.error, 'SUCURSAL_INACTIVA');
    assert.match(resAsociar.body.message, /deshabilitada o dada de baja/i);

    // Verificar que la cuenta permanece intacta en Sucursal 1
    const cuentaBd = await db.query('SELECT sucursal_id FROM cuenta_recepcion WHERE id = 1');
    assert.equal(cuentaBd.rows[0].sucursal_id, 1);
  });

  it('ESCENARIO 3: Fallo por cuenta previamente asociada a la sucursal: bloquea cuando ya mantiene un vínculo activo', async () => {
    const adminLogin = await login('admin@tutucas.local');
    const adminToken = adminLogin.body.session.token;

    // Intentar asociar Cuenta 1 a Sucursal 1 (con la cual ya mantiene el vínculo activo)
    const resAsociar = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/cuentas-recepcion/1/asociar',
      { sucursal_id: 1 },
      adminToken
    );

    assert.equal(resAsociar.statusCode, 409);
    assert.equal(resAsociar.body.error, 'CUENTA_PREVIAMENTE_ASOCIADA');
    assert.match(resAsociar.body.message, /ya se encuentra configurada para esa unidad operativa/i);
  });

  it('REGLA A CONSIDERAR: La cuenta receptora debe encontrarse activa para poder asociarse a una sucursal', async () => {
    const adminLogin = await login('admin@tutucas.local');
    const adminToken = adminLogin.body.session.token;

    // Cuenta 2 se encuentra inactiva (activa = false)
    const resAsociar = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/cuentas-recepcion/2/asociar',
      { sucursal_id: 2 },
      adminToken
    );

    assert.equal(resAsociar.statusCode, 422);
    assert.equal(resAsociar.body.error, 'CUENTA_INACTIVA');
    assert.match(resAsociar.body.message, /debe encontrarse activa/i);
  });

  it('ESCENARIO 2 (Creación): Fallo al crear cuenta vinculada a sucursal inactiva', async () => {
    const adminLogin = await login('admin@tutucas.local');
    const adminToken = adminLogin.body.session.token;

    const resCrear = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/cuentas-recepcion',
      {
        sucursal_id: 3, // Inactiva
        alias: 'CUENTA.NUEVA.TEST',
        banco: 'Banco Nación',
        cbu: '9990000100000000000017',
        cuit_titular: '30700000001',
        moneda: 'ARS',
      },
      adminToken
    );

    assert.equal(resCrear.statusCode, 422);
    assert.equal(resCrear.body.error, 'SUCURSAL_INACTIVA');
    assert.match(resCrear.body.message, /deshabilitada o dada de baja/i);
  });

  it('ESCENARIO 3 (Creación): Fallo por duplicar alias/cuenta en la misma sucursal', async () => {
    const adminLogin = await login('admin@tutucas.local');
    const adminToken = adminLogin.body.session.token;

    // Intentar registrar cuenta con mismo alias que Cuenta 1 en Sucursal 1
    const resCrear = await dispatch(
      configuracionRouter,
      'post',
      '/configuracion/cuentas-recepcion',
      {
        sucursal_id: 1,
        alias: 'DISTRIBUIDORA.CENTRO',
        banco: 'Banco Galicia',
        cbu: '0720000732000000000010',
        cuit_titular: '30700000001',
        moneda: 'ARS',
      },
      adminToken
    );

    assert.equal(resCrear.statusCode, 409);
    assert.equal(resCrear.body.error, 'DATO_BANCARIO_DUPLICADO');
    assert.match(resCrear.body.message, /ya se encuentra registrado/i);
  });
});
