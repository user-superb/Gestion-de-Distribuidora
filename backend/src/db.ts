// backend/src/db.ts
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tutucas_db';

let activePool = new pg.Pool({
  connectionString,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

export const db = {
  async query(text: string, params?: any[]): Promise<pg.QueryResult<any>> {
    return activePool.query(text, params);
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
      return false;
    }
  },
};
