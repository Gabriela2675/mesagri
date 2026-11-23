-- =============================================================================
-- 0013 · Ubicaciones verificadas de las chacras
-- - ubigeo: los 109 distritos de las 8 provincias de Arequipa (antes 22), con su capital y las
--   coordenadas de la capital (INEI). El servidor completa las filas al arrancar.
-- - organizations.farm_location: dónde está la chacra principal del agricultor (centro poblado
--   del INEI, GPS del celular o dirección del buscador). Nunca se muestra a los compradores (RN-17).
-- - farms: el lugar elegido, la referencia para llegar, de dónde salió el punto y su precisión.
-- =============================================================================

ALTER TABLE ubigeo
  MODIFY province_code VARCHAR(20) NOT NULL COMMENT 'AREQUIPA, CAMANA, CARAVELI, CASTILLA, CAYLLOMA, CONDESUYOS, ISLAY, LA_UNION',
  ADD COLUMN capital    VARCHAR(80)  NULL COMMENT 'Capital del distrito (INEI)' AFTER district,
  ADD COLUMN latitude   DECIMAL(9,6) NULL COMMENT 'Coordenadas de la capital' AFTER capital,
  ADD COLUMN longitude  DECIMAL(9,6) NULL AFTER latitude,
  ADD COLUMN altitude_m SMALLINT     NULL COMMENT 'Altitud de la capital (m s. n. m.)' AFTER longitude;

ALTER TABLE organizations
  ADD COLUMN farm_location JSON NULL COMMENT 'Agricultor: ubicación de su chacra principal (RN-17: no la ven los compradores)' AFTER province_code;

ALTER TABLE farms
  ADD COLUMN place_label     VARCHAR(160) NULL COMMENT 'Lugar elegido: centro poblado del INEI o dirección del buscador' AFTER longitude,
  ADD COLUMN reference       VARCHAR(200) NULL COMMENT 'Referencia para llegar, escrita por el agricultor' AFTER place_label,
  ADD COLUMN location_source ENUM('CCPP','DISTRITO','GPS','BUSCADOR') NULL COMMENT 'De dónde salió el punto' AFTER reference,
  ADD COLUMN ccpp_code       CHAR(10)     NULL COMMENT 'Código INEI del centro poblado' AFTER location_source,
  ADD COLUMN gps_accuracy_m  INT          NULL COMMENT 'Precisión del GPS (m)' AFTER ccpp_code,
  ADD COLUMN located_at      DATETIME(3)  NULL AFTER gps_accuracy_m;
