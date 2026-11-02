/// <reference types="node" />
// HU #46 · Declarar efectivo recaudado (y anulación, HU #47 E2): reglas del celular y cola sin conexión.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ErrorApi, ErrorRed } from '../errores';
import type { ColaPorClave } from '../dominio/estadoVisita';
import { consolidarParadas } from '../dominio/parada';
import {
  armarDeclaracion,
  efectivoCobrado,
  estadoDeclaracion,
  paradasPendientes,
  puedeAnular,
  validarDeclaracion,
} from '../dominio/rendicion';
import { Almacen, ColaOperaciones, ItemCola, Operacion } from '../sincronizacion/cola';
import type { HojaDeRuta, Remito, RendicionHoja, Visita } from '../tipos';

const remito = (id: string, estado = 'en_ruta', importeCentavos = 100000): Remito => ({
  id, numero: `R-${id}`, marca: 'Lácteos', importeCentavos, estado, bultos: 1,
});

function visita(id: string, orden: number, remitos: Remito[], cobrada = false, efectivoCobradoCentavos = 0): Visita {
  const totalCentavos = remitos.filter((r) => r.estado !== 'no_entregado').reduce((s, r) => s + r.importeCentavos, 0);
  return {
    id, orden, estado: 'pendiente', cobrada, efectivoCobradoCentavos,
    comercio: { id, razonSocial: `Comercio ${id}`, nombreFantasia: null, domicilio: 'X', localidad: null, ventanaDesde: null, ventanaHasta: null, telefono: null },
    remitos,
    importe: { totalCentavos, subtotalesPorMarca: [], remitosExcluidos: [], sinCobroEnDestino: totalCentavos === 0 },
  };
}

function hoja(visitas: Visita[], rendicion: RendicionHoja | null = null): HojaDeRuta {
  return { id: '7', fechaReparto: '2026-11-02', patente: 'AF-321-JK', estado: 'en_curso', sucursal: 'Central', visitas, rendicion };
}

const CLAVE = '11111111-1111-4111-8111-111111111111';
const vacia: ColaPorClave = new Map();

function cobroEnCola(visitaId: string, pagos: [string, number][], estado: ItemCola['estado'] = 'pendiente'): [string, ItemCola] {
  return [
    `cobro:${visitaId}`,
    {
      tipo: 'cobro', visitaId, estado,
      cuerpo: {
        pagos: pagos.map(([medioPago, importeCentavos], i) => ({ claveIdempotencia: `${visitaId}-${i}`, medioPago: medioPago as any, importeCentavos })),
        registradoEn: '2026-11-02T10:00:00.000Z', ubicacion: null,
      },
    },
  ];
}

function rendicionEnCola(estado: ItemCola['estado'], declaradoCentavos = 450000, motivo?: string): [string, ItemCola] {
  return [`rendicion:7`, { tipo: 'rendicion', hojaId: '7', cuerpo: armarDeclaracion('7', declaradoCentavos, CLAVE, new Date('2026-11-02T18:00:00.000Z')), estado, motivo }];
}

function anulacionEnCola(estado: ItemCola['estado']): [string, ItemCola] {
  return [`anulacion_rendicion:${CLAVE}`, { tipo: 'anulacion_rendicion', hojaId: '7', cuerpo: { claveIdempotencia: CLAVE, anuladaEn: '2026-11-02T18:10:00.000Z' }, estado }];
}

const terminada = () => hoja([
  visita('1', 1, [remito('a', 'entregado', 150000), remito('b', 'entregado', 125050)], true, 150000),
  visita('2', 2, [remito('c', 'entregado', 300000)], true, 300000),
  visita('3', 3, [remito('d', 'no_entregado', 80000)]),
]);

describe('HU #46 · Declarar efectivo recaudado', () => {
  it('sugiere el efectivo cobrado: el del servidor y el que sigue en el celular, sin transferencias ni QR', () => {
    const h = hoja([
      visita('1', 1, [remito('a', 'entregado', 150000), remito('b', 'entregado', 125050)], true, 150000),
      visita('2', 2, [remito('c', 'entregado', 300000)]),
    ]);
    const cola: ColaPorClave = new Map([cobroEnCola('2', [['efectivo', 200000], ['qr', 100000]])]);
    assert.equal(efectivoCobrado(h, cola), 350000);
    // Un cobro que el servidor rechazó no cuenta.
    assert.equal(efectivoCobrado(h, new Map([cobroEnCola('2', [['efectivo', 300000]], 'rechazado')])), 150000);
  });

  it('ESCENARIO 1: con la ruta terminada se puede declarar', () => {
    const h = terminada();
    const pendientes = paradasPendientes(consolidarParadas(h.visitas, vacia), vacia);
    assert.equal(pendientes.length, 0);
    assert.deepEqual(validarDeclaracion(pendientes, 450000, estadoDeclaracion(h, vacia)), { ok: true });
    assert.deepEqual(armarDeclaracion('7', 450000, CLAVE, new Date('2026-11-02T18:00:00.000Z')), {
      hojaDeRutaId: '7', declaradoCentavos: 450000, claveIdempotencia: CLAVE, declaradoEn: '2026-11-02T18:00:00.000Z',
    });
  });

  it('ESCENARIO 1: una vez enviada, figura como pendiente de conteo en la caja', () => {
    const h = { ...terminada(), rendicion: { id: '3', estado: 'pendiente' as const, declaradoCentavos: 450000, declaradoEn: '2026-11-02T18:00:00.000Z', claveIdempotencia: CLAVE } };
    assert.equal(estadoDeclaracion(h, new Map([rendicionEnCola('sincronizado')])).estado, 'pendiente');
    assert.equal(estadoDeclaracion(h, vacia).estado, 'pendiente');
    // Lo que informa el servidor después: el supervisor registró una diferencia.
    const enRevision = { ...h, rendicion: { ...h.rendicion, estado: 'con_diferencia' as const } };
    assert.equal(estadoDeclaracion(enRevision, new Map([rendicionEnCola('sincronizado')])).estado, 'con_diferencia');
  });

  it('ESCENARIO 2: sin conexión queda guardada en el celular como "sin sincronizar"', () => {
    const declaracion = estadoDeclaracion(terminada(), new Map([rendicionEnCola('pendiente')]));
    assert.equal(declaracion.estado, 'sin_sincronizar');
    assert.equal(validarDeclaracion([], 450000, declaracion).ok, false);
  });

  it('ESCENARIO 3: con visitas pendientes en el celular bloquea la rendición final', () => {
    const h = hoja([
      visita('1', 1, [remito('a', 'entregado', 150000)], true, 150000),
      visita('2', 2, [remito('c', 'en_ruta', 300000)]),
      visita('3', 3, [remito('d', 'entregado', 80000)]), // entregada, falta cobrar
    ]);
    const pendientes = paradasPendientes(consolidarParadas(h.visitas, vacia), vacia);
    assert.deepEqual(pendientes.map((p) => p.orden), [2, 3]);
    const resultado = validarDeclaracion(pendientes, 150000, estadoDeclaracion(h, vacia));
    assert.deepEqual(resultado, { ok: false, error: 'No podés rendir todavía: te quedan 2 paradas pendientes en la hoja de ruta.' });
  });

  it('ESCENARIO 3: lo que se registró en el celular sin señal también cierra la parada', () => {
    const h = hoja([visita('1', 1, [remito('a', 'en_ruta', 150000)])]);
    const cola: ColaPorClave = new Map([
      ['entrega:a', { tipo: 'entrega', visitaId: '1', remitoId: 'a', cuerpo: { timestamp: '2026-11-02T10:00:00.000Z', latitud: 0, longitud: 0 }, estado: 'pendiente' }],
      cobroEnCola('1', [['efectivo', 150000]]),
    ]);
    assert.equal(paradasPendientes(consolidarParadas(h.visitas, cola), cola).length, 0);
    assert.equal(efectivoCobrado(h, cola), 150000);
  });

  it('exige un monto válido', () => {
    assert.equal(validarDeclaracion([], null, { estado: 'sin_declarar' }).ok, false);
    assert.deepEqual(validarDeclaracion([], 0, { estado: 'sin_declarar' }), { ok: true });
  });

  it('si el servidor rechazó la declaración, se puede volver a declarar y se muestra el motivo', () => {
    const declaracion = estadoDeclaracion(terminada(), new Map([rendicionEnCola('rechazado', 450000, 'Tenés 1 visita pendiente')]));
    assert.deepEqual(declaracion, { estado: 'sin_declarar', motivoRechazo: 'Tenés 1 visita pendiente' });
  });
});

describe('HU #47 E2 · Anular la declaración desde la app', () => {
  it('se puede anular mientras no la contó el supervisor', () => {
    assert.equal(puedeAnular(estadoDeclaracion(terminada(), new Map([rendicionEnCola('pendiente')]))), true);
    assert.equal(puedeAnular({ estado: 'con_diferencia', declaradoCentavos: 1, claveIdempotencia: CLAVE, declaradoEn: null }), false);
    assert.equal(puedeAnular({ estado: 'validada', declaradoCentavos: 1, claveIdempotencia: CLAVE, declaradoEn: null }), false);
  });

  it('una anulación (aunque siga en el celular) deja la hoja sin declarar', () => {
    const h = { ...terminada(), rendicion: { id: '3', estado: 'pendiente' as const, declaradoCentavos: 450000, declaradoEn: null, claveIdempotencia: CLAVE } };
    assert.equal(estadoDeclaracion(h, new Map([rendicionEnCola('sincronizado'), anulacionEnCola('pendiente')])).estado, 'sin_declarar');
    assert.equal(estadoDeclaracion(h, new Map([anulacionEnCola('sincronizado')])).estado, 'sin_declarar');
  });
});

describe('Cola sin conexión · declaración y anulación', () => {
  function almacenEnMemoria(): Almacen {
    const datos = new Map<string, string>();
    return { async getItem(c) { return datos.get(c) ?? null; }, async setItem(c, v) { datos.set(c, v); } };
  }
  const declaracion = (): Operacion => ({ tipo: 'rendicion', hojaId: '7', cuerpo: armarDeclaracion('7', 450000, CLAVE, new Date('2026-11-02T18:00:00.000Z')) });
  const anulacion = (): Operacion => ({ tipo: 'anulacion_rendicion', hojaId: '7', cuerpo: { claveIdempotencia: CLAVE, anuladaEn: '2026-11-02T18:10:00.000Z' } });

  let enviados: Operacion[];
  let respuesta: (operacion: Operacion) => Promise<void>;
  let cola: ColaOperaciones;
  beforeEach(() => {
    enviados = [];
    respuesta = async () => undefined;
    cola = new ColaOperaciones(almacenEnMemoria(), async (operacion) => {
      await respuesta(operacion);
      enviados.push(operacion);
    });
  });

  it('ESCENARIO 2: sin red queda pendiente y se envía después de los cobros, al volver la señal', async () => {
    await cola.encolar({ tipo: 'cobro', visitaId: '2', cuerpo: { pagos: [{ claveIdempotencia: 'x', medioPago: 'efectivo', importeCentavos: 300000 }], registradoEn: '2026-11-02T17:00:00.000Z', ubicacion: null } });
    await cola.encolar(declaracion());
    respuesta = async () => { throw new ErrorRed('sin red'); };
    assert.equal((await cola.sincronizar()).pendientes, 2);

    respuesta = async () => undefined;
    const resultado = await cola.sincronizar();
    assert.equal(resultado.sincronizados, 2);
    assert.deepEqual(enviados.map((op) => op.tipo), ['cobro', 'rendicion']);
    assert.equal((await cola.estadoPorClave()).get('rendicion:7')?.estado, 'sincronizado');
  });

  it('ESCENARIO 3: si el servidor la bloquea por visitas pendientes, queda rechazada con el motivo', async () => {
    await cola.encolar(declaracion());
    respuesta = async () => { throw new ErrorApi('No podés rendir todavía: tenés 1 visita(s) pendiente(s) en la hoja de ruta.', 409); };
    await cola.sincronizar();
    const item = (await cola.estadoPorClave()).get('rendicion:7');
    assert.equal(item?.estado, 'rechazado');
    assert.match(item?.motivo ?? '', /visita\(s\) pendiente/);
  });

  it('la anulación sale después de la declaración, aunque las dos se hayan hecho sin señal', async () => {
    await cola.encolar(declaracion());
    await cola.encolar(anulacion());
    await cola.sincronizar();
    assert.deepEqual(enviados.map((op) => op.tipo), ['rendicion', 'anulacion_rendicion']);
  });

  it('anular una declaración que el servidor rechazó solo la descarta del celular', async () => {
    await cola.encolar(declaracion());
    respuesta = async () => { throw new ErrorApi('Ya declaraste el efectivo de esta hoja de ruta.', 409); };
    await cola.sincronizar();
    await cola.encolar(anulacion());
    assert.deepEqual(await cola.listar(), []);
  });
});
