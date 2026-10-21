-- Migración 004: HU #19 - Anexar Entrega a Ruta y Sincronización con Transportista
BEGIN;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS dispositivo_conectado boolean NOT NULL DEFAULT true;

ALTER TABLE visita ADD COLUMN IF NOT EXISTS sincronizacion_pendiente boolean NOT NULL DEFAULT false;

COMMIT;
