import { Remito, Visita, Comercio, Marca, HojaDeRuta } from '../types/domain';

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

export function obtenerFechaActualISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function esFechaCalendarioValida(fechaISO: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return false;
  const parsed = new Date(`${fechaISO}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === fechaISO;
}

let mockRemitos: Remito[] = [...INITIAL_REMITOS];
let mockVisitas: Visita[] = [];
let mockHojaCounter = 1;
let mockHojaDeRuta: HojaDeRuta = {
  id: 'hdr-1',
  numero: 'HR-0001',
  transportistaId: null,
  transportistaNombre: null,
  fechaReparto: obtenerFechaActualISO(),
  estado: 'borrador',
  visitas: [],
  cantidadVisitas: 0,
  cantidadRemitos: 0,
  importeTotal: 0,
};
let mockHojasDeRuta: HojaDeRuta[] = [];
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

    // Verificar si ya hay una visita abierta en armado (sin hojaDeRutaId) para ese mismo comercio
    const indexExistente = mockVisitas.findIndex(
      (v) => v.comercioId === comercioIdBase && !v.hojaDeRutaId
    );

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

    const visitasEnArmado = mockVisitas.filter((v) => !v.hojaDeRutaId);
    const nuevaVisita: Visita = {
      id: `VIS-${mockVisitas.length + 1}`,
      comercioId: comercioIdBase,
      remitos: remitosActualizados,
      importeTotal: remitosActualizados.reduce((acc, r) => acc + r.importe, 0),
      orden: visitasEnArmado.length + 1,
      hojaDeRutaId: null,
      estado: 'pendiente',
    };

    mockVisitas = [nuevaVisita, ...mockVisitas];
    return { success: true, visita: nuevaVisita };
  },

  getHojaDeRutaActiva: (): HojaDeRuta => ({ ...mockHojaDeRuta }),

  getHojasDeRuta: (): HojaDeRuta[] =>
    mockHojasDeRuta.map((h) => {
      const visitasRuta = mockVisitas.filter((v) => v.hojaDeRutaId === h.id);
      return {
        ...h,
        visitas: visitasRuta,
        cantidadVisitas: visitasRuta.length,
        cantidadRemitos: visitasRuta.reduce((acc, v) => acc + v.remitos.length, 0),
        importeTotal: visitasRuta.reduce((acc, v) => acc + v.importeTotal, 0),
      };
    }),

  eliminarHojaDeRuta: (id: string): { success: boolean } => {
    mockVisitas = mockVisitas.map((v) =>
      v.hojaDeRutaId === id ? { ...v, hojaDeRutaId: null } : v
    );
    let orden = 1;
    mockVisitas = mockVisitas.map((v) => (!v.hojaDeRutaId ? { ...v, orden: orden++ } : v));
    mockHojasDeRuta = mockHojasDeRuta.filter((h) => h.id !== id);
    if (mockHojaDeRuta.id === id) {
      mockHojaDeRuta = {
        id: `hdr-${mockHojaCounter}`,
        numero: `HR-${String(mockHojaCounter).padStart(4, '0')}`,
        transportistaId: null,
        transportistaNombre: null,
        fechaReparto: obtenerFechaActualISO(),
        estado: 'borrador',
        visitas: [],
        cantidadVisitas: 0,
        cantidadRemitos: 0,
        importeTotal: 0,
      };
    }
    return { success: true };
  },

  cambiarEstadoHojaDeRuta: (nuevoEstado: HojaDeRuta['estado']): void => {
    mockHojaDeRuta.estado = nuevoEstado;
  },

  asignarFechaHojaDeRuta: (
    fechaReparto: string,
    fechaReferencia?: string
  ): { success: boolean; hojaDeRuta?: HojaDeRuta; error?: string; status?: number } => {
    const fechaLimpia = typeof fechaReparto === 'string' ? fechaReparto.trim() : '';

    if (!fechaLimpia || !esFechaCalendarioValida(fechaLimpia)) {
      return {
        success: false,
        error: 'Debe ingresar una fecha válida con formato AAAA-MM-DD.',
        status: 400,
      };
    }

    const hoy =
      fechaReferencia && esFechaCalendarioValida(fechaReferencia)
        ? fechaReferencia
        : obtenerFechaActualISO();

    // Criterio de Aceptación ESCENARIO 2:
    // "Fallo por fecha pretérita: El administrativo intenta ingresar una fecha anterior a la actual. El sistema rechaza la programación."
    if (fechaLimpia < hoy) {
      return {
        success: false,
        error:
          'No se puede programar la hoja de ruta en una fecha anterior a la actual. El sistema opera logísticamente en el día o a futuro.',
        status: 422,
      };
    }

    if (
      mockHojaDeRuta.estado === 'en_curso' ||
      mockHojaDeRuta.estado === 'cerrada' ||
      mockHojaDeRuta.estado === 'anulada'
    ) {
      return {
        success: false,
        error: 'No se puede reprogramar la fecha: la hoja de ruta ya fue despachada o finalizada.',
        status: 409,
      };
    }

    const nuevaHojaId = `hdr-${mockHojaCounter}`;
    const numeroHoja = `HR-${String(mockHojaCounter).padStart(4, '0')}`;
    mockHojaCounter++;

    // Consolidar las visitas en armado (sin hojaDeRutaId) dentro de esta nueva Hoja de Ruta
    let idxOrden = 1;
    mockVisitas = mockVisitas.map((v) =>
      !v.hojaDeRutaId ? { ...v, hojaDeRutaId: nuevaHojaId, orden: idxOrden++ } : v
    );

    const visitasDeEstaHoja = mockVisitas.filter((v) => v.hojaDeRutaId === nuevaHojaId);

    // Criterio de Aceptación ESCENARIO 1:
    // "Programación exitosa: Se define la fecha. La ruta queda en estado 'Pendiente de Despacho'."
    const hojaCreada: HojaDeRuta = {
      id: nuevaHojaId,
      numero: numeroHoja,
      transportistaId: null,
      transportistaNombre: null,
      fechaReparto: fechaLimpia,
      estado: 'pendiente_de_despacho',
      visitas: visitasDeEstaHoja,
      cantidadVisitas: visitasDeEstaHoja.length,
      cantidadRemitos: visitasDeEstaHoja.reduce((acc, v) => acc + v.remitos.length, 0),
      importeTotal: visitasDeEstaHoja.reduce((acc, v) => acc + v.importeTotal, 0),
    };

    mockHojaDeRuta = { ...hojaCreada };
    mockHojasDeRuta = [...mockHojasDeRuta, hojaCreada];

    return {
      success: true,
      hojaDeRuta: { ...hojaCreada },
    };
  },

  reordenarVisitas: (
    visitaIds: string[]
  ): { success: boolean; visitas?: Visita[]; error?: string; status?: number } => {
    if (!visitaIds || visitaIds.length === 0) {
      return { success: false, error: 'Debe especificar la lista de visitas a ordenar.', status: 400 };
    }

    if (mockHojaDeRuta.estado === 'en_curso' || mockHojaDeRuta.estado === 'cerrada') {
      return {
        success: false,
        error: 'No se puede modificar el orden: la hoja de ruta ya fue despachada y se encuentra en ejecución.',
        status: 409,
      };
    }

    const mapa = new Map(mockVisitas.map((v) => [v.id, v]));
    const nuevas: Visita[] = [];

    visitaIds.forEach((id, index) => {
      const v = mapa.get(id);
      if (v) {
        nuevas.push({ ...v, orden: index + 1 });
      }
    });

    const restantes = mockVisitas.filter((v) => !visitaIds.includes(v.id));
    mockVisitas = [...nuevas, ...restantes];
    return { success: true, visitas: [...nuevas] };
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
    mockHojaCounter = 1;
    mockHojaDeRuta = {
      id: 'hdr-1',
      numero: 'HR-0001',
      transportistaId: null,
      transportistaNombre: null,
      fechaReparto: obtenerFechaActualISO(),
      estado: 'borrador',
      visitas: [],
      cantidadVisitas: 0,
      cantidadRemitos: 0,
      importeTotal: 0,
    };
    mockHojasDeRuta = [];
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

  async getHojaDeRutaActivaAsync(): Promise<HojaDeRuta | null> {
    try {
      const res = await fetch(`${API_BASE}/hoja-de-ruta/activa`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        if (data) return data;
      }
    } catch {
      // Fallback
    }
    return remitoService.getHojaDeRutaActiva();
  },

  async getHojasDeRutaAsync(): Promise<HojaDeRuta[]> {
    try {
      const res = await fetch(`${API_BASE}/hojas-de-ruta`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    } catch {
      // Fallback
    }
    return remitoService.getHojasDeRuta();
  },

  async eliminarHojaDeRutaAsync(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/hojas-de-ruta/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback
    }
    return remitoService.eliminarHojaDeRuta(id);
  },

  async cambiarEstadoHojaDeRutaAsync(id: string, estado: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/hoja-de-ruta/${encodeURIComponent(id)}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return;
    } catch {
      // Fallback
    }
    remitoService.cambiarEstadoHojaDeRuta(estado as any);
  },

  async asignarFechaHojaDeRutaAsync(
    fechaReparto: string,
    id?: string
  ): Promise<{ success: boolean; hojaDeRuta?: HojaDeRuta; error?: string; status?: number }> {
    try {
      const endpoint = id
        ? `${API_BASE}/hoja-de-ruta/${encodeURIComponent(id)}/fecha`
        : `${API_BASE}/hoja-de-ruta/fecha`;
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fechaReparto, hojaDeRutaId: id }),
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
      if (data.error) {
        return {
          success: false,
          error: data.error,
          status: res.status,
        };
      }
    } catch {
      // Fallback a lógica en memoria
    }
    return remitoService.asignarFechaHojaDeRuta(fechaReparto);
  },

  async reordenarVisitasAsync(
    visitaIds: string[],
    hojaDeRutaId?: string
  ): Promise<{ success: boolean; visitas?: Visita[]; error?: string; status?: number }> {
    try {
      const res = await fetch(`${API_BASE}/visitas/reordenar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitaIds, hojaDeRutaId }),
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
      return {
        success: false,
        error: data.error || 'Error al reordenar visitas.',
        status: res.status,
      };
    } catch {
      // Fallback a lógica en memoria
    }
    return remitoService.reordenarVisitas(visitaIds);
  },
};
