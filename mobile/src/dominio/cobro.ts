// Reglas de cobro que la app valida antes de confirmar (HU #26 a #29).
// El backend vuelve a validar todo (backend/src/services/cobroService.ts).
import { formatearPesos, parsearPesos } from './dinero';

export type MedioPago = 'efectivo' | 'transferencia' | 'qr';

export const NOMBRE_MEDIO: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  qr: 'QR Mercado Pago',
};

/** Medios que requieren conexión (RNF y HU #29). Ver supuesto S4 en docs/requerimientos. */
export const MEDIOS_SOLO_EN_LINEA: MedioPago[] = ['qr'];

/** Una fila del formulario de cobro, tal como la carga el transportista. */
export interface PagoEnCarga {
  medioPago: MedioPago;
  importeTexto: string;
  referencia: string;
}

export interface ResultadoValidacion {
  puedeConfirmar: boolean;
  /** Positiva si sobra plata, negativa si falta. */
  diferenciaCentavos: number;
  declaradoCentavos: number;
  errores: string[];
}

export function validarCobro(pagos: PagoEnCarga[], totalExigibleCentavos: number, enLinea: boolean): ResultadoValidacion {
  const errores: string[] = [];
  let declaradoCentavos = 0;

  if (totalExigibleCentavos === 0) {
    // HU #25 ESCENARIO 2: sin cobro en destino, no se exige recaudación.
    return {
      puedeConfirmar: pagos.length === 0,
      diferenciaCentavos: 0,
      declaradoCentavos: 0,
      errores: pagos.length ? ['La visita no tiene cobro en destino.'] : [],
    };
  }
  if (pagos.length === 0) errores.push('Elegí un medio de pago.');

  pagos.forEach((pago, i) => {
    const fila = pagos.length > 1 ? ` (medio ${i + 1})` : '';
    const importe = parsearPesos(pago.importeTexto);
    if (importe === null || importe <= 0) {
      errores.push(`Ingresá un importe válido${fila}.`);
    } else {
      declaradoCentavos += importe;
    }
    // HU #28 ESCENARIO 3 y HU #29 ESCENARIO 4.
    if (pago.medioPago === 'transferencia' && !pago.referencia.trim()) {
      errores.push(`Falta la referencia bancaria de la transferencia${fila}.`);
    }
    if (!enLinea && MEDIOS_SOLO_EN_LINEA.includes(pago.medioPago)) {
      errores.push('El cobro por QR necesita conexión a internet.');
    }
  });

  const referencias = pagos
    .filter((pago) => pago.medioPago === 'transferencia' && pago.referencia.trim())
    .map((pago) => pago.referencia.trim().toUpperCase());
  if (new Set(referencias).size !== referencias.length) {
    errores.push('La misma referencia de transferencia se cargó dos veces.');
  }

  // HU #26 ESCENARIO 3 y HU #29 ESCENARIO 3: la suma tiene que ser exacta.
  const diferenciaCentavos = declaradoCentavos - totalExigibleCentavos;
  if (diferenciaCentavos < 0) errores.push(`Faltan ${formatearPesos(-diferenciaCentavos)} para completar el total.`);
  if (diferenciaCentavos > 0) errores.push(`Sobran ${formatearPesos(diferenciaCentavos)} sobre el total.`);

  return { puedeConfirmar: errores.length === 0, diferenciaCentavos, declaradoCentavos, errores };
}

/** Importe para precargar una fila nueva: lo que falta para llegar al total. */
export function importeRestante(pagos: PagoEnCarga[], totalExigibleCentavos: number): number {
  const cargado = pagos.reduce((suma, pago) => suma + (parsearPesos(pago.importeTexto) || 0), 0);
  return Math.max(totalExigibleCentavos - cargado, 0);
}
