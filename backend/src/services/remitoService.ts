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
              (CASE WHEN importe_centavos > 1000000 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
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
              (CASE WHEN importe_centavos > 1000000 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
              (CASE WHEN visita_id IS NOT NULL THEN 'AGRUPADO' ELSE 'PENDIENTE' END) as estado,
              visita_id::text as "visitaId"
       FROM remito
       ORDER BY id`
    );
    return res.rows;
  },

  async getVisitas(): Promise<Visita[]> {
    const visitasRes = await db.query(
      'SELECT id::text as id, comercio_id::text as "comercioId" FROM visita ORDER BY id DESC'
    );

    const visitas: Visita[] = [];

    for (const v of visitasRes.rows) {
      const remitosRes = await db.query(
        `SELECT id::text as id, numero as "numeroRemito", comercio_id::text as "comercioId",
                marca_id::text as "marcaId",
                (CASE WHEN importe_centavos > 1000000 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
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
      });
    }

    return visitas;
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
              (CASE WHEN importe_centavos > 1000000 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
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
      const nuevaVisitaRes = await db.query(
        'INSERT INTO visita (comercio_id, estado) VALUES ($1::bigint, $2) RETURNING id::text as id',
        [primerComercioId, 'pendiente']
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
              (CASE WHEN importe_centavos > 1000000 THEN importe_centavos / 100 ELSE importe_centavos END)::int as importe,
              'AGRUPADO' as estado, visita_id::text as "visitaId"
       FROM remito
       WHERE visita_id::text = $1
       ORDER BY id`,
      [targetVisitaId]
    );

    const remitosConsolidados: Remito[] = remitosConsolidadosRes.rows;
    const importeTotal = remitosConsolidados.reduce((acc, r) => acc + Number(r.importe), 0);

    const visitaActualizada: Visita = {
      id: targetVisitaId,
      comercioId: primerComercioId,
      remitos: remitosConsolidados,
      importeTotal,
    };

    return { success: true, visita: visitaActualizada };
  },

  async desagruparVisita(visitaId: string): Promise<void> {
    await db.query('UPDATE remito SET visita_id = NULL WHERE visita_id::text = $1', [visitaId]);
    await db.query('DELETE FROM visita WHERE id::text = $1', [visitaId]);
  },
};
