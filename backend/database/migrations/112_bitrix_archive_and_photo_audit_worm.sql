-- Migration 112: Bitrix24 Drive archive + photo_access_audit WORM + S3 columns
--
-- Цель: защищённое архивное хранилище для копии фотографий с Bitrix24 Drive.
-- Bucket: svoefoto-archive-bitrix (MinIO, object-lock Governance 1y, versioning).
--
-- Таблицы:
--   bitrix_oauth_tokens   — OAuth 2.0 refresh/access токены (encrypted via pgp_sym_encrypt)
--   bitrix_photo_imports  — 1 запись на каждый импортированный файл (идемпотентно)
--   bitrix_import_runs    — состояние прогонов импорта (resume, progress, errors)
--
-- Расширение existing photo_access_audit (миграция 093):
--   + s3_bucket, s3_key  — для логирования доступа к архивным файлам
--   + WORM trigger       — append-only гарантия (152-ФЗ audit requirement)

BEGIN;

-- pgcrypto нужен для шифрования OAuth-токенов
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. OAuth токены Bitrix24 (per portal)
-- ============================================================
CREATE TABLE IF NOT EXISTS bitrix_oauth_tokens (
  id SERIAL PRIMARY KEY,
  portal_url TEXT NOT NULL UNIQUE,
  access_token_encrypted BYTEA NOT NULL,
  refresh_token_encrypted BYTEA NOT NULL,
  scope TEXT NOT NULL DEFAULT 'disk',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Импортированные файлы (1 запись на файл, UNIQUE по bitrix_file_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS bitrix_photo_imports (
  id BIGSERIAL PRIMARY KEY,
  bitrix_file_id TEXT NOT NULL UNIQUE,
  bitrix_folder_id TEXT,
  bitrix_folder_path TEXT NOT NULL,
  bitrix_name TEXT NOT NULL,
  s3_bucket TEXT NOT NULL DEFAULT 'svoefoto-archive-bitrix',
  s3_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  mime_type TEXT,
  is_webp_preview_generated BOOLEAN NOT NULL DEFAULT false,
  webp_preview_key TEXT,
  source_portal TEXT NOT NULL,
  bitrix_created_at TIMESTAMPTZ,
  bitrix_modified_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  run_id BIGINT,
  CONSTRAINT bitrix_photo_imports_s3_key_unique UNIQUE (s3_bucket, s3_key)
);
CREATE INDEX IF NOT EXISTS idx_bitrix_imports_folder
  ON bitrix_photo_imports(bitrix_folder_path);
CREATE INDEX IF NOT EXISTS idx_bitrix_imports_imported_at
  ON bitrix_photo_imports(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_bitrix_imports_run
  ON bitrix_photo_imports(run_id)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bitrix_imports_sha256
  ON bitrix_photo_imports(sha256);

-- ============================================================
-- 3. Прогоны импорта (progress, resume, ошибки)
-- ============================================================
CREATE TABLE IF NOT EXISTS bitrix_import_runs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','paused','completed','failed','cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  last_folder_id TEXT,
  last_file_id TEXT,
  files_scanned BIGINT NOT NULL DEFAULT 0,
  files_imported BIGINT NOT NULL DEFAULT 0,
  files_skipped BIGINT NOT NULL DEFAULT 0,
  bytes_imported BIGINT NOT NULL DEFAULT 0,
  errors_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_bitrix_runs_status
  ON bitrix_import_runs(status, started_at DESC);

-- FK от imports → runs после создания обеих
ALTER TABLE bitrix_photo_imports
  DROP CONSTRAINT IF EXISTS fk_bitrix_imports_run;
ALTER TABLE bitrix_photo_imports
  ADD CONSTRAINT fk_bitrix_imports_run
  FOREIGN KEY (run_id) REFERENCES bitrix_import_runs(id) ON DELETE SET NULL;

-- ============================================================
-- 4. Расширение photo_access_audit: S3-контекст + WORM
-- ============================================================
ALTER TABLE photo_access_audit
  ADD COLUMN IF NOT EXISTS s3_bucket TEXT,
  ADD COLUMN IF NOT EXISTS s3_key TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE INDEX IF NOT EXISTS idx_photo_audit_s3_key
  ON photo_access_audit(s3_key, created_at DESC)
  WHERE s3_key IS NOT NULL;

-- WORM: append-only, UPDATE/DELETE запрещены (152-ФЗ audit requirement)
CREATE OR REPLACE FUNCTION photo_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'photo_access_audit is append-only (WORM); % not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_photo_audit_no_update ON photo_access_audit;
CREATE TRIGGER trg_photo_audit_no_update
  BEFORE UPDATE ON photo_access_audit
  FOR EACH ROW EXECUTE FUNCTION photo_audit_immutable();

DROP TRIGGER IF EXISTS trg_photo_audit_no_delete ON photo_access_audit;
CREATE TRIGGER trg_photo_audit_no_delete
  BEFORE DELETE ON photo_access_audit
  FOR EACH ROW EXECUTE FUNCTION photo_audit_immutable();

-- ============================================================
-- 5. updated_at trigger для bitrix_oauth_tokens
-- ============================================================
CREATE OR REPLACE FUNCTION bitrix_oauth_tokens_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bitrix_oauth_tokens_touch ON bitrix_oauth_tokens;
CREATE TRIGGER trg_bitrix_oauth_tokens_touch
  BEFORE UPDATE ON bitrix_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION bitrix_oauth_tokens_touch();

COMMIT;
