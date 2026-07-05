/**
 * Чтение/запись OAuth-токенов Bitrix24 с шифрованием через pgcrypto.
 *
 * Ключ шифрования — BITRIX_TOKEN_ENCRYPTION_KEY (в .env).
 * Токены в БД лежат как bytea, расшифровываются через pgp_sym_decrypt.
 */

import db from '../../database/db.js';
import { createLogger } from '../../utils/logger.js';
import type { BitrixOAuthTokenRow } from '../../types/views/bitrix-archive-views.js';
import type { BitrixOAuthTokens } from './types.js';

const logger = createLogger('bitrix.token-store');

function getEncryptionKey(): string {
  const key = process.env['BITRIX_TOKEN_ENCRYPTION_KEY'] ?? '';
  if (!key) {
    throw new Error('BITRIX_TOKEN_ENCRYPTION_KEY is not configured');
  }
  return key;
}

function toTokens(row: BitrixOAuthTokenRow | null): BitrixOAuthTokens | null {
  if (!row) return null;
  return {
    portalUrl: row.portal_url,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scope: row.scope,
    expiresAt: new Date(row.expires_at),
  };
}

export async function loadTokens(portalUrl: string): Promise<BitrixOAuthTokens | null> {
  const key = getEncryptionKey();
  const row = await db.queryOne<BitrixOAuthTokenRow>(
    `
    SELECT
      portal_url,
      pgp_sym_decrypt(access_token_encrypted, $2) AS access_token,
      pgp_sym_decrypt(refresh_token_encrypted, $2) AS refresh_token,
      scope,
      expires_at
    FROM bitrix_oauth_tokens
    WHERE portal_url = $1
    `,
    [portalUrl, key],
  );
  return toTokens(row);
}

export async function loadLatestTokens(): Promise<BitrixOAuthTokens | null> {
  const key = getEncryptionKey();
  const row = await db.queryOne<BitrixOAuthTokenRow>(
    `
    SELECT
      portal_url,
      pgp_sym_decrypt(access_token_encrypted, $1) AS access_token,
      pgp_sym_decrypt(refresh_token_encrypted, $1) AS refresh_token,
      scope,
      expires_at
    FROM bitrix_oauth_tokens
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [key],
  );
  return toTokens(row);
}

export async function saveTokens(
  portalUrl: string,
  accessToken: string,
  refreshToken: string,
  expiresInSec: number,
  scope = 'disk',
): Promise<void> {
  const key = getEncryptionKey();
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);

  await db.query(
    `
    INSERT INTO bitrix_oauth_tokens
      (portal_url, access_token_encrypted, refresh_token_encrypted, scope, expires_at)
    VALUES
      ($1, pgp_sym_encrypt($2, $5), pgp_sym_encrypt($3, $5), $4, $6)
    ON CONFLICT (portal_url) DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      scope = EXCLUDED.scope,
      expires_at = EXCLUDED.expires_at,
      updated_at = now()
    `,
    [portalUrl, accessToken, refreshToken, scope, key, expiresAt],
  );

  logger.info('Bitrix tokens persisted', { portalUrl, expiresAt: expiresAt.toISOString() });
}
