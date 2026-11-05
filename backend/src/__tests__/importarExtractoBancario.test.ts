import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authRouter } from '../routes/authRoutes.js';
import { conciliacionRouter } from '../routes/conciliacionRoutes.js';
import { ConciliacionError, conciliacionService } from '../services/conciliacionService.js';

const password = 'Password123!';
let pool: any;

function responseMock() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
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

async function dispatchImport(body: any, file: any, token: string) {
  const req: any = {
    method: 'POST',
    url: '/extractos/importar',
    body,
    file,
    params: {},
    query: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'test', authorization: `Bearer ${token}` },
  };
  const res = responseMock();

  for (const layer of conciliacionRouter.stack.filter((item: any) => !item.route)) {
    for (const handle of layer. stack ? layer.stack.map((s: any) => s.handle) : [layer.handle]) {
      let continued = false;
      await handle(req, res, (err?: unknown) => {
        if (err) throw err;
        continued = true;
      });
      if (!continued) return res;
    }
  }

  const routeLayer = conciliacionRouter.stack.find(
    (item: any) => item.route?.path === '/extractos/importar' && item.route.methods.post
  );
  assert.ok(routeLayer, 'No existe POST /extractos/importar');

  // Ejecutar requireAdministrativo y el handler final (omitiendo el middleware de multer porque inyectamos req.file en el test)
  const stack = routeLayer.route.stack;
  let passedRole = false;
  await stack[0].handle(req, res, () => { passedRole = true; });
  if (!passedRole) return res;

  await stack[stack.length - 1].handle(req, res, () => undefined);
  return res;
}

describe('HU: Importar un extracto bancario en archivo digital para cargar masivamente movimientos de ingresos sin duplicar registros', () => {
  beforeEach(async () => {
    const memDb = newDb();
    memDb.public.registerFunction({
      name: 'now',
      implementation: () => new Date('2026-11-05T12:00:00Z'),
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
        estado text NOT NULL DEFAULT 'sin_imputar',
        creado_en timestamp DEFAULT now(),
        UNIQUE (cuenta_id, referencia_externa)
      );

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
        (1, 'Sucursal Central - La Plata', 'Calle 12 N° 500', true),
        (2, 'Sucursal Sur - Inactiva', 'Av. Sur 100', false);

      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, activo) VALUES
        (1, 'admin', 'Martín Administrativo', 'admin@tutucas.local', '${hash}', 'Administrativo', true);

      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES (1, 1);

      INSERT INTO cuenta_recepcion (id, sucursal_id, nombre_fantasia, alias, cbu, banco, cuit_titular, moneda, activa) VALUES
        (1, 1, 'Cuenta Operativa Central', 'DISTRIBUIDORA.CENTRAL', '2850590940090418135201', 'Banco Macro', '30712345678', 'ARS', true),
        (2, 1, 'Cuenta Dólares Central', 'DISTRIBUIDORA.USD', '0720000732000000000010', 'Banco Galicia', '30712345678', 'USD', true),
        (3, 1, 'Cuenta Inactiva', 'DISTRIBUIDORA.BAJA', '0110599520000001234569', 'Banco Nación', '30712345678', 'ARS', false);

      -- Movimiento previamente importado en Cuenta 1
      INSERT INTO movimiento_bancario (cuenta_id, fecha_hora, ordenante, concepto, referencia_externa, importe_centavos, estado)
      VALUES (1, '2026-11-04T12:00:00Z', 'Mayorista El Sol S.R.L.', 'Transferencia acreditada', 'TRX-0001', 15000000, 'sin_imputar');
    `);

    const adapter = memDb.adapters.createPg();
    pool = new adapter.Pool();
    db.setPool(pool as any);
  });

  afterEach(async () => {
    if (pool) await pool.end();
  });

  it('ESCENARIO 1: Importación exitosa con omisión de duplicados: persiste solo transacciones inéditas, omite duplicadas y devuelve el resumen consolidado', async () => {
    const loginRes = await login('admin@tutucas.local');
    assert.equal(loginRes.statusCode, 200);
    const token = loginRes.body.session.token;

    // El archivo contiene:
    // - TRX-0001 (ya existente en la BD -> debe omitirse)
    // - TRX-0002 (nuevo -> debe insertarse)
    // - TRX-0003 (nuevo -> debe insertarse)
    // - TRX-0002 repetido dentro del mismo archivo -> también debe omitirse
    const csvContent = [
      '# CBU: 2850590940090418135201',
      '# MONEDA: ARS',
      'fecha;concepto;importe;referencia;ordenante;cuit',
      '2026-11-04;Transferencia acreditada;150000.00;TRX-0001;Mayorista El Sol S.R.L.;30111222334',
      '2026-11-05;Cobro transferencia comercios;62000,50;TRX-0002;Autoservicio Luna;30222333445',
      '05/11/2026;Pago factura remito;94000.00;TRX-0003;Distribuidora Los Andes;30333444556',
      '2026-11-05;Cobro transferencia comercios;62000,50;TRX-0002;Autoservicio Luna;30222333445',
    ].join('\n');

    const archivo = {
      originalname: 'extracto_macro_noviembre.csv',
      mimetype: 'text/csv',
      size: Buffer.byteLength(csvContent),
      buffer: Buffer.from(csvContent, 'utf-8'),
    };

    const res = await dispatchImport({ cuentaId: '1' }, archivo, token);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.totalProcesados, 4);
    assert.equal(res.body.insertados, 2);
    assert.equal(res.body.omitidosDuplicados, 2);
    assert.match(res.body.mensaje, /2 movimiento\(s\) nuevo\(s\) insertado\(s\) y 2 registro\(s\) duplicado\(s\) omitido\(s\)/i);

    // Verificar en BD que ahora hay exactamente 3 movimientos en total (1 previo + 2 nuevos)
    const movsBd = await db.query('SELECT referencia_externa, importe_centavos::text AS importe, ordenante FROM movimiento_bancario WHERE cuenta_id = 1 ORDER BY id');
    assert.equal(movsBd.rowCount, 3);
    assert.deepEqual(
      movsBd.rows.map((r: any) => ({ ref: r.referencia_externa, imp: r.importe })),
      [
        { ref: 'TRX-0001', imp: '15000000' },
        { ref: 'TRX-0002', imp: '6200050' },
        { ref: 'TRX-0003', imp: '9400000' },
      ]
    );

    // Si volvemos a importar el mismo archivo (idempotencia completa), insertados = 0 y omitidos = 4
    const resIdempotente = await dispatchImport({ cuentaId: '1' }, archivo, token);
    assert.equal(resIdempotente.statusCode, 200);
    assert.equal(resIdempotente.body.insertados, 0);
    assert.equal(resIdempotente.body.omitidosDuplicados, 4);
  });

  it('ESCENARIO 1 (XLS estándar): Soporta archivos con extensión .xls y formato tabular bancario estándar', async () => {
    const xlsContent = `
      <table>
        <tr><th>Fecha</th><th>Concepto</th><th>Importe</th><th>Referencia</th><th>Ordenante</th></tr>
        <tr><td>2026-11-05</td><td>Transferencia MEP</td><td>$ 125.000,00</td><td>XLS-9001</td><td>Mayorista El Sol S.R.L.</td></tr>
      </table>
    `;
    const result = await conciliacionService.importarExtractoBancario(
      1,
      {
        originalname: 'extracto_banco.xls',
        mimetype: 'application/vnd.ms-excel',
        size: Buffer.byteLength(xlsContent),
        buffer: Buffer.from(xlsContent, 'utf-8'),
      },
      1
    );
    assert.equal(result.insertados, 1);
    assert.equal(result.omitidosDuplicados, 0);
  });

  it('ESCENARIO 2: Fallo por estructura o formato de archivo inválido: aborta la lectura antes de persistir datos y revierte cualquier cambio', async () => {
    const loginRes = await login('admin@tutucas.local');
    const token = loginRes.body.session.token;

    // Caso A: Extensión no admitida (.txt / .pdf)
    const archivoExtensionInvalida = {
      originalname: 'extracto.pdf',
      mimetype: 'application/pdf',
      size: 32,
      buffer: Buffer.from('%PDF-1.7 contenido no valido', 'utf-8'),
    };
    const resExt = await dispatchImport({ cuentaId: '1' }, archivoExtensionInvalida, token);
    assert.equal(resExt.statusCode, 400);
    assert.equal(resExt.body.error, 'FORMATO_ARCHIVO_INVALIDO');
    assert.match(resExt.body.message, /\.CSV o \.XLS/i);

    // Caso B: Faltan columnas mínimas obligatorias (fecha, concepto, importe, referencia)
    const csvSinColumnas = [
      'fecha;detalle_libre;monto', // falta 'referencia'
      '2026-11-05;Transferencia;50000.00',
    ].join('\n');
    const resCols = await dispatchImport(
      { cuentaId: '1' },
      {
        originalname: 'extracto_incompleto.csv',
        size: Buffer.byteLength(csvSinSinColumnas(csvSinColumnas)),
        buffer: Buffer.from(csvSinColumnas, 'utf-8'),
      },
      token
    );
    assert.equal(resCols.statusCode, 400);
    assert.equal(resCols.body.error, 'ESTRUCTURA_ARCHIVO_INVALIDA');
    assert.match(resCols.body.message, /referencia/i);

    // Caso C: Fila 1 válida pero Fila 2 con datos corruptos (importe inválido / fecha inválida) -> NO debe persistirse ni la fila 1
    const csvCorruptoEnMitad = [
      'fecha;concepto;importe;referencia',
      '2026-11-05;Transferencia valida;80000.00;TRX-VALIDA-NO-GUARDAR',
      '2026-99-99;Transferencia con fecha corrupta;ABC_CORRUPTO;TRX-CORRUPTA',
    ].join('\n');
    const resCorrupto = await dispatchImport(
      { cuentaId: '1' },
      {
        originalname: 'extracto_corrupto.csv',
        size: Buffer.byteLength(csvCorruptoEnMitad),
        buffer: Buffer.from(csvCorruptoEnMitad, 'utf-8'),
      },
      token
    );
    assert.equal(resCorrupto.statusCode, 400);
    assert.equal(resCorrupto.body.error, 'DATOS_CORRUPTOS');

    // Verificar que no se insertó ningún movimiento nuevo (sigue habiendo solo 1 en BD)
    const countBd = await db.query('SELECT COUNT(*)::int AS total FROM movimiento_bancario WHERE cuenta_id = 1');
    assert.equal(countBd.rows[0].total, 1);
  });

  it('ESCENARIO 3: Fallo por cuenta bancaria no identificada o inconsistente (CBU, número de cuenta o moneda no coinciden)', async () => {
    const loginRes = await login('admin@tutucas.local');
    const token = loginRes.body.session.token;

    // Caso A: Extracto informa un CBU que no coincide con la cuenta seleccionada (Cuenta 1 tiene CBU 2850590940090418135201)
    const csvCbuDistinto = [
      '# CBU: 0720000732000000000010',
      'fecha;concepto;importe;referencia',
      '2026-11-05;Transferencia recibida;45000.00;TRX-CBU-ERR',
    ].join('\n');

    const resCbu = await dispatchImport(
      { cuentaId: '1' },
      {
        originalname: 'extracto_otro_cbu.csv',
        size: Buffer.byteLength(csvCbuDistinto),
        buffer: Buffer.from(csvCbuDistinto, 'utf-8'),
      },
      token
    );
    assert.equal(resCbu.statusCode, 422);
    assert.equal(resCbu.body.error, 'CUENTA_INCONSISTENTE');
    assert.match(resCbu.body.message, /CBU informado en el extracto.*no coincide/i);

    // Caso B: Extracto en moneda USD intentando cargarse en una cuenta en ARS (Cuenta 1 es ARS)
    const csvMonedaDistinta = [
      'fecha;concepto;importe;referencia;moneda',
      '2026-11-05;Transferencia USD;1200.00;TRX-USD-01;USD',
    ].join('\n');

    const resMoneda = await dispatchImport(
      { cuentaId: '1' },
      {
        originalname: 'extracto_usd.csv',
        size: Buffer.byteLength(csvMonedaDistinta),
        buffer: Buffer.from(csvMonedaDistinta, 'utf-8'),
      },
      token
    );
    assert.equal(resMoneda.statusCode, 422);
    assert.equal(resMoneda.body.error, 'CUENTA_INCONSISTENTE');
    assert.match(resMoneda.body.message, /moneda/i);

    // Caso C: Número de cuenta en el extracto no coincide con la cuenta seleccionada
    const csvNroCuentaDistinto = [
      '# CUENTA: 9999999999',
      'fecha;concepto;importe;referencia',
      '2026-11-05;Transferencia recibida;45000.00;TRX-CTA-ERR',
    ].join('\n');

    const resNroCuenta = await dispatchImport(
      { cuentaId: '1' },
      {
        originalname: 'extracto_otra_cuenta.csv',
        size: Buffer.byteLength(csvNroCuentaDistinto),
        buffer: Buffer.from(csvNroCuentaDistinto, 'utf-8'),
      },
      token
    );
    assert.equal(resNroCuenta.statusCode, 422);
    assert.equal(resNroCuenta.body.error, 'CUENTA_INCONSISTENTE');
    assert.match(resNroCuenta.body.message, /número de cuenta/i);

    // Caso D: Cuenta destino inexistente en el sistema
    await assert.rejects(
      () =>
        conciliacionService.importarExtractoBancario(
          999,
          {
            originalname: 'extracto.csv',
            size: 60,
            buffer: Buffer.from('fecha;concepto;importe;referencia\n2026-11-05;Pago;1000;TRX-1', 'utf-8'),
          },
          1
        ),
      (err: any) => err instanceof ConciliacionError && err.status === 422 && err.details.errorCode === 'CUENTA_NO_IDENTIFICADA'
    );

    // Verificar que ningún movimiento de los casos fallidos fue persistido
    const countBd = await db.query('SELECT COUNT(*)::int AS total FROM movimiento_bancario WHERE cuenta_id = 1');
    assert.equal(countBd.rows[0].total, 1);
  });
});

function csvSinSinColumnas(s: string) {
  return s;
}
