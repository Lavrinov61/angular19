-- JSONB-кэш вычисленного контекста чат-сессии
-- Хранит: hasPhoto, photoCount, selectedDoc, selectedTariff, orderNumber, upgradedTariff
-- Обновляется атомарно при каждом действии клиента вместо пересчёта из всех сообщений

ALTER TABLE visitor_chat_sessions ADD COLUMN IF NOT EXISTS context JSONB DEFAULT '{}'::jsonb;
