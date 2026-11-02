-- Épica 2.3 · Circuito digital de rendición y control de efectivo (HU #46 a #50).
-- Idempotente: se puede correr varias veces (db:migrate aplica todas las migraciones en cada corrida
-- y el servidor la aplica al iniciar).
--
-- Ciclo de vida de una rendición:
--   pendiente       el transportista declaró el efectivo desde la app (HU #46)
--   anulada         el transportista la retractó antes de llegar a la caja (HU #47 E2)
--   con_diferencia  el supervisor contó y registró un faltante o sobrante con justificación (HU #49)
--   validada        el supervisor la aprobó, coincidente (HU #48) o con diferencia (HU #50); cierra la hoja
BEGIN;

ALTER TABLE rendicion_efectivo
  ADD COLUMN IF NOT EXISTS transportista_id bigint REFERENCES usuario(id),
  ADD COLUMN IF NOT EXISTS declarado_en timestamptz,
  ADD COLUMN IF NOT EXISTS clave_idempotencia uuid,
  ADD COLUMN IF NOT EXISTS anulada_en timestamptz,
  ADD COLUMN IF NOT EXISTS conteo_billetes jsonb,
  ADD COLUMN IF NOT EXISTS diferencia_registrada_por bigint REFERENCES usuario(id),
  ADD COLUMN IF NOT EXISTS diferencia_registrada_en timestamptz,
  ADD COLUMN IF NOT EXISTS creado_en timestamptz NOT NULL DEFAULT now();

-- Una hoja puede tener una declaración anulada y otra nueva: solo una activa por hoja.
ALTER TABLE rendicion_efectivo DROP CONSTRAINT IF EXISTS rendicion_unica_por_hoja;
CREATE UNIQUE INDEX IF NOT EXISTS rendicion_activa_por_hoja
  ON rendicion_efectivo (hoja_de_ruta_id) WHERE estado <> 'anulada';
-- Idempotencia de la sincronización offline: un reenvío desde el celular no duplica la declaración.
CREATE UNIQUE INDEX IF NOT EXISTS rendicion_clave_unica
  ON rendicion_efectivo (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS rendicion_estado_idx ON rendicion_efectivo (estado, declarado_en DESC);

ALTER TABLE rendicion_efectivo DROP CONSTRAINT IF EXISTS rendicion_estado_valido;
ALTER TABLE rendicion_efectivo ADD CONSTRAINT rendicion_estado_valido
  CHECK (estado IN ('pendiente','con_diferencia','validada','rechazada','anulada'));

ALTER TABLE rendicion_efectivo DROP CONSTRAINT IF EXISTS rendicion_importes_no_negativos;
ALTER TABLE rendicion_efectivo ADD CONSTRAINT rendicion_importes_no_negativos
  CHECK (declarado_centavos >= 0 AND (rendido_centavos IS NULL OR rendido_centavos >= 0));

-- No se puede registrar ni cerrar una rendición con diferencia sin explicar por qué (HU #49 y #50).
ALTER TABLE rendicion_efectivo DROP CONSTRAINT IF EXISTS rendicion_motivo_si_hay_diferencia;
ALTER TABLE rendicion_efectivo ADD CONSTRAINT rendicion_motivo_si_hay_diferencia
  CHECK (
    estado NOT IN ('validada','con_diferencia')
    OR rendido_centavos = declarado_centavos
    OR motivo_diferencia IS NOT NULL
  );

ALTER TABLE rendicion_efectivo DROP CONSTRAINT IF EXISTS rendicion_validacion_coherente;
ALTER TABLE rendicion_efectivo ADD CONSTRAINT rendicion_validacion_coherente
  CHECK (estado NOT IN ('validada','rechazada') OR (validado_por IS NOT NULL AND validado_en IS NOT NULL));

COMMIT;
