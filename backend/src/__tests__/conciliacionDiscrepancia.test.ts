import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db.js';
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
