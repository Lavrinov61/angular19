-- Migration 117 — auto-create contact при INSERT в users (chat-auth-only P0)
--
-- Цель: гарантировать инвариант 1:1 user ↔ contact (active, non-deleted).
-- Backend в chat-auth-only архитектуре полагается на наличие ровно одного
-- contact для каждого авторизованного user (chat messages, visitor_email,
-- контакт-шторка, GET /chat/sessions/current).
--
-- Что делает:
--   Step 1. Preflight logging.
--   Step 2.5a. Re-point FK inbound на contacts с duplicate → primary.
--              (channel_users, conversations, customer_tag_assignments,
--               photo_approval_sessions, visitor_chat_sessions).
--   Step 2.5b. Merge полей duplicate → primary (COALESCE только если NULL).
--   Step 2.5c. Soft-delete (deleted_at = NOW()) duplicate contacts.
--   Step 2.  Merge anonymous contacts по phone/email для 49 orphan users.
--   Step 3.  Backfill остальных orphan users (INSERT contact).
--   Step 4.  Partial UNIQUE INDEX ux_contacts_user_id_active — гарантия 1:1.
--   Step 5.  Dedup duplicate active web conversations per contact
--            (pre-check для Step 6, safety; research dup_count = 0).
--   Step 6.  Partial UNIQUE INDEX ux_one_active_web_conv_per_contact —
--            гарантия «один активный web-чат на контакт» (backend
--            GET /chat/sessions/current race-protection).
--   Step 7.  Trigger function trg_users_create_contact + AFTER INSERT trigger
--            users_auto_create_contact.
--
-- Идемпотентна: DROP TRIGGER IF EXISTS, CREATE OR REPLACE FUNCTION,
--               CREATE UNIQUE INDEX IF NOT EXISTS,
--               INSERT ... ON CONFLICT DO NOTHING.
--
-- NB: НЕ CREATE INDEX CONCURRENTLY — несовместимо с BEGIN/COMMIT.
--     На небольшом объёме (≤3K contacts) транзакционный CREATE UNIQUE INDEX
--     блокирует writes менее 50 мс.
--
-- Rollback: см. секцию в конце файла (закомментировано).

BEGIN;

-- ============================================================
-- Step 1. Preflight logging
-- ============================================================
DO $$
DECLARE
  v_orphan_users    INTEGER;
  v_dup_user_id     INTEGER;
  v_dup_web_active  INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orphan_users
  FROM users u
  LEFT JOIN contacts c ON c.user_id = u.id AND c.deleted_at IS NULL
  WHERE c.id IS NULL;

  SELECT COUNT(*) INTO v_dup_user_id
  FROM (
    SELECT user_id FROM contacts
    WHERE user_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY user_id HAVING COUNT(*) > 1
  ) t;

  SELECT COUNT(*) INTO v_dup_web_active
  FROM (
    SELECT contact_id FROM conversations
    WHERE channel = 'web' AND status IN ('open','waiting','active')
      AND contact_id IS NOT NULL
    GROUP BY contact_id HAVING COUNT(*) > 1
  ) t;

  RAISE NOTICE 'migration 117 preflight: orphan_users=%, dup_user_id=%, dup_web_active=%',
               v_orphan_users, v_dup_user_id, v_dup_web_active;
END
$$;

-- ============================================================
-- Step 2.5. Resolve duplicate user_id in contacts (real data: 2 users,
--           3+2 contact rows). UNIQUE INDEX later requires each user_id
--           to appear ≤1 in non-deleted rows.
-- ============================================================

-- Pick primary per user_id: latest last_seen_at, earlier created_at as tiebreak.
CREATE TEMP TABLE primary_contacts_dedup ON COMMIT DROP AS
SELECT DISTINCT ON (user_id)
  user_id,
  id AS primary_id
FROM contacts
WHERE user_id IS NOT NULL AND deleted_at IS NULL
ORDER BY user_id, last_seen_at DESC NULLS LAST, created_at ASC;

-- Step 2.5a — re-point FK inbound на contacts с duplicate → primary.
-- Все 5 таблиц из pg_constraint: channel_users, conversations,
-- customer_tag_assignments, photo_approval_sessions, visitor_chat_sessions.

-- channel_users.contact_id (index non-UNIQUE, safe)
UPDATE channel_users cu
SET contact_id = p.primary_id
FROM primary_contacts_dedup p, contacts c
WHERE cu.contact_id = c.id
  AND c.user_id = p.user_id
  AND c.id <> p.primary_id;

-- conversations.contact_id (FK ON DELETE RESTRICT; index non-UNIQUE)
UPDATE conversations cv
SET contact_id = p.primary_id
FROM primary_contacts_dedup p, contacts c
WHERE cv.contact_id = c.id
  AND c.user_id = p.user_id
  AND c.id <> p.primary_id;

-- customer_tag_assignments.customer_id (PK = (customer_id, tag_id)) —
-- защита от UNIQUE-конфликта: сначала INSERT недостающих (ON CONFLICT DO NOTHING),
-- затем DELETE из duplicate (FK CASCADE не сработает — мы не удаляем contact).
INSERT INTO customer_tag_assignments (customer_id, tag_id, assigned_by, assigned_at)
SELECT p.primary_id, cta.tag_id, cta.assigned_by, cta.assigned_at
FROM customer_tag_assignments cta
JOIN contacts c      ON c.id = cta.customer_id
JOIN primary_contacts_dedup p ON p.user_id = c.user_id AND c.id <> p.primary_id
ON CONFLICT (customer_id, tag_id) DO NOTHING;

DELETE FROM customer_tag_assignments cta
USING contacts c, primary_contacts_dedup p
WHERE cta.customer_id = c.id
  AND c.user_id = p.user_id
  AND c.id <> p.primary_id;

-- photo_approval_sessions.contact_id (index non-UNIQUE, safe)
UPDATE photo_approval_sessions pas
SET contact_id = p.primary_id
FROM primary_contacts_dedup p, contacts c
WHERE pas.contact_id = c.id
  AND c.user_id = p.user_id
  AND c.id <> p.primary_id;

-- visitor_chat_sessions.contact_id (index non-UNIQUE, safe)
UPDATE visitor_chat_sessions vcs
SET contact_id = p.primary_id
FROM primary_contacts_dedup p, contacts c
WHERE vcs.contact_id = c.id
  AND c.user_id = p.user_id
  AND c.id <> p.primary_id;

-- Step 2.5b — snapshot полей из duplicate в TEMP, затем soft-delete, затем merge.
-- Порядок важен: UNIQUE idx_contacts_phone (partial WHERE deleted_at IS NULL)
-- упадёт если copy phone в primary без предварительного soft-delete duplicate.

-- Snapshot (выбираем лучшие значения полей из всех дубликатов per user_id,
-- ТОЛЬКО если primary их не имеет).
CREATE TEMP TABLE dup_field_merge ON COMMIT DROP AS
SELECT
  p.primary_id,
  (SELECT c.phone
     FROM contacts c
    WHERE c.user_id = p.user_id
      AND c.id <> p.primary_id
      AND c.deleted_at IS NULL
      AND c.phone IS NOT NULL
    ORDER BY c.last_seen_at DESC NULLS LAST
    LIMIT 1) AS merged_phone,
  (SELECT c.email
     FROM contacts c
    WHERE c.user_id = p.user_id
      AND c.id <> p.primary_id
      AND c.deleted_at IS NULL
      AND c.email IS NOT NULL
    ORDER BY c.last_seen_at DESC NULLS LAST
    LIMIT 1) AS merged_email,
  (SELECT c.display_name
     FROM contacts c
    WHERE c.user_id = p.user_id
      AND c.id <> p.primary_id
      AND c.deleted_at IS NULL
      AND NULLIF(TRIM(c.display_name), '') IS NOT NULL
    ORDER BY LENGTH(c.display_name) DESC NULLS LAST
    LIMIT 1) AS merged_display_name
FROM primary_contacts_dedup p;

-- Step 2.5c — soft-delete duplicate contacts (non-primary) ПЕРЕД merge,
-- чтобы освободить UNIQUE partial idx_contacts_phone (WHERE deleted_at IS NULL).
UPDATE contacts c
SET deleted_at = NOW(),
    updated_at = NOW()
FROM primary_contacts_dedup p
WHERE c.user_id = p.user_id
  AND c.id <> p.primary_id
  AND c.deleted_at IS NULL;

-- Merge полей snapshot → primary (COALESCE: только если primary.NULL).
UPDATE contacts pr
SET
  phone        = COALESCE(pr.phone,        d.merged_phone),
  email        = COALESCE(pr.email,        d.merged_email),
  display_name = COALESCE(NULLIF(TRIM(pr.display_name), ''), d.merged_display_name),
  updated_at   = NOW()
FROM dup_field_merge d
WHERE pr.id = d.primary_id
  AND (d.merged_phone IS NOT NULL
    OR d.merged_email IS NOT NULL
    OR d.merged_display_name IS NOT NULL);

-- ============================================================
-- Step 2. Merge anonymous contacts с users по phone/email
-- ============================================================
-- Сценарий: user зарегистрировался через /auth, до этого чатился анонимно
-- (есть contact с user_id=NULL но phone=user.phone ИЛИ email=user.email).
-- Привязываем этот contact к user вместо создания нового.
-- rn=1 — deterministic выбор, если есть несколько matching anon.
-- Только contact с NULL user_id + совпадающим phone ИЛИ email;
-- не трогаем контакты с NULL phone+email.
WITH candidate AS (
  SELECT
    u.id AS user_id,
    c.id AS contact_id,
    ROW_NUMBER() OVER (
      PARTITION BY u.id
      ORDER BY c.last_seen_at DESC NULLS LAST, c.created_at ASC
    ) AS rn
  FROM users u
  JOIN contacts c
    ON c.user_id IS NULL
   AND c.deleted_at IS NULL
   AND (
         (c.phone IS NOT NULL AND u.phone IS NOT NULL AND c.phone = u.phone)
      OR (c.email IS NOT NULL AND u.email IS NOT NULL AND c.email = u.email)
   )
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts c2
    WHERE c2.user_id = u.id
      AND c2.deleted_at IS NULL
  )
)
UPDATE contacts c
SET user_id    = cand.user_id,
    updated_at = NOW()
FROM candidate cand
WHERE c.id = cand.contact_id
  AND cand.rn = 1;

-- ============================================================
-- Step 3. Backfill orphan users (INSERT contact)
-- ============================================================
-- После merge остались users совсем без contact — создаём contact.
-- UNIQUE INDEX на user_id ещё не существует (Step 4 ниже).
--
-- ВАЖНО: idx_contacts_phone UNIQUE partial (WHERE phone IS NOT NULL AND
-- deleted_at IS NULL) и idx_contacts_user_id_active (создаётся в Step 4)
-- могут конфликтовать, если у двух разных users общий phone/email
-- (реальный случай: 724ba1f2 Администратор и 3f846d5b Фёдор делили phone).
-- NULL-аем phone/email которые уже заняты другим non-deleted contact.
INSERT INTO contacts (
  user_id, display_name, phone, email, source,
  first_seen_at, last_seen_at, created_at, updated_at
)
SELECT
  u.id,
  COALESCE(
    NULLIF(TRIM(u.display_name), ''),
    NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
    u.email,
    u.phone,
    'user-' || SUBSTRING(u.id::text FROM 1 FOR 8)
  ),
  CASE
    WHEN u.phone IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM contacts c2
      WHERE c2.phone = u.phone AND c2.deleted_at IS NULL
    ) THEN NULL
    ELSE u.phone
  END,
  CASE
    WHEN u.email IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM contacts c2
      WHERE c2.email = u.email
        AND c2.deleted_at IS NULL
        AND c2.user_id IS NOT NULL
        AND c2.user_id <> u.id
    ) THEN NULL
    ELSE u.email
  END,
  'auth',
  COALESCE(u.created_at, NOW()),
  NOW(),
  NOW(),
  NOW()
FROM users u
LEFT JOIN contacts c
  ON c.user_id = u.id AND c.deleted_at IS NULL
WHERE c.id IS NULL;

-- ============================================================
-- Step 4. Partial UNIQUE INDEX на contacts(user_id) — гарантия 1:1
-- ============================================================
-- WHERE user_id IS NOT NULL AND deleted_at IS NULL:
--   NULL user_id (2420 pure-anon contacts) не блокирует;
--   soft-deleted (duplicates из Step 2.5c) не учитываются.
CREATE UNIQUE INDEX IF NOT EXISTS ux_contacts_user_id_active
  ON contacts(user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- Step 5. Dedup duplicate active web conversations per contact
-- ============================================================
-- Pre-check для Step 6. Research (2026-04-19) dup_count = 0 —
-- на данный момент no-op, но остаётся для идемпотентности и защиты
-- после Step 2.5a (re-point contact_id).
--
-- Если несколько active web conversations на один contact —
-- оставляем latest (updated_at DESC), остальные → status='closed'.
WITH dups AS (
  SELECT id,
         contact_id,
         ROW_NUMBER() OVER (
           PARTITION BY contact_id
           ORDER BY updated_at DESC NULLS LAST, id
         ) AS rn
  FROM conversations
  WHERE channel = 'web'
    AND status IN ('open', 'waiting', 'active')
    AND contact_id IS NOT NULL
)
UPDATE conversations c
SET status     = 'closed',
    closed_at  = NOW(),
    updated_at = NOW()
FROM dups
WHERE c.id = dups.id
  AND dups.rn > 1;

-- ============================================================
-- Step 6. Partial UNIQUE INDEX — one active web conversation per contact
-- ============================================================
-- Backend GET /chat/sessions/current использует этот индекс для
-- race-protection: INSERT ... ON CONFLICT (contact_id) WHERE channel='web'
-- AND status IN ('open','waiting','active') DO UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_web_conv_per_contact
  ON conversations(contact_id)
  WHERE channel = 'web'
    AND status IN ('open', 'waiting', 'active');

-- ============================================================
-- Step 7. Trigger function + trigger
-- ============================================================
-- AFTER INSERT ON users: создаёт contact для нового user.
-- ON CONFLICT (unique index ux_contacts_user_id_active) DO NOTHING —
-- защита на случай если приложение уже создало contact.
CREATE OR REPLACE FUNCTION trg_users_create_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_phone TEXT;
  v_email TEXT;
BEGIN
  -- NULL-аем phone если уже занят другим non-deleted contact
  -- (guard против UNIQUE idx_contacts_phone partial).
  IF NEW.phone IS NULL THEN
    v_phone := NULL;
  ELSIF EXISTS (
    SELECT 1 FROM contacts c2
    WHERE c2.phone = NEW.phone AND c2.deleted_at IS NULL
  ) THEN
    v_phone := NULL;
  ELSE
    v_phone := NEW.phone;
  END IF;

  -- NULL-аем email если уже занят другим non-deleted contact с user_id.
  IF NEW.email IS NULL THEN
    v_email := NULL;
  ELSIF EXISTS (
    SELECT 1 FROM contacts c2
    WHERE c2.email = NEW.email
      AND c2.deleted_at IS NULL
      AND c2.user_id IS NOT NULL
      AND c2.user_id <> NEW.id
  ) THEN
    v_email := NULL;
  ELSE
    v_email := NEW.email;
  END IF;

  INSERT INTO contacts (
    user_id, display_name, phone, email, source,
    first_seen_at, last_seen_at, created_at, updated_at
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(NEW.display_name), ''),
      NULLIF(TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), ''),
      NEW.email,
      NEW.phone,
      'user-' || SUBSTRING(NEW.id::text FROM 1 FOR 8)
    ),
    v_phone,
    v_email,
    'auth',
    NOW(), NOW(), NOW(), NOW()
  )
  ON CONFLICT (user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL
    DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_auto_create_contact ON users;

CREATE TRIGGER users_auto_create_contact
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION trg_users_create_contact();

COMMIT;

-- ============================================================
-- Verification (запустить вручную после COMMIT)
-- ============================================================
-- 1. Ожидаем: 0
-- SELECT COUNT(*) FROM users u
-- LEFT JOIN contacts c ON c.user_id=u.id AND c.deleted_at IS NULL
-- WHERE c.id IS NULL;
--
-- 2. Ожидаем: 0
-- SELECT user_id, COUNT(*) FROM contacts
-- WHERE user_id IS NOT NULL AND deleted_at IS NULL
-- GROUP BY user_id HAVING COUNT(*) > 1;
--
-- 3. Ожидаем: 0
-- SELECT contact_id, COUNT(*) FROM conversations
-- WHERE channel='web' AND status IN ('open','waiting','active')
--   AND contact_id IS NOT NULL
-- GROUP BY contact_id HAVING COUNT(*) > 1;
--
-- 4. Ожидаем: 2 индекса
-- SELECT indexname FROM pg_indexes
-- WHERE indexname IN ('ux_contacts_user_id_active', 'ux_one_active_web_conv_per_contact');
--
-- 5. Ожидаем: trigger существует
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid='users'::regclass AND tgname='users_auto_create_contact';
--
-- 6. Smoke test (optional):
-- BEGIN;
--   INSERT INTO users (id, email, role)
--   VALUES (gen_random_uuid(), 'test-trg-117@example.com', 'client')
--   RETURNING id \gset
--   SELECT * FROM contacts WHERE user_id = :'id';  -- 1 row
-- ROLLBACK;

-- ============================================================
-- Rollback (если нужно откатить)
-- ============================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS users_auto_create_contact ON users;
-- DROP FUNCTION IF EXISTS trg_users_create_contact();
-- DROP INDEX IF EXISTS ux_one_active_web_conv_per_contact;
-- DROP INDEX IF EXISTS ux_contacts_user_id_active;
-- -- Step 2.5 (re-point FK + merge + soft-delete) НЕ откатывается автоматически —
-- -- данные в primary contacts остаются, deleted_at нужно вручную сбросить при необходимости.
-- -- Step 5 dedup НЕ откатывается (closed conversations остаются closed).
-- COMMIT;
