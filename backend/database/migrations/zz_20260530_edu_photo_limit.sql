-- zz_20260530_edu_photo_limit.sql
-- Второй лимит образовательной льготы: фотопечать (10x15…A4) — отдельный счётчик
-- в том же rolling-30 периоде, что и документы. Мягкое превышение (D3): сверх лимита
-- позиция печатается по обычной цене (без 409). Аудит фото-списаний через benefit_type='photo_print'.
-- Идемпотентна. Применяется на shared БД сразу (CLAUDE.md).

BEGIN;

-- 1) Второй счётчик «фото» в периоде льготы (один период — оба лимита, D4)
ALTER TABLE student_allowance_periods
  ADD COLUMN IF NOT EXISTS photo_limit integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS photos_used integer NOT NULL DEFAULT 0;

-- 2) Инварианты неотрицательности фото-счётчика (без <=limit — D3 мягкое превышение)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='student_allowance_periods_photo_limit_nn') THEN
    ALTER TABLE student_allowance_periods
      ADD CONSTRAINT student_allowance_periods_photo_limit_nn CHECK (photo_limit >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='student_allowance_periods_photos_used_nn') THEN
    ALTER TABLE student_allowance_periods
      ADD CONSTRAINT student_allowance_periods_photos_used_nn CHECK (photos_used >= 0);
  END IF;
END $$;

-- 3) D3 мягкое превышение: снять жёсткий табличный CHECK sheets_used<=sheet_limit.
--    App-уровень продолжает clamp'ить; снятие нужно, чтобы мягкое превышение не упёрлось в констрейнт.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid='student_allowance_periods'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) ILIKE '%sheets_used%<%sheet_limit%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE student_allowance_periods DROP CONSTRAINT %I', c); END IF;
END $$;

-- 4) Аудит фото-списаний (F7): расширить benefit_type на photo_print
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid='student_discount_redemptions'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) ILIKE '%benefit_type%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE student_discount_redemptions DROP CONSTRAINT %I', c); END IF;
  ALTER TABLE student_discount_redemptions
    ADD CONSTRAINT student_discount_redemptions_benefit_type_check
    CHECK (benefit_type IN ('print_a4_bw','print_a4_color','binding_spring_a4','photo_print'));
END $$;

-- 5) Идемпотентность списания на чек (защита от ретраев вне idempotency-окна)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sdr_receipt_benefit_product
  ON student_discount_redemptions (pos_receipt_id, benefit_type, COALESCE((metadata->>'product_id'),''))
  WHERE pos_receipt_id IS NOT NULL;

COMMENT ON COLUMN student_allowance_periods.photo_limit IS
  'Лимит фотоотпечатков 10x15…A4 за rolling-30 период (D1, дефолт 100, параметризуется EDU_PHOTO_LIMIT).';
COMMENT ON COLUMN student_allowance_periods.photos_used IS
  'Использовано фотоотпечатков; списывается финализатором POS-чека, benefit_type=photo_print. Мягкое превышение допускается.';

COMMIT;
