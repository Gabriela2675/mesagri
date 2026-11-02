-- =============================================================================
-- MESAGRI · Migración 0003
-- Comunicación y reputación, soporte y cumplimiento (13.3, R1 y R2).
-- =============================================================================

CREATE TABLE conversations (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           VARCHAR(80)  NOT NULL COMMENT 'Clave de la conversación: el pedido (so-...) o la consulta (ticket:...)',
  kind           ENUM('PEDIDO','CONSULTA') NOT NULL,
  sub_order_id   BIGINT UNSIGNED NULL,
  buyer_org_id   BIGINT UNSIGNED NULL,
  seller_org_id  BIGINT UNSIGNED NULL,
  ticket_uuid    VARCHAR(80)  NULL,
  position       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_conversations_uuid (uuid),
  CONSTRAINT fk_conversations_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_buyer FOREIGN KEY (buyer_org_id) REFERENCES organizations (id) ON DELETE SET NULL,
  CONSTRAINT fk_conversations_seller FOREIGN KEY (seller_org_id) REFERENCES organizations (id) ON DELETE SET NULL
) COMMENT='Chat por pedido (también por WebSocket)';

CREATE TABLE messages (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  conversation_id  BIGINT UNSIGNED NOT NULL,
  sender_user_id   BIGINT UNSIGNED NULL,
  sender_uuid      VARCHAR(80)  NOT NULL,
  msg_type         ENUM('TEXTO','RAPIDA') NOT NULL DEFAULT 'TEXTO',
  template_key     VARCHAR(40)  NULL COMMENT 'Respuesta rápida traducida (q.hora, q.llego7...)',
  body             TEXT         NOT NULL,
  sent_at          DATETIME(3)  NOT NULL,
  position         INT          NOT NULL DEFAULT 0,
  deleted_at       DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_messages_conv_uuid (conversation_id, uuid),
  KEY ix_messages_conv (conversation_id, position),
  CONSTRAINT fk_messages_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users (id) ON DELETE SET NULL
) COMMENT='Mensajes';

CREATE TABLE reviews (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              VARCHAR(80)  NOT NULL,
  sub_order_id      BIGINT UNSIGNED NOT NULL,
  direction         ENUM('BUYER','SELLER') NOT NULL COMMENT 'BUYER = la MYPE califica al agricultor',
  reviewer_org_id   BIGINT UNSIGNED NOT NULL,
  reviewee_org_id   BIGINT UNSIGNED NOT NULL,
  rating            TINYINT      NOT NULL,
  tags              JSON         NOT NULL,
  comment           TEXT         NULL,
  status            ENUM('OCULTA','PUBLICADA') NOT NULL DEFAULT 'OCULTA' COMMENT 'Doble ciego: se publican juntas o a los 7 días (RN-12)',
  reply             TEXT         NULL,
  created_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reviews_uuid (uuid),
  UNIQUE KEY uk_reviews_sub_direction (sub_order_id, direction),
  KEY ix_reviews_reviewee (reviewee_org_id, status),
  CONSTRAINT fk_reviews_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id),
  CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_reviews_reviewee FOREIGN KEY (reviewee_org_id) REFERENCES organizations (id),
  CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) COMMENT='Calificaciones de cada pedido';

CREATE TABLE organization_stats (
  organization_id         BIGINT UNSIGNED NOT NULL,
  rating_avg              DECIMAL(3,2) NULL COMMENT 'Calculado de las calificaciones publicadas',
  ratings_count           INT          NOT NULL DEFAULT 0,
  orders_completed        INT          NOT NULL DEFAULT 0,
  on_time_rate            DECIMAL(5,4) NULL,
  completed_sales         INT          NOT NULL DEFAULT 0 COMMENT 'Ventas conformes (base de la comisión, RN-14)',
  free_sales_used         INT          NOT NULL DEFAULT 0 COMMENT 'Cuántas de las 5 sin comisión ya se usaron',
  completed_purchases     INT          NOT NULL DEFAULT 0,
  late_cancels            INT          NOT NULL DEFAULT 0,
  seller_cancels          INT          NOT NULL DEFAULT 0,
  expired_orders          INT          NOT NULL DEFAULT 0,
  response_minutes_total  INT          NOT NULL DEFAULT 0,
  responses               INT          NOT NULL DEFAULT 0,
  on_time                 INT          NOT NULL DEFAULT 0,
  deliveries              INT          NOT NULL DEFAULT 0,
  disputes_lost           INT          NOT NULL DEFAULT 0,
  base_rating             JSON         NULL COMMENT 'Reputación importada de antes del piloto {avg, count}',
  PRIMARY KEY (organization_id),
  CONSTRAINT fk_org_stats_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT ck_org_stats_free CHECK (free_sales_used BETWEEN 0 AND 100)
) COMMENT='Contadores de reputación, comisión y alertas';

CREATE TABLE notifications (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  audience         ENUM('ORG','EQUIPO') NOT NULL DEFAULT 'ORG',
  recipient        VARCHAR(80)  NOT NULL COMMENT 'uuid de la organización o ADMIN (equipo)',
  organization_id  BIGINT UNSIGNED NULL,
  kind             ENUM('ORDER','PAYMENT','DELIVERY','VERIFICATION','BILLING','STORAGE','SHIPMENT','REVIEW','SYSTEM','PRICE') NOT NULL,
  title            VARCHAR(255) NOT NULL,
  body             TEXT         NOT NULL,
  link             JSON         NULL COMMENT 'Enlace profundo a la pantalla',
  created_at       DATETIME(3)  NOT NULL,
  seq              INT UNSIGNED NOT NULL,
  read_at          DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notifications_uuid (uuid),
  KEY ix_notifications_org (organization_id, created_at),
  KEY ix_notifications_seq (seq),
  CONSTRAINT fk_notifications_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT ck_notifications_audience CHECK (audience = 'EQUIPO' OR organization_id IS NOT NULL)
) COMMENT='Avisos con enlace profundo';

CREATE TABLE requests (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  buyer_org_id        BIGINT UNSIGNED NOT NULL,
  catalog_product_id  INT          NOT NULL,
  quantity            DECIMAL(12,3) NOT NULL,
  max_price_per_kg    DECIMAL(12,2) NULL,
  needed_on           DATE         NOT NULL,
  status              ENUM('ABIERTA','ADJUDICADA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  created_at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_requests_uuid (uuid),
  CONSTRAINT fk_requests_buyer FOREIGN KEY (buyer_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_requests_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id)
) COMMENT='Solicitudes de compra (R2, mercado inverso)';

CREATE TABLE request_offers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           VARCHAR(80)  NOT NULL,
  request_id     BIGINT UNSIGNED NOT NULL,
  seller_org_id  BIGINT UNSIGNED NOT NULL,
  unit_price     DECIMAL(12,2) NOT NULL,
  status         ENUM('ENVIADA','ACEPTADA','RECHAZADA') NOT NULL DEFAULT 'ENVIADA',
  created_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_request_offers_uuid (uuid),
  CONSTRAINT fk_request_offers_request FOREIGN KEY (request_id) REFERENCES requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_request_offers_seller FOREIGN KEY (seller_org_id) REFERENCES organizations (id)
) COMMENT='Ofertas a una solicitud de compra (R2)';

-- ---------- Soporte y cumplimiento ----------

CREATE TABLE support_tickets (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  ticket_number    VARCHAR(20)  NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NULL,
  category         VARCHAR(120) NOT NULL,
  body             TEXT         NOT NULL,
  status           ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  created_at       DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_support_tickets_uuid (uuid),
  UNIQUE KEY uk_support_tickets_number (ticket_number),
  KEY ix_support_tickets_status (status, created_at),
  CONSTRAINT fk_support_tickets_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_support_tickets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) COMMENT='Consultas a Soporte';

CREATE TABLE ticket_messages (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id    BIGINT UNSIGNED NOT NULL,
  author_uuid  VARCHAR(80)  NOT NULL,
  body         TEXT         NOT NULL,
  sent_at      DATETIME(3)  NOT NULL,
  position     SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_ticket_messages_ticket (ticket_id, position),
  CONSTRAINT fk_ticket_messages_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE
) COMMENT='Respuestas de una consulta';

CREATE TABLE complaint_book_entries (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              VARCHAR(80)  NOT NULL,
  complaint_number  VARCHAR(10)  NOT NULL COMMENT 'Correlativo (RN-20)',
  kind              ENUM('RECLAMO','QUEJA') NOT NULL,
  organization_id   BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NULL,
  related_service   VARCHAR(300) NOT NULL,
  amount            DECIMAL(12,2) NULL,
  detail            TEXT         NOT NULL,
  consumer_request  TEXT         NOT NULL,
  submitted_at      DATETIME(3)  NOT NULL,
  response_due_at   DATETIME(3)  NOT NULL COMMENT '15 días hábiles',
  status            ENUM('OPEN','ANSWERED') NOT NULL DEFAULT 'OPEN',
  answer            TEXT         NULL,
  answered_at       DATETIME(3)  NULL,
  answered_by       BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_complaints_uuid (uuid),
  UNIQUE KEY uk_complaints_number (complaint_number),
  KEY ix_complaints_due (status, response_due_at),
  CONSTRAINT fk_complaints_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_complaints_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_complaints_answered FOREIGN KEY (answered_by) REFERENCES users (id) ON DELETE SET NULL
) COMMENT='Libro de Reclamaciones virtual (D. S. 011-2011-PCM)';

CREATE TABLE reports (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid               VARCHAR(80)  NOT NULL,
  reporter_user_id   BIGINT UNSIGNED NOT NULL,
  target_type        ENUM('LISTING','ORGANIZATION','MESSAGE','REVIEW') NOT NULL,
  target_uuid        VARCHAR(80)  NOT NULL,
  reason             VARCHAR(200) NOT NULL,
  status             ENUM('ABIERTA','REVISADA','DESCARTADA') NOT NULL DEFAULT 'ABIERTA',
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reports_uuid (uuid),
  CONSTRAINT fk_reports_user FOREIGN KEY (reporter_user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Denuncias de publicaciones o usuarios';

CREATE TABLE audit_logs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           VARCHAR(80)  NOT NULL,
  actor_user_id  BIGINT UNSIGNED NULL,
  actor_uuid     VARCHAR(80)  NOT NULL COMMENT 'uuid del usuario o system',
  action         VARCHAR(60)  NOT NULL,
  entity_type    VARCHAR(160) NOT NULL,
  detail         TEXT         NOT NULL,
  before_data    JSON         NULL,
  after_data     JSON         NULL,
  created_at     DATETIME(3)  NOT NULL,
  seq            INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_audit_logs_uuid (uuid),
  KEY ix_audit_logs_seq (seq),
  KEY ix_audit_logs_actor (actor_user_id, created_at),
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) COMMENT='Auditoría: cada decisión la toma una persona y queda registrada';

CREATE TABLE idempotency_keys (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  key_value      VARCHAR(80)  NOT NULL COMMENT 'Encabezado Idempotency-Key o id de la acción creada en el celular',
  user_id        BIGINT UNSIGNED NULL,
  request_hash   CHAR(64)     NOT NULL,
  status_code    SMALLINT     NOT NULL,
  response       JSON         NOT NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_idempotency_keys (key_value),
  KEY ix_idempotency_expires (expires_at),
  CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Reintentos sin duplicar (cola sin conexión, 14.5)';
