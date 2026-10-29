// backend/src/__tests__/rechazoRemito.test.ts
// HU #24 · Registrar rechazo de entrega (endpoint que la app ya usaba y no existía).
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { newDb } from 'pg-mem';
import { db } from '../db.js';
import { authService } from '../services/authService.js';
import { RechazoError, rechazoService } from '../services/rechazoService.js';
import { transportistaRouter } from '../routes/transportistaRoutes.js';

const CHOFER = 2;
const cuerpo = (motivo = 'Comercio cerrado') => ({ motivo, timestamp: '2026-10-24T09:00:00.000-03:00', latitud: -34.92, longitud: -57.95 });

async function rechaza(promesa: Promise<unknown>, status: number, mensaje: RegExp) {
  await assert.rejects(promesa, (error: unknown) => {
    assert.ok(error instanceof RechazoError);
    assert.equal(error.status, status);
    assert.match(error.message, mensaje);
    return true;
  });
}

async function fila(sql: string) {
  return (await db.query(sql)).rows[0];
}

async function postRechazo(remitoId: string, token: string | null, body: any) {
  const layer = (transportistaRouter as any).stack.find((l: any) => l.route?.path === '/remitos/:id/rechazar' && l.route.methods.post);
  assert.ok(layer, 'falta la ruta POST /remitos/:id/rechazar');
  const req: any = { params: { id: remitoId }, body, query: {}, headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; }, setHeader() { return this; } };
  for (const handler of layer.route.stack.map((s: any) => s.handle)) {
    let siguiente = false;
    await handler(req, res, () => { siguiente = true; });
    if (!siguiente) break;
  }
  return res;
}

describe('HU #24 · Registrar rechazo de entrega', () => {
  beforeEach(() => {
    authService.resetLockout();
    const mem = newDb();
    const hash = bcryptjs.hashSync('Password123!', 4);
    mem.public.none(`
      CREATE TABLE sucursal (id serial PRIMARY KEY, nombre text NOT NULL UNIQUE);
      CREATE TABLE usuario (id serial PRIMARY KEY, usuario text NOT NULL UNIQUE, nombre text NOT NULL, email text,
        password_hash text NOT NULL, rol text NOT NULL, es_transportista boolean NOT NULL DEFAULT false, activo boolean NOT NULL DEFAULT true);
      CREATE TABLE usuario_sucursal (usuario_id bigint NOT NULL, sucursal_id bigint NOT NULL, PRIMARY KEY (usuario_id, sucursal_id));
      CREATE TABLE sesion_usuario (id text PRIMARY KEY, usuario_id bigint NOT NULL, token text NOT NULL UNIQUE, ip_address text, user_agent text,
        creado_en timestamptz DEFAULT now(), ultimo_acceso timestamptz DEFAULT now(), expira_en timestamptz NOT NULL,
        revocado boolean NOT NULL DEFAULT false, revocado_en timestamptz, motivo_cierre text);
      CREATE TABLE hoja_de_ruta (id serial PRIMARY KEY, sucursal_id bigint, transportista_id bigint NOT NULL, fecha_reparto date NOT NULL, estado text NOT NULL);
      CREATE TABLE visita (id serial PRIMARY KEY, hoja_de_ruta_id bigint, comercio_id bigint NOT NULL, orden integer, estado text NOT NULL DEFAULT 'pendiente', observacion text);
      CREATE TABLE remito (id serial PRIMARY KEY, numero text NOT NULL, visita_id bigint, estado text NOT NULL, motivo_no_entrega text,
        latitud numeric(9,6), longitud numeric(9,6), actualizado_en timestamptz DEFAULT now());

      INSERT INTO sucursal (id, nombre) VALUES (1, 'Central');
      INSERT INTO usuario (id, usuario, nombre, password_hash, rol, es_transportista) VALUES
        (1, 'admin', 'Admin', '${hash}', 'Administrativo', false),
        (2, 'chofer', 'Chofer', '${hash}', 'Transportista', true),
        (3, 'chofer2', 'Otro', '${hash}', 'Transportista', true);
      INSERT INTO usuario_sucursal VALUES (1, 1), (2, 1), (3, 1);
      INSERT INTO hoja_de_ruta (id, sucursal_id, transportista_id, fecha_reparto, estado) VALUES (1, 1, 2, '2026-10-24', 'publicada');
      INSERT INTO visita (id, hoja_de_ruta_id, comercio_id, orden) VALUES (1, 1, 1, 1), (2, 1, 2, 2);
      INSERT INTO remito (id, numero, visita_id, estado) VALUES
        (1, 'R-1', 1, 'entregado'),
        (2, 'R-2', 1, 'en_ruta'),
        (3, 'R-3', 2, 'en_ruta'),
        (4, 'R-4', 2, 'en_ruta');
    `);
    const { Pool } = mem.adapters.createPg();
    db.setPool(new Pool() as any);
  });

  it('registra el rechazo con el motivo y la ubicación', async () => {
    const resultado = await rechazoService.rechazarRemito(CHOFER, '3', cuerpo('Mercadería dañada o en mal estado'));
    assert.equal(resultado.duplicado, false);
    const remito = await fila('SELECT estado, motivo_no_entrega, latitud FROM remito WHERE id = 3');
    assert.equal(remito.estado, 'no_entregado');
    assert.equal(remito.motivo_no_entrega, 'Mercadería dañada o en mal estado');
    assert.equal(Number(remito.latitud), -34.92);
    assert.equal((await fila('SELECT estado FROM visita WHERE id = 2')).estado, 'en_curso');
  });

  it('cierra la visita "con excepciones" cuando el último pendiente se rechaza y hubo entregas', async () => {
    const resultado = await rechazoService.rechazarRemito(CHOFER, '2', cuerpo());
    assert.equal(resultado.visitaEstado, 'completada');
    const visita = await fila('SELECT estado, observacion FROM visita WHERE id = 1');
    assert.deepEqual({ ...visita }, { estado: 'completada', observacion: 'Entregada con excepciones' });
  });

  it('marca la visita como no realizada si se rechazan todos sus remitos', async () => {
    await rechazoService.rechazarRemito(CHOFER, '3', cuerpo());
    await rechazoService.rechazarRemito(CHOFER, '4', cuerpo());
    assert.equal((await fila('SELECT estado FROM visita WHERE id = 2')).estado, 'no_realizada');
  });

  it('exige un motivo', async () => {
    await rechaza(rechazoService.rechazarRemito(CHOFER, '3', cuerpo('   ')), 422, /motivo/);
  });

  it('un reenvío de la cola sin conexión no falla ni cambia el motivo original', async () => {
    await rechazoService.rechazarRemito(CHOFER, '3', cuerpo('Comercio cerrado'));
    const reenvio = await rechazoService.rechazarRemito(CHOFER, '3', cuerpo('Otro motivo'));
    assert.equal(reenvio.duplicado, true);
    assert.equal((await fila('SELECT motivo_no_entrega FROM remito WHERE id = 3')).motivo_no_entrega, 'Comercio cerrado');
  });

  it('no permite rechazar un remito ya entregado', async () => {
    await rechaza(rechazoService.rechazarRemito(CHOFER, '1', cuerpo()), 409, /ya fue entregado/);
  });

  it('no permite rechazar remitos de la hoja de otro transportista', async () => {
    await rechaza(rechazoService.rechazarRemito(3, '3', cuerpo()), 404, /no pertenece/);
  });

  it('la API exige sesión y rol de transportista', async () => {
    assert.equal((await postRechazo('3', null, cuerpo())).statusCode, 401);
    const admin = await authService.login({ identifier: 'admin', password: 'Password123!' });
    assert.equal((await postRechazo('3', admin.session!.token, cuerpo())).statusCode, 403);
    const chofer = await authService.login({ identifier: 'chofer', password: 'Password123!' });
    const res = await postRechazo('3', chofer.session!.token, cuerpo());
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
  });
});
