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
  const sql = fs.readFileSync(path.resolve(process.cwd(), 'db/migrations/001_admin_system_role.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migración de rol Administrador del sistema aplicada.');
} catch (error) {
  console.error('No se pudo aplicar la migración:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
