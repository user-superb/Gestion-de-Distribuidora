// frontend/src/services/transportistaService.ts
import { HojaDeRutaActiva } from '../types/domain';
import { offlineSyncService } from './offlineSyncService';

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';
const HOJA_CACHE_KEY = 'tutucas_hoja_activa_cache';

// Datos de fallback en memoria si el backend no responde
const MOCK_HOJA_DEFAULT: HojaDeRutaActiva = {
  id: 'HDR-2026-001',
  transportistaId: '2',
  fechaReparto: new Date().toISOString().split('T')[0],
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
          id: '6',
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
          id: '7',
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
    {
      id: 'VIS-2',
      comercioId: '2',
      comercioNombre: 'Autoservicio Luna',
      comercioDomicilio: 'Belgrano 1230, Avellaneda',
      orden: 2,
      estado: 'pendiente',
      todosEntregados: false,
      remitos: [
        {
          id: '8',
          numeroRemito: 'R-0004-90003',
          marcaId: '3',
          marcaNombre: 'Alimentos Río de la Plata',
          comercioId: '2',
          importe: 82000,
          importeCentavos: 8200000,
          estado: 'pendiente',
          visitaId: 'VIS-2',
        },
      ],
    },
  ],
  resumen: {
    totalVisitas: 2,
    visitasCompletadas: 0,
    totalRemitos: 3,
    remitosEntregados: 0,
  },
};

export interface ConfirmarEntregaResult {
  success: boolean;
  modo: 'online' | 'offline';
  remitoId: string;
  timestamp: string;
  latitud: number;
  longitud: number;
  visitaCerrada?: boolean;
  visitaEstado?: string;
  error?: string;
}

export const transportistaService = {
  /**
   * Obtiene la posición GPS actual del dispositivo con fallback a coordenadas operativas seguras
   */
  async obtenerCoordenadasGps(): Promise<{ latitud: number; longitud: number }> {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 60000,
          });
        });
        return {
          latitud: Number(position.coords.latitude.toFixed(6)),
          longitud: Number(position.coords.longitude.toFixed(6)),
        };
      } catch {
        // Fallback si el usuario no autoriza GPS o falla
      }
    }
    // Coordenadas operativas por defecto (Centro Logístico / La Plata - Berisso)
    return {
      latitud: -34.92145,
      longitud: -57.95453,
    };
  },

  /**
   * Obtiene la hoja de ruta activa y aplica el estado de remitos guardados en cola offline
   */
  async getHojaActiva(transportistaId: string = '2'): Promise<HojaDeRutaActiva> {
    let hoja: HojaDeRutaActiva | null = null;
    const cleanId = String(transportistaId || '2').replace(/^usr_/, '').trim() || '2';

    if (offlineSyncService.isOnline()) {
      try {
        const res = await fetch(`${API_BASE}/transportista/hoja-activa?transportistaId=${cleanId}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.hoja) {
            hoja = data.hoja;
            // Guardar en caché para acceso sin conexión
            try {
              localStorage.setItem(HOJA_CACHE_KEY, JSON.stringify(hoja));
            } catch {}
          }
        }
      } catch {
        // Fallback a caché
      }
    }

    if (!hoja) {
      try {
        const cached = localStorage.getItem(HOJA_CACHE_KEY);
        if (cached) {
          hoja = JSON.parse(cached);
        }
      } catch {}
    }

    if (!hoja) {
      hoja = JSON.parse(JSON.stringify(MOCK_HOJA_DEFAULT));
    }

    // Unificar con la cola offline local
    return this.aplicarColaOfflineAHoja(hoja!);
  },

  /**
   * Sobrescribe visualmente el estado de los remitos con los eventos pendientes de la cola offline
   */
  aplicarColaOfflineAHoja(hoja: HojaDeRutaActiva): HojaDeRutaActiva {
    const cola = offlineSyncService.obtenerCola();
    if (cola.length === 0) return hoja;

    const copia: HojaDeRutaActiva = JSON.parse(JSON.stringify(hoja));
    let remitosEntregadosCount = 0;

    copia.visitas.forEach((v) => {
      v.remitos.forEach((r) => {
        const itemEnCola = cola.find((c) => c.remitoId === r.id);
        if (itemEnCola) {
          r.estado = 'entregado';
          r.entregadoEn = itemEnCola.timestamp;
          r.latitud = itemEnCola.latitud;
          r.longitud = itemEnCola.longitud;
          r.enColaOffline = true;
        }
        if (r.estado === 'entregado') {
          remitosEntregadosCount++;
        }
      });

      // Evaluar Regla 3: Si todos los remitos de la visita están entregados
      const todosTerminales = v.remitos.length > 0 && v.remitos.every(
        (r) => r.estado === 'entregado' || r.estado === 'no_entregado'
      );
      if (todosTerminales) {
        v.estado = 'completada';
        v.todosEntregados = true;
      }
    });

    copia.resumen.remitosEntregados = remitosEntregadosCount;
    copia.resumen.visitasCompletadas = copia.visitas.filter((v) => v.estado === 'completada').length;

    return copia;
  },

  /**
   * HU #22: Confirmar la entrega individual de un remito.
   * - Escenario 1: Si hay conexión, envía al backend y sella la hora en el servidor.
   * - Escenario 2: Si no hay conexión (offline), guarda el evento con el timestamp original en la cola local.
   */
  async confirmarEntrega(
    remitoId: string,
    transportistaId: string = '2',
    gpsCoords?: { latitud: number; longitud: number }
  ): Promise<ConfirmarEntregaResult> {
    const cleanChoferId = String(transportistaId || '2').replace(/^usr_/, '').trim() || '2';
    const timestampLocal = new Date().toISOString();
    const coords = gpsCoords || (await this.obtenerCoordenadasGps());

    // ESCENARIO 2: Modo Offline (sin conexión o conexión simulada desactivada)
    if (!offlineSyncService.isOnline()) {
      offlineSyncService.encolarEntrega({
        remitoId,
        timestamp: timestampLocal, // TIMESTAMP ORIGINAL SELLADO
        transportistaId: cleanChoferId,
        latitud: coords.latitud,
        longitud: coords.longitud,
      });

      return {
        success: true,
        modo: 'offline',
        remitoId,
        timestamp: timestampLocal,
        latitud: coords.latitud,
        longitud: coords.longitud,
      };
    }

    // ESCENARIO 1: Modo Online con el servidor
    try {
      const res = await fetch(`${API_BASE}/transportista/remitos/${encodeURIComponent(remitoId)}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: timestampLocal,
          transportistaId: cleanChoferId,
          latitud: coords.latitud,
          longitud: coords.longitud,
        }),
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = await res.json();
        // Si estaba en cola previa, removerlo
        offlineSyncService.quitarDeCola(remitoId);

        return {
          success: true,
          modo: 'online',
          remitoId,
          timestamp: data.remito?.entregadoEn || timestampLocal,
          latitud: coords.latitud,
          longitud: coords.longitud,
          visitaCerrada: data.visitaCerrada,
          visitaEstado: data.visitaEstado,
        };
      } else {
        // Fallback a cola offline si el servidor responde con error 5xx o timeout
        offlineSyncService.encolarEntrega({
          remitoId,
          timestamp: timestampLocal,
          transportistaId,
          latitud: coords.latitud,
          longitud: coords.longitud,
        });

        return {
          success: true,
          modo: 'offline',
          remitoId,
          timestamp: timestampLocal,
          latitud: coords.latitud,
          longitud: coords.longitud,
        };
      }
    } catch {
      // Error de red: Guardar en cola offline (Escenario 2)
      offlineSyncService.encolarEntrega({
        remitoId,
        timestamp: timestampLocal,
        transportistaId,
        latitud: coords.latitud,
        longitud: coords.longitud,
      });

      return {
        success: true,
        modo: 'offline',
        remitoId,
        timestamp: timestampLocal,
        latitud: coords.latitud,
        longitud: coords.longitud,
      };
    }
  },

  /**
   * Resetea el caché local y la cola para pruebas
   */
  limpiarDatosLocales(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(HOJA_CACHE_KEY);
      offlineSyncService.limpiarCola();
    }
  },
};
