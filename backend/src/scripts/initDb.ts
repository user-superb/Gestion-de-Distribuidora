// backend/src/scripts/initDb.ts
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const targetUrl =
  process.env.DATABASE_URL || 'postgresql://postgres:tutucas@localhost:5432/tutucas_db';

async function initDb() {
  const parsed = new URL(targetUrl);
  const targetDbName = parsed.pathname.replace('/', '') || 'tutucas_db';

  // 1. Conectarse primero a la base de mantenimiento 'postgres' para verificar/crear tutucas_db
  parsed.pathname = '/postgres';
  const maintenanceUrl = parsed.toString();

  console.log(`🔌 Conectando a PostgreSQL (servidor): ${parsed.hostname}:${parsed.port || 5432}...`);
  const maintenancePool = new pg.Pool({ connectionString: maintenanceUrl });

  try {
    const mClient = await maintenancePool.connect();
    console.log('✅ Conexión con PostgreSQL establecida.');

    const checkDb = await mClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDbName]
    );

    if (checkDb.rows.length === 0) {
      console.log(`📦 Creando base de datos '${targetDbName}'...`);
      await mClient.query(`CREATE DATABASE "${targetDbName}"`);
      console.log(`✅ Base de datos '${targetDbName}' creada exitosamente.`);
    } else {
      console.log(`ℹ️  La base de datos '${targetDbName}' ya existe.`);
    }

    mClient.release();
    await maintenancePool.end();
  } catch (err: any) {
    console.warn(`⚠️  Aviso al conectar con base 'postgres': ${err.message}. Intentando conectar directamente a '${targetDbName}'...`);
    await maintenancePool.end();
  }

  // 2. Conectarse a la base de datos destino 'tutucas_db'
  console.log(`🔌 Conectando a '${targetDbName}'...`);
  const targetPool = new pg.Pool({ connectionString: targetUrl });

  try {
    const client = await targetPool.connect();
    console.log(`✅ Conectado a '${targetDbName}'.`);

    const schemaPath = path.resolve(process.cwd(), 'db', 'schema.sql');
    const seedPath = path.resolve(process.cwd(), 'db', 'seed.sql');

    console.log(`📄 Aplicando esquema DDL: ${schemaPath}...`);
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    await client.query(schemaSql);
    console.log('✅ Esquema DDL aplicado con éxito.');

    console.log(`🌱 Insertando datos semilla: ${seedPath}...`);
    const seedSql = fs.readFileSync(seedPath, 'utf-8');
    await client.query(seedSql);
    console.log('✅ Datos semilla insertados con éxito.');

    client.release();
    await targetPool.end();
    console.log('🎉 ¡Base de datos PostgreSQL inicializada y lista para Tutucas!');
  } catch (error) {
    console.error('❌ Error al inicializar las tablas:', error);
    await targetPool.end();
    process.exit(1);
  }
}

initDb();
