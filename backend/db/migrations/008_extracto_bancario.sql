-- Migración 008: Importación de extracto bancario en archivo digital y soporte completo de cuentas de recepción
BEGIN;

ALTER TABLE cuenta_recepcion
  ADD COLUMN IF NOT EXISTS nombre_fantasia text,
  ADD COLUMN IF NOT EXISTS cuit_titular char(11),
  ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();

ALTER TABLE movimiento_bancario
  ADD COLUMN IF NOT EXISTS concepto text;

-- HU #19: Permitir anexar nuevas paradas (visitas) al final de la secuencia de una hoja de ruta para un mismo comercio
DROP INDEX IF EXISTS visita_comercio_unico_idx;

-- HU #19: Latido de conexión en vivo de la app móvil del transportista (por defecto desconectado hasta que la app móvil reporte latido)
ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS ultimo_latido_movil timestamptz,
  ALTER COLUMN dispositivo_conectado SET DEFAULT false;

UPDATE usuario
SET dispositivo_conectado = false
WHERE ultimo_latido_movil IS NULL;

COMMIT;
