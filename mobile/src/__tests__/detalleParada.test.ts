import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ColaPorClave } from '../dominio/estadoVisita';
import {
  agruparRemitosPorMarca,
  consolidarParadas,
  esRemitoActivo,
  esVisitaActiva,
  verificarParadaActiva,
} from '../dominio/parada';
import type { HojaDeRuta, Remito, Visita } from '../tipos';

function crearRemito(
  id: string,
  numero: string,
  marca: string,
  importeCentavos: number,
  estado = 'pendiente',
  bultos = 1,
  motivoNoEntrega: string | null = null
): Remito {
  return { id, numero, marca, importeCentavos, estado, bultos, motivoNoEntrega };
}

function crearVisita(
  id: string,
  orden: number,
  razonSocial: string,
  remitos: Remito[],
  estado = 'pendiente',
  comercioId = id
): Visita {
  const totalCentavos = remitos.reduce(
    (acc, r) => (r.estado !== 'no_entregado' && r.estado !== 'devuelto' && r.estado !== 'anulado' ? acc + r.importeCentavos : acc),
    0
  );
  return {
    id,
    orden,
    estado,
    cobrada: false,
    comercio: {
      id: comercioId,
      razonSocial,
      nombreFantasia: `${razonSocial} Fantasia`,
      domicilio: `Av. Siempre Viva ${id}`,
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

describe('HU: Despliegue de Detalle de Parada y Clasificación por Marca', () => {
  const colaVacia: ColaPorClave = new Map();

  describe('Regla: Totalizador de bultos/remitos por marca y total general de la parada', () => {
    it('presenta el total general de la parada con bultos, remitos e importe consolidado', () => {
      const r1 = crearRemito('r1', '0001-1001', 'Arcor', 150000, 'pendiente', 3);
      const r2 = crearRemito('r2', '0001-1002', 'Bagley', 80000, 'pendiente', 2);
      const r3 = crearRemito('r3', '0001-1003', 'Arcor', 120000, 'pendiente', 1);

      const v = crearVisita('v1', 1, 'Kiosco El Centro', [r1, r2, r3]);
      const paradas = consolidarParadas([v], colaVacia);

      assert.equal(paradas.length, 1);
      const parada = paradas[0];

      // Total general
      assert.equal(parada.totalBultos, 6); // 3 + 2 + 1
      assert.equal(parada.totalRemitos, 3);
      assert.equal(parada.totalImporteCentavos, 350000);
      assert.equal(parada.sinCobroEnDestino, false);
    });

    it('presenta un totalizador de bultos y remitos clasificado por cada marca presente', () => {
      const r1 = crearRemito('r1', '0001-1001', 'Arcor', 150000, 'pendiente', 3);
      const r2 = crearRemito('r2', '0001-1002', 'Bagley', 80000, 'pendiente', 2);
      const r3 = crearRemito('r3', '0001-1003', 'Arcor', 120000, 'pendiente', 4);
      const r4 = crearRemito('r4', '0001-1004', 'Coca-Cola', 200000, 'pendiente', 5);

      const v = crearVisita('v1', 1, 'Autoservicio Quilmes', [r1, r2, r3, r4]);
      const paradas = consolidarParadas([v], colaVacia);

      assert.equal(paradas.length, 1);
      const parada = paradas[0];

      // Marcas detectadas
      assert.deepEqual(parada.marcas, ['Arcor', 'Bagley', 'Coca-Cola']);
      assert.equal(parada.resumenPorMarca.length, 3);

      // Totalizador Arcor: 2 remitos, 7 bultos (3 + 4), $270.000
      const arcor = parada.resumenPorMarca.find((m) => m.marca === 'Arcor');
      assert.ok(arcor);
      assert.equal(arcor.totalRemitos, 2);
      assert.equal(arcor.totalBultos, 7);
      assert.equal(arcor.totalImporteCentavos, 270000);

      // Totalizador Bagley: 1 remito, 2 bultos, $80.000
      const bagley = parada.resumenPorMarca.find((m) => m.marca === 'Bagley');
      assert.ok(bagley);
      assert.equal(bagley.totalRemitos, 1);
      assert.equal(bagley.totalBultos, 2);
      assert.equal(bagley.totalImporteCentavos, 80000);

      // Totalizador Coca-Cola: 1 remito, 5 bultos, $200.000
      const coca = parada.resumenPorMarca.find((m) => m.marca === 'Coca-Cola');
      assert.ok(coca);
      assert.equal(coca.totalRemitos, 1);
      assert.equal(coca.totalBultos, 5);
      assert.equal(coca.totalImporteCentavos, 200000);
    });
  });

  describe('Regla: Remitos asociados clasificados y etiquetados por marca', () => {
    it('agrupa los remitos asociados por marca con sus datos individuales completos', () => {
      const r1 = crearRemito('r1', '0001-1001', 'Arcor', 100000, 'pendiente', 2);
      const r2 = crearRemito('r2', '0001-1002', 'Bagley', 75000, 'entregado', 3);
      const r3 = crearRemito('r3', '0001-1003', 'Arcor', 50000, 'no_entregado', 1, 'Local cerrado');

      const v = crearVisita('v1', 1, 'Almacén Don Tito', [r1, r2, r3]);
      const paradas = consolidarParadas([v], colaVacia);
      const parada = paradas[0];

      const grupos = agruparRemitosPorMarca(parada.documentos);
      assert.equal(grupos.length, 2);

      // Grupo Arcor
      const grupoArcor = grupos.find((g) => g.marca === 'Arcor');
      assert.ok(grupoArcor);
      assert.equal(grupoArcor.totalRemitos, 2);
      assert.equal(grupoArcor.totalBultos, 3);
      assert.equal(grupoArcor.documentos.length, 2);

      assert.equal(grupoArcor.documentos[0].numero, '0001-1001');
      assert.equal(grupoArcor.documentos[0].marca, 'Arcor');
      assert.equal(grupoArcor.documentos[0].bultos, 2);
      assert.equal(grupoArcor.documentos[0].estadoOperativo, 'Pendiente');

      assert.equal(grupoArcor.documentos[1].numero, '0001-1003');
      assert.equal(grupoArcor.documentos[1].marca, 'Arcor');
      assert.equal(grupoArcor.documentos[1].bultos, 1);
      assert.equal(grupoArcor.documentos[1].estadoOperativo, 'Rechazado');
      assert.equal(grupoArcor.documentos[1].motivoNoEntrega, 'Local cerrado');

      // Grupo Bagley
      const grupoBagley = grupos.find((g) => g.marca === 'Bagley');
      assert.ok(grupoBagley);
      assert.equal(grupoBagley.totalRemitos, 1);
      assert.equal(grupoBagley.totalBultos, 3);
      assert.equal(grupoBagley.documentos[0].numero, '0001-1002');
      assert.equal(grupoBagley.documentos[0].marca, 'Bagley');
      assert.equal(grupoBagley.documentos[0].estadoOperativo, 'Entregado');
    });
  });

  describe('ESCENARIO 1: Despliegue exitoso al tocar la parada', () => {
    it('verifica que la visita sigue activa y genera la parada actualizada con sus marcas', () => {
      const r1 = crearRemito('r1', '0001-5001', 'Arcor', 120000, 'pendiente', 2);
      const r2 = crearRemito('r2', '0001-5002', 'Bagley', 90000, 'pendiente', 3);
      const v = crearVisita('v1', 1, 'Despensa Los Pinos', [r1, r2]);

      const hojaActiva: HojaDeRuta = {
        id: 'h1',
        fechaReparto: '2026-10-22',
        patente: 'AA123BB',
        estado: 'en_curso',
        sucursal: 'Sur',
        visitas: [v],
      };

      const paradaLocal = consolidarParadas([v], colaVacia)[0];

      // El transportista toca la parada y el sistema verifica que la visita sigue activa
      const resultado = verificarParadaActiva(paradaLocal, hojaActiva, colaVacia);

      assert.equal(resultado.activa, true);
      assert.ok(resultado.paradaActualizada);
      assert.equal(resultado.paradaActualizada.comercio.razonSocial, 'Despensa Los Pinos');
      assert.equal(resultado.paradaActualizada.totalRemitos, 2);
      assert.equal(resultado.paradaActualizada.totalBultos, 5);
      assert.deepEqual(resultado.paradaActualizada.marcas, ['Arcor', 'Bagley']);
    });
  });

  describe('ESCENARIO 2: Fallo por remitos o visita cancelados por administración', () => {
    it('detecta cuando una parada fue eliminada de la hoja de ruta por administración', () => {
      const r = crearRemito('r1', '0001-2001', 'Arcor', 100000, 'pendiente', 2);
      const vOriginal = crearVisita('v1', 1, 'Kiosco Sol', [r]);
      const paradaLocal = consolidarParadas([vOriginal], colaVacia)[0];

      // Administración eliminó/desagrupó la visita: la hoja actualizada ya no contiene v1
      const hojaServidorModificada: HojaDeRuta = {
        id: 'h1',
        fechaReparto: '2026-10-22',
        patente: 'AA123BB',
        estado: 'publicada',
        sucursal: 'Sur',
        visitas: [], // Lista vacía
      };

      const resultado = verificarParadaActiva(paradaLocal, hojaServidorModificada, colaVacia);

      // Debe rechazar la apertura y notificar motivo
      assert.equal(resultado.activa, false);
      assert.match(resultado.motivo || '', /eliminada|no se encontraron/i);

      // Al consolidar con la nueva hoja, la parada se oculta forzosamente
      const paradasRefrescadas = consolidarParadas(hojaServidorModificada.visitas, colaVacia);
      assert.equal(paradasRefrescadas.length, 0);
    });

    it('detecta cuando administración canceló el estado de la visita (visita.estado = "cancelada")', () => {
      const r = crearRemito('r1', '0001-2001', 'Arcor', 100000, 'pendiente', 2);
      const vOriginal = crearVisita('v1', 1, 'Kiosco Sol', [r]);
      const paradaLocal = consolidarParadas([vOriginal], colaVacia)[0];

      // En el servidor, la visita pasó a 'cancelada'
      const vCancelada = crearVisita('v1', 1, 'Kiosco Sol', [r], 'cancelada');
      const hojaServidor: HojaDeRuta = {
        id: 'h1',
        fechaReparto: '2026-10-22',
        patente: 'AA123BB',
        estado: 'en_curso',
        sucursal: 'Sur',
        visitas: [vCancelada],
      };

      assert.equal(esVisitaActiva(vCancelada), false);

      const resultado = verificarParadaActiva(paradaLocal, hojaServidor, colaVacia);
      assert.equal(resultado.activa, false);
      assert.match(resultado.motivo || '', /cancelados recientemente/i);

      // La visita cancelada se oculta forzosamente de la lista consolidada
      const paradasRefrescadas = consolidarParadas(hojaServidor.visitas, colaVacia);
      assert.equal(paradasRefrescadas.length, 0);
    });

    it('detecta cuando administración anuló todos los remitos de la parada (remito.estado = "anulado")', () => {
      const r1 = crearRemito('r1', '0001-2001', 'Arcor', 100000, 'pendiente', 2);
      const r2 = crearRemito('r2', '0001-2002', 'Bagley', 80000, 'pendiente', 1);
      const vOriginal = crearVisita('v1', 1, 'Kiosco Sol', [r1, r2]);
      const paradaLocal = consolidarParadas([vOriginal], colaVacia)[0];

      // En el servidor, todos los remitos fueron anulados
      const r1Anulado = crearRemito('r1', '0001-2001', 'Arcor', 100000, 'anulado', 2);
      const r2Anulado = crearRemito('r2', '0001-2002', 'Bagley', 80000, 'cancelado', 1);
      const vConRemitosAnulados = crearVisita('v1', 1, 'Kiosco Sol', [r1Anulado, r2Anulado], 'pendiente');

      assert.equal(esRemitoActivo(r1Anulado), false);
      assert.equal(esRemitoActivo(r2Anulado), false);
      assert.equal(esVisitaActiva(vConRemitosAnulados), false);

      const hojaServidor: HojaDeRuta = {
        id: 'h1',
        fechaReparto: '2026-10-22',
        patente: 'AA123BB',
        estado: 'en_curso',
        sucursal: 'Sur',
        visitas: [vConRemitosAnulados],
      };

      const resultado = verificarParadaActiva(paradaLocal, hojaServidor, colaVacia);
      assert.equal(resultado.activa, false);

      // Al actualizar la vista, la visita queda oculta
      const paradasRefrescadas = consolidarParadas(hojaServidor.visitas, colaVacia);
      assert.equal(paradasRefrescadas.length, 0);
    });

    it('mantiene la parada activa y actualiza la carga si administración canceló un remito pero quedan otros activos', () => {
      const r1 = crearRemito('r1', '0001-2001', 'Arcor', 100000, 'pendiente', 2);
      const r2 = crearRemito('r2', '0001-2002', 'Bagley', 80000, 'pendiente', 3);
      const vOriginal = crearVisita('v1', 1, 'Kiosco Sol', [r1, r2]);
      const paradaLocal = consolidarParadas([vOriginal], colaVacia)[0];

      // Administración anuló únicamente r1 (Arcor), r2 (Bagley) sigue activo
      const r1Anulado = crearRemito('r1', '0001-2001', 'Arcor', 100000, 'anulado', 2);
      const vModificada = crearVisita('v1', 1, 'Kiosco Sol', [r1Anulado, r2], 'pendiente');

      assert.equal(esVisitaActiva(vModificada), true);

      const hojaServidor: HojaDeRuta = {
        id: 'h1',
        fechaReparto: '2026-10-22',
        patente: 'AA123BB',
        estado: 'en_curso',
        sucursal: 'Sur',
        visitas: [vModificada],
      };

      const resultado = verificarParadaActiva(paradaLocal, hojaServidor, colaVacia);
      assert.equal(resultado.activa, true);
      assert.ok(resultado.paradaActualizada);

      // Se recalculó la carga excluyendo el remito anulado
      assert.equal(resultado.paradaActualizada.totalRemitos, 1);
      assert.equal(resultado.paradaActualizada.totalBultos, 3);
      assert.deepEqual(resultado.paradaActualizada.marcas, ['Bagley']);
    });
  });
});
