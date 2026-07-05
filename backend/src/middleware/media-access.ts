/**
 * media-access.ts — Access control for /media/* proxy.
 *
 * Determines auth requirements based on S3 key prefix:
 *   gallery/     → public (UUID-based paths, no auth)
 *   photos/      → public (access gated at API level)
 *   chat/        → public (128-bit UUID keys = unguessable)
 *   staff-chat/  → public (UUID keys, employee-only content)
 *   approvals/   → public (UUID keys, session token for client share)
 *   photo-workspace/crops/ → public (UUID-based internal crop outputs)
 *   print-uploads/ → public (UUID paths for local print uploads consumed by Rust/CUPS)
 *   print-layout/ → public (UUID paths for Rust-rendered sheets consumed by CUPS)
 *   print-conversions/ → public (UUID paths for converted document pages consumed by CUPS)
 *   print/       → JWT operator/admin only (customer documents)
 */

import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt-keys.js';
import { createLogger } from '../utils/logger.js';
import { verifySignedUrl } from '../services/signed-url.service.js';
import { config } from '../config/index.js';

const log = createLogger('media-access');

/** Prefixes that require no authentication — protected by UUID obscurity */
const PUBLIC_PREFIXES = [
  'gallery/',
  'photos/',
  'chat/',
  'staff-chat/',
  'approvals/',
  'photo-workspace/crops/',
  'print-uploads/',
  'print-layout/',
  'print-conversions/',
  'print-materials/',
  'order-attachments/',
];

/** Prefixes that require JWT (operator/admin) — sensitive customer documents */
const OPERATOR_PREFIXES = ['print/'];

function extractKey(req: Request): string {
  const raw = req.params['key'];
  return (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\/+/, '');
}

function hasValidJwt(req: Request): boolean {
  const authHeader = req.headers.authorization;
  const token = req.cookies?.['access_token']
    || (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined);
  if (!token) return false;
  try {
    verifyJwt(token);
    return true;
  } catch {
    return false;
  }
}

function hasValidSignedUrl(req: Request): boolean {
  if (!req.query['sig'] || !req.query['exp']) return false;
  return verifySignedUrl(req.originalUrl, config.guestSession.secret);
}

/**
 * Media access middleware. Mounted before the media-proxy route handler.
 */
export function verifyMediaAccess(req: Request, res: Response, next: NextFunction): void {
  const key = extractKey(req);

  // Public prefixes — no auth needed (UUID-based paths are unguessable)
  if (PUBLIC_PREFIXES.some(p => key.startsWith(p))) {
    next();
    return;
  }

  // Operator-only prefixes — require valid JWT
  if (OPERATOR_PREFIXES.some(p => key.startsWith(p))) {
    if (hasValidJwt(req) || hasValidSignedUrl(req)) {
      next();
      return;
    }
    log.warn('media access denied: operator-only prefix without JWT', {
      key: key.slice(0, 60),
      ip: req.ip,
    });
    res.status(403).json({ error: 'Authentication required' });
    return;
  }

  // Unknown prefix — deny by default
  log.warn('media access denied: unknown prefix', { key: key.slice(0, 60) });
  res.status(403).json({ error: 'Access denied' });
}
