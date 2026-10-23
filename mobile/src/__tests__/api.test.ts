/// <reference types="node" />
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_API_URL,
  configurarApiUrl,
  normalizarApiUrl,
  obtenerApiUrl,
  restablecerApiUrl,
} from '../api';

describe('API Móvil - Configuración dinámica de URL', () => {
  beforeEach(async () => {
    await restablecerApiUrl();
  });

  it('normaliza URLs agregando protocolo http:// si falta y sufijo /api', () => {
    assert.equal(normalizarApiUrl('192.168.0.8:3001'), 'http://192.168.0.8:3001/api');
    assert.equal(normalizarApiUrl('192.168.0.8:3001/api'), 'http://192.168.0.8:3001/api');
    assert.equal(normalizarApiUrl('http://192.168.0.8:3001'), 'http://192.168.0.8:3001/api');
    assert.equal(normalizarApiUrl('http://192.168.0.8:3001/api/'), 'http://192.168.0.8:3001/api');
  });

  it('respeta URLs HTTPS de túneles como VS Code DevTunnels', () => {
    assert.equal(
      normalizarApiUrl('https://abc-3001.app.github.dev'),
      'https://abc-3001.app.github.dev/api'
    );
    assert.equal(
      normalizarApiUrl('https://abc-3001.app.github.dev/api'),
      'https://abc-3001.app.github.dev/api'
    );
  });

  it('devuelve DEFAULT_API_URL si la cadena está vacía', () => {
    assert.equal(normalizarApiUrl(''), DEFAULT_API_URL);
    assert.equal(normalizarApiUrl('   '), DEFAULT_API_URL);
  });

  it('permite cambiar la URL en tiempo de ejecución con configurarApiUrl', () => {
    configurarApiUrl('https://mi-tunel.app.github.dev');
    assert.equal(obtenerApiUrl(), 'https://mi-tunel.app.github.dev/api');
  });

  it('restablece a DEFAULT_API_URL', async () => {
    configurarApiUrl('https://otro-servidor.com/api');
    assert.equal(obtenerApiUrl(), 'https://otro-servidor.com/api');
    const reset = await restablecerApiUrl();
    assert.equal(reset, DEFAULT_API_URL);
    assert.equal(obtenerApiUrl(), DEFAULT_API_URL);
  });
});
