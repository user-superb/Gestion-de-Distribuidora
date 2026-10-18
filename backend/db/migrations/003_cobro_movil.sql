-- HU #28: la transferencia exige la referencia del comprobante bancario.
BEGIN;

ALTER TABLE cobro ADD COLUMN IF NOT EXISTS referencia_transferencia text;

ALTER TABLE cobro DROP CONSTRAINT IF EXISTS cobro_referencia_si_transferencia;
ALTER TABLE cobro ADD CONSTRAINT cobro_referencia_si_transferencia CHECK (
    medio_pago <> 'transferencia'
    OR (referencia_transferencia IS NOT NULL AND length(trim(referencia_transferencia)) > 0)
);

-- Búsqueda de referencias repetidas por comercio y día (HU #28 ESCENARIO 2).
-- La API guarda la referencia normalizada: sin espacios y en mayúsculas.
CREATE INDEX IF NOT EXISTS cobro_referencia_idx
    ON cobro (referencia_transferencia)
    WHERE referencia_transferencia IS NOT NULL;

COMMIT;
