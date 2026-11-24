-- =============================================================================
-- 0015 · Primer filtro con Machine Learning en cada publicación
-- Un modelo de visión (CLIP ViT-B/32, en el mismo servidor, sin costo por foto) mira las fotos:
-- ¿muestran el producto que se publica? Le deja al equipo una recomendación (publicar, revisar o
-- no publicar) con los motivos. El resultado va en listings.review (JSON); aquí queda cada corrida
-- y el vector de cada foto para encontrar fotos copiadas de otra publicación.
-- =============================================================================

CREATE TABLE ml_reviews (
  id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  listing_uuid  VARCHAR(80)      NOT NULL,
  queued_at     DATETIME(3)      NOT NULL COMMENT 'Versión de la publicación que se revisó',
  model         VARCHAR(80)      NOT NULL,
  decision      ENUM('PUBLICAR','REVISAR','NO_PUBLICAR') NULL,
  confidence    TINYINT UNSIGNED NULL,
  photos        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Fotos que analizó',
  duration_ms   INT UNSIGNED     NULL,
  error         VARCHAR(300)     NULL,
  created_at    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ml_reviews_day (created_at),
  KEY ix_ml_reviews_listing (listing_uuid)
) ENGINE=InnoDB COMMENT='Cada revisión de fotos con el modelo de Machine Learning';

CREATE TABLE ml_photo_vectors (
  file_uuid     VARCHAR(80)      NOT NULL,
  listing_uuid  VARCHAR(80)      NOT NULL,
  org_uuid      VARCHAR(80)      NOT NULL,
  vec           VARBINARY(1024)  NOT NULL COMMENT '512 números en float16: lo que el modelo ve en la foto',
  dhash         CHAR(16)         NULL     COMMENT 'Huella de la foto (dHash de 64 bits): casi igual si es la misma foto recomprimida o achicada',
  created_at    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (file_uuid),
  KEY ix_ml_vectors_org (org_uuid)
) ENGINE=InnoDB COMMENT='Vector de cada foto analizada: fotos casi iguales en publicaciones de otro agricultor';
