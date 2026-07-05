/**
 * OAuth Account Linking Service
 *
 * Prevents OAuth Account Takeover: when an OAuth login matches an existing
 * account by email (but not by OAuth provider ID), we create a "pending link"
 * and require email confirmation before granting access.
 */

import crypto from 'crypto';
import db from '../database/db.js';
import { config } from '../config/index.js';
import { sendOAuthLinkConfirmEmail } from './email.service.js';
import { logAudit } from './audit.service.js';

import { createLogger } from '../utils/logger.js';
interface PendingLinkResult {
  token: string;
  maskedEmail: string;
}

const logger = createLogger('oauth-link.service');
/**
 * Create a pending OAuth link — sends confirmation email to account owner.
 * Returns the token and masked email for frontend display.
 */
export async function createPendingLink(
  userId: string,
  userEmail: string,
  displayName: string | null,
  provider: string,
  providerId: string,
  ip: string | undefined,
): Promise<PendingLinkResult> {
  // Delete old pending links for this user + provider
  await db.query(
    'DELETE FROM pending_oauth_links WHERE user_id = $1 AND provider = $2',
    [userId, provider],
  );

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.query(
    `INSERT INTO pending_oauth_links (user_id, provider, provider_id, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, provider, providerId, token, expiresAt],
  );

  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
  const confirmUrl = `${frontendUrl}/auth/confirm-oauth-link?token=${token}`;

  // Send confirmation email (fire-and-forget)
  sendOAuthLinkConfirmEmail(userEmail, displayName, provider, confirmUrl).catch(err => {
    logger.error('[OAuthLink] Failed to send confirmation email:', err.message);
  });

  logAudit({
    userId,
    action: 'oauth_link_pending',
    entityType: 'user',
    entityId: userId,
    ip,
    details: { provider, providerId },
  });

  return {
    token,
    maskedEmail: maskEmail(userEmail),
  };
}

/**
 * Confirm a pending OAuth link — links the OAuth account and returns user data.
 */
export async function confirmPendingLink(token: string): Promise<{
  userId: string;
  email: string;
  role: string;
  provider: string;
} | null> {
  const link = await db.queryOne<{
    id: string;
    user_id: string;
    provider: string;
    provider_id: string;
    expires_at: string;
    used: boolean;
  }>(
    'SELECT id, user_id, provider, provider_id, expires_at, used FROM pending_oauth_links WHERE token = $1',
    [token],
  );

  if (!link || link.used || new Date(link.expires_at) < new Date()) {
    return null;
  }

  // Mark as used
  await db.query('UPDATE pending_oauth_links SET used = true WHERE id = $1', [link.id]);

  // Link the OAuth provider to the user
  const providerColumn = getProviderColumn(link.provider);
  if (!providerColumn) return null;

  await db.query(
    `UPDATE users SET ${providerColumn} = $1, updated_at = NOW() WHERE id = $2`,
    [link.provider_id, link.user_id],
  );

  // Get user data for token generation
  const user = await db.queryOne<{ id: string; email: string; role: string }>(
    'SELECT id, email, role FROM users WHERE id = $1 AND is_active = true',
    [link.user_id],
  );

  if (!user) return null;

  logAudit({
    userId: user.id,
    action: 'oauth_link_confirmed',
    entityType: 'user',
    entityId: user.id,
    details: { provider: link.provider, providerId: link.provider_id },
  });

  return { userId: user.id, email: user.email, role: user.role, provider: link.provider };
}

function getProviderColumn(provider: string): string | null {
  const map: Record<string, string> = {
    yandex: 'yandex_id',
    google: 'google_id',
    apple: 'apple_id',
    vk: 'vk_id',
    sber: 'sber_id',
    mts: 'mts_id',
  };
  return map[provider] || null;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  const visible = local.length <= 3 ? local[0] : local.slice(0, 3);
  return `${visible}***@${domain}`;
}
