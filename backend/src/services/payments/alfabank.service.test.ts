import { describe, expect, it } from 'vitest';
import {
  AlfaBankClient,
  AlfaBankConfigurationError,
  DEFAULT_ALFABANK_API_BASE_URL,
  rubToKopeks,
  type AlfaBankClientConfig,
} from './alfabank.service.js';

interface FetchCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

function testConfig(overrides: Partial<AlfaBankClientConfig> = {}): AlfaBankClientConfig {
  return {
    enabled: true,
    apiBaseUrl: DEFAULT_ALFABANK_API_BASE_URL,
    userName: 'test-merchant',
    password: 'test-password',
    returnUrl: 'https://example.test/payments/alfabank/return',
    failUrl: 'https://example.test/payments/alfabank/fail',
    webhookSecret: '',
    ...overrides,
  };
}

function createJsonFetch(responseBody: unknown, status = 200) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

function singleCall(calls: FetchCall[]): FetchCall {
  const call = calls[0];
  if (!call) {
    throw new Error('Expected one fetch call');
  }
  return call;
}

function formBody(call: FetchCall): URLSearchParams {
  const body = call.init?.body;
  if (!(body instanceof URLSearchParams)) {
    throw new Error('Expected URLSearchParams body');
  }
  return body;
}

describe('AlfaBankClient', () => {
  it('converts RUB amounts to integer kopeks', () => {
    expect(rubToKopeks(1)).toBe(100);
    expect(rubToKopeks(123.45)).toBe(12345);
    expect(() => rubToKopeks(0)).toThrow('positive');
    expect(() => rubToKopeks(Number.NaN)).toThrow('finite');
  });

  it('registers an order through the AlfaBank test REST endpoint', async () => {
    const { calls, fetchImpl } = createJsonFetch({
      orderId: 'bank-order-1',
      formUrl: 'https://alfa.rbsuat.com/payment/merchants/rbs/payment_ru.html?mdOrder=bank-order-1',
    });
    const client = new AlfaBankClient(testConfig({ apiBaseUrl: `${DEFAULT_ALFABANK_API_BASE_URL}/` }), fetchImpl);

    const result = await client.registerOrder({
      orderNumber: 'ALFA-TEST-1',
      amountRub: 123.45,
      description: 'Test AlfaBank payment',
      clientId: 'user-1',
      email: 'client@example.test',
      phone: '79001112233',
      metadata: { purpose: 'smoke' },
    });

    expect(result).toEqual({
      success: true,
      orderId: 'bank-order-1',
      formUrl: 'https://alfa.rbsuat.com/payment/merchants/rbs/payment_ru.html?mdOrder=bank-order-1',
      raw: {
        orderId: 'bank-order-1',
        formUrl: 'https://alfa.rbsuat.com/payment/merchants/rbs/payment_ru.html?mdOrder=bank-order-1',
      },
    });

    const call = singleCall(calls);
    expect(String(call.input)).toBe('https://alfa.rbsuat.com/payment/rest/register.do');
    expect(call.init?.method).toBe('POST');

    const body = formBody(call);
    expect(body.get('userName')).toBe('test-merchant');
    expect(body.get('password')).toBe('test-password');
    expect(body.get('orderNumber')).toBe('ALFA-TEST-1');
    expect(body.get('amount')).toBe('12345');
    expect(body.get('currency')).toBe('643');
    expect(body.get('description')).toBe('Test AlfaBank payment');
    expect(body.get('returnUrl')).toBe('https://example.test/payments/alfabank/return');
    expect(body.get('failUrl')).toBe('https://example.test/payments/alfabank/fail');
    expect(body.get('clientId')).toBe('user-1');
    expect(body.get('email')).toBe('client@example.test');
    expect(body.get('phone')).toBe('79001112233');
    expect(body.get('jsonParams')).toBe(JSON.stringify({ purpose: 'smoke' }));
  });

  it('normalizes provider errors from register.do', async () => {
    const { fetchImpl } = createJsonFetch({
      errorCode: '5',
      errorMessage: 'Order number is already used',
    });
    const client = new AlfaBankClient(testConfig(), fetchImpl);

    const result = await client.registerOrder({
      orderNumber: 'ALFA-TEST-1',
      amountRub: 10,
      description: 'Duplicate order',
    });

    expect(result).toEqual({
      success: false,
      errorCode: '5',
      errorMessage: 'Order number is already used',
      raw: {
        errorCode: '5',
        errorMessage: 'Order number is already used',
      },
    });
  });

  it('requests extended order status by AlfaBank order id', async () => {
    const { calls, fetchImpl } = createJsonFetch({
      orderStatus: 2,
      actionCode: 0,
      actionCodeDescription: 'Success',
    });
    const client = new AlfaBankClient(testConfig(), fetchImpl);

    const result = await client.getOrderStatusExtended({ orderId: 'bank-order-1' });

    expect(result.success).toBe(true);
    const call = singleCall(calls);
    expect(String(call.input)).toBe('https://alfa.rbsuat.com/payment/rest/getOrderStatusExtended.do');

    const body = formBody(call);
    expect(body.get('userName')).toBe('test-merchant');
    expect(body.get('password')).toBe('test-password');
    expect(body.get('orderId')).toBe('bank-order-1');
  });

  it('rejects calls when AlfaBank credentials are missing', async () => {
    const { calls, fetchImpl } = createJsonFetch({});
    const client = new AlfaBankClient(testConfig({ userName: '', password: '' }), fetchImpl);

    await expect(client.registerOrder({
      orderNumber: 'ALFA-TEST-1',
      amountRub: 10,
      description: 'No credentials',
    })).rejects.toBeInstanceOf(AlfaBankConfigurationError);
    expect(calls).toHaveLength(0);
  });
});
