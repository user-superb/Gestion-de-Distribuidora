-- =====================================================================
--  Set de datos para probar las HU #46 a #50 (arqueo y rendición de efectivo),
--  #55 a #57 (auditoría) y #36 a #39 (conciliación). Solo para bases de desarrollo.
--
--  Correr desde backend/:
--      npx tsx src/scripts/runSqlFile.ts db/demo_hu36_57.sql
--
--  Es re-ejecutable: borra lo que haya quedado de la corrida anterior
--  (imputaciones, discrepancias y movimientos de estos casos) y lo vuelve
--  a crear con fechas de HOY, así las sugerencias (ventana de 7 días)
--  nunca quedan vencidas. Guía de prueba: docs/pruebas-hu36-57.md
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Limpieza de la corrida anterior
-- ---------------------------------------------------------------------
CREATE TEMP TABLE demo_movs ON COMMIT DROP AS
  SELECT id FROM movimiento_bancario
  WHERE referencia_externa LIKE 'DEMO36-%' OR referencia_externa LIKE 'DEMO37-%'
     OR referencia_externa LIKE 'DEMO38-%' OR referencia_externa LIKE 'DEMO39-%'
     OR referencia_externa LIKE 'DEMO55-%';

CREATE TEMP TABLE demo_rems ON COMMIT DROP AS
  SELECT id FROM remito
  WHERE numero LIKE 'D36-%' OR numero LIKE 'K37-%' OR numero LIKE 'P38-%'
     OR numero LIKE 'P39-%' OR numero LIKE 'V38-%' OR numero LIKE 'E46-%';

-- Hojas de ruta de ejemplo (se reconocen por la patente).
CREATE TEMP TABLE demo_hojas ON COMMIT DROP AS
  SELECT id FROM hoja_de_ruta WHERE patente IN ('DEMO56A', 'DEMO56B') OR patente LIKE 'DEMO46%';

CREATE TEMP TABLE demo_disc ON COMMIT DROP AS
  SELECT id FROM discrepancia_conciliacion
  WHERE movimiento_ids && ARRAY(SELECT id FROM demo_movs)
     OR remito_ids && ARRAY(SELECT id FROM demo_rems)
     OR movimiento_id IN (SELECT id FROM demo_movs);

DELETE FROM discrepancia_notificacion WHERE discrepancia_id IN (SELECT id FROM demo_disc);
DELETE FROM discrepancia_ajuste       WHERE discrepancia_id IN (SELECT id FROM demo_disc);
DELETE FROM discrepancia_comprobante  WHERE discrepancia_id IN (SELECT id FROM demo_disc);
DELETE FROM discrepancia_conciliacion WHERE id IN (SELECT id FROM demo_disc);
DELETE FROM imputacion
  WHERE movimiento_bancario_id IN (SELECT id FROM demo_movs) OR remito_id IN (SELECT id FROM demo_rems);
DELETE FROM movimiento_bancario_comprobante WHERE movimiento_id IN (SELECT id FROM demo_movs);
DELETE FROM movimiento_bancario WHERE id IN (SELECT id FROM demo_movs);
DELETE FROM remito WHERE id IN (SELECT id FROM demo_rems);

-- Historial de auditoría de ejemplo (solo el que crea este script, marcado con "demo").
DELETE FROM auditoria WHERE valores_despues->>'demo' = 'hu36-57';
UPDATE cobro SET rendicion_id = NULL
  WHERE rendicion_id IN (SELECT id FROM rendicion_efectivo WHERE hoja_de_ruta_id IN (SELECT id FROM demo_hojas));
DELETE FROM rendicion_efectivo WHERE hoja_de_ruta_id IN (SELECT id FROM demo_hojas);
-- Al borrar la hoja se van sus visitas y, con ellas, sus cobros.
DELETE FROM hoja_de_ruta WHERE id IN (SELECT id FROM demo_hojas);

-- ---------------------------------------------------------------------
-- 1. Comercios de prueba (uno por grupo de historias)
-- ---------------------------------------------------------------------
INSERT INTO comercio (razon_social, nombre_fantasia, cuit, domicilio, localidad)
SELECT d.razon_social, d.fantasia, d.cuit, d.domicilio, 'La Plata'
FROM (VALUES
  ('Almacén Don Pepe S.A.',      'Don Pepe',       '30711111118', 'Calle 44 N° 1250'),   -- HU #36
  ('Kiosco La Esquina S.R.L.',   'La Esquina',     '30722222224', 'Av. 7 N° 980'),       -- HU #37
  ('Panadería San Martín S.A.',  'San Martín',     '30733333330', 'Calle 50 N° 640'),    -- HU #38 y #39
  ('Despensa El Trébol',         'El Trébol',      '20744444446', 'Calle 60 N° 315'),    -- HU #38: otra razón social
  ('Verdulería Los Hermanos',    'Los Hermanos',   '30755555552', 'Diagonal 73 N° 2100') -- HU #38: sin coincidencias
) AS d(razon_social, fantasia, cuit, domicilio)
WHERE NOT EXISTS (SELECT 1 FROM comercio c WHERE c.razon_social = d.razon_social);

-- Usuario administrativo de OTRA sucursal: no ve movimientos ni sugerencias de la Central
-- (sirve para ver el estado vacío de la HU #38 E3). Misma contraseña que el usuario admin.
INSERT INTO usuario (usuario, nombre, email, password_hash, rol, es_transportista, activo)
SELECT 'admin_sur', 'Sofía Depósito Sur', 'admin.sur@tutucas.com.ar', u.password_hash, 'Administrativo', false, true
FROM usuario u
WHERE u.usuario = 'admin'
  AND NOT EXISTS (SELECT 1 FROM usuario x WHERE x.usuario = 'admin_sur');

INSERT INTO usuario_sucursal (usuario_id, sucursal_id)
SELECT u.id, s.id FROM usuario u, sucursal s
WHERE u.usuario = 'admin_sur' AND s.nombre = 'Depósito Sur - Berisso'
ON CONFLICT DO NOTHING;

-- Para poder APROBAR discrepancias (HU #36 E2, #37 E2/E3, #56): el gerente necesita un límite
-- de autorización. Sin esto, toda aprobación se escala y nunca se cierra.
UPDATE usuario SET limite_autorizacion_centavos = 10000000  -- $100.000
WHERE usuario = 'gerencia' AND limite_autorizacion_centavos = 0;

-- ---------------------------------------------------------------------
-- 2. Remitos entregados e impagos (entregados ayer, sucursal Central)
-- ---------------------------------------------------------------------
INSERT INTO remito (marca_id, comercio_id, sucursal_id, numero, importe_centavos, estado, entregado_en)
SELECT m.id, c.id, s.id, d.numero, d.importe, 'entregado', now() - interval '1 day'
FROM (VALUES
  -- HU #36 · Almacén Don Pepe
  ('Almacén Don Pepe S.A.',     'D36-001',  500000::bigint),  -- E1: tres remitos de $5.000 ...
  ('Almacén Don Pepe S.A.',     'D36-002',  500000::bigint),
  ('Almacén Don Pepe S.A.',     'D36-003',  500000::bigint),
  ('Almacén Don Pepe S.A.',     'D36-004',  850000::bigint),  -- E2: $8.500 + $11.500 = $20.000 contra $15.000
  ('Almacén Don Pepe S.A.',     'D36-005', 1150000::bigint),
  ('Almacén Don Pepe S.A.',     'D36-006',  900000::bigint),  -- E3: para mezclar con un remito de otro comercio
  -- HU #37 · Kiosco La Esquina
  ('Kiosco La Esquina S.R.L.',  'K37-001', 3000000::bigint),  -- E1: $10.000 + $12.000 + $8.000
  ('Kiosco La Esquina S.R.L.',  'K37-002', 4800000::bigint),  -- E2: $20.000 + $18.400 = 80 %
  ('Kiosco La Esquina S.R.L.',  'K37-003', 2500000::bigint),  -- E3: $15.000 + $15.000 excede en $5.000
  -- HU #38 · Panadería San Martín
  ('Panadería San Martín S.A.', 'P38-001', 4235000::bigint),  -- E1: match exacto
  ('Panadería San Martín S.A.', 'P38-002', 1890000::bigint),  -- E2: mismo importe, otra razón social
  ('Panadería San Martín S.A.', 'P38-003', 6000000::bigint),  -- E2: mismo cliente, importe aproximado
  ('Verdulería Los Hermanos',   'V38-001', 3333300::bigint),  -- E3: sin ningún movimiento que coincida
  -- HU #39 · Panadería San Martín
  ('Panadería San Martín S.A.', 'P39-001', 2700000::bigint),  -- E1: aceptar
  ('Panadería San Martín S.A.', 'P39-002', 3500000::bigint),  -- E2: movimiento consumido por otro operador
  ('Panadería San Martín S.A.', 'P39-003', 7130000::bigint)   -- E3: remito saldado por otro movimiento
) AS d(comercio, numero, importe)
JOIN comercio c ON c.razon_social = d.comercio
JOIN marca m ON m.nombre = 'Lácteos del Sur'
JOIN sucursal s ON s.nombre = 'Sucursal Central - La Plata';

-- ---------------------------------------------------------------------
-- 3. Movimientos bancarios pendientes (acreditados HOY, cuenta demo de la Central)
--    El concepto dice para qué escenario es cada uno.
-- ---------------------------------------------------------------------
INSERT INTO movimiento_bancario (cuenta_id, fecha_hora, ordenante, ordenante_cuit, concepto, referencia_externa, importe_centavos, origen, estado)
SELECT cr.id, now() - (d.orden || ' minutes')::interval, d.ordenante, d.cuit, d.concepto, d.referencia, d.importe, 'Extracto Bancario', 'sin_imputar'
FROM (VALUES
  -- HU #36
  ( 1, 'Almacén Don Pepe S.A.',     '30711111118', 'HU36 E1 - pago unico de 3 remitos',        'DEMO36-E1',        1500000::bigint),
  ( 2, 'Almacén Don Pepe S.A.',     '30711111118', 'HU36 E2 - no alcanza para D36-004 y 005',  'DEMO36-E2',        1500000::bigint),
  -- HU #37
  ( 3, 'Kiosco La Esquina S.R.L.',  '30722222224', 'HU37 E1 - cuota 1 de 3 de K37-001',        'DEMO37-E1-A',      1000000::bigint),
  ( 4, 'Kiosco La Esquina S.R.L.',  '30722222224', 'HU37 E1 - cuota 2 de 3 de K37-001',        'DEMO37-E1-B',      1200000::bigint),
  ( 5, 'Kiosco La Esquina S.R.L.',  '30722222224', 'HU37 E1 - cuota 3 de 3 de K37-001',        'DEMO37-E1-C',       800000::bigint),
  ( 6, 'Kiosco La Esquina S.R.L.',  '30722222224', 'HU37 E2 - pago parcial 1 de K37-002',      'DEMO37-E2-A',      2000000::bigint),
  ( 7, 'Kiosco La Esquina S.R.L.',  '30722222224', 'HU37 E2 - pago parcial 2 de K37-002',      'DEMO37-E2-B',      1840000::bigint),
  ( 8, 'Kiosco La Esquina S.R.L.',  '30722222224', 'HU37 E3 - pago 1 que excede K37-003',      'DEMO37-E3-A',      1500000::bigint),
  ( 9, 'Kiosco La Esquina S.R.L.',  '30722222224', 'HU37 E3 - pago 2 que excede K37-003',      'DEMO37-E3-B',      1500000::bigint),
  -- HU #38 (el segundo no trae CUIT: coincide por razón social)
  (10, 'Panadería San Martín S.A.', '30733333330', 'HU38 E1 - match exacto con P38-001',       'DEMO38-EXACTA',    4235000::bigint),
  (11, 'Despensa El Trébol',        '20744444446', 'HU38 E2 - mismo importe, otro cliente',    'DEMO38-PARCIAL-CLIENTE', 1890000::bigint),
  (12, 'PANADERIA SAN MARTIN SA',   NULL,          'HU38 E2 - mismo cliente, importe cercano', 'DEMO38-PARCIAL-IMPORTE', 5750000::bigint),
  -- HU #39
  (13, 'Panadería San Martín S.A.', '30733333330', 'HU39 E1 - aceptar sugerencia',             'DEMO39-E1',        2700000::bigint),
  (14, 'Panadería San Martín S.A.', '30733333330', 'HU39 E2 - se consume desde otra pestaña',  'DEMO39-E2',        3500000::bigint),
  (15, 'Panadería San Martín S.A.', '30733333330', 'HU39 E3 - sugerencia A de P39-003',        'DEMO39-E3-A',      7130000::bigint),
  (16, 'Panadería San Martín S.A.', '30733333330', 'HU39 E3 - sugerencia B de P39-003',        'DEMO39-E3-B',      7130000::bigint)
) AS d(orden, ordenante, cuit, concepto, referencia, importe)
JOIN cuenta_recepcion cr ON cr.alias = 'Cuenta operativa demo'
JOIN sucursal s ON s.id = cr.sucursal_id AND s.nombre = 'Sucursal Central - La Plata';

-- ---------------------------------------------------------------------
-- 4. Historial de auditoría de ejemplo (HU #55, #56 y #57)
--    Con la misma forma que escribe el sistema. Lo que hagas vos al probar
--    (importar un extracto, conciliar, aprobar un arqueo) se suma a esto.
-- ---------------------------------------------------------------------
-- HU #55 · importaciones de extractos: dos archivos y una re-subida con todo duplicado.
INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, ocurrido_en, valores_despues, observacion)
SELECT 'cuenta_recepcion', cr.id, 'importacion_extracto', u.id, now() - d.hace,
       jsonb_build_object('archivo', d.archivo, 'totalProcesados', d.insertados + d.omitidos,
                          'insertados', d.insertados, 'omitidosDuplicados', d.omitidos, 'demo', 'hu36-57'),
       format('Importación de extracto bancario (%s insertados, %s duplicados omitidos)', d.insertados, d.omitidos)
FROM (VALUES
  ('admin',         interval '6 days', 'extracto_banco_demo_semana_1.csv', 12, 0),
  ('admin',         interval '3 days', 'extracto_banco_demo_semana_2.csv',  8, 3),
  ('admin_sistema', interval '1 day',  'extracto_banco_demo_semana_2.csv',  0, 11)
) AS d(usuario, hace, archivo, insertados, omitidos)
JOIN usuario u ON u.usuario = d.usuario
JOIN cuenta_recepcion cr ON cr.alias = 'Cuenta operativa demo'
JOIN sucursal s ON s.id = cr.sucursal_id AND s.nombre = 'Sucursal Central - La Plata';

-- HU #56 · dos rendiciones validadas por el supervisor: un faltante de $5.000 hace una semana
-- y una coincidente hace 5 días.
INSERT INTO hoja_de_ruta (sucursal_id, transportista_id, fecha_reparto, patente, estado, cerrada_en)
SELECT s.id, t.id, (now() - d.hace)::date, d.patente, 'cerrada', now() - d.hace
FROM (VALUES ('DEMO56A', interval '7 days'), ('DEMO56B', interval '5 days')) AS d(patente, hace)
JOIN sucursal s ON s.nombre = 'Sucursal Central - La Plata'
JOIN usuario t ON t.usuario = 'chofer';

INSERT INTO rendicion_efectivo (hoja_de_ruta_id, transportista_id, declarado_centavos, declarado_en,
                                rendido_centavos, motivo_diferencia, estado, validado_por, validado_en)
SELECT h.id, h.transportista_id, d.declarado, h.cerrada_en - interval '1 hour',
       d.rendido, d.motivo, 'validada', sup.id, h.cerrada_en
FROM (VALUES
  ('DEMO56A', 8500000::bigint, 8000000::bigint, 'Faltante de $5.000: el chofer dio mal un vuelto y lo reconoce. Se descuenta de la liquidación.'),
  ('DEMO56B', 6200000::bigint, 6200000::bigint, NULL)
) AS d(patente, declarado, rendido, motivo)
JOIN hoja_de_ruta h ON h.patente = d.patente
JOIN usuario sup ON sup.usuario = 'supervisor';

INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, ocurrido_en, valores_antes, valores_despues, observacion)
SELECT 'rendicion_efectivo', re.id, 'validacion', re.validado_por, re.validado_en,
       jsonb_build_object('estado', 'pendiente'),
       jsonb_build_object('estado', 'validada', 'hojaDeRutaId', re.hoja_de_ruta_id::text,
                          'declaradoCentavos', re.declarado_centavos, 'rendidoCentavos', re.rendido_centavos,
                          'diferenciaCentavos', re.rendido_centavos - re.declarado_centavos,
                          'descuadre', re.rendido_centavos <> re.declarado_centavos, 'demo', 'hu36-57'),
       re.motivo_diferencia
FROM rendicion_efectivo re
JOIN hoja_de_ruta h ON h.id = re.hoja_de_ruta_id
WHERE h.patente IN ('DEMO56A', 'DEMO56B');

-- HU #57 · actividad por usuario: dos reasignaciones del administrativo y una anulación del chofer.
INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, ocurrido_en, valores_antes, valores_despues, observacion)
SELECT 'hoja_de_ruta', h.id, 'reasignacion', adm.id, now() - d.hace,
       jsonb_build_object('transportista_id', ch2.id::text),
       jsonb_build_object('transportista_id', ch.id::text, 'demo', 'hu36-57'),
       d.observacion
FROM (VALUES
  ('DEMO56A', interval '8 days', 'Cambio de transportista'),
  ('DEMO56B', interval '6 days', 'Cambio de transportista')
) AS d(patente, hace, observacion)
JOIN hoja_de_ruta h ON h.patente = d.patente
JOIN usuario adm ON adm.usuario = 'admin'
JOIN usuario ch ON ch.usuario = 'chofer'
JOIN usuario ch2 ON ch2.usuario = 'chofer2';

INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, ocurrido_en, valores_antes, valores_despues, observacion)
SELECT 'rendicion_efectivo', re.id, 'anulacion', ch.id, re.declarado_en - interval '20 minutes',
       jsonb_build_object('estado', 'pendiente'),
       jsonb_build_object('estado', 'anulada', 'demo', 'hu36-57'),
       'El transportista retractó una declaración anterior de esta hoja'
FROM rendicion_efectivo re
JOIN hoja_de_ruta h ON h.id = re.hoja_de_ruta_id AND h.patente = 'DEMO56A'
JOIN usuario ch ON ch.usuario = 'chofer';

-- ---------------------------------------------------------------------
-- 5. Rutas para el arqueo de efectivo (HU #46 a #50), del transportista Mario Flete (chofer2)
--    DEMO46A y DEMO46B están terminadas y cobradas en efectivo: el sistema les genera el arqueo
--    solo, la primera vez que el supervisor abre "Efectivo". DEMO46C tiene una parada pendiente:
--    no se genera sola y aparece en "+ Iniciar Arqueo" con la advertencia.
--      DEMO46A  $23.450 + $31.200 = $54.650   -> HU #48: contar exacto y aprobar
--      DEMO46B  $44.100 + $28.600 = $72.700   -> HU #49 y #50: contar de menos, justificar y aprobar
--      DEMO46C  $16.800 cobrado + 1 parada pendiente -> HU #46 E3: ruta abierta
-- ---------------------------------------------------------------------
INSERT INTO hoja_de_ruta (sucursal_id, transportista_id, fecha_reparto, patente, estado, publicada_en)
SELECT s.id, t.id, (now() - d.hace)::date, d.patente, 'en_curso', now() - d.hace
FROM (VALUES
  ('DEMO46A', interval '1 day'),
  ('DEMO46B', interval '2 days'),
  ('DEMO46C', interval '3 days')
) AS d(patente, hace)
JOIN sucursal s ON s.nombre = 'Sucursal Central - La Plata'
JOIN usuario t ON t.usuario = 'chofer2';

INSERT INTO visita (hoja_de_ruta_id, comercio_id, orden, estado, registrada_en, cobrada_en)
SELECT h.id, c.id, d.orden, d.estado,
       CASE WHEN d.cobrada THEN h.publicada_en + interval '3 hours' END,
       CASE WHEN d.cobrada THEN h.publicada_en + interval '3 hours' END
FROM (VALUES
  ('DEMO46A', 1, 'Verdulería Los Hermanos', 'completada', true),
  ('DEMO46A', 2, 'Despensa El Trébol',      'completada', true),
  ('DEMO46B', 1, 'Verdulería Los Hermanos', 'completada', true),
  ('DEMO46B', 2, 'Despensa El Trébol',      'completada', true),
  ('DEMO46C', 1, 'Verdulería Los Hermanos', 'completada', true),
  ('DEMO46C', 2, 'Despensa El Trébol',      'pendiente',  false)
) AS d(patente, orden, comercio, estado, cobrada)
JOIN hoja_de_ruta h ON h.patente = d.patente
JOIN comercio c ON c.razon_social = d.comercio;

INSERT INTO remito (marca_id, comercio_id, sucursal_id, numero, importe_centavos, estado, entregado_en, visita_id)
SELECT m.id, v.comercio_id, h.sucursal_id, d.numero, d.importe, d.estado,
       CASE WHEN d.estado = 'entregado' THEN v.registrada_en END, v.id
FROM (VALUES
  ('DEMO46A', 1, 'E46-A1', 2345000::bigint, 'entregado'),
  ('DEMO46A', 2, 'E46-A2', 3120000::bigint, 'entregado'),
  ('DEMO46B', 1, 'E46-B1', 4410000::bigint, 'entregado'),
  ('DEMO46B', 2, 'E46-B2', 2860000::bigint, 'entregado'),
  ('DEMO46C', 1, 'E46-C1', 1680000::bigint, 'entregado'),
  ('DEMO46C', 2, 'E46-C2',  975000::bigint, 'en_ruta')
) AS d(patente, orden, numero, importe, estado)
JOIN hoja_de_ruta h ON h.patente = d.patente
JOIN visita v ON v.hoja_de_ruta_id = h.id AND v.orden = d.orden
JOIN marca m ON m.nombre = 'Bebidas Nacionales';

-- Cada parada cobrada se pagó completa en efectivo.
INSERT INTO cobro (visita_id, medio_pago, importe_centavos, registrado_en, registrado_por, clave_idempotencia, estado, sincronizado_en)
SELECT v.id, 'efectivo', r.importe_centavos, v.cobrada_en, h.transportista_id, gen_random_uuid(), 'pendiente', v.cobrada_en
FROM hoja_de_ruta h
JOIN visita v ON v.hoja_de_ruta_id = h.id AND v.cobrada_en IS NOT NULL
JOIN remito r ON r.visita_id = v.id
WHERE h.patente LIKE 'DEMO46%';

COMMIT;
