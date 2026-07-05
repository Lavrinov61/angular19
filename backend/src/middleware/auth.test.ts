import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types/index.js';

vi.mock('jsonwebtoken', () => {
  const JsonWebTokenError = class extends Error { override name = 'JsonWebTokenError'; };
  const TokenExpiredError = class extends Error { override name = 'TokenExpiredError'; };
  return {
    default: {
      verify: vi.fn(),
      sign: vi.fn(),
      decode: vi.fn().mockReturnValue(null),
      JsonWebTokenError,
      TokenExpiredError,
    },
    JsonWebTokenError,
    TokenExpiredError,
  };
});

vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-secret', secretPrevious: '' } },
}));

vi.mock('../database/db.js', () => ({
  default: {
    queryOne: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn(),
    hasAllPermissions: vi.fn(),
  },
}));

vi.mock('../config/permissions.js', async () => {
  const actual = await vi.importActual<typeof import('../config/permissions.js')>('../config/permissions.js');
  return actual;
});

import jwt from 'jsonwebtoken';
import db from '../database/db.js';
import { isTokenBlacklisted, isUserTokensInvalidated } from '../services/token-blacklist.service.js';
import { authenticateToken, requirePermission, requireUser } from './auth.js';

function mockReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    headers: { authorization: 'Bearer valid-token' },
    user: undefined,
    ...overrides,
  } as AuthRequest;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('authenticateToken', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.resetAllMocks();
    next = vi.fn();
    process.env['RBAC_USE_DB'] = 'false';
    vi.mocked(isTokenBlacklisted).mockResolvedValue(false);
    vi.mocked(isUserTokensInvalidated).mockResolvedValue(false);
  });

  it('returns 401 when no token is provided', async () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authentication required' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid JWT', async () => {
    vi.mocked(jwt.verify).mockImplementation(() => {
      const err = new jwt.JsonWebTokenError('invalid');
      throw err;
    });

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid token' }));
  });

  it('returns 401 for expired JWT', async () => {
    vi.mocked(jwt.verify).mockImplementation(() => {
      const err = new jwt.TokenExpiredError('expired', new Date());
      throw err;
    });

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Token expired' }));
  });

  it('returns 401 when token is blacklisted', async () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'u1', iat: 1000 } as any);
    vi.mocked(isTokenBlacklisted).mockResolvedValue(true);

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Token revoked' }));
  });

  it('returns 401 when user tokens are globally invalidated', async () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'u1', iat: 1000 } as any);
    vi.mocked(isTokenBlacklisted).mockResolvedValue(false);
    vi.mocked(isUserTokensInvalidated).mockResolvedValue(true);

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Token revoked' }));
  });

  it('returns 401 when user does not exist in DB', async () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'u1', iat: 1000 } as any);
    vi.mocked(db.queryOne).mockResolvedValue(null);

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid or inactive user' }));
  });

  it('returns 401 when user is inactive', async () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'u1', iat: 1000 } as any);
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'admin', is_active: false });

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('sets req.user with permissions for valid admin token', async () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'u1', iat: 1000 } as any);
    vi.mocked(db.queryOne).mockResolvedValue({
      id: 'u1', email: 'admin@test.com', role: 'admin', is_active: true,
      display_name: 'Admin', phone: null,
    });

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.role).toBe('admin');
    expect(req.user!.permissions).toContain('settings:manage');
    expect(req.user!.permissions).toContain('inbox:view');
  });

  it('sets correct permissions for employee role', async () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'u2', iat: 1000 } as any);
    vi.mocked(db.queryOne).mockResolvedValue({
      id: 'u2', email: 'emp@test.com', role: 'employee', is_active: true,
    });

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user!.permissions).toContain('inbox:view');
    expect(req.user!.permissions).toContain('pos:use');
    expect(req.user!.permissions).not.toContain('settings:manage');
    expect(req.user!.permissions).not.toContain('analytics:view');
  });

  it('client role gets empty permissions', async () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'u3', iat: 1000 } as any);
    vi.mocked(db.queryOne).mockResolvedValue({
      id: 'u3', email: 'client@test.com', role: 'client', is_active: true,
    });

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user!.permissions).toEqual([]);
  });

  it('returns 403 when employee password change is forced', async () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'u2', iat: 1000 } as any);
    vi.mocked(db.queryOne).mockResolvedValue({
      id: 'u2', email: 'emp@test.com', role: 'employee', is_active: true,
      force_password_change: true,
    });

    const req = mockReq();
    const res = mockRes();

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requirePermission', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('returns 401 when user is not set', async () => {
    const middleware = requirePermission('inbox:view');
    const req = mockReq({ user: undefined });
    const res = mockRes();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes when user has required permission', async () => {
    const middleware = requirePermission('inbox:view');
    const req = mockReq({
      user: { id: 'u1', email: 'a@b.c', role: 'admin', permissions: ['inbox:view', 'inbox:manage'] },
    });
    const res = mockRes();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks required permission', async () => {
    const middleware = requirePermission('settings:manage');
    const req = mockReq({
      user: { id: 'u2', email: 'c@d.e', role: 'employee', permissions: ['inbox:view', 'pos:use'] },
    });
    const res = mockRes();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('requires ALL permissions when multiple are specified', async () => {
    const middleware = requirePermission('inbox:view', 'settings:manage');
    const req = mockReq({
      user: { id: 'u1', email: 'a@b.c', role: 'employee', permissions: ['inbox:view', 'pos:use'] },
    });
    const res = mockRes();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('falls back to static role map when permissions array is missing', async () => {
    const middleware = requirePermission('inbox:view');
    const req = mockReq({
      user: { id: 'u1', email: 'a@b.c', role: 'admin' },
    });
    const res = mockRes();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('requireUser', () => {
  it('throws AppError when user is not set', () => {
    const req = mockReq({ user: undefined });
    expect(() => requireUser(req)).toThrow();
  });

  it('does not throw when user is set', () => {
    const req = mockReq({
      user: { id: 'u1', email: 'a@b.c', role: 'admin' },
    });
    expect(() => requireUser(req)).not.toThrow();
  });
});
