-- Migración 005: Cobro Móvil y Soporte de Entregas para Transportistas (Épica 1.4)
BEGIN;

-- HU #28: la transferencia exige la referencia del comprobante bancario.
ALTER TABLE cobro ADD COLUMN IF NOT EXISTS referencia_transferencia text;

-- Momento en que se registró el cobro de la visita.
ALTER TABLE visita ADD COLUMN IF NOT EXISTS cobrada_en timestamptz;

-- Columnas de geolocalización y auditoría de entrega en remito
ALTER TABLE remito ADD COLUMN IF NOT EXISTS entregado_por bigint REFERENCES usuario(id);
ALTER TABLE remito ADD COLUMN IF NOT EXISTS latitud numeric(9,6);
ALTER TABLE remito ADD COLUMN IF NOT EXISTS longitud numeric(9,6);
ALTER TABLE remito ADD COLUMN IF NOT EXISTS motivo_no_entrega text;

ALTER TABLE cobro DROP CONSTRAINT IF EXISTS cobro_referencia_si_transferencia;
ALTER TABLE cobro ADD CONSTRAINT cobro_referencia_si_transferencia CHECK (
    medio_pago <> 'transferencia'
    OR (referencia_transferencia IS NOT NULL AND length(trim(referencia_transferencia)) > 0)
);

-- Búsqueda de referencias de transferencias
CREATE INDEX IF NOT EXISTS cobro_referencia_idx
    ON cobro (referencia_transferencia)
    WHERE referencia_transferencia IS NOT NULL;

COMMIT;
