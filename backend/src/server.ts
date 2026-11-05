import fs from 'node:fs';
import path from 'node:path';
// backend/src/server.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from './db.js';
import { remitoRouter } from './routes/remitoRoutes.js';
import { authRouter } from './routes/authRoutes.js';
import { conciliacionRouter } from './routes/conciliacionRoutes.js';
import { usuarioRouter } from './routes/usuarioRoutes.js';
import { configuracionRouter } from './routes/configuracionRoutes.js';
import { movilRouter } from './routes/movilRoutes.js';
import { transportistaRouter } from './routes/transportistaRoutes.js';
import { efectivoRouter } from './routes/efectivoRoutes.js';
import { asegurarEsquemaRendicion } from './services/rendicionService.js';

const rootEnv = path.resolve(process.cwd(), '.env');
const backendEnv = path.resolve(process.cwd(), 'backend', '.env');
if (fs.existsSync(backendEnv)) dotenv.config({ path: backendEnv });
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json());

// Endpoint raíz de bienvenida e información del servicio (ideal para chequeos de port-forwarding)
app.get('/', async (_req, res) => {
  const dbConnected = await db.checkConnection();
  res.json({
    status: 'ok',
    service: 'Tutucas Distribuidora API',
    database: dbConnected ? (db.isMemory() ? 'PostgreSQL In-Memory (pg-mem)' : 'PostgreSQL Conectado') : 'PostgreSQL Desconectado',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/login',
      remitos: '/api/remitos',
      hojasDeRuta: '/api/hojas-de-ruta',
      movil: '/api/movil/hoja-de-ruta',
      transportista: '/api/transportista/hoja-activa',
      efectivo: '/api/efectivo/rendiciones',
    },
    timestamp: new Date().toISOString(),
  });
});

// Endpoint de estado y salud
app.get('/api/health', async (_req, res) => {
  const dbConnected = await db.checkConnection();
  res.json({
    status: 'ok',
    service: 'Tutucas Distribuidora API',
    database: dbConnected ? (db.isMemory() ? 'PostgreSQL In-Memory (pg-mem)' : 'PostgreSQL Conectado') : 'PostgreSQL Desconectado',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', authRouter);
app.use('/api/movil', movilRouter);
app.use('/api/transportista', transportistaRouter);
app.use('/api/conciliacion', conciliacionRouter);
app.use('/api/efectivo', efectivoRouter);
app.use('/api', remitoRouter);
app.use('/api', usuarioRouter);
app.use('/api', configuracionRouter);

// Iniciar servidor solo si no estamos importando para testing
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, HOST, async () => {
    console.log(`🚀 Servidor backend escuchando en http://${HOST}:${PORT}`);
    const isConnected = await db.checkConnection();
    if (isConnected) {
      console.log(`🐘 Conexión exitosa con PostgreSQL.`);
      try {
        await db.query('ALTER TABLE hoja_de_ruta ALTER COLUMN transportista_id DROP NOT NULL;');
        await db.query('ALTER TABLE hoja_de_ruta DROP CONSTRAINT IF EXISTS hoja_unica_por_transportista_y_fecha;');
        await db.query('ALTER TABLE usuario ADD COLUMN IF NOT EXISTS dispositivo_conectado boolean NOT NULL DEFAULT false;');
        await db.query('ALTER TABLE usuario ALTER COLUMN dispositivo_conectado SET DEFAULT false;');
        await db.query('ALTER TABLE usuario ADD COLUMN IF NOT EXISTS ultimo_latido_movil timestamptz;');
        await db.query('UPDATE usuario SET dispositivo_conectado = false WHERE ultimo_latido_movil IS NULL OR ultimo_latido_movil < (now() - interval \'12 seconds\');');
        await db.query('ALTER TABLE visita ADD COLUMN IF NOT EXISTS sincronizacion_pendiente boolean NOT NULL DEFAULT false;');
        await db.query('ALTER TABLE visita ADD COLUMN IF NOT EXISTS cobrada_en timestamptz;');
        await db.query('ALTER TABLE cobro ADD COLUMN IF NOT EXISTS referencia_transferencia text;');
        await db.query('ALTER TABLE remito ADD COLUMN IF NOT EXISTS entregado_por bigint REFERENCES usuario(id);');
        await db.query('ALTER TABLE remito ADD COLUMN IF NOT EXISTS latitud numeric(9,6);');
        await db.query('ALTER TABLE remito ADD COLUMN IF NOT EXISTS longitud numeric(9,6);');
        await db.query('ALTER TABLE cuenta_recepcion ADD COLUMN IF NOT EXISTS nombre_fantasia text;');
        await db.query('ALTER TABLE cuenta_recepcion ADD COLUMN IF NOT EXISTS cuit_titular char(11);');
        await db.query("ALTER TABLE cuenta_recepcion ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS';");
        await db.query('ALTER TABLE cuenta_recepcion ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();');
        await db.query('ALTER TABLE movimiento_bancario ADD COLUMN IF NOT EXISTS concepto text;');
        await db.query("ALTER TABLE movimiento_bancario ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'Extracto Bancario';");
        await db.query(`
          CREATE TABLE IF NOT EXISTS movimiento_bancario_comprobante (
            movimiento_id bigint PRIMARY KEY REFERENCES movimiento_bancario(id) ON DELETE CASCADE,
            nombre_archivo text NOT NULL,
            tipo_mime text NOT NULL CHECK (tipo_mime IN ('application/pdf','image/jpeg','image/png')),
            contenido bytea NOT NULL,
            tamano_bytes bigint NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 5242880),
            subido_en timestamptz NOT NULL DEFAULT now()
          );
        `);
        await db.query('DROP INDEX IF EXISTS visita_comercio_unico_idx;');
        await db.query(`
          UPDATE hoja_de_ruta
          SET estado = 'en_curso'
          WHERE estado IN ('pendiente_de_despacho', 'publicada', 'asignada', 'borrador')
            AND id IN (
              SELECT DISTINCT v.hoja_de_ruta_id
              FROM visita v
              JOIN remito r ON r.visita_id = v.id
              WHERE v.hoja_de_ruta_id IS NOT NULL
                AND (r.estado = 'entregado' OR r.estado = 'no_entregado' OR v.estado = 'completada' OR v.estado = 'en_curso')
            );
        `);
      } catch (e: any) {
        console.warn('⚠️  Aviso de sincronización DDL al inicio:', e.message);
      }
      try {
        // Épica 2.3 (HU #46 a #50): columnas y estados de la rendición de efectivo.
        await asegurarEsquemaRendicion();
      } catch (e: any) {
        console.warn('⚠️  No se pudo aplicar la migración de rendición de efectivo:', e.message);
      }
    } else {
      console.log(`⚠️  PostgreSQL no responde en DATABASE_URL. Verificá que el servicio esté iniciado o corré 'npm run db:init' cuando esté disponible.`);
    }
  });
}

export default app;
