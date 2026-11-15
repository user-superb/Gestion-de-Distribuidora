import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { conciliacionRouter } from '../routes/conciliacionRoutes.js';
import { ConciliacionError, conciliacionService } from '../services/conciliacionService.js';

function fakePool(difference: bigint, status = 'pendiente', createdBy = 3, limit = 100_000n, multiRemitos = false) {
  const statements: Array<{ sql: string; params?: any[] }> = [];
  const client = {
    async query(sql: string, params?: any[]) {
      statements.push({ sql, params });
      if (sql.includes('SELECT * FROM discrepancia_conciliacion')) return { rows: [{
        id: '9', movimiento_id: 1, movimiento_ids: [1], remito_ids: multiRemitos ? [2, 3] : [2],
        importe_movimiento: difference < 0n ? '500' : '1500', importe_seleccionado: '1000',
        diferencia_centavos: difference.toString(), estado: status, creada_por: createdBy,
      }], rowCount: 1 };
      if (sql.includes('INSERT INTO discrepancia_conciliacion')) return { rows: [{ id: '9' }], rowCount: 1 };
      if (sql.includes('SELECT limite_autorizacion_centavos')) return { rows: [{ limite_autorizacion_centavos: limit.toString() }], rowCount: 1 };
      if (sql.includes('SELECT mb.id::text AS id')) return { rows: [{
        id: '1', cuenta_id: '1', importe_disponible_centavos: difference < 0n ? '500' : '1500',
        estado: 'sin_imputar', ordenante: 'Cliente', ordenante_cuit: '20123456789',
        fecha_hora: new Date(), sucursal_id: 1,
      }], rowCount: 1 };
      if (sql.includes('SELECT id FROM remito')) return { rows: multiRemitos ? [{ id: '2' }, { id: '3' }] : [{ id: '2' }], rowCount: multiRemitos ? 2 : 1 };
      if (sql.includes('SELECT r.id, r.numero')) return { rows: (multiRemitos ? ['2', '3'] : ['2']).map((id) => ({
        id, numero: `R-${id}`, estado: 'entregado', sucursal_id: 1, comercio_id: '4',
        razon_social: 'Cliente', cuit: '20123456789', saldo_centavos: multiRemitos ? '500' : '1000', fecha_entrega: new Date(),
      })), rowCount: multiRemitos ? 2 : 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  db.setPool({ connect: async () => client } as any);
  return statements;
}

describe('Resolución de discrepancias de conciliación', () => {
  it('exige motivo y respaldo para registrar una diferencia', async () => {
    await assert.rejects(
      () => conciliacionService.registrarDiscrepancia([1], [2], 'Diferencia', '', null, 4),
      (error: unknown) => error instanceof ConciliacionError && error.status === 400
    );
  });

  it('registra un faltante justificado con respaldo', async () => {
    const statements = fakePool(-500n);
    const previousCents = process.env.CONCILIATION_TOLERANCE_CENTS;
    const previousPercent = process.env.CONCILIATION_TOLERANCE_PERCENT;
    process.env.CONCILIATION_TOLERANCE_CENTS = '0'; process.env.CONCILIATION_TOLERANCE_PERCENT = '0';
    try {
      const result = await conciliacionService.registrarDiscrepancia([1], [2], 'Retención documentada', 'retenciones_impositivas', {
        originalname: 'retencion.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.7'),
      }, 4);
      assert.equal(result.diferenciaCentavos, '-500');
      assert.equal(result.estado, 'pendiente');
      assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO discrepancia_comprobante')));
    } finally {
      if (previousCents === undefined) delete process.env.CONCILIATION_TOLERANCE_CENTS; else process.env.CONCILIATION_TOLERANCE_CENTS = previousCents;
      if (previousPercent === undefined) delete process.env.CONCILIATION_TOLERANCE_PERCENT; else process.env.CONCILIATION_TOLERANCE_PERCENT = previousPercent;
    }
  });

  it('registra un sobrante justificado con respaldo', async () => {
    const statements = fakePool(500n);
    const previousCents = process.env.CONCILIATION_TOLERANCE_CENTS;
    const previousPercent = process.env.CONCILIATION_TOLERANCE_PERCENT;
    process.env.CONCILIATION_TOLERANCE_CENTS = '0'; process.env.CONCILIATION_TOLERANCE_PERCENT = '0';
    try {
      const result = await conciliacionService.registrarDiscrepancia([1], [2], 'Comisión informada', 'comision_bancaria', {
        originalname: 'comision.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.7'),
      }, 4);
      assert.equal(result.diferenciaCentavos, '500');
      assert.equal(result.estado, 'pendiente');
      assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO discrepancia_comprobante')));
    } finally {
      if (previousCents === undefined) delete process.env.CONCILIATION_TOLERANCE_CENTS; else process.env.CONCILIATION_TOLERANCE_CENTS = previousCents;
      if (previousPercent === undefined) delete process.env.CONCILIATION_TOLERANCE_PERCENT; else process.env.CONCILIATION_TOLERANCE_PERCENT = previousPercent;
    }
  });

  it('requiere una observación para rechazar', async () => {
    await assert.rejects(
      () => conciliacionService.resolverDiscrepancia('9', 4, false, '   '),
      (error: unknown) => error instanceof ConciliacionError && error.status === 400
    );
  });

  it('bloquea resolver el expediente si otro usuario ya lo cerró', async () => {
    const statements = fakePool(500n, 'aprobada');
    await assert.rejects(
      () => conciliacionService.resolverDiscrepancia('9', 4, false, 'Rechazo'),
      (error: unknown) => error instanceof ConciliacionError && error.status === 409
    );
    assert.ok(statements.some(({ sql }) => sql.includes('FOR UPDATE')));
    assert.ok(statements.some(({ sql }) => sql === 'ROLLBACK'));
  });

  it('impide que el usuario que abrió el caso lo apruebe', async () => {
    fakePool(500n, 'pendiente', 4);
    await assert.rejects(
      () => conciliacionService.resolverDiscrepancia('9', 4, true, 'Aprobado'),
      (error: unknown) => error instanceof ConciliacionError && error.status === 403
    );
  });

  it('escala una aprobación que supera el límite personal', async () => {
    const statements = fakePool(500n, 'pendiente', 3, 100n);
    const result = await conciliacionService.resolverDiscrepancia('9', 4, true, 'Aprobación');
    assert.equal(result.estado, 'escalada');
    assert.ok(statements.some(({ sql }) => sql.includes("SET estado = 'escalada'")));
    assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO discrepancia_notificacion')));
  });

  it('aprueba un faltante y registra la reducción del saldo del remito', async () => {
    const statements = fakePool(-500n);
    const result = await conciliacionService.resolverDiscrepancia('9', 4, true, 'Retención documentada');
    assert.equal(result.estado, 'aprobada');
    assert.ok(statements.some(({ sql, params }) => sql.includes('reduccion_saldo') && params?.includes('500')));
    assert.ok(statements.some(({ sql }) => sql.includes("SET estado = 'imputado'")));
  });

  it('descuenta el faltante de lo que sigue impago después de repartir entre varios remitos', async () => {
    const statements = fakePool(-500n, 'pendiente', 3, 100_000n, true);
    await conciliacionService.resolverDiscrepancia('9', 4, true, 'Retención documentada');
    assert.ok(statements.some(({ sql, params }) => sql.includes('reduccion_saldo') && params?.[1] === '3' && params?.[2] === '500'));
  });

  it('aprueba un sobrante y conserva el excedente como saldo a favor', async () => {
    const statements = fakePool(500n);
    const result = await conciliacionService.resolverDiscrepancia('9', 4, true, 'Diferencia documentada');
    assert.equal(result.estado, 'aprobada');
    assert.ok(statements.some(({ sql, params }) => sql.includes('saldo_favor') && params?.includes('500')));
  });
});

describe('Conciliación 1 a N y exclusión de movimientos con discrepancias', () => {
  let pool: any;
  let prevToleranceCents: string | undefined;
  let prevTolerancePercent: string | undefined;

  beforeEach(() => {
    prevToleranceCents = process.env.CONCILIATION_TOLERANCE_CENTS;
    prevTolerancePercent = process.env.CONCILIATION_TOLERANCE_PERCENT;
    process.env.CONCILIATION_TOLERANCE_CENTS = '0';
    process.env.CONCILIATION_TOLERANCE_PERCENT = '0';

    const mem = newDb();
    mem.public.none(`
      CREATE TABLE sucursal (id serial PRIMARY KEY, nombre text NOT NULL, codigo text, activa boolean NOT NULL DEFAULT true);
      CREATE TABLE usuario (id serial PRIMARY KEY, usuario text NOT NULL UNIQUE, nombre text NOT NULL, rol text NOT NULL, activo boolean NOT NULL DEFAULT true, limite_autorizacion_centavos bigint DEFAULT 1000000);
      CREATE TABLE usuario_sucursal (usuario_id bigint NOT NULL, sucursal_id bigint NOT NULL, PRIMARY KEY(usuario_id, sucursal_id));
      CREATE TABLE comercio (id serial PRIMARY KEY, razon_social text NOT NULL, nombre_fantasia text, cuit char(11) NOT NULL);
      CREATE TABLE marca (id serial PRIMARY KEY, nombre text NOT NULL);
      CREATE TABLE cuenta_recepcion (id serial PRIMARY KEY, sucursal_id bigint NOT NULL, alias text NOT NULL, activa boolean NOT NULL DEFAULT true);
      CREATE TABLE visita (id serial PRIMARY KEY, registrada_en timestamp DEFAULT now());
      CREATE TABLE remito (id serial PRIMARY KEY, numero text NOT NULL, marca_id bigint NOT NULL DEFAULT 1, comercio_id bigint NOT NULL, sucursal_id bigint NOT NULL, importe_centavos bigint NOT NULL, estado text NOT NULL DEFAULT 'entregado', visita_id bigint, entregado_en timestamp DEFAULT now());
      CREATE TABLE cobro (id serial PRIMARY KEY, visita_id bigint NOT NULL, medio_pago text NOT NULL, importe_centavos bigint NOT NULL, registrado_en timestamp DEFAULT now(), registrado_por bigint NOT NULL, movimiento_bancario_id bigint, estado text NOT NULL DEFAULT 'pendiente', clave_idempotencia text NOT NULL UNIQUE);
      CREATE TABLE movimiento_bancario (id serial PRIMARY KEY, cuenta_id bigint NOT NULL, fecha_hora timestamp NOT NULL DEFAULT now(), ordenante text NOT NULL, ordenante_cuit char(11), concepto text, referencia_externa text, importe_centavos bigint NOT NULL, origen text NOT NULL DEFAULT 'Extracto Bancario', estado text NOT NULL DEFAULT 'sin_imputar');
      CREATE TABLE movimiento_bancario_comprobante (movimiento_id bigint PRIMARY KEY, nombre_archivo text NOT NULL, tipo_mime text NOT NULL, contenido bytea NOT NULL, tamano_bytes bigint NOT NULL, subido_en timestamp DEFAULT now());
      CREATE TABLE imputacion (id serial PRIMARY KEY, movimiento_bancario_id bigint, cobro_id bigint, remito_id bigint NOT NULL, importe_centavos bigint NOT NULL, imputado_por bigint NOT NULL, imputado_en timestamp DEFAULT now(), anulado boolean NOT NULL DEFAULT false);
      CREATE TABLE auditoria (id serial PRIMARY KEY, entidad text NOT NULL, entidad_id bigint NOT NULL, accion text NOT NULL, usuario_id bigint NOT NULL, ocurrido_en timestamp DEFAULT now(), valores_antes jsonb, valores_despues jsonb, observacion text);
      CREATE TABLE discrepancia_conciliacion (
        id serial PRIMARY KEY,
        movimiento_id bigint,
        movimiento_ids bigint[] DEFAULT '{}',
        remito_ids bigint[] NOT NULL,
        importe_movimiento bigint NOT NULL,
        importe_seleccionado bigint NOT NULL,
        diferencia_centavos bigint NOT NULL,
        nota text NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente',
        creada_por bigint NOT NULL,
        creada_en timestamp DEFAULT now(),
        motivo_codigo text,
        resuelta_por bigint,
        resuelta_en timestamp,
        observacion_resolucion text
      );
      CREATE TABLE discrepancia_comprobante (discrepancia_id bigint PRIMARY KEY, nombre_archivo text NOT NULL, tipo_mime text NOT NULL, contenido bytea NOT NULL, tamano_bytes bigint NOT NULL);
      CREATE TABLE discrepancia_ajuste (id serial PRIMARY KEY, discrepancia_id bigint NOT NULL, remito_id bigint, comercio_id bigint, tipo text NOT NULL, importe_centavos bigint NOT NULL);
      CREATE TABLE discrepancia_notificacion (id serial PRIMARY KEY, discrepancia_id bigint NOT NULL, usuario_id bigint NOT NULL, mensaje text NOT NULL, creada_en timestamp DEFAULT now(), leida_en timestamp);

      CREATE VIEW remito_saldo AS
      WITH pagos AS (
        SELECT remito_id, SUM(importe_centavos)::bigint AS importe_centavos FROM imputacion WHERE anulado = false GROUP BY remito_id
      ), ajustes AS (
        SELECT remito_id, SUM(importe_centavos)::bigint AS importe_centavos FROM discrepancia_ajuste WHERE tipo = 'reduccion_saldo' GROUP BY remito_id
      )
      SELECT r.id AS remito_id, r.comercio_id, r.marca_id, r.importe_centavos,
        COALESCE(p.importe_centavos, 0) AS imputado_centavos,
        (r.importe_centavos + (-COALESCE(p.importe_centavos, 0)) + (-COALESCE(a.importe_centavos, 0)))::bigint AS saldo_centavos,
        CASE
          WHEN r.importe_centavos = COALESCE(p.importe_centavos, 0) + COALESCE(a.importe_centavos, 0) THEN 'saldado'
          WHEN COALESCE(p.importe_centavos, 0) + COALESCE(a.importe_centavos, 0) > 0 THEN 'parcial'
          ELSE 'pendiente'
        END AS estado_pago
      FROM remito r
      LEFT JOIN pagos p ON p.remito_id = r.id
      LEFT JOIN ajustes a ON a.remito_id = r.id;

      INSERT INTO sucursal (id, nombre, codigo) VALUES (1, 'Central', 'CEN'), (2, 'Norte', 'NOR');
      INSERT INTO marca (id, nombre) VALUES (1, 'Tutucas');
      INSERT INTO usuario (id, usuario, nombre, rol, limite_autorizacion_centavos) VALUES
        (1, 'admin1', 'Admin 1', 'Administrativo', 100000),
        (2, 'gerente', 'Gerente', 'Gerente', 1000000);
      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (1, 1), (2, 1);
      INSERT INTO cuenta_recepcion (id, sucursal_id, alias) VALUES (1, 1, 'cuenta.central'), (2, 2, 'cuenta.norte');
      INSERT INTO comercio (id, razon_social, cuit) VALUES
        (1, 'Almacen Sur SRL', '20111222339'),
        (2, 'Kiosco Centro', '20999888776');
      INSERT INTO remito (id, numero, comercio_id, sucursal_id, importe_centavos, estado, visita_id) VALUES
        (1, 'R-0001', 1, 1, 60000, 'entregado', 10),
        (2, 'R-0002', 1, 1, 40000, 'entregado', 11),
        (3, 'R-0003', 2, 1, 50000, 'entregado', NULL),
        (4, 'R-0004', 1, 2, 50000, 'entregado', NULL),
        (5, 'R-0005', 1, 1, 50000, 'pendiente', NULL);
      INSERT INTO cobro (id, visita_id, medio_pago, importe_centavos, registrado_por, estado, clave_idempotencia) VALUES
        (1, 10, 'transferencia', 60000, 1, 'pendiente', 'k-1'),
        (2, 11, 'qr', 40000, 1, 'pendiente', 'k-2');
      INSERT INTO movimiento_bancario (id, cuenta_id, ordenante, ordenante_cuit, referencia_externa, importe_centavos, estado) VALUES
        (1, 1, 'Almacen Sur SRL', '20111222339', 'REF-EXACTA', 100000, 'sin_imputar'),
        (2, 1, 'Almacen Sur SRL', '20111222339', 'REF-DESCUADRE', 95000, 'sin_imputar');
    `);

    const adapter = mem.adapters.createPg();
    const rawPool = new adapter.Pool();
    const adaptForPgMem = (sql: string, params?: any[]): [string, any[] | undefined] => {
      let adapted = sql
        .replace(/\bFOR UPDATE OF \w+/gi, 'FOR UPDATE')
        .replace(/mb\.importe_centavos\s*-\s*COALESCE\(i\.imputado_centavos,\s*0\)/gi, 'mb.importe_centavos + (-COALESCE(i.imputado_centavos, 0))')
        .replace(/(INSERT INTO discrepancia_notificacion[^)]+\)\s*SELECT\s+)\$1\b/gi, '$1$$1::bigint');
      if (!params) return [adapted, params];
      // Expand `col = ANY($n::bigint[])` to `col IN (v1, v2, ...)` because pg-mem returns empty for ANY(array::bigint[])
      adapted = adapted.replace(/([\w.]+)\s*=\s*ANY\(\$(\d+)::bigint\[\]\)/gi, (_m, col, idx) => {
        const arr = Array.isArray(params[Number(idx) - 1]) ? params[Number(idx) - 1] : [];
        const nums = arr.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
        return nums.length > 0 ? `${col} IN (${nums.join(', ')})` : '1 = 0';
      });
      // Replace `(movimiento_ids && $1::bigint[] OR remito_ids && $2::bigint[])` for pg-mem array overlap support
      adapted = adapted.replace(
        /\(movimiento_ids\s*&&\s*\$(\d+)::bigint\[\]\s*OR\s*remito_ids\s*&&\s*\$(\d+)::bigint\[\]\)/gi,
        (_m, i1, i2) => {
          const mIds = (Array.isArray(params[Number(i1) - 1]) ? params[Number(i1) - 1] : []).map(Number).filter(Number.isFinite);
          const rIds = (Array.isArray(params[Number(i2) - 1]) ? params[Number(i2) - 1] : []).map(Number).filter(Number.isFinite);
          const checks: string[] = [];
          for (const id of mIds) checks.push(`${id} = ANY(movimiento_ids)`);
          for (const id of rIds) checks.push(`${id} = ANY(remito_ids)`);
          return checks.length > 0 ? `(${checks.join(' OR ')})` : '1 = 0';
        }
      );
      return [adapted, params];
    };
    const runAdapted = async (target: any, sql: string, params?: any[]) => {
      const [adaptedSql, rawParams] = adaptForPgMem(sql, params);
      const adaptedParams = rawParams && adaptedSql.includes('discrepancia_notificacion')
        ? rawParams.map((p) => (typeof p === 'string' && /^\d+$/.test(p) ? Number(p) : p))
        : rawParams;
      try {
        return await target.query(adaptedSql, adaptedParams);
      } catch (err: any) {
        // Retry without unused positional params if pg-mem complains about unused $N after IN expansion
        if (adaptedParams && adaptedParams.length > 0 && String(err?.message || '').includes('parameter')) {
          return await target.query(adaptedSql);
        }
        throw err;
      }
    };
    pool = {
      query: (sql: string, params?: any[]) => runAdapted(rawPool, sql, params),
      connect: async () => {
        const client = await rawPool.connect();
        return {
          query: (sql: string, params?: any[]) => runAdapted(client, sql, params),
          release: () => client.release(),
        };
      },
      end: () => rawPool.end(),
    };
    db.setPool(pool);
  });

  afterEach(async () => {
    if (prevToleranceCents === undefined) delete process.env.CONCILIATION_TOLERANCE_CENTS;
    else process.env.CONCILIATION_TOLERANCE_CENTS = prevToleranceCents;
    if (prevTolerancePercent === undefined) delete process.env.CONCILIATION_TOLERANCE_PERCENT;
    else process.env.CONCILIATION_TOLERANCE_PERCENT = prevTolerancePercent;
    if (pool) await pool.end();
  });

  it('Escenario 1: concilia 1 a N exacto, salda remitos, valida cobros y quita el movimiento de pendientes', async () => {
    const result = await conciliacionService.conciliar([1], [1, 2], 1);
    assert.ok(result);

    const pendientes = await conciliacionService.getMovimientosPendientes(undefined, { id: 'usr_1', role: 'Administrativo' });
    assert.deepEqual(pendientes.map((m) => m.id), ['2']);

    const remitos = await pool.query('SELECT remito_id::text, saldo_centavos::text, estado_pago FROM remito_saldo WHERE remito_id IN (1, 2) ORDER BY remito_id');
    assert.deepEqual(remitos.rows, [
      { remito_id: '1', saldo_centavos: '0', estado_pago: 'saldado' },
      { remito_id: '2', saldo_centavos: '0', estado_pago: 'saldado' },
    ]);

    const cobros = await pool.query("SELECT id::text, estado FROM cobro WHERE id IN (1, 2) ORDER BY id");
    assert.deepEqual(cobros.rows, [
      { id: '1', estado: 'validado' },
      { id: '2', estado: 'validado' },
    ]);
  });

  it('Escenario 2: bloquea conciliación directa con descuadre y oculta el movimiento y los remitos de la lista al derivar a discrepancias (y los restaura si se rechaza)', async () => {
    await assert.rejects(
      () => conciliacionService.conciliar([2], [1, 2], 1),
      (error: unknown) => error instanceof ConciliacionError && error.message.includes('no coincide')
    );

    const disc = await conciliacionService.registrarDiscrepancia(
      [2],
      [1, 2],
      'Retención IIBB aplicada',
      'retenciones_impositivas',
      { originalname: 'ret.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.7') },
      1
    );
    assert.equal(disc.estado, 'pendiente');
    assert.equal(disc.diferenciaCentavos, '-5000');

    const pendientesConDiscrepancia = await conciliacionService.getMovimientosPendientes(undefined, { id: 'usr_1', role: 'Administrativo' });
    assert.equal(pendientesConDiscrepancia.some((m) => m.id === '2'), false);

    const remitosConDiscrepancia = await conciliacionService.getRemitosPendientes({ id: 'usr_1', role: 'Administrativo' });
    assert.equal(remitosConDiscrepancia.some((r) => r.id === '1' || r.id === '2'), false);
    assert.equal(remitosConDiscrepancia.some((r) => r.id === '3'), true);

    const sugerenciasConDiscrepancia = await conciliacionService.getSugerencias({ id: 'usr_1', role: 'Administrativo' });
    assert.equal(sugerenciasConDiscrepancia.some((s) => s.remito_id === '1' || s.remito_id === '2'), false);

    // Si se rechaza la discrepancia, el movimiento y los remitos vuelven a aparecer como pendientes
    const rechazada = await conciliacionService.resolverDiscrepancia(disc.id, 2, false, 'Comprobante ilegible');
    assert.equal(rechazada.estado, 'rechazada');

    const pendientesTrasRechazo = await conciliacionService.getMovimientosPendientes(undefined, { id: 'usr_1', role: 'Administrativo' });
    assert.equal(pendientesTrasRechazo.some((m) => m.id === '2'), true);

    const remitosTrasRechazo = await conciliacionService.getRemitosPendientes({ id: 'usr_1', role: 'Administrativo' });
    assert.equal(remitosTrasRechazo.some((r) => r.id === '1'), true);
    assert.equal(remitosTrasRechazo.some((r) => r.id === '2'), true);
  });

  it('Escenario 3: rechaza remitos de otro comercio o sucursal e informa los no elegibles', async () => {
    await assert.rejects(
      () => conciliacionService.conciliar([1], [1, 3], 1),
      (error: unknown) => error instanceof ConciliacionError && error.message.includes('mismo comercio')
    );

    await assert.rejects(
      () => conciliacionService.conciliar([1], [4], 1),
      (error: unknown) => error instanceof ConciliacionError && error.status >= 400
    );
  });

  it('Escenario 4: aborta si un remito no está entregado o pertenece a una discrepancia activa', async () => {
    await assert.rejects(
      () => conciliacionService.conciliar([1], [5], 1),
      (error: unknown) => error instanceof ConciliacionError && error.message.includes('no entregados')
    );

    await conciliacionService.registrarDiscrepancia(
      [2],
      [1, 2],
      'Faltante por retención',
      'retenciones_impositivas',
      { originalname: 'ret.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.7') },
      1
    );

    await assert.rejects(
      () => conciliacionService.conciliar([1], [1, 2], 1),
      (error: unknown) => error instanceof ConciliacionError && error.status === 409
    );
  });

  it('permite al Administrador del sistema aprobar o rechazar una discrepancia sin importar quién la creó, límite ni observación', async () => {
    await pool.query(
      "INSERT INTO usuario (id, usuario, nombre, rol, limite_autorizacion_centavos) VALUES (3, 'admin_sistema', 'Admin Sistema', 'Administrador del sistema', 0)"
    );

    const discAprobar = await conciliacionService.registrarDiscrepancia(
      [2],
      [1, 2],
      'Discrepancia creada por admin',
      'retenciones_impositivas',
      { originalname: 'ret.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.7') },
      3
    );
    const aprobada = await conciliacionService.resolverDiscrepancia(discAprobar.id, 3, true, '', 'Administrador del sistema');
    assert.equal(aprobada.estado, 'aprobada');

    await pool.query(
      "INSERT INTO movimiento_bancario (id, cuenta_id, ordenante, ordenante_cuit, referencia_externa, importe_centavos, estado) VALUES (3, 1, 'Almacen Sur SRL', '20111222339', 'REF-3', 55000, 'sin_imputar')"
    );
    await pool.query(
      "INSERT INTO remito (id, numero, comercio_id, sucursal_id, importe_centavos, estado) VALUES (6, 'R-0006', 1, 1, 60000, 'entregado')"
    );
    const discRechazar = await conciliacionService.registrarDiscrepancia(
      [3],
      [6],
      'Para rechazar sin nota',
      'otro',
      { originalname: 'nota.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.7') },
      1
    );
    const rechazada = await conciliacionService.resolverDiscrepancia(discRechazar.id, 3, false, '', 'Administrador del sistema');
    assert.equal(rechazada.estado, 'rechazada');
  });

  it('devuelve todos los números de remito asociados en la bandeja de discrepancias pendientes', async () => {
    await pool.query(
      "INSERT INTO remito (id, numero, comercio_id, sucursal_id, importe_centavos, estado) VALUES (7, 'R-0007', 1, 1, 10000, 'entregado')"
    );
    await conciliacionService.registrarDiscrepancia(
      [2],
      [1, 2, 7],
      'Faltante con 3 remitos',
      'retenciones_impositivas',
      { originalname: 'ret.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.7') },
      1
    );
    const pendientes = await conciliacionService.getDiscrepanciasPendientes({ id: 'usr_1', role: 'Administrativo' });
    assert.equal(pendientes.length, 1);
    assert.deepEqual(pendientes[0].remito_numeros, ['R-0001', 'R-0002', 'R-0007']);
  });

  it('marca notificaciones de discrepancia como leídas individualmente, en lote y al resolver el caso', async () => {
    const disc = await conciliacionService.registrarDiscrepancia(
      [2],
      [1, 2],
      'Pendiente con alerta',
      'retenciones_impositivas',
      { originalname: 'ret.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.7') },
      1
    );
    // El gerente (usuario 2) recibió la notificación de pendiente
    const pendingBefore = await pool.query('SELECT id FROM discrepancia_notificacion WHERE usuario_id = 2 AND leida_en IS NULL');
    assert.equal(pendingBefore.rows.length, 1);

    // Al rechazar la discrepancia, la alerta previa al gerente se marca leída y se crea la de rechazo para usuario 1
    await conciliacionService.resolverDiscrepancia(disc.id, 2, false, 'Falta firma');
    const pendingAfterResolve = await pool.query('SELECT id FROM discrepancia_notificacion WHERE usuario_id = 2 AND leida_en IS NULL');
    assert.equal(pendingAfterResolve.rows.length, 0);

    await pool.query("INSERT INTO discrepancia_notificacion (discrepancia_id, usuario_id, mensaje) VALUES (1, 1, 'Segundo aviso')");
    const getHandler = (method: string, path: string) => {
      const layer: any = (conciliacionRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
      assert.ok(layer);
      return layer.route.stack[layer.route.stack.length - 1].handle;
    };
    const mockRes = () => ({ statusCode: 200, body: undefined as any, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } });

    const beforeList = await pool.query('SELECT id::text AS id FROM discrepancia_notificacion WHERE usuario_id = 1 AND leida_en IS NULL ORDER BY id');
    assert.equal(beforeList.rows.length, 2);

    const resOne = mockRes();
    await getHandler('post', '/notificaciones/:id/leer')({ params: { id: beforeList.rows[0].id }, userSession: { id: 'usr_1', role: 'Administrativo' } }, resOne);
    assert.equal(resOne.statusCode, 200);
    const afterOne = await pool.query('SELECT id FROM discrepancia_notificacion WHERE usuario_id = 1 AND leida_en IS NULL');
    assert.equal(afterOne.rows.length, 1);

    const resAll = mockRes();
    await getHandler('post', '/notificaciones/leer-todas')({ params: {}, userSession: { id: 'usr_1', role: 'Administrativo' } }, resAll);
    assert.equal(resAll.statusCode, 200);
    const afterAll = await pool.query('SELECT id FROM discrepancia_notificacion WHERE usuario_id = 1 AND leida_en IS NULL');
    assert.equal(afterAll.rows.length, 0);
  });
});
