import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { newDb } from 'pg-mem';
import { auditoriaRouter } from '../routes/auditoriaRoutes.js';
import { authService } from '../services/authService.js';
import { db } from '../db.js';

test('auditoría: permisos, filtros combinados, fechas y estados vacíos', async () => {
  const mem = newDb();
  mem.public.none(`
    CREATE TABLE usuario (id bigint PRIMARY KEY, nombre text, email text);
    CREATE TABLE cuenta_recepcion (id bigint PRIMARY KEY, alias text);
    CREATE TABLE rendicion_efectivo (id bigint PRIMARY KEY, hoja_de_ruta_id bigint, declarado_centavos bigint, rendido_centavos bigint);
    CREATE TABLE discrepancia_conciliacion (id bigint PRIMARY KEY, importe_movimiento bigint, importe_seleccionado bigint);
    CREATE TABLE auditoria (id bigint PRIMARY KEY, ocurrido_en timestamptz, accion text, entidad text, entidad_id bigint, usuario_id bigint, valores_antes jsonb, valores_despues jsonb, observacion text);
    INSERT INTO usuario VALUES (1, 'Ana', 'ana@ejemplo.com'), (2, 'Luis', 'luis@ejemplo.com');
    INSERT INTO cuenta_recepcion VALUES (1, 'Cuenta principal'), (2, 'Otra cuenta');
    INSERT INTO rendicion_efectivo VALUES (5, 10, 10000, 9000);
    INSERT INTO auditoria VALUES
      (1, '2025-01-02T15:00:00Z', 'importacion_extracto', 'cuenta_recepcion', 1, 1, NULL, '{"archivo":"extracto.csv","insertados":2,"omitidosDuplicados":1}', NULL),
      (2, '2025-01-03T15:00:00Z', 'validacion', 'rendicion_efectivo', 5, 1, NULL, '{"declaradoCentavos":10000,"rendidoCentavos":9000}', 'Faltante'),
      (3, '2025-01-04T15:00:00Z', 'reasignacion', 'hoja_de_ruta', 10, 2, NULL, '{}', NULL);
  `);
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool() as any;
  const originalPool = db.getPool();
  const originalVerify = authService.verifySession;
  db.setPool(pool);
  const app = express(); app.use('/api/auditoria', auditoriaRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor no disponible');
  const url = `http://127.0.0.1:${address.port}/api/auditoria`;
  const request = (query = '') => fetch(`${url}${query}`, { headers: { Authorization: 'Bearer test' } });
  try {
    assert.equal((await fetch(url)).status, 401);
    (authService as any).verifySession = async () => ({ valid: true, session: { role: 'Transportista' } });
    assert.equal((await request()).status, 403);
    (authService as any).verifySession = async () => ({ valid: true, session: { role: 'Administrativo' } });
    const all = await request(); assert.equal(all.status, 200); assert.equal(((await all.json()) as any).registros.length, 3);
    const combined = await request('?email=ANA%40EJEMPLO.COM&accion=importacion_extracto&cuenta=1&desde=2025-01-02&hasta=2025-01-02');
    assert.equal(combined.status, 200); const imported = ((await combined.json()) as any).registros;
    assert.equal(imported.length, 1); assert.equal(imported[0].cuenta_alias, 'Cuenta principal'); assert.equal(imported[0].valores_despues.omitidosDuplicados, 1);
    const validaciones = await request('?accion=validacion'); assert.equal(((await validaciones.json()) as any).registros.length, 1);
    const empty = await request('?email=nadie%40ejemplo.com'); assert.deepEqual(((await empty.json()) as any).registros, []);
    const wrongAccount = await request('?accion=importacion_extracto&cuenta=2'); assert.deepEqual(((await wrongAccount.json()) as any).registros, []);
    assert.equal((await request('?desde=2025-02-01&hasta=2025-01-01')).status, 400);
    assert.equal((await request('?desde=2999-01-01')).status, 400);
    (authService as any).verifySession = async () => ({ valid: true, session: { role: 'Administrador del sistema' } });
    assert.equal((await request('/cuentas')).status, 200);
  } finally {
    authService.verifySession = originalVerify; db.setPool(originalPool); server.close(); await pool.end();
  }
});
