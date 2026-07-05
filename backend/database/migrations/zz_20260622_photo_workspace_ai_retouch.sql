CREATE TABLE IF NOT EXISTS photo_workspace_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES photo_print_orders(id) ON DELETE CASCADE,
  approval_session_id UUID REFERENCES photo_approval_sessions(id) ON DELETE SET NULL,
  source_asset_id TEXT,
  source_asset_url TEXT NOT NULL,
  source_asset_name TEXT NOT NULL DEFAULT 'Фото',
  label TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'passport_rf',
  tariff_level TEXT NOT NULL DEFAULT 'basic'
    CHECK (tariff_level IN ('basic', 'extended', 'maximum', 'super')),
  variant_limit INTEGER NOT NULL DEFAULT 2 CHECK (variant_limit BETWEEN 1 AND 10),
  crop_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  crop_job_id UUID REFERENCES ai_retouch_jobs(id) ON DELETE SET NULL,
  crop_result_url TEXT,
  crop_result_thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'crop_ready', 'prompt_ready', 'ai_running', 'photoshop_review', 'ready_to_send', 'sent')),
  active_section TEXT NOT NULL DEFAULT 'crop',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, source_asset_url)
);

CREATE TABLE IF NOT EXISTS photo_workspace_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES photo_workspace_items(id) ON DELETE CASCADE,
  asset_id TEXT,
  asset_url TEXT NOT NULL,
  asset_name TEXT NOT NULL DEFAULT 'Референс',
  thumbnail_url TEXT,
  source TEXT NOT NULL DEFAULT 'order',
  roles TEXT[] NOT NULL DEFAULT '{}',
  use_in_ai BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, asset_url),
  CHECK (NOT (use_in_ai = TRUE AND cardinality(roles) = 0))
);

CREATE TABLE IF NOT EXISTS photo_workspace_wishes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES photo_workspace_items(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('order_comment', 'order_wishes', 'chat_message', 'approval_revision', 'manual')),
  source_id TEXT,
  source_label TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  reject_reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(text)) > 0),
  CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS photo_workspace_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES photo_workspace_items(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 10),
  source_type TEXT NOT NULL DEFAULT 'ai' CHECK (source_type IN ('ai', 'photoshop_only')),
  internal_name TEXT NOT NULL,
  preset_slug TEXT NOT NULL,
  preset_label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  base_prompt TEXT NOT NULL DEFAULT '',
  manual_prompt TEXT NOT NULL DEFAULT '',
  final_prompt TEXT NOT NULL DEFAULT '',
  prompt_ready BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'planned',
  ai_job_id UUID REFERENCES ai_retouch_jobs(id) ON DELETE SET NULL,
  ai_original_url TEXT,
  ai_original_thumbnail_url TEXT,
  ai_original_expires_at TIMESTAMPTZ,
  photoshop_url TEXT,
  photoshop_thumbnail_url TEXT,
  photoshop_uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  photoshop_uploaded_at TIMESTAMPTZ,
  checked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ,
  approval_photo_id UUID REFERENCES photo_approvals(id) ON DELETE SET NULL,
  approval_variant_id UUID REFERENCES photo_approval_variants(id) ON DELETE SET NULL,
  approval_position_kind TEXT CHECK (approval_position_kind IN ('primary', 'variant')),
  sent_at TIMESTAMPTZ,
  downloaded_at TIMESTAMPTZ,
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, slot_number),
  CHECK (status IN (
    'planned', 'pending_generation', 'generating', 'ai_generated',
    'needs_photoshop_check', 'downloaded_for_check', 'photoshop_uploaded',
    'checked', 'sent_to_client', 'error', 'stale_after_recrop'
  )),
  CHECK (source_type <> 'photoshop_only' OR ai_job_id IS NULL)
);

CREATE TABLE IF NOT EXISTS photo_workspace_journal (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES photo_print_orders(id) ON DELETE CASCADE,
  item_id UUID REFERENCES photo_workspace_items(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES photo_workspace_variants(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
);

CREATE TABLE IF NOT EXISTS photo_workspace_notification_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES photo_print_orders(id) ON DELETE CASCADE,
  approval_session_id UUID NOT NULL REFERENCES photo_approval_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'cancelled')),
  pending_change_count INTEGER NOT NULL DEFAULT 1 CHECK (pending_change_count >= 0),
  message_text TEXT NOT NULL DEFAULT 'Мы обновили варианты обработки, пожалуйста, посмотрите согласование ещё раз.',
  scheduled_for TIMESTAMPTZ NOT NULL,
  last_change_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_workspace_items_order ON photo_workspace_items(order_id);
CREATE INDEX IF NOT EXISTS idx_photo_workspace_refs_item ON photo_workspace_references(item_id);
CREATE INDEX IF NOT EXISTS idx_photo_workspace_wishes_item ON photo_workspace_wishes(item_id);
CREATE INDEX IF NOT EXISTS idx_photo_workspace_variants_item ON photo_workspace_variants(item_id, slot_number);
CREATE INDEX IF NOT EXISTS idx_photo_workspace_variants_job ON photo_workspace_variants(ai_job_id) WHERE ai_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_photo_workspace_journal_item_created ON photo_workspace_journal(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photo_workspace_journal_expires ON photo_workspace_journal(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_workspace_notify_one_scheduled
  ON photo_workspace_notification_batches(approval_session_id)
  WHERE status = 'scheduled';

INSERT INTO rbac_permissions (id, slug, module, display_name, description, is_active)
VALUES (uuid_generate_v4(), 'photo-workspace:edit-completed', 'photo-workspace', 'Редактировать завершённые фото-заказы', 'Разрешает обновлять workspace и согласование после завершения заказа', TRUE)
ON CONFLICT (slug) DO NOTHING;

DROP TRIGGER IF EXISTS update_photo_workspace_items_updated_at ON photo_workspace_items;
CREATE TRIGGER update_photo_workspace_items_updated_at
BEFORE UPDATE ON photo_workspace_items
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_photo_workspace_references_updated_at ON photo_workspace_references;
CREATE TRIGGER update_photo_workspace_references_updated_at
BEFORE UPDATE ON photo_workspace_references
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_photo_workspace_wishes_updated_at ON photo_workspace_wishes;
CREATE TRIGGER update_photo_workspace_wishes_updated_at
BEFORE UPDATE ON photo_workspace_wishes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_photo_workspace_variants_updated_at ON photo_workspace_variants;
CREATE TRIGGER update_photo_workspace_variants_updated_at
BEFORE UPDATE ON photo_workspace_variants
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_photo_workspace_notification_batches_updated_at ON photo_workspace_notification_batches;
CREATE TRIGGER update_photo_workspace_notification_batches_updated_at
BEFORE UPDATE ON photo_workspace_notification_batches
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
