// backend/src/__tests__/recuperacionContrasena.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { newDb } from 'pg-mem';
import bcryptjs from 'bcryptjs';
import { db } from '../db.js';
import { authService } from '../services/authService.js';

describe('Backend PostgreSQL - HU: Recuperación de Contraseña', () => {
  beforeEach(() => {
    authService.resetLockout();

    const mem = newDb();
    mem.public.none(`
      CREATE TABLE IF NOT EXISTS sucursal (
        id serial PRIMARY KEY,
        nombre text NOT NULL UNIQUE,
        domicilio text,
        activa boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS usuario (
        id serial PRIMARY KEY,
        usuario text NOT NULL UNIQUE,
        nombre text NOT NULL,
        email text,
        password_hash text NOT NULL,
        rol text NOT NULL DEFAULT 'Administrativo',
        es_transportista boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        creado_en timestamp DEFAULT now(),
        actualizado_en timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS usuario_sucursal (
        usuario_id bigint NOT NULL,
        sucursal_id bigint NOT NULL,
        PRIMARY KEY (usuario_id, sucursal_id)
      );

      CREATE TABLE IF NOT EXISTS sesion_usuario (
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

      CREATE TABLE IF NOT EXISTS token_recuperacion_contrasena (
        id serial PRIMARY KEY,
        usuario_id bigint NOT NULL,
        token_hash text NOT NULL UNIQUE,
        expira_en timestamp NOT NULL,
        usado boolean NOT NULL DEFAULT false,
        usado_en timestamp,
        creado_en timestamp DEFAULT now()
      );
    `);

    const hash = bcryptjs.hashSync('Password123!', 10);

    mem.public.none(`
      INSERT INTO sucursal (id, nombre, domicilio) VALUES
        (1, 'Sucursal Central - La Plata', 'Calle 12 N° 500, La Plata');

      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, es_transportista, activo) VALUES
        (1, 'admin', 'Martín Coordinador', 'almeida.christian.writing@gmail.com', '${hash}', 'Administrativo', false, true),
        (2, 'inactivo', 'Usuario Inactivo', 'inactivo@tutucas.com.ar', '${hash}', 'Administrativo', false, false);

      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES
        (1, 1),
        (2, 1);
    `);

    const adapter = mem.adapters.createPg();
    db.setPool(new adapter.Pool() as any);
  });

  it('ESCENARIO 1: Solicitud genera token de 20 min y hash sha256 para usuario activo', async () => {
    const res = await authService.requestPasswordReset('almeida.christian.writing@gmail.com');
    assert.equal(res.success, true);
    assert.ok(res.message.includes('correo'));

    const tokens = await db.query('SELECT * FROM token_recuperacion_contrasena WHERE usuario_id = 1');
    assert.equal(tokens.rows.length, 1);
    const tokenRow = tokens.rows[0];
    assert.equal(tokenRow.usado, false);
    assert.equal(tokenRow.token_hash.length, 64); // SHA-256 hex string

    // Verificar expiración aproximada de 20 minutos (1200 segundos)
    const diffMs = new Date(tokenRow.expira_en).getTime() - new Date(tokenRow.creado_en).getTime();
    const diffMinutes = Math.round(diffMs / 60000);
    assert.equal(diffMinutes, 20);
  });

  it('ESCENARIO 1 (Privacidad): Respuesta genérica idéntica para correo inexistente o usuario inactivo', async () => {
    const genericExpected = 'Si el correo electrónico coincide con una cuenta activa, recibirá las instrucciones para restablecer su contraseña en su casilla de correo.';

    // Correo inexistente
    const resNoExiste = await authService.requestPasswordReset('no_existe@tutucas.com.ar');
    assert.equal(resNoExiste.success, true);
    assert.equal(resNoExiste.message, genericExpected);

    // Usuario inactivo
    const resInactivo = await authService.requestPasswordReset('inactivo@tutucas.com.ar');
    assert.equal(resInactivo.success, true);
    assert.equal(resInactivo.message, genericExpected);

    // No debe haberse creado ningún token
    const tokens = await db.query('SELECT * FROM token_recuperacion_contrasena');
    assert.equal(tokens.rows.length, 0);
  });

  it('ESCENARIO 2: Cambio efectivo de contraseña actualiza clave, invalida token y revoca sesiones', async () => {
    // 1. Crear sesión activa previa
    const loginPrevio = await authService.login({
      identifier: 'almeida.christian.writing@gmail.com',
      password: 'Password123!',
    });
    assert.equal(loginPrevio.success, true);
    const oldSessionToken = loginPrevio.session!.token;

    // 2. Generar token de recuperación
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiraEn = new Date(Date.now() + 20 * 60 * 1000);

    await db.query(
      'INSERT INTO token_recuperacion_contrasena (usuario_id, token_hash, expira_en, usado) VALUES (1, $1, $2, false)',
      [tokenHash, expiraEn]
    );

    // Validar token antes de mostrar formulario
    const validacion = await authService.validateResetToken(rawToken);
    assert.equal(validacion.valid, true);

    // 3. Restablecer con nueva clave robusta (>= 12 caracteres, números y caracteres especiales)
    const nuevaClave = 'SuperSegura2026!';
    const resetRes = await authService.resetPasswordWithToken(rawToken, nuevaClave);
    assert.equal(resetRes.success, true);

    // 4. Verificar que el token quedó marcado como usado
    const tokenDb = await db.query('SELECT * FROM token_recuperacion_contrasena WHERE token_hash = $1', [tokenHash]);
    assert.equal(tokenDb.rows[0].usado, true);
    assert.ok(tokenDb.rows[0].usado_en);

    // 5. Verificar que la sesión previa fue revocada
    const sesionVerif = await authService.verifySession(oldSessionToken);
    assert.equal(sesionVerif.valid, false);
    assert.equal(sesionVerif.error?.type, 'SESSION_REVOKED');

    // 6. Verificar que la clave anterior ya no funciona
    const loginViejo = await authService.login({
      identifier: 'almeida.christian.writing@gmail.com',
      password: 'Password123!',
    });
    assert.equal(loginViejo.success, false);

    // 7. Verificar que el login con la nueva clave funciona exitosamente
    const loginNuevo = await authService.login({
      identifier: 'almeida.christian.writing@gmail.com',
      password: nuevaClave,
    });
    assert.equal(loginNuevo.success, true);
  });

  it('ESCENARIO 3: Rechaza token expirado (> 20 minutos)', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    // Expirado hace 5 minutos
    const expiraEn = new Date(Date.now() - 5 * 60 * 1000);

    await db.query(
      'INSERT INTO token_recuperacion_contrasena (usuario_id, token_hash, expira_en, usado) VALUES (1, $1, $2, false)',
      [tokenHash, expiraEn]
    );

    // Validación previa
    const validacion = await authService.validateResetToken(rawToken);
    assert.equal(validacion.valid, false);
    assert.equal(validacion.error, 'TOKEN_EXPIRADO');
    assert.ok(validacion.message.includes('caducado'));

    // Intento de restablecimiento
    const resetRes = await authService.resetPasswordWithToken(rawToken, 'NuevaClaveValida2026!');
    assert.equal(resetRes.success, false);
    assert.equal(resetRes.error, 'TOKEN_EXPIRADO');
    assert.ok(resetRes.message.includes('caducado'));

    // Clave original no cambia
    const login = await authService.login({
      identifier: 'almeida.christian.writing@gmail.com',
      password: 'Password123!',
    });
    assert.equal(login.success, true);
  });

  it('ESCENARIO 3b: Rechaza token que ya fue utilizado', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiraEn = new Date(Date.now() + 20 * 60 * 1000);

    await db.query(
      'INSERT INTO token_recuperacion_contrasena (usuario_id, token_hash, expira_en, usado, usado_en) VALUES (1, $1, $2, true, now())',
      [tokenHash, expiraEn]
    );

    // Validación previa
    const validacion = await authService.validateResetToken(rawToken);
    assert.equal(validacion.valid, false);
    assert.equal(validacion.error, 'TOKEN_YA_UTILIZADO');
    assert.ok(validacion.message.includes('utilizado'));

    // Intento de restablecimiento
    const resetRes = await authService.resetPasswordWithToken(rawToken, 'NuevaClaveValida2026!');
    assert.equal(resetRes.success, false);
    assert.equal(resetRes.error, 'TOKEN_YA_UTILIZADO');
  });

  it('POLÍTICA DE CONTRASEÑA: Exige longitud mínima de 12 caracteres, números y caracteres especiales', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiraEn = new Date(Date.now() + 20 * 60 * 1000);

    await db.query(
      'INSERT INTO token_recuperacion_contrasena (usuario_id, token_hash, expira_en, usado) VALUES (1, $1, $2, false)',
      [tokenHash, expiraEn]
    );

    // Menos de 12 caracteres
    const resCorta = await authService.resetPasswordWithToken(rawToken, 'Corta1!');
    assert.equal(resCorta.success, false);
    assert.equal(resCorta.error, 'POLITICA_NO_CUMPLIDA');
    assert.ok(resCorta.message.includes('12 caracteres'));

    // Sin números
    const resSinNum = await authService.resetPasswordWithToken(rawToken, 'ContrasenaLargaSinNumero!');
    assert.equal(resSinNum.success, false);
    assert.equal(resSinNum.error, 'POLITICA_NO_CUMPLIDA');
    assert.ok(resSinNum.message.includes('número'));

    // Sin caracteres especiales
    const resSinEspecial = await authService.resetPasswordWithToken(rawToken, 'ContrasenaLargaCon123456');
    assert.equal(resSinEspecial.success, false);
    assert.equal(resSinEspecial.error, 'POLITICA_NO_CUMPLIDA');
    assert.ok(resSinEspecial.message.includes('carácter especial'));
  });

  it('CONCURRENCIA: Solicitudes concurrentes con el mismo token no permiten doble uso', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiraEn = new Date(Date.now() + 20 * 60 * 1000);

    await db.query(
      'INSERT INTO token_recuperacion_contrasena (usuario_id, token_hash, expira_en, usado) VALUES (1, $1, $2, false)',
      [tokenHash, expiraEn]
    );

    // Disparar dos solicitudes concurrentes con el mismo token
    const [res1, res2] = await Promise.all([
      authService.resetPasswordWithToken(rawToken, 'ClaveConcurrente1!'),
      authService.resetPasswordWithToken(rawToken, 'ClaveConcurrente2!'),
    ]);

    // Exactamente una debe haber tenido éxito y la otra debe haber sido rechazada por token ya utilizado
    const exitos = [res1, res2].filter((r) => r.success);
    const fallos = [res1, res2].filter((r) => !r.success);

    assert.equal(exitos.length, 1);
    assert.equal(fallos.length, 1);
    assert.equal(fallos[0].error, 'TOKEN_YA_UTILIZADO');
  });
});
