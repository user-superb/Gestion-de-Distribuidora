// Cola de operaciones registradas en el celular, pendientes de llegar al servidor:
// entregas de remitos (HU #22), entregas multimarca en lote (HU #23) y cobros de visitas (HU #26 a #29).
// RNF: la app funciona sin conexión y sincroniza apenas recupera el acceso.
// Se envían en el orden en que se registraron, así la entrega llega antes que el cobro.
// Reenviar es seguro: el cobro lleva claves de idempotencia y la entrega de un remito ya entregado no se pisa.
import { ErrorApi } from '../errores';
import type { CobroDto, EntregaDto, ItemEntregaLote, RechazoDto } from '../tipos';

export type EstadoEnCola = 'pendiente' | 'sincronizado' | 'rechazado';

export type Operacion =
  | { tipo: 'cobro'; visitaId: string; cuerpo: CobroDto }
  | { tipo: 'entrega'; visitaId: string; remitoId: string; cuerpo: EntregaDto }
  | { tipo: 'entrega_lote'; visitaId: string; entregas: ItemEntregaLote[]; cuerpoGeneral: EntregaDto }
  | { tipo: 'rechazo'; visitaId: string; remitoId: string; cuerpo: RechazoDto };

export type ItemCola = Operacion & { estado: EstadoEnCola; motivo?: string };

/** Almacenamiento clave-valor. En la app es AsyncStorage; en los tests, un Map. */
export interface Almacen {
  getItem(clave: string): Promise<string | null>;
  setItem(clave: string, valor: string): Promise<void>;
}

export type EnviarOperacion = (operacion: Operacion) => Promise<void>;

export interface ResultadoSincronizacion {
  sincronizados: number;
  rechazados: number;
  pendientes: number;
  sesionVencida: boolean;
}

const CLAVE = 'cola-cobros';
const MANTENER_SINCRONIZADOS_MS = 48 * 60 * 60 * 1000;

/** Identifica la operación: un cobro por visita, una entrega por remito, un rechazo por remito o un lote de visita. */
export function claveOperacion(operacion: Operacion): string {
  if (operacion.tipo === 'cobro') return `cobro:${operacion.visitaId}`;
  if (operacion.tipo === 'entrega_lote') return `entrega_lote:${operacion.visitaId}`;
  if (operacion.tipo === 'rechazo') return `rechazo:${operacion.remitoId}`;
  return `entrega:${operacion.remitoId}`;
}

function registradaEn(operacion: Operacion): number {
  if (operacion.tipo === 'cobro') return new Date(operacion.cuerpo.registradoEn).getTime();
  if (operacion.tipo === 'entrega_lote') return new Date(operacion.cuerpoGeneral.timestamp).getTime();
  return new Date(operacion.cuerpo.timestamp).getTime();
}

export class ColaOperaciones {
  private sincronizando = false;

  constructor(private almacen: Almacen, private enviar: EnviarOperacion) {}

  async listar(): Promise<ItemCola[]> {
    const guardado = await this.almacen.getItem(CLAVE);
    // Las versiones anteriores de la app solo guardaban cobros, sin el campo tipo.
    return guardado ? JSON.parse(guardado).map((item: any) => ({ tipo: 'cobro', ...item })) : [];
  }

  private async guardar(cola: ItemCola[]) {
    await this.almacen.setItem(CLAVE, JSON.stringify(cola));
  }

  /**
   * Guarda la operación en el celular. Si había un intento rechazado de la misma operación, lo reemplaza.
   * De paso descarta las ya sincronizadas de jornadas anteriores (más de 48 h).
   * En caso de lote, reemplaza intentos individuales previos de los remitos incluidos.
   * En caso de rechazo, anula intentos individuales de entrega previos para el mismo remito (y viceversa).
   */
  async encolar(operacion: Operacion, ahora = new Date()): Promise<void> {
    const clave = claveOperacion(operacion);
    const limite = ahora.getTime() - MANTENER_SINCRONIZADOS_MS;
    const remitoIdsEnLote = operacion.tipo === 'entrega_lote'
      ? new Set(operacion.entregas.map((e) => e.remitoId))
      : null;

    const cola = (await this.listar()).filter((item) => {
      if (claveOperacion(item) === clave && item.estado === 'rechazado') return false;
      if (remitoIdsEnLote && (item.tipo === 'entrega' || item.tipo === 'rechazo') && remitoIdsEnLote.has(item.remitoId)) return false;
      if (operacion.tipo === 'rechazo' && item.tipo === 'entrega' && item.remitoId === operacion.remitoId) return false;
      if (operacion.tipo === 'entrega' && item.tipo === 'rechazo' && item.remitoId === operacion.remitoId) return false;
      if (item.estado === 'sincronizado' && registradaEn(item) < limite) return false;
      return true;
    });
    cola.push({ ...operacion, estado: 'pendiente' });
    await this.guardar(cola);
  }

  /**
   * Envía los pendientes en orden. Si no hay red, se detiene y los deja para el próximo intento.
   * Si la sesión venció (401), también se detiene: se reintenta después de volver a iniciar sesión (supuesto S5).
   * Si el servidor rechaza la operación por una regla de negocio (4xx), queda marcada para que el transportista la corrija.
   */
  async sincronizar(): Promise<ResultadoSincronizacion> {
    const resultado = { sincronizados: 0, rechazados: 0, pendientes: 0, sesionVencida: false };
    if (this.sincronizando) {
      resultado.pendientes = (await this.listar()).filter((item) => item.estado === 'pendiente').length;
      return resultado;
    }
    this.sincronizando = true;
    try {
      const cola = await this.listar();
      for (const item of cola) {
        if (item.estado !== 'pendiente') continue;
        try {
          const { estado, motivo, ...operacion } = item;
          await this.enviar(operacion as Operacion);
          item.estado = 'sincronizado';
          resultado.sincronizados += 1;
        } catch (error) {
          if (error instanceof ErrorApi && error.status === 401) {
            resultado.sesionVencida = true;
            break;
          }
          if (error instanceof ErrorApi && error.status >= 400 && error.status < 500) {
            item.estado = 'rechazado';
            item.motivo = error.message;
            resultado.rechazados += 1;
            continue;
          }
          break; // Sin red o error del servidor: se reintenta más tarde.
        } finally {
          await this.guardar(cola);
        }
      }
      resultado.pendientes = cola.filter((item) => item.estado === 'pendiente').length;
      return resultado;
    } finally {
      this.sincronizando = false;
    }
  }

  /**
   * Último estado de cada operación, por clave ("cobro:<visita>", "entrega:<remito>", "entrega_lote:<visita>").
   * Para operaciones 'entrega_lote', mapea también cada remito como 'entrega:<remitoId>' para alimentar la UI.
   */
  async estadoPorClave(): Promise<Map<string, ItemCola>> {
    const mapa = new Map<string, ItemCola>();
    const items = await this.listar();
    for (const item of items) {
      mapa.set(claveOperacion(item), item);
      if (item.tipo === 'entrega_lote') {
        for (const e of item.entregas) {
          mapa.set(`entrega:${e.remitoId}`, {
            tipo: 'entrega',
            visitaId: item.visitaId,
            remitoId: e.remitoId,
            cuerpo: e.cuerpo,
            estado: item.estado,
            motivo: item.motivo,
          });
        }
      }
    }
    return mapa;
  }
}
