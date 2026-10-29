-- =====================================================================
--  Datos de Prueba Iniciales (Seed) · PostgreSQL
-- =====================================================================

BEGIN;

-- 1. Sucursales
INSERT INTO sucursal (nombre, domicilio, activa) VALUES
  ('Sucursal Central - La Plata', 'Calle 12 N° 500, La Plata', true),
  ('Depósito Sur - Berisso', 'Av. Río de la Plata 1240, Berisso', true),
  ('Hub Central - Distribución', 'Ruta 2 Km 45, La Plata', true),
  ('Sede Administrativa Central', 'Calle 7 N° 850, La Plata', true)
ON CONFLICT (nombre) DO NOTHING;

-- 2. Usuarios con roles para cada perfil operativo (Clave: Password123!)
INSERT INTO usuario (usuario, nombre, email, password_hash, rol, es_transportista, activo) VALUES
  ('admin', 'Martín Jirafales Coordinador', 'almeidachristian94@hotmail.com', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Administrativo', false, true),
  ('admin_sistema', 'Administrador del Sistema', 'admin.sistema@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Administrador del sistema', false, true),
  ('chofer', 'Carlos Repartidor', 'chofer@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Transportista', true, true),
  ('chofer2', 'Mario Flete', 'chofer2@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Transportista', true, true),
  ('supervisor', 'Valeria Logística', 'supervisor@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Supervisor', false, true),
  ('gerencia', 'Roberto Gerente', 'gerencia@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Gerente', false, true)
ON CONFLICT (usuario) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  rol = EXCLUDED.rol,
  es_transportista = EXCLUDED.es_transportista,
  activo = EXCLUDED.activo,
  actualizado_en = now();

-- Corrige la cuenta demo existente si se ejecutó una migración anterior que la elevaba.
UPDATE usuario
SET rol = 'Administrativo', actualizado_en = now()
WHERE usuario = 'admin' AND email = 'almeidachristian94@hotmail.com';

-- 2.1 Asignación Usuario - Sucursal
INSERT INTO usuario_sucursal (usuario_id, sucursal_id)
SELECT u.id, s.id
FROM (VALUES
  ('admin', 'Sucursal Central - La Plata'),
  ('admin_sistema', 'Sucursal Central - La Plata'),
  ('chofer', 'Sucursal Central - La Plata'),
  ('supervisor', 'Hub Central - Distribución'),
  ('gerencia', 'Sede Administrativa Central')
) AS us(usuario_nom, sucursal_nom)
JOIN usuario u ON u.usuario = us.usuario_nom
JOIN sucursal s ON s.nombre = us.sucursal_nom
ON CONFLICT (usuario_id, sucursal_id) DO NOTHING;

-- El transportista demo opera desde la misma sucursal que su hoja.
DELETE FROM usuario_sucursal
WHERE usuario_id = (SELECT id FROM usuario WHERE usuario = 'chofer')
  AND sucursal_id <> (SELECT id FROM sucursal WHERE nombre = 'Sucursal Central - La Plata');

-- 3. Marcas
INSERT INTO marca (nombre, activa) VALUES
  ('Lácteos del Sur', true),
  ('Bebidas Nacionales', true),
  ('Alimentos Río de la Plata', true)
ON CONFLICT (nombre) DO NOTHING;

-- 4. Comercios
INSERT INTO comercio (razon_social, domicilio, localidad, activo)
SELECT v.razon_social, v.domicilio, v.localidad, v.activo
FROM (VALUES
  ('Mayorista El Sol S.R.L.', 'Av. Hipólito Yrigoyen 4500, Lanús', 'Lanús', true),
  ('Autoservicio Luna', 'Belgrano 1230, Avellaneda', 'Avellaneda', true),
  ('Distribuidora Los Andes', 'Camino Gral. Belgrano 1800, Gerli', 'Gerli', true)
) AS v(razon_social, domicilio, localidad, activo)
WHERE NOT EXISTS (
  SELECT 1 FROM comercio c WHERE c.razon_social = v.razon_social
);

-- 5. Hoja de ruta demo publicada para el día operativo argentino.
WITH demo_dia AS (
  SELECT timezone('America/Argentina/Buenos_Aires', now())::date AS fecha
)
INSERT INTO hoja_de_ruta (sucursal_id, transportista_id, fecha_reparto, patente, estado, publicada_en)
SELECT s.id, u.id, d.fecha, 'AB123CD', 'publicada', now()
FROM sucursal s
JOIN usuario u ON u.usuario = 'chofer'
CROSS JOIN demo_dia d
WHERE s.nombre = 'Sucursal Central - La Plata'
  AND NOT EXISTS (
    SELECT 1 FROM hoja_de_ruta h
    WHERE h.transportista_id = u.id AND h.fecha_reparto = d.fecha
  );

-- Si ya existía la hoja borrador creada por una seed anterior, publicarla.
WITH demo_dia AS (
  SELECT timezone('America/Argentina/Buenos_Aires', now())::date AS fecha
)
UPDATE hoja_de_ruta h
SET patente = COALESCE(h.patente, 'AB123CD'),
    estado = CASE WHEN h.estado = 'borrador' THEN 'publicada' ELSE h.estado END,
    publicada_en = COALESCE(h.publicada_en, now())
FROM usuario u, demo_dia d
WHERE u.usuario = 'chofer'
  AND h.transportista_id = u.id
  AND h.fecha_reparto = d.fecha
  AND h.id = (
    SELECT h2.id FROM hoja_de_ruta h2
    WHERE h2.transportista_id = u.id AND h2.fecha_reparto = d.fecha
    ORDER BY h2.id DESC LIMIT 1
  );

-- Tres paradas de demo, únicas por orden y comercio para la hoja.
WITH demo_dia AS (
  SELECT timezone('America/Argentina/Buenos_Aires', now())::date AS fecha
)
INSERT INTO visita (hoja_de_ruta_id, comercio_id, orden)
SELECT h.id, c.id, d.orden
FROM (VALUES
  ('Mayorista El Sol S.R.L.', 1),
  ('Autoservicio Luna', 2),
  ('Distribuidora Los Andes', 3)
) AS d(razon_social, orden)
JOIN comercio c ON c.razon_social = d.razon_social
JOIN usuario u ON u.usuario = 'chofer'
JOIN hoja_de_ruta h ON h.id = (
  SELECT h2.id FROM hoja_de_ruta h2
  WHERE h2.transportista_id = u.id
    AND h2.fecha_reparto = (SELECT fecha FROM demo_dia)
  ORDER BY h2.id DESC LIMIT 1
)
ON CONFLICT DO NOTHING;

-- 6. Remitos de Prueba (Importes en centavos)
-- Nota: Asociamos a sucursal 1 y a los IDs de marca y comercio generados
INSERT INTO remito (marca_id, comercio_id, sucursal_id, numero, importe_centavos, estado)
SELECT m.id, c.id, s.id, r.numero, r.importe_centavos, 'pendiente'
FROM (VALUES
  ('Lácteos del Sur', 'Mayorista El Sol S.R.L.', 'R-0001-45120', 15000000::bigint),
  ('Bebidas Nacionales', 'Mayorista El Sol S.R.L.', 'R-0002-89310', 700000::bigint),
  ('Lácteos del Sur', 'Mayorista El Sol S.R.L.', 'R-0001-45122', 10000000::bigint),
  ('Bebidas Nacionales', 'Mayorista El Sol S.R.L.', 'R-0002-89311', 5700000::bigint),
  ('Lácteos del Sur', 'Autoservicio Luna', 'R-0001-45121', 6200000::bigint),
  ('Alimentos Río de la Plata', 'Autoservicio Luna', 'R-0003-11200', 11000000::bigint),
  ('Bebidas Nacionales', 'Distribuidora Los Andes', 'R-0002-89315', 9400000::bigint),
  ('Lácteos del Sur', 'Mayorista El Sol S.R.L.', 'R-HU38-EXACTA', 15000000::bigint),
  ('Lácteos del Sur', 'Autoservicio Luna', 'R-HU38-PARCIAL', 15000000::bigint),
  ('Lácteos del Sur', 'Mayorista El Sol S.R.L.', 'R-0004-90001', 12500000::bigint),
  ('Bebidas Nacionales', 'Mayorista El Sol S.R.L.', 'R-0004-90002', 8400000::bigint),
  ('Lácteos del Sur', 'Autoservicio Luna', 'R-0004-90003', 4500000::bigint),
  ('Alimentos Río de la Plata', 'Distribuidora Los Andes', 'R-0004-90004', 16000000::bigint),
  ('Bebidas Nacionales', 'Distribuidora Los Andes', 'R-0004-90005', 9200000::bigint)
) AS r(marca_nombre, comercio_nombre, numero, importe_centavos)
JOIN marca m ON m.nombre = r.marca_nombre
JOIN comercio c ON c.razon_social = r.comercio_nombre
JOIN sucursal s ON s.nombre = 'Sucursal Central - La Plata'
ON CONFLICT (marca_id, numero) DO NOTHING;

-- Remitos asignados a las paradas para probar entregas y cobros desde el móvil.
WITH demo_dia AS (
  SELECT timezone('America/Argentina/Buenos_Aires', now())::date AS fecha
)
INSERT INTO remito (marca_id, comercio_id, sucursal_id, numero, importe_centavos, estado, visita_id)
SELECT m.id, c.id, h.sucursal_id,
       'M' || to_char(d.fecha, 'YYMMDD') || '-' || r.sufijo,
       r.importe_centavos, r.estado, v.id
FROM (VALUES
  (1, 'Lácteos del Sur',           '01', 4500000::bigint, 'en_ruta'),
  (1, 'Bebidas Nacionales',        '02', 1250050::bigint, 'en_ruta'),
  (2, 'Alimentos Río de la Plata', '03', 3000000::bigint, 'en_ruta'),
  (2, 'Lácteos del Sur',           '04',  800000::bigint, 'devuelto'),
  (3, 'Bebidas Nacionales',        '05', 2199999::bigint, 'en_ruta')
) AS r(orden, marca, sufijo, importe_centavos, estado)
CROSS JOIN demo_dia d
JOIN marca m ON m.nombre = r.marca
JOIN usuario u ON u.usuario = 'chofer'
JOIN hoja_de_ruta h ON h.id = (
  SELECT h2.id FROM hoja_de_ruta h2
  WHERE h2.transportista_id = u.id AND h2.fecha_reparto = d.fecha
  ORDER BY h2.id DESC LIMIT 1
)
JOIN visita v ON v.hoja_de_ruta_id = h.id AND v.orden = r.orden
JOIN comercio c ON c.id = v.comercio_id AND c.razon_social =
  CASE r.orden WHEN 1 THEN 'Mayorista El Sol S.R.L.' WHEN 2 THEN 'Autoservicio Luna' ELSE 'Distribuidora Los Andes' END
ON CONFLICT (marca_id, numero) DO UPDATE SET visita_id = EXCLUDED.visita_id;

-- Remitos entregados de ejemplo para la bandeja de cobranza y conciliación exacta.
UPDATE remito SET estado = 'entregado', entregado_en = now() - interval '12 days'
WHERE numero IN ('R-0001-45120', 'R-0002-89310', 'R-0001-45122', 'R-0002-89311', 'R-HU38-EXACTA', 'R-HU38-PARCIAL');

-- 7. Movimientos bancarios de ejemplo para probar E5-04
INSERT INTO cuenta_recepcion (sucursal_id, alias, banco)
SELECT id, 'Cuenta operativa demo', 'Banco Demo'
FROM sucursal
WHERE nombre = 'Sucursal Central - La Plata'
ON CONFLICT (sucursal_id, alias) DO NOTHING;

INSERT INTO movimiento_bancario (cuenta_id, fecha_hora, ordenante, referencia_externa, importe_centavos)
SELECT cr.id, now(), c.razon_social, demo.referencia, demo.importe_centavos
FROM cuenta_recepcion cr
JOIN sucursal s ON s.id = cr.sucursal_id
CROSS JOIN (VALUES
  ('Mayorista El Sol S.R.L.', 'DEMO-E5-04-001', 15700000::bigint), -- exacto: R-0001-45120 + R-0002-89310
  ('Mayorista El Sol S.R.L.', 'DEMO-E5-04-002', 15600000::bigint), -- movimiento corto: diferencia de -$1.000
  ('Mayorista El Sol S.R.L.', 'DEMO-E5-04-003', 15800000::bigint), -- movimiento excedido: diferencia de +$1.000
  ('Autoservicio Luna',      'DEMO-E5-04-004', 15700000::bigint), -- ordenante distinto al de esos dos remitos
  ('Mayorista El Sol S.R.L.', 'DEMO-E5-04-005', 15700000::bigint), -- repetir tras conciliar 001: remitos ya saldados
  ('Mayorista El Sol S.R.L.', 'DEMO-E5-04-006', 15700000::bigint), -- exacto para probar HU sin reutilizar remitos saldados
  ('Mayorista El Sol S.R.L.', 'DEMO-E5-04-007', 5000000::bigint), -- primer pago parcial de R-0001-45122
  ('Mayorista El Sol S.R.L.', 'DEMO-E5-04-008', 5000000::bigint)  -- segundo pago completa ese remito
) AS demo(ordenante, referencia, importe_centavos)
JOIN comercio c ON c.razon_social = demo.ordenante
WHERE s.nombre = 'Sucursal Central - La Plata'
  AND cr.sucursal_id = s.id
  AND cr.alias = 'Cuenta operativa demo'
  AND NOT EXISTS (
      SELECT 1 FROM movimiento_bancario mb
      WHERE mb.cuenta_id = cr.id AND mb.referencia_externa = demo.referencia
  );

-- 8. Casos de ejemplo para sugerencias exactas/parciales y movimientos huérfanos
INSERT INTO movimiento_bancario (cuenta_id, fecha_hora, ordenante, referencia_externa, importe_centavos)
SELECT cr.id, demo.fecha_hora, demo.ordenante, demo.referencia, demo.importe_centavos
FROM cuenta_recepcion cr
JOIN sucursal s ON s.id = cr.sucursal_id
CROSS JOIN (VALUES
  ('Mayorista El Sol S.R.L.', 'DEMO-HU38-EXACTA', 15000000::bigint, now() - interval '11 days'),
  ('Autoservicio Luna',      'DEMO-HU38-PARCIAL', 14200000::bigint, now() - interval '11 days'),
  ('Ordenante sin identificar', 'DEMO-HU40-HUERFANO', 8300000::bigint, now() - interval '4 days')
) AS demo(ordenante, referencia, importe_centavos, fecha_hora)
WHERE s.nombre = 'Sucursal Central - La Plata'
  AND cr.sucursal_id = s.id
  AND cr.alias = 'Cuenta operativa demo'
  AND NOT EXISTS (
      SELECT 1 FROM movimiento_bancario mb
      WHERE mb.cuenta_id = cr.id AND mb.referencia_externa = demo.referencia
  );

COMMIT;
