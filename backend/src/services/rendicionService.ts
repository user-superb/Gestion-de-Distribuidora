// backend/src/services/rendicionService.ts
// Épica 2.3 · Circuito digital de rendición y control de efectivo (HU #46 a #50).
// Reglas y supuestos en docs/requerimientos/epica-2.3-rendicion-efectivo.md
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PoolClient } from 'pg';
import { db } from '../db.js';
import { calcularImporteVisita } from './cobroService.js';

export class RendicionError extends Error {
  constructor(
    message: string,
    public status = 422,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export type EstadoRendicion = 'pendiente' | 'con_diferencia' | 'validada' | 'rechazada' | 'anulada';

/** Billetes de curso legal que cuenta el supervisor, en centavos (de $20.000 a $10). */
export const DENOMINACIONES_CENTAVOS = [2000000, 1000000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

export interface ConteoBilletes {
  billetes: Record<string, number>;
  monedasCentavos: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ESTADOS_HOJA_OPERATIVOS = ['publicada', 'asignada', 'en_curso', 'pendiente_de_despacho'];
const ESTADOS_HOJA_OPERATIVOS_SQL = ESTADOS_HOJA_OPERATIVOS.map((estado) => `'${estado}'`).join(', ');
/** Deja afuera las hojas sin paradas. Va como JOIN a una subconsulta para que también lo resuelva pg-mem (tests). */
const JOIN_HOJAS_CON_PARADAS = `JOIN (
          SELECT DISTINCT hoja_de_ruta_id FROM visita WHERE hoja_de_ruta_id IS NOT NULL
        ) con_paradas ON con_paradas.hoja_de_ruta_id = h.id`;
const ESTADOS_REMITO_SIN_RESOLVER = ['pendiente', 'en_ruta'];
const LARGO_MINIMO_JUSTIFICACION = 10;

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

type Consulta = { query: typeof db.query };

function aFecha(valor: unknown): string | null {
  if (!valor) return null;
  if (valor instanceof Date) {
    // node-pg devuelve las columnas date a medianoche local; pg-mem, a medianoche UTC.
    const utc = valor.getUTCHours() === 0 && valor.getUTCMinutes() === 0;
    const [anio, mes, dia] = utc
      ? [valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate()]
      : [valor.getFullYear(), valor.getMonth(), valor.getDate()];
    return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  return String(valor).slice(0, 10);
}

function aIso(valor: unknown): string | null {
  if (!valor) return null;
  const fecha = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function formatearPesos(centavos: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(centavos / 100);
}

/** Diferencia del conteo físico contra lo declarado: negativa = faltante, positiva = sobrante. */
export function calcularDiferencia(declaradoCentavos: number, rendidoCentavos: number) {
  const diferenciaCentavos = rendidoCentavos - declaradoCentavos;
  return {
    diferenciaCentavos,
    tipo: diferenciaCentavos === 0 ? ('coincide' as const) : diferenciaCentavos < 0 ? ('faltante' as const) : ('sobrante' as const),
  };
}

/**
 * HU #49 E2: el conteo no admite valores negativos ni fraccionarios.
 * Si viene el detalle de billetes, el total tiene que ser la suma del detalle.
 */
export function validarConteo(rendido: unknown, conteo: unknown): { rendidoCentavos: number; conteo: ConteoBilletes | null } {
  let conteoValido: ConteoBilletes | null = null;
  if (conteo !== undefined && conteo !== null) {
    const billetes = (conteo as any)?.billetes ?? {};
    if (typeof billetes !== 'object' || Array.isArray(billetes)) {
      throw new RendicionError('El conteo de billetes es inválido.', 400);
    }
    const limpio: Record<string, number> = {};
    let total = 0;
    for (const [denominacion, cantidad] of Object.entries(billetes)) {
      const valor = Number(denominacion);
      if (!DENOMINACIONES_CENTAVOS.includes(valor)) {
        throw new RendicionError(`Denominación de billete inválida: ${denominacion}.`, 400);
      }
      const unidades = Number(cantidad);
      if (!Number.isFinite(unidades) || unidades < 0) {
        throw new RendicionError('El conteo no admite valores negativos.', 400, { campo: 'conteo', denominacion: valor });
      }
      if (!Number.isSafeInteger(unidades)) {
        throw new RendicionError('La cantidad de billetes debe ser un número entero.', 400, { denominacion: valor });
      }
      if (unidades > 0) limpio[String(valor)] = unidades;
      total += valor * unidades;
    }
    const monedas = Number((conteo as any)?.monedasCentavos ?? 0);
    if (!Number.isFinite(monedas) || monedas < 0) {
      throw new RendicionError('El conteo no admite valores negativos.', 400, { campo: 'monedasCentavos' });
    }
    if (!Number.isSafeInteger(monedas)) {
      throw new RendicionError('El importe en monedas es inválido.', 400);
    }
    total += monedas;
    conteoValido = { billetes: limpio, monedasCentavos: monedas };
    if (rendido === undefined || rendido === null) rendido = total;
    if (Number(rendido) !== total) {
      throw new RendicionError('El total contado no coincide con el detalle de billetes.', 400, { totalConteoCentavos: total });
    }
  }

  const rendidoCentavos = Number(rendido);
  if (rendido === undefined || rendido === null || rendido === '' || !Number.isFinite(rendidoCentavos)) {
    throw new RendicionError('Ingresá el monto físico contado.', 400, { campo: 'rendidoCentavos' });
  }
  if (rendidoCentavos < 0) {
    throw new RendicionError('El conteo no admite valores negativos.', 400, { campo: 'rendidoCentavos' });
  }
  if (!Number.isSafeInteger(rendidoCentavos)) {
    throw new RendicionError('El monto contado es inválido.', 400, { campo: 'rendidoCentavos' });
  }
  return { rendidoCentavos, conteo: conteoValido };
}

function validarJustificacion(texto: unknown, campo: string): string {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (!limpio) {
    throw new RendicionError('La diferencia exige una justificación escrita.', 422, { campo });
  }
  if (limpio.length < LARGO_MINIMO_JUSTIFICACION) {
    throw new RendicionError(`La justificación debe tener al menos ${LARGO_MINIMO_JUSTIFICACION} caracteres.`, 422, { campo });
  }
  return limpio;
}

/**
 * HU #46 E3: visitas que todavía están abiertas. Una visita está pendiente si le queda algún remito
 * sin entregar ni rechazar, o si tiene importe a cobrar y todavía no se cobró.
 */
async function visitasPendientes(client: Consulta, hojaId: string) {
  const res = await client.query(
    `SELECT v.id::text AS visita_id, v.orden, v.cobrada_en IS NOT NULL AS cobrada,
            c.razon_social, c.nombre_fantasia,
            r.id::text AS remito_id, r.numero, r.estado AS remito_estado, r.importe_centavos
     FROM visita v
     JOIN comercio c ON c.id = v.comercio_id
     LEFT JOIN remito r ON r.visita_id = v.id
     WHERE v.hoja_de_ruta_id::text = $1
     ORDER BY v.orden, v.id`,
    [hojaId]
  );
  const visitas = new Map<string, { orden: number | null; comercio: string; cobrada: boolean; remitos: any[] }>();
  for (const row of res.rows) {
    if (!visitas.has(row.visita_id)) {
      visitas.set(row.visita_id, {
        orden: row.orden === null ? null : Number(row.orden),
        comercio: row.nombre_fantasia || row.razon_social,
        cobrada: !!row.cobrada,
        remitos: [],
      });
    }
    if (row.remito_id) {
      visitas.get(row.visita_id)!.remitos.push({
        id: row.remito_id, numero: row.numero, marca: '', estado: row.remito_estado, importeCentavos: Number(row.importe_centavos),
      });
    }
  }
  const pendientes = [];
  for (const [visitaId, visita] of visitas) {
    const sinResolver = visita.remitos.some((remito) => ESTADOS_REMITO_SIN_RESOLVER.includes(remito.estado));
    const faltaCobrar = !visita.cobrada && calcularImporteVisita(visita.remitos).totalCentavos > 0;
    if (sinResolver || faltaCobrar) {
      pendientes.push({ visitaId, orden: visita.orden, comercio: visita.comercio, motivo: sinResolver ? 'remitos sin entregar' : 'falta el cobro' });
    }
  }
  return pendientes;
}

async function cobrosEfectivoDeHoja(client: Consulta, hojaId: string) {
  const res = await client.query(
    `SELECT co.id::text AS id, co.importe_centavos, co.registrado_en, v.orden,
            c.razon_social, c.nombre_fantasia
     FROM cobro co
     JOIN visita v ON v.id = co.visita_id
     JOIN comercio c ON c.id = v.comercio_id
     WHERE v.hoja_de_ruta_id::text = $1 AND co.medio_pago = 'efectivo'
     ORDER BY v.orden, co.id`,
    [hojaId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    orden: row.orden === null ? null : Number(row.orden),
    comercio: row.nombre_fantasia || row.razon_social,
    importeCentavos: Number(row.importe_centavos),
    registradoEn: aIso(row.registrado_en),
  }));
}

const SELECT_RENDICION = `
  SELECT re.id::text AS id, re.hoja_de_ruta_id::text AS hoja_id, re.estado,
         re.declarado_centavos, re.declarado_en, re.clave_idempotencia::text AS clave,
         re.anulada_en, re.rendido_centavos, re.conteo_billetes, re.motivo_diferencia,
         re.diferencia_registrada_en, re.validado_en,
         h.fecha_reparto, h.patente, h.estado AS hoja_estado,
         s.nombre AS sucursal,
         t.id::text AS transportista_id, t.nombre AS transportista_nombre,
         sup.nombre AS validado_por_nombre,
         dif.nombre AS diferencia_registrada_por_nombre
  FROM rendicion_efectivo re
  JOIN hoja_de_ruta h ON h.id = re.hoja_de_ruta_id
  JOIN sucursal s ON s.id = h.sucursal_id
  JOIN usuario t ON t.id = COALESCE(re.transportista_id, h.transportista_id)
  LEFT JOIN usuario sup ON sup.id = re.validado_por
  LEFT JOIN usuario dif ON dif.id = re.diferencia_registrada_por`;

function mapearRendicion(row: any) {
  const declaradoCentavos = Number(row.declarado_centavos);
  const rendidoCentavos = row.rendido_centavos === null || row.rendido_centavos === undefined ? null : Number(row.rendido_centavos);
  const diferencia = rendidoCentavos === null ? null : calcularDiferencia(declaradoCentavos, rendidoCentavos);
  const conteo = typeof row.conteo_billetes === 'string' ? JSON.parse(row.conteo_billetes) : row.conteo_billetes ?? null;
  return {
    id: row.id,
    hojaDeRutaId: row.hoja_id,
    codigoHoja: `HR-${String(row.hoja_id).padStart(4, '0')}`,
    fechaReparto: aFecha(row.fecha_reparto),
    patente: row.patente ?? null,
    estadoHoja: row.hoja_estado,
    sucursal: row.sucursal,
    transportista: { id: row.transportista_id, nombre: row.transportista_nombre },
    estado: row.estado as EstadoRendicion,
    declaradoCentavos,
    declaradoEn: aIso(row.declarado_en),
    claveIdempotencia: row.clave ?? null,
    anuladaEn: aIso(row.anulada_en),
    rendidoCentavos,
    conteo,
    diferenciaCentavos: diferencia?.diferenciaCentavos ?? null,
    tipoDiferencia: diferencia?.tipo ?? null,
    motivoDiferencia: row.motivo_diferencia ?? null,
    diferenciaRegistradaEn: aIso(row.diferencia_registrada_en),
    diferenciaRegistradaPor: row.diferencia_registrada_por_nombre ?? null,
    validadoEn: aIso(row.validado_en),
    validadoPor: row.validado_por_nombre ?? null,
  };
}

export type Rendicion = ReturnType<typeof mapearRendicion>;

async function buscarRendicion(client: Consulta, id: string): Promise<Rendicion | null> {
  const res = await client.query(`${SELECT_RENDICION} WHERE re.id::text = $1`, [id]);
  return res.rows[0] ? mapearRendicion(res.rows[0]) : null;
}

function mensajeRetractada(rendicion: Rendicion): string {
  const cuando = rendicion.anuladaEn
    ? ` el ${new Date(rendicion.anuladaEn).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' })}`
    : '';
  return `${rendicion.transportista.nombre} retractó esta declaración de efectivo${cuando}: no se puede procesar. Esperá la nueva declaración desde la app.`;
}

async function auditar(client: Consulta, rendicionId: string, accion: string, usuarioId: number, antes: unknown, despues: unknown, observacion?: string) {
  await client.query(
    `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_antes, valores_despues, observacion)
     VALUES ('rendicion_efectivo', $1, $2, $3, $4, $5, $6)`,
    [rendicionId, accion, usuarioId, antes === null ? null : JSON.stringify(antes), JSON.stringify(despues), observacion ?? null]
  );
}

/** Rendición sobre la que el supervisor puede trabajar: existe, no fue retractada y no está cerrada. */
async function rendicionParaProcesar(client: Consulta, id: string, estadosPermitidos: EstadoRendicion[]): Promise<Rendicion> {
  if (!/^[1-9]\d*$/.test(id)) throw new RendicionError('Rendición inválida.', 400);
  const rendicion = await buscarRendicion(client, id);
  if (!rendicion) throw new RendicionError('La declaración de efectivo no existe.', 404);
  if (rendicion.estado === 'anulada') {
    throw new RendicionError(mensajeRetractada(rendicion), 410, { estado: 'anulada', anuladaEn: rendicion.anuladaEn });
  }
  if (!estadosPermitidos.includes(rendicion.estado)) {
    throw new RendicionError(
      rendicion.estado === 'validada' ? 'La rendición ya fue aprobada y la hoja de ruta está cerrada.' : 'La rendición no está en un estado que permita esta operación.',
      409,
      { estado: rendicion.estado }
    );
  }
  return rendicion;
}

/** Cierra la hoja de ruta y deja validados los cobros en efectivo que entraron en la rendición. */
async function cerrarCircuito(client: Consulta, rendicion: Rendicion) {
  await client.query(`UPDATE hoja_de_ruta SET estado = 'cerrada', cerrada_en = now() WHERE id::text = $1`, [rendicion.hojaDeRutaId]);
  await client.query(`UPDATE cobro SET estado = 'validado' WHERE rendicion_id::text = $1`, [rendicion.id]);
}

export const rendicionService = {
  /** Estado de la declaración activa de una hoja, para la app (o null si no declaró o la anuló). */
  async getRendicionActivaDeHoja(hojaId: string) {
    const res = await db.query(
      `${SELECT_RENDICION} WHERE re.hoja_de_ruta_id::text = $1 AND re.estado <> 'anulada' ORDER BY re.id DESC LIMIT 1`,
      [hojaId]
    );
    if (!res.rows[0]) return null;
    const r = mapearRendicion(res.rows[0]);
    return { id: r.id, estado: r.estado, declaradoCentavos: r.declaradoCentavos, declaradoEn: r.declaradoEn, claveIdempotencia: r.claveIdempotencia };
  },

  /**
   * HU #46: el transportista declara el efectivo que lleva al terminar la ruta.
   * E1: queda pendiente y aparece en el escritorio del supervisor.
   * E2: la app la encola sin conexión; el reenvío con la misma clave no la duplica.
   * E3: se bloquea si la hoja todavía tiene visitas pendientes.
   */
  async declarar(transportistaId: number, body: any) {
    const clave = String(body?.claveIdempotencia || '').toLowerCase();
    if (!UUID_RE.test(clave)) throw new RendicionError('La declaración necesita una clave de idempotencia (uuid).', 400);
    const hojaId = String(body?.hojaDeRutaId ?? '');
    if (!/^[1-9]\d*$/.test(hojaId)) throw new RendicionError('Hoja de ruta inválida.', 400);
    const declarado = Number(body?.declaradoCentavos);
    if (body?.declaradoCentavos === undefined || body?.declaradoCentavos === null || !Number.isFinite(declarado)) {
      throw new RendicionError('Ingresá el monto de efectivo que llevás.', 400, { campo: 'declaradoCentavos' });
    }
    if (declarado < 0 || !Number.isSafeInteger(declarado)) {
      throw new RendicionError('El monto declarado no puede ser negativo.', 422, { campo: 'declaradoCentavos' });
    }
    const declaradoEn = new Date(body?.declaradoEn ?? Date.now());
    if (Number.isNaN(declaradoEn.getTime())) throw new RendicionError('La fecha de la declaración es inválida.', 400);

    return enTransaccion(async (client) => {
      const existente = await client.query(`SELECT id::text AS id FROM rendicion_efectivo WHERE clave_idempotencia = $1`, [clave]);
      if (existente.rows[0]) {
        const rendicion = await buscarRendicion(client, existente.rows[0].id);
        if (rendicion?.transportista.id !== String(transportistaId)) {
          throw new RendicionError('La clave de la declaración ya se usó.', 409);
        }
        return { rendicion, duplicado: true };
      }

      const hojaRes = await client.query(
        `SELECT id::text AS id, transportista_id::text AS transportista_id, estado FROM hoja_de_ruta WHERE id::text = $1`,
        [hojaId]
      );
      const hoja = hojaRes.rows[0];
      if (!hoja || hoja.transportista_id !== String(transportistaId)) {
        throw new RendicionError('La hoja de ruta no existe o no está asignada a vos.', 404);
      }
      if (!ESTADOS_HOJA_OPERATIVOS.includes(hoja.estado)) {
        throw new RendicionError('La hoja de ruta ya está cerrada: no admite una nueva declaración.', 409, { estadoHoja: hoja.estado });
      }

      const pendientes = await visitasPendientes(client, hojaId);
      if (pendientes.length > 0) {
        throw new RendicionError(
          `No podés rendir todavía: tenés ${pendientes.length} visita(s) pendiente(s) en la hoja de ruta.`,
          409,
          { codigo: 'VISITAS_PENDIENTES', visitasPendientes: pendientes }
        );
      }

      const activa = await client.query(
        `SELECT id::text AS id FROM rendicion_efectivo WHERE hoja_de_ruta_id::text = $1 AND estado <> 'anulada'`,
        [hojaId]
      );
      if (activa.rows[0]) {
        throw new RendicionError('Ya declaraste el efectivo de esta hoja de ruta.', 409, { rendicionId: activa.rows[0].id });
      }

      const insert = await client.query(
        `INSERT INTO rendicion_efectivo (hoja_de_ruta_id, transportista_id, declarado_centavos, declarado_en, clave_idempotencia, estado)
         VALUES ($1, $2, $3, $4, $5, 'pendiente')
         RETURNING id::text AS id`,
        [hojaId, transportistaId, declarado, declaradoEn.toISOString(), clave]
      );
      const id = insert.rows[0].id;
      // Los cobros en efectivo de la jornada entran en esta rendición física.
      await client.query(
        `UPDATE cobro SET rendicion_id = $1
         WHERE medio_pago = 'efectivo'
           AND visita_id IN (SELECT id FROM visita WHERE hoja_de_ruta_id::text = $2)`,
        [id, hojaId]
      );
      await auditar(client, id, 'alta', transportistaId, null, { hojaDeRutaId: hojaId, declaradoCentavos: declarado, declaradoEn: declaradoEn.toISOString() });
      return { rendicion: await buscarRendicion(client, id), duplicado: false };
    });
  },

  /**
   * HU #47 E2: el transportista retracta su declaración antes de llegar a la caja.
   * Se identifica por la clave de idempotencia, así funciona aunque la declaración siga en la cola del celular.
   */
  async anular(transportistaId: number, body: any) {
    const clave = String(body?.claveIdempotencia || '').toLowerCase();
    if (!UUID_RE.test(clave)) throw new RendicionError('Falta la clave de la declaración a anular.', 400);

    return enTransaccion(async (client) => {
      const res = await client.query(`SELECT id::text AS id FROM rendicion_efectivo WHERE clave_idempotencia = $1`, [clave]);
      const rendicion = res.rows[0] ? await buscarRendicion(client, res.rows[0].id) : null;
      if (!rendicion || rendicion.transportista.id !== String(transportistaId)) {
        throw new RendicionError('La declaración no existe o no es tuya.', 404);
      }
      if (rendicion.estado === 'anulada') return { rendicion, duplicado: true };
      if (rendicion.estado !== 'pendiente') {
        throw new RendicionError('El supervisor ya está contando este efectivo: no se puede anular.', 409, { estado: rendicion.estado });
      }
      const anuladaEn = new Date(body?.anuladaEn ?? Date.now());
      await client.query(
        `UPDATE rendicion_efectivo SET estado = 'anulada', anulada_en = $2 WHERE id::text = $1`,
        [rendicion.id, Number.isNaN(anuladaEn.getTime()) ? new Date().toISOString() : anuladaEn.toISOString()]
      );
      await client.query(`UPDATE cobro SET rendicion_id = NULL WHERE rendicion_id::text = $1`, [rendicion.id]);
      await auditar(client, rendicion.id, 'anulacion', transportistaId, { estado: 'pendiente' }, { estado: 'anulada' });
      return { rendicion: await buscarRendicion(client, rendicion.id), duplicado: false };
    });
  },

  /** HU #47: listado del supervisor. Identifica al transportista y la fecha de la hoja de ruta. */
  async listar(filtros: { estado?: string; fecha?: string } = {}) {
    await this.asegurarArqueosAutomaticos();
    const condiciones: string[] = [];
    const params: unknown[] = [];
    if (filtros.estado) {
      const estados = filtros.estado.split(',').map((e) => e.trim()).filter(Boolean);
      condiciones.push(`re.estado IN (${estados.map((_, i) => `$${params.length + i + 1}`).join(', ')})`);
      params.push(...estados);
    }
    if (filtros.fecha) {
      params.push(filtros.fecha);
      condiciones.push(`h.fecha_reparto = $${params.length}::date`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const res = await db.query(`${SELECT_RENDICION} ${where} ORDER BY re.declarado_en DESC, re.id DESC`, params);
    return res.rows.map(mapearRendicion);
  },

  /**
   * HU #47 E1: el supervisor abre la declaración y ve transportista, monto declarado y fecha de la hoja.
   * E2: si fue retractada, avisa (410) en lugar de mostrarla para contar.
   */
  async detalle(id: string) {
    if (!/^[1-9]\d*$/.test(id)) throw new RendicionError('Rendición inválida.', 400);
    const rendicion = await buscarRendicion(db, id);
    if (!rendicion) throw new RendicionError('La declaración de efectivo no existe.', 404);
    if (rendicion.estado === 'anulada') {
      throw new RendicionError(mensajeRetractada(rendicion), 410, { estado: 'anulada', anuladaEn: rendicion.anuladaEn, rendicion });
    }
    const cobros = await cobrosEfectivoDeHoja(db, rendicion.hojaDeRutaId);
    return {
      ...rendicion,
      cobrosEfectivo: cobros,
      efectivoCobradoCentavos: cobros.reduce((suma, cobro) => suma + cobro.importeCentavos, 0),
    };
  },

  /** HU #48: aprueba la rendición coincidente. Solo si lo contado es exactamente igual a lo declarado. */
  async aprobar(supervisorId: number, id: string, body: any) {
    const { rendidoCentavos, conteo } = validarConteo(body?.rendidoCentavos, body?.conteo);
    return enTransaccion(async (client) => {
      // También desde "con diferencia": un reconteo que ahora coincide se aprueba sin descuadre.
      const rendicion = await rendicionParaProcesar(client, id, ['pendiente', 'con_diferencia']);
      const diferencia = calcularDiferencia(rendicion.declaradoCentavos, rendidoCentavos);
      if (diferencia.tipo !== 'coincide') {
        throw new RendicionError(
          `El monto contado no coincide con lo declarado (${diferencia.tipo} de ${formatearPesos(Math.abs(diferencia.diferenciaCentavos))}). Registrá la diferencia.`,
          422,
          { codigo: 'NO_COINCIDE', ...diferencia, declaradoCentavos: rendicion.declaradoCentavos, rendidoCentavos }
        );
      }
      await client.query(
        `UPDATE rendicion_efectivo
         SET estado = 'validada', rendido_centavos = $2, conteo_billetes = $3, motivo_diferencia = NULL,
             validado_por = $4, validado_en = now()
         WHERE id::text = $1`,
        [rendicion.id, rendidoCentavos, conteo ? JSON.stringify(conteo) : null, supervisorId]
      );
      await cerrarCircuito(client, rendicion);
      await auditar(client, rendicion.id, 'validacion', supervisorId, { estado: rendicion.estado }, { estado: 'validada', hojaDeRutaId: rendicion.hojaDeRutaId, declaradoCentavos: rendicion.declaradoCentavos, rendidoCentavos });
      return buscarRendicion(client, rendicion.id);
    });
  },

  /**
   * HU #49: registra el faltante o sobrante del conteo físico, con justificación escrita obligatoria.
   * La rendición queda "con diferencia", a la espera de la aprobación (HU #50).
   */
  async registrarDiferencia(supervisorId: number, id: string, body: any) {
    const { rendidoCentavos, conteo } = validarConteo(body?.rendidoCentavos, body?.conteo);
    return enTransaccion(async (client) => {
      const rendicion = await rendicionParaProcesar(client, id, ['pendiente', 'con_diferencia']);
      const diferencia = calcularDiferencia(rendicion.declaradoCentavos, rendidoCentavos);
      if (diferencia.tipo === 'coincide') {
        throw new RendicionError('El monto contado coincide con lo declarado: no hay diferencia para registrar. Aprobá la rendición.', 422, { codigo: 'SIN_DIFERENCIA' });
      }
      const justificacion = validarJustificacion(body?.justificacion, 'justificacion');
      await client.query(
        `UPDATE rendicion_efectivo
         SET estado = 'con_diferencia', rendido_centavos = $2, conteo_billetes = $3, motivo_diferencia = $4,
             diferencia_registrada_por = $5, diferencia_registrada_en = now()
         WHERE id::text = $1`,
        [rendicion.id, rendidoCentavos, conteo ? JSON.stringify(conteo) : null, justificacion, supervisorId]
      );
      await auditar(
        client, rendicion.id, 'modificacion', supervisorId,
        { estado: rendicion.estado, rendidoCentavos: rendicion.rendidoCentavos },
        { estado: 'con_diferencia', rendidoCentavos, ...diferencia },
        justificacion
      );
      return buscarRendicion(client, rendicion.id);
    });
  },

  /**
   * HU #50: aprueba la rendición con diferencia. Calcula el descuadre, lo deja asentado con su motivo
   * y cierra la hoja de ruta.
   */
  async aprobarConDiferencia(supervisorId: number, id: string, body: any) {
    const { rendidoCentavos, conteo } = validarConteo(body?.rendidoCentavos, body?.conteo);
    return enTransaccion(async (client) => {
      const rendicion = await rendicionParaProcesar(client, id, ['pendiente', 'con_diferencia']);
      const diferencia = calcularDiferencia(rendicion.declaradoCentavos, rendidoCentavos);
      if (diferencia.tipo === 'coincide') {
        throw new RendicionError('El monto contado coincide con lo declarado: aprobá la rendición sin diferencia.', 422, { codigo: 'SIN_DIFERENCIA' });
      }
      const motivo = validarJustificacion(body?.motivo, 'motivo');
      await client.query(
        `UPDATE rendicion_efectivo
         SET estado = 'validada', rendido_centavos = $2, conteo_billetes = $3, motivo_diferencia = $4,
             validado_por = $5, validado_en = now()
         WHERE id::text = $1`,
        [rendicion.id, rendidoCentavos, conteo ? JSON.stringify(conteo) : (rendicion.conteo ? JSON.stringify(rendicion.conteo) : null), motivo, supervisorId]
      );
      await cerrarCircuito(client, rendicion);
      await auditar(
        client, rendicion.id, 'validacion', supervisorId,
        { estado: rendicion.estado, rendidoCentavos: rendicion.rendidoCentavos },
        { estado: 'validada', hojaDeRutaId: rendicion.hojaDeRutaId, declaradoCentavos: rendicion.declaradoCentavos, rendidoCentavos, ...diferencia, descuadre: true },
        motivo
      );
      return buscarRendicion(client, rendicion.id);
    });
  },

  /**
   * Opción 1: Hojas de ruta finalizadas o en curso que pueden ser arqueadas por el supervisor en la web.
   */
  async listarHojasPendientes(filtros: { fecha?: string } = {}) {
    const params: unknown[] = [];
    let fechaCond = '';
    if (filtros.fecha) {
      params.push(filtros.fecha);
      fechaCond = `AND h.fecha_reparto = $1::date`;
    }
    const query = `
      SELECT h.id::text AS hoja_id, h.fecha_reparto, h.patente, h.estado AS hoja_estado,
             s.nombre AS sucursal,
             t.id::text AS transportista_id, t.nombre AS transportista_nombre
      FROM hoja_de_ruta h
      ${JOIN_HOJAS_CON_PARADAS}
      JOIN sucursal s ON s.id = h.sucursal_id
      LEFT JOIN usuario t ON t.id = h.transportista_id
      LEFT JOIN rendicion_efectivo re ON re.hoja_de_ruta_id = h.id AND re.estado <> 'anulada'
      WHERE h.estado IN (${ESTADOS_HOJA_OPERATIVOS_SQL})
        ${fechaCond}
        AND re.id IS NULL
      ORDER BY h.fecha_reparto DESC, h.id DESC
    `;
    const res = await db.query(query, params);
    const resultado = [];
    for (const row of res.rows) {
      const cobros = await cobrosEfectivoDeHoja(db, row.hoja_id);
      const pendientes = await visitasPendientes(db, row.hoja_id);
      resultado.push({
        hojaId: row.hoja_id,
        codigoHoja: `HR-${String(row.hoja_id).padStart(4, '0')}`,
        fechaReparto: aFecha(row.fecha_reparto),
        patente: row.patente ?? null,
        estadoHoja: row.hoja_estado,
        sucursal: row.sucursal,
        transportista: { id: row.transportista_id ?? '', nombre: row.transportista_nombre ?? 'Sin asignar' },
        efectivoCobradoCentavos: cobros.reduce((acc, c) => acc + c.importeCentavos, 0),
        cantidadCobrosEfectivo: cobros.length,
        visitasPendientesCount: pendientes.length,
        visitasPendientes: pendientes,
      });
    }
    return resultado;
  },

  /**
   * Automatización: busca hojas de ruta operativas con todas sus paradas terminadas y genera
   * automáticamente la rendición en 'pendiente' para que aparezca directo en la bandeja del supervisor.
   */
  async asegurarArqueosAutomaticos() {
    try {
      // Solo hojas despachadas y con paradas: una hoja en borrador o vacía no tiene pendientes,
      // pero tampoco tiene nada que rendir.
      const query = `
        SELECT h.id::text AS hoja_id, h.transportista_id
        FROM hoja_de_ruta h
        ${JOIN_HOJAS_CON_PARADAS}
        LEFT JOIN rendicion_efectivo re ON re.hoja_de_ruta_id = h.id AND re.estado <> 'anulada'
        WHERE h.estado IN (${ESTADOS_HOJA_OPERATIVOS_SQL})
          AND re.id IS NULL
      `;
      const res = await db.query(query);
      for (const row of res.rows) {
        const pendientes = await visitasPendientes(db, row.hoja_id);
        if (pendientes.length === 0) {
          try {
            const transportistaId = row.transportista_id ? Number(row.transportista_id) : 1;
            await this.iniciarArqueo(transportistaId, { hojaDeRutaId: row.hoja_id, automatico: true });
          } catch {
            // Ignorar si se procesó concurrentemente
          }
        }
      }
    } catch (e) {
      console.error('Error al asegurar arqueos automáticos:', e);
    }
  },

  /**
   * Opción 1 & Opción B: Inicio de arqueo (automático o manual por el supervisor).
   * Permite 'forzar: true' para casos de contingencia con paradas pendientes.
   */
  async iniciarArqueo(supervisorId: number, body: { hojaDeRutaId: string; declaradoCentavos?: number; forzar?: boolean; automatico?: boolean }) {
    const hojaId = String(body?.hojaDeRutaId ?? '');
    if (!/^[1-9]\d*$/.test(hojaId)) throw new RendicionError('Hoja de ruta inválida.', 400);

    return enTransaccion(async (client) => {
      const hojaRes = await client.query(
        `SELECT h.id::text AS id, h.estado, h.transportista_id, t.nombre AS transportista_nombre
         FROM hoja_de_ruta h
         LEFT JOIN usuario t ON t.id = h.transportista_id
         WHERE h.id::text = $1`,
        [hojaId]
      );
      const hoja = hojaRes.rows[0];
      if (!hoja) throw new RendicionError('La hoja de ruta no existe.', 404);
      if (hoja.estado === 'cerrada') {
        throw new RendicionError('La hoja de ruta ya está cerrada: no admite una nueva rendición.', 409, { estadoHoja: hoja.estado });
      }
      if (hoja.estado === 'anulada') {
        throw new RendicionError('La hoja de ruta está anulada.', 409, { estadoHoja: hoja.estado });
      }
      // Ni siquiera forzando: una hoja que no salió a la calle o no tiene paradas no tiene efectivo que rendir,
      // y aprobar su arqueo la cerraría mientras se está armando.
      if (!ESTADOS_HOJA_OPERATIVOS.includes(hoja.estado)) {
        throw new RendicionError('La hoja de ruta todavía no fue despachada: no tiene efectivo para arquear.', 409, { estadoHoja: hoja.estado });
      }
      const paradas = await client.query(`SELECT id FROM visita WHERE hoja_de_ruta_id::text = $1 LIMIT 1`, [hojaId]);
      if (paradas.rows.length === 0) {
        throw new RendicionError('La hoja de ruta no tiene paradas: no hay efectivo para arquear.', 409, { estadoHoja: hoja.estado });
      }

      // Verificar que no haya otra rendición activa
      const existente = await client.query(
        `SELECT id::text AS id FROM rendicion_efectivo WHERE hoja_de_ruta_id::text = $1 AND estado <> 'anulada'`,
        [hojaId]
      );
      if (existente.rows[0]) {
        throw new RendicionError('Ya existe un arqueo o rendición activa para esta hoja de ruta.', 409);
      }

      // Visitas pendientes: se bloquea salvo que se indique explícitamente forzar
      const pendientes = await visitasPendientes(client, hojaId);
      if (pendientes.length > 0 && !body?.forzar) {
        throw new RendicionError(
          `No se puede iniciar el arqueo: la hoja de ruta tiene ${pendientes.length} visita(s) pendiente(s).`,
          409,
          { codigo: 'VISITAS_PENDIENTES', visitasPendientes: pendientes }
        );
      }

      const cobros = await cobrosEfectivoDeHoja(client, hojaId);
      const efectivoCobrado = cobros.reduce((suma, c) => suma + c.importeCentavos, 0);
      const declarado = body?.declaradoCentavos !== undefined && body?.declaradoCentavos !== null
        ? Number(body.declaradoCentavos)
        : efectivoCobrado;

      if (declarado < 0 || !Number.isSafeInteger(declarado)) {
        throw new RendicionError('El monto declarado no puede ser negativo.', 422, { campo: 'declaradoCentavos' });
      }

      const clave = crypto.randomUUID();
      const transportistaId = hoja.transportista_id ? Number(hoja.transportista_id) : supervisorId;
      const insert = await client.query(
        `INSERT INTO rendicion_efectivo (hoja_de_ruta_id, transportista_id, declarado_centavos, declarado_en, clave_idempotencia, estado)
         VALUES ($1, $2, $3, now(), $4, 'pendiente')
         RETURNING id::text AS id`,
        [hojaId, transportistaId, declarado, clave]
      );
      const id = insert.rows[0].id;
      await client.query(
        `UPDATE cobro SET rendicion_id = $1
         WHERE medio_pago = 'efectivo'
           AND visita_id IN (SELECT id FROM visita WHERE hoja_de_ruta_id::text = $2)`,
        [id, hojaId]
      );
      await auditar(client, id, 'alta', supervisorId, null, {
        hojaDeRutaId: hojaId,
        declaradoCentavos: declarado,
        iniciadoAutomatico: !!body?.automatico,
        forzadoConVisitasPendientes: pendientes.length > 0 && !!body?.forzar,
      });
      return { rendicion: await buscarRendicion(client, id) };
    });
  },
};

/**
 * Aplica la migración de la Épica 2.3 al iniciar el servidor (es idempotente).
 * Usa una conexión propia: si falla a mitad de camino, el ROLLBACK evita devolver al pool
 * una conexión con la transacción abortada, que haría fallar las consultas siguientes.
 */
export async function asegurarEsquemaRendicion(): Promise<void> {
  const archivo = new URL('../../db/migrations/007_rendicion_efectivo.sql', import.meta.url);
  if (!fs.existsSync(archivo)) return;
  const client = await db.getPool().connect();
  try {
    await client.query(fs.readFileSync(archivo, 'utf-8'));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
