import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../test-utils/create-test-app.js';

const {
  authState,
  createAlfaBankClientMock,
  mockConfig,
  registerOrderMock,
  requirePermissionMock,
  MockAlfaBankConfigurationError,
} = vi.hoisted(() => {
  class MockAlfaBankConfigurationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AlfaBankConfigurationError';
    }
  }

  return {
    authState: {
      authenticated: true,
      permitted: true,
    },
    createAlfaBankClientMock: vi.fn(),
    mockConfig: {
      alfaBank: {
        enabled: true,
        apiBaseUrl: 'https://alfa.rbsuat.com/payment/rest',
        userName: 'test-merchant',
        password: 'test-password',
        returnUrl: 'https://example.test/payments/alfabank/return',
        failUrl: 'https://example.test/payments/alfabank/fail',
        webhookSecret: '',
      },
    },
    registerOrderMock: vi.fn(),
    requirePermissionMock: vi.fn(),
    MockAlfaBankConfigurationError,
  };
});

interface MockAuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    permissions: string[];
  };
}

vi.mock('../config/index.js', () => ({
  config: mockConfig,
}));

vi.mock('../services/payments/alfabank.service.js', () => ({
  AlfaBankConfigurationError: MockAlfaBankConfigurationError,
  createAlfaBankClient: createAlfaBankClientMock,
}));

vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: MockAuthRequest, res: Response, next: NextFunction) => {
    if (!authState.authenticated) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    req.user = {
      id: 'admin-1',
      role: 'admin',
      permissions: ['subscriptions:manage'],
    };
    next();
  },
  requirePermission: (...permissions: string[]) => (req: Request, res: Response, next: NextFunction) => {
    requirePermissionMock(permissions);
    if (!authState.permitted) {
      res.status(403).json({ success: false, error: 'Недостаточно прав', required: permissions });
      return;
    }
    next();
  },
}));

let app: import('express').Express;

beforeAll(async () => {
  const { default: router } = await import('./alfabank-payments.routes.js');
  app = createTestApp(router, '/');
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.authenticated = true;
  authState.permitted = true;
  mockConfig.alfaBank.enabled = true;
  mockConfig.alfaBank.apiBaseUrl = 'https://alfa.rbsuat.com/payment/rest';
  mockConfig.alfaBank.userName = 'test-merchant';
  mockConfig.alfaBank.password = 'test-password';
  mockConfig.alfaBank.returnUrl = 'https://example.test/payments/alfabank/return';
  mockConfig.alfaBank.failUrl = 'https://example.test/payments/alfabank/fail';
  createAlfaBankClientMock.mockReturnValue({ registerOrder: registerOrderMock });
  registerOrderMock.mockResolvedValue({
    success: true,
    orderId: 'bank-order-1',
    formUrl: 'https://alfa.rbsuat.com/payment/merchants/rbs/payment_ru.html?mdOrder=bank-order-1',
    raw: {},
  });
});

describe('alfabank payments routes', () => {
  it('exposes safe health without credentials', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      provider: 'alfabank',
      environment: 'test',
      enabled: true,
      configured: true,
      apiBaseUrl: 'https://alfa.rbsuat.com/payment/rest',
    });
    expect(JSON.stringify(res.body)).not.toContain('test-password');
    expect(JSON.stringify(res.body)).not.toContain('test-merchant');
  });

  it('guards test order registration with auth and subscriptions permission', async () => {
    authState.authenticated = false;

    const res = await request(app)
      .post('/test/register-order')
      .send({ amountRub: 10, description: 'Smoke order' });

    expect(res.status).toBe(401);
    expect(registerOrderMock).not.toHaveBeenCalled();
  });

  it('returns 503 when AlfaBank is not configured', async () => {
    registerOrderMock.mockRejectedValueOnce(new MockAlfaBankConfigurationError('AlfaBank credentials are missing'));

    const res = await request(app)
      .post('/test/register-order')
      .send({ amountRub: 10, description: 'Smoke order' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: 'AlfaBank payments are not configured',
    });
    expect(JSON.stringify(res.body)).not.toContain('test-password');
  });

  it('registers a test AlfaBank order and returns the payment form URL', async () => {
    const res = await request(app)
      .post('/test/register-order')
      .send({
        amountRub: 10.5,
        description: 'Smoke order',
        clientId: 'client-1',
        email: 'client@example.test',
        phone: '79001112233',
      });

    expect(res.status).toBe(201);
    expect(requirePermissionMock).toHaveBeenCalledWith(['subscriptions:manage']);
    expect(createAlfaBankClientMock).toHaveBeenCalledWith(mockConfig.alfaBank);
    expect(registerOrderMock).toHaveBeenCalledWith(expect.objectContaining({
      orderNumber: expect.stringMatching(/^ALFA-TEST-/),
      amountRub: 10.5,
      description: 'Smoke order',
      clientId: 'client-1',
      email: 'client@example.test',
      phone: '79001112233',
    }));
    expect(res.body).toEqual({
      success: true,
      provider: 'alfabank',
      test: true,
      orderNumber: expect.stringMatching(/^ALFA-TEST-/),
      orderId: 'bank-order-1',
      formUrl: 'https://alfa.rbsuat.com/payment/merchants/rbs/payment_ru.html?mdOrder=bank-order-1',
    });
  });
});
