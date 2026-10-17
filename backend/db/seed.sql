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
  ('admin', 'Martín Jirafales Coordinador', 'admin@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Administrativo', false, true),
  ('chofer', 'Carlos Repartidor', 'chofer@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Transportista', true, true),
  ('supervisor', 'Valeria Logística', 'supervisor@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Supervisor', false, true),
  ('gerencia', 'Roberto Gerente', 'gerencia@tutucas.com.ar', '$2b$10$e3NYwqO7uVTBhE56XYXR3uKzT9pm6IVV/LnAfghzSx50r1FgP5HuO', 'Gerente', false, true)
ON CONFLICT (usuario) DO NOTHING;

-- 2.1 Asignación Usuario - Sucursal
INSERT INTO usuario_sucursal (usuario_id, sucursal_id)
SELECT u.id, s.id
FROM (VALUES
  ('admin', 'Sucursal Central - La Plata'),
  ('chofer', 'Depósito Sur - Berisso'),
  ('supervisor', 'Hub Central - Distribución'),
  ('gerencia', 'Sede Administrativa Central')
) AS us(usuario_nom, sucursal_nom)
JOIN usuario u ON u.usuario = us.usuario_nom
JOIN sucursal s ON s.nombre = us.sucursal_nom
ON CONFLICT (usuario_id, sucursal_id) DO NOTHING;

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
  ('Lácteos del Sur', 'Mayorista El Sol S.R.L.', 'R-0001-45122', 10000000::bigint),
  ('Bebidas Nacionales', 'Mayorista El Sol S.R.L.', 'R-0002-89311', 5700000::bigint),
  ('Lácteos del Sur', 'Autoservicio Luna', 'R-0001-45121', 6200000::bigint),
  ('Alimentos Río de la Plata', 'Autoservicio Luna', 'R-0003-11200', 11000000::bigint),
  ('Bebidas Nacionales', 'Distribuidora Los Andes', 'R-0002-89315', 9400000::bigint)
) AS r(marca_nombre, comercio_nombre, numero, importe_centavos)
JOIN marca m ON m.nombre = r.marca_nombre
JOIN comercio c ON c.razon_social = r.comercio_nombre
JOIN sucursal s ON s.nombre = 'Sucursal Central - La Plata'
ON CONFLICT (marca_id, numero) DO NOTHING;

-- Remitos entregados de ejemplo para la bandeja de cobranza y conciliación exacta.
UPDATE remito SET estado = 'entregado', entregado_en = now() - interval '12 days'
WHERE numero IN ('R-0001-45120', 'R-0002-89310', 'R-0001-45122', 'R-0002-89311');

-- 6. Movimientos bancarios de ejemplo para probar E5-04
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

COMMIT;
