// Importes en centavos (enteros), igual que en la base. Formato de pesos argentinos.

const formato = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 5750050 → "$ 57.500,50" */
export function formatearPesos(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  return `${signo}$ ${formato.format(Math.abs(centavos) / 100)}`;
}

/** 5750050 → "57500,50", para precargar un campo editable. */
export function centavosATexto(centavos: number): string {
  const pesos = Math.trunc(centavos / 100);
  const resto = String(Math.abs(centavos % 100)).padStart(2, '0');
  return `${pesos},${resto}`;
}

/**
 * Lo que tipea el transportista → centavos. Acepta "57500", "57500,5", "57.500,50".
 * La coma es el separador decimal; los puntos se toman como separador de miles.
 * Devuelve null si el texto no es un importe válido.
 */
export function parsearPesos(texto: string): number | null {
  const limpio = texto.trim().replace(/^\$\s*/, '').replace(/\./g, '');
  if (!/^\d+(,\d{1,2})?$/.test(limpio)) return null;
  const [enteros, decimales = ''] = limpio.split(',');
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}
