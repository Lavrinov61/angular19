-- Promo code safety: UNIQUE constraint + race condition prevention
-- Idempotent: safe to run multiple times

-- Step 1: Check for duplicate active promo codes (informational only)
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT UPPER(promo_code) AS code
    FROM promotions
    WHERE promo_code IS NOT NULL AND is_active = true
    GROUP BY UPPER(promo_code)
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE WARNING 'Found % duplicate active promo code group(s). Review before relying on UNIQUE index.', dup_count;
  END IF;
END $$;

-- Step 2: Partial UNIQUE index — only active promo codes, NULL allowed
CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_promo_code_unique
  ON promotions (UPPER(promo_code))
  WHERE promo_code IS NOT NULL AND is_active = true;
