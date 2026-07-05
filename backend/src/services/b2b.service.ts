import { createHash, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { createLogger } from '../utils/logger.js';
import type {
  AdminUpdateB2BOrganizationInput,
  B2BListQueryInput,
  CreateB2BInvoiceInput,
  CreateB2BMemberInput,
  CreateB2BOrganizationInput,
  ResolveB2BReconciliationTaskInput,
  ResolveB2BVerificationTaskInput,
  UpdateB2BMemberInput,
  UpdateB2BOrganizationInput,
} from '../schemas/b2b.schema.js';
import type {
  B2BBalanceLedgerRow,
  B2BBalanceSummary,
  B2BBankIdentityProviderDescriptor,
  B2BBankIdentityStartResult,
  B2BBankTransactionRow,
  B2BCountRow,
  B2BDocumentFileRow,
  B2BDocumentPackageDetailsRow,
  B2BDocumentPackageRow,
  B2BInvoiceDetailsRow,
  B2BInvoiceLineRow,
  B2BInvoiceRow,
  B2BListResult,
  B2BMembershipAccessRow,
  B2BMutationIdRow,
  B2BNextSequenceRow,
  B2BOrganizationMemberRow,
  B2BOrganizationRow,
  B2BOrganizationSummaryRow,
  B2BOrganizationVerificationRow,
  B2BPrintJobUsageRow,
  B2BReconciliationTaskRow,
  B2BVerificationProviderCode,
} from '../types/views/b2b-views.js';

const logger = createLogger('b2b.service');

const PROVIDER_CODES: readonly B2BVerificationProviderCode[] = [
  'sber_business_id',
  'alfa_business_id',
  'tbank_business_id',
];

interface BankIdentityProviderConfig {
  code: B2BVerificationProviderCode;
  title: string;
  authUrlEnv: string;
  clientIdEnv: string;
  redirectUriEnv: string;
  scope: readonly string[];
}

const BANK_IDENTITY_PROVIDERS: readonly BankIdentityProviderConfig[] = [
  {
    code: 'sber_business_id',
    title: 'СберБизнес ID',
    authUrlEnv: 'B2B_SBER_BUSINESS_ID_AUTH_URL',
    clientIdEnv: 'B2B_SBER_BUSINESS_ID_CLIENT_ID',
    redirectUriEnv: 'B2B_SBER_BUSINESS_ID_REDIRECT_URI',
    scope: ['openid', 'profile', 'organization'],
  },
  {
    code: 'alfa_business_id',
    title: 'Альфа-Бизнес ID',
    authUrlEnv: 'B2B_ALFA_BUSINESS_ID_AUTH_URL',
    clientIdEnv: 'B2B_ALFA_BUSINESS_ID_CLIENT_ID',
    redirectUriEnv: 'B2B_ALFA_BUSINESS_ID_REDIRECT_URI',
    scope: ['openid', 'profile', 'organization'],
  },
  {
    code: 'tbank_business_id',
    title: 'T-Бизнес ID',
    authUrlEnv: 'B2B_TBANK_BUSINESS_ID_AUTH_URL',
    clientIdEnv: 'B2B_TBANK_BUSINESS_ID_CLIENT_ID',
    redirectUriEnv: 'B2B_TBANK_BUSINESS_ID_REDIRECT_URI',
    scope: ['openid', 'profile', 'organization'],
  },
];

interface UnknownRecord {
  [key: string]: unknown;
}

const ORGANIZATION_COLUMNS = `
  o.id,
  o.status,
  o.verification_status,
  o.inn,
  o.kpp,
  o.ogrn,
  o.legal_name,
  o.short_name,
  o.legal_address,
  o.postal_address,
  o.accountant_email,
  o.accountant_phone,
  o.edo_provider,
  o.edo_operator_id,
  o.tax_system,
  o.vat_rate::float8 AS vat_rate,
  o.metadata,
  o.created_by,
  o.created_at,
  o.updated_at
`;

const INVOICE_COLUMNS = `
  id,
  organization_id,
  billing_account_id,
  invoice_number,
  status,
  payment_purpose,
  amount::float8 AS amount,
  paid_amount::float8 AS paid_amount,
  currency,
  issued_at,
  due_at,
  paid_at,
  period_start,
  period_end,
  created_by,
  metadata,
  created_at,
  updated_at
`;

const INVOICE_LINE_COLUMNS = `
  id,
  invoice_id,
  line_number,
  description,
  quantity::float8 AS quantity,
  unit_price::float8 AS unit_price,
  amount::float8 AS amount,
  vat_rate::float8 AS vat_rate,
  metadata,
  created_at
`;

const DOCUMENT_COLUMNS = `
  id,
  organization_id,
  service_period_id,
  invoice_id,
  document_type,
  package_number,
  version,
  status,
  total_amount::float8 AS total_amount,
  currency,
  generated_at,
  sent_at,
  signed_at,
  metadata,
  created_at,
  updated_at
`;

function isProviderCode(value: string): value is B2BVerificationProviderCode {
  return PROVIDER_CODES.includes(value as B2BVerificationProviderCode);
}

export function parseBankIdentityProviderCode(value: string): B2BVerificationProviderCode {
  if (isProviderCode(value)) return value;
  throw new AppError(400, 'Неизвестный провайдер банковского ID', ErrorCode.VALIDATION_ERROR);
}

function getEnv(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function describeProvider(config: BankIdentityProviderConfig): B2BBankIdentityProviderDescriptor {
  const requiredEnv = [config.authUrlEnv, config.clientIdEnv, config.redirectUriEnv];
  const isConfigured = requiredEnv.every(name => getEnv(name) !== null);
  return {
    code: config.code,
    title: config.title,
    status: isConfigured ? 'configured' : 'planned',
    is_configured: isConfigured,
    required_env: requiredEnv,
  };
}

function getProviderConfig(code: B2BVerificationProviderCode): BankIdentityProviderConfig {
  const config = BANK_IDENTITY_PROVIDERS.find(provider => provider.code === code);
  if (!config) {
    throw new AppError(400, 'Неизвестный провайдер банковского ID', ErrorCode.VALIDATION_ERROR);
  }
  return config;
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getRecordValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as UnknownRecord)[key];
}

function getPgCode(error: unknown): string | null {
  const code = getRecordValue(error, 'code');
  return typeof code === 'string' ? code : null;
}

async function queryMany<T>(
  client: PoolClient | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (client) {
    const result = await client.query(sql, params);
    return result.rows as T[];
  }
  return db.query<T>(sql, params);
}

async function queryOne<T>(
  client: PoolClient | null,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await queryMany<T>(client, sql, params);
  return rows[0] ?? null;
}

async function writeAudit(
  client: PoolClient,
  organizationId: string | null,
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  afterSnapshot: unknown,
): Promise<void> {
  const params: unknown[] = [
    organizationId,
    actorUserId,
    action,
    entityType,
    entityId,
    afterSnapshot,
  ];
  await client.query(
    `INSERT INTO b2b_audit_log
       (organization_id, actor_user_id, action, entity_type, entity_id, after_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    params,
  );
}

async function getCurrentAccess(
  userId: string,
  allowedRoles?: readonly string[],
): Promise<B2BMembershipAccessRow> {
  const access = await db.queryOne<B2BMembershipAccessRow>(
    `SELECT
       o.id AS organization_id,
       m.id AS member_id,
       m.role,
       o.status AS organization_status,
       ba.id AS billing_account_id,
       ba.status AS billing_status,
       ba.payment_mode,
       ba.credit_limit::float8 AS credit_limit
     FROM b2b_organization_members m
     JOIN b2b_organizations o ON o.id = m.organization_id
     JOIN b2b_billing_accounts ba ON ba.organization_id = o.id
     WHERE m.user_id = $1
       AND m.status = 'active'
       AND o.status <> 'closed'
     ORDER BY
       CASE m.role
         WHEN 'owner' THEN 0
         WHEN 'accountant' THEN 1
         WHEN 'manager' THEN 2
         ELSE 3
       END,
       o.created_at DESC
     LIMIT 1`,
    [userId],
  );

  if (!access) {
    throw new AppError(404, 'B2B-организация не найдена', ErrorCode.NOT_FOUND);
  }

  if (allowedRoles && !allowedRoles.includes(access.role)) {
    throw new AppError(403, 'Недостаточно прав в B2B-организации', ErrorCode.FORBIDDEN);
  }

  return access;
}

async function getOrganizationSummaryForUser(
  userId: string,
  organizationId: string | null,
  client: PoolClient | null = null,
): Promise<B2BOrganizationSummaryRow | null> {
  const params: unknown[] = [userId];
  const organizationFilter = organizationId ? 'AND o.id = $2' : '';
  if (organizationId) params.push(organizationId);

  return queryOne<B2BOrganizationSummaryRow>(
    client,
    `SELECT
       ${ORGANIZATION_COLUMNS},
       m.id AS member_id,
       m.role AS member_role,
       ba.id AS billing_account_id,
       ba.status AS billing_status,
       ba.payment_mode,
       ba.credit_limit::float8 AS credit_limit,
       COALESCE(balance.value, 0)::float8 AS balance
     FROM b2b_organization_members m
     JOIN b2b_organizations o ON o.id = m.organization_id
     JOIN b2b_billing_accounts ba ON ba.organization_id = o.id
     LEFT JOIN LATERAL (
       SELECT SUM(
         CASE ledger.direction
           WHEN 'credit' THEN ledger.amount
           ELSE -ledger.amount
         END
       ) AS value
       FROM b2b_balance_ledger ledger
       WHERE ledger.billing_account_id = ba.id
     ) balance ON true
     WHERE m.user_id = $1
       AND m.status = 'active'
       AND o.status <> 'closed'
       ${organizationFilter}
     ORDER BY
       CASE m.role
         WHEN 'owner' THEN 0
         WHEN 'accountant' THEN 1
         WHEN 'manager' THEN 2
         ELSE 3
       END,
       o.created_at DESC
     LIMIT 1`,
    params,
  );
}

async function getAdminOrganizationById(id: string): Promise<{
  organization: B2BOrganizationRow;
  billing: B2BBalanceSummary;
  members: B2BOrganizationMemberRow[];
}> {
  const organization = await db.queryOne<B2BOrganizationRow>(
    `SELECT ${ORGANIZATION_COLUMNS}
     FROM b2b_organizations o
     WHERE o.id = $1`,
    [id],
  );
  if (!organization) throw new AppError(404, 'B2B-организация не найдена', ErrorCode.NOT_FOUND);

  const [billing, members] = await Promise.all([
    getBalanceForOrganization(id),
    listMembersForOrganization(id),
  ]);

  return { organization, billing, members };
}

async function listMembersForOrganization(organizationId: string): Promise<B2BOrganizationMemberRow[]> {
  return db.query<B2BOrganizationMemberRow>(
    `SELECT
       m.id,
       m.organization_id,
       m.user_id,
       m.cost_center_id,
       m.role,
       m.status,
       m.invited_email,
       m.invited_at,
       m.joined_at,
       m.disabled_at,
       m.metadata,
       m.created_at,
       m.updated_at,
       u.email AS user_email,
       u.display_name AS user_display_name
     FROM b2b_organization_members m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = $1
     ORDER BY
       CASE m.role
         WHEN 'owner' THEN 0
         WHEN 'accountant' THEN 1
         WHEN 'manager' THEN 2
         ELSE 3
       END,
       m.created_at DESC`,
    [organizationId],
  );
}

async function getBalanceForOrganization(organizationId: string): Promise<B2BBalanceSummary> {
  const balance = await db.queryOne<B2BBalanceSummary>(
    `SELECT
       ba.organization_id,
       ba.id AS billing_account_id,
       ba.currency,
       COALESCE(ledger.balance, 0)::float8 AS balance,
       ba.credit_limit::float8 AS credit_limit,
       (COALESCE(ledger.balance, 0) + ba.credit_limit)::float8 AS available,
       ledger.last_entry_at
     FROM b2b_billing_accounts ba
     LEFT JOIN LATERAL (
       SELECT
         SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END) AS balance,
         MAX(created_at) AS last_entry_at
       FROM b2b_balance_ledger
       WHERE billing_account_id = ba.id
     ) ledger ON true
     WHERE ba.organization_id = $1`,
    [organizationId],
  );
  if (!balance) throw new AppError(404, 'B2B billing account не найден', ErrorCode.NOT_FOUND);
  return balance;
}

export async function getMyB2BOrganization(userId: string): Promise<B2BOrganizationSummaryRow | null> {
  return getOrganizationSummaryForUser(userId, null);
}

export async function createB2BOrganization(
  userId: string,
  input: CreateB2BOrganizationInput,
): Promise<B2BOrganizationSummaryRow> {
  try {
    return await db.transaction(async (client) => {
      const organization = await queryOne<B2BOrganizationRow>(
        client,
        `INSERT INTO b2b_organizations
           (inn, kpp, ogrn, legal_name, short_name, legal_address, postal_address,
            accountant_email, accountant_phone, edo_provider, edo_operator_id,
            tax_system, vat_rate, metadata, created_by)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
         RETURNING ${ORGANIZATION_COLUMNS.replaceAll('o.', '')}`,
        [
          input.inn,
          input.kpp ?? null,
          input.ogrn ?? null,
          input.legal_name,
          input.short_name ?? null,
          input.legal_address ?? null,
          input.postal_address ?? null,
          input.accountant_email ?? null,
          input.accountant_phone ?? null,
          input.edo_provider ?? null,
          input.edo_operator_id ?? null,
          input.tax_system ?? null,
          input.vat_rate,
          input.metadata,
          userId,
        ],
      );
      if (!organization) throw new AppError(500, 'Не удалось создать B2B-организацию', ErrorCode.INTERNAL_ERROR);

      await client.query(
        `INSERT INTO b2b_organization_members
           (organization_id, user_id, role, status, joined_at)
         VALUES ($1, $2, 'owner', 'active', now())`,
        [organization.id, userId],
      );

      await client.query(
        `INSERT INTO b2b_contracts
           (organization_id, status, payment_terms, credit_limit, vat_rate, edo_required, offer_accepted_at, starts_at)
         VALUES ($1, 'active', $2, $3, $4, true, now(), CURRENT_DATE)`,
        [organization.id, input.payment_mode, input.credit_limit, input.vat_rate],
      );

      await client.query(
        `INSERT INTO b2b_billing_accounts
           (organization_id, status, payment_mode, credit_limit)
         VALUES ($1, 'active', $2, $3)`,
        [organization.id, input.payment_mode, input.credit_limit],
      );

      await writeAudit(client, organization.id, userId, 'organization.create', 'b2b_organization', organization.id, organization);

      const summary = await getOrganizationSummaryForUser(userId, organization.id, client);
      if (!summary) throw new AppError(500, 'Не удалось прочитать созданную B2B-организацию', ErrorCode.INTERNAL_ERROR);
      return summary;
    });
  } catch (error) {
    if (getPgCode(error) === '23505') {
      throw new AppError(409, 'B2B-организация с таким ИНН/КПП уже существует', ErrorCode.VALIDATION_ERROR);
    }
    throw error;
  }
}

export async function updateMyB2BOrganization(
  userId: string,
  input: UpdateB2BOrganizationInput,
): Promise<B2BOrganizationSummaryRow> {
  const access = await getCurrentAccess(userId, ['owner', 'accountant']);

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const pushField = (column: string, value: unknown): void => {
    if (value === undefined) return;
    sets.push(`${column} = $${idx++}`);
    params.push(value);
  };

  pushField('legal_name', input.legal_name);
  pushField('short_name', input.short_name);
  pushField('legal_address', input.legal_address);
  pushField('postal_address', input.postal_address);
  pushField('accountant_email', input.accountant_email);
  pushField('accountant_phone', input.accountant_phone);
  pushField('edo_provider', input.edo_provider);
  pushField('edo_operator_id', input.edo_operator_id);
  pushField('tax_system', input.tax_system);
  pushField('vat_rate', input.vat_rate);
  if (input.metadata !== undefined) {
    sets.push(`metadata = $${idx++}::jsonb`);
    params.push(input.metadata);
  }

  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления', ErrorCode.VALIDATION_ERROR);

  params.push(access.organization_id);
  await db.query<B2BMutationIdRow>(
    `UPDATE b2b_organizations
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING id`,
    params,
  );

  const summary = await getOrganizationSummaryForUser(userId, access.organization_id);
  if (!summary) throw new AppError(404, 'B2B-организация не найдена', ErrorCode.NOT_FOUND);
  return summary;
}

export async function getB2BVerificationStatus(userId: string): Promise<{
  organization: B2BOrganizationSummaryRow;
  attempts: B2BOrganizationVerificationRow[];
}> {
  const organization = await getOrganizationSummaryForUser(userId, null);
  if (!organization) throw new AppError(404, 'B2B-организация не найдена', ErrorCode.NOT_FOUND);

  const attempts = await db.query<B2BOrganizationVerificationRow>(
    `SELECT *
     FROM b2b_organization_verifications
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [organization.id],
  );

  return { organization, attempts };
}

export function getBankIdentityProviders(): B2BBankIdentityProviderDescriptor[] {
  return BANK_IDENTITY_PROVIDERS.map(describeProvider);
}

export async function startBankIdentityVerification(
  userId: string,
  providerCode: B2BVerificationProviderCode,
): Promise<B2BBankIdentityStartResult> {
  const config = getProviderConfig(providerCode);
  const provider = describeProvider(config);
  if (!provider.is_configured) {
    throw new AppError(501, 'Провайдер банковского ID еще не настроен', 'B2B_BANK_IDENTITY_PROVIDER_NOT_CONFIGURED');
  }

  const authUrl = getEnv(config.authUrlEnv);
  const clientId = getEnv(config.clientIdEnv);
  const redirectUri = getEnv(config.redirectUriEnv);
  if (!authUrl || !clientId || !redirectUri) {
    throw new AppError(501, 'Провайдер банковского ID еще не настроен', 'B2B_BANK_IDENTITY_PROVIDER_NOT_CONFIGURED');
  }

  const access = await getCurrentAccess(userId, ['owner', 'accountant', 'manager']);
  const state = randomToken();
  const nonce = randomToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const requestedScope = [...config.scope];

  const verification = await db.queryOne<B2BOrganizationVerificationRow>(
    `INSERT INTO b2b_organization_verifications
       (organization_id, provider_type, provider_code, status, state_hash, nonce_hash,
        requested_scope, started_by, expires_at)
     VALUES
       ($1, 'bank_identity', $2, 'redirected', $3, $4, $5::text[], $6, $7)
     RETURNING *`,
    [
      access.organization_id,
      providerCode,
      hashSecret(state),
      hashSecret(nonce),
      requestedScope,
      userId,
      expiresAt,
    ],
  );
  if (!verification) throw new AppError(500, 'Не удалось начать банковскую верификацию', ErrorCode.INTERNAL_ERROR);

  const url = new URL(authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', requestedScope.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);

  logger.info('Started B2B bank identity verification', {
    organizationId: access.organization_id,
    verificationId: verification.id,
    providerCode,
  });

  return {
    provider,
    verification,
    authorization_url: url.toString(),
    expires_at: expiresAt.toISOString(),
  };
}

export async function failBankIdentityCallback(
  providerCode: B2BVerificationProviderCode,
  state: string,
  errorCode: string | null,
  errorMessage: string | null,
): Promise<B2BOrganizationVerificationRow> {
  const verification = await db.queryOne<B2BOrganizationVerificationRow>(
    `UPDATE b2b_organization_verifications
     SET status = 'failed',
         error_code = $1,
         error_message = $2
     WHERE provider_type = 'bank_identity'
       AND provider_code = $3
       AND state_hash = $4
       AND status IN ('pending', 'redirected', 'authorized')
     RETURNING *`,
    [
      errorCode ?? 'B2B_BANK_IDENTITY_CONNECTOR_NOT_IMPLEMENTED',
      errorMessage ?? 'Обмен code на данные организации еще не подключен',
      providerCode,
      hashSecret(state),
    ],
  );

  if (!verification) {
    throw new AppError(404, 'Заявка банковской верификации не найдена или уже завершена', ErrorCode.NOT_FOUND);
  }

  throw new AppError(501, 'Обработчик callback банковского ID требует подключения провайдера', 'B2B_BANK_IDENTITY_CALLBACK_NOT_CONFIGURED');
}

export async function listB2BMembers(userId: string): Promise<B2BOrganizationMemberRow[]> {
  const access = await getCurrentAccess(userId, ['owner', 'accountant', 'manager']);
  return listMembersForOrganization(access.organization_id);
}

export async function createB2BMember(
  userId: string,
  input: CreateB2BMemberInput,
): Promise<B2BOrganizationMemberRow> {
  const access = await getCurrentAccess(userId, ['owner', 'accountant', 'manager']);
  try {
    const member = await db.queryOne<B2BOrganizationMemberRow>(
      `INSERT INTO b2b_organization_members
         (organization_id, user_id, invited_email, role, status, cost_center_id, invited_at, joined_at, metadata)
       VALUES
         ($1, $2, $3, $4, $5, $6, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END,
          CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END, $7::jsonb)
       RETURNING
         id,
         organization_id,
         user_id,
         cost_center_id,
         role,
         status,
         invited_email,
         invited_at,
         joined_at,
         disabled_at,
         metadata,
         created_at,
         updated_at,
         NULL::text AS user_email,
         NULL::text AS user_display_name`,
      [
        access.organization_id,
        input.user_id ?? null,
        input.invited_email ?? null,
        input.role,
        input.user_id ? 'active' : 'invited',
        input.cost_center_id ?? null,
        input.metadata,
      ],
    );
    if (!member) throw new AppError(500, 'Не удалось добавить участника', ErrorCode.INTERNAL_ERROR);
    return member;
  } catch (error) {
    if (getPgCode(error) === '23505') {
      throw new AppError(409, 'Участник или приглашение уже есть в этой организации', ErrorCode.VALIDATION_ERROR);
    }
    throw error;
  }
}

export async function updateB2BMember(
  userId: string,
  memberId: string,
  input: UpdateB2BMemberInput,
): Promise<B2BOrganizationMemberRow> {
  const access = await getCurrentAccess(userId, ['owner', 'accountant', 'manager']);
  if (input.role === 'owner' && access.role !== 'owner') {
    throw new AppError(403, 'Назначать владельца может только владелец организации', ErrorCode.FORBIDDEN);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.role !== undefined) {
    sets.push(`role = $${idx++}`);
    params.push(input.role);
  }
  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(input.status);
    if (input.status === 'disabled') {
      sets.push('disabled_at = now()');
    }
  }
  if (input.cost_center_id !== undefined) {
    sets.push(`cost_center_id = $${idx++}`);
    params.push(input.cost_center_id);
  }
  if (input.metadata !== undefined) {
    sets.push(`metadata = $${idx++}::jsonb`);
    params.push(input.metadata);
  }

  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления', ErrorCode.VALIDATION_ERROR);

  params.push(access.organization_id, memberId, access.role);
  const member = await db.queryOne<B2BOrganizationMemberRow>(
    `UPDATE b2b_organization_members m
     SET ${sets.join(', ')}
     WHERE m.organization_id = $${idx++}
       AND m.id = $${idx}
       AND (m.role <> 'owner' OR $${idx + 1} = 'owner')
     RETURNING
       m.id,
       m.organization_id,
       m.user_id,
       m.cost_center_id,
       m.role,
       m.status,
       m.invited_email,
       m.invited_at,
       m.joined_at,
       m.disabled_at,
       m.metadata,
       m.created_at,
       m.updated_at,
       NULL::text AS user_email,
       NULL::text AS user_display_name`,
    params,
  );

  if (!member) throw new AppError(404, 'Участник не найден или защищен от изменения', ErrorCode.NOT_FOUND);
  return member;
}

export async function listB2BInvoices(
  userId: string,
  query: B2BListQueryInput,
): Promise<B2BListResult<B2BInvoiceRow>> {
  const access = await getCurrentAccess(userId);
  const params: unknown[] = [access.organization_id];
  const filters = ['organization_id = $1'];
  let idx = 2;

  if (query.status) {
    filters.push(`status = $${idx++}`);
    params.push(query.status);
  }

  const where = filters.join(' AND ');
  const [rows, count] = await Promise.all([
    db.query<B2BInvoiceRow>(
      `SELECT ${INVOICE_COLUMNS}
       FROM b2b_invoices
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, query.limit, query.offset],
    ),
    db.queryOne<B2BCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM b2b_invoices
       WHERE ${where}`,
      params,
    ),
  ]);

  return { rows, total: count?.total ?? 0 };
}

export async function getB2BInvoice(userId: string, invoiceId: string): Promise<B2BInvoiceDetailsRow> {
  const access = await getCurrentAccess(userId);
  const invoice = await db.queryOne<B2BInvoiceRow>(
    `SELECT ${INVOICE_COLUMNS}
     FROM b2b_invoices
     WHERE organization_id = $1 AND id = $2`,
    [access.organization_id, invoiceId],
  );
  if (!invoice) throw new AppError(404, 'Счет не найден', ErrorCode.NOT_FOUND);

  const lines = await db.query<B2BInvoiceLineRow>(
    `SELECT ${INVOICE_LINE_COLUMNS}
     FROM b2b_invoice_lines
     WHERE invoice_id = $1
     ORDER BY line_number`,
    [invoiceId],
  );

  return { ...invoice, lines };
}

export async function createB2BInvoice(
  userId: string,
  input: CreateB2BInvoiceInput,
): Promise<B2BInvoiceDetailsRow> {
  const access = await getCurrentAccess(userId, ['owner', 'accountant', 'manager']);
  const amount = roundMoney(input.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0));
  const now = new Date();
  const dueAt = input.due_at ? new Date(input.due_at) : new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  return db.transaction(async (client) => {
    const seq = await queryOne<B2BNextSequenceRow>(
      client,
      `SELECT nextval('public.b2b_invoice_number_seq')::text AS value`,
    );
    if (!seq) throw new AppError(500, 'Не удалось получить номер счета', ErrorCode.INTERNAL_ERROR);

    const invoiceNumber = `B2B-${now.getUTCFullYear()}-${seq.value.padStart(6, '0')}`;
    const paymentPurpose = input.payment_purpose ?? `Оплата счета №${invoiceNumber} за услуги печати`;

    const invoice = await queryOne<B2BInvoiceRow>(
      client,
      `INSERT INTO b2b_invoices
         (organization_id, billing_account_id, invoice_number, status, payment_purpose,
          amount, issued_at, due_at, period_start, period_end, created_by, metadata)
       VALUES
         ($1, $2, $3, 'issued', $4, $5, now(), $6, $7, $8, $9, $10::jsonb)
       RETURNING ${INVOICE_COLUMNS}`,
      [
        access.organization_id,
        access.billing_account_id,
        invoiceNumber,
        paymentPurpose,
        amount,
        dueAt,
        input.period_start ?? null,
        input.period_end ?? null,
        userId,
        input.metadata,
      ],
    );
    if (!invoice) throw new AppError(500, 'Не удалось создать счет', ErrorCode.INTERNAL_ERROR);

    const lines: B2BInvoiceLineRow[] = [];
    for (let lineIndex = 0; lineIndex < input.lines.length; lineIndex += 1) {
      const line = input.lines[lineIndex];
      const lineAmount = roundMoney(line.quantity * line.unit_price);
      const insertedLine = await queryOne<B2BInvoiceLineRow>(
        client,
        `INSERT INTO b2b_invoice_lines
           (invoice_id, line_number, description, quantity, unit_price, amount, vat_rate, metadata)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING ${INVOICE_LINE_COLUMNS}`,
        [
          invoice.id,
          lineIndex + 1,
          line.description,
          line.quantity,
          line.unit_price,
          lineAmount,
          line.vat_rate,
          line.metadata,
        ],
      );
      if (!insertedLine) throw new AppError(500, 'Не удалось создать строку счета', ErrorCode.INTERNAL_ERROR);
      lines.push(insertedLine);
    }

    await queryOne<B2BDocumentPackageRow>(
      client,
      `INSERT INTO b2b_document_packages
         (organization_id, invoice_id, document_type, package_number, status, total_amount)
       VALUES
         ($1, $2, 'invoice', $3, 'draft', $4)
       RETURNING ${DOCUMENT_COLUMNS}`,
      [access.organization_id, invoice.id, invoiceNumber, amount],
    );

    await writeAudit(client, access.organization_id, userId, 'invoice.create', 'b2b_invoice', invoice.id, invoice);
    return { ...invoice, lines };
  });
}

export async function listB2BDocuments(
  userId: string,
  query: B2BListQueryInput,
): Promise<B2BListResult<B2BDocumentPackageRow>> {
  const access = await getCurrentAccess(userId);
  const params: unknown[] = [access.organization_id];
  const filters = ['organization_id = $1'];
  let idx = 2;

  if (query.status) {
    filters.push(`status = $${idx++}`);
    params.push(query.status);
  }

  const where = filters.join(' AND ');
  const [rows, count] = await Promise.all([
    db.query<B2BDocumentPackageRow>(
      `SELECT ${DOCUMENT_COLUMNS}
       FROM b2b_document_packages
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, query.limit, query.offset],
    ),
    db.queryOne<B2BCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM b2b_document_packages
       WHERE ${where}`,
      params,
    ),
  ]);

  return { rows, total: count?.total ?? 0 };
}

export async function getB2BDocument(userId: string, documentId: string): Promise<B2BDocumentPackageDetailsRow> {
  const access = await getCurrentAccess(userId);
  const document = await db.queryOne<B2BDocumentPackageRow>(
    `SELECT ${DOCUMENT_COLUMNS}
     FROM b2b_document_packages
     WHERE organization_id = $1 AND id = $2`,
    [access.organization_id, documentId],
  );
  if (!document) throw new AppError(404, 'Пакет документов не найден', ErrorCode.NOT_FOUND);

  const files = await db.query<B2BDocumentFileRow>(
    `SELECT
       id,
       document_package_id,
       file_kind,
       storage_key,
       content_type,
       size_bytes::int AS size_bytes,
       sha256_hash,
       version,
       created_at
     FROM b2b_document_files
     WHERE document_package_id = $1
     ORDER BY version DESC, file_kind`,
    [documentId],
  );

  return { ...document, files };
}

export async function getB2BBalance(userId: string): Promise<{
  summary: B2BBalanceSummary;
  recent_entries: B2BBalanceLedgerRow[];
}> {
  const access = await getCurrentAccess(userId);
  const [summary, recentEntries] = await Promise.all([
    getBalanceForOrganization(access.organization_id),
    db.query<B2BBalanceLedgerRow>(
      `SELECT
         id,
         organization_id,
         billing_account_id,
         entry_type,
         direction,
         amount::float8 AS amount,
         currency,
         invoice_id,
         bank_transaction_id,
         print_job_usage_id,
         source_type,
         source_id,
         idempotency_key,
         description,
         created_by,
         metadata,
         created_at
       FROM b2b_balance_ledger
       WHERE billing_account_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [access.billing_account_id],
    ),
  ]);

  return { summary, recent_entries: recentEntries };
}

export async function listB2BUsage(
  userId: string,
  query: B2BListQueryInput,
): Promise<B2BListResult<B2BPrintJobUsageRow>> {
  const access = await getCurrentAccess(userId);
  const [rows, count] = await Promise.all([
    db.query<B2BPrintJobUsageRow>(
      `SELECT
         id,
         organization_id,
         billing_account_id,
         service_period_id,
         print_job_id,
         user_id,
         member_id,
         cost_center_id,
         printer_id,
         occurred_at,
         service_slug,
         pages,
         copies,
         color_mode,
         paper_size,
         duplex,
         unit_price::float8 AS unit_price,
         amount::float8 AS amount,
         vat_rate::float8 AS vat_rate,
         currency,
         status,
         tariff_snapshot,
         metadata,
         created_at,
         updated_at
       FROM b2b_print_job_usages
       WHERE organization_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2 OFFSET $3`,
      [access.organization_id, query.limit, query.offset],
    ),
    db.queryOne<B2BCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM b2b_print_job_usages
       WHERE organization_id = $1`,
      [access.organization_id],
    ),
  ]);
  return { rows, total: count?.total ?? 0 };
}

export async function adminListB2BOrganizations(query: B2BListQueryInput): Promise<B2BListResult<B2BOrganizationRow>> {
  const params: unknown[] = [];
  const filters: string[] = [];
  let idx = 1;

  if (query.status) {
    filters.push(`o.status = $${idx++}`);
    params.push(query.status);
  }
  if (query.search) {
    filters.push(`(o.legal_name ILIKE $${idx} OR o.inn ILIKE $${idx})`);
    params.push(`%${query.search}%`);
    idx += 1;
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    db.query<B2BOrganizationRow>(
      `SELECT ${ORGANIZATION_COLUMNS}
       FROM b2b_organizations o
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, query.limit, query.offset],
    ),
    db.queryOne<B2BCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM b2b_organizations o
       ${where}`,
      params,
    ),
  ]);

  return { rows, total: count?.total ?? 0 };
}

export async function adminGetB2BOrganization(id: string): Promise<{
  organization: B2BOrganizationRow;
  billing: B2BBalanceSummary;
  members: B2BOrganizationMemberRow[];
}> {
  return getAdminOrganizationById(id);
}

export async function adminUpdateB2BOrganization(
  adminUserId: string,
  organizationId: string,
  input: AdminUpdateB2BOrganizationInput,
): Promise<{
  organization: B2BOrganizationRow;
  billing: B2BBalanceSummary;
  members: B2BOrganizationMemberRow[];
}> {
  await db.transaction(async (client) => {
    const orgSets: string[] = [];
    const orgParams: unknown[] = [];
    let orgIdx = 1;

    if (input.status !== undefined) {
      orgSets.push(`status = $${orgIdx++}`);
      orgParams.push(input.status);
    }
    if (input.verification_status !== undefined) {
      orgSets.push(`verification_status = $${orgIdx++}`);
      orgParams.push(input.verification_status);
    }
    if (input.metadata !== undefined) {
      orgSets.push(`metadata = metadata || $${orgIdx++}::jsonb`);
      orgParams.push(input.metadata);
    }

    if (orgSets.length > 0) {
      orgParams.push(organizationId);
      await client.query(
        `UPDATE b2b_organizations
         SET ${orgSets.join(', ')}
         WHERE id = $${orgIdx}`,
        orgParams,
      );
    }

    const billingSets: string[] = [];
    const billingParams: unknown[] = [];
    let billingIdx = 1;

    if (input.payment_mode !== undefined) {
      billingSets.push(`payment_mode = $${billingIdx++}`);
      billingParams.push(input.payment_mode);
    }
    if (input.billing_status !== undefined) {
      billingSets.push(`status = $${billingIdx++}`);
      billingParams.push(input.billing_status);
    }
    if (input.credit_limit !== undefined) {
      billingSets.push(`credit_limit = $${billingIdx++}`);
      billingParams.push(input.credit_limit);
    }
    if (input.block_reason !== undefined) {
      billingSets.push(`block_reason = $${billingIdx++}`);
      billingParams.push(input.block_reason);
    }

    if (billingSets.length > 0) {
      billingParams.push(organizationId);
      await client.query(
        `UPDATE b2b_billing_accounts
         SET ${billingSets.join(', ')}
         WHERE organization_id = $${billingIdx}`,
        billingParams,
      );
    }

    await writeAudit(client, organizationId, adminUserId, 'organization.admin_update', 'b2b_organization', organizationId, input);
  });

  return getAdminOrganizationById(organizationId);
}

export async function adminListBankTransactions(query: B2BListQueryInput): Promise<B2BListResult<B2BBankTransactionRow>> {
  const params: unknown[] = [];
  const filters: string[] = [];
  let idx = 1;

  if (query.status) {
    filters.push(`status = $${idx++}`);
    params.push(query.status);
  }
  if (query.search) {
    filters.push(`(payer_name ILIKE $${idx} OR payer_inn ILIKE $${idx} OR payment_purpose ILIKE $${idx})`);
    params.push(`%${query.search}%`);
    idx += 1;
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    db.query<B2BBankTransactionRow>(
      `SELECT
         id,
         provider_code,
         external_transaction_id,
         operation_date,
         posted_at,
         payer_inn,
         payer_kpp,
         payer_name,
         amount::float8 AS amount,
         currency,
         payment_purpose,
         direction,
         status,
         created_at,
         updated_at
       FROM b2b_bank_transactions
       ${where}
       ORDER BY operation_date DESC, created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, query.limit, query.offset],
    ),
    db.queryOne<B2BCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM b2b_bank_transactions
       ${where}`,
      params,
    ),
  ]);

  return { rows, total: count?.total ?? 0 };
}

export async function adminListReconciliationTasks(query: B2BListQueryInput): Promise<B2BListResult<B2BReconciliationTaskRow>> {
  const params: unknown[] = [];
  const filters: string[] = [];
  let idx = 1;

  if (query.status) {
    filters.push(`status = $${idx++}`);
    params.push(query.status);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    db.query<B2BReconciliationTaskRow>(
      `SELECT *
       FROM b2b_reconciliation_tasks
       ${where}
       ORDER BY
         CASE priority
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           ELSE 3
         END,
         created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, query.limit, query.offset],
    ),
    db.queryOne<B2BCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM b2b_reconciliation_tasks
       ${where}`,
      params,
    ),
  ]);

  return { rows, total: count?.total ?? 0 };
}

export async function adminResolveReconciliationTask(
  adminUserId: string,
  taskId: string,
  input: ResolveB2BReconciliationTaskInput,
): Promise<B2BReconciliationTaskRow> {
  const task = await db.queryOne<B2BReconciliationTaskRow>(
    `UPDATE b2b_reconciliation_tasks
     SET status = $1,
         resolved_by = $2,
         resolved_at = now(),
         resolution_note = $3
     WHERE id = $4
     RETURNING *`,
    [input.status, adminUserId, input.resolution_note ?? null, taskId],
  );
  if (!task) throw new AppError(404, 'Задача сверки не найдена', ErrorCode.NOT_FOUND);
  return task;
}

export async function adminListVerificationTasks(query: B2BListQueryInput): Promise<B2BListResult<B2BOrganizationVerificationRow>> {
  const params: unknown[] = [];
  const filters: string[] = ["provider_type = 'bank_identity'"];
  let idx = 1;

  if (query.status) {
    filters.push(`status = $${idx++}`);
    params.push(query.status);
  } else {
    filters.push("status IN ('pending', 'redirected', 'authorized', 'mismatch', 'insufficient_permissions', 'failed')");
  }

  const where = `WHERE ${filters.join(' AND ')}`;
  const [rows, count] = await Promise.all([
    db.query<B2BOrganizationVerificationRow>(
      `SELECT *
       FROM b2b_organization_verifications
       ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, query.limit, query.offset],
    ),
    db.queryOne<B2BCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM b2b_organization_verifications
       ${where}`,
      params,
    ),
  ]);

  return { rows, total: count?.total ?? 0 };
}

export async function adminResolveVerificationTask(
  adminUserId: string,
  verificationId: string,
  input: ResolveB2BVerificationTaskInput,
): Promise<B2BOrganizationVerificationRow> {
  const status = input.action === 'approve'
    ? 'verified'
    : input.action === 'manual_review'
      ? 'mismatch'
      : 'rejected';
  const organizationStatus = input.verification_status
    ?? (input.action === 'approve' ? 'verified' : input.action === 'manual_review' ? 'manual_review' : 'rejected');

  return db.transaction(async (client) => {
    const verification = await queryOne<B2BOrganizationVerificationRow>(
      client,
      `UPDATE b2b_organization_verifications
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = now(),
           error_message = $3
       WHERE id = $4
       RETURNING *`,
      [status, adminUserId, input.reason ?? null, verificationId],
    );
    if (!verification) throw new AppError(404, 'Заявка верификации не найдена', ErrorCode.NOT_FOUND);

    await client.query(
      `UPDATE b2b_organizations
       SET verification_status = $1,
           status = CASE WHEN $1 = 'verified' AND status = 'draft' THEN 'active' ELSE status END
       WHERE id = $2`,
      [organizationStatus, verification.organization_id],
    );

    await writeAudit(
      client,
      verification.organization_id,
      adminUserId,
      'verification.resolve',
      'b2b_organization_verification',
      verification.id,
      { action: input.action, reason: input.reason ?? null, organization_status: organizationStatus },
    );

    return verification;
  });
}

export async function adminRegenerateDocument(adminUserId: string, documentId: string): Promise<B2BDocumentPackageRow> {
  const document = await db.queryOne<B2BDocumentPackageRow>(
    `UPDATE b2b_document_packages
     SET status = 'draft',
         metadata = metadata || jsonb_build_object(
           'regeneration_requested_at', now(),
           'regeneration_requested_by', $1
         )
     WHERE id = $2
     RETURNING ${DOCUMENT_COLUMNS}`,
    [adminUserId, documentId],
  );
  if (!document) throw new AppError(404, 'Пакет документов не найден', ErrorCode.NOT_FOUND);
  return document;
}

export async function adminSendDocumentToEdo(adminUserId: string, documentId: string): Promise<B2BDocumentPackageRow> {
  const document = await db.queryOne<B2BDocumentPackageRow>(
    `SELECT ${DOCUMENT_COLUMNS}
     FROM b2b_document_packages
     WHERE id = $1`,
    [documentId],
  );
  if (!document) throw new AppError(404, 'Пакет документов не найден', ErrorCode.NOT_FOUND);

  await db.query<B2BMutationIdRow>(
    `INSERT INTO b2b_edo_messages
       (document_package_id, provider_code, direction, status, last_error, metadata)
     VALUES
       ($1, COALESCE((SELECT edo_provider FROM b2b_organizations WHERE id = $2), 'unconfigured'),
        'outgoing', 'failed', $3, jsonb_build_object('requested_by', $4, 'requested_at', now()))
     RETURNING id`,
    [
      document.id,
      document.organization_id,
      'ЭДО-коннектор еще не настроен для автоматической отправки',
      adminUserId,
    ],
  );

  throw new AppError(501, 'ЭДО-коннектор еще не настроен', 'B2B_EDO_CONNECTOR_NOT_CONFIGURED');
}
