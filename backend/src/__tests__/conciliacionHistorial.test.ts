import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authRouter } from '../routes/authRoutes.js';
import { conciliacionRouter } from '../routes/conciliacionRoutes.js';
import { authService } from '../services/authService.js';
import { conciliacionService } from '../services/conciliacionService.js';

const password = 'Password123!';
let pool: any;

function responseMock() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    type() { return this; },
    attachment() { return this; },
    send(payload: any) { this.body = payload; return this; },
    setHeader() { return this; },
  };
}

function routeHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((item: any) => item.route?.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `No route ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
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

async function dispatch(
  method: 'GET' | 'POST',
  path: string,
  token?: string,
  query: Record<string, string> = {}
) {
  const req: any = {
    method,
    url: path,
    query,
    params: {},
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = responseMock();

  for (const layer of (conciliacionRouter as any).stack.filter((item: any) => !item.route)) {
    for (const handle of layer.stack ? layer.stack.map((s: any) => s.handle) : [layer.handle]) {
      let continued = false;
      await handle(req, res as any, (err?: unknown) => {
        if (err) throw err;
        continued = true;
      });
      if (!continued) return res;
    }
  }

  const routeLayer: any = (conciliacionRouter as any).stack.find(
    (item: any) => item.route?.path === path && item.route.methods[method.toLowerCase()]
  );
  assert.ok(routeLayer, `No existe ${method} ${path}`);
  await routeLayer.route.stack[routeLayer.route.stack.length - 1].handle(req, res);
  return res;
}

describe('Historial de Conciliaciones', () => {
  beforeEach(async () => {
    authService.resetLockout();

    const mem = newDb();
    mem.public.none(`
      CREATE TABLE sucursal (id serial PRIMARY KEY, nombre text NOT NULL, codigo text, domicilio text, activa boolean NOT NULL DEFAULT true);
      CREATE TABLE usuario (id serial PRIMARY KEY, usuario text NOT NULL UNIQUE, nombre text NOT NULL, email text, password_hash text NOT NULL, rol text NOT NULL, es_transportista boolean NOT NULL DEFAULT false, activo boolean NOT NULL DEFAULT true);
      CREATE TABLE usuario_sucursal (usuario_id bigint NOT NULL, sucursal_id bigint NOT NULL, PRIMARY KEY(usuario_id, sucursal_id));
      CREATE TABLE sesion_usuario (id text PRIMARY KEY, usuario_id bigint NOT NULL, token text NOT NULL UNIQUE, ip_address text, user_agent text, creado_en timestamp DEFAULT now(), ultimo_acceso timestamp DEFAULT now(), expira_en timestamp NOT NULL, revocado boolean NOT NULL DEFAULT false, revocado_en timestamp, motivo_cierre text);
      CREATE TABLE comercio (id serial PRIMARY KEY, razon_social text NOT NULL, nombre_fantasia text, cuit char(11) NOT NULL);
      CREATE TABLE marca (id serial PRIMARY KEY, nombre text NOT NULL);
      CREATE TABLE remito (id serial PRIMARY KEY, numero text NOT NULL, comercio_id bigint NOT NULL, sucursal_id bigint NOT NULL, importe_centavos bigint NOT NULL, estado text NOT NULL DEFAULT 'entregado', entregado_en timestamp DEFAULT now());
      CREATE TABLE cuenta_recepcion (id serial PRIMARY KEY, sucursal_id bigint NOT NULL, alias text NOT NULL, activa boolean NOT NULL DEFAULT true);
      CREATE TABLE movimiento_bancario (id serial PRIMARY KEY, cuenta_id bigint NOT NULL, fecha_hora timestamp NOT NULL DEFAULT now(), ordenante text NOT NULL, ordenante_cuit char(11), concepto text, referencia_externa text, importe_centavos bigint NOT NULL, origen text NOT NULL DEFAULT 'Extracto Bancario', estado text NOT NULL DEFAULT 'imputado');
      CREATE TABLE movimiento_bancario_comprobante (movimiento_id bigint PRIMARY KEY, nombre_archivo text NOT NULL, tipo_mime text NOT NULL, contenido bytea NOT NULL, tamano_bytes bigint NOT NULL, subido_en timestamp DEFAULT now());
      CREATE TABLE imputacion (id serial PRIMARY KEY, movimiento_bancario_id bigint, remito_id bigint NOT NULL, importe_centavos bigint NOT NULL, imputado_por bigint NOT NULL, imputado_en timestamp DEFAULT now());
    `);

    const hash = bcryptjs.hashSync(password, 4);
    mem.public.none(`
      INSERT INTO sucursal (id, nombre, codigo) VALUES (1, 'Sucursal Central', 'CEN');
      INSERT INTO usuario (id, usuario, email, nombre, rol, password_hash) VALUES
        (1, 'admin', 'admin@tutucas.test', 'Administrador', 'Administrador del sistema', '${hash}'),
        (2, 'operador', 'operador@tutucas.test', 'Operador Administrativo', 'Administrativo', '${hash}'),
        (3, 'chofer', 'chofer@tutucas.test', 'Carlos Chofer', 'Transportista', '${hash}');
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (2, 1);
      INSERT INTO cuenta_recepcion (id, sucursal_id, alias) VALUES (1, 1, 'tutucas.central');
      INSERT INTO comercio (id, razon_social, nombre_fantasia, cuit) VALUES (1, 'Mayorista El Sol S.R.L.', 'El Sol Mayorista', '20123456789');
      INSERT INTO remito (id, numero, comercio_id, sucursal_id, importe_centavos, estado) VALUES (1, 'R-0001-1001', 1, 1, 15000000, 'entregado');
      INSERT INTO movimiento_bancario (id, cuenta_id, ordenante, ordenante_cuit, concepto, referencia_externa, importe_centavos, origen, estado)
        VALUES (1, 1, 'Mayorista El Sol S.R.L.', '20123456789', 'Transferencia recibida', 'REF-9988', 15000000, 'Carga Manual', 'imputado');
      INSERT INTO imputacion (id, movimiento_bancario_id, remito_id, importe_centavos, imputado_por)
        VALUES (1, 1, 1, 15000000, 2);
    `);

    const adapter = mem.adapters.createPg();
    pool = new adapter.Pool();
    db.setPool(pool);
  });

  afterEach(async () => {
    if (pool) await pool.end();
  });

  it('lista correctamente los movimientos conciliados e imputaciones asociadas', async () => {
    const session = { id: 'usr_2', role: 'Administrativo' };
    const historial = await conciliacionService.getHistorialConciliaciones({}, session);

    assert.equal(historial.length, 1);
    const mov = historial[0];
    assert.equal(mov.id, '1');
    assert.equal(mov.ordenante, 'Mayorista El Sol S.R.L.');
    assert.equal(mov.importe_centavos, '15000000');
    assert.equal(mov.origen, 'Carga Manual');
    assert.equal(mov.estado, 'imputado');
    assert.equal(mov.imputaciones.length, 1);

    const imp = mov.imputaciones[0];
    assert.equal(imp.remitoNumero, 'R-0001-1001');
    assert.equal(imp.comercio, 'El Sol Mayorista');
    assert.equal(imp.importeCentavos, '15000000');
    assert.equal(imp.imputadoPor, 'Operador Administrativo');
  });

  it('filtra por búsqueda de texto (ordenante, remito o comercio)', async () => {
    const session = { id: 'usr_2', role: 'Administrativo' };

    // Coincidencia
    const conSol = await conciliacionService.getHistorialConciliaciones({ busqueda: 'Mayorista' }, session);
    assert.equal(conSol.length, 1);

    const conRemito = await conciliacionService.getHistorialConciliaciones({ busqueda: 'R-0001-1001' }, session);
    assert.equal(conRemito.length, 1);

    // Sin coincidencia
    const sinCoincidencia = await conciliacionService.getHistorialConciliaciones({ busqueda: 'Inexistente' }, session);
    assert.equal(sinCoincidencia.length, 0);
  });

  it('permite acceder al endpoint /api/conciliacion/historial con rol Administrativo', async () => {
    const authRes = await login('operador@tutucas.test');
    assert.equal(authRes.statusCode, 200);
    const token = authRes.body.session.token;

    const res = await dispatch('GET', '/historial', token);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, '1');
  });

  it('deniega acceso al endpoint con rol Transportista (403 FORBIDDEN)', async () => {
    const authRes = await login('chofer@tutucas.test');
    assert.equal(authRes.statusCode, 200);
    const token = authRes.body.session.token;

    const res = await dispatch('GET', '/historial', token);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FORBIDDEN');
  });

  it('valida formato de fechas en /api/conciliacion/historial', async () => {
    const authRes = await login('operador@tutucas.test');
    const token = authRes.body.session.token;

    const res = await dispatch('GET', '/historial', token, { desde: 'fecha-invalida' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_FILTER');
  });

  it('muestra todos los N movimientos para un único remito cuando hay discrepancia aprobada (faltante y sobrante)', async () => {
    await pool.query(`
      CREATE TABLE discrepancia_conciliacion (
        id serial PRIMARY KEY,
        movimiento_id bigint NOT NULL,
        movimiento_ids bigint[] NOT NULL DEFAULT '{}',
        remito_ids bigint[] NOT NULL,
        importe_movimiento bigint NOT NULL,
        importe_seleccionado bigint NOT NULL,
        diferencia_centavos bigint NOT NULL,
        nota text NOT NULL,
        motivo_codigo text,
        estado text NOT NULL DEFAULT 'pendiente',
        creada_por bigint NOT NULL,
        creada_en timestamp DEFAULT now(),
        resuelta_por bigint,
        resuelta_en timestamp,
        observacion_resolucion text
      );
      CREATE TABLE discrepancia_comprobante (
        discrepancia_id bigint PRIMARY KEY,
        nombre_archivo text NOT NULL,
        tipo_mime text NOT NULL,
        contenido bytea NOT NULL,
        tamano_bytes bigint NOT NULL
      );
      CREATE TABLE discrepancia_ajuste (
        id serial PRIMARY KEY,
        discrepancia_id bigint NOT NULL,
        remito_id bigint,
        comercio_id bigint,
        tipo text NOT NULL,
        importe_centavos bigint NOT NULL
      );
    `);

    // Caso 1: 2 movimientos → 1 único remito con sobrante donde M2 ya cubre el 100% y M3 queda sin imputación directa
    await pool.query(`
      INSERT INTO remito (id, numero, comercio_id, sucursal_id, importe_centavos, estado)
        VALUES (2, 'R-0002-2001', 1, 1, 100000, 'entregado');
      INSERT INTO movimiento_bancario (id, cuenta_id, ordenante, ordenante_cuit, referencia_externa, importe_centavos, origen, estado) VALUES
        (2, 1, 'Mayorista El Sol S.R.L.', '20123456789', 'REF-SOB-1', 100000, 'Extracto Bancario', 'imputado'),
        (3, 1, 'Mayorista El Sol S.R.L.', '20123456789', 'REF-SOB-2', 25000, 'Extracto Bancario', 'imputado');
      INSERT INTO imputacion (id, movimiento_bancario_id, remito_id, importe_centavos, imputado_por)
        VALUES (2, 2, 2, 100000, 1);
      INSERT INTO discrepancia_conciliacion
        (id, movimiento_id, movimiento_ids, remito_ids, importe_movimiento, importe_seleccionado, diferencia_centavos, nota, motivo_codigo, estado, creada_por, resuelta_por, resuelta_en, observacion_resolucion)
        VALUES (10, 2, ARRAY[2, 3], ARRAY[2], 125000, 100000, 25000, 'Pago anticipado con saldo a favor', 'otro', 'aprobada', 2, 1, now(), 'Aprobado por admin');
      INSERT INTO discrepancia_comprobante (discrepancia_id, nombre_archivo, tipo_mime, contenido, tamano_bytes)
        VALUES (10, 'respaldo-sobrante.pdf', 'application/pdf', '1234'::bytea, 4);
      INSERT INTO discrepancia_ajuste (id, discrepancia_id, remito_id, comercio_id, tipo, importe_centavos)
        VALUES (1, 10, NULL, 1, 'saldo_favor', 25000);
    `);

    const session = { id: 'usr_2', role: 'Administrativo' };
    const historial = await conciliacionService.getHistorialConciliaciones({ busqueda: 'R-0002-2001' }, session);

    assert.equal(historial.length, 2);
    const movIds = historial.map((m) => m.id).sort();
    assert.deepEqual(movIds, ['2', '3']);

    const mov3 = historial.find((m) => m.id === '3')!;
    assert.equal(mov3.referencia_externa, 'REF-SOB-2');
    assert.equal(mov3.imputaciones.length, 1);
    assert.equal(mov3.imputaciones[0].remitoId, '2');
    assert.equal(mov3.imputaciones[0].remitoNumero, 'R-0002-2001');
    assert.equal(mov3.imputaciones[0].importeCentavos, '0');
    assert.equal(mov3.imputaciones[0].esExcedenteDiscrepancia, true);

    for (const mov of historial) {
      assert.equal(mov.discrepancia?.id, '10');
      assert.deepEqual(mov.discrepancia?.movimientoIds, ['2', '3']);
      assert.deepEqual(mov.discrepancia?.remitoIds, ['2']);
      assert.equal(mov.discrepancia?.comprobanteNombre, 'respaldo-sobrante.pdf');
      assert.equal(mov.discrepancia?.ajustes.length, 1);
      assert.equal(mov.discrepancia?.ajustes[0].tipo, 'saldo_favor');
    }
  });
});
