// src/services/remitoService.ts
import { Remito, Visita, Comercio, Marca } from '../types/domain';

export const MOCK_COMERCIOS: Comercio[] = [
  { id: 'com-101', razonSocial: 'Mayorista El Sol S.R.L.', domicilio: 'Av. Hipólito Yrigoyen 4500, Lanús' },
  { id: 'com-102', razonSocial: 'Autoservicio Luna', domicilio: 'Belgrano 1230, Avellaneda' },
  { id: 'com-103', razonSocial: 'Distribuidora Los Andes', domicilio: 'Camino Gral. Belgrano 1800, Gerli' },
];

export const MOCK_MARCAS: Marca[] = [
  { id: 'marca-A', nombre: 'Lácteos del Sur' },
  { id: 'marca-B', nombre: 'Bebidas Nacionales' },
  { id: 'marca-C', nombre: 'Alimentos Río de la Plata' },
];

const INITIAL_REMITOS: Remito[] = [
  { id: 'rem-1', numeroRemito: 'R-0001-45120', comercioId: 'com-101', marcaId: 'marca-A', importe: 150000, estado: 'PENDIENTE' },
  { id: 'rem-2', numeroRemito: 'R-0002-89310', comercioId: 'com-101', marcaId: 'marca-B', importe: 85000, estado: 'PENDIENTE' },
  { id: 'rem-3', numeroRemito: 'R-0001-45121', comercioId: 'com-102', marcaId: 'marca-A', importe: 62000, estado: 'PENDIENTE' },
  { id: 'rem-4', numeroRemito: 'R-0003-11200', comercioId: 'com-102', marcaId: 'marca-C', importe: 110000, estado: 'PENDIENTE' },
  { id: 'rem-5', numeroRemito: 'R-0002-89315', comercioId: 'com-103', marcaId: 'marca-B', importe: 94000, estado: 'PENDIENTE' },
];

let mockRemitos: Remito[] = [...INITIAL_REMITOS];
let mockVisitas: Visita[] = [];

export const remitoService = {
  getComercios: (): Comercio[] => MOCK_COMERCIOS,
  getMarcas: (): Marca[] => MOCK_MARCAS,
  getComercioById: (id: string): Comercio | undefined => MOCK_COMERCIOS.find((c) => c.id === id),
  getMarcaById: (id: string): Marca | undefined => MOCK_MARCAS.find((m) => m.id === id),

  getAllRemitos: (): Remito[] => [...mockRemitos],
  getRemitosPendientes: (): Remito[] => mockRemitos.filter((r) => r.estado === 'PENDIENTE'),
  getVisitas: (): Visita[] => [...mockVisitas],

  asignarComercioARemito: (remitoId: string, nuevoComercioId: string): void => {
    mockRemitos = mockRemitos.map((r) =>
      r.id === remitoId ? { ...r, comercioId: nuevoComercioId } : r
    );
  },

  agruparEnVisita: (remitosIds: string[]): { success: boolean; visita?: Visita; error?: string } => {
    const seleccionados = mockRemitos.filter(
      (r) => remitosIds.includes(r.id) && r.estado === 'PENDIENTE'
    );

    if (seleccionados.length === 0) {
      return { success: false, error: 'Debe seleccionar al menos un remito pendiente.' };
    }

    // REGLA DE NEGOCIO ESTRICTA: Mismo ID de comercio destinatario
    const comercioIdBase = seleccionados[0].comercioId;
    const todosMismoComercio = seleccionados.every((r) => r.comercioId === comercioIdBase);

    if (!todosMismoComercio) {
      return {
        success: false,
        error:
          'No se puede agrupar: Los remitos seleccionados pertenecen a comercios distintos. Solo se agrupan remitos que compartan exactamente el mismo identificador de comercio destinatario.',
      };
    }

    // Marcar remitos como AGRUPADO
    mockRemitos = mockRemitos.map((r) =>
      remitosIds.includes(r.id) ? { ...r, estado: 'AGRUPADO' } : r
    );

    const remitosActualizados = seleccionados.map((r) => ({ ...r, estado: 'AGRUPADO' as const }));

    // Verificar si ya hay una visita abierta para ese mismo comercio y sumarlos ahí, o crear una nueva
    const indexExistente = mockVisitas.findIndex((v) => v.comercioId === comercioIdBase);

    if (indexExistente >= 0) {
      const visitaActual = mockVisitas[indexExistente];
      const remitosUnificados = [...visitaActual.remitos, ...remitosActualizados];
      const visitaActualizada: Visita = {
        ...visitaActual,
        remitos: remitosUnificados,
        importeTotal: remitosUnificados.reduce((acc, r) => acc + r.importe, 0),
      };
      mockVisitas[indexExistente] = visitaActualizada;
      return { success: true, visita: visitaActualizada };
    }

    const nuevaVisita: Visita = {
      id: `VIS-${mockVisitas.length + 1}`,
      comercioId: comercioIdBase,
      remitos: remitosActualizados,
      importeTotal: remitosActualizados.reduce((acc, r) => acc + r.importe, 0),
    };

    mockVisitas = [nuevaVisita, ...mockVisitas];
    return { success: true, visita: nuevaVisita };
  },

  desagruparVisita: (visitaId: string): void => {
    const visita = mockVisitas.find((v) => v.id === visitaId);
    if (!visita) return;

    const idsEnVisita = visita.remitos.map((r) => r.id);
    mockRemitos = mockRemitos.map((r) =>
      idsEnVisita.includes(r.id) ? { ...r, estado: 'PENDIENTE' } : r
    );
    mockVisitas = mockVisitas.filter((v) => v.id !== visitaId);
  },

  resetearDatosMock: (): void => {
    mockRemitos = [...INITIAL_REMITOS];
    mockVisitas = [];
  },
};