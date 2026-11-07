// frontend/src/services/__tests__/tableroService.test.ts
// Pruebas unitarias para el servicio y utilidades del Tablero de Recaudación (Gerencia).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  tableroService,
  formatearMoneda,
  formatearCentavos,
  formatearPorcentaje,
  TableroServiceError,
} from '../tableroService';
import { ComposicionRecaudacion } from '../../types/tablero';

describe('HU Gerencia: Tablero de Recaudación por Medio de Pago', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Formateadores y Utilidades', () => {
    it('formatea montos en pesos argentinos con 2 decimales', () => {
      const formatted = formatearMoneda(12500.5);
      // Debe contener el símbolo $ y el separador de miles/decimales
      expect(formatted).toMatch(/\$\s?12\.500,50/);
    });

    it('formatea montos a partir de centavos enteros', () => {
      const formatted = formatearCentavos(1000000); // 10.000 pesos
      expect(formatted).toMatch(/\$\s?10\.000,00/);
    });

    it('formatea porcentajes con un decimal', () => {
      expect(formatearPorcentaje(25)).toBe('25,0%');
      expect(formatearPorcentaje(33.333)).toBe('33,3%');
      expect(formatearPorcentaje(0)).toBe('0,0%');
    });
  });

  describe('tableroService.obtenerRecaudacion', () => {
    const mockRespuesta: ComposicionRecaudacion = {
      totalRecaudadoCentavos: 1000000,
      totalRecaudadoPesos: 10000,
      cantidadTotalPagos: 3,
      desglose: [
        {
          medioPago: 'efectivo',
          etiqueta: 'Efectivo',
          totalCentavos: 200000,
          totalPesos: 2000,
          cantidadPagos: 1,
          porcentaje: 20,
          color: '#10B981',
        },
        {
          medioPago: 'transferencia',
          etiqueta: 'Transferencia bancaria',
          totalCentavos: 500000,
          totalPesos: 5000,
          cantidadPagos: 1,
          porcentaje: 50,
          color: '#2563EB',
        },
        {
          medioPago: 'qr',
          etiqueta: 'Pago QR',
          totalCentavos: 300000,
          totalPesos: 3000,
          cantidadPagos: 1,
          porcentaje: 30,
          color: '#F4661B',
        },
      ],
      filtrosAplicados: {
        sucursalId: null,
        fechaDesde: null,
        fechaHasta: null,
        soloConfirmados: true,
      },
    };

    it('ESCENARIO 1: Gráfico de recaudación renderizado: obtiene correctamente el desglose consolidado de la distribución de medios de pago', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, options: any) => {
          expect(url).toContain('/api/tablero/recaudacion');
          expect(options.headers.Authorization).toBe('Bearer token-gerente');

          return new Response(JSON.stringify(mockRespuesta), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        })
      );

      const res = await tableroService.obtenerRecaudacion('token-gerente');

      expect(res.totalRecaudadoPesos).toBe(10000);
      expect(res.cantidadTotalPagos).toBe(3);
      expect(res.desglose).toHaveLength(3);

      const efectivo = res.desglose.find((d) => d.medioPago === 'efectivo');
      const transf = res.desglose.find((d) => d.medioPago === 'transferencia');
      const qr = res.desglose.find((d) => d.medioPago === 'qr');

      expect(efectivo?.totalPesos).toBe(2000);
      expect(efectivo?.porcentaje).toBe(20);
      expect(transf?.totalPesos).toBe(5000);
      expect(transf?.porcentaje).toBe(50);
      expect(qr?.totalPesos).toBe(3000);
      expect(qr?.porcentaje).toBe(30);
    });

    it('envía los filtros de búsqueda por querystring', async () => {
      let urlCapturada = '';
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          urlCapturada = url;
          return new Response(JSON.stringify(mockRespuesta), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        })
      );

      await tableroService.obtenerRecaudacion('token-admin', {
        sucursalId: '2',
        fechaDesde: '2026-11-01',
        fechaHasta: '2026-11-05',
        soloConfirmados: false,
      });

      expect(urlCapturada).toContain('sucursalId=2');
      expect(urlCapturada).toContain('fechaDesde=2026-11-01');
      expect(urlCapturada).toContain('fechaHasta=2026-11-05');
      expect(urlCapturada).toContain('confirmados=false');
    });

    it('lanza TableroServiceError ante errores de autorización o de red', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          return new Response(
            JSON.stringify({ error: 'FORBIDDEN', message: 'No tenés permisos para consultar el tablero.' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        })
      );

      await expect(tableroService.obtenerRecaudacion('token-invalido')).rejects.toThrow(
        TableroServiceError
      );
      await expect(tableroService.obtenerRecaudacion('token-invalido')).rejects.toThrow(
        /No tenés permisos/
      );
    });
  });

  describe('tableroService.obtenerMetricasEntregasDiarias', () => {
    const mockEntregasExitosas = {
      fecha: '2026-11-07',
      totalDespachados: 10,
      exitosas: 7,
      pendientes: 2,
      rechazadas: 1,
      porcentajeExitosas: 70.0,
      porcentajePendientes: 20.0,
      porcentajeRechazadas: 10.0,
      tasaEfectividad: 70.0,
      operacionInactiva: false,
      filtrosAplicados: {
        fecha: '2026-11-07',
        sucursalId: null,
      },
    };

    it('obtiene métricas de entregas diarias exitosamente', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          expect(url).toContain('/api/tablero/entregas-diarias');
          expect(init?.headers).toEqual(
            expect.objectContaining({
              Authorization: 'Bearer token-gerente',
            })
          );
          return new Response(JSON.stringify(mockEntregasExitosas), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        })
      );

      const res = await tableroService.obtenerMetricasEntregasDiarias('token-gerente', { fecha: '2026-11-07' });
      expect(res.operacionInactiva).toBe(false);
      expect(res.totalDespachados).toBe(10);
      expect(res.exitosas).toBe(7);
      expect(res.tasaEfectividad).toBe(70.0);
    });

    it('procesa respuesta de inactividad comercial con métrica plana', async () => {
      const mockInactiva = {
        fecha: '2026-11-08',
        totalDespachados: 0,
        exitosas: 0,
        pendientes: 0,
        rechazadas: 0,
        porcentajeExitosas: 0,
        porcentajePendientes: 0,
        porcentajeRechazadas: 0,
        tasaEfectividad: 0,
        operacionInactiva: true,
        mensajeEstado: 'Operación inactiva en la fecha',
        filtrosAplicados: {
          fecha: '2026-11-08',
          sucursalId: null,
        },
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          return new Response(JSON.stringify(mockInactiva), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        })
      );

      const res = await tableroService.obtenerMetricasEntregasDiarias('token-gerente', { fecha: '2026-11-08' });
      expect(res.operacionInactiva).toBe(true);
      expect(res.totalDespachados).toBe(0);
      expect(res.mensajeEstado).toBe('Operación inactiva en la fecha');
    });

    it('lanza TableroServiceError ante errores de API', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          return new Response(
            JSON.stringify({ error: 'INVALID_DATE', message: 'fecha debe tener formato AAAA-MM-DD.' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        })
      );

      await expect(
        tableroService.obtenerMetricasEntregasDiarias('token-gerente', { fecha: 'invalido' })
      ).rejects.toThrow(TableroServiceError);
    });
  });

  describe('tableroService.obtenerSucursalesPermitidas', () => {
    it('obtiene las sucursales permitidas para rol global', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          expect(url).toContain('/api/tablero/sucursales-permitidas');
          expect(init?.headers).toEqual(
            expect.objectContaining({
              Authorization: 'Bearer token-gerente',
            })
          );
          return new Response(
            JSON.stringify({
              esGlobal: true,
              sucursales: [
                { id: '1', nombre: 'Central Córdoba' },
                { id: '2', nombre: 'Sucursal Rosario' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        })
      );

      const res = await tableroService.obtenerSucursalesPermitidas('token-gerente');
      expect(res.esGlobal).toBe(true);
      expect(res.sucursales).toHaveLength(2);
      expect(res.sucursales[0].nombre).toBe('Central Córdoba');
    });

    it('obtiene las sucursales permitidas para usuario sectorizado', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          return new Response(
            JSON.stringify({
              esGlobal: false,
              sucursales: [{ id: '2', nombre: 'Sucursal Rosario' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        })
      );

      const res = await tableroService.obtenerSucursalesPermitidas('token-sectorizado');
      expect(res.esGlobal).toBe(false);
      expect(res.sucursales).toHaveLength(1);
      expect(res.sucursales[0].id).toBe('2');
    });

    it('lanza TableroServiceError si falla la consulta', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          return new Response(
            JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Fallo de base de datos' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        })
      );

      await expect(
        tableroService.obtenerSucursalesPermitidas('token-invalido')
      ).rejects.toThrow(TableroServiceError);
    });
  });
});
