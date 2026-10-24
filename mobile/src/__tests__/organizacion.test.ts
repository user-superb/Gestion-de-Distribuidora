/// <reference types="node" />
// Correcciones del cliente (24/10/2026): hoja dividida en dos pantallas, remitos resueltos abajo
// y selección de qué remitos se entregan.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ColaPorClave } from '../dominio/estadoVisita';
import { esParadaTerminada, faltaCobrar, ordenarRemitosParaEntrega, planificarEntrega, separarParadas } from '../dominio/organizacion';
import { consolidarParadas } from '../dominio/parada';
import type { ItemCola } from '../sincronizacion/cola';
import type { Remito, Visita } from '../tipos';

const remito = (id: string, estado = 'en_ruta', importeCentavos = 1000): Remito => ({
  id, numero: `R-${id}`, marca: 'Lácteos', importeCentavos, estado, bultos: 1,
});

function visita(id: string, orden: number, remitos: Remito[], cobrada = false): Visita {
  return {
    id, orden, estado: 'pendiente', cobrada,
    comercio: { id, razonSocial: `Comercio ${id}`, nombreFantasia: null, domicilio: 'X', localidad: null, ventanaDesde: null, ventanaHasta: null, telefono: null },
    remitos,
    importe: { totalCentavos: 0, subtotalesPorMarca: [], remitosExcluidos: [], sinCobroEnDestino: false },
  };
}

const vacia: ColaPorClave = new Map();
const cobroEnCola = (visitaId: string, estado: ItemCola['estado'] = 'pendiente'): [string, ItemCola] => [
  `cobro:${visitaId}`,
  { tipo: 'cobro', visitaId, cuerpo: { pagos: [], registradoEn: '2026-10-24T08:00:00.000Z', ubicacion: null }, estado },
];
const entregaEnCola = (visitaId: string, remitoId: string): [string, ItemCola] => [
  `entrega:${remitoId}`,
  { tipo: 'entrega', visitaId, remitoId, cuerpo: { timestamp: '2026-10-24T08:00:00.000Z', latitud: 0, longitud: 0 }, estado: 'pendiente' },
];

describe('Corrección 7 · Hoja de ruta en dos pantallas: Por entregar y Entregadas', () => {
  it('una parada pendiente o en curso queda en "Por entregar"', () => {
    const paradas = consolidarParadas([visita('1', 1, [remito('a')]), visita('2', 2, [remito('b', 'entregado'), remito('c')])], vacia);
    const { porEntregar, entregadas } = separarParadas(paradas, vacia);
    assert.deepEqual(porEntregar.map((p) => p.orden), [1, 2]);
    assert.equal(entregadas.length, 0);
  });

  it('una parada entregada y cobrada pasa a "Entregadas", respetando el orden planificado', () => {
    const paradas = consolidarParadas([
      visita('1', 1, [remito('a', 'entregado')], true),
      visita('2', 2, [remito('b')]),
      visita('3', 3, [remito('c', 'entregado')], true),
    ], vacia);
    const { porEntregar, entregadas } = separarParadas(paradas, vacia);
    assert.deepEqual(porEntregar.map((p) => p.orden), [2]);
    assert.deepEqual(entregadas.map((p) => p.orden), [1, 3]);
  });

  it('si se entregó pero falta el cobro, sigue en "Por entregar" marcada como "Falta cobrar"', () => {
    const [parada] = consolidarParadas([visita('1', 1, [remito('a', 'entregado')])], vacia);
    assert.equal(esParadaTerminada(parada, vacia), false);
    assert.equal(faltaCobrar(parada, vacia), true);
  });

  it('reconoce la entrega y el cobro guardados en el celular sin conexión', () => {
    const cola: ColaPorClave = new Map([entregaEnCola('1', 'a'), cobroEnCola('1')]);
    const [parada] = consolidarParadas([visita('1', 1, [remito('a')])], cola);
    assert.equal(esParadaTerminada(parada, cola), true);
  });

  it('una parada con todos los remitos rechazados no tiene nada que cobrar y queda terminada', () => {
    const [parada] = consolidarParadas([visita('1', 1, [remito('a', 'no_entregado')])], vacia);
    assert.equal(parada.estadoOperativo, 'Rechazado');
    assert.equal(esParadaTerminada(parada, vacia), true);
  });
});

describe('Corrección 4 · Los remitos entregados quedan abajo', () => {
  it('pone primero los pendientes y después los resueltos, sin cambiar el orden dentro de cada grupo', () => {
    const remitos = [remito('a', 'entregado'), remito('b'), remito('c', 'no_entregado'), remito('d')];
    assert.deepEqual(ordenarRemitosParaEntrega(remitos, vacia).map((r) => r.id), ['b', 'd', 'a', 'c']);
  });

  it('un remito entregado sin conexión también baja', () => {
    const cola: ColaPorClave = new Map([entregaEnCola('1', 'a')]);
    assert.deepEqual(ordenarRemitosParaEntrega([remito('a'), remito('b')], cola).map((r) => r.id), ['b', 'a']);
  });
});

describe('Corrección 5 · Elegir qué remitos se entregan', () => {
  const pendientes = [remito('a'), remito('b'), remito('c')];

  it('si se eligieron todos, se confirma en lote (HU #23)', () => {
    assert.equal(planificarEntrega(pendientes, pendientes), 'lote');
  });

  it('si se eligió una parte, se confirma uno por uno: el lote entregaría también los no elegidos', () => {
    assert.equal(planificarEntrega([pendientes[0], pendientes[2]], pendientes), 'individual');
  });

  it('con un solo remito pendiente se confirma individual', () => {
    assert.equal(planificarEntrega([pendientes[0]], [pendientes[0]]), 'individual');
  });

  it('sin selección no hay nada que confirmar', () => {
    assert.equal(planificarEntrega([], pendientes), 'nada');
  });
});
