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

  const id = path.match(/^\/configuracion\/cuentas-recepcion\/(\d+)/)?.[1];
  if (id) req.params.id = id;

  const routePath = path
    .replace(/^\/configuracion\/cuentas-recepcion\/\d+/, '/configuracion/cuentas-recepcion/:id');

  await routeHandler(router, method, routePath)(req, res, () => undefined);
  return res;
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

describe('HU: Modificar los datos de una cuenta de recepción para mantener la vigencia bancaria', () => {
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
        cbu char(22),
        banco text,
        cuit_titular char(11),
        moneda text NOT NULL DEFAULT 'ARS',
        activa boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now(),
        actualizado_en timestamp DEFAULT now()
      );

      CREATE TABLE movimiento_bancario (
        id serial PRIMARY KEY,
        cuenta_id bigint NOT NULL REFERENCES cuenta_recepcion(id),
        fecha_hora timestamp DEFAULT now(),
        ordenante text,
        referencia_externa text,
        importe_centavos bigint NOT NULL,
        estado text DEFAULT 'sin_imputar'
      );

      CREATE TABLE visita (
        id serial PRIMARY KEY,
        orden integer DEFAULT 1,
        estado text DEFAULT 'pendiente'
      );

      CREATE TABLE cobro (
        id serial PRIMARY KEY,
        visita_id bigint REFERENCES visita(id),
        medio_pago text NOT NULL,
        importe_centavos bigint NOT NULL,
        registrado_por bigint REFERENCES usuario(id),
        movimiento_bancario_id bigint REFERENCES movimiento_bancario(id),
        clave_idempotencia text UNIQUE,
        estado text DEFAULT 'pendiente'
      );

      CREATE TABLE discrepancia_conciliacion (
        id serial PRIMARY KEY,
        movimiento_id bigint REFERENCES movimiento_bancario(id),
        movimiento_ids bigint[] DEFAULT '{}',
        remito_ids bigint[] DEFAULT '{}',
        importe_movimiento bigint NOT NULL DEFAULT 0,
        importe_seleccionado bigint NOT NULL DEFAULT 0,
        diferencia_centavos bigint NOT NULL DEFAULT 0,
        nota text NOT NULL DEFAULT 'nota',
        estado text NOT NULL DEFAULT 'pendiente',
        creada_por bigint REFERENCES usuario(id),
        creada_en timestamp DEFAULT now()
      );

      CREATE TABLE liquidacion (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL REFERENCES sucursal(id),
        periodo_desde date NOT NULL,
        periodo_hasta date NOT NULL,
        importe_centavos bigint DEFAULT 0,
        estado text NOT NULL DEFAULT 'abierta'
      );

      INSERT INTO sucursal (nombre) VALUES ('Sucursal Central'), ('Sucursal Norte');
    `);

    const hash = bcryptjs.hashSync(password, 10);
    memDb.public.none(`
      INSERT INTO usuario (usuario, nombre, email, password_hash, rol, activo)
      VALUES ('admin', 'Admin Sistema', 'admin@example.com', '${hash}', 'Administrador del sistema', true);
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (1, 1);
    `);

    const adapter = memDb.adapters.createPg();
    pool = new adapter.Pool();
    db.setPool(pool as any);
  });

  afterEach(async () => {
    if (pool) await pool.end();
  });

  async function getAdminToken() {
    const loginRes = await login('admin@example.com');
    assert.equal(loginRes.statusCode, 200);
    return loginRes.body.session.token;
  }

  it('ESCENARIO 1: Modificación exitosa de datos operativos: nombre de fantasía, alias o sucursal sobre cuenta habilitada y sin bloqueos contables', async () => {
    const token = await getAdminToken();

    // 1. Crear una cuenta de recepción
    const createRes = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 1,
      nombre_fantasia: 'Cuenta Principal Tutucas',
      alias: 'TUTUCAS.CENTRAL',
      banco: 'Banco Santander',
      cbu: '2850590940090418135201',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);
    assert.equal(createRes.statusCode, 201);

    const listRes = await dispatch(configuracionRouter, 'get', '/configuracion/cuentas-recepcion', undefined, token);
    assert.equal(listRes.statusCode, 200);
    const cuentaId = listRes.body[0].id;
    assert.equal(listRes.body[0].alias, 'TUTUCAS.CENTRAL');
    assert.equal(listRes.body[0].nombre_fantasia, 'Cuenta Principal Tutucas');
    assert.equal(listRes.body[0].moneda, 'ARS');

    // 2. Modificar datos operativos: nombre de fantasía, alias y reasignar a sucursal 2
    const updateRes = await dispatch(configuracionRouter, 'put', `/configuracion/cuentas-recepcion/${cuentaId}`, {
      sucursal_id: 2,
      nombre_fantasia: 'Cuenta Recaudación Norte',
      alias: 'TUTUCAS.NORTE',
      banco: 'Banco Santander Río',
      cbu: '2850590940090418135201',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);
    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.body.success, true);
    assert.equal(updateRes.body.cuenta.alias, 'TUTUCAS.NORTE');
    assert.equal(updateRes.body.cuenta.nombre_fantasia, 'Cuenta Recaudación Norte');
    assert.equal(updateRes.body.cuenta.sucursal_id, 2);

    // Verificar en base de datos
    const updatedList = await dispatch(configuracionRouter, 'get', '/configuracion/cuentas-recepcion', undefined, token);
    const updated = updatedList.body.find((c: any) => c.id === cuentaId);
    assert.equal(updated.alias, 'TUTUCAS.NORTE');
    assert.equal(updated.nombre_fantasia, 'Cuenta Recaudación Norte');
    assert.equal(updated.sucursal_id, 2);
  });

  it('ESCENARIO 2: Fallo por cuenta en conciliación o cierre contable bloqueado: restringe edición y notifica inmovilización', async () => {
    const token = await getAdminToken();

    // 1. Crear cuenta y registrar un movimiento
    await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 1,
      alias: 'CUENTA.CONCILIACION',
      banco: 'Banco Nación',
      cbu: '0110000600000000000024',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);
    const listRes = await dispatch(configuracionRouter, 'get', '/configuracion/cuentas-recepcion', undefined, token);
    const cuentaId = listRes.body[0].id;

    // Insertar un movimiento bancario asociado a la cuenta
    await db.query(`
      INSERT INTO movimiento_bancario (id, cuenta_id, importe_centavos, estado)
      VALUES (101, ${cuentaId}, 50000, 'sin_imputar');
    `);

    // A. Bloqueo por conciliación activa (discrepancia en estado 'pendiente')
    await db.query(`
      INSERT INTO discrepancia_conciliacion (id, movimiento_id, importe_movimiento, diferencia_centavos, nota, estado, creada_por)
      VALUES (1, 101, 50000, 1000, 'Diferencia en verificación', 'pendiente', 1);
    `);

    const failConciliacion = await dispatch(configuracionRouter, 'put', `/configuracion/cuentas-recepcion/${cuentaId}`, {
      alias: 'ALIAS.NUEVO',
    }, token);
    assert.equal(failConciliacion.statusCode, 422);
    assert.equal(failConciliacion.body.error, 'CUENTA_INMOVILIZADA');
    assert.match(failConciliacion.body.message, /inmovilizada para cambios/i);

    // Resolver la discrepancia (pasa a 'resuelta')
    await db.query(`UPDATE discrepancia_conciliacion SET estado = 'resuelta' WHERE id = 1;`);

    // B. Bloqueo por período contable cerrado/bloqueado por auditoría (liquidación cerrada)
    await db.query(`
      INSERT INTO liquidacion (id, sucursal_id, periodo_desde, periodo_hasta, estado)
      VALUES (1, 1, '2026-10-01', '2026-10-31', 'cerrada');
    `);

    const failPeriodoBloqueado = await dispatch(configuracionRouter, 'put', `/configuracion/cuentas-recepcion/${cuentaId}`, {
      alias: 'ALIAS.NUEVO',
    }, token);
    assert.equal(failPeriodoBloqueado.statusCode, 422);
    assert.equal(failPeriodoBloqueado.body.error, 'CUENTA_INMOVILIZADA');
    assert.match(failPeriodoBloqueado.body.message, /período contable bloqueado/i);
  });

  it('ESCENARIO 3: Bloqueo de edición sobre datos estructurales (CBU, CUIT titular o moneda) cuando la cuenta tiene movimientos históricos', async () => {
    const token = await getAdminToken();

    // 1. Crear cuenta
    await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 1,
      alias: 'CUENTA.HISTORICA',
      banco: 'Banco Galicia',
      cbu: '0070000900000000000031',
      cuit_titular: '30999888776',
      moneda: 'ARS',
    }, token);
    const listRes = await dispatch(configuracionRouter, 'get', '/configuracion/cuentas-recepcion', undefined, token);
    const cuentaId = listRes.body[0].id;

    // 2. Sin movimientos históricos, se puede editar CBU, CUIT o moneda
    const updateSinMov = await dispatch(configuracionRouter, 'put', `/configuracion/cuentas-recepcion/${cuentaId}`, {
      alias: 'CUENTA.HISTORICA.MOD',
      cbu: '0070000900000000000048',
      cuit_titular: '30111222334',
      moneda: 'USD',
    }, token);
    assert.equal(updateSinMov.statusCode, 200);

    // 3. Asentar un movimiento histórico en la cuenta
    await db.query(`
      INSERT INTO movimiento_bancario (id, cuenta_id, importe_centavos, estado)
      VALUES (201, ${cuentaId}, 75000, 'imputado');
    `);

    // 4. Intentar alterar CBU con histórico asentado -> debe rechazarse (HTTP 409)
    const failCbu = await dispatch(configuracionRouter, 'put', `/configuracion/cuentas-recepcion/${cuentaId}`, {
      alias: 'CUENTA.HISTORICA.MOD',
      cbu: '0070000900000000009991',
      cuit_titular: '30111222334',
      moneda: 'USD',
    }, token);
    assert.equal(failCbu.statusCode, 409);
    assert.equal(failCbu.body.error, 'DATOS_ESTRUCTURALES_BLOQUEADOS');
    assert.match(failCbu.body.message, /datos estructurales/i);

    // 5. Intentar alterar CUIT titular con histórico asentado -> debe rechazarse (HTTP 409)
    const failCuit = await dispatch(configuracionRouter, 'put', `/configuracion/cuentas-recepcion/${cuentaId}`, {
      alias: 'CUENTA.HISTORICA.MOD',
      cbu: '0070000900000000000048',
      cuit_titular: '30555666778',
      moneda: 'USD',
    }, token);
    assert.equal(failCuit.statusCode, 409);
    assert.equal(failCuit.body.error, 'DATOS_ESTRUCTURALES_BLOQUEADOS');

    // 6. Intentar alterar Moneda con histórico asentado -> debe rechazarse (HTTP 409)
    const failMoneda = await dispatch(configuracionRouter, 'put', `/configuracion/cuentas-recepcion/${cuentaId}`, {
      alias: 'CUENTA.HISTORICA.MOD',
      cbu: '0070000900000000000048',
      cuit_titular: '30111222334',
      moneda: 'ARS',
    }, token);
    assert.equal(failMoneda.statusCode, 409);
    assert.equal(failMoneda.body.error, 'DATOS_ESTRUCTURALES_BLOQUEADOS');

    // 7. Modificar únicamente datos descriptivos u operativos (alias, banco, nombre de fantasía) manteniendo intactos los estructurales -> debe permitirse
    const okOperativos = await dispatch(configuracionRouter, 'put', `/configuracion/cuentas-recepcion/${cuentaId}`, {
      alias: 'CUENTA.ALIAS.ACTUALIZADO',
      nombre_fantasia: 'Cuenta Galic Recaudación',
      banco: 'Banco Galicia y Buenos Aires',
      cbu: '0070000900000000000048',
      cuit_titular: '30111222334',
      moneda: 'USD',
    }, token);
    assert.equal(okOperativos.statusCode, 200);
    assert.equal(okOperativos.body.cuenta.alias, 'CUENTA.ALIAS.ACTUALIZADO');
    assert.equal(okOperativos.body.cuenta.nombre_fantasia, 'Cuenta Galic Recaudación');
    assert.equal(okOperativos.body.cuenta.cbu.trim(), '0070000900000000000048');
  });
});
