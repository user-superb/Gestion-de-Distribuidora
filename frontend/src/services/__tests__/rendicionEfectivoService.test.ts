// frontend/src/services/__tests__/rendicionEfectivoService.test.ts
// Épica 2.3 · Escritorio del supervisor de efectivo (HU #47 a #50).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analizarConteo,
  compararConDeclarado,
  formConteoVacio,
  formDesdeConteo,
  justificacionValida,
  leerPesos,
  rendicionEfectivoService,
  RendicionRetractadaError,
} from '../rendicionEfectivoService';

describe('HU #47 · Visualizar declaración de efectivo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ESCENARIO 1: abre la declaración con transportista, monto y fecha de la hoja', async () => {
    const detalle = { id: '3', transportista: { id: '2', nombre: 'Carlos Repartidor' }, declaradoCentavos: 4500000, fechaReparto: '2026-11-02' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(detalle), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const resultado = await rendicionEfectivoService.detalle('token', '3');
    expect(resultado.transportista.nombre).toBe('Carlos Repartidor');
    expect(resultado.declaradoCentavos).toBe(4500000);
    expect(resultado.fechaReparto).toBe('2026-11-02');
  });

  it('ESCENARIO 2: si fue retractada, avisa con el mensaje del sistema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'RENDICION_RETRACTADA', message: 'Carlos Repartidor retractó esta declaración de efectivo.', anuladaEn: '2026-11-02T21:10:00.000Z' }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    )));
    await expect(rendicionEfectivoService.detalle('token', '3')).rejects.toBeInstanceOf(RendicionRetractadaError);
    await expect(rendicionEfectivoService.detalle('token', '3')).rejects.toThrow(/retractó esta declaración/);
  });
});

describe('HU #48 · Aprobar rendición de efectivo', () => {
  it('ESCENARIO 1: el conteo de billetes que cuadra con lo declarado se valida sin diferencias', () => {
    const analisis = analizarConteo({ ...formConteoVacio(), billetes: { 20000: '2', 2000: '2', 1000: '1' } });
    expect(analisis).toEqual({ ok: true, rendidoCentavos: 4500000, conteo: { billetes: { '2000000': 2, '200000': 2, '100000': 1 }, monedasCentavos: 0 } });
    if (!analisis.ok) return;
    expect(compararConDeclarado(4500000, analisis.rendidoCentavos)).toEqual({ diferenciaCentavos: 0, tipo: 'coincide' });
  });

  it('solo es coincidente si es exactamente igual (un centavo de diferencia ya no lo es)', () => {
    expect(compararConDeclarado(4500000, 4499999).tipo).toBe('faltante');
    const analisis = analizarConteo({ ...formConteoVacio(), billetes: { 20000: '2', 2000: '2', 1000: '1' }, monedas: '0,50' });
    expect(analisis.ok && analisis.rendidoCentavos).toBe(4500050);
  });
});

describe('HU #49 · Registrar diferencia en el efectivo físico', () => {
  it('ESCENARIO 1: calcula el faltante contra lo declarado', () => {
    const analisis = analizarConteo({ ...formConteoVacio(), modo: 'total', total: '43.000' });
    expect(analisis.ok && analisis.rendidoCentavos).toBe(4300000);
    expect(compararConDeclarado(4500000, 4300000)).toEqual({ diferenciaCentavos: -200000, tipo: 'faltante' });
    expect(compararConDeclarado(4500000, 4550000)).toEqual({ diferenciaCentavos: 50000, tipo: 'sobrante' });
  });

  it('ESCENARIO 1: exige justificación escrita', () => {
    expect(justificacionValida('')).toBe(false);
    expect(justificacionValida('   falta   ')).toBe(false);
    expect(justificacionValida('Faltan dos billetes de $1.000')).toBe(true);
  });

  it('ESCENARIO 2: un valor negativo en el conteo de billetes bloquea el registro', () => {
    const billetes = analizarConteo({ ...formConteoVacio(), billetes: { 20000: '2', 1000: '-3' } });
    expect(billetes).toMatchObject({ ok: false, negativo: true });
    expect(analizarConteo({ ...formConteoVacio(), monedas: '-5' })).toMatchObject({ ok: false, negativo: true });
    expect(analizarConteo({ ...formConteoVacio(), modo: 'total', total: '-43000' })).toMatchObject({ ok: false, negativo: true });
  });

  it('rechaza cantidades no enteras y formatos inválidos sin marcarlos como negativos', () => {
    expect(analizarConteo({ ...formConteoVacio(), billetes: { 1000: '1.5' } })).toMatchObject({ ok: false, negativo: false });
    expect(analizarConteo(formConteoVacio())).toMatchObject({ ok: false, negativo: false });
    expect(leerPesos('45.000,50')).toEqual({ centavos: 4500050 });
    expect(leerPesos('abc')).toEqual({ error: 'invalido' });
  });
});

describe('HU #50 · Aprobar rendición con diferencia', () => {
  it('ESCENARIO 1: precarga el conteo registrado para aprobar con el mismo monto', () => {
    const form = formDesdeConteo(4300050, { billetes: { '2000000': 2, '100000': 3 }, monedasCentavos: 50 });
    const analisis = analizarConteo(form);
    expect(analisis.ok && analisis.rendidoCentavos).toBe(4300050);
    expect(analizarConteo(formDesdeConteo(4300000, null))).toMatchObject({ ok: true, rendidoCentavos: 4300000, conteo: null });
  });

  it('ESCENARIO 1: envía el monto y el motivo a la API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: '3', estado: 'validada' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await rendicionEfectivoService.aprobarConDiferencia('token', '3', 4300000, null, 'El chofer reconoce el faltante');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/efectivo\/rendiciones\/3\/aprobar-con-diferencia$/);
    expect(JSON.parse(String(init.body))).toEqual({ rendidoCentavos: 4300000, conteo: null, motivo: 'El chofer reconoce el faltante' });
    vi.unstubAllGlobals();
  });
});

describe('Opción 1 · Inicio de arqueo por el supervisor (escritorio web)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista hojas de ruta pendientes de arqueo', async () => {
    const hojasMock = [{ hojaId: '1', codigoHoja: 'HR-0001', efectivoCobradoCentavos: 4500000, visitasPendientesCount: 0 }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hojas: hojasMock }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const resultado = await rendicionEfectivoService.listarHojasPendientes('token', '2026-11-02');
    expect(resultado).toHaveLength(1);
    expect(resultado[0].codigoHoja).toBe('HR-0001');
    expect(resultado[0].efectivoCobradoCentavos).toBe(4500000);
  });

  it('inicia el arqueo de una hoja enviando hojaDeRutaId y forzar', async () => {
    const rendicionMock = { id: '5', estado: 'pendiente', declaradoCentavos: 4500000 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ rendicion: rendicionMock }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const resultado = await rendicionEfectivoService.iniciarArqueo('token', '1', undefined, true);
    expect(resultado.id).toBe('5');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/efectivo\/iniciar$/);
    expect(JSON.parse(String(init.body))).toEqual({ hojaDeRutaId: '1', forzar: true });
  });
});
