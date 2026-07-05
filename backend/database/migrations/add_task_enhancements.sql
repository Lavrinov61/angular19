-- Миграция: Расширение рабочей доски — карточка клиента, связывание задач
-- Зависит от: add_task_board.sql

-- ============================================================================
-- 1. unified_customer_id в work_tasks (кросс-мессенджер линковка)
-- ============================================================================
ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS unified_customer_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_unified_customer
    ON work_tasks(unified_customer_id) WHERE unified_customer_id IS NOT NULL;

-- ============================================================================
-- 2. task_links — M:N связь между задачами
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_a_id UUID NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
    task_b_id UUID NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
    link_type VARCHAR(20) DEFAULT 'related'
        CHECK (link_type IN ('related', 'duplicate', 'parent_child', 'merged')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (task_a_id != task_b_id),
    UNIQUE(task_a_id, task_b_id)
);

CREATE INDEX IF NOT EXISTS idx_task_links_a ON task_links(task_a_id);
CREATE INDEX IF NOT EXISTS idx_task_links_b ON task_links(task_b_id);
CREATE INDEX IF NOT EXISTS idx_task_links_type ON task_links(link_type);
