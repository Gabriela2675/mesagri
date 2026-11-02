-- =============================================================================
-- 0009 · Mesagri en la nube
-- - file_blobs: el contenido de fotos y documentos dentro de la base (en la nube el disco del
--   servidor se borra en cada reinicio). La fila de `files` sigue siendo la referencia y el hash.
-- - trusted_devices: celulares donde la persona ya ingresó. Sin proveedor de SMS, en la versión de
--   prueba el código se muestra en pantalla solo en esos celulares (o en las cuentas de ejemplo).
-- =============================================================================

CREATE TABLE file_blobs (
  file_id      BIGINT UNSIGNED NOT NULL,
  data         MEDIUMBLOB      NOT NULL,
  PRIMARY KEY (file_id),
  CONSTRAINT fk_file_blobs_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
) COMMENT='Contenido de los archivos (hasta 5 MB cada uno)';

CREATE TABLE trusted_devices (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  key_hash      CHAR(64)        NOT NULL COMMENT 'SHA-256 de la llave que guarda el celular',
  label         VARCHAR(80)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_trusted_devices_key (key_hash),
  KEY ix_trusted_devices_user (user_id),
  CONSTRAINT fk_trusted_devices_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Celulares de confianza de cada cuenta';
