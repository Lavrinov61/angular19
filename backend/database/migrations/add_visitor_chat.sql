-- Миграция: Анонимный чат для посетителей
-- Позволяет общаться с клиентами без регистрации

-- Таблица чат-сессий посетителей
CREATE TABLE IF NOT EXISTS visitor_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Идентификация посетителя
    visitor_id VARCHAR(64) NOT NULL,           -- fingerprint из DeepLinkService
    visitor_name VARCHAR(100),                  -- Имя (если указано)
    visitor_phone VARCHAR(20),                  -- Телефон (если указано)
    visitor_email VARCHAR(255),                 -- Email (если указано)
    
    -- Канал чата
    channel VARCHAR(20) DEFAULT 'online',       -- online (онлайн-сервис) | studio (офлайн-студия)
    
    -- Контекст заказа
    selected_service VARCHAR(100),              -- Выбранный тариф
    selected_price INTEGER,                     -- Цена в рублях
    page_url VARCHAR(500),                      -- Страница, с которой начат чат
    
    -- Интеграции
    bitrix_dialog_id VARCHAR(100),              -- ID диалога в Bitrix24
    bitrix_user_id VARCHAR(100),                -- ID пользователя в Bitrix24
    
    -- Статусы
    status VARCHAR(20) DEFAULT 'open'           -- open, resolved, closed
        CHECK (status IN ('open', 'waiting', 'active', 'resolved', 'closed')),
    assigned_operator_id UUID REFERENCES users(id), -- Назначенный оператор
    
    -- Метаданные
    user_agent TEXT,
    ip_address INET,
    
    -- Временные метки
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE
);

-- Таблица сообщений
CREATE TABLE IF NOT EXISTS visitor_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES visitor_chat_sessions(id) ON DELETE CASCADE,
    
    -- Отправитель
    sender_type VARCHAR(20) NOT NULL            -- visitor, operator, bot
        CHECK (sender_type IN ('visitor', 'operator', 'bot')),
    sender_id VARCHAR(100),                     -- ID оператора или 'bot'
    sender_name VARCHAR(100),
    
    -- Сообщение
    message_type VARCHAR(20) DEFAULT 'text'     -- text, image, file, system
        CHECK (message_type IN ('text', 'image', 'file', 'system')),
    content TEXT NOT NULL,
    attachment_url VARCHAR(500),                -- URL файла/изображения
    attachment_name VARCHAR(255),
    
    -- Статусы
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    
    -- Bitrix sync
    bitrix_message_id VARCHAR(100),
    
    -- Временные метки
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблица быстрых ответов (для бота и операторов)
CREATE TABLE IF NOT EXISTS chat_quick_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    trigger_keywords TEXT[],                    -- Ключевые слова для триггера
    category VARCHAR(50),                       -- Категория: greeting, order, faq, etc.
    
    title VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    
    -- Порядок и активность
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor_id ON visitor_chat_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_channel ON visitor_chat_sessions(channel);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_status ON visitor_chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_created ON visitor_chat_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_messages_session ON visitor_chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_visitor_messages_created ON visitor_chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_quick_replies_category ON chat_quick_replies(category);
CREATE INDEX IF NOT EXISTS idx_quick_replies_keywords ON chat_quick_replies USING GIN(trigger_keywords);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_visitor_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_visitor_session_updated ON visitor_chat_sessions;
CREATE TRIGGER trigger_visitor_session_updated
    BEFORE UPDATE ON visitor_chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_visitor_session_timestamp();

-- Триггер для обновления last_message_at при новом сообщении
CREATE OR REPLACE FUNCTION update_session_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE visitor_chat_sessions 
    SET last_message_at = NEW.created_at
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_new_message ON visitor_chat_messages;
CREATE TRIGGER trigger_new_message
    AFTER INSERT ON visitor_chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_session_last_message();

-- Начальные быстрые ответы
INSERT INTO chat_quick_replies (category, trigger_keywords, title, content, sort_order) VALUES
('greeting', ARRAY['привет', 'здравствуйте', 'добрый день', 'hello'], 
 'Приветствие',
 'Здравствуйте! 👋 Добро пожаловать в Своё Фото! Я помогу вам оформить заказ. Чем могу помочь?',
 1),
 
('order', ARRAY['заказать', 'хочу заказать', 'оформить заказ'], 
 'Начало заказа',
 'Отлично! Для оформления заказа отправьте, пожалуйста, ваше фото (селфи) прямо сюда. Мы оценим его и подскажем, подойдёт ли оно для обработки.',
 2),
 
('price', ARRAY['цена', 'сколько стоит', 'стоимость', 'прайс'], 
 'Цены',
 'Наши цены:\n• Без ретуши — 350₽\n• С ретушью — 590₽ (популярный)\n• Срочное — 750₽ (10-15 мин)\n• На все документы — 890₽\n\nКакой вариант вас интересует?',
 3),
 
('time', ARRAY['сколько времени', 'как быстро', 'срок', 'когда будет готово'], 
 'Сроки',
 'Обычный заказ — 30 минут, срочный — 10-15 минут. Мы работаем ежедневно с 9:00 до 21:00.',
 4),
 
('payment', ARRAY['оплата', 'как оплатить', 'способы оплаты'], 
 'Оплата',
 'Принимаем карты (Сбербанк, Тинькофф, любые), СБП, переводы. Оплата после согласования готового фото — никаких рисков для вас!',
 5),
 
('delivery', ARRAY['доставка', 'как получить', 'печать'], 
 'Доставка',
 'Готовое фото отправляем:\n• Электронный файл — сразу в чат или на почту\n• Печатные фото — доставка СДЭК/Яндекс по всей России (2-5 дней)',
 6)

ON CONFLICT DO NOTHING;

-- Комментарии к таблицам
COMMENT ON TABLE visitor_chat_sessions IS 'Чат-сессии анонимных посетителей для онлайн-заказов';
COMMENT ON TABLE visitor_chat_messages IS 'Сообщения в чат-сессиях посетителей';
COMMENT ON TABLE chat_quick_replies IS 'Быстрые ответы для бота и операторов';
