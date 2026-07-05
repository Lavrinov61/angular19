ALTER TABLE print_jobs
    ADD COLUMN IF NOT EXISTS photo_enhance BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS brightness SMALLINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS contrast SMALLINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS saturation SMALLINT DEFAULT 0;

ALTER TABLE print_jobs
    DROP CONSTRAINT IF EXISTS print_jobs_brightness_range;

ALTER TABLE print_jobs
    ADD CONSTRAINT print_jobs_brightness_range
    CHECK (brightness IS NULL OR brightness BETWEEN -40 AND 40);

ALTER TABLE print_jobs
    DROP CONSTRAINT IF EXISTS print_jobs_contrast_range;

ALTER TABLE print_jobs
    ADD CONSTRAINT print_jobs_contrast_range
    CHECK (contrast IS NULL OR contrast BETWEEN -40 AND 40);

ALTER TABLE print_jobs
    DROP CONSTRAINT IF EXISTS print_jobs_saturation_range;

ALTER TABLE print_jobs
    ADD CONSTRAINT print_jobs_saturation_range
    CHECK (saturation IS NULL OR saturation BETWEEN -60 AND 60);
