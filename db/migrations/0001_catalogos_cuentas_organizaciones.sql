-- =============================================================================
-- MESAGRI · Esquema MySQL 8.4 · Migración 0001
-- Catálogos y configuración, identidad y sesiones, organizaciones (13.3, R1).
-- Convenciones de 13.4: llave interna BIGINT y uuid público, dinero en DECIMAL(12,2),
-- cantidades en DECIMAL(12,3), estados como ENUM, fechas en UTC, utf8mb4_0900_ai_ci.
-- Las fechas del negocio (created_at, confirm_by, ...) usan el reloj de la demo.
-- =============================================================================

-- ---------- Catálogos y configuración ----------

CREATE TABLE ubigeo (
  code          CHAR(6)       NOT NULL COMMENT 'Código INEI del distrito',
  department    VARCHAR(40)   NOT NULL,
  province_code VARCHAR(20)   NOT NULL COMMENT 'AREQUIPA, CAMANA, CAYLLOMA',
  province      VARCHAR(60)   NOT NULL,
  district      VARCHAR(80)   NOT NULL,
  is_city       BOOLEAN       NOT NULL DEFAULT FALSE COMMENT 'Distrito de la ciudad de Arequipa',
  map_x         DECIMAL(6,2)  NULL COMMENT 'Posición en el mapa esquemático (0 a 100)',
  map_y         DECIMAL(6,2)  NULL,
  PRIMARY KEY (code),
  KEY ix_ubigeo_province (province_code)
) COMMENT='Distritos de la zona del piloto (INEI)';

CREATE TABLE roles (
  id     SMALLINT     NOT NULL,
  code   VARCHAR(20)  NOT NULL,
  label  VARCHAR(60)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_roles_code (code)
) COMMENT='Roles: agricultor, comprador, almacén, transportista y equipo';

CREATE TABLE units (
  code        VARCHAR(10)  NOT NULL COMMENT 'kg, saco, arroba, jaba, atado',
  label_one   VARCHAR(20)  NOT NULL,
  label_many  VARCHAR(20)  NOT NULL,
  short_label VARCHAR(10)  NOT NULL,
  PRIMARY KEY (code)
) COMMENT='Unidades de venta';

CREATE TABLE product_categories (
  id    SMALLINT     NOT NULL AUTO_INCREMENT,
  code  VARCHAR(20)  NOT NULL,
  name  VARCHAR(60)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_categories_code (code)
) COMMENT='Categorías del catálogo maestro';

CREATE TABLE catalog_products (
  id                     INT           NOT NULL AUTO_INCREMENT,
  code                   VARCHAR(40)   NOT NULL COMMENT 'Identificador estable (papa_amarilla)',
  category_id            SMALLINT      NOT NULL,
  name                   VARCHAR(80)   NOT NULL,
  short_name             VARCHAR(60)   NOT NULL,
  letter                 CHAR(1)       NOT NULL,
  color                  CHAR(7)       NOT NULL,
  default_unit           VARCHAR(10)   NOT NULL DEFAULT 'kg',
  allowed_units          JSON          NOT NULL,
  sack_kg                DECIMAL(8,2)  NOT NULL,
  jaba_kg                DECIMAL(8,2)  NULL,
  perishability          ENUM('ALTA','MEDIA','BAJA') NOT NULL COMMENT 'Según los días de vigencia de la publicación',
  perish_days            SMALLINT      NOT NULL,
  storable               BOOLEAN       NOT NULL DEFAULT FALSE,
  shrink_class           ENUM('TUBERCULO','GRANO','NO') NOT NULL DEFAULT 'NO',
  igv_treatment_default  ENUM('EXONERADO','GRAVADO') NOT NULL DEFAULT 'EXONERADO' COMMENT 'Productos agrícolas en estado natural: exonerados (Apéndice I, Ley del IGV)',
  varieties              JSON          NULL,
  active                 BOOLEAN       NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_catalog_products_code (code),
  UNIQUE KEY uk_catalog_products_name (name),
  FULLTEXT KEY ft_catalog_products_name (name, short_name),
  CONSTRAINT fk_catalog_products_category FOREIGN KEY (category_id) REFERENCES product_categories (id),
  CONSTRAINT fk_catalog_products_unit FOREIGN KEY (default_unit) REFERENCES units (code),
  CONSTRAINT ck_catalog_products_sack CHECK (sack_kg > 0)
) COMMENT='Catálogo maestro de productos';

CREATE TABLE catalog_product_aliases (
  id                  INT          NOT NULL AUTO_INCREMENT,
  catalog_product_id  INT          NOT NULL,
  alias               VARCHAR(80)  NOT NULL,
  language            ENUM('es','qu','ay') NOT NULL DEFAULT 'es',
  is_preferred        BOOLEAN      NOT NULL DEFAULT FALSE,
  review_status       ENUM('BORRADOR','REVISADO','APROBADO') NOT NULL DEFAULT 'APROBADO' COMMENT 'Quechua y aimara: borrador hasta que lo revisen hablantes (RN-32)',
  PRIMARY KEY (id),
  UNIQUE KEY uk_catalog_aliases (catalog_product_id, alias, language),
  KEY ix_catalog_aliases_alias (alias),
  CONSTRAINT fk_catalog_aliases_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id) ON DELETE CASCADE
) COMMENT='Sinónimos para buscar y para el intérprete de voz';

CREATE TABLE crop_references (
  id                  INT          NOT NULL AUTO_INCREMENT,
  catalog_product_id  INT          NOT NULL,
  yield_kg_ha_high    INT          NOT NULL COMMENT 'Rendimiento alto por hectárea (regla de verosimilitud, RN-23)',
  price_farm_per_kg   DECIMAL(8,2) NOT NULL COMMENT 'Precio de referencia en chacra',
  price_market_per_kg DECIMAL(8,2) NOT NULL COMMENT 'Precio mayorista de referencia',
  source              VARCHAR(160) NOT NULL,
  harvest_months      JSON         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_crop_references_product (catalog_product_id),
  CONSTRAINT fk_crop_references_product FOREIGN KEY (catalog_product_id) REFERENCES catalog_products (id) ON DELETE CASCADE
) COMMENT='Rendimientos y precios de referencia por cultivo';

CREATE TABLE platform_settings (
  setting_key  VARCHAR(60)  NOT NULL,
  value        JSON         NOT NULL,
  description  VARCHAR(200) NULL,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key)
) COMMENT='Comisión, plazos, topes y tarifas: cambian sin redeploy (con doble aprobación, RN-50)';

CREATE TABLE verification_level_limits (
  org_kind          ENUM('FARMER','BUYER') NOT NULL,
  level             TINYINT       NOT NULL,
  max_listings      INT           NULL COMMENT 'NULL = sin tope',
  max_order_total   DECIMAL(12,2) NOT NULL,
  max_monthly_total DECIMAL(12,2) NULL COMMENT 'NULL = sin tope',
  cash_allowed      BOOLEAN       NOT NULL,
  prepay_required   BOOLEAN       NOT NULL,
  PRIMARY KEY (org_kind, level),
  CONSTRAINT ck_level_limits_level CHECK (level BETWEEN 0 AND 3)
) COMMENT='Límites por nivel de verificación (10.6)';

CREATE TABLE translations (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type    ENUM('UI','CATALOG','HELP','QUICK_REPLY','AUDIO') NOT NULL DEFAULT 'UI',
  entity_key     VARCHAR(80)  NOT NULL,
  language       ENUM('qu','ay','es') NOT NULL,
  text           TEXT         NOT NULL,
  status         ENUM('MACHINE_DRAFT','DRAFT','REVIEWED','APPROVED') NOT NULL DEFAULT 'DRAFT',
  reviewed_by    VARCHAR(80)  NULL COMMENT 'uuid de quien revisó',
  reviewed_at    DATETIME(3)  NULL,
  audio_file_id  BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_translations (entity_type, entity_key, language)
) COMMENT='Contenido multilingüe con su estado de revisión (16.4)';

-- ---------- Identidad y sesiones ----------

CREATE TABLE users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           VARCHAR(80)  NOT NULL,
  phone_e164     VARCHAR(16)  NOT NULL COMMENT '+51 y 9 dígitos',
  email          VARCHAR(120) NULL COMMENT 'Solo el equipo de Mesagri',
  password_hash  VARCHAR(200) NULL COMMENT 'Argon2id (cuentas del panel)',
  totp_secret_enc VARBINARY(255) NULL COMMENT 'Secreto del doble factor (TOTP), cifrado con AES-256-GCM',
  failed_logins  TINYINT      NOT NULL DEFAULT 0,
  locked_until   DATETIME(3)  NULL COMMENT 'Bloqueo tras intentos fallidos (14.4)',
  status         ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  created_at     DATETIME(3)  NOT NULL,
  last_login_at  DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_uuid (uuid),
  UNIQUE KEY uk_users_phone (phone_e164),
  UNIQUE KEY uk_users_email (email),
  CONSTRAINT ck_users_phone CHECK (phone_e164 REGEXP '^\\+519[0-9]{8}$')
) COMMENT='Credenciales (los datos personales van en user_profiles)';

CREATE TABLE user_profiles (
  user_id        BIGINT UNSIGNED NOT NULL,
  doc_type       ENUM('DNI','CE','NINGUNO') NOT NULL DEFAULT 'NINGUNO',
  doc_number     VARCHAR(12)  NULL,
  full_name      VARCHAR(120) NOT NULL,
  short_name     VARCHAR(60)  NOT NULL,
  title          VARCHAR(60)  NULL COMMENT 'Trato: Doña, Don',
  persona_code   VARCHAR(10)  NULL COMMENT 'Persona de ejemplo del documento (sección 5)',
  PRIMARY KEY (user_id),
  UNIQUE KEY uk_user_profiles_doc (doc_type, doc_number),
  CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_user_profiles_dni CHECK (doc_type <> 'DNI' OR doc_number REGEXP '^[0-9]{8}$')
) COMMENT='Datos personales separados de las credenciales (Ley 29733)';

CREATE TABLE user_roles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  role_id     SMALLINT     NOT NULL,
  admin_role  ENUM('GENERAL','VERIFIER','SUPPORT','ANALYST') NULL COMMENT 'Solo el equipo de Mesagri',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_roles (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id)
) COMMENT='Rol de cada usuario (el servidor nunca confía en el rol que envía el cliente)';

CREATE TABLE devices (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          VARCHAR(80)  NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  label         VARCHAR(80)  NULL,
  platform      ENUM('ANDROID','IOS','WEB') NOT NULL DEFAULT 'WEB',
  push_token    VARCHAR(255) NULL,
  last_seen_at  DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_devices_uuid (uuid),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Celulares y navegadores registrados para avisos';

CREATE TABLE refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64)     NOT NULL COMMENT 'SHA-256 del token (nunca el token)',
  family       VARCHAR(40)  NOT NULL COMMENT 'Cadena de rotación: si se reutiliza uno ya rotado, se cierra toda la familia',
  device_label VARCHAR(80)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at   DATETIME(3)  NOT NULL,
  revoked_at   DATETIME(3)  NULL,
  replaced_by  BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_refresh_tokens_hash (token_hash),
  KEY ix_refresh_tokens_family (family),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Sesiones con token de refresco rotativo (14.4)';

CREATE TABLE otp_codes (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone_e164   VARCHAR(16)  NOT NULL,
  purpose      ENUM('REGISTER','LOGIN','RECOVER') NOT NULL,
  code_hash    CHAR(64)     NOT NULL,
  attempts     TINYINT      NOT NULL DEFAULT 0,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at   DATETIME(3)  NOT NULL,
  consumed_at  DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_otp_codes_phone (phone_e164, purpose, created_at),
  CONSTRAINT ck_otp_attempts CHECK (attempts BETWEEN 0 AND 10)
) COMMENT='Códigos de un solo uso por WhatsApp o SMS';

CREATE TABLE consents (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  purpose     VARCHAR(40)  NOT NULL COMMENT 'distrito, dni, whatsapp, precios, voz...',
  granted     BOOLEAN      NOT NULL,
  version     VARCHAR(10)  NOT NULL,
  decided_at  DATETIME(3)  NOT NULL,
  position    SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_consents (user_id, purpose),
  CONSTRAINT fk_consents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Consentimientos por finalidad (Ley 29733)';

CREATE TABLE privacy_requests (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid         VARCHAR(80)  NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  kind         ENUM('ACCESO','RECTIFICACION','CANCELACION','OPOSICION') NOT NULL,
  detail       TEXT         NULL,
  status       ENUM('RECIBIDA','EN_PROCESO','RESPONDIDA') NOT NULL DEFAULT 'RECIBIDA',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at       DATETIME(3)  NOT NULL COMMENT '10 días hábiles para responder',
  answered_at  DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_privacy_requests_uuid (uuid),
  CONSTRAINT fk_privacy_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Derechos ARCO';

CREATE TABLE user_preferences (
  user_id           BIGINT UNSIGNED NOT NULL,
  ui_language       ENUM('es','qu','ay') NOT NULL DEFAULT 'es',
  bilingual_labels  BOOLEAN      NOT NULL DEFAULT FALSE,
  audio_guide       BOOLEAN      NOT NULL DEFAULT TRUE,
  text_scale        DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  data_saver        BOOLEAN      NOT NULL DEFAULT FALSE,
  number_format     ENUM('coma','punto') NOT NULL DEFAULT 'coma',
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_user_preferences_scale CHECK (text_scale IN (1.00, 1.25, 1.50))
) COMMENT='Idioma, guía de audio y tamaño de letra (el idioma no depende del teléfono)';

CREATE TABLE files (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           VARCHAR(80)  NOT NULL,
  owner_user_id  BIGINT UNSIGNED NULL,
  kind           ENUM('FOTO','DNI','SELFIE','DOCUMENTO','AUDIO') NOT NULL DEFAULT 'FOTO',
  mime_type      VARCHAR(60)  NOT NULL,
  size_bytes     INT UNSIGNED NOT NULL,
  sha256         CHAR(64)     NOT NULL COMMENT 'Detecta duplicados',
  storage_key    VARCHAR(200) NOT NULL COMMENT 'Ruta en el almacenamiento de objetos (no se guarda la imagen en la base)',
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  purge_after    DATETIME(3)  NULL COMMENT 'Retención legal (RN-21)',
  PRIMARY KEY (id),
  UNIQUE KEY uk_files_uuid (uuid),
  KEY ix_files_sha (sha256),
  KEY ix_files_purge (purge_after),
  CONSTRAINT fk_files_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
) COMMENT='Fotos, documentos y audios: solo la referencia y el hash';

-- ---------- Organizaciones ----------

CREATE TABLE organizations (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                VARCHAR(80)  NOT NULL,
  kind                ENUM('FARMER','BUYER','CARRIER','WAREHOUSE','MESAGRI') NOT NULL,
  trade_name          VARCHAR(120) NOT NULL COMMENT 'Nombre comercial o de la persona',
  legal_name          VARCHAR(160) NULL COMMENT 'Razón social',
  ruc                 CHAR(11)     NULL,
  dni                 CHAR(8)      NULL,
  ubigeo              CHAR(6)      NOT NULL,
  province_code       VARCHAR(20)  NOT NULL,
  verification_level  TINYINT      NOT NULL DEFAULT 0,
  status              ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  suspended_reason    VARCHAR(500) NULL,
  accepts_cash        BOOLEAN      NOT NULL DEFAULT FALSE,
  delivery_days       JSON         NOT NULL COMMENT 'Días de entrega: 1 = lunes ... 7 = domingo',
  pickup_point        VARCHAR(160) NULL,
  avatar_initials     VARCHAR(3)   NOT NULL,
  avatar_color        CHAR(7)      NOT NULL,
  created_at          DATETIME(3)  NOT NULL,
  deleted_at          DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_organizations_uuid (uuid),
  UNIQUE KEY uk_organizations_ruc (ruc),
  KEY ix_organizations_kind (kind, status),
  CONSTRAINT fk_organizations_ubigeo FOREIGN KEY (ubigeo) REFERENCES ubigeo (code),
  CONSTRAINT ck_organizations_level CHECK (verification_level BETWEEN 0 AND 3),
  CONSTRAINT ck_organizations_ruc CHECK (ruc IS NULL OR ruc REGEXP '^(10|15|17|20)[0-9]{9}$'),
  CONSTRAINT ck_organizations_dni CHECK (dni IS NULL OR dni REGEXP '^[0-9]{8}$')
) COMMENT='Supertipo: agricultor, comprador MYPE, almacén y transportista (13.4)';

CREATE TABLE organization_members (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  member_role      ENUM('TITULAR','ADMINISTRADOR','MIEMBRO') NOT NULL DEFAULT 'TITULAR',
  position         SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_organization_members (organization_id, user_id),
  CONSTRAINT fk_org_members_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_org_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) COMMENT='Quién actúa por cada organización';

CREATE TABLE farmer_details (
  organization_id   BIGINT UNSIGNED NOT NULL,
  ppa_registered    BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Inscrito en el Padrón de Productores Agrarios',
  primary_language  ENUM('es','qu','ay') NOT NULL DEFAULT 'es',
  PRIMARY KEY (organization_id),
  CONSTRAINT fk_farmer_details_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) COMMENT='Subtipo agricultor';

CREATE TABLE buyer_details (
  organization_id  BIGINT UNSIGNED NOT NULL,
  business_type    ENUM('RESTAURANTE','HOTEL','BODEGA','COMEDOR') NULL,
  mype_category    ENUM('MICRO','PEQUENA') NULL,
  license_number   VARCHAR(30)  NULL COMMENT 'Licencia municipal de funcionamiento',
  receiver_name    VARCHAR(120) NULL COMMENT 'Quién recibe los pedidos',
  PRIMARY KEY (organization_id),
  CONSTRAINT fk_buyer_details_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) COMMENT='Subtipo comprador MYPE';

CREATE TABLE tax_profiles (
  organization_id  BIGINT UNSIGNED NOT NULL,
  tax_regime       ENUM('SIN_RUC','NRUS','RER','GENERAL') NOT NULL,
  ciiu_code        CHAR(4)      NULL,
  sunat_status     ENUM('ACTIVO','BAJA') NULL,
  sunat_condition  ENUM('HABIDO','NO HABIDO') NULL,
  PRIMARY KEY (organization_id),
  CONSTRAINT fk_tax_profiles_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) COMMENT='Situación tributaria: decide qué comprobante puede dar (RN-34)';

CREATE TABLE addresses (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  ubigeo           CHAR(6)      NOT NULL,
  address_line     VARCHAR(200) NOT NULL,
  is_default       BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  KEY ix_addresses_org (organization_id),
  CONSTRAINT fk_addresses_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_addresses_ubigeo FOREIGN KEY (ubigeo) REFERENCES ubigeo (code)
) COMMENT='Dirección de entrega del comprador';

CREATE TABLE org_service_areas (
  organization_id  BIGINT UNSIGNED NOT NULL,
  ubigeo           CHAR(6)      NOT NULL,
  delivery_fee     DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '0 = incluido',
  position         SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, ubigeo),
  CONSTRAINT fk_service_areas_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_service_areas_ubigeo FOREIGN KEY (ubigeo) REFERENCES ubigeo (code),
  CONSTRAINT ck_service_areas_fee CHECK (delivery_fee >= 0)
) COMMENT='Zonas donde entrega el agricultor y su costo de envío';

CREATE TABLE payout_accounts (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                   VARCHAR(80)  NOT NULL,
  organization_id        BIGINT UNSIGNED NOT NULL,
  method                 ENUM('YAPE','PLIN','BANK') NOT NULL,
  account_enc            VARBINARY(255) NOT NULL COMMENT 'Número o CCI cifrado con AES-256-GCM en la aplicación (14.9)',
  account_last4          CHAR(4)      NOT NULL,
  holder_name            VARCHAR(160) NOT NULL,
  holder_relation        ENUM('PROPIA','FAMILIAR','ASOCIACION') NOT NULL DEFAULT 'PROPIA',
  authorization_text     VARCHAR(500) NULL,
  authorization_file_id  BIGINT UNSIGNED NULL,
  status                 ENUM('VERIFICADA','SIN_VERIFICAR') NOT NULL DEFAULT 'SIN_VERIFICAR',
  position               SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payout_accounts (organization_id, uuid),
  KEY ix_payout_accounts_org (organization_id),
  CONSTRAINT fk_payout_accounts_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_payout_accounts_file FOREIGN KEY (authorization_file_id) REFERENCES files (id),
  CONSTRAINT ck_payout_third_party CHECK (holder_relation = 'PROPIA' OR authorization_text IS NOT NULL OR authorization_file_id IS NOT NULL)
) COMMENT='Cuentas de cobro: una de un tercero exige autorización (RN-28)';

CREATE TABLE plans (
  id             SMALLINT     NOT NULL AUTO_INCREMENT,
  code           VARCHAR(10)  NOT NULL COMMENT 'BASICO, PRO, EMPRESA',
  name           VARCHAR(40)  NOT NULL,
  audience       ENUM('BUYER') NOT NULL DEFAULT 'BUYER',
  price_month    DECIMAL(12,2) NOT NULL COMMENT 'Con IGV',
  purchase_cap   DECIMAL(12,2) NULL COMMENT 'Compras al mes; NULL = sin tope',
  max_users      INT          NULL,
  max_locations  INT          NULL,
  features       JSON         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_plans_code (code),
  CONSTRAINT ck_plans_price CHECK (price_month >= 0)
) COMMENT='Planes de membresía de la MYPE';

CREATE TABLE subscriptions (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  plan_id          SMALLINT     NOT NULL,
  status           ENUM('TRIAL','ACTIVE','GRACE','INACTIVE') NOT NULL COMMENT 'prueba, activa, pendiente (gracia), sin membresía',
  started_at       DATETIME(3)  NULL,
  trial_ends_on    DATETIME(3)  NOT NULL,
  paid_until       DATETIME(3)  NOT NULL,
  grace_until      DATETIME(3)  NULL COMMENT '5 días de gracia (RN-37)',
  months_below     TINYINT      NOT NULL DEFAULT 0 COMMENT 'Meses seguidos por debajo del plan inferior (RN-38)',
  history          JSON         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_subscriptions_org (organization_id),
  CONSTRAINT fk_subscriptions_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES plans (id)
) COMMENT='Membresía de cada MYPE';
