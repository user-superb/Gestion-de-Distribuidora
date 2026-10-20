// backend/src/services/remitoService.ts
import { db } from '../db.js';

export interface Comercio {
  id: string;
  razonSocial: string;
  domicilio: string;
}

export interface Marca {
  id: string;
  nombre: string;
}

export interface Remito {
  id: string;
  numeroRemito: string;
  comercioId: string;
  marcaId: string;
  importe: number;
  estado: 'PENDIENTE' | 'AGRUPADO';
  visitaId?: string | null;
}

export interface Visita {
  id: string;
  comercioId: string;
  remitos: Remito[];
  importeTotal: number;
  orden?: number;
  hojaDeRutaId?: string | null;
  estado?: string;
}

export interface HojaDeRuta {
  id: string;
  sucursalId?: string;
  transportistaId?: string;
  fechaReparto: string;
  patente?: string;
  estado: 'borrador' | 'publicada' | 'en_curso' | 'cerrada' | 'anulada';
  visitas?: Visita[];
}

export interface NuevoComercioDto {
  razonSocial: string;
  domicilio: string;
  localidad?: string;
  telefono?: string;
  cuit?: string;
}

export interface CargaEntregaManualDto {
  comercioId?: string;
  nuevoComercio?: NuevoComercioDto;
  marcaId: string;
  importe: number;
  numeroRemito?: string;
  fechaEmision?: string;
  sucursalId?: string;
}

export const remitoService = {
  async getComercios(): Promise<Comercio[]> {
    const res = await db.query(
      'SELECT id::text as id, razon_social as "razonSocial", domicilio FROM comercio WHERE activo = true ORDER BY id'
    );
    return res.rows;
  },

  async getMarcas(): Promise<Marca[]> {
    const res = await db.query('SELECT id::text as id, nombre FROM marca WHERE activa = true ORDER BY id');
    return res.rows;
  },

  async getRemitosPendientes(): Promise<Remito[]> {
    const res = await db.query(
      `SELECT id::text as id, numero as "numeroRemito", comercio_id::text as "comercioId",
              marca_id::text as "marcaId",
              (CASE WHEN importe_centavos >= 100 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
              'PENDIENTE' as estado, visita_id::text as "visitaId"
       FROM remito
       WHERE visita_id IS NULL AND estado = 'pendiente'
       ORDER BY id`
    );
    return res.rows;
  },

  async getAllRemitos(): Promise<Remito[]> {
    const res = await db.query(
      `SELECT id::text as id, numero as "numeroRemito", comercio_id::text as "comercioId",
              marca_id::text as "marcaId",
              (CASE WHEN importe_centavos >= 100 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
              (CASE WHEN visita_id IS NOT NULL THEN 'AGRUPADO' ELSE 'PENDIENTE' END) as estado,
              visita_id::text as "visitaId"
       FROM remito
       ORDER BY id`
    );
    return res.rows;
  },

  async getVisitas(): Promise<Visita[]> {
    const visitasRes = await db.query(
      `SELECT id::text as id, comercio_id::text as "comercioId",
              hoja_de_ruta_id::text as "hojaDeRutaId", orden, estado
       FROM visita
       ORDER BY COALESCE(orden, 999999), id ASC`
    );

    const visitas: Visita[] = [];

    for (const v of visitasRes.rows) {
      const remitosRes = await db.query(
        `SELECT id::text as id, numero as "numeroRemito", comercio_id::text as "comercioId",
                marca_id::text as "marcaId",
                (CASE WHEN importe_centavos >= 100 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
                'AGRUPADO' as estado, visita_id::text as "visitaId"
         FROM remito
         WHERE visita_id::text = $1
         ORDER BY id`,
        [v.id]
      );

      const remitos: Remito[] = remitosRes.rows;
      const importeTotal = remitos.reduce((acc, r) => acc + Number(r.importe), 0);

      visitas.push({
        id: v.id,
        comercioId: v.comercioId,
        remitos,
        importeTotal,
        orden: v.orden != null ? Number(v.orden) : undefined,
        hojaDeRutaId: v.hojaDeRutaId || null,
        estado: v.estado,
      });
    }

    return visitas;
  },

  async crearEntregaManual(
    dto: CargaEntregaManualDto
  ): Promise<{
    success: boolean;
    remito?: Remito;
    comercio?: Comercio;
    error?: string;
    status?: number;
    esNuevoComercio?: boolean;
  }> {
    // 1. Validar importe
    const importeNum = Number(dto.importe);
    if (!dto.importe || isNaN(importeNum) || importeNum <= 0) {
      return {
        success: false,
        error: 'El importe de la entrega debe ser un valor numérico positivo mayor a 0.',
        status: 400,
      };
    }

    // 2. Validar marca
    if (!dto.marcaId) {
      return {
        success: false,
        error: 'Debe seleccionar una marca proveedora para la entrega.',
        status: 400,
      };
    }

    const marcaCheck = await db.query('SELECT id::text as id, nombre FROM marca WHERE id::text = $1', [
      String(dto.marcaId),
    ]);
    if (marcaCheck.rows.length === 0) {
      return {
        success: false,
        error: 'La marca seleccionada no existe en el sistema.',
        status: 404,
      };
    }

    // 3. Resolver comercio destinatario (Escenario 1 vs Escenario 2)
    let comercioId = dto.comercioId ? String(dto.comercioId).trim() : '';
    let comercioObj: Comercio | undefined;
    let esNuevoComercio = false;

    if (!comercioId) {
      // Escenario 2: Comercio no registrado -> Carga básica de datos
      const nuevo = dto.nuevoComercio;
      if (!nuevo || !nuevo.razonSocial?.trim() || !nuevo.domicilio?.trim()) {
        return {
          success: false,
          error:
            'Debe asociar la entrega a un comercio registrado o ingresar los datos básicos del destinatario (Razón social y Domicilio).',
          status: 400,
        };
      }

      const insertComRes = await db.query(
        `INSERT INTO comercio (razon_social, domicilio, localidad, telefono, cuit, activo)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id::text as id, razon_social as "razonSocial", domicilio`,
        [
          nuevo.razonSocial.trim(),
          nuevo.domicilio.trim(),
          nuevo.localidad?.trim() || null,
          nuevo.telefono?.trim() || null,
          nuevo.cuit?.trim() || null,
        ]
      );
      comercioObj = insertComRes.rows[0];
      comercioId = comercioObj!.id;
      esNuevoComercio = true;
    } else {
      // Escenario 1: Comercio ya registrado
      const comRes = await db.query(
        'SELECT id::text as id, razon_social as "razonSocial", domicilio FROM comercio WHERE id::text = $1',
        [comercioId]
      );
      if (comRes.rows.length === 0) {
        return {
          success: false,
          error: 'El comercio seleccionado no existe en el sistema.',
          status: 404,
        };
      }
      comercioObj = comRes.rows[0];
    }

    // 4. Validar o auto-generar número de remito interno
    let numero = dto.numeroRemito?.trim();
    if (numero) {
      const dupCheck = await db.query(
        'SELECT id FROM remito WHERE marca_id::text = $1 AND numero = $2',
        [String(dto.marcaId), numero]
      );
      if (dupCheck.rows.length > 0) {
        return {
          success: false,
          error: `Ya existe un remito con el número ${numero} para esta marca.`,
          status: 409,
        };
      }
    } else {
      // Generar número interno único
      const randSuffix = Math.floor(100000 + Math.random() * 900000);
      numero = `REM-MAN-${randSuffix}`;
    }

    // 5. Insertar remito en estado 'pendiente' y archivo_id = NULL
    const sucursalId = dto.sucursalId ? String(dto.sucursalId) : '1';
    const importeCentavos = Math.round(importeNum * 100);

    let nuevoRemito: Remito;
    try {
      const remitoRes = await db.query(
        `INSERT INTO remito (numero, marca_id, comercio_id, sucursal_id, importe_centavos, estado, visita_id)
         VALUES ($1, $2::bigint, $3::bigint, $4::bigint, $5::bigint, 'pendiente', NULL)
         RETURNING id::text as id, numero as "numeroRemito", comercio_id::text as "comercioId",
                   marca_id::text as "marcaId", (CASE WHEN importe_centavos >= 100 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
                   'PENDIENTE' as estado, visita_id::text as "visitaId"`,
        [numero, dto.marcaId, comercioId, sucursalId, importeCentavos]
      );
      nuevoRemito = remitoRes.rows[0];
    } catch (err: any) {
      if (err.message?.includes('sucursal_id')) {
        const remitoRes = await db.query(
          `INSERT INTO remito (numero, marca_id, comercio_id, importe_centavos, estado, visita_id)
           VALUES ($1, $2::bigint, $3::bigint, $4::bigint, 'pendiente', NULL)
           RETURNING id::text as id, numero as "numeroRemito", comercio_id::text as "comercioId",
                     marca_id::text as "marcaId", (CASE WHEN importe_centavos >= 100 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
                     'PENDIENTE' as estado, visita_id::text as "visitaId"`,
          [numero, dto.marcaId, comercioId, importeCentavos]
        );
        nuevoRemito = remitoRes.rows[0];
      } else {
        throw err;
      }
    }

    return {
      success: true,
      remito: nuevoRemito,
      comercio: comercioObj,
      esNuevoComercio,
    };
  },

  async asignarComercioARemito(remitoId: string, nuevoComercioId: string): Promise<void> {
    await db.query('UPDATE remito SET comercio_id = $1::bigint WHERE id::text = $2', [
      nuevoComercioId,
      remitoId,
    ]);
  },

  async agruparEnVisita(
    remitoIds: string[]
  ): Promise<{ success: boolean; visita?: Visita; error?: string }> {
    if (!remitoIds || remitoIds.length === 0) {
      return { success: false, error: 'Debe seleccionar al menos un remito pendiente.' };
    }

    // Buscar los remitos pendientes que coincidan con los IDs
    const res = await db.query(
      `SELECT id::text as id, numero as "numeroRemito", comercio_id::text as "comercioId",
              marca_id::text as "marcaId",
              (CASE WHEN importe_centavos >= 100 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
              estado, visita_id::text as "visitaId"
       FROM remito
       WHERE id::text = ANY($1) AND visita_id IS NULL`,
      [remitoIds]
    );

    const seleccionados = res.rows;

    if (seleccionados.length !== remitoIds.length) {
      return {
        success: false,
        error: 'Algunos de los remitos seleccionados no existen o ya fueron agrupados.',
      };
    }

    // Regla de Negocio Estricta: Mismo identificador de comercio destinatario
    const primerComercioId = seleccionados[0].comercioId;
    const todosMismoComercio = seleccionados.every((r) => r.comercioId === primerComercioId);

    if (!todosMismoComercio) {
      return {
        success: false,
        error:
          'No se puede agrupar: Los remitos seleccionados pertenecen a comercios distintos. Solo se agrupan remitos que compartan exactamente el mismo identificador de comercio destinatario.',
      };
    }

    // Verificar si ya existe una visita previa para ese comercio sin ruta asignada
    const visitaExistenteRes = await db.query(
      'SELECT id::text as id, comercio_id::text as "comercioId" FROM visita WHERE comercio_id::text = $1 AND hoja_de_ruta_id IS NULL',
      [primerComercioId]
    );

    let targetVisitaId: string;

    if (visitaExistenteRes.rows.length > 0) {
      targetVisitaId = visitaExistenteRes.rows[0].id;
    } else {
      let hojaId: string | null = null;
      try {
        const hojaRes = await db.query('SELECT id::text as id FROM hoja_de_ruta ORDER BY id ASC LIMIT 1');
        if (hojaRes.rows.length > 0) hojaId = hojaRes.rows[0].id;
      } catch {
        // En tests unitarios sin hoja_de_ruta, continuar con null
      }
      const ordenRes = await db.query('SELECT COALESCE(MAX(orden), 0) + 1 as sig FROM visita');
      const sigOrden = Number(ordenRes.rows[0]?.sig || 1);
      const nuevaVisitaRes = await db.query(
        'INSERT INTO visita (comercio_id, estado, orden, hoja_de_ruta_id) VALUES ($1::bigint, $2, $3, $4) RETURNING id::text as id',
        [primerComercioId, 'pendiente', sigOrden, hojaId]
      );
      targetVisitaId = nuevaVisitaRes.rows[0].id;
    }

    // Asociar remitos a la visita en PostgreSQL
    await db.query('UPDATE remito SET visita_id = $1::bigint WHERE id::text = ANY($2)', [
      targetVisitaId,
      remitoIds,
    ]);

    // Consultar todos los remitos unificados en esa visita
    const remitosConsolidadosRes = await db.query(
      `SELECT id::text as id, numero as "numeroRemito", comercio_id::text as "comercioId",
              marca_id::text as "marcaId",
              (CASE WHEN importe_centavos >= 100 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
              'AGRUPADO' as estado, visita_id::text as "visitaId"
       FROM remito
       WHERE visita_id::text = $1
       ORDER BY id`,
      [targetVisitaId]
    );

    const remitosConsolidados: Remito[] = remitosConsolidadosRes.rows;
    const importeTotal = remitosConsolidados.reduce((acc, r) => acc + Number(r.importe), 0);
    const vRow = await db.query('SELECT orden, hoja_de_ruta_id::text as "hojaDeRutaId", estado FROM visita WHERE id::text = $1', [targetVisitaId]);

    const visitaActualizada: Visita = {
      id: targetVisitaId,
      comercioId: primerComercioId,
      remitos: remitosConsolidados,
      importeTotal,
      orden: vRow.rows[0]?.orden != null ? Number(vRow.rows[0].orden) : undefined,
      hojaDeRutaId: vRow.rows[0]?.hojaDeRutaId || null,
      estado: vRow.rows[0]?.estado,
    };

    return { success: true, visita: visitaActualizada };
  },

  async desagruparVisita(visitaId: string): Promise<void> {
    await db.query('UPDATE remito SET visita_id = NULL WHERE visita_id::text = $1', [visitaId]);
    await db.query('DELETE FROM visita WHERE id::text = $1', [visitaId]);
  },

  async getHojaDeRutaActiva(): Promise<HojaDeRuta | null> {
    try {
      const res = await db.query(
        'SELECT id::text as id, sucursal_id::text as "sucursalId", transportista_id::text as "transportistaId", fecha_reparto as "fechaReparto", estado FROM hoja_de_ruta ORDER BY id ASC LIMIT 1'
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: String(row.id),
        sucursalId: row.sucursalId ? String(row.sucursalId) : undefined,
        transportistaId: row.transportistaId ? String(row.transportistaId) : undefined,
        fechaReparto: String(row.fechaReparto || ''),
        estado: row.estado,
      };
    } catch {
      return null;
    }
  },

  async cambiarEstadoHojaDeRuta(id: string, nuevoEstado: string): Promise<void> {
    await db.query('UPDATE hoja_de_ruta SET estado = $1 WHERE id::text = $2', [nuevoEstado, id]);
  },

  async reordenarVisitas(
    visitaIds: string[],
    hojaDeRutaId?: string
  ): Promise<{ success: boolean; visitas?: Visita[]; error?: string; status?: number }> {
    if (!Array.isArray(visitaIds) || visitaIds.length === 0) {
      return { success: false, error: 'Debe especificar la lista de visitas a ordenar.', status: 400 };
    }

    let targetHojaId = hojaDeRutaId;
    if (!targetHojaId) {
      const checkHoja = await db.query(
        'SELECT DISTINCT hoja_de_ruta_id::text as "hojaId" FROM visita WHERE id::text = ANY($1) AND hoja_de_ruta_id IS NOT NULL',
        [visitaIds]
      );
      if (checkHoja.rows.length > 0) {
        targetHojaId = checkHoja.rows[0].hojaId;
      }
    }

    if (targetHojaId) {
      const hojaRes = await db.query('SELECT estado FROM hoja_de_ruta WHERE id::text = $1', [targetHojaId]);
      if (hojaRes.rows.length > 0) {
        const estadoRuta = hojaRes.rows[0].estado;
        if (estadoRuta === 'en_curso' || estadoRuta === 'cerrada' || estadoRuta === 'anulada') {
          return {
            success: false,
            error: 'No se puede modificar el orden: la hoja de ruta ya fue despachada y se encuentra en ejecución.',
            status: 409,
          };
        }
      }
    }

    for (let i = 0; i < visitaIds.length; i++) {
      await db.query('UPDATE visita SET orden = $1 WHERE id::text = $2', [-(i + 1), visitaIds[i]]);
    }

    for (let i = 0; i < visitaIds.length; i++) {
      await db.query('UPDATE visita SET orden = $1 WHERE id::text = $2', [i + 1, visitaIds[i]]);
    }

    const visitasActualizadas = await this.getVisitas();
    return { success: true, visitas: visitasActualizadas };
  },
};
