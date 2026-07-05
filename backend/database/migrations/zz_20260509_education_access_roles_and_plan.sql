-- Education access: one verified educational offer for students and teaching staff.

BEGIN;

ALTER TABLE student_accounts
  ADD COLUMN IF NOT EXISTS education_role VARCHAR(20);

UPDATE student_accounts
SET education_role = 'student'
WHERE education_role IS NULL;

ALTER TABLE student_accounts
  ALTER COLUMN education_role SET DEFAULT 'student',
  ALTER COLUMN education_role SET NOT NULL;

ALTER TABLE student_accounts
  DROP CONSTRAINT IF EXISTS student_accounts_education_role_check,
  ADD CONSTRAINT student_accounts_education_role_check
    CHECK (education_role IN ('student', 'teacher', 'lecturer', 'staff'));

CREATE INDEX IF NOT EXISTS idx_student_accounts_education_role_status
  ON student_accounts(education_role, status, expires_at);

ALTER TABLE student_verifications
  ADD COLUMN IF NOT EXISTS education_role VARCHAR(20);

UPDATE student_verifications v
SET education_role = COALESCE(a.education_role, 'student')
FROM student_accounts a
WHERE a.id = v.account_id
  AND v.education_role IS NULL;

UPDATE student_verifications
SET education_role = 'student'
WHERE education_role IS NULL;

ALTER TABLE student_verifications
  ALTER COLUMN education_role SET DEFAULT 'student',
  ALTER COLUMN education_role SET NOT NULL;

ALTER TABLE student_verifications
  DROP CONSTRAINT IF EXISTS student_verifications_education_role_check,
  ADD CONSTRAINT student_verifications_education_role_check
    CHECK (education_role IN ('student', 'teacher', 'lecturer', 'staff'));

CREATE INDEX IF NOT EXISTS idx_student_verifications_education_role_status
  ON student_verifications(education_role, status, submitted_at DESC);

INSERT INTO subscription_plans (
  slug,
  name,
  description,
  base_price,
  is_customizable,
  min_price,
  billing_period,
  subscriber_discount_percent,
  credits_rollover_months,
  is_active,
  sort_order,
  features,
  category,
  icon,
  savings_label,
  is_popular,
  is_recommended
)
VALUES (
  'education-yearly-199',
  'Образовательный доступ',
  'Годовой доступ для студентов, учителей, преподавателей и сотрудников учебных заведений',
  199.00,
  false,
  NULL,
  'yearly',
  0.00,
  0,
  true,
  5,
  '["199 ₽ в год", "Ч/б учебный А4 по 3 ₽", "Цветной учебный А4 по 4 ₽", "Первый переплёт за 10 ₽", "Для студентов, учителей и преподавателей"]'::jsonb,
  'education',
  'school',
  NULL,
  false,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  is_customizable = EXCLUDED.is_customizable,
  min_price = EXCLUDED.min_price,
  billing_period = EXCLUDED.billing_period,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular,
  is_recommended = EXCLUDED.is_recommended,
  updated_at = now();

DELETE FROM subscription_plan_items
WHERE plan_id = (
  SELECT id
  FROM subscription_plans
  WHERE slug = 'education-yearly-199'
);

COMMENT ON COLUMN student_accounts.education_role IS
  'Educational role verified for education access: student, teacher, lecturer or staff.';
COMMENT ON COLUMN student_verifications.education_role IS
  'Role claimed and reviewed in this educational verification submission.';

COMMIT;
