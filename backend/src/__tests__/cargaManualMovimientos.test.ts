import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authRouter } from '../routes/authRoutes.js';
import { conciliacionRouter } from '../routes/conciliacionRoutes.js';
import { conciliacionService } from '../services/conciliacionService.js';

const password = 'Password123!';
let pool: any;

const validPdfComprobante = {
  originalname: 'comprobante_transferencia.pdf',
  mimetype: 'application/pdf',
  size: 16,
  buffer: Buffer.from('%PDF-1.7-respaldo'),
};

function responseMock() {
  return {
    statusCode: 200,
    body: undefined as any,
    mimeType: undefined as string | undefined,
    attachmentName: undefined as string | undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    type(t: string) { this.mimeType = t; return this; },
    attachment(name: string) { this.attachmentName = name; return this; },
    send(payload: any) { this.body = payload; return this; },
    setHeader() { return this; },
  };
}

function routeHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((item: any) => item.route?.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `No route ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function login(identifier: string) {
  const req: any = {
    body: { identifier, password },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test' },
  };
  const res = responseMock();
  await routeHandler(authRouter, 'post', '/auth/login')(req, res);
  return res;
}

async function dispatchConciliacion(
  method: 'GET' | 'POST',
  path: string,
  token: string,
  options: { body?: any; file?: any; params?: Record<string, string>; query?: Record<string, string> } = {}
) {
  const req: any = {
    method,
    url: path,
    body: options.body || {},
    file: options.file || undefined,
    params: options.params || {},
    query: options.query || {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test', authorization: `Bearer ${token}` },
  };
  const res = responseMock();

  for (const layer of (conciliacionRouter as any).stack.filter((item: any) => !item.route)) {
    for (const handle of layer.stack ? layer.stack.map((s: any) => s.handle) : [layer.handle]) {
      let continued = false;
      await handle(req, res as any, (err?: unknown) => {
        if (err) throw err;
        continued = true;
      });
      if (!continued) return res;
    }
  }

  const routeLayer: any = (conciliacionRouter as any).stack.find(
    (item: any) => item.route?.path === path && item.route.methods[method.toLowerCase()]
  );
  assert.ok(routeLayer, `No existe ${method} ${path}`);

  const stack = routeLayer.route.stack;
  if (stack.length > 1) {
    let passedRole = false;
    await stack[0].handle(req, res as any, () => { passedRole = true; });
    if (!passedRole) return res;
  }

  await stack[stack.length - 1].handle(req, res as any, () => undefined);
  return res;
}

function obtenerFechaRelativaDias(diasDelta: number): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const baseStr = formatter.format(new Date());
  const [y, m, d] = baseStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + diasDelta, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

describe('HU: Carga manual de transferencia bancaria y Carga manual de ingreso por cobro QR', () => {
  beforeEach(async () => {
    const memDb = newDb();
    memDb.public.registerFunction({
      name: 'now',
      implementation: () => new Date(),
    });

    memDb.public.none(`
      CREATE TABLE sucursal (
        id serial PRIMARY KEY,
        nombre text NOT NULL UNIQUE,
        domicilio text,
        activa boolean NOT NULL DEFAULT true
      );

      CREATE TABLE usuario (
        id serial PRIMARY KEY,
        usuario text NOT NULL UNIQUE,
        nombre text NOT NULL,
        email text,
        password_hash text NOT NULL,
        rol text NOT NULL DEFAULT 'Administrativo',
        limite_autorizacion_centavos bigint NOT NULL DEFAULT 0,
        es_transportista boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now(),
        actualizado_en timestamp DEFAULT now()
      );

      CREATE TABLE usuario_sucursal (
        usuario_id bigint NOT NULL,
        sucursal_id bigint NOT NULL,
        PRIMARY KEY (usuario_id, sucursal_id)
      );

      CREATE TABLE sesion_usuario (
        id text PRIMARY KEY,
        usuario_id bigint NOT NULL,
        token text NOT NULL UNIQUE,
        ip_address text,
        user_agent text,
        creado_en timestamp DEFAULT now(),
        ultimo_acceso timestamp DEFAULT now(),
        expira_en timestamp NOT NULL,
        revocado boolean NOT NULL DEFAULT false,
        revocado_en timestamp,
        motivo_cierre text
      );

      CREATE TABLE intento_login (
        id serial PRIMARY KEY,
        identificador text NOT NULL,
        ip_address text,
        exitoso boolean NOT NULL,
        motivo_fallo text,
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE marca (
        id serial PRIMARY KEY,
        nombre text NOT NULL UNIQUE,
        activa boolean NOT NULL DEFAULT true
      );

      CREATE TABLE comercio (
        id serial PRIMARY KEY,
        razon_social text NOT NULL,
        cuit char(11),
        domicilio text NOT NULL,
        activo boolean NOT NULL DEFAULT true
      );

      CREATE TABLE visita (
        id serial PRIMARY KEY,
        comercio_id bigint NOT NULL,
        hoja_de_ruta_id bigint,
        orden integer,
        estado text NOT NULL DEFAULT 'completada',
        registrada_en timestamp DEFAULT now()
      );

      CREATE TABLE remito (
        id serial PRIMARY KEY,
        numero text NOT NULL,
        marca_id bigint NOT NULL,
        comercio_id bigint NOT NULL,
        sucursal_id bigint NOT NULL,
        importe_centavos bigint NOT NULL,
        estado text NOT NULL DEFAULT 'entregado',
        visita_id bigint,
        entregado_en timestamp DEFAULT now()
      );

      CREATE TABLE cuenta_recepcion (
        id serial PRIMARY KEY,
        sucursal_id bigint NOT NULL REFERENCES sucursal(id),
        nombre_fantasia text,
        alias text NOT NULL,
        cbu char(22),
        banco text,
        cuit_titular char(11),
        moneda text NOT NULL DEFAULT 'ARS',
        activa boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now(),
        actualizado_en timestamp DEFAULT now(),
        UNIQUE (sucursal_id, alias)
      );

      CREATE TABLE movimiento_bancario (
        id serial PRIMARY KEY,
        cuenta_id bigint NOT NULL REFERENCES cuenta_recepcion(id),
        fecha_hora timestamp NOT NULL DEFAULT now(),
        ordenante text NOT NULL,
        ordenante_cuit char(11),
        concepto text,
        referencia_externa text,
        importe_centavos bigint NOT NULL,
        origen text NOT NULL DEFAULT 'Extracto Bancario',
        estado text NOT NULL DEFAULT 'sin_imputar',
        creado_en timestamp DEFAULT now(),
        UNIQUE (cuenta_id, referencia_externa)
      );

      CREATE TABLE movimiento_bancario_comprobante (
        movimiento_id bigint PRIMARY KEY REFERENCES movimiento_bancario(id) ON DELETE CASCADE,
        nombre_archivo text NOT NULL,
        tipo_mime text NOT NULL,
        contenido bytea NOT NULL,
        tamano_bytes bigint NOT NULL,
        subido_en timestamp DEFAULT now()
      );

      CREATE TABLE cobro (
        id serial PRIMARY KEY,
        visita_id bigint NOT NULL,
        medio_pago text NOT NULL,
        importe_centavos bigint NOT NULL,
        registrado_en timestamp NOT NULL DEFAULT now(),
        registrado_por bigint NOT NULL,
        movimiento_bancario_id bigint,
        referencia_transferencia text,
        estado text NOT NULL DEFAULT 'pendiente',
        clave_idempotencia text NOT NULL UNIQUE
      );

      CREATE TABLE imputacion (
        id serial PRIMARY KEY,
        movimiento_bancario_id bigint,
        cobro_id bigint,
        remito_id bigint NOT NULL,
        importe_centavos bigint NOT NULL,
        imputado_por bigint NOT NULL,
        imputado_en timestamp DEFAULT now(),
        anulado boolean NOT NULL DEFAULT false
      );

      CREATE TABLE discrepancia_conciliacion (
        id serial PRIMARY KEY,
        movimiento_id bigint,
        movimiento_ids bigint[] DEFAULT '{}',
        remito_ids bigint[] NOT NULL,
        importe_movimiento bigint NOT NULL,
        importe_seleccionado bigint NOT NULL,
        diferencia_centavos bigint NOT NULL,
        nota text NOT NULL,
        estado text NOT NULL DEFAULT 'pendiente',
        creada_por bigint NOT NULL,
        creada_en timestamp DEFAULT now()
      );

      CREATE TABLE discrepancia_ajuste (
        id serial PRIMARY KEY,
        discrepancia_id bigint NOT NULL,
        remito_id bigint,
        comercio_id bigint,
        tipo text NOT NULL,
        importe_centavos bigint NOT NULL
      );

      CREATE VIEW remito_saldo AS
      WITH pagos AS (
        SELECT remito_id, SUM(importe_centavos)::bigint AS importe_centavos FROM imputacion WHERE anulado = false GROUP BY remito_id
      ), ajustes AS (
        SELECT remito_id, SUM(importe_centavos)::bigint AS importe_centavos FROM discrepancia_ajuste WHERE tipo = 'reduccion_saldo' GROUP BY remito_id
      )
      SELECT r.id AS remito_id,
             r.comercio_id,
             r.marca_id,
             r.importe_centavos,
             COALESCE(p.importe_centavos, 0) AS imputado_centavos,
             (r.importe_centavos - COALESCE(p.importe_centavos, 0) - COALESCE(a.importe_centavos, 0))::bigint AS saldo_centavos,
             CASE
               WHEN r.importe_centavos = COALESCE(p.importe_centavos, 0) + COALESCE(a.importe_centavos, 0) THEN 'saldado'
               WHEN COALESCE(p.importe_centavos, 0) + COALESCE(a.importe_centavos, 0) > 0 THEN 'parcial'
               ELSE 'pendiente'
             END AS estado_cobro
      FROM remito r
      LEFT JOIN pagos p ON p.remito_id = r.id
      LEFT JOIN ajustes a ON a.remito_id = r.id;

      CREATE TABLE auditoria (
        id serial PRIMARY KEY,
        entidad text NOT NULL,
        entidad_id bigint NOT NULL,
        accion text NOT NULL,
        usuario_id bigint NOT NULL,
        ocurrido_en timestamp DEFAULT now(),
        valores_antes jsonb,
        valores_despues jsonb,
        observacion text
      );
    `);

    const hash = bcryptjs.hashSync(password, 4);

    memDb.public.none(`
      INSERT INTO sucursal (id, nombre, domicilio, activa) VALUES
        (1, 'Sucursal Central - La Plata', 'Calle 12 N° 500', true);

      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo) VALUES
        (1, 'admin', 'Martín Administrativo', 'admin@tutucas.local', '${hash}', 'Administrativo', true);

      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (1, 1);

      INSERT INTO marca (id, nombre, activa) VALUES (1, 'Lácteos del Sur', true);

      INSERT INTO comercio (id, razon_social, cuit, domicilio, activo) VALUES
        (1, 'Mayorista El Sol S.R.L.', '30111222334', 'Av. Hipólito Yrigoyen 4500', true),
        (2, 'Autoservicio Luna', '30222333445', 'Belgrano 1230', true);

      INSERT INTO remito (id, numero, marca_id, comercio_id, sucursal_id, importe_centavos, estado, entregado_en) VALUES
        (10, 'R-0001-9001', 1, 1, 1, 8500000, 'entregado', now()),
        (11, 'R-0001-9002', 1, 2, 1, 4200000, 'entregado', now());

      INSERT INTO cuenta_recepcion (id, sucursal_id, nombre_fantasia, alias, cbu, banco, cuit_titular, moneda, activa) VALUES
        (1, 1, 'Cuenta Operativa Central', 'DISTRIBUIDORA.CENTRAL', '2850590940090418135201', 'Banco Macro', '30712345678', 'ARS', true),
        (2, 1, 'Billetera QR Operativa', 'BILLETERA.QR.CENTRAL', '0000003100090418135202', 'Mercado Pago', '30712345678', 'ARS', true),
        (3, 1, 'Cuenta Inactiva', 'CUENTA.BAJA', '0110599520000001234569', 'Banco Nación', '30712345678', 'ARS', false);

      -- Movimiento existente en cuenta 1 para prueba de duplicados
      INSERT INTO movimiento_bancario (cuenta_id, fecha_hora, ordenante, concepto, referencia_externa, importe_centavos, origen, estado)
      VALUES (1, now(), 'Mayorista El Sol S.R.L.', 'Transferencia previa', 'OP-EXISTENTE-001', 5000000, 'Extracto Bancario', 'sin_imputar');

      -- Movimiento QR ya registrado previamente por webhook/pasarela en cuenta 1
      INSERT INTO movimiento_bancario (cuenta_id, fecha_hora, ordenante, concepto, referencia_externa, importe_centavos, origen, estado)
      VALUES (1, now(), 'Autoservicio Luna', 'Webhook pasarela QR', 'QR-WEBHOOK-999', 3000000, 'Extracto Bancario', 'sin_imputar');
    `);

    const adapter = memDb.adapters.createPg();
    pool = new adapter.Pool();
    db.setPool(pool as any);
  });

  afterEach(async () => {
    if (pool) await pool.end();
  });

  // =========================================================================
  // HISTORIA 1: Carga manual de un movimiento de transferencia bancaria
  // =========================================================================
  describe('HU: Cargar manualmente un movimiento de transferencia bancaria', () => {
    it('ESCENARIO 1: Carga manual exitosa con comprobante: persiste bajo la marca "Carga Manual", guarda el comprobante y lo envía a la bandeja de pendientes de conciliación', async () => {
      const loginRes = await login('admin@tutucas.local');
      const token = loginRes.body.session.token;
      const hoy = obtenerFechaRelativaDias(0);

      const res = await dispatchConciliacion('POST', '/movimientos/manual/transferencia', token, {
        body: {
          cuentaId: '1',
          fechaContable: hoy,
          importe: '85.000,00',
          numeroOperacion: 'OP-MANUAL-1001',
          ordenante: 'Mayorista El Sol S.R.L.',
          ordenanteCuit: '30111222334',
          concepto: 'Transferencia acreditada fuera de extracto',
        },
        file: validPdfComprobante,
      });

      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.success, true);
      assert.equal(res.body.origen, 'Carga Manual');
      assert.equal(res.body.estado, 'sin_imputar');
      assert.equal(res.body.referencia_externa, 'OP-MANUAL-1001');
      assert.equal(res.body.importe_centavos, '8500000');
      assert.equal(res.body.comprobante_nombre, 'comprobante_transferencia.pdf');

      // Verificar que aparece en la bandeja de pendientes de conciliación con su etiqueta "Carga Manual"
      const pendientes = await conciliacionService.getMovimientosPendientes(hoy);
      const encontrado = pendientes.find((m: any) => m.id === res.body.id);
      assert.ok(encontrado, 'El movimiento manual debe figurar en la bandeja de pendientes de conciliación');
      assert.equal(encontrado.origen, 'Carga Manual');
      assert.equal(encontrado.comprobante_nombre, 'comprobante_transferencia.pdf');

      // Verificar que el comprobante adjunto se puede descargar y que quedó auditado bajo "Carga Manual"
      const compRes = await dispatchConciliacion('GET', '/movimientos/:id/comprobante', token, {
        params: { id: res.body.id },
      });
      assert.equal(compRes.statusCode, 200);
      assert.equal(compRes.attachmentName, 'comprobante_transferencia.pdf');

      const audRes = await db.query(
        `SELECT accion, valores_despues, observacion FROM auditoria WHERE entidad = 'movimiento_bancario' AND entidad_id = $1`,
        [res.body.id]
      );
      assert.equal(audRes.rowCount, 1);
      assert.equal(audRes.rows[0].valores_despues.origen, 'Carga Manual');
    });

    it('ESCENARIO 2: Fallo por fecha contable futura: bloquea el guardado, señala el campo fechaContable y notifica que no se admiten movimientos bancarios anticipados', async () => {
      const loginRes = await login('admin@tutucas.local');
      const token = loginRes.body.session.token;
      const manana = obtenerFechaRelativaDias(2);

      const res = await dispatchConciliacion('POST', '/movimientos/manual/transferencia', token, {
        body: {
          cuentaId: '1',
          fechaContable: manana,
          importe: '45000.00',
          numeroOperacion: 'OP-FUTURA-001',
          ordenante: 'Mayorista El Sol S.R.L.',
        },
        file: validPdfComprobante,
      });

      assert.equal(res.statusCode, 422);
      assert.equal(res.body.error, 'FECHA_CONTABLE_FUTURA');
      assert.match(res.body.message, /no se admiten movimientos bancarios anticipados/i);
      assert.ok(Array.isArray(res.body.camposInvalidos) && res.body.camposInvalidos.includes('fechaContable'));

      const checkBd = await db.query(
        `SELECT COUNT(*)::int AS total FROM movimiento_bancario WHERE referencia_externa = 'OP-FUTURA-001'`
      );
      assert.equal(checkBd.rows[0].total, 0);
    });

    it('ESCENARIO 3: Fallo por comprobante u operación bancaria duplicada en la misma cuenta de recepción: impide la persistencia y alerta sobre la coincidencia', async () => {
      const loginRes = await login('admin@tutucas.local');
      const token = loginRes.body.session.token;
      const hoy = obtenerFechaRelativaDias(0);

      const res = await dispatchConciliacion('POST', '/movimientos/manual/transferencia', token, {
        body: {
          cuentaId: '1',
          fechaContable: hoy,
          importe: '50000.00',
          numeroOperacion: 'op-existente-001', // Ya existe en cuenta 1 (insensible a mayúsculas/minúsculas)
          ordenante: 'Mayorista El Sol S.R.L.',
        },
        file: validPdfComprobante,
      });

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.error, 'OPERACION_BANCARIA_DUPLICADA');
      assert.match(res.body.message, /ya se encuentra registrado en la cuenta/i);
      assert.ok(Array.isArray(res.body.camposInvalidos) && res.body.camposInvalidos.includes('numeroOperacion'));
    });

    it('Regla adicional: Exige comprobante de respaldo obligatorio y cuenta de recepción activa', async () => {
      const loginRes = await login('admin@tutucas.local');
      const token = loginRes.body.session.token;
      const hoy = obtenerFechaRelativaDias(0);

      // Sin comprobante adjunto
      const resSinArchivo = await dispatchConciliacion('POST', '/movimientos/manual/transferencia', token, {
        body: {
          cuentaId: '1',
          fechaContable: hoy,
          importe: '25000.00',
          numeroOperacion: 'OP-SIN-COMP',
        },
        file: null,
      });
      assert.equal(resSinArchivo.statusCode, 400);
      assert.equal(resSinArchivo.body.error, 'COMPROBANTE_OBLIGATORIO');
      assert.ok(resSinArchivo.body.camposInvalidos.includes('comprobante'));

      // Cuenta inactiva (Cuenta 3)
      const resCuentaInactiva = await dispatchConciliacion('POST', '/movimientos/manual/transferencia', token, {
        body: {
          cuentaId: '3',
          fechaContable: hoy,
          importe: '25000.00',
          numeroOperacion: 'OP-CTA-INACTIVA',
        },
        file: validPdfComprobante,
      });
      assert.equal(resCuentaInactiva.statusCode, 422);
      assert.equal(resCuentaInactiva.body.error, 'CUENTA_INACTIVA');
    });
  });

  // =========================================================================
  // HISTORIA 2: Carga manual de un ingreso por cobro QR
  // =========================================================================
  describe('HU: Cargar manualmente un ingreso por cobro QR', () => {
    it('ESCENARIO 1: Registro manual de ingreso QR exitoso: persiste bajo "QR - Carga Manual" y lo habilita en la bandeja de conciliación con las mismas reglas de matching que una transferencia', async () => {
      const loginRes = await login('admin@tutucas.local');
      const token = loginRes.body.session.token;
      const hoy = obtenerFechaRelativaDias(0);

      const res = await dispatchConciliacion('POST', '/movimientos/manual/qr', token, {
        body: {
          cuentaId: '2',
          fechaContable: hoy,
          importe: '42000,00',
          idTransaccion: 'MP-QR-2026-778899',
          ordenante: 'Autoservicio Luna',
          ordenanteCuit: '30222333445',
          concepto: 'Cobro QR billetera virtual',
        },
      });

      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.success, true);
      assert.equal(res.body.origen, 'QR - Carga Manual');
      assert.equal(res.body.estado, 'sin_imputar');
      assert.equal(res.body.referencia_externa, 'MP-QR-2026-778899');
      assert.equal(res.body.importe_centavos, '4200000');

      // Verificar presencia en bandeja de pendientes de conciliación con etiqueta "QR - Carga Manual" y datos para matching (ordenante, CUIT, importe)
      const pendientes = await conciliacionService.getMovimientosPendientes(hoy);
      const qrMov = pendientes.find((m: any) => m.id === res.body.id);
      assert.ok(qrMov, 'El ingreso QR manual debe figurar en la bandeja de pendientes');
      assert.equal(qrMov.origen, 'QR - Carga Manual');
      assert.equal(qrMov.ordenante, 'Autoservicio Luna');
      assert.equal(String(qrMov.ordenante_cuit).trim(), '30222333445');
      assert.equal(qrMov.referencia_externa, 'MP-QR-2026-778899');

      const audQr = await db.query(
        `SELECT accion, valores_despues FROM auditoria WHERE entidad = 'movimiento_bancario' AND entidad_id = $1`,
        [res.body.id]
      );
      assert.equal(audQr.rowCount, 1);
      assert.equal(audQr.rows[0].valores_despues.origen, 'QR - Carga Manual');
    });

    it('ESCENARIO 2: Fallo por ID de transacción QR duplicado: bloquea el alta si ya existe en el sistema (cargado manualmente o recibido por webhook) aunque sea en otra cuenta', async () => {
      const loginRes = await login('admin@tutucas.local');
      const token = loginRes.body.session.token;
      const hoy = obtenerFechaRelativaDias(0);

      // Intentar registrar en Cuenta 2 un ID de transacción QR que ya ingresó previamente en Cuenta 1 ('QR-WEBHOOK-999')
      const res = await dispatchConciliacion('POST', '/movimientos/manual/qr', token, {
        body: {
          cuentaId: '2',
          fechaContable: hoy,
          importe: '30000.00',
          idTransaccion: 'qr-webhook-999',
          ordenante: 'Autoservicio Luna',
        },
      });

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.error, 'TRANSACCION_QR_DUPLICADA');
      assert.match(res.body.message, /ya fue registrado previamente en el sistema/i);
      assert.ok(Array.isArray(res.body.camposInvalidos) && res.body.camposInvalidos.includes('idTransaccion'));
    });

    it('ESCENARIO 3: Fallo por inconsistencia en fecha o importe: detiene la operación, señala los campos no válidos e impide el ingreso del comprobante a tesorería', async () => {
      const loginRes = await login('admin@tutucas.local');
      const token = loginRes.body.session.token;
      const hoy = obtenerFechaRelativaDias(0);
      const fechaFutura = obtenerFechaRelativaDias(3);

      // Caso A: Fecha futura e importe cero/negativo simultáneamente
      const resAmbos = await dispatchConciliacion('POST', '/movimientos/manual/qr', token, {
        body: {
          cuentaId: '2',
          fechaContable: fechaFutura,
          importe: '0',
          idTransaccion: 'MP-QR-INVALIDO-1',
          ordenante: 'Autoservicio Luna',
        },
      });

      assert.equal(resAmbos.statusCode, 422);
      assert.ok(resAmbos.body.camposInvalidos.includes('fechaContable'));
      assert.ok(resAmbos.body.camposInvalidos.includes('importe'));

      // Caso B: Importe negativo con fecha válida
      const resImporteNegativo = await dispatchConciliacion('POST', '/movimientos/manual/qr', token, {
        body: {
          cuentaId: '2',
          fechaContable: hoy,
          importe: '-1500.00',
          idTransaccion: 'MP-QR-INVALIDO-2',
          ordenante: 'Autoservicio Luna',
        },
      });

      assert.equal(resImporteNegativo.statusCode, 422);
      assert.deepEqual(resImporteNegativo.body.camposInvalidos, ['importe']);

      // Caso C: Fecha futura con importe positivo
      const resFechaFutura = await dispatchConciliacion('POST', '/movimientos/manual/qr', token, {
        body: {
          cuentaId: '2',
          fechaContable: fechaFutura,
          importe: '15000.00',
          idTransaccion: 'MP-QR-INVALIDO-3',
          ordenante: 'Autoservicio Luna',
        },
      });

      assert.equal(resFechaFutura.statusCode, 422);
      assert.equal(resFechaFutura.body.error, 'FECHA_CONTABLE_FUTURA');
      assert.deepEqual(resFechaFutura.body.camposInvalidos, ['fechaContable']);

      // Verificar que ninguno de los 3 casos inválidos ingresó a tesorería
      const countQrInvalidos = await db.query(
        `SELECT COUNT(*)::int AS total FROM movimiento_bancario WHERE referencia_externa LIKE 'MP-QR-INVALIDO-%'`
      );
      assert.equal(countQrInvalidos.rows[0].total, 0);
    });
  });
});
