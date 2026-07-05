import type { PoolClient } from 'pg';
import db from '../database/db.js';
import type { PrivacyConsentDetailsJsonb } from '../types/jsonb/privacy-consent-jsonb.js';
import type { PrivacyConsentCreatedRow } from '../types/views/privacy-consent-views.js';

interface ConsentQueryRows {
  rows: PrivacyConsentCreatedRow[];
}

type ConsentQuery = (text: string, params: unknown[]) => Promise<ConsentQueryRows>;

export interface PrivacyConsentRecordInput {
  userId?: string | null;
  visitorId?: string | null;
  documentType: string;
  documentVersion: string;
  scope: readonly string[];
  source: string;
  accepted?: boolean;
  ip?: string | null;
  userAgent?: string | string[] | null;
  details?: PrivacyConsentDetailsJsonb;
}

const INSERT_PRIVACY_CONSENT_SQL = `
  INSERT INTO privacy_consents
    (user_id, visitor_id, document_type, document_version, scope, source, accepted, ip, user_agent, details)
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, $10::jsonb)
  RETURNING id
`;

function normalizeUserAgent(userAgent: PrivacyConsentRecordInput['userAgent']): string | null {
  if (Array.isArray(userAgent)) return userAgent.join(', ');
  return typeof userAgent === 'string' && userAgent.trim() ? userAgent : null;
}

function buildPrivacyConsentParams(input: PrivacyConsentRecordInput): unknown[] {
  return [
    input.userId ?? null,
    input.visitorId ?? null,
    input.documentType,
    input.documentVersion,
    [...input.scope],
    input.source,
    input.accepted ?? true,
    input.ip ?? null,
    normalizeUserAgent(input.userAgent),
    JSON.stringify(input.details ?? {}),
  ];
}

async function insertPrivacyConsent(query: ConsentQuery, input: PrivacyConsentRecordInput): Promise<PrivacyConsentCreatedRow> {
  const result = await query(
    INSERT_PRIVACY_CONSENT_SQL,
    buildPrivacyConsentParams(input),
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Privacy consent insert returned no id');
  }
  return row;
}

export async function recordPrivacyConsent(input: PrivacyConsentRecordInput): Promise<PrivacyConsentCreatedRow> {
  return insertPrivacyConsent(async (text: string, params: unknown[]) => ({
    rows: await db.query<PrivacyConsentCreatedRow>(text, params),
  }), input);
}

export async function recordPrivacyConsentTx(client: PoolClient, input: PrivacyConsentRecordInput): Promise<PrivacyConsentCreatedRow> {
  return insertPrivacyConsent((text: string, params: unknown[]) => client.query<PrivacyConsentCreatedRow>(text, params), input);
}
