/**
 * Omnichannel v2 — Instagram Token Refresh
 *
 * Instagram long-lived tokens expire after 60 days.
 * This module refreshes the token every ~50 days.
 * Updates channel_accounts.credentials with new token + expiry.
 */

import { fetchWithTimeout } from '../../../utils/fetch-timeout.js';
import { updateCredentials, updateTokenRefresh } from '../core/account-store.js';
import type { ChannelAccount } from '../core/types.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('ig-token-refresh');

/**
 * Refresh Instagram long-lived token.
 * Updates both credentials JSON and token_expires_at in channel_accounts.
 */
export async function refreshInstagramToken(account: ChannelAccount): Promise<boolean> {
  const currentToken = account.credentials['accessToken'] as string | undefined;
  if (!currentToken) {
    log.warn('No access token to refresh', { accountId: account.id });
    return false;
  }

  try {
    const response = await fetchWithTimeout(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`,
    );

    if (!response.ok) {
      log.error('Token refresh HTTP error', { status: response.status, body: await response.text() });
      return false;
    }

    const data = await response.json() as Record<string, unknown>;
    const newToken = data['access_token'] as string;
    const expiresIn = data['expires_in'] as number; // seconds

    if (!newToken) {
      log.error('No access_token in refresh response', { data });
      return false;
    }

    // Update credentials in DB
    const updatedCreds = { ...account.credentials, accessToken: newToken };
    await updateCredentials(account.id, updatedCreds);

    // Update token expiry
    const expiresAt = new Date(Date.now() + (expiresIn || 60 * 86400) * 1000);
    await updateTokenRefresh(account.id, expiresAt);

    log.info('Token refreshed', { accountId: account.id, expiresIn, expiresAt: expiresAt.toISOString() });
    return true;
  } catch (err) {
    log.error('Token refresh failed', { accountId: account.id, error: String(err) });
    return false;
  }
}

/**
 * Check if token needs refreshing (within 10 days of expiry).
 */
export function shouldRefreshToken(account: ChannelAccount): boolean {
  if (!account.tokenExpiresAt) return false;
  const daysUntilExpiry = (account.tokenExpiresAt.getTime() - Date.now()) / (1000 * 86400);
  return daysUntilExpiry < 10;
}
