import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload, AuthRequest } from '../types/index.js';
import db from '../database/db.js';
import { AppError } from './errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { isTokenBlacklisted, isUserTokensInvalidated } from '../services/token-blacklist.service.js';
import { getAuthCache, setAuthCache, type CachedAuthUser } from '../services/auth-cache.service.js';
import { verifyJwt } from '../utils/jwt-keys.js';

/**
 * Feature flag: when true, permissions are resolved from DB (rbac_* tables).
 * Set RBAC_USE_DB=true in .env to enable. Default: false (uses static map).
 */
const USE_DB_PERMISSIONS = process.env['RBAC_USE_DB'] === 'true';

export type { AuthRequest };

/**
 * Helper function to ensure user is authenticated
 * Throws with proper response if user is not authenticated
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function requireUser(req: AuthRequest, _res?: Response): asserts req is AuthRequest & { user: NonNullable<AuthRequest['user']> } {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized', ErrorCode.UNAUTHORIZED);
  }
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Cookie-first: httpOnly cookie (secure), fallback to Authorization header (mobile/legacy)
    const authHeader = req.headers.authorization;
    const token = req.cookies?.['access_token'] || (authHeader && authHeader.split(' ')[1]); // Cookie > Bearer TOKEN

    if (!token) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const decoded = verifyJwt(token) as JwtPayload;

    // Token blacklist check (Redis) — revoked on logout / password reset
    const [tokenBl, userBl] = await Promise.all([
      isTokenBlacklisted(token).catch(() => false),
      isUserTokensInvalidated(decoded.userId, decoded.iat || 0).catch(() => false),
    ]);
    if (tokenBl || userBl) {
      res.status(401).json({ success: false, error: 'Token revoked' });
      return;
    }

    // Verify user still exists and is active — Redis cache (5-min TTL)
    let user: CachedAuthUser | null = await getAuthCache(decoded.userId);
    if (!user) {
      // Cache miss — fetch from DB and populate cache
      user = await db.queryOne<CachedAuthUser>(
        'SELECT id, email, role, is_active, display_name, phone, force_password_change, last_password_change FROM users WHERE id = $1',
        [decoded.userId]
      );
      if (user) {
        setAuthCache(decoded.userId, user).catch(() => {});
      }
    }

    if (!user || !user.is_active) {
      res.status(401).json({ success: false, error: 'Invalid or inactive user' });
      return;
    }

    // Принудительная смена пароля для сотрудников
    if (user.role !== 'client') {
      if (user.force_password_change) {
        res.status(403).json({
          success: false,
          error: 'Требуется смена пароля',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
        return;
      }
      // Проверка 90-дневного срока действия пароля
      if (user.last_password_change) {
        const daysSinceChange = (Date.now() - new Date(user.last_password_change).getTime()) / 86400000;
        if (daysSinceChange > 90) {
          db.query('UPDATE users SET force_password_change = true WHERE id = $1', [user.id]).catch(() => {});
          res.status(403).json({
            success: false,
            error: 'Пароль устарел (более 90 дней), требуется смена',
            code: 'PASSWORD_CHANGE_REQUIRED',
          });
          return;
        }
      }
    }

    const baseUser = {
      id: user.id as string,
      email: user.email ?? '',
      role: user.role,
      display_name: user.display_name ?? undefined,
      phone: user.phone ?? undefined,
    };

    if (USE_DB_PERMISSIONS) {
      const perms = await permissionService.getUserPermissions(user.id);
      req.user = { ...baseUser, permissions: perms };
    } else {
      req.user = { ...baseUser, permissions: getPermissions(user.role) };
    }

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, error: 'Token expired' });
      return;
    }
    logger.error('Auth middleware error:', { error: String(error) });
    res.status(500).json({ success: false, error: 'Authentication error' });
  }
};


import { hasPermission, getPermissions, type Permission } from '../config/permissions.js';
import { permissionService } from '../services/permission.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('auth');

export const requirePermission = (...permissions: Permission[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    let hasAll: boolean;
    // Prefer req.user.permissions loaded by authenticateToken — avoids extra DB roundtrip
    if (req.user.permissions) {
      hasAll = permissions.every(p => req.user!.permissions!.includes(p as string));
    } else if (USE_DB_PERMISSIONS) {
      try {
        hasAll = await permissionService.hasAllPermissions(req.user.id, permissions as string[]);
      } catch (err) {
        // DB unavailable — fallback to static map to stay available
        logger.error('[requirePermission] DB error, falling back to static map', { error: String(err) });
        hasAll = permissions.every(p => hasPermission(req.user!.role, p));
      }
    } else {
      hasAll = permissions.every(p => hasPermission(req.user!.role, p));
    }

    if (!hasAll) {
      res.status(403).json({ success: false, error: 'Недостаточно прав', required: permissions });
      return;
    }

    next();
  };
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Cookie-first: httpOnly cookie (secure), fallback to Authorization header (mobile/legacy)
    const authHeader = req.headers.authorization;
    const token = req.cookies?.['access_token'] || (authHeader && authHeader.split(' ')[1]);

    if (token) {
      const decoded = verifyJwt(token) as JwtPayload;

      // Redis cache for optional auth (same pattern as authenticateToken)
      let user: CachedAuthUser | null = await getAuthCache(decoded.userId);
      if (!user) {
        user = await db.queryOne<CachedAuthUser>(
          'SELECT id, email, role, is_active, display_name, phone, force_password_change, last_password_change FROM users WHERE id = $1',
          [decoded.userId]
        );
        if (user) {
          setAuthCache(decoded.userId, user).catch(() => {});
        }
      }

      if (user && user.is_active) {
        const permissions = USE_DB_PERMISSIONS
          ? await permissionService.getUserPermissions(user.id)
          : getPermissions(user.role);
        req.user = {
          id: user.id as string,
          email: user.email ?? '',
          role: user.role,
          display_name: user.display_name ?? undefined,
          phone: user.phone ?? undefined,
          permissions,
        };
      }
    }

    next();
  } catch (error) {
    // Ignore errors for optional auth
    next();
  }
};

