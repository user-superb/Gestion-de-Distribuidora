BEGIN;

ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_rol_check;
ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check
  CHECK (rol IN ('Administrador del sistema', 'Administrativo', 'Transportista', 'Supervisor', 'Gerente'));
CREATE UNIQUE INDEX IF NOT EXISTS usuario_nombre_login_unico ON usuario (lower(usuario));
CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_login_unico ON usuario (lower(email)) WHERE email IS NOT NULL;

UPDATE usuario
SET rol = 'Administrativo', actualizado_en = now()
WHERE usuario = 'admin' AND email = 'admin@tutucas.com.ar';

INSERT INTO usuario (usuario, nombre, email, password_hash, rol, es_transportista, activo)
VALUES (
  'admin_sistema', 'Administrador del Sistema', 'admin.sistema@tutucas.com.ar',
  '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO',
  'Administrador del sistema', false, true
)
ON CONFLICT (usuario) DO NOTHING;

INSERT INTO usuario_sucursal (usuario_id, sucursal_id)
SELECT u.id, s.id
FROM usuario u CROSS JOIN sucursal s
WHERE u.usuario = 'admin_sistema' AND s.nombre = 'Sucursal Central - La Plata'
ON CONFLICT (usuario_id, sucursal_id) DO NOTHING;

COMMIT;
