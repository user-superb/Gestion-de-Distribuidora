-- =====================================================================
-- Migración 006: Tabla de tokens de recuperación de contraseña
-- =====================================================================

CREATE TABLE IF NOT EXISTS token_recuperacion_contrasena (
    id serial PRIMARY KEY,
    usuario_id bigint NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expira_en timestamptz NOT NULL,
    usado boolean NOT NULL DEFAULT false,
    usado_en timestamptz,
    creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_recuperacion_hash ON token_recuperacion_contrasena (token_hash);
CREATE INDEX IF NOT EXISTS idx_token_recuperacion_usuario ON token_recuperacion_contrasena (usuario_id);

-- Actualización del correo electrónico del usuario administrativo de prueba
UPDATE usuario 
SET email = 'almeidachristian94@hotmail.com', actualizado_en = now()
WHERE usuario = 'admin';
