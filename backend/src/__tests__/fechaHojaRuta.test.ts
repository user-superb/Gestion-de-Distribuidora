// backend/src/__tests__/fechaHojaRuta.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { remitoService } from '../services/remitoService.js';

describe('Backend PostgreSQL - HU #15: Asignar Fecha a la Hoja de Ruta', () => {
  beforeEach(() => {
    const memDb = newDb();

    memDb.public.none(`
      CREATE TABLE IF NOT EXISTS sucursal (
        id serial PRIMARY KEY,
        nombre text NOT NULL,
        activa boolean DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS hoja_de_ruta (
        id serial PRIMARY KEY,
        sucursal_id bigint DEFAULT 1,
        transportista_id bigint,
        fecha_reparto date DEFAULT CURRENT_DATE,
        patente text,
        estado text NOT NULL DEFAULT 'borrador',
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

      -- Hoja de ruta inicialmente en estado 'borrador'
      INSERT INTO hoja_de_ruta (sucursal_id, fecha_reparto, estado)
      VALUES (1, '2026-10-20', 'borrador');
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('ESCENARIO 1: Programación exitosa: Se define la fecha (en el día o a futuro) y la ruta queda en estado "Pendiente de Despacho"', async () => {
    const hojaInicial = await remitoService.getHojaDeRutaActiva();
    assert.equal(hojaInicial?.estado, 'borrador');

    // Programar para una fecha futura respecto a la fecha de referencia (2026-10-20)
    const resultado = await remitoService.asignarFechaHojaDeRuta('2026-10-25', '1', '2026-10-20');

    assert.equal(resultado.success, true);
    assert.ok(resultado.hojaDeRuta);
    assert.equal(resultado.hojaDeRuta.fechaReparto, '2026-10-25');
    assert.equal(resultado.hojaDeRuta.estado, 'pendiente_de_despacho');

    // Verificar persistencia en PostgreSQL
    const hojaPersistida = await remitoService.getHojaDeRutaActiva();
    assert.equal(hojaPersistida?.fechaReparto, '2026-10-25');
    assert.equal(hojaPersistida?.estado, 'pendiente_de_despacho');

    // También debe permitir programar para el mismo día operativo actual
    const resultadoMismoDia = await remitoService.asignarFechaHojaDeRuta('2026-10-20', '1', '2026-10-20');
    assert.equal(resultadoMismoDia.success, true);
    assert.equal(resultadoMismoDia.hojaDeRuta?.fechaReparto, '2026-10-20');
    assert.equal(resultadoMismoDia.hojaDeRuta?.estado, 'pendiente_de_despacho');
  });

  it('ESCENARIO 2: Fallo por fecha pretérita: El administrativo intenta ingresar una fecha anterior a la actual. El sistema rechaza la programación.', async () => {
    // Intentar asignar una fecha pasada (2026-10-19 siendo hoy 2026-10-20)
    const resultado = await remitoService.asignarFechaHojaDeRuta('2026-10-19', '1', '2026-10-20');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.match(resultado.error || '', /fecha anterior a la actual|en el día o a futuro/i);

    // Verificar que la hoja de ruta permanece intacta en estado 'borrador' y con su fecha original
    const hojaEnBd = await remitoService.getHojaDeRutaActiva();
    assert.equal(hojaEnBd?.estado, 'borrador');
    assert.equal(hojaEnBd?.fechaReparto, '2026-10-20');
  });

  it('FLUJO MULTI-HOJA DE RUTA: Permite armar múltiples hojas de ruta y devolver visitas a Sección 2 solo al eliminar la hoja en Sección 3', async () => {
    // 1. Insertar dos visitas en armado (hoja_de_ruta_id = NULL)
    await db.query(`INSERT INTO visita (hoja_de_ruta_id, comercio_id, orden) VALUES (NULL, 1, 1), (NULL, 2, 2)`);

    // 2. Programar la primera hoja de ruta con las dos visitas en armado
    const r1 = await remitoService.asignarFechaHojaDeRuta('2026-10-25', undefined, '2026-10-20');
    assert.equal(r1.success, true);
    const hoja1Id = r1.hojaDeRuta!.id;

    // Verificar que las dos visitas ahora pertenecen a hoja1Id (salieron de Sección 2)
    const vArmadoTrasH1 = await db.query(`SELECT id FROM visita WHERE hoja_de_ruta_id IS NULL`);
    assert.equal(vArmadoTrasH1.rows.length, 0);

    // 3. Armar una nueva visita en Sección 2 y programar una segunda hoja de ruta
    await db.query(`INSERT INTO visita (hoja_de_ruta_id, comercio_id, orden) VALUES (NULL, 3, 1)`);
    const r2 = await remitoService.asignarFechaHojaDeRuta('2026-10-26', undefined, '2026-10-20');
    assert.equal(r2.success, true);
    const hoja2Id = r2.hojaDeRuta!.id;
    assert.notEqual(hoja1Id, hoja2Id);

    const hojasArmadas = await remitoService.getHojasDeRuta();
    assert.ok(hojasArmadas.some((h) => h.id === hoja1Id));
    assert.ok(hojasArmadas.some((h) => h.id === hoja2Id));

    // 4. Eliminar la primera hoja de ruta desde la Sección 3 -> sus visitas vuelven a Sección 2 (hoja_de_ruta_id IS NULL)
    const delRes = await remitoService.eliminarHojaDeRuta(hoja1Id);
    assert.equal(delRes.success, true);

    const vArmadoTrasEliminar = await db.query(`SELECT id FROM visita WHERE hoja_de_ruta_id IS NULL ORDER BY id ASC`);
    assert.equal(vArmadoTrasEliminar.rows.length, 2);
  });
});
