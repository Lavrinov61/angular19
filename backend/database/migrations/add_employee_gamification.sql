-- Employee Gamification: XP system, achievements, daily quests
-- Run: psql -U magnus_user -d magnus_photo_db -f add_employee_gamification.sql

-- XP Log: every action earns XP
CREATE TABLE IF NOT EXISTS employee_xp_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    xp_amount INTEGER NOT NULL,
    action_type VARCHAR(50) NOT NULL, -- 'task_completed', 'order_processed', 'shift_completed', 'chat_resolved', 'review_collected', 'streak_bonus', 'quest_completed'
    entity_id UUID,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_xp_employee ON employee_xp_log(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emp_xp_action ON employee_xp_log(action_type);

-- Achievement definitions (templates)
CREATE TABLE IF NOT EXISTS employee_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL, -- 'first_task', 'speed_demon', 'review_king'
    title VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50) NOT NULL, -- Material icon name
    category VARCHAR(50) DEFAULT 'general', -- 'productivity', 'quality', 'streak', 'milestone'
    xp_reward INTEGER DEFAULT 0,
    condition JSONB NOT NULL DEFAULT '{}', -- {"type": "count", "action": "task_completed", "target": 100}
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unlocked achievements per employee
CREATE TABLE IF NOT EXISTS employee_unlocked_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id UUID NOT NULL REFERENCES employee_achievements(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_unlocked_ach ON employee_unlocked_achievements(employee_id);

-- Daily quests
CREATE TABLE IF NOT EXISTS employee_daily_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_date DATE NOT NULL DEFAULT CURRENT_DATE,
    quest_type VARCHAR(50) NOT NULL, -- 'complete_tasks', 'process_orders', 'resolve_chats', 'collect_reviews'
    title VARCHAR(255) NOT NULL,
    target INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    xp_reward INTEGER NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, quest_date, quest_type)
);

CREATE INDEX IF NOT EXISTS idx_emp_quests_date ON employee_daily_quests(employee_id, quest_date);

-- Seed: initial achievement definitions
INSERT INTO employee_achievements (code, title, description, icon, category, xp_reward, condition, sort_order) VALUES
  ('first_task', 'Первое задание', 'Завершите первую задачу', 'task_alt', 'milestone', 50, '{"type":"count","action":"task_completed","target":1}', 1),
  ('task_10', 'Рабочая лошадка', '10 задач выполнено', 'checklist', 'productivity', 100, '{"type":"count","action":"task_completed","target":10}', 2),
  ('task_50', 'Мастер задач', '50 задач выполнено', 'military_tech', 'productivity', 250, '{"type":"count","action":"task_completed","target":50}', 3),
  ('task_100', 'Легенда продуктивности', '100 задач выполнено', 'emoji_events', 'productivity', 500, '{"type":"count","action":"task_completed","target":100}', 4),
  ('order_10', 'Обработчик', '10 заказов обработано', 'shopping_bag', 'productivity', 100, '{"type":"count","action":"order_processed","target":10}', 5),
  ('order_50', 'Конвейер', '50 заказов обработано', 'local_shipping', 'productivity', 250, '{"type":"count","action":"order_processed","target":50}', 6),
  ('chat_10', 'Коммуникатор', '10 чатов закрыто', 'chat', 'quality', 100, '{"type":"count","action":"chat_resolved","target":10}', 7),
  ('chat_50', 'Гуру общения', '50 чатов закрыто', 'forum', 'quality', 250, '{"type":"count","action":"chat_resolved","target":50}', 8),
  ('review_5', 'Собиратель звёзд', '5 отзывов собрано', 'star', 'quality', 150, '{"type":"count","action":"review_collected","target":5}', 9),
  ('review_25', 'Король отзывов', '25 отзывов собрано', 'stars', 'quality', 400, '{"type":"count","action":"review_collected","target":25}', 10),
  ('streak_3', 'Стабильность', '3 дня подряд на смене', 'local_fire_department', 'streak', 100, '{"type":"streak","target":3}', 11),
  ('streak_7', 'Неделя огня', '7 дней подряд на смене', 'whatshot', 'streak', 250, '{"type":"streak","target":7}', 12),
  ('streak_30', 'Железная воля', '30 дней подряд на смене', 'diamond', 'streak', 1000, '{"type":"streak","target":30}', 13),
  ('shift_first', 'Добро пожаловать', 'Завершите первую смену', 'waving_hand', 'milestone', 30, '{"type":"count","action":"shift_completed","target":1}', 14),
  ('xp_1000', 'Тысячник', 'Набрано 1000 XP', 'trending_up', 'milestone', 100, '{"type":"total_xp","target":1000}', 15)
ON CONFLICT (code) DO NOTHING;
