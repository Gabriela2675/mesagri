-- =============================================================================
-- 0010 · Equipo de Mesagri: la administración general crea las cuentas del panel
-- La persona recibe una clave temporal (vence en 3 días). En su primer ingreso crea su propia
-- contraseña y activa su doble factor en su celular: nadie más conoce ninguno de los dos.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN password_temp TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Clave temporal: al entrar se crea la propia y se activa el doble factor' AFTER password_hash,
  ADD COLUMN password_temp_until DATETIME(3) NULL COMMENT 'Vencimiento de la clave temporal' AFTER password_temp;

-- El equipo de Mesagri se conserva al reiniciar la demo: quién es, su rol y sus claves.
CREATE TABLE team_accounts (
  user_uuid           VARCHAR(80)    NOT NULL,
  profile             JSON           NOT NULL COMMENT 'Nombre, cómo se le llama, correo, celular, rol y estado',
  password_hash       VARCHAR(200)   NULL COMMENT 'Argon2id (sin clave: cuenta de prueba de la demo)',
  password_temp       TINYINT(1)     NOT NULL DEFAULT 0,
  password_temp_until DATETIME(3)    NULL,
  totp_secret_enc     VARBINARY(255) NULL COMMENT 'Secreto del doble factor, cifrado con AES-256-GCM',
  updated_at          DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_uuid)
) COMMENT='Equipo del panel: se vuelve a poner después de reiniciar la demo';
