/// <reference types="node" />
// Reglas de cobro de la app (HU #25 a #29). Se corren con: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importeRestante, PagoEnCarga, validarCobro } from '../dominio/cobro';
import { centavosATexto, formatearPesos, parsearPesos } from '../dominio/dinero';
import { armarEntrega, puedeConfirmarse } from '../dominio/entrega';
import { estadoCobro, estadoEntrega, resumenEntregas } from '../dominio/estadoVisita';
import type { ItemCola } from '../sincronizacion/cola';
import type { Remito, Visita } from '../tipos';

const TOTAL = 5750050; // $ 57.500,50

function fila(medioPago: PagoEnCarga['medioPago'], importeTexto: string, referencia = ''): PagoEnCarga {
  return { medioPago, importeTexto, referencia };
}

describe('Importes en pesos argentinos', () => {
  it('formatea centavos en es-AR', () => {
    assert.equal(formatearPesos(5750050), '$ 57.500,50');
    assert.equal(formatearPesos(0), '$ 0,00');
    assert.equal(formatearPesos(-249950), '-$ 2.499,50');
  });

  it('interpreta lo que tipea el transportista', () => {
    assert.equal(parsearPesos('57500,50'), 5750050);
    assert.equal(parsearPesos('57.500,50'), 5750050);
    assert.equal(parsearPesos('$ 57500'), 5750000);
    assert.equal(parsearPesos('10,5'), 1050);
    assert.equal(parsearPesos(''), null);
    assert.equal(parsearPesos('abc'), null);
    assert.equal(parsearPesos('10,555'), null);
    assert.equal(centavosATexto(5750050), '57500,50');
  });
});

describe('HU #25 · Visita sin cobro en destino', () => {
  it('ESCENARIO 2: con total $0 no exige medios de pago', () => {
    assert.equal(validarCobro([], 0, true).puedeConfirmar, true);
    assert.equal(validarCobro([fila('efectivo', '100')], 0, true).puedeConfirmar, false);
  });
});

describe('HU #26 · Cobro efectivo total', () => {
  it('ESCENARIO 1 y 2: efectivo por el monto exacto se puede confirmar, con o sin conexión', () => {
    assert.equal(validarCobro([fila('efectivo', '57500,50')], TOTAL, true).puedeConfirmar, true);
    assert.equal(validarCobro([fila('efectivo', '57500,50')], TOTAL, false).puedeConfirmar, true);
  });

  it('ESCENARIO 3: un monto menor al requerido no permite cerrar el cobro', () => {
    const resultado = validarCobro([fila('efectivo', '50000')], TOTAL, true);
    assert.equal(resultado.puedeConfirmar, false);
    assert.equal(resultado.diferenciaCentavos, -750050);
    assert.match(resultado.errores.join(' '), /Faltan \$ 7\.500,50/);
  });
});

describe('HU #27 · Cobro QR', () => {
  it('con conexión se registra por el total', () => {
    assert.equal(validarCobro([fila('qr', '57500,50')], TOTAL, true).puedeConfirmar, true);
  });

  it('sin conexión el QR queda deshabilitado', () => {
    const resultado = validarCobro([fila('qr', '57500,50')], TOTAL, false);
    assert.equal(resultado.puedeConfirmar, false);
    assert.match(resultado.errores.join(' '), /QR necesita conexión/);
  });
});

describe('HU #28 · Cobro transferencia total', () => {
  it('ESCENARIO 1: con referencia se puede confirmar', () => {
    assert.equal(validarCobro([fila('transferencia', '57500,50', 'OP-1')], TOTAL, true).puedeConfirmar, true);
  });

  it('ESCENARIO 3: sin referencia no se puede confirmar', () => {
    const resultado = validarCobro([fila('transferencia', '57500,50', '   ')], TOTAL, true);
    assert.equal(resultado.puedeConfirmar, false);
    assert.match(resultado.errores.join(' '), /Falta la referencia/);
  });
});

describe('HU #29 · Cobro combinado', () => {
  it('ESCENARIO 1 y 2: la suma exacta de varios medios se puede confirmar (sin conexión, sin QR)', () => {
    const pagos = [fila('efectivo', '40000'), fila('transferencia', '17500,50', 'OP-9')];
    assert.equal(validarCobro(pagos, TOTAL, true).puedeConfirmar, true);
    assert.equal(validarCobro(pagos, TOTAL, false).puedeConfirmar, true);
  });

  it('ESCENARIO 3: si la suma no coincide bloquea la confirmación y muestra la diferencia', () => {
    const menos = validarCobro([fila('efectivo', '40000'), fila('qr', '10000')], TOTAL, true);
    assert.equal(menos.puedeConfirmar, false);
    assert.equal(menos.diferenciaCentavos, -750050);

    const mas = validarCobro([fila('efectivo', '40000'), fila('qr', '20000')], TOTAL, true);
    assert.equal(mas.puedeConfirmar, false);
    assert.match(mas.errores.join(' '), /Sobran \$ 2\.499,50/);
  });

  it('ESCENARIO 4: si falta un dato obligatorio de un medio no se puede confirmar', () => {
    const resultado = validarCobro([fila('efectivo', '40000'), fila('transferencia', '17500,50')], TOTAL, true);
    assert.equal(resultado.puedeConfirmar, false);
    assert.match(resultado.errores.join(' '), /Falta la referencia bancaria de la transferencia \(medio 2\)/);
  });

  it('al agregar un medio se precarga lo que falta para el total', () => {
    assert.equal(importeRestante([], TOTAL), TOTAL);
    assert.equal(importeRestante([fila('efectivo', '40000')], TOTAL), 1750050);
    assert.equal(importeRestante([fila('efectivo', '90000')], TOTAL), 0);
  });
});

describe('HU #22 · Confirmación de entrega de remitos', () => {
  const remito = (id: string, estado: string): Remito => ({ id, numero: `R-${id}`, marca: 'Lácteos', importeCentavos: 1000, estado });

  it('REGLA 1: la confirmación lleva la hora del celular y el GPS; sin ubicación no se arma', () => {
    const ahora = new Date('2026-10-19T08:00:00.000Z');
    assert.deepEqual(armarEntrega({ latitud: -34.9, longitud: -57.9, precisionMetros: 10 }, ahora), {
      timestamp: '2026-10-19T08:00:00.000Z',
      latitud: -34.9,
      longitud: -57.9,
    });
    assert.equal(armarEntrega(null, ahora), null);
  });

  it('solo se confirman los remitos que no están en un estado final', () => {
    assert.equal(puedeConfirmarse(remito('1', 'en_ruta')), true);
    assert.equal(puedeConfirmarse(remito('2', 'pendiente')), true);
    assert.equal(puedeConfirmarse(remito('3', 'entregado')), false);
    assert.equal(puedeConfirmarse(remito('4', 'devuelto')), false);
  });

  it('cuenta las entregas confirmadas en el servidor y en el celular, sin contar los devueltos', () => {
    const visita: Visita = {
      id: '1', orden: 1, estado: 'en_curso', cobrada: false,
      comercio: { razonSocial: 'X', nombreFantasia: null, domicilio: 'Y', localidad: null, ventanaDesde: null, ventanaHasta: null, telefono: null },
      remitos: [remito('1', 'entregado'), remito('2', 'en_ruta'), remito('3', 'en_ruta'), remito('4', 'devuelto')],
      importe: { totalCentavos: 3000, subtotalesPorMarca: [], remitosExcluidos: ['R-4'], sinCobroEnDestino: false },
    };
    const enCola = new Map<string, ItemCola>([
      ['entrega:2', { tipo: 'entrega', visitaId: '1', remitoId: '2', cuerpo: { timestamp: '', latitud: 0, longitud: 0 }, estado: 'pendiente' }],
    ]);
    assert.deepEqual(resumenEntregas(visita, enCola), { confirmados: 2, total: 3 });
    assert.equal(estadoEntrega(visita.remitos[1], enCola), 'sin_sincronizar');
    assert.equal(estadoEntrega(visita.remitos[2], enCola), 'pendiente');
  });
});

describe('Estado del cobro en el celular', () => {
  const cuerpo = { pagos: [], registradoEn: '2026-10-19T08:00:00.000Z', ubicacion: null };
  const visita = (cobrada: boolean, estado = 'pendiente') => ({ id: '1', cobrada, estado } as Visita);
  const enCola = (estado: ItemCola['estado']) => new Map<string, ItemCola>([['cobro:1', { tipo: 'cobro', visitaId: '1', cuerpo, estado }]]);

  it('combina lo del servidor con la cola local', () => {
    assert.equal(estadoCobro(visita(false), new Map()), 'pendiente');
    assert.equal(estadoCobro(visita(false), enCola('pendiente')), 'sin_sincronizar');
    assert.equal(estadoCobro(visita(false), enCola('rechazado')), 'rechazado');
    assert.equal(estadoCobro(visita(true), enCola('rechazado')), 'hecho');
  });

  it('una visita cerrada por la entrega (HU #22) sigue sin cobrar', () => {
    assert.equal(estadoCobro(visita(false, 'completada'), new Map()), 'pendiente');
  });
});
