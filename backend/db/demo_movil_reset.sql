-- =====================================================================
--  Reinicia la demo de la app móvil: borra la hoja de ruta de HOY (Argentina) del
--  usuario 'chofer' (con sus visitas y cobros) y los remitos de demo.
--  Solo para bases de desarrollo. Después correr seed.sql.
--  (npm run db:demo-movil-reset hace las dos cosas).
-- =====================================================================

BEGIN;

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

COMMIT;
