// backend/src/__tests__/asignarTransportista.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { remitoService } from '../services/remitoService.js';

describe('Backend PostgreSQL - HU #14: Asignar Hoja de Ruta a Transportista', () => {
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

      -- Hoja de Ruta 100: Fecha 2026-10-25, sin transportista asignado
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (100, 1, NULL, '2026-10-25', 'pendiente_de_despacho');

      -- Hoja de Ruta 200: Misma fecha 2026-10-25, sin transportista asignado
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (200, 1, NULL, '2026-10-25', 'pendiente_de_despacho');

      -- Hoja de Ruta 300: Otra fecha (2026-10-26), asignada a Carlos (10)
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (300, 1, 10, '2026-10-26', 'pendiente_de_despacho');
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('ESCENARIO 1: Asignación exitosa sin hoja de ruta asignada previamente: El administrativo selecciona a un transportista habilitado sin otra hoja de ruta asignada en esa fecha y asigna la hoja de ruta. El sistema vincula la ruta a su perfil.', async () => {
    // Hoja 100 tiene fecha 2026-10-25. Carlos (10) solo tiene asignada la hoja 300 el 2026-10-26.
    const resultado = await remitoService.asignarTransportistaHojaDeRuta('100', '10');

    assert.equal(resultado.success, true);
    assert.ok(resultado.hojaDeRuta);
    assert.equal(resultado.hojaDeRuta.transportistaId, '10');
    assert.equal(resultado.hojaDeRuta.transportistaNombre, 'Carlos Repartidor');

    // Comprobamos en la base de datos que se vinculó a su perfil
    const checkDb = await db.query('SELECT transportista_id::text as "transportistaId" FROM hoja_de_ruta WHERE id = 100');
    assert.equal(checkDb.rows[0].transportistaId, '10');
  });

  it('ESCENARIO 2: Fallo por solapamiento de asignación: El administrativo intenta asignar la ruta a un transportista que ya posee una ruta en curso para esa misma fecha. El sistema rechaza la asignación.', async () => {
    // 1. Asignamos primero la hoja 100 (fecha 2026-10-25) al transportista Carlos (10)
    const primeraAsignacion = await remitoService.asignarTransportistaHojaDeRuta('100', '10');
    assert.equal(primeraAsignacion.success, true);

    // 2. Intentamos asignar la hoja 200 (misma fecha 2026-10-25) también a Carlos (10)
    const segundaAsignacion = await remitoService.asignarTransportistaHojaDeRuta('200', '10');

    // Debe ser rechazado
    assert.equal(segundaAsignacion.success, false);
    assert.equal(segundaAsignacion.status, 422);
    assert.match(
      segundaAsignacion.error || '',
      /ya posee una hoja de ruta asignada para esa misma fecha/i
    );

    // Verificamos que la hoja 200 sigue sin tener asignado a Carlos
    const checkDb = await db.query('SELECT transportista_id FROM hoja_de_ruta WHERE id = 200');
    assert.equal(checkDb.rows[0].transportista_id, null);
  });

  it('REGLAS A CONSIDERAR: Rechaza la asignación si el transportista no se encuentra habilitado en la flota (inactivo)', async () => {
    const resultado = await remitoService.asignarTransportistaHojaDeRuta('100', '30'); // chofer_inactivo (activo = false)

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.match(resultado.error || '', /habilitado en la flota/i);
  });

  it('REGLAS A CONSIDERAR: Rechaza la asignación si el usuario no es transportista', async () => {
    const resultado = await remitoService.asignarTransportistaHojaDeRuta('100', '40'); // admin1 (Administrativo, no chofer)

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.match(resultado.error || '', /habilitado en la flota/i);
  });

  it('REGLAS A CONSIDERAR: Rechaza si la hoja de ruta especificada no existe', async () => {
    const resultado = await remitoService.asignarTransportistaHojaDeRuta('99999', '10');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 404);
  });

  it('CATÁLOGO: getTransportistasHabilitados solo retorna choferes activos habilitados', async () => {
    const transportistas = await remitoService.getTransportistasHabilitados();

    // Deben estar Carlos (10) y Mario (20), pero NO el inactivo (30) ni el administrativo (40)
    const ids = transportistas.map((t) => t.id);
    assert.ok(ids.includes('10'));
    assert.ok(ids.includes('20'));
    assert.ok(!ids.includes('30'));
    assert.ok(!ids.includes('40'));
  });

  it('DESASIGNACIÓN: Permite desvincular un transportista pasando null', async () => {
    // Asignamos
    await remitoService.asignarTransportistaHojaDeRuta('100', '10');
    // Desasignamos
    const desasignar = await remitoService.asignarTransportistaHojaDeRuta('100', null);
    assert.equal(desasignar.success, true);
    assert.equal(desasignar.hojaDeRuta?.transportistaId, null);
    assert.equal(desasignar.hojaDeRuta?.transportistaNombre, null);
  });

  it('BLOQUEO: No permite desasignar ni modificar el transportista si la hoja ya fue despachada o cuenta con entregas', async () => {
    // Hoja 300 tiene asignado a Carlos (10). La marcamos en ejecución (despachada)
    await db.query(`UPDATE hoja_de_ruta SET estado = 'en_curso' WHERE id = 300`);

    // Intentar desasignar
    const intentoDesasignar = await remitoService.asignarTransportistaHojaDeRuta('300', null);
    assert.equal(intentoDesasignar.success, false);
    assert.equal(intentoDesasignar.status, 409);
    assert.match(intentoDesasignar.error || '', /ya fue despachada o cuenta con entregas/i);

    // Intentar reasignar a Mario (20)
    const intentoReasignar = await remitoService.asignarTransportistaHojaDeRuta('300', '20');
    assert.equal(intentoReasignar.success, false);
    assert.equal(intentoReasignar.status, 409);
    assert.match(intentoReasignar.error || '', /ya fue despachada o cuenta con entregas/i);
  });
});
