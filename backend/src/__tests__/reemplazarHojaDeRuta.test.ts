// backend/src/__tests__/reemplazarHojaDeRuta.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { remitoService } from '../services/remitoService.js';

describe('Backend PostgreSQL - HU #45: Reemplazar Hoja de Ruta asignada a un Transportista', () => {
  beforeEach(() => {
    const memDb = newDb();

    memDb.public.none(`
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
        activo boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS hoja_de_ruta (
        id serial PRIMARY KEY,
        sucursal_id bigint DEFAULT 1,
        transportista_id bigint REFERENCES usuario(id),
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

      -- Transportista 1: Habilitado (Activo y es_transportista)
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, es_transportista, activo)
      VALUES (10, 'chofer1', 'Carlos Repartidor', 'chofer1@tutucas.com.ar', 'hash123', 'Transportista', true, true);

      -- Transportista 2: Habilitado (Activo)
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, es_transportista, activo)
      VALUES (20, 'chofer2', 'Mario Flete', 'chofer2@tutucas.com.ar', 'hash123', 'Transportista', true, true);

      -- Usuario 3: Inactivo (Deshabilitado en la flota)
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, es_transportista, activo)
      VALUES (30, 'chofer_inactivo', 'Lucas Inactivo', 'chofer3@tutucas.com.ar', 'hash123', 'Transportista', true, false);

      -- Usuario 4: Activo pero con rol Administrativo (No es transportista)
      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, es_transportista, activo)
      VALUES (40, 'admin1', 'Martín Admin', 'admin@tutucas.com.ar', 'hash123', 'Administrativo', false, true);

      -- Hoja 100: Fecha 2026-10-25, ya asignada a Carlos (10), estado pendiente_de_despacho
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (100, 1, 10, '2026-10-25', 'pendiente_de_despacho');

      -- Hoja 200: Misma fecha 2026-10-25, SIN transportista asignado (la nueva hoja que se asignará en reemplazo)
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (200, 1, NULL, '2026-10-25', 'pendiente_de_despacho');

      -- Hoja 300: Otra fecha (2026-10-26), asignada a Carlos (10)
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (300, 1, 10, '2026-10-26', 'pendiente_de_despacho');

      -- Hoja 400: Misma fecha 2026-10-25, pero en estado 'en_curso' asignada a Mario (20)
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (400, 1, 20, '2026-10-25', 'en_curso');

      -- Hoja 500: Misma fecha 2026-10-25, sin asignar
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (500, 1, NULL, '2026-10-25', 'pendiente_de_despacho');
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('ESCENARIO 1: Reemplazo exitoso: El administrativo selecciona a un transportista habilitado con una hoja de ruta asignada para la fecha y asigna la nueva hoja de ruta. El sistema vincula la nueva ruta a su perfil y desvincula la anterior.', async () => {
    // Carlos (10) tiene asignada la hoja 100 el 2026-10-25. Reemplazamos por la hoja 200 (misma fecha).
    const resultado = await remitoService.reemplazarHojaDeRutaTransportista('200', '10');

    assert.equal(resultado.success, true);
    assert.equal(resultado.hojaPreviaDesvinculadaId, '100');
    assert.ok(resultado.hojaDeRuta);
    assert.equal(resultado.hojaDeRuta.id, '200');
    assert.equal(resultado.hojaDeRuta.transportistaId, '10');
    assert.equal(resultado.hojaDeRuta.transportistaNombre, 'Carlos Repartidor');

    // Verificamos en base de datos que la nueva ruta (200) quedó vinculada a Carlos
    const checkNueva = await db.query('SELECT transportista_id::text as "transportistaId" FROM hoja_de_ruta WHERE id = 200');
    assert.equal(checkNueva.rows[0].transportistaId, '10');

    // Verificamos en base de datos que la ruta anterior (100) quedó desvinculada (NULL)
    const checkAnterior = await db.query('SELECT transportista_id FROM hoja_de_ruta WHERE id = 100');
    assert.equal(checkAnterior.rows[0].transportista_id, null);
  });

  it('ESCENARIO 2: Fallo por ruta activa: El administrativo selecciona a un transportista habilitado con una hoja de ruta en curso para esa misma fecha e intenta reemplazar la hoja de ruta. El sistema rechaza la asignación.', async () => {
    // Mario (20) tiene la hoja 400 en curso ('en_curso') para el 2026-10-25.
    // Intentamos reemplazarla por la hoja 500 (misma fecha).
    const resultado = await remitoService.reemplazarHojaDeRutaTransportista('500', '20');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 409);
    assert.match(resultado.error || '', /en curso/i);

    // Verificamos que la hoja previa (400) sigue asignada a Mario
    const checkPrevia = await db.query('SELECT transportista_id::text as "transportistaId" FROM hoja_de_ruta WHERE id = 400');
    assert.equal(checkPrevia.rows[0].transportistaId, '20');

    // Verificamos que la hoja 500 sigue sin asignar
    const checkNueva = await db.query('SELECT transportista_id FROM hoja_de_ruta WHERE id = 500');
    assert.equal(checkNueva.rows[0].transportista_id, null);
  });

  it('ESCENARIO 3: Fallo por no haber hoja de ruta previa: El administrativo selecciona a un transportista habilitado sin hoja de ruta para esa fecha e intenta reemplazar la hoja de ruta. El sistema rechaza la asignación.', async () => {
    // Mario (20) no tiene ninguna hoja de ruta asignada para el 2026-10-26 (solo Carlos tiene la 300).
    // Creamos una hoja 600 para el 2026-10-26 sin asignar
    await db.query(`
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (600, 1, NULL, '2026-10-26', 'pendiente_de_despacho');
    `);

    // Intentamos reemplazar la hoja de Mario en 2026-10-26 (no tiene previa)
    const resultado = await remitoService.reemplazarHojaDeRutaTransportista('600', '20');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.match(resultado.error || '', /no posee una hoja de ruta asignada para esa fecha/i);

    // La hoja 600 sigue sin asignar
    const checkNueva = await db.query('SELECT transportista_id FROM hoja_de_ruta WHERE id = 600');
    assert.equal(checkNueva.rows[0].transportista_id, null);
  });

  it('REGLAS A CONSIDERAR: Rechaza si el transportista no se encuentra habilitado en la flota (inactivo)', async () => {
    const resultado = await remitoService.reemplazarHojaDeRutaTransportista('200', '30'); // chofer_inactivo

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.match(resultado.error || '', /habilitado en la flota/i);
  });

  it('REGLAS A CONSIDERAR: Rechaza si el usuario seleccionado no es transportista', async () => {
    const resultado = await remitoService.reemplazarHojaDeRutaTransportista('200', '40'); // admin1 (Administrativo)

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.match(resultado.error || '', /habilitado en la flota/i);
  });

  it('VALIDACIÓN: Rechaza si la hoja de ruta destino no existe', async () => {
    const resultado = await remitoService.reemplazarHojaDeRutaTransportista('99999', '10');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 404);
  });

  it('VALIDACIÓN: Rechaza si la nueva hoja de ruta ya está en curso o cerrada', async () => {
    // Marcamos la hoja 200 como cerrada
    await db.query(`UPDATE hoja_de_ruta SET estado = 'cerrada' WHERE id = 200`);

    const resultado = await remitoService.reemplazarHojaDeRutaTransportista('200', '10');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 409);
    assert.match(resultado.error || '', /ya fue despachada, cerrada o anulada/i);
  });
});
