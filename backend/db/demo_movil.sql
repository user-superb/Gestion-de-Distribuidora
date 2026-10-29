-- =====================================================================
--  Datos de prueba para la app móvil (Épica 1.4)
--  Crea la hoja de ruta de HOY para el usuario 'chofer', publicada y con
--  tres visitas. Se puede correr todos los días: los números de remito
--  llevan la fecha, y si la hoja de hoy ya existe no se duplica nada.
-- =====================================================================

BEGIN;

INSERT INTO hoja_de_ruta (sucursal_id, transportista_id, fecha_reparto, patente, estado, publicada_en)
SELECT s.id, u.id, CURRENT_DATE, 'AB123CD', 'publicada', now()
FROM usuario u
JOIN sucursal s ON s.nombre = 'Sucursal Central - La Plata'
WHERE u.usuario = 'chofer'
  AND NOT EXISTS (
    SELECT 1 FROM hoja_de_ruta h WHERE h.transportista_id = u.id AND h.fecha_reparto = CURRENT_DATE
  );

INSERT INTO visita (hoja_de_ruta_id, comercio_id, orden)
SELECT h.id, (SELECT min(c.id) FROM comercio c WHERE c.razon_social = d.razon_social), d.orden
FROM (VALUES
  ('Mayorista El Sol S.R.L.', 1),
  ('Autoservicio Luna', 2),
  ('Distribuidora Los Andes', 3)
) AS d(razon_social, orden)
JOIN usuario u ON u.usuario = 'chofer'
JOIN hoja_de_ruta h ON h.transportista_id = u.id AND h.fecha_reparto = CURRENT_DATE
ON CONFLICT DO NOTHING;

-- Visita 2 incluye un remito no entregado con motivo para probar la HU #24 y HU #25 ESCENARIO 3.
INSERT INTO remito (marca_id, comercio_id, sucursal_id, numero, importe_centavos, estado, motivo_no_entrega, visita_id)
SELECT m.id, v.comercio_id, h.sucursal_id,
       'M' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || r.sufijo,
       r.importe_centavos, r.estado, r.motivo_no_entrega, v.id
FROM (VALUES
  (1, 'Lácteos del Sur',           '01', 4500000::bigint, 'en_ruta',      NULL),
  (1, 'Bebidas Nacionales',        '02', 1250050::bigint, 'en_ruta',      NULL),
  (2, 'Alimentos Río de la Plata', '03', 3000000::bigint, 'en_ruta',      NULL),
  (2, 'Lácteos del Sur',           '04',  800000::bigint, 'no_entregado', 'Comercio cerrado en horario de reparto'),
  (3, 'Bebidas Nacionales',        '05', 2199999::bigint, 'en_ruta',      NULL)
) AS r(orden, marca, sufijo, importe_centavos, estado, motivo_no_entrega)
JOIN marca m ON m.nombre = r.marca
JOIN usuario u ON u.usuario = 'chofer'
JOIN hoja_de_ruta h ON h.transportista_id = u.id AND h.fecha_reparto = CURRENT_DATE
JOIN visita v ON v.hoja_de_ruta_id = h.id AND v.orden = r.orden
ON CONFLICT (marca_id, numero) DO UPDATE
SET estado = EXCLUDED.estado,
    motivo_no_entrega = EXCLUDED.motivo_no_entrega,
    importe_centavos = EXCLUDED.importe_centavos;

COMMIT;
