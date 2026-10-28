import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { conciliacionService } from '../services/conciliacionService.js';

describe('Backend PostgreSQL - HU: Registrar y Tipificar Diferencia en Conciliación', () => {
  beforeEach(() => {
    const mem = newDb();
    mem.public.none(`
      CREATE TABLE IF NOT EXISTS sucursal (
        id serial PRIMARY KEY,
        nombre text NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS marca (
        id serial PRIMARY KEY,
        nombre text NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS comercio (
        id serial PRIMARY KEY,
        razon_social text NOT NULL,
        cuit char(11)
      );

      CREATE TABLE IF NOT EXISTS cuenta_recepcion (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL,
        alias text NOT NULL,
        activa boolean NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS usuario (
        id serial PRIMARY KEY,
        usuario text NOT NULL UNIQUE,
        nombre text NOT NULL,
        email text,
        rol text NOT NULL DEFAULT 'Administrativo',
        activo boolean NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS remito (
        id serial PRIMARY KEY,
        numero text NOT NULL,
        marca_id bigint NOT NULL,
        comercio_id bigint NOT NULL,
        sucursal_id bigint,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente',
        visita_id bigint,
        entregado_en timestamp DEFAULT now(),
        actualizado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS visita (
        id serial PRIMARY KEY,
        comercio_id bigint NOT NULL,
        registrada_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS movimiento_bancario (
        id serial PRIMARY KEY,
        cuenta_id bigint NOT NULL,
        fecha_hora timestamp DEFAULT now(),
        ordenante text NOT NULL,
        ordenante_cuit char(11),
        referencia_externa text,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'sin_imputar',
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS imputacion (
        id serial PRIMARY KEY,
        movimiento_bancario_id bigint,
        cobro_id bigint,
        remito_id bigint NOT NULL,
        importe_centavos bigint NOT NULL,
        imputado_por bigint NOT NULL,
        imputado_en timestamp DEFAULT now(),
        anulado boolean NOT NULL DEFAULT false,
        anulado_por bigint,
        anulado_en timestamp,
        motivo_anulacion text,
        es_ajuste boolean NOT NULL DEFAULT false,
        motivo_ajuste text,
        comprobante_nombre text
      );

      CREATE TABLE IF NOT EXISTS ajuste_conciliacion (
        id serial PRIMARY KEY,
        movimiento_bancario_id bigint,
        remito_id bigint NOT NULL,
        motivo_tipificado text NOT NULL,
        comprobante_nombre text NOT NULL,
        importe_centavos bigint NOT NULL,
        creado_por bigint NOT NULL,
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS discrepancia_conciliacion (
        id serial PRIMARY KEY,
        movimiento_id bigint,
        movimiento_ids bigint[] DEFAULT '{}',
        remito_ids bigint[] NOT NULL,
        importe_movimiento bigint NOT NULL,
        importe_seleccionado bigint NOT NULL,
        diferencia_centavos bigint NOT NULL,
        nota text NOT NULL,
        motivo_tipificado text,
        comprobante_nombre text,
        dentro_de_tolerancia boolean NOT NULL DEFAULT false,
        estado text NOT NULL DEFAULT 'pendiente',
        creada_por bigint NOT NULL,
        creada_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS auditoria (
        id serial PRIMARY KEY,
        entidad text NOT NULL,
        entidad_id text,
        accion text NOT NULL,
        usuario_id bigint NOT NULL,
        valores_despues jsonb,
        observacion text,
        creado_en timestamp DEFAULT now()
      );

      CREATE VIEW remito_saldo AS
      SELECT  r.id AS remito_id,
              r.comercio_id,
              r.marca_id,
              r.importe_centavos,
              COALESCE(i.imputado, 0) AS imputado_centavos,
              CASE
                WHEN i.imputado IS NULL THEN r.importe_centavos
                ELSE r.importe_centavos - i.imputado
              END AS saldo_centavos,
              CASE
                  WHEN i.imputado IS NOT NULL AND r.importe_centavos = i.imputado THEN 'saldado'
                  WHEN i.imputado IS NOT NULL AND i.imputado > 0 THEN 'parcial'
                  ELSE 'pendiente'
              END AS estado_pago
      FROM remito r
      LEFT JOIN (
        SELECT remito_id, SUM(importe_centavos) AS imputado
        FROM imputacion
        WHERE anulado = false
        GROUP BY remito_id
      ) i ON i.remito_id = r.id;

      INSERT INTO sucursal VALUES (1, 'Sucursal Central');
      INSERT INTO marca VALUES (1, 'Bebidas Nacionales');
      INSERT INTO comercio VALUES (1, 'Mayorista El Sol S.R.L.', '30112233445');
      INSERT INTO cuenta_recepcion VALUES (1, 1, 'Cuenta Demo', true);
      INSERT INTO usuario VALUES (1, 'admin', 'Administrativo Demo', 'admin@tutucas.com.ar', 'Administrativo', true);
    `);

    const adapter = mem.adapters.createPg();
    db.setPool(new adapter.Pool() as any);
  });

  it('ESCENARIO 1: Justificación válida dentro de tolerancia asienta ajuste, salda remito y registra desglose', async () => {
    // Remito entregado por $100.000 (10.000.000 centavos)
    await db.query(`
      INSERT INTO remito (id, numero, marca_id, comercio_id, sucursal_id, importe_centavos, estado)
      VALUES (101, 'REM-001', 1, 1, 1, 10000000, 'entregado')
    `);

    // Movimiento bancario de $97.000 (9.700.000 centavos) -> Desvío de $3.000 (3%) <= tolerancia ($5.000 o 5%)
    await db.query(`
      INSERT INTO movimiento_bancario (id, cuenta_id, fecha_hora, ordenante, ordenante_cuit, importe_centavos, estado)
      VALUES (201, 1, now(), 'Mayorista El Sol S.R.L.', '30112233445', 9700000, 'sin_imputar')
    `);

    const res = await conciliacionService.conciliar(
      [201],
      [101],
      1,
      {
        motivoTipificado: 'Retenciones impositivas',
        comprobanteNombre: 'Certificado_Retencion_AFIP_45120.pdf',
        nota: 'Retención de Ingresos Brutos y Ganancias aplicada en origen',
      }
    );

    assert.equal(res.success, true);
    assert.equal(res.ajusteAsentado, true);
    assert.equal(res.motivoTipificado, 'Retenciones impositivas');
    assert.equal(res.desvioCentavos, '300000');

    // 1. Verificar que el remito quedó 100% saldado en la base de datos
    const remitoSaldoDb = await db.query('SELECT * FROM remito_saldo WHERE remito_id = 101');
    assert.equal(remitoSaldoDb.rows[0].saldo_centavos, 0);
    assert.equal(remitoSaldoDb.rows[0].estado_pago, 'saldado');

    // 2. Verificar que se registraron dos imputaciones: la bancaria y la de ajuste
    const imputacionesDb = await db.query('SELECT * FROM imputacion WHERE remito_id = 101 ORDER BY id');
    assert.equal(imputacionesDb.rows.length, 2);
    // Imputación 1: Monto pagado por banco
    assert.equal(imputacionesDb.rows[0].importe_centavos, 9700000);
    assert.equal(imputacionesDb.rows[0].es_ajuste, false);
    // Imputación 2: Ajuste contable por causal tipificada
    assert.equal(imputacionesDb.rows[1].importe_centavos, 300000);
    assert.equal(imputacionesDb.rows[1].es_ajuste, true);
    assert.equal(imputacionesDb.rows[1].motivo_ajuste, 'Retenciones impositivas');
    assert.equal(imputacionesDb.rows[1].comprobante_nombre, 'Certificado_Retencion_AFIP_45120.pdf');

    // 3. Verificar que se asentó el ajuste en ajuste_conciliacion
    const ajustesDb = await db.query('SELECT * FROM ajuste_conciliacion WHERE remito_id = 101');
    assert.equal(ajustesDb.rows.length, 1);
    assert.equal(ajustesDb.rows[0].motivo_tipificado, 'Retenciones impositivas');
    assert.equal(ajustesDb.rows[0].comprobante_nombre, 'Certificado_Retencion_AFIP_45120.pdf');
    assert.equal(ajustesDb.rows[0].importe_centavos, 300000);

    // 4. Verificar estado del movimiento bancario
    const movDb = await db.query('SELECT estado FROM movimiento_bancario WHERE id = 201');
    assert.equal(movDb.rows[0].estado, 'imputado');
  });

  it('ESCENARIO 2: Bloqueo y escalamiento a aprobación gerencial si la diferencia excede la tolerancia', async () => {
    // Remito entregado por $100.000 (10.000.000 centavos)
    await db.query(`
      INSERT INTO remito (id, numero, marca_id, comercio_id, sucursal_id, importe_centavos, estado)
      VALUES (102, 'REM-002', 1, 1, 1, 10000000, 'entregado')
    `);

    // Movimiento bancario de $85.000 (8.500.000 centavos) -> Desvío de $15.000 (15% > 10% tolerancia)
    await db.query(`
      INSERT INTO movimiento_bancario (id, cuenta_id, fecha_hora, ordenante, ordenante_cuit, importe_centavos, estado)
      VALUES (202, 1, now(), 'Mayorista El Sol S.R.L.', '30112233445', 8500000, 'sin_imputar')
    `);

    const res = await conciliacionService.conciliar(
      [202],
      [102],
      1,
      {
        motivoTipificado: 'Descuentos comerciales',
        comprobanteNombre: 'Acuerdo_Comercial_Descuento_Volumen.pdf',
        nota: 'Descuento especial por volumen acordado con gerencia',
      }
    );

    // El sistema bloquea la conciliación directa y envía el expediente a aprobación gerencial
    assert.equal(res.bloqueadoPorTolerancia, true);
    assert.equal(res.escaladoGerencia, true);
    assert.equal(res.estado, 'pendiente_aprobacion');
    assert.ok(res.discrepanciaId);
    assert.ok(res.message.includes('excede la tolerancia'));

    // 1. Verificar que el remito NO fue saldado (permanece pendiente)
    const remitoSaldoDb = await db.query('SELECT * FROM remito_saldo WHERE remito_id = 102');
    assert.equal(remitoSaldoDb.rows[0].saldo_centavos, 10000000);
    assert.equal(remitoSaldoDb.rows[0].estado_pago, 'pendiente');

    // 2. Verificar que el movimiento bancario permanece sin imputar
    const movDb = await db.query('SELECT estado FROM movimiento_bancario WHERE id = 202');
    assert.equal(movDb.rows[0].estado, 'sin_imputar');

    // 3. Verificar que se creó el expediente en discrepancia_conciliacion con estado pendiente_aprobacion
    const discDb = await db.query('SELECT * FROM discrepancia_conciliacion WHERE id = $1', [Number(res.discrepanciaId)]);
    assert.equal(discDb.rows.length, 1);
    assert.equal(discDb.rows[0].estado, 'pendiente_aprobacion');
    assert.equal(discDb.rows[0].motivo_tipificado, 'Descuentos comerciales');
    assert.equal(discDb.rows[0].comprobante_nombre, 'Acuerdo_Comercial_Descuento_Volumen.pdf');
    assert.equal(discDb.rows[0].dentro_de_tolerancia, false);
    assert.equal(discDb.rows[0].diferencia_centavos, -1500000);

    // 4. Verificar auditoría de escalamiento gerencial
    const auditDb = await db.query("SELECT * FROM auditoria WHERE accion = 'escalamiento_gerencial'");
    assert.equal(auditDb.rows.length, 1);
  });

  it('ESCENARIO 3: Bloquea guardado e indica campos faltantes si se omite motivo o documentación requerida', async () => {
    // Remito por $100.000
    await db.query(`
      INSERT INTO remito (id, numero, marca_id, comercio_id, sucursal_id, importe_centavos, estado)
      VALUES (103, 'REM-003', 1, 1, 1, 10000000, 'entregado')
    `);

    // Movimiento por $98.000 (diferencia monetaria)
    await db.query(`
      INSERT INTO movimiento_bancario (id, cuenta_id, fecha_hora, ordenante, ordenante_cuit, importe_centavos, estado)
      VALUES (203, 1, now(), 'Mayorista El Sol S.R.L.', '30112233445', 9800000, 'sin_imputar')
    `);

    // Caso A: Omisión total de justificación
    await assert.rejects(
      async () => {
        await conciliacionService.conciliar([203], [103], 1, null);
      },
      (err: any) => {
        assert.equal(err.status, 422);
        assert.ok(err.details?.camposFaltantes);
        return true;
      }
    );

    // Caso B: Omisión de motivo tipificado válido
    await assert.rejects(
      async () => {
        await conciliacionService.conciliar([203], [103], 1, {
          motivoTipificado: 'Motivo Inexistente' as any,
          comprobanteNombre: 'adjunto.pdf',
        });
      },
      (err: any) => {
        assert.equal(err.status, 422);
        assert.ok(err.details?.camposFaltantes?.includes('motivoTipificado'));
        return true;
      }
    );

    // Caso C: Omisión de comprobante de respaldo obligatorio
    await assert.rejects(
      async () => {
        await conciliacionService.conciliar([203], [103], 1, {
          motivoTipificado: 'Retenciones impositivas',
          comprobanteNombre: '   ',
        });
      },
      (err: any) => {
        assert.equal(err.status, 422);
        assert.ok(err.details?.camposFaltantes?.includes('comprobanteNombre'));
        return true;
      }
    );

    // Verificar que la base de datos no fue modificada
    const remitoDb = await db.query('SELECT * FROM remito_saldo WHERE remito_id = 103');
    assert.equal(remitoDb.rows[0].saldo_centavos, 10000000);
    assert.equal(remitoDb.rows[0].estado_pago, 'pendiente');
  });
});
