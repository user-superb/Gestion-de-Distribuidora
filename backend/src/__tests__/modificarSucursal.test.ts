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

describe('HU #52: Modificar Datos de Sucursal (Épica 2.4: Modelo Multi-sucursal y Cuentas de Recepción)', () => {
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
      CREATE TABLE hoja_de_ruta (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL,
        transportista_id bigint,
        fecha_reparto date NOT NULL DEFAULT CURRENT_DATE,
        estado text NOT NULL DEFAULT 'en_curso',
        creado_en timestamp DEFAULT now()
      );
      CREATE TABLE remito (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL,
        numero text NOT NULL,
        comercio_id text,
        marca_id text,
        visita_id text,
        importe_centavos bigint NOT NULL DEFAULT 0,
        estado text NOT NULL DEFAULT 'entregado',
        creado_en timestamp DEFAULT now()
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

  it('ESCENARIO 1: Modificación exitosa: Se cambia la dirección física de la sucursal y se guarda correctamente preservando la integridad de los remitos', async () => {
    const token = await adminToken();

    // Consultamos la sucursal Central (id = 1)
    const sucursalAntes = await db.query('SELECT * FROM sucursal WHERE codigo = $1', ['SUC-CEN']);
    assert.equal(sucursalAntes.rows.length, 1);
    const sucursalId = sucursalAntes.rows[0].id;
    assert.equal(sucursalAntes.rows[0].domicilio, 'Calle 12 N° 500, La Plata');

    // Asociamos remitos históricos procesados bajo esta sucursal
    await db.query(`
      INSERT INTO remito (sucursal_id, numero, importe_centavos, estado) VALUES
        (${sucursalId}, 'REM-HIST-001', 1500000, 'entregado'),
        (${sucursalId}, 'REM-HIST-002', 850000, 'cobrado'),
        (${sucursalId}, 'REM-HIST-003', 420000, 'rendido');
    `);

    // Modificamos la dirección física (domicilio) de la sucursal
    const nuevaDireccion = 'Av. 7 N° 850, La Plata';
    const response = await dispatch(
      configuracionRouter,
      'put',
      `/configuracion/sucursales/${sucursalId}`,
      {
        codigo: 'SUC-CEN',
        nombre: 'Sucursal Central - Renovada',
        domicilio: nuevaDireccion,
      },
      token
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.ok(response.body.sucursal);
    assert.equal(response.body.sucursal.domicilio, nuevaDireccion);
    assert.equal(response.body.sucursal.nombre, 'Sucursal Central - Renovada');

    // Verificamos que los datos se actualizaron en la base de datos
    const sucursalDespues = await db.query('SELECT * FROM sucursal WHERE id = $1', [sucursalId]);
    assert.equal(sucursalDespues.rows[0].domicilio, nuevaDireccion);
    assert.equal(sucursalDespues.rows[0].nombre, 'Sucursal Central - Renovada');
    assert.equal(sucursalDespues.rows[0].codigo, 'SUC-CEN');

    // REGLA A CONSIDERAR:
    // La modificación del nombre o dirección de la sucursal no debe afectar la integridad histórica de los remitos ya procesados bajo ella.
    const remitosHistoricos = await db.query(
      'SELECT id, sucursal_id, numero, importe_centavos, estado FROM remito WHERE sucursal_id = $1 ORDER BY numero',
      [sucursalId]
    );
    assert.equal(remitosHistoricos.rows.length, 3);
    assert.equal(remitosHistoricos.rows[0].numero, 'REM-HIST-001');
    assert.equal(remitosHistoricos.rows[0].sucursal_id, sucursalId);
    assert.equal(remitosHistoricos.rows[0].importe_centavos, 1500000);
    assert.equal(remitosHistoricos.rows[0].estado, 'entregado');

    assert.equal(remitosHistoricos.rows[1].numero, 'REM-HIST-002');
    assert.equal(remitosHistoricos.rows[1].sucursal_id, sucursalId);
    assert.equal(remitosHistoricos.rows[1].importe_centavos, 850000);
    assert.equal(remitosHistoricos.rows[1].estado, 'cobrado');

    assert.equal(remitosHistoricos.rows[2].numero, 'REM-HIST-003');
    assert.equal(remitosHistoricos.rows[2].sucursal_id, sucursalId);
    assert.equal(remitosHistoricos.rows[2].importe_centavos, 420000);
    assert.equal(remitosHistoricos.rows[2].estado, 'rendido');
  });

  it('ESCENARIO 2: Fallo por desactivación de sucursal operativa: Se intenta marcar la sucursal como "Inactiva" mientras posee 5 hojas de ruta en calle en progreso. El sistema bloquea la baja lógica.', async () => {
    const token = await adminToken();

    // Obtenemos id de la sucursal
    const sucursalRes = await db.query('SELECT id FROM sucursal WHERE codigo = $1', ['SUC-CEN']);
    const sucursalId = sucursalRes.rows[0].id;

    // Simulamos exactamente 5 hojas de ruta en calle en progreso ('en_curso')
    await db.query(`
      INSERT INTO hoja_de_ruta (sucursal_id, estado) VALUES
        (${sucursalId}, 'en_curso'),
        (${sucursalId}, 'en_curso'),
        (${sucursalId}, 'en_curso'),
        (${sucursalId}, 'en_curso'),
        (${sucursalId}, 'en_curso');
    `);

    // Intentamos marcar la sucursal como "Inactiva"
    const response = await dispatch(
      configuracionRouter,
      'patch',
      `/configuracion/sucursales/${sucursalId}/estado`,
      { activa: false },
      token
    );

    // El sistema debe bloquear la baja lógica con código 409
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error, 'SUCURSAL_OPERATIVA_CON_RUTAS_EN_CURSO');
    assert.match(response.body.message, /posee 5 hoja\(s\) de ruta en calle en progreso/i);
    assert.match(response.body.message, /El sistema bloquea la baja lógica/i);

    // Verificamos que en la base de datos la sucursal sigue activa (no se dio de baja)
    const checkDb = await db.query('SELECT activa FROM sucursal WHERE id = $1', [sucursalId]);
    assert.equal(checkDb.rows[0].activa, true);
  });

  it('ESCENARIO 2 (Variante permitida): Si no posee hojas de ruta en progreso, se permite la desactivación lógica', async () => {
    const token = await adminToken();

    const sucursalRes = await db.query('SELECT id FROM sucursal WHERE codigo = $1', ['SUC-SUR']);
    const sucursalId = sucursalRes.rows[0].id;

    // Hojas de ruta existentes pero ya finalizadas ('cerrada', 'liquidada')
    await db.query(`
      INSERT INTO hoja_de_ruta (sucursal_id, estado) VALUES
        (${sucursalId}, 'cerrada'),
        (${sucursalId}, 'liquidada');
    `);

    // Desactivamos la sucursal
    const response = await dispatch(
      configuracionRouter,
      'patch',
      `/configuracion/sucursales/${sucursalId}/estado`,
      { activa: false },
      token
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.sucursal.activa, false);

    const checkDb = await db.query('SELECT activa FROM sucursal WHERE id = $1', [sucursalId]);
    assert.equal(checkDb.rows[0].activa, false);

    // Y se puede volver a reactivar
    const reactivarRes = await dispatch(
      configuracionRouter,
      'patch',
      `/configuracion/sucursales/${sucursalId}/estado`,
      { activa: true },
      token
    );
    assert.equal(reactivarRes.statusCode, 200);
    assert.equal(reactivarRes.body.sucursal.activa, true);
  });

  it('VALIDACIÓN: No se permite modificar el código de una sucursal existente (solo nombre y dirección)', async () => {
    const token = await adminToken();

    const cenRes = await db.query('SELECT id FROM sucursal WHERE codigo = $1', ['SUC-CEN']);
    const cenId = cenRes.rows[0].id;

    // Intentamos cambiar el código de SUC-CEN a otro código (nuevo o existente)
    const response = await dispatch(
      configuracionRouter,
      'put',
      `/configuracion/sucursales/${cenId}`,
      {
        codigo: 'SUC-NUEVO',
        nombre: 'Sucursal Central',
        domicilio: 'Calle 12 N° 500',
      },
      token
    );

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, 'CODIGO_NO_MODIFICABLE');

    // Verificamos que el código original permanece intacto
    const checkDb = await db.query('SELECT codigo FROM sucursal WHERE id = $1', [cenId]);
    assert.equal(checkDb.rows[0].codigo, 'SUC-CEN');
  });

  it('SEGURIDAD: Solo el Administrador del sistema puede modificar datos o estados de una sucursal', async () => {
    const operator = await login('operador@example.com');
    const operatorToken = operator.body.session.token;

    const forbiddenPut = await dispatch(
      configuracionRouter,
      'put',
      '/configuracion/sucursales/1',
      { codigo: 'SUC-CEN', nombre: 'Cambio No Autorizado', domicilio: 'Calle Nueva' },
      operatorToken
    );
    assert.equal(forbiddenPut.statusCode, 403);

    const forbiddenPatch = await dispatch(
      configuracionRouter,
      'patch',
      '/configuracion/sucursales/1/estado',
      { activa: false },
      operatorToken
    );
    assert.equal(forbiddenPatch.statusCode, 403);
  });
});
