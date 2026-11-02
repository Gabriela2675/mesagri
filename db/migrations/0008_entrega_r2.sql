-- =============================================================================
-- MESAGRI · Migración 0008
-- Entrega R2 dentro del MVP: solicitudes de compra con ofertas (RF-ORD-09), pedidos programados
-- del plan Pro (RF-ORD-10), equipo y locales de la MYPE (B-23), quién publica por el agricultor
-- (A-28, RF-IDI-12) y productos nuevos del catálogo (W-09). Completa las tablas de 0003 y 0004.
-- =============================================================================

-- ---------- Publicaciones: venta hecha a la medida de una solicitud ----------
ALTER TABLE listings
  ADD COLUMN request_uuid VARCHAR(80) NULL COMMENT 'Solicitud de compra que originó esta venta (no sale en el catálogo)';

-- ---------- Solicitudes de compra ----------
ALTER TABLE requests
  ADD COLUMN code            VARCHAR(20)  NOT NULL DEFAULT '' AFTER uuid,
  ADD COLUMN buyer_user_id   BIGINT UNSIGNED NULL AFTER buyer_org_id,
  ADD COLUMN ubigeo          CHAR(6)      NULL COMMENT 'Distrito de entrega',
  ADD COLUMN address         VARCHAR(200) NULL,
  ADD COLUMN local_uuid      VARCHAR(80)  NULL,
  ADD COLUMN note            VARCHAR(300) NULL,
  ADD COLUMN closes_at       DATETIME(3)  NULL COMMENT 'Hasta cuándo recibe ofertas',
  ADD COLUMN awarded_offer_uuid VARCHAR(80) NULL,
  ADD COLUMN sub_order_uuid  VARCHAR(80)  NULL COMMENT 'Pedido que generó la oferta aceptada',
  ADD COLUMN closed_at       DATETIME(3)  NULL,
  MODIFY COLUMN needed_on    DATETIME(3)  NOT NULL COMMENT 'Día de entrega (inicio del día en Lima)',
  MODIFY COLUMN status       ENUM('ABIERTA','ADJUDICADA','CERRADA','VENCIDA') NOT NULL DEFAULT 'ABIERTA',
  ADD KEY ix_requests_open (status, closes_at),
  ADD CONSTRAINT fk_requests_user FOREIGN KEY (buyer_user_id) REFERENCES users (id),
  ADD CONSTRAINT fk_requests_ubigeo FOREIGN KEY (ubigeo) REFERENCES ubigeo (code),
  ADD CONSTRAINT ck_requests_qty CHECK (quantity > 0),
  ADD CONSTRAINT ck_requests_price CHECK (max_price_per_kg IS NULL OR max_price_per_kg > 0);

ALTER TABLE request_offers
  ADD COLUMN user_id        BIGINT UNSIGNED NULL AFTER seller_org_id,
  ADD COLUMN quantity       DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT 'Kilos ofrecidos',
  ADD COLUMN harvest_date   DATETIME(3)  NULL,
  ADD COLUMN quality        ENUM('PRIMERA','SEGUNDA','TERCERA') NOT NULL DEFAULT 'PRIMERA',
  ADD COLUMN note           VARCHAR(200) NULL,
  ADD COLUMN listing_uuid   VARCHAR(80)  NULL COMMENT 'Publicación creada al aceptar la oferta',
  ADD COLUMN position       SMALLINT     NOT NULL DEFAULT 0,
  MODIFY COLUMN status      ENUM('ENVIADA','ACEPTADA','RECHAZADA','RETIRADA') NOT NULL DEFAULT 'ENVIADA',
  ADD UNIQUE KEY uk_request_offers_request_uuid (request_id, uuid),
  ADD CONSTRAINT fk_request_offers_user FOREIGN KEY (user_id) REFERENCES users (id),
  ADD CONSTRAINT ck_request_offers_price CHECK (unit_price > 0);

-- ---------- Pedidos programados (plan Pro) ----------
ALTER TABLE order_schedules
  ADD COLUMN code             VARCHAR(20)  NOT NULL DEFAULT '' AFTER uuid,
  ADD COLUMN name             VARCHAR(60)  NOT NULL DEFAULT '',
  ADD COLUMN created_by       BIGINT UNSIGNED NULL,
  ADD COLUMN delivery_mode    ENUM('PICKUP','FARMER','CARRIER') NOT NULL DEFAULT 'FARMER',
  ADD COLUMN pay_method       ENUM('YAPE','PLIN','TRANSFER','CASH','CARD') NOT NULL DEFAULT 'YAPE',
  ADD COLUMN tax_doc          ENUM('BOLETA','FACTURA','LIQUIDACION') NOT NULL DEFAULT 'BOLETA',
  ADD COLUMN delivery_slot    VARCHAR(40)  NOT NULL DEFAULT '7:00 a 9:00',
  ADD COLUMN local_uuid       VARCHAR(80)  NULL,
  ADD COLUMN next_delivery_at DATETIME(3)  NULL COMMENT 'Próxima entrega; el pedido se arma 2 días antes',
  ADD COLUMN draft            JSON         NULL COMMENT 'Pedido armado que espera aprobación',
  ADD COLUMN history          JSON         NULL,
  ADD COLUMN created_at       DATETIME(3)  NULL,
  ADD CONSTRAINT fk_order_schedules_user FOREIGN KEY (created_by) REFERENCES users (id),
  ADD CONSTRAINT ck_order_schedules_weekday CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
  ADD CONSTRAINT ck_order_schedules_increase CHECK (max_price_increase IS NULL OR max_price_increase BETWEEN 0 AND 0.5);

ALTER TABLE order_schedule_items
  ADD COLUMN listing_uuid  VARCHAR(80)   NULL,
  ADD COLUMN unit          VARCHAR(10)   NOT NULL DEFAULT 'kg',
  ADD COLUMN unit_kg       DECIMAL(8,3)  NOT NULL DEFAULT 1,
  ADD COLUMN ref_price     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Precio al programar: base del tope de alza',
  ADD COLUMN position      SMALLINT      NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_schedule_items_qty CHECK (quantity > 0);

-- ---------- Equipo de la MYPE y quién publica por el agricultor ----------
ALTER TABLE organization_members
  ADD COLUMN member_kind  ENUM('EQUIPO','FAMILIAR','PROMOTOR','CONDUCTOR') NULL COMMENT 'NULL = titular o cuenta sin permisos aparte',
  ADD COLUMN permissions  JSON         NULL COMMENT 'PEDIR, APROBAR, PAGAR (MYPE) · PUBLICAR, PEDIDOS (agricultor)',
  ADD COLUMN active       BOOLEAN      NOT NULL DEFAULT TRUE,
  ADD COLUMN added_at     DATETIME(3)  NULL,
  ADD COLUMN added_by     BIGINT UNSIGNED NULL,
  ADD COLUMN note         VARCHAR(40)  NULL COMMENT 'Cargo o parentesco',
  ADD CONSTRAINT fk_org_members_added_by FOREIGN KEY (added_by) REFERENCES users (id);

-- ---------- Locales de la MYPE ----------
ALTER TABLE addresses
  ADD COLUMN uuid           VARCHAR(80)  NULL,
  ADD COLUMN label          VARCHAR(60)  NULL,
  ADD COLUMN receiver_name  VARCHAR(80)  NULL,
  ADD COLUMN receiving_days JSON         NULL,
  ADD COLUMN position       SMALLINT     NOT NULL DEFAULT 0,
  ADD UNIQUE KEY uk_addresses_org_uuid (organization_id, uuid);

-- ---------- Catálogo: productos que agrega el equipo ----------
ALTER TABLE catalog_products
  ADD COLUMN custom_definition JSON NULL COMMENT 'Ficha completa de un producto agregado desde el panel (W-09)',
  ADD COLUMN created_by        BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_catalog_products_user FOREIGN KEY (created_by) REFERENCES users (id);
