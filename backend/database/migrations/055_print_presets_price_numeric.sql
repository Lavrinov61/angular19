-- Migration 055: Change print_presets.price from float8 to numeric(10,2)
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'print_presets'
      AND column_name = 'price'
      AND data_type = 'double precision'
  ) THEN
    ALTER TABLE print_presets
      ALTER COLUMN price TYPE NUMERIC(10,2) USING price::NUMERIC(10,2);
  END IF;
END $$;

COMMIT;
