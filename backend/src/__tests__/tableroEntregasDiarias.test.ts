// backend/src/__tests__/tableroEntregasDiarias.test.ts
// Historia de Usuario Gerencia: Visualizar las métricas de entregas diarias para evaluar la eficiencia de la flota logística.
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authService } from '../services/authService.js';
import { tableroService } from '../services/tableroService.js';
import { tableroRouter } from '../routes/tableroRoutes.js';

function responseMock() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    setHeader() { return this; },
  };
}

async function dispatch(router: any, method: string, routePath: string, token?: string, query: Record<string, string> = {}) {
  const req: any = {
    method,
    url: routePath,
    body: {},
    params: {},
    query,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'user-agent': 'test-runner',
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = responseMock();

  for (const layer of router.stack.filter((item: any) => !item.route)) {
    let continued = false;
    await layer.handle(req, res, () => { continued = true; });
    if (!continued) return res;
  }

  const layer = router.stack.find((item: any) => item.route?.path === routePath && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `No existe la ruta ${method} ${routePath}`);
  await layer.route.stack[0].handle(req, res, () => undefined);
  return res;
}

async function obtenerToken(usuario: string) {
  const loginResult = await authService.login({ identifier: usuario, password: 'Password123!' });
  assert.ok(loginResult.success, `No se pudo loguear ${usuario}`);
  return loginResult.session!.token;
}

describe('HU Gerencia: Métricas de Entregas Diarias y Eficiencia de Flota', () => {
  beforeEach(async () => {
    authService.resetLockout();
    const mem = newDb();
    const hash = bcryptjs.hashSync('Password123!', 4);

    mem.public.none(`
      CREATE TABLE sucursal (id serial PRIMARY KEY, nombre text NOT NULL UNIQUE, activa boolean NOT NULL DEFAULT true);
      CREATE TABLE usuario (
        id serial PRIMARY KEY, usuario text NOT NULL UNIQUE, nombre text NOT NULL, email text,
        password_hash text NOT NULL, rol text NOT NULL, es_transportista boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true
      );
      CREATE TABLE usuario_sucursal (usuario_id bigint NOT NULL, sucursal_id bigint NOT NULL, PRIMARY KEY (usuario_id, sucursal_id));
      CREATE TABLE sesion_usuario (
        id text PRIMARY KEY, usuario_id bigint NOT NULL, token text NOT NULL UNIQUE, ip_address text, user_agent text,
        creado_en timestamptz DEFAULT now(), ultimo_acceso timestamptz DEFAULT now(), expira_en timestamptz NOT NULL,
        revocado boolean NOT NULL DEFAULT false, revocado_en timestamptz, motivo_cierre text
      );
      CREATE TABLE comercio (
        id serial PRIMARY KEY, razon_social text NOT NULL, domicilio text NOT NULL
      );
      CREATE TABLE hoja_de_ruta (
        id serial PRIMARY KEY, sucursal_id bigint NOT NULL, transportista_id bigint,
        fecha_reparto date NOT NULL, estado text NOT NULL DEFAULT 'en_curso'
      );
      CREATE TABLE visita (
        id serial PRIMARY KEY, hoja_de_ruta_id bigint, comercio_id bigint NOT NULL, orden integer,
        estado text NOT NULL DEFAULT 'en_curso'
      );
      CREATE TABLE remito (
        id serial PRIMARY KEY, numero text NOT NULL, visita_id bigint NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente', motivo_no_entrega text
      );

      INSERT INTO sucursal (id, nombre) VALUES (1, 'Sucursal Central'), (2, 'Depósito Sur');
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo) VALUES
        (1, 'admin', 'Administrador', 'admin@tutucas.com.ar', '${hash}', 'Administrador del sistema', true),
        (2, 'gerente', 'Roberto Gerente', 'gerencia@tutucas.com.ar', '${hash}', 'Gerente', true),
        (3, 'administrativo', 'Ana Admin', 'ana@tutucas.com.ar', '${hash}', 'Administrativo', true),
        (4, 'chofer', 'Carlos Chofer', 'chofer@tutucas.com.ar', '${hash}', 'Transportista', true);
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (1, 1), (2, 1), (3, 1), (4, 1);
      INSERT INTO comercio (id, razon_social, domicilio) VALUES (1, 'Kiosco Central', 'Calle 1');
    `);

    const { Pool } = mem.adapters.createPg();
    db.setPool(new Pool() as any);
  });

  it('ESCENARIO 1: Carga de métricas exitosa: consolida y grafica la cantidad de entregas exitosas, pendientes y rechazadas del día', async () => {
    // Hoja en curso para 2026-11-07
    await db.query(`
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (1, 1, 4, '2026-11-07', 'en_curso');

      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado)
      VALUES (1, 1, 1, 1, 'en_curso'), (2, 1, 1, 2, 'en_curso');

      INSERT INTO remito (id, numero, visita_id, estado) VALUES
        (1, 'R-001', 1, 'entregado'),
        (2, 'R-002', 1, 'entregado'),
        (3, 'R-003', 1, 'entregado'),
        (4, 'R-004', 1, 'no_entregado'),
        (5, 'R-005', 2, 'pendiente'),
        (6, 'R-006', 2, 'en_ruta');
    `);

    const res = await tableroService.obtenerMetricasEntregasDiarias({ fecha: '2026-11-07' });

    assert.equal(res.operacionInactiva, false);
    assert.equal(res.totalDespachados, 6);
    assert.equal(res.exitosas, 3);
    assert.equal(res.rechazadas, 1);
    assert.equal(res.pendientes, 2);
    assert.equal(res.porcentajeExitosas, 50.0);
    assert.equal(res.porcentajeRechazadas, 16.7);
    assert.equal(res.porcentajePendientes, 33.3);
    assert.equal(res.tasaEfectividad, 50.0);
  });

  it('ESCENARIO 2: Fallo visual por inactividad comercial: Se selecciona para analizar una fecha donde no hubo despachos. El sistema muestra la métrica plana indicando "Operación inactiva en la fecha"', async () => {
    // Consultamos fecha sin hojas de ruta
    const res = await tableroService.obtenerMetricasEntregasDiarias({ fecha: '2026-11-08' });

    assert.equal(res.operacionInactiva, true);
    assert.equal(res.totalDespachados, 0);
    assert.equal(res.exitosas, 0);
    assert.equal(res.pendientes, 0);
    assert.equal(res.rechazadas, 0);
    assert.equal(res.tasaEfectividad, 0);
    assert.equal(res.mensajeEstado, 'Operación inactiva en la fecha');
  });

  it('ignora hojas de ruta anuladas en el cálculo', async () => {
    await db.query(`
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (1, 1, 4, '2026-11-07', 'anulada');

      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado)
      VALUES (1, 1, 1, 1, 'en_curso');

      INSERT INTO remito (id, numero, visita_id, estado) VALUES (1, 'R-001', 1, 'entregado');
    `);

    const res = await tableroService.obtenerMetricasEntregasDiarias({ fecha: '2026-11-07' });
    assert.equal(res.operacionInactiva, true);
    assert.equal(res.totalDespachados, 0);
    assert.equal(res.mensajeEstado, 'Operación inactiva en la fecha');
  });

  it('filtra correctamente por sucursal', async () => {
    await db.query(`
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado) VALUES
        (1, 1, 4, '2026-11-07', 'en_curso'),
        (2, 2, 4, '2026-11-07', 'en_curso');

      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado) VALUES
        (1, 1, 1, 1, 'en_curso'),
        (2, 2, 1, 1, 'en_curso');

      INSERT INTO remito (id, numero, visita_id, estado) VALUES
        (1, 'R-001', 1, 'entregado'),
        (2, 'R-002', 2, 'no_entregado');
    `);

    // Consulta para Sucursal 1
    const resSuc1 = await tableroService.obtenerMetricasEntregasDiarias({ fecha: '2026-11-07', sucursalId: '1' });
    assert.equal(resSuc1.totalDespachados, 1);
    assert.equal(resSuc1.exitosas, 1);
    assert.equal(resSuc1.rechazadas, 0);

    // Consulta para Sucursal 2
    const resSuc2 = await tableroService.obtenerMetricasEntregasDiarias({ fecha: '2026-11-07', sucursalId: '2' });
    assert.equal(resSuc2.totalDespachados, 1);
    assert.equal(resSuc2.exitosas, 0);
    assert.equal(resSuc2.rechazadas, 1);
  });

  describe('Control de Accesos y API REST (/api/tablero/entregas-diarias)', () => {
    it('permite acceso al rol Gerente', async () => {
      const token = await obtenerToken('gerencia@tutucas.com.ar');
      const res = await dispatch(tableroRouter, 'GET', '/entregas-diarias', token, { fecha: '2026-11-07' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.operacionInactiva, true);
    });

    it('permite acceso al rol Administrativo y Administrador del sistema', async () => {
      const tokenAdmin = await obtenerToken('admin@tutucas.com.ar');
      const resAdmin = await dispatch(tableroRouter, 'GET', '/entregas-diarias', tokenAdmin, { fecha: '2026-11-07' });
      assert.equal(resAdmin.statusCode, 200);

      const tokenAna = await obtenerToken('ana@tutucas.com.ar');
      const resAna = await dispatch(tableroRouter, 'GET', '/entregas-diarias', tokenAna, { fecha: '2026-11-07' });
      assert.equal(resAna.statusCode, 200);
    });

    it('deniega acceso con 403 a usuarios no gerenciales (Transportista)', async () => {
      const tokenChofer = await obtenerToken('chofer@tutucas.com.ar');
      const res = await dispatch(tableroRouter, 'GET', '/entregas-diarias', tokenChofer, { fecha: '2026-11-07' });
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'FORBIDDEN');
    });

    it('deniega acceso con 401 si no hay token de autenticación', async () => {
      const res = await dispatch(tableroRouter, 'GET', '/entregas-diarias');
      assert.equal(res.statusCode, 401);
    });

    it('valida formato de fecha rechazando valores incorrectos con 400', async () => {
      const token = await obtenerToken('gerencia@tutucas.com.ar');
      const res = await dispatch(tableroRouter, 'GET', '/entregas-diarias', token, { fecha: '07-11-2026' });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'INVALID_DATE');
    });
  });
});
