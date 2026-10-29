// backend/src/services/rechazoService.ts
// HU #24 · Registrar rechazo de entrega: el comercio no recibe un remito y el transportista deja el motivo.
// La app ya enviaba POST /api/transportista/remitos/:id/rechazar, pero el endpoint no existía (respondía 403).
import { PoolClient } from 'pg';
import { db } from '../db.js';

export class RechazoError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

export interface RechazoDto {
  motivo?: unknown;
  timestamp?: unknown;
  latitud?: unknown;
  longitud?: unknown;
}

async function enTransaccion<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const numeroONulo = (valor: unknown) => (valor === null || valor === undefined || valor === '' || !Number.isFinite(Number(valor)) ? null : Number(valor));

export const rechazoService = {
  async rechazarRemito(transportistaId: number, remitoId: string, body: RechazoDto) {
    if (!/^[1-9]\d*$/.test(remitoId)) throw new RechazoError('Remito inválido.', 400);
    const motivo = String(body?.motivo ?? '').trim();
    if (!motivo) throw new RechazoError('Indicá el motivo del rechazo.', 422);
    if (motivo.length > 300) throw new RechazoError('El motivo no puede superar los 300 caracteres.', 422);
    const latitud = numeroONulo(body?.latitud);
    const longitud = latitud === null ? null : numeroONulo(body?.longitud);

    return enTransaccion(async (client) => {
      const res = await client.query(
        `SELECT r.id::text AS id, r.estado, r.visita_id::text AS visita_id, h.transportista_id::text AS transportista_id
         FROM remito r
         JOIN visita v ON v.id = r.visita_id
         JOIN hoja_de_ruta h ON h.id = v.hoja_de_ruta_id
         WHERE r.id::text = $1`,
        [remitoId]
      );
      const remito = res.rows[0];
      if (!remito || remito.transportista_id !== String(transportistaId)) {
        throw new RechazoError('El remito no existe o no pertenece a tu hoja de ruta.', 404);
      }
      // Reenvío desde la cola sin conexión: vale el primer registro.
      if (remito.estado === 'no_entregado' || remito.estado === 'devuelto') {
        return { success: true, duplicado: true, remitoId, visitaId: remito.visita_id };
      }
      if (remito.estado === 'entregado') throw new RechazoError('El remito ya fue entregado: no se puede rechazar.', 409);
      if (remito.estado === 'anulado') throw new RechazoError('El remito fue anulado por administración.', 409);

      await client.query(
        `UPDATE remito
         SET estado = 'no_entregado', motivo_no_entrega = $2, latitud = $3, longitud = $4, actualizado_en = now()
         WHERE id::text = $1`,
        [remitoId, motivo, latitud, longitud]
      );

      // Misma regla que la entrega (HU #22 Regla 3): la visita se cierra cuando todos sus remitos son finales.
      const restantes = await client.query(
        `SELECT estado FROM remito WHERE visita_id::text = $1`,
        [remito.visita_id]
      );
      const estados = restantes.rows.map((row) => row.estado);
      const pendientes = estados.filter((estado) => estado === 'pendiente' || estado === 'en_ruta').length;
      let visitaEstado = 'en_curso';
      if (pendientes === 0) {
        const huboEntrega = estados.includes('entregado');
        visitaEstado = huboEntrega ? 'completada' : 'no_realizada';
        await client.query(
          `UPDATE visita SET estado = $2, observacion = $3 WHERE id::text = $1`,
          [remito.visita_id, visitaEstado, huboEntrega ? 'Entregada con excepciones' : 'Todos los remitos rechazados']
        );
      } else {
        await client.query(`UPDATE visita SET estado = 'en_curso' WHERE id::text = $1 AND estado = 'pendiente'`, [remito.visita_id]);
      }

      return { success: true, duplicado: false, remitoId, visitaId: remito.visita_id, visitaEstado };
    });
  },
};
