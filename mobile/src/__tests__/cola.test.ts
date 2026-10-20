/// <reference types="node" />
// Cola de sincronización sin conexión: entregas (HU #22 E2), entregas multimarca en lote (HU #23 E3) y cobros (HU #26 E2, #29 E2), con idempotencia.
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorApi, ErrorRed } from '../errores';
import { Almacen, ColaOperaciones, Operacion } from '../sincronizacion/cola';
import type { CobroDto } from '../tipos';

function almacenEnMemoria(): Almacen {
  const datos = new Map<string, string>();
  return {
    async getItem(clave) { return datos.get(clave) ?? null; },
    async setItem(clave, valor) { datos.set(clave, valor); },
  };
}

function cuerpoCobro(clave: string, registradoEn = '2026-10-19T08:00:00.000Z'): CobroDto {
  return { pagos: [{ claveIdempotencia: clave, medioPago: 'efectivo', importeCentavos: 1000 }], registradoEn, ubicacion: null };
}

function cobro(visitaId: string, clave: string, registradoEn?: string): Operacion {
  return { tipo: 'cobro', visitaId, cuerpo: cuerpoCobro(clave, registradoEn) };
}

function entrega(remitoId: string, timestamp = '2026-10-19T07:55:00.000Z'): Operacion {
  return { tipo: 'entrega', visitaId: '1', remitoId, cuerpo: { timestamp, latitud: -34.92, longitud: -57.95 } };
}

function entregaLote(visitaId: string, remitoIds: string[], timestamp = '2026-10-19T07:55:00.000Z'): Operacion {
  const base = { timestamp, latitud: -34.92, longitud: -57.95 };
  return {
    tipo: 'entrega_lote',
    visitaId,
    cuerpoGeneral: base,
    entregas: remitoIds.map((remitoId) => ({ remitoId, cuerpo: { ...base } })),
  };
}

describe('Cola de operaciones sin conexión', () => {
  let almacen: Almacen;
  let respuesta: (operacion: Operacion) => Promise<void>;
  let enviados: Operacion[];
  let cola: ColaOperaciones;

  beforeEach(() => {
    almacen = almacenEnMemoria();
    enviados = [];
    respuesta = async () => undefined;
    cola = new ColaOperaciones(almacen, async (operacion) => {
      await respuesta(operacion);
      enviados.push(operacion);
    });
  });

  it('guarda las operaciones sin red y las envía en orden cuando vuelve la conexión', async () => {
    respuesta = async () => { throw new ErrorRed(); };
    await cola.encolar(entrega('10'));
    await cola.encolar(entrega('11'));
    await cola.encolar(cobro('1', 'a'));

    const sinRed = await cola.sincronizar();
    assert.deepEqual(sinRed, { sincronizados: 0, rechazados: 0, pendientes: 3, sesionVencida: false });

    respuesta = async () => undefined;
    assert.equal((await cola.sincronizar()).sincronizados, 3);
    // La entrega llega antes que el cobro de la misma visita.
    assert.deepEqual(enviados.map((op) => op.tipo), ['entrega', 'entrega', 'cobro']);
  });

  it('HU #22 ESCENARIO 2: la entrega guardada sin conexión conserva la hora en que se confirmó', async () => {
    respuesta = async () => { throw new ErrorRed(); };
    await cola.encolar(entrega('10', '2026-10-19T05:12:00.000Z'));
    await cola.sincronizar();
    respuesta = async () => undefined;
    await cola.sincronizar();
    const enviada = enviados[0];
    assert.equal(enviada.tipo === 'entrega' && enviada.cuerpo.timestamp, '2026-10-19T05:12:00.000Z');
  });

  it('sobrevive a un cierre de la app: la cola queda en el almacenamiento', async () => {
    await cola.encolar(cobro('1', 'a'));
    const reabierta = new ColaOperaciones(almacen, async () => undefined);
    assert.equal((await reabierta.listar())[0].estado, 'pendiente');
    assert.equal((await reabierta.sincronizar()).sincronizados, 1);
  });

  it('lee la cola guardada por la versión anterior de la app (solo cobros, sin tipo)', async () => {
    await almacen.setItem('cola-cobros', JSON.stringify([{ visitaId: '9', cuerpo: cuerpoCobro('x'), estado: 'pendiente' }]));
    const [item] = await cola.listar();
    assert.equal(item.tipo, 'cobro');
    assert.equal((await cola.estadoPorClave()).get('cobro:9')?.estado, 'pendiente');
  });

  it('reenvía siempre las mismas claves de idempotencia y no vuelve a enviar lo sincronizado', async () => {
    let intentos = 0;
    respuesta = async () => { intentos += 1; if (intentos === 1) throw new ErrorRed(); };
    await cola.encolar(cobro('1', 'clave-fija'));
    await cola.sincronizar();
    await cola.sincronizar();
    await cola.sincronizar();
    assert.equal(intentos, 2);
    const enviado = enviados[0];
    assert.equal(enviado.tipo === 'cobro' && enviado.cuerpo.pagos[0].claveIdempotencia, 'clave-fija');
  });

  it('si el servidor rechaza una operación la marca para corregirla y sigue con las demás', async () => {
    respuesta = async (op) => {
      if (op.tipo === 'cobro' && op.visitaId === '1') throw new ErrorApi('Ese número de comprobante ya fue utilizado por este comercio hoy.', 409);
    };
    await cola.encolar(cobro('1', 'a'));
    await cola.encolar(cobro('2', 'b'));
    const resultado = await cola.sincronizar();
    assert.equal(resultado.rechazados, 1);
    assert.equal(resultado.sincronizados, 1);

    const estado = await cola.estadoPorClave();
    assert.equal(estado.get('cobro:1')?.estado, 'rechazado');
    assert.match(estado.get('cobro:1')?.motivo || '', /ya fue utilizado/);

    // El transportista corrige y vuelve a cobrar: el intento rechazado se reemplaza.
    respuesta = async () => undefined;
    await cola.encolar(cobro('1', 'c'));
    assert.equal((await cola.listar()).filter((item) => item.tipo === 'cobro' && item.visitaId === '1').length, 1);
    assert.equal((await cola.sincronizar()).sincronizados, 1);
  });

  it('distingue entregas por remito y cobros por visita', async () => {
    await cola.encolar(entrega('10'));
    await cola.encolar(cobro('1', 'a'));
    const estado = await cola.estadoPorClave();
    assert.deepEqual([...estado.keys()].sort(), ['cobro:1', 'entrega:10']);
  });

  it('con la sesión vencida se detiene y conserva las operaciones para después del login', async () => {
    respuesta = async () => { throw new ErrorApi('Sesión expirada', 401); };
    await cola.encolar(cobro('1', 'a'));
    const resultado = await cola.sincronizar();
    assert.equal(resultado.sesionVencida, true);
    assert.equal(resultado.pendientes, 1);
  });

  it('descarta las sincronizadas de jornadas anteriores', async () => {
    await cola.encolar(cobro('1', 'a', '2026-10-15T08:00:00.000Z'));
    await cola.encolar(entrega('10', '2026-10-15T07:00:00.000Z'));
    await cola.sincronizar();
    await cola.encolar(cobro('2', 'b'), new Date('2026-10-19T08:00:00.000Z'));
    assert.deepEqual((await cola.listar()).map((item) => item.visitaId), ['2']);
  });

  describe('HU #23 · Operación de lote multimarca sin conexión (Regla 4 y Escenario 3)', () => {
    it('ESCENARIO 3: encola lote multimarca como bloque transaccional y alimenta estado individual', async () => {
      respuesta = async () => { throw new ErrorRed(); };
      const ts = '2026-10-20T11:00:00.000Z';
      await cola.encolar(entregaLote('1', ['101', '102', '103'], ts));

      // Se guarda como un solo bloque en la cola
      const items = await cola.listar();
      assert.equal(items.length, 1);
      assert.equal(items[0].tipo, 'entrega_lote');
      assert.equal(items[0].estado, 'pendiente');

      // estadoPorClave alimenta la UI para cada remito individualmente en 'pendiente' ('sin_sincronizar')
      const mapa = await cola.estadoPorClave();
      assert.equal(mapa.get('entrega_lote:1')?.estado, 'pendiente');
      assert.equal(mapa.get('entrega:101')?.estado, 'pendiente');
      assert.equal(mapa.get('entrega:102')?.estado, 'pendiente');
      assert.equal(mapa.get('entrega:103')?.estado, 'pendiente');

      // Intentar sincronizar sin red mantiene los pendientes
      const resOffline = await cola.sincronizar();
      assert.equal(resOffline.sincronizados, 0);
      assert.equal(resOffline.pendientes, 1);

      // Al recuperar conexión, despacha el bloque completo en una sola operación
      respuesta = async () => undefined;
      const resOnline = await cola.sincronizar();
      assert.equal(resOnline.sincronizados, 1);
      assert.equal(resOnline.pendientes, 0);

      assert.equal(enviados.length, 1);
      assert.equal(enviados[0].tipo, 'entrega_lote');
      if (enviados[0].tipo === 'entrega_lote') {
        assert.equal(enviados[0].cuerpoGeneral.timestamp, ts);
        assert.equal(enviados[0].entregas.length, 3);
        assert.equal(enviados[0].entregas[0].remitoId, '101');
      }

      // El mapa ahora refleja todos como sincronizados
      const mapaSync = await cola.estadoPorClave();
      assert.equal(mapaSync.get('entrega:101')?.estado, 'sincronizado');
      assert.equal(mapaSync.get('entrega:102')?.estado, 'sincronizado');
      assert.equal(mapaSync.get('entrega:103')?.estado, 'sincronizado');
    });

    it('al encolar lote multimarca reemplaza entregas individuales previas de los mismos remitos', async () => {
      // Había una entrega individual previa del remito 101 en cola
      await cola.encolar(entrega('101'));
      assert.equal((await cola.listar()).length, 1);

      // Ahora se confirma toda la visita con lote que incluye 101 y 102
      await cola.encolar(entregaLote('1', ['101', '102']));
      const items = await cola.listar();
      assert.equal(items.length, 1);
      assert.equal(items[0].tipo, 'entrega_lote');
    });
  });
});
