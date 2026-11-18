import { describe, expect, it } from 'vitest';
import { agruparHistorialConciliaciones, MovimientoConciliado } from '../conciliacionHistorial';

function crearMovimiento(partial: Partial<MovimientoConciliado> & { id: string }): MovimientoConciliado {
  return {
    fecha_hora: '2026-11-18T10:00:00.000Z',
    ordenante: 'Mayorista El Sol S.R.L.',
    ordenante_cuit: '20123456789',
    concepto: 'Transferencia',
    referencia_externa: `REF-${partial.id}`,
    origen: 'Extracto Bancario',
    importe_centavos: '5000000',
    estado: 'imputado',
    cuenta_id: '1',
    cuenta: 'Cuenta operativa demo',
    sucursal_id: '1',
    sucursal: 'Sucursal Central - La Plata',
    comprobante_nombre: null,
    imputado_en: '2026-11-18T12:00:00.000Z',
    imputaciones: [],
    ...partial,
  };
}

describe('agruparHistorialConciliaciones', () => {
  it('agrupa N movimientos asignados a 1 único remito con discrepancia aprobada en una sola tarjeta con ambos lados', () => {
    const discrepancia = {
      id: '10',
      movimientoIds: ['1', '2'],
      remitoIds: ['99'],
      motivoCodigo: 'otro',
      nota: 'Dos transferencias para cancelar un remito con excedente',
      observacionResolucion: 'Aprobado',
      diferenciaCentavos: '1500000',
      importeMovimiento: '11500000',
      importeSeleccionado: '10000000',
      resueltaEn: '2026-11-18T12:00:00.000Z',
      resueltaPor: 'Gerente',
      comprobanteNombre: 'comp.pdf',
      ajustes: [{ tipo: 'saldo_favor' as const, remitoId: null, comercioId: '1', importeCentavos: '1500000' }],
    };

    const m1 = crearMovimiento({
      id: '1',
      importe_centavos: '10000000',
      discrepancia,
      imputaciones: [
        {
          id: 'imp-1',
          remitoId: '99',
          remitoNumero: 'R-0001-45120',
          remitoImporteCentavos: '10000000',
          comercio: 'Mayorista El Sol S.R.L.',
          comercioCuit: '20123456789',
          importeCentavos: '10000000',
          imputadoEn: '2026-11-18T12:00:00.000Z',
          imputadoPor: 'Gerente',
        },
      ],
    });

    const m2 = crearMovimiento({
      id: '2',
      importe_centavos: '1500000',
      discrepancia,
      imputaciones: [
        {
          id: 'disc-10-mov-2-rem-99',
          remitoId: '99',
          remitoNumero: 'R-0001-45120',
          remitoImporteCentavos: '10000000',
          comercio: 'Mayorista El Sol S.R.L.',
          comercioCuit: '20123456789',
          importeCentavos: '0',
          imputadoEn: '2026-11-18T12:00:00.000Z',
          imputadoPor: 'Gerente',
          esExcedenteDiscrepancia: true,
        },
      ],
    });

    const grupos = agruparHistorialConciliaciones([m2, m1]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].movimientos.map((m) => m.id)).toEqual(['1', '2']);
    expect(grupos[0].remitos).toHaveLength(1);
    expect(grupos[0].remitos[0].remitoNumero).toBe('R-0001-45120');
    expect(grupos[0].remitos[0].totalImputadoCentavos).toBe('10000000');
    expect(grupos[0].remitos[0].detalleMovimientos).toHaveLength(2);
    expect(grupos[0].totalMovimientosCentavos).toBe('11500000');
    expect(grupos[0].totalImputadoCentavos).toBe('10000000');
    expect(grupos[0].discrepancia?.id).toBe('10');
  });

  it('mantiene separados dos casos independientes (1→M y 1→1)', () => {
    const movA = crearMovimiento({
      id: '10',
      importe_centavos: '8000000',
      imputado_en: '2026-11-18T10:00:00.000Z',
      imputaciones: [
        {
          id: 'i1',
          remitoId: '1',
          remitoNumero: 'R-0001',
          comercio: 'Comercio A',
          comercioCuit: null,
          importeCentavos: '5000000',
          imputadoEn: '2026-11-18T10:00:00.000Z',
          imputadoPor: 'Admin',
        },
        {
          id: 'i2',
          remitoId: '2',
          remitoNumero: 'R-0002',
          comercio: 'Comercio A',
          comercioCuit: null,
          importeCentavos: '3000000',
          imputadoEn: '2026-11-18T10:00:00.000Z',
          imputadoPor: 'Admin',
        },
      ],
    });

    const movB = crearMovimiento({
      id: '11',
      importe_centavos: '2000000',
      imputado_en: '2026-11-18T11:00:00.000Z',
      imputaciones: [
        {
          id: 'i3',
          remitoId: '3',
          remitoNumero: 'R-0003',
          comercio: 'Comercio B',
          comercioCuit: null,
          importeCentavos: '2000000',
          imputadoEn: '2026-11-18T11:00:00.000Z',
          imputadoPor: 'Admin',
        },
      ],
    });

    const grupos = agruparHistorialConciliaciones([movA, movB]);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].movimientos).toHaveLength(1);
    expect(grupos[0].remitos).toHaveLength(1);
    expect(grupos[1].movimientos).toHaveLength(1);
    expect(grupos[1].remitos).toHaveLength(2);
  });

  it('calcula excedente parcial en movimientos y ajuste de reducción por remito en faltantes 1→M', () => {
    const movParcial = crearMovimiento({
      id: '20',
      importe_centavos: '15700000',
      imputaciones: [
        {
          id: 'imp-20',
          remitoId: '50',
          remitoNumero: 'R-0050',
          remitoImporteCentavos: '10000000',
          comercio: 'Comercio C',
          comercioCuit: null,
          importeCentavos: '10000000',
          imputadoEn: '2026-11-18T12:00:00.000Z',
          imputadoPor: 'Admin',
        },
      ],
    });

    const discFaltante = {
      id: '30',
      movimientoIds: ['21'],
      remitoIds: ['51', '52'],
      motivoCodigo: 'descuento_comercial',
      nota: 'Faltante 1->2',
      observacionResolucion: 'Aprobado',
      diferenciaCentavos: '-5700000',
      importeMovimiento: '5000000',
      importeSeleccionado: '10700000',
      resueltaEn: '2026-11-18T13:00:00.000Z',
      resueltaPor: 'Gerente',
      comprobanteNombre: null,
      ajustes: [
        { tipo: 'reduccion_saldo' as const, remitoId: '51', remitoNumero: 'R-0051', comercioId: null, importeCentavos: '5000000' },
        { tipo: 'reduccion_saldo' as const, remitoId: '52', remitoNumero: 'R-0052', comercioId: null, importeCentavos: '700000' },
      ],
    };

    const movFaltante = crearMovimiento({
      id: '21',
      importe_centavos: '5000000',
      imputado_en: '2026-11-18T13:00:00.000Z',
      discrepancia: discFaltante,
      imputaciones: [
        {
          id: 'imp-21',
          remitoId: '51',
          remitoNumero: 'R-0051',
          remitoImporteCentavos: '10000000',
          comercio: 'Comercio D',
          comercioCuit: null,
          importeCentavos: '5000000',
          imputadoEn: '2026-11-18T13:00:00.000Z',
          imputadoPor: 'Gerente',
        },
        {
          id: 'disc-30-ajuste-rem-52',
          remitoId: '52',
          remitoNumero: 'R-0052',
          remitoImporteCentavos: '700000',
          comercio: 'Comercio D',
          comercioCuit: null,
          importeCentavos: '0',
          imputadoEn: '2026-11-18T13:00:00.000Z',
          imputadoPor: 'Gerente',
          esExcedenteDiscrepancia: false,
          esAjusteDiscrepancia: true,
        },
      ],
    });

    const grupos = agruparHistorialConciliaciones([movParcial, movFaltante]);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].remitos[0].ajusteReduccionCentavos).toBe('5000000');
    expect(grupos[0].remitos[1].ajusteReduccionCentavos).toBe('700000');
    expect(grupos[0].remitos[1].detalleMovimientos).toHaveLength(0);
    expect(grupos[0].totalRemitosCentavos).toBe('10700000');

    expect(grupos[1].movimientos[0].totalImputadoCentavos).toBe('10000000');
    expect(grupos[1].movimientos[0].excedenteCentavos).toBe('5700000');
    expect(grupos[1].movimientos[0].tieneExcedente).toBe(true);
  });

  it('conserva el monto cobrado en efectivo por remito en pagos combinados', () => {
    const movQr = crearMovimiento({
      id: '30',
      origen: 'QR - Móvil',
      importe_centavos: '2000000',
      imputaciones: [
        {
          id: 'imp-30',
          remitoId: '77',
          remitoNumero: 'R-0077',
          remitoImporteCentavos: '3000000',
          cobradoEfectivoCentavos: '1000000',
          comercio: 'Autoservicio Luna',
          comercioCuit: null,
          importeCentavos: '2000000',
          imputadoEn: '2026-11-18T14:00:00.000Z',
          imputadoPor: 'Admin',
        },
      ],
    });

    const grupos = agruparHistorialConciliaciones([movQr]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].remitos[0].cobradoEfectivoCentavos).toBe('1000000');
    expect(grupos[0].remitos[0].totalImputadoCentavos).toBe('2000000');
    expect(grupos[0].remitos[0].remitoImporteCentavos).toBe('3000000');
  });
});
