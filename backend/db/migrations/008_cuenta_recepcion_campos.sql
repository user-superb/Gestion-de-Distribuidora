-- Migración 008: soporte de nombre de fantasía, CUIT titular y moneda en cuenta_recepcion
ALTER TABLE cuenta_recepcion
    ADD COLUMN IF NOT EXISTS nombre_fantasia text,
    ADD COLUMN IF NOT EXISTS cuit_titular char(11),
    ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS',
    ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cuenta_cuit_titular_formato'
    ) THEN
        ALTER TABLE cuenta_recepcion
            ADD CONSTRAINT cuenta_cuit_titular_formato
            CHECK (cuit_titular IS NULL OR cuit_titular ~ '^[0-9]{11}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cuenta_moneda_valida'
    ) THEN
        ALTER TABLE cuenta_recepcion
            ADD CONSTRAINT cuenta_moneda_valida
            CHECK (moneda IN ('ARS', 'USD'));
    END IF;
END $$;
