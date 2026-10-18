// Aplica un archivo .sql contra DATABASE_URL. Uso: tsx src/scripts/runSqlFile.ts db/migrations/003_cobro_movil.sql
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const archivo = process.argv[2];
if (!archivo) {
  console.error('Indicá el archivo .sql a aplicar.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tutucas_db',
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

try {
  await pool.query(fs.readFileSync(path.resolve(process.cwd(), archivo), 'utf-8'));
  console.log(`Aplicado: ${archivo}`);
} catch (error) {
  console.error(`No se pudo aplicar ${archivo}:`, error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
