/**
 * Bitrix24 Disk REST API DTOs + internal import types.
 *
 * Source: https://apidocs.bitrix24.com/api-reference/disk/
 */

export interface BitrixOAuthTokens {
  portalUrl: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
}

export interface BitrixTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  domain?: string;
  server_endpoint?: string;
  client_endpoint?: string;
  member_id?: string;
  status?: string;
}

/**
 * disk.folder.getchildren item. SIZE приходит как строка (bigint string) или number.
 */
export interface BitrixDiskItem {
  ID: string;
  NAME: string;
  CODE: string | null;
  STORAGE_ID: string;
  TYPE: 'folder' | 'file';
  REAL_OBJECT_ID: string;
  PARENT_ID: string;
  CREATE_TIME: string;
  UPDATE_TIME: string;
  DELETE_TIME: string | null;
  CREATED_BY: string;
  UPDATED_BY: string;
  DELETED_BY: string | null;
  SIZE?: string | number;
  DOWNLOAD_URL?: string;
  DETAIL_URL?: string;
  FILE_ID?: string;
}

export interface BitrixRestError {
  error: string;
  error_description?: string;
}

export type BitrixRestResult<T> = {
  result: T;
  time: {
    start: number;
    finish: number;
    duration: number;
    processing: number;
    date_start: string;
    date_finish: string;
  };
  next?: number;
  total?: number;
};

export interface ImportRunConfig {
  /** Список корневых folder_id для старта (если пусто — все storage-ы). */
  rootFolderIds?: string[];
  /** Skip файлы modified_time < since (для инкремента). */
  modifiedSince?: string;
  /** Только эти mime-типы (undefined = все). */
  mimeWhitelist?: string[];
  /** Макс файлов за прогон (для dry-run тестов). */
  maxFiles?: number;
}

export interface ImportFileOutcome {
  status: 'imported' | 'skipped' | 'error';
  bitrixFileId: string;
  s3Key?: string;
  size?: number;
  sha256?: string;
  error?: string;
}
