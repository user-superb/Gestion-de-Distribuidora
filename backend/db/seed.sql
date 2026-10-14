-- =====================================================================
--  Datos de Prueba Iniciales (Seed) · PostgreSQL
-- =====================================================================

BEGIN;

-- 1. Sucursal
INSERT INTO sucursal (nombre, domicilio, activa) VALUES
  ('Sucursal Central - La Plata', 'Calle 12 N° 500, La Plata', true)
ON CONFLICT (nombre) DO NOTHING;

-- 2. Usuarios
INSERT INTO usuario (usuario, nombre, email, password_hash, es_transportista, activo) VALUES
  ('admin', 'Martín Jirafales Coordinador', 'admin@tutucas.com.ar', '$2b$10$e8w67wK4jE52m1R0W3m2xeU6hH6Zt6lX6.Yy1tVn2z5c4m9l4d4dO', false, true),
  ('chofer', 'Carlos Repartidor', 'chofer@tutucas.com.ar', '$2b$10$e8w67wK4jE52m1R0W3m2xeU6hH6Zt6lX6.Yy1tVn2z5c4m9l4d4dO', true, true)
ON CONFLICT (usuario) DO NOTHING;

-- 3. Marcas
INSERT INTO marca (nombre, activa) VALUES
  ('Lácteos del Sur', true),
  ('Bebidas Nacionales', true),
  ('Alimentos Río de la Plata', true)
ON CONFLICT (nombre) DO NOTHING;

-- 4. Comercios
INSERT INTO comercio (razon_social, domicilio, localidad, activo) VALUES
  ('Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús', 'Lanús', true),
  ('Autoservicio Luna', 'Belgrano 1230, Avellaneda', 'Avellaneda', true),
  ('Distribuidora Los Andes', 'Camino Gral. Belgrano 1800, Gerli', 'Gerli', true);

-- 5. Remitos de Prueba (Importes en centavos)
-- Nota: Asociamos a sucursal 1 y a los IDs de marca y comercio generados
INSERT INTO remito (marca_id, comercio_id, sucursal_id, numero, importe_centavos, estado)
SELECT m.id, c.id, s.id, r.numero, r.importe_centavos, 'pendiente'
FROM (VALUES
  ('Lácteos del Sur', 'Mayorista El Sol S.R.L.', 'R-0001-45120', 15000000::bigint),
  ('Bebidas Nacionales', 'Mayorista El Sol S.R.L.', 'R-0002-89310', 700000::bigint),
  ('Lácteos del Sur', 'Autoservicio Luna', 'R-0001-45121', 6200000::bigint),
  ('Alimentos Río de la Plata', 'Autoservicio Luna', 'R-0003-11200', 11000000::bigint),
  ('Bebidas Nacionales', 'Distribuidora Los Andes', 'R-0002-89315', 9400000::bigint)
) AS r(marca_nombre, comercio_nombre, numero, importe_centavos)
JOIN marca m ON m.nombre = r.marca_nombre
JOIN comercio c ON c.razon_social = r.comercio_nombre
JOIN sucursal s ON s.nombre = 'Sucursal Central - La Plata'
ON CONFLICT (marca_id, numero) DO NOTHING;

COMMIT;
