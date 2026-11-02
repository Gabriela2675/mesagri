-- =============================================================================
-- MESAGRI · Migración 0006
-- Tablas de soporte que agrega el MVP a las 100 del documento:
--   system_state            estado del motor de reglas (reloj de la demo, correlativos)
--   sync_events             bitácora de acciones: sincroniza los celulares y permite reintentos
--   operation_numbers       números de operación ya usados en cualquier pago (RF-PAY-05)
--   setting_change_requests cambios de configuración con segunda aprobación (RN-50, W-10)
--   sunat_ruc_registry      padrón de RUC importado de la SUNAT (RF-VER-03, tarea diaria 14.7)
-- =============================================================================

CREATE TABLE system_state (
  state_key   VARCHAR(60)  NOT NULL,
  value       JSON         NOT NULL,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (state_key)
) COMMENT='Estado del motor: reloj de la demo, correlativos, último cierre de mes';

CREATE TABLE sync_events (
  seq           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_uuid    VARCHAR(80)  NOT NULL COMMENT 'Id creado en el celular (idempotencia)',
  type          VARCHAR(40)  NOT NULL,
  actor_uuid    VARCHAR(80)  NOT NULL,
  device        VARCHAR(80)  NULL,
  payload       JSON         NOT NULL,
  simulated_at  DATETIME(3)  NOT NULL COMMENT 'Hora del reloj de la demo',
  client_at     DATETIME(3)  NULL COMMENT 'Hora en que se hizo en el celular (puede ser sin señal)',
  received_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  epoch         VARCHAR(40)  NOT NULL COMMENT 'Cambia al reiniciar la demo',
  result        JSON         NULL,
  PRIMARY KEY (seq),
  UNIQUE KEY uk_sync_events_uuid (event_uuid),
  KEY ix_sync_events_epoch (epoch, seq)
) COMMENT='Acciones aceptadas, en el orden del servidor';

CREATE TABLE operation_numbers (
  method     VARCHAR(12)  NOT NULL,
  operation  VARCHAR(40)  NOT NULL,
  ref_uuid   VARCHAR(80)  NOT NULL COMMENT 'Pedido, estado de cuenta o cobro que pagó',
  PRIMARY KEY (method, operation)
) COMMENT='Un número de operación no sirve para dos pagos (RF-PAY-05), en cualquier tabla';

CREATE TABLE setting_change_requests (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  setting_key      VARCHAR(60)  NOT NULL,
  label            VARCHAR(160) NOT NULL,
  value_from       JSON         NOT NULL,
  value_to         JSON         NOT NULL,
  reason           TEXT         NOT NULL,
  proposed_by      VARCHAR(80)  NOT NULL,
  proposed_at      DATETIME(3)  NOT NULL,
  effective_from   DATETIME(3)  NOT NULL,
  status           ENUM('PENDING','APPROVED','APPLIED','REJECTED') NOT NULL,
  approved_by      VARCHAR(80)  NULL,
  decided_at       DATETIME(3)  NULL,
  reject_reason    VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_setting_changes_uuid (uuid),
  KEY ix_setting_changes_status (status, effective_from)
) COMMENT='Cambios de comisión, plazos y topes: los propone uno y los aprueba otro (RN-50)';

CREATE TABLE sunat_ruc_registry (
  ruc            CHAR(11)     NOT NULL,
  business_name  VARCHAR(160) NOT NULL,
  status         ENUM('ACTIVO','BAJA') NOT NULL,
  ruc_condition  ENUM('HABIDO','NO HABIDO') NOT NULL,
  ubigeo         CHAR(6)      NOT NULL,
  imported_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ruc),
  CONSTRAINT ck_sunat_ruc CHECK (ruc REGEXP '^[0-9]{11}$')
) COMMENT='Padrón reducido de la SUNAT (en el piloto se importa cada madrugada)';
