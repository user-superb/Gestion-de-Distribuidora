// backend/src/__tests__/tableroRecaudacion.test.ts
// Historia de Usuario Gerencia: Visualizar en el tablero el volumen de dinero por medio de pago.
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

describe('HU Gerencia: Composición de Recaudación por Medio de Pago', () => {
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
        id serial PRIMARY KEY, sucursal_id bigint NOT NULL, transportista_id bigint NOT NULL,
        fecha_reparto date NOT NULL, estado text NOT NULL DEFAULT 'en_curso'
      );
      CREATE TABLE visita (
        id serial PRIMARY KEY, hoja_de_ruta_id bigint, comercio_id bigint NOT NULL, orden integer,
        estado text NOT NULL DEFAULT 'completada', cobrada_en timestamptz
      );
      CREATE TABLE cobro (
        id serial PRIMARY KEY, visita_id bigint NOT NULL, medio_pago text NOT NULL, importe_centavos bigint NOT NULL,
        registrado_en timestamptz NOT NULL, registrado_por bigint NOT NULL, estado text NOT NULL DEFAULT 'pendiente',
        rendicion_id bigint, clave_idempotencia uuid NOT NULL UNIQUE, creado_en timestamptz DEFAULT now()
      );

      INSERT INTO sucursal (id, nombre) VALUES
        (1, 'Sucursal Central - La Plata'),
        (2, 'Depósito Sur - Berisso');

      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, es_transportista) VALUES
        (1, 'admin', 'Martín Jirafales Coordinador', 'admin@tutucas.com.ar', '${hash}', 'Administrativo', false),
        (2, 'chofer', 'Carlos Repartidor', 'chofer@tutucas.com.ar', '${hash}', 'Transportista', true),
        (3, 'gerencia', 'Roberto Gerente', 'gerencia@tutucas.com.ar', '${hash}', 'Gerente', false),
        (4, 'admin_sistema', 'Administrador del Sistema', 'admin.sistema@tutucas.com.ar', '${hash}', 'Administrador del sistema', false);

      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES
        (1, 1), (2, 1), (3, 1), (4, 1);

      INSERT INTO comercio (id, razon_social, domicilio) VALUES
        (1, 'Mayorista El Sol S.R.L.', 'Av. 7 123'),
        (2, 'Autoservicio Luna', 'Calle 50 456');

      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado) VALUES
        (1, 1, 2, '2026-11-05', 'en_curso'),
        (2, 2, 2, '2026-11-05', 'en_curso');

      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado, cobrada_en) VALUES
        (1, 1, 1, 1, 'completada', '2026-11-05T14:00:00.000Z'),
        (2, 1, 2, 2, 'completada', '2026-11-05T15:30:00.000Z'),
        (3, 2, 1, 1, 'completada', '2026-11-05T16:00:00.000Z');
    `);

    const { Pool } = mem.adapters.createPg();
    db.setPool(new Pool() as any);
  });

  it('ESCENARIO 1: Gráfico de recaudación renderizado: consolida y diferencia pagos confirmados en Efectivo, Transferencia y QR', async () => {
    // Cobros en Hoja 1 (Sucursal 1):
    // 1. Efectivo validado: $2.000 (200.000 centavos)
    // 2. Transferencia validada: $5.000 (500.000 centavos)
    // 3. QR validado: $3.000 (300.000 centavos)
    // 4. Efectivo pendiente: $1.500 (150.000 centavos) -> NO debe sumar en confirmados
    // 5. Cobro rechazado: $500 (50.000 centavos) -> NO debe sumar
    await db.query(`
      INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, registrado_por, estado, clave_idempotencia) VALUES
        (1, 'efectivo', 200000, '2026-11-05T14:10:00.000Z', 2, 'validado', '${crypto.randomUUID()}'),
        (1, 'transferencia', 500000, '2026-11-05T14:15:00.000Z', 2, 'validado', '${crypto.randomUUID()}'),
        (2, 'qr', 300000, '2026-11-05T15:35:00.000Z', 2, 'validado', '${crypto.randomUUID()}'),
        (2, 'efectivo', 150000, '2026-11-05T15:40:00.000Z', 2, 'pendiente', '${crypto.randomUUID()}'),
        (2, 'qr', 50000, '2026-11-05T15:45:00.000Z', 2, 'rechazado', '${crypto.randomUUID()}');
    `);

    const resultado = await tableroService.obtenerComposicionRecaudacion({ soloConfirmados: true });

    // Verificación de la consolidación total: solo los pagos confirmados ($2.000 + $5.000 + $3.000 = $10.000)
    assert.equal(resultado.totalRecaudadoCentavos, 1000000);
    assert.equal(resultado.totalRecaudadoPesos, 10000);
    assert.equal(resultado.cantidadTotalPagos, 3);

    // Verificación de la diferenciación por cada medio de pago:
    const efectivo = resultado.desglose.find((d) => d.medioPago === 'efectivo');
    const transferencia = resultado.desglose.find((d) => d.medioPago === 'transferencia');
    const qr = resultado.desglose.find((d) => d.medioPago === 'qr');

    assert.ok(efectivo, 'Debe incluir Efectivo');
    assert.equal(efectivo.totalCentavos, 200000);
    assert.equal(efectivo.totalPesos, 2000);
    assert.equal(efectivo.cantidadPagos, 1);
    assert.equal(efectivo.porcentaje, 20); // 2.000 / 10.000 = 20%

    assert.ok(transferencia, 'Debe incluir Transferencia bancaria');
    assert.equal(transferencia.totalCentavos, 500000);
    assert.equal(transferencia.totalPesos, 5000);
    assert.equal(transferencia.cantidadPagos, 1);
    assert.equal(transferencia.porcentaje, 50); // 5.000 / 10.000 = 50%

    assert.ok(qr, 'Debe incluir Pago QR');
    assert.equal(qr.totalCentavos, 300000);
    assert.equal(qr.totalPesos, 3000);
    assert.equal(qr.cantidadPagos, 1);
    assert.equal(qr.porcentaje, 30); // 3.000 / 10.000 = 30%

    // La suma de los porcentajes de los 3 medios debe cerrar en 100%
    const sumaPorcentajes = resultado.desglose.reduce((acc, curr) => acc + curr.porcentaje, 0);
    assert.equal(sumaPorcentajes, 100);
  });

  it('permite comparar incluyendo pagos pendientes si se solicita explícitamente', async () => {
    await db.query(`
      INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, registrado_por, estado, clave_idempotencia) VALUES
        (1, 'efectivo', 200000, '2026-11-05T14:10:00.000Z', 2, 'validado', '${crypto.randomUUID()}'),
        (2, 'efectivo', 150000, '2026-11-05T15:40:00.000Z', 2, 'pendiente', '${crypto.randomUUID()}'),
        (2, 'qr', 50000, '2026-11-05T15:45:00.000Z', 2, 'rechazado', '${crypto.randomUUID()}');
    `);

    const resultado = await tableroService.obtenerComposicionRecaudacion({ soloConfirmados: false });

    // Debe incluir el efectivo pendiente pero no el cobro rechazado
    assert.equal(resultado.totalRecaudadoCentavos, 350000);
    assert.equal(resultado.totalRecaudadoPesos, 3500);
    assert.equal(resultado.cantidadTotalPagos, 2);

    const efectivo = resultado.desglose.find((d) => d.medioPago === 'efectivo');
    assert.equal(efectivo?.totalCentavos, 350000);
    assert.equal(efectivo?.cantidadPagos, 2);
  });

  it('mantiene la estructura con 0% y $0 si no hay pagos registrados en un medio', async () => {
    // Solo registramos transferencia
    await db.query(`
      INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, registrado_por, estado, clave_idempotencia) VALUES
        (1, 'transferencia', 500000, '2026-11-05T14:15:00.000Z', 2, 'validado', '${crypto.randomUUID()}');
    `);

    const resultado = await tableroService.obtenerComposicionRecaudacion();

    assert.equal(resultado.totalRecaudadoCentavos, 500000);
    assert.equal(resultado.desglose.length, 3);

    const efectivo = resultado.desglose.find((d) => d.medioPago === 'efectivo');
    const qr = resultado.desglose.find((d) => d.medioPago === 'qr');
    const transferencia = resultado.desglose.find((d) => d.medioPago === 'transferencia');

    assert.equal(efectivo?.totalCentavos, 0);
    assert.equal(efectivo?.porcentaje, 0);
    assert.equal(qr?.totalCentavos, 0);
    assert.equal(qr?.porcentaje, 0);
    assert.equal(transferencia?.porcentaje, 100);
  });

  it('filtra correctamente por sucursal', async () => {
    // Cobro en Sucursal 1 (visita 1) y Cobro en Sucursal 2 (visita 3)
    await db.query(`
      INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, registrado_por, estado, clave_idempotencia) VALUES
        (1, 'efectivo', 100000, '2026-11-05T14:10:00.000Z', 2, 'validado', '${crypto.randomUUID()}'),
        (3, 'qr', 400000, '2026-11-05T16:15:00.000Z', 2, 'validado', '${crypto.randomUUID()}');
    `);

    const resultadoSucursal1 = await tableroService.obtenerComposicionRecaudacion({ sucursalId: '1' });
    assert.equal(resultadoSucursal1.totalRecaudadoCentavos, 100000);
    const efectivoSuc1 = resultadoSucursal1.desglose.find((d) => d.medioPago === 'efectivo');
    assert.equal(efectivoSuc1?.totalCentavos, 100000);
    assert.equal(efectivoSuc1?.porcentaje, 100);

    const resultadoSucursal2 = await tableroService.obtenerComposicionRecaudacion({ sucursalId: '2' });
    assert.equal(resultadoSucursal2.totalRecaudadoCentavos, 400000);
    const qrSuc2 = resultadoSucursal2.desglose.find((d) => d.medioPago === 'qr');
    assert.equal(qrSuc2?.totalCentavos, 400000);
    assert.equal(qrSuc2?.porcentaje, 100);
  });

  describe('Control de Accesos y API REST (/api/tablero/recaudacion)', () => {
    it('permite acceso al rol Gerente', async () => {
      const token = await obtenerToken('gerencia');
      const res = await dispatch(tableroRouter, 'GET', '/recaudacion', token);
      assert.equal(res.statusCode, 200);
      assert.ok(Array.isArray(res.body.desglose));
    });

    it('permite acceso al Administrador del sistema y Administrativo', async () => {
      const tokenAdminSis = await obtenerToken('admin_sistema');
      const resSis = await dispatch(tableroRouter, 'GET', '/recaudacion', tokenAdminSis);
      assert.equal(resSis.statusCode, 200);

      const tokenAdmin = await obtenerToken('admin');
      const resAdmin = await dispatch(tableroRouter, 'GET', '/recaudacion', tokenAdmin);
      assert.equal(resAdmin.statusCode, 200);
    });

    it('deniega acceso con 403 a usuarios no gerenciales (Transportista)', async () => {
      const tokenChofer = await obtenerToken('chofer');
      const res = await dispatch(tableroRouter, 'GET', '/recaudacion', tokenChofer);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'FORBIDDEN');
    });

    it('deniega acceso con 401 si no hay token de autenticación', async () => {
      const res = await dispatch(tableroRouter, 'GET', '/recaudacion');
      assert.equal(res.statusCode, 401);
    });

    it('valida formato de fechas rechazando valores incorrectos con 400', async () => {
      const token = await obtenerToken('gerencia');
      const res = await dispatch(tableroRouter, 'GET', '/recaudacion', token, { fechaDesde: '2026/11/05' });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'INVALID_DATE');
    });
  });
});
