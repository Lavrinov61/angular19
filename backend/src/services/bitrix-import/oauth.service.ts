/**
 * Bitrix24 OAuth refresh flow.
 *
 * Access-token живёт ~1 час (AUTH_EXPIRES=3600). За 5 мин до истечения рефрешим.
 * Refresh-эндпоинт — глобальный oauth.bitrix.info, а НЕ ваш портал.
 *
 * Источник: https://apidocs.bitrix24.com/api-reference/oauth/index.html
 */

import { createLogger } from '../../utils/logger.js';
import { loadTokens, loadLatestTokens, saveTokens } from './token-store.js';
import type { BitrixOAuthTokens, BitrixTokenResponse } from './types.js';

const logger = createLogger('bitrix.oauth');

const REFRESH_ENDPOINT = 'https://oauth.bitrix.info/oauth/token/';
const REFRESH_SKEW_MS = 5 * 60 * 1000;

let inFlightRefresh: Promise<BitrixOAuthTokens> | null = null;

function getClientId(): string {
  return process.env['BITRIX_OAUTH_CLIENT_ID'] ?? '';
}

function getClientSecret(): string {
  return process.env['BITRIX_OAUTH_CLIENT_SECRET'] ?? '';
}

function getPortalUrl(): string {
  return (process.env['BITRIX_PORTAL_URL'] ?? '').replace(/\/$/, '');
}

async function refresh(tokens: BitrixOAuthTokens): Promise<BitrixOAuthTokens> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error('BITRIX_OAUTH_CLIENT_ID / CLIENT_SECRET not configured');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
  });

  const url = `${REFRESH_ENDPOINT}?${params.toString()}`;
  logger.info('Refreshing Bitrix token', { portal: tokens.portalUrl });

  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Bitrix refresh failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as BitrixTokenResponse;
  if (!data.access_token || !data.refresh_token) {
    throw new Error(`Bitrix refresh returned malformed body`);
  }

  await saveTokens(
    tokens.portalUrl,
    data.access_token,
    data.refresh_token,
    data.expires_in,
    tokens.scope,
  );

  return {
    portalUrl: tokens.portalUrl,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: tokens.scope,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Загрузить свежие токены, при необходимости обновить.
 * Concurrent-safe: одновременные вызовы шарят один refresh Promise.
 */
export async function getAccessToken(portalUrl?: string): Promise<BitrixOAuthTokens> {
  const targetPortal = portalUrl ?? getPortalUrl();

  let tokens = targetPortal ? await loadTokens(targetPortal) : await loadLatestTokens();
  if (!tokens) {
    throw new Error(`No Bitrix tokens saved for portal "${targetPortal}" — install the app first`);
  }

  const needsRefresh = tokens.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;
  if (!needsRefresh) return tokens;

  if (!inFlightRefresh) {
    inFlightRefresh = refresh(tokens).finally(() => {
      inFlightRefresh = null;
    });
  }

  tokens = await inFlightRefresh;
  return tokens;
}

/**
 * Принудительное обновление (например после 401).
 */
export async function forceRefresh(portalUrl?: string): Promise<BitrixOAuthTokens> {
  const targetPortal = portalUrl ?? getPortalUrl();
  const existing = targetPortal ? await loadTokens(targetPortal) : await loadLatestTokens();
  if (!existing) {
    throw new Error('No Bitrix tokens to force-refresh');
  }

  inFlightRefresh = refresh(existing).finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}
