-- Migración 009: Carga manual de movimientos bancarios (Transferencia con comprobante y Cobro QR)
BEGIN;

ALTER TABLE movimiento_bancario
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'Extracto Bancario';

CREATE TABLE IF NOT EXISTS movimiento_bancario_comprobante (
  movimiento_id bigint PRIMARY KEY REFERENCES movimiento_bancario(id) ON DELETE CASCADE,
  nombre_archivo text NOT NULL,
  tipo_mime text NOT NULL CHECK (tipo_mime IN ('application/pdf','image/jpeg','image/png')),
  contenido bytea NOT NULL,
  tamano_bytes bigint NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 5242880),
  subido_en timestamptz NOT NULL DEFAULT now()
);

COMMIT;
