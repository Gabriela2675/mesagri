-- =============================================================================
-- MESAGRI · Migración 0004 (versión 4 del documento, 13.7)
-- Almacenes aliados, membresías y cobros. Las restricciones de 13.7 van como CHECK,
-- UNIQUE o llaves foráneas donde la base puede imponerlas.
-- =============================================================================

-- ---------- Almacenes aliados ----------

CREATE TABLE warehouse_details (
  organization_id    BIGINT UNSIGNED NOT NULL,
  facility_type      ENUM('MOLINO','SECO','ACOPIO','FRIO') NOT NULL,
  services           JSON         NOT NULL,
  optional_services  JSON         NOT NULL COMMENT 'Servicios con precio aparte (secado, limpieza)',
  products           JSON         NOT NULL COMMENT 'Productos que recibe',
  default_rate       DECIMAL(12,2) NOT NULL COMMENT 'S/ por saco al mes',
  docs               JSON         NOT NULL COMMENT 'Licencia, ITSE, fumigación, calibración de balanza, con vencimiento',
  agreement_signed   BOOLEAN      NOT NULL DEFAULT FALSE,
  payout_account_id  BIGINT UNSIGNED NULL,
  PRIMARY KEY (organization_id),
  CONSTRAINT fk_warehouse_details_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_warehouse_details_payout FOREIGN KEY (payout_account_id) REFERENCES payout_accounts (id) ON DELETE SET NULL
) COMMENT='Subtipo almacén aliado';

CREATE TABLE storage_facilities (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  facility_type         ENUM('MOLINO','SECO','ACOPIO','FRIO') NOT NULL,
  capacity_for_mesagri  INT          NOT NULL COMMENT 'Sacos que ofrece a Mesagri',
  ubigeo                CHAR(6)      NOT NULL,
  lat_lng               VARCHAR(40)  NULL COMMENT 'GPS',
  map_x                 DECIMAL(6,2) NULL,
  map_y                 DECIMAL(6,2) NULL,
  level                 ENUM('A0','A1','A2','A3','SUSPENDIDO') NOT NULL DEFAULT 'A0',
  next_doc_expiry       DATETIME(3)  NULL,
  visit_scheduled_at    DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_facilities_org (organization_id),
  CONSTRAINT fk_storage_facilities_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_storage_facilities_ubigeo FOREIGN KEY (ubigeo) REFERENCES ubigeo (code),
  CONSTRAINT ck_storage_facilities_capacity CHECK (capacity_for_mesagri >= 0)
) COMMENT='El local del almacén: ubicación, capacidad y nivel';

CREATE TABLE storage_rates (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  catalog_product_id  INT          NOT NULL,
  unit                ENUM('saco','kg','t','pallet') NOT NULL DEFAULT 'saco',
  price_per_month     DECIMAL(12,2) NOT NULL,
  valid_from          DATETIME(3)  NULL,
  position            SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_rates (facility_id, catalog_product_id, unit),
  CONSTRAINT fk_storage_rates_facility FOREIGN KEY (facility_id) REFERENCES storage_facilities (id) ON DELETE CASCADE,
  CONSTRAINT fk_storage_rates_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id),
  CONSTRAINT ck_storage_rates_price CHECK (price_per_month > 0)
) COMMENT='Tarifa por producto y unidad';

CREATE TABLE storage_inspections (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id     BIGINT UNSIGNED NOT NULL,
  inspector_id    BIGINT UNSIGNED NULL,
  inspector_uuid  VARCHAR(80)  NULL,
  visited_at      DATETIME(3)  NOT NULL,
  score           INT          NOT NULL,
  critical_fails  INT          NOT NULL DEFAULT 0,
  checklist       JSON         NULL,
  PRIMARY KEY (id),
  KEY ix_storage_inspections_facility (facility_id),
  CONSTRAINT fk_storage_inspections_facility FOREIGN KEY (facility_id) REFERENCES storage_facilities (id) ON DELETE CASCADE,
  CONSTRAINT fk_storage_inspections_user FOREIGN KEY (inspector_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT ck_storage_inspections_score CHECK (score BETWEEN 0 AND 100)
) COMMENT='Visita de campo con su puntaje (mínimo 80)';

CREATE TABLE storage_bookings (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  code                VARCHAR(20)  NOT NULL COMMENT 'R-0203',
  facility_id         BIGINT UNSIGNED NOT NULL,
  farmer_org_id       BIGINT UNSIGNED NOT NULL,
  catalog_product_id  INT          NOT NULL,
  sacks               INT          NOT NULL,
  kg_per_sack         DECIMAL(10,3) NOT NULL,
  months              TINYINT      NOT NULL,
  arrival_date        DATETIME(3)  NOT NULL,
  rate_frozen         DECIMAL(12,2) NOT NULL COMMENT 'Tarifa congelada al reservar (RN-43)',
  status              ENUM('PENDING','ACCEPTED','REJECTED','EXPIRED','RECEIVED','CANCELLED','LAPSED') NOT NULL,
  created_at          DATETIME(3)  NOT NULL,
  responded_at        DATETIME(3)  NULL,
  reject_reason       VARCHAR(500) NULL,
  qr_text             VARCHAR(120) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_bookings_uuid (uuid),
  UNIQUE KEY uk_storage_bookings_code (code),
  KEY ix_storage_bookings_facility (facility_id, status),
  CONSTRAINT fk_storage_bookings_facility FOREIGN KEY (facility_id) REFERENCES storage_facilities (id),
  CONSTRAINT fk_storage_bookings_farmer FOREIGN KEY (farmer_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_storage_bookings_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id),
  CONSTRAINT ck_storage_bookings_sacks CHECK (sacks > 0 AND months BETWEEN 1 AND 12)
) COMMENT='Reserva de espacio (el almacén responde en 24 h)';

CREATE TABLE storage_lots (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  code                VARCHAR(30)  NOT NULL COMMENT 'ALM-2026-0042',
  booking_id          BIGINT UNSIGNED NOT NULL,
  facility_id         BIGINT UNSIGNED NOT NULL,
  farmer_org_id       BIGINT UNSIGNED NOT NULL,
  catalog_product_id  INT          NOT NULL,
  declared_kg         DECIMAL(12,3) NOT NULL,
  weight_in_kg        DECIMAL(12,3) NOT NULL COMMENT 'Peso en la balanza al ingresar',
  balance_kg          DECIMAL(12,3) NOT NULL,
  sacks               INT          NOT NULL,
  balance_sacks       INT          NOT NULL,
  quality             CHAR(1)      NOT NULL,
  photo_uuids         JSON         NOT NULL,
  intake_at           DATETIME(3)  NOT NULL,
  expires_on          DATETIME(3)  NOT NULL,
  rate                DECIMAL(12,2) NOT NULL,
  status              ENUM('WAITING_FARMER','IN_DEPOSIT','FOR_SALE','CLOSED','DISPUTE','RETURNED') NOT NULL,
  listing_id          BIGINT UNSIGNED NULL COMMENT 'Se vende como esta publicación',
  rated               BOOLEAN      NULL,
  rent_collected      DECIMAL(12,2) NULL COMMENT 'Alquiler cobrado por el almacén',
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_lots_uuid (uuid),
  UNIQUE KEY uk_storage_lots_code (code),
  KEY ix_storage_lots_facility (facility_id, status),
  KEY ix_storage_lots_expire (expires_on),
  CONSTRAINT fk_storage_lots_booking FOREIGN KEY (booking_id) REFERENCES storage_bookings (id),
  CONSTRAINT fk_storage_lots_facility FOREIGN KEY (facility_id) REFERENCES storage_facilities (id),
  CONSTRAINT fk_storage_lots_farmer FOREIGN KEY (farmer_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_storage_lots_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id),
  CONSTRAINT fk_storage_lots_listing FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE SET NULL,
  CONSTRAINT ck_storage_lots_balance CHECK (balance_kg >= 0 AND balance_sacks >= 0),
  CONSTRAINT ck_storage_lots_quality CHECK (quality IN ('A','B','C'))
) COMMENT='Lote recibido y su saldo (nunca negativo)';

CREATE TABLE storage_receipts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id     BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(30)  NOT NULL,
  qr_hash    CHAR(64)     NOT NULL,
  issued_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_receipts_lot (lot_id),
  UNIQUE KEY uk_storage_receipts_code (code),
  CONSTRAINT fk_storage_receipts_lot FOREIGN KEY (lot_id) REFERENCES storage_lots (id) ON DELETE CASCADE
) COMMENT='Constancia de depósito (no es certificado de depósito ni warrant, Ley 27287)';

CREATE TABLE storage_movements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id        BIGINT UNSIGNED NOT NULL,
  kind          ENUM('INGRESO','SALIDA','MERMA') NOT NULL,
  kg            DECIMAL(12,3) NOT NULL,
  sub_order_id  BIGINT UNSIGNED NULL,
  moved_at      DATETIME(3)  NOT NULL,
  ref           VARCHAR(80)  NOT NULL COMMENT 'Lote, orden de salida o incidente que lo originó',
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_movements_ref (lot_id, kind, ref),
  CONSTRAINT fk_storage_movements_lot FOREIGN KEY (lot_id) REFERENCES storage_lots (id) ON DELETE CASCADE,
  CONSTRAINT fk_storage_movements_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE SET NULL
) COMMENT='Ingresos, salidas y mermas del lote';

CREATE TABLE storage_release_orders (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              VARCHAR(80)  NOT NULL,
  code              VARCHAR(20)  NOT NULL COMMENT 'OS-0201',
  lot_id            BIGINT UNSIGNED NOT NULL,
  sacks             INT          NOT NULL,
  kg                DECIMAL(12,3) NOT NULL,
  picker            ENUM('FARMER','BUYER','CARRIER') NOT NULL,
  picker_name       VARCHAR(160) NOT NULL,
  sub_order_id      BIGINT UNSIGNED NULL,
  rent_amount       DECIMAL(12,2) NOT NULL,
  rent_declared_at  DATETIME(3)  NULL,
  rent_paid_at      DATETIME(3)  NULL COMMENT 'Lo confirma el almacén (RN-46)',
  expires_at        DATETIME(3)  NULL,
  status            ENUM('WAITING_RENT','ACTIVE','USED','EXPIRED') NOT NULL,
  used_at           DATETIME(3)  NULL,
  kg_out            DECIMAL(12,3) NULL,
  created_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_release_uuid (uuid),
  UNIQUE KEY uk_storage_release_code (code),
  CONSTRAINT fk_storage_release_lot FOREIGN KEY (lot_id) REFERENCES storage_lots (id),
  CONSTRAINT fk_storage_release_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE SET NULL,
  CONSTRAINT ck_storage_release_rent CHECK (status <> 'ACTIVE' OR rent_paid_at IS NOT NULL),
  CONSTRAINT ck_storage_release_sacks CHECK (sacks > 0)
) COMMENT='Orden de salida con QR: no pasa a activa sin el alquiler pagado (RN-46)';

CREATE TABLE storage_incidents (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  code                VARCHAR(20)  NOT NULL,
  lot_id              BIGINT UNSIGNED NOT NULL,
  kind                VARCHAR(40)  NOT NULL COMMENT 'Merma, plaga, humedad, daño o robo',
  kg_now              DECIMAL(12,3) NOT NULL,
  kg_lost             DECIMAL(12,3) NOT NULL,
  diff_pct            DOUBLE       NOT NULL,
  tolerance_exceeded  BOOLEAN      NOT NULL,
  happened_at         DATETIME(3)  NOT NULL,
  status              ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  resolution          VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_incidents_uuid (uuid),
  UNIQUE KEY uk_storage_incidents_code (code),
  CONSTRAINT fk_storage_incidents_lot FOREIGN KEY (lot_id) REFERENCES storage_lots (id)
) COMMENT='Incidentes del lote (el almacén compensa si pasa la tolerancia)';

CREATE TABLE storage_statements (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  facility_id      BIGINT UNSIGNED NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  code             VARCHAR(40)  NOT NULL,
  period           CHAR(7)      NOT NULL,
  rent_total       DECIMAL(12,2) NOT NULL,
  commission       DECIMAL(12,2) NOT NULL COMMENT '10 % del alquiler (RN-48)',
  items            JSON         NOT NULL,
  issued_at        DATETIME(3)  NOT NULL,
  due_on           DATETIME(3)  NOT NULL,
  status           ENUM('ISSUED','PAYMENT_REGISTERED','PAID','OVERDUE','VOID') NOT NULL,
  receipt_number   VARCHAR(30)  NULL,
  claim            JSON         NULL,
  reconcile_note   VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_statements_uuid (uuid),
  UNIQUE KEY uk_storage_statements_period (organization_id, period),
  CONSTRAINT fk_storage_statements_facility FOREIGN KEY (facility_id) REFERENCES storage_facilities (id) ON DELETE SET NULL,
  CONSTRAINT fk_storage_statements_org FOREIGN KEY (organization_id) REFERENCES organizations (id)
) COMMENT='Estado de cuenta mensual del almacén';

-- ---------- Membresías y cobros ----------

CREATE TABLE subscription_usage (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id  BIGINT UNSIGNED NOT NULL,
  period           CHAR(7)      NOT NULL,
  purchases_total  DECIMAL(12,2) NOT NULL DEFAULT 0,
  users_count      INT          NOT NULL DEFAULT 1,
  locations_count  INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_subscription_usage (subscription_id, period),
  CONSTRAINT fk_subscription_usage_sub FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE CASCADE
) COMMENT='Uso del mes frente al límite del plan (RN-36)';

CREATE TABLE subscription_invoices (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             VARCHAR(80)  NOT NULL,
  subscription_id  BIGINT UNSIGNED NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  period           CHAR(7)      NOT NULL,
  plan_code        VARCHAR(10)  NOT NULL,
  concept          VARCHAR(160) NOT NULL,
  amount           DECIMAL(12,2) NOT NULL COMMENT 'Con IGV',
  tax_document     VARCHAR(30)  NULL COMMENT 'Factura de Mesagri',
  issued_at        DATETIME(3)  NOT NULL,
  due_at           DATETIME(3)  NOT NULL,
  status           ENUM('ISSUED','PAID','RECONCILED','VOID') NOT NULL COMMENT 'emitida, pagada, conciliada, anulada',
  PRIMARY KEY (id),
  UNIQUE KEY uk_subscription_invoices_uuid (uuid),
  KEY ix_subscription_invoices_org (organization_id, period),
  CONSTRAINT fk_subscription_invoices_sub FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE SET NULL,
  CONSTRAINT fk_subscription_invoices_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT ck_subscription_invoices_amount CHECK (amount >= 0)
) COMMENT='Cobro mensual de la membresía';

CREATE TABLE commission_statement_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  statement_id   BIGINT UNSIGNED NOT NULL,
  item_uuid      VARCHAR(80)  NOT NULL COMMENT 'Sub-pedido de la venta',
  sub_order_id   BIGINT UNSIGNED NULL,
  ref            VARCHAR(40)  NOT NULL COMMENT 'Código del pedido',
  label          VARCHAR(200) NOT NULL,
  sale_number    INT          NULL COMMENT 'Correlativo por agricultor; las 5 primeras sin comisión (RN-14)',
  sale_amount    DECIMAL(12,2) NOT NULL,
  rate           DECIMAL(6,4) NOT NULL,
  commission     DECIMAL(12,2) NOT NULL,
  voided         BOOLEAN      NULL,
  void_reason    VARCHAR(500) NULL,
  position       SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_commission_items_statement (statement_id, position),
  CONSTRAINT fk_commission_items_statement FOREIGN KEY (statement_id) REFERENCES commission_statements (id) ON DELETE CASCADE,
  CONSTRAINT fk_commission_items_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id) ON DELETE SET NULL,
  CONSTRAINT ck_commission_items_amount CHECK (commission >= 0 AND sale_amount >= 0)
) COMMENT='Detalle por venta del estado de cuenta (las ventas sin comisión van con monto cero)';

CREATE TABLE billing_payments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              VARCHAR(80)  NOT NULL,
  organization_id   BIGINT UNSIGNED NOT NULL,
  concept           ENUM('MEMBRESIA','COMISION','ALMACEN','TRANSPORTE') NOT NULL,
  ref_uuid          VARCHAR(80)  NOT NULL COMMENT 'Estado de cuenta o cobro de membresía que paga',
  amount            DECIMAL(12,2) NOT NULL,
  method            ENUM('YAPE','PLIN','TRANSFER','CASH','CARD') NOT NULL,
  operation_number  VARCHAR(40)  NOT NULL,
  paid_at           DATETIME(3)  NOT NULL,
  reconciled_at     DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_billing_payments_uuid (uuid),
  UNIQUE KEY uk_billing_payments_operation (method, operation_number),
  KEY ix_billing_payments_org (organization_id),
  CONSTRAINT fk_billing_payments_org FOREIGN KEY (organization_id) REFERENCES organizations (id)
) COMMENT='Pagos que recibe Mesagri: la misma constancia no paga dos cargos';

CREATE TABLE order_schedules (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  buyer_org_id        BIGINT UNSIGNED NOT NULL,
  frequency           ENUM('SEMANAL','QUINCENAL','MENSUAL') NOT NULL,
  weekday             TINYINT      NULL,
  next_run_on         DATE         NOT NULL,
  max_price_increase  DECIMAL(5,4) NULL COMMENT 'Pide solo si el precio no sube más de este %',
  active              BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_schedules_uuid (uuid),
  CONSTRAINT fk_order_schedules_buyer FOREIGN KEY (buyer_org_id) REFERENCES organizations (id)
) COMMENT='Pedidos programados del plan Pro (R2)';

CREATE TABLE order_schedule_items (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_id         BIGINT UNSIGNED NOT NULL,
  catalog_product_id  INT          NOT NULL,
  seller_org_id       BIGINT UNSIGNED NULL,
  quantity            DECIMAL(12,3) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_schedule_items_schedule FOREIGN KEY (schedule_id) REFERENCES order_schedules (id) ON DELETE CASCADE,
  CONSTRAINT fk_schedule_items_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id),
  CONSTRAINT fk_schedule_items_seller FOREIGN KEY (seller_org_id) REFERENCES organizations (id)
) COMMENT='Productos de un pedido programado (R2)';
