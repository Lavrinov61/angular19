-- Migration 048: Search and date range indexes for print_jobs
-- Supports ILIKE search on file_name (uses pg_trgm GIN)

-- Ensure pg_trgm is available
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index for ILIKE search on file_name
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_print_jobs_file_name_trgm
  ON print_jobs USING gin (file_name gin_trgm_ops);
