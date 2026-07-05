-- Добавление колонок discount_type и discount_label в pos_receipt_items
-- для сохранения типа скидки (degressive/volume/subscription) из waterfall v2

ALTER TABLE pos_receipt_items
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS discount_label TEXT;

COMMENT ON COLUMN pos_receipt_items.discount_type IS 'Тип скидки: degressive, category_degressive, volume, subscription, cross_category';
COMMENT ON COLUMN pos_receipt_items.discount_label IS 'Описание скидки для отчётов, напр. "2-й комплект: экономия 130₽"';
