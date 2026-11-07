// backend/src/scripts/startDevPostgres.ts
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import dotenv from 'dotenv';
// @ts-ignore
import EmbeddedPostgres from 'embedded-postgres';

const rootEnv = path.resolve(process.cwd(), '.env');
const backendEnv = path.resolve(process.cwd(), 'backend', '.env');
if (fs.existsSync(backendEnv)) dotenv.config({ path: backendEnv });
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
dotenv.config();

const targetUrl =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tutucas_db';

const parsedUrl = new URL(targetUrl);
const PORT = Number(parsedUrl.port) || 5432;
const USER = decodeURIComponent(parsedUrl.username || 'postgres');
const PASSWORD = decodeURIComponent(parsedUrl.password || 'postgres');
const DB_NAME = parsedUrl.pathname.replace(/^\//, '') || 'tutucas_db';

const backendDir = fs.existsSync(path.resolve(process.cwd(), 'db', 'schema.sql'))
  ? process.cwd()
  : path.resolve(process.cwd(), 'backend');

const dataDir = path.resolve(backendDir, 'data', 'pg16');

function isPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function applySchemaAndMigrations() {
  const pool = new pg.Pool({ connectionString: targetUrl });
  const client = await pool.connect();
  try {
    // Verificar si la tabla sucursal ya existe
    const checkTable = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'sucursal'
      ) AS exists;
    `);

    const alreadyInitialized = Boolean(checkTable.rows[0]?.exists);

    if (!alreadyInitialized) {
      const schemaPath = path.resolve(backendDir, 'db', 'schema.sql');
      console.log(`📄 Aplicando esquema inicial PostgreSQL (${schemaPath})...`);
      const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
      await client.query(schemaSql);
    }

    const migrationsDir = path.resolve(backendDir, 'db', 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        await client.query(sql);
      }
    }

    const seedPath = path.resolve(backendDir, 'db', 'seed.sql');
    if (fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf-8');
      await client.query(seedSql);
    }

    console.log(`✅ Base de datos PostgreSQL '${DB_NAME}' sincronizada (schema + migraciones + seeds).`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const alreadyUp = await isPortListening(PORT);
  let embeddedPg: EmbeddedPostgres | null = null;

  if (alreadyUp) {
    console.log(`🐘 Servidor PostgreSQL detectado activo en localhost:${PORT}.`);
  } else {
    console.log(`🐘 Iniciando servidor PostgreSQL 16 local en puerto ${PORT} (datos en ${dataDir})...`);
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });

    // Limpiar postmaster.pid huérfano si quedó de un cierre abrupto previo
    const pidFile = path.join(dataDir, 'postmaster.pid');
    if (fs.existsSync(pidFile)) {
      try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
    }

    embeddedPg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: USER,
      password: PASSWORD,
      port: PORT,
      persistent: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => {},
      onError: (msg: any) => {
        const text = String(msg || '');
        if (text.includes('FATAL') || text.includes('ERROR')) {
          console.error('[PG]', text.trim());
        }
      },
    });

    if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      console.log('📦 Inicializando clúster de PostgreSQL 16 por primera vez...');
      await embeddedPg.initialise();
    }

    await embeddedPg.start();
    console.log(`🚀 PostgreSQL 16 escuchando en localhost:${PORT}.`);

    // Asegurar que la base de datos tutucas_db exista
    const adminPool = new pg.Pool({
      host: 'localhost',
      port: PORT,
      user: USER,
      password: PASSWORD,
      database: 'postgres',
    });
    try {
      const dbExists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
      if (dbExists.rowCount === 0) {
        console.log(`📦 Creando base de datos '${DB_NAME}'...`);
        await adminPool.query(`CREATE DATABASE "${DB_NAME}"`);
      }
    } finally {
      await adminPool.end();
    }
  }

  await applySchemaAndMigrations();

  // Si se pasó --init-only, cerramos limpiamente y salimos
  if (process.argv.includes('--init-only')) {
    if (embeddedPg) {
      await embeddedPg.stop();
    }
    process.exit(0);
  }

  // Mantener el proceso vivo mientras dure `npm run dev`
  const shutdown = async () => {
    if (embeddedPg) {
      console.log('🛑 Deteniendo PostgreSQL 16 local...');
      try {
        await embeddedPg.stop();
      } catch {
        // ignore
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  console.error('❌ Error al iniciar PostgreSQL local:', err);
  process.exit(1);
});
