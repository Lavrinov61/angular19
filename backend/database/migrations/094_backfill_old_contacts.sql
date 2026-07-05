-- 094_backfill_old_contacts.sql
-- Backfill contact_id for ALL old conversations missing it (not just post-Apr 7)
-- Extends 093 which only covered recent conversations.
-- Safe to run multiple times (idempotent).

BEGIN;

-- Step 1: Link conversations to existing contacts via channel_users
WITH unlinked AS (
  SELECT
    c.id AS conversation_id,
    c.visitor_id,
    c.channel,
    c.visitor_name,
    CASE
      WHEN c.visitor_id LIKE '%:%'
      THEN SUBSTRING(c.visitor_id FROM POSITION(':' IN c.visitor_id) + 1)
      ELSE c.visitor_id
    END AS external_user_id
  FROM conversations c
  WHERE c.contact_id IS NULL
    AND c.status NOT IN ('closed')
    AND c.visitor_id IS NOT NULL
),
with_existing_contact AS (
  SELECT
    u.conversation_id,
    cu.contact_id
  FROM unlinked u
  JOIN channel_users cu
    ON cu.channel = u.channel::varchar
    AND cu.external_user_id = u.external_user_id
  WHERE cu.contact_id IS NOT NULL
)
UPDATE conversations c
SET contact_id = wec.contact_id,
    updated_at = NOW()
FROM with_existing_contact wec
WHERE c.id = wec.conversation_id
  AND c.contact_id IS NULL;

-- Step 2: For remaining unlinked conversations, create new contacts
DO $$
DECLARE
  rec RECORD;
  new_contact_id uuid;
  v_external_user_id text;
BEGIN
  FOR rec IN
    SELECT
      c.id AS conversation_id,
      c.visitor_id,
      c.channel,
      c.visitor_name
    FROM conversations c
    WHERE c.contact_id IS NULL
      AND c.status NOT IN ('closed')
      AND c.visitor_id IS NOT NULL
  LOOP
    IF rec.visitor_id LIKE '%:%' THEN
      v_external_user_id := SUBSTRING(rec.visitor_id FROM POSITION(':' IN rec.visitor_id) + 1);
    ELSE
      v_external_user_id := rec.visitor_id;
    END IF;

    -- Check channel_user for existing contact
    SELECT cu.contact_id INTO new_contact_id
    FROM channel_users cu
    WHERE cu.channel = rec.channel::varchar
      AND cu.external_user_id = v_external_user_id
      AND cu.contact_id IS NOT NULL
    LIMIT 1;

    IF new_contact_id IS NOT NULL THEN
      UPDATE conversations
      SET contact_id = new_contact_id, updated_at = NOW()
      WHERE id = rec.conversation_id AND contact_id IS NULL;
    ELSE
      -- Create new contact
      INSERT INTO contacts (display_name, source)
      VALUES (rec.visitor_name, rec.channel::varchar)
      RETURNING id INTO new_contact_id;

      -- Link conversation
      UPDATE conversations
      SET contact_id = new_contact_id, updated_at = NOW()
      WHERE id = rec.conversation_id AND contact_id IS NULL;

      -- Link channel_user
      UPDATE channel_users
      SET contact_id = new_contact_id
      WHERE channel = rec.channel::varchar
        AND external_user_id = v_external_user_id
        AND contact_id IS NULL;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
