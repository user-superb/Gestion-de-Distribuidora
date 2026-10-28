-- =====================================================================
-- Migración 007: Justificación y tipificación de diferencias en conciliación
-- =====================================================================

-- 1. Agregar columnas a discrepancia_conciliacion para tipificación y comprobante
ALTER TABLE discrepancia_conciliacion
  ADD COLUMN IF NOT EXISTS motivo_tipificado text,
  ADD COLUMN IF NOT EXISTS comprobante_nombre text,
  ADD COLUMN IF NOT EXISTS dentro_de_tolerancia boolean NOT NULL DEFAULT false;

-- 2. Tabla para registrar los desgloses contables de ajustes dentro de tolerancia
CREATE TABLE IF NOT EXISTS ajuste_conciliacion (
    id serial PRIMARY KEY,
    movimiento_bancario_id bigint REFERENCES movimiento_bancario(id),
    remito_id bigint NOT NULL REFERENCES remito(id) ON DELETE CASCADE,
    motivo_tipificado text NOT NULL,
    comprobante_nombre text NOT NULL,
    importe_centavos bigint NOT NULL,
    creado_por bigint NOT NULL REFERENCES usuario(id),
    creado_en timestamptz NOT NULL DEFAULT now()
);

-- 3. Campos adicionales en imputacion para registrar ajustes contables vinculados al saldo del remito
ALTER TABLE imputacion
  ADD COLUMN IF NOT EXISTS es_ajuste boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_ajuste text,
  ADD COLUMN IF NOT EXISTS comprobante_nombre text;

CREATE INDEX IF NOT EXISTS idx_ajuste_conciliacion_remito ON ajuste_conciliacion (remito_id);
CREATE INDEX IF NOT EXISTS idx_ajuste_conciliacion_movimiento ON ajuste_conciliacion (movimiento_bancario_id);
