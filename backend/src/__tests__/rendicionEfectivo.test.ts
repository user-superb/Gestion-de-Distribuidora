// backend/src/__tests__/rendicionEfectivo.test.ts
// Épica 2.3 · Circuito digital de rendición y control de efectivo (HU #46 a #50).
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authService } from '../services/authService.js';
import { cobroService } from '../services/cobroService.js';
import { RendicionError, rendicionService } from '../services/rendicionService.js';
import { movilRouter } from '../routes/movilRoutes.js';
import { efectivoRouter } from '../routes/efectivoRoutes.js';

const CHOFER = 2;
const OTRO_CHOFER = 3;
const SUPERVISOR = 4;
const HOJA = '1';
const FECHA = '2026-11-02';

function declaracion(declaradoCentavos: number, claveIdempotencia: string = crypto.randomUUID(), hojaDeRutaId = HOJA) {
  return { hojaDeRutaId, declaradoCentavos, claveIdempotencia, declaradoEn: '2026-11-02T18:30:00.000-03:00' };
}

async function rechaza(promesa: Promise<unknown>, status: number, mensaje: RegExp) {
  await assert.rejects(promesa, (error: unknown) => {
    assert.ok(error instanceof RendicionError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, mensaje);
    return true;
  });
}

async function uno(sql: string, params: any[] = []) {
  return (await db.query(sql, params)).rows[0];
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

async function dispatch(router: any, method: string, routePath: string, params: Record<string, string>, token: string, body?: any, query: any = {}) {
  const req: any = { method, body, params, query, headers: { authorization: `Bearer ${token}` } };
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

async function token(usuario: string) {
  const result = await authService.login({ identifier: usuario, password: 'Password123!' });
  assert.ok(result.success);
  return result.session!.token;
}

/** Deja la hoja 1 terminada: todo entregado (o rechazado) y cobrado; $ 45.000 en efectivo y $ 12.500,50 por transferencia. */
async function terminarRuta() {
  await db.query(`UPDATE remito SET estado = 'entregado' WHERE visita_id IN (1, 2)`);
  await db.query(`UPDATE remito SET estado = 'no_entregado', motivo_no_entrega = 'Local cerrado' WHERE visita_id = 3`);
  await db.query(`UPDATE visita SET estado = 'completada', cobrada_en = now() WHERE id IN (1, 2)`);
  await db.query(`UPDATE visita SET estado = 'no_realizada' WHERE id = 3`);
  await db.query(`
    INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, registrado_por, clave_idempotencia) VALUES
      (1, 'efectivo', 1500000, now(), 2, '${crypto.randomUUID()}'),
      (1, 'transferencia', 1250050, now(), 2, '${crypto.randomUUID()}'),
      (2, 'efectivo', 3000000, now(), 2, '${crypto.randomUUID()}')`);
}

describe('Épica 2.3 · Rendición y control de efectivo', () => {
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
        fecha_reparto date NOT NULL, patente text, estado text NOT NULL DEFAULT 'borrador', cerrada_en timestamptz
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
      CREATE TABLE rendicion_efectivo (
        id serial PRIMARY KEY, hoja_de_ruta_id bigint NOT NULL, transportista_id bigint,
        declarado_centavos bigint NOT NULL DEFAULT 0, declarado_en timestamptz, clave_idempotencia uuid,
        anulada_en timestamptz, rendido_centavos bigint, conteo_billetes jsonb, motivo_diferencia text,
        diferencia_registrada_por bigint, diferencia_registrada_en timestamptz,
        estado text NOT NULL DEFAULT 'pendiente', validado_por bigint, validado_en timestamptz,
        creado_en timestamptz DEFAULT now()
      );
      CREATE TABLE cobro (
        id serial PRIMARY KEY, visita_id bigint NOT NULL, medio_pago text NOT NULL, importe_centavos bigint NOT NULL,
        registrado_en timestamptz NOT NULL, latitud numeric(9,6), longitud numeric(9,6), registrado_por bigint NOT NULL,
        referencia_transferencia text, estado text NOT NULL DEFAULT 'pendiente', rendicion_id bigint,
        clave_idempotencia uuid NOT NULL UNIQUE, sincronizado_en timestamptz, creado_en timestamptz DEFAULT now()
      );
      CREATE TABLE auditoria (
        id serial PRIMARY KEY, entidad text NOT NULL, entidad_id bigint NOT NULL, accion text NOT NULL,
        usuario_id bigint NOT NULL, ocurrido_en timestamptz DEFAULT now(), valores_antes jsonb, valores_despues jsonb,
        observacion text
      );

      INSERT INTO sucursal (id, nombre) VALUES (1, 'Sucursal Central - La Plata');
      INSERT INTO usuario (id, usuario, nombre, password_hash, rol, es_transportista) VALUES
        (1, 'admin', 'Administrativo', '${hash}', 'Administrativo', false),
        (2, 'chofer', 'Carlos Repartidor', '${hash}', 'Transportista', true),
        (3, 'chofer2', 'Mario Flete', '${hash}', 'Transportista', true),
        (4, 'supervisor', 'Valeria Logística', '${hash}', 'Supervisor', false);
      INSERT INTO usuario_sucursal VALUES (1, 1), (2, 1), (3, 1), (4, 1);
      INSERT INTO marca (id, nombre) VALUES (1, 'Lácteos del Sur'), (2, 'Bebidas Nacionales');
      INSERT INTO comercio (id, razon_social, domicilio) VALUES
        (1, 'Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500'),
        (2, 'Autoservicio Luna', 'Belgrano 1230'),
        (3, 'Distribuidora Los Andes', 'Camino Gral. Belgrano 1800');

      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, patente, estado) VALUES
        (1, 1, 2, '${FECHA}', 'AF-321-JK', 'en_curso'),
        (2, 1, 3, '${FECHA}', 'AB-123-CD', 'en_curso');
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden) VALUES
        (1, 1, 1, 1), (2, 1, 2, 2), (3, 1, 3, 3), (4, 2, 1, 1);
      INSERT INTO remito (id, marca_id, comercio_id, numero, importe_centavos, estado, visita_id) VALUES
        (1, 1, 1, 'R-1', 1500000, 'en_ruta', 1),
        (2, 2, 1, 'R-2', 1250050, 'en_ruta', 1),
        (3, 1, 2, 'R-3', 3000000, 'en_ruta', 2),
        (4, 2, 3, 'R-4',  800000, 'en_ruta', 3),
        (5, 1, 1, 'R-5', 1000000, 'en_ruta', 4);
    `);
    const { Pool } = mem.adapters.createPg();
    db.setPool(new Pool() as any);
  });

  describe('HU #46 · Declarar efectivo recaudado (app móvil)', () => {
    it('ESCENARIO 1: la declaración enviada impacta en el escritorio del supervisor', async () => {
      await terminarRuta();
      const chofer = await token('chofer');
      const res = await dispatch(movilRouter, 'POST', '/rendicion', {}, chofer, declaracion(4500000));
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.rendicion.estado, 'pendiente');
      assert.equal(res.body.rendicion.declaradoCentavos, 4500000);

      const supervisor = await token('supervisor');
      const lista = await dispatch(efectivoRouter, 'GET', '/rendiciones', {}, supervisor, undefined, { estado: 'pendiente' });
      assert.equal(lista.statusCode, 200);
      assert.equal(lista.body.rendiciones.length, 1);
      assert.equal(lista.body.rendiciones[0].transportista.nombre, 'Carlos Repartidor');

      // Los cobros en efectivo de la jornada quedan dentro de la rendición; la transferencia no.
      const ligados = await uno(`SELECT count(*) AS n FROM cobro WHERE rendicion_id IS NOT NULL`);
      assert.equal(Number(ligados.n), 2);
      const auditoria = await uno(`SELECT count(*) AS n FROM auditoria WHERE entidad = 'rendicion_efectivo' AND accion = 'alta'`);
      assert.equal(Number(auditoria.n), 1);
    });

    it('ESCENARIO 1: la hoja de ruta de la app informa la declaración y el efectivo cobrado por visita', async () => {
      await terminarRuta();
      const chofer = await token('chofer');
      const antes = await dispatch(movilRouter, 'GET', '/hoja-de-ruta', {}, chofer, undefined, { fecha: FECHA });
      assert.equal(antes.body.rendicion, null);
      assert.deepEqual(antes.body.visitas.map((v: any) => v.efectivoCobradoCentavos), [1500000, 3000000, 0]);

      await rendicionService.declarar(CHOFER, declaracion(4500000));
      const despues = await dispatch(movilRouter, 'GET', '/hoja-de-ruta', {}, chofer, undefined, { fecha: FECHA });
      assert.equal(despues.body.rendicion.estado, 'pendiente');
      assert.equal(despues.body.rendicion.declaradoCentavos, 4500000);
    });

    it('ESCENARIO 2: la declaración hecha sin conexión se reenvía al recuperar señal sin duplicarse', async () => {
      await terminarRuta();
      const clave = crypto.randomUUID();
      const primera = await rendicionService.declarar(CHOFER, declaracion(4500000, clave));
      const reenvio = await rendicionService.declarar(CHOFER, declaracion(4500000, clave));
      assert.equal(primera.duplicado, false);
      assert.equal(reenvio.duplicado, true);
      assert.equal(reenvio.rendicion!.id, primera.rendicion!.id);
      const total = await uno(`SELECT count(*) AS n FROM rendicion_efectivo`);
      assert.equal(Number(total.n), 1);
    });

    it('ESCENARIO 3: con visitas pendientes la rendición final se bloquea', async () => {
      await rechaza(rendicionService.declarar(CHOFER, declaracion(0)), 409, /visita\(s\) pendiente/);
      try {
        await rendicionService.declarar(CHOFER, declaracion(0));
      } catch (error: any) {
        assert.equal(error.details.codigo, 'VISITAS_PENDIENTES');
        assert.deepEqual(error.details.visitasPendientes.map((v: any) => v.orden), [1, 2, 3]);
      }
      const total = await uno(`SELECT count(*) AS n FROM rendicion_efectivo`);
      assert.equal(Number(total.n), 0);
    });

    it('ESCENARIO 3: una visita entregada pero sin cobrar también cuenta como pendiente', async () => {
      await terminarRuta();
      await db.query(`UPDATE visita SET cobrada_en = NULL WHERE id = 2`);
      await assert.rejects(rendicionService.declarar(CHOFER, declaracion(4500000)), (error: any) => {
        assert.equal(error.status, 409);
        assert.deepEqual(error.details.visitasPendientes, [{ visitaId: '2', orden: 2, comercio: 'Autoservicio Luna', motivo: 'falta el cobro' }]);
        return true;
      });
    });

    it('valida el monto, la hoja y que no haya otra declaración activa', async () => {
      await terminarRuta();
      await rechaza(rendicionService.declarar(CHOFER, declaracion(-100)), 422, /negativo/);
      await rechaza(rendicionService.declarar(OTRO_CHOFER, declaracion(100)), 404, /no está asignada/);
      await rendicionService.declarar(CHOFER, declaracion(4500000));
      await rechaza(rendicionService.declarar(CHOFER, declaracion(4500000)), 409, /Ya declaraste/);
    });

    it('solo un transportista puede declarar desde la app', async () => {
      const supervisor = await token('supervisor');
      const res = await dispatch(movilRouter, 'POST', '/rendicion', {}, supervisor, declaracion(100));
      assert.equal(res.statusCode, 403);
    });
  });

  describe('Opción 1 · Inicio de arqueo por el supervisor (escritorio web)', () => {
    it('lista hojas de ruta pendientes de arqueo', async () => {
      const supervisor = await token('supervisor');
      const res = await dispatch(efectivoRouter, 'GET', '/hojas-pendientes', {}, supervisor, undefined, { fecha: FECHA });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.hojas.length >= 1);
      assert.ok(res.body.hojas.some((h: any) => h.codigoHoja === 'HR-0001'));
    });

    it('el supervisor inicia el arqueo precargando automáticamente el efectivo cobrado', async () => {
      await terminarRuta();
      const supervisor = await token('supervisor');
      const res = await dispatch(efectivoRouter, 'POST', '/iniciar', {}, supervisor, { hojaDeRutaId: '1' });
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.rendicion.estado, 'pendiente');
      assert.equal(res.body.rendicion.declaradoCentavos, 4500000); // 15.000 + 30.000 de cobros en efectivo
      assert.equal(res.body.rendicion.hojaDeRutaId, '1');

      // Verifica que los cobros en efectivo quedaron ligados a la nueva rendición
      const ligados = await uno(`SELECT count(*) AS n FROM cobro WHERE rendicion_id = $1`, [res.body.rendicion.id]);
      assert.equal(Number(ligados.n), 2);

      // Ahora la hoja 1 no debe aparecer en hojas pendientes de arqueo
      const pendientes = await dispatch(efectivoRouter, 'GET', '/hojas-pendientes', {}, supervisor, undefined, { fecha: FECHA });
      assert.ok(!pendientes.body.hojas.some((h: any) => h.hojaId === '1'));
    });

    it('bloquea el inicio del arqueo si la hoja tiene visitas pendientes', async () => {
      // Hoja 1 sin terminar visitas
      const supervisor = await token('supervisor');
      const res = await dispatch(efectivoRouter, 'POST', '/iniciar', {}, supervisor, { hojaDeRutaId: '1' });
      assert.equal(res.statusCode, 409);
      assert.match(res.body.message, /visita\(s\) pendiente/);
    });

    it('permite forzar el arqueo manual con paradas pendientes si se indica forzar: true', async () => {
      // Hoja 1 con visitas pendientes
      const supervisor = await token('supervisor');
      const res = await dispatch(efectivoRouter, 'POST', '/iniciar', {}, supervisor, { hojaDeRutaId: '1', forzar: true });
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.rendicion.estado, 'pendiente');
      assert.equal(res.body.rendicion.hojaDeRutaId, '1');
    });

    it('automatización: al terminar la ruta la rendición aparece automáticamente en la lista sin inicio manual', async () => {
      await terminarRuta();
      const supervisor = await token('supervisor');
      // No llamamos a POST /iniciar ni a POST /rendicion
      const lista = await dispatch(efectivoRouter, 'GET', '/rendiciones', {}, supervisor, undefined, { estado: 'pendiente' });
      assert.equal(lista.statusCode, 200);
      assert.ok(lista.body.rendiciones.some((r: any) => r.hojaDeRutaId === '1' && r.estado === 'pendiente'));
      const auto = lista.body.rendiciones.find((r: any) => r.hojaDeRutaId === '1');
      assert.equal(auto.declaradoCentavos, 4500000);
    });

    describe('hojas que no se arquean: en borrador o sin paradas', () => {
      // 10: en borrador y vacía (se está armando) · 11: publicada pero sin paradas · 12: en borrador con una parada sin remitos
      beforeEach(async () => {
        await db.query(`
          INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, patente, estado) VALUES
            (10, 1, 3, '${FECHA}', 'BORRADOR', 'borrador'),
            (11, 1, 3, '${FECHA}', 'VACIA', 'publicada'),
            (12, 1, 3, '${FECHA}', 'ARMANDO', 'borrador')`);
        await db.query(`INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden) VALUES (20, 12, 2, 1)`);
      });

      it('la automatización no les genera un arqueo de $0', async () => {
        const supervisor = await token('supervisor');
        const lista = await dispatch(efectivoRouter, 'GET', '/rendiciones', {}, supervisor);
        assert.equal(lista.statusCode, 200);
        assert.deepEqual(lista.body.rendiciones, []);
        assert.equal(Number((await uno(`SELECT count(*) AS n FROM rendicion_efectivo`)).n), 0);
      });

      it('no aparecen entre las hojas para iniciar arqueo', async () => {
        const supervisor = await token('supervisor');
        const res = await dispatch(efectivoRouter, 'GET', '/hojas-pendientes', {}, supervisor);
        assert.deepEqual(res.body.hojas.map((h: any) => h.hojaId).sort(), ['1', '2']);
      });

      it('no se les puede iniciar un arqueo, ni siquiera forzándolo', async () => {
        const supervisor = await token('supervisor');
        for (const [hojaDeRutaId, mensaje] of [['10', /todavía no fue despachada/], ['11', /no tiene paradas/], ['12', /todavía no fue despachada/]] as const) {
          const res = await dispatch(efectivoRouter, 'POST', '/iniciar', {}, supervisor, { hojaDeRutaId, forzar: true });
          assert.equal(res.statusCode, 409, `hoja ${hojaDeRutaId}: ${JSON.stringify(res.body)}`);
          assert.match(res.body.message, mensaje);
        }
        assert.equal(Number((await uno(`SELECT count(*) AS n FROM rendicion_efectivo`)).n), 0);
        assert.deepEqual((await db.query(`SELECT estado FROM hoja_de_ruta WHERE id IN (10, 11, 12) ORDER BY id`)).rows.map((r) => r.estado), ['borrador', 'publicada', 'borrador']);
      });
    });
  });

  describe('HU #47 · Visualizar declaración de efectivo (escritorio)', () => {
    it('ESCENARIO 1: muestra el nombre del transportista, el monto declarado y la fecha de la hoja de ruta', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      const supervisor = await token('supervisor');
      const res = await dispatch(efectivoRouter, 'GET', '/rendiciones/:id', { id: rendicion!.id }, supervisor);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.transportista.nombre, 'Carlos Repartidor');
      assert.equal(res.body.declaradoCentavos, 4500000);
      assert.equal(res.body.fechaReparto, FECHA);
      assert.equal(res.body.efectivoCobradoCentavos, 4500000);
      assert.equal(res.body.cobrosEfectivo.length, 2);
    });

    it('ESCENARIO 2: si el transportista la anuló, el sistema advierte que fue retractada', async () => {
      await terminarRuta();
      const clave = crypto.randomUUID();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000, clave));
      const chofer = await token('chofer');
      const anulada = await dispatch(movilRouter, 'POST', '/rendicion/anular', {}, chofer, { claveIdempotencia: clave });
      assert.equal(anulada.statusCode, 200, JSON.stringify(anulada.body));

      const supervisor = await token('supervisor');
      const res = await dispatch(efectivoRouter, 'GET', '/rendiciones/:id', { id: rendicion!.id }, supervisor);
      assert.equal(res.statusCode, 410);
      assert.equal(res.body.error, 'RENDICION_RETRACTADA');
      assert.match(res.body.message, /Carlos Repartidor retractó esta declaración/);

      // Tampoco se puede contar ni aprobar.
      const aprobar = await dispatch(efectivoRouter, 'POST', '/rendiciones/:id/aprobar', { id: rendicion!.id }, supervisor, { rendidoCentavos: 4500000 });
      assert.equal(aprobar.statusCode, 410);
      // Los cobros vuelven a quedar libres y el transportista puede declarar de nuevo.
      assert.equal(Number((await uno(`SELECT count(*) AS n FROM cobro WHERE rendicion_id IS NOT NULL`)).n), 0);
      const nueva = await rendicionService.declarar(CHOFER, declaracion(4400000));
      assert.equal(nueva.rendicion!.estado, 'pendiente');
    });

    it('no se puede anular una declaración que el supervisor ya está contando', async () => {
      await terminarRuta();
      const clave = crypto.randomUUID();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000, clave));
      await rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4400000, justificacion: 'Falta un billete de mil' });
      await rechaza(rendicionService.anular(CHOFER, { claveIdempotencia: clave }), 409, /ya está contando/);
    });

    it('solo el supervisor de efectivo accede a las rendiciones', async () => {
      for (const usuario of ['chofer', 'admin']) {
        const res = await dispatch(efectivoRouter, 'GET', '/rendiciones', {}, await token(usuario));
        assert.equal(res.statusCode, 403, usuario);
      }
    });
  });

  describe('HU #48 · Aprobar rendición de efectivo', () => {
    it('ESCENARIO 1: el dinero contado cuadra con lo declarado y el supervisor valida sin diferencias', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      const supervisor = await token('supervisor');
      const conteo = { billetes: { '2000000': 2, '200000': 2, '100000': 1 }, monedasCentavos: 0 };
      const res = await dispatch(efectivoRouter, 'POST', '/rendiciones/:id/aprobar', { id: rendicion!.id }, supervisor, { rendidoCentavos: 4500000, conteo });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.estado, 'validada');
      assert.equal(res.body.diferenciaCentavos, 0);
      assert.equal(res.body.validadoPor, 'Valeria Logística');

      // Se cierra el circuito del chofer: la hoja queda cerrada y los cobros en efectivo validados.
      assert.equal((await uno(`SELECT estado FROM hoja_de_ruta WHERE id = 1`)).estado, 'cerrada');
      assert.equal(Number((await uno(`SELECT count(*) AS n FROM cobro WHERE estado = 'validado'`)).n), 2);
    });

    it('solo es coincidente si el monto es exactamente igual: si no, pide registrar la diferencia', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      await rechaza(rendicionService.aprobar(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4499999 }), 422, /no coincide.*Registrá la diferencia/);
      assert.equal((await uno(`SELECT estado FROM rendicion_efectivo`)).estado, 'pendiente');
      assert.equal((await uno(`SELECT estado FROM hoja_de_ruta WHERE id = 1`)).estado, 'en_curso');
    });

    it('el detalle de billetes tiene que sumar el total contado', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      await rechaza(
        rendicionService.aprobar(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4500000, conteo: { billetes: { '2000000': 2 }, monedasCentavos: 0 } }),
        400,
        /no coincide con el detalle/
      );
    });
  });

  describe('HU #49 · Registrar diferencia en el efectivo físico', () => {
    it('ESCENARIO 1: con el monto real contado calcula el faltante y exige justificación escrita', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      await rechaza(rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4300000 }), 422, /justificación escrita/);
      await rechaza(rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4300000, justificacion: 'falta' }), 422, /al menos 10/);

      const resultado = await rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, {
        rendidoCentavos: 4300000,
        justificacion: 'Faltan dos billetes de $1.000 en el sobre',
      });
      assert.equal(resultado!.estado, 'con_diferencia');
      assert.equal(resultado!.diferenciaCentavos, -200000);
      assert.equal(resultado!.tipoDiferencia, 'faltante');
      assert.equal(resultado!.motivoDiferencia, 'Faltan dos billetes de $1.000 en el sobre');
      assert.equal(resultado!.diferenciaRegistradaPor, 'Valeria Logística');
      // Registrar la diferencia no cierra la ruta: falta la aprobación (HU #50).
      assert.equal((await uno(`SELECT estado FROM hoja_de_ruta WHERE id = 1`)).estado, 'en_curso');
    });

    it('ESCENARIO 1: también asienta sobrantes', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      const resultado = await rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, {
        rendidoCentavos: 4550000,
        justificacion: 'Sobra un billete de $500 sin identificar',
      });
      assert.equal(resultado!.diferenciaCentavos, 50000);
      assert.equal(resultado!.tipoDiferencia, 'sobrante');
    });

    it('ESCENARIO 2: un valor negativo en el conteo de billetes se bloquea por ilógico', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      const supervisor = await token('supervisor');
      const negativo = await dispatch(efectivoRouter, 'POST', '/rendiciones/:id/diferencia', { id: rendicion!.id }, supervisor, {
        rendidoCentavos: -100000,
        justificacion: 'Conteo con error de tipeo',
      });
      assert.equal(negativo.statusCode, 400);
      assert.match(negativo.body.message, /no admite valores negativos/);

      await rechaza(
        rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, {
          conteo: { billetes: { '2000000': 3, '1000000': -2 }, monedasCentavos: 0 },
          justificacion: 'Conteo con error de tipeo',
        }),
        400,
        /no admite valores negativos/
      );
      const sinCambios = await uno(`SELECT estado, rendido_centavos FROM rendicion_efectivo`);
      assert.equal(sinCambios.estado, 'pendiente');
      assert.equal(sinCambios.rendido_centavos, null);
    });

    it('si el conteo coincide no hay diferencia para registrar', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      await rechaza(
        rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4500000, justificacion: 'Sin novedades en el conteo' }),
        422,
        /no hay diferencia/
      );
    });
  });

  describe('HU #50 · Aprobar rendición con diferencia', () => {
    it('ESCENARIO 1: con monto y motivo calcula la diferencia, cierra la ruta y deja asentado el descuadre', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      await rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, {
        rendidoCentavos: 4300000,
        justificacion: 'Faltan dos billetes de $1.000 en el sobre',
      });

      const supervisor = await token('supervisor');
      const res = await dispatch(efectivoRouter, 'POST', '/rendiciones/:id/aprobar-con-diferencia', { id: rendicion!.id }, supervisor, {
        rendidoCentavos: 4300000,
        motivo: 'El chofer reconoce el faltante; se descuenta de la liquidación',
      });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.estado, 'validada');
      assert.equal(res.body.diferenciaCentavos, -200000);
      assert.equal(res.body.motivoDiferencia, 'El chofer reconoce el faltante; se descuenta de la liquidación');
      assert.equal((await uno(`SELECT estado FROM hoja_de_ruta WHERE id = 1`)).estado, 'cerrada');

      const auditoria = await uno(
        `SELECT valores_despues, observacion FROM auditoria WHERE entidad = 'rendicion_efectivo' AND accion = 'validacion'`
      );
      const despues = typeof auditoria.valores_despues === 'string' ? JSON.parse(auditoria.valores_despues) : auditoria.valores_despues;
      assert.equal(despues.descuadre, true);
      assert.equal(despues.diferenciaCentavos, -200000);
      assert.match(auditoria.observacion, /reconoce el faltante/);

      // Cerrada, ya no admite más cambios.
      await rechaza(rendicionService.registrarDiferencia(SUPERVISOR, rendicion!.id, { rendidoCentavos: 1, justificacion: 'Otro intento de conteo' }), 409, /ya fue aprobada/);
    });

    it('se puede aprobar con diferencia directamente desde una declaración pendiente, siempre con motivo', async () => {
      await terminarRuta();
      const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
      await rechaza(rendicionService.aprobarConDiferencia(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4600000 }), 422, /justificación escrita/);
      await rechaza(
        rendicionService.aprobarConDiferencia(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4500000, motivo: 'No debería aprobarse así' }),
        422,
        /sin diferencia/
      );
      const resultado = await rendicionService.aprobarConDiferencia(SUPERVISOR, rendicion!.id, {
        rendidoCentavos: 4600000,
        motivo: 'Sobrante devuelto al chofer: vuelto de un cliente',
      });
      assert.equal(resultado!.estado, 'validada');
      assert.equal(resultado!.tipoDiferencia, 'sobrante');
    });
  });

  it('la hoja de la app ya no aparece después de cerrar la rendición', async () => {
    await terminarRuta();
    const { rendicion } = await rendicionService.declarar(CHOFER, declaracion(4500000));
    await rendicionService.aprobar(SUPERVISOR, rendicion!.id, { rendidoCentavos: 4500000 });
    assert.equal(await cobroService.getHojaDelDia(CHOFER, FECHA), null);
  });
});
