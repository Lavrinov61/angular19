-- 105_promotions_kind_visibility.sql
-- Purpose: разделить промо-записи по типу (public_campaign | personal | prize | partner),
-- чтобы GET /api/promotions не светил персональные SVV-коды и призовые STUDV-коды.
-- Корень инцидента: promotions.routes.ts:16 возвращал все is_active=true без фильтра по типу.
-- Идемпотентно: безопасно запускать многократно.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.promotions'::regclass
      AND attname = 'kind'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE promotions
      ADD COLUMN kind VARCHAR(32) NOT NULL DEFAULT 'public_campaign';
  END IF;
END $$;

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_kind_check;
ALTER TABLE promotions
  ADD CONSTRAINT promotions_kind_check
  CHECK (kind IN ('public_campaign', 'personal', 'prize', 'partner'));

COMMENT ON COLUMN promotions.kind IS
  'Тип промо-записи: public_campaign=листится в GET /api/promotions; personal=именные SVV-коды (сертификаты, usage_limit=1); prize=призовые коды STUDV-* (100% off); partner=партнёрские коды (скрыты, работают через /validate/:code). GET /api/promotions фильтрует по kind=public_campaign; /validate/:code работает для всех.';

UPDATE promotions
  SET kind = 'personal'
  WHERE promo_code LIKE 'SVV-%'
    AND kind = 'public_campaign';

UPDATE promotions
  SET kind = 'prize'
  WHERE promo_code LIKE 'STUDV-%'
    AND kind = 'public_campaign';

CREATE INDEX IF NOT EXISTS idx_promotions_public_active
  ON promotions (kind, is_active, sort_order)
  WHERE kind = 'public_campaign';

DO $$
DECLARE
  v_personal INT;
  v_prize INT;
  v_public INT;
  v_partner INT;
BEGIN
  SELECT COUNT(*) INTO v_personal FROM promotions WHERE kind = 'personal';
  SELECT COUNT(*) INTO v_prize    FROM promotions WHERE kind = 'prize';
  SELECT COUNT(*) INTO v_public   FROM promotions WHERE kind = 'public_campaign';
  SELECT COUNT(*) INTO v_partner  FROM promotions WHERE kind = 'partner';
  RAISE NOTICE 'promotions.kind distribution: personal=%, prize=%, public_campaign=%, partner=%',
    v_personal, v_prize, v_public, v_partner;
END $$;

COMMIT;
