-- Курьерская доставка печати через API Яндекс.Доставки (slice S1)
-- Идемпотентна: IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / ON CONFLICT.
-- Провайдер-агностичная модель: delivery_zones (тарифы в БД) + delivery_shipments
-- (состояние доставки). Расширение photo_print_orders минимально (delivery_method +
-- 'courier', delivery_provider, delivery_zone). Всё за флагом DELIVERY_YANDEX_ENABLED (off).
-- См. 30-architecture.md «Final data model».

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. delivery_zones — конфигурируемые тарифы (бизнес калибрует UPDATE-ом без деплоя)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_zones (
  id             smallint PRIMARY KEY,                 -- 1..4
  name           varchar(50)  NOT NULL,
  max_distance_m integer      NOT NULL,                -- верхняя граница distance_meters (ASC)
  price_rub      numeric(10,2) NOT NULL,              -- зональная ступень: 300/400/450/550
  min_order_rub  numeric(10,2) NOT NULL DEFAULT 0,    -- мин. заказ печати для зоны: 0/0/2000/3000
  taxi_class     varchar(20)  NOT NULL DEFAULT 'courier',
  is_active      boolean      NOT NULL DEFAULT true,
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

-- Сид 4 зон (идемпотентный: при повторном прогоне обновляет тарифы)
INSERT INTO delivery_zones (id, name, max_distance_m, price_rub, min_order_rub, taxi_class) VALUES
  (1, 'Зона 1 (центр)',      5000,       300, 0,    'courier'),
  (2, 'Зона 2',              10000,      400, 0,    'courier'),
  (3, 'Зона 3 (дальняя)',    18000,      450, 2000, 'courier'),
  (4, 'Зона 4 (за Доном)',   2000000000, 550, 3000, 'courier')
ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  max_distance_m = EXCLUDED.max_distance_m,
  price_rub      = EXCLUDED.price_rub,
  min_order_rub  = EXCLUDED.min_order_rub,
  taxi_class     = EXCLUDED.taxi_class,
  updated_at     = now();

-- ---------------------------------------------------------------------------
-- 2. delivery_shipments — состояние доставки (провайдер-агностично, 1 активная/заказ)
-- ---------------------------------------------------------------------------
-- order_id varchar(50) — как photo_print_orders.order_id (FK на UNIQUE-ключ order_id).
-- claim_id varchar(100) — claim_id Яндекса.
CREATE TABLE IF NOT EXISTS delivery_shipments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          varchar(50) NOT NULL REFERENCES photo_print_orders(order_id),
  provider          varchar(20) NOT NULL DEFAULT 'yandex',
  status            varchar(30) NOT NULL DEFAULT 'pending',   -- нормализованный
  raw_status        varchar(120),
  zone_id           smallint REFERENCES delivery_zones(id),
  price_rub         numeric(10,2) NOT NULL,                   -- зональная ступень (в чеке)
  real_price_rub    numeric(10,2),                            -- реальная цена Яндекса (себестоимость/калибровка)
  distance_m        integer,
  source_studio_id  uuid REFERENCES studios(id),
  dropoff_address   text,
  dropoff_lon       numeric(9,6),
  dropoff_lat       numeric(9,6),
  weight_grams      integer,
  claim_id          varchar(100),                             -- claim_id Яндекса
  tracking_url      text,
  courier_name      text,
  courier_phone     varchar(32),
  needs_attention   boolean NOT NULL DEFAULT false,           -- claim_failed/cancelled → оператору
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_shipments_status_check CHECK (status IN (
    'pending','created','courier_assigned','picked_up','in_transit',
    'delivered','cancelled','failed'
  ))
);

-- Одна активная (не-терминальная) доставка на заказ
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_active_per_order
  ON delivery_shipments(order_id) WHERE status NOT IN ('cancelled','failed','delivered');
-- Уникальность claim_id (защита от двойного создания claim)
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_claim_id
  ON delivery_shipments(claim_id) WHERE claim_id IS NOT NULL;
-- Поиск/JOIN по заказу
CREATE INDEX IF NOT EXISTS idx_shipment_order ON delivery_shipments(order_id);

-- ---------------------------------------------------------------------------
-- 3. photo_print_orders — расширение под курьерскую доставку
-- ---------------------------------------------------------------------------
-- P0-блокер: текущий CHECK delivery_method не содержит 'courier'. Расширяем домен
-- (IS NULL OR … — мягко, обратно совместимо). Существующий CHECK называется
-- photo_print_orders_delivery_method_check (schema.sql).
ALTER TABLE photo_print_orders DROP CONSTRAINT IF EXISTS photo_print_orders_delivery_method_check;
ALTER TABLE photo_print_orders ADD CONSTRAINT photo_print_orders_delivery_method_check
  CHECK (delivery_method IS NULL OR delivery_method IN ('electronic','pickup','postal','courier'));

-- Провайдер доставки и зона (delivery_cost, delivery_address, delivery_postal_code уже есть)
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS delivery_provider varchar(16),
  ADD COLUMN IF NOT EXISTS delivery_zone     smallint;

COMMIT;
