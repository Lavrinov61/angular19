export const DEFAULT_ALFABANK_API_BASE_URL = 'https://alfa.rbsuat.com/payment/rest';
export const ALFABANK_RUB_CURRENCY_CODE = '643';

export interface AlfaBankClientConfig {
  enabled: boolean;
  apiBaseUrl: string;
  userName: string;
  password: string;
  returnUrl: string;
  failUrl: string;
  webhookSecret: string;
}

export interface AlfaBankMetadataPayload {
  readonly [key: string]: unknown;
}

export interface AlfaBankRawResponse {
  [key: string]: unknown;
}

export interface AlfaBankRegisterOrderInput {
  orderNumber: string;
  amountRub: number;
  description: string;
  returnUrl?: string;
  failUrl?: string;
  clientId?: string;
  email?: string;
  phone?: string;
  metadata?: AlfaBankMetadataPayload;
}

export interface AlfaBankOrderStatusInput {
  orderId?: string;
  orderNumber?: string;
}

export interface AlfaBankRegisterOrderSuccess {
  success: true;
  orderId: string;
  formUrl: string;
  raw: AlfaBankRawResponse;
}

export interface AlfaBankOrderStatusSuccess {
  success: true;
  raw: AlfaBankRawResponse;
}

export interface AlfaBankProviderError {
  success: false;
  errorCode: string;
  errorMessage: string;
  raw: AlfaBankRawResponse;
}

export type AlfaBankRegisterOrderResult = AlfaBankRegisterOrderSuccess | AlfaBankProviderError;
export type AlfaBankOrderStatusResult = AlfaBankOrderStatusSuccess | AlfaBankProviderError;

export class AlfaBankConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlfaBankConfigurationError';
  }
}

export class AlfaBankValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlfaBankValidationError';
  }
}

export function createAlfaBankClient(config: AlfaBankClientConfig, fetchImpl: typeof fetch = fetch): AlfaBankClient {
  return new AlfaBankClient(config, fetchImpl);
}

export function rubToKopeks(amountRub: number): number {
  if (!Number.isFinite(amountRub)) {
    throw new AlfaBankValidationError('Amount must be finite');
  }
  if (amountRub <= 0) {
    throw new AlfaBankValidationError('Amount must be positive');
  }
  return Math.round(amountRub * 100);
}

export function normalizeAlfaBankApiBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim();
  return (trimmed || DEFAULT_ALFABANK_API_BASE_URL).replace(/\/+$/, '');
}

export class AlfaBankClient {
  private readonly apiBaseUrl: string;

  constructor(
    private readonly config: AlfaBankClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiBaseUrl = normalizeAlfaBankApiBaseUrl(config.apiBaseUrl);
  }

  async registerOrder(input: AlfaBankRegisterOrderInput): Promise<AlfaBankRegisterOrderResult> {
    this.assertConfigured();

    const params = this.credentialsParams();
    params.set('orderNumber', requiredText(input.orderNumber, 'orderNumber'));
    params.set('amount', String(rubToKopeks(input.amountRub)));
    params.set('currency', ALFABANK_RUB_CURRENCY_CODE);
    params.set('description', requiredText(input.description, 'description'));
    params.set('returnUrl', optionalText(input.returnUrl) ?? this.config.returnUrl);
    params.set('failUrl', optionalText(input.failUrl) ?? this.config.failUrl);

    appendOptional(params, 'clientId', input.clientId);
    appendOptional(params, 'email', input.email);
    appendOptional(params, 'phone', input.phone);

    if (input.metadata && Object.keys(input.metadata).length > 0) {
      params.set('jsonParams', JSON.stringify(input.metadata));
    }

    const raw = await this.postForm('register.do', params);
    const providerError = readProviderError(raw);
    if (providerError) return providerError;

    const orderId = readString(raw['orderId']);
    const formUrl = readString(raw['formUrl']);
    if (!orderId || !formUrl) {
      return invalidResponse('AlfaBank register.do response did not include orderId/formUrl', raw);
    }

    return {
      success: true,
      orderId,
      formUrl,
      raw,
    };
  }

  async getOrderStatusExtended(input: AlfaBankOrderStatusInput): Promise<AlfaBankOrderStatusResult> {
    this.assertConfigured();

    const orderId = optionalText(input.orderId);
    const orderNumber = optionalText(input.orderNumber);
    if (!orderId && !orderNumber) {
      throw new AlfaBankValidationError('Either orderId or orderNumber is required');
    }

    const params = this.credentialsParams();
    if (orderId) {
      params.set('orderId', orderId);
    } else if (orderNumber) {
      params.set('orderNumber', orderNumber);
    }

    const raw = await this.postForm('getOrderStatusExtended.do', params);
    const providerError = readProviderError(raw);
    if (providerError) return providerError;

    return { success: true, raw };
  }

  private assertConfigured(): void {
    if (!this.config.enabled) {
      throw new AlfaBankConfigurationError('AlfaBank payments are disabled');
    }
    if (!this.config.userName.trim() || !this.config.password.trim()) {
      throw new AlfaBankConfigurationError('AlfaBank credentials are missing');
    }
    if (!this.config.returnUrl.trim() || !this.config.failUrl.trim()) {
      throw new AlfaBankConfigurationError('AlfaBank return/fail URLs are missing');
    }
  }

  private credentialsParams(): URLSearchParams {
    return new URLSearchParams({
      userName: this.config.userName,
      password: this.config.password,
    });
  }

  private async postForm(methodName: string, params: URLSearchParams): Promise<AlfaBankRawResponse> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/${methodName}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const body = await readResponseBody(response);
    if (!response.ok) {
      return {
        errorCode: `HTTP_${response.status}`,
        errorMessage: response.statusText || 'AlfaBank HTTP error',
        httpStatus: response.status,
        body,
      };
    }
    return body;
  }
}

async function readResponseBody(response: Response): Promise<AlfaBankRawResponse> {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    const body: unknown = JSON.parse(text);
    return isUnknownRecord(body) ? body : { body };
  } catch {
    return { body: text };
  }
}

function readProviderError(raw: AlfaBankRawResponse): AlfaBankProviderError | null {
  const errorCode = readString(raw['errorCode']) ?? readString(raw['error']);
  const errorMessage = readString(raw['errorMessage']) ?? readString(raw['message']);
  if (!errorCode && !errorMessage) return null;

  return {
    success: false,
    errorCode: errorCode ?? 'ALFABANK_ERROR',
    errorMessage: errorMessage ?? 'AlfaBank payment gateway returned an error',
    raw,
  };
}

function invalidResponse(errorMessage: string, raw: AlfaBankRawResponse): AlfaBankProviderError {
  return {
    success: false,
    errorCode: 'INVALID_RESPONSE',
    errorMessage,
    raw,
  };
}

function requiredText(value: string, fieldName: string): string {
  const text = value.trim();
  if (!text) {
    throw new AlfaBankValidationError(`${fieldName} is required`);
  }
  return text;
}

function optionalText(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function appendOptional(params: URLSearchParams, key: string, value: string | undefined): void {
  const text = optionalText(value);
  if (text) {
    params.set(key, text);
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isUnknownRecord(value: unknown): value is AlfaBankRawResponse {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
