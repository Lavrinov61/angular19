-- Migration 100: Contact Ownership Model
-- contact_id becomes NOT NULL — every conversation must belong to a contact
-- This is the core architectural fix: contact = single source of truth for identity
--
-- Idempotent: safe to run multiple times

BEGIN;

-- Step 1: Backfill contacts for conversations that have phone (exact match or create)
DO $$
DECLARE
  conv RECORD;
  matched_contact_id UUID;
BEGIN
  FOR conv IN
    SELECT c.id, c.visitor_name, c.visitor_phone, c.visitor_email, c.channel::text AS ch
    FROM conversations c
    WHERE c.contact_id IS NULL
      AND c.visitor_phone IS NOT NULL
    ORDER BY c.created_at DESC
  LOOP
    -- Try to find existing contact by phone
    SELECT id INTO matched_contact_id
    FROM contacts
    WHERE phone = conv.visitor_phone AND deleted_at IS NULL
    LIMIT 1;

    IF matched_contact_id IS NULL THEN
      -- Create new contact
      INSERT INTO contacts (display_name, phone, email, source)
      VALUES (
        COALESCE(conv.visitor_name, 'Клиент ' || conv.visitor_phone),
        conv.visitor_phone,
        conv.visitor_email,
        COALESCE(conv.ch, 'web')
      )
      ON CONFLICT (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL
      DO UPDATE SET last_seen_at = NOW()
      RETURNING id INTO matched_contact_id;
    END IF;

    UPDATE conversations SET contact_id = matched_contact_id WHERE id = conv.id;
  END LOOP;
END $$;

-- Step 2: Backfill contacts for phoneless conversations (web anonymous, email, etc.)
DO $$
DECLARE
  conv RECORD;
  new_contact_id UUID;
BEGIN
  FOR conv IN
    SELECT c.id, c.visitor_name, c.visitor_email, c.channel::text AS ch, c.visitor_id
    FROM conversations c
    WHERE c.contact_id IS NULL
    ORDER BY c.created_at DESC
  LOOP
    -- For email: try to match by email
    IF conv.visitor_email IS NOT NULL THEN
      SELECT id INTO new_contact_id
      FROM contacts
      WHERE email = conv.visitor_email AND deleted_at IS NULL
      LIMIT 1;
    END IF;

    IF new_contact_id IS NULL THEN
      -- Create new phoneless contact
      INSERT INTO contacts (display_name, email, source)
      VALUES (
        COALESCE(NULLIF(conv.visitor_name, ''), 'Посетитель ' || LEFT(conv.id::text, 8)),
        conv.visitor_email,
        COALESCE(conv.ch, 'web')
      )
      RETURNING id INTO new_contact_id;
    END IF;

    UPDATE conversations SET contact_id = new_contact_id WHERE id = conv.id;
    new_contact_id := NULL;
  END LOOP;
END $$;

-- Step 3: Verify no orphans remain
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count FROM conversations WHERE contact_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE NOTICE 'WARNING: % conversations still without contact_id', orphan_count;
  ELSE
    RAISE NOTICE 'OK: All conversations have contact_id';
  END IF;
END $$;

-- Step 4: Add NOT NULL constraint
ALTER TABLE conversations ALTER COLUMN contact_id SET NOT NULL;

-- Step 5: Add index for contact_id lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations (contact_id);

-- Step 6: Mark visitor_* columns as deprecated
COMMENT ON COLUMN conversations.visitor_name IS 'DEPRECATED: use contacts.display_name via contact_id JOIN';
COMMENT ON COLUMN conversations.visitor_phone IS 'DEPRECATED: use contacts.phone via contact_id JOIN';
COMMENT ON COLUMN conversations.visitor_email IS 'DEPRECATED: use contacts.email via contact_id JOIN';

COMMIT;
