-- =============================================================================
-- MESAGRI · Migración 0007
-- Vistas para las consultas que el diseño ya considera (13.5).
-- =============================================================================

-- Catálogo del comprador: publicaciones activas con su agricultor, producto y reputación.
CREATE OR REPLACE VIEW v_active_listings AS
SELECT
  l.uuid                 AS listing_uuid,
  l.unit_price,
  l.unit,
  l.unit_kg,
  ROUND(l.unit_price / l.unit_kg, 2) AS price_per_kg,
  l.qty_available,
  l.quality,
  l.harvest_date,
  l.harvest_seal,
  l.lot_code,
  l.created_at,
  l.expires_at,
  p.code                 AS product_code,
  p.name                 AS product_name,
  c.code                 AS category_code,
  o.uuid                 AS seller_uuid,
  o.trade_name           AS seller_name,
  o.verification_level   AS seller_level,
  o.ubigeo               AS seller_ubigeo,
  u.district             AS seller_district,
  u.province             AS seller_province,
  s.rating_avg           AS seller_rating,
  s.ratings_count        AS seller_ratings
FROM listings l
JOIN catalog_products p ON p.id = l.catalog_product_id
JOIN product_categories c ON c.id = p.category_id
JOIN organizations o ON o.id = l.organization_id
JOIN ubigeo u ON u.code = o.ubigeo
LEFT JOIN organization_stats s ON s.organization_id = o.id
WHERE l.status = 'ACTIVE' AND l.qty_available > 0 AND l.deleted_at IS NULL AND o.status = 'ACTIVE';

-- Cola del verificador: lo más antiguo primero, con sus alertas.
CREATE OR REPLACE VIEW v_verification_queue AS
SELECT
  k.uuid               AS case_uuid,
  k.status,
  k.subject,
  k.target_level,
  k.submitted_at,
  o.uuid               AS org_uuid,
  o.trade_name         AS org_name,
  o.ubigeo,
  a.uuid               AS assigned_to_uuid,
  (SELECT GROUP_CONCAT(ch.check_type ORDER BY ch.position SEPARATOR ', ') FROM verification_checks ch WHERE ch.case_id = k.id) AS alerts,
  (SELECT COUNT(*) FROM documents d WHERE d.case_id = k.id) AS evidence_count
FROM verification_cases k
JOIN organizations o ON o.id = k.organization_id
LEFT JOIN users a ON a.id = k.assigned_to
WHERE k.status IN ('SUBMITTED','IN_REVIEW','NEEDS_INFO','APPEALED');

-- Bandeja del agricultor: sub-pedidos con su comprador, pago y entrega.
CREATE OR REPLACE VIEW v_seller_inbox AS
SELECT
  so.uuid           AS sub_order_uuid,
  so.code,
  so.status,
  so.total,
  so.delivery_mode,
  so.delivery_date,
  so.confirm_by,
  so.created_at,
  seller.uuid       AS seller_uuid,
  buyer.uuid        AS buyer_uuid,
  buyer.trade_name  AS buyer_name,
  pay.method        AS pay_method,
  pay.status        AS pay_status
FROM sub_orders so
JOIN organizations seller ON seller.id = so.seller_org_id
JOIN organizations buyer ON buyer.id = so.buyer_org_id
LEFT JOIN payments pay ON pay.sub_order_id = so.id;

-- Ventas conformes por agricultor y mes (base del estado de cuenta, RN-14).
CREATE OR REPLACE VIEW v_monthly_sales AS
SELECT
  o.uuid                              AS seller_uuid,
  o.trade_name                        AS seller_name,
  DATE_FORMAT(so.completed_at, '%Y-%m') AS period,
  COUNT(*)                            AS sales,
  SUM(COALESCE(so.sale_amount, so.subtotal)) AS sales_total,
  SUM(COALESCE(so.commission, 0))     AS commission_total
FROM sub_orders so
JOIN organizations o ON o.id = so.seller_org_id
WHERE so.status = 'COMPLETED'
GROUP BY o.uuid, o.trade_name, DATE_FORMAT(so.completed_at, '%Y-%m');
