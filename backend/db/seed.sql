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

-- 5. Hoja de ruta demo en calle en progreso para el día operativo argentino.
WITH demo_dia AS (
  SELECT timezone('America/Argentina/Buenos_Aires', now())::date AS fecha
)
INSERT INTO hoja_de_ruta (sucursal_id, transportista_id, fecha_reparto, patente, estado, publicada_en)
SELECT s.id, u.id, d.fecha, 'AB123CD', 'en_curso', now()
FROM sucursal s
JOIN usuario u ON u.usuario = 'chofer'
CROSS JOIN demo_dia d
WHERE s.nombre = 'Sucursal Central - La Plata'
  AND NOT EXISTS (
    SELECT 1 FROM hoja_de_ruta h
    WHERE h.transportista_id = u.id AND h.fecha_reparto = d.fecha
  );

-- Si ya existía la hoja borrador o publicada creada por una seed anterior, dejarla en curso.
WITH demo_dia AS (
  SELECT timezone('America/Argentina/Buenos_Aires', now())::date AS fecha
)
UPDATE hoja_de_ruta h
SET patente = COALESCE(h.patente, 'AB123CD'),
    estado = CASE WHEN h.estado IN ('borrador', 'publicada') THEN 'en_curso' ELSE h.estado END,
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
WHERE numero IN ('R-0001-45120', 'R-0002-89310', 'R-0001-45122', 'R-0002-89311');

-- 7. Movimientos bancarios de ejemplo para probar E5-04
INSERT INTO cuenta_recepcion (sucursal_id, nombre_fantasia, alias, cbu, banco, cuit_titular, moneda, activa)
SELECT id, 'Cuenta Operativa Principal', 'Cuenta operativa demo', '2850590940090418135201', 'Banco Demo', '30712345678', 'ARS', true
FROM sucursal
WHERE nombre = 'Sucursal Central - La Plata'
ON CONFLICT (sucursal_id, alias) DO UPDATE SET
  cbu = COALESCE(cuenta_recepcion.cbu, EXCLUDED.cbu),
  cuit_titular = COALESCE(cuenta_recepcion.cuit_titular, EXCLUDED.cuit_titular),
  moneda = COALESCE(cuenta_recepcion.moneda, EXCLUDED.moneda),
  nombre_fantasia = COALESCE(cuenta_recepcion.nombre_fantasia, EXCLUDED.nombre_fantasia);

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

-- Si ya existían de días previos y siguen sin imputar, actualizar su fecha al día de hoy para que sean visibles en la bandeja del día actual
UPDATE movimiento_bancario
SET fecha_hora = now()
WHERE referencia_externa LIKE 'DEMO-E5-04-%'
  AND estado = 'sin_imputar';

-- 8. Caso de ejemplo para movimientos huérfanos (HU #40)
INSERT INTO movimiento_bancario (cuenta_id, fecha_hora, ordenante, referencia_externa, importe_centavos)
SELECT cr.id, demo.fecha_hora, demo.ordenante, demo.referencia, demo.importe_centavos
FROM cuenta_recepcion cr
JOIN sucursal s ON s.id = cr.sucursal_id
CROSS JOIN (VALUES
  ('Ordenante sin identificar', 'DEMO-HU40-HUERFANO', 8300000::bigint, now() - interval '4 days')
) AS demo(ordenante, referencia, importe_centavos, fecha_hora)
WHERE s.nombre = 'Sucursal Central - La Plata'
  AND cr.sucursal_id = s.id
  AND cr.alias = 'Cuenta operativa demo'
  AND NOT EXISTS (
      SELECT 1 FROM movimiento_bancario mb
      WHERE mb.cuenta_id = cr.id AND mb.referencia_externa = demo.referencia
  );

-- 9. Limpieza de registros de auditoría repetidos/redundantes y set inicial variado
DELETE FROM auditoria
WHERE observacion IN ('232323232323', 'asdasdasdasd', 'mogolico', 'kjgkkhjjkhhkkhj')
   OR (entidad = 'imputacion' AND accion = 'alta')
   OR (entidad = 'movimiento_bancario' AND accion = 'alta');

DELETE FROM auditoria a
USING auditoria b
WHERE a.id < b.id
  AND a.entidad = b.entidad
  AND a.entidad_id = b.entidad_id
  AND a.accion = b.accion
  AND a.usuario_id = b.usuario_id
  AND COALESCE(a.observacion, '') = COALESCE(b.observacion, '');

INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, ocurrido_en, valores_antes, valores_despues, observacion)
SELECT
  d.entidad,
  d.entidad_id,
  d.accion,
  u.id,
  now() - d.hace,
  d.valores_antes::jsonb,
  d.valores_despues::jsonb,
  d.observacion
FROM (VALUES
  (
    'seed-imp-extracto',
    'cuenta_recepcion',
    COALESCE((SELECT id FROM cuenta_recepcion ORDER BY id LIMIT 1), 1),
    'importacion_extracto',
    'admin',
    interval '6 hours',
    NULL,
    '{"seedKey":"seed-imp-extracto","archivo":"extracto_octubre_central.csv","insertados":12,"omitidosDuplicados":2}',
    'Importación de extracto bancario (12 insertados, 2 duplicados omitidos)'
  ),
  (
    'seed-carga-transf',
    'movimiento_bancario',
    COALESCE((SELECT id FROM movimiento_bancario ORDER BY id LIMIT 1), 1),
    'alta_manual_transferencia',
    'admin',
    interval '5 hours',
    NULL,
    '{"seedKey":"seed-carga-transf","ordenante":"Mayorista El Sol S.R.L.","referenciaExterna":"TR-MANUAL-8841","importeCentavos":"15700000","origen":"Carga Manual"}',
    'Carga manual de transferencia bancaria con comprobante PDF'
  ),
  (
    'seed-carga-qr',
    'movimiento_bancario',
    COALESCE((SELECT id FROM movimiento_bancario ORDER BY id DESC LIMIT 1), 2),
    'alta_manual_qr',
    'admin',
    interval '4 hours',
    NULL,
    '{"seedKey":"seed-carga-qr","ordenante":"Autoservicio Luna","referenciaExterna":"MP-QR-2026-9912","importeCentavos":"6200000","origen":"QR - Carga Manual"}',
    'Carga manual de cobro por QR acreditado en cuenta receptora'
  ),
  (
    'seed-conciliacion',
    'movimiento_bancario',
    COALESCE((SELECT id FROM movimiento_bancario ORDER BY id LIMIT 1), 1),
    'conciliacion',
    'admin',
    interval '3 hours',
    NULL,
    '{"seedKey":"seed-conciliacion","estado":"imputado","imputaciones":[{"remitoId":"1","importeCentavos":"15000000"},{"remitoId":"2","importeCentavos":"700000"}]}',
    'Conciliación bancaria confirmada contra remitos entregados'
  ),
  (
    'seed-disc-alta',
    'discrepancia_conciliacion',
    101::bigint,
    'alta',
    'admin',
    interval '2 hours 30 minutes',
    NULL,
    '{"seedKey":"seed-disc-alta","movimientoIds":["2"],"remitoIds":["3"],"diferenciaCentavos":"-100000"}',
    'Diferencia por retención impositiva derivada a bandeja de aprobación'
  ),
  (
    'seed-disc-aprobada',
    'discrepancia_conciliacion',
    101::bigint,
    'aprobada',
    'gerencia',
    interval '2 hours',
    NULL,
    '{"seedKey":"seed-disc-aprobada","estado":"aprobada","movimientoIds":["2"],"remitoIds":["3"],"importeMovimiento":"15600000","importeSeleccionado":"15700000","diferenciaCentavos":"-100000"}',
    'Discrepancia aprobada con reducción de saldo por descuento comercial'
  ),
  (
    'seed-disc-rechazada',
    'discrepancia_conciliacion',
    102::bigint,
    'rechazada',
    'gerencia',
    interval '1 hour 45 minutes',
    NULL,
    '{"seedKey":"seed-disc-rechazada","estado":"rechazada","movimientoIds":["3"],"remitoIds":["4"],"diferenciaCentavos":"100000"}',
    'Rechazo de discrepancia por comprobante ilegible; vuelve a pendientes'
  ),
  (
    'seed-cobro-movil',
    'cobro',
    COALESCE((SELECT id FROM cobro ORDER BY id LIMIT 1), 1),
    'alta',
    'chofer',
    interval '1 hour 30 minutes',
    NULL,
    '{"seedKey":"seed-cobro-movil","visitaId":"1","medioPago":"efectivo","importeCentavos":4500000}',
    'Cobro en efectivo registrado en punto de entrega desde app móvil'
  ),
  (
    'seed-arqueo-dif',
    'rendicion_efectivo',
    COALESCE((SELECT id FROM rendicion_efectivo ORDER BY id LIMIT 1), 1),
    'modificacion',
    'supervisor',
    interval '1 hour',
    '{"estado":"pendiente"}',
    '{"seedKey":"seed-arqueo-dif","estado":"con_diferencia","declaradoCentavos":7270000,"rendidoCentavos":7000000,"diferenciaCentavos":-270000,"tipo":"faltante"}',
    'Faltante físico de $2.700 constatado en arqueo de billetes'
  ),
  (
    'seed-arqueo-val',
    'rendicion_efectivo',
    COALESCE((SELECT id FROM rendicion_efectivo ORDER BY id DESC LIMIT 1), 2),
    'validacion',
    'supervisor',
    interval '45 minutes',
    '{"estado":"pendiente"}',
    '{"seedKey":"seed-arqueo-val","estado":"validada","hojaDeRutaId":"1","declaradoCentavos":5465000,"rendidoCentavos":5465000}',
    'Rendición física de efectivo validada y hoja de ruta cerrada'
  ),
  (
    'seed-reasig-ruta',
    'hoja_de_ruta',
    COALESCE((SELECT id FROM hoja_de_ruta ORDER BY id LIMIT 1), 1),
    'reasignacion',
    'admin_sistema',
    interval '30 minutes',
    '{"transportista_id":"4"}',
    '{"seedKey":"seed-reasig-ruta","hoja_de_ruta_id":"1","transportista_id":"3"}',
    'Reasignación operativa de transportista antes del despacho'
  ),
  (
    'seed-anul-rend',
    'rendicion_efectivo',
    COALESCE((SELECT id FROM rendicion_efectivo ORDER BY id DESC LIMIT 1), 3),
    'anulacion',
    'chofer2',
    interval '15 minutes',
    '{"estado":"pendiente"}',
    '{"seedKey":"seed-anul-rend","estado":"anulada"}',
    'Declaración de efectivo retractada antes del arqueo de caja'
  )
) AS d(seed_key, entidad, entidad_id, accion, usuario_login, hace, valores_antes, valores_despues, observacion)
JOIN usuario u ON u.usuario = d.usuario_login
WHERE NOT EXISTS (
  SELECT 1 FROM auditoria a
  WHERE a.valores_despues->>'seedKey' = d.seed_key
);

COMMIT;
