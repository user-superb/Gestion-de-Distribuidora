// backend/src/__tests__/tableroFiltroSucursal.test.ts
// Historia de Usuario Gerencia: Filtrar los indicadores del tablero por sucursal para analizar el rendimiento local individualizado.
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authService } from '../services/authService.js';
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

describe('HU Gerencia: Filtrar Indicadores del Tablero por Sucursal', () => {
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
        estado text NOT NULL DEFAULT 'en_curso', cobrada_en timestamptz
      );
      CREATE TABLE cobro (
        id serial PRIMARY KEY, visita_id bigint NOT NULL, medio_pago text NOT NULL, importe_centavos bigint NOT NULL,
        registrado_en timestamptz NOT NULL, registrado_por bigint NOT NULL, estado text NOT NULL DEFAULT 'validado',
        clave_idempotencia uuid NOT NULL UNIQUE, creado_en timestamptz DEFAULT now()
      );
      CREATE TABLE remito (
        id serial PRIMARY KEY, numero text NOT NULL, visita_id bigint NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente', motivo_no_entrega text
      );

      INSERT INTO sucursal (id, nombre, activa) VALUES
        (1, 'Sucursal Central - La Plata', true),
        (2, 'Depósito Sur - Berisso', true),
        (3, 'Hub Norte - City Bell', true);

      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo) VALUES
        (1, 'admin', 'Administrador', 'admin@tutucas.com.ar', '${hash}', 'Administrador del sistema', true),
        (2, 'gerente', 'Roberto Gerente', 'gerencia@tutucas.com.ar', '${hash}', 'Gerente', true),
        (3, 'jefe_central', 'Jefe Central', 'jefe.central@tutucas.com.ar', '${hash}', 'Administrativo', true),
        (4, 'jefe_sur', 'Jefe Sur', 'jefe.sur@tutucas.com.ar', '${hash}', 'Administrativo', true);

      -- Jefe Central solo tiene permiso en Sucursal 1
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (3, 1);

      -- Jefe Sur solo tiene permiso en Sucursal 2
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (4, 2);

      INSERT INTO comercio (id, razon_social, domicilio) VALUES (1, 'Kiosco 1', 'Calle 1'), (2, 'Almacén 2', 'Calle 2');

      -- Datos de Sucursal 1 (Central): $50.000 en Efectivo, 3 remitos (2 entregados, 1 pendiente)
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (1, 1, 1, '2026-11-07', 'en_curso');

      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden) VALUES (1, 1, 1, 1);
      INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, registrado_por, estado, clave_idempotencia)
      VALUES (1, 'efectivo', 5000000, now(), 1, 'validado', '${crypto.randomUUID()}');
      INSERT INTO remito (id, numero, visita_id, estado) VALUES
        (1, 'R-C1', 1, 'entregado'),
        (2, 'R-C2', 1, 'entregado'),
        (3, 'R-C3', 1, 'pendiente');

      -- Datos de Sucursal 2 (Sur): $80.000 en Transferencia, 2 remitos (1 entregado, 1 rechazado)
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (2, 2, 1, '2026-11-07', 'en_curso');

      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden) VALUES (2, 2, 2, 1);
      INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, registrado_por, estado, clave_idempotencia)
      VALUES (2, 'transferencia', 8000000, now(), 1, 'validado', '${crypto.randomUUID()}');
      INSERT INTO remito (id, numero, visita_id, estado) VALUES
        (4, 'R-S1', 2, 'entregado'),
        (5, 'R-S2', 2, 'no_entregado');
    `);

    const { Pool } = mem.adapters.createPg();
    db.setPool(new Pool() as any);
  });

  it('ESCENARIO 1: Segmentación de datos correcta: El gerente selecciona una sucursal y todos los gráficos financieros y logísticos mutan para mostrar exclusivamente la actividad de esa filial', async () => {
    const tokenGerente = await obtenerToken('gerencia@tutucas.com.ar');

    // 1. Consulta financiera y logística para Sucursal 1 (Central)
    const recSuc1 = await dispatch(tableroRouter, 'GET', '/recaudacion', tokenGerente, { sucursalId: '1' });
    assert.equal(recSuc1.statusCode, 200);
    assert.equal(recSuc1.body.totalRecaudadoPesos, 50000);
    assert.equal(recSuc1.body.desglose.find((d: any) => d.medioPago === 'efectivo').totalPesos, 50000);
    assert.equal(recSuc1.body.desglose.find((d: any) => d.medioPago === 'transferencia').totalPesos, 0);

    const entSuc1 = await dispatch(tableroRouter, 'GET', '/entregas-diarias', tokenGerente, { sucursalId: '1', fecha: '2026-11-07' });
    assert.equal(entSuc1.statusCode, 200);
    assert.equal(entSuc1.body.totalDespachados, 3);
    assert.equal(entSuc1.body.exitosas, 2);
    assert.equal(entSuc1.body.pendientes, 1);
    assert.equal(entSuc1.body.rechazadas, 0);

    // 2. Conmuta a Sucursal 2 (Sur): ambos indicadores financieros y logísticos mutan exactamente
    const recSuc2 = await dispatch(tableroRouter, 'GET', '/recaudacion', tokenGerente, { sucursalId: '2' });
    assert.equal(recSuc2.statusCode, 200);
    assert.equal(recSuc2.body.totalRecaudadoPesos, 80000);
    assert.equal(recSuc2.body.desglose.find((d: any) => d.medioPago === 'transferencia').totalPesos, 80000);
    assert.equal(recSuc2.body.desglose.find((d: any) => d.medioPago === 'efectivo').totalPesos, 0);

    const entSuc2 = await dispatch(tableroRouter, 'GET', '/entregas-diarias', tokenGerente, { sucursalId: '2', fecha: '2026-11-07' });
    assert.equal(entSuc2.statusCode, 200);
    assert.equal(entSuc2.body.totalDespachados, 2);
    assert.equal(entSuc2.body.exitosas, 1);
    assert.equal(entSuc2.body.pendientes, 0);
    assert.equal(entSuc2.body.rechazadas, 1);

    // 3. Consulta global consolidada (sin sucursalId): suma ambas filiales ($130.000 y 5 remitos)
    const recGlobal = await dispatch(tableroRouter, 'GET', '/recaudacion', tokenGerente);
    assert.equal(recGlobal.statusCode, 200);
    assert.equal(recGlobal.body.totalRecaudadoPesos, 130000);

    const entGlobal = await dispatch(tableroRouter, 'GET', '/entregas-diarias', tokenGerente, { fecha: '2026-11-07' });
    assert.equal(entGlobal.statusCode, 200);
    assert.equal(entGlobal.body.totalDespachados, 5);
  });

  it('ESCENARIO 2: Fallo por carencia de accesos: Un jefe de área que no posee permisos de visualización para determinada sucursal intenta ver el tablero. El sistema intercepta y deniega el acceso a las métricas ajenas', async () => {
    // Jefe Central solo tiene permiso en Sucursal 1 (id: 1)
    const tokenJefeCentral = await obtenerToken('jefe.central@tutucas.com.ar');

    // 1. Acceso permitido a su sucursal autorizada (Sucursal 1)
    const recPermitido = await dispatch(tableroRouter, 'GET', '/recaudacion', tokenJefeCentral, { sucursalId: '1' });
    assert.equal(recPermitido.statusCode, 200);
    assert.equal(recPermitido.body.totalRecaudadoPesos, 50000);

    const entPermitido = await dispatch(tableroRouter, 'GET', '/entregas-diarias', tokenJefeCentral, { sucursalId: '1', fecha: '2026-11-07' });
    assert.equal(entPermitido.statusCode, 200);

    // 2. Intento de ver métricas de Sucursal 2 (Sur) para la cual no tiene permisos
    const recDenegado = await dispatch(tableroRouter, 'GET', '/recaudacion', tokenJefeCentral, { sucursalId: '2' });
    assert.equal(recDenegado.statusCode, 403);
    assert.equal(recDenegado.body.error, 'ACCESO_DENEGADO_SUCURSAL');
    assert.match(recDenegado.body.message, /No posees permisos de visualización/i);

    const entDenegado = await dispatch(tableroRouter, 'GET', '/entregas-diarias', tokenJefeCentral, { sucursalId: '2', fecha: '2026-11-07' });
    assert.equal(entDenegado.statusCode, 403);
    assert.equal(entDenegado.body.error, 'ACCESO_DENEGADO_SUCURSAL');
  });

  it('CATÁLOGO /api/tablero/sucursales-permitidas: Expone todas las filiales a perfiles globales y solo las asignadas a usuarios locales', async () => {
    const tokenGerente = await obtenerToken('gerencia@tutucas.com.ar');
    const resGerente = await dispatch(tableroRouter, 'GET', '/sucursales-permitidas', tokenGerente);
    assert.equal(resGerente.statusCode, 200);
    assert.equal(resGerente.body.esGlobal, true);
    assert.equal(resGerente.body.sucursales.length, 3);

    const tokenJefeCentral = await obtenerToken('jefe.central@tutucas.com.ar');
    const resJefe = await dispatch(tableroRouter, 'GET', '/sucursales-permitidas', tokenJefeCentral);
    assert.equal(resJefe.statusCode, 200);
    assert.equal(resJefe.body.esGlobal, false);
    assert.equal(resJefe.body.sucursales.length, 1);
    assert.equal(resJefe.body.sucursales[0].id, '1');
    assert.equal(resJefe.body.sucursales[0].nombre, 'Sucursal Central - La Plata');
  });
});
