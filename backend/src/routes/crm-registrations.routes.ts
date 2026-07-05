/**
 * CRM Registrations Routes
 * Статистика регистраций новых пользователей — только для admin (users:manage)
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import db from '../database/db.js';
import type {
  AuthProvider,
  UtmSourceBucket,
  RecentUserRow,
  FunnelStage,
} from './crm-registrations.types.js';

const router = Router();
router.use(authenticateToken, requirePermission('users:manage'));

const ROLE_WHITELIST: ReadonlyArray<string> = ['client', 'employee', 'admin', 'photographer'];
const AUTH_PROVIDERS: ReadonlyArray<AuthProvider> = [
  'yandex', 'telegram', 'google', 'apple', 'vk', 'sber', 'mts', 'email', 'phone',
];

const PROVIDER_COLUMN_MAP: Record<Exclude<AuthProvider, 'email' | 'phone'>, string> = {
  yandex:   'yandex_id',
  telegram: 'telegram_id',
  google:   'google_id',
  apple:    'apple_id',
  vk:       'vk_id',
  sber:     'sber_id',
  mts:      'mts_id',
};

const PROVIDER_COLUMNS = Object.values(PROVIDER_COLUMN_MAP);
const NO_SOCIAL_PROVIDER_SQL = PROVIDER_COLUMNS.map(c => `${c} IS NULL`).join(' AND ');
const PHONE_AUTH_SQL = `${NO_SOCIAL_PROVIDER_SQL}
           AND phone_verified = true
           AND phone IS NOT NULL AND phone != ''
           AND password_hash IS NULL`;
const EMAIL_AUTH_SQL = `${NO_SOCIAL_PROVIDER_SQL}
           AND password_hash IS NOT NULL`;

function periodToInterval(period: string): string {
  switch (period) {
    case '7d':   return '7 days';
    case '30d':  return '30 days';
    case '90d':  return '90 days';
    default:     return '30 days';
  }
}

function parseBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v === true  || v === 'true'  || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return undefined;
}

function getQueryString(req: AuthRequest, key: string): string | undefined {
  const value = req.query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number, max?: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max === undefined ? parsed : Math.min(max, parsed);
}

function getRowValue(row: unknown, key: string): unknown {
  if (typeof row !== 'object' || row === null) return undefined;
  return Reflect.get(row, key);
}

function getNumberField(row: unknown, key: string): number {
  const value = getRowValue(row, key);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getNullableRoundedNumberField(row: unknown, key: string): number | null {
  const value = getRowValue(row, key);
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function getStringField(row: unknown, key: string): string {
  const value = getRowValue(row, key);
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return '';
}

function getNullableStringField(row: unknown, key: string): string | null {
  const value = getRowValue(row, key);
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return String(value);
}

function getBooleanField(row: unknown, key: string): boolean {
  const value = getRowValue(row, key);
  return value === true || value === 'true' || value === 1 || value === '1';
}

function getPgErrorCode(error: unknown): string | undefined {
  const code = getRowValue(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function getProviderColumn(provider: string): string | undefined {
  const value = getRowValue(PROVIDER_COLUMN_MAP, provider);
  return typeof value === 'string' ? value : undefined;
}

function isAuthProvider(value: unknown): value is AuthProvider {
  return typeof value === 'string' && AUTH_PROVIDERS.some(provider => provider === value);
}

function toUtmSourceBucket(row: unknown): UtmSourceBucket | null {
  const source = getNullableStringField(row, 'source');
  if (!source) return null;
  return {
    source,
    count: getNumberField(row, 'count'),
  };
}

function toRecentUserRow(row: unknown): RecentUserRow | null {
  const id = getNullableStringField(row, 'id');
  const role = getNullableStringField(row, 'role');
  const createdAt = getStringField(row, 'created_at');
  const provider = getRowValue(row, 'auth_provider');

  if (!id || !role || !createdAt || !isAuthProvider(provider)) return null;

  return {
    id,
    email: getNullableStringField(row, 'email'),
    display_name: getNullableStringField(row, 'display_name'),
    first_name: getNullableStringField(row, 'first_name'),
    last_name: getNullableStringField(row, 'last_name'),
    phone: getNullableStringField(row, 'phone'),
    role,
    email_verified: getBooleanField(row, 'email_verified'),
    phone_verified: getBooleanField(row, 'phone_verified'),
    is_active: getBooleanField(row, 'is_active'),
    auth_provider: provider,
    utm_source: getNullableStringField(row, 'utm_source'),
    utm_medium: getNullableStringField(row, 'utm_medium'),
    utm_campaign: getNullableStringField(row, 'utm_campaign'),
    has_order: getBooleanField(row, 'has_order'),
    created_at: createdAt,
  };
}

// ── GET /api/crm/registrations/stats ─────────────────────────
// ?period=7d|30d|90d

router.get('/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  const period   = getQueryString(req, 'period') || '30d';
  const interval = periodToInterval(period);

  // KPI summary with conversion + previousPeriodNew via CTE
  const summaryRows = await db.query(
    `WITH first_conv AS (
       SELECT
         u.id AS user_id,
         LEAST(
           (SELECT MIN(o.created_at) FROM orders   o WHERE o.client_id = u.id),
           (SELECT MIN(b.created_at) FROM bookings b WHERE b.client_id = u.id)
         ) AS first_at
       FROM users u
       WHERE u.role = 'client'
         AND u.created_at >= NOW() - $1::interval
     )
     SELECT
       (SELECT COUNT(*) FROM users)                                                   AS total_users,
       COUNT(*) FILTER (WHERE created_at >= NOW() - $1::interval)                     AS new_in_period,
       COUNT(*) FILTER (
         WHERE created_at >= NOW() - $1::interval * 2
           AND created_at <  NOW() - $1::interval
       )                                                                              AS previous_period_new,
       COUNT(*) FILTER (WHERE role = 'client')                                        AS clients,
       COUNT(*) FILTER (WHERE role IN ('employee','admin','photographer'))            AS staff,
       COUNT(*) FILTER (WHERE yandex_id IS NOT NULL)                                  AS via_yandex,
       COUNT(*) FILTER (WHERE telegram_id IS NOT NULL)                                AS via_telegram,
       COUNT(*) FILTER (WHERE google_id IS NOT NULL)                                  AS via_google,
       COUNT(*) FILTER (WHERE apple_id IS NOT NULL)                                   AS via_apple,
       COUNT(*) FILTER (WHERE vk_id IS NOT NULL)                                      AS via_vk,
       COUNT(*) FILTER (WHERE sber_id IS NOT NULL)                                    AS via_sber,
       COUNT(*) FILTER (WHERE mts_id IS NOT NULL)                                     AS via_mts,
       COUNT(*) FILTER (
         WHERE ${PHONE_AUTH_SQL}
       )                                                                              AS via_phone,
       COUNT(*) FILTER (
         WHERE ${EMAIL_AUTH_SQL}
           AND email_verified = true
       )                                                                              AS via_email,
       COUNT(*) FILTER (
         WHERE ${EMAIL_AUTH_SQL}
           AND (email_verified = false OR email_verified IS NULL)
       )                                                                              AS via_email_unverified,
       COUNT(*) FILTER (WHERE email_verified = true)                                  AS email_verified,
       COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone != '')                      AS has_phone,
       (SELECT COUNT(*)::int FROM first_conv WHERE first_at IS NOT NULL)              AS clients_converted,
       (SELECT AVG(EXTRACT(EPOCH FROM (fc.first_at - u2.created_at)) / 86400)::float
          FROM first_conv fc
          JOIN users u2 ON u2.id = fc.user_id
          WHERE fc.first_at IS NOT NULL)                                              AS avg_days_to_conversion
     FROM users`,
    [interval],
  );

  // Daily registrations with generate_series to fill gaps
  const dailyRows = await db.query(
    `SELECT
       d::date AS day,
       COUNT(u.id)::int AS count
     FROM generate_series(
       (NOW() - $1::interval)::date,
       CURRENT_DATE,
       '1 day'::interval
     ) AS d
     LEFT JOIN users u ON u.created_at::date = d::date
     GROUP BY d::date
     ORDER BY d::date`,
    [interval],
  );

  // By-role breakdown within period
  const roleRows = await db.query(
    `SELECT
       role,
       COUNT(*)::int AS count
     FROM users
     WHERE created_at >= NOW() - $1::interval
     GROUP BY role
     ORDER BY count DESC`,
    [interval],
  );

  // Repeat visitors — distinct visitor_ids с session_number>1
  let repeatVisitors = 0;
  try {
    const repeatRows = await db.query(
      `SELECT COUNT(DISTINCT visitor_id)::int AS count
         FROM visitor_chat_sessions
        WHERE user_id IS NOT NULL
          AND session_number > 1
          AND created_at >= NOW() - $1::interval`,
      [interval],
    );
    repeatVisitors = getNumberField(repeatRows[0], 'count');
  } catch {
    repeatVisitors = 0;
  }

  // Top UTM sources — может не существовать если миграция 109 ещё не применена
  let topUtmSources: UtmSourceBucket[] = [];
  try {
    const utmRows = await db.query(
      `SELECT utm_source AS source, COUNT(*)::int AS count
         FROM users
        WHERE utm_source IS NOT NULL
          AND created_at >= NOW() - $1::interval
        GROUP BY utm_source
        ORDER BY count DESC
        LIMIT 5`,
      [interval],
    );
    topUtmSources = utmRows
      .map(toUtmSourceBucket)
      .filter((row): row is UtmSourceBucket => row !== null);
  } catch (err: unknown) {
    const code = getPgErrorCode(err);
    if (code === '42703') {
      topUtmSources = [];
    } else {
      throw err;
    }
  }

  const s = summaryRows[0];

  const clientsCount      = getNumberField(s, 'clients');
  const clientsConverted  = getNumberField(s, 'clients_converted');
  const conversionPct     = clientsCount > 0
    ? Math.round((clientsConverted / clientsCount) * 10000) / 100
    : 0;
  const avgDaysToConversion = getNullableRoundedNumberField(s, 'avg_days_to_conversion');

  res.json({
    success: true,
    period,
    summary: {
      totalUsers:         getNumberField(s, 'total_users'),
      newInPeriod:        getNumberField(s, 'new_in_period'),
      previousPeriodNew:  getNumberField(s, 'previous_period_new'),
      clients:            clientsCount,
      staff:              getNumberField(s, 'staff'),
      viaYandex:          getNumberField(s, 'via_yandex'),
      viaTelegram:        getNumberField(s, 'via_telegram'),
      viaGoogle:          getNumberField(s, 'via_google'),
      viaApple:           getNumberField(s, 'via_apple'),
      viaVk:              getNumberField(s, 'via_vk'),
      viaSber:            getNumberField(s, 'via_sber'),
      viaMts:             getNumberField(s, 'via_mts'),
      viaPhone:           getNumberField(s, 'via_phone'),
      viaEmail:           getNumberField(s, 'via_email'),
      viaEmailUnverified: getNumberField(s, 'via_email_unverified'),
      emailVerified:      getNumberField(s, 'email_verified'),
      hasPhone:           getNumberField(s, 'has_phone'),
      conversionPct,
      avgDaysToConversion,
      repeatVisitors,
      topUtmSources,
    },
    daily:  dailyRows.map(r => ({
      day:   getStringField(r, 'day'),
      count: getNumberField(r, 'count'),
    })),
    byRole: roleRows.map(r => ({
      role:  getStringField(r, 'role'),
      count: getNumberField(r, 'count'),
    })),
  });
});

// ── GET /api/crm/registrations/recent ────────────────────────
// ?period=7d|30d|90d &page=1 &limit=50
// Filters: role, provider, search, verified, hasOrder

router.get('/recent', async (req: AuthRequest, res: Response): Promise<void> => {
  const period   = getQueryString(req, 'period') || '30d';
  const page     = parsePositiveInt(getQueryString(req, 'page'), 1);
  const limit    = parsePositiveInt(getQueryString(req, 'limit'), 50, 200);
  const offset   = (page - 1) * limit;
  const interval = periodToInterval(period);

  const roleFilter     = getQueryString(req, 'role');
  const providerFilter = getQueryString(req, 'provider');
  const searchFilter   = getQueryString(req, 'search');
  const verifiedFilter = parseBool(req.query['verified']);
  const hasOrderFilter = parseBool(req.query['hasOrder']);

  const conditions: string[] = ['created_at >= NOW() - $1::interval'];
  const params: unknown[] = [interval];
  let p = 1;

  if (roleFilter && ROLE_WHITELIST.includes(roleFilter)) {
    p += 1;
    conditions.push(`role = $${p}`);
    params.push(roleFilter);
  }

  if (providerFilter) {
    if (providerFilter === 'email') {
      conditions.push(`(${EMAIL_AUTH_SQL})`);
    } else if (providerFilter === 'phone') {
      conditions.push(`(${PHONE_AUTH_SQL})`);
    } else {
      const col = getProviderColumn(providerFilter);
      if (col) {
        conditions.push(`${col} IS NOT NULL`);
      }
    }
  }

  if (searchFilter && typeof searchFilter === 'string') {
    const trimmed = searchFilter.trim().slice(0, 128);
    if (trimmed.length > 0) {
      p += 1;
      conditions.push(`(email ILIKE $${p} OR display_name ILIKE $${p} OR phone ILIKE $${p})`);
      params.push(`%${trimmed}%`);
    }
  }

  if (verifiedFilter !== undefined) {
    p += 1;
    conditions.push(`email_verified = $${p}`);
    params.push(verifiedFilter);
  }

  if (hasOrderFilter === true) {
    conditions.push(`(
      EXISTS (SELECT 1 FROM orders   o WHERE o.client_id = users.id)
      OR EXISTS (SELECT 1 FROM bookings b WHERE b.client_id = users.id)
    )`);
  } else if (hasOrderFilter === false) {
    conditions.push(`NOT (
      EXISTS (SELECT 1 FROM orders   o WHERE o.client_id = users.id)
      OR EXISTS (SELECT 1 FROM bookings b WHERE b.client_id = users.id)
    )`);
  }

  const whereSql = `WHERE ${conditions.join(' AND ')}`;

  const listParams  = [...params, limit, offset];
  const listLimitP  = p + 1;
  const listOffsetP = p + 2;

  const listSql = `
    SELECT
      id,
      email,
      display_name,
      first_name,
      last_name,
      phone,
      role,
      email_verified,
      phone_verified,
      is_active,
      CASE
        WHEN yandex_id   IS NOT NULL THEN 'yandex'
        WHEN telegram_id IS NOT NULL THEN 'telegram'
        WHEN google_id   IS NOT NULL THEN 'google'
        WHEN apple_id    IS NOT NULL THEN 'apple'
        WHEN vk_id       IS NOT NULL THEN 'vk'
        WHEN sber_id     IS NOT NULL THEN 'sber'
        WHEN mts_id      IS NOT NULL THEN 'mts'
        WHEN ${PHONE_AUTH_SQL} THEN 'phone'
        ELSE 'email'
      END AS auth_provider,
      utm_source,
      utm_medium,
      utm_campaign,
      (
        EXISTS (SELECT 1 FROM orders   o WHERE o.client_id = users.id)
        OR EXISTS (SELECT 1 FROM bookings b WHERE b.client_id = users.id)
      ) AS has_order,
      created_at
    FROM users
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT $${listLimitP} OFFSET $${listOffsetP}
  `;

  const countSql = `SELECT COUNT(*)::int AS total FROM users ${whereSql}`;

  // Graceful fallback для utm_* колонок если миграция 109 не применена
  let rows: unknown[];
  let countRows: unknown[];
  try {
    [rows, countRows] = await Promise.all([
      db.query(listSql, listParams),
      db.query(countSql, params),
    ]);
  } catch (err: unknown) {
    const code = getPgErrorCode(err);
    if (code === '42703') {
      const fallbackListSql = listSql
        .replace('utm_source,\n      utm_medium,\n      utm_campaign,\n      ', '')
        .replace(
          'auth_provider,\n      (',
          'auth_provider,\n      NULL::text AS utm_source,\n      NULL::text AS utm_medium,\n      NULL::text AS utm_campaign,\n      (',
        );
      [rows, countRows] = await Promise.all([
        db.query(fallbackListSql, listParams),
        db.query(countSql, params),
      ]);
    } else {
      throw err;
    }
  }

  res.json({
    success: true,
    data:  rows.map(toRecentUserRow).filter((row): row is RecentUserRow => row !== null),
    total: getNumberField(countRows[0], 'total'),
    page,
    limit,
  });
});

// ── GET /api/crm/registrations/funnel ────────────────────────
// ?period=7d|30d|90d
// Conversion funnel: registered → emailVerified → hasPhone → hasOrder

router.get('/funnel', async (req: AuthRequest, res: Response): Promise<void> => {
  const period   = getQueryString(req, 'period') || '30d';
  const interval = periodToInterval(period);

  const rows = await db.query(
    `SELECT
       COUNT(*)::int                                                                AS registered,
       COUNT(*) FILTER (WHERE email_verified = true)::int                           AS email_verified,
       COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone != '')::int               AS has_phone,
       COUNT(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM orders   o WHERE o.client_id = users.id)
            OR EXISTS (SELECT 1 FROM bookings b WHERE b.client_id = users.id)
       )::int                                                                       AS has_order
     FROM users
     WHERE created_at >= NOW() - $1::interval`,
    [interval],
  );

  const r = rows[0];

  const registered = getNumberField(r, 'registered');
  const emailVerified = getNumberField(r, 'email_verified');
  const hasPhone = getNumberField(r, 'has_phone');
  const hasOrder = getNumberField(r, 'has_order');
  const pct = (n: number): number =>
    registered > 0 ? Math.round((n / registered) * 10000) / 100 : 0;

  const stages: FunnelStage[] = [
    { key: 'registered',    label: 'Зарегистрирован',    count: registered,             pct: registered > 0 ? 100 : 0 },
    { key: 'emailVerified', label: 'Email подтверждён',  count: emailVerified,           pct: pct(emailVerified) },
    { key: 'hasPhone',      label: 'Оставил телефон',    count: hasPhone,                pct: pct(hasPhone) },
    { key: 'hasOrder',      label: 'Сделал заказ',       count: hasOrder,                pct: pct(hasOrder) },
  ];

  res.json({
    success: true,
    period,
    stages,
  });
});

export default router;
