-- =============================================================================
-- 0014 · Revisión de cada publicación antes de verse en el catálogo
-- 1) revisión automática: reglas (precio, cantidad, fotos, cosecha, historial) y, si el servidor
--    tiene ANTHROPIC_API_KEY, una IA que mira las fotos;
-- 2) el equipo la aprueba, pide cambios o la rechaza (panel W-06);
-- 3) recién entonces se publica.
-- =============================================================================

ALTER TABLE listings
  ADD COLUMN review JSON NULL COMMENT 'Revisión antes de publicar: automática (IA o reglas) y aprobación del equipo' AFTER review_flags;

CREATE TABLE ai_reviews (
  id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  listing_uuid  VARCHAR(80)      NOT NULL,
  queued_at     DATETIME(3)      NOT NULL COMMENT 'Versión de la publicación que se revisó',
  model         VARCHAR(60)      NOT NULL,
  verdict       ENUM('OK','OBSERVAR','RECHAZAR') NULL,
  score         TINYINT UNSIGNED NULL,
  photos        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Fotos que miró',
  input_tokens  INT UNSIGNED     NULL,
  output_tokens INT UNSIGNED     NULL,
  duration_ms   INT UNSIGNED     NULL,
  error         VARCHAR(300)     NULL,
  created_at    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ai_reviews_day (created_at),
  KEY ix_ai_reviews_listing (listing_uuid)
) ENGINE=InnoDB COMMENT='Cada revisión con IA: para ver el costo y aplicar el tope diario';
