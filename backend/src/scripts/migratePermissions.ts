import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tutucas_db',
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

try {
  const sql = fs.readFileSync(path.resolve(process.cwd(), 'db/migrations/002_permisos_por_sucursal.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migración de permisos por sucursal aplicada.');
} catch (error) {
  console.error('No se pudo aplicar la migración:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
