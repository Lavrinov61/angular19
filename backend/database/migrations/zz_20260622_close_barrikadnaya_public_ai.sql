-- Barrikadnaya 4 is permanently closed for customers.
-- Keep historical rows for reports, shifts and audit, but remove the address
-- from public AI knowledge and service location metadata when KB tables exist.

DO $$
BEGIN
  IF to_regclass('public.kb_entities') IS NULL THEN
    RAISE NOTICE 'kb_entities table is absent; skipping Barrikadnaya public AI KB cleanup';
  ELSE
    UPDATE kb_entities
    SET status = 'archived',
        visibility = 'internal',
        summary = 'Точка на 2-й Баррикадной закрыта. Не использовать в ответах клиентам.',
        content = E'Точка на 2-й Баррикадной закрыта. Для клиентов используйте открытую студию: пер. Соборный 21.',
        metadata = metadata
          || jsonb_build_object(
            'closed', true,
            'closed_at', '2026-06-22',
            'replacement_location', 'studio-soborny'
          ),
        tags = ARRAY['студия', 'баррикадная', 'закрыта'],
        is_verified = false,
        updated_at = NOW()
    WHERE slug = 'studio-barrikadnaya';

    UPDATE kb_entities
    SET metadata = jsonb_set(
          metadata,
          '{locations}',
          COALESCE(
            (
              SELECT jsonb_agg(location_value)
              FROM jsonb_array_elements_text(metadata->'locations') AS locations(location_value)
              WHERE location_value NOT IN ('barrikadnaya', 'barrikadnaya-4', 'studio-barrikadnaya')
            ),
            '[]'::jsonb
          ),
          false
        ),
        updated_at = NOW()
    WHERE metadata ? 'locations'
      AND metadata->'locations' ?| ARRAY['barrikadnaya', 'barrikadnaya-4', 'studio-barrikadnaya'];

    UPDATE kb_entities
    SET summary = replace(replace(summary, ', ул. 2-я Баррикадная 4', ''), ', ул. 2-ая Баррикадная 4', ''),
        content = replace(replace(content, ', ул. 2-я Баррикадная 4', ''), ', ул. 2-ая Баррикадная 4', ''),
        updated_at = NOW()
    WHERE slug = 'company-contacts';
  END IF;
END $$;
