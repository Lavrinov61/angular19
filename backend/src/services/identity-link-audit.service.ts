import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Request } from 'express';
import db from '../database/db.js';
import { getRequestId } from '../middleware/request-context.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('identity-link-audit');

export type IdentityLinkAction =
  | 'identity_link_session'
  | 'identity_link_chat'
  | 'identity_auto_link'
  | 'identity_link_skipped';

export type IdentityLinkResult = 'linked' | 'skipped' | 'blocked' | 'failed';

export interface IdentityLinkAuditMetadata {
  updatedSessionIds?: string[];
  candidateConversationIds?: string[];
  updatedConversationIds?: string[];
  linkedCount?: number;
  matchedByPhone?: boolean;
  phoneAvailable?: boolean;
  channelExternalUserId?: string | null;
}

export interface IdentityLinkAuditEvent {
  action: IdentityLinkAction;
  source: string;
  entityType: 'photo_approval_session' | 'conversation' | 'contact' | 'channel_user';
  entityId?: string | null;
  actorUserId?: string | null;
  actorUserName?: string | null;
  actorRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  approvalSessionId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  channel?: string | null;
  externalChatId?: string | null;
  visitorId?: string | null;
  previousUserId?: string | null;
  newUserId?: string | null;
  previousClientId?: string | null;
  newClientId?: string | null;
  reason?: string;
  result?: IdentityLinkResult;
  tokenHash?: string | null;
  metadata?: IdentityLinkAuditMetadata;
}

export interface IdentityLinkRequestContext {
  ip: string | null;
  userAgent: string | null;
}

interface IdentityLinkAuditDetails {
  source?: string;
  actorRole?: string | null;
  requestId?: string | null;
  approvalSessionId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  channel?: string | null;
  externalChatId?: string | null;
  visitorId?: string | null;
  previousUserId?: string | null;
  newUserId?: string | null;
  previousClientId?: string | null;
  newClientId?: string | null;
  reason?: string;
  result?: IdentityLinkResult;
  tokenHash?: string | null;
  metadata?: IdentityLinkAuditMetadata;
}

interface IdentityLinkLogPayload {
  [key: string]: unknown;
  action: IdentityLinkAction;
  source: string;
  entityType: IdentityLinkAuditEvent['entityType'];
  entityId: string | null;
  actorUserId: string | null;
  result?: IdentityLinkResult;
  requestId: string | null;
  conversationId?: string | null;
  approvalSessionId?: string | null;
  previousUserId?: string | null;
  newUserId?: string | null;
  previousClientId?: string | null;
  newClientId?: string | null;
  reason?: string;
}

function compactDetails(input: IdentityLinkAuditDetails): IdentityLinkAuditDetails {
  const output: IdentityLinkAuditDetails = {};
  if (input.source !== undefined) output.source = input.source;
  if (input.actorRole !== undefined) output.actorRole = input.actorRole;
  if (input.requestId !== undefined) output.requestId = input.requestId;
  if (input.approvalSessionId !== undefined) output.approvalSessionId = input.approvalSessionId;
  if (input.conversationId !== undefined) output.conversationId = input.conversationId;
  if (input.contactId !== undefined) output.contactId = input.contactId;
  if (input.channel !== undefined) output.channel = input.channel;
  if (input.externalChatId !== undefined) output.externalChatId = input.externalChatId;
  if (input.visitorId !== undefined) output.visitorId = input.visitorId;
  if (input.previousUserId !== undefined) output.previousUserId = input.previousUserId;
  if (input.newUserId !== undefined) output.newUserId = input.newUserId;
  if (input.previousClientId !== undefined) output.previousClientId = input.previousClientId;
  if (input.newClientId !== undefined) output.newClientId = input.newClientId;
  if (input.reason !== undefined) output.reason = input.reason;
  if (input.result !== undefined) output.result = input.result;
  if (input.tokenHash !== undefined) output.tokenHash = input.tokenHash;
  if (input.metadata !== undefined) output.metadata = input.metadata;
  return output;
}

function compactLogPayload(input: IdentityLinkLogPayload): IdentityLinkLogPayload {
  const output: IdentityLinkLogPayload = {
    action: input.action,
    source: input.source,
    entityType: input.entityType,
    entityId: input.entityId,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  };
  if (input.result !== undefined) output.result = input.result;
  if (input.conversationId !== undefined) output.conversationId = input.conversationId;
  if (input.approvalSessionId !== undefined) output.approvalSessionId = input.approvalSessionId;
  if (input.previousUserId !== undefined) output.previousUserId = input.previousUserId;
  if (input.newUserId !== undefined) output.newUserId = input.newUserId;
  if (input.previousClientId !== undefined) output.previousClientId = input.previousClientId;
  if (input.newClientId !== undefined) output.newClientId = input.newClientId;
  if (input.reason !== undefined) output.reason = input.reason;
  return output;
}

function normalizeHeader(value: IncomingHttpHeaders[string]): string | null {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return value ?? null;
}

export function getIdentityLinkRequestContext(req: Request): IdentityLinkRequestContext {
  return {
    ip: req.ip ?? null,
    userAgent: normalizeHeader(req.headers['user-agent']),
  };
}

export function hashPublicToken(token: string | null | undefined): string | null {
  if (!token) {
    return null;
  }
  const digest = createHash('sha256').update(token).digest('hex');
  return `sha256:${digest.slice(0, 24)}`;
}

export async function logIdentityLinkEvent(event: IdentityLinkAuditEvent): Promise<void> {
  const requestId = getRequestId() ?? null;
  const details = compactDetails({
    source: event.source,
    actorRole: event.actorRole,
    requestId,
    approvalSessionId: event.approvalSessionId,
    conversationId: event.conversationId,
    contactId: event.contactId,
    channel: event.channel,
    externalChatId: event.externalChatId,
    visitorId: event.visitorId,
    previousUserId: event.previousUserId,
    newUserId: event.newUserId,
    previousClientId: event.previousClientId,
    newClientId: event.newClientId,
    reason: event.reason,
    result: event.result,
    tokenHash: event.tokenHash,
    metadata: event.metadata,
  });

  const params: unknown[] = [
    event.actorUserId ?? null,
    event.actorUserName ?? null,
    event.action,
    event.entityType,
    event.entityId ?? null,
    JSON.stringify(details),
    event.ip ?? null,
    event.userAgent ?? null,
  ];

  try {
    await db.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, details, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      params,
    );

    logger.info('identity link audit event', compactLogPayload({
      action: event.action,
      source: event.source,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      actorUserId: event.actorUserId ?? null,
      result: event.result,
      requestId,
      conversationId: event.conversationId,
      approvalSessionId: event.approvalSessionId,
      previousUserId: event.previousUserId,
      newUserId: event.newUserId,
      previousClientId: event.previousClientId,
      newClientId: event.newClientId,
      reason: event.reason,
    }));
  } catch (err) {
    logger.error('failed to write identity link audit event', {
      error: String(err),
      action: event.action,
      source: event.source,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      requestId,
    });
  }
}
