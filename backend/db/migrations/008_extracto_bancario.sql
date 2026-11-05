-- Migración 008: Importación de extracto bancario en archivo digital y soporte completo de cuentas de recepción
BEGIN;

ALTER TABLE cuenta_recepcion
  ADD COLUMN IF NOT EXISTS nombre_fantasia text,
  ADD COLUMN IF NOT EXISTS cuit_titular char(11),
  ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();

ALTER TABLE movimiento_bancario
  ADD COLUMN IF NOT EXISTS concepto text;

COMMIT;
