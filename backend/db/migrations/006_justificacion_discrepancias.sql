BEGIN;

ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS limite_autorizacion_centavos bigint NOT NULL DEFAULT 0;
ALTER TABLE usuario
  DROP CONSTRAINT IF EXISTS usuario_limite_autorizacion_no_negativo;
ALTER TABLE usuario
  ADD CONSTRAINT usuario_limite_autorizacion_no_negativo CHECK (limite_autorizacion_centavos >= 0);

ALTER TABLE discrepancia_conciliacion
  ADD COLUMN IF NOT EXISTS motivo_codigo text,
  ADD COLUMN IF NOT EXISTS resuelta_por bigint REFERENCES usuario(id),
  ADD COLUMN IF NOT EXISTS resuelta_en timestamptz,
  ADD COLUMN IF NOT EXISTS observacion_resolucion text;
ALTER TABLE discrepancia_conciliacion DROP CONSTRAINT IF EXISTS discrepancia_estado_valido;
ALTER TABLE discrepancia_conciliacion
  ADD CONSTRAINT discrepancia_estado_valido CHECK (estado IN ('pendiente','escalada','aprobada','rechazada','resuelta'));
CREATE INDEX IF NOT EXISTS discrepancia_revision_idx
  ON discrepancia_conciliacion (estado, creada_en DESC);

CREATE TABLE IF NOT EXISTS discrepancia_comprobante (
  discrepancia_id bigint PRIMARY KEY REFERENCES discrepancia_conciliacion(id) ON DELETE CASCADE,
  nombre_archivo text NOT NULL,
  tipo_mime text NOT NULL CHECK (tipo_mime IN ('application/pdf','image/jpeg','image/png')),
  contenido bytea NOT NULL,
  tamano_bytes bigint NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 5242880),
  subido_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discrepancia_ajuste (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  discrepancia_id bigint NOT NULL REFERENCES discrepancia_conciliacion(id),
  remito_id bigint REFERENCES remito(id),
  comercio_id bigint REFERENCES comercio(id),
  tipo text NOT NULL CHECK (tipo IN ('reduccion_saldo','saldo_favor')),
  importe_centavos bigint NOT NULL CHECK (importe_centavos > 0),
  CONSTRAINT discrepancia_ajuste_destino CHECK (
    (tipo = 'reduccion_saldo' AND remito_id IS NOT NULL AND comercio_id IS NULL) OR
    (tipo = 'saldo_favor' AND remito_id IS NULL AND comercio_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS discrepancia_notificacion (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  discrepancia_id bigint NOT NULL REFERENCES discrepancia_conciliacion(id) ON DELETE CASCADE,
  usuario_id bigint NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  mensaje text NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now(),
  leida_en timestamptz
);

CREATE OR REPLACE VIEW remito_saldo AS
WITH pagos AS (
  SELECT remito_id, SUM(importe_centavos) AS importe_centavos
  FROM imputacion GROUP BY remito_id
), ajustes AS (
  SELECT remito_id, SUM(importe_centavos) AS importe_centavos
  FROM discrepancia_ajuste WHERE tipo = 'reduccion_saldo' GROUP BY remito_id
)
SELECT r.id AS remito_id,
       r.comercio_id,
       r.marca_id,
       r.importe_centavos,
       COALESCE(p.importe_centavos, 0) AS imputado_centavos,
       r.importe_centavos - COALESCE(p.importe_centavos, 0) - COALESCE(a.importe_centavos, 0) AS saldo_centavos,
       CASE
         WHEN r.importe_centavos = COALESCE(p.importe_centavos, 0) + COALESCE(a.importe_centavos, 0) THEN 'saldado'
         WHEN COALESCE(p.importe_centavos, 0) + COALESCE(a.importe_centavos, 0) > 0 THEN 'parcial'
         ELSE 'pendiente'
       END AS estado_cobro,
       COALESCE(a.importe_centavos, 0) AS ajustado_centavos
FROM remito r
LEFT JOIN pagos p ON p.remito_id = r.id
LEFT JOIN ajustes a ON a.remito_id = r.id;

COMMIT;
