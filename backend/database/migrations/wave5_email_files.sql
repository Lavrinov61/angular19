-- Wave 5: Email Integration + File Storage CRM
-- Применять: PGPASSWORD=magnus_password psql -U magnus_user -d magnus_photo_db -h 127.0.0.1 -f backend/database/migrations/wave5_email_files.sql

-- ============================================================
-- TABLES
-- ============================================================

-- Входящие/исходящие email-сообщения
CREATE TABLE IF NOT EXISTS email_messages (
  id SERIAL PRIMARY KEY,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  cc_addresses TEXT[],
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  customer_phone VARCHAR(30),            -- привязанный клиент (по email → phone lookup)
  thread_id VARCHAR(200),               -- message-id для группировки цепочек
  in_reply_to VARCHAR(200),             -- replied message-id
  message_id VARCHAR(200) UNIQUE,       -- RFC 2822 Message-ID (для дедупликации)
  entity_type VARCHAR(50),              -- 'order', 'task', 'booking', 'chat', null
  entity_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'received' CHECK (status IN ('received','read','replied','archived','draft','sent','failed')),
  sent_by UUID REFERENCES users(id), -- кто отправил (для outbound)
  has_attachments BOOLEAN DEFAULT false,
  attachment_count INTEGER DEFAULT 0,
  error_message TEXT,                   -- для failed outbound
  imap_uid BIGINT,                      -- UID на IMAP-сервере (для синхронизации)
  imap_folder VARCHAR(100) DEFAULT 'INBOX',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_direction ON email_messages(direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_messages(status) WHERE status NOT IN ('archived');
CREATE INDEX IF NOT EXISTS idx_email_thread ON email_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_customer ON email_messages(customer_phone) WHERE customer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_entity ON email_messages(entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_imap_uid ON email_messages(imap_uid, imap_folder) WHERE imap_uid IS NOT NULL;

-- Шаблоны email-рассылок
CREATE TABLE IF NOT EXISTS email_templates (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  subject_template TEXT NOT NULL,        -- поддерживает {{var}}
  body_template TEXT NOT NULL,           -- HTML с {{var}} плейсхолдерами
  variables JSONB DEFAULT '[]',          -- описание переменных: [{name, label, required}]
  category VARCHAR(50) DEFAULT 'general',-- 'order', 'review', 'promo', 'booking', 'general'
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Файловое хранилище CRM
CREATE TABLE IF NOT EXISTS crm_files (
  id SERIAL PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE NOT NULL,       -- UUID для публичных URL
  filename VARCHAR(255) NOT NULL,         -- имя на диске (uuid + ext)
  original_name VARCHAR(500) NOT NULL,    -- исходное имя файла
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,            -- полный путь на диске
  entity_type VARCHAR(50),               -- 'order', 'task', 'booking', 'client', 'shared', 'email'
  entity_id VARCHAR(100),
  uploaded_by UUID REFERENCES users(id),
  is_public BOOLEAN DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  clamav_status VARCHAR(20) DEFAULT 'pending' CHECK (clamav_status IN ('pending','clean','infected','error','skipped')),
  clamav_result TEXT,                    -- сообщение от ClamAV
  deleted_at TIMESTAMPTZ,               -- soft delete
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_files_entity ON crm_files(entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_files_uploader ON crm_files(uploaded_by) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_files_uuid ON crm_files(uuid);

-- ============================================================
-- SEED: базовые email-шаблоны
-- ============================================================

INSERT INTO email_templates (slug, name, description, subject_template, body_template, variables, category) VALUES
(
  'order_confirmation',
  'Подтверждение заказа',
  'Отправляется клиенту после оплаты заказа',
  'Заказ {{order_id}} оплачен — Своё Фото',
  '<p>Спасибо за заказ {{order_id}}!</p><p>Сумма: {{total}} ₽</p>',
  '[{"name":"order_id","label":"Номер заказа","required":true},{"name":"total","label":"Сумма","required":true}]',
  'order'
),
(
  'booking_reminder',
  'Напоминание о записи',
  'Отправляется за день до записи',
  'Напоминаем о вашей записи — {{date}}',
  '<p>Ваша запись на {{date}} в {{time}} в студии Своё Фото.</p><p>Адрес: {{address}}</p>',
  '[{"name":"date","label":"Дата","required":true},{"name":"time","label":"Время","required":true},{"name":"address","label":"Адрес","required":false}]',
  'booking'
),
(
  'review_request',
  'Запрос отзыва',
  'Отправляется после выполнения заказа',
  '⭐ Оставьте отзыв о визите — Своё Фото',
  '<p>Спасибо за визит в Своё Фото! Оцените нашу работу: <a href="{{review_url}}">Оставить отзыв</a></p>',
  '[{"name":"review_url","label":"Ссылка на отзыв","required":true}]',
  'review'
),
(
  'manual_reply',
  'Ручной ответ оператора',
  'Свободный ответ оператора на входящее письмо',
  'Re: {{subject}}',
  '<p>{{body}}</p>',
  '[{"name":"subject","label":"Тема исходного письма","required":true},{"name":"body","label":"Текст ответа","required":true}]',
  'general'
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- UPDATE materialized view (добавить email в inbox если нужно)
-- ============================================================
-- Примечание: email добавляется в inbox через отдельный endpoint
-- (не через crm_inbox_view — чтобы не нарушать MV refresh logic)
