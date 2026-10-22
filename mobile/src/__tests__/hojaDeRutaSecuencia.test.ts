import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ColaPorClave } from '../dominio/estadoVisita';
import {
  calcularEstadoOperativoParada,
  consolidarParadas,
  esHojaOperativaVigente,
  fechaOperativaHoy,
} from '../dominio/parada';
import type { HojaDeRuta, Remito, Visita } from '../tipos';

function remito(id: string, numero: string, marca: string, importeCentavos: number, estado = 'pendiente', bultos = 1): Remito {
  return { id, numero, marca, importeCentavos, estado, bultos };
}

function visita(
  id: string,
  orden: number,
  razonSocial: string,
  remitos: Remito[],
  estado = 'pendiente',
  comercioId = id
): Visita {
  const totalCentavos = remitos.reduce((acc, r) => acc + (r.estado !== 'no_entregado' && r.estado !== 'devuelto' ? r.importeCentavos : 0), 0);
  return {
    id,
    orden,
    estado,
    cobrada: false,
    comercio: {
      id: comercioId,
      razonSocial,
      nombreFantasia: `${razonSocial} Fantasia`,
      domicilio: `Calle Falsa ${id}`,
      localidad: 'Quilmes',
      ventanaDesde: '08:00',
      ventanaHasta: '12:00',
      telefono: '1144445555',
    },
    remitos,
    importe: {
      totalCentavos,
      subtotalesPorMarca: [],
      remitosExcluidos: [],
      sinCobroEnDestino: totalCentavos === 0,
    },
  };
}

describe('HU: Visualización de Hoja de Ruta por Parada (Comercio)', () => {
  const colaVacia: ColaPorClave = new Map();

  describe('ESCENARIO 1: Visualización correcta y secuencia planificada', () => {
    it('muestra las visitas ordenadas estrictamente según la secuencia planificada por el administrativo', () => {
      const v3 = visita('3', 3, 'Kiosco El Paso', [remito('r3', '0003', 'Arcor', 150000)]);
      const v1 = visita('1', 1, 'Almacén Don Mario', [remito('r1', '0001', 'Bagley', 200000)]);
      const v2 = visita('2', 2, 'Supermercado Sol', [remito('r2', '0002', 'La Serenísima', 350000)]);

      // Se pasan desordenadas
      const paradas = consolidarParadas([v3, v1, v2], colaVacia);

      assert.equal(paradas.length, 3);
      assert.deepEqual(
        paradas.map((p) => p.orden),
        [1, 2, 3]
      );
      assert.deepEqual(
        paradas.map((p) => p.comercio.razonSocial),
        ['Almacén Don Mario', 'Supermercado Sol', 'Kiosco El Paso']
      );
    });
  });

  describe('Regla: Consolidación por comercio, carga y desglose de documentos', () => {
    it('consolida múltiples remitos, bultos y marcas para un mismo comercio bajo una única parada', () => {
      const r1 = remito('101', '0001-0001', 'Arcor', 120000, 'pendiente', 2);
      const r2 = remito('102', '0001-0002', 'Bagley', 80000, 'pendiente', 3);
      const r3 = remito('103', '0001-0003', 'Coca-Cola', 150000, 'pendiente', 1);

      const v = visita('1', 1, 'Autoservicio Centro', [r1, r2, r3]);

      const paradas = consolidarParadas([v], colaVacia);
      assert.equal(paradas.length, 1);

      const parada = paradas[0];
      assert.equal(parada.comercio.razonSocial, 'Autoservicio Centro');
      assert.equal(parada.totalRemitos, 3);
      assert.equal(parada.totalBultos, 6); // 2 + 3 + 1
      assert.deepEqual(parada.marcas.sort(), ['Arcor', 'Bagley', 'Coca-Cola'].sort());
      assert.equal(parada.totalImporteCentavos, 350000);
      assert.equal(parada.sinCobroEnDestino, false);

      // Desglose de documentos asociados
      assert.equal(parada.documentos.length, 3);
      assert.equal(parada.documentos[0].numero, '0001-0001');
      assert.equal(parada.documentos[0].bultos, 2);
      assert.equal(parada.documentos[0].marca, 'Arcor');
      assert.equal(parada.documentos[0].estadoOperativo, 'Pendiente');
    });

    it('consolida múltiples visitas asignadas al mismo comercio en una sola parada en la vista principal', () => {
      const r1 = remito('101', '0001-0001', 'Arcor', 100000, 'pendiente', 1);
      const r2 = remito('102', '0001-0002', 'Bagley', 150000, 'pendiente', 2);

      const vA = visita('vA', 2, 'Distribuidora Norte', [r1], 'pendiente', 'comercio-42');
      const vB = visita('vB', 2, 'Distribuidora Norte', [r2], 'pendiente', 'comercio-42');

      const paradas = consolidarParadas([vA, vB], colaVacia);
      assert.equal(paradas.length, 1);
      assert.equal(paradas[0].totalRemitos, 2);
      assert.equal(paradas[0].totalBultos, 3);
      assert.equal(paradas[0].totalImporteCentavos, 250000);
    });
  });

  describe('Regla: Estados operativos de cada parada (Pendiente, En curso, Entregado, Rechazado)', () => {
    it('refleja "Pendiente" si no se ha iniciado gestión en la parada', () => {
      const v = visita('1', 1, 'Comercio A', [
        remito('1', 'R1', 'Arcor', 100000, 'pendiente'),
        remito('2', 'R2', 'Bagley', 200000, 'pendiente'),
      ]);
      const estado = calcularEstadoOperativoParada(v, colaVacia);
      assert.equal(estado, 'Pendiente');
    });

    it('refleja "En curso" si al menos un remito fue entregado pero restan pendientes', () => {
      const v = visita('1', 1, 'Comercio A', [
        remito('1', 'R1', 'Arcor', 100000, 'entregado'),
        remito('2', 'R2', 'Bagley', 200000, 'pendiente'),
      ]);
      const estado = calcularEstadoOperativoParada(v, colaVacia);
      assert.equal(estado, 'En curso');
    });

    it('refleja "En curso" si al menos un remito fue rechazado pero restan pendientes', () => {
      const v = visita('1', 1, 'Comercio A', [
        remito('1', 'R1', 'Arcor', 100000, 'no_entregado'),
        remito('2', 'R2', 'Bagley', 200000, 'pendiente'),
      ]);
      const estado = calcularEstadoOperativoParada(v, colaVacia);
      assert.equal(estado, 'En curso');
    });

    it('refleja "En curso" si el servidor reporta la visita en curso', () => {
      const v = visita('1', 1, 'Comercio A', [remito('1', 'R1', 'Arcor', 100000, 'pendiente')], 'en_curso');
      const estado = calcularEstadoOperativoParada(v, colaVacia);
      assert.equal(estado, 'En curso');
    });

    it('refleja "Entregado" cuando todos los remitos están entregados', () => {
      const v = visita('1', 1, 'Comercio A', [
        remito('1', 'R1', 'Arcor', 100000, 'entregado'),
        remito('2', 'R2', 'Bagley', 200000, 'entregado'),
      ]);
      const estado = calcularEstadoOperativoParada(v, colaVacia);
      assert.equal(estado, 'Entregado');
    });

    it('refleja "Entregado" cuando todos los remitos fueron resueltos con al menos una entrega (con excepciones)', () => {
      const v = visita('1', 1, 'Comercio A', [
        remito('1', 'R1', 'Arcor', 100000, 'entregado'),
        remito('2', 'R2', 'Bagley', 200000, 'no_entregado'),
      ]);
      const estado = calcularEstadoOperativoParada(v, colaVacia);
      assert.equal(estado, 'Entregado');
    });

    it('refleja "Rechazado" cuando todos los remitos de la parada fueron rechazados', () => {
      const v = visita('1', 1, 'Comercio A', [
        remito('1', 'R1', 'Arcor', 100000, 'no_entregado'),
        remito('2', 'R2', 'Bagley', 200000, 'devuelto'),
      ]);
      const estado = calcularEstadoOperativoParada(v, colaVacia);
      assert.equal(estado, 'Rechazado');
    });

    it('refleja "Rechazado" si la visita fue marcada como no realizada en el servidor', () => {
      const v = visita('1', 1, 'Comercio A', [remito('1', 'R1', 'Arcor', 100000, 'pendiente')], 'no_realizada');
      const estado = calcularEstadoOperativoParada(v, colaVacia);
      assert.equal(estado, 'Rechazado');
    });

    it('reconoce entregas y rechazos registrados en la cola local sin conexión', () => {
      const v = visita('1', 1, 'Comercio A', [
        remito('1', 'R1', 'Arcor', 100000, 'pendiente'),
        remito('2', 'R2', 'Bagley', 200000, 'pendiente'),
      ]);

      const colaLocal: ColaPorClave = new Map();
      colaLocal.set('entrega:1', {
        tipo: 'entrega',
        visitaId: '1',
        remitoId: '1',
        cuerpo: { timestamp: new Date().toISOString(), latitud: -34.6, longitud: -58.4 },
        estado: 'pendiente',
      });

      // Remito 1 encolado como entrega, Remito 2 pendiente -> En curso
      assert.equal(calcularEstadoOperativoParada(v, colaLocal), 'En curso');

      // Remito 2 encolado como rechazo -> Ambos resueltos con 1 entrega -> Entregado
      colaLocal.set('rechazo:2', {
        tipo: 'rechazo',
        visitaId: '1',
        remitoId: '2',
        cuerpo: { motivo: 'Comercio cerrado', timestamp: new Date().toISOString() },
        estado: 'pendiente',
      });

      assert.equal(calcularEstadoOperativoParada(v, colaLocal), 'Entregado');
    });
  });

  describe('Regla: Filtro de fecha operativa actual y estado habilitado', () => {
    const hoy = fechaOperativaHoy();

    it('acepta hojas con fecha de hoy en estado publicada, asignada o en_curso', () => {
      const hojaBase: HojaDeRuta = {
        id: '1',
        fechaReparto: hoy,
        patente: 'AA123BB',
        estado: 'publicada',
        sucursal: 'Sur',
        visitas: [],
      };

      assert.equal(esHojaOperativaVigente(hojaBase, hoy), true);
      assert.equal(esHojaOperativaVigente({ ...hojaBase, estado: 'asignada' }, hoy), true);
      assert.equal(esHojaOperativaVigente({ ...hojaBase, estado: 'en_curso' }, hoy), true);
    });

    it('descarta hojas de fecha diferente a la fecha operativa actual', () => {
      const hojaAyer: HojaDeRuta = {
        id: '1',
        fechaReparto: '2026-10-21',
        patente: 'AA123BB',
        estado: 'publicada',
        sucursal: 'Sur',
        visitas: [],
      };
      assert.equal(esHojaOperativaVigente(hojaAyer, '2026-10-22'), false);
    });

    it('descarta hojas en estados deshabilitados para ejecución (borrador, cerrada, anulada)', () => {
      const hoja: HojaDeRuta = {
        id: '1',
        fechaReparto: hoy,
        patente: 'AA123BB',
        estado: 'borrador',
        sucursal: 'Sur',
        visitas: [],
      };
      assert.equal(esHojaOperativaVigente(hoja, hoy), false);
      assert.equal(esHojaOperativaVigente({ ...hoja, estado: 'cerrada' }, hoy), false);
      assert.equal(esHojaOperativaVigente({ ...hoja, estado: 'anulada' }, hoy), false);
    });
  });

  describe('ESCENARIO 2: Ausencia de rutas asignadas para la fecha operativa', () => {
    it('devuelve lista vacía de paradas si no hay visitas programadas', () => {
      const paradas = consolidarParadas([], colaVacia);
      assert.equal(paradas.length, 0);
    });
  });
});
