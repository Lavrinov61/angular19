import { pool } from '../database/db.js';
import type { CustomerPricingConversationIdentityRow } from '../types/views/customer-pricing-phone-views.js';
import { createLogger } from '../utils/logger.js';
import {
  getClientContextByContactId,
  getClientContextByUserId,
} from './client-context.service.js';

const log = createLogger('customer-pricing-phone');

export interface CustomerPricingPhoneSource {
  readonly phone?: string | null;
  readonly clientUserId?: string | null;
  readonly clientContactId?: string | null;
  readonly sessionId?: string | null;
}

export function isUsableCustomerPricingPhone(value: string | null | undefined): value is string {
  const phone = value?.trim();
  if (!phone) return false;
  if (phone.includes('*')) return false;
  return phone.replace(/\D/g, '').length >= 10;
}

function usablePhone(value: string | null | undefined): string | null {
  const phone = value?.trim();
  return isUsableCustomerPricingPhone(phone) ? phone : null;
}

async function resolveByUserId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const context = await getClientContextByUserId(userId);
    return usablePhone(context.profile.phone);
  } catch (error) {
    log.warn('Failed to resolve pricing phone by user id', { userId, error: String(error) });
    return null;
  }
}

async function resolveByContactId(contactId: string | null | undefined): Promise<string | null> {
  if (!contactId) return null;
  try {
    const context = await getClientContextByContactId(contactId);
    return usablePhone(context.profile.phone);
  } catch (error) {
    log.warn('Failed to resolve pricing phone by contact id', { contactId, error: String(error) });
    return null;
  }
}

async function resolveBySessionId(sessionId: string | null | undefined): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const result = await pool.query<CustomerPricingConversationIdentityRow>(
      `SELECT visitor_phone, user_id, contact_id
       FROM conversations
       WHERE id = $1
       LIMIT 1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) return null;

    return usablePhone(row.visitor_phone)
      ?? await resolveByUserId(row.user_id)
      ?? await resolveByContactId(row.contact_id);
  } catch (error) {
    log.warn('Failed to resolve pricing phone by chat session', { sessionId, error: String(error) });
    return null;
  }
}

export async function resolveCustomerPricingPhone(source: CustomerPricingPhoneSource): Promise<string | null> {
  return usablePhone(source.phone)
    ?? await resolveByUserId(source.clientUserId)
    ?? await resolveByContactId(source.clientContactId)
    ?? await resolveBySessionId(source.sessionId);
}
