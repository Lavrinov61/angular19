-- ============================================================
-- Phase 4: Order Items + Products Seed
-- ============================================================
-- 4.1  CREATE TABLE order_items — структурированные позиции любого заказа
-- 4.2  Seed products из service_options (с link service_options.product_id)
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 4.1: order_items
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_items (
  id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           VARCHAR(100)   NOT NULL,           -- receipt_number / order_id
  order_type         VARCHAR(20)    NOT NULL CHECK (order_type IN ('chat', 'app', 'pos')),
  service_option_id  UUID           REFERENCES service_options(id) ON DELETE SET NULL,
  product_id         UUID           REFERENCES products(id)        ON DELETE SET NULL,
  name               VARCHAR(255)   NOT NULL,
  unit_price         DECIMAL(10,2)  NOT NULL,
  quantity           INT            NOT NULL DEFAULT 1,
  subtotal           DECIMAL(10,2)  NOT NULL,
  delivery_method    VARCHAR(20)    CHECK (delivery_method IN ('electronic', 'pickup', 'postal')),
  metadata           JSONB          DEFAULT '{}',
  created_at         TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id         ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id       ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_service_option_id ON order_items(service_option_id);
CREATE INDEX IF NOT EXISTS idx_order_items_created_at       ON order_items(created_at);

-- ────────────────────────────────────────────────────────────
-- 4.2: Seed products из service_options
--
-- Создаём по одному Product на каждую ценную service_option.
-- sell_price = price_studio (для POS pickup), fallback base_price.
-- code = slug для поиска в каталоге.
-- metadata хранит привязку slug → для обратного поиска.
-- ────────────────────────────────────────────────────────────

INSERT INTO products (
  name,
  product_type,
  code,
  unit,
  sell_price,
  vat_rate,
  tax_system,
  is_discount_allowed,
  is_active,
  metadata
)
SELECT
  so.name,
  'service',
  so.slug,
  'piece',
  COALESCE(so.price_studio, so.base_price),
  'NoVat',
  'StsIncome',
  true,
  true,
  jsonb_build_object(
    'service_option_slug',     so.slug,
    'service_category_slug',   sc.slug,
    'price_online',            so.price_online,
    'price_studio',            so.price_studio,
    'price_base',              so.base_price
  )
FROM service_options so
JOIN option_groups       og ON so.option_group_id          = og.id
JOIN service_categories  sc ON og.service_category_id      = sc.id
WHERE so.is_active = true
  AND COALESCE(so.price_studio, so.base_price) > 0
  AND NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.metadata->>'service_option_slug' = so.slug
  );

-- ────────────────────────────────────────────────────────────
-- Связать service_options.product_id → products.id
-- ────────────────────────────────────────────────────────────

UPDATE service_options so
SET    product_id = p.id
FROM   products p
WHERE  p.metadata->>'service_option_slug' = so.slug
  AND  so.product_id IS NULL;

COMMIT;
