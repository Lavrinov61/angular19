-- Migration 081: photographers backend-driven
-- Добавляет поля is_active, slug, sort_order и наполняет данными фотографов

-- 1. Добавляем колонки
ALTER TABLE photographers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;
ALTER TABLE photographers ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE;
ALTER TABLE photographers ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 2. Индекс для быстрого поиска активных
CREATE INDEX IF NOT EXISTS idx_photographers_is_active ON photographers (is_active);
CREATE INDEX IF NOT EXISTS idx_photographers_slug ON photographers (slug);
CREATE INDEX IF NOT EXISTS idx_photographers_sort_order ON photographers (sort_order);

-- 3. INSERT фотографов (ON CONFLICT по user_id — идемпотентно)

-- Ольга (active, sort_order=1)
INSERT INTO photographers (user_id, name, bio, experience, specializations, is_active, slug, sort_order, metadata)
VALUES (
  'b92127a0-c435-4c91-81ad-ee86dc35c3a0',
  'Ольга',
  'Профессиональный студийный фотограф. Создаёт тёплую атмосферу на съёмке — клиенты забывают о камере и просто живут.',
  3,
  ARRAY['Студийный портрет', 'Фото на документы', 'Семейные портреты'],
  true,
  'olga',
  1,
  jsonb_build_object(
    'team_display', jsonb_build_object(
      'role', 'Студийный фотограф',
      'tagline', 'Тепло, естественность и настоящие эмоции',
      'portrait_hero', '/assets/static/photographers/olga-hero.webp',
      'portrait_card', '/assets/static/photographers/olga-card.webp',
      'experience_years', 3,
      'sessions_completed', 200,
      'signature', 'Создаёт тёплую атмосферу на съёмке — клиенты забывают о камере и просто живут. Именно так получаются лучшие портреты.',
      'specialties', '["Студийный портрет", "Фото на документы", "Семейные портреты"]'::jsonb,
      'personal_fact', 'Убеждена: каждый человек фотогеничен — нужно лишь найти правильный ракурс и поймать настоящую эмоцию.'
    )
  )
)
ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  bio = EXCLUDED.bio,
  experience = EXCLUDED.experience,
  specializations = EXCLUDED.specializations,
  is_active = EXCLUDED.is_active,
  slug = EXCLUDED.slug,
  sort_order = EXCLUDED.sort_order,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

-- Оля (active, sort_order=2)
INSERT INTO photographers (user_id, name, bio, experience, specializations, is_active, slug, sort_order, metadata)
VALUES (
  '95cbc327-eca5-4ac5-a4d3-063346231ae9',
  'Оля',
  'Студийный фотограф. Лёгкость и непринуждённость в каждом кадре.',
  2,
  ARRAY['Студийный портрет', 'Фото на документы'],
  true,
  'olya',
  2,
  jsonb_build_object(
    'team_display', jsonb_build_object(
      'role', 'Студийный фотограф',
      'tagline', 'Лёгкость в каждом кадре',
      'portrait_hero', '/assets/static/photographers/olga-hero.webp',
      'portrait_card', '/assets/static/photographers/olga-card.webp',
      'experience_years', 2,
      'sessions_completed', 150,
      'signature', '',
      'specialties', '["Студийный портрет", "Фото на документы"]'::jsonb,
      'personal_fact', null
    )
  )
)
ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  bio = EXCLUDED.bio,
  experience = EXCLUDED.experience,
  specializations = EXCLUDED.specializations,
  is_active = EXCLUDED.is_active,
  slug = EXCLUDED.slug,
  sort_order = EXCLUDED.sort_order,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

-- Маргарита (inactive, sort_order=10)
INSERT INTO photographers (user_id, name, bio, experience, specializations, is_active, slug, sort_order, metadata)
VALUES (
  'f6e46c1b-205e-496b-a231-bb3903653dd9',
  'Маргарита',
  'Опытный студийный фотограф. Создаёт портреты, в которых люди узнают себя.',
  5,
  ARRAY['Студийный портрет', 'Деловое фото', 'Семейная съёмка'],
  false,
  'margarita',
  10,
  jsonb_build_object(
    'team_display', jsonb_build_object(
      'role', 'Студийный фотограф',
      'tagline', 'Создаю портреты, в которых узнают себя',
      'portrait_hero', '/assets/static/photographers/margarita-hero.webp',
      'portrait_card', '/assets/static/photographers/margarita-card.webp',
      'experience_years', 5,
      'sessions_completed', 300,
      'signature', '',
      'specialties', '["Студийный портрет", "Деловое фото", "Семейная съёмка"]'::jsonb,
      'personal_fact', 'Считает, что идеальный свет — это когда человек светится изнутри.'
    )
  )
)
ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  bio = EXCLUDED.bio,
  experience = EXCLUDED.experience,
  specializations = EXCLUDED.specializations,
  is_active = EXCLUDED.is_active,
  slug = EXCLUDED.slug,
  sort_order = EXCLUDED.sort_order,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

-- Анна (inactive, sort_order=11)
INSERT INTO photographers (user_id, name, bio, experience, specializations, is_active, slug, sort_order, metadata)
VALUES (
  'fd5ebe64-eb34-4412-82f9-d5e850ff460f',
  'Анна',
  'Студийный фотограф с 6-летним опытом. Каждый кадр — маленький шедевр.',
  6,
  ARRAY['Портрет', 'Документальное фото', 'Детская съёмка'],
  false,
  'anna',
  11,
  jsonb_build_object(
    'team_display', jsonb_build_object(
      'role', 'Студийный фотограф',
      'tagline', 'Каждый кадр — маленький шедевр',
      'portrait_hero', '/assets/static/photographers/anna-hero.webp',
      'portrait_card', '/assets/static/photographers/anna-card.webp',
      'experience_years', 6,
      'sessions_completed', 400,
      'signature', '',
      'specialties', '["Портрет", "Документальное фото", "Детская съёмка"]'::jsonb,
      'personal_fact', 'Верит, что хорошая фотография меняет то, как человек видит себя.'
    )
  )
)
ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  bio = EXCLUDED.bio,
  experience = EXCLUDED.experience,
  specializations = EXCLUDED.specializations,
  is_active = EXCLUDED.is_active,
  slug = EXCLUDED.slug,
  sort_order = EXCLUDED.sort_order,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();
