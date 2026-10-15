// backend/src/__tests__/authApi.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import bcryptjs from 'bcryptjs';
import { db } from '../db.js';
import { authService } from '../services/authService.js';

describe('Backend PostgreSQL - HU: Autenticación, Roles y Cierre de Sesión (Logout & Inactividad)', () => {
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
    `);

    const hash = bcryptjs.hashSync('Password123!', 10);

    mem.public.none(`
      INSERT INTO sucursal (id, nombre, domicilio) VALUES
        (1, 'Sucursal Central - La Plata', 'Calle 12 N° 500, La Plata'),
        (2, 'Depósito Sur - Berisso', 'Av. Río de la Plata 1240, Berisso');

      INSERT INTO usuario (id, usuario, nombre, email, password_hash, rol, es_transportista, activo) VALUES
        (1, 'admin', 'Martín Jirafales Coordinador', 'admin@tutucas.com.ar', '${hash}', 'Administrativo', false, true),
        (2, 'chofer', 'Carlos Repartidor', 'chofer@tutucas.com.ar', '${hash}', 'Transportista', true, true);

      INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES
        (1, 1),
        (2, 2);
    `);

    const adapter = mem.adapters.createPg();
    db.setPool(new adapter.Pool() as any);
  });

  it('ESCENARIO 1 (Login Éxito): Autentica contra PostgreSQL y devuelve token, sucursal y rol', async () => {
    const res = await authService.login({
      identifier: 'admin@tutucas.com.ar',
      password: 'Password123!',
    });

    assert.equal(res.success, true);
    assert.ok(res.session);
    assert.equal(res.session.email, 'admin@tutucas.com.ar');
    assert.equal(res.session.role, 'Administrativo');
    assert.equal(res.session.branch, 'Sucursal Central - La Plata');
    assert.ok(res.session.token.startsWith('tutucas_tok_'));
    assert.equal(res.redirectUrl, '/dashboard');
  });

  it('ESCENARIO 2 (Fallo seguro): Credenciales erróneas devuelven texto exacto y auditan intentos', async () => {
    const res = await authService.login({
      identifier: 'admin@tutucas.com.ar',
      password: 'clave_incorrecta',
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.type, 'INVALID_CREDENTIALS');
    assert.equal(res.error?.message, 'Credenciales incorrectas');
    assert.equal(res.error?.remainingAttempts, 4);
  });

  it('ESCENARIO 3 (Bloqueo preventivo): Al 5to intento fallido bloquea temporalmente', async () => {
    for (let i = 0; i < 4; i++) {
      await authService.login({ identifier: 'admin@tutucas.com.ar', password: 'err' });
    }

    const res5 = await authService.login({ identifier: 'admin@tutucas.com.ar', password: 'err' });
    assert.equal(res5.success, false);
    assert.equal(res5.error?.type, 'ACCOUNT_LOCKED');
    assert.equal(res5.error?.remainingAttempts, 0);

    // Intentos posteriores quedan bloqueados
    const res6 = await authService.login({ identifier: 'admin@tutucas.com.ar', password: 'Password123!' });
    assert.equal(res6.success, false);
    assert.equal(res6.error?.type, 'ACCOUNT_LOCKED');
  });

  it('HU LOGOUT - ESCENARIO 1: Cierre de sesión voluntario revoca token en backend inmediatamente', async () => {
    // 1. Iniciar sesión
    const loginRes = await authService.login({
      identifier: 'admin@tutucas.com.ar',
      password: 'Password123!',
    });
    const token = loginRes.session!.token;

    // Verificar que la sesión está activa
    const verifyBefore = await authService.verifySession(token);
    assert.equal(verifyBefore.valid, true);

    // 2. Ejecutar logout
    const logoutRes = await authService.logout(token, 'manual');
    assert.equal(logoutRes.success, true);

    // 3. Verificar que el token ahora está revocado en la base de datos
    const verifyAfter = await authService.verifySession(token);
    assert.equal(verifyAfter.valid, false);
    assert.equal(verifyAfter.error?.type, 'SESSION_REVOKED');
  });

  it('HU LOGOUT - ESCENARIO 2: Inactividad expira la sesión automáticamente tras ventana límite', async () => {
    // Iniciar sesión
    const loginRes = await authService.login({
      identifier: 'admin@tutucas.com.ar',
      password: 'Password123!',
    });
    const token = loginRes.session!.token;

    // Simular que la sesión fue creada hace más de 30 minutos (forzar expiración en base de datos)
    await db.query(
      `UPDATE sesion_usuario
       SET expira_en = now() - interval '5 minutes'
       WHERE token = $1`,
      [token]
    );

    // Verificar sesión: debe detectar expiración automática
    const verify = await authService.verifySession(token);
    assert.equal(verify.valid, false);
    assert.equal(verify.error?.type, 'SESSION_EXPIRED');
  });
});
