// backend/src/__tests__/anexarEntrega.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { remitoService } from '../services/remitoService.js';
import { cobroService } from '../services/cobroService.js';

describe('Backend PostgreSQL - HU #19: Anexar una Entrega a una Ruta', () => {
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
        dispositivo_conectado boolean NOT NULL DEFAULT true,
        activo boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS comercio (
        id serial PRIMARY KEY,
        razon_social text NOT NULL,
        nombre_fantasia text,
        domicilio text NOT NULL,
        localidad text,
        ventana_desde time,
        ventana_hasta time,
        telefono text,
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
        transportista_id bigint REFERENCES usuario(id),
        fecha_reparto date NOT NULL DEFAULT CURRENT_DATE,
        patente text,
        estado text NOT NULL DEFAULT 'pendiente_de_despacho',
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS visita (
        id serial PRIMARY KEY,
        hoja_de_ruta_id bigint REFERENCES hoja_de_ruta(id) ON DELETE CASCADE,
        comercio_id bigint NOT NULL REFERENCES comercio(id),
        orden integer NOT NULL DEFAULT 1,
        estado text NOT NULL DEFAULT 'pendiente',
        sincronizacion_pendiente boolean NOT NULL DEFAULT false,
        cobrada_en timestamptz
      );

      CREATE TABLE IF NOT EXISTS remito (
        id serial PRIMARY KEY,
        sucursal_id bigint DEFAULT 1,
        numero text NOT NULL,
        comercio_id bigint NOT NULL REFERENCES comercio(id),
        marca_id bigint NOT NULL REFERENCES marca(id),
        visita_id bigint REFERENCES visita(id) ON DELETE SET NULL,
        importe_centavos bigint NOT NULL DEFAULT 0,
        fecha_emision date DEFAULT CURRENT_DATE,
        estado text NOT NULL DEFAULT 'pendiente',
        creado_en timestamp DEFAULT now()
      );

      INSERT INTO sucursal (id, nombre) VALUES (1, 'Sucursal Central');

      -- Transportista 10: Conectado (Online)
      INSERT INTO usuario (id, usuario, nombre, rol, es_transportista, dispositivo_conectado, activo, password_hash)
      VALUES (10, 'chofer_online', 'Carlos Conectado', 'Transportista', true, true, true, 'hash123');

      -- Transportista 20: Desconectado (Offline)
      INSERT INTO usuario (id, usuario, nombre, rol, es_transportista, dispositivo_conectado, activo, password_hash)
      VALUES (20, 'chofer_offline', 'Mario Desconectado', 'Transportista', true, false, true, 'hash123');

      -- Comercios
      INSERT INTO comercio (id, razon_social, domicilio, localidad)
      VALUES 
        (1, 'Comercio A', 'Calle 1 #100', 'La Plata'),
        (2, 'Comercio B', 'Calle 2 #200', 'La Plata'),
        (3, 'Comercio C - Nuevo Destino', 'Calle 3 #300', 'Berisso');

      -- Marcas
      INSERT INTO marca (id, nombre) VALUES (1, 'Marca Alfa');

      -- Hoja de Ruta 100: Abierta (pendiente_de_despacho) con chofer conectado (10) para Comercio 1
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (100, 1, 10, '2026-10-28', 'pendiente_de_despacho');

      -- 2 Paradas preexistentes en la Hoja 100 (secuencia: 1, 2) para Comercio 1
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado, sincronizacion_pendiente)
      VALUES 
        (101, 100, 1, 1, 'pendiente', false),
        (102, 100, 1, 2, 'pendiente', false);

      INSERT INTO remito (id, numero, comercio_id, marca_id, visita_id, importe_centavos, estado)
      VALUES 
        (1001, 'R-01', 1, 1, 101, 100000, 'en_ruta'),
        (1002, 'R-02', 1, 1, 102, 200000, 'en_ruta');

      -- Hoja de Ruta 200: Abierta (en_curso) con chofer desconectado (20) para Comercio 2
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (200, 1, 20, '2026-10-28', 'en_curso');

      -- 1 Parada preexistente en Hoja 200 (secuencia: 1) para Comercio 2
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado, sincronizacion_pendiente)
      VALUES (201, 200, 2, 1, 'pendiente', false);

      INSERT INTO remito (id, numero, comercio_id, marca_id, visita_id, importe_centavos, estado)
      VALUES (2001, 'R-20', 2, 1, 201, 150000, 'en_ruta');

      -- Hoja de Ruta 300: CERRADA para Comercio 1
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (300, 1, 10, '2026-10-28', 'cerrada');
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado) VALUES (301, 300, 1, 1, 'completada');

      -- Hoja de Ruta 400: ANULADA para Comercio 1
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado)
      VALUES (400, 1, 10, '2026-10-28', 'anulada');
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden, estado) VALUES (401, 400, 1, 1, 'no_realizada');

      -- Remitos pendientes sin asignar
      INSERT INTO remito (id, numero, comercio_id, marca_id, visita_id, importe_centavos, estado)
      VALUES 
        (5001, 'REM-PEND-01', 1, 1, NULL, 350000, 'pendiente'),
        (5002, 'REM-PEND-02', 2, 1, NULL, 420000, 'pendiente'),
        (5003, 'REM-PEND-03', 1, 1, NULL, 180000, 'pendiente'),
        (5004, 'REM-PEND-DISTINTO', 3, 1, NULL, 150000, 'pendiente');
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('ESCENARIO 1: Anexión exitosa: Se asigna el remito a una ruta preexistente. La parada aparece al final de la secuencia del transportista.', async () => {
    // Hoja 100 tiene 2 paradas previas (orden 1 y 2) de Comercio 1. El chofer 10 está conectado. Remito 5001 es de Comercio 1.
    const resultado = await remitoService.anexarEntregaARuta('5001', '100');

    assert.equal(resultado.success, true);
    assert.ok(resultado.parada);
    // Debe quedar estrictamente al final de la secuencia (Parada #3)
    assert.equal(resultado.ordenParada, 3);
    assert.equal(resultado.parada.orden, 3);
    // Al estar el chofer conectado, no hay sincronización pendiente
    assert.equal(resultado.sincronizacionPendiente, false);
    assert.equal(resultado.alerta, undefined);

    // Verificar en base de datos que el remito fue asignado a la nueva visita
    const dbRemito = await db.query('SELECT visita_id, estado FROM remito WHERE id = 5001');
    assert.equal(String(dbRemito.rows[0].visita_id), resultado.parada.id);
    assert.equal(dbRemito.rows[0].estado, 'en_ruta');

    // Verificar en base de datos la parada al final de la secuencia
    const dbVisitas = await db.query(
      'SELECT id, orden, sincronizacion_pendiente FROM visita WHERE hoja_de_ruta_id = 100 ORDER BY orden ASC'
    );
    assert.equal(dbVisitas.rows.length, 3);
    assert.equal(dbVisitas.rows[2].orden, 3);
    assert.equal(dbVisitas.rows[2].sincronizacion_pendiente, false);
  });

  it('ESCENARIO 2: Chofer desconectado: Se anexa el remito pero el dispositivo del transportista no reporta conexión. El sistema genera una alerta visual de "Sincronización pendiente".', async () => {
    // Hoja 200 tiene 1 parada previa (orden 1) de Comercio 2. El chofer 20 reporta dispositivo_conectado = false. Remito 5002 es de Comercio 2.
    const resultado = await remitoService.anexarEntregaARuta('5002', '200');

    // Se anexa el remito exitosamente
    assert.equal(resultado.success, true);
    assert.ok(resultado.parada);
    // Aparece al final de la secuencia (Parada #2)
    assert.equal(resultado.ordenParada, 2);
    assert.equal(resultado.parada.orden, 2);

    // Genera alerta visual de sincronización pendiente
    assert.equal(resultado.sincronizacionPendiente, true);
    assert.equal(resultado.alerta, 'Sincronización pendiente');
    assert.ok(resultado.mensaje?.includes('Sincronización pendiente'));

    // Verificar en base de datos que la nueva parada guarda el flag de sincronización pendiente
    const dbVisita = await db.query('SELECT orden, sincronizacion_pendiente FROM visita WHERE id = $1', [
      resultado.parada.id,
    ]);
    assert.equal(dbVisita.rows[0].orden, 2);
    assert.equal(dbVisita.rows[0].sincronizacion_pendiente, true);

    // El remito quedó efectivamente asignado
    const dbRemito = await db.query('SELECT visita_id FROM remito WHERE id = 5002');
    assert.equal(String(dbRemito.rows[0].visita_id), resultado.parada.id);
  });

  it('REGLA A CONSIDERAR: La ruta de destino debe encontrarse abierta (Rechaza si la ruta está "cerrada")', async () => {
    // Hoja 300 está en estado 'cerrada'
    const resultado = await remitoService.anexarEntregaARuta('5003', '300');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.ok(resultado.error?.includes('no se encuentra abierta'));
    assert.ok(resultado.error?.includes('cerrada'));

    // El remito debe permanecer pendiente sin asignar
    const dbRemito = await db.query('SELECT visita_id, estado FROM remito WHERE id = 5003');
    assert.equal(dbRemito.rows[0].visita_id, null);
    assert.equal(dbRemito.rows[0].estado, 'pendiente');
  });

  it('REGLA A CONSIDERAR: La ruta de destino debe encontrarse abierta (Rechaza si la ruta está "anulada")', async () => {
    // Hoja 400 está en estado 'anulada'
    const resultado = await remitoService.anexarEntregaARuta('5003', '400');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.ok(resultado.error?.includes('no se encuentra abierta'));
    assert.ok(resultado.error?.includes('anulada'));
  });

  it('REGLA DE NEGOCIO: Rechaza anexar remito si pertenece a un comercio distinto al de la hoja de ruta', async () => {
    // Hoja 100 pertenece a Comercio 1. Remito 5004 pertenece a Comercio 3.
    const resultado = await remitoService.anexarEntregaARuta('5004', '100');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.ok(resultado.error?.includes('comercio distinto'));
  });

  it('PERMISIBILIDAD: Permite anexar a cualquier ruta abierta creada ("pendiente_de_despacho", "publicada", "en_curso")', async () => {
    await db.query("INSERT INTO hoja_de_ruta (id, transportista_id, estado) VALUES (500, 10, 'publicada')");
    // Al no tener visitas previas, acepta el remito de Comercio 1
    const resultado = await remitoService.anexarEntregaARuta('5003', '500');

    assert.equal(resultado.success, true);
    assert.equal(resultado.ordenParada, 1);
  });

  it('REGLA A CONSIDERAR: Rechaza si la hoja de ruta está en estado "borrador" (no se puede anexar si no fue conformada/creada)', async () => {
    await db.query("INSERT INTO hoja_de_ruta (id, transportista_id, estado) VALUES (600, 10, 'borrador')");
    const resultado = await remitoService.anexarEntregaARuta('5003', '600');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.ok(resultado.error?.includes('borrador'));
  });

  it('INTEGRACIÓN DATABASE Y MÓVIL: Al anexar un remito a la ruta, se actualiza la database y el transportista ve la nueva parada al final en /movil/hoja-de-ruta', async () => {
    // Anexar remito 5003 (Comercio 1) a la hoja 100 del chofer 10 ('chofer_online') programada para '2026-10-28'
    const resultado = await remitoService.anexarEntregaARuta('5003', '100');
    assert.equal(resultado.success, true);

    // 1. Verificar persistencia en PostgreSQL de remito y visita
    const remitoDb = await db.query('SELECT visita_id, estado FROM remito WHERE id = 5003');
    assert.equal(remitoDb.rows[0].estado, 'en_ruta');
    assert.ok(resultado.parada);
    assert.equal(String(remitoDb.rows[0].visita_id), resultado.parada!.id);

    // 2. Verificar que el transportista al consultar su hoja del día desde el móvil recibe la nueva parada
    const hojaMovil = await cobroService.getHojaDelDia(10, '2026-10-28');
    assert.ok(hojaMovil);
    assert.equal(hojaMovil.id, '100');
    // Tenía 2 paradas iniciales, ahora tiene 3
    assert.equal(hojaMovil.visitas.length, 3);
    const ultimaParada = hojaMovil.visitas[2];
    assert.equal(ultimaParada.id, resultado.parada!.id);
    assert.equal(ultimaParada.orden, 3);
    assert.equal(ultimaParada.remitos.length, 1);
    assert.equal(ultimaParada.remitos[0].id, '5003');
    assert.equal(ultimaParada.remitos[0].numero, 'REM-PEND-03');
  });

  it('VALIDACIÓN: Rechaza si el remito ya se encuentra asignado a otra visita', async () => {
    // Remito 1001 ya está asignado a la visita 101
    const resultado = await remitoService.anexarEntregaARuta('1001', '100');

    assert.equal(resultado.success, false);
    assert.equal(resultado.status, 422);
    assert.ok(resultado.error?.includes('ya se encuentra asignado'));
  });

  it('VALIDACIÓN: Rechaza si el remito o la hoja de ruta no existen', async () => {
    const remInexistente = await remitoService.anexarEntregaARuta('99999', '100');
    assert.equal(remInexistente.success, false);
    assert.equal(remInexistente.status, 404);

    const hojaInexistente = await remitoService.anexarEntregaARuta('5003', '99999');
    assert.equal(hojaInexistente.success, false);
    assert.equal(hojaInexistente.status, 404);
  });

  it('OVERRIDE Y DINAMISMO: Permite sobreescribir o actualizar la conectividad del dispositivo', async () => {
    // Chofer 10 está online por defecto, pero se indica explícitamente dispositivoConectado = false
    const resConOverride = await remitoService.anexarEntregaARuta('5003', '100', {
      dispositivoConectado: false,
    });

    assert.equal(resConOverride.success, true);
    assert.equal(resConOverride.sincronizacionPendiente, true);
    assert.equal(resConOverride.alerta, 'Sincronización pendiente');

    // Cambiar conexión de chofer 20 a true y anexar
    await remitoService.actualizarConexionTransportista('20', true);
    const chofer20 = await db.query('SELECT dispositivo_conectado FROM usuario WHERE id = 20');
    assert.equal(chofer20.rows[0].dispositivo_conectado, true);
  });
});
