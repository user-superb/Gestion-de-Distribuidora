// backend/src/__tests__/remitoApi.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { remitoService } from '../services/remitoService.js';

describe('Backend PostgreSQL - HU #12: Agrupar Remitos por Comercio', () => {
  beforeEach(() => {
    // Crear instancia in-memory de PostgreSQL para tests
    const memDb = newDb();

    memDb.public.none(`
      CREATE TABLE IF NOT EXISTS comercio (
        id serial PRIMARY KEY,
        razon_social text NOT NULL,
        domicilio text NOT NULL,
        activo boolean DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS marca (
        id serial PRIMARY KEY,
        nombre text NOT NULL,
        activa boolean DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS visita (
        id serial PRIMARY KEY,
        comercio_id bigint NOT NULL,
        hoja_de_ruta_id bigint,
        orden integer,
        estado text NOT NULL DEFAULT 'pendiente'
      );

      CREATE TABLE IF NOT EXISTS remito (
        id serial PRIMARY KEY,
        numero text NOT NULL,
        comercio_id bigint NOT NULL,
        marca_id bigint NOT NULL,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente',
        visita_id bigint
      );

      -- Datos de prueba
      INSERT INTO comercio (id, razon_social, domicilio) VALUES
        (1, 'Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús'),
        (2, 'Autoservicio Luna', 'Belgrano 1230, Avellaneda'),
        (3, 'Distribuidora Los Andes', 'Camino Gral. Belgrano 1800, Gerli');

      INSERT INTO marca (id, nombre) VALUES
        (1, 'Lácteos del Sur'),
        (2, 'Bebidas Nacionales'),
        (3, 'Alimentos Río de la Plata');

      INSERT INTO remito (id, numero, comercio_id, marca_id, importe_centavos, estado) VALUES
        (1, 'R-0001-45120', 1, 1, 15000000, 'pendiente'),
        (2, 'R-0002-89310', 1, 2, 8500000, 'pendiente'),
        (3, 'R-0001-45121', 2, 1, 6200000, 'pendiente'),
        (4, 'R-0003-11200', 2, 3, 11000000, 'pendiente'),
        (5, 'R-0002-89315', 3, 2, 9400000, 'pendiente');
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('ESCENARIO 1: Agrupación exitosa en PostgreSQL de remitos con el mismo comercio', async () => {
    const pendientesIniciales = await remitoService.getRemitosPendientes();
    assert.equal(pendientesIniciales.length, 5);

    // remitos 1 y 2 pertenecen al comercio 1 (Mayorista El Sol S.R.L.)
    const resultado = await remitoService.agruparEnVisita(['1', '2']);
    assert.equal(resultado.success, true);
    assert.ok(resultado.visita);
    assert.equal(resultado.visita.comercioId, '1');
    assert.equal(resultado.visita.remitos.length, 2);
    // 150.000 + 85.000 = 235.000
    assert.equal(resultado.visita.importeTotal, 235000);

    // Verificar que ya no figuran en pendientes
    const pendientesRestantes = await remitoService.getRemitosPendientes();
    assert.equal(pendientesRestantes.length, 3);
    assert.equal(pendientesRestantes.some((r) => r.id === '1' || r.id === '2'), false);

    // Verificar que figuran en las visitas
    const visitas = await remitoService.getVisitas();
    assert.equal(visitas.length, 1);
    assert.equal(visitas[0].id, resultado.visita.id);
  });

  it('ESCENARIO 2 (RECHAZO): No permite agrupar remitos con comercios distintos', async () => {
    // remito 1 es de comercio 1, remito 3 es de comercio 2
    const resultado = await remitoService.agruparEnVisita(['1', '3']);
    assert.equal(resultado.success, false);
    assert.match(resultado.error || '', /comercios distintos/);

    // Verificar que los estados no cambiaron
    const pendientes = await remitoService.getRemitosPendientes();
    assert.equal(pendientes.length, 5);
    const visitas = await remitoService.getVisitas();
    assert.equal(visitas.length, 0);
  });

  it('REGLA MULTIMARCA: Agrupa remitos de marcas distintas hacia el mismo comercio', async () => {
    const todos = await remitoService.getAllRemitos();
    const r1 = todos.find((r) => r.id === '1');
    const r2 = todos.find((r) => r.id === '2');

    assert.notEqual(r1?.marcaId, r2?.marcaId);
    assert.equal(r1?.comercioId, r2?.comercioId);

    const resultado = await remitoService.agruparEnVisita(['1', '2']);
    assert.equal(resultado.success, true);
    assert.equal(resultado.visita?.remitos.length, 2);
  });

  it('DESAGRUPACIÓN: Restaura los remitos a estado pendiente y elimina la visita', async () => {
    const agruparRes = await remitoService.agruparEnVisita(['1', '2']);
    assert.equal(agruparRes.success, true);
    const visitaId = agruparRes.visita!.id;

    await remitoService.desagruparVisita(visitaId);

    const visitas = await remitoService.getVisitas();
    assert.equal(visitas.length, 0);

    const pendientes = await remitoService.getRemitosPendientes();
    assert.equal(pendientes.length, 5);
    const remito1 = pendientes.find((r) => r.id === '1');
    assert.equal(remito1?.estado, 'PENDIENTE');
    assert.equal(remito1?.visitaId, null);
  });
});
