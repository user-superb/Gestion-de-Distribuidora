// backend/src/scripts/queryDb.ts
import { db } from '../db.js';

async function runQuery() {
  const query = process.argv[2] || 'SELECT id, usuario, nombre, email, rol, activo FROM usuario;';

  console.log(`\n🔍 Ejecutando consulta SQL en Tutucas DB:`);
  console.log(`> ${query}\n`);

  try {
    const isConn = await db.checkConnection();
    console.log(`📡 Estado del motor: ${db.isMemory() ? 'PostgreSQL In-Memory (pg-mem)' : 'PostgreSQL Físico'}`);

    const res = await db.query(query);

    if (res.rows && res.rows.length > 0) {
      console.table(res.rows);
      console.log(`\n✅ ${res.rows.length} fila(s) obtenida(s).\n`);
    } else {
      console.log('ℹ️  La consulta no retornó filas o se ejecutó exitosamente (0 filas).\n');
    }

    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Error al ejecutar la consulta SQL:', err.message);
    process.exit(1);
  }
}

runQuery();
