-- 072_payroll_payout_accounts.sql
-- Банковские реквизиты сотрудников + расширение employee_commission_payouts для mark-as-paid
-- Идемпотентная миграция

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Таблица банковских реквизитов сотрудников
-- ══════════════════════════════════════════════════════════════════════════
-- Отдельная таблица, а НЕ JSONB в users.personal_data:
--   a) personal_data — generic JSONB без schema enforcement
--   b) Реквизиты нужны для payroll workflow — отдельная таблица = JOIN, индексы, валидация
--   c) Сотрудник может иметь несколько аккаунтов, один is_primary

CREATE TABLE IF NOT EXISTS employee_payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Тип способа выплаты
  method varchar(20) NOT NULL DEFAULT 'phone_transfer'
    CHECK (method IN ('phone_transfer', 'card_transfer', 'cash')),

  -- Банк (Тбанк, Сбер, Альфа, ВТБ, и т.д.)
  bank_name varchar(100),

  -- Номер телефона или карты (для phone_transfer / card_transfer)
  account_identifier varchar(50),

  -- ФИО получателя (может отличаться от display_name в users)
  recipient_name varchar(200) NOT NULL,

  -- Пометка "основной" — один на сотрудника
  is_primary boolean NOT NULL DEFAULT true,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Индекс: быстрый lookup по сотруднику
CREATE INDEX IF NOT EXISTS idx_employee_payout_accounts_employee
  ON employee_payout_accounts(employee_id);

-- Уникальный partial индекс: только один primary аккаунт на сотрудника
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_payout_accounts_primary
  ON employee_payout_accounts(employee_id) WHERE is_primary = true;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Расширение employee_commission_payouts — поля для отметки "оплачено"
-- ══════════════════════════════════════════════════════════════════════════

-- Кто отметил как оплаченный
ALTER TABLE employee_commission_payouts
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES users(id);

-- Когда отмечено оплаченным
ALTER TABLE employee_commission_payouts
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Способ оплаты (перевод по телефону, на карту, наличные)
ALTER TABLE employee_commission_payouts
  ADD COLUMN IF NOT EXISTS payment_method varchar(20);

-- Ссылка на аккаунт выплаты
ALTER TABLE employee_commission_payouts
  ADD COLUMN IF NOT EXISTS payout_account_id uuid REFERENCES employee_payout_accounts(id);

-- Референс перевода (номер операции и т.п.)
ALTER TABLE employee_commission_payouts
  ADD COLUMN IF NOT EXISTS transfer_reference varchar(500);

-- Заметки к выплате
ALTER TABLE employee_commission_payouts
  ADD COLUMN IF NOT EXISTS payment_notes text;

-- Сумма к выплате (gross - НДФЛ). Хранится при mark-as-paid для аудита
ALTER TABLE employee_commission_payouts
  ADD COLUMN IF NOT EXISTS net_amount numeric(12,2);

-- Индекс: payouts по статусу для admin panel
CREATE INDEX IF NOT EXISTS idx_employee_commission_payouts_status
  ON employee_commission_payouts(status, period DESC);

COMMIT;
