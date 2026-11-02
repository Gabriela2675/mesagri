-- =============================================================================
-- MESAGRI · Migración 0005 (versión 5 del documento, 13.8)
-- Transportistas aliados, vehículos, rutas y envíos.
-- =============================================================================

CREATE TABLE carrier_details (
  organization_id    BIGINT UNSIGNED NOT NULL,
  level              ENUM('T0','T1','T2','T3','SUSPENDIDO') NOT NULL DEFAULT 'T0',
  available          BOOLEAN      NOT NULL DEFAULT FALSE,
  rating_avg         DECIMAL(3,2) NULL COMMENT 'Calculado',
  shipments_done     INT          NOT NULL DEFAULT 0 COMMENT 'Calculado',
  on_time_pct        DECIMAL(5,4) NULL COMMENT 'Calculado',
  no_show_count      INT          NOT NULL DEFAULT 0 COMMENT '3 inasistencias = suspensión',
  training_done      TINYINT      NOT NULL DEFAULT 0,
  training_total     TINYINT      NOT NULL DEFAULT 3 COMMENT 'Capacitación de 40 minutos en módulos',
  agreement_signed   BOOLEAN      NOT NULL DEFAULT FALSE,
  insurance          BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Seguro de carga (requisito de T3)',
  payout_account_id  BIGINT UNSIGNED NULL,
  base_stats         JSON         NULL COMMENT 'Historial importado de antes del piloto',
  PRIMARY KEY (organization_id),
  CONSTRAINT fk_carrier_details_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_carrier_details_payout FOREIGN KEY (payout_account_id) REFERENCES payout_accounts (id) ON DELETE SET NULL
) COMMENT='Subtipo transportista aliado';

CREATE TABLE carrier_drivers (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  carrier_org_id      BIGINT UNSIGNED NOT NULL,
  user_id             BIGINT UNSIGNED NULL,
  license_class       ENUM('B-IIb','A-I','A-IIb','B-IIc') NOT NULL,
  license_expires_on  DATETIME(3)  NOT NULL,
  record_checked_on   DATETIME(3)  NULL COMMENT 'Récord de conductor',
  PRIMARY KEY (id),
  KEY ix_carrier_drivers_org (carrier_org_id),
  CONSTRAINT fk_carrier_drivers_org FOREIGN KEY (carrier_org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_carrier_drivers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) COMMENT='Conductores y su licencia';

CREATE TABLE vehicles (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  carrier_org_id  BIGINT UNSIGNED NOT NULL,
  plate           VARCHAR(10)  NOT NULL,
  vehicle_class   ENUM('V1','V2','V3') NOT NULL COMMENT 'V1 moto con cajuela, V2 camioneta o furgón, V3 camión ligero',
  category        ENUM('L3','N1','N2') NOT NULL,
  payload_kg      INT          NOT NULL,
  body_type       VARCHAR(60)  NOT NULL,
  model_year      SMALLINT     NOT NULL,
  status          ENUM('ACTIVO','OBSERVADO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicles_plate (plate),
  KEY ix_vehicles_org (carrier_org_id),
  CONSTRAINT fk_vehicles_org FOREIGN KEY (carrier_org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT ck_vehicles_payload CHECK (payload_kg > 0 AND payload_kg <= 6000)
) COMMENT='Vehículos admitidos: sin autos, mototaxis, trimotos ni camiones de más de 12 t';

CREATE TABLE vehicle_documents (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id  BIGINT UNSIGNED NOT NULL,
  kind        VARCHAR(20)  NOT NULL COMMENT 'SOAT, CITV, TUC, MTC, MUNICIPAL, SEGURO, LICENCIA',
  label       VARCHAR(120) NOT NULL,
  number      VARCHAR(40)  NULL,
  expires_on  DATETIME(3)  NULL,
  status      ENUM('OK','PENDING','OBSERVED','MISSING') NOT NULL,
  note        VARCHAR(200) NULL,
  position    SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_vehicle_documents_vehicle (vehicle_id),
  KEY ix_vehicle_documents_expires (expires_on),
  CONSTRAINT fk_vehicle_documents_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
) COMMENT='Papeles del vehículo con vencimiento (RN-52)';

CREATE TABLE vehicle_inspections (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id      BIGINT UNSIGNED NOT NULL,
  inspector_uuid  VARCHAR(80)  NULL,
  inspected_at    DATETIME(3)  NOT NULL,
  score           INT          NOT NULL,
  critical_fails  INT          NOT NULL DEFAULT 0,
  checklist       JSON         NOT NULL COMMENT '20 puntos',
  PRIMARY KEY (id),
  KEY ix_vehicle_inspections_vehicle (vehicle_id),
  CONSTRAINT fk_vehicle_inspections_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE,
  CONSTRAINT ck_vehicle_inspections_score CHECK (score BETWEEN 0 AND 100)
) COMMENT='Revisión del vehículo cada 6 meses (mínimo 80 de 100)';

CREATE TABLE shipping_routes (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(40)  NOT NULL COMMENT 'camana-aqp, colca-aqp, aqp-ciudad',
  name            VARCHAR(80)  NOT NULL,
  scope           ENUM('RUTA','CIUDAD') NOT NULL,
  origin          VARCHAR(40)  NOT NULL,
  destination     VARCHAR(40)  NOT NULL,
  distance_km     DECIMAL(8,2) NOT NULL,
  offer_minutes   INT          NOT NULL COMMENT '15 min (ciudad) o 2 h (ruta) para aceptar',
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_shipping_routes_code (code)
) COMMENT='Rutas entre provincias y reparto en la ciudad';

CREATE TABLE shipping_rates (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  route_id            BIGINT UNSIGNED NOT NULL,
  vehicle_class       ENUM('V1','V2','V3') NOT NULL,
  price_per_kg        DECIMAL(8,4) NOT NULL,
  price_per_delivery  DECIMAL(12,2) NOT NULL,
  min_fee             DECIMAL(12,2) NOT NULL,
  valid_from          DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_shipping_rates (route_id, vehicle_class),
  CONSTRAINT fk_shipping_rates_route FOREIGN KEY (route_id) REFERENCES shipping_routes (id) ON DELETE CASCADE
) COMMENT='Tarifa de referencia por ruta y clase de vehículo (RF-TRA-08)';

CREATE TABLE carrier_routes (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  carrier_org_id  BIGINT UNSIGNED NOT NULL,
  route_id        BIGINT UNSIGNED NOT NULL,
  weekdays        JSON         NOT NULL COMMENT '1 = lunes ... 7 = domingo',
  departs_at      TIME         NOT NULL,
  arrives_at      TIME         NOT NULL,
  position        SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_carrier_routes_org (carrier_org_id),
  CONSTRAINT fk_carrier_routes_org FOREIGN KEY (carrier_org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_carrier_routes_route FOREIGN KEY (route_id) REFERENCES shipping_routes (id)
) COMMENT='Rutas, días y horas que cubre cada transportista';

CREATE TABLE shipments (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                     VARCHAR(80)  NOT NULL,
  code                     VARCHAR(20)  NOT NULL COMMENT 'ENV-0032',
  sub_order_id             BIGINT UNSIGNED NOT NULL,
  buyer_org_id             BIGINT UNSIGNED NOT NULL,
  seller_org_id            BIGINT UNSIGNED NOT NULL,
  mode                     ENUM('RECOJO','AGRICULTOR','ALIADO') NOT NULL DEFAULT 'ALIADO',
  route_id                 BIGINT UNSIGNED NOT NULL,
  scope                    ENUM('RUTA','CIUDAD') NOT NULL,
  origin_label             VARCHAR(160) NOT NULL,
  dest_label               VARCHAR(160) NOT NULL,
  distance_km              DECIMAL(8,2) NOT NULL,
  carrier_org_id           BIGINT UNSIGNED NULL,
  vehicle_id               BIGINT UNSIGNED NULL,
  weight_kg                DECIMAL(12,3) NOT NULL,
  sacks                    INT          NOT NULL,
  cargo_value              DECIMAL(12,2) NOT NULL,
  freight                  DECIMAL(12,2) NOT NULL COMMENT 'Congelado al pedir (RN-54)',
  commission_rate          DECIMAL(6,4) NOT NULL COMMENT 'Congelada (RN-63)',
  preferred_carrier_uuid   VARCHAR(80)  NULL,
  delivery_code_hash       CHAR(64)     NULL COMMENT 'Huella del código del sub-pedido; nunca en claro',
  status                   ENUM('WAITING_FARMER','OFFERING','ASSIGNED','GOING_TO_PICKUP','PICKED_UP','ARRIVED','DELIVERED','CLOSED','NO_CARRIER','CANCELLED') NOT NULL,
  requested_at             DATETIME(3)  NOT NULL,
  offering_since           DATETIME(3)  NULL,
  pickup_at                DATETIME(3)  NOT NULL,
  deliver_from             DATETIME(3)  NOT NULL,
  deliver_to               DATETIME(3)  NOT NULL,
  pickup_evidence          JSON         NULL COMMENT 'Conteo, peso, fotos, guías y QR',
  delivery_evidence        JSON         NULL COMMENT 'Peso, fotos, medio de cobro',
  buyer_paid               JSON         NULL COMMENT 'Flete pagado directo al transportista (RN-55)',
  false_freight            DECIMAL(12,2) NULL COMMENT 'Falso flete de 30 % (RN-61)',
  cancel_reason            VARCHAR(500) NULL,
  release_order_uuid       VARCHAR(80)  NULL COMMENT 'Si sale de un almacén aliado',
  on_time                  BOOLEAN      NULL,
  closed_at                DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_shipments_uuid (uuid),
  UNIQUE KEY uk_shipments_code (code),
  UNIQUE KEY uk_shipments_sub (sub_order_id),
  KEY ix_shipments_carrier (carrier_org_id, status),
  KEY ix_shipments_status (status, pickup_at),
  CONSTRAINT fk_shipments_sub FOREIGN KEY (sub_order_id) REFERENCES sub_orders (id),
  CONSTRAINT fk_shipments_buyer FOREIGN KEY (buyer_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_shipments_seller FOREIGN KEY (seller_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_shipments_route FOREIGN KEY (route_id) REFERENCES shipping_routes (id),
  CONSTRAINT fk_shipments_carrier FOREIGN KEY (carrier_org_id) REFERENCES organizations (id),
  CONSTRAINT fk_shipments_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE SET NULL,
  CONSTRAINT ck_shipments_values CHECK (weight_kg > 0 AND freight >= 0 AND cargo_value >= 0)
) COMMENT='Envío de un sub-pedido (como máximo uno por sub-pedido)';

CREATE TABLE shipment_offers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shipment_id     BIGINT UNSIGNED NOT NULL,
  carrier_org_id  BIGINT UNSIGNED NOT NULL,
  `rank`          SMALLINT     NOT NULL COMMENT 'Primero los favoritos de la MYPE y luego por calificación (RN-56)',
  sent_at         DATETIME(3)  NOT NULL,
  expires_at      DATETIME(3)  NOT NULL,
  response        ENUM('ACCEPTED','REJECTED','EXPIRED') NULL,
  responded_at    DATETIME(3)  NULL,
  reason          VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_shipment_offers_rank (shipment_id, `rank`),
  KEY ix_shipment_offers_carrier (carrier_org_id, response),
  CONSTRAINT fk_shipment_offers_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE CASCADE,
  CONSTRAINT fk_shipment_offers_carrier FOREIGN KEY (carrier_org_id) REFERENCES organizations (id)
) COMMENT='Ofertas del envío: aceptar es atómico y gana el primero';

CREATE TABLE shipment_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shipment_id     BIGINT UNSIGNED NOT NULL,
  kind            VARCHAR(30)  NOT NULL COMMENT 'Recojo, avance, llegada, entrega, cancelación...',
  happened_at     DATETIME(3)  NOT NULL,
  text            VARCHAR(500) NOT NULL,
  by_uuid         VARCHAR(80)  NULL,
  lat_lng         VARCHAR(40)  NULL,
  weight_kg       DECIMAL(12,3) NULL,
  waybill_number  VARCHAR(30)  NULL,
  position        SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_shipment_events_shipment (shipment_id, position),
  CONSTRAINT fk_shipment_events_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE CASCADE
) COMMENT='Recojo, avance y entrega con sus evidencias';

CREATE TABLE shipment_incidents (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          VARCHAR(80)  NOT NULL,
  shipment_id   BIGINT UNSIGNED NOT NULL,
  is_claim      BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Reclamo de la MYPE por pérdida o daño (24 h, RN-60)',
  kind          VARCHAR(40)  NOT NULL COMMENT 'Demora, avería, daño, pérdida o robo',
  text          TEXT         NOT NULL,
  new_eta       VARCHAR(40)  NULL,
  location      VARCHAR(200) NULL,
  photo_uuids   JSON         NOT NULL,
  kg_lost       DECIMAL(12,3) NULL,
  compensation  DECIMAL(12,2) NULL,
  response      TEXT         NULL,
  resolution    VARCHAR(500) NULL,
  status        ENUM('OPEN','RESPONDED','RESOLVED','INFORMADO') NOT NULL DEFAULT 'INFORMADO',
  happened_at   DATETIME(3)  NOT NULL,
  position      SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_shipment_incidents_uuid (uuid),
  KEY ix_shipment_incidents_shipment (shipment_id),
  CONSTRAINT fk_shipment_incidents_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE CASCADE
) COMMENT='Problemas en ruta y reclamos';

CREATE TABLE carrier_ratings (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shipment_id   BIGINT UNSIGNED NOT NULL,
  punctuality   TINYINT      NOT NULL,
  care          TINYINT      NOT NULL,
  treatment     TINYINT      NOT NULL,
  tags          JSON         NOT NULL,
  recommends    BOOLEAN      NOT NULL,
  comment       TEXT         NULL,
  reply         TEXT         NULL,
  rated_at      DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_carrier_ratings_shipment (shipment_id),
  CONSTRAINT fk_carrier_ratings_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE CASCADE,
  CONSTRAINT ck_carrier_ratings_values CHECK (punctuality BETWEEN 1 AND 5 AND care BETWEEN 1 AND 5 AND treatment BETWEEN 1 AND 5)
) COMMENT='Calificación del envío por la MYPE (una por envío, RN-64)';

CREATE TABLE carrier_favorites (
  buyer_org_id    BIGINT UNSIGNED NOT NULL,
  carrier_org_id  BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  position        SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (buyer_org_id, carrier_org_id),
  CONSTRAINT fk_carrier_favorites_buyer FOREIGN KEY (buyer_org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_carrier_favorites_carrier FOREIGN KEY (carrier_org_id) REFERENCES organizations (id) ON DELETE CASCADE
) COMMENT='Transportistas favoritos de una MYPE (reciben la oferta primero)';

CREATE TABLE carrier_statements (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            VARCHAR(80)  NOT NULL,
  carrier_org_id  BIGINT UNSIGNED NOT NULL,
  code            VARCHAR(40)  NOT NULL,
  period          CHAR(7)      NOT NULL,
  freight_total   DECIMAL(12,2) NOT NULL,
  commission      DECIMAL(12,2) NOT NULL COMMENT '10 % de los fletes (RN-63)',
  items           JSON         NOT NULL,
  issued_at       DATETIME(3)  NOT NULL,
  due_on          DATETIME(3)  NOT NULL,
  status          ENUM('ISSUED','PAYMENT_REGISTERED','PAID','OVERDUE','VOID') NOT NULL,
  receipt_number  VARCHAR(30)  NULL,
  claim           JSON         NULL,
  reconcile_note  VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_carrier_statements_uuid (uuid),
  UNIQUE KEY uk_carrier_statements_period (carrier_org_id, period),
  CONSTRAINT fk_carrier_statements_org FOREIGN KEY (carrier_org_id) REFERENCES organizations (id)
) COMMENT='Estado de cuenta mensual del transportista';
