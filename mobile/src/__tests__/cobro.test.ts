/// <reference types="node" />
// Reglas de cobro de la app (HU #25 a #29). Se corren con: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importeRestante, PagoEnCarga, validarCobro } from '../dominio/cobro';
import { centavosATexto, formatearPesos, parsearPesos } from '../dominio/dinero';
import { estadoVisitaLocal } from '../dominio/estadoVisita';

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

describe('Estado de la visita en el celular', () => {
  const cuerpo = { pagos: [], registradoEn: '2026-10-19T08:00:00.000Z', ubicacion: null };

  it('combina lo del servidor con la cola local', () => {
    assert.equal(estadoVisitaLocal('pendiente'), 'pendiente');
    assert.equal(estadoVisitaLocal('pendiente', { visitaId: '1', cuerpo, estado: 'pendiente' }), 'sin_sincronizar');
    assert.equal(estadoVisitaLocal('pendiente', { visitaId: '1', cuerpo, estado: 'rechazado' }), 'rechazada');
    assert.equal(estadoVisitaLocal('completada', { visitaId: '1', cuerpo, estado: 'rechazado' }), 'cobrada');
  });
});
