// frontend/src/services/__tests__/offlineSyncService.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { offlineSyncService } from '../offlineSyncService';
import { transportistaService } from '../transportistaService';
import { HojaDeRutaActiva } from '../../types/domain';

describe('HU #22: Ejecución Móvil y Sincronización Offline', () => {
  beforeEach(() => {
    // Limpiar cola y modo offline simulado antes de cada test
    offlineSyncService.limpiarCola();
    offlineSyncService.setSimulatedOffline(false);
  });

  it('ESCENARIO 2 (Cola Offline): Encola la entrega con timestamp original y coordenadas GPS inmutables', () => {
    const timestampOriginal = '2026-10-17T21:10:00.000Z';
    const lat = -34.603722;
    const lng = -58.381592;

    offlineSyncService.encolarEntrega({
      remitoId: 'rem-offline-1',
      timestamp: timestampOriginal,
      transportistaId: '2',
      latitud: lat,
      longitud: lng,
    });

    expect(offlineSyncService.obtenerCantidadEnCola()).toBe(1);
    expect(offlineSyncService.estaEnCola('rem-offline-1')).toBe(true);

    const item = offlineSyncService.obtenerItemDeCola('rem-offline-1');
    expect(item).toBeDefined();
    expect(item?.timestamp).toBe(timestampOriginal);
    expect(item?.latitud).toBe(lat);
    expect(item?.longitud).toBe(lng);
  });

  it('Modo Offline Simulado: Permite conmutar entre En Línea y Sin Conexión para QA', () => {
    expect(offlineSyncService.isOnline()).toBe(true);

    // Activar simulación offline
    offlineSyncService.setSimulatedOffline(true);
    expect(offlineSyncService.isSimulatedOffline()).toBe(true);
    expect(offlineSyncService.isOnline()).toBe(false);

    // Desactivar simulación offline
    offlineSyncService.setSimulatedOffline(false);
    expect(offlineSyncService.isSimulatedOffline()).toBe(false);
    expect(offlineSyncService.isOnline()).toBe(true);
  });

  it('ESCENARIO 2 (Vista Local): aplicarColaOfflineAHoja actualiza el remito a entregado en la vista sin esperar al servidor', () => {
    const timestampCaptura = '2026-10-17T21:30:00.000Z';

    const hojaBase: HojaDeRutaActiva = {
      id: 'HDR-1',
      transportistaId: '2',
      fechaReparto: '2026-10-17',
      patente: 'AF-321-JK',
      estado: 'en_curso',
      visitas: [
        {
          id: 'VIS-1',
          comercioId: '1',
          comercioNombre: 'Mayorista El Sol S.R.L.',
          comercioDomicilio: 'Av. Hipólito Yrigoyen 4500, Lanús',
          orden: 1,
          estado: 'en_curso',
          todosEntregados: false,
          remitos: [
            {
              id: 'rem-101',
              numeroRemito: 'R-0004-90001',
              marcaId: '1',
              marcaNombre: 'Lácteos del Sur',
              comercioId: '1',
              importe: 125000,
              importeCentavos: 12500000,
              estado: 'pendiente',
              visitaId: 'VIS-1',
            },
            {
              id: 'rem-102',
              numeroRemito: 'R-0004-90002',
              marcaId: '2',
              marcaNombre: 'Bebidas Nacionales',
              comercioId: '1',
              importe: 45000,
              importeCentavos: 4500000,
              estado: 'pendiente',
              visitaId: 'VIS-1',
            },
          ],
        },
      ],
      resumen: {
        totalVisitas: 1,
        visitasCompletadas: 0,
        totalRemitos: 2,
        remitosEntregados: 0,
      },
    };

    // Chofer confirma el remito 101 sin conexión
    offlineSyncService.encolarEntrega({
      remitoId: 'rem-101',
      timestamp: timestampCaptura,
      transportistaId: '2',
      latitud: -34.6037,
      longitud: -58.3815,
    });

    const hojaConCola = transportistaService.aplicarColaOfflineAHoja(hojaBase);

    // El remito 101 figura como entregado y con bandera de cola offline
    const remito101 = hojaConCola.visitas[0].remitos.find((r) => r.id === 'rem-101');
    expect(remito101?.estado).toBe('entregado');
    expect(remito101?.enColaOffline).toBe(true);
    expect(remito101?.entregadoEn).toBe(timestampCaptura);

    // REGLA 3: Como el remito 102 sigue pendiente, la visita general sigue en_curso y NO completada
    expect(hojaConCola.visitas[0].estado).toBe('en_curso');
    expect(hojaConCola.visitas[0].todosEntregados).toBe(false);
  });

  it('REGLA 3: Al entregar todos los remitos de la parada en offline, la visita pasa a completada', () => {
    const hojaBase: HojaDeRutaActiva = {
      id: 'HDR-1',
      transportistaId: '2',
      fechaReparto: '2026-10-17',
      patente: 'AF-321-JK',
      estado: 'en_curso',
      visitas: [
        {
          id: 'VIS-1',
          comercioId: '1',
          comercioNombre: 'Mayorista El Sol S.R.L.',
          comercioDomicilio: 'Av. Hipólito Yrigoyen 4500, Lanús',
          orden: 1,
          estado: 'en_curso',
          todosEntregados: false,
          remitos: [
            {
              id: 'rem-101',
              numeroRemito: 'R-0004-90001',
              marcaId: '1',
              marcaNombre: 'Lácteos del Sur',
              comercioId: '1',
              importe: 125000,
              importeCentavos: 12500000,
              estado: 'pendiente',
              visitaId: 'VIS-1',
            },
            {
              id: 'rem-102',
              numeroRemito: 'R-0004-90002',
              marcaId: '2',
              marcaNombre: 'Bebidas Nacionales',
              comercioId: '1',
              importe: 45000,
              importeCentavos: 4500000,
              estado: 'pendiente',
              visitaId: 'VIS-1',
            },
          ],
        },
      ],
      resumen: {
        totalVisitas: 1,
        visitasCompletadas: 0,
        totalRemitos: 2,
        remitosEntregados: 0,
      },
    };

    // Entregar ambos remitos
    offlineSyncService.encolarEntrega({
      remitoId: 'rem-101',
      timestamp: '2026-10-17T21:30:00.000Z',
      transportistaId: '2',
      latitud: -34.6037,
      longitud: -58.3815,
    });
    offlineSyncService.encolarEntrega({
      remitoId: 'rem-102',
      timestamp: '2026-10-17T21:32:00.000Z',
      transportistaId: '2',
      latitud: -34.6038,
      longitud: -58.3816,
    });

    const hojaActualizada = transportistaService.aplicarColaOfflineAHoja(hojaBase);

    // Ahora todos los remitos están entregados -> visita pasa a completada
    expect(hojaActualizada.visitas[0].estado).toBe('completada');
    expect(hojaActualizada.visitas[0].todosEntregados).toBe(true);
    expect(hojaActualizada.resumen.visitasCompletadas).toBe(1);
    expect(hojaActualizada.resumen.remitosEntregados).toBe(2);
  });

  it('Sincronización: Al sincronizar exitosamente con la API, vacía los elementos de la cola', async () => {
    offlineSyncService.encolarEntrega({
      remitoId: 'rem-sinc-1',
      timestamp: '2026-10-17T20:00:00.000Z',
      transportistaId: '2',
      latitud: -34.60,
      longitud: -58.38,
    });

    // Mock fetch de éxito
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        resultados: [{ remitoId: 'rem-sinc-1', success: true }],
      }),
    } as any);

    const resultado = await offlineSyncService.sincronizarCola();
    expect(resultado.success).toBe(true);
    expect(resultado.sincronizados).toBe(1);
    expect(offlineSyncService.obtenerCantidadEnCola()).toBe(0);
  });
});
