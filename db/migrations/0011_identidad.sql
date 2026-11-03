-- Identidad con revisión automática: DNI y nombre (consulta a RENIEC por un proveedor o el padrón de
-- prueba de la demo), dígito de verificación, fotos del DNI y del rostro en tres ángulos, y lo que el
-- panel lee en las fotos (código del reverso del DNI, parecido del rostro).

ALTER TABLE verification_cases
  ADD COLUMN identity JSON NULL COMMENT 'DNI, nombre, fotos del DNI y del rostro (frente, derecha, izquierda) con su revisión automática' AFTER history;

CREATE TABLE identity_lookups (
  dni           CHAR(8)      NOT NULL,
  source        VARCHAR(20)  NOT NULL COMMENT 'PROVEEDOR',
  provider      VARCHAR(60)  NULL,
  found         BOOLEAN      NOT NULL,
  data          JSON         NULL COMMENT 'Apellidos y nombres oficiales; fallecido si la fuente lo informa',
  looked_up_at  DATETIME(3)  NOT NULL,
  purge_after   DATETIME(3)  NOT NULL COMMENT 'Se borra a los 30 días (Ley 29733)',
  PRIMARY KEY (dni),
  KEY ix_identity_lookups_purge (purge_after)
) COMMENT='Consultas del DNI al proveedor (cada una cuesta: se guardan 30 días)';
