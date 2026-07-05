-- Layout columns for photo imposition (grid printing)
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS layout_rows INT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS layout_cols INT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS cut_margin_mm DOUBLE PRECISION;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS custom_photo_width_mm DOUBLE PRECISION;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS custom_photo_height_mm DOUBLE PRECISION;
