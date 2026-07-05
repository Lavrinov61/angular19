/**
 * View types для Bitrix24 Drive import таблиц (migration 112).
 * Используются во всех db.query / db.queryOne вызовах вместо inline-generics.
 */

export interface BitrixOAuthTokenRow {
  portal_url: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_at: string;
}

export interface BitrixOAuthStatusRow {
  portal_url: string;
  scope: string;
  expires_at: string;
  updated_at: string;
}

export interface BitrixImportRunRow {
  id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  last_folder_id: string | null;
  last_file_id: string | null;
  files_scanned: number;
  files_imported: number;
  files_skipped: number;
  bytes_imported: number;
  errors_count: number;
  last_error: string | null;
  initiated_by: string | null;
  config: unknown;
}

export interface BitrixImportRunBrief {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  last_error: string | null;
  errors_count: number;
}

export interface BitrixImportRunCreated {
  id: number;
}

export interface BitrixImportRunStatus {
  status: string;
}

export interface BitrixImportRunWithConfig {
  id: number;
  config: unknown;
}

export interface BitrixPhotoImportRow {
  id: number;
  bitrix_file_id: string;
  bitrix_folder_path: string;
  bitrix_name: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  mime_type: string | null;
  is_webp_preview_generated: boolean;
  imported_at: string;
}

export interface BitrixPhotoImportS3Keys {
  s3_key: string;
  webp_preview_key: string | null;
}

export interface BitrixPhotoImportIdRef {
  id: string;
}
