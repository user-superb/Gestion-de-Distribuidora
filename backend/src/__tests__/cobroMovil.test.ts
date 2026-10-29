// backend/src/__tests__/cobroMovil.test.ts
// Épica 1.4 · HU #25 a #29: cobro en el punto de entrega desde la app móvil.
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authService } from '../services/authService.js';
import { calcularImporteVisita, cobroService, CobroError, rangoDiaArgentina } from '../services/cobroService.js';
import { movilRouter } from '../routes/movilRoutes.js';

const CHOFER = 2;
const OTRO_CHOFER = 3;
const HOY = '2026-10-19T08:30:00.000-03:00';

function pago(medioPago: string, importeCentavos: number, referenciaTransferencia?: string) {
  return { claveIdempotencia: crypto.randomUUID(), medioPago, importeCentavos, referenciaTransferencia };
}

function liquidacion(pagos: any[], registradoEn = HOY) {
  return { pagos, registradoEn, ubicacion: { latitud: -34.9214, longitud: -57.9545, precisionMetros: 12 } };
}

async function rechaza(promesa: Promise<unknown>, status: number, mensaje: RegExp) {
  await assert.rejects(promesa, (error: unknown) => {
    assert.ok(error instanceof CobroError);
    assert.equal(error.status, status);
    assert.match(error.message, mensaje);
    return true;
  });
}

async function contar(sql: string, params: any[] = []) {
  const result = await db.query(sql, params);
  return Number(result.rows[0].n);
}

function responseMock() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    setHeader() { return this; },
  };
}

async function dispatch(method: string, routePath: string, params: Record<string, string>, token: string, body?: any) {
  const req: any = { method, body, params, query: {}, headers: { authorization: `Bearer ${token}` } };
  const res = responseMock();
  for (const layer of (movilRouter as any).stack.filter((item: any) => !item.route)) {
    let continued = false;
    await layer.handle(req, res, () => { continued = true; });
    if (!continued) return res;
  }
  const layer = (movilRouter as any).stack.find(
    (item: any) => item.route?.path === routePath && item.route.methods[method.toLowerCase()]
  );
  assert.ok(layer, `No existe la ruta ${method} ${routePath}`);
  await layer.route.stack[0].handle(req, res, () => undefined);
  return res;
}

async function token(usuario: string) {
  const result = await authService.login({ identifier: usuario, password: 'Password123!' });
  assert.ok(result.success);
  return result.session!.token;
}

describe('Épica 1.4 · Cobro integrado en punto de entrega (app móvil)', () => {
  beforeEach(() => {
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
      CREATE TABLE marca (id serial PRIMARY KEY, nombre text NOT NULL UNIQUE);
      CREATE TABLE comercio (
        id serial PRIMARY KEY, razon_social text NOT NULL, nombre_fantasia text, domicilio text NOT NULL, localidad text,
        ventana_desde time, ventana_hasta time, telefono text
      );
      CREATE TABLE hoja_de_ruta (
        id serial PRIMARY KEY, sucursal_id bigint NOT NULL, transportista_id bigint NOT NULL,
        fecha_reparto date NOT NULL, patente text, estado text NOT NULL DEFAULT 'borrador'
      );
      CREATE TABLE visita (
        id serial PRIMARY KEY, hoja_de_ruta_id bigint, comercio_id bigint NOT NULL, orden integer,
        estado text NOT NULL DEFAULT 'pendiente', registrada_en timestamptz, latitud numeric(9,6), longitud numeric(9,6),
        precision_metros numeric(7,1), gps_disponible boolean, cobrada_en timestamptz
      );
      CREATE TABLE remito (
        id serial PRIMARY KEY, marca_id bigint NOT NULL, comercio_id bigint NOT NULL, numero text NOT NULL,
        importe_centavos bigint NOT NULL, estado text NOT NULL DEFAULT 'pendiente', visita_id bigint,
        motivo_no_entrega text, actualizado_en timestamptz DEFAULT now()
      );
      CREATE TABLE cobro (
        id serial PRIMARY KEY, visita_id bigint NOT NULL, medio_pago text NOT NULL, importe_centavos bigint NOT NULL,
        registrado_en timestamptz NOT NULL, latitud numeric(9,6), longitud numeric(9,6), registrado_por bigint NOT NULL,
        referencia_transferencia text, estado text NOT NULL DEFAULT 'pendiente',
        clave_idempotencia uuid NOT NULL UNIQUE, sincronizado_en timestamptz, creado_en timestamptz DEFAULT now()
      );
      CREATE TABLE auditoria (
        id serial PRIMARY KEY, entidad text NOT NULL, entidad_id bigint NOT NULL, accion text NOT NULL,
        usuario_id bigint NOT NULL, ocurrido_en timestamptz DEFAULT now(), valores_antes jsonb, valores_despues jsonb
      );

      INSERT INTO sucursal (id, nombre) VALUES (1, 'Sucursal Central - La Plata');
      INSERT INTO usuario (id, usuario, nombre, password_hash, rol, es_transportista) VALUES
        (1, 'admin', 'Administrativo', '${hash}', 'Administrativo', false),
        (2, 'chofer', 'Carlos Repartidor', '${hash}', 'Transportista', true),
        (3, 'chofer2', 'Otro Chofer', '${hash}', 'Transportista', true);
      INSERT INTO usuario_sucursal VALUES (1, 1), (2, 1), (3, 1);
      INSERT INTO marca (id, nombre) VALUES (1, 'Lácteos del Sur'), (2, 'Bebidas Nacionales');
      INSERT INTO comercio (id, razon_social, domicilio) VALUES
        (1, 'Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500'),
        (2, 'Autoservicio Luna', 'Belgrano 1230'),
        (3, 'Distribuidora Los Andes', 'Camino Gral. Belgrano 1800');

      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado) VALUES
        (1, 1, 2, '2026-10-19', 'publicada'),
        (2, 1, 3, '2026-10-19', 'publicada');
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden) VALUES
        (1, 1, 1, 1),   -- El Sol: dos marcas, total $ 57.500,50
        (2, 1, 2, 2),   -- Luna: un remito devuelto
        (3, 1, 3, 3),   -- Los Andes: todos los remitos devueltos
        (4, 2, 1, 1);   -- El Sol en la hoja de otro chofer
      INSERT INTO remito (id, marca_id, comercio_id, numero, importe_centavos, estado, visita_id) VALUES
        (1, 1, 1, 'R-1', 4500000, 'en_ruta', 1),
        (2, 2, 1, 'R-2', 1250050, 'en_ruta', 1),
        (3, 1, 2, 'R-3', 3000000, 'en_ruta', 2),
        (4, 2, 2, 'R-4',  800000, 'devuelto', 2),
        (5, 2, 3, 'R-5', 2199999, 'devuelto', 3),
        (6, 1, 1, 'R-6', 1000000, 'en_ruta', 4);
    `);
    const { Pool } = mem.adapters.createPg();
    db.setPool(new Pool() as any);
  });

  describe('HU #25 · Visualizar importe de cobro', () => {
    it('ESCENARIO 1: muestra el total consolidado de solo lectura con el desglose por marca', async () => {
      const hoja = await cobroService.getHojaDelDia(CHOFER, '2026-10-19');
      assert.ok(hoja);
      assert.deepEqual(hoja.visitas.map((v) => v.id), ['1', '2', '3']);
      const importe = hoja.visitas[0].importe;
      assert.equal(importe.totalCentavos, 5750050);
      assert.deepEqual(importe.subtotalesPorMarca, [
        { marca: 'Bebidas Nacionales', importeCentavos: 1250050 },
        { marca: 'Lácteos del Sur', importeCentavos: 4500000 },
      ]);
      assert.equal(importe.sinCobroEnDestino, false);
    });

    it('ESCENARIO 2: sin nada que cobrar muestra $0,00 "Sin cobro en destino" y no exige recaudación', async () => {
      const hoja = await cobroService.getHojaDelDia(CHOFER, '2026-10-19');
      const importe = hoja!.visitas[2].importe;
      assert.equal(importe.totalCentavos, 0);
      assert.equal(importe.sinCobroEnDestino, true);

      const resultado = await cobroService.registrarCobro(CHOFER, '3', liquidacion([]));
      assert.equal(resultado.cobrada, true);
      assert.equal(await contar('SELECT count(*) AS n FROM cobro'), 0);
    });

    it('ESCENARIO 3: descuenta el remito rechazado y muestra solo el neto exigible', () => {
      const importe = calcularImporteVisita([
        { id: '3', numero: 'R-3', marca: 'Alimentos', importeCentavos: 3000000, estado: 'en_ruta' },
        { id: '4', numero: 'R-4', marca: 'Lácteos', importeCentavos: 800000, estado: 'devuelto' },
        { id: '7', numero: 'R-7', marca: 'Lácteos', importeCentavos: 500000, estado: 'no_entregado' },
      ]);
      assert.equal(importe.totalCentavos, 3000000);
      assert.deepEqual(importe.remitosExcluidos, ['R-4', 'R-7']);
      assert.deepEqual(importe.subtotalesPorMarca, [{ marca: 'Alimentos', importeCentavos: 3000000 }]);
    });
  });

  describe('HU #26 · Cobro efectivo total', () => {
    it('ESCENARIO 1: efectivo por el monto exacto liquida la visita', async () => {
      const resultado = await cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('efectivo', 5750050)]));
      assert.equal(resultado.duplicado, false);
      assert.equal(resultado.totalCentavos, 5750050);

      assert.equal(await contar('SELECT count(*) AS n FROM visita WHERE id = 1 AND cobrada_en IS NOT NULL'), 1);
      const cobro = (await db.query('SELECT medio_pago, estado, registrado_por, latitud FROM cobro')).rows[0];
      assert.deepEqual({ ...cobro, registrado_por: Number(cobro.registrado_por), latitud: Number(cobro.latitud) },
        { medio_pago: 'efectivo', estado: 'pendiente', registrado_por: CHOFER, latitud: -34.9214 });
      // La entrega de los remitos la confirma la HU #22, no el cobro.
      assert.equal(await contar("SELECT count(*) AS n FROM remito WHERE visita_id = 1 AND estado = 'en_ruta'"), 2);
      assert.equal(await contar("SELECT count(*) AS n FROM auditoria WHERE entidad = 'cobro' AND accion = 'alta'"), 1);
    });

    it('ESCENARIO 2: el cobro hecho sin conexión se sincroniza una sola vez aunque se reenvíe', async () => {
      // El celular guardó el cobro a las 05:10 y lo envía más tarde, dos veces por una caída de red.
      const offline = liquidacion([pago('efectivo', 5750050)], '2026-10-19T05:10:00.000-03:00');
      const primero = await cobroService.registrarCobro(CHOFER, '1', offline);
      const reenvio = await cobroService.registrarCobro(CHOFER, '1', offline);

      assert.equal(primero.duplicado, false);
      assert.equal(reenvio.duplicado, true);
      assert.deepEqual(reenvio.cobros.map((c) => c.id), primero.cobros.map((c) => c.id));
      assert.equal(await contar('SELECT count(*) AS n FROM cobro'), 1);
      const registrado = (await db.query('SELECT registrado_en FROM cobro')).rows[0].registrado_en;
      assert.equal(new Date(registrado).toISOString(), '2026-10-19T08:10:00.000Z');
    });

    it('ESCENARIO 3: un monto menor al exigido rechaza el cierre del cobro', async () => {
      await rechaza(
        cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('efectivo', 5000000)])),
        422,
        /menor al importe exigido/
      );
      assert.equal(await contar('SELECT count(*) AS n FROM cobro'), 0);
      assert.equal(await contar('SELECT count(*) AS n FROM visita WHERE id = 1 AND cobrada_en IS NULL'), 1);
    });
  });

  describe('HU #27 · Cobro QR total', () => {
    it('registra que la visita se cobró por QR y la liquida', async () => {
      await cobroService.registrarCobro(CHOFER, '2', liquidacion([pago('qr', 3000000)]));
      assert.equal((await db.query('SELECT medio_pago FROM cobro')).rows[0].medio_pago, 'qr');
      assert.equal(await contar('SELECT count(*) AS n FROM visita WHERE id = 2 AND cobrada_en IS NOT NULL'), 1);
      // El remito devuelto no pasa a entregado.
      assert.equal((await db.query('SELECT estado FROM remito WHERE id = 4')).rows[0].estado, 'devuelto');
    });
  });

  describe('HU #28 · Cobro transferencia total', () => {
    it('ESCENARIO 1: con la referencia del banco se cierra el cobro', async () => {
      await cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('transferencia', 5750050, ' op-998877 ')]));
      assert.equal((await db.query('SELECT referencia_transferencia FROM cobro')).rows[0].referencia_transferencia, 'OP-998877');
    });

    it('ESCENARIO 2: bloquea una referencia ya usada por el mismo comercio en el mismo día', async () => {
      // El Sol ya pagó con esa referencia hoy, en la visita de otro chofer.
      await cobroService.registrarCobro(OTRO_CHOFER, '4', liquidacion([pago('transferencia', 1000000, 'OP-1')]));
      await rechaza(
        cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('transferencia', 5750050, 'op-1')])),
        409,
        /ya fue utilizado por este comercio hoy/
      );
      assert.equal(await contar('SELECT count(*) AS n FROM visita WHERE id = 1 AND cobrada_en IS NULL'), 1);
    });

    it('ESCENARIO 2: la misma referencia en otro día no se considera duplicada', async () => {
      await cobroService.registrarCobro(OTRO_CHOFER, '4', liquidacion([pago('transferencia', 1000000, 'OP-1')], '2026-10-18T09:00:00.000-03:00'));
      const resultado = await cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('transferencia', 5750050, 'OP-1')]));
      assert.equal(resultado.cobrada, true);
    });

    it('ESCENARIO 3: sin referencia del banco no se puede confirmar el cobro', async () => {
      await rechaza(
        cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('transferencia', 5750050, '  ')])),
        422,
        /Falta la referencia/
      );
    });
  });

  describe('HU #29 · Cobro combinado', () => {
    it('ESCENARIO 1: con la suma exacta registra el desglose por medio y marca la parada como cobrada', async () => {
      const resultado = await cobroService.registrarCobro(CHOFER, '1', liquidacion([
        pago('efectivo', 2000000),
        pago('transferencia', 2500000, 'OP-55'),
        pago('qr', 1250050),
      ]));
      assert.deepEqual(resultado.cobros.map((c) => c.medioPago), ['efectivo', 'transferencia', 'qr']);
      assert.equal(resultado.totalCentavos, 5750050);
      assert.equal(await contar('SELECT count(*) AS n FROM cobro WHERE visita_id = 1'), 3);
      assert.equal(await contar('SELECT count(*) AS n FROM visita WHERE id = 1 AND cobrada_en IS NOT NULL'), 1);
    });

    it('ESCENARIO 2: el desglose guardado sin conexión se sincroniza completo y sin duplicar', async () => {
      const offline = liquidacion([pago('efectivo', 4000000), pago('transferencia', 1750050, 'OP-77')], '2026-10-19T06:00:00.000-03:00');
      await cobroService.registrarCobro(CHOFER, '1', offline);
      const reenvio = await cobroService.registrarCobro(CHOFER, '1', offline);
      assert.equal(reenvio.duplicado, true);
      assert.equal(await contar('SELECT count(*) AS n FROM cobro'), 2);
    });

    it('ESCENARIO 3: si la suma no coincide informa la diferencia e impide guardar', async () => {
      await assert.rejects(
        cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('efectivo', 5000000), pago('qr', 1000000)])),
        (error: any) => {
          assert.equal(error.status, 422);
          assert.equal(error.details.diferenciaCentavos, 249950);
          return true;
        }
      );
      assert.equal(await contar('SELECT count(*) AS n FROM cobro'), 0);
    });

    it('ESCENARIO 4: si falta un dato obligatorio de un medio de pago impide confirmar', async () => {
      await rechaza(
        cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('efectivo', 4000000), pago('transferencia', 1750050)])),
        422,
        /Falta la referencia/
      );
      assert.equal(await contar('SELECT count(*) AS n FROM cobro'), 0);
    });
  });

  describe('Reglas generales de la API móvil', () => {
    it('no permite cobrar una visita ya cobrada con otro registro', async () => {
      await cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('efectivo', 5750050)]));
      await rechaza(cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('qr', 5750050)])), 409, /ya fue cobrada/);
    });

    it('una visita cerrada por la entrega de todos sus remitos (HU #22) se puede cobrar', async () => {
      await db.query("UPDATE remito SET estado = 'entregado' WHERE visita_id = 1");
      await db.query("UPDATE visita SET estado = 'completada' WHERE id = 1");
      const hoja = await cobroService.getHojaDelDia(CHOFER, '2026-10-19');
      assert.equal(hoja!.visitas[0].cobrada, false);
      assert.equal(hoja!.visitas[0].importe.totalCentavos, 5750050);

      const resultado = await cobroService.registrarCobro(CHOFER, '1', liquidacion([pago('efectivo', 5750050)]));
      assert.equal(resultado.cobrada, true);
      assert.equal((await db.query('SELECT estado FROM visita WHERE id = 1')).rows[0].estado, 'completada');
    });

    it('no permite cobrar visitas de la hoja de ruta de otro transportista', async () => {
      await rechaza(cobroService.registrarCobro(CHOFER, '4', liquidacion([pago('efectivo', 1000000)])), 404, /no pertenece/);
    });

    it('la API móvil exige sesión de transportista', async () => {
      const res = await dispatch('post', '/visitas/:id/cobro', { id: '1' }, await token('admin'), liquidacion([pago('efectivo', 5750050)]));
      assert.equal(res.statusCode, 403);
    });

    it('la API móvil registra el cobro del transportista autenticado', async () => {
      const res = await dispatch('post', '/visitas/:id/cobro', { id: '1' }, await token('chofer'), liquidacion([pago('efectivo', 5750050)]));
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.cobrada, true);
    });

    it('calcula el día en hora argentina', () => {
      const { desde, hasta } = rangoDiaArgentina(new Date('2026-10-19T01:30:00.000Z')); // 22:30 del 18 en Argentina
      assert.equal(desde.toISOString(), '2026-10-18T03:00:00.000Z');
      assert.equal(hasta.toISOString(), '2026-10-19T03:00:00.000Z');
    });
  });
});
