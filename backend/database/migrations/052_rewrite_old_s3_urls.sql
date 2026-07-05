-- Migration 052: Rewrite old S3 URLs (Selectel + YandexCloud) to MinIO proxy
-- After migrating from Selectel S3 / YandexCloud S3 to local MinIO,
-- old absolute URLs in DB are broken. Rewrite them to use /media/ proxy.
--
-- Patterns:
--   https://storage.yandexcloud.net/svoefoto-client-photos/{key} → https://svoefoto.ru/media/{key}
--   https://s3.ru-1.storage.selcloud.ru/svoefoto-photos/{key}[?presigned-params] → https://svoefoto.ru/media/{key}
--
-- Idempotent: WHERE conditions only match old URLs

BEGIN;

-- 1. messages.attachment_url — YandexCloud (92 rows)
UPDATE messages
SET attachment_url = REPLACE(attachment_url,
  'https://storage.yandexcloud.net/svoefoto-client-photos/',
  'https://svoefoto.ru/media/')
WHERE attachment_url LIKE 'https://storage.yandexcloud.net/svoefoto-client-photos/%';

-- 2. photo_approval_sessions.original_photo_url — YandexCloud (125 rows)
UPDATE photo_approval_sessions
SET original_photo_url = REPLACE(original_photo_url,
  'https://storage.yandexcloud.net/svoefoto-client-photos/',
  'https://svoefoto.ru/media/')
WHERE original_photo_url LIKE 'https://storage.yandexcloud.net/svoefoto-client-photos/%';

-- 3. photo_approval_sessions.original_thumbnail_url — YandexCloud (125 rows)
UPDATE photo_approval_sessions
SET original_thumbnail_url = REPLACE(original_thumbnail_url,
  'https://storage.yandexcloud.net/svoefoto-client-photos/',
  'https://svoefoto.ru/media/')
WHERE original_thumbnail_url LIKE 'https://storage.yandexcloud.net/svoefoto-client-photos/%';

-- 4. outbound_delivery_log.attachment_url — YandexCloud (8 rows)
UPDATE outbound_delivery_log
SET attachment_url = REPLACE(attachment_url,
  'https://storage.yandexcloud.net/svoefoto-client-photos/',
  'https://svoefoto.ru/media/')
WHERE attachment_url LIKE 'https://storage.yandexcloud.net/svoefoto-client-photos/%';

-- 5. print_jobs.file_url — Selectel (24 rows, some with presigned query params)
UPDATE print_jobs
SET file_url = 'https://svoefoto.ru/media/' ||
  substring(split_part(file_url, '?', 1) FROM 'svoefoto-photos/(.+)$')
WHERE file_url LIKE 'https://s3.ru-1.storage.selcloud.ru/svoefoto-photos/%';

-- 6. outbound_queue.attachment_url — Selectel (72 rows)
UPDATE outbound_queue
SET attachment_url = 'https://svoefoto.ru/media/' ||
  substring(split_part(attachment_url, '?', 1) FROM 'svoefoto-photos/(.+)$')
WHERE attachment_url LIKE 'https://s3.ru-1.storage.selcloud.ru/svoefoto-photos/%';

-- 7. staff_messages.attachment_url — Selectel (2 rows)
UPDATE staff_messages
SET attachment_url = 'https://svoefoto.ru/media/' ||
  substring(split_part(attachment_url, '?', 1) FROM 'svoefoto-photos/(.+)$')
WHERE attachment_url LIKE 'https://s3.ru-1.storage.selcloud.ru/svoefoto-photos/%';

-- 8. email_attachments.storage_url — Selectel (4 rows)
UPDATE email_attachments
SET storage_url = 'https://svoefoto.ru/media/' ||
  substring(split_part(storage_url, '?', 1) FROM 'svoefoto-photos/(.+)$')
WHERE storage_url LIKE 'https://s3.ru-1.storage.selcloud.ru/svoefoto-photos/%';

-- 9. photo_approvals.original_thumbnail_url — YandexCloud (285 rows)
UPDATE photo_approvals
SET original_thumbnail_url = REPLACE(original_thumbnail_url,
  'https://storage.yandexcloud.net/svoefoto-client-photos/',
  'https://svoefoto.ru/media/')
WHERE original_thumbnail_url LIKE 'https://storage.yandexcloud.net/svoefoto-client-photos/%';

-- 10. print_jobs.source_file_url — Selectel (5 rows)
UPDATE print_jobs
SET source_file_url = 'https://svoefoto.ru/media/' ||
  substring(split_part(source_file_url, '?', 1) FROM 'svoefoto-photos/(.+)$')
WHERE source_file_url LIKE 'https://s3.ru-1.storage.selcloud.ru/svoefoto-photos/%';

-- 11. outbound_delivery_log_archived — YandexCloud (20 rows)
UPDATE outbound_delivery_log_archived
SET attachment_url = REPLACE(attachment_url,
  'https://storage.yandexcloud.net/svoefoto-client-photos/',
  'https://svoefoto.ru/media/')
WHERE attachment_url LIKE 'https://storage.yandexcloud.net/svoefoto-client-photos/%';

COMMIT;
