/// <reference types="node" />
// Reglas de cobro de la app (HU #25 a #29) y entregas (HU #22, #23). Se corren con: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularImporteVisitaLocal, importeRestante, PagoEnCarga, validarCobro } from '../dominio/cobro';
import { centavosATexto, formatearPesos, parsearPesos } from '../dominio/dinero';
import { armarEntrega, armarEntregaLote, armarRechazo, MOTIVOS_RECHAZO_PREESTABLECIDOS, puedeConfirmarse } from '../dominio/entrega';
import {
  esRemitoRechazado,
  esRemitoResuelto,
  estadoCobro,
  estadoEntrega,
  infoEstadoRemito,
  resumenEntregas,
  resumenVisitaEntrega,
} from '../dominio/estadoVisita';
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

  it('separa errores específicos por medio de pago y errores generales', () => {
    // Medio 1: sin importe; Medio 2: transferencia sin referencia
    const resultado = validarCobro(
      [fila('efectivo', ''), fila('transferencia', '10000', '')],
      TOTAL,
      true
    );
    assert.equal(resultado.puedeConfirmar, false);
    assert.equal(resultado.erroresPorPago.length, 2);
    assert.deepEqual(resultado.erroresPorPago[0], ['Ingresá un importe válido.']);
    assert.deepEqual(resultado.erroresPorPago[1], ['Falta el comprobante o referencia bancaria de la transferencia.']);
    // Error general de suma restante
    assert.ok(resultado.erroresGenerales.some((e) => e.includes('Faltan')));
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

describe('HU #23 · Confirmación de entrega multimarca', () => {
  const remito = (id: string, estado = 'pendiente', marca = 'Marca A'): Remito => ({
    id, numero: `R-${id}`, marca, importeCentavos: 1000, estado,
  });

  const ubicacion = { latitud: -34.92, longitud: -57.95, precisionMetros: 10 };
  const ahora = new Date('2026-10-20T10:00:00.000Z');

  it('armarEntregaLote solo incluye remitos en estado pendiente (Regla 1)', () => {
    const remitos = [
      remito('1', 'pendiente', 'Arcor'),
      remito('2', 'entregado', 'Bagley'),
      remito('3', 'no_entregado', 'Quilmes'),
      remito('4', 'pendiente', 'La Serenísima'),
    ];

    const lote = armarEntregaLote(remitos, ubicacion, ahora);
    assert.ok(lote);
    assert.equal(lote.entregas.length, 2);
    assert.deepEqual(lote.entregas.map((e) => e.remitoId), ['1', '4']);
  });

  it('armarEntregaLote asigna timestamp y coordenadas GPS a cada remito del lote (Regla 3)', () => {
    const remitos = [remito('1', 'pendiente', 'Arcor'), remito('2', 'pendiente', 'Bagley')];
    const lote = armarEntregaLote(remitos, ubicacion, ahora);
    assert.ok(lote);
    assert.equal(lote.cuerpoGeneral.timestamp, '2026-10-20T10:00:00.000Z');
    assert.equal(lote.cuerpoGeneral.latitud, -34.92);
    assert.equal(lote.cuerpoGeneral.longitud, -57.95);

    assert.equal(lote.entregas[0].cuerpo.timestamp, '2026-10-20T10:00:00.000Z');
    assert.equal(lote.entregas[0].cuerpo.latitud, -34.92);
    assert.equal(lote.entregas[1].cuerpo.timestamp, '2026-10-20T10:00:00.000Z');
    assert.equal(lote.entregas[1].cuerpo.latitud, -34.92);
  });

  it('sin GPS armarEntregaLote devuelve null', () => {
    assert.equal(armarEntregaLote([remito('1')], null, ahora), null);
  });

  it('si no hay remitos pendientes armarEntregaLote devuelve null', () => {
    const remitos = [remito('1', 'entregado'), remito('2', 'devuelto')];
    assert.equal(armarEntregaLote(remitos, ubicacion, ahora), null);
  });

  it('resumenVisitaEntrega marca como Completada cuando todos están entregados (Regla 2)', () => {
    const visita: Visita = {
      id: '1', orden: 1, estado: 'en_curso', cobrada: false,
      comercio: { razonSocial: 'X', nombreFantasia: null, domicilio: 'Y', localidad: null, ventanaDesde: null, ventanaHasta: null, telefono: null },
      remitos: [remito('1', 'entregado'), remito('2', 'entregado')],
      importe: { totalCentavos: 2000, subtotalesPorMarca: [], remitosExcluidos: [], sinCobroEnDestino: false },
    };

    const resumen = resumenVisitaEntrega(visita, new Map());
    assert.equal(resumen.completada, true);
    assert.equal(resumen.conExcepciones, false);
    assert.equal(resumen.etiqueta, 'Completada');
  });

  it('resumenVisitaEntrega marca como Entregada con excepciones si existían rechazos previos (Regla 2)', () => {
    const visita: Visita = {
      id: '1', orden: 1, estado: 'en_curso', cobrada: false,
      comercio: { razonSocial: 'X', nombreFantasia: null, domicilio: 'Y', localidad: null, ventanaDesde: null, ventanaHasta: null, telefono: null },
      remitos: [remito('1', 'entregado'), remito('2', 'no_entregado')],
      importe: { totalCentavos: 1000, subtotalesPorMarca: [], remitosExcluidos: ['R-2'], sinCobroEnDestino: false },
    };

    const resumen = resumenVisitaEntrega(visita, new Map());
    assert.equal(resumen.completada, true);
    assert.equal(resumen.conExcepciones, true);
    assert.equal(resumen.etiqueta, 'Entregada con excepciones');
  });

  it('resumenVisitaEntrega indica entregas pendientes si aún no finalizó', () => {
    const visita: Visita = {
      id: '1', orden: 1, estado: 'en_curso', cobrada: false,
      comercio: { razonSocial: 'X', nombreFantasia: null, domicilio: 'Y', localidad: null, ventanaDesde: null, ventanaHasta: null, telefono: null },
      remitos: [remito('1', 'entregado'), remito('2', 'pendiente'), remito('3', 'pendiente')],
      importe: { totalCentavos: 3000, subtotalesPorMarca: [], remitosExcluidos: [], sinCobroEnDestino: false },
    };

    const resumen = resumenVisitaEntrega(visita, new Map());
    assert.equal(resumen.completada, false);
    assert.equal(resumen.confirmados, 1);
    assert.equal(resumen.total, 3);
    assert.equal(resumen.etiqueta, '1/3 entregados');
  });
});

describe('HU: Registro de rechazo de un remito (Dominio)', () => {
  it('armarRechazo con motivo preestablecido genera RechazoDto válido', () => {
    const motivo = MOTIVOS_RECHAZO_PREESTABLECIDOS[0]; // 'Comercio cerrado'
    const ahora = new Date('2026-10-20T15:30:00.000Z');
    const u = { latitud: -34.60, longitud: -58.38, precisionMetros: 5 };

    const dto = armarRechazo(motivo, u, ahora);
    assert.ok(dto);
    assert.equal(dto?.motivo, 'Comercio cerrado');
    assert.equal(dto?.timestamp, '2026-10-20T15:30:00.000Z');
    assert.equal(dto?.latitud, -34.60);
    assert.equal(dto?.longitud, -58.38);
  });

  it('armarRechazo con motivo manual genera RechazoDto válido y permite sin GPS', () => {
    const motivoManual = 'El encargado avisó que no tiene fondos para recibir el pedido';
    const ahora = new Date('2026-10-20T15:35:00.000Z');

    const dto = armarRechazo(motivoManual, null, ahora);
    assert.ok(dto);
    assert.equal(dto?.motivo, motivoManual);
    assert.equal(dto?.timestamp, '2026-10-20T15:35:00.000Z');
    assert.equal(dto?.latitud, null);
    assert.equal(dto?.longitud, null);
  });

  it('REGLA: armarRechazo con motivo vacío devuelve null (bloquea confirmación)', () => {
    assert.equal(armarRechazo('', null), null);
    assert.equal(armarRechazo('   ', null), null);
    assert.equal(armarRechazo(undefined as any, null), null);
  });

  it('infoEstadoRemito muestra estado local para remito encolado sin sincronizar', () => {
    const r: Remito = { id: '10', numero: 'R-01', marca: 'Marca A', importeCentavos: 1000, estado: 'pendiente' };
    const cola: Map<string, ItemCola> = new Map([
      ['rechazo:10', {
        tipo: 'rechazo',
        visitaId: '1',
        remitoId: '10',
        cuerpo: { motivo: 'Mercadería dañada', timestamp: '2026-10-20T10:00:00.000Z' },
        estado: 'pendiente',
      }],
    ]);

    const info = infoEstadoRemito(r, cola);
    assert.equal(info.texto, 'Rechazado · sin sincronizar');
    assert.equal(info.puedeOperar, false);
    assert.equal(info.esRechazado, true);
    assert.equal(info.motivo, 'Mercadería dañada');
  });

  it('resumenVisitaEntrega reconoce rechazos encolados localmente y cierra con excepciones', () => {
    const r1: Remito = { id: '1', numero: 'R-1', marca: 'A', importeCentavos: 1000, estado: 'entregado' };
    const r2: Remito = { id: '2', numero: 'R-2', marca: 'B', importeCentavos: 2000, estado: 'pendiente' };

    const visita: Visita = {
      id: '1', orden: 1, estado: 'en_curso', cobrada: false,
      comercio: { razonSocial: 'X', nombreFantasia: null, domicilio: 'Y', localidad: null, ventanaDesde: null, ventanaHasta: null, telefono: null },
      remitos: [r1, r2],
      importe: { totalCentavos: 3000, subtotalesPorMarca: [], remitosExcluidos: [], sinCobroEnDestino: false },
    };

    const cola: Map<string, ItemCola> = new Map([
      ['rechazo:2', {
        tipo: 'rechazo',
        visitaId: '1',
        remitoId: '2',
        cuerpo: { motivo: 'Comercio cerrado', timestamp: '2026-10-20T10:00:00.000Z' },
        estado: 'pendiente',
      }],
    ]);

    const resumen = resumenVisitaEntrega(visita, cola);
    assert.equal(resumen.completada, true);
    assert.equal(resumen.conExcepciones, true);
    assert.equal(resumen.etiqueta, 'Entregada con excepciones');
  });

  it('calcularImporteVisitaLocal descuenta remitos rechazados en la cola local', () => {
    const r1: Remito = { id: '1', numero: 'R-1', marca: 'Marca A', importeCentavos: 500000, estado: 'pendiente' };
    const r2: Remito = { id: '2', numero: 'R-2', marca: 'Marca B', importeCentavos: 300000, estado: 'pendiente' };

    const visita: Visita = {
      id: '1', orden: 1, estado: 'en_curso', cobrada: false,
      comercio: { razonSocial: 'X', nombreFantasia: null, domicilio: 'Y', localidad: null, ventanaDesde: null, ventanaHasta: null, telefono: null },
      remitos: [r1, r2],
      importe: { totalCentavos: 800000, subtotalesPorMarca: [], remitosExcluidos: [], sinCobroEnDestino: false },
    };

    // Rechazamos r2 en cola local
    const cola: Map<string, ItemCola> = new Map([
      ['rechazo:2', {
        tipo: 'rechazo',
        visitaId: '1',
        remitoId: '2',
        cuerpo: { motivo: 'Mercadería dañada', timestamp: '2026-10-20T10:00:00.000Z' },
        estado: 'pendiente',
      }],
    ]);

    const importeActualizado = calcularImporteVisitaLocal(visita, cola);
    assert.equal(importeActualizado.totalCentavos, 500000);
    assert.deepEqual(importeActualizado.remitosExcluidos, ['R-2']);
    assert.equal(importeActualizado.sinCobroEnDestino, false);

    // Si también se rechaza r1, pasa a ser $0,00 sin cobro en destino
    cola.set('rechazo:1', {
      tipo: 'rechazo',
      visitaId: '1',
      remitoId: '1',
      cuerpo: { motivo: 'Comercio cerrado', timestamp: '2026-10-20T10:05:00.000Z' },
      estado: 'pendiente',
    });

    const importeCero = calcularImporteVisitaLocal(visita, cola);
    assert.equal(importeCero.totalCentavos, 0);
    assert.equal(importeCero.sinCobroEnDestino, true);
  });
});
