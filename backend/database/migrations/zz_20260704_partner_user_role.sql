-- Allow technical partner users for /api/partner self-service accounts.
-- Application RBAC already maps role 'partner' to zero CRM permissions.

BEGIN;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (
    role::text = ANY (
      ARRAY[
        'admin',
        'employee',
        'manager',
        'client',
        'photographer',
        'partner'
      ]::text[]
    )
  );

COMMIT;
