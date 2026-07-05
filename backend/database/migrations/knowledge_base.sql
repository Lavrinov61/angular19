-- =============================================================
-- Knowledge Base — Enterprise Schema
-- Phase 0 of Express → Rust (Axum) migration
-- =============================================================
--
-- Architecture: Knowledge Graph + Versioning + Semantic Search
--               + AI Enrichment Pipeline + RBAC + Data Provenance
--
-- Pattern: Google Knowledge Graph + Amazon Kendra + RAG Pipeline
--
-- Tables (11):
--   1.  kb_config              — System configuration (KV store)
--   2.  kb_categories          — Hierarchical taxonomy tree
--   3.  kb_entities            — Core knowledge entries
--   4.  kb_entity_versions     — Full audit trail with diffs
--   5.  kb_relations           — Knowledge graph edges
--   6.  kb_metrics             — Time-series business data
--   7.  kb_metric_definitions  — Metric catalog
--   8.  kb_enrichment_tasks    — AI pipeline queue
--   9.  kb_data_sources        — Data provenance registry
--   10. kb_source_links        — Entity ↔ source mapping
--   11. kb_access_rules        — RBAC for KB
--
-- Extensions: pgvector (semantic search), pg_trgm (fuzzy text)
-- Seed data: 14 root categories, 70+ subcategories,
--            20+ metric definitions, default access rules
--
-- Entity Types & JSONB Metadata Schemas:
--
--   'service'        — base_price, currency, duration_minutes, delivery_methods[],
--                       availability[], locations[], requires_appointment,
--                       popular, new, process_steps[], min_price, max_price
--
--   'equipment'      — brand, model, category, serial_number, purchase_date,
--                       purchase_price, location_slug, status, specs:{},
--                       maintenance_schedule, warranty_until, condition
--
--   'location'       — address, city, district, coordinates:{lat,lng}, capacity,
--                       area_sqm, working_hours:{}, opened_at, features[],
--                       transport_info, parking, renovation_year
--
--   'person'         — role, experience_years, specializations[], hourly_rate,
--                       portfolio_url, events_covered, certifications[], bio,
--                       languages[], education
--
--   'competitor'     — website, city, founded_year, total_customers, rating,
--                       review_count, pricing:{}, services[], strengths[],
--                       weaknesses[], market_position, last_checked_at
--
--   'process'        — steps[], duration_minutes, participants[], inputs[],
--                       outputs[], tools_required[], sla:{}, automation_level,
--                       frequency, exceptions[]
--
--   'faq'            — question, short_answer, audience, related_services[],
--                       asked_frequency, last_updated_reason
--
--   'usp'            — claim, evidence[], impact_metric, comparison_data:{},
--                       target_audience, messaging_variants[]
--
--   'content'        — content_type, channel, target_audience, keywords[],
--                       publish_date, performance:{views,clicks,conversions}
--
--   'market_insight' — insight_type, data_source, date_range:{},
--                       confidence, methodology, raw_data:{}, actionable
--
--   'product'        — sku, category, materials[], dimensions:{},
--                       cost_price, retail_price, margin_percent,
--                       supplier, lead_time_days, min_stock
--
--   'brand_asset'    — asset_type, format, dimensions, file_url,
--                       usage_guidelines, color_codes:{}, fonts[]
--
-- =============================================================

-- Extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pgvector: may require Yandex Cloud console activation
-- If this fails, the rest of the migration still applies
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgvector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not available — semantic search disabled. Enable via Yandex Cloud console (extension name: pgvector).';
END $$;


-- =============================================================
-- 1. SYSTEM CONFIGURATION
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_config (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  description   TEXT,
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kb_config IS 'KB system configuration — embedding model, enrichment settings, thresholds';

INSERT INTO kb_config (key, value, description) VALUES
  ('embedding_model', '"voyage-3"', 'Model for generating embeddings (Voyage AI recommended by Anthropic)'),
  ('embedding_dimensions', '1024', 'Vector dimensions for the chosen model'),
  ('enrichment_enabled', 'true', 'Global toggle for AI enrichment pipeline'),
  ('enrichment_max_retries', '3', 'Max retry attempts for failed enrichment tasks'),
  ('scrape_interval_hours', '168', 'Competitor scraping interval (1 week)'),
  ('confidence_threshold', '0.7', 'Minimum confidence for auto-publishing AI-generated entries'),
  ('version_retention_days', '365', 'How long to keep entity versions'),
  ('search_result_limit', '50', 'Default search results per page'),
  ('api_rate_limit_rpm', '120', 'API rate limit (requests per minute per client)')
ON CONFLICT (key) DO NOTHING;


-- =============================================================
-- 2. HIERARCHICAL TAXONOMY
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES kb_categories(id) ON DELETE CASCADE,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  icon          TEXT,                -- Material icon name for CRM UI
  sort_order    INT NOT NULL DEFAULT 0,
  metadata      JSONB NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  entity_count  INT NOT NULL DEFAULT 0,  -- denormalized counter
  depth         INT NOT NULL DEFAULT 0,  -- 0 = root
  path          TEXT NOT NULL DEFAULT '', -- materialized path: 'company/history'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kb_categories IS 'Hierarchical taxonomy tree — 14 root domains, 70+ leaves';

CREATE INDEX IF NOT EXISTS idx_kb_categories_parent ON kb_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_kb_categories_path ON kb_categories(path);
CREATE INDEX IF NOT EXISTS idx_kb_categories_active ON kb_categories(is_active) WHERE is_active = TRUE;


-- =============================================================
-- 3. CORE KNOWLEDGE ENTITIES
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID NOT NULL REFERENCES kb_categories(id) ON DELETE RESTRICT,

  -- Classification
  entity_type     TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'archived', 'deprecated', 'review')),
  visibility      TEXT NOT NULL DEFAULT 'internal'
                    CHECK (visibility IN ('public', 'internal', 'confidential')),

  -- Content
  name            TEXT NOT NULL,
  summary         TEXT,            -- short description (1-2 sentences)
  content         TEXT,            -- full markdown content
  metadata        JSONB NOT NULL DEFAULT '{}',  -- structured data per entity_type
  tags            TEXT[] NOT NULL DEFAULT '{}',

  -- Provenance
  source_type     TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source_type IN (
                      'manual', 'import', 'ai_generated', 'ai_enriched',
                      'web_scraped', 'analytics', 'conversation', 'api'
                    )),
  source_ref      TEXT,            -- URL, file path, conversation ID, etc.
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00
                    CHECK (confidence BETWEEN 0 AND 1),
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at     TIMESTAMPTZ,

  -- Search
  search_vector   TSVECTOR,        -- auto-generated by trigger
  -- embedding: added conditionally below if pgvector available

  -- Versioning
  version         INT NOT NULL DEFAULT 1,

  -- Audit
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ      -- soft delete
);

COMMENT ON TABLE kb_entities IS 'Core knowledge entries — services, equipment, locations, people, competitors, processes, FAQs, USPs, market insights';

-- Add vector column if pgvector is available
DO $$ BEGIN
  ALTER TABLE kb_entities ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available — embedding column skipped';
END $$;

-- Primary indexes
CREATE INDEX IF NOT EXISTS idx_kb_entities_category ON kb_entities(category_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_entities_type ON kb_entities(entity_type, status);
CREATE INDEX IF NOT EXISTS idx_kb_entities_status ON kb_entities(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kb_entities_created ON kb_entities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_entities_verified ON kb_entities(is_verified, status)
  WHERE is_verified = FALSE AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_kb_entities_deleted ON kb_entities(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Search indexes
CREATE INDEX IF NOT EXISTS idx_kb_entities_search ON kb_entities USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_kb_entities_tags ON kb_entities USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_kb_entities_metadata ON kb_entities USING gin(metadata jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_kb_entities_name_trgm ON kb_entities USING gin(name gin_trgm_ops);

-- Vector index (HNSW for high recall, good for <100K entities)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_kb_entities_embedding
    ON kb_entities USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector HNSW index skipped — extension not available';
END $$;


-- =============================================================
-- 4. ENTITY VERSIONING (Audit Trail)
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_entity_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,
  version         INT NOT NULL,

  -- Snapshot of the entity at this version
  name            TEXT NOT NULL,
  summary         TEXT,
  content         TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL,
  visibility      TEXT NOT NULL,

  -- Change info
  change_type     TEXT NOT NULL DEFAULT 'update'
                    CHECK (change_type IN ('create', 'update', 'verify', 'archive',
                                           'restore', 'enrich', 'merge')),
  change_reason   TEXT,
  diff            JSONB,           -- structured diff from previous version
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(entity_id, version)
);

COMMENT ON TABLE kb_entity_versions IS 'Full audit trail — every entity change creates a version snapshot';

CREATE INDEX IF NOT EXISTS idx_kb_versions_entity ON kb_entity_versions(entity_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_kb_versions_changed_by ON kb_entity_versions(changed_by, created_at DESC);


-- =============================================================
-- 5. KNOWLEDGE GRAPH (Relations)
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_relations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id  UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,
  to_entity_id    UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,

  relation_type   TEXT NOT NULL,
  -- Supported types:
  --   part_of, contains, used_in, requires, depends_on,
  --   performed_by, located_at, competes_with, alternative_to,
  --   replaced_by, produces, documented_in, related_to,
  --   specializes_in, priced_at, serves, enables, complements,
  --   derived_from, instance_of, similar_to

  label           TEXT,            -- human-readable label (optional)
  weight          DECIMAL(5,2) NOT NULL DEFAULT 1.0
                    CHECK (weight BETWEEN 0 AND 100),
  bidirectional   BOOLEAN NOT NULL DEFAULT FALSE,
  metadata        JSONB NOT NULL DEFAULT '{}',

  -- Provenance
  source_type     TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source_type IN ('manual', 'ai_generated', 'import', 'inferred')),
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00
                    CHECK (confidence BETWEEN 0 AND 1),

  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate relations
  UNIQUE(from_entity_id, to_entity_id, relation_type)
);

COMMENT ON TABLE kb_relations IS 'Knowledge graph edges — typed, weighted, optional bidirectional';

CREATE INDEX IF NOT EXISTS idx_kb_relations_from ON kb_relations(from_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_kb_relations_to ON kb_relations(to_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_kb_relations_type ON kb_relations(relation_type);

-- Prevent self-references
ALTER TABLE kb_relations DROP CONSTRAINT IF EXISTS kb_relations_no_self_ref;
ALTER TABLE kb_relations ADD CONSTRAINT kb_relations_no_self_ref
  CHECK (from_entity_id != to_entity_id);


-- =============================================================
-- 6. METRIC DEFINITIONS (Catalog)
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_metric_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  unit            TEXT NOT NULL DEFAULT 'count',
                    -- rub, percent, count, minutes, hours, days, rating, index
  aggregation     TEXT NOT NULL DEFAULT 'sum'
                    CHECK (aggregation IN ('sum', 'avg', 'min', 'max', 'count',
                                           'median', 'last', 'first', 'weighted_avg')),
  category        TEXT NOT NULL DEFAULT 'business',
                    -- business, financial, operational, quality, marketing, competitor
  is_cumulative   BOOLEAN NOT NULL DEFAULT FALSE,
  alert_threshold JSONB,           -- { "min": 0, "max": 100, "warning": 80 }
  dashboard_config JSONB,          -- { "chart_type": "line", "color": "#4CAF50" }
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kb_metric_definitions IS 'Metric catalog — defines what metrics exist, units, aggregation rules, alert thresholds';


-- =============================================================
-- 7. TIME-SERIES METRICS
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id   UUID NOT NULL REFERENCES kb_metric_definitions(id) ON DELETE RESTRICT,

  metric_value    DECIMAL NOT NULL,
  dimensions      JSONB NOT NULL DEFAULT '{}',
                    -- Flexible dimensions: { "service": "retouch", "channel": "online",
                    --   "location": "soborniy", "segment": "new_customers" }

  period_type     TEXT NOT NULL DEFAULT 'daily'
                    CHECK (period_type IN ('hourly', 'daily', 'weekly', 'monthly',
                                           'quarterly', 'yearly', 'custom')),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,

  -- Provenance
  source_type     TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source_type IN ('manual', 'pos', 'analytics', 'ai_calculated',
                                           'web_scraped', 'api', 'import')),
  source_ref      TEXT,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00
                    CHECK (confidence BETWEEN 0 AND 1),
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate metrics for same period
  UNIQUE(definition_id, dimensions, period_type, period_start)
);

COMMENT ON TABLE kb_metrics IS 'Time-series business data — revenue, conversion, satisfaction, competitor prices';

CREATE INDEX IF NOT EXISTS idx_kb_metrics_definition ON kb_metrics(definition_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_kb_metrics_period ON kb_metrics(period_start DESC, period_type);
CREATE INDEX IF NOT EXISTS idx_kb_metrics_dimensions ON kb_metrics USING gin(dimensions jsonb_path_ops);

-- Constraint: period_end >= period_start
ALTER TABLE kb_metrics DROP CONSTRAINT IF EXISTS kb_metrics_period_valid;
ALTER TABLE kb_metrics ADD CONSTRAINT kb_metrics_period_valid
  CHECK (period_end >= period_start);


-- =============================================================
-- 8. AI ENRICHMENT PIPELINE
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_enrichment_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       UUID REFERENCES kb_entities(id) ON DELETE CASCADE,

  task_type       TEXT NOT NULL,
                    -- embed, summarize, extract_relations, verify_facts,
                    -- update_pricing, scrape_competitor, analyze_market,
                    -- generate_faq, compare_prices, detect_duplicates,
                    -- enrich_metadata, translate, categorize

  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed',
                                      'failed', 'cancelled', 'scheduled')),
  priority        INT NOT NULL DEFAULT 5
                    CHECK (priority BETWEEN 1 AND 10),  -- 1 = highest

  -- Task configuration
  payload         JSONB NOT NULL DEFAULT '{}',   -- input data for the task
  result          JSONB,                          -- output data
  error           TEXT,

  -- Retry logic
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3,
  retry_after     TIMESTAMPTZ,

  -- Scheduling
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,

  -- Recurring tasks
  cron_expression TEXT,            -- e.g., '0 3 * * 1' (every Monday 3am)
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kb_enrichment_tasks IS 'AI pipeline queue — embedding, summarization, relation extraction, competitor scraping, price analysis';

CREATE INDEX IF NOT EXISTS idx_kb_enrichment_pending
  ON kb_enrichment_tasks(priority, scheduled_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_kb_enrichment_entity ON kb_enrichment_tasks(entity_id);
CREATE INDEX IF NOT EXISTS idx_kb_enrichment_type ON kb_enrichment_tasks(task_type, status);
CREATE INDEX IF NOT EXISTS idx_kb_enrichment_recurring
  ON kb_enrichment_tasks(next_run_at)
  WHERE cron_expression IS NOT NULL AND status != 'cancelled';


-- =============================================================
-- 9. DATA PROVENANCE
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_data_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  source_type     TEXT NOT NULL
                    CHECK (source_type IN ('file', 'url', 'api', 'database',
                                           'manual', 'conversation', 'scraper')),
  config          JSONB NOT NULL DEFAULT '{}',
                    -- Connection details, file paths, API endpoints, selectors
                    -- { "url": "https://3x4photo.ru", "selectors": {...},
                    --   "auth": null, "rate_limit": "1/min" }
  sync_schedule   TEXT,            -- cron expression for auto-sync
  last_synced_at  TIMESTAMPTZ,
  sync_status     TEXT DEFAULT 'idle'
                    CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error      TEXT,
  entity_count    INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kb_data_sources IS 'Data provenance registry — where knowledge comes from (files, URLs, APIs, conversations)';

CREATE TABLE IF NOT EXISTS kb_source_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,
  source_id       UUID NOT NULL REFERENCES kb_data_sources(id) ON DELETE CASCADE,
  external_id     TEXT,            -- ID in the source system
  sync_hash       TEXT,            -- hash of content for change detection
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(entity_id, source_id)
);

COMMENT ON TABLE kb_source_links IS 'Entity ↔ source mapping with sync hash for incremental updates';

CREATE INDEX IF NOT EXISTS idx_kb_source_links_entity ON kb_source_links(entity_id);
CREATE INDEX IF NOT EXISTS idx_kb_source_links_source ON kb_source_links(source_id);


-- =============================================================
-- 10. ACCESS CONTROL
-- =============================================================

CREATE TABLE IF NOT EXISTS kb_access_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role            TEXT NOT NULL,      -- admin, manager, photographer, employee, ai_agent, public_api
  category_slug   TEXT,               -- NULL = applies to all categories
  entity_type     TEXT,               -- NULL = applies to all entity types

  can_read        BOOLEAN NOT NULL DEFAULT TRUE,
  can_create      BOOLEAN NOT NULL DEFAULT FALSE,
  can_update      BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete      BOOLEAN NOT NULL DEFAULT FALSE,
  can_verify      BOOLEAN NOT NULL DEFAULT FALSE,
  can_export      BOOLEAN NOT NULL DEFAULT FALSE,

  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(role, category_slug, entity_type)
);

COMMENT ON TABLE kb_access_rules IS 'RBAC for KB — role × category × entity_type → permissions';


-- =============================================================
-- 11. FUNCTIONS & TRIGGERS
-- =============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION kb_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-generate search_vector from text fields
CREATE OR REPLACE FUNCTION kb_update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector = (
    setweight(to_tsvector('russian', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('russian', COALESCE(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('russian', COALESCE(NEW.content, '')), 'C') ||
    setweight(to_tsvector('russian', COALESCE(array_to_string(NEW.tags, ' '), '')), 'B')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-create version on entity update
CREATE OR REPLACE FUNCTION kb_create_version()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create version if content actually changed
  IF OLD.name IS DISTINCT FROM NEW.name
     OR OLD.summary IS DISTINCT FROM NEW.summary
     OR OLD.content IS DISTINCT FROM NEW.content
     OR OLD.metadata IS DISTINCT FROM NEW.metadata
     OR OLD.tags IS DISTINCT FROM NEW.tags
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.visibility IS DISTINCT FROM NEW.visibility
  THEN
    INSERT INTO kb_entity_versions (
      entity_id, version, name, summary, content, metadata, tags,
      status, visibility, change_type, changed_by, diff
    ) VALUES (
      OLD.id,
      OLD.version,
      OLD.name,
      OLD.summary,
      OLD.content,
      OLD.metadata,
      OLD.tags,
      OLD.status,
      OLD.visibility,
      CASE
        WHEN OLD.status != NEW.status AND NEW.status = 'archived' THEN 'archive'
        WHEN OLD.status != NEW.status AND OLD.status = 'archived' THEN 'restore'
        WHEN OLD.is_verified != NEW.is_verified AND NEW.is_verified THEN 'verify'
        WHEN NEW.source_type IN ('ai_generated', 'ai_enriched') THEN 'enrich'
        ELSE 'update'
      END,
      NEW.updated_by,
      jsonb_build_object(
        'changed_fields', (
          SELECT jsonb_object_agg(key, value)
          FROM jsonb_each(to_jsonb(NEW))
          WHERE key IN ('name', 'summary', 'content', 'metadata', 'tags', 'status', 'visibility')
            AND value IS DISTINCT FROM (to_jsonb(OLD))->key
        )
      )
    );

    -- Increment version
    NEW.version = OLD.version + 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update category entity_count
CREATE OR REPLACE FUNCTION kb_update_category_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE kb_categories SET entity_count = entity_count + 1 WHERE id = NEW.category_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE kb_categories SET entity_count = entity_count - 1 WHERE id = OLD.category_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.category_id != NEW.category_id THEN
    UPDATE kb_categories SET entity_count = entity_count - 1 WHERE id = OLD.category_id;
    UPDATE kb_categories SET entity_count = entity_count + 1 WHERE id = NEW.category_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Apply triggers (idempotent: drop + create)
DROP TRIGGER IF EXISTS trg_kb_entities_timestamp ON kb_entities;
CREATE TRIGGER trg_kb_entities_timestamp
  BEFORE UPDATE ON kb_entities
  FOR EACH ROW EXECUTE FUNCTION kb_update_timestamp();

DROP TRIGGER IF EXISTS trg_kb_entities_search ON kb_entities;
CREATE TRIGGER trg_kb_entities_search
  BEFORE INSERT OR UPDATE OF name, summary, content, tags ON kb_entities
  FOR EACH ROW EXECUTE FUNCTION kb_update_search_vector();

DROP TRIGGER IF EXISTS trg_kb_entities_version ON kb_entities;
CREATE TRIGGER trg_kb_entities_version
  BEFORE UPDATE ON kb_entities
  FOR EACH ROW EXECUTE FUNCTION kb_create_version();

DROP TRIGGER IF EXISTS trg_kb_entities_category_count ON kb_entities;
CREATE TRIGGER trg_kb_entities_category_count
  AFTER INSERT OR DELETE OR UPDATE OF category_id ON kb_entities
  FOR EACH ROW EXECUTE FUNCTION kb_update_category_count();

DROP TRIGGER IF EXISTS trg_kb_categories_timestamp ON kb_categories;
CREATE TRIGGER trg_kb_categories_timestamp
  BEFORE UPDATE ON kb_categories
  FOR EACH ROW EXECUTE FUNCTION kb_update_timestamp();

DROP TRIGGER IF EXISTS trg_kb_data_sources_timestamp ON kb_data_sources;
CREATE TRIGGER trg_kb_data_sources_timestamp
  BEFORE UPDATE ON kb_data_sources
  FOR EACH ROW EXECUTE FUNCTION kb_update_timestamp();


-- =============================================================
-- 12. SEED DATA: Categories (14 root domains, 70+ subcategories)
-- =============================================================

-- Root categories
INSERT INTO kb_categories (slug, name, description, icon, sort_order, depth, path) VALUES
  ('company',      'О компании',              'История, миссия, юридические данные, бренд',             'business',        1,  0, 'company'),
  ('locations',    'Студии и локации',         'Фотостудии, зоны, инфраструктура',                      'location_on',     2,  0, 'locations'),
  ('services',     'Услуги',                   'Каталог всех услуг с ценами и процессами',               'camera_alt',      3,  0, 'services'),
  ('pricing',      'Ценообразование',          'Правила формирования цен, история, сравнение',           'payments',        4,  0, 'pricing'),
  ('equipment',    'Оборудование',             'Камеры, свет, принтеры, ПО, расходники',                 'build',           5,  0, 'equipment'),
  ('team',         'Команда',                  'Фотографы, ретушёры, менеджеры — навыки и компетенции',   'groups',          6,  0, 'team'),
  ('usp',          'Конкурентные преимущества', 'УТП, позиционирование, доказательства',                  'emoji_events',    7,  0, 'usp'),
  ('competitors',  'Конкуренты',               'Анализ конкурентов, цены, сильные/слабые стороны',        'analytics',       8,  0, 'competitors'),
  ('market',       'Рынок',                    'Тренды, сегменты, география, спрос',                     'trending_up',     9,  0, 'market'),
  ('analytics',    'Аналитика',                'Финансы, конверсия, удовлетворённость, прогнозы',         'insights',        10, 0, 'analytics'),
  ('processes',    'Бизнес-процессы',          'Съёмка, ретушь, согласование, выдача, бронирование',      'account_tree',    11, 0, 'processes'),
  ('faq',          'Частые вопросы',           'FAQ для клиентов, сотрудников, партнёров',                'help',            12, 0, 'faq'),
  ('content',      'Контент и маркетинг',      'SEO, соцсети, тексты, медиа',                            'edit_note',       13, 0, 'content'),
  ('products',     'Товары и материалы',       'SKU, расходники, фотобумага, рамки, сувениры',           'inventory_2',     14, 0, 'products')
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: company
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'company/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('company-history',     'История',                'Основание, вехи, ключевые даты',              'history',          1),
  ('company-mission',     'Миссия и ценности',      'Зачем мы существуем, принципы работы',         'flag',             2),
  ('company-legal',       'Юридическая информация',  'ИП/ООО, ИНН, ОГРН, лицензии',                'gavel',            3),
  ('company-brand',       'Бренд и айдентика',       'Логотип, цвета, шрифты, гайдлайны',           'palette',          4),
  ('company-contacts',    'Контакты',               'Телефоны, email, мессенджеры, соцсети',        'contact_phone',    5),
  ('company-achievements','Достижения',             'Награды, рейтинги, сертификаты',               'military_tech',    6)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'company'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: locations
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'locations/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('locations-studios',        'Фотостудии',       'Адреса, часы работы, координаты',        'storefront',      1),
  ('locations-zones',          'Зоны и интерьер',   'Фотозоны, фоны, декорации',              'meeting_room',    2),
  ('locations-infrastructure', 'Инфраструктура',   'Парковка, навигация, доступность',        'directions',      3)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'locations'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: services
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'services/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('services-studio-photo',  'Студийная съёмка',        'Портреты, семейные, детские',           'photo_camera',    1),
  ('services-documents',     'Фото на документы',       'Паспорт, виза, удостоверения',          'badge',           2),
  ('services-retouch',       'Ретушь и обработка',      'Базовая, сложная, художественная',      'auto_fix_high',   3),
  ('services-restoration',   'Реставрация',             'Восстановление старых фото',            'healing',         4),
  ('services-print',         'Печать',                  'Фотопечать, документы, широкоформат',    'print',           5),
  ('services-souvenirs',     'Сувенирная продукция',    'Кружки, футболки, магниты, холсты',     'redeem',          6),
  ('services-office',        'Офисные услуги',          'Копии, ламинация, сканирование',        'content_copy',    7),
  ('services-online',        'Онлайн-услуги',           'Удалённая ретушь, реставрация, нейро',   'cloud',           8),
  ('services-marketplace',   'Маркетплейсы',            'Товарная съёмка, инфографика, SMM',     'shopping_cart',   9),
  ('services-events',        'Выездная съёмка',         'Репортаж, мероприятия, корпоративы',     'event',           10),
  ('services-neuro',         'Нейрофотосессии',         'AI-генерация портретов',                'smart_toy',       11),
  ('services-military',      'Военная ретушь',          'Портрет в форме, награды, медали',       'shield',          12)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'services'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: pricing
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'pricing/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('pricing-rules',       'Правила ценообразования',    'Как формируются цены, каналы, модификаторы',   'rule',            1),
  ('pricing-history',     'История цен',                'Динамика изменения цен по периодам',           'timeline',        2),
  ('pricing-comparison',  'Сравнение с рынком',         'Наши цены vs конкуренты',                       'compare',         3),
  ('pricing-modifiers',   'Скидки и модификаторы',      'Промо, каналы, объёмные скидки',               'loyalty',         4),
  ('pricing-bundles',     'Пакеты и бандлы',            'Комплексные предложения',                       'inventory',       5)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'pricing'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: equipment
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'equipment/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('equipment-cameras',    'Камеры',                'Тушки, характеристики, назначение',     'photo_camera',    1),
  ('equipment-lenses',     'Объективы',             'Фокусные, светосила, назначение',       'camera',          2),
  ('equipment-lighting',   'Освещение',             'Студийный свет, модификаторы',          'wb_sunny',        3),
  ('equipment-printers',   'Принтеры',              'Фотопринтеры, МФУ, широкоформат',       'local_printshop', 4),
  ('equipment-backdrops',  'Фоны',                  'Бумажные, тканевые, хромакей',          'wallpaper',       5),
  ('equipment-props',      'Реквизит',              'Мебель, аксессуары, декорации',          'chair',           6),
  ('equipment-software',   'Программное обеспечение','Photoshop, Lightroom, CaptureOne',      'code',            7),
  ('equipment-consumables','Расходные материалы',    'Бумага, чернила, ламинат',              'receipt_long',    8)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'equipment'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: team
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'team/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('team-photographers',  'Фотографы',     'Навыки, специализация, портфолио',       'person',          1),
  ('team-retouchers',     'Ретушёры',       'Стиль обработки, скорость, навыки',      'brush',           2),
  ('team-managers',       'Менеджеры',      'Продажи, клиентский сервис',             'support_agent',   3),
  ('team-skills',         'Навыки и компетенции', 'Общие компетенции команды',        'school',          4)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'team'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: usp
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'usp/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('usp-pay-per-result', 'Оплата за результат',    'Платите только за понравившиеся снимки',   'verified',        1),
  ('usp-speed',          'Скорость',               '10 минут печать, моментальная выдача',     'speed',           2),
  ('usp-quality',        'Качество',               'Профессиональная обработка, оборудование', 'workspace_premium',3),
  ('usp-experience',     'Опыт',                   '27 лет, 30000+ клиентов',                 'emoji_events',    4),
  ('usp-technology',     'Технологии',              'Нейрофото, онлайн-услуги, CRM',           'rocket_launch',   5),
  ('usp-pricing',        'Цены',                   'Доступные цены, прозрачность',             'savings',         6)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'usp'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: competitors
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'competitors/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('competitors-direct',   'Прямые конкуренты',    'Фотостудии Ростова',                  'store',           1),
  ('competitors-indirect', 'Косвенные конкуренты', 'Полиграфия, типографии, онлайн',       'storefront',      2),
  ('competitors-online',   'Онлайн-конкуренты',    'Федеральные онлайн-сервисы',           'language',        3)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'competitors'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: market
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'market/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('market-trends',    'Тренды',         'Тренды фотоуслуг, AI, онлайн',           'trending_up',     1),
  ('market-segments',  'Сегменты',       'B2C, B2B, маркетплейсы, гос.',            'pie_chart',       2),
  ('market-geo',       'География',      'Ростов, ЮФО, онлайн-Россия',             'map',             3),
  ('market-demand',    'Спрос',          'Сезонность, пики, каналы привлечения',    'show_chart',      4),
  ('market-regulation','Регуляторика',   'Закон о персональных данных, лицензии',   'policy',          5)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'market'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: analytics
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'analytics/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('analytics-revenue',       'Выручка',              'Общая, по услугам, по каналам',      'attach_money',    1),
  ('analytics-conversion',    'Конверсия',             'Сайт → заказ, чат → заказ',          'funnel_chart',    2),
  ('analytics-satisfaction',  'Удовлетворённость',     'NPS, CSAT, отзывы',                  'sentiment_satisfied',3),
  ('analytics-efficiency',    'Эффективность',         'Время обработки, утилизация',        'speed',           4),
  ('analytics-forecasts',     'Прогнозы',              'AI-прогнозы спроса и выручки',        'auto_graph',      5),
  ('analytics-unit-economics','Юнит-экономика',        'CAC, LTV, маржинальность',           'calculate',       6)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'analytics'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: processes
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'processes/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('processes-shooting',   'Съёмка',                'Воркфлоу студийной съёмки',            'photo_camera',    1),
  ('processes-retouch',    'Ретушь',                'Воркфлоу обработки фото',              'auto_fix_high',   2),
  ('processes-approval',   'Согласование',           'Воркфлоу согласования с клиентом',     'fact_check',      3),
  ('processes-delivery',   'Выдача',                'Выдача заказа клиенту',                'local_shipping',  4),
  ('processes-booking',    'Бронирование',           'Запись на съёмку',                     'event',           5),
  ('processes-support',    'Поддержка',              'Обработка обращений',                  'support_agent',   6),
  ('processes-onboarding', 'Онбординг сотрудника',   'Ввод нового сотрудника',               'person_add',      7),
  ('processes-quality',    'Контроль качества',      'QC на каждом этапе',                   'verified',        8)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'processes'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: faq
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'faq/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('faq-clients',    'Для клиентов',      'Часто задаваемые вопросы клиентов',    'person',          1),
  ('faq-employees',  'Для сотрудников',    'Внутренний FAQ для команды',           'badge',           2),
  ('faq-partners',   'Для партнёров',      'FAQ партнёрской программы',            'handshake',       3)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'faq'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: content
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'content/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('content-seo',         'SEO',            'Ключевые слова, мета-теги, стратегия',  'search',          1),
  ('content-social',      'Соцсети',        'VK, Telegram, Instagram стратегия',     'share',           2),
  ('content-copywriting', 'Тексты',         'Шаблоны, тон, стиль коммуникации',      'edit_note',       3),
  ('content-media',       'Медиа-контент',  'Фото, видео, баннеры для маркетинга',   'perm_media',      4),
  ('content-reputation',  'Репутация',       'Отзывы, рейтинги, управление',          'star',            5)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'content'
ON CONFLICT (slug) DO NOTHING;

-- Subcategories: products
INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
SELECT c.id, v.slug, v.name, v.description, v.icon, v.sort_order, 1, 'products/' || v.slug
FROM kb_categories c
CROSS JOIN (VALUES
  ('products-paper',       'Фотобумага',         'Типы, форматы, поставщики',            'description',     1),
  ('products-ink',         'Чернила и тонер',     'Расход, поставщики, стоимость',         'opacity',         2),
  ('products-frames',      'Рамки',              'Размеры, материалы, маржа',             'crop_square',     3),
  ('products-souvenirs',   'Сувениры-заготовки',  'Кружки, магниты, футболки',             'redeem',          4),
  ('products-lamination',  'Ламинат',             'Типы, толщина, расход',                 'layers',          5),
  ('products-packaging',   'Упаковка',            'Конверты, пакеты, коробки',             'inventory_2',     6)
) AS v(slug, name, description, icon, sort_order)
WHERE c.slug = 'products'
ON CONFLICT (slug) DO NOTHING;


-- =============================================================
-- 13. SEED DATA: Metric Definitions
-- =============================================================

INSERT INTO kb_metric_definitions (slug, name, description, unit, aggregation, category, is_cumulative, alert_threshold, dashboard_config) VALUES
  -- Financial
  ('revenue-total',           'Общая выручка',                  'Суммарная выручка за период',                                'rub',     'sum',  'financial',   TRUE,  '{"warning": null}',                  '{"chart_type": "bar", "color": "#4CAF50"}'),
  ('revenue-by-service',      'Выручка по услугам',             'Выручка в разрезе категорий услуг',                          'rub',     'sum',  'financial',   TRUE,  NULL,                                  '{"chart_type": "stacked_bar"}'),
  ('revenue-by-channel',      'Выручка по каналам',             'Онлайн vs студия vs партнёры',                               'rub',     'sum',  'financial',   TRUE,  NULL,                                  '{"chart_type": "pie"}'),
  ('avg-check',               'Средний чек',                    'Средняя сумма заказа',                                       'rub',     'avg',  'financial',   FALSE, '{"min": 300, "warning": 400}',        '{"chart_type": "line", "color": "#2196F3"}'),
  ('avg-check-by-service',    'Средний чек по услугам',         'Средняя сумма в разрезе услуг',                              'rub',     'avg',  'financial',   FALSE, NULL,                                  '{"chart_type": "bar"}'),
  ('margin-percent',          'Маржинальность',                 'Процент маржи по услугам',                                   'percent', 'avg',  'financial',   FALSE, '{"min": 30, "warning": 40}',          '{"chart_type": "gauge"}'),
  ('cac',                     'Стоимость привлечения клиента',  'Customer Acquisition Cost',                                   'rub',     'avg',  'financial',   FALSE, '{"max": 500, "warning": 400}',        '{"chart_type": "line"}'),
  ('ltv',                     'Пожизненная ценность клиента',   'Lifetime Value',                                             'rub',     'avg',  'financial',   FALSE, NULL,                                  '{"chart_type": "line"}'),

  -- Operational
  ('order-count',             'Количество заказов',             'Всего заказов за период',                                    'count',   'sum',  'operational', TRUE,  '{"min": 5}',                          '{"chart_type": "bar", "color": "#FF9800"}'),
  ('order-count-by-service',  'Заказы по услугам',              'В разрезе категорий',                                        'count',   'sum',  'operational', TRUE,  NULL,                                  '{"chart_type": "stacked_bar"}'),
  ('customer-count-new',      'Новые клиенты',                  'Количество новых уникальных клиентов',                       'count',   'sum',  'operational', TRUE,  NULL,                                  '{"chart_type": "line", "color": "#9C27B0"}'),
  ('customer-count-repeat',   'Повторные клиенты',              'Количество вернувшихся клиентов',                            'count',   'sum',  'operational', TRUE,  NULL,                                  '{"chart_type": "line", "color": "#E91E63"}'),
  ('repeat-rate',             'Доля повторных',                 'Процент повторных клиентов',                                 'percent', 'avg',  'operational', FALSE, '{"min": 15, "warning": 20}',          '{"chart_type": "gauge"}'),
  ('studio-utilization',      'Утилизация студии',              'Процент занятых слотов',                                     'percent', 'avg',  'operational', FALSE, '{"min": 40, "warning": 60}',          '{"chart_type": "gauge"}'),
  ('retouch-time-avg',        'Среднее время ретуши',           'Время обработки одного фото (минуты)',                       'minutes', 'avg',  'operational', FALSE, '{"max": 30, "warning": 20}',          '{"chart_type": "line"}'),
  ('print-time-avg',          'Среднее время печати',           'Время от заказа до готовности',                              'minutes', 'avg',  'operational', FALSE, '{"max": 15, "warning": 10}',          '{"chart_type": "line"}'),
  ('booking-no-show-rate',    'Неявки на бронь',                'Процент записавшихся, но не пришедших',                      'percent', 'avg',  'operational', FALSE, '{"max": 20, "warning": 15}',          '{"chart_type": "line"}'),

  -- Quality
  ('nps-score',               'NPS',                            'Net Promoter Score (-100..+100)',                             'index',   'avg',  'quality',     FALSE, '{"min": 50, "warning": 70}',          '{"chart_type": "gauge", "color": "#4CAF50"}'),
  ('csat-score',              'CSAT',                           'Customer Satisfaction Score (1-5)',                            'rating',  'avg',  'quality',     FALSE, '{"min": 4.0, "warning": 4.5}',        '{"chart_type": "gauge"}'),
  ('review-count',            'Количество отзывов',             'Новые отзывы за период',                                     'count',   'sum',  'quality',     TRUE,  NULL,                                  '{"chart_type": "bar"}'),
  ('review-avg-rating',       'Средний рейтинг',                'Средняя оценка по отзывам (1-5)',                             'rating',  'avg',  'quality',     FALSE, '{"min": 4.5, "warning": 4.7}',        '{"chart_type": "line"}'),
  ('complaint-count',         'Жалобы',                         'Количество жалоб/рекламаций',                                'count',   'sum',  'quality',     TRUE,  '{"max": 3, "warning": 1}',            '{"chart_type": "bar", "color": "#F44336"}'),
  ('approval-first-try-rate', 'Одобрение с первого раза',       'Процент согласований ретуши без доработок',                   'percent', 'avg',  'quality',     FALSE, '{"min": 70, "warning": 80}',          '{"chart_type": "line"}'),

  -- Marketing
  ('website-visitors',        'Посетители сайта',               'Уникальные посетители',                                      'count',   'sum',  'marketing',   TRUE,  NULL,                                  '{"chart_type": "area"}'),
  ('conversion-rate',         'Конверсия сайта',                'Посетители → заказы (%)',                                    'percent', 'avg',  'marketing',   FALSE, '{"min": 2, "warning": 3}',            '{"chart_type": "line", "color": "#00BCD4"}'),
  ('chat-to-order-rate',      'Конверсия чата',                 'Чат → заказ (%)',                                            'percent', 'avg',  'marketing',   FALSE, '{"min": 10, "warning": 15}',          '{"chart_type": "line"}'),
  ('social-followers',        'Подписчики соцсетей',            'Общее число подписчиков',                                    'count',   'last', 'marketing',   FALSE, NULL,                                  '{"chart_type": "line"}'),

  -- Competitor
  ('competitor-price-index',  'Ценовой индекс конкурентов',     'Наша цена / средняя цена конкурентов × 100',                 'index',   'avg',  'competitor',  FALSE, '{"max": 110, "warning": 100}',        '{"chart_type": "radar"}'),
  ('competitor-review-gap',   'Разрыв по отзывам',              'Наши отзывы − среднее конкурентов',                           'count',   'last', 'competitor',  FALSE, NULL,                                  '{"chart_type": "bar"}'),
  ('market-share-estimate',   'Доля рынка (оценка)',            'Оценочная доля в городском рынке фотоуслуг',                 'percent', 'last', 'competitor',  FALSE, NULL,                                  '{"chart_type": "gauge"}')
ON CONFLICT (slug) DO NOTHING;


-- =============================================================
-- 14. SEED DATA: Default Access Rules
-- =============================================================

INSERT INTO kb_access_rules (role, category_slug, entity_type, can_read, can_create, can_update, can_delete, can_verify, can_export) VALUES
  -- Admin: full access everywhere
  ('admin',        NULL, NULL, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE),

  -- Manager: read all, create/update most, verify, no delete
  ('manager',      NULL, NULL, TRUE, TRUE, TRUE, FALSE, TRUE, TRUE),

  -- Photographer: read services/equipment/processes, limited write
  ('photographer', 'services',   NULL, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
  ('photographer', 'equipment',  NULL, TRUE, TRUE,  TRUE,  FALSE, FALSE, FALSE),
  ('photographer', 'processes',  NULL, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
  ('photographer', 'team',       NULL, TRUE, FALSE, TRUE,  FALSE, FALSE, FALSE),
  ('photographer', 'faq',        NULL, TRUE, TRUE,  TRUE,  FALSE, FALSE, FALSE),

  -- Employee: read non-confidential
  ('employee',     NULL, NULL, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),

  -- AI Agent: read all, create/update with review required
  ('ai_agent',     NULL, NULL, TRUE, TRUE, TRUE, FALSE, FALSE, TRUE),

  -- Public API: read only public entities
  ('public_api',   NULL, NULL, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE)
ON CONFLICT (role, category_slug, entity_type) DO NOTHING;


-- =============================================================
-- 15. SEED DATA: Initial Data Sources
-- =============================================================

INSERT INTO kb_data_sources (slug, name, source_type, config, is_active) VALUES
  ('ts-services-data',     'services.data.ts',         'file', '{"path": "src/app/core/data/services.data.ts", "parser": "typescript"}',    TRUE),
  ('ts-about-data',        'about.data.ts',            'file', '{"path": "src/app/core/data/about.data.ts", "parser": "typescript"}',       TRUE),
  ('ts-address-data',      'address.data.ts',          'file', '{"path": "src/app/core/data/address.data.ts", "parser": "typescript"}',     TRUE),
  ('ts-photographers-data','photographers.data.ts',    'file', '{"path": "src/app/core/data/photographers.data.ts", "parser": "typescript"}', TRUE),
  ('ts-reviews-data',      'reviews.data.ts',          'file', '{"path": "src/app/core/data/reviews.data.ts", "parser": "typescript"}',     TRUE),
  ('ts-hero-data',         'hero.data.ts',             'file', '{"path": "src/app/core/data/hero.data.ts", "parser": "typescript"}',        TRUE),
  ('md-competitors',       'Competitor Analysis (MD)',  'file', '{"path": "конкуренты/", "parser": "markdown"}',                             TRUE),
  ('db-pricing',           'Pricing System (DB)',       'database', '{"tables": ["service_categories", "option_groups", "service_options"]}', TRUE),
  ('db-orders',            'Orders & POS (DB)',         'database', '{"tables": ["orders", "pos_transactions", "order_assignments"]}',       TRUE),
  ('db-reviews',           'Reviews (DB)',              'database', '{"tables": ["reviews"]}',                                                TRUE),
  ('db-analytics',         'Behavior Analytics (DB)',   'database', '{"tables": ["behavior_events", "replay_sessions"]}',                    TRUE),
  ('web-trinachetyre',     '3x4photo.ru',              'scraper',  '{"url": "https://3x4photo.ru", "pages": ["/", "/prices"], "interval": "7d"}',  TRUE),
  ('web-skyprint',         'SkyPrint161',               'scraper',  '{"url": "https://skyprint161.ru", "pages": ["/", "/price"], "interval": "7d"}', TRUE),
  ('web-yandex-maps',      'Яндекс Карты (отзывы)',    'scraper',  '{"source": "yandex_maps", "org_id": "magnus_photo", "interval": "1d"}', TRUE),
  ('web-2gis',             '2ГИС (отзывы)',            'scraper',  '{"source": "2gis", "org_id": "magnus_photo", "interval": "1d"}',        TRUE),
  ('ai-conversation',      'AI Conversations',          'conversation', '{"description": "Facts learned from user conversations"}',          TRUE),
  ('ai-analytics',         'AI Analytics Pipeline',     'api',      '{"description": "AI-generated insights from business data"}',           TRUE)
ON CONFLICT (slug) DO NOTHING;


-- =============================================================
-- 16. UTILITY VIEWS
-- =============================================================

-- Category tree with full path and entity counts
CREATE OR REPLACE VIEW kb_category_tree AS
WITH RECURSIVE tree AS (
  SELECT id, parent_id, slug, name, icon, sort_order, depth, path,
         entity_count, is_active, name AS full_name
  FROM kb_categories
  WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, c.slug, c.name, c.icon, c.sort_order, c.depth, c.path,
         c.entity_count, c.is_active, tree.full_name || ' → ' || c.name
  FROM kb_categories c
  INNER JOIN tree ON tree.id = c.parent_id
)
SELECT * FROM tree ORDER BY path, sort_order;

-- Unverified entities needing human review
CREATE OR REPLACE VIEW kb_entities_pending_review AS
SELECT e.id, e.entity_type, e.name, e.summary, e.source_type,
       e.confidence, e.created_at, e.updated_at,
       c.name AS category_name, c.path AS category_path,
       u.first_name || ' ' || u.last_name AS created_by_name
FROM kb_entities e
JOIN kb_categories c ON c.id = e.category_id
LEFT JOIN users u ON u.id = e.created_by
WHERE e.is_verified = FALSE
  AND e.status IN ('active', 'review')
  AND e.deleted_at IS NULL
ORDER BY e.confidence ASC, e.created_at DESC;

-- Enrichment task queue (ready to process)
CREATE OR REPLACE VIEW kb_enrichment_ready AS
SELECT t.*, e.name AS entity_name, e.entity_type
FROM kb_enrichment_tasks t
LEFT JOIN kb_entities e ON e.id = t.entity_id
WHERE t.status = 'pending'
  AND t.scheduled_at <= NOW()
  AND t.attempts < t.max_attempts
ORDER BY t.priority ASC, t.scheduled_at ASC;

-- Entity with relations (graph view)
CREATE OR REPLACE VIEW kb_entity_graph AS
SELECT
  e.id, e.name, e.entity_type, e.slug, e.status,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'relation_type', r.relation_type,
      'direction', 'outgoing',
      'target_id', r.to_entity_id,
      'target_name', t.name,
      'target_type', t.entity_type,
      'weight', r.weight
    ))
    FROM kb_relations r
    JOIN kb_entities t ON t.id = r.to_entity_id
    WHERE r.from_entity_id = e.id
  ) AS outgoing_relations,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'relation_type', r.relation_type,
      'direction', 'incoming',
      'source_id', r.from_entity_id,
      'source_name', s.name,
      'source_type', s.entity_type,
      'weight', r.weight
    ))
    FROM kb_relations r
    JOIN kb_entities s ON s.id = r.from_entity_id
    WHERE r.to_entity_id = e.id
  ) AS incoming_relations
FROM kb_entities e
WHERE e.deleted_at IS NULL;


-- =============================================================
-- 17. SEARCH FUNCTIONS
-- =============================================================

-- Full-text search with ranking
CREATE OR REPLACE FUNCTION kb_search_text(
  query_text TEXT,
  category_filter TEXT DEFAULT NULL,
  type_filter TEXT DEFAULT NULL,
  status_filter TEXT DEFAULT 'active',
  result_limit INT DEFAULT 20,
  result_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  entity_type TEXT,
  slug TEXT,
  name TEXT,
  summary TEXT,
  category_path TEXT,
  tags TEXT[],
  confidence DECIMAL,
  is_verified BOOLEAN,
  rank REAL,
  headline TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.entity_type, e.slug, e.name, e.summary,
    c.path, e.tags, e.confidence, e.is_verified,
    ts_rank_cd(e.search_vector, websearch_to_tsquery('russian', query_text)) AS rank,
    ts_headline('russian', COALESCE(e.summary, e.name),
                websearch_to_tsquery('russian', query_text),
                'MaxWords=50, MinWords=20, StartSel=**, StopSel=**') AS headline
  FROM kb_entities e
  JOIN kb_categories c ON c.id = e.category_id
  WHERE e.search_vector @@ websearch_to_tsquery('russian', query_text)
    AND e.deleted_at IS NULL
    AND (status_filter IS NULL OR e.status = status_filter)
    AND (category_filter IS NULL OR c.path LIKE category_filter || '%')
    AND (type_filter IS NULL OR e.entity_type = type_filter)
  ORDER BY rank DESC
  LIMIT result_limit OFFSET result_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Semantic (vector) search — only if pgvector available
DO $$ BEGIN
  EXECUTE '
    CREATE OR REPLACE FUNCTION kb_search_semantic(
      query_embedding vector(1024),
      similarity_threshold FLOAT DEFAULT 0.7,
      category_filter TEXT DEFAULT NULL,
      type_filter TEXT DEFAULT NULL,
      result_limit INT DEFAULT 20
    )
    RETURNS TABLE (
      id UUID,
      entity_type TEXT,
      slug TEXT,
      name TEXT,
      summary TEXT,
      category_path TEXT,
      similarity FLOAT
    ) AS $func$
    BEGIN
      RETURN QUERY
      SELECT
        e.id, e.entity_type, e.slug, e.name, e.summary,
        c.path,
        1 - (e.embedding <=> query_embedding) AS similarity
      FROM kb_entities e
      JOIN kb_categories c ON c.id = e.category_id
      WHERE e.embedding IS NOT NULL
        AND e.deleted_at IS NULL
        AND e.status = ''active''
        AND (category_filter IS NULL OR c.path LIKE category_filter || ''%'')
        AND (type_filter IS NULL OR e.entity_type = type_filter)
        AND 1 - (e.embedding <=> query_embedding) >= similarity_threshold
      ORDER BY e.embedding <=> query_embedding
      LIMIT result_limit;
    END;
    $func$ LANGUAGE plpgsql STABLE;
  ';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'kb_search_semantic skipped — pgvector not available';
END $$;

-- Fuzzy name search (trigram)
CREATE OR REPLACE FUNCTION kb_search_fuzzy(
  query_text TEXT,
  similarity_threshold FLOAT DEFAULT 0.3,
  result_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  entity_type TEXT,
  slug TEXT,
  name TEXT,
  summary TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.entity_type, e.slug, e.name, e.summary,
    similarity(e.name, query_text)::FLOAT AS sim
  FROM kb_entities e
  WHERE e.deleted_at IS NULL
    AND e.status = 'active'
    AND similarity(e.name, query_text) >= similarity_threshold
  ORDER BY sim DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Combined search (FTS + fuzzy, with deduplication)
CREATE OR REPLACE FUNCTION kb_search_combined(
  query_text TEXT,
  category_filter TEXT DEFAULT NULL,
  type_filter TEXT DEFAULT NULL,
  result_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  entity_type TEXT,
  slug TEXT,
  name TEXT,
  summary TEXT,
  category_path TEXT,
  search_method TEXT,
  score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH fts AS (
    SELECT r.id, r.entity_type, r.slug, r.name, r.summary,
           r.category_path, 'fts'::TEXT AS search_method,
           r.rank::FLOAT AS score
    FROM kb_search_text(query_text, category_filter, type_filter) r
  ),
  fuzzy AS (
    SELECT e.id, e.entity_type, e.slug, e.name, e.summary,
           c.path AS category_path, 'fuzzy'::TEXT AS search_method,
           similarity(e.name, query_text)::FLOAT * 0.5 AS score  -- lower weight for fuzzy
    FROM kb_entities e
    JOIN kb_categories c ON c.id = e.category_id
    WHERE e.deleted_at IS NULL AND e.status = 'active'
      AND similarity(e.name, query_text) >= 0.3
      AND (category_filter IS NULL OR c.path LIKE category_filter || '%')
      AND (type_filter IS NULL OR e.entity_type = type_filter)
      AND e.id NOT IN (SELECT fts.id FROM fts)
  ),
  combined AS (
    SELECT * FROM fts
    UNION ALL
    SELECT * FROM fuzzy
  )
  SELECT * FROM combined
  ORDER BY score DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;


-- =============================================================
-- 18. ANALYTICS FUNCTIONS
-- =============================================================

-- Get metric time series
CREATE OR REPLACE FUNCTION kb_metric_series(
  p_metric_slug TEXT,
  p_period_type TEXT DEFAULT 'monthly',
  p_from DATE DEFAULT (CURRENT_DATE - INTERVAL '1 year')::DATE,
  p_to DATE DEFAULT CURRENT_DATE,
  p_dimensions JSONB DEFAULT '{}'
)
RETURNS TABLE (
  period_start DATE,
  period_end DATE,
  metric_value DECIMAL,
  dimensions JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT m.period_start, m.period_end, m.metric_value, m.dimensions
  FROM kb_metrics m
  JOIN kb_metric_definitions d ON d.id = m.definition_id
  WHERE d.slug = p_metric_slug
    AND m.period_type = p_period_type
    AND m.period_start >= p_from
    AND m.period_end <= p_to
    AND (p_dimensions = '{}' OR m.dimensions @> p_dimensions)
  ORDER BY m.period_start;
END;
$$ LANGUAGE plpgsql STABLE;

-- Compare our prices with competitors
CREATE OR REPLACE FUNCTION kb_price_comparison(
  p_service_slug TEXT DEFAULT NULL
)
RETURNS TABLE (
  service_name TEXT,
  our_price DECIMAL,
  competitor_name TEXT,
  competitor_price DECIMAL,
  price_diff_percent DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    our.name AS service_name,
    (our.metadata->>'base_price')::DECIMAL AS our_price,
    comp.name AS competitor_name,
    (comp.metadata->'pricing'->>our.slug)::DECIMAL AS competitor_price,
    ROUND(
      ((our.metadata->>'base_price')::DECIMAL - (comp.metadata->'pricing'->>our.slug)::DECIMAL)
      / NULLIF((comp.metadata->'pricing'->>our.slug)::DECIMAL, 0) * 100,
      1
    ) AS price_diff_percent
  FROM kb_entities our
  CROSS JOIN kb_entities comp
  WHERE our.entity_type = 'service'
    AND comp.entity_type = 'competitor'
    AND our.status = 'active'
    AND comp.status = 'active'
    AND our.deleted_at IS NULL
    AND comp.deleted_at IS NULL
    AND comp.metadata->'pricing' ? our.slug
    AND (p_service_slug IS NULL OR our.slug = p_service_slug)
  ORDER BY our.name, comp.name;
END;
$$ LANGUAGE plpgsql STABLE;


-- =============================================================
-- DONE
-- =============================================================
-- Total: 11 tables, 4 views, 7 functions, 6 triggers
-- Seed: 14 root categories, 70+ subcategories,
--        30+ metric definitions, 6 access rules, 17 data sources
-- =============================================================
