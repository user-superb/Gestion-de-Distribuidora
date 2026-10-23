// backend/src/__tests__/conciliacionApi.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { conciliacionService } from '../services/conciliacionService.js';

describe('Conciliación Bancaria N a N - Servicios y Consultas', () => {
  beforeEach(() => {
    const memDb = newDb();

    memDb.public.none(`
      CREATE TABLE sucursal (
        id serial PRIMARY KEY,
        nombre text NOT NULL,
        activa boolean DEFAULT true
      );

      CREATE TABLE cuenta_recepcion (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL,
        alias text NOT NULL,
        cbu char(22),
        banco text NOT NULL,
        activa boolean DEFAULT true
      );

      CREATE TABLE usuario (
        id serial PRIMARY KEY,
        usuario text NOT NULL UNIQUE,
        nombre text NOT NULL,
        email text NOT NULL UNIQUE,
        rol text NOT NULL,
        activo boolean DEFAULT true
      );

      CREATE TABLE comercio (
        id serial PRIMARY KEY,
        razon_social text NOT NULL,
        cuit char(11),
        domicilio text NOT NULL,
        activo boolean DEFAULT true
      );

      CREATE TABLE marca (
        id serial PRIMARY KEY,
        nombre text NOT NULL,
        activa boolean DEFAULT true
      );

      CREATE TABLE visita (
        id serial PRIMARY KEY,
        comercio_id bigint,
        hoja_de_ruta_id bigint,
        orden integer,
        estado text DEFAULT 'pendiente',
        registrada_en timestamptz
      );

      CREATE TABLE remito (
        id serial PRIMARY KEY,
        numero text NOT NULL,
        comercio_id bigint NOT NULL,
        marca_id bigint NOT NULL,
        sucursal_id bigint NOT NULL,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'entregado',
        entregado_en timestamptz DEFAULT now(),
        visita_id bigint
      );

      CREATE TABLE movimiento_bancario (
        id serial PRIMARY KEY,
        cuenta_id bigint NOT NULL,
        fecha_hora timestamptz DEFAULT now(),
        ordenante text NOT NULL,
        ordenante_cuit char(11),
        referencia_externa text,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'sin_imputar',
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE imputacion (
        id serial PRIMARY KEY,
        movimiento_bancario_id bigint,
        cobro_id bigint,
        remito_id bigint NOT NULL,
        importe_centavos bigint NOT NULL,
        imputado_por bigint NOT NULL,
        imputado_en timestamp DEFAULT now(),
        anulado boolean NOT NULL DEFAULT false,
        anulado_por bigint,
        anulado_en timestamp,
        motivo_anulacion text
      );

      CREATE TABLE discrepancia_conciliacion (
        id serial PRIMARY KEY,
        movimiento_id bigint,
        movimiento_ids bigint[] DEFAULT '{}',
        remito_ids bigint[] NOT NULL,
        importe_movimiento bigint NOT NULL,
        importe_seleccionado bigint NOT NULL,
        diferencia_centavos bigint NOT NULL,
        nota text NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente',
        creada_por bigint NOT NULL,
        creada_en timestamp DEFAULT now()
      );

      CREATE TABLE auditoria (
        id serial PRIMARY KEY,
        entidad text NOT NULL,
        entidad_id bigint NOT NULL,
        accion text NOT NULL,
        usuario_id bigint NOT NULL,
        ocurrido_en timestamp DEFAULT now(),
        ip_origen text,
        valores_antes jsonb,
        valores_despues jsonb,
        observacion text
      );

      CREATE VIEW remito_saldo AS
      SELECT r.id AS remito_id, r.comercio_id, r.marca_id, r.importe_centavos,
             COALESCE(SUM(i.importe_centavos), 0) AS imputado_centavos,
             CASE
               WHEN SUM(i.importe_centavos) IS NULL OR SUM(i.importe_centavos) = 0 THEN r.importe_centavos
               ELSE r.importe_centavos - SUM(i.importe_centavos)
             END AS saldo_centavos,
             CASE
               WHEN r.importe_centavos = COALESCE(SUM(i.importe_centavos), 0) THEN 'saldado'
               WHEN COALESCE(SUM(i.importe_centavos), 0) > 0 THEN 'parcial'
               ELSE 'pendiente'
             END AS estado_cobro
      FROM remito r
      LEFT JOIN imputacion i ON i.remito_id = r.id
      GROUP BY r.id, r.comercio_id, r.marca_id, r.importe_centavos;

      -- Datos semilla para prueba
      INSERT INTO sucursal (id, nombre) VALUES (1, 'Central');
      INSERT INTO cuenta_recepcion (id, sucursal_id, alias, banco) VALUES (1, 1, 'TUTUCAS.CENTRAL', 'Banco Galicia');
      INSERT INTO usuario (id, usuario, nombre, email, rol) VALUES (1, 'admin', 'Administrativo', 'admin@tutucas.com', 'Administrativo');
      INSERT INTO comercio (id, razon_social, cuit, domicilio) VALUES (1, 'Supermercado Sol', '20123456789', 'Calle 1');
      INSERT INTO marca (id, nombre) VALUES (1, 'Marca A');

      INSERT INTO remito (id, numero, comercio_id, marca_id, sucursal_id, importe_centavos, estado)
      VALUES (1, 'R-001', 1, 1, 1, 500000, 'entregado');

      INSERT INTO movimiento_bancario (id, cuenta_id, ordenante, ordenante_cuit, importe_centavos, estado)
      VALUES (1, 1, 'Supermercado Sol', '20123456789', 500000, 'sin_imputar');
    `);

    const { Pool } = memDb.adapters.createPg();
    const testPool = new Pool() as any;
    db.setPool(testPool);
  });

  it('obtiene movimientos bancarios pendientes sin imputar', async () => {
    const movs = await conciliacionService.getMovimientosPendientes();
    assert.equal(movs.length, 1);
    assert.equal(movs[0].id, '1');
    assert.equal(movs[0].importe_centavos, '500000');
  });

  it('obtiene remitos pendientes con saldo positivo', async () => {
    const remitos = await conciliacionService.getRemitosPendientes();
    assert.equal(remitos.length, 1);
    assert.equal(remitos[0].id, '1');
    assert.equal(remitos[0].saldo_centavos, '500000');
  });

  it('genera sugerencia exacta por coincidencia de cliente e importe', async () => {
    const sugerencias = await conciliacionService.getSugerencias();
    assert.equal(sugerencias.length, 1);
    assert.equal(sugerencias[0].tipo, 'exacta');
    assert.equal(sugerencias[0].movimiento_id, '1');
    assert.equal(sugerencias[0].remito_id, '1');
  });

  it('concilia movimiento bancario con remito y actualiza estado', async () => {
    const res = await conciliacionService.conciliar(['1'], ['1'], 1);
    assert.equal(res.estado, 'imputado');
    assert.equal(res.imputaciones.length, 1);
    assert.equal(res.imputaciones[0].importeCentavos, '500000');

    // Movimientos pendientes ahora debe estar vacío
    const movsRestantes = await conciliacionService.getMovimientosPendientes();
    assert.equal(movsRestantes.length, 0);

    // Remitos pendientes ahora debe estar vacío
    const remitosRestantes = await conciliacionService.getRemitosPendientes();
    assert.equal(remitosRestantes.length, 0);
  });
});
