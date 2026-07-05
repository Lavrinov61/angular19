-- Document font adjustment before LibreOffice conversion.
-- Negative values reduce all explicit DOC/DOCX font sizes by N points.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS font_size_delta_pt SMALLINT;

COMMENT ON COLUMN print_jobs.font_size_delta_pt IS
  'DOC/DOCX pre-conversion font delta in points, e.g. -2 turns 12pt into 10pt and 10pt into 8pt';
