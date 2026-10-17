import { PoolClient } from 'pg';
import { db } from '../db.js';

export class ConciliacionError extends Error {
  constructor(
    message: string,
    public status = 422,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

function normalizarNombre(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parsearIds(value: unknown, entidad: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConciliacionError(`Seleccioná al menos un ${entidad}.`, 400);
  }
  const ids = value.map(String);
  if (ids.some((id) => !/^[1-9]\d*$/.test(id) || id.length > 19 || BigInt(id) > 9223372036854775807n) || new Set(ids).size !== ids.length) {
    throw new ConciliacionError(`La selección contiene IDs de ${entidad} inválidos o repetidos.`, 400);
  }
  return ids;
}

async function validarSeleccion(
  client: PoolClient,
  movimientoIds: string[],
  remitoIds: string[]
) {
  const movimientoRes = await client.query(
    `SELECT mb.id::text AS id, mb.cuenta_id::text AS cuenta_id,
            mb.importe_centavos::text AS importe_centavos,
            mb.estado, mb.ordenante, mb.ordenante_cuit,
            cr.sucursal_id
     FROM movimiento_bancario mb
     JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id
     WHERE mb.id = ANY($1::bigint[])
     ORDER BY mb.id
     FOR UPDATE OF mb`,
    [movimientoIds]
  );
  if (movimientoRes.rowCount !== movimientoIds.length) {
    const encontrados = new Set(movimientoRes.rows.map((row) => String(row.id)));
    throw new ConciliacionError('Hay movimientos bancarios inexistentes o no elegibles.', 422, {
      movimientosNoElegibles: movimientoIds.filter((id) => !encontrados.has(id)),
    });
  }
  const movimientosPorId = new Map(movimientoRes.rows.map((item) => [String(item.id), item]));
  const movimientos = movimientoIds.map((id) => movimientosPorId.get(id)!);
  const noPendientes = movimientos.filter((item) => item.estado !== 'sin_imputar');
  if (noPendientes.length) {
    throw new ConciliacionError('Hay movimientos que ya no están pendientes de conciliación.', 409, {
      movimientosNoElegibles: noPendientes.map((item) => item.id),
    });
  }
  if (new Set(movimientos.map((item) => String(item.cuenta_id))).size !== 1) {
    throw new ConciliacionError('Seleccioná movimientos de una misma cuenta bancaria.');
  }

  const remitosBloqueados = await client.query(
    'SELECT id FROM remito WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
    [remitoIds]
  );
  if (remitosBloqueados.rowCount !== remitoIds.length) {
    const encontrados = new Set(remitosBloqueados.rows.map((row) => String(row.id)));
    throw new ConciliacionError('Hay remitos inexistentes o no elegibles.', 422, {
      remitosNoElegibles: remitoIds.filter((id) => !encontrados.has(id)),
    });
  }

  const remitosRes = await client.query(
    `SELECT r.id, r.numero, r.estado, r.sucursal_id,
            c.id AS comercio_id, c.razon_social, c.cuit,
            rs.saldo_centavos::text AS saldo_centavos
     FROM remito r
     JOIN comercio c ON c.id = r.comercio_id
     JOIN remito_saldo rs ON rs.remito_id = r.id
     WHERE r.id = ANY($1::bigint[])
     ORDER BY r.id`,
    [remitoIds]
  );
  const remitosPorId = new Map(remitosRes.rows.map((item) => [String(item.id), item]));
  const remitos = remitoIds.map((id) => remitosPorId.get(id)!);
  const noElegibles = remitos.filter(
    (remito) => remito.estado !== 'entregado' || BigInt(remito.saldo_centavos) <= 0n
  );
  if (noElegibles.length) {
    throw new ConciliacionError('La operación incluye remitos no entregados, devueltos, anulados o ya saldados.', 422, {
      remitosNoElegibles: noElegibles.map((remito) => ({ id: remito.id, numero: remito.numero })),
    });
  }

  const comercioId = String(remitos[0].comercio_id);
  const distintosComercios = remitos.filter((remito) => String(remito.comercio_id) !== comercioId);
  if (distintosComercios.length) {
    throw new ConciliacionError('Todos los remitos deben pertenecer al mismo comercio.', 422, {
      remitosNoElegibles: distintosComercios.map((remito) => ({ id: remito.id, numero: remito.numero })),
    });
  }

  const otraSucursal = remitos.filter((remito) => String(remito.sucursal_id) !== String(movimientos[0].sucursal_id));
  if (otraSucursal.length) {
    throw new ConciliacionError('El movimiento y los remitos deben corresponder a la misma sucursal/cuenta.', 422, {
      remitosNoElegibles: otraSucursal.map((remito) => ({ id: remito.id, numero: remito.numero })),
    });
  }

  const comercio = remitos[0];
  const otrosOrdenantes = movimientos.filter((movimiento) => {
    const ordenanteCuit = (movimiento.ordenante_cuit || '').trim();
    const comercioCuit = (comercio.cuit || '').trim();
    return ordenanteCuit && comercioCuit
      ? ordenanteCuit !== comercioCuit
      : normalizarNombre(movimiento.ordenante) !== normalizarNombre(comercio.razon_social);
  });
  if (otrosOrdenantes.length) {
    throw new ConciliacionError('Todos los movimientos deben corresponder al comercio de los remitos.', 422, {
      movimientosNoElegibles: otrosOrdenantes.map((item) => item.id),
    });
  }

  const saldos = new Map(remitos.map((remito) => [String(remito.id), BigInt(remito.saldo_centavos)]));
  const imputaciones: Array<{ movimientoId: string; remitoId: string; importeCentavos: bigint }> = [];
  for (const movimiento of movimientos) {
    let restante = BigInt(movimiento.importe_centavos);
    for (const remito of remitos) {
      if (restante === 0n) break;
      const remitoId = String(remito.id);
      const saldo = saldos.get(remitoId)!;
      if (saldo === 0n) continue;
      const importeCentavos = restante < saldo ? restante : saldo;
      imputaciones.push({ movimientoId: String(movimiento.id), remitoId, importeCentavos });
      saldos.set(remitoId, saldo - importeCentavos);
      restante -= importeCentavos;
    }
  }
  const importeMovimiento = movimientos.reduce<bigint>((total, item) => total + BigInt(item.importe_centavos), 0n);
  const importeSeleccionado = remitos.reduce<bigint>((total, item) => total + BigInt(item.saldo_centavos), 0n);

  return {
    movimientos,
    remitos,
    imputaciones,
    importeMovimiento,
    importeSeleccionado,
    diferencia: importeMovimiento - importeSeleccionado,
  };
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

export const conciliacionService = {
  async getMovimientosPendientes(fecha?: string) {
    const params: unknown[] = [];
    let fechaFiltro = '';
    if (fecha) {
      params.push(fecha);
      fechaFiltro = "AND (mb.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = $1::date";
    }
    const result = await db.query(
      `SELECT mb.id::text AS id, mb.fecha_hora, mb.ordenante,
              mb.importe_centavos::text AS importe_centavos,
              mb.cuenta_id::text AS cuenta_id, cr.alias AS cuenta
       FROM movimiento_bancario mb
       JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id
       WHERE mb.estado = 'sin_imputar'
         ${fechaFiltro}
       ORDER BY mb.fecha_hora DESC, mb.id DESC`,
      params
    );
    return result.rows;
  },

  async getRemitosPendientes() {
    const result = await db.query(
      `SELECT r.id::text AS id, r.numero, r.estado,
              COALESCE(r.entregado_en, v.registrada_en)::text AS fecha_entrega,
              c.id::text AS comercio_id, c.razon_social,
              m.nombre AS marca, rs.importe_centavos::text AS importe_centavos,
              rs.saldo_centavos::text AS saldo_centavos,
              s.id::text AS sucursal_id, s.nombre AS sucursal
       FROM remito r
       JOIN comercio c ON c.id = r.comercio_id
       JOIN marca m ON m.id = r.marca_id
       JOIN sucursal s ON s.id = r.sucursal_id
       LEFT JOIN visita v ON v.id = r.visita_id
       JOIN remito_saldo rs ON rs.remito_id = r.id
       WHERE rs.saldo_centavos > 0
         AND r.estado = 'entregado'
       ORDER BY r.entregado_en DESC NULLS LAST, c.razon_social, r.numero`
    );
    return result.rows;
  },

  async getDiscrepanciasPendientes() {
    const result = await db.query(
      `SELECT dc.id::text AS id, dc.movimiento_id::text AS movimiento_id,
              dc.movimiento_ids::text AS movimiento_ids,
              mb.fecha_hora, mb.ordenante, dc.importe_movimiento::text AS importe_movimiento,
              dc.importe_seleccionado::text AS importe_seleccionado,
              dc.diferencia_centavos::text AS diferencia_centavos, dc.nota,
              dc.remito_ids::text AS remito_ids
       FROM discrepancia_conciliacion dc
       JOIN movimiento_bancario mb ON mb.id = dc.movimiento_id
       WHERE dc.estado = 'pendiente'
       ORDER BY dc.creada_en DESC`
    );
    return result.rows;
  },

  async conciliar(movimientoIdsValue: unknown, remitoIdsValue: unknown, usuarioId: number) {
    const movimientoIds = parsearIds(movimientoIdsValue, 'movimiento');
    const remitoIds = parsearIds(remitoIdsValue, 'remito');
    return enTransaccion(async (client) => {
      const result = await validarSeleccion(client, movimientoIds, remitoIds);
      if (result.diferencia !== 0n) {
        throw new ConciliacionError('El total de movimientos debe coincidir exactamente con los saldos seleccionados.', 422, {
          importeMovimiento: result.importeMovimiento.toString(),
          importeSeleccionado: result.importeSeleccionado.toString(),
          diferenciaCentavos: result.diferencia.toString(),
        });
      }
      const discrepanciasVigentes = await client.query(
        `SELECT movimiento_ids::text AS movimiento_ids FROM discrepancia_conciliacion
         WHERE estado = 'pendiente' AND movimiento_ids && $1::bigint[] FOR UPDATE`,
        [movimientoIds]
      );
      const seleccionIds = new Set(movimientoIds);
      const grupoIncompleto = discrepanciasVigentes.rows.some((row) =>
        row.movimiento_ids.replace(/[{}]/g, '').split(',').some((id: string) => !seleccionIds.has(id))
      );
      if (grupoIncompleto) {
        throw new ConciliacionError('Seleccioná todos los movimientos de la discrepancia para resolverla.', 409);
      }

      const imputaciones: Array<{ id: string; movimientoId: string; remitoId: string; importeCentavos: string }> = [];
      for (const asignacion of result.imputaciones) {
        const inserted = await client.query(
          `INSERT INTO imputacion (movimiento_bancario_id, remito_id, importe_centavos, imputado_por)
           VALUES ($1, $2, $3, $4)
           RETURNING id::text AS id`,
          [asignacion.movimientoId, asignacion.remitoId, asignacion.importeCentavos.toString(), usuarioId]
        );
        const imputacion = {
          id: inserted.rows[0].id,
          movimientoId: asignacion.movimientoId,
          remitoId: asignacion.remitoId,
          importeCentavos: asignacion.importeCentavos.toString(),
        };
        imputaciones.push(imputacion);
        await client.query(
          `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
           VALUES ('imputacion', $1, 'alta', $2, $3::jsonb, 'Imputación bancaria E5-04')`,
          [imputacion.id, usuarioId, JSON.stringify(imputacion)]
        );
      }

      await client.query(
        `UPDATE movimiento_bancario SET estado = 'imputado' WHERE id = ANY($1::bigint[])`,
        [movimientoIds]
      );
      await client.query(
        `UPDATE discrepancia_conciliacion SET estado = 'resuelta'
         WHERE estado = 'pendiente' AND movimiento_ids && $1::bigint[]`,
        [movimientoIds]
      );
      for (const movimientoId of movimientoIds) {
        await client.query(
          `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
           VALUES ('movimiento_bancario', $1, 'conciliacion', $2, $3::jsonb, 'Movimiento conciliado con remitos E5-04')`,
          [movimientoId, usuarioId, JSON.stringify({ estado: 'imputado', imputaciones: imputaciones.filter((item) => item.movimientoId === movimientoId) })]
        );
      }

      return { movimientoIds, estado: 'imputado', imputaciones };
    });
  },

  async derivarDiscrepancia(movimientoIdsValue: unknown, remitoIdsValue: unknown, nota: unknown, usuarioId: number) {
    const movimientoIds = parsearIds(movimientoIdsValue, 'movimiento');
    const remitoIds = parsearIds(remitoIdsValue, 'remito');
    if (typeof nota !== 'string' || !nota.trim()) {
      throw new ConciliacionError('Escribí una nota para derivar la discrepancia.', 400);
    }

    return enTransaccion(async (client) => {
      const result = await validarSeleccion(client, movimientoIds, remitoIds);
      if (result.diferencia === 0n) {
        throw new ConciliacionError('Los importes coinciden; corresponde conciliar los movimientos.', 422);
      }
      const existing = await client.query(
        `SELECT id::text AS id FROM discrepancia_conciliacion
         WHERE estado = 'pendiente' AND movimiento_ids && $1::bigint[] FOR UPDATE`,
        [movimientoIds]
      );
      if (existing.rows.length) {
        throw new ConciliacionError('Uno o más movimientos ya están derivados a una discrepancia pendiente.', 409, {
          movimientosNoElegibles: movimientoIds,
        });
      }
      const values = [movimientoIds[0], movimientoIds, remitoIds, result.importeMovimiento.toString(), result.importeSeleccionado.toString(),
        result.diferencia.toString(), nota.trim(), usuarioId];
      const discrepancia = await client.query(
        `INSERT INTO discrepancia_conciliacion
           (movimiento_id, movimiento_ids, remito_ids, importe_movimiento, importe_seleccionado,
            diferencia_centavos, nota, creada_por)
         VALUES ($1, $2::bigint[], $3::bigint[], $4, $5, $6, $7, $8)
         RETURNING id::text AS id`, values
      );
      const discrepanciaId = discrepancia.rows[0].id;
      await client.query(
        `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
         VALUES ('discrepancia_conciliacion', $1, $2, $3, $4::jsonb, $5)`,
        [discrepanciaId, 'alta', usuarioId,
          JSON.stringify({
            movimientoIds,
            remitoIds,
            diferenciaCentavos: result.diferencia.toString(),
          }), nota.trim()]
      );
      return { id: discrepanciaId, movimientoIds, diferenciaCentavos: result.diferencia.toString() };
    });
  },
};
