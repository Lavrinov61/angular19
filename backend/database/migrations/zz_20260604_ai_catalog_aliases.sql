-- AI catalog aliases for human-facing service lookup.
-- The pricing catalog remains the source of truth; aliases only help the AI
-- resolve client wording and guessed external slugs to existing DB categories.

UPDATE service_categories
   SET metadata = COALESCE(metadata, '{}'::jsonb)
     || jsonb_build_object(
          'ai_aliases',
          jsonb_build_array(
            'визитки',
            'визитка',
            'полиграфия',
            'листовки',
            'флаеры',
            'business-cards',
            'business cards',
            'business card',
            'visitki'
          )
        ),
       updated_at = NOW()
 WHERE slug = 'polygraphy';

UPDATE service_categories
   SET metadata = COALESCE(metadata, '{}'::jsonb)
     || jsonb_build_object(
          'ai_aliases',
          jsonb_build_array(
            'макет',
            'макеты',
            'разработка макета',
            'дизайн',
            'дизайн визитки',
            'дизайн листовки',
            'layout',
            'design'
          )
        ),
       updated_at = NOW()
 WHERE slug = 'design-text';
