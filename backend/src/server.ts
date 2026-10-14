// backend/src/server.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from './db.js';
import { remitoRouter } from './routes/remitoRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json());

// Endpoint de estado y salud
app.get('/api/health', async (_req, res) => {
  const dbConnected = await db.checkConnection();
  res.json({
    status: 'ok',
    service: 'Tutucas Distribuidora API',
    database: dbConnected ? 'PostgreSQL Conectado' : 'PostgreSQL Desconectado',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', remitoRouter);

// Iniciar servidor solo si no estamos importando para testing
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, async () => {
    console.log(`🚀 Servidor backend escuchando en http://localhost:${PORT}`);
    const isConnected = await db.checkConnection();
    if (isConnected) {
      console.log(`🐘 Conexión exitosa con PostgreSQL.`);
    } else {
      console.log(`⚠️  PostgreSQL no responde en DATABASE_URL. Verificá que el servicio esté iniciado o corré 'npm run db:init' cuando esté disponible.`);
    }
  });
}

export default app;
