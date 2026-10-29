// Reglas de cobro que la app valida antes de confirmar (HU #26 a #29).
// El backend vuelve a validar todo (backend/src/services/cobroService.ts).
import type { ImporteVisita, Visita } from '../tipos';
import { ColaPorClave, esRemitoRechazado } from './estadoVisita';
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
  erroresPorPago: string[][];
  erroresGenerales: string[];
}

export function validarCobro(pagos: PagoEnCarga[], totalExigibleCentavos: number, enLinea: boolean): ResultadoValidacion {
  const errores: string[] = [];
  const erroresPorPago: string[][] = pagos.map(() => []);
  const erroresGenerales: string[] = [];
  let declaradoCentavos = 0;

  if (totalExigibleCentavos === 0) {
    // HU #25 ESCENARIO 2: sin cobro en destino, no se exige recaudación.
    const errSinCobro = pagos.length ? ['La visita no tiene cobro en destino.'] : [];
    return {
      puedeConfirmar: pagos.length === 0,
      diferenciaCentavos: 0,
      declaradoCentavos: 0,
      errores: errSinCobro,
      erroresPorPago,
      erroresGenerales: errSinCobro,
    };
  }
  if (pagos.length === 0) {
    errores.push('Elegí un medio de pago.');
    erroresGenerales.push('Elegí un medio de pago.');
  }

  pagos.forEach((pago, i) => {
    const fila = pagos.length > 1 ? ` (medio ${i + 1})` : '';
    const importe = parsearPesos(pago.importeTexto);
    if (importe === null || importe <= 0) {
      errores.push(`Ingresá un importe válido${fila}.`);
      erroresPorPago[i].push('Ingresá un importe válido.');
    } else {
      declaradoCentavos += importe;
    }
    // HU #28 ESCENARIO 3 y HU #29 ESCENARIO 4.
    if (pago.medioPago === 'transferencia' && !pago.referencia.trim()) {
      errores.push(`Falta la referencia bancaria de la transferencia${fila}.`);
      erroresPorPago[i].push('Falta el comprobante o referencia bancaria de la transferencia.');
    }
    if (!enLinea && MEDIOS_SOLO_EN_LINEA.includes(pago.medioPago)) {
      errores.push('El cobro por QR necesita conexión a internet.');
      erroresPorPago[i].push('El cobro por QR necesita conexión a internet.');
    }
  });

  const referencias = pagos
    .filter((pago) => pago.medioPago === 'transferencia' && pago.referencia.trim())
    .map((pago) => pago.referencia.trim().toUpperCase());
  if (new Set(referencias).size !== referencias.length) {
    const errDup = 'La misma referencia de transferencia se cargó dos veces.';
    errores.push(errDup);
    erroresGenerales.push(errDup);
  }

  // HU #26 ESCENARIO 3 y HU #29 ESCENARIO 3: la suma tiene que ser exacta.
  const diferenciaCentavos = declaradoCentavos - totalExigibleCentavos;
  if (diferenciaCentavos < 0) {
    const errFalta = `Faltan ${formatearPesos(-diferenciaCentavos)} para completar el total.`;
    errores.push(errFalta);
    erroresGenerales.push(errFalta);
  }
  if (diferenciaCentavos > 0) {
    const errSobra = `Sobran ${formatearPesos(diferenciaCentavos)} sobre el total.`;
    errores.push(errSobra);
    erroresGenerales.push(errSobra);
  }

  return { puedeConfirmar: errores.length === 0, diferenciaCentavos, declaradoCentavos, errores, erroresPorPago, erroresGenerales };
}

/** Importe para precargar una fila nueva: lo que falta para llegar al total. */
export function importeRestante(pagos: PagoEnCarga[], totalExigibleCentavos: number): number {
  const cargado = pagos.reduce((suma, pago) => suma + (parsearPesos(pago.importeTexto) || 0), 0);
  return Math.max(totalExigibleCentavos - cargado, 0);
}

/**
 * HU #25: Calcula el importe exigible de la visita en el celular,
 * descontando remitos rechazados (tanto en servidor como encolados sin conexión).
 */
export function calcularImporteVisitaLocal(visita: Visita, cola: ColaPorClave): ImporteVisita {
  const subtotales = new Map<string, number>();
  const remitosExcluidos: string[] = [];
  let totalCentavos = 0;

  for (const remito of visita.remitos) {
    if (esRemitoRechazado(remito, cola) || remito.estado === 'anulado') {
      remitosExcluidos.push(remito.numero);
      continue;
    }
    totalCentavos += remito.importeCentavos;
    subtotales.set(remito.marca, (subtotales.get(remito.marca) || 0) + remito.importeCentavos);
  }

  return {
    totalCentavos,
    subtotalesPorMarca: [...subtotales].map(([marca, importeCentavos]) => ({ marca, importeCentavos })),
    remitosExcluidos,
    sinCobroEnDestino: totalCentavos === 0,
  };
}
