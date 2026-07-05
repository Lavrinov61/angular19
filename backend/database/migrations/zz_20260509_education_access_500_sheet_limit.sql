-- Education access: refresh plan feature text.

BEGIN;

UPDATE subscription_plans
SET features = '["199 ₽ в год", "Ч/б учебный А4 по 3 ₽", "Цветной учебный А4 по 4 ₽", "Первый переплёт за 10 ₽", "Для студентов, учителей и преподавателей"]'::jsonb,
    updated_at = now()
WHERE slug = 'education-yearly-199';

UPDATE student_allowance_periods
SET sheet_limit = 500,
    updated_at = now()
WHERE sheet_limit = 100
  AND period_end >= now();

COMMIT;
