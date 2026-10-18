/// <reference types="node" />
// Cola de sincronización sin conexión (HU #26 E2, #29 E2 y RNF de idempotencia).
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorApi, ErrorRed } from '../errores';
import { Almacen, ColaCobros } from '../sincronizacion/cola';
import type { CobroDto } from '../tipos';

function almacenEnMemoria(): Almacen {
  const datos = new Map<string, string>();
  return {
    async getItem(clave) { return datos.get(clave) ?? null; },
    async setItem(clave, valor) { datos.set(clave, valor); },
  };
}

function cobro(clave: string, registradoEn = '2026-10-19T08:00:00.000Z'): CobroDto {
  return {
    pagos: [{ claveIdempotencia: clave, medioPago: 'efectivo', importeCentavos: 1000 }],
    registradoEn,
    ubicacion: null,
  };
}

describe('Cola de cobros sin conexión', () => {
  let almacen: Almacen;
  let respuesta: (visitaId: string) => Promise<void>;
  let enviados: { visitaId: string; cuerpo: CobroDto }[];
  let cola: ColaCobros;

  beforeEach(() => {
    almacen = almacenEnMemoria();
    enviados = [];
    respuesta = async () => undefined;
    cola = new ColaCobros(almacen, async (visitaId, cuerpo) => {
      await respuesta(visitaId);
      enviados.push({ visitaId, cuerpo });
    });
  });

  it('guarda el cobro sin red y lo envía cuando vuelve la conexión', async () => {
    respuesta = async () => { throw new ErrorRed(); };
    await cola.encolar('1', cobro('a'));
    await cola.encolar('2', cobro('b'));

    const sinRed = await cola.sincronizar();
    assert.deepEqual(sinRed, { sincronizados: 0, rechazados: 0, pendientes: 2, sesionVencida: false });

    respuesta = async () => undefined;
    const conRed = await cola.sincronizar();
    assert.equal(conRed.sincronizados, 2);
    assert.deepEqual(enviados.map((e) => e.visitaId), ['1', '2']);
  });

  it('sobrevive a un cierre de la app: la cola queda en el almacenamiento', async () => {
    await cola.encolar('1', cobro('a'));
    const reabierta = new ColaCobros(almacen, async () => undefined);
    assert.equal((await reabierta.listar())[0].estado, 'pendiente');
    assert.equal((await reabierta.sincronizar()).sincronizados, 1);
  });

  it('reenvía siempre las mismas claves de idempotencia y no vuelve a enviar lo sincronizado', async () => {
    let intentos = 0;
    respuesta = async () => { intentos += 1; if (intentos === 1) throw new ErrorRed(); };
    await cola.encolar('1', cobro('clave-fija'));
    await cola.sincronizar();
    await cola.sincronizar();
    await cola.sincronizar();
    assert.equal(intentos, 2);
    assert.equal(enviados[0].cuerpo.pagos[0].claveIdempotencia, 'clave-fija');
  });

  it('si el servidor rechaza el cobro lo marca para corregirlo y sigue con los demás', async () => {
    respuesta = async (visitaId) => {
      if (visitaId === '1') throw new ErrorApi('Ese número de comprobante ya fue utilizado por este comercio hoy.', 409);
    };
    await cola.encolar('1', cobro('a'));
    await cola.encolar('2', cobro('b'));
    const resultado = await cola.sincronizar();
    assert.equal(resultado.rechazados, 1);
    assert.equal(resultado.sincronizados, 1);

    const estado = await cola.estadoPorVisita();
    assert.equal(estado.get('1')?.estado, 'rechazado');
    assert.match(estado.get('1')?.motivo || '', /ya fue utilizado/);

    // El transportista corrige y vuelve a cobrar: el intento rechazado se reemplaza.
    respuesta = async () => undefined;
    await cola.encolar('1', cobro('c'));
    assert.equal((await cola.listar()).filter((item) => item.visitaId === '1').length, 1);
    assert.equal((await cola.sincronizar()).sincronizados, 1);
  });

  it('con la sesión vencida se detiene y conserva los cobros para después del login', async () => {
    respuesta = async () => { throw new ErrorApi('Sesión expirada', 401); };
    await cola.encolar('1', cobro('a'));
    const resultado = await cola.sincronizar();
    assert.equal(resultado.sesionVencida, true);
    assert.equal(resultado.pendientes, 1);
  });

  it('descarta los sincronizados de jornadas anteriores', async () => {
    await cola.encolar('1', cobro('a', '2026-10-15T08:00:00.000Z'));
    await cola.sincronizar();
    await cola.encolar('2', cobro('b'), new Date('2026-10-19T08:00:00.000Z'));
    assert.deepEqual((await cola.listar()).map((item) => item.visitaId), ['2']);
  });
});
