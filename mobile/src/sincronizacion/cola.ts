// Cola de cobros registrados en el celular, pendientes de llegar al servidor.
// RNF: la app funciona sin conexión y sincroniza apenas recupera el acceso.
// Cada pago lleva su clave de idempotencia, así un reenvío nunca duplica el cobro.
import { ErrorApi } from '../errores';
import type { CobroDto } from '../tipos';

export type EstadoEnCola = 'pendiente' | 'sincronizado' | 'rechazado';

export interface CobroEnCola {
  visitaId: string;
  cuerpo: CobroDto;
  estado: EstadoEnCola;
  motivo?: string;
}

/** Almacenamiento clave-valor. En la app es AsyncStorage; en los tests, un Map. */
export interface Almacen {
  getItem(clave: string): Promise<string | null>;
  setItem(clave: string, valor: string): Promise<void>;
}

export type EnviarCobro = (visitaId: string, cuerpo: CobroDto) => Promise<void>;

export interface ResultadoSincronizacion {
  sincronizados: number;
  rechazados: number;
  pendientes: number;
  sesionVencida: boolean;
}

const CLAVE = 'cola-cobros';
const MANTENER_SINCRONIZADOS_MS = 48 * 60 * 60 * 1000;

export class ColaCobros {
  private sincronizando = false;

  constructor(private almacen: Almacen, private enviar: EnviarCobro) {}

  async listar(): Promise<CobroEnCola[]> {
    const guardado = await this.almacen.getItem(CLAVE);
    return guardado ? JSON.parse(guardado) : [];
  }

  private async guardar(cola: CobroEnCola[]) {
    await this.almacen.setItem(CLAVE, JSON.stringify(cola));
  }

  /**
   * Guarda el cobro en el celular. Si había un intento rechazado de la misma visita, lo reemplaza.
   * De paso descarta los ya sincronizados de jornadas anteriores (más de 48 h).
   */
  async encolar(visitaId: string, cuerpo: CobroDto, ahora = new Date()): Promise<void> {
    const limite = ahora.getTime() - MANTENER_SINCRONIZADOS_MS;
    const cola = (await this.listar()).filter(
      (item) =>
        !(item.visitaId === visitaId && item.estado === 'rechazado') &&
        !(item.estado === 'sincronizado' && new Date(item.cuerpo.registradoEn).getTime() < limite)
    );
    cola.push({ visitaId, cuerpo, estado: 'pendiente' });
    await this.guardar(cola);
  }

  /**
   * Envía los pendientes en orden. Si no hay red, se detiene y los deja para el próximo intento.
   * Si la sesión venció (401), también se detiene: se reintenta después de volver a iniciar sesión (supuesto S5).
   * Si el servidor rechaza el cobro por una regla de negocio (4xx), queda marcado para que el transportista lo corrija.
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
          await this.enviar(item.visitaId, item.cuerpo);
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

  /** Estado local de cada visita según la cola: lo último registrado manda. */
  async estadoPorVisita(): Promise<Map<string, CobroEnCola>> {
    return new Map((await this.listar()).map((item) => [item.visitaId, item]));
  }
}
