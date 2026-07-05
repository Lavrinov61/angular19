-- zz_20260602_student_id_photo_promo_v2.sql
-- Доработка акции «Фото на студенческий 4×200»:
--  1) Каденция зависит от тарифа: подписка (education_subscription) → пакет обновляется
--     каждые 30 дней; без подписки (подтверждён) → один раз навсегда. Реализуем через
--     period_key: 'lifetime' для verified-only, дата начала rolling-30 периода для подписчика.
--     UNIQUE(student_account_id, period_key) = один пакет на (аккаунт × период).
--  2) Онлайн-оплата по ссылке (payment_links): акция списывается при оплате счёта; для
--     возврата нужна привязка payment_link_id. Маркер акции хранится в payment_links.
-- Таблица на момент миграции пустая (бэкафилл тривиален). Идемпотентна, применяется сразу.

BEGIN;

-- 1) period_key: 'lifetime' (verified-only) либо 'YYYY-MM-DD' начала периода (подписчик)
ALTER TABLE student_id_photo_promo_redemptions
  ADD COLUMN IF NOT EXISTS period_key TEXT NOT NULL DEFAULT 'lifetime';

-- 2) Привязка к онлайн-счёту (для списания/возврата по оплате ссылки)
ALTER TABLE student_id_photo_promo_redemptions
  ADD COLUMN IF NOT EXISTS payment_link_id UUID REFERENCES payment_links(id) ON DELETE SET NULL;

-- 3) Заменяем lifetime-only уникальность на (аккаунт × период)
DROP INDEX IF EXISTS uq_student_id_photo_promo_account;
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_id_photo_promo_account_period
  ON student_id_photo_promo_redemptions(student_account_id, period_key);

CREATE INDEX IF NOT EXISTS idx_student_id_photo_promo_payment_link
  ON student_id_photo_promo_redemptions(payment_link_id)
  WHERE payment_link_id IS NOT NULL;

COMMENT ON COLUMN student_id_photo_promo_redemptions.period_key IS
  '''lifetime'' для подтверждённого без подписки (пакет 1 раз) либо ''YYYY-MM-DD'' начала rolling-30 периода для подписчика (пакет каждый месяц).';

-- 4) Маркер акции на онлайн-счёте: пишется при создании ссылки, применяется в вебхуке оплаты
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS student_id_photo_promo JSONB;

COMMENT ON COLUMN payment_links.student_id_photo_promo IS
  'Снимок акции «Фото на студенческий 4×200» (studentAccountId/userId/units/unitPrice/discountAmount/periodKey); списывается при оплате счёта.';

COMMIT;
