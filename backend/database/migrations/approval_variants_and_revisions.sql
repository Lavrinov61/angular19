-- F14: Enterprise photo approval variants & revisions
-- Adds multi-variant support, revision history, chat integration, SLA tracking

-- 1. Таблица вариантов (N вариантов на 1 фото-позицию)
CREATE TABLE IF NOT EXISTS photo_approval_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    approval_id UUID NOT NULL REFERENCES photo_approvals(id) ON DELETE CASCADE,
    variant_url TEXT NOT NULL,
    thumbnail_url TEXT,
    label VARCHAR(100),
    sort_order INT DEFAULT 0,
    is_selected BOOLEAN DEFAULT FALSE,
    selected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_av_approval ON photo_approval_variants(approval_id);

-- 2. Таблица ревизий (история итераций)
CREATE TABLE IF NOT EXISTS photo_approval_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    approval_id UUID NOT NULL REFERENCES photo_approvals(id) ON DELETE CASCADE,
    revision_number INT NOT NULL DEFAULT 1,
    variants_snapshot JSONB DEFAULT '[]',
    client_comment TEXT,
    annotations_snapshot JSONB DEFAULT '[]',
    status VARCHAR(30) NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ar_approval ON photo_approval_revisions(approval_id);

-- 3. Расширение photo_approvals
ALTER TABLE photo_approvals
    ADD COLUMN IF NOT EXISTS revision_count INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS selected_variant_id UUID,
    ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
    ADD COLUMN IF NOT EXISTS original_thumbnail_url TEXT;

-- 4. Расширение photo_approval_sessions (chat-привязка + SLA)
ALTER TABLE photo_approval_sessions
    ADD COLUMN IF NOT EXISTS chat_session_id UUID,
    ADD COLUMN IF NOT EXISTS sla_hours INT DEFAULT 48,
    ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
