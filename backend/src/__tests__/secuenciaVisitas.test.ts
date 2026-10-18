// backend/src/__tests__/secuenciaVisitas.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { remitoService } from '../services/remitoService.js';

describe('Backend PostgreSQL - HU #13: Ordenar Secuencias de Visitas', () => {
  beforeEach(() => {
    const memDb = newDb();

    memDb.public.none(`
      CREATE TABLE IF NOT EXISTS sucursal (
        id serial PRIMARY KEY,
        nombre text NOT NULL,
        activa boolean DEFAULT true
      );

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

      INSERT INTO sucursal (id, nombre) VALUES (1, 'Sucursal Central');

      INSERT INTO comercio (id, razon_social, domicilio) VALUES
        (1, 'Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús'),
        (2, 'Autoservicio Luna', 'Belgrano 1230, Avellaneda'),
        (3, 'Distribuidora Los Andes', 'Camino Gral. Belgrano 1800, Gerli');

      INSERT INTO marca (id, nombre) VALUES
        (1, 'Lácteos del Sur'),
        (2, 'Bebidas Nacionales');

      -- Hoja de ruta en estado 'borrador'
      INSERT INTO hoja_de_ruta (id, sucursal_id, estado) VALUES (1, 1, 'borrador');

      -- 3 Visitas asociadas a la hoja de ruta con orden inicial 1, 2, 3
      INSERT INTO visita (id, comercio_id, hoja_de_ruta_id, orden, estado) VALUES
        (1, 1, 1, 1, 'pendiente'),
        (2, 2, 1, 2, 'pendiente'),
        (3, 3, 1, 3, 'pendiente');

      -- Remitos asociados a las visitas
      INSERT INTO remito (id, numero, comercio_id, marca_id, importe_centavos, estado, visita_id) VALUES
        (1, 'R-0001-45120', 1, 1, 15000000, 'AGRUPADO', 1),
        (2, 'R-0001-45121', 2, 1, 6200000, 'AGRUPADO', 2),
        (3, 'R-0002-89315', 3, 2, 9400000, 'AGRUPADO', 3);
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('ESCENARIO 1: Cambio de orden exitoso: El administrativo arrastra una visita a la primera posición. El sistema actualiza la secuencia numérica de toda la ruta.', async () => {
    // Verificar orden inicial (1, 2, 3)
    const visitasIniciales = await remitoService.getVisitas();
    assert.equal(visitasIniciales.length, 3);
    assert.equal(visitasIniciales[0].id, '1');
    assert.equal(visitasIniciales[0].orden, 1);
    assert.equal(visitasIniciales[1].id, '2');
    assert.equal(visitasIniciales[1].orden, 2);
    assert.equal(visitasIniciales[2].id, '3');
    assert.equal(visitasIniciales[2].orden, 3);

    // El administrativo mueve la visita 3 a la primera posición: ['3', '1', '2']
    const resultado = await remitoService.reordenarVisitas(['3', '1', '2'], '1');
    assert.equal(resultado.success, true);
    assert.ok(resultado.visitas);

    // Comprobar la secuencia numérica completa
    const visitasReordenadas = resultado.visitas;
    assert.equal(visitasReordenadas[0].id, '3');
    assert.equal(visitasReordenadas[0].orden, 1);

    assert.equal(visitasReordenadas[1].id, '1');
    assert.equal(visitasReordenadas[1].orden, 2);

    assert.equal(visitasReordenadas[2].id, '2');
    assert.equal(visitasReordenadas[2].orden, 3);

    // Verificar persistencia al volver a consultar
    const visitasEnBd = await remitoService.getVisitas();
    assert.deepEqual(
      visitasEnBd.map((v) => ({ id: v.id, orden: v.orden })),
      [
        { id: '3', orden: 1 },
        { id: '1', orden: 2 },
        { id: '2', orden: 3 },
      ]
    );
  });

  it('ESCENARIO 2: Fallo por ruta en curso: El administrativo intenta reordenar una hoja de ruta que ya fue despachada. El sistema bloquea el cambio por encontrarse en ejecución.', async () => {
    // Despachar la hoja de ruta (cambiar su estado a 'en_curso')
    await remitoService.cambiarEstadoHojaDeRuta('1', 'en_curso');

    const hoja = await remitoService.getHojaDeRutaActiva();
    assert.equal(hoja?.estado, 'en_curso');

    // Intentar reordenar la secuencia
    const resultado = await remitoService.reordenarVisitas(['2', '1', '3'], '1');

    // El sistema debe bloquear la operación
    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 409);
    assert.match(resultado.error || '', /despachada.*en ejecución|en ejecución/i);

    // Verificar que el orden no cambió
    const visitas = await remitoService.getVisitas();
    assert.equal(visitas.find((v) => v.id === '1')?.orden, 1);
    assert.equal(visitas.find((v) => v.id === '2')?.orden, 2);
    assert.equal(visitas.find((v) => v.id === '3')?.orden, 3);
  });
});
