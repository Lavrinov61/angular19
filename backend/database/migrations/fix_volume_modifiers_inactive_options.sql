-- Fix volume modifiers linked to inactive photo options
-- Re-link to active km-* counterparts
-- 2026-03-27

BEGIN;

-- 10x15-premium (inactive b4e04d67) → km-фото-10x15-премиум (active 38bceb13)
UPDATE price_modifiers
SET service_option_id = '38bceb13-7a17-4f85-8195-d36ecf05405b'
WHERE service_option_id = 'b4e04d67-08ea-4c02-aaf3-1e9e813a5e99'
  AND modifier_type = 'volume';

-- 10x15-super (inactive 74249997) → km-фото-10x15-супер (active dae7c15b)
UPDATE price_modifiers
SET service_option_id = 'dae7c15b-108a-4c54-832f-a64a5653ce50'
WHERE service_option_id = '74249997-6b1e-4c0e-a3f6-d2e199662192'
  AND modifier_type = 'volume';

-- 15x20-premium (inactive 5dfc82d0) → km-фото-15x20-премиум (active 8c5cce6b)
UPDATE price_modifiers
SET service_option_id = '8c5cce6b-fb58-4168-b610-60f344cb31ee'
WHERE service_option_id = '5dfc82d0-d7b5-4c7f-b275-9e5fab0a53f0'
  AND modifier_type = 'volume';

-- 15x20-super (inactive 0c8e19e4) → km-фото-15x20-супер (active 0cee7888)
UPDATE price_modifiers
SET service_option_id = '0cee7888-2522-4372-a096-595675a47ea8'
WHERE service_option_id = '0c8e19e4-030d-4362-a6db-fb1fdf8e798c'
  AND modifier_type = 'volume';

-- 20x30-premium (inactive be242acf) → km-фото-20x30-премиум (active cc38ddca)
UPDATE price_modifiers
SET service_option_id = 'cc38ddca-0b58-48de-9752-4b65750a6055'
WHERE service_option_id = 'be242acf-f4f7-425c-b3f6-6f22352342df'
  AND modifier_type = 'volume';

-- 20x30-super (inactive c84a9a74) → km-фото-20x30-супер (active ae1b930f)
UPDATE price_modifiers
SET service_option_id = 'ae1b930f-b56e-4b72-9f2c-43e1359af613'
WHERE service_option_id = 'c84a9a74-8aeb-4af1-9c78-f1ee70d42b98'
  AND modifier_type = 'volume';

-- Deactivate orphaned modifiers for inactive A3 options (no active counterpart)
UPDATE price_modifiers
SET is_active = false
WHERE modifier_type = 'volume'
  AND service_option_id IN (
    '825f214f-42c9-447d-8813-d6a6f03f230e', -- copy-a3-bw (inactive)
    'e2888ae3-1683-425a-a37c-db79ad57f2c6', -- copy-a3-color (inactive)
    '379bbc2a-a23e-40ed-9b0d-bc1d48848f59', -- copy-a3-photo-color (inactive)
    'a061662f-3483-4402-b750-222cbb19e9d6', -- drawing-a3-bw (inactive)
    '20f912e8-508b-44fb-b1d9-745048f6029a', -- drawing-a3-color (inactive)
    '13fd62da-99de-4af7-8a31-f578fd5212a3'  -- print-a3-bw (inactive)
  );

COMMIT;
