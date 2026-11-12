-- =====================================================================
--  Reinicia la demo de la app móvil: borra la hoja de ruta de HOY (Argentina) del
--  usuario 'chofer' (con sus visitas y cobros) y los remitos de demo.
--  Solo para bases de desarrollo. Después correr seed.sql.
--  (npm run db:demo-movil-reset hace las dos cosas).
-- =====================================================================

BEGIN;

-- Rendiciones de efectivo de la hoja de HOY (HU #46 a #50): primero se liberan sus cobros.
UPDATE cobro SET rendicion_id = NULL
WHERE rendicion_id IN (
    SELECT re.id
    FROM rendicion_efectivo re
    JOIN hoja_de_ruta h ON h.id = re.hoja_de_ruta_id
    JOIN usuario u ON u.id = h.transportista_id
    WHERE u.usuario = 'chofer'
      AND h.fecha_reparto = timezone('America/Argentina/Buenos_Aires', now())::date
);

DELETE FROM rendicion_efectivo re
USING hoja_de_ruta h, usuario u
WHERE h.id = re.hoja_de_ruta_id
  AND u.id = h.transportista_id
  AND u.usuario = 'chofer'
  AND h.fecha_reparto = timezone('America/Argentina/Buenos_Aires', now())::date;

DELETE FROM remito
WHERE visita_id IN (
    SELECT v.id
    FROM visita v
    JOIN hoja_de_ruta h ON h.id = v.hoja_de_ruta_id
    JOIN usuario u ON u.id = h.transportista_id
    WHERE u.usuario = 'chofer'
      AND h.fecha_reparto = timezone('America/Argentina/Buenos_Aires', now())::date
);

-- Visitas y cobros se borran en cascada.
DELETE FROM hoja_de_ruta h
USING usuario u
WHERE u.id = h.transportista_id
  AND u.usuario = 'chofer'
  AND h.fecha_reparto = timezone('America/Argentina/Buenos_Aires', now())::date;

-- Reiniciar conciliaciones y movimientos demo para volver a probar la pestaña Conciliación desde cero:
DELETE FROM discrepancia_notificacion;
DELETE FROM discrepancia_ajuste;
DELETE FROM discrepancia_comprobante;
DELETE FROM discrepancia_conciliacion;
DELETE FROM imputacion;
DELETE FROM movimiento_bancario_comprobante;
DELETE FROM movimiento_bancario
WHERE referencia_externa LIKE 'DEMO-%'
   OR origen IN ('Carga Manual', 'QR - Carga Manual');

COMMIT;
