-- Recover the core Knowledge Base entity table when earlier KB schema exists
-- without kb_entities. This keeps the existing heavy KB API usable and lets
-- later seed migrations insert employee instructions.

DO $$
BEGIN
  IF to_regclass('public.kb_categories') IS NULL THEN
    RAISE NOTICE 'kb_categories is absent; skipping kb_entities recovery';
    RETURN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kb_entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID NOT NULL REFERENCES kb_categories(id) ON DELETE RESTRICT,

  entity_type     TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'archived', 'deprecated', 'review')),
  visibility      TEXT NOT NULL DEFAULT 'internal'
                    CHECK (visibility IN ('public', 'internal', 'confidential')),

  name            TEXT NOT NULL,
  summary         TEXT,
  content         TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  tags            TEXT[] NOT NULL DEFAULT '{}',

  source_type     TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source_type IN (
                      'manual', 'import', 'ai_generated', 'ai_enriched',
                      'web_scraped', 'analytics', 'conversation', 'api'
                    )),
  source_ref      TEXT,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00
                    CHECK (confidence BETWEEN 0 AND 1),
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at     TIMESTAMPTZ,

  search_vector   TSVECTOR,
  version         INT NOT NULL DEFAULT 1,

  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

COMMENT ON TABLE kb_entities IS 'Core knowledge entries — services, equipment, locations, people, competitors, processes, FAQs, USPs, market insights';

DO $$
BEGIN
  ALTER TABLE kb_entities ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available — embedding column skipped';
END $$;

CREATE INDEX IF NOT EXISTS idx_kb_entities_category ON kb_entities(category_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_entities_type ON kb_entities(entity_type, status);
CREATE INDEX IF NOT EXISTS idx_kb_entities_status ON kb_entities(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kb_entities_created ON kb_entities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_entities_verified ON kb_entities(is_verified, status)
  WHERE is_verified = FALSE AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_kb_entities_deleted ON kb_entities(deleted_at)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_entities_search ON kb_entities USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_kb_entities_tags ON kb_entities USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_kb_entities_metadata ON kb_entities USING gin(metadata jsonb_path_ops);

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_kb_entities_name_trgm
    ON kb_entities USING gin(name gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm name index skipped';
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_kb_entities_embedding
    ON kb_entities USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector HNSW index skipped — extension not available';
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.kb_update_timestamp()') IS NULL
     OR to_regprocedure('public.kb_update_search_vector()') IS NULL
     OR to_regprocedure('public.kb_create_version()') IS NULL
     OR to_regprocedure('public.kb_update_category_count()') IS NULL
  THEN
    RAISE EXCEPTION 'KB utility trigger functions are absent; apply knowledge_base.sql first';
  END IF;
END $$;

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

CREATE OR REPLACE VIEW kb_enrichment_ready AS
SELECT t.*, e.name AS entity_name, e.entity_type
FROM kb_enrichment_tasks t
LEFT JOIN kb_entities e ON e.id = t.entity_id
WHERE t.status = 'pending'
  AND t.scheduled_at <= NOW()
  AND t.attempts < t.max_attempts
ORDER BY t.priority ASC, t.scheduled_at ASC;

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
