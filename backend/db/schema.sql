-- =====================================================================
--  Sistema de gestión de entregas, cobros y conciliación
--  Esquema inicial · PostgreSQL 14+
--
--  Convenciones
--    · Todo importe se guarda en CENTAVOS, como bigint. Nunca float.
--    · Los estados se modelan con CHECK sobre text en lugar de ENUM
--      nativo: durante el desarrollo los estados van a cambiar y un
--      CHECK se reemplaza con un DROP/ADD CONSTRAINT, mientras que
--      sacarle un valor a un ENUM obliga a recrear el tipo.
--    · Timestamps en timestamptz. La operación arranca a las 4 AM y el
--      huso importa para los reportes por día.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), no usado aún pero útil


-- =====================================================================
--  1. ORGANIZACIÓN: sucursales, usuarios y permisos
-- =====================================================================

CREATE TABLE sucursal (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre          text        NOT NULL UNIQUE,
    domicilio       text,
    activa          boolean     NOT NULL DEFAULT true,
    creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario         text        NOT NULL UNIQUE,
    nombre          text        NOT NULL,
    email           text,
    -- Hash de contraseña con bcrypt / scrypt / Argon2, NUNCA SHA-256.
    -- El salt va embebido en el string del algoritmo.
    password_hash   text        NOT NULL,
    rol             text        NOT NULL DEFAULT 'Administrativo' CHECK (rol IN ('Administrador del sistema', 'Administrativo', 'Transportista', 'Supervisor', 'Gerente')),
    es_transportista boolean    NOT NULL DEFAULT false,
    dispositivo_conectado boolean NOT NULL DEFAULT true,
    activo          boolean     NOT NULL DEFAULT true,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    actualizado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX usuario_nombre_login_unico ON usuario (lower(usuario));
CREATE UNIQUE INDEX usuario_email_login_unico ON usuario (lower(email)) WHERE email IS NOT NULL;

-- Un usuario puede operar sobre varias sucursales. El cliente pidió
-- explícitamente que el alcance sea configurable y no se deduzca del cargo.
CREATE TABLE usuario_sucursal (
    usuario_id      bigint NOT NULL REFERENCES usuario(id)  ON DELETE CASCADE,
    sucursal_id     bigint NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, sucursal_id)
);

-- Sesiones activas y tokens para autenticación, expiración por inactividad e invalidación/logout
CREATE TABLE sesion_usuario (
    id              text PRIMARY KEY,
    usuario_id      bigint NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    token           text NOT NULL UNIQUE,
    ip_address      text,
    user_agent      text,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    ultimo_acceso   timestamptz NOT NULL DEFAULT now(),
    expira_en       timestamptz NOT NULL,
    revocado        boolean NOT NULL DEFAULT false,
    revocado_en     timestamptz,
    motivo_cierre   text -- 'manual' | 'inactividad' | 'expirado'
);

-- Catálogo de acciones. Se agrega una fila por cada permiso nuevo del
-- sistema; no hace falta tocar código para asignarlo.
CREATE TABLE permiso (
    codigo          text PRIMARY KEY,
    descripcion     text NOT NULL
);

CREATE TABLE usuario_permiso (
    usuario_id      bigint NOT NULL REFERENCES usuario(id)  ON DELETE CASCADE,
    permiso_codigo  text   NOT NULL REFERENCES permiso(codigo) ON DELETE CASCADE,
    otorgado_en     timestamptz NOT NULL DEFAULT now(),
    otorgado_por    bigint REFERENCES usuario(id),
    PRIMARY KEY (usuario_id, permiso_codigo)
);

CREATE TABLE usuario_sucursal_permiso (
    usuario_id      bigint NOT NULL,
    sucursal_id     bigint NOT NULL,
    permiso_codigo  text   NOT NULL REFERENCES permiso(codigo) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, sucursal_id, permiso_codigo),
    FOREIGN KEY (usuario_id, sucursal_id)
        REFERENCES usuario_sucursal(usuario_id, sucursal_id) ON DELETE CASCADE
);


-- =====================================================================
--  2. MAESTROS: marcas y comercios
-- =====================================================================

CREATE TABLE marca (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre          text        NOT NULL UNIQUE,
    cuit            char(11),
    activa          boolean     NOT NULL DEFAULT true,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT marca_cuit_formato CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$')
);

CREATE TABLE comercio (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razon_social    text        NOT NULL,
    nombre_fantasia text,
    -- CUIT opcional a propósito: el cliente aclaró que no todos lo
    -- informan y que la operación no se debe bloquear por eso.
    cuit            char(11),
    domicilio       text        NOT NULL,
    localidad       text,
    -- Coordenadas opcionales, solo para visualizar la ubicación en el ABM.
    -- No alimentan el ruteo ni se exponen al transportista.
    latitud         numeric(9,6),
    longitud        numeric(9,6),
    ventana_desde   time,
    ventana_hasta   time,
    contacto        text,
    telefono        text,
    activo          boolean     NOT NULL DEFAULT true,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    actualizado_en  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT comercio_cuit_formato CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$'),
    CONSTRAINT comercio_coords_completas
        CHECK ((latitud IS NULL) = (longitud IS NULL))
);

CREATE INDEX comercio_razon_social_idx ON comercio (lower(razon_social));
CREATE INDEX comercio_cuit_idx         ON comercio (cuit) WHERE cuit IS NOT NULL;


-- =====================================================================
--  3. IMPORTACIÓN Y REMITOS
-- =====================================================================

CREATE TABLE archivo_proveedor (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marca_id        bigint      NOT NULL REFERENCES marca(id),
    sucursal_id     bigint      NOT NULL REFERENCES sucursal(id),
    nombre_archivo  text        NOT NULL,
    hash_contenido  text,                       -- evita importar dos veces el mismo archivo
    filas_totales   integer     NOT NULL DEFAULT 0,
    filas_ok        integer     NOT NULL DEFAULT 0,
    filas_error     integer     NOT NULL DEFAULT 0,
    estado          text        NOT NULL DEFAULT 'procesando',
    importado_por   bigint      NOT NULL REFERENCES usuario(id),
    importado_en    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT archivo_estado_valido
        CHECK (estado IN ('procesando','importado','con_errores','anulado'))
);

CREATE UNIQUE INDEX archivo_hash_idx
    ON archivo_proveedor (hash_contenido) WHERE hash_contenido IS NOT NULL;

-- Filas del archivo que no se pudieron resolver (por ejemplo, un
-- domicilio que no matchea con ningún comercio). Es la bandeja de
-- excepciones que se resuelve antes de publicar la hoja de ruta.
CREATE TABLE excepcion_importacion (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    archivo_id          bigint      NOT NULL REFERENCES archivo_proveedor(id) ON DELETE CASCADE,
    nro_fila            integer,
    motivo              text        NOT NULL,
    datos_crudos        jsonb       NOT NULL,
    comercio_sugerido_id bigint     REFERENCES comercio(id),
    resuelta            boolean     NOT NULL DEFAULT false,
    resuelta_por        bigint      REFERENCES usuario(id),
    resuelta_en         timestamptz,
    CONSTRAINT excepcion_resolucion_coherente
        CHECK (NOT resuelta OR (resuelta_por IS NOT NULL AND resuelta_en IS NOT NULL))
);

-- Un remito pertenece SIEMPRE a una sola marca. Una visita a un comercio
-- puede tener varios remitos, uno por cada marca que se entrega ahí.
CREATE TABLE remito (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marca_id            bigint      NOT NULL REFERENCES marca(id),
    comercio_id         bigint      NOT NULL REFERENCES comercio(id),
    sucursal_id         bigint      NOT NULL REFERENCES sucursal(id),
    archivo_id          bigint      REFERENCES archivo_proveedor(id),  -- NULL = carga manual
    numero              text        NOT NULL,
    fecha_emision       date,
    entregado_en        timestamptz,
    entregado_por       bigint      REFERENCES usuario(id),
    latitud             numeric(9,6),
    longitud            numeric(9,6),
    importe_centavos    bigint      NOT NULL,
    estado              text        NOT NULL DEFAULT 'pendiente',
    motivo_no_entrega   text,
    creado_por          bigint      REFERENCES usuario(id),
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT remito_numero_unico_por_marca UNIQUE (marca_id, numero),
    CONSTRAINT remito_importe_positivo CHECK (importe_centavos > 0),
    CONSTRAINT remito_estado_valido
        CHECK (estado IN ('pendiente','en_ruta','entregado','no_entregado','anulado','devuelto')),
    CONSTRAINT remito_motivo_si_no_entregado
        CHECK (estado <> 'no_entregado' OR motivo_no_entrega IS NOT NULL)
);

CREATE OR REPLACE FUNCTION registrar_entrega_remito() RETURNS trigger AS $$
BEGIN
    IF NEW.estado = 'entregado' THEN
        NEW.entregado_en := COALESCE(NEW.entregado_en, OLD.entregado_en, now());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS remito_entrega_fecha ON remito;
CREATE TRIGGER remito_entrega_fecha
    BEFORE INSERT OR UPDATE ON remito
    FOR EACH ROW EXECUTE FUNCTION registrar_entrega_remito();

CREATE INDEX remito_comercio_idx ON remito (comercio_id);
CREATE INDEX remito_marca_idx    ON remito (marca_id);
CREATE INDEX remito_estado_idx   ON remito (estado) WHERE estado IN ('pendiente','en_ruta');

-- Detalle del remito. Sin precio unitario: el cliente no necesita
-- valorizar por posición, solo conocer qué se entregó.
CREATE TABLE posicion_remito (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    remito_id       bigint  NOT NULL REFERENCES remito(id) ON DELETE CASCADE,
    nro_posicion    integer NOT NULL,
    descripcion     text    NOT NULL,
    cantidad        numeric(12,3) NOT NULL,
    unidad          text,
    CONSTRAINT posicion_unica_por_remito UNIQUE (remito_id, nro_posicion),
    CONSTRAINT posicion_cantidad_positiva CHECK (cantidad > 0)
);


-- =====================================================================
--  4. HOJA DE RUTA Y VISITAS
-- =====================================================================

CREATE TABLE hoja_de_ruta (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sucursal_id     bigint      NOT NULL REFERENCES sucursal(id),
    transportista_id bigint     REFERENCES usuario(id),
    fecha_reparto   date        NOT NULL,
    patente         text,
    estado          text        NOT NULL DEFAULT 'borrador',
    armada_por      bigint      REFERENCES usuario(id),
    publicada_en    timestamptz,
    cerrada_en      timestamptz,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hoja_estado_valido
        CHECK (estado IN ('borrador','pendiente_de_despacho','publicada','en_curso','cerrada','anulada'))
);

ALTER TABLE hoja_de_ruta DROP CONSTRAINT IF EXISTS hoja_estado_valido;
ALTER TABLE hoja_de_ruta ADD CONSTRAINT hoja_estado_valido
    CHECK (estado IN ('borrador','pendiente_de_despacho','publicada','en_curso','cerrada','anulada'));

CREATE INDEX hoja_fecha_idx ON hoja_de_ruta (fecha_reparto, sucursal_id);

-- Una visita agrupa todos los remitos a entregar en un comercio.
-- El orden lo define una persona; el sistema no lo calcula.
-- NOTA HU #12: hoja_de_ruta_id y orden son opcionales para permitir agrupar remitos en visitas
-- antes de definir la asignación final de la hoja de ruta.
CREATE TABLE visita (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hoja_de_ruta_id     bigint      REFERENCES hoja_de_ruta(id) ON DELETE CASCADE,
    comercio_id         bigint      NOT NULL REFERENCES comercio(id),
    orden               integer,
    estado              text        NOT NULL DEFAULT 'pendiente',
    sincronizacion_pendiente boolean NOT NULL DEFAULT false,
    cobrada_en          timestamptz,
    -- Ubicación, fecha y hora reales de la operación. Pedido explícito
    -- del cliente; no reemplaza el seguimiento en vivo del camión.
    registrada_en       timestamptz,
    latitud             numeric(9,6),
    longitud            numeric(9,6),
    precision_metros    numeric(7,1),
    gps_disponible      boolean,
    observacion         text,
    CONSTRAINT visita_estado_valido
        CHECK (estado IN ('pendiente','en_curso','completada','no_realizada')),
    CONSTRAINT visita_coords_completas
        CHECK ((latitud IS NULL) = (longitud IS NULL))
);

CREATE UNIQUE INDEX visita_orden_unico_idx
    ON visita (hoja_de_ruta_id, orden) WHERE hoja_de_ruta_id IS NOT NULL AND orden IS NOT NULL;
CREATE UNIQUE INDEX visita_comercio_unico_idx
    ON visita (hoja_de_ruta_id, comercio_id) WHERE hoja_de_ruta_id IS NOT NULL;

-- El remito se asigna a una visita al armar la hoja de ruta.
ALTER TABLE remito
    ADD COLUMN visita_id bigint REFERENCES visita(id) ON DELETE SET NULL;

CREATE INDEX remito_visita_idx ON remito (visita_id);


-- =====================================================================
--  5. COBROS
-- =====================================================================

CREATE TABLE cuenta_recepcion (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sucursal_id     bigint      NOT NULL REFERENCES sucursal(id),
    alias           text        NOT NULL,
    cbu             char(22),
    banco           text,
    activa          boolean     NOT NULL DEFAULT true,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cuenta_alias_unico UNIQUE (sucursal_id, alias),
    CONSTRAINT cuenta_cbu_formato CHECK (cbu IS NULL OR cbu ~ '^[0-9]{22}$')
);
-- PENDIENTE: la cardinalidad sucursal–cuenta no quedó cerrada en la
-- entrevista. El modelo permite N cuentas por sucursal, que es el caso
-- más general. Si se confirma que es una sola, se agrega un índice único
-- parcial sobre (sucursal_id) WHERE activa.

-- Movimientos del extracto de la cuenta.
-- PENDIENTE: falta definir si se importan automáticamente o los carga
-- un administrativo a mano.
CREATE TABLE movimiento_bancario (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cuenta_id           bigint      NOT NULL REFERENCES cuenta_recepcion(id),
    fecha_hora          timestamptz NOT NULL,
    ordenante           text,
    ordenante_cuit      char(11),
    referencia_externa  text,
    importe_centavos    bigint      NOT NULL,
    estado              text        NOT NULL DEFAULT 'sin_imputar',
    creado_en           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT movimiento_importe_positivo CHECK (importe_centavos > 0),
    CONSTRAINT movimiento_estado_valido
        CHECK (estado IN ('sin_imputar','parcial','imputado','descartado')),
    CONSTRAINT movimiento_referencia_unica
        UNIQUE (cuenta_id, referencia_externa)
);

CREATE INDEX movimiento_pendientes_idx
    ON movimiento_bancario (cuenta_id, fecha_hora)
    WHERE estado IN ('sin_imputar','parcial');

-- Rendición física del efectivo de una jornada, validada por un supervisor.
-- Es un circuito distinto de la conciliación bancaria.
CREATE TABLE rendicion_efectivo (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hoja_de_ruta_id         bigint      NOT NULL REFERENCES hoja_de_ruta(id),
    declarado_centavos      bigint      NOT NULL DEFAULT 0,
    rendido_centavos        bigint,
    motivo_diferencia       text,
    estado                  text        NOT NULL DEFAULT 'pendiente',
    validado_por            bigint      REFERENCES usuario(id),
    validado_en             timestamptz,
    CONSTRAINT rendicion_unica_por_hoja UNIQUE (hoja_de_ruta_id),
    CONSTRAINT rendicion_estado_valido
        CHECK (estado IN ('pendiente','validada','rechazada')),
    -- No se puede cerrar una rendición con diferencia sin explicar por qué.
    CONSTRAINT rendicion_motivo_si_hay_diferencia
        CHECK (
            estado <> 'validada'
            OR rendido_centavos = declarado_centavos
            OR motivo_diferencia IS NOT NULL
        ),
    CONSTRAINT rendicion_validacion_coherente
        CHECK (estado = 'pendiente' OR (validado_por IS NOT NULL AND validado_en IS NOT NULL))
);

-- Un cobro cuelga de la VISITA, no del remito: en una visita se puede
-- pagar con varios medios a la vez. La relación con los remitos que
-- salda se resuelve en la tabla imputacion.
CREATE TABLE cobro (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    visita_id               bigint      NOT NULL REFERENCES visita(id) ON DELETE CASCADE,
    medio_pago              text        NOT NULL,
    importe_centavos        bigint      NOT NULL,
    registrado_en           timestamptz NOT NULL,
    latitud                 numeric(9,6),
    longitud                numeric(9,6),
    registrado_por          bigint      NOT NULL REFERENCES usuario(id),
    -- Para transferencia y QR: el movimiento del extracto que lo respalda.
    movimiento_bancario_id  bigint      REFERENCES movimiento_bancario(id),
    -- Para efectivo: la rendición física en la que entra.
    rendicion_id            bigint      REFERENCES rendicion_efectivo(id),
    referencia_transferencia text,
    estado                  text        NOT NULL DEFAULT 'pendiente',
    -- Idempotencia de la sincronización offline: el móvil genera esta
    -- clave y un reenvío tras una caída de red no duplica el cobro.
    clave_idempotencia      uuid        NOT NULL,
    sincronizado_en         timestamptz,
    creado_en               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cobro_clave_unica UNIQUE (clave_idempotencia),
    CONSTRAINT cobro_importe_positivo CHECK (importe_centavos > 0),
    CONSTRAINT cobro_medio_valido
        CHECK (medio_pago IN ('efectivo','transferencia','qr')),
    CONSTRAINT cobro_estado_valido
        CHECK (estado IN ('pendiente','validado','rechazado')),
    CONSTRAINT cobro_coords_completas
        CHECK ((latitud IS NULL) = (longitud IS NULL)),
    -- El efectivo no se concilia contra el banco y viceversa.
    CONSTRAINT cobro_respaldo_coherente CHECK (
        (medio_pago = 'efectivo'  AND movimiento_bancario_id IS NULL)
     OR (medio_pago <> 'efectivo' AND rendicion_id IS NULL)
    )
);

CREATE INDEX cobro_visita_idx      ON cobro (visita_id);
CREATE INDEX IF NOT EXISTS cobro_referencia_idx  ON cobro (referencia_transferencia)
    WHERE referencia_transferencia IS NOT NULL;
CREATE INDEX cobro_movimiento_idx  ON cobro (movimiento_bancario_id);
CREATE INDEX cobro_rendicion_idx   ON cobro (rendicion_id);

-- Comprobante adjunto (foto del recibo, captura de la transferencia).
CREATE TABLE comprobante (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cobro_id        bigint      NOT NULL REFERENCES cobro(id) ON DELETE CASCADE,
    tipo_mime       text        NOT NULL,
    ruta_archivo    text        NOT NULL,   -- el binario vive fuera de la base
    tamano_bytes    bigint,
    subido_en       timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
--  6. IMPUTACIÓN  (el corazón del sistema)
-- =====================================================================

-- Relación N a N entre cobros o movimientos bancarios y remitos.
-- Una transferencia consolidada puede saldar varios remitos directamente.
CREATE TABLE imputacion (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cobro_id            bigint      REFERENCES cobro(id)  ON DELETE CASCADE,
    movimiento_bancario_id bigint    REFERENCES movimiento_bancario(id),
    remito_id           bigint      NOT NULL REFERENCES remito(id) ON DELETE CASCADE,
    importe_centavos    bigint      NOT NULL,
    imputado_por        bigint      NOT NULL REFERENCES usuario(id),
    imputado_en         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT imputacion_origen_unico CHECK ((cobro_id IS NULL) <> (movimiento_bancario_id IS NULL)),
    CONSTRAINT imputacion_importe_positivo CHECK (importe_centavos > 0)
);

CREATE UNIQUE INDEX imputacion_cobro_remito_unica
    ON imputacion (cobro_id, remito_id) WHERE cobro_id IS NOT NULL;
CREATE UNIQUE INDEX imputacion_movimiento_remito_unica
    ON imputacion (movimiento_bancario_id, remito_id) WHERE movimiento_bancario_id IS NOT NULL;
CREATE INDEX imputacion_remito_idx ON imputacion (remito_id);

CREATE TABLE discrepancia_conciliacion (
    id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    movimiento_id        bigint      NOT NULL REFERENCES movimiento_bancario(id),
    movimiento_ids       bigint[]    NOT NULL DEFAULT '{}',
    remito_ids           bigint[]    NOT NULL,
    importe_movimiento   bigint      NOT NULL,
    importe_seleccionado bigint      NOT NULL,
    diferencia_centavos  bigint      NOT NULL,
    nota                 text        NOT NULL,
    estado               text        NOT NULL DEFAULT 'pendiente',
    creada_por           bigint      NOT NULL REFERENCES usuario(id),
    creada_en            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT discrepancia_montos CHECK (diferencia_centavos <> 0),
    CONSTRAINT discrepancia_nota_no_vacia CHECK (length(trim(nota)) > 0),
    CONSTRAINT discrepancia_estado_valido CHECK (estado IN ('pendiente','resuelta'))
);
ALTER TABLE discrepancia_conciliacion
    ADD COLUMN IF NOT EXISTS movimiento_ids bigint[] NOT NULL DEFAULT '{}';
UPDATE discrepancia_conciliacion
SET movimiento_ids = ARRAY[movimiento_id]
WHERE cardinality(movimiento_ids) = 0;
CREATE UNIQUE INDEX discrepancia_pendiente_unica_por_movimiento
    ON discrepancia_conciliacion (movimiento_id) WHERE estado = 'pendiente';

-- OJO: estas reglas NO se pueden expresar con un CHECK, porque son
-- agregados sobre varias filas. Van por trigger o en la capa de negocio,
-- siempre dentro de la misma transacción que inserta la imputación:
--   a) SUM(imputacion.importe) por cobro_id <= cobro.importe_centavos
--   b) SUM(imputacion.importe) por movimiento_bancario_id <= importe_centavos
--   c) SUM(imputacion.importe) por remito_id <= remito.importe_centavos
-- Sin esto se puede imputar plata que no existe.

-- Vista de saldos, para la pantalla de conciliación.
CREATE VIEW remito_saldo AS
SELECT  r.id                AS remito_id,
        r.comercio_id,
        r.marca_id,
        r.importe_centavos,
        COALESCE(SUM(i.importe_centavos), 0)                      AS imputado_centavos,
        r.importe_centavos - COALESCE(SUM(i.importe_centavos), 0) AS saldo_centavos,
        CASE
            WHEN r.importe_centavos = COALESCE(SUM(i.importe_centavos), 0) THEN 'saldado'
            WHEN COALESCE(SUM(i.importe_centavos), 0) > 0 THEN 'parcial'
            ELSE 'pendiente'
        END AS estado_cobro
FROM    remito r
LEFT JOIN imputacion i ON i.remito_id = r.id
GROUP BY r.id;


-- =====================================================================
--  7. LIQUIDACIÓN A LA MARCA
-- =====================================================================

CREATE TABLE liquidacion (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marca_id            bigint      NOT NULL REFERENCES marca(id),
    sucursal_id         bigint      NOT NULL REFERENCES sucursal(id),
    periodo_desde       date        NOT NULL,
    periodo_hasta       date        NOT NULL,
    importe_centavos    bigint      NOT NULL DEFAULT 0,
    estado              text        NOT NULL DEFAULT 'abierta',
    generada_por        bigint      REFERENCES usuario(id),
    generada_en         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT liquidacion_periodo_valido CHECK (periodo_hasta >= periodo_desde),
    CONSTRAINT liquidacion_estado_valido
        CHECK (estado IN ('abierta','cerrada','rendida'))
);

CREATE TABLE liquidacion_detalle (
    liquidacion_id      bigint NOT NULL REFERENCES liquidacion(id) ON DELETE CASCADE,
    imputacion_id       bigint NOT NULL REFERENCES imputacion(id),
    PRIMARY KEY (liquidacion_id, imputacion_id)
);
-- Una imputación se rinde una sola vez.
CREATE UNIQUE INDEX liquidacion_detalle_imputacion_unica
    ON liquidacion_detalle (imputacion_id);


-- =====================================================================
--  8. AUDITORÍA
-- =====================================================================

-- Bitácora de toda operación sobre plata. Es append-only: la aplicación
-- se conecta con un rol que tiene INSERT y SELECT, pero no UPDATE ni
-- DELETE sobre esta tabla. Sin eso, la auditoría no respalda nada.
CREATE TABLE auditoria (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entidad         text        NOT NULL,     -- 'cobro', 'imputacion', 'rendicion_efectivo', ...
    entidad_id      bigint      NOT NULL,
    accion          text        NOT NULL,     -- 'alta', 'modificacion', 'validacion', 'anulacion'
    usuario_id      bigint      NOT NULL REFERENCES usuario(id),
    ocurrido_en     timestamptz NOT NULL DEFAULT now(),
    ip_origen       inet,
    valores_antes   jsonb,
    valores_despues jsonb,
    observacion     text
);

CREATE INDEX auditoria_entidad_idx ON auditoria (entidad, entidad_id);
CREATE INDEX auditoria_fecha_idx   ON auditoria (ocurrido_en);
CREATE INDEX auditoria_usuario_idx ON auditoria (usuario_id);

-- Ejemplo del rol de aplicación (ajustar el nombre al del proyecto):
--   CREATE ROLE app_distribuidora LOGIN PASSWORD '...';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--       TO app_distribuidora;
--   REVOKE UPDATE, DELETE ON auditoria FROM app_distribuidora;


-- =====================================================================
--  9. CATÁLOGO INICIAL DE PERMISOS
-- =====================================================================

INSERT INTO permiso (codigo, descripcion) VALUES
    ('comercio.ver',        'Consultar comercios'),
    ('comercio.editar',     'Dar de alta y modificar comercios'),
    ('archivo.importar',    'Importar archivos de proveedor'),
    ('excepcion.resolver',  'Resolver excepciones de importación'),
    ('hoja_ruta.armar',     'Armar y ordenar hojas de ruta'),
    ('hoja_ruta.publicar',  'Publicar una hoja de ruta al transportista'),
    ('remito.cargar',       'Cargar entregas manuales'),
    ('cobro.registrar',     'Registrar cobros desde la aplicación móvil'),
    ('imputacion.crear',    'Imputar cobros a remitos'),
    ('imputacion.anular',   'Anular una imputación existente'),
    ('efectivo.validar',    'Validar la rendición física de efectivo'),
    ('liquidacion.generar', 'Generar liquidaciones a las marcas'),
    ('reporte.ver',         'Consultar reportes e indicadores'),
    ('usuario.administrar', 'Administrar usuarios y permisos');

COMMIT;
