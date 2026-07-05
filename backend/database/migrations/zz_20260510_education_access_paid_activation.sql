-- Education access activation is two-stage:
-- 1) staff approves the educational document;
-- 2) paid education subscription activates the discount entitlement.

BEGIN;

WITH paid_education_subscriptions AS (
  SELECT DISTINCT ON (us.user_id)
         us.user_id,
         a.id AS student_account_id,
         us.current_period_end
  FROM user_subscriptions us
  JOIN subscription_plans sp ON sp.id = us.plan_id
  JOIN student_accounts a ON a.user_id = us.user_id
  WHERE sp.slug = 'education-yearly-199'
    AND us.user_id IS NOT NULL
    AND us.status IN ('active', 'paused')
    AND us.current_period_end IS NOT NULL
    AND us.current_period_end >= NOW()
    AND a.status = 'verified'
    AND (a.expires_at IS NULL OR a.expires_at >= NOW())
  ORDER BY us.user_id, us.current_period_end DESC
)
UPDATE student_accounts a
SET expires_at = GREATEST(
      COALESCE(a.expires_at, paid_education_subscriptions.current_period_end),
      paid_education_subscriptions.current_period_end
    ),
    updated_at = NOW()
FROM paid_education_subscriptions
WHERE a.id = paid_education_subscriptions.student_account_id;

WITH paid_education_subscriptions AS (
  SELECT DISTINCT ON (us.user_id)
         us.user_id,
         a.id AS student_account_id,
         us.current_period_end
  FROM user_subscriptions us
  JOIN subscription_plans sp ON sp.id = us.plan_id
  JOIN student_accounts a ON a.user_id = us.user_id
  WHERE sp.slug = 'education-yearly-199'
    AND us.user_id IS NOT NULL
    AND us.status IN ('active', 'paused')
    AND us.current_period_end IS NOT NULL
    AND us.current_period_end >= NOW()
    AND a.status = 'verified'
    AND (a.expires_at IS NULL OR a.expires_at >= NOW())
  ORDER BY us.user_id, us.current_period_end DESC
)
INSERT INTO student_discount_entitlements (
  user_id,
  status,
  source_token,
  source_url,
  student_account_id,
  activated_at,
  expires_at
)
SELECT
  user_id,
  'active',
  'education_subscription',
  NULL,
  student_account_id,
  NOW(),
  current_period_end
FROM paid_education_subscriptions
ON CONFLICT (user_id) DO UPDATE SET
  status = 'active',
  source_token = 'education_subscription',
  source_url = NULL,
  student_account_id = EXCLUDED.student_account_id,
  expires_at = GREATEST(
    COALESCE(student_discount_entitlements.expires_at, EXCLUDED.expires_at),
    EXCLUDED.expires_at
  ),
  updated_at = NOW();

UPDATE student_discount_entitlements s
SET status = 'expired',
    expires_at = LEAST(s.expires_at, NOW()),
    updated_at = NOW()
WHERE s.status = 'active'
  AND s.source_token = 'photo_verification'
  AND NOT EXISTS (
    SELECT 1
    FROM user_subscriptions us
    JOIN subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = s.user_id
      AND sp.slug = 'education-yearly-199'
      AND us.status IN ('active', 'paused')
      AND us.current_period_end IS NOT NULL
      AND us.current_period_end >= NOW()
  );

COMMIT;
