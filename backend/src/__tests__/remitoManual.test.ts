// backend/src/__tests__/remitoManual.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { remitoService } from '../services/remitoService.js';

describe('Backend PostgreSQL - HU: Carga Manual de Entregas', () => {
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
        localidad text,
        telefono text,
        cuit text,
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
        sucursal_id bigint,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente',
        visita_id bigint,
        archivo_id bigint
      );

      INSERT INTO sucursal (nombre) VALUES ('Sucursal Central - La Plata');

      INSERT INTO comercio (razon_social, domicilio, localidad) VALUES
        ('Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús', 'Lanús'),
        ('Autoservicio Luna', 'Belgrano 1230, Avellaneda', 'Avellaneda');

      INSERT INTO marca (nombre) VALUES
        ('Lácteos del Sur'),
        ('Bebidas Nacionales');
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('ESCENARIO 1: Carga manual exitosa de comercio registrado: Se ingresan los datos de una nueva entrega para un comercio ya registrado. El sistema genera un remito interno disponible para asignar.', async () => {
    // Comercio 1 ya existe ("Mayorista El Sol S.R.L.")
    const res = await remitoService.crearEntregaManual({
      comercioId: '1',
      marcaId: '1',
      importe: 45000,
      numeroRemito: 'MAN-REG-001',
    });

    assert.equal(res.success, true);
    assert.ok(res.remito);
    assert.equal(res.remito.numeroRemito, 'MAN-REG-001');
    assert.equal(res.remito.comercioId, '1');
    assert.equal(res.remito.marcaId, '1');
    assert.equal(res.remito.importe, 45000);
    assert.equal(res.remito.estado, 'PENDIENTE');
    assert.equal(res.remito.visitaId, null);
    assert.equal(res.esNuevoComercio, false);

    // Verificar que el remito figura como disponible para asignar en getRemitosPendientes
    const pendientes = await remitoService.getRemitosPendientes();
    const nuevoEnPendientes = pendientes.find((r) => r.id === res.remito?.id);
    assert.ok(nuevoEnPendientes, 'El remito manual debe figurar en la lista de pendientes para asignar');
    assert.equal(nuevoEnPendientes.estado, 'PENDIENTE');

    // Verificar que el remito generado puede agruparse inmediatamente en una visita
    const agruparRes = await remitoService.agruparEnVisita([res.remito.id]);
    assert.equal(agruparRes.success, true);
    assert.equal(agruparRes.visita?.comercioId, '1');
    assert.equal(agruparRes.visita?.remitos.length, 1);
  });

  it('ESCENARIO 2: Carga manual exitosa de comercio no registrado: Se ingresan los datos de una nueva entrega para un comercio no registrado. Se ingresan los datos básicos del comercio. El sistema genera un remito interno disponible para asignar.', async () => {
    // Se ingresan datos de entrega sin comercioId, con datos básicos del destinatario
    const res = await remitoService.crearEntregaManual({
      nuevoComercio: {
        razonSocial: 'Almacén Don Mario',
        domicilio: 'Calle 50 N° 1245',
        localidad: 'La Plata',
        telefono: '2214567890',
        cuit: '20304050607',
      },
      marcaId: '2',
      importe: 32000,
      numeroRemito: 'MAN-NREG-002',
    });

    assert.equal(res.success, true);
    assert.ok(res.remito);
    assert.ok(res.comercio);
    assert.equal(res.esNuevoComercio, true);
    assert.equal(res.comercio.razonSocial, 'Almacén Don Mario');
    assert.equal(res.comercio.domicilio, 'Calle 50 N° 1245');

    // El remito debe asociarse al nuevo comercio dado de alta
    assert.equal(res.remito.comercioId, res.comercio.id);
    assert.equal(res.remito.marcaId, '2');
    assert.equal(res.remito.importe, 32000);
    assert.equal(res.remito.estado, 'PENDIENTE');
    assert.equal(res.remito.visitaId, null);

    // Verificar que el nuevo comercio figura en la lista de comercios
    const comercios = await remitoService.getComercios();
    const comEnLista = comercios.find((c) => c.id === res.comercio?.id);
    assert.ok(comEnLista, 'El comercio no registrado debe haber sido dado de alta en la base');

    // Verificar que el remito interno está disponible para ser asignado/agrupado
    const pendientes = await remitoService.getRemitosPendientes();
    const remitoEnPendientes = pendientes.find((r) => r.id === res.remito?.id);
    assert.ok(remitoEnPendientes, 'El remito interno debe estar disponible para asignar');

    // Agrupación exitosa del nuevo remito y comercio
    const agruparRes = await remitoService.agruparEnVisita([res.remito.id]);
    assert.equal(agruparRes.success, true);
    assert.equal(agruparRes.visita?.comercioId, res.comercio.id);
  });

  it('AUTO-GENERACIÓN DE NÚMERO DE REMITO: Si no se provee número de remito, genera uno interno automáticamente', async () => {
    const res = await remitoService.crearEntregaManual({
      comercioId: '1',
      marcaId: '1',
      importe: 15500,
      // sin numeroRemito
    });

    assert.equal(res.success, true);
    assert.ok(res.remito);
    assert.match(res.remito.numeroRemito, /^REM-MAN-\d+$/);
    assert.equal(res.remito.estado, 'PENDIENTE');
  });

  it('VALIDACIÓN REGLA: Rechaza entrega si no se asocia a comercio registrado ni se cargan datos básicos', async () => {
    const res = await remitoService.crearEntregaManual({
      marcaId: '1',
      importe: 20000,
    });

    assert.equal(res.success, false);
    assert.equal(res.status, 400);
    assert.match(res.error || '', /comercio registrado|datos básicos/);
  });

  it('VALIDACIÓN REGLA: Rechaza entrega si faltan razón social o domicilio en comercio no registrado', async () => {
    const res = await remitoService.crearEntregaManual({
      nuevoComercio: {
        razonSocial: '   ',
        domicilio: '',
      },
      marcaId: '1',
      importe: 20000,
    });

    assert.equal(res.success, false);
    assert.equal(res.status, 400);
    assert.match(res.error || '', /datos básicos/);
  });

  it('VALIDACIÓN REGLA: Rechaza entrega si el importe no es un número positivo mayor a 0', async () => {
    const res1 = await remitoService.crearEntregaManual({
      comercioId: '1',
      marcaId: '1',
      importe: 0,
    });
    assert.equal(res1.success, false);
    assert.equal(res1.status, 400);

    const res2 = await remitoService.crearEntregaManual({
      comercioId: '1',
      marcaId: '1',
      importe: -500,
    });
    assert.equal(res2.success, false);
    assert.equal(res2.status, 400);
  });

  it('VALIDACIÓN INTEGRIDAD: Rechaza número de remito duplicado para la misma marca proveedora', async () => {
    await remitoService.crearEntregaManual({
      comercioId: '1',
      marcaId: '1',
      importe: 10000,
      numeroRemito: 'DUP-001',
    });

    const resDup = await remitoService.crearEntregaManual({
      comercioId: '2',
      marcaId: '1',
      importe: 15000,
      numeroRemito: 'DUP-001',
    });

    assert.equal(resDup.success, false);
    assert.equal(resDup.status, 409);
    assert.match(resDup.error || '', /DUP-001/);
  });
});
