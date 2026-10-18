// backend/src/db.ts
import pg from 'pg';
import dotenv from 'dotenv';
import { newDb } from 'pg-mem';
import bcryptjs from 'bcryptjs';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tutucas_db';

let activePool = new pg.Pool({
  connectionString,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

let isMemoryFallback = false;
let memDbInstance: any = null;

function setupMemoryDb() {
  if (memDbInstance) return;
  const mem = newDb();

  // Tablas principales para auth, dominio y remitos
  mem.public.none(`
    CREATE TABLE IF NOT EXISTS sucursal (
      id serial PRIMARY KEY,
      nombre text NOT NULL UNIQUE,
      domicilio text,
      activa boolean NOT NULL DEFAULT true,
      creado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usuario (
      id serial PRIMARY KEY,
      usuario text NOT NULL UNIQUE,
      nombre text NOT NULL,
      email text,
      password_hash text NOT NULL,
      rol text NOT NULL DEFAULT 'Administrativo',
      es_transportista boolean NOT NULL DEFAULT false,
      activo boolean NOT NULL DEFAULT true,
      creado_en timestamp DEFAULT now(),
      actualizado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usuario_sucursal (
      usuario_id bigint NOT NULL,
      sucursal_id bigint NOT NULL,
      PRIMARY KEY (usuario_id, sucursal_id)
    );

    CREATE TABLE IF NOT EXISTS sesion_usuario (
      id text PRIMARY KEY,
      usuario_id bigint NOT NULL,
      token text NOT NULL UNIQUE,
      ip_address text,
      user_agent text,
      creado_en timestamp DEFAULT now(),
      ultimo_acceso timestamp DEFAULT now(),
      expira_en timestamp NOT NULL,
      revocado boolean NOT NULL DEFAULT false,
      revocado_en timestamp,
      motivo_cierre text
    );

    CREATE TABLE IF NOT EXISTS marca (
      id serial PRIMARY KEY,
      nombre text NOT NULL UNIQUE,
      activa boolean NOT NULL DEFAULT true,
      creado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS comercio (
      id serial PRIMARY KEY,
      razon_social text NOT NULL,
      domicilio text NOT NULL,
      localidad text,
      activo boolean NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS hoja_de_ruta (
      id serial PRIMARY KEY,
      sucursal_id bigint,
      transportista_id bigint NOT NULL,
      fecha_reparto date NOT NULL,
      patente text,
      estado text NOT NULL DEFAULT 'borrador',
      armada_por bigint,
      publicada_en timestamp,
      cerrada_en timestamp,
      creado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS visita (
      id serial PRIMARY KEY,
      comercio_id bigint NOT NULL,
      hoja_de_ruta_id bigint,
      orden integer,
      estado text NOT NULL DEFAULT 'pendiente',
      registrada_en timestamp,
      latitud numeric,
      longitud numeric
    );

    CREATE TABLE IF NOT EXISTS remito (
      id serial PRIMARY KEY,
      numero text NOT NULL,
      marca_id bigint NOT NULL,
      comercio_id bigint NOT NULL,
      sucursal_id bigint,
      importe_centavos bigint NOT NULL,
      estado text NOT NULL DEFAULT 'pendiente',
      visita_id bigint,
      entregado_en timestamp,
      entregado_por bigint,
      latitud numeric,
      longitud numeric
    );
  `);

  // Seeds iniciales
  const hash = bcryptjs.hashSync('Password123!', 10);

  mem.public.none(`
    INSERT INTO sucursal (id, nombre, domicilio) VALUES
      (1, 'Sucursal Central - La Plata', 'Calle 12 N° 500, La Plata'),
      (2, 'Depósito Sur - Berisso', 'Av. Río de la Plata 1240, Berisso'),
      (3, 'Hub Central - Distribución', 'Ruta 2 Km 45, La Plata'),
      (4, 'Sede Administrativa Central', 'Calle 7 N° 850, La Plata')
    ON CONFLICT (nombre) DO NOTHING;

    INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, es_transportista, activo) VALUES
      (1, 'admin', 'Martín Jirafales Coordinador', 'admin@tutucas.com.ar', '${hash}', 'Administrativo', false, true),
      (2, 'chofer', 'Carlos Repartidor', 'chofer@tutucas.com.ar', '${hash}', 'Transportista', true, true),
      (3, 'supervisor', 'Valeria Logística', 'supervisor@tutucas.com.ar', '${hash}', 'Supervisor', false, true),
      (4, 'gerencia', 'Roberto Gerente', 'gerencia@tutucas.com.ar', '${hash}', 'Gerente', false, true)
    ON CONFLICT (usuario) DO NOTHING;

    INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES
      (1, 1),
      (2, 2),
      (3, 3),
      (4, 4)
    ON CONFLICT (usuario_id, sucursal_id) DO NOTHING;

    INSERT INTO marca (id, nombre) VALUES
      (1, 'Lácteos del Sur'),
      (2, 'Bebidas Nacionales'),
      (3, 'Alimentos Río de la Plata')
    ON CONFLICT (nombre) DO NOTHING;

    INSERT INTO comercio (id, razon_social, domicilio, localidad) VALUES
      (1, 'Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús', 'Lanús'),
      (2, 'Autoservicio Luna', 'Belgrano 1230, Avellaneda', 'Avellaneda'),
      (3, 'Distribuidora Los Andes', 'Camino Gral. Belgrano 1800, Gerli', 'Gerli');

    INSERT INTO remito (id, numero, marca_id, comercio_id, sucursal_id, importe_centavos, estado) VALUES
      (1, 'R-0001-45120', 1, 1, 1, 15000000, 'pendiente'),
      (2, 'R-0002-89310', 2, 1, 1, 700000, 'pendiente'),
      (3, 'R-0001-45121', 1, 2, 1, 6200000, 'pendiente'),
      (4, 'R-0003-11200', 3, 2, 1, 11000000, 'pendiente'),
      (5, 'R-0002-89315', 2, 3, 1, 9400000, 'pendiente');

    -- Hoja de ruta activa asignada al chofer Carlos Repartidor (id: 2)
    INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, patente, estado) VALUES
      (1, 1, 2, CURRENT_DATE, 'AF-321-JK', 'en_curso');

    -- Parada 1: Mayorista El Sol S.R.L. (Visita con 2 remitos para validar Regla 3)
    INSERT INTO visita (id, comercio_id, hoja_de_ruta_id, orden, estado) VALUES
      (1, 1, 1, 1, 'en_curso'),
      (2, 2, 1, 2, 'pendiente');

    -- Remitos asignados a la ruta del transportista:
    -- Remitos 6 y 7 en Visita 1 (Mayorista El Sol)
    -- Remito 8 en Visita 2 (Autoservicio Luna)
    INSERT INTO remito (id, numero, marca_id, comercio_id, sucursal_id, importe_centavos, estado, visita_id) VALUES
      (6, 'R-0004-90001', 1, 1, 1, 12500000, 'pendiente', 1),
      (7, 'R-0004-90002', 2, 1, 1, 4500000, 'pendiente', 1),
      (8, 'R-0004-90003', 3, 2, 1, 8200000, 'pendiente', 2);
  `);

  memDbInstance = mem.adapters.createPg().Pool;
  activePool = new memDbInstance();
  isMemoryFallback = true;
}

export const db = {
  async query(text: string, params?: any[]): Promise<pg.QueryResult<any>> {
    try {
      return await activePool.query(text, params);
    } catch (err: any) {
      // Si la base de datos física no está accesible y no hemos activado memoria aún, activar fallback
      if (!isMemoryFallback && (err.code === 'ECONNREFUSED' || err.message?.includes('connect'))) {
        console.log('ℹ️  PostgreSQL externo offline. Activando motor PostgreSQL in-memory (pg-mem) para desarrollo...');
        setupMemoryDb();
        return await activePool.query(text, params);
      }
      throw err;
    }
  },

  getPool(): pg.Pool {
    return activePool;
  },

  setPool(newPool: pg.Pool) {
    activePool = newPool;
  },

  async checkConnection(): Promise<boolean> {
    try {
      const res = await activePool.query('SELECT 1 as connected');
      return !!res.rows[0];
    } catch {
      // Intentar fallback en memoria
      setupMemoryDb();
      return true;
    }
  },

  isMemory(): boolean {
    return isMemoryFallback;
  },
};
