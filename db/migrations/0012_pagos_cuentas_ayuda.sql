-- =============================================================================
-- 0012 · Pagos que se pueden comprobar, cuentas que el equipo corrige o elimina, y letra chica
-- - payments y billing_payments: a nombre de quién sale el pago y, en Yape, el código de seguridad
--   de 3 dígitos (el mismo sale en el detalle del movimiento de quien cobra). En los pagos a Mesagri,
--   además la captura y cómo estaba la membresía antes del pago (si el pago no aparece en el
--   extracto, la membresía vuelve a eso).
-- - Cuentas eliminadas por el equipo (Ley 29733, derecho de cancelación): estado DELETED, sin
--   celular ni datos personales. Quedan los pedidos y pagos sin su nombre.
-- - Letra chica (0,90) en las preferencias de cada persona.
-- =============================================================================

ALTER TABLE payments
  ADD COLUMN payer_name VARCHAR(120) NULL COMMENT 'A nombre de quién sale el pago (como lo ve quien cobra)' AFTER operation_code,
  ADD COLUMN security_code CHAR(3) NULL COMMENT 'Yape: código de seguridad de 3 dígitos de la constancia' AFTER payer_name;

ALTER TABLE billing_payments
  ADD COLUMN payer_name VARCHAR(120) NULL COMMENT 'A nombre de quién sale el pago' AFTER operation_number,
  ADD COLUMN security_code CHAR(3) NULL COMMENT 'Yape: código de seguridad de 3 dígitos' AFTER payer_name,
  ADD COLUMN proof_file_uuid VARCHAR(80) NULL COMMENT 'Captura de la constancia' AFTER security_code,
  ADD COLUMN revert_data JSON NULL COMMENT 'Membresía: cómo estaba antes del pago (si no aparece en el extracto, vuelve a eso)' AFTER proof_file_uuid;

ALTER TABLE subscription_invoices
  ADD COLUMN reconcile_note VARCHAR(500) NULL COMMENT 'Por qué el equipo no encontró el pago (lo lee la MYPE)' AFTER status;

-- Cuentas eliminadas: sin celular (queda libre para otra cuenta) y con su estado propio
ALTER TABLE users
  MODIFY phone_e164 VARCHAR(16) NULL COMMENT '+51 y 9 dígitos (vacío si la cuenta se eliminó)',
  MODIFY status ENUM('ACTIVE','SUSPENDED','DELETED') NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE organizations
  MODIFY status ENUM('ACTIVE','SUSPENDED','DELETED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN deleted_reason VARCHAR(500) NULL COMMENT 'Por qué el equipo eliminó la cuenta' AFTER deleted_at;

-- Letra chica
ALTER TABLE user_preferences DROP CHECK ck_user_preferences_scale;
ALTER TABLE user_preferences ADD CONSTRAINT ck_user_preferences_scale CHECK (text_scale IN (0.90, 1.00, 1.25, 1.50));

-- La MYPE de ejemplo (Doña Charo) empieza con la letra normal, como las demás cuentas
UPDATE user_preferences up JOIN users u ON u.id = up.user_id SET up.text_scale = 1.00 WHERE u.uuid = 'u-charo' AND up.text_scale = 1.25;
