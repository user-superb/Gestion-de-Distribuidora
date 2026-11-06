import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from './authRoutes.js';

export const auditoriaRouter = Router();
auditoriaRouter.use(requireAuth, (req, res, next) => {
  if (!['Administrativo', 'Administrador del sistema'].includes((req as any).userSession?.role)) {
    return res.status(403).json({ message: 'No tenés permiso para consultar la auditoría.' });
  }
  next();
});

auditoriaRouter.get('/cuentas', async (_req, res) => {
  try {
    const result = await db.query('SELECT id::text AS id, alias FROM cuenta_recepcion ORDER BY alias, id');
    return res.json({ cuentas: result.rows });
  } catch (error) {
    console.error('Error al consultar cuentas de auditoría:', error);
    return res.status(500).json({ message: 'No se pudieron consultar las cuentas.' });
  }
});

const fechaValida = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

auditoriaRouter.get('/', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  const accion = typeof req.query.accion === 'string' ? req.query.accion : '';
  const cuenta = typeof req.query.cuenta === 'string' ? req.query.cuenta : '';
  const desde = typeof req.query.desde === 'string' ? req.query.desde : '';
  const hasta = typeof req.query.hasta === 'string' ? req.query.hasta : '';
  const pagina = typeof req.query.pagina === 'string' ? Number(req.query.pagina) : 1;
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({ message: 'Ingresá un correo electrónico válido.' });
  if (!['', 'importacion_extracto', 'validacion', 'anulacion', 'reasignacion'].includes(accion) || (cuenta && !/^[1-9]\d*$/.test(cuenta)) || !Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) return res.status(400).json({ message: 'Los filtros son inválidos.' });
  if ((desde && (!fechaValida(desde) || desde > hoy)) || (hasta && (!fechaValida(hasta) || hasta > hoy)) || (desde && hasta && desde > hasta)) return res.status(400).json({ message: 'El rango de fechas es inválido: revisá el orden y evitá fechas futuras.' });
  const condiciones: string[] = [];
  const params: unknown[] = [];
  const agregar = (sql: string, value: unknown) => { params.push(value); condiciones.push(sql.replace('?', `$${params.length}`)); };
  if (email) agregar('lower(u.email) = lower(?)', email);
  if (accion === 'validacion') condiciones.push("((a.entidad = 'rendicion_efectivo' AND a.accion = 'validacion') OR (a.entidad = 'discrepancia_conciliacion' AND a.accion = 'aprobada'))");
  else if (accion) agregar('a.accion = ?', accion);
  if (cuenta) { condiciones.push("a.entidad = 'cuenta_recepcion' AND a.accion = 'importacion_extracto'"); agregar('a.entidad_id = ?', cuenta); }
  if (desde) agregar('a.ocurrido_en >= ?', `${desde}T00:00:00-03:00`);
  if (hasta) { const next = new Date(`${hasta}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); agregar('a.ocurrido_en < ?', `${next.toISOString().slice(0, 10)}T00:00:00-03:00`); }
  params.push(51, (pagina - 1) * 50);
  try {
    const result = await db.query(
      `SELECT a.id::text, a.ocurrido_en, a.accion, a.entidad, a.entidad_id::text,
              a.valores_antes, a.valores_despues, a.observacion, u.nombre, u.email,
              c.alias AS cuenta_alias,
              re.hoja_de_ruta_id::text AS hoja_id, re.declarado_centavos::text AS declarado_actual,
              re.rendido_centavos::text AS rendido_actual,
              dc.importe_movimiento::text AS movimiento_actual, dc.importe_seleccionado::text AS seleccionado_actual
       FROM auditoria a JOIN usuario u ON u.id = a.usuario_id
       LEFT JOIN cuenta_recepcion c ON a.entidad = 'cuenta_recepcion' AND c.id = a.entidad_id
       LEFT JOIN rendicion_efectivo re ON a.entidad = 'rendicion_efectivo' AND re.id = a.entidad_id
       LEFT JOIN discrepancia_conciliacion dc ON a.entidad = 'discrepancia_conciliacion' AND dc.id = a.entidad_id
       ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
       ORDER BY a.ocurrido_en DESC, a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
    );
    return res.json({ registros: result.rows.slice(0, 50), hayMas: result.rows.length > 50, pagina });
  } catch (error) {
    console.error('Error al consultar auditoría:', error);
    return res.status(500).json({ message: 'No se pudo consultar la auditoría.' });
  }
});
