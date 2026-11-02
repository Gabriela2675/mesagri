-- =============================================================================
-- MESAGRI · Migración 0002
-- Verificación, publicaciones e inventario, carrito y pedidos, pagos, entrega y disputas
-- (13.3, R1 y R2). Las fotos se referencian por su uuid (files.uuid): la app las sube
-- aparte y con reintento (14.5), así un pedido no falla si la foto llega después.
-- =============================================================================

-- ---------- Verificación ----------

CREATE TABLE verification_cases (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  organization_id     BIGINT UNSIGNED NOT NULL,
  subject             ENUM('FARMER','BUYER','CARRIER','WAREHOUSE') NOT NULL,
  target_level        TINYINT      NOT NULL COMMENT 'Nivel que pide (T y A: 1 = T1/A1, 2 = T2/A2)',
  status              ENUM('SUBMITTED','IN_REVIEW','NEEDS_INFO','APPROVED','REJECTED','APPEALED') NOT NULL,
  submitted_at        DATETIME(3)  NOT NULL,
  assigned_to         BIGINT UNSIGNED NULL,
  decided_by          BIGINT UNSIGNED NULL,
  decided_by_uuid     VARCHAR(80)  NULL COMMENT 'uuid de quien decidió',
  decision_result     ENUM('APPROVE','NEEDS_INFO','REJECT') NULL,
  decision_reason     TEXT         NULL COMMENT 'Motivo obligatorio (RF-VER-07)',
  decided_at          DATETIME(3)  NULL,
  appeal_of_case_id   BIGINT UNSIGNED NULL,
  appealed            BOOLEAN      NULL,
  history             JSON         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_verification_cases_uuid (uuid),
  KEY ix_verification_queue (status, submitted_at),
  CONSTRAINT fk_verif_cases_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_verif_cases_assigned FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_verif_cases_decided FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_verif_cases_appeal FOREIGN KEY (appeal_of_case_id) REFERENCES verification_cases (id) ON DELETE SET NULL,
  CONSTRAINT ck_verif_cases_level CHECK (target_level BETWEEN 1 AND 3),
  CONSTRAINT ck_verif_cases_reason CHECK (decision_result IS NULL OR decision_reason IS NOT NULL)
) COMMENT='Expedientes de verificación';

CREATE TABLE verification_checks (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id     BIGINT UNSIGNED NOT NULL,
  check_type  VARCHAR(160) NOT NULL COMMENT 'DNI REPETIDO, TELÉFONO REPETIDO, CUENTA DE TERCERO, RUC NO HABIDO...',
  result      ENUM('ALERTA','OK') NOT NULL DEFAULT 'ALERTA',
  evidence    JSON         NULL,
  position    SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_verif_checks_case (case_id),
  CONSTRAINT fk_verif_checks_case FOREIGN KEY (case_id) REFERENCES verification_cases (id) ON DELETE CASCADE
) COMMENT='Controles automáticos (antifraude, 10.4)';

CREATE TABLE documents (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id    BIGINT UNSIGNED NOT NULL,
  doc_type   VARCHAR(40)  NOT NULL COMMENT 'dni, selfie, cobro, padron, chacra, ruc...',
  label      VARCHAR(160) NOT NULL,
  detail     VARCHAR(500) NULL,
  file_uuid  VARCHAR(80)  NULL,
  reviewed_ok BOOLEAN     NULL,
  status     ENUM('RECIBIDO','APROBADO','OBSERVADO') NOT NULL DEFAULT 'RECIBIDO',
  position   SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_documents_case (case_id),
  CONSTRAINT fk_documents_case FOREIGN KEY (case_id) REFERENCES verification_cases (id) ON DELETE CASCADE
) COMMENT='Evidencias de un expediente';

CREATE TABLE farms (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(120) NOT NULL,
  ubigeo           CHAR(6)      NOT NULL,
  latitude         DECIMAL(9,6) NULL COMMENT 'Nunca se muestra a los compradores (RN-17)',
  longitude        DECIMAL(9,6) NULL,
  area_ha          DECIMAL(10,2) NOT NULL,
  tenure           ENUM('PROPIA','COMUNAL','ALQUILADA') NOT NULL,
  crops            JSON         NOT NULL,
  gps_source       ENUM('APP','MANUAL') NOT NULL DEFAULT 'APP',
  photos           JSON         NOT NULL,
  created_at       DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_farms_uuid (uuid),
  KEY ix_farms_org (organization_id),
  CONSTRAINT fk_farms_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_farms_ubigeo FOREIGN KEY (ubigeo) REFERENCES ubigeo (code),
  CONSTRAINT ck_farms_area CHECK (area_ha > 0)
) COMMENT='Chacras';

CREATE TABLE endorsements (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  endorser_name    VARCHAR(120) NOT NULL COMMENT 'Asociación, comunidad o agencia agraria',
  endorser_role    VARCHAR(80)  NULL,
  file_uuid        VARCHAR(80)  NULL,
  status           ENUM('RECIBIDO','VALIDADO','RECHAZADO') NOT NULL DEFAULT 'RECIBIDO',
  created_at       DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_endorsements_uuid (uuid),
  CONSTRAINT fk_endorsements_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) COMMENT='Avales (R2)';

-- ---------- Publicaciones e inventario ----------

CREATE TABLE listings (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  organization_id     BIGINT UNSIGNED NOT NULL,
  catalog_product_id  INT          NOT NULL,
  farm_id             BIGINT UNSIGNED NULL,
  variety             VARCHAR(60)  NULL,
  unit                VARCHAR(10)  NOT NULL,
  unit_kg             DECIMAL(10,3) NOT NULL COMMENT 'Kilos por unidad de venta',
  qty_total           DECIMAL(12,3) NOT NULL,
  qty_available       DECIMAL(12,3) NOT NULL,
  qty_reserved        DECIMAL(12,3) NOT NULL DEFAULT 0,
  qty_sold            DECIMAL(12,3) NOT NULL DEFAULT 0,
  min_qty             DECIMAL(12,3) NOT NULL DEFAULT 1,
  unit_price          DECIMAL(12,2) NOT NULL COMMENT 'S/ por unidad de venta (RN-06)',
  harvest_date        DATETIME(3)  NOT NULL,
  quality             ENUM('PRIMERA','SEGUNDA','TERCERA') NOT NULL,
  harvest_seal        BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Sello cosechado hoy (RN-22)',
  status              ENUM('ACTIVE','PAUSED','SOLD_OUT','EXPIRED','IN_REVIEW','REJECTED','REMOVED','QUEUED') NOT NULL,
  review_reason       VARCHAR(500) NULL,
  review_flags        JSON         NULL COMMENT 'Por qué pasó a revisión (precio fuera de rango, nivel 1)',
  lot_code            VARCHAR(40)  NULL COMMENT 'Lote verificado en almacén (RF-STO-12)',
  from_lot_uuid       VARCHAR(80)  NULL,
  created_at          DATETIME(3)  NOT NULL,
  expires_at          DATETIME(3)  NULL COMMENT 'NULL = sin vencimiento (agotada)',
  deleted_at          DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_listings_uuid (uuid),
  KEY ix_listings_lot (lot_code),
  KEY ix_listings_catalog (status, catalog_product_id, created_at),
  KEY ix_listings_org (organization_id, status),
  KEY ix_listings_expire (status, expires_at),
  CONSTRAINT fk_listings_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_listings_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id),
  CONSTRAINT fk_listings_farm FOREIGN KEY (farm_id) REFERENCES farms (id) ON DELETE SET NULL,
  CONSTRAINT fk_listings_unit FOREIGN KEY (unit) REFERENCES units (code),
  CONSTRAINT ck_listings_available CHECK (qty_available >= 0),
  CONSTRAINT ck_listings_reserved CHECK (qty_reserved >= 0),
  CONSTRAINT ck_listings_price CHECK (unit_price > 0),
  CONSTRAINT ck_listings_unit_kg CHECK (unit_kg > 0)
) COMMENT='Publicaciones con stock en contadores (los movimientos van en inventory_movements)';

CREATE TABLE listing_photos (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id  BIGINT UNSIGNED NOT NULL,
  file_uuid   VARCHAR(80)  NOT NULL,
  position    SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_listing_photos_listing (listing_id),
  CONSTRAINT fk_listing_photos_listing FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE
) COMMENT='Fotos de la cosecha';

CREATE TABLE listing_price_tiers (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id  BIGINT UNSIGNED NOT NULL,
  min_kg      DECIMAL(12,3) NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL,
  position    SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_price_tiers_listing (listing_id),
  CONSTRAINT fk_price_tiers_listing FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE,
  CONSTRAINT ck_price_tiers_price CHECK (unit_price > 0)
) COMMENT='Precio por volumen';

CREATE TABLE favorites (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  target_type      ENUM('LISTING','SELLER') NOT NULL,
  target_uuid      VARCHAR(80)  NOT NULL,
  position         SMALLINT     NOT NULL DEFAULT 0,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_favorites (organization_id, target_type, target_uuid),
  CONSTRAINT fk_favorites_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) COMMENT='Productos y proveedores favoritos de la MYPE';

CREATE TABLE inventory_movements (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id       BIGINT UNSIGNED NOT NULL,
  movement_type    ENUM('INIT','RESERVE','RELEASE','CONSUME','ADJUST') NOT NULL,
  delta_available  DECIMAL(12,3) NOT NULL,
  ref              VARCHAR(120) NULL COMMENT 'Pedido o acción que lo originó',
  sub_order_id     BIGINT UNSIGNED NULL,
  moved_at         DATETIME(3)  NOT NULL,
  seq              INT UNSIGNED NOT NULL COMMENT 'Orden en el libro',
  PRIMARY KEY (id),
  UNIQUE KEY uk_inventory_movements_seq (seq),
  KEY ix_inventory_movements_listing (listing_id, moved_at)
) COMMENT='Libro de movimientos de stock (auditoría y reconstrucción, 13.4)';

CREATE TABLE voice_drafts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid        VARCHAR(80)  NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  audio_uuid  VARCHAR(80)  NULL,
  transcript  TEXT         NULL,
  extracted   JSON         NULL COMMENT 'Producto, cantidad, unidad, precio, cosecha y calidad, con confianza por campo',
  status      ENUM('GRABADO','PROCESADO','CONFIRMADO','DESCARTADO') NOT NULL DEFAULT 'GRABADO',
  listing_id  BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)  NOT NULL,
  purge_after DATETIME(3)  NULL COMMENT 'El audio se borra a los 30 días (14.8)',
  PRIMARY KEY (id),
  UNIQUE KEY uk_voice_drafts_uuid (uuid),
  CONSTRAINT fk_voice_drafts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_voice_drafts_listing FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE SET NULL
) COMMENT='Borradores de voz procesados en el servidor (R2; en el MVP el intérprete corre en el celular)';

CREATE TABLE market_prices (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_product_id  INT          NOT NULL,
  market              VARCHAR(80)  NOT NULL,
  price_per_kg        DECIMAL(8,2) NOT NULL,
  observed_on         DATE         NOT NULL,
  source              VARCHAR(160) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_market_prices (catalog_product_id, market, observed_on),
  CONSTRAINT fk_market_prices_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id) ON DELETE CASCADE
) COMMENT='Precios de referencia (Midagri y mercados mayoristas)';

-- ---------- Carrito y pedidos ----------

CREATE TABLE carts (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_carts_user (user_id),
  CONSTRAINT fk_carts_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Carrito sincronizado del comprador';

CREATE TABLE cart_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cart_id     BIGINT UNSIGNED NOT NULL,
  listing_id  BIGINT UNSIGNED NOT NULL,
  quantity    DECIMAL(12,3) NOT NULL,
  added_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_cart_items (cart_id, listing_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts (id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_items_listing FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE,
  CONSTRAINT ck_cart_items_qty CHECK (quantity > 0)
) COMMENT='Productos en el carrito';

CREATE TABLE orders (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            VARCHAR(80)  NOT NULL,
  order_number    VARCHAR(80)  NOT NULL,
  buyer_org_id    BIGINT UNSIGNED NOT NULL,
  buyer_user_id   BIGINT UNSIGNED NULL,
  total           DECIMAL(12,2) NOT NULL,
  status          ENUM('EN_CURSO','CERRADO') NOT NULL DEFAULT 'EN_CURSO' COMMENT 'Resumen: cada agricultor tiene su propio estado en sub_orders',
  created_at      DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_uuid (uuid),
  UNIQUE KEY uk_orders_number (order_number),
  KEY ix_orders_buyer (buyer_org_id, created_at),
  CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_orders_user FOREIGN KEY (buyer_user_id) REFERENCES users (id) ON DELETE SET NULL
) COMMENT='Pedido de la MYPE (se divide en un sub-pedido por agricultor)';

CREATE TABLE sub_orders (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  code                VARCHAR(20)  NOT NULL COMMENT 'CAMP-7F2K91',
  order_id            BIGINT UNSIGNED NOT NULL,
  buyer_org_id        BIGINT UNSIGNED NOT NULL,
  seller_org_id       BIGINT UNSIGNED NOT NULL,
  buyer_user_id       BIGINT UNSIGNED NULL,
  subtotal            DECIMAL(12,2) NOT NULL,
  delivery_mode       ENUM('PICKUP','FARMER','CARRIER') NOT NULL,
  delivery_fee        DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Envío del agricultor (el flete del transportista va en shipments)',
  total               DECIMAL(12,2) NOT NULL,
  delivery_date       DATETIME(3)  NOT NULL,
  delivery_slot       VARCHAR(40)  NOT NULL,
  address_snapshot    VARCHAR(200) NOT NULL COMMENT 'Snapshot: el pedido no cambia si después cambia la dirección',
  ubigeo              CHAR(6)      NOT NULL,
  prepay              BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Pago antes de preparar (RN-24)',
  status              ENUM('PENDING_CONFIRMATION','CONFIRMED','AWAITING_HARVEST','PREPARING','READY','IN_TRANSIT','DELIVERED','COMPLETED','DISPUTED','REJECTED','EXPIRED','CANCELLED_BY_BUYER','CANCELLED_BY_SELLER') NOT NULL,
  created_at          DATETIME(3)  NOT NULL,
  confirm_by          DATETIME(3)  NOT NULL COMMENT 'Plazo para aceptar (RN-08)',
  responded_at        DATETIME(3)  NULL,
  delivered_at        DATETIME(3)  NULL,
  completed_at        DATETIME(3)  NULL,
  commission_rate     DECIMAL(6,4) NOT NULL COMMENT 'Congelada al crear (RN-14)',
  free_slot_reserved  BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Cupo sin comisión reservado al aceptar (corrige D-01)',
  sale_number         INT          NULL,
  commission          DECIMAL(12,2) NULL,
  sale_amount         DECIMAL(12,2) NULL,
  free_sale_bonus     BOOLEAN      NULL,
  reject_reason       VARCHAR(500) NULL,
  cancel_reason       VARCHAR(500) NULL,
  late_cancel         BOOLEAN      NULL,
  on_time             BOOLEAN      NULL,
  from_lot            BOOLEAN      NULL,
  dispute_uuid        VARCHAR(80)  NULL,
  shipment_uuid       VARCHAR(80)  NULL,
  review_buyer_uuid   VARCHAR(80)  NULL,
  review_seller_uuid  VARCHAR(80)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sub_orders_uuid (uuid),
  UNIQUE KEY uk_sub_orders_code (code),
  KEY ix_sub_orders_seller (seller_org_id, status, created_at),
  KEY ix_sub_orders_buyer (buyer_org_id, status, created_at),
  KEY ix_sub_orders_expire (status, confirm_by),
  CONSTRAINT fk_sub_orders_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_sub_orders_buyer FOREIGN KEY (buyer_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_sub_orders_seller FOREIGN KEY (seller_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_sub_orders_user FOREIGN KEY (buyer_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_sub_orders_ubigeo FOREIGN KEY (ubigeo) REFERENCES ubigeo (code),
  CONSTRAINT ck_sub_orders_total CHECK (total >= 0 AND subtotal >= 0)
) COMMENT='Un sub-pedido por agricultor: su estado, pago, entrega y comisión';

CREATE TABLE sub_order_items (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sub_order_id        BIGINT UNSIGNED NOT NULL,
  listing_id          BIGINT UNSIGNED NOT NULL,
  catalog_product_id  INT          NOT NULL,
  product_name        VARCHAR(80)  NOT NULL COMMENT 'Snapshot del nombre',
  unit                VARCHAR(10)  NOT NULL,
  unit_kg             DECIMAL(10,3) NOT NULL,
  quantity            DECIMAL(12,3) NOT NULL,
  unit_price          DECIMAL(12,2) NOT NULL COMMENT 'Snapshot del precio',
  subtotal            DECIMAL(12,2) NOT NULL,
  qty_accepted        DECIMAL(12,3) NULL COMMENT 'Conformidad parcial',
  quality_check       ENUM('OK','FAIL') NULL,
  position            SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_sub_order_items_sub (sub_order_id),
  CONSTRAINT fk_sub_order_items_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_order_items_listing FOREIGN KEY (listing_id) REFERENCES listings (id),
  CONSTRAINT fk_sub_order_items_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id),
  CONSTRAINT ck_sub_order_items_qty CHECK (quantity > 0)
) COMMENT='Productos de cada sub-pedido';

CREATE TABLE sub_order_status_history (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sub_order_id  BIGINT UNSIGNED NOT NULL,
  status        ENUM('PENDING_CONFIRMATION','CONFIRMED','AWAITING_HARVEST','PREPARING','READY','IN_TRANSIT','DELIVERED','COMPLETED','DISPUTED','REJECTED','EXPIRED','CANCELLED_BY_BUYER','CANCELLED_BY_SELLER') NOT NULL,
  changed_at    DATETIME(3)  NOT NULL,
  changed_by    VARCHAR(80)  NULL COMMENT 'uuid de quien lo cambió o system',
  note          VARCHAR(500) NULL,
  position      SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_status_history_sub (sub_order_id, position),
  CONSTRAINT fk_status_history_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE CASCADE
) COMMENT='Historial de estados (máquina de estados, 12.3)';

CREATE TABLE commission_statements (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  code             VARCHAR(40)  NOT NULL,
  period           CHAR(7)      NOT NULL COMMENT 'AAAA-MM',
  sales_total      DECIMAL(12,2) NOT NULL,
  commission       DECIMAL(12,2) NOT NULL COMMENT '3 % desde la sexta venta (RN-14)',
  issued_at        DATETIME(3)  NOT NULL,
  due_on           DATETIME(3)  NOT NULL COMMENT 'Día 10',
  status           ENUM('ISSUED','PAYMENT_REGISTERED','PAID','OVERDUE','VOID') NOT NULL,
  receipt_number   VARCHAR(30)  NULL COMMENT 'Boleta o factura de Mesagri',
  claim            JSON         NULL,
  reconcile_note   VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_commission_statements_uuid (uuid),
  UNIQUE KEY uk_commission_statements_period (organization_id, period),
  CONSTRAINT fk_commission_statements_org FOREIGN KEY (organization_id) REFERENCES organizations (id)
) COMMENT='Estado de cuenta mensual del agricultor';

-- ---------- Pagos, entrega y disputas ----------

CREATE TABLE payments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sub_order_id    BIGINT UNSIGNED NOT NULL,
  method          ENUM('YAPE','PLIN','TRANSFER','CASH','CARD') NOT NULL,
  amount          DECIMAL(12,2) NULL,
  status          ENUM('NONE','UPLOADED','CONFIRMED','NOT_RECEIVED') NOT NULL DEFAULT 'NONE',
  operation_code  VARCHAR(40)  NULL COMMENT 'Único por medio de pago (RF-PAY-05)',
  paid_at         DATETIME(3)  NULL,
  proof_file_uuid VARCHAR(80)  NULL COMMENT 'Captura de la constancia',
  uploaded_at     DATETIME(3)  NULL,
  confirmed_at    DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payments_sub (sub_order_id),
  UNIQUE KEY uk_payments_operation (method, operation_code),
  CONSTRAINT fk_payments_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE CASCADE,
  CONSTRAINT ck_payments_amount CHECK (amount IS NULL OR amount >= 0)
) COMMENT='Pago directo al agricultor con constancia (Mesagri no custodia el dinero)';

CREATE TABLE tax_documents (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sub_order_id    BIGINT UNSIGNED NOT NULL,
  doc_kind        ENUM('BOLETA','FACTURA','LIQUIDACION') NOT NULL,
  doc_number      VARCHAR(30)  NULL,
  issuer_org_id   BIGINT UNSIGNED NOT NULL COMMENT 'Quien la emite: el agricultor, o la MYPE si es liquidación de compra (RN-34)',
  PRIMARY KEY (id),
  UNIQUE KEY uk_tax_documents_sub (sub_order_id),
  CONSTRAINT fk_tax_documents_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_tax_documents_issuer FOREIGN KEY (issuer_org_id) REFERENCES organizations (id)
) COMMENT='Comprobante del pedido';

CREATE TABLE deliveries (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sub_order_id             BIGINT UNSIGNED NOT NULL,
  mode                     ENUM('PICKUP','FARMER','CARRIER') NOT NULL,
  delivery_code_hash       CHAR(64)     NOT NULL COMMENT 'Huella del código de 4 dígitos (RN-58)',
  delivery_code_enc        VARBINARY(64) NOT NULL COMMENT 'Cifrado: solo lo ve la MYPE que compró',
  pickup_code              VARCHAR(10)  NULL,
  pickup_qr                VARCHAR(120) NOT NULL,
  code_tries               TINYINT      NOT NULL DEFAULT 0,
  delivered_at             DATETIME(3)  NULL,
  delivery_photo_uuid      VARCHAR(80)  NULL,
  receipt_photo_uuids      JSON         NULL,
  remission_guide_number   VARCHAR(30)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_deliveries_sub (sub_order_id),
  CONSTRAINT fk_deliveries_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE CASCADE,
  CONSTRAINT ck_deliveries_tries CHECK (code_tries BETWEEN 0 AND 20)
) COMMENT='Entrega con código';

CREATE TABLE delivery_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  delivery_id  BIGINT UNSIGNED NOT NULL,
  kind         ENUM('LISTO','EN_CAMINO','ENTREGADO','CONFORME') NOT NULL,
  happened_at  DATETIME(3)  NOT NULL,
  note         VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY ix_delivery_events_delivery (delivery_id),
  CONSTRAINT fk_delivery_events_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries (id) ON DELETE CASCADE
) COMMENT='Seguimiento de la entrega';

CREATE TABLE disputes (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid               VARCHAR(80)  NOT NULL,
  code               VARCHAR(20)  NOT NULL COMMENT 'DSP-0031',
  sub_order_id       BIGINT UNSIGNED NOT NULL,
  opened_by_org_id   BIGINT UNSIGNED NOT NULL,
  reason             ENUM('CANTIDAD','CALIDAD','NO_LLEGO','PAGO_NO_RECIBIDO','OTRO') NOT NULL,
  description        TEXT         NOT NULL,
  status             ENUM('OPEN','PROPOSED','RESOLVED') NOT NULL,
  opened_at          DATETIME(3)  NOT NULL,
  assigned_to        BIGINT UNSIGNED NULL,
  proposal           JSON         NULL,
  resolution         ENUM('FAVOR_COMPRADOR','FAVOR_AGRICULTOR','ACUERDO') NULL,
  resolution_refund  DECIMAL(12,2) NULL,
  resolution_note    TEXT         NULL,
  resolved_by        VARCHAR(80)  NULL,
  resolved_at        DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_disputes_uuid (uuid),
  UNIQUE KEY uk_disputes_code (code),
  KEY ix_disputes_status (status, opened_at),
  CONSTRAINT fk_disputes_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id),
  CONSTRAINT fk_disputes_org FOREIGN KEY (opened_by_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_disputes_assigned FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL
) COMMENT='Reclamos sobre un pedido (12.6)';

CREATE TABLE dispute_evidence (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dispute_id  BIGINT UNSIGNED NOT NULL,
  file_uuid   VARCHAR(80)  NOT NULL,
  position    SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_dispute_evidence_dispute (dispute_id),
  CONSTRAINT fk_dispute_evidence_dispute FOREIGN KEY (dispute_id) REFERENCES disputes (id) ON DELETE CASCADE
) COMMENT='Fotos y pruebas de la disputa';
