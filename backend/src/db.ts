// backend/src/db.ts
import pg from 'pg';
import dotenv from 'dotenv';
import { newDb } from 'pg-mem';
import bcryptjs from 'bcryptjs';

import path from 'path';
import fs from 'fs';

const rootEnv = path.resolve(process.cwd(), '.env');
const backendEnv = path.resolve(process.cwd(), 'backend', '.env');
if (fs.existsSync(backendEnv)) dotenv.config({ path: backendEnv });
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
dotenv.config();

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:tutucas@localhost:5432/tutucas_db';

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
      limite_autorizacion_centavos bigint NOT NULL DEFAULT 0,
      es_transportista boolean NOT NULL DEFAULT false,
      dispositivo_conectado boolean NOT NULL DEFAULT true,
      activo boolean NOT NULL DEFAULT true,
      creado_en timestamp DEFAULT now(),
      actualizado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usuario_sucursal (
      usuario_id bigint NOT NULL,
      sucursal_id bigint NOT NULL,
      PRIMARY KEY (usuario_id, sucursal_id)
    );

    CREATE TABLE IF NOT EXISTS permiso (codigo text PRIMARY KEY, descripcion text NOT NULL);

    CREATE TABLE IF NOT EXISTS usuario_sucursal_permiso (
      usuario_id bigint NOT NULL,
      sucursal_id bigint NOT NULL,
      permiso_codigo text NOT NULL,
      PRIMARY KEY (usuario_id, sucursal_id, permiso_codigo)
    );

    CREATE TABLE IF NOT EXISTS cuenta_recepcion (
      id serial PRIMARY KEY,
      sucursal_id bigint NOT NULL,
      alias text NOT NULL,
      cbu char(22),
      banco text,
      activa boolean NOT NULL DEFAULT true,
      creado_en timestamp DEFAULT now(),
      UNIQUE (sucursal_id, alias)
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

    CREATE TABLE IF NOT EXISTS token_recuperacion_contrasena (
      id serial PRIMARY KEY,
      usuario_id bigint NOT NULL,
      token_hash text NOT NULL UNIQUE,
      expira_en timestamp NOT NULL,
      usado boolean NOT NULL DEFAULT false,
      usado_en timestamp,
      creado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS marca (
      id serial PRIMARY KEY,
      nombre text NOT NULL UNIQUE,
      cuit char(11),
      activa boolean NOT NULL DEFAULT true,
      creado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS comercio (
      id serial PRIMARY KEY,
      razon_social text NOT NULL,
      nombre_fantasia text,
      cuit char(11),
      domicilio text NOT NULL,
      localidad text,
      contacto text,
      telefono text,
      ventana_desde time,
      ventana_hasta time,
      activo boolean NOT NULL DEFAULT true,
      actualizado_en timestamp DEFAULT now()
    );

        CREATE TABLE IF NOT EXISTS hoja_de_ruta (
      id serial PRIMARY KEY,
      sucursal_id bigint NOT NULL DEFAULT 1,
      transportista_id bigint,
      fecha_reparto date NOT NULL DEFAULT CURRENT_DATE,
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
      longitud numeric,
      precision_metros numeric,
      gps_disponible boolean,
      observacion text,
      cobrada_en timestamp,
      sincronizacion_pendiente boolean NOT NULL DEFAULT false
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
      longitud numeric,
      actualizado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cobro (
      id serial PRIMARY KEY,
      visita_id bigint NOT NULL,
      medio_pago text NOT NULL,
      importe_centavos bigint NOT NULL,
      registrado_en timestamp NOT NULL,
      latitud numeric,
      longitud numeric,
      registrado_por bigint NOT NULL,
      movimiento_bancario_id bigint,
      rendicion_id bigint,
      referencia_transferencia text,
      estado text NOT NULL DEFAULT 'pendiente',
      clave_idempotencia text NOT NULL UNIQUE,
      sincronizado_en timestamp,
      creado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auditoria (
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

    CREATE TABLE IF NOT EXISTS movimiento_bancario (
      id serial PRIMARY KEY,
      cuenta_id bigint NOT NULL,
      fecha_hora timestamp DEFAULT now(),
      ordenante text NOT NULL,
      ordenante_cuit char(11),
      referencia_externa text,
      importe_centavos bigint NOT NULL,
      estado text NOT NULL DEFAULT 'sin_imputar',
      creado_en timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS imputacion (
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

    CREATE TABLE IF NOT EXISTS discrepancia_conciliacion (
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
      creada_en timestamp DEFAULT now(),
      motivo_codigo text,
      resuelta_por bigint,
      resuelta_en timestamp,
      observacion_resolucion text
    );

    CREATE TABLE IF NOT EXISTS discrepancia_comprobante (
      discrepancia_id bigint PRIMARY KEY,
      nombre_archivo text NOT NULL,
      tipo_mime text NOT NULL,
      contenido bytea NOT NULL,
      tamano_bytes bigint NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discrepancia_ajuste (
      id serial PRIMARY KEY,
      discrepancia_id bigint NOT NULL,
      remito_id bigint,
      comercio_id bigint,
      tipo text NOT NULL,
      importe_centavos bigint NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discrepancia_notificacion (
      id serial PRIMARY KEY,
      discrepancia_id bigint NOT NULL,
      usuario_id bigint NOT NULL,
      mensaje text NOT NULL,
      creada_en timestamp DEFAULT now(),
      leida_en timestamp
    );

    CREATE VIEW remito_saldo AS
    WITH pagos AS (
      SELECT remito_id, SUM(importe_centavos) AS importe_centavos FROM imputacion WHERE anulado = false GROUP BY remito_id
    ), ajustes AS (
      SELECT remito_id, SUM(importe_centavos) AS importe_centavos FROM discrepancia_ajuste WHERE tipo = 'reduccion_saldo' GROUP BY remito_id
    )
    SELECT  r.id AS remito_id,
            r.comercio_id,
            r.marca_id,
            r.importe_centavos,
            COALESCE(p.importe_centavos, 0) AS imputado_centavos,
            r.importe_centavos - COALESCE(p.importe_centavos, 0) - COALESCE(a.importe_centavos, 0) AS saldo_centavos,
            CASE
                WHEN r.importe_centavos = COALESCE(p.importe_centavos, 0) + COALESCE(a.importe_centavos, 0) THEN 'saldado'
                WHEN COALESCE(p.importe_centavos, 0) + COALESCE(a.importe_centavos, 0) > 0 THEN 'parcial'
                ELSE 'pendiente'
            END AS estado_pago
    FROM remito r
    LEFT JOIN pagos p ON p.remito_id = r.id
    LEFT JOIN ajustes a ON a.remito_id = r.id;
  `);

  // Seeds iniciales
  const hash = bcryptjs.hashSync('Password123!', 10);

  mem.public.none(`
    INSERT INTO permiso (codigo, descripcion) VALUES
      ('comercio.ver', 'Consultar comercios'),
      ('comercio.editar', 'Dar de alta y modificar comercios'),
      ('archivo.importar', 'Importar archivos de proveedor'),
      ('excepcion.resolver', 'Resolver excepciones de importación'),
      ('hoja_ruta.armar', 'Armar y ordenar hojas de ruta'),
      ('hoja_ruta.publicar', 'Publicar una hoja de ruta al transportista'),
      ('remito.cargar', 'Cargar entregas manuales'),
      ('cobro.registrar', 'Registrar cobros desde la aplicación móvil'),
      ('imputacion.crear', 'Imputar cobros a remitos'),
      ('imputacion.anular', 'Anular una imputación existente'),
      ('efectivo.validar', 'Validar la rendición física de efectivo'),
      ('liquidacion.generar', 'Generar liquidaciones a las marcas'),
      ('reporte.ver', 'Consultar reportes e indicadores'),
      ('usuario.administrar', 'Administrar usuarios y permisos');

    INSERT INTO sucursal (nombre, domicilio) VALUES
      ('Sucursal Central - La Plata', 'Calle 12 N° 500, La Plata'),
      ('Depósito Sur - Berisso', 'Av. Río de la Plata 1240, Berisso'),
      ('Hub Central - Distribución', 'Ruta 2 Km 45, La Plata'),
      ('Sede Administrativa Central', 'Calle 7 N° 850, La Plata')
    ON CONFLICT (nombre) DO NOTHING;

    INSERT INTO usuario (usuario, nombre, email, password_hash, rol, es_transportista, activo) VALUES
      ('admin', 'Martín Jirafales Coordinador', 'almeidachristian94@hotmail.com', '${hash}', 'Administrativo', false, true),
      ('chofer', 'Carlos Repartidor', 'chofer@tutucas.com.ar', '${hash}', 'Transportista', true, true),
      ('supervisor', 'Valeria Logística', 'supervisor@tutucas.com.ar', '${hash}', 'Supervisor', false, true),
      ('gerencia', 'Roberto Gerente', 'gerencia@tutucas.com.ar', '${hash}', 'Gerente', false, true),
      ('admin_sistema', 'Administrador del Sistema', 'admin.sistema@tutucas.com.ar', '${hash}', 'Administrador del sistema', false, true),
      ('chofer2', 'Mario Flete', 'chofer2@tutucas.com.ar', '${hash}', 'Transportista', true, true)
    ON CONFLICT (usuario) DO NOTHING;

    INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES
      (1, 1),
      (2, 2),
      (3, 3),
      (4, 4),
      (5, 1),
      (6, 1)
    ON CONFLICT (usuario_id, sucursal_id) DO NOTHING;

    INSERT INTO cuenta_recepcion (sucursal_id, alias, banco)
    SELECT id, 'Cuenta operativa demo', 'Banco Demo' FROM sucursal WHERE nombre = 'Sucursal Central - La Plata'
    ON CONFLICT (sucursal_id, alias) DO NOTHING;

    INSERT INTO hoja_de_ruta (sucursal_id, transportista_id, estado) VALUES
      (1, 2, 'borrador')
    ON CONFLICT DO NOTHING;

    INSERT INTO marca (nombre) VALUES
      ('Lácteos del Sur'),
      ('Bebidas Nacionales'),
      ('Alimentos Río de la Plata')
    ON CONFLICT (nombre) DO NOTHING;

    INSERT INTO comercio (razon_social, domicilio, localidad) VALUES
      ('Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús', 'Lanús'),
      ('Autoservicio Luna', 'Belgrano 1230, Avellaneda', 'Avellaneda'),
      ('Distribuidora Los Andes', 'Camino Gral. Belgrano 1800, Gerli', 'Gerli');

    INSERT INTO remito (numero, marca_id, comercio_id, sucursal_id, importe_centavos, estado) VALUES
      ('R-0001-45120', 1, 1, 1, 15000000, 'pendiente'),
      ('R-0002-89310', 2, 1, 1, 700000, 'pendiente'),
      ('R-0001-45121', 1, 2, 1, 6200000, 'pendiente'),
      ('R-0003-11200', 3, 2, 1, 11000000, 'pendiente'),
      ('R-0002-89315', 2, 3, 1, 9400000, 'pendiente');
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
