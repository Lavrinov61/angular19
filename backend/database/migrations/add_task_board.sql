-- Миграция: Рабочая доска сотрудников (Task Board)
-- Система задач, смен и передачи дел между сотрудниками двух точек

-- ============================================================================
-- 1. Расширение таблицы studios — код точки
-- ============================================================================
ALTER TABLE studios ADD COLUMN IF NOT EXISTS location_code VARCHAR(20) UNIQUE;
-- UPDATE studios SET location_code = 'soborny' WHERE name ILIKE '%соборн%';
-- UPDATE studios SET location_code = 'barrikadnaya' WHERE name ILIKE '%баррикад%';

-- ============================================================================
-- 2. employee_shifts — Смены сотрудников
-- ============================================================================
CREATE TABLE IF NOT EXISTS employee_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,

    -- Дата и время смены
    shift_date DATE NOT NULL,
    start_time TIME NOT NULL DEFAULT '09:00',
    end_time TIME NOT NULL DEFAULT '19:30',

    -- Статус
    status VARCHAR(20) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),

    -- Заметки
    notes TEXT,

    -- Временные метки
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Один сотрудник = одна смена в день
    UNIQUE(employee_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_shifts_employee ON employee_shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_studio ON employee_shifts(studio_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON employee_shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON employee_shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_active ON employee_shifts(shift_date, status)
    WHERE status IN ('scheduled', 'active');

-- ============================================================================
-- 3. work_tasks — Задачи / рабочие единицы
-- ============================================================================
CREATE TABLE IF NOT EXISTS work_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Номер задачи (человекочитаемый)
    task_number SERIAL,

    -- Тип задачи
    task_type VARCHAR(30) NOT NULL
        CHECK (task_type IN (
            'photo_order',        -- заказ на фото/печать
            'chat_inquiry',       -- обращение из чата
            'walk_in',            -- клиент пришел на точку
            'callback',           -- перезвонить клиенту
            'retouch',            -- ретушь фото
            'delivery',           -- отправка заказа
            'internal',           -- внутренняя задача
            'cross_location'      -- межточечный заказ
        )),

    -- Привязка к сущностям (nullable)
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    print_order_id UUID,  -- FK добавлен ниже (photo_print_orders может быть без каскада)
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    chat_session_id UUID REFERENCES visitor_chat_sessions(id) ON DELETE SET NULL,
    client_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Назначение
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_studio_id UUID REFERENCES studios(id) ON DELETE SET NULL,

    -- Приоритет и статус
    priority VARCHAR(10) DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'open'
        CHECK (status IN (
            'open',           -- новая, не взята
            'assigned',       -- назначена конкретному сотруднику
            'in_progress',    -- в работе
            'waiting',        -- ожидает (клиента, материалы, подтверждение)
            'handed_off',     -- передана следующей смене
            'completed',      -- выполнена
            'cancelled'       -- отменена
        )),

    -- Контент задачи
    title VARCHAR(255) NOT NULL,
    description TEXT,

    -- Контекст клиента (денормализовано для быстрого отображения)
    client_name VARCHAR(255),
    client_phone VARCHAR(20),
    client_channel VARCHAR(20),  -- online, whatsapp, telegram, walk_in, phone, max

    -- Дедлайн
    due_date TIMESTAMP WITH TIME ZONE,

    -- AI summary
    ai_summary TEXT,

    -- Метаданные (расширяемо)
    metadata JSONB DEFAULT '{}',

    -- Временные метки
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Кто создал
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- FK на photo_print_orders (может не существовать в некоторых окружениях)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'photo_print_orders') THEN
        ALTER TABLE work_tasks ADD CONSTRAINT fk_work_tasks_print_order
            FOREIGN KEY (print_order_id) REFERENCES photo_print_orders(id) ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_number ON work_tasks(task_number);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON work_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_studio ON work_tasks(assigned_studio_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON work_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON work_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON work_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON work_tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_order ON work_tasks(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_print_order ON work_tasks(print_order_id) WHERE print_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_booking ON work_tasks(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_chat ON work_tasks(chat_session_id) WHERE chat_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_open ON work_tasks(status, assigned_studio_id)
    WHERE status IN ('open', 'assigned', 'in_progress', 'waiting');
CREATE INDEX IF NOT EXISTS idx_tasks_created ON work_tasks(created_at DESC);

-- ============================================================================
-- 4. task_notes — Заметки / комментарии к задачам
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Тип заметки
    note_type VARCHAR(20) DEFAULT 'comment'
        CHECK (note_type IN ('comment', 'status_change', 'handoff', 'system', 'ai_summary')),

    content TEXT NOT NULL,

    -- Метаданные (для status_change: {from, to}, для system: {event})
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_task ON task_notes(task_id);
CREATE INDEX IF NOT EXISTS idx_notes_author ON task_notes(author_id);
CREATE INDEX IF NOT EXISTS idx_notes_created ON task_notes(created_at);

-- ============================================================================
-- 5. task_handoffs — Передача задач между сменами
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_handoffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,

    -- Кто передает, кому
    from_employee_id UUID NOT NULL REFERENCES users(id),
    to_employee_id UUID REFERENCES users(id),  -- NULL = следующей смене
    from_shift_id UUID REFERENCES employee_shifts(id) ON DELETE SET NULL,

    -- Контекст передачи
    handoff_note TEXT NOT NULL,
    ai_context_summary TEXT,

    -- Подтверждение принятия
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by UUID REFERENCES users(id),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handoffs_task ON task_handoffs(task_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_from ON task_handoffs(from_employee_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_to ON task_handoffs(to_employee_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_pending ON task_handoffs(acknowledged)
    WHERE acknowledged = FALSE;

-- ============================================================================
-- 6. shift_briefings — AI-сводки для начала смены
-- ============================================================================
CREATE TABLE IF NOT EXISTS shift_briefings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES employee_shifts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES users(id),
    studio_id UUID NOT NULL REFERENCES studios(id),

    briefing_date DATE NOT NULL,

    -- AI-сгенерированная сводка
    summary TEXT NOT NULL,
    structured_data JSONB DEFAULT '{}',

    -- Статус
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,

    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(shift_id)
);

CREATE INDEX IF NOT EXISTS idx_briefings_employee ON shift_briefings(employee_id);
CREATE INDEX IF NOT EXISTS idx_briefings_date ON shift_briefings(briefing_date);
CREATE INDEX IF NOT EXISTS idx_briefings_unread ON shift_briefings(is_read)
    WHERE is_read = FALSE;

-- ============================================================================
-- 7. chat_task_links — Связь чат-сессий с задачами (M:N)
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_task_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,

    -- Один из: visitor_chat_session ИЛИ bitrix chat
    chat_session_id UUID REFERENCES visitor_chat_sessions(id) ON DELETE SET NULL,
    bitrix_chat_id VARCHAR(100),
    messenger_type VARCHAR(20),  -- website, whatsapp, telegram, max

    linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    linked_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_links_task ON chat_task_links(task_id);
CREATE INDEX IF NOT EXISTS idx_chat_links_session ON chat_task_links(chat_session_id)
    WHERE chat_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_links_bitrix ON chat_task_links(bitrix_chat_id)
    WHERE bitrix_chat_id IS NOT NULL;

-- Уникальность: одна связь task-session, одна связь task-bitrix_chat
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_links_task_session
    ON chat_task_links(task_id, chat_session_id) WHERE chat_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_links_task_bitrix
    ON chat_task_links(task_id, bitrix_chat_id) WHERE bitrix_chat_id IS NOT NULL;

-- ============================================================================
-- Triggers для updated_at
-- ============================================================================
CREATE TRIGGER update_employee_shifts_updated_at
    BEFORE UPDATE ON employee_shifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_work_tasks_updated_at
    BEFORE UPDATE ON work_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
