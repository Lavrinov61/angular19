-- zz_20260602_student_id_photo_promo.sql
-- Акция «Фото на студенческий — пакет 4 комплекта по 200 ₽» (800 ₽ за раз, ровно 4,
-- ни больше ни меньше) для подтверждённого образовательного аккаунта БЕЗ требования
-- платной подписки. Одно списание на аккаунт (lifetime), откатывается при void/возврате.
-- Плюс новая образовательная роль 'applicant' (абитуриент) для верификации.
-- Идемпотентна. Применяется на shared БД сразу (CLAUDE.md).

BEGIN;

-- 1) Леджер одноразового пакета. Один НЕотменённый ряд на student_account_id (lifetime-кап).
--    units фиксированы = размер пакета (4); цена/размер пакета параметризуются в коде (env).
CREATE TABLE IF NOT EXISTS student_id_photo_promo_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_account_id UUID NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  units INTEGER NOT NULL DEFAULT 4 CHECK (units > 0),
  unit_price NUMERIC(10,2) NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  pos_receipt_id UUID REFERENCES pos_receipts(id) ON DELETE SET NULL,
  print_order_id UUID,
  customer_phone TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один пакет на образовательный аккаунт навсегда (гонко-безопасно через INSERT … ON CONFLICT).
-- Откат при возврате удаляет ряд → аккаунт снова становится доступен для акции.
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_id_photo_promo_account
  ON student_id_photo_promo_redemptions(student_account_id);

CREATE INDEX IF NOT EXISTS idx_student_id_photo_promo_receipt
  ON student_id_photo_promo_redemptions(pos_receipt_id)
  WHERE pos_receipt_id IS NOT NULL;

COMMENT ON TABLE student_id_photo_promo_redemptions IS
  'Списания одноразового пакета «Фото на студенческий 4×200» на образовательном аккаунте; один ряд = пакет использован, удаление ряда = возврат.';

-- 2) Новая образовательная роль 'applicant' (абитуриент) — у него нет студбилета,
--    подтверждение через справку/приказ о зачислении, расписку приёмной комиссии,
--    скрин Госуслуг, аттестат или справку из школы.
ALTER TABLE student_accounts
  DROP CONSTRAINT IF EXISTS student_accounts_education_role_check,
  ADD CONSTRAINT student_accounts_education_role_check
    CHECK (education_role IN ('student', 'applicant', 'teacher', 'lecturer', 'staff'));

ALTER TABLE student_verifications
  DROP CONSTRAINT IF EXISTS student_verifications_education_role_check,
  ADD CONSTRAINT student_verifications_education_role_check
    CHECK (education_role IN ('student', 'applicant', 'teacher', 'lecturer', 'staff'));

COMMENT ON COLUMN student_accounts.education_role IS
  'Educational role verified for education access: student, applicant, teacher, lecturer or staff.';

COMMIT;
