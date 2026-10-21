-- Migración 003: Sincronización de esquema (Sesiones, Conciliación N-N, Hoja de Ruta HU #15)
BEGIN;

-- 1. Tabla de sesiones de usuario (Login/Logout e Inactividad)
CREATE TABLE IF NOT EXISTS sesion_usuario (
    id              text PRIMARY KEY,
    usuario_id      bigint NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    token           text NOT NULL UNIQUE,
    ip_address      text,
    user_agent      text,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    ultimo_acceso   timestamptz NOT NULL DEFAULT now(),
    expira_en       timestamptz NOT NULL,
    revocado        boolean NOT NULL DEFAULT false,
    revocado_en     timestamptz,
    motivo_cierre   text -- 'manual' | 'inactividad' | 'expirado'
);

-- 2. Actualización de tabla remito (columna entregado_en, estados y trigger)
ALTER TABLE remito ADD COLUMN IF NOT EXISTS entregado_en timestamptz;
ALTER TABLE remito DROP CONSTRAINT IF EXISTS remito_estado_valido;
ALTER TABLE remito ADD CONSTRAINT remito_estado_valido
    CHECK (estado IN ('pendiente','en_ruta','entregado','no_entregado','anulado','devuelto'));

CREATE OR REPLACE FUNCTION registrar_entrega_remito() RETURNS trigger AS $$
BEGIN
    IF NEW.estado = 'entregado' THEN
        NEW.entregado_en := COALESCE(NEW.entregado_en, OLD.entregado_en, now());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS remito_entrega_fecha ON remito;
CREATE TRIGGER remito_entrega_fecha
    BEFORE INSERT OR UPDATE ON remito
    FOR EACH ROW EXECUTE FUNCTION registrar_entrega_remito();

UPDATE remito r
SET entregado_en = COALESCE((SELECT v.registrada_en FROM visita v WHERE v.id = r.visita_id), r.actualizado_en, now())
WHERE r.estado = 'entregado' AND r.entregado_en IS NULL;

-- 3. Tabla discrepancia_conciliacion (Conciliación bancaria N-N)
CREATE TABLE IF NOT EXISTS discrepancia_conciliacion (
    id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    movimiento_id        bigint      NOT NULL REFERENCES movimiento_bancario(id),
    movimiento_ids       bigint[]    NOT NULL DEFAULT '{}',
    remito_ids           bigint[]    NOT NULL,
    importe_movimiento   bigint      NOT NULL,
    importe_seleccionado bigint      NOT NULL,
    diferencia_centavos  bigint      NOT NULL,
    nota                 text        NOT NULL,
    estado               text        NOT NULL DEFAULT 'pendiente',
    creada_por           bigint      NOT NULL REFERENCES usuario(id),
    creada_en            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT discrepancia_montos CHECK (diferencia_centavos <> 0),
    CONSTRAINT discrepancia_nota_no_vacia CHECK (length(trim(nota)) > 0),
    CONSTRAINT discrepancia_estado_valido CHECK (estado IN ('pendiente','resuelta'))
);

ALTER TABLE discrepancia_conciliacion
    ADD COLUMN IF NOT EXISTS movimiento_ids bigint[] NOT NULL DEFAULT '{}';

UPDATE discrepancia_conciliacion
SET movimiento_ids = ARRAY[movimiento_id]
WHERE cardinality(movimiento_ids) = 0;

CREATE UNIQUE INDEX IF NOT EXISTS discrepancia_pendiente_unica_por_movimiento
    ON discrepancia_conciliacion (movimiento_id) WHERE estado = 'pendiente';

-- 4. HU #15: Estado 'pendiente_de_despacho' en hoja_de_ruta y soporte para múltiples hojas de ruta
ALTER TABLE hoja_de_ruta ALTER COLUMN transportista_id DROP NOT NULL;
ALTER TABLE hoja_de_ruta DROP CONSTRAINT IF EXISTS hoja_unica_por_transportista_y_fecha;
ALTER TABLE hoja_de_ruta DROP CONSTRAINT IF EXISTS hoja_estado_valido;
ALTER TABLE hoja_de_ruta ADD CONSTRAINT hoja_estado_valido
    CHECK (estado IN ('borrador','pendiente_de_despacho','publicada','en_curso','cerrada','anulada'));

COMMIT;
