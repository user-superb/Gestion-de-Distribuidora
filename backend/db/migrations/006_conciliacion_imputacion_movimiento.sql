-- Migración 006: Habilitar conciliación bancaria N a N en tabla imputacion
BEGIN;

-- 1. Agregar columna movimiento_bancario_id si no existe
ALTER TABLE imputacion
    ADD COLUMN IF NOT EXISTS movimiento_bancario_id bigint REFERENCES movimiento_bancario(id);

-- 2. Permitir que cobro_id sea nullable (origen puede ser cobro_id O movimiento_bancario_id)
ALTER TABLE imputacion
    ALTER COLUMN cobro_id DROP NOT NULL;

-- 3. Campos para auditoría/anulación si no existen
ALTER TABLE imputacion
    ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS anulado_por bigint REFERENCES usuario(id),
    ADD COLUMN IF NOT EXISTS anulado_en timestamptz,
    ADD COLUMN IF NOT EXISTS motivo_anulacion text;

-- 4. Actualizar constraints para origen único (cobro O movimiento bancario)
ALTER TABLE imputacion
    DROP CONSTRAINT IF EXISTS imputacion_par_unico;

ALTER TABLE imputacion
    DROP CONSTRAINT IF EXISTS imputacion_origen_unico;

ALTER TABLE imputacion
    ADD CONSTRAINT imputacion_origen_unico
    CHECK ((cobro_id IS NULL) <> (movimiento_bancario_id IS NULL));

-- 5. Índices únicos condicionales
CREATE UNIQUE INDEX IF NOT EXISTS imputacion_cobro_remito_unica
    ON imputacion (cobro_id, remito_id) WHERE cobro_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS imputacion_movimiento_remito_unica
    ON imputacion (movimiento_bancario_id, remito_id) WHERE movimiento_bancario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS imputacion_remito_idx
    ON imputacion (remito_id);

CREATE INDEX IF NOT EXISTS imputacion_movimiento_idx
    ON imputacion (movimiento_bancario_id);

COMMIT;
