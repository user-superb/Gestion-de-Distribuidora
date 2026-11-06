import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authRouter } from '../routes/authRoutes.js';
import { configuracionRouter, validarCbuChecksum } from '../routes/configuracionRoutes.js';

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

  const cleanPath = path.split('?')[0];

  for (const layer of router.stack.filter((item: any) => !item.route)) {
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

  const idMatch = cleanPath.match(/^\/configuracion\/cuentas-recepcion\/(\d+)$/);
  if (idMatch) {
    req.params.id = idMatch[1];
    await routeHandler(router, method, '/configuracion/cuentas-recepcion/:id')(req, res, () => undefined);
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

describe('HU: Dar de alta una cuenta bancaria de recepción para disponerla como cuenta de acreditación y destino de cobros', () => {
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
    memDb.public.none(`
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo)
      VALUES (1, 'admin', 'Admin Central', 'admin@tutucas.local', '${hash}', 'Administrador del sistema', true);
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (1, 1);

      INSERT INTO sucursal (id, nombre, domicilio, activa) VALUES
        (1, 'Sucursal Centro', 'Av. San Martín 100', true),
        (2, 'Sucursal Norte', 'Ruta 9 Km 5', true);

      INSERT INTO cuenta_recepcion (sucursal_id, nombre_fantasia, alias, cbu, banco, cuit_titular, moneda, activa)
      VALUES (1, 'Cuenta Central', 'ALIAS.EXISTENTE', '2850590940090418135201', 'Banco Macro', '30712345678', 'ARS', true);
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

  async function getAdminToken() {
    const loginRes = await login('admin@tutucas.local');
    assert.equal(loginRes.statusCode, 200);
    return loginRes.body.session.token;
  }

  it('Verificación unitaria: Algoritmo de checksum bancario de 22 dígitos (BCRA ponderado 7-1-3-9)', () => {
    assert.equal(validarCbuChecksum('2850590940090418135201'), true);
    assert.equal(validarCbuChecksum('0720000732000000000010'), true);
    assert.equal(validarCbuChecksum('0110599520000001234569'), true);
    // Dígito verificador del bloque 1 alterado
    assert.equal(validarCbuChecksum('2850590840090418135201'), false);
    // Dígito verificador del bloque 2 alterado
    assert.equal(validarCbuChecksum('2850590940090418135202'), false);
    // Longitud incorrecta
    assert.equal(validarCbuChecksum('285059094009041813520'), false);
    assert.equal(validarCbuChecksum('28505909400904181352011'), false);
    // Caracteres alfabéticos
    assert.equal(validarCbuChecksum('285059094009041813520A'), false);
  });

  it('ESCENARIO 1: Alta exitosa de cuenta receptora: persiste la cuenta en estado "Activa" con todos sus datos requeridos', async () => {
    const token = await getAdminToken();

    // CBU válido de 22 dígitos con checksum verificado (Banco Galicia)
    const cbuValido = '0720000732000000000010';

    const res = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 2,
      nombre_fantasia: 'Cuenta Recaudación Norte',
      alias: 'TUTUCAS.NORTE.RECAUDA',
      cbu: cbuValido,
      banco: 'Banco Galicia',
      cuit_titular: '30999888776',
      moneda: 'ARS',
    }, token);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.cuenta.alias, 'TUTUCAS.NORTE.RECAUDA');
    assert.equal(res.body.cuenta.cbu, cbuValido);
    assert.equal(res.body.cuenta.banco, 'Banco Galicia');
    assert.equal(res.body.cuenta.cuit_titular, '30999888776');
    assert.equal(res.body.cuenta.moneda, 'ARS');
    assert.equal(res.body.cuenta.activa, true);

    // Verificar en la base de datos
    const checkDb = await db.query('SELECT * FROM cuenta_recepcion WHERE alias = $1', ['TUTUCAS.NORTE.RECAUDA']);
    assert.equal(checkDb.rowCount, 1);
    assert.equal(checkDb.rows[0].activa, true);
    assert.equal(checkDb.rows[0].sucursal_id, 2);
  });

  it('ESCENARIO 2: Fallo por CBU o Alias duplicado: bloquea el alta y advierte duplicidad del dato bancario', async () => {
    const token = await getAdminToken();

    // A. Intento de alta con Alias existente ('ALIAS.EXISTENTE')
    const cbuNuevo = '0110599520000001234569';
    const resAliasDup = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 2,
      alias: 'alias.existente', // prueba case-insensitive
      cbu: cbuNuevo,
      banco: 'Banco Nación',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);

    assert.equal(resAliasDup.statusCode, 409);
    assert.equal(resAliasDup.body.error, 'DATO_BANCARIO_DUPLICADO');
    assert.match(resAliasDup.body.message, /el Alias ya se encuentra registrado/i);

    // B. Intento de alta con CBU existente ('2850590940090418135201')
    const resCbuDup = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 2,
      alias: 'NUEVO.ALIAS.DISTINTO',
      cbu: '2850590940090418135201',
      banco: 'Banco Santander',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);

    assert.equal(resCbuDup.statusCode, 409);
    assert.equal(resCbuDup.body.error, 'DATO_BANCARIO_DUPLICADO');
    assert.match(resCbuDup.body.message, /el CBU ya se encuentra registrado/i);
  });

  it('ESCENARIO 3: Fallo por formato de CBU inválido: rechaza cuando no tiene 22 dígitos o no supera el checksum', async () => {
    const token = await getAdminToken();

    // A. CBU con menos de 22 dígitos
    const resCorto = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 1,
      alias: 'ALIAS.INVALIDO.1',
      cbu: '1234567890',
      banco: 'Banco Francés',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);

    assert.equal(resCorto.statusCode, 400);
    assert.equal(resCorto.body.error, 'FORMATO_CBU_INVALIDO');
    assert.equal(resCorto.body.field, 'cbu');
    assert.match(resCorto.body.message, /checksum bancario|22 dígitos/i);

    // B. CBU de 22 dígitos numéricos pero con dígito verificador / checksum erróneo
    const resChecksumFalso = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 1,
      alias: 'ALIAS.INVALIDO.2',
      cbu: '0720000000000000000001', // 22 dígitos pero checksum inválido
      banco: 'Banco Francés',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);

    assert.equal(resChecksumFalso.statusCode, 400);
    assert.equal(resChecksumFalso.body.error, 'FORMATO_CBU_INVALIDO');
    assert.equal(resChecksumFalso.body.field, 'cbu');
    assert.match(resChecksumFalso.body.message, /checksum bancario/i);

    // C. CBU vacío
    const resVacio = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 1,
      alias: 'ALIAS.INVALIDO.3',
      cbu: '',
      banco: 'Banco Francés',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);

    assert.equal(resVacio.statusCode, 400);
    assert.equal(resVacio.body.error, 'FORMATO_CBU_INVALIDO');
  });

  it('REGLA A CONSIDERAR: Banco emisor, CUIT/CUIL del titular y Moneda son obligatorios para habilitar el uso en recaudación', async () => {
    const token = await getAdminToken();
    const cbuValido = '0720000732000000000010';

    // Falta banco
    const resSinBanco = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 1,
      alias: 'ALIAS.SIN.BANCO',
      cbu: cbuValido,
      banco: '',
      cuit_titular: '30712345678',
      moneda: 'ARS',
    }, token);
    assert.equal(resSinBanco.statusCode, 400);
    assert.equal(resSinBanco.body.error, 'DATOS_REQUERIDOS');

    // Falta CUIT o formato inválido
    const resCuitInvalido = await dispatch(configuracionRouter, 'post', '/configuracion/cuentas-recepcion', {
      sucursal_id: 1,
      alias: 'ALIAS.CUIT.MAL',
      cbu: cbuValido,
      banco: 'Banco Provincia',
      cuit_titular: '12345',
      moneda: 'ARS',
    }, token);
    assert.equal(resCuitInvalido.statusCode, 400);
    assert.equal(resCuitInvalido.body.error, 'FORMATO_CUIT_INVALIDO');
  });
});
