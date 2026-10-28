import { PoolClient } from 'pg';
import { db } from '../db.js';


export const MOTIVOS_TIPIFICADOS = [
  'Retenciones impositivas',
  'Descuentos comerciales',
  'Diferencias de cambio',
  'Comisiones bancarias',
  'Otros conceptos autorizados',
] as const;

export type MotivoTipificado = (typeof MOTIVOS_TIPIFICADOS)[number];

export interface JustificacionDiferenciaDto {
  motivoTipificado: MotivoTipificado;
  comprobanteNombre: string;
  nota?: string;
}

export const TOLERANCIA_NOMINAL_MAX_CENTAVOS = BigInt(process.env.TOLERANCIA_NOMINAL_MAX_CENTAVOS || 500000); // $5.000 (500000 centavos)
export const TOLERANCIA_PORCENTUAL_MAX = BigInt(process.env.TOLERANCIA_PORCENTUAL_MAX || 5); // 5%

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
            (CASE WHEN i.imputado_centavos IS NULL THEN mb.importe_centavos ELSE mb.importe_centavos - i.imputado_centavos END)::text AS importe_disponible_centavos,
            mb.estado, mb.ordenante, mb.ordenante_cuit, mb.fecha_hora,
            cr.sucursal_id
     FROM movimiento_bancario mb
     JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id
     LEFT JOIN (
       SELECT movimiento_bancario_id, SUM(importe_centavos) AS imputado_centavos
       FROM imputacion WHERE movimiento_bancario_id IS NOT NULL GROUP BY movimiento_bancario_id
     ) i ON i.movimiento_bancario_id = mb.id
     WHERE mb.id::text = ANY($1)
     ORDER BY mb.id`,
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
    `SELECT id FROM remito WHERE id::text = ANY($1) ORDER BY id ${db.isMemory() ? '' : 'FOR UPDATE'}`,
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
     WHERE r.id::text = ANY($1)
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
    saldos,
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
      fechaFiltro = db.isMemory()
        ? "AND mb.fecha_hora::date = $1::date"
        : "AND (mb.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = $1::date";
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

  async getDiscrepanciaMovimientoIds(): Promise<Set<string>> {
    const res = await db.query(
      "SELECT movimiento_ids::text AS movimiento_ids FROM discrepancia_conciliacion WHERE estado = 'pendiente'"
    );
    const ids = new Set<string>();
    for (const row of res.rows) {
      const items = String(row.movimiento_ids || '').replace(/[{}]/g, '').split(',').filter(Boolean);
      for (const item of items) ids.add(item);
    }
    return ids;
  },

  async getSugerencias() {
    const idsExcluidos = await this.getDiscrepanciaMovimientoIds();
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
      if (idsExcluidos.has(String(movimiento.movimiento_id))) continue;
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
    const idsExcluidos = await this.getDiscrepanciaMovimientoIds();
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
       ORDER BY mb.fecha_hora DESC, mb.id DESC`,
      [cutoff]
    );
    const movimientos = result.rows.filter((item) => {
      if (idsExcluidos.has(String(item.id))) return false;
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
              COALESCE(r.entregado_en, v.registrada_en) AS fecha_entrega,
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
       , dc.motivo_tipificado, dc.comprobante_nombre, dc.dentro_de_tolerancia, dc.estado
       FROM discrepancia_conciliacion dc
       JOIN movimiento_bancario mb ON mb.id = dc.movimiento_id
       WHERE dc.estado IN ('pendiente', 'pendiente_aprobacion')
       ORDER BY dc.creada_en DESC`
    );
    return result.rows;
  },

  async conciliar(
    movimientoIdsValue: unknown,
    remitoIdsValue: unknown,
    usuarioId: number,
    justificacion?: JustificacionDiferenciaDto | null,
    aceptarSugerencia = false
  ) {
    const movimientoIds = parsearIds(movimientoIdsValue, 'movimiento');
    const remitoIds = parsearIds(remitoIdsValue, 'remito');
    return enTransaccion(async (client) => {
      const result = await validarSeleccion(client, movimientoIds, remitoIds);
      if (aceptarSugerencia && (movimientoIds.length !== 1 || remitoIds.length !== 1 || result.diferencia !== 0n ||
          diasEntre(result.movimientos[0].fecha_hora, result.remitos[0].fecha_entrega) > VENTANA_SUGERENCIAS_DIAS)) {
        throw new ConciliacionError('La sugerencia dejó de ser exacta o ya no está vigente; revisá la conciliación manual.', 409);
      }
      if (aceptarSugerencia) {
        const discrepancia = await client.query(
          `SELECT id FROM discrepancia_conciliacion
           WHERE estado = 'pendiente' AND movimiento_ids && $1::bigint[] FOR UPDATE`,
          [movimientoIds]
        );
        if (discrepancia.rows.length) throw new ConciliacionError('El movimiento está en la bandeja de discrepancias y requiere revisión manual.', 409);
      }
      if (result.diferencia > 0n) {
        throw new ConciliacionError('El total de movimientos supera los saldos seleccionados.', 422, {
          importeMovimiento: result.importeMovimiento.toString(),
          importeSeleccionado: result.importeSeleccionado.toString(),
          diferenciaCentavos: result.diferencia.toString(),
        });
      }

      // Si el movimiento bancario es inferior al saldo total de los remitos (diferencia < 0)
      if (result.diferencia < 0n) {
        const desvioCentavos = -result.diferencia;

        // ESCENARIO 3: Validación obligatoria de motivo tipificado y comprobante de respaldo
        if (!justificacion) {
          throw new ConciliacionError(
            'Toda diferencia entre el valor del movimiento bancario y el saldo de los remitos debe clasificarse obligatoriamente bajo un motivo tipificado con comprobante de respaldo adjunto.',
            422,
            { camposFaltantes: ['motivoTipificado', 'comprobanteNombre'], desvioCentavos: desvioCentavos.toString() }
          );
        }

        const camposFaltantes: string[] = [];
        if (!justificacion.motivoTipificado || !MOTIVOS_TIPIFICADOS.includes(justificacion.motivoTipificado as any)) {
          camposFaltantes.push('motivoTipificado');
        }
        if (!justificacion.comprobanteNombre || typeof justificacion.comprobanteNombre !== 'string' || !justificacion.comprobanteNombre.trim()) {
          camposFaltantes.push('comprobanteNombre');
        }

        if (camposFaltantes.length > 0) {
          throw new ConciliacionError(
            'Debe seleccionar una causal tipificada válida y adjuntar el comprobante o certificado de respaldo obligatorio.',
            422,
            { camposFaltantes, desvioCentavos: desvioCentavos.toString() }
          );
        }

        // Evaluar política financiera de tolerancia (nominal y porcentual)
        const porcentajeDesvio = (desvioCentavos * 100n) / result.importeSeleccionado;
        const excedeTolerancia = desvioCentavos > TOLERANCIA_NOMINAL_MAX_CENTAVOS || porcentajeDesvio > TOLERANCIA_PORCENTUAL_MAX;

        // ESCENARIO 2: Bloqueo y escalamiento a aprobación gerencial si excede la tolerancia
        if (excedeTolerancia) {
          const discResult = await client.query(
            `INSERT INTO discrepancia_conciliacion
               (movimiento_id, movimiento_ids, remito_ids, importe_movimiento, importe_seleccionado,
                diferencia_centavos, nota, motivo_tipificado, comprobante_nombre, dentro_de_tolerancia, estado, creada_por)
             VALUES ($1, $2::bigint[], $3::bigint[], $4, $5, $6, $7, $8, $9, false, 'pendiente_aprobacion', $10)
             RETURNING id::text AS id`,
            [
              movimientoIds[0],
              movimientoIds,
              remitoIds,
              result.importeMovimiento.toString(),
              result.importeSeleccionado.toString(),
              result.diferencia.toString(),
              justificacion.nota?.trim() || 'Discrepancia excede tolerancia operativa',
              justificacion.motivoTipificado,
              justificacion.comprobanteNombre.trim(),
              usuarioId,
            ]
          );

          const discrepanciaId = discResult.rows[0].id;

          await client.query(
            `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
             VALUES ('discrepancia_conciliacion', $1, 'escalamiento_gerencial', $2, $3::jsonb, $4)`,
            [
              discrepanciaId,
              usuarioId,
              JSON.stringify({
                movimientoIds,
                remitoIds,
                desvioCentavos: desvioCentavos.toString(),
                porcentajeDesvio: Number(porcentajeDesvio),
                motivoTipificado: justificacion.motivoTipificado,
                comprobanteNombre: justificacion.comprobanteNombre.trim(),
                toleranciaNominalCentavos: TOLERANCIA_NOMINAL_MAX_CENTAVOS.toString(),
                toleranciaPorcentual: Number(TOLERANCIA_PORCENTUAL_MAX),
              }),
              `Desvío excede tolerancia operativa ($${Number(desvioCentavos) / 100} / ${porcentajeDesvio}%). Conciliación bloqueada y derivada a aprobación gerencial.`,
            ]
          );

          return {
            bloqueadoPorTolerancia: true,
            escaladoGerencia: true,
            estado: 'pendiente_aprobacion',
            discrepanciaId,
            desvioCentavos: desvioCentavos.toString(),
            porcentajeDesvio: Number(porcentajeDesvio),
            message: `El desvío excede la tolerancia operativa máxima (límite: $${Number(TOLERANCIA_NOMINAL_MAX_CENTAVOS) / 100} o ${TOLERANCIA_PORCENTUAL_MAX}%). La conciliación directa fue bloqueada y el caso se envió a la bandeja de aprobación gerencial.`,
          };
        }

        // ESCENARIO 1: Justificación válida dentro de la tolerancia permitida
        // 1. Imputar monto bancario
        const imputaciones: Array<{ id: string; movimientoId: string; remitoId: string; importeCentavos: string }> = [];
        for (const asignacion of result.imputaciones) {
          const inserted = await client.query(
            `INSERT INTO imputacion (movimiento_bancario_id, remito_id, importe_centavos, imputado_por, es_ajuste)
             VALUES ($1, $2, $3, $4, false)
             RETURNING id::text AS id`,
            [asignacion.movimientoId, asignacion.remitoId, asignacion.importeCentavos.toString(), usuarioId]
          );
          imputaciones.push({
            id: inserted.rows[0].id,
            movimientoId: asignacion.movimientoId,
            remitoId: asignacion.remitoId,
            importeCentavos: asignacion.importeCentavos.toString(),
          });
        }

        // 2. Asentar ajuste contable con la causal y certificado para saldar el remito
        const ajustes: Array<{ id: string; remitoId: string; importeCentavos: string }> = [];
        for (const [remitoId, saldoRestante] of result.saldos.entries()) {
          if (saldoRestante <= 0n) continue;
          await client.query(
            `INSERT INTO imputacion (movimiento_bancario_id, remito_id, importe_centavos, imputado_por, es_ajuste, motivo_ajuste, comprobante_nombre)
             VALUES ($1, $2, $3, $4, true, $5, $6)`,
            [
              movimientoIds[0],
              remitoId,
              saldoRestante.toString(),
              usuarioId,
              justificacion.motivoTipificado,
              justificacion.comprobanteNombre.trim(),
            ]
          );

          const insertedAjuste = await client.query(
            `INSERT INTO ajuste_conciliacion (movimiento_bancario_id, remito_id, motivo_tipificado, comprobante_nombre, importe_centavos, creado_por)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id::text AS id`,
            [
              movimientoIds[0],
              remitoId,
              justificacion.motivoTipificado,
              justificacion.comprobanteNombre.trim(),
              saldoRestante.toString(),
              usuarioId,
            ]
          );

          ajustes.push({
            id: insertedAjuste.rows[0].id,
            remitoId,
            importeCentavos: saldoRestante.toString(),
          });
        }

        await client.query(
          `UPDATE movimiento_bancario SET estado = 'imputado' WHERE id::text = ANY($1)`,
          [movimientoIds]
        );

        await client.query(
          `UPDATE discrepancia_conciliacion SET estado = 'resuelta'
           WHERE estado IN ('pendiente', 'pendiente_aprobacion') AND movimiento_ids && $1::bigint[]`,
          [movimientoIds]
        );

        // Registrar desglose contable en auditoría
        await client.query(
          `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
           VALUES ('movimiento_bancario', $1, 'conciliacion_con_ajuste', $2, $3::jsonb, $4)`,
          [
            movimientoIds[0],
            usuarioId,
            JSON.stringify({
              movimientoIds,
              remitoIds,
              importeMovimiento: result.importeMovimiento.toString(),
              desvioAjustado: desvioCentavos.toString(),
              motivoTipificado: justificacion.motivoTipificado,
              comprobanteNombre: justificacion.comprobanteNombre.trim(),
              ajustes,
              imputaciones,
            }),
            `Conciliación con ajuste asentado por ${justificacion.motivoTipificado} (Certificado: ${justificacion.comprobanteNombre.trim()}). Comprobantes saldados.`,
          ]
        );

        return {
          success: true,
          movimientoIds,
          estado: 'imputado',
          ajusteAsentado: true,
          motivoTipificado: justificacion.motivoTipificado,
          comprobanteNombre: justificacion.comprobanteNombre.trim(),
          desvioCentavos: desvioCentavos.toString(),
          imputaciones,
          ajustes,
          message: `Ajuste asentado correctamente dentro de la tolerancia permitida bajo causal "${justificacion.motivoTipificado}". Los comprobantes quedaron saldados y el desglose contable registrado.`,
        };
      }

      // Conciliación exacta estándar
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
        `UPDATE movimiento_bancario SET estado = 'imputado' WHERE id::text = ANY($1)`,
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
      if (result.diferencia <= 0n) {
        throw new ConciliacionError('No hay sobrante de movimientos; corresponde imputarlos a los remitos.', 422);
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
