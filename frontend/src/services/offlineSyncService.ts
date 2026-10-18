// frontend/src/services/offlineSyncService.ts
import { EntregaOfflineItem } from '../types/domain';

const QUEUE_STORAGE_KEY = 'tutucas_offline_deliveries_queue';
const SIMULATED_OFFLINE_KEY = 'tutucas_simulated_offline';
const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

const inMemoryStore = new Map<string, string>();

function getStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {}
  return inMemoryStore.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {}
  inMemoryStore.set(key, value);
}

function removeStorageItem(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {}
  inMemoryStore.delete(key);
}

type ColaListener = (cola: EntregaOfflineItem[]) => void;
type EstadoRedListener = (online: boolean) => void;

class OfflineSyncService {
  private colaListeners: Set<ColaListener> = new Set();
  private redListeners: Set<EstadoRedListener> = new Set();
  private sincronizando = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.notificarEstadoRed();
        this.sincronizarCola();
      });

      window.addEventListener('offline', () => {
        this.notificarEstadoRed();
      });

      // Chequeo periódico cada 30 segundos si hay conexión y elementos en cola
      setInterval(() => {
        if (this.isOnline() && this.obtenerCantidadEnCola() > 0) {
          this.sincronizarCola();
        }
      }, 30000);
    }
  }

  // --- Modo Simulado de Red (Para QA y Testing Manual) ---
  isSimulatedOffline(): boolean {
    return getStorageItem(SIMULATED_OFFLINE_KEY) === 'true';
  }

  setSimulatedOffline(offline: boolean): void {
    if (offline) {
      setStorageItem(SIMULATED_OFFLINE_KEY, 'true');
    } else {
      removeStorageItem(SIMULATED_OFFLINE_KEY);
    }
    this.notificarEstadoRed();
    if (!offline) {
      // Al reconectar, intentar sincronizar de inmediato
      this.sincronizarCola();
    }
  }

  toggleSimulatedOffline(): boolean {
    const nextState = !this.isSimulatedOffline();
    this.setSimulatedOffline(nextState);
    return nextState;
  }

  isOnline(): boolean {
    if (this.isSimulatedOffline()) return false;
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  // --- Gestión de la Cola Local ---
  obtenerCola(): EntregaOfflineItem[] {
    try {
      const raw = getStorageItem(QUEUE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  obtenerCantidadEnCola(): number {
    return this.obtenerCola().length;
  }

  estaEnCola(remitoId: string): boolean {
    return this.obtenerCola().some((item) => item.remitoId === remitoId);
  }

  obtenerItemDeCola(remitoId: string): EntregaOfflineItem | undefined {
    return this.obtenerCola().find((item) => item.remitoId === remitoId);
  }

  encolarEntrega(item: Omit<EntregaOfflineItem, 'guardadoEn' | 'intentos'>): void {
    const cola = this.obtenerCola();
    const indexExistente = cola.findIndex((c) => c.remitoId === item.remitoId);

    const nuevoItem: EntregaOfflineItem = {
      ...item,
      guardadoEn: new Date().toISOString(),
      intentos: 0,
    };

    if (indexExistente >= 0) {
      // Mantener el timestamp de captura original (inmutable)
      cola[indexExistente] = {
        ...nuevoItem,
        timestamp: cola[indexExistente].timestamp,
      };
    } else {
      cola.push(nuevoItem);
    }

    this.guardarCola(cola);
  }

  quitarDeCola(remitoId: string): void {
    const cola = this.obtenerCola().filter((c) => c.remitoId !== remitoId);
    this.guardarCola(cola);
  }

  limpiarCola(): void {
    removeStorageItem(QUEUE_STORAGE_KEY);
    this.notificarCola();
  }

  private guardarCola(cola: EntregaOfflineItem[]): void {
    setStorageItem(QUEUE_STORAGE_KEY, JSON.stringify(cola));
    this.notificarCola();
  }

  // --- Sincronización Automática en Segundo Plano (Escenario 2) ---
  async sincronizarCola(): Promise<{
    success: boolean;
    total: number;
    sincronizados: number;
    errores: string[];
  }> {
    if (this.sincronizando) {
      return { success: false, total: 0, sincronizados: 0, errores: ['Sincronización en curso'] };
    }

    if (!this.isOnline()) {
      return { success: false, total: 0, sincronizados: 0, errores: ['Dispositivo sin conexión'] };
    }

    const cola = this.obtenerCola();
    if (cola.length === 0) {
      return { success: true, total: 0, sincronizados: 0, errores: [] };
    }

    this.sincronizando = true;
    let sincronizados = 0;
    const errores: string[] = [];

    try {
      const payload = {
        entregas: cola.map((item) => ({
          remitoId: item.remitoId,
          dto: {
            timestamp: item.timestamp, // PRESERVA EL TIMESTAMP ORIGINAL (Regla 2)
            transportistaId: item.transportistaId,
            latitud: item.latitud,
            longitud: item.longitud,
          },
        })),
      };

      const res = await fetch(`${API_BASE}/transportista/sincronizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.resultados && Array.isArray(data.resultados)) {
          for (const r of data.resultados) {
            if (r.success) {
              this.quitarDeCola(r.remitoId);
              sincronizados++;
            } else {
              errores.push(`Remito ${r.remitoId}: ${r.error || 'Error al procesar'}`);
            }
          }
        }
      } else {
        errores.push(`Error del servidor: ${res.statusText}`);
      }
    } catch (err: any) {
      errores.push(`Fallo de red al sincronizar: ${err.message}`);
    } finally {
      this.sincronizando = false;
    }

    return {
      success: errores.length === 0,
      total: cola.length,
      sincronizados,
      errores,
    };
  }

  // --- Suscripciones y Notificaciones ---
  suscribirACola(listener: ColaListener): () => void {
    this.colaListeners.add(listener);
    listener(this.obtenerCola());
    return () => {
      this.colaListeners.delete(listener);
    };
  }

  suscribirAEstadoRed(listener: EstadoRedListener): () => void {
    this.redListeners.add(listener);
    listener(this.isOnline());
    return () => {
      this.redListeners.delete(listener);
    };
  }

  private notificarCola(): void {
    const cola = this.obtenerCola();
    for (const listener of this.colaListeners) {
      listener(cola);
    }
  }

  private notificarEstadoRed(): void {
    const online = this.isOnline();
    for (const listener of this.redListeners) {
      listener(online);
    }
  }
}

export const offlineSyncService = new OfflineSyncService();
