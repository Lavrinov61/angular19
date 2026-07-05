-- Migration: 044_add_print_jobs_indexes
-- Add critical indexes for 1M scale (200x growth)
-- Idempotent: IF NOT EXISTS

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- Fix existing partial index (was filtering by status)
-- ═══════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_print_jobs_status;
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);

-- ═══════════════════════════════════════════════════════════
-- Composite indexes for queue management
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_print_jobs_printer_status_created
  ON print_jobs(printer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_jobs_studio_priority_queued
  ON print_jobs(studio_id, priority DESC, created_at)
  WHERE status IN ('queued', 'sending');

CREATE INDEX IF NOT EXISTS idx_print_jobs_status_created
  ON print_jobs(status, created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- Operator analytics
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_print_jobs_created_by
  ON print_jobs(created_by);

CREATE INDEX IF NOT EXISTS idx_print_jobs_operator_stats
  ON print_jobs(created_by, status, price_total);

-- ═══════════════════════════════════════════════════════════
-- Priority queue (fix existing)
-- ═══════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_print_jobs_priority;
CREATE INDEX IF NOT EXISTS idx_print_jobs_priority_queued
  ON print_jobs(status, priority DESC, created_at)
  WHERE status IN ('queued', 'sending');

CREATE INDEX IF NOT EXISTS idx_print_jobs_failed
  ON print_jobs(status, created_at DESC)
  WHERE status = 'failed';

-- ═══════════════════════════════════════════════════════════
-- Batch processing
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_print_jobs_batch_sequence
  ON print_jobs(batch_id, batch_sequence)
  WHERE batch_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- Document photo pipeline
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_print_jobs_document_tree
  ON print_jobs(parent_job_id, page_number, document_template_slug)
  WHERE parent_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_print_jobs_customer_template
  ON print_jobs(customer_id, document_template_slug, created_at DESC)
  WHERE customer_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- Order linking
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_print_jobs_order_type_created
  ON print_jobs(order_id, order_type, created_at DESC)
  WHERE order_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- Archive & retention
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_print_jobs_completed_archive
  ON print_jobs(completed_at DESC)
  WHERE status IN ('completed', 'failed', 'cancelled');

-- ═══════════════════════════════════════════════════════════
-- Daily analytics
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_print_jobs_daily_stats
  ON print_jobs(created_at, studio_id, status);

-- ═══════════════════════════════════════════════════════════
-- Revenue tracking
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_print_jobs_revenue
  ON print_jobs(created_at DESC, price_total)
  WHERE price_total IS NOT NULL AND price_total > 0;

-- ═══════════════════════════════════════════════════════════
-- Face validations indexes
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_face_validations_verdict
  ON face_validations(verdict, created_at DESC)
  WHERE verdict IN ('invalid', 'needs_manual_review');

CREATE INDEX IF NOT EXISTS idx_face_validations_passport_validity
  ON face_validations(is_valid_passport, created_at DESC)
  WHERE is_valid_passport IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_face_validations_dpi_source
  ON face_validations(dpi_source, created_at DESC)
  WHERE dpi_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_face_validations_validated_by
  ON face_validations(validated_by)
  WHERE validated_by IS NOT NULL;

COMMIT;
