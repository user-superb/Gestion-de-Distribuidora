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
let cachedComercios: Comercio[] = [...MOCK_COMERCIOS];
let cachedMarcas: Marca[] = [...MOCK_MARCAS];

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

export const remitoService = {
  // Síncronos (para tests y modo offline)
  getComercios: (): Comercio[] => cachedComercios,
  getMarcas: (): Marca[] => cachedMarcas,
  getComercioById: (id: string): Comercio | undefined => cachedComercios.find((c) => c.id === id),
  getMarcaById: (id: string): Marca | undefined => cachedMarcas.find((m) => m.id === id),

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

  // -------------------------------------------------------------
  // MÉTODOS ASÍNCRONOS CONEXIÓN API REST (Con fallback automático)
  // -------------------------------------------------------------
  async checkBackend(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getComerciosAsync(): Promise<Comercio[]> {
    try {
      const res = await fetch(`${API_BASE}/comercios`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        cachedComercios = data;
        return data;
      }
    } catch {
      // Fallback
    }
    return remitoService.getComercios();
  },

  async getMarcasAsync(): Promise<Marca[]> {
    try {
      const res = await fetch(`${API_BASE}/marcas`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        cachedMarcas = data;
        return data;
      }
    } catch {
      // Fallback
    }
    return remitoService.getMarcas();
  },

  async asignarComercioARemitoAsync(remitoId: string, nuevoComercioId: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/remitos/asignar-comercio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remitoId, nuevoComercioId }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return;
    } catch {
      // Fallback
    }
    remitoService.asignarComercioARemito(remitoId, nuevoComercioId);
  },

  async getRemitosPendientesAsync(): Promise<Remito[]> {
    try {
      const res = await fetch(`${API_BASE}/remitos/pendientes`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return remitoService.getRemitosPendientes();
  },

  async getVisitasAsync(): Promise<Visita[]> {
    try {
      const res = await fetch(`${API_BASE}/visitas`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return remitoService.getVisitas();
  },

  async agruparEnVisitaAsync(
    remitosIds: string[]
  ): Promise<{ success: boolean; visita?: Visita; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/visitas/agrupar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remitoIds: remitosIds }),
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
      if (data.error) {
        return { success: false, error: data.error };
      }
    } catch {
      // Fallback a lógica en memoria
    }
    return remitoService.agruparEnVisita(remitosIds);
  },

  async desagruparVisitaAsync(visitaId: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/visitas/${encodeURIComponent(visitaId)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return;
    } catch {
      // Fallback
    }
    remitoService.desagruparVisita(visitaId);
  },

  async resetearDatosAsync(): Promise<void> {
    try {
      await fetch(`${API_BASE}/demo/reset`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Fallback
    }
    remitoService.resetearDatosMock();
  },
};