// backend/src/services/cobroService.ts
// Épica 1.4 · Registro de cobro integrado en punto de entrega (HU #25 a #29).
// Reglas y supuestos documentados en docs/requerimientos/epica-1.4-cobro-movil.md
import { PoolClient } from 'pg';
import { db } from '../db.js';

export class CobroError extends Error {
  constructor(
    message: string,
    public status = 422,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export type MedioPago = 'efectivo' | 'transferencia' | 'qr';
export const MEDIOS_PAGO: MedioPago[] = ['efectivo', 'transferencia', 'qr'];

// HU #25 · Ajuste dinámico por excepciones: estos remitos no se cobran (supuesto S2).
export const ESTADOS_REMITO_NO_COBRABLES = ['no_entregado', 'devuelto', 'anulado'];

export interface RemitoVisita {
  id: string;
  numero: string;
  marca: string;
  importeCentavos: number;
  estado: string;
}

export interface ImporteVisita {
  totalCentavos: number;
  subtotalesPorMarca: { marca: string; importeCentavos: number }[];
  remitosExcluidos: string[];
  sinCobroEnDestino: boolean;
}

export interface PagoDto {
  claveIdempotencia: string;
  medioPago: MedioPago;
  importeCentavos: number;
  referenciaTransferencia?: string | null;
}

export interface RegistrarCobroDto {
  pagos: PagoDto[];
  registradoEn: string;
  ubicacion?: { latitud: number; longitud: number; precisionMetros?: number | null } | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires';

/**
 * HU #25: importe exigible de la visita, de solo lectura, con subtotal por marca.
 * Descuenta los remitos rechazados, devueltos o anulados.
 */
export function calcularImporteVisita(remitos: RemitoVisita[]): ImporteVisita {
  const subtotales = new Map<string, number>();
  const remitosExcluidos: string[] = [];
  let totalCentavos = 0;

  for (const remito of remitos) {
    if (ESTADOS_REMITO_NO_COBRABLES.includes(remito.estado)) {
      remitosExcluidos.push(remito.numero);
      continue;
    }
    totalCentavos += remito.importeCentavos;
    subtotales.set(remito.marca, (subtotales.get(remito.marca) || 0) + remito.importeCentavos);
  }

  return {
    totalCentavos,
    subtotalesPorMarca: [...subtotales].map(([marca, importeCentavos]) => ({ marca, importeCentavos })),
    remitosExcluidos,
    sinCobroEnDestino: totalCentavos === 0,
  };
}

export function normalizarReferencia(referencia: string | null | undefined): string {
  return (referencia || '').trim().toUpperCase();
}

/**
 * Valida los pagos declarados contra el total exigible (HU #26 E3, #28 E3, #29 E3 y E4).
 * Si la suma no coincide, el error informa la diferencia: positiva si sobra plata, negativa si falta.
 */
export function validarPagos(pagos: PagoDto[], totalExigibleCentavos: number): void {
  if (totalExigibleCentavos === 0) {
    if (pagos.length > 0) {
      throw new CobroError('La visita no tiene cobro en destino: no se deben registrar pagos.', 422);
    }
    return;
  }
  if (pagos.length === 0) {
    throw new CobroError('Indicá al menos un medio de pago.', 422);
  }

  for (const pago of pagos) {
    if (!MEDIOS_PAGO.includes(pago.medioPago)) {
      throw new CobroError(`Medio de pago inválido: ${pago.medioPago}.`, 400);
    }
    if (!Number.isSafeInteger(pago.importeCentavos) || pago.importeCentavos <= 0) {
      throw new CobroError('Cada medio de pago debe tener un importe mayor a cero.', 422, { medioPago: pago.medioPago });
    }
    if (pago.medioPago === 'transferencia' && !normalizarReferencia(pago.referenciaTransferencia)) {
      throw new CobroError('Falta la referencia bancaria de la transferencia.', 422, { campo: 'referenciaTransferencia' });
    }
  }

  const referencias = pagos
    .filter((pago) => pago.medioPago === 'transferencia')
    .map((pago) => normalizarReferencia(pago.referenciaTransferencia));
  if (new Set(referencias).size !== referencias.length) {
    throw new CobroError('La misma referencia de transferencia se cargó dos veces.', 409);
  }

  const declarado = pagos.reduce((suma, pago) => suma + pago.importeCentavos, 0);
  const diferencia = declarado - totalExigibleCentavos;
  if (diferencia !== 0) {
    throw new CobroError(
      diferencia < 0
        ? 'El monto ingresado es menor al importe exigido para la visita.'
        : 'El monto ingresado supera el importe exigido para la visita.',
      422,
      { totalExigibleCentavos, declaradoCentavos: declarado, diferenciaCentavos: diferencia }
    );
  }
}

/** Fecha AAAA-MM-DD en hora argentina. */
export function fechaArgentina(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_ARGENTINA }).format(fecha);
}

/** Rango [desde, hasta) del día argentino que contiene a `fecha`. Argentina no usa horario de verano (UTC-3). */
export function rangoDiaArgentina(fecha: Date): { desde: Date; hasta: Date } {
  const desde = new Date(`${fechaArgentina(fecha)}T00:00:00-03:00`);
  return { desde, hasta: new Date(desde.getTime() + 24 * 60 * 60 * 1000) };
}

function parsearDto(body: any): RegistrarCobroDto {
  if (!body || !Array.isArray(body.pagos)) {
    throw new CobroError('Falta la lista de pagos.', 400);
  }
  const registradoEn = new Date(body.registradoEn);
  if (typeof body.registradoEn !== 'string' || Number.isNaN(registradoEn.getTime())) {
    throw new CobroError('Falta la fecha y hora del registro.', 400);
  }
  const pagos: PagoDto[] = body.pagos.map((pago: any) => {
    const clave = String(pago?.claveIdempotencia || '').toLowerCase();
    if (!UUID_RE.test(clave)) {
      throw new CobroError('Cada pago necesita una clave de idempotencia (uuid).', 400);
    }
    return {
      claveIdempotencia: clave,
      medioPago: pago.medioPago,
      importeCentavos: Number(pago.importeCentavos),
      referenciaTransferencia: pago.medioPago === 'transferencia' ? normalizarReferencia(pago.referenciaTransferencia) : null,
    };
  });
  if (new Set(pagos.map((pago) => pago.claveIdempotencia)).size !== pagos.length) {
    throw new CobroError('Hay claves de idempotencia repetidas.', 400);
  }

  const u = body.ubicacion;
  const ubicacion =
    u && Number.isFinite(Number(u.latitud)) && Number.isFinite(Number(u.longitud))
      ? {
          latitud: Number(u.latitud),
          longitud: Number(u.longitud),
          precisionMetros: Number.isFinite(Number(u.precisionMetros)) ? Number(u.precisionMetros) : null,
        }
      : null;

  return { pagos, registradoEn: registradoEn.toISOString(), ubicacion };
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

async function getRemitosVisita(client: { query: typeof db.query }, visitaId: string): Promise<RemitoVisita[]> {
  const result = await client.query(
    `SELECT r.id::text AS id, r.numero, m.nombre AS marca, r.importe_centavos, r.estado
     FROM remito r
     JOIN marca m ON m.id = r.marca_id
     WHERE r.visita_id::text = $1
     ORDER BY m.nombre, r.numero`,
    [visitaId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    numero: row.numero,
    marca: row.marca,
    importeCentavos: Number(row.importe_centavos),
    estado: row.estado,
  }));
}

/** "$1, $2, ..." a partir de `desde`. Se usa IN en lugar de ANY($1) para uuid, que pg-mem (tests) no resuelve. */
function marcadores(cantidad: number, desde = 1): string {
  return Array.from({ length: cantidad }, (_, i) => `$${i + desde}`).join(', ');
}

async function buscarCobrosPorClave(client: { query: typeof db.query }, claves: string[]) {
  const result = await client.query(
    `SELECT id::text AS id, visita_id::text AS visita_id, clave_idempotencia::text AS clave,
            medio_pago, importe_centavos
     FROM cobro
     WHERE clave_idempotencia IN (${marcadores(claves.length)})`,
    claves
  );
  return result.rows;
}

function respuestaCobros(visitaId: string, rows: any[], duplicado: boolean) {
  const cobros = rows.map((row) => ({
    id: row.id,
    claveIdempotencia: row.clave,
    medioPago: row.medio_pago,
    importeCentavos: Number(row.importe_centavos),
  }));
  return {
    visitaId,
    cobrada: true,
    duplicado,
    totalCentavos: cobros.reduce((suma, cobro) => suma + cobro.importeCentavos, 0),
    cobros,
  };
}

export const cobroService = {
  /** Hoja de ruta publicada del transportista para una fecha, con todo lo necesario para trabajar sin conexión. */
  async getHojaDelDia(transportistaId: number, fecha: string) {
    const hojaRes = await db.query(
      `SELECT h.id::text AS id, h.patente, h.estado, s.nombre AS sucursal
       FROM hoja_de_ruta h
       JOIN sucursal s ON s.id = h.sucursal_id
       WHERE h.transportista_id = $1
         AND h.fecha_reparto = $2::date
         AND h.estado IN ('publicada', 'en_curso')
       LIMIT 1`,
      [transportistaId, fecha]
    );
    const hoja = hojaRes.rows[0];
    if (!hoja) return null;

    const visitasRes = await db.query(
      `SELECT v.id::text AS id, v.orden, v.estado, v.cobrada_en IS NOT NULL AS cobrada,
              c.razon_social, c.nombre_fantasia, c.domicilio, c.localidad,
              c.ventana_desde::text AS ventana_desde, c.ventana_hasta::text AS ventana_hasta, c.telefono
       FROM visita v
       JOIN comercio c ON c.id = v.comercio_id
       WHERE v.hoja_de_ruta_id::text = $1
       ORDER BY v.orden NULLS LAST, v.id`,
      [hoja.id]
    );

    const visitas = [];
    for (const v of visitasRes.rows) {
      const remitos = await getRemitosVisita(db, v.id);
      visitas.push({
        id: v.id,
        orden: v.orden,
        estado: v.estado,
        cobrada: !!v.cobrada,
        comercio: {
          razonSocial: v.razon_social,
          nombreFantasia: v.nombre_fantasia,
          domicilio: v.domicilio,
          localidad: v.localidad,
          ventanaDesde: v.ventana_desde,
          ventanaHasta: v.ventana_hasta,
          telefono: v.telefono,
        },
        remitos,
        importe: calcularImporteVisita(remitos),
      });
    }

    return {
      id: hoja.id,
      fechaReparto: fecha,
      patente: hoja.patente,
      estado: hoja.estado,
      sucursal: hoja.sucursal,
      visitas,
    };
  },

  /** HU #26 a #29: registra los pagos de una visita y la liquida, todo o nada. */
  async registrarCobro(transportistaId: number, visitaId: string, body: unknown) {
    if (!/^[1-9]\d*$/.test(visitaId)) throw new CobroError('Visita inválida.', 400);
    const dto = parsearDto(body);
    const claves = dto.pagos.map((pago) => pago.claveIdempotencia);

    try {
      return await enTransaccion(async (client) => {
        const visitaRes = await client.query(
          `SELECT v.id::text AS id, v.cobrada_en IS NOT NULL AS cobrada, v.comercio_id::text AS comercio_id,
                  h.transportista_id::text AS transportista_id, h.estado AS hoja_estado
           FROM visita v
           JOIN hoja_de_ruta h ON h.id = v.hoja_de_ruta_id
           WHERE v.id::text = $1`,
          [visitaId]
        );
        const visita = visitaRes.rows[0];
        if (!visita || visita.transportista_id !== String(transportistaId)) {
          throw new CobroError('La visita no existe o no pertenece a tu hoja de ruta.', 404);
        }

        // Idempotencia (RNF): si el celular reenvía una liquidación ya registrada, se devuelve la original.
        const existentes = claves.length ? await buscarCobrosPorClave(client, claves) : [];
        if (existentes.length > 0) {
          if (existentes.every((row) => row.visita_id === visitaId)) {
            const todos = await client.query(
              `SELECT id::text AS id, clave_idempotencia::text AS clave, medio_pago, importe_centavos
               FROM cobro WHERE visita_id::text = $1 ORDER BY id`,
              [visitaId]
            );
            return respuestaCobros(visitaId, todos.rows, true);
          }
          throw new CobroError('Las claves del cobro ya se usaron en otra visita.', 409);
        }

        // La visita puede estar 'completada' por la entrega (HU #22) y todavía no cobrada.
        if (visita.cobrada) {
          throw new CobroError('La visita ya fue cobrada.', 409);
        }
        if (!['publicada', 'en_curso'].includes(visita.hoja_estado)) {
          throw new CobroError('La hoja de ruta no está habilitada para registrar cobros.', 409);
        }

        const importe = calcularImporteVisita(await getRemitosVisita(client, visitaId));
        validarPagos(dto.pagos, importe.totalCentavos);

        // HU #28 ESCENARIO 2: misma referencia, mismo comercio, mismo día.
        // Las referencias se guardan ya normalizadas (sin espacios y en mayúsculas).
        const referencias = dto.pagos
          .filter((pago) => pago.medioPago === 'transferencia')
          .map((pago) => pago.referenciaTransferencia as string);
        if (referencias.length > 0) {
          const { desde, hasta } = rangoDiaArgentina(new Date(dto.registradoEn));
          const repetidas = await client.query(
            `SELECT c.referencia_transferencia
             FROM cobro c
             JOIN visita v ON v.id = c.visita_id
             WHERE v.comercio_id::text = $1
               AND c.medio_pago = 'transferencia'
               AND c.registrado_en >= $2 AND c.registrado_en < $3
               AND c.referencia_transferencia IN (${marcadores(referencias.length, 4)})`,
            [visita.comercio_id, desde, hasta, ...referencias]
          );
          if (repetidas.rows.length > 0) {
            throw new CobroError(
              'Ese número de comprobante ya fue utilizado por este comercio hoy. Operación bloqueada.',
              409,
              { referencia: repetidas.rows[0].referencia_transferencia }
            );
          }
        }

        const u = dto.ubicacion;
        const insertados = [];
        for (const pago of dto.pagos) {
          const res = await client.query(
            `INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, latitud, longitud,
                                registrado_por, referencia_transferencia, estado, clave_idempotencia, sincronizado_en)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente', $9, now())
             RETURNING id::text AS id, clave_idempotencia::text AS clave, medio_pago, importe_centavos`,
            [
              visitaId, pago.medioPago, pago.importeCentavos, dto.registradoEn,
              u?.latitud ?? null, u?.longitud ?? null, transportistaId,
              pago.referenciaTransferencia, pago.claveIdempotencia,
            ]
          );
          const cobro = res.rows[0];
          insertados.push(cobro);
          await client.query(
            `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues)
             VALUES ('cobro', $1, 'alta', $2, $3)`,
            [cobro.id, transportistaId, JSON.stringify({ visitaId, ...pago })]
          );
        }

        // D5: la visita queda cobrada. El estado de la visita y de sus remitos lo maneja la entrega (HU #22).
        await client.query('UPDATE visita SET cobrada_en = $2 WHERE id::text = $1', [visitaId, dto.registradoEn]);

        return respuestaCobros(visitaId, insertados, false);
      });
    } catch (error: any) {
      // Dos reenvíos simultáneos de la misma operación: gana el primero.
      if (error?.code === '23505' && claves.length) {
        const existentes = await buscarCobrosPorClave(db, claves);
        if (existentes.length && existentes.every((row) => row.visita_id === visitaId)) {
          return respuestaCobros(visitaId, existentes, true);
        }
      }
      throw error;
    }
  },
};
