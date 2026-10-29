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

const VENTANA_SUGERENCIAS_DIAS = 7;
const HORAS_PARA_HUERFANO = Math.max(1, Number(process.env.ORPHAN_MOVEMENT_HOURS || 48));

function diasEntre(a: Date | string | null, b: Date | string | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const fechaA = new Date(a).getTime();
  const fechaB = new Date(b).getTime();
  return Number.isFinite(fechaA) && Number.isFinite(fechaB)
    ? Math.abs(fechaA - fechaB) / 86_400_000
    : Number.POSITIVE_INFINITY;
}

function mismoCliente(movimiento: any, remito: any): boolean {
  const cuitMovimiento = (movimiento.ordenante_cuit || '').replace(/\D/g, '');
  const cuitComercio = (remito.cuit || '').replace(/\D/g, '');
  if (cuitMovimiento && cuitComercio) return cuitMovimiento === cuitComercio;
  const ordenante = normalizarNombre(movimiento.ordenante);
  return !!ordenante && ordenante === normalizarNombre(remito.razon_social);
}

function sugerir(movimiento: any, remito: any) {
  const dias = diasEntre(movimiento.fecha_hora, remito.fecha_entrega);
  if (dias > VENTANA_SUGERENCIAS_DIAS || String(movimiento.sucursal_id) !== String(remito.sucursal_id)) return null;
  const importe = BigInt(movimiento.importe_disponible_centavos);
  const saldo = BigInt(remito.saldo_centavos);
  const diferencia = importe >= saldo ? importe - saldo : saldo - importe;
  const clienteCoincide = mismoCliente(movimiento, remito);
  const importeCoincide = diferencia === 0n;
  const importeAproximado = !importeCoincide && diferencia * 10n <= saldo;

  if (clienteCoincide && importeCoincide) {
    return { tipo: 'exacta', motivo: 'Coinciden cliente, importe y fecha cercana.', diferencia_centavos: '0' };
  }
  if ((importeCoincide && !clienteCoincide) || (clienteCoincide && importeAproximado)) {
    return {
      tipo: 'parcial',
      motivo: importeCoincide ? 'Coincide el importe, pero verificá el cliente.' : 'Coincide el cliente, pero hay una diferencia de importe.',
      diferencia_centavos: (importe - saldo).toString(),
    };
  }
  return null;
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
            (mb.importe_centavos - COALESCE(i.imputado_centavos, 0))::text AS importe_disponible_centavos,
            mb.estado, mb.ordenante, mb.ordenante_cuit, mb.fecha_hora,
            cr.sucursal_id
     FROM movimiento_bancario mb
     JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id
     LEFT JOIN (
       SELECT movimiento_bancario_id, SUM(importe_centavos) AS imputado_centavos
       FROM imputacion WHERE movimiento_bancario_id IS NOT NULL GROUP BY movimiento_bancario_id
     ) i ON i.movimiento_bancario_id = mb.id
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
  const noPendientes = movimientos.filter((item) => !['sin_imputar', 'parcial'].includes(item.estado) || BigInt(item.importe_disponible_centavos) <= 0n);
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
            rs.saldo_centavos::text AS saldo_centavos,
            COALESCE(r.entregado_en, v.registrada_en) AS fecha_entrega
     FROM remito r
     JOIN comercio c ON c.id = r.comercio_id
     LEFT JOIN visita v ON v.id = r.visita_id
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
    return !mismoCliente(movimiento, comercio);
  });
  if (otrosOrdenantes.length) {
    throw new ConciliacionError('Todos los movimientos deben corresponder al comercio de los remitos.', 422, {
      movimientosNoElegibles: otrosOrdenantes.map((item) => item.id),
    });
  }

  const saldos = new Map(remitos.map((remito) => [String(remito.id), BigInt(remito.saldo_centavos)]));
  const imputaciones: Array<{ movimientoId: string; remitoId: string; importeCentavos: bigint }> = [];
  for (const movimiento of movimientos) {
    let restante = BigInt(movimiento.importe_disponible_centavos);
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
  const importeMovimiento = movimientos.reduce<bigint>((total, item) => total + BigInt(item.importe_disponible_centavos), 0n);
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
              (mb.importe_centavos - COALESCE(i.imputado_centavos, 0))::text AS importe_centavos,
              mb.cuenta_id::text AS cuenta_id, cr.alias AS cuenta
       FROM movimiento_bancario mb
       JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id
       LEFT JOIN (
         SELECT movimiento_bancario_id, SUM(importe_centavos) AS imputado_centavos
         FROM imputacion WHERE movimiento_bancario_id IS NOT NULL GROUP BY movimiento_bancario_id
       ) i ON i.movimiento_bancario_id = mb.id
       WHERE mb.estado IN ('sin_imputar', 'parcial')
         ${fechaFiltro}
       ORDER BY mb.fecha_hora DESC, mb.id DESC`,
      params
    );
    return result.rows;
  },

  async getSugerencias() {
    const [movimientosRes, remitosRes] = await Promise.all([
      db.query(
        `SELECT mb.id::text AS movimiento_id, mb.fecha_hora, mb.ordenante, mb.ordenante_cuit,
                (mb.importe_centavos - COALESCE(i.imputado_centavos, 0))::text AS importe_disponible_centavos,
                mb.cuenta_id::text AS cuenta_id, cr.alias AS cuenta, cr.sucursal_id::text AS sucursal_id
         FROM movimiento_bancario mb
         JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id AND cr.activa = true
         LEFT JOIN (
           SELECT movimiento_bancario_id, SUM(importe_centavos) AS imputado_centavos
           FROM imputacion WHERE movimiento_bancario_id IS NOT NULL GROUP BY movimiento_bancario_id
         ) i ON i.movimiento_bancario_id = mb.id
         WHERE mb.estado IN ('sin_imputar', 'parcial')
           AND mb.importe_centavos > COALESCE(i.imputado_centavos, 0)
           AND NOT EXISTS (
             SELECT 1 FROM discrepancia_conciliacion dc
             WHERE dc.estado IN ('pendiente','escalada') AND mb.id = ANY(dc.movimiento_ids)
           )
         ORDER BY mb.fecha_hora DESC, mb.id DESC`
      ),
      db.query(
        `SELECT r.id::text AS remito_id, r.numero, r.sucursal_id::text AS sucursal_id,
                c.razon_social, c.cuit, rs.saldo_centavos::text AS saldo_centavos,
                COALESCE(r.entregado_en, v.registrada_en) AS fecha_entrega
         FROM remito r
         JOIN comercio c ON c.id = r.comercio_id
         JOIN remito_saldo rs ON rs.remito_id = r.id
         LEFT JOIN visita v ON v.id = r.visita_id
         WHERE r.estado = 'entregado' AND rs.saldo_centavos > 0
         ORDER BY r.entregado_en DESC NULLS LAST, r.id DESC`
      ),
    ]);

    const remitosPorSucursal = new Map<string, any[]>();
    for (const remito of remitosRes.rows) {
      if (!remito.fecha_entrega) continue;
      const sucursal = String(remito.sucursal_id);
      const grupo = remitosPorSucursal.get(sucursal) || [];
      grupo.push(remito);
      remitosPorSucursal.set(sucursal, grupo);
    }
    for (const grupo of remitosPorSucursal.values()) {
      grupo.sort((a, b) => new Date(a.fecha_entrega).getTime() - new Date(b.fecha_entrega).getTime());
    }

    const sugerencias: any[] = [];
    for (const movimiento of movimientosRes.rows) {
      const fechaMovimiento = new Date(movimiento.fecha_hora).getTime();
      const remitos = remitosPorSucursal.get(String(movimiento.sucursal_id)) || [];
      for (const remito of remitos) {
        const fechaRemito = new Date(remito.fecha_entrega).getTime();
        if (fechaRemito < fechaMovimiento - VENTANA_SUGERENCIAS_DIAS * 86_400_000) continue;
        if (fechaRemito > fechaMovimiento + VENTANA_SUGERENCIAS_DIAS * 86_400_000) break;
        const match = sugerir(movimiento, remito);
        if (match) sugerencias.push({ ...match, ...movimiento, ...remito });
      }
    }
    return sugerencias.sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'exacta' ? -1 : 1;
      const byDate = diasEntre(a.fecha_hora, a.fecha_entrega) - diasEntre(b.fecha_hora, b.fecha_entrega);
      return byDate || a.razon_social.localeCompare(b.razon_social) || a.numero.localeCompare(b.numero);
    });
  },

  async getMovimientosHuerfanos(filters: { sucursalId?: string; cuentaId?: string; desde?: string; hasta?: string } = {}) {
    const sugerencias = await this.getSugerencias();
    const movimientosConSugerencias = new Set(sugerencias.map((item) => item.movimiento_id));
    const cutoff = new Date(Date.now() - HORAS_PARA_HUERFANO * 3_600_000);
    const result = await db.query(
      `SELECT mb.id::text AS id, mb.fecha_hora, mb.ordenante,
              (mb.importe_centavos - COALESCE(i.imputado_centavos, 0))::text AS importe_centavos,
              mb.cuenta_id::text AS cuenta_id, cr.alias AS cuenta,
              cr.sucursal_id::text AS sucursal_id, s.nombre AS sucursal
       FROM movimiento_bancario mb
       JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id AND cr.activa = true
       JOIN sucursal s ON s.id = cr.sucursal_id
       LEFT JOIN (
         SELECT movimiento_bancario_id, SUM(importe_centavos) AS imputado_centavos
         FROM imputacion WHERE movimiento_bancario_id IS NOT NULL GROUP BY movimiento_bancario_id
       ) i ON i.movimiento_bancario_id = mb.id
       WHERE mb.estado IN ('sin_imputar', 'parcial')
         AND mb.importe_centavos > COALESCE(i.imputado_centavos, 0)
         AND mb.fecha_hora <= $1
         AND NOT EXISTS (
           SELECT 1 FROM discrepancia_conciliacion dc
           WHERE dc.estado IN ('pendiente','escalada') AND mb.id = ANY(dc.movimiento_ids)
         )
       ORDER BY mb.fecha_hora DESC, mb.id DESC`,
      [cutoff]
    );
    const movimientos = result.rows.filter((item) => {
      if (movimientosConSugerencias.has(item.id)) return false;
      const fecha = new Date(item.fecha_hora).toISOString().slice(0, 10);
      return (!filters.sucursalId || item.sucursal_id === filters.sucursalId) &&
        (!filters.cuentaId || item.cuenta_id === filters.cuentaId) &&
        (!filters.desde || fecha >= filters.desde) && (!filters.hasta || fecha <= filters.hasta);
    }).map((item) => ({ ...item, antiguedad_horas: Math.floor((Date.now() - new Date(item.fecha_hora).getTime()) / 3_600_000) }));
    return { horasUmbral: HORAS_PARA_HUERFANO, movimientos };
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
              dc.diferencia_centavos::text AS diferencia_centavos, dc.nota, dc.motivo_codigo,
              dc.remito_ids::text AS remito_ids, dc.estado, dc.creada_por::text AS creada_por,
              (SELECT nombre_archivo FROM discrepancia_comprobante WHERE discrepancia_id = dc.id) AS comprobante_nombre
       FROM discrepancia_conciliacion dc
       JOIN movimiento_bancario mb ON mb.id = dc.movimiento_id
       WHERE dc.estado IN ('pendiente','escalada')
       ORDER BY dc.creada_en DESC`
    );
    return result.rows;
  },

  async conciliar(movimientoIdsValue: unknown, remitoIdsValue: unknown, usuarioId: number, aceptarSugerencia = false) {
    const movimientoIds = parsearIds(movimientoIdsValue, 'movimiento');
    const remitoIds = parsearIds(remitoIdsValue, 'remito');
    return enTransaccion(async (client) => {
      const result = await validarSeleccion(client, movimientoIds, remitoIds);
      if (aceptarSugerencia && (movimientoIds.length !== 1 || remitoIds.length !== 1 || result.diferencia !== 0n ||
          diasEntre(result.movimientos[0].fecha_hora, result.remitos[0].fecha_entrega) > VENTANA_SUGERENCIAS_DIAS)) {
        throw new ConciliacionError('La sugerencia dejó de ser exacta o ya no está vigente; revisá la conciliación manual.', 409);
      }
      const discrepanciasVigentes = await client.query(
        `SELECT id FROM discrepancia_conciliacion
         WHERE estado IN ('pendiente','escalada')
           AND (movimiento_ids && $1::bigint[] OR remito_ids && $2::bigint[]) FOR UPDATE`,
        [movimientoIds, remitoIds]
      );
      if (discrepanciasVigentes.rows.length) {
        throw new ConciliacionError('El movimiento o remito pertenece a una discrepancia pendiente de revisión.', 409);
      }
      if (result.diferencia > 0n) {
        throw new ConciliacionError('El total de movimientos supera los saldos seleccionados.', 422, {
          importeMovimiento: result.importeMovimiento.toString(),
          importeSeleccionado: result.importeSeleccionado.toString(),
          diferenciaCentavos: result.diferencia.toString(),
        });
      }
      if (result.diferencia < 0n) {
        throw new ConciliacionError('El total de movimientos no coincide con el saldo de los remitos. Registrá una justificación para continuar.', 422, {
          importeMovimiento: result.importeMovimiento.toString(),
          importeSeleccionado: result.importeSeleccionado.toString(),
          diferenciaCentavos: result.diferencia.toString(),
        });
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

  async registrarDiscrepancia(movimientoIdsValue: unknown, remitoIdsValue: unknown, nota: unknown, motivo: unknown, archivo: { originalname: string; mimetype: string; size: number; buffer: Buffer } | null, usuarioId: number) {
    const movimientoIds = parsearIds(movimientoIdsValue, 'movimiento');
    const remitoIds = parsearIds(remitoIdsValue, 'remito');
    const motivos = ['retenciones_impositivas', 'descuento_comercial', 'diferencia_cambio', 'comision_bancaria', 'otro'];
    if (typeof nota !== 'string' || !nota.trim() || nota.trim().length > 500 || typeof motivo !== 'string' || !motivos.includes(motivo) || !archivo) {
      throw new ConciliacionError('Indicá el motivo, agregá una explicación y adjuntá el comprobante de respaldo.', 400);
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(archivo.mimetype) || archivo.size < 1 || archivo.size > 5 * 1024 * 1024) {
      throw new ConciliacionError('El comprobante debe ser PDF, JPG o PNG y no superar 5 MB.', 400);
    }
    const firma = archivo.buffer.subarray(0, 8);
    const formatoValido = archivo.mimetype === 'application/pdf' ? firma.subarray(0, 4).toString() === '%PDF' :
      archivo.mimetype === 'image/png' ? firma.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
      firma[0] === 0xff && firma[1] === 0xd8 && firma[2] === 0xff;
    if (!formatoValido) throw new ConciliacionError('El contenido del comprobante no coincide con su formato.', 400);

    return enTransaccion(async (client) => {
      const result = await validarSeleccion(client, movimientoIds, remitoIds);
      if (result.diferencia === 0n) {
        throw new ConciliacionError('Los importes coinciden; usá la conciliación directa.', 422);
      }
      const existing = await client.query(
        `SELECT id::text AS id FROM discrepancia_conciliacion
         WHERE estado IN ('pendiente','escalada')
           AND (movimiento_ids && $1::bigint[] OR remito_ids && $2::bigint[]) FOR UPDATE`,
        [movimientoIds, remitoIds]
      );
      if (existing.rows.length) {
        throw new ConciliacionError('Un movimiento o remito ya pertenece a una discrepancia pendiente.', 409, {
          movimientosNoElegibles: movimientoIds,
        });
      }
      const values = [movimientoIds[0], movimientoIds, remitoIds, result.importeMovimiento.toString(), result.importeSeleccionado.toString(),
        result.diferencia.toString(), nota.trim(), motivo, usuarioId];
      const discrepancia = await client.query(
        `INSERT INTO discrepancia_conciliacion
           (movimiento_id, movimiento_ids, remito_ids, importe_movimiento, importe_seleccionado,
            diferencia_centavos, nota, motivo_codigo, creada_por)
         VALUES ($1, $2::bigint[], $3::bigint[], $4, $5, $6, $7, $8, $9)
         RETURNING id::text AS id`, values
      );
      const discrepanciaId = discrepancia.rows[0].id;
      await client.query(
        `INSERT INTO discrepancia_comprobante (discrepancia_id, nombre_archivo, tipo_mime, contenido, tamano_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [discrepanciaId, archivo.originalname.replace(/[\\/\r\n\"]/g, '_').slice(0, 255), archivo.mimetype, archivo.buffer, archivo.size]
      );
      const limiteCentavos = BigInt(Math.max(0, Math.floor(Number(process.env.CONCILIATION_TOLERANCE_CENTS || 0))));
      const toleranciaPuntosBase = BigInt(Math.max(0, Math.floor(Number(process.env.CONCILIATION_TOLERANCE_PERCENT || 0) * 100)));
      const magnitudDiferencia = result.diferencia < 0n ? -result.diferencia : result.diferencia;
      const dentroTolerancia = magnitudDiferencia <= limiteCentavos || magnitudDiferencia * 10_000n <= result.importeSeleccionado * toleranciaPuntosBase;
      const estado = dentroTolerancia ? 'aprobada' : 'pendiente';
      if (estado === 'aprobada') {
        await aplicarDiscrepancia(client, discrepanciaId, result, usuarioId);
      } else {
        await client.query(
          `INSERT INTO discrepancia_notificacion (discrepancia_id, usuario_id, mensaje)
           SELECT $1, id, 'Hay una discrepancia pendiente de aprobación.' FROM usuario
           WHERE activo = true AND rol = 'Gerente'`, [discrepanciaId]
        );
      }
      await client.query('UPDATE discrepancia_conciliacion SET estado = $1 WHERE id = $2', [estado, discrepanciaId]);
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
      return { id: discrepanciaId, movimientoIds, diferenciaCentavos: result.diferencia.toString(), estado };
    });
  },

  async resolverDiscrepancia(idValue: unknown, usuarioId: number, aprobar: boolean, observacion: unknown) {
    const id = String(idValue || '');
    if (!/^[1-9]\d*$/.test(id)) throw new ConciliacionError('Identificador de discrepancia inválido.', 400);
    if (typeof observacion !== 'string' || !observacion.trim() || observacion.trim().length > 500) throw new ConciliacionError('La observación es obligatoria y no puede superar 500 caracteres.', 400);
    return enTransaccion(async (client) => {
      const caso = await client.query('SELECT * FROM discrepancia_conciliacion WHERE id = $1 FOR UPDATE', [id]);
      if (!caso.rows.length) throw new ConciliacionError('No se encontró la discrepancia.', 404);
      const dc = caso.rows[0];
      if (!['pendiente','escalada'].includes(dc.estado)) throw new ConciliacionError('El caso ya fue resuelto por otro usuario.', 409);
      if (aprobar && String(dc.creada_por) === String(usuarioId)) throw new ConciliacionError('Otro usuario debe aprobar la discrepancia.', 403);
      if (aprobar) {
        const usuario = await client.query('SELECT limite_autorizacion_centavos FROM usuario WHERE id = $1', [usuarioId]);
        const magnitud = BigInt(dc.diferencia_centavos) < 0n ? -BigInt(dc.diferencia_centavos) : BigInt(dc.diferencia_centavos);
        if (!usuario.rows.length || BigInt(usuario.rows[0].limite_autorizacion_centavos || 0) < magnitud) {
          await client.query("UPDATE discrepancia_conciliacion SET estado = 'escalada' WHERE id = $1", [id]);
          await client.query(
            `INSERT INTO discrepancia_notificacion (discrepancia_id, usuario_id, mensaje)
             SELECT $1, id, 'Una discrepancia requiere un límite de autorización mayor.' FROM usuario
             WHERE activo = true AND rol = 'Gerente'`, [id]
          );
          return { id, estado: 'escalada', mensaje: 'El límite de autorización no alcanza; se escaló a Gerencia.' };
        }
      }
      const movimientoIds = (dc.movimiento_ids || [dc.movimiento_id]).map(String);
      const remitoIds = dc.remito_ids.map(String);
      const result = await validarSeleccion(client, movimientoIds, remitoIds);
      if (result.importeMovimiento.toString() !== String(dc.importe_movimiento) ||
          result.importeSeleccionado.toString() !== String(dc.importe_seleccionado) ||
          result.diferencia.toString() !== String(dc.diferencia_centavos)) {
        throw new ConciliacionError('Los saldos cambiaron desde que se registró el caso; revisalo nuevamente.', 409);
      }
      if (aprobar) await aplicarDiscrepancia(client, id, result, usuarioId);
      const estado = aprobar ? 'aprobada' : 'rechazada';
      await client.query(
        `UPDATE discrepancia_conciliacion SET estado = $1, resuelta_por = $2, resuelta_en = now(), observacion_resolucion = $3 WHERE id = $4`,
        [estado, usuarioId, observacion.trim(), id]
      );
      await client.query(
        `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
         VALUES ('discrepancia_conciliacion', $1, $2, $3, $4::jsonb, $5)`,
        [id, estado, usuarioId, JSON.stringify({ estado, movimientoIds, remitoIds }), observacion.trim()]
      );
      if (!aprobar) await client.query(
        `INSERT INTO discrepancia_notificacion (discrepancia_id, usuario_id, mensaje)
         VALUES ($1, $2, $3)`, [id, dc.creada_por, `La discrepancia fue rechazada: ${observacion.trim()}`]
      );
      return { id, estado };
    });
  },
};

async function aplicarDiscrepancia(client: PoolClient, id: string, result: Awaited<ReturnType<typeof validarSeleccion>>, usuarioId: number) {
  for (const item of result.imputaciones) {
    await client.query(
      `INSERT INTO imputacion (movimiento_bancario_id, remito_id, importe_centavos, imputado_por)
       VALUES ($1, $2, $3, $4)`, [item.movimientoId, item.remitoId, item.importeCentavos.toString(), usuarioId]
    );
  }
  if (result.diferencia < 0n) {
    let restante = -result.diferencia;
    const saldos = new Map(result.remitos.map((remito) => [String(remito.id), BigInt(remito.saldo_centavos)]));
    for (const asignacion of result.imputaciones) {
      const id = String(asignacion.remitoId);
      saldos.set(id, saldos.get(id)! - asignacion.importeCentavos);
    }
    for (const remito of result.remitos) {
      if (!restante) break;
      const saldo = saldos.get(String(remito.id))!;
      const ajuste = saldo < restante ? saldo : restante;
      await client.query(
        `INSERT INTO discrepancia_ajuste (discrepancia_id, remito_id, tipo, importe_centavos) VALUES ($1, $2, 'reduccion_saldo', $3)`,
        [id, remito.id, ajuste.toString()]
      );
      restante -= ajuste;
    }
  } else {
    await client.query(
      `INSERT INTO discrepancia_ajuste (discrepancia_id, comercio_id, tipo, importe_centavos)
       VALUES ($1, $2, 'saldo_favor', $3)`, [id, result.remitos[0].comercio_id, result.diferencia.toString()]
    );
  }
  await client.query("UPDATE movimiento_bancario SET estado = 'imputado' WHERE id = ANY($1::bigint[])", [result.movimientos.map((item) => String(item.id))]);
}
