// backend/src/__tests__/transportistaApi.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { transportistaService } from '../services/transportistaService.js';

describe('Backend PostgreSQL - HU #22: Confirmar Entrega Remito Individual', () => {
  beforeEach(() => {
    const memDb = newDb();

    memDb.public.none(`
      CREATE TABLE IF NOT EXISTS comercio (
        id serial PRIMARY KEY,
        razon_social text NOT NULL,
        domicilio text NOT NULL,
        localidad text,
        activo boolean DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS marca (
        id serial PRIMARY KEY,
        nombre text NOT NULL,
        activa boolean DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS usuario (
        id serial PRIMARY KEY,
        usuario text NOT NULL UNIQUE,
        nombre text NOT NULL,
        rol text NOT NULL DEFAULT 'Transportista'
      );

      CREATE TABLE IF NOT EXISTS hoja_de_ruta (
        id serial PRIMARY KEY,
        sucursal_id bigint,
        transportista_id bigint NOT NULL,
        fecha_reparto date NOT NULL,
        patente text,
        estado text NOT NULL DEFAULT 'en_curso'
      );

      CREATE TABLE IF NOT EXISTS visita (
        id serial PRIMARY KEY,
        comercio_id bigint NOT NULL,
        hoja_de_ruta_id bigint,
        orden integer,
        estado text NOT NULL DEFAULT 'pendiente',
        registrada_en timestamp,
        latitud numeric,
        longitud numeric,
        observacion text
      );

      CREATE TABLE IF NOT EXISTS remito (
        id serial PRIMARY KEY,
        numero text NOT NULL,
        comercio_id bigint NOT NULL,
        marca_id bigint NOT NULL,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente',
        visita_id bigint,
        entregado_en timestamp,
        entregado_por bigint,
        latitud numeric,
        longitud numeric,
        observacion text
      );

      -- Datos de prueba
      INSERT INTO usuario (id, usuario, nombre, rol) VALUES
        (2, 'chofer', 'Carlos Repartidor', 'Transportista');

      INSERT INTO comercio (id, razon_social, domicilio) VALUES
        (1, 'Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús'),
        (2, 'Autoservicio Luna', 'Belgrano 1230, Avellaneda');

      INSERT INTO marca (id, nombre) VALUES
        (1, 'Lácteos del Sur'),
        (2, 'Bebidas Nacionales');

      INSERT INTO hoja_de_ruta (id, transportista_id, fecha_reparto, patente, estado) VALUES
        (1, 2, '2026-10-17', 'AF-321-JK', 'en_curso');

      -- Parada 1: Mayorista El Sol (Tiene 2 remitos: 101 y 102)
      INSERT INTO visita (id, comercio_id, hoja_de_ruta_id, orden, estado) VALUES
        (1, 1, 1, 1, 'en_curso'),
        (2, 2, 1, 2, 'pendiente');

      -- Remitos asociados:
      -- Visita 1 tiene DOS remitos (para probar Regla 3)
      INSERT INTO remito (id, numero, comercio_id, marca_id, importe_centavos, estado, visita_id) VALUES
        (101, 'R-0004-90001', 1, 1, 12500000, 'pendiente', 1),
        (102, 'R-0004-90002', 1, 2, 4500000, 'pendiente', 1),
        (103, 'R-0004-90003', 2, 1, 8200000, 'pendiente', 2);
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('GET /hoja-activa: Retorna la hoja de ruta en curso con paradas y remitos asignados', async () => {
    const hoja = await transportistaService.getHojaActiva('2');
    assert.ok(hoja);
    assert.equal(hoja.patente, 'AF-321-JK');
    assert.equal(hoja.visitas.length, 2);
    assert.equal(hoja.visitas[0].remitos.length, 2);
    assert.equal(hoja.visitas[1].remitos.length, 1);
    assert.equal(hoja.resumen.totalRemitos, 3);
    assert.equal(hoja.resumen.remitosEntregados, 0);
  });

  it('ESCENARIO 1: Confirmación exitosa con sello de hora, chofer y coordenadas GPS (Regla 1)', async () => {
    const timestampCaptura = '2026-10-17T21:45:00.000Z';
    const lat = -34.603722;
    const lng = -58.381592;

    const resultado = await transportistaService.confirmarEntregaRemito('103', {
      timestamp: timestampCaptura,
      transportistaId: '2',
      latitud: lat,
      longitud: lng,
    });

    assert.equal(resultado.success, true);
    assert.ok(resultado.remito);
    assert.equal(resultado.remito.estado, 'entregado');
    assert.equal(resultado.remito.entregadoPor, '2');
    assert.equal(resultado.remito.latitud, lat);
    assert.equal(resultado.remito.longitud, lng);

    // Como la visita 2 solo tenía el remito 103, al entregarse se completa la visita
    assert.equal(resultado.visitaCerrada, true);
    assert.equal(resultado.visitaEstado, 'completada');

    // Verificar persistencia en base de datos
    const remitoDb = (await db.query('SELECT * FROM remito WHERE id = 103')).rows[0];
    assert.equal(remitoDb.estado, 'entregado');
    assert.equal(String(remitoDb.entregado_por), '2');
  });

  it('REGLA 1 (Validación estricta): Falla si faltan campos obligatorios (GPS o transportista)', async () => {
    // Sin latitud
    const resSinGps = await transportistaService.confirmarEntregaRemito('101', {
      timestamp: '2026-10-17T21:45:00.000Z',
      transportistaId: '2',
      latitud: undefined as any,
      longitud: -58.381592,
    });
    assert.equal(resSinGps.success, false);
    assert.match(resSinGps.error || '', /latitud/);

    // Sin transportista
    const resSinChofer = await transportistaService.confirmarEntregaRemito('101', {
      timestamp: '2026-10-17T21:45:00.000Z',
      transportistaId: '',
      latitud: -34.60,
      longitud: -58.38,
    });
    assert.equal(resSinChofer.success, false);
    assert.match(resSinChofer.error || '', /transportista/);
  });

  it('REGLA 3: La confirmación individual NO cierra la visita general hasta que todos los remitos sean terminales', async () => {
    // La visita 1 tiene 2 remitos: 101 y 102
    // Paso 1: Confirmamos la entrega del remito 101
    const res1 = await transportistaService.confirmarEntregaRemito('101', {
      timestamp: '2026-10-17T21:40:00.000Z',
      transportistaId: '2',
      latitud: -34.6037,
      longitud: -58.3815,
    });

    assert.equal(res1.success, true);
    assert.equal(res1.remito?.estado, 'entregado');
    // REGLA 3: La visita NO debe cerrarse porque falta el remito 102
    assert.equal(res1.visitaCerrada, false);
    assert.equal(res1.visitaEstado, 'en_curso');

    const visitaDb1 = (await db.query('SELECT estado FROM visita WHERE id = 1')).rows[0];
    assert.equal(visitaDb1.estado, 'en_curso');

    // Paso 2: Ahora confirmamos el segundo remito de la parada (102)
    const res2 = await transportistaService.confirmarEntregaRemito('102', {
      timestamp: '2026-10-17T21:43:00.000Z',
      transportistaId: '2',
      latitud: -34.6038,
      longitud: -58.3816,
    });

    assert.equal(res2.success, true);
    assert.equal(res2.remito?.estado, 'entregado');
    // Ahora sí: todos los remitos de la visita 1 son terminales -> visita pasa a completada
    assert.equal(res2.visitaCerrada, true);
    assert.equal(res2.visitaEstado, 'completada');

    const visitaDb2 = (await db.query('SELECT estado FROM visita WHERE id = 1')).rows[0];
    assert.equal(visitaDb2.estado, 'completada');
  });

  it('ESCENARIO 2: Sincronización en segundo plano preserva timestamp original capturado offline', async () => {
    const timestampOriginalOffline = '2026-10-17T19:15:30.000Z'; // Capturado hace horas sin red

    const colaOffline = [
      {
        remitoId: '101',
        dto: {
          timestamp: timestampOriginalOffline,
          transportistaId: '2',
          latitud: -34.7001,
          longitud: -58.4002,
        },
      },
    ];

    const resultadoSinc = await transportistaService.sincronizarEntregas(colaOffline);
    assert.equal(resultadoSinc.success, true);
    assert.equal(resultadoSinc.exitosos, 1);

    // Verificar que el timestamp guardado en base de datos es exactamente el capturado offline
    const remitoDb = (await db.query('SELECT entregado_en as "entregadoEn" FROM remito WHERE id = 101')).rows[0];
    const fechaGuardada = new Date(remitoDb.entregadoEn).toISOString();
    assert.equal(fechaGuardada, timestampOriginalOffline);
  });

  describe('HU #23: Confirmar Entrega Remitos Multimarca', () => {
    it('ESCENARIO 1: Confirmación multimarca exitosa de toda la visita', async () => {
      // Visita 1 tiene 2 remitos pendientes de distintas marcas: 101 (Marca 1) y 102 (Marca 2)
      const timestamp = '2026-10-17T20:30:00.000Z';
      const lat = -34.6037;
      const lng = -58.3815;

      const res = await transportistaService.confirmarTodaLaVisita('1', {
        timestamp,
        transportistaId: '2',
        latitud: lat,
        longitud: lng,
      });

      assert.equal(res.success, true);
      assert.equal(res.visitaCerrada, true);
      assert.equal(res.visitaEstado, 'completada');
      assert.equal(res.conExcepciones, false);
      assert.equal(res.totalConfirmados, 2);

      // Verificar que ambos remitos pasaron a entregado con trazabilidad individual
      const r1 = (await db.query('SELECT * FROM remito WHERE id = 101')).rows[0];
      const r2 = (await db.query('SELECT * FROM remito WHERE id = 102')).rows[0];
      assert.equal(r1.estado, 'entregado');
      assert.equal(r2.estado, 'entregado');
      assert.equal(new Date(r1.entregado_en).toISOString(), timestamp);
      assert.equal(new Date(r2.entregado_en).toISOString(), timestamp);
      assert.equal(String(r1.entregado_por), '2');
      assert.equal(String(r2.entregado_por), '2');

      // Verificar que la visita quedó completada
      const visitaDb = (await db.query('SELECT * FROM visita WHERE id = 1')).rows[0];
      assert.equal(visitaDb.estado, 'completada');
    });

    it('ESCENARIO 2: Confirmación multimarca con remitos previamente aprobados (Regla 1)', async () => {
      // El remito 101 fue confirmado previamente de forma individual
      const timestampPrevio = '2026-10-17T17:00:00.000Z';
      await db.query(
        `UPDATE remito SET estado = 'entregado', entregado_en = $1::timestamptz, latitud = -34.111, longitud = -58.111, entregado_por = 2 WHERE id = 101`,
        [timestampPrevio]
      );

      // Ahora se presiona "Confirmar toda la visita"
      const timestampMasivo = '2026-10-17T20:00:00.000Z';
      const res = await transportistaService.confirmarTodaLaVisita('1', {
        timestamp: timestampMasivo,
        transportistaId: '2',
        latitud: -34.222,
        longitud: -58.222,
      });

      assert.equal(res.success, true);
      assert.equal(res.visitaCerrada, true);
      assert.equal(res.visitaEstado, 'completada');
      assert.equal(res.totalConfirmados, 1); // Solo el 102 que estaba pendiente

      // El remito 101 conserva su timestamp y coordenadas originales (Regla 1)
      const r1 = (await db.query('SELECT * FROM remito WHERE id = 101')).rows[0];
      assert.equal(r1.estado, 'entregado');
      assert.equal(new Date(r1.entregado_en).toISOString(), timestampPrevio);
      assert.equal(Number(r1.latitud), -34.111);

      // El remito 102 se confirmó con los datos masivos
      const r2 = (await db.query('SELECT * FROM remito WHERE id = 102')).rows[0];
      assert.equal(r2.estado, 'entregado');
      assert.equal(new Date(r2.entregado_en).toISOString(), timestampMasivo);
      assert.equal(Number(r2.latitud), -34.222);
    });

    it('REGLA 1 y 2: Remito rechazado previo conserva estado y visita cierra como "Entregada con excepciones"', async () => {
      // Remito 101 fue marcado como 'no_entregado'
      await db.query(`UPDATE remito SET estado = 'no_entregado' WHERE id = 101`);

      // Se confirma la visita masivamente
      const res = await transportistaService.confirmarTodaLaVisita('1', {
        timestamp: '2026-10-17T20:45:00.000Z',
        transportistaId: '2',
        latitud: -34.60,
        longitud: -58.38,
      });

      assert.equal(res.success, true);
      assert.equal(res.visitaCerrada, true);
      assert.equal(res.visitaEstado, 'completada');
      assert.equal(res.conExcepciones, true);

      // El remito rechazado NO cambió a entregado
      const r1 = (await db.query('SELECT * FROM remito WHERE id = 101')).rows[0];
      assert.equal(r1.estado, 'no_entregado');

      // El remito 102 sí se entregó
      const r2 = (await db.query('SELECT * FROM remito WHERE id = 102')).rows[0];
      assert.equal(r2.estado, 'entregado');

      // La visita registra la observación de excepciones
      const visitaDb = (await db.query('SELECT * FROM visita WHERE id = 1')).rows[0];
      assert.equal(visitaDb.estado, 'completada');
      assert.equal(visitaDb.observacion, 'Entregada con excepciones');
    });

    it('REGLA 3: Trazabilidad individual por documento con timestamps específicos', async () => {
      const res = await transportistaService.confirmarTodaLaVisita('1', {
        timestamp: '2026-10-17T20:00:00.000Z',
        transportistaId: '2',
        latitud: -34.50,
        longitud: -58.50,
        entregas: [
          { remitoId: '101', timestamp: '2026-10-17T20:01:00.000Z', latitud: -34.501, longitud: -58.501 },
          { remitoId: '102', timestamp: '2026-10-17T20:02:00.000Z', latitud: -34.502, longitud: -58.502 },
        ],
      });

      assert.equal(res.success, true);
      const r1 = (await db.query('SELECT * FROM remito WHERE id = 101')).rows[0];
      const r2 = (await db.query('SELECT * FROM remito WHERE id = 102')).rows[0];
      assert.equal(new Date(r1.entregado_en).toISOString(), '2026-10-17T20:01:00.000Z');
      assert.equal(new Date(r2.entregado_en).toISOString(), '2026-10-17T20:02:00.000Z');
      assert.equal(Number(r1.latitud), -34.501);
      assert.equal(Number(r2.latitud), -34.502);
      assert.equal(String(r1.marca_id), '1');
      assert.equal(String(r2.marca_id), '2');
    });

    it('Validación: Requiere GPS y transportista obligatorios', async () => {
      const res = await transportistaService.confirmarTodaLaVisita('1', {
        timestamp: '2026-10-17T20:00:00.000Z',
        transportistaId: '2',
        latitud: undefined as any,
        longitud: -58.50,
      });
      assert.equal(res.success, false);
      assert.match(res.error || '', /latitud/);
    });
  });
});
