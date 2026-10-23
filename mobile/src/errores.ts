/** El servidor respondió con un error (4xx/5xx). */
export class ErrorApi extends Error {
  constructor(
    message: string,
    public status: number,
    public detalles: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ErrorApi';
  }
}

/** No se pudo llegar al servidor: sin señal, servidor caído o timeout. */
export class ErrorRed extends Error {
  constructor(message = 'Sin conexión con el servidor.') {
    super(message);
    this.name = 'ErrorRed';
  }
}

