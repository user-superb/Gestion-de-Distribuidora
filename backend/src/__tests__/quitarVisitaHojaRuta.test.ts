// backend/src/__tests__/quitarVisitaHojaRuta.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { remitoService } from '../services/remitoService.js';

describe('Backend PostgreSQL - HU: Quitar una visita de una hoja de ruta para reprogramarla', () => {
  beforeEach(() => {
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

      CREATE TABLE IF NOT EXISTS sucursal (
        id serial PRIMARY KEY,
        nombre text NOT NULL,
        activa boolean DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS usuario (
        id serial PRIMARY KEY,
        usuario text NOT NULL UNIQUE,
        nombre text NOT NULL,
        email text,
        password_hash text NOT NULL,
        rol text NOT NULL DEFAULT 'Transportista',
        es_transportista boolean NOT NULL DEFAULT true,
        activo boolean NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS hoja_de_ruta (
        id serial PRIMARY KEY,
        sucursal_id bigint DEFAULT 1,
        transportista_id bigint,
        fecha_reparto date NOT NULL DEFAULT CURRENT_DATE,
        patente text,
        estado text NOT NULL DEFAULT 'pendiente_de_despacho',
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS visita (
        id serial PRIMARY KEY,
        hoja_de_ruta_id bigint REFERENCES hoja_de_ruta(id) ON DELETE CASCADE,
        comercio_id bigint NOT NULL,
        orden integer NOT NULL DEFAULT 1,
        estado text NOT NULL DEFAULT 'pendiente'
      );

      CREATE TABLE IF NOT EXISTS remito (
        id serial PRIMARY KEY,
        sucursal_id bigint DEFAULT 1,
        numero text NOT NULL,
        comercio_id bigint NOT NULL,
        marca_id bigint NOT NULL,
        visita_id bigint REFERENCES visita(id) ON DELETE SET NULL,
        importe_centavos bigint NOT NULL DEFAULT 0,
        fecha_emision date DEFAULT CURRENT_DATE,
        estado text NOT NULL DEFAULT 'pendiente',
        creado_en timestamp DEFAULT now()
      );

      INSERT INTO sucursal (id, nombre) VALUES (1, 'Sucursal Central');
      INSERT INTO comercio (id, razon_social, domicilio) VALUES
        (1, 'Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús'),
        (2, 'Autoservicio Luna', 'Belgrano 1230, Avellaneda'),
        (3, 'Distribuidora Los Andes', 'Camino Gral. Belgrano 1800, Gerli');

      INSERT INTO marca (id, nombre) VALUES
        (1, 'Arcor'),
        (2, 'La Serenísima');

      -- Hoja 100 abierta
      INSERT INTO hoja_de_ruta (id, sucursal_id, fecha_reparto, estado)
      VALUES (100, 1, '2026-10-30', 'pendiente_de_despacho');

      -- Visita 1 (Parada 1 en Hoja 100)
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado)
      VALUES (1, 100, 1, 1, 'pendiente');

      -- Visita 2 (Parada 2 en Hoja 100)
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado)
      VALUES (2, 100, 2, 2, 'pendiente');

      -- Visita 3 (Parada 3 en Hoja 100)
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado)
      VALUES (3, 100, 3, 3, 'pendiente');

      -- Remitos de Visita 1
      INSERT INTO remito (id, sucursal_id, numero, comercio_id, marca_id, visita_id, importe_centavos, estado)
      VALUES (1, 1, 'R-0001', 1, 1, 1, 10000, 'en_ruta'),
             (2, 1, 'R-0002', 1, 2, 1, 15000, 'en_ruta');

      -- Remito de Visita 2
      INSERT INTO remito (id, sucursal_id, numero, comercio_id, marca_id, visita_id, importe_centavos, estado)
      VALUES (3, 1, 'R-0003', 2, 1, 2, 25000, 'en_ruta');

      -- Remito de Visita 3
      INSERT INTO remito (id, sucursal_id, numero, comercio_id, marca_id, visita_id, importe_centavos, estado)
      VALUES (4, 1, 'R-0004', 3, 2, 3, 30000, 'en_ruta');

      -- Hoja 200 cerrada con visita completada
      INSERT INTO hoja_de_ruta (id, sucursal_id, fecha_reparto, estado)
      VALUES (200, 1, '2026-10-25', 'cerrada');

      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado)
      VALUES (4, 200, 1, 1, 'completada');

      INSERT INTO remito (id, sucursal_id, numero, comercio_id, marca_id, visita_id, importe_centavos, estado)
      VALUES (5, 1, 'R-0005', 1, 1, 4, 12000, 'entregado');

      -- Visita 5 en Hoja 100 pero con remito marcado como entregado
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado)
      VALUES (5, 100, 1, 4, 'pendiente');

      INSERT INTO remito (id, sucursal_id, numero, comercio_id, marca_id, visita_id, importe_centavos, estado)
      VALUES (6, 1, 'R-0006', 1, 1, 5, 8000, 'entregado');
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('ESCENARIO 1: Remoción exitosa: Se elimina la parada. Los remitos vuelven a la bandeja de pendientes de asignación.', async () => {
    // Quitar Visita 2 de la Hoja de Ruta 100
    const res = await remitoService.quitarVisitaDeHojaDeRuta('2', '100');

    assert.equal(res.success, true);
    assert.ok(res.remitosLiberados);
    assert.equal(res.remitosLiberados.length, 1);
    assert.equal(res.remitosLiberados[0].numeroRemito, 'R-0003');

    // 1. La parada fue eliminada de la base de datos
    const visitaDb = await db.query('SELECT * FROM visita WHERE id = 2');
    assert.equal(visitaDb.rows.length, 0);

    // 2. El remito R-0003 fue desvinculado (visita_id NULL) y vuelto a estado 'pendiente'
    const remitoDb = await db.query('SELECT visita_id, estado FROM remito WHERE id = 3');
    assert.equal(remitoDb.rows[0].visita_id, null);
    assert.equal(remitoDb.rows[0].estado, 'pendiente');

    // 3. El remito vuelve a aparecer en la bandeja de pendientes de asignación
    const pendientes = await remitoService.getRemitosPendientes();
    const remitoLiberadoEnPendientes = pendientes.find((r) => r.id === '3');
    assert.ok(remitoLiberadoEnPendientes, 'El remito debe figurar en la lista de pendientes');
    assert.equal(remitoLiberadoEnPendientes.numeroRemito, 'R-0003');

    // 4. Se resecuenció el orden de las paradas restantes en la hoja 100
    const paradasRestantes = await db.query(
      'SELECT id, orden FROM visita WHERE hoja_de_ruta_id = 100 ORDER BY orden ASC'
    );
    // Antes eran: Visita 1 (orden 1), Visita 2 (orden 2), Visita 3 (orden 3), Visita 5 (orden 4)
    // Al quitar la 2: Visita 1 tiene orden 1, Visita 3 tiene orden 2, Visita 5 tiene orden 3
    assert.equal(paradasRestantes.rows.length, 3);
    assert.equal(paradasRestantes.rows[0].id, 1);
    assert.equal(paradasRestantes.rows[0].orden, 1);
    assert.equal(paradasRestantes.rows[1].id, 3);
    assert.equal(paradasRestantes.rows[1].orden, 2);
  });

  it('ESCENARIO 2: Fallo por visita completada: Se intenta quitar una visita cuyo estado es "Entregado". El sistema impide desvincularla de la ruta histórica.', async () => {
    // Visita 4 tiene estado 'completada' en Hoja 200
    const res = await remitoService.quitarVisitaDeHojaDeRuta('4', '200');

    assert.equal(res.success, false);
    assert.equal(res.status, 409);
    assert.match(res.error || '', /no se puede quitar/i);

    // La parada histórica NO fue eliminada
    const visitaDb = await db.query('SELECT * FROM visita WHERE id = 4');
    assert.equal(visitaDb.rows.length, 1);
    assert.equal(visitaDb.rows[0].estado, 'completada');

    // El remito 5 permanece vinculado a la visita histórica
    const remitoDb = await db.query('SELECT visita_id, estado FROM remito WHERE id = 5');
    assert.equal(remitoDb.rows[0].visita_id, 4);
    assert.equal(remitoDb.rows[0].estado, 'entregado');
  });

  it('ESCENARIO 2 (variante remito entregado): Impide quitar si algún remito ya fue marcado como entregado', async () => {
    // Visita 5 tiene estado 'pendiente' pero contiene el remito 6 con estado 'entregado'
    const res = await remitoService.quitarVisitaDeHojaDeRuta('5', '100');

    assert.equal(res.success, false);
    assert.equal(res.status, 409);
    assert.match(res.error || '', /no se puede quitar/i);

    // La visita sigue intacta
    const visitaDb = await db.query('SELECT * FROM visita WHERE id = 5');
    assert.equal(visitaDb.rows.length, 1);
  });

  it('Validación: Retorna 404 si la visita no existe', async () => {
    const res = await remitoService.quitarVisitaDeHojaDeRuta('9999');
    assert.equal(res.success, false);
    assert.equal(res.status, 404);
  });

  it('Validación: Retorna 400 si la visita pertenece a otra hoja de ruta', async () => {
    // Visita 1 pertenece a Hoja 100, no a Hoja 999
    const res = await remitoService.quitarVisitaDeHojaDeRuta('1', '999');
    assert.equal(res.success, false);
    assert.equal(res.status, 400);
  });
});
