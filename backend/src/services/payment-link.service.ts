import crypto from 'crypto';
import { config } from '../config/index.js';

export interface PaymentPayload {
  orderType: 'photo_print' | 'booking' | 'custom';
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  email?: string;
  phone?: string;
  createdAt: number;
  expiresAt: number;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signToken(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function encodePaymentToken(payload: PaymentPayload, secret: string): string {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadJson);
  const signature = signToken(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export function decodePaymentToken(token: string, secret: string): PaymentPayload | null {
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;
  const expected = signToken(payloadB64, secret);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const payloadJson = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadJson) as PaymentPayload;
    // Проверяем срок действия токена
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate a CloudPayments redirect payment URL for a chat order.
 * Returns null if payment links are not configured.
 */
export function generateChatPaymentUrl(
  orderId: string,
  amount: number,
  description: string,
  baseUrl?: string,
): string | null {
  const secret = config.actions.paymentSecret;
  if (!secret) return null;

  const payload: PaymentPayload = {
    orderType: 'custom',
    orderId,
    amount,
    currency: 'RUB',
    description,
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24, // 24 hours
  };

  const token = encodePaymentToken(payload, secret);
  const base = baseUrl || 'https://svoefoto.ru';
  return `${base}/api/actions/pay/${token}`;
}
