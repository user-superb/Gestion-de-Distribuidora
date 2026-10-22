// backend/src/scripts/migrateAll.ts
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tutucas_db';

async function migrateAll() {
  const pool = new pg.Pool({
    connectionString,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    const client = await pool.connect();
    console.log('🔌 Conectado a PostgreSQL para aplicar migraciones y actualizar datos...');

    const migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      console.log(`⚙️  Aplicando migración: ${file}...`);
      const sql = fs.readFileSync(filePath, 'utf-8');
      await client.query(sql);
      console.log(`✅ ${file} aplicada correctamente.`);
    }

    const seedPath = path.resolve(process.cwd(), 'db', 'seed.sql');
    if (fs.existsSync(seedPath)) {
      console.log('🌱 Actualizando datos semilla (seed.sql)...');
      const seedSql = fs.readFileSync(seedPath, 'utf-8');
      await client.query(seedSql);
      console.log('✅ Datos semilla sincronizados.');
    }

    client.release();
    await pool.end();
    console.log('🎉 Todas las migraciones y semillas fueron aplicadas exitosamente en PostgreSQL.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error al aplicar las migraciones:', error);
    await pool.end();
    process.exit(1);
  }
}

migrateAll();
