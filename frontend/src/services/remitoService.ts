import { Remito, Visita, Comercio, Marca, HojaDeRuta, Transportista, CargaEntregaManualDto, AnexarEntregaResultado } from '../types/domain';

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

export const MOCK_TRANSPORTISTAS: Transportista[] = [
  { id: '2', nombre: 'Carlos Repartidor', usuario: 'chofer', rol: 'Transportista', activo: true, esTransportista: true, dispositivoConectado: true },
  { id: '6', nombre: 'Mario Flete', usuario: 'chofer2', rol: 'Transportista', activo: true, esTransportista: true, dispositivoConectado: true },
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
let cachedTransportistas: Transportista[] = [...MOCK_TRANSPORTISTAS];

import { API_BASE } from '../config/api';

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

  crearEntregaManual: (
    dto: CargaEntregaManualDto
  ): { success: boolean; remito?: Remito; comercio?: Comercio; error?: string } => {
    // 1. Validar importe
    const importeNum = Number(dto.importe);
    if (!dto.importe || isNaN(importeNum) || importeNum <= 0) {
      return { success: false, error: 'El importe de la entrega debe ser un valor numérico positivo mayor a 0.' };
    }

    // 2. Validar marca
    if (!dto.marcaId) {
      return { success: false, error: 'Debe seleccionar una marca proveedora para la entrega.' };
    }

    // 3. Resolver comercio destinatario
    let comercioId = dto.comercioId ? String(dto.comercioId).trim() : '';
    let comercioObj: Comercio | undefined;

    if (!comercioId) {
      // Escenario 2: Comercio no registrado
      const nuevo = dto.nuevoComercio;
      if (!nuevo || !nuevo.razonSocial?.trim() || !nuevo.domicilio?.trim()) {
        return {
          success: false,
          error:
            'Debe asociar la entrega a un comercio registrado o ingresar los datos básicos del destinatario (Razón social y Domicilio).',
        };
      }
      comercioId = `com-${Date.now().toString().slice(-4)}`;
      comercioObj = {
        id: comercioId,
        razonSocial: nuevo.razonSocial.trim(),
        domicilio: nuevo.domicilio.trim(),
      };
      cachedComercios.push(comercioObj);
    } else {
      // Escenario 1: Comercio ya registrado
      comercioObj = cachedComercios.find((c) => c.id === comercioId);
      if (!comercioObj) {
        return { success: false, error: 'El comercio seleccionado no existe en el sistema.' };
      }
    }

    // 4. Resolver o auto-generar número de remito interno
    let numero = dto.numeroRemito?.trim();
    if (numero) {
      const existe = mockRemitos.some((r) => r.marcaId === dto.marcaId && r.numeroRemito === numero);
      if (existe) {
        return { success: false, error: `Ya existe un remito con el número ${numero} para esta marca.` };
      }
    } else {
      numero = `REM-MAN-${Math.floor(100000 + Math.random() * 900000)}`;
    }

    const nuevoRemito: Remito = {
      id: `rem-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 1000)}`,
      numeroRemito: numero,
      comercioId,
      marcaId: dto.marcaId,
      importe: importeNum,
      estado: 'PENDIENTE',
    };

    mockRemitos.push(nuevoRemito);
    return { success: true, remito: nuevoRemito, comercio: comercioObj };
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

    mockVisitas.push(nuevaVisita);
    return { success: true, visita: nuevaVisita };
  },

  getHojaDeRutaActiva: (): HojaDeRuta | null => {
    return { ...mockHojaDeRuta, visitas: [...mockVisitas] };
  },

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

  cambiarEstadoHojaDeRuta: (nuevoEstado: HojaDeRuta['estado'], hojaId?: string): void => {
    if (hojaId) {
      mockHojasDeRuta = mockHojasDeRuta.map((h) =>
        h.id === hojaId ? { ...h, estado: nuevoEstado } : h
      );
      if (mockHojaDeRuta.id === hojaId) {
        mockHojaDeRuta.estado = nuevoEstado;
      }
    } else {
      mockHojaDeRuta.estado = nuevoEstado;
    }
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
    if (!Array.isArray(visitaIds) || visitaIds.length === 0) {
      return { success: false, error: 'Debe especificar la lista de visitas a ordenar.', status: 400 };
    }

    if (mockHojaDeRuta.estado === 'en_curso' || mockHojaDeRuta.estado === 'cerrada' || mockHojaDeRuta.estado === 'anulada') {
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

  getTransportistas: (): Transportista[] => [...cachedTransportistas],

  asignarTransportistaHojaDeRuta: (
    hojaDeRutaId: string,
    transportistaId: string | null
  ): { success: boolean; hojaDeRuta?: HojaDeRuta; error?: string; status?: number } => {
    if (!hojaDeRutaId) {
      return { success: false, error: 'Debe especificar el ID de la hoja de ruta.', status: 400 };
    }

    const idx = mockHojasDeRuta.findIndex((h) => h.id === hojaDeRutaId);
    if (idx === -1 && mockHojaDeRuta.id !== hojaDeRutaId) {
      return { success: false, error: 'La hoja de ruta especificada no existe.', status: 404 };
    }

    const hojaActual = idx !== -1 ? mockHojasDeRuta[idx] : mockHojaDeRuta;

    // Desasignación si transportistaId es null o vacío
    if (!transportistaId) {
      const actualizada: HojaDeRuta = { ...hojaActual, transportistaId: null, transportistaNombre: null };
      if (idx !== -1) mockHojasDeRuta[idx] = actualizada;
      if (mockHojaDeRuta.id === hojaDeRutaId) mockHojaDeRuta = actualizada;
      return { success: true, hojaDeRuta: actualizada };
    }

    // Regla: Solo transportista habilitado en la flota
    const transportista = cachedTransportistas.find((t) => t.id === transportistaId);
    if (!transportista) {
      return { success: false, error: 'El transportista seleccionado no existe.', status: 404 };
    }

    const estaHabilitado =
      Boolean(transportista.activo) &&
      (Boolean(transportista.esTransportista) || transportista.rol === 'Transportista');

    if (!estaHabilitado) {
      return {
        success: false,
        error: 'La hoja de ruta solo puede ser asignada a un transportista que se encuentre habilitado en la flota.',
        status: 422,
      };
    }

    // Criterio de Aceptación Escenario 2: Fallo por solapamiento de asignación
    const solapada = mockHojasDeRuta.find(
      (h) =>
        h.id !== hojaDeRutaId &&
        h.transportistaId === transportistaId &&
        h.fechaReparto === hojaActual.fechaReparto &&
        h.estado !== 'anulada'
    );

    if (solapada) {
      return {
        success: false,
        error: `El transportista ya posee una hoja de ruta asignada para esa misma fecha (${hojaActual.fechaReparto}).`,
        status: 422,
      };
    }

    // Criterio de Aceptación Escenario 1: Asignación exitosa
    const actualizada: HojaDeRuta = {
      ...hojaActual,
      transportistaId: transportista.id,
      transportistaNombre: transportista.nombre,
    };
    if (idx !== -1) mockHojasDeRuta[idx] = actualizada;
    if (mockHojaDeRuta.id === hojaDeRutaId) mockHojaDeRuta = actualizada;

    return { success: true, hojaDeRuta: actualizada };
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


  setConexionTransportista: (transportistaId: string, conectado: boolean): boolean => {
    cachedTransportistas = cachedTransportistas.map((t) =>
      t.id === transportistaId ? { ...t, dispositivoConectado: conectado } : t
    );
    return true;
  },

  anexarEntregaARuta: (
    remitoId: string,
    hojaDeRutaId: string,
    opciones?: { dispositivoConectado?: boolean }
  ): AnexarEntregaResultado => {
    if (!remitoId || !hojaDeRutaId) {
      return { success: false, error: 'Debe especificar el remito y la hoja de ruta de destino.', status: 400 };
    }

    const remito = mockRemitos.find((r) => r.id === remitoId);
    if (!remito) {
      return { success: false, error: 'El remito especificado no existe.', status: 404 };
    }
    if (remito.estado === 'AGRUPADO') {
      return { success: false, error: 'El remito ya se encuentra asignado a una visita.', status: 422 };
    }

    // Buscar la hoja de ruta de destino
    let hoja = mockHojasDeRuta.find((h) => h.id === hojaDeRutaId);
    if (!hoja && mockHojaDeRuta.id === hojaDeRutaId) {
      hoja = mockHojaDeRuta;
    }
    if (!hoja) {
      return { success: false, error: 'La hoja de ruta de destino no existe.', status: 404 };
    }

    // Regla: Coherencia de comercio destinatario (Solo se pueden agrupar o anexar remitos del mismo comercio)
    const visitasDeHoja = mockVisitas.filter((v) => v.hojaDeRutaId === hojaDeRutaId);
    if (
      visitasDeHoja.length > 0 &&
      !visitasDeHoja.some((v) => v.comercioId === remito.comercioId)
    ) {
      return {
        success: false,
        error:
          'No se puede anexar la entrega: El remito pertenece a un comercio distinto al de la hoja de ruta de destino. Solo se pueden agrupar o anexar entregas del mismo comercio.',
        status: 422,
      };
    }

    // Regla: La ruta de destino debe encontrarse abierta
    if (hoja.estado === 'cerrada' || hoja.estado === 'anulada') {
      return {
        success: false,
        error: `No se puede anexar la entrega: la hoja de ruta de destino no se encuentra abierta (estado actual: "${hoja.estado}").`,
        status: 422,
      };
    }

    // Regla: transportista conexión
    let reportaConexion = true;
    if (opciones?.dispositivoConectado !== undefined) {
      reportaConexion = Boolean(opciones.dispositivoConectado);
    } else if (hoja.transportistaId) {
      const chofer = cachedTransportistas.find((t) => t.id === hoja.transportistaId);
      reportaConexion = chofer?.dispositivoConectado ?? true;
    } else {
      reportaConexion = false;
    }

    const sincronizacionPendiente = !reportaConexion;

    // Calcular orden al final de la secuencia de esta hoja
    // Reutilizamos visitasDeHoja
    const maxOrden = visitasDeHoja.reduce((max, v) => Math.max(max, v.orden || 0), 0);
    const nuevoOrden = maxOrden + 1;

    // Crear la nueva parada
    const nuevaVisitaId = `vis-anexada-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const updatedRemito: Remito = { ...remito, estado: 'AGRUPADO' };
    mockRemitos = mockRemitos.map((r) => (r.id === remitoId ? updatedRemito : r));

    const nuevaParada: Visita = {
      id: nuevaVisitaId,
      comercioId: remito.comercioId,
      remitos: [updatedRemito],
      importeTotal: remito.importe,
      orden: nuevoOrden,
      hojaDeRutaId,
      estado: 'pendiente',
      sincronizacionPendiente,
    };

    mockVisitas.push(nuevaParada);

    // Actualizar la hoja de ruta
    hoja.visitas = [...(hoja.visitas || []), nuevaParada];
    hoja.cantidadVisitas = (hoja.cantidadVisitas || 0) + 1;
    hoja.cantidadRemitos = (hoja.cantidadRemitos || 0) + 1;
    hoja.importeTotal = (hoja.importeTotal || 0) + remito.importe;
    hoja.tieneSincronizacionPendiente = hoja.visitas.some((v) => Boolean(v.sincronizacionPendiente));

    return {
      success: true,
      parada: nuevaParada,
      ordenParada: nuevoOrden,
      hojaDeRuta: { ...hoja },
      sincronizacionPendiente,
      alerta: sincronizacionPendiente ? 'Sincronización pendiente' : undefined,
      mensaje: sincronizacionPendiente
        ? 'Entrega anexada a la ruta. El dispositivo del transportista no reporta conexión; se generó una alerta de "Sincronización pendiente".'
        : 'Entrega anexada exitosamente al final de la secuencia de la hoja de ruta y sincronizada con el transportista.',
    };
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
    cachedComercios = [...MOCK_COMERCIOS];
    cachedMarcas = [...MOCK_MARCAS];
    mockHojasDeRuta = [];
    cachedTransportistas = [...MOCK_TRANSPORTISTAS];
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

  async crearEntregaManualAsync(
    dto: CargaEntregaManualDto
  ): Promise<{ success: boolean; remito?: Remito; comercio?: Comercio; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/remitos/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dto),
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.comercio && !cachedComercios.some((c) => c.id === data.comercio.id)) {
          cachedComercios.push(data.comercio);
        }
        return data;
      }
      return { success: false, error: data.error || 'Error al procesar la entrega manual.' };
    } catch {
      // Fallback a lógica en memoria
    }
    return remitoService.crearEntregaManual(dto);
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
      if (!res.ok || data.error) {
        return {
          success: false,
          error: data?.error || data?.message || 'Error al asignar fecha a la hoja de ruta en el servidor.',
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

  async getTransportistasAsync(): Promise<Transportista[]> {
    try {
      const res = await fetch(`${API_BASE}/transportistas`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        cachedTransportistas = data;
        return data;
      }
    } catch {
      // Fallback a lógica en memoria
    }
    return remitoService.getTransportistas();
  },

  async asignarTransportistaHojaDeRutaAsync(
    hojaDeRutaId: string,
    transportistaId: string | null
  ): Promise<{ success: boolean; hojaDeRuta?: HojaDeRuta; error?: string; status?: number }> {
    try {
      const res = await fetch(
        `${API_BASE}/hoja-de-ruta/${encodeURIComponent(hojaDeRutaId)}/transportista`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transportistaId }),
          signal: AbortSignal.timeout(3000),
        }
      );
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
    return remitoService.asignarTransportistaHojaDeRuta(hojaDeRutaId, transportistaId);
  },
  async anexarEntregaARutaAsync(
    remitoId: string,
    hojaDeRutaId: string,
    opciones?: { dispositivoConectado?: boolean }
  ): Promise<AnexarEntregaResultado> {
    try {
      const res = await fetch(
        `${API_BASE}/hoja-de-ruta/${encodeURIComponent(hojaDeRutaId)}/anexar-entrega`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remitoId, ...opciones }),
          signal: AbortSignal.timeout(3000),
        }
      );
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
    return remitoService.anexarEntregaARuta(remitoId, hojaDeRutaId, opciones);
  },

  async actualizarConexionTransportistaAsync(
    transportistaId: string,
    conectado: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/transportistas/${encodeURIComponent(transportistaId)}/conexion`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conectado }),
          signal: AbortSignal.timeout(3000),
        }
      );
      const data = await res.json();
      if (res.ok) {
        cachedTransportistas = cachedTransportistas.map((t) =>
          t.id === transportistaId ? { ...t, dispositivoConectado: conectado } : t
        );
        return data;
      }
    } catch {
      // Fallback a memoria
    }
    cachedTransportistas = cachedTransportistas.map((t) =>
      t.id === transportistaId ? { ...t, dispositivoConectado: conectado } : t
    );
    return { success: true };
  },
};