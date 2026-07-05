-- Migration: 045_fix_print_jobs_fk_constraints
-- Explicitly define FK constraints with ON DELETE behavior
-- Ensures referential integrity for 1M scale
-- Idempotent: DROP IF EXISTS before ADD

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- print_jobs FK constraints — fix
-- ═══════════════════════════════════════════════════════════

-- Drop existing constraints (may be missing ON DELETE)
ALTER TABLE print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_printer_id_fkey,
  DROP CONSTRAINT IF EXISTS print_jobs_created_by_fkey,
  DROP CONSTRAINT IF EXISTS print_jobs_reassigned_from_fkey,
  DROP CONSTRAINT IF EXISTS print_jobs_reassigned_by_fkey,
  DROP CONSTRAINT IF EXISTS print_jobs_customer_id_fkey;

-- Re-add with explicit ON DELETE behavior
ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_printer_id_fkey
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE RESTRICT,
  ADD CONSTRAINT print_jobs_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT print_jobs_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT print_jobs_reassigned_from_fkey
    FOREIGN KEY (reassigned_from) REFERENCES printers(id) ON DELETE SET NULL,
  ADD CONSTRAINT print_jobs_reassigned_by_fkey
    FOREIGN KEY (reassigned_by) REFERENCES users(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════
-- Add missing FK: document_template_slug → document_templates(slug)
-- ═══════════════════════════════════════════════════════════

-- First ensure document_templates.slug is UNIQUE
ALTER TABLE document_templates
  ADD CONSTRAINT document_templates_slug_unique UNIQUE (slug);

-- Add FK from print_jobs to document_templates
ALTER TABLE print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_document_template_fkey;

ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_document_template_fkey
    FOREIGN KEY (document_template_slug) REFERENCES document_templates(slug) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════
-- face_validations FK constraints
-- ═══════════════════════════════════════════════════════════

ALTER TABLE face_validations
  DROP CONSTRAINT IF EXISTS face_validations_validated_by_fkey;

ALTER TABLE face_validations
  ADD CONSTRAINT face_validations_validated_by_fkey
    FOREIGN KEY (validated_by) REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
