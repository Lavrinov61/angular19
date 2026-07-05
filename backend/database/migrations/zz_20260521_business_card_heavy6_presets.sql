-- Keep Canon C3226i business-card pricing rows aligned with the Rust print contract.
-- Physical business-card printing uses Heavy 6 / 221-256 g/m2 from the universal tray.

BEGIN;

UPDATE print_presets
SET media_type = 'heavy6',
    face_requirements = jsonb_set(
      COALESCE(face_requirements, '{}'::jsonb),
      '{media_type}',
      '"heavy6"'::jsonb,
      true
    ),
    updated_at = NOW()
WHERE slug IN (
    'business-card-90x50-a4-canon-c3226i',
    'business-card-85x55-a4-canon-c3226i',
    'business-card-a4-canon-c3226i'
  )
  AND printer_type = 'mfp'
  AND paper_size = 'A4'
  AND (
    media_type IS DISTINCT FROM 'heavy6'
    OR COALESCE(face_requirements->>'media_type', '') <> 'heavy6'
  );

COMMIT;
