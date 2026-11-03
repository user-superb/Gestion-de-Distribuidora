-- Migración 008: HU #51 - Alta de sucursales con código unívoco
BEGIN;

ALTER TABLE sucursal ADD COLUMN IF NOT EXISTS codigo text;

-- Asignar códigos a sucursales existentes que no posean uno
UPDATE sucursal
SET codigo = 'SUC-' || lpad(id::text, 3, '0')
WHERE codigo IS NULL;

-- Regla a considerar (HU #51): El código de la sucursal es la clave unívoca y no puede repetirse
CREATE UNIQUE INDEX IF NOT EXISTS sucursal_codigo_unico ON sucursal (lower(codigo));

COMMIT;
