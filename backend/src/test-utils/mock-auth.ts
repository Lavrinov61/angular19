import jwt from 'jsonwebtoken';
import { getPermissions } from '../config/permissions.js';

/**
 * JWT secret used in all tests.
 * Must match what is provided to the config mock in test files:
 *   vi.mock('../config/index.js', () => ({ config: { jwt: { secret: TEST_JWT_SECRET } } }))
 */
export const TEST_JWT_SECRET = 'test-jwt-secret-for-tests';

export interface MockUser {
  id: string;
  email: string;
  role: string;
  display_name?: string;
  phone?: string;
  is_active?: boolean;
  permissions?: string[];
  email_verified?: boolean;
  force_password_change?: boolean;
  last_password_change?: string | null;
}

/** Base user factory — override any field */
export function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  const role = overrides.role ?? 'client';
  return {
    id: 'test-user-id',
    email: 'user@example.com',
    role,
    display_name: 'Test User',
    is_active: true,
    email_verified: true,
    permissions: getPermissions(role),
    ...overrides,
  };
}

export function makeAdminUser(overrides: Partial<MockUser> = {}): MockUser {
  return makeUser({ id: 'admin-id', email: 'admin@example.com', role: 'admin', display_name: 'Admin User', ...overrides });
}

export function makeManagerUser(overrides: Partial<MockUser> = {}): MockUser {
  return makeUser({ id: 'manager-id', email: 'manager@example.com', role: 'manager', display_name: 'Manager User', ...overrides });
}

export function makeEmployeeUser(overrides: Partial<MockUser> = {}): MockUser {
  return makeUser({ id: 'employee-id', email: 'employee@example.com', role: 'employee', display_name: 'Employee User', ...overrides });
}

export function makeClientUser(overrides: Partial<MockUser> = {}): MockUser {
  return makeUser({ id: 'client-id', email: 'client@example.com', role: 'client', display_name: 'Client User', ...overrides });
}

/**
 * Signs a JWT access token using TEST_JWT_SECRET.
 * The token payload matches what authenticateToken middleware expects.
 */
export function makeToken(user: MockUser, expiresIn = '15m'): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    TEST_JWT_SECRET,
    { expiresIn } as jwt.SignOptions,
  );
}

/** Creates a token that is already expired */
export function makeExpiredToken(user: MockUser): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    TEST_JWT_SECRET,
    { expiresIn: 1 }, // 1ms — expired before use
  );
}

/** Returns the Authorization header object for supertest */
export function authHeader(user: MockUser): { Authorization: string } {
  return { Authorization: `Bearer ${makeToken(user)}` };
}

/** Returns a Bearer token string */
export function bearerToken(user: MockUser): string {
  return `Bearer ${makeToken(user)}`;
}
