BEGIN;

CREATE TABLE IF NOT EXISTS usuario_sucursal_permiso (
    usuario_id      bigint NOT NULL,
    sucursal_id     bigint NOT NULL,
    permiso_codigo  text   NOT NULL REFERENCES permiso(codigo) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, sucursal_id, permiso_codigo),
    FOREIGN KEY (usuario_id, sucursal_id)
        REFERENCES usuario_sucursal(usuario_id, sucursal_id) ON DELETE CASCADE
);

COMMIT;
