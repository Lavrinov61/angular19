-- Migration: 046_add_face_validation_gost_columns
-- Add ГОСТ compliance tracking columns to face_validations
-- ГОСТ Р ИСО/МЭК 19794-5: face height 28-36mm per document type
-- Supports ideas #11 and #15 from print session 2026-03-31

BEGIN;

ALTER TABLE face_validations
  ADD COLUMN IF NOT EXISTS gost_height_mm NUMERIC(5,1),          -- measured height in mm
  ADD COLUMN IF NOT EXISTS gost_height_min_mm NUMERIC(5,1),      -- doc-specific min (default 28)
  ADD COLUMN IF NOT EXISTS gost_height_max_mm NUMERIC(5,1),      -- doc-specific max (default 36)
  ADD COLUMN IF NOT EXISTS gost_pass BOOLEAN,                    -- height in range?
  ADD COLUMN IF NOT EXISTS gost_notes TEXT,                      -- e.g., "слишком низкий лоб" or "OK"
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(50);            -- e.g., 'passport', 'visa_schengen'

-- Index for ГОСТ verdict queries
CREATE INDEX IF NOT EXISTS idx_face_validations_gost_pass
  ON face_validations(gost_pass, created_at DESC)
  WHERE gost_pass IS NOT NULL;

-- Index for doc type filtering
CREATE INDEX IF NOT EXISTS idx_face_validations_document_type
  ON face_validations(document_type)
  WHERE document_type IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN face_validations.gost_height_mm IS 'Measured face height in mm (forehead to chin) per MediaPipe landmarks';
COMMENT ON COLUMN face_validations.gost_pass IS 'TRUE if face height >= gost_height_min_mm AND <= gost_height_max_mm';
COMMENT ON COLUMN face_validations.document_type IS 'Document category: passport|visa|greencard|driver_license|medical_book etc';

COMMIT;
