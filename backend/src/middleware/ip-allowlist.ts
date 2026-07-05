/**
 * IP allowlist middleware for CRM / admin / employee surfaces.
 *
 * Default mode: audit-only. If the caller's IP is not inside any of the CIDRs in
 * TRUSTED_CIDRS, we emit a structured pino warn + increment Prometheus counter
 * `crm_ip_guard_reject_total{mode}`. The request is NOT blocked.
 *
 * Hard mode (IP_GUARD_MODE=hard): return 403 FORBIDDEN_IP AppError.
 *
 * Trust proxy is configured to 2 in app.ts, so req.ip is the real client address.
 */

import type { Response, NextFunction } from 'express';
import { BlockList, isIP } from 'net';
import jwt from 'jsonwebtoken';
import type { AuthRequest } from '../types/index.js';
import { AppError } from './errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { createLogger } from '../utils/logger.js';
import { crmIpGuardRejectTotal } from '../services/metrics.service.js';

const log = createLogger('ip-allowlist');

const DEFAULT_CIDRS = '10.200.0.0/24,127.0.0.1/32';

interface ParsedCidr {
  raw: string;
  family: 'ipv4' | 'ipv6';
  address: string;
  prefix: number;
}

function parseCidr(raw: string): ParsedCidr | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const [addressPart, prefixPart] = trimmed.split('/');
  if (!addressPart) return null;

  const ipKind = isIP(addressPart);
  if (ipKind === 0) return null;

  const family: 'ipv4' | 'ipv6' = ipKind === 6 ? 'ipv6' : 'ipv4';
  const defaultPrefix = family === 'ipv6' ? 128 : 32;
  const prefix = prefixPart === undefined ? defaultPrefix : Number(prefixPart);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > defaultPrefix) {
    return null;
  }

  return { raw: trimmed, family, address: addressPart, prefix };
}

function buildBlockList(cidrs: string[]): { blockList: BlockList; entries: ParsedCidr[] } {
  const blockList = new BlockList();
  const entries: ParsedCidr[] = [];
  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr);
    if (!parsed) {
      log.warn('ip-allowlist: ignoring malformed CIDR', { cidr });
      continue;
    }
    blockList.addSubnet(parsed.address, parsed.prefix, parsed.family);
    entries.push(parsed);
  }
  return { blockList, entries };
}

let cachedEnv: { cidrs: string; mode: string } | null = null;
let cachedState: { blockList: BlockList; entries: ParsedCidr[]; mode: 'audit' | 'hard' } | null = null;

function loadState(): { blockList: BlockList; entries: ParsedCidr[]; mode: 'audit' | 'hard' } {
  const cidrsEnv = process.env['TRUSTED_CIDRS'] ?? DEFAULT_CIDRS;
  const modeEnv = (process.env['IP_GUARD_MODE'] ?? 'audit').toLowerCase();

  if (cachedEnv && cachedState && cachedEnv.cidrs === cidrsEnv && cachedEnv.mode === modeEnv) {
    return cachedState;
  }

  const cidrs = cidrsEnv.split(',').map((s) => s.trim()).filter(Boolean);
  const { blockList, entries } = buildBlockList(cidrs);
  const mode: 'audit' | 'hard' = modeEnv === 'hard' ? 'hard' : 'audit';

  cachedEnv = { cidrs: cidrsEnv, mode: modeEnv };
  cachedState = { blockList, entries, mode };

  log.info('ip-allowlist state loaded', {
    mode,
    cidrCount: entries.length,
    cidrs: entries.map((e) => e.raw),
  });

  return cachedState;
}

function ipInAllowlist(ip: string | undefined, state: ReturnType<typeof loadState>): boolean {
  if (!ip) return false;
  const kind = isIP(ip);
  if (kind === 0) return false;

  // net.BlockList.check — second arg is family. IPv4 inside IPv6 ('::ffff:1.2.3.4') is handled
  // by passing 'ipv4' when possible; fallback to raw family if mapping fails.
  if (kind === 6 && ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (isIP(mapped) === 4 && state.blockList.check(mapped, 'ipv4')) return true;
  }
  const family: 'ipv4' | 'ipv6' = kind === 6 ? 'ipv6' : 'ipv4';
  return state.blockList.check(ip, family);
}

export interface IpAllowlistOptions {
  logTag?: string;
}

export function ipAllowlistAuditOnly(opts: IpAllowlistOptions = {}) {
  const logTag = opts.logTag ?? 'crm';

  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    const state = loadState();
    const ip = req.ip;

    if (ipInAllowlist(ip, state)) {
      next();
      return;
    }

    const context = {
      logTag,
      path: req.originalUrl || req.url,
      ip: ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      userId: req.user?.id ?? null,
      mode: state.mode,
    };

    try {
      crmIpGuardRejectTotal.labels(state.mode, logTag).inc();
    } catch { /* counter errors are non-fatal */ }

    if (state.mode === 'hard') {
      log.warn('ip-allowlist reject (hard)', context);
      next(new AppError(403, 'Access denied from this network', ErrorCode.FORBIDDEN_IP));
      return;
    }

    log.warn('ip-allowlist reject (audit-only)', context);
    next();
  };
}

// Exposed for tests — resets memoised state after mutating process.env.
export function __resetIpAllowlistStateForTests(): void {
  cachedEnv = null;
  cachedState = null;
}
