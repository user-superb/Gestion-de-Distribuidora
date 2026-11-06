import { PoolClient } from 'pg';
import { db } from '../db.js';

export function esRolGlobal(rol?: string | null): boolean {
  if (!rol) return false;
  const normalizado = rol.trim().toLowerCase();
  return (
    normalizado === 'ceo' ||
    normalizado === 'gerente' ||
    normalizado === 'director' ||
    normalizado === 'administrador del sistema'
  );
}

export class ConciliacionError extends Error {
  constructor(
    message: string,
    public status = 422,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export interface ArchivoImportacion {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

export interface MovimientoExtractoParseado {
  fila: number;
  fechaHora: Date;
  fechaClave: string;
  concepto: string;
  ordenante: string;
  ordenanteCuit: string | null;
  importeCentavos: bigint;
  referenciaExterna: string;
  cbuFila?: string;
  cuentaFila?: string;
  monedaFila?: string;
}

interface MetadataExtracto {
  cbu?: string;
  numeroCuenta?: string;
  moneda?: string;
  alias?: string;
}

function normalizarEncabezado(valor: string): string {
  return valor
    .replace(/^\uFEFF/, '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function dividirLineaDelimited(linea: string, delimitador: string): string[] {
  const resultado: string[] = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const char = linea[i];
    if (char === '"') {
      if (enComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        enComillas = !enComillas;
      }
    } else if (char === delimitador && !enComillas) {
      resultado.push(actual.trim());
      actual = '';
    } else {
      actual += char;
    }
  }
  resultado.push(actual.trim());
  return resultado;
}

function detectarDelimitador(linea: string): string {
  const candidatos = [';', ',', '\t'];
  let mejor = ',';
  let max = -1;
  for (const delim of candidatos) {
    const partes = dividirLineaDelimited(linea, delim);
    if (partes.length > max) {
      max = partes.length;
      mejor = delim;
    }
  }
  return mejor;
}

function parsearFechaExtracto(raw: string): { fechaHora: Date; fechaClave: string } | null {
  const limpio = raw.trim();
  if (!limpio) return null;

  // Formato ISO o YYYY-MM-DD[ HH:mm[:ss]]
  const isoMatch = limpio.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (isoMatch) {
    const [, y, m, d, hh = '12', mm = '00', ss = '00'] = isoMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const date = new Date(Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss)));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return { fechaHora: date, fechaClave: `${y}-${m}-${d}` };
    }
    return null;
  }

  // Formato DD/MM/YYYY o DD-MM-YYYY [HH:mm[:ss]]
  const arMatch = limpio.match(/^(\d{2})[/-](\d{2})[/-](\d{4})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (arMatch) {
    const [, d, m, y, hh = '12', mm = '00', ss = '00'] = arMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const date = new Date(Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss)));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return { fechaHora: date, fechaClave: `${y}-${m}-${d}` };
    }
    return null;
  }

  return null;
}

function parsearImporteCentavos(raw: string): bigint | null {
  let limpio = raw.trim().replace(/[$ARSUSD\s]/gi, '');
  if (!limpio) return null;
  // No se admiten signos negativos ni cero para ingresos bancarios
  if (limpio.startsWith('-')) return null;
  limpio = limpio.replace(/^\+/, '');

  // Determinar separador decimal: si tiene ',' y '.', el último es el decimal
  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');

  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    if (ultimaComa > ultimoPunto) {
      // Formato 15.700,50
      limpio = limpio.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato 15,700.50
      limpio = limpio.replace(/,/g, '');
    }
  } else if (ultimaComa !== -1) {
    // Formato 15700,50
    limpio = limpio.replace(',', '.');
  } else if (ultimoPunto !== -1) {
    // Si hay más de un punto (ej: 15.700.000), son separadores de miles
    const partes = limpio.split('.');
    if (partes.length > 2) {
      limpio = partes.join('');
    }
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(limpio)) return null;
  const [entero, decimal = ''] = limpio.split('.');
  const centavosStr = decimal.padEnd(2, '0');
  const centavos = BigInt(entero) * 100n + BigInt(centavosStr);
  return centavos > 0n ? centavos : null;
}

function extraerFilasDeTexto(contenido: string): { metadata: MetadataExtracto; filas: string[][] } {
  const metadata: MetadataExtracto = {};
  const trimmed = contenido.trim();

  // Soporte de tabla XML/HTML de XLS bancario estándar si el archivo exportado por el banco es HTML/XML
  if (/^<(?:!DOCTYPE|html|table|\?xml)/i.test(trimmed)) {
    const filas: string[][] = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trRegex.exec(trimmed)) !== null) {
      const celdas: string[] = [];
      const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
        const textoCelda = tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
        celdas.push(textoCelda);
      }
      if (celdas.some((c) => c.length > 0)) filas.push(celdas);
    }
    return { metadata, filas };
  }

  const lineasBrutas = contenido.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lineasDatos: string[] = [];

  for (const linea of lineasBrutas) {
    const sinBom = linea.replace(/^\uFEFF/, '').trim();
    if (!sinBom) continue;

    // Detectar metadatos de cabecera del extracto (ej: "# CBU: 2850...", "CBU;2850...", "MONEDA: ARS", "CUENTA: ...")
    const metaMatch = sinBom.match(/^(?:#\s*)?(cbu|nro_cuenta|numero_cuenta|cuenta|moneda|divisa|alias)\s*[:=;,\t]\s*([^\r\n;,\t]+)/i);
    if (metaMatch && lineasDatos.length === 0) {
      const clave = normalizarEncabezado(metaMatch[1]);
      const valor = metaMatch[2].trim();
      if (clave === 'cbu') metadata.cbu = valor;
      else if (clave === 'moneda' || clave === 'divisa') metadata.moneda = valor.toUpperCase();
      else if (clave === 'alias') metadata.alias = valor;
      else metadata.numeroCuenta = valor;
      continue;
    }

    if (sinBom.startsWith('#')) continue;
    lineasDatos.push(sinBom);
  }

  if (lineasDatos.length === 0) return { metadata, filas: [] };
  const delimitador = detectarDelimitador(lineasDatos[0]);
  const filas = lineasDatos.map((l) => dividirLineaDelimited(l, delimitador));
  return { metadata, filas };
}

function parsearArchivoExtracto(archivo: ArchivoImportacion): { metadata: MetadataExtracto; movimientos: MovimientoExtractoParseado[] } {
  const nombre = (archivo.originalname || '').trim().toLowerCase();
  const extensionValida = nombre.endsWith('.csv') || nombre.endsWith('.xls') || nombre.endsWith('.xlsx');
  if (!extensionValida) {
    throw new ConciliacionError(
      'El formato del archivo no es válido. Solo se admiten extractos bancarios en formato .CSV o .XLS.',
      400,
      { errorCode: 'FORMATO_ARCHIVO_INVALIDO' }
    );
  }

  if (!archivo.buffer || archivo.buffer.length === 0 || archivo.size <= 0) {
    throw new ConciliacionError(
      'El archivo de extracto bancario está vacío o dañado.',
      400,
      { errorCode: 'FORMATO_ARCHIVO_INVALIDO' }
    );
  }

  // Detectar bytes nulos o binarios corruptos no legibles
  if (archivo.buffer.includes(0x00)) {
    throw new ConciliacionError(
      'El archivo contiene datos corruptos o codificación binaria no soportada.',
      400,
      { errorCode: 'FORMATO_ARCHIVO_INVALIDO' }
    );
  }

  const contenido = archivo.buffer.toString('utf-8');
  if (contenido.includes('\uFFFD')) {
    throw new ConciliacionError(
      'El archivo presenta errores de codificación o caracteres corruptos. Utilizá codificación UTF-8.',
      400,
      { errorCode: 'FORMATO_ARCHIVO_INVALIDO' }
    );
  }

  const { metadata, filas } = extraerFilasDeTexto(contenido);
  if (filas.length < 2) {
    throw new ConciliacionError(
      'El extracto bancario no contiene encabezados o registros de movimientos válidos.',
      400,
      { errorCode: 'ESTRUCTURA_ARCHIVO_INVALIDA' }
    );
  }

  const encabezados = filas[0].map(normalizarEncabezado);
  const buscarColumna = (aliasList: string[]) => encabezados.findIndex((h) => aliasList.includes(h));

  const idxFecha = buscarColumna(['fecha', 'fecha_hora', 'fecha_movimiento', 'fecha_operacion', 'fecha_valor']);
  const idxConcepto = buscarColumna(['concepto', 'descripcion', 'detalle', 'motivo']);
  const idxImporte = buscarColumna(['importe', 'monto', 'importe_pesos', 'credito', 'valor']);
  const idxReferencia = buscarColumna(['referencia', 'referencia_externa', 'id_transaccion', 'nro_transaccion', 'id_movimiento', 'comprobante', 'numero_operacion']);
  const idxOrdenante = buscarColumna(['ordenante', 'cliente', 'razon_social', 'origen', 'titular_origen']);
  const idxCuit = buscarColumna(['cuit', 'ordenante_cuit', 'cuit_ordenante', 'cuit_origen']);
  const idxCbu = buscarColumna(['cbu', 'cbu_cuenta', 'cbu_destino', 'cuenta_cbu']);
  const idxCuenta = buscarColumna(['cuenta', 'nro_cuenta', 'numero_cuenta', 'cuenta_destino']);
  const idxMoneda = buscarColumna(['moneda', 'divisa', 'currency']);

  const faltantes: string[] = [];
  if (idxFecha === -1) faltantes.push('fecha');
  if (idxConcepto === -1) faltantes.push('concepto');
  if (idxImporte === -1) faltantes.push('importe');
  if (idxReferencia === -1) faltantes.push('referencia');

  if (faltantes.length > 0) {
    throw new ConciliacionError(
      `El archivo no respeta la estructura mínima obligatoria. Faltan las columnas: ${faltantes.join(', ')}.`,
      400,
      { errorCode: 'ESTRUCTURA_ARCHIVO_INVALIDA', columnasFaltantes: faltantes }
    );
  }

  const movimientos: MovimientoExtractoParseado[] = [];
  const numColumnasEsperadas = filas[0].length;

  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i];
    const nroFila = i + 1;

    if (fila.every((celda) => !celda.trim())) continue;

    if (fila.length < 4 || fila.length > numColumnasEsperadas + 2) {
      throw new ConciliacionError(
        `Error de formato en la fila ${nroFila}: la estructura de columnas está corrupta o incompleta.`,
        400,
        { errorCode: 'DATOS_CORRUPTOS', fila: nroFila }
      );
    }

    const rawFecha = fila[idxFecha] || '';
    const rawConcepto = (fila[idxConcepto] || '').trim();
    const rawImporte = fila[idxImporte] || '';
    const rawReferencia = (fila[idxReferencia] || '').trim();
    const rawOrdenante = idxOrdenante !== -1 ? (fila[idxOrdenante] || '').trim() : '';
    const rawCuit = idxCuit !== -1 ? (fila[idxCuit] || '').replace(/\D/g, '') : '';
    const rawCbu = idxCbu !== -1 ? (fila[idxCbu] || '').trim() : undefined;
    const rawCuenta = idxCuenta !== -1 ? (fila[idxCuenta] || '').trim() : undefined;
    const rawMoneda = idxMoneda !== -1 ? (fila[idxMoneda] || '').trim().toUpperCase() : undefined;

    const fechaParsed = parsearFechaExtracto(rawFecha);
    if (!fechaParsed) {
      throw new ConciliacionError(
        `Datos corruptos o inválidos en la fila ${nroFila}: la fecha "${rawFecha}" no tiene un formato válido.`,
        400,
        { errorCode: 'DATOS_CORRUPTOS', fila: nroFila }
      );
    }

    if (!rawConcepto) {
      throw new ConciliacionError(
        `Datos incompletos en la fila ${nroFila}: el campo concepto es obligatorio.`,
        400,
        { errorCode: 'DATOS_CORRUPTOS', fila: nroFila }
      );
    }

    const importeCentavos = parsearImporteCentavos(rawImporte);
    if (importeCentavos === null) {
      throw new ConciliacionError(
        `Datos corruptos o inválidos en la fila ${nroFila}: el importe "${rawImporte}" no es un monto positivo válido.`,
        400,
        { errorCode: 'DATOS_CORRUPTOS', fila: nroFila }
      );
    }

    if (rawCuit && rawCuit.length !== 11) {
      throw new ConciliacionError(
        `Datos inválidos en la fila ${nroFila}: el CUIT del ordenante debe tener 11 dígitos.`,
        400,
        { errorCode: 'DATOS_CORRUPTOS', fila: nroFila }
      );
    }

    const referenciaFinal = rawReferencia || `REF-${fechaParsed.fechaClave}-${importeCentavos.toString()}-${normalizarNombre(rawConcepto).slice(0, 20)}`;
    const ordenanteFinal = rawOrdenante || rawConcepto;

    movimientos.push({
      fila: nroFila,
      fechaHora: fechaParsed.fechaHora,
      fechaClave: fechaParsed.fechaClave,
      concepto: rawConcepto,
      ordenante: ordenanteFinal,
      ordenanteCuit: rawCuit || null,
      importeCentavos,
      referenciaExterna: referenciaFinal,
      cbuFila: rawCbu || undefined,
      cuentaFila: rawCuenta || undefined,
      monedaFila: rawMoneda || undefined,
    });
  }

  if (movimientos.length === 0) {
    throw new ConciliacionError(
      'El extracto bancario no contiene registros de movimientos para procesar.',
      400,
      { errorCode: 'ESTRUCTURA_ARCHIVO_INVALIDA' }
    );
  }

  return { metadata, movimientos };
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

function fechaActualArgentina(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function validarComprobanteAdjunto(archivo: ArchivoImportacion | null): ArchivoImportacion {
  if (!archivo || !archivo.buffer || archivo.size < 1) {
    throw new ConciliacionError(
      'El comprobante de respaldo es obligatorio para registrar manualmente una transferencia.',
      400,
      { errorCode: 'COMPROBANTE_OBLIGATORIO', camposInvalidos: ['comprobante'] }
    );
  }
  const mime = (archivo.mimetype || '').toLowerCase();
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mime) || archivo.size > 5 * 1024 * 1024) {
    throw new ConciliacionError(
      'El comprobante de respaldo debe ser un archivo PDF, JPG o PNG y no superar 5 MB.',
      400,
      { errorCode: 'COMPROBANTE_INVALIDO', camposInvalidos: ['comprobante'] }
    );
  }
  const firma = archivo.buffer.subarray(0, 8);
  const formatoValido =
    mime === 'application/pdf'
      ? firma.subarray(0, 4).toString() === '%PDF'
      : mime === 'image/png'
        ? firma.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : firma[0] === 0xff && firma[1] === 0xd8 && firma[2] === 0xff;
  if (!formatoValido) {
    throw new ConciliacionError(
      'El contenido del comprobante adjunto no coincide con su formato (PDF, JPG o PNG).',
      400,
      { errorCode: 'COMPROBANTE_INVALIDO', camposInvalidos: ['comprobante'] }
    );
  }
  return archivo;
}

export const conciliacionService = {
  async getComerciosParaConciliacion() {
    const res = await db.query(
      `SELECT id::text AS id, razon_social, nombre_fantasia, cuit
       FROM comercio
       WHERE activo = true
       ORDER BY razon_social`
    );
    return res.rows.map((r: any) => ({
      id: String(r.id),
      razon_social: String(r.razon_social || '').trim(),
      nombre_fantasia: r.nombre_fantasia ? String(r.nombre_fantasia).trim() : null,
      cuit: r.cuit ? String(r.cuit).trim() : null,
    }));
  },

  async getCuentasRecepcionParaExtracto(usuarioId: number, rol: string) {
    const isAdminSistema = rol === 'Administrador del sistema' || rol === 'Gerente';
    const query = isAdminSistema
      ? `SELECT cr.id::text AS id, cr.sucursal_id::text AS sucursal_id, s.nombre AS sucursal,
                cr.nombre_fantasia, cr.alias, cr.cbu, cr.banco, COALESCE(cr.moneda, 'ARS') AS moneda
         FROM cuenta_recepcion cr
         JOIN sucursal s ON s.id = cr.sucursal_id
         WHERE cr.activa = true AND s.activa = true
         ORDER BY s.nombre, cr.alias`
      : `SELECT cr.id::text AS id, cr.sucursal_id::text AS sucursal_id, s.nombre AS sucursal,
                cr.nombre_fantasia, cr.alias, cr.cbu, cr.banco, COALESCE(cr.moneda, 'ARS') AS moneda
         FROM cuenta_recepcion cr
         JOIN sucursal s ON s.id = cr.sucursal_id
         JOIN usuario_sucursal us ON us.sucursal_id = cr.sucursal_id
         WHERE us.usuario_id = $1 AND cr.activa = true AND s.activa = true
         ORDER BY s.nombre, cr.alias`;
    const res = await db.query(query, isAdminSistema ? [] : [usuarioId]);
    return res.rows.map((r: any) => ({
      ...r,
      cbu: r.cbu ? String(r.cbu).trim() : null,
    }));
  },

  async importarExtractoBancario(cuentaIdValue: unknown, archivo: ArchivoImportacion | null, usuarioId: number) {
    const cuentaId = Number(cuentaIdValue);
    if (!Number.isSafeInteger(cuentaId) || cuentaId <= 0) {
      throw new ConciliacionError('Seleccioná una cuenta bancaria de recepción válida para importar el extracto.', 400, {
        errorCode: 'CUENTA_NO_IDENTIFICADA',
      });
    }
    if (!archivo) {
      throw new ConciliacionError('Adjuntá un archivo de extracto bancario (.CSV o .XLS).', 400, {
        errorCode: 'FORMATO_ARCHIVO_INVALIDO',
      });
    }

    // 1. Parsear y validar estructura del archivo ANTES de abrir o persistir en BD (Escenario 2)
    const { metadata, movimientos } = parsearArchivoExtracto(archivo);

    return enTransaccion(async (client) => {
      // 2. Validar existencia y vigencia de la cuenta receptora seleccionada (Escenario 3)
      const cuentaRes = await client.query(
        `SELECT cr.id, cr.sucursal_id, cr.alias, cr.cbu, cr.banco, cr.moneda, cr.activa,
                s.activa AS sucursal_activa, s.nombre AS sucursal_nombre
         FROM cuenta_recepcion cr
         JOIN sucursal s ON s.id = cr.sucursal_id
         WHERE cr.id = $1`,
        [cuentaId]
      );

      if (!cuentaRes.rowCount) {
        throw new ConciliacionError(
          'La cuenta bancaria de recepción seleccionada no existe o no fue identificada en el sistema.',
          422,
          { errorCode: 'CUENTA_NO_IDENTIFICADA' }
        );
      }

      const cuenta = cuentaRes.rows[0];
      if (!cuenta.activa || !cuenta.sucursal_activa) {
        throw new ConciliacionError(
          'La cuenta de recepción seleccionada o su sucursal se encuentra inactiva y no admite importaciones.',
          422,
          { errorCode: 'CUENTA_INCONSISTENTE' }
        );
      }

      const cbuCuenta = (cuenta.cbu || '').trim();
      const aliasCuenta = (cuenta.alias || '').trim().toLowerCase();
      const monedaCuenta = (cuenta.moneda || 'ARS').trim().toUpperCase();

      const coincideNumeroCuenta = (valorArchivo: string) => {
        const limpio = valorArchivo.trim();
        const soloDigitos = limpio.replace(/\D/g, '');
        if (limpio.toLowerCase() === aliasCuenta) return true;
        if (cbuCuenta && limpio === cbuCuenta) return true;
        // En CBU argentino, los últimos 14 dígitos corresponden al bloque de número de cuenta + verificador
        if (cbuCuenta && soloDigitos.length >= 6 && cbuCuenta.includes(soloDigitos)) return true;
        return false;
      };

      // Validar metadatos de cabecera del extracto contra la cuenta destino (Escenario 3)
      if (metadata.cbu) {
        const cbuArchivo = metadata.cbu.replace(/\D/g, '');
        if (!cbuCuenta || cbuArchivo !== cbuCuenta) {
          throw new ConciliacionError(
            `El CBU informado en el extracto (${metadata.cbu}) no coincide con el CBU de la cuenta de recepción seleccionada (${cbuCuenta || 'sin CBU'}).`,
            422,
            { errorCode: 'CUENTA_INCONSISTENTE', detalle: 'cbu' }
          );
        }
      }

      if (metadata.numeroCuenta && !coincideNumeroCuenta(metadata.numeroCuenta)) {
        throw new ConciliacionError(
          `El número de cuenta o identificador del extracto (${metadata.numeroCuenta}) no corresponde a la cuenta de recepción seleccionada (${cuenta.alias}).`,
          422,
          { errorCode: 'CUENTA_INCONSISTENTE', detalle: 'numero_cuenta' }
        );
      }

      if (metadata.alias && metadata.alias.trim().toLowerCase() !== aliasCuenta) {
        throw new ConciliacionError(
          `El alias del extracto (${metadata.alias}) no coincide con la cuenta de recepción seleccionada (${cuenta.alias}).`,
          422,
          { errorCode: 'CUENTA_INCONSISTENTE', detalle: 'alias' }
        );
      }

      if (metadata.moneda && metadata.moneda.toUpperCase() !== monedaCuenta) {
        throw new ConciliacionError(
          `La moneda del extracto (${metadata.moneda}) no coincide con la moneda configurada en la cuenta de recepción (${monedaCuenta}).`,
          422,
          { errorCode: 'CUENTA_INCONSISTENTE', detalle: 'moneda' }
        );
      }

      // Validar también columnas por fila si el extracto incluye CBU, cuenta o moneda en cada registro (Escenario 3)
      for (const mov of movimientos) {
        if (mov.cbuFila) {
          const cbuFilaLimpio = mov.cbuFila.replace(/\D/g, '');
          if (!cbuCuenta || cbuFilaLimpio !== cbuCuenta) {
            throw new ConciliacionError(
              `Inconsistencia en la fila ${mov.fila}: el CBU del movimiento (${mov.cbuFila}) no coincide con el CBU de la cuenta seleccionada (${cbuCuenta || 'sin CBU'}).`,
              422,
              { errorCode: 'CUENTA_INCONSISTENTE', detalle: 'cbu', fila: mov.fila }
            );
          }
        }
        if (mov.cuentaFila && !coincideNumeroCuenta(mov.cuentaFila)) {
          throw new ConciliacionError(
            `Inconsistencia en la fila ${mov.fila}: la cuenta del movimiento (${mov.cuentaFila}) no corresponde a la cuenta seleccionada (${cuenta.alias}).`,
            422,
            { errorCode: 'CUENTA_INCONSISTENTE', detalle: 'numero_cuenta', fila: mov.fila }
          );
        }
        if (mov.monedaFila && mov.monedaFila !== monedaCuenta) {
          throw new ConciliacionError(
            `Inconsistencia en la fila ${mov.fila}: la moneda del movimiento (${mov.monedaFila}) no coincide con la moneda de la cuenta seleccionada (${monedaCuenta}).`,
            422,
            { errorCode: 'CUENTA_INCONSISTENTE', detalle: 'moneda', fila: mov.fila }
          );
        }
      }

      // 3. Consultar movimientos existentes en la cuenta para garantizar idempotencia por referencia_externa o (fecha, importe, referencia) (Escenario 1)
      const existentesRes = await client.query(
        `SELECT id::text AS id, referencia_externa, importe_centavos::text AS importe_centavos, fecha_hora
         FROM movimiento_bancario
         WHERE cuenta_id = $1`,
        [cuentaId]
      );

      const referenciasExistentes = new Set<string>();
      const clavesCompuestasExistentes = new Set<string>();

      for (const row of existentesRes.rows) {
        const ref = (row.referencia_externa || '').trim().toLowerCase();
        if (ref) referenciasExistentes.add(ref);
        const fechaIso = row.fecha_hora ? new Date(row.fecha_hora).toISOString().slice(0, 10) : '';
        const claveCompuesta = `${fechaIso}|${row.importe_centavos}|${ref}`;
        clavesCompuestasExistentes.add(claveCompuesta);
      }

      let insertados = 0;
      let omitidosDuplicados = 0;
      const movimientosInsertados: Array<{
        id: string;
        referencia_externa: string;
        importe_centavos: string;
        ordenante: string;
        fecha_hora: string;
      }> = [];

      for (const mov of movimientos) {
        const refNorm = mov.referenciaExterna.trim().toLowerCase();
        const claveCompuesta = `${mov.fechaClave}|${mov.importeCentavos.toString()}|${refNorm}`;

        if (referenciasExistentes.has(refNorm) || clavesCompuestasExistentes.has(claveCompuesta)) {
          omitidosDuplicados++;
          continue;
        }

        const insertRes = await client.query(
          `INSERT INTO movimiento_bancario
             (cuenta_id, fecha_hora, ordenante, ordenante_cuit, concepto, referencia_externa, importe_centavos, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'sin_imputar')
           RETURNING id::text AS id, fecha_hora`,
          [
            cuentaId,
            mov.fechaHora,
            mov.ordenante,
            mov.ordenanteCuit,
            mov.concepto,
            mov.referenciaExterna,
            mov.importeCentavos.toString(),
          ]
        );

        referenciasExistentes.add(refNorm);
        clavesCompuestasExistentes.add(claveCompuesta);
        insertados++;

        movimientosInsertados.push({
          id: insertRes.rows[0].id,
          referencia_externa: mov.referenciaExterna,
          importe_centavos: mov.importeCentavos.toString(),
          ordenante: mov.ordenante,
          fecha_hora: new Date(insertRes.rows[0].fecha_hora).toISOString(),
        });
      }

      await client.query(
        `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
         VALUES ('cuenta_recepcion', $1, 'importacion_extracto', $2, $3::jsonb, $4)`,
        [
          cuentaId,
          usuarioId,
          JSON.stringify({
            archivo: archivo.originalname,
            totalProcesados: movimientos.length,
            insertados,
            omitidosDuplicados,
          }),
          `Importación de extracto bancario (${insertados} insertados, ${omitidosDuplicados} duplicados omitidos)`,
        ]
      );

      return {
        cuentaId: String(cuentaId),
        cuentaAlias: cuenta.alias,
        moneda: monedaCuenta,
        archivo: archivo.originalname,
        totalProcesados: movimientos.length,
        insertados,
        omitidosDuplicados,
        movimientosInsertados,
        mensaje: `Importación finalizada: ${insertados} movimiento(s) nuevo(s) insertado(s) y ${omitidosDuplicados} registro(s) duplicado(s) omitido(s).`,
      };
    });
  },

  async registrarTransferenciaManual(
    payload: {
      cuentaId?: unknown;
      fechaContable?: unknown;
      importe?: unknown;
      numeroOperacion?: unknown;
      ordenante?: unknown;
      ordenanteCuit?: unknown;
      concepto?: unknown;
    },
    archivo: ArchivoImportacion | null,
    usuarioId: number
  ) {
    const cuentaId = Number(payload.cuentaId);
    if (!Number.isSafeInteger(cuentaId) || cuentaId <= 0) {
      throw new ConciliacionError(
        'Seleccioná una cuenta bancaria de recepción activa.',
        400,
        { errorCode: 'CUENTA_INVALIDA', camposInvalidos: ['cuentaId'] }
      );
    }

    const rawFecha = String(payload.fechaContable ?? '').trim();
    const fechaParsed = parsearFechaExtracto(rawFecha);
    const hoyClave = fechaActualArgentina();
    if (!fechaParsed) {
      throw new ConciliacionError(
        'Ingresá una fecha contable válida.',
        400,
        { errorCode: 'FECHA_INVALIDA', camposInvalidos: ['fechaContable'] }
      );
    }
    if (fechaParsed.fechaClave > hoyClave) {
      throw new ConciliacionError(
        'No se admiten movimientos bancarios anticipados: la fecha contable no puede ser posterior al día de la carga.',
        422,
        { errorCode: 'FECHA_CONTABLE_FUTURA', camposInvalidos: ['fechaContable'] }
      );
    }

    const rawImporte = String(payload.importe ?? '').trim();
    const importeCentavos = parsearImporteCentavos(rawImporte);
    if (importeCentavos === null || importeCentavos <= 0n) {
      throw new ConciliacionError(
        'El importe debe ser un monto positivo mayor a cero.',
        422,
        { errorCode: 'IMPORTE_INVALIDO', camposInvalidos: ['importe'] }
      );
    }

    const numeroOperacion = String(payload.numeroOperacion ?? '').trim();
    if (!numeroOperacion) {
      throw new ConciliacionError(
        'El número de operación o referencia bancaria es obligatorio.',
        400,
        { errorCode: 'OPERACION_OBLIGATORIA', camposInvalidos: ['numeroOperacion'] }
      );
    }

    const rawCuit = String(payload.ordenanteCuit ?? '').replace(/\D/g, '');
    if (rawCuit && rawCuit.length !== 11) {
      throw new ConciliacionError(
        'El CUIT del ordenante debe contener exactamente 11 dígitos.',
        400,
        { errorCode: 'CUIT_INVALIDO', camposInvalidos: ['ordenanteCuit'] }
      );
    }

    const comprobanteValido = validarComprobanteAdjunto(archivo);
    const conceptoFinal = String(payload.concepto ?? '').trim() || 'Transferencia bancaria manual';
    const ordenanteFinal = String(payload.ordenante ?? '').trim() || conceptoFinal;

    return enTransaccion(async (client) => {
      const cuentaRes = await client.query(
        `SELECT cr.id, cr.sucursal_id, cr.alias, cr.cbu, cr.banco, cr.moneda, cr.activa,
                s.activa AS sucursal_activa
         FROM cuenta_recepcion cr
         JOIN sucursal s ON s.id = cr.sucursal_id
         WHERE cr.id = $1`,
        [cuentaId]
      );

      if (!cuentaRes.rowCount) {
        throw new ConciliacionError(
          'La cuenta de recepción seleccionada no existe.',
          422,
          { errorCode: 'CUENTA_NO_IDENTIFICADA', camposInvalidos: ['cuentaId'] }
        );
      }

      const cuenta = cuentaRes.rows[0];
      if (!cuenta.activa || !cuenta.sucursal_activa) {
        throw new ConciliacionError(
          'La cuenta de recepción seleccionada se encuentra inactiva y no admite cargas manuales.',
          422,
          { errorCode: 'CUENTA_INACTIVA', camposInvalidos: ['cuentaId'] }
        );
      }

      // Verificar que el número de operación/referencia no exista en la misma cuenta de recepción (Escenario 3)
      const dupRes = await client.query(
        `SELECT id::text AS id, referencia_externa
         FROM movimiento_bancario
         WHERE cuenta_id = $1 AND referencia_externa IS NOT NULL`,
        [cuentaId]
      );

      const opNormalizada = numeroOperacion.trim().toLowerCase();
      const existeDuplicado = dupRes.rows.some(
        (r: any) => String(r.referencia_externa || '').trim().toLowerCase() === opNormalizada
      );

      if (existeDuplicado) {
        throw new ConciliacionError(
          `El número de operación o referencia bancaria "${numeroOperacion}" ya se encuentra registrado en la cuenta "${cuenta.alias}". No se admiten duplicaciones contables.`,
          409,
          { errorCode: 'OPERACION_BANCARIA_DUPLICADA', camposInvalidos: ['numeroOperacion'] }
        );
      }

      const insertRes = await client.query(
        `INSERT INTO movimiento_bancario
           (cuenta_id, fecha_hora, ordenante, ordenante_cuit, concepto, referencia_externa, importe_centavos, origen, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Carga Manual', 'sin_imputar')
         RETURNING id::text AS id, fecha_hora, origen, estado`,
        [
          cuentaId,
          fechaParsed.fechaHora,
          ordenanteFinal,
          rawCuit || null,
          conceptoFinal,
          numeroOperacion,
          importeCentavos.toString(),
        ]
      );

      const movimientoId = insertRes.rows[0].id;
      const nombreLimpio = comprobanteValido.originalname.replace(/[\\/\r\n\"]/g, '_').slice(0, 255) || 'comprobante';

      await client.query(
        `INSERT INTO movimiento_bancario_comprobante
           (movimiento_id, nombre_archivo, tipo_mime, contenido, tamano_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          movimientoId,
          nombreLimpio,
          comprobanteValido.mimetype || 'application/pdf',
          comprobanteValido.buffer,
          comprobanteValido.size,
        ]
      );

      await client.query(
        `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
         VALUES ('movimiento_bancario', $1, 'alta_manual_transferencia', $2, $3::jsonb, $4)`,
        [
          movimientoId,
          usuarioId,
          JSON.stringify({
            id: movimientoId,
            cuentaId: String(cuentaId),
            cuentaAlias: cuenta.alias,
            fechaContable: fechaParsed.fechaClave,
            importeCentavos: importeCentavos.toString(),
            referenciaExterna: numeroOperacion,
            ordenante: ordenanteFinal,
            ordenanteCuit: rawCuit || null,
            origen: 'Carga Manual',
            estado: 'sin_imputar',
            comprobante: nombreLimpio,
          }),
          'Carga Manual de transferencia bancaria con comprobante de respaldo',
        ]
      );

      return {
        id: movimientoId,
        cuenta_id: String(cuentaId),
        cuenta: cuenta.alias,
        fecha_hora: new Date(insertRes.rows[0].fecha_hora).toISOString(),
        ordenante: ordenanteFinal,
        ordenante_cuit: rawCuit || null,
        concepto: conceptoFinal,
        referencia_externa: numeroOperacion,
        importe_centavos: importeCentavos.toString(),
        origen: 'Carga Manual',
        estado: 'sin_imputar',
        comprobante_nombre: nombreLimpio,
        mensaje: `Transferencia manual #${numeroOperacion} registrada bajo "Carga Manual" y disponible en la bandeja de pendientes de conciliación.`,
      };
    });
  },

  async registrarIngresoQrManual(
    payload: {
      cuentaId?: unknown;
      fechaContable?: unknown;
      importe?: unknown;
      idTransaccion?: unknown;
      ordenante?: unknown;
      ordenanteCuit?: unknown;
      concepto?: unknown;
    },
    usuarioId: number
  ) {
    const cuentaId = Number(payload.cuentaId);
    if (!Number.isSafeInteger(cuentaId) || cuentaId <= 0) {
      throw new ConciliacionError(
        'Seleccioná una cuenta o billetera de acreditación activa.',
        400,
        { errorCode: 'CUENTA_INVALIDA', camposInvalidos: ['cuentaId'] }
      );
    }

    const camposInvalidos: string[] = [];
    const rawFecha = String(payload.fechaContable ?? '').trim();
    const fechaParsed = parsearFechaExtracto(rawFecha);
    const hoyClave = fechaActualArgentina();
    const fechaFutura = !!fechaParsed && fechaParsed.fechaClave > hoyClave;
    if (!fechaParsed || fechaFutura) {
      camposInvalidos.push('fechaContable');
    }

    const rawImporte = String(payload.importe ?? '').trim();
    const importeCentavos = parsearImporteCentavos(rawImporte);
    if (importeCentavos === null || importeCentavos <= 0n) {
      camposInvalidos.push('importe');
    }

    if (camposInvalidos.length > 0) {
      const detalleMensajes: string[] = [];
      if (camposInvalidos.includes('fechaContable')) {
        detalleMensajes.push(
          fechaFutura
            ? 'la fecha contable no puede ser futura (no se admiten movimientos anticipados)'
            : 'la fecha contable no es válida'
        );
      }
      if (camposInvalidos.includes('importe')) {
        detalleMensajes.push('el importe debe ser un monto positivo mayor a cero');
      }
      throw new ConciliacionError(
        `Inconsistencia en los datos del cobro QR: ${detalleMensajes.join(' y ')}.`,
        422,
        {
          errorCode: fechaFutura && camposInvalidos.length === 1 ? 'FECHA_CONTABLE_FUTURA' : 'DATOS_QR_INVALIDOS',
          camposInvalidos,
        }
      );
    }

    const idTransaccion = String(payload.idTransaccion ?? '').trim();
    if (!idTransaccion) {
      throw new ConciliacionError(
        'El ID de transacción provisto por la pasarela de pagos es obligatorio.',
        400,
        { errorCode: 'TRANSACCION_QR_OBLIGATORIA', camposInvalidos: ['idTransaccion'] }
      );
    }

    const rawCuit = String(payload.ordenanteCuit ?? '').replace(/\D/g, '');
    if (rawCuit && rawCuit.length !== 11) {
      throw new ConciliacionError(
        'El CUIT del comercio/ordenante debe contener exactamente 11 dígitos.',
        400,
        { errorCode: 'CUIT_INVALIDO', camposInvalidos: ['ordenanteCuit'] }
      );
    }

    const conceptoFinal = String(payload.concepto ?? '').trim() || 'Acreditación por cobro QR';
    const ordenanteFinal = String(payload.ordenante ?? '').trim() || conceptoFinal;

    return enTransaccion(async (client) => {
      const cuentaRes = await client.query(
        `SELECT cr.id, cr.sucursal_id, cr.alias, cr.cbu, cr.banco, cr.moneda, cr.activa,
                s.activa AS sucursal_activa
         FROM cuenta_recepcion cr
         JOIN sucursal s ON s.id = cr.sucursal_id
         WHERE cr.id = $1`,
        [cuentaId]
      );

      if (!cuentaRes.rowCount) {
        throw new ConciliacionError(
          'La cuenta o billetera de acreditación seleccionada no existe.',
          422,
          { errorCode: 'CUENTA_NO_IDENTIFICADA', camposInvalidos: ['cuentaId'] }
        );
      }

      const cuenta = cuentaRes.rows[0];
      if (!cuenta.activa || !cuenta.sucursal_activa) {
        throw new ConciliacionError(
          'La cuenta o billetera de acreditación seleccionada se encuentra inactiva.',
          422,
          { errorCode: 'CUENTA_INACTIVA', camposInvalidos: ['cuentaId'] }
        );
      }

      // El ID de transacción QR de la pasarela debe ser único en todo el sistema (cargado manualmente o recibido previamente) (Escenario 2)
      const dupMovRes = await client.query(
        `SELECT id::text AS id, referencia_externa
         FROM movimiento_bancario
         WHERE referencia_externa IS NOT NULL`
      );

      const dupCobroRes = await client.query(
        `SELECT id::text AS id, referencia_transferencia
         FROM cobro
         WHERE medio_pago = 'qr' AND referencia_transferencia IS NOT NULL`
      );

      const idQrNormalizado = idTransaccion.trim().toLowerCase();
      const existeEnMovimientos = dupMovRes.rows.some(
        (r: any) => String(r.referencia_externa || '').trim().toLowerCase() === idQrNormalizado
      );
      const existeEnCobros = dupCobroRes.rows.some(
        (r: any) => String(r.referencia_transferencia || '').trim().toLowerCase() === idQrNormalizado
      );

      if (existeEnMovimientos || existeEnCobros) {
        throw new ConciliacionError(
          `El comprobante con ID de transacción QR "${idTransaccion}" ya fue registrado previamente en el sistema. Se bloquea el alta para impedir dobles imputaciones.`,
          409,
          { errorCode: 'TRANSACCION_QR_DUPLICADA', camposInvalidos: ['idTransaccion'] }
        );
      }

      const insertRes = await client.query(
        `INSERT INTO movimiento_bancario
           (cuenta_id, fecha_hora, ordenante, ordenante_cuit, concepto, referencia_externa, importe_centavos, origen, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'QR - Carga Manual', 'sin_imputar')
         RETURNING id::text AS id, fecha_hora, origen, estado`,
        [
          cuentaId,
          fechaParsed!.fechaHora,
          ordenanteFinal,
          rawCuit || null,
          conceptoFinal,
          idTransaccion,
          importeCentavos!.toString(),
        ]
      );

      const movimientoId = insertRes.rows[0].id;

      await client.query(
        `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion)
         VALUES ('movimiento_bancario', $1, 'alta_manual_qr', $2, $3::jsonb, $4)`,
        [
          movimientoId,
          usuarioId,
          JSON.stringify({
            id: movimientoId,
            cuentaId: String(cuentaId),
            cuentaAlias: cuenta.alias,
            fechaContable: fechaParsed!.fechaClave,
            importeCentavos: importeCentavos!.toString(),
            idTransaccion,
            ordenante: ordenanteFinal,
            ordenanteCuit: rawCuit || null,
            origen: 'QR - Carga Manual',
            estado: 'sin_imputar',
          }),
          'QR - Carga Manual de ingreso de billetera virtual homologado para conciliación',
        ]
      );

      return {
        id: movimientoId,
        cuenta_id: String(cuentaId),
        cuenta: cuenta.alias,
        fecha_hora: new Date(insertRes.rows[0].fecha_hora).toISOString(),
        ordenante: ordenanteFinal,
        ordenante_cuit: rawCuit || null,
        concepto: conceptoFinal,
        referencia_externa: idTransaccion,
        importe_centavos: importeCentavos!.toString(),
        origen: 'QR - Carga Manual',
        estado: 'sin_imputar',
        comprobante_nombre: null,
        mensaje: `Ingreso por cobro QR #${idTransaccion} registrado bajo "QR - Carga Manual" y habilitado en la bandeja de pendientes de conciliación.`,
      };
    });
  },

  async getMovimientosPendientes(fecha?: string, userSession?: { id?: string; role?: string }) {
    const params: unknown[] = [];
    let fechaIndex = 0;
    if (fecha) {
      params.push(fecha);
      fechaIndex = params.length;
    }

    let sucursalFiltro = '';
    const rol = userSession?.role;
    const esGlobal = esRolGlobal(rol);

    // ESCENARIO 2 (HU #53): Fallo por rol global:
    // Se intenta restringir geográficamente la vista a un usuario con perfil jerárquico global inamovible (Ej. CEO).
    // El sistema ignora la restricción local.
    // ESCENARIO 1 (HU #53): Sectorización de usuario exitosa:
    // Se restringe a un administrativo solo para determinada sucursal. Automáticamente deja de ver los extractos bancarios de las demás sucursales.
    if (!esGlobal && userSession?.id) {
      const usuarioId = Number(String(userSession.id).replace(/^usr_/, ''));
      if (Number.isSafeInteger(usuarioId) && usuarioId > 0) {
        params.push(usuarioId);
        sucursalFiltro = "AND cr.sucursal_id IN (SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = $" + params.length + ")";
      }
    }

    const buildQuery = (useSimpleDateCast: boolean) => {
      const fechaExpr = useSimpleDateCast
        ? `mb.fecha_hora::date = $${fechaIndex}::date`
        : `(mb.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = $${fechaIndex}::date`;
      const fechaFiltro = fecha ? `AND ${fechaExpr}` : '';
      return `SELECT mb.id::text AS id, mb.fecha_hora, mb.ordenante, mb.ordenante_cuit,
              mb.concepto, mb.referencia_externa,
              COALESCE(mb.origen, 'Extracto Bancario') AS origen,
              (mb.importe_centavos - COALESCE(i.imputado_centavos, 0))::text AS importe_centavos,
              mb.cuenta_id::text AS cuenta_id, cr.alias AS cuenta,
              cr.sucursal_id::text AS sucursal_id, s.nombre AS sucursal,
              mbc.nombre_archivo AS comprobante_nombre
       FROM movimiento_bancario mb
       JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id
       LEFT JOIN sucursal s ON s.id = cr.sucursal_id
       LEFT JOIN (
         SELECT movimiento_bancario_id, SUM(importe_centavos) AS imputado_centavos
         FROM imputacion WHERE movimiento_bancario_id IS NOT NULL GROUP BY movimiento_bancario_id
       ) i ON i.movimiento_bancario_id = mb.id
       LEFT JOIN movimiento_bancario_comprobante mbc ON mbc.movimiento_id = mb.id
       WHERE mb.estado IN ('sin_imputar', 'parcial')
         ${fechaFiltro}
         ${sucursalFiltro}
       ORDER BY mb.fecha_hora DESC, mb.id DESC`;
    };

    try {
      const result = await db.query(buildQuery(db.isMemory()), params);
      return result.rows;
    } catch (err: any) {
      if (fecha && String(err?.message || '').includes('AT TIME ZONE')) {
        const fallbackRes = await db.query(buildQuery(true), params);
        return fallbackRes.rows;
      }
      throw err;
    }
  },

  async getSugerencias(userSession?: { id?: string; role?: string }) {
    const rol = userSession?.role;
    const esGlobal = esRolGlobal(rol);
    const paramsMov: unknown[] = [];
    const paramsRem: unknown[] = [];
    let movSucursalFiltro = '';
    let remSucursalFiltro = '';

    if (!esGlobal && userSession?.id) {
      const usuarioId = Number(String(userSession.id).replace(/^usr_/, ''));
      if (Number.isSafeInteger(usuarioId) && usuarioId > 0) {
        paramsMov.push(usuarioId);
        movSucursalFiltro = "AND cr.sucursal_id IN (SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = $1)";
        paramsRem.push(usuarioId);
        remSucursalFiltro = "AND r.sucursal_id IN (SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = $1)";
      }
    }

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
           ${movSucursalFiltro}
           AND NOT EXISTS (
             SELECT 1 FROM discrepancia_conciliacion dc
             WHERE dc.estado IN ('pendiente','escalada') AND mb.id = ANY(dc.movimiento_ids)
           )
         ORDER BY mb.fecha_hora DESC, mb.id DESC`,
        paramsMov
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
           ${remSucursalFiltro}
         ORDER BY r.entregado_en DESC NULLS LAST, r.id DESC`,
        paramsRem
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

  async getMovimientosHuerfanos(
    filters: { sucursalId?: string; cuentaId?: string; desde?: string; hasta?: string } = {},
    userSession?: { id?: string; role?: string }
  ) {
    const sugerencias = await this.getSugerencias(userSession);
    const movimientosConSugerencias = new Set(sugerencias.map((item) => item.movimiento_id));
    const cutoff = new Date(Date.now() - HORAS_PARA_HUERFANO * 3_600_000);
    const params: unknown[] = [cutoff];

    let sucursalFiltro = '';
    const rol = userSession?.role;
    const esGlobal = esRolGlobal(rol);

    if (!esGlobal && userSession?.id) {
      const usuarioId = Number(String(userSession.id).replace(/^usr_/, ''));
      if (Number.isSafeInteger(usuarioId) && usuarioId > 0) {
        params.push(usuarioId);
        sucursalFiltro = "AND cr.sucursal_id IN (SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = $" + params.length + ")";
      }
    }

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
         ${sucursalFiltro}
         AND NOT EXISTS (
           SELECT 1 FROM discrepancia_conciliacion dc
           WHERE dc.estado IN ('pendiente','escalada') AND mb.id = ANY(dc.movimiento_ids)
         )
       ORDER BY mb.fecha_hora DESC, mb.id DESC`,
      params
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

  async getRemitosPendientes(userSession?: { id?: string; role?: string }) {
    const rol = userSession?.role;
    const esGlobal = esRolGlobal(rol);
    const params: unknown[] = [];
    let sucursalFiltro = '';

    if (!esGlobal && userSession?.id) {
      const usuarioId = Number(String(userSession.id).replace(/^usr_/, ''));
      if (Number.isSafeInteger(usuarioId) && usuarioId > 0) {
        params.push(usuarioId);
        sucursalFiltro = "AND r.sucursal_id IN (SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = $1)";
      }
    }

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
         ${sucursalFiltro}
       ORDER BY r.entregado_en DESC NULLS LAST, c.razon_social, r.numero`,
      params
    );
    return result.rows;
  },

  async getDiscrepanciasPendientes(userSession?: { id?: string; role?: string }) {
    const rol = userSession?.role;
    const esGlobal = esRolGlobal(rol);
    const params: unknown[] = [];
    let sucursalFiltro = '';

    if (!esGlobal && userSession?.id) {
      const usuarioId = Number(String(userSession.id).replace(/^usr_/, ''));
      if (Number.isSafeInteger(usuarioId) && usuarioId > 0) {
        params.push(usuarioId);
        sucursalFiltro = "AND cr.sucursal_id IN (SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = $1)";
      }
    }

    const result = await db.query(
      `SELECT dc.id::text AS id, dc.movimiento_id::text AS movimiento_id,
              dc.movimiento_ids::text AS movimiento_ids,
              mb.fecha_hora, mb.ordenante, dc.importe_movimiento::text AS importe_movimiento,
              dc.importe_seleccionado::text AS importe_seleccionado,
              dc.diferencia_centavos::text AS diferencia_centavos, dc.nota, dc.motivo_codigo,
              dc.remito_ids::text AS remito_ids, dc.estado, dc.creada_por::text AS creada_por,
              dcomp.nombre_archivo AS comprobante_nombre
       FROM discrepancia_conciliacion dc
       JOIN movimiento_bancario mb ON mb.id = dc.movimiento_id
       JOIN cuenta_recepcion cr ON cr.id = mb.cuenta_id
       LEFT JOIN discrepancia_comprobante dcomp ON dcomp.discrepancia_id = dc.id
       WHERE dc.estado IN ('pendiente','escalada')
         ${sucursalFiltro}
       ORDER BY dc.creada_en DESC`,
      params
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
      if (estado === 'aprobada') {
        await client.query(
          `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, valores_despues, observacion) VALUES ('discrepancia_conciliacion', $1, 'aprobada', $2, $3::jsonb, $4)`,
          [discrepanciaId, usuarioId, JSON.stringify({ estado, movimientoIds, remitoIds, importeMovimiento: result.importeMovimiento.toString(), importeSeleccionado: result.importeSeleccionado.toString(), diferenciaCentavos: result.diferencia.toString() }), nota.trim()]
        );
      }
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
        [id, estado, usuarioId, JSON.stringify({ estado, movimientoIds, remitoIds, importeMovimiento: String(dc.importe_movimiento), importeSeleccionado: String(dc.importe_seleccionado), diferenciaCentavos: String(dc.diferencia_centavos) }), observacion.trim()]
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
