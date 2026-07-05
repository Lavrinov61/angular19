import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import type {
  StudentAllowancePeriodRow,
  StudentAllowancePeriodUpdateRow,
  StudentDiscountBenefitType,
  StudentDiscountEntitlementRow,
  StudentDiscountPartialRedemptionRow,
  StudentDiscountReceiptItemLookupRow,
  StudentDiscountRedemptionUsageRow,
  StudentDiscountStatus,
  StudentDiscountUserLookupRow,
} from '../types/views/student-discount-views.js';
import type { StudentDiscountRedemptionMetadata } from '../types/jsonb/student-discount-jsonb.js';

interface QueryClient {
  query<Row = unknown>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export const STUDENT_DISCOUNT_LINK_TOKEN = 'student-2026';

/** Лимиты образовательной льготы за rolling-30 период. Параметризуются env (D1, дефолт 100/100). */
function readLimitEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
export const STUDENT_DISCOUNT_PRINT_LIMIT = readLimitEnv('EDU_DOC_LIMIT', 100);
export const STUDENT_DISCOUNT_PHOTO_LIMIT = readLimitEnv('EDU_PHOTO_LIMIT', 100);
export const STUDENT_DISCOUNT_PRINT_BW_PRICE = 3;
export const STUDENT_DISCOUNT_PRINT_COLOR_PRICE = 4;
export const STUDENT_DISCOUNT_PRINT_PRICE = STUDENT_DISCOUNT_PRINT_BW_PRICE;
/** Образовательный тариф «без подписки»: ч/б документ −50% = 5 ₽ (подписка −70% = 3 ₽). */
export const STUDENT_DISCOUNT_VERIFIED_PRINT_PRICE = 5;
export const STUDENT_DISCOUNT_PRINT_GRAPHIC_50_PRICE = 8;
export const STUDENT_DISCOUNT_PRINT_GRAPHIC_75_PRICE = 12;
export const STUDENT_DISCOUNT_PRINT_GRAPHIC_100_PRICE = 18;
export const STUDENT_DISCOUNT_MAX_FILL_PERCENT = 100;
export const STUDENT_DISCOUNT_BINDING_LIMIT = 1;
export const STUDENT_DISCOUNT_BINDING_PRICE = 10;
export const STUDENT_ALLOWANCE_PERIOD_DAYS = 30;

const PRINT_A4_BW_SLUGS = new Set([
  'copy-a4-bw',
  'km-а4-ксерокопия',
  'km-а4-до-75',
  'km-а4-печать-документа',
  'km-а4-печать-документа-студент',
  'km-а4-печать-до-75',
  'print-a4-bw',
  'student-print-a4',
]);
const PRINT_A4_COLOR_SLUGS = new Set([
  'copy-a4-color',
  'km-а4-до-15-цвет',
  'km-а4-ксерокопия-цветная',
  'km-а4-ксерокопия-фото-цветная',
  'km-а4-фото-документ',
  'km-а4-печать-документа-цветная',
  'km-а4-печать-до-15-цвет',
  'print-a4-color',
]);
const BINDING_SLUGS = new Set(['binding-spring-a4']);

const ENTITLEMENT_COLUMNS = `
  id, user_id, status, source_token, source_url, student_account_id,
  activated_at, expires_at, print_sheets_used, binding_uses, created_at, updated_at
`;
// Образовательная льгота активна для ДВУХ тарифов: оплаченная подписка
// ('education_subscription', −70%/−50%) и подтверждённый статус без подписки
// ('education_verified', −50%/−30%). Оба дают rolling-30 кап (studentState).
const EDUCATION_ENTITLEMENT_SQL = `s.source_token IN ('education_subscription', 'education_verified')`;

const STUDENT_ALLOWANCE_PERIOD_SECONDS = STUDENT_ALLOWANCE_PERIOD_DAYS * 24 * 60 * 60;
const STUDENT_ALLOWANCE_PERIOD_INTERVAL_SQL = `INTERVAL '${STUDENT_ALLOWANCE_PERIOD_DAYS} days'`;
const VERIFIED_STUDENT_ACCOUNT_SQL = `
  EXISTS (
    SELECT 1
    FROM student_accounts a
    WHERE a.id = s.student_account_id
      AND a.user_id = s.user_id
      AND a.status = 'verified'
      AND (a.expires_at IS NULL OR a.expires_at >= NOW())
  )
`;

export function currentStudentAllowancePeriodStartSql(entitlementAlias = 's'): string {
  const activatedAt = `${entitlementAlias}.activated_at`;
  return `${activatedAt} + (
    GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (NOW() - ${activatedAt})) / ${STUDENT_ALLOWANCE_PERIOD_SECONDS})::integer
    ) * ${STUDENT_ALLOWANCE_PERIOD_INTERVAL_SQL}
  )`;
}

// sheet_price берётся по тарифу льготы: подписка ($4=3 ₽) vs verified ($5=5 ₽).
// CASE делает значение self-healing: при апгрейде verified→подписка ON CONFLICT DO UPDATE
// перезапишет sheet_price на 3. Для education цена документа реально считается процентом
// в pricing-engine, поэтому sheet_price это витринная цифра (кабинет/оценка).
const CURRENT_STUDENT_ALLOWANCE_INSERT_SQL = `
  WITH current_period AS (
    SELECT
      s.id AS entitlement_id,
      s.user_id,
      s.source_token,
      ${currentStudentAllowancePeriodStartSql('s')} AS period_start
    FROM student_discount_entitlements s
    WHERE s.id = $1
      AND s.user_id = $2
    LIMIT 1
  )
  INSERT INTO student_allowance_periods
    (entitlement_id, user_id, period_start, period_end, sheet_limit, sheet_price, photo_limit)
  SELECT
    entitlement_id,
    user_id,
    period_start,
    period_start + ${STUDENT_ALLOWANCE_PERIOD_INTERVAL_SQL},
    $3,
    CASE WHEN source_token = 'education_subscription' THEN $4::numeric ELSE $5::numeric END,
    $6
  FROM current_period
  ON CONFLICT (entitlement_id, period_start) DO UPDATE SET
    sheet_limit = EXCLUDED.sheet_limit,
    sheet_price = EXCLUDED.sheet_price,
    photo_limit = EXCLUDED.photo_limit
  RETURNING id, entitlement_id, user_id, period_start, period_end,
            sheet_limit, sheet_price, sheets_used, photo_limit, photos_used, created_at, updated_at
`;

export interface StudentDiscountSummary {
  status: StudentDiscountStatus;
  source_token: string;
  activated_at: string;
  expires_at: string;
  print_sheets_limit: number;
  print_sheets_used: number;
  print_sheets_remaining: number;
  print_sheet_price: number;
  max_print_fill_percent: number;
  photo_limit: number;
  photo_used: number;
  photo_remaining: number;
  allowance_period_id: string | null;
  allowance_period_start: string | null;
  allowance_period_end: string | null;
  binding_limit: number;
  binding_uses: number;
  binding_remaining: number;
}

export interface ActiveStudentDiscount {
  id: string;
  user_id: string;
  summary: StudentDiscountSummary;
}

export interface StudentDiscountPricingState {
  entitlementId: string;
  userId: string;
  printSheetsRemaining: number;
  bindingRemaining: number;
  photosRemaining: number;
}

export interface StudentDiscountItemPricing {
  total: number;
  units: number;
  benefitType: StudentDiscountBenefitType;
  label: string;
}

export interface StudentDiscountReceiptItem {
  product_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price?: number;
  discount_amount?: number;
  discount_type?: string | null;
  student_discount_benefit?: StudentDiscountBenefitType | null;
  student_discount_units?: number | null;
  print_fill_percent?: number | string | null;
  print_order_id?: string | null;
}

export interface StudentDiscountReceiptUsage {
  entitlement_id: string;
  user_id: string;
  print_sheets: number;
  binding_uses: number;
}

function configuredStudentTokens(): Set<string> {
  const raw = process.env['STUDENT_DISCOUNT_TOKENS'] || STUDENT_DISCOUNT_LINK_TOKEN;
  return new Set(
    raw
      .split(',')
      .map(token => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isStudentDiscountRedemptionMetadata(value: unknown): value is StudentDiscountRedemptionMetadata {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metadataProductId(metadata: StudentDiscountRedemptionMetadata | null): string | null {
  if (!isStudentDiscountRedemptionMetadata(metadata)) return null;
  const value = metadata.product_id ?? metadata.productId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function metadataRefundedUnits(metadata: StudentDiscountRedemptionMetadata | null): number {
  if (!isStudentDiscountRedemptionMetadata(metadata)) return 0;
  return Math.max(0, Math.floor(toNumber(metadata.partial_refunded_units)));
}

function normalizePhoneTail(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

function isActiveStatus(row: StudentDiscountEntitlementRow | StudentDiscountUserLookupRow): boolean {
  const summary = mapSummary(row, null);
  return summary.status === 'active';
}

function mapSummary(
  row: StudentDiscountEntitlementRow | StudentDiscountUserLookupRow,
  allowance: StudentAllowancePeriodRow | null,
): StudentDiscountSummary {
  const legacyPrintUsed = Math.min(STUDENT_DISCOUNT_PRINT_LIMIT, Math.max(0, toNumber(row.print_sheets_used)));
  const printLimit = allowance ? Math.max(0, Math.floor(toNumber(allowance.sheet_limit))) : STUDENT_DISCOUNT_PRINT_LIMIT;
  const printUsed = allowance
    ? Math.min(printLimit, Math.max(0, Math.floor(toNumber(allowance.sheets_used))))
    : legacyPrintUsed;
  const bindingUses = Math.min(STUDENT_DISCOUNT_BINDING_LIMIT, Math.max(0, toNumber(row.binding_uses)));
  const photoLimit = allowance && allowance.photo_limit !== undefined && allowance.photo_limit !== null
    ? Math.max(0, Math.floor(toNumber(allowance.photo_limit)))
    : STUDENT_DISCOUNT_PHOTO_LIMIT;
  const photoUsed = allowance
    ? Math.min(photoLimit, Math.max(0, Math.floor(toNumber(allowance.photos_used))))
    : 0;
  const expiresAt = new Date(row.expires_at);
  const effectiveStatus: StudentDiscountStatus =
    row.status === 'active' && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()
      ? 'expired'
      : row.status;

  return {
    status: effectiveStatus,
    source_token: row.source_token,
    activated_at: row.activated_at,
    expires_at: row.expires_at,
    print_sheets_limit: printLimit,
    print_sheets_used: printUsed,
    print_sheets_remaining: effectiveStatus === 'active' ? Math.max(0, printLimit - printUsed) : 0,
    print_sheet_price: allowance ? toNumber(allowance.sheet_price) : STUDENT_DISCOUNT_PRINT_PRICE,
    max_print_fill_percent: STUDENT_DISCOUNT_MAX_FILL_PERCENT,
    photo_limit: photoLimit,
    photo_used: photoUsed,
    photo_remaining: effectiveStatus === 'active' ? Math.max(0, photoLimit - photoUsed) : 0,
    allowance_period_id: allowance?.id ?? null,
    allowance_period_start: allowance?.period_start ?? null,
    allowance_period_end: allowance?.period_end ?? null,
    binding_limit: STUDENT_DISCOUNT_BINDING_LIMIT,
    binding_uses: bindingUses,
    binding_remaining: effectiveStatus === 'active' ? STUDENT_DISCOUNT_BINDING_LIMIT - bindingUses : 0,
  };
}

export function normalizeStudentPrintFillPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

export function isStudentPrintFillEligible(value: unknown): boolean {
  const fillPercent = normalizeStudentPrintFillPercent(value);
  return fillPercent !== null && fillPercent <= STUDENT_DISCOUNT_MAX_FILL_PERCENT;
}

export function assertStudentPrintFillEligible(value: unknown): void {
  if (!isStudentPrintFillEligible(value)) {
    throw new AppError(
      409,
      'Укажите заливку страницы от 0 до 100%, чтобы применить образовательную цену',
      ErrorCode.VALIDATION_ERROR,
    );
  }
}

export function isStudentPrintDiscountBenefit(
  benefitType: StudentDiscountBenefitType | null | undefined,
): benefitType is 'print_a4_bw' | 'print_a4_color' {
  return benefitType === 'print_a4_bw' || benefitType === 'print_a4_color';
}

function studentPrintPrice(benefitType: 'print_a4_bw' | 'print_a4_color', value: unknown): number | null {
  const fillPercent = normalizeStudentPrintFillPercent(value);
  if (fillPercent === null || fillPercent > STUDENT_DISCOUNT_MAX_FILL_PERCENT) return null;
  if (fillPercent <= 15) {
    return benefitType === 'print_a4_color'
      ? STUDENT_DISCOUNT_PRINT_COLOR_PRICE
      : STUDENT_DISCOUNT_PRINT_BW_PRICE;
  }
  if (fillPercent <= 50) return STUDENT_DISCOUNT_PRINT_GRAPHIC_50_PRICE;
  if (fillPercent <= 75) return STUDENT_DISCOUNT_PRINT_GRAPHIC_75_PRICE;
  return STUDENT_DISCOUNT_PRINT_GRAPHIC_100_PRICE;
}

function studentPrintFillLabel(value: unknown): string {
  const fillPercent = normalizeStudentPrintFillPercent(value) ?? STUDENT_DISCOUNT_MAX_FILL_PERCENT;
  if (fillPercent <= 15) return 'до 15%';
  if (fillPercent <= 50) return 'до 50%';
  if (fillPercent <= 75) return 'до 75%';
  return 'до 100%';
}

export function isStudentDiscountToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const normalized = token.trim().toLowerCase();
  return normalized.length > 0 && configuredStudentTokens().has(normalized);
}

export function classifyStudentDiscountBenefit(
  slug: string | null | undefined,
  productName = '',
): StudentDiscountBenefitType | null {
  const normalizedSlug = slug?.trim().toLowerCase() || '';
  if (PRINT_A4_COLOR_SLUGS.has(normalizedSlug)) {
    return 'print_a4_color';
  }
  if (PRINT_A4_BW_SLUGS.has(normalizedSlug)) {
    return 'print_a4_bw';
  }
  if (BINDING_SLUGS.has(normalizedSlug)) {
    return 'binding_spring_a4';
  }

  const name = productName.toLowerCase();
  const isA4 = name.includes('а4') || name.includes('a4');
  const isFillTier =
    name.includes('до 15') || name.includes('15%')
    || name.includes('до 50') || name.includes('50%')
    || name.includes('до 75') || name.includes('75%')
    || name.includes('до 100') || name.includes('100%');
  const isA4Print = name.includes('печать') || name.includes('ксерокоп') || name.includes('документ') || isFillTier;
  if (isA4 && name.includes('цвет') && isA4Print && !name.includes('фото на')) {
    return 'print_a4_color';
  }
  if (
    isA4
    && !name.includes('цвет')
    && !name.includes('фото на')
    && isA4Print
  ) {
    return 'print_a4_bw';
  }
  if (name.includes('перепл') || name.includes('пружин')) {
    return 'binding_spring_a4';
  }
  return null;
}

export function calculateStudentDiscountForItem(params: {
  state: StudentDiscountPricingState | null;
  slug: string;
  name: string;
  basePrice: number;
  quantity: number;
  printFillPercent?: unknown;
}): StudentDiscountItemPricing | null {
  if (!params.state) return null;

  const benefitType = classifyStudentDiscountBenefit(params.slug, params.name);
  if (!benefitType) return null;

  if (isStudentPrintDiscountBenefit(benefitType)) {
    const printPrice = studentPrintPrice(benefitType, params.printFillPercent);
    if (printPrice === null) return null;

    const fillLabel = studentPrintFillLabel(params.printFillPercent);
    const units = Math.min(params.quantity, params.state.printSheetsRemaining);
    if (units <= 0 || params.basePrice <= printPrice) return null;
    const total = printPrice * units + params.basePrice * (params.quantity - units);
    return {
      total,
      units,
      benefitType,
      label: units === params.quantity
        ? `Образовательная цена: ${printPrice}₽ за лист (${fillLabel})`
        : `Образовательная цена: ${units} из ${params.quantity} листов по ${printPrice}₽ (${fillLabel})`,
    };
  }

  const units = Math.min(params.quantity, params.state.bindingRemaining);
  if (units <= 0 || params.basePrice <= STUDENT_DISCOUNT_BINDING_PRICE) return null;
  const total = STUDENT_DISCOUNT_BINDING_PRICE * units + params.basePrice * (params.quantity - units);
  return {
    total,
    units,
    benefitType,
    label: units === params.quantity
      ? `Образовательная цена: переплёт ${STUDENT_DISCOUNT_BINDING_PRICE}₽`
      : `Образовательная цена: ${units} переплёт за ${STUDENT_DISCOUNT_BINDING_PRICE}₽`,
  };
}

export function applyStudentDiscountUsageToState(
  state: StudentDiscountPricingState | null,
  pricing: StudentDiscountItemPricing | null,
): void {
  if (!state || !pricing) return;
  if (isStudentPrintDiscountBenefit(pricing.benefitType)) {
    state.printSheetsRemaining = Math.max(0, state.printSheetsRemaining - pricing.units);
    return;
  }
  state.bindingRemaining = Math.max(0, state.bindingRemaining - pricing.units);
}

async function ensureCurrentStudentAllowancePeriod(
  entitlementId: string,
  userId: string,
): Promise<StudentAllowancePeriodRow> {
  const row = await db.queryOne<StudentAllowancePeriodRow>(
    CURRENT_STUDENT_ALLOWANCE_INSERT_SQL,
    [
      entitlementId,
      userId,
      STUDENT_DISCOUNT_PRINT_LIMIT,
      STUDENT_DISCOUNT_PRINT_PRICE,
      STUDENT_DISCOUNT_VERIFIED_PRINT_PRICE,
      STUDENT_DISCOUNT_PHOTO_LIMIT,
    ],
  );
  if (!row) {
    throw new AppError(500, 'Не удалось подготовить образовательный 30-дневный лимит', ErrorCode.INTERNAL_ERROR);
  }
  return row;
}

export async function ensureCurrentStudentAllowancePeriodWithClient(
  client: QueryClient,
  params: { entitlementId: string; userId: string; lock?: boolean },
): Promise<StudentAllowancePeriodRow> {
  const result = await client.query<StudentAllowancePeriodRow>(
    CURRENT_STUDENT_ALLOWANCE_INSERT_SQL,
    [
      params.entitlementId,
      params.userId,
      STUDENT_DISCOUNT_PRINT_LIMIT,
      STUDENT_DISCOUNT_PRINT_PRICE,
      STUDENT_DISCOUNT_VERIFIED_PRINT_PRICE,
      STUDENT_DISCOUNT_PHOTO_LIMIT,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(500, 'Не удалось подготовить образовательный 30-дневный лимит', ErrorCode.INTERNAL_ERROR);
  }

  if (!params.lock) return row;

  const locked = await client.query<StudentAllowancePeriodRow>(
    `SELECT id, entitlement_id, user_id, period_start, period_end,
            sheet_limit, sheet_price, sheets_used, photo_limit, photos_used, created_at, updated_at
     FROM student_allowance_periods
     WHERE id = $1
     FOR UPDATE`,
    [row.id],
  );
  return locked.rows[0] ?? row;
}

async function mapSummaryWithCurrentAllowance(
  row: StudentDiscountEntitlementRow | StudentDiscountUserLookupRow,
): Promise<StudentDiscountSummary> {
  if (!isActiveStatus(row)) {
    return mapSummary(row, null);
  }
  const allowance = await ensureCurrentStudentAllowancePeriod(row.id, row.user_id);
  return mapSummary(row, allowance);
}

export async function activateStudentDiscountForUser(params: {
  userId: string;
  token?: unknown;
  sourceUrl?: string | null;
}): Promise<StudentDiscountSummary | null> {
  if (!isStudentDiscountToken(params.token)) {
    return null;
  }

  return getStudentDiscountForUser(params.userId);
}

export async function getStudentDiscountForUser(userId: string): Promise<StudentDiscountSummary | null> {
  const row = await db.queryOne<StudentDiscountEntitlementRow>(
    `SELECT ${ENTITLEMENT_COLUMNS}
     FROM student_discount_entitlements s
     WHERE s.user_id = $1
       AND ${EDUCATION_ENTITLEMENT_SQL}
       AND ${VERIFIED_STUDENT_ACCOUNT_SQL}
     LIMIT 1`,
    [userId],
  );
  return row ? mapSummaryWithCurrentAllowance(row) : null;
}

export async function getStudentDiscountForPhone(phone: string): Promise<StudentDiscountSummary | null> {
  const tail = normalizePhoneTail(phone);
  if (tail.length !== 10) return null;

  const row = await db.queryOne<StudentDiscountUserLookupRow>(
    `SELECT s.id, s.user_id, s.status, s.source_token, s.source_url, s.student_account_id,
            s.activated_at, s.expires_at, s.print_sheets_used, s.binding_uses, s.created_at, s.updated_at
     FROM student_discount_entitlements s
     JOIN users u ON u.id = s.user_id
     WHERE RIGHT(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), 10) = $1
       AND ${EDUCATION_ENTITLEMENT_SQL}
       AND ${VERIFIED_STUDENT_ACCOUNT_SQL}
     ORDER BY s.activated_at DESC
     LIMIT 1`,
    [tail],
  );
  return row ? mapSummaryWithCurrentAllowance(row) : null;
}

export async function getActiveStudentDiscount(params: {
  userId?: string | null;
  customerPhone?: string | null;
}): Promise<ActiveStudentDiscount | null> {
  let row: StudentDiscountEntitlementRow | StudentDiscountUserLookupRow | null = null;

  if (params.userId) {
    row = await db.queryOne<StudentDiscountEntitlementRow>(
      `SELECT ${ENTITLEMENT_COLUMNS}
       FROM student_discount_entitlements s
       WHERE s.user_id = $1
         AND ${EDUCATION_ENTITLEMENT_SQL}
         AND ${VERIFIED_STUDENT_ACCOUNT_SQL}
       LIMIT 1`,
      [params.userId],
    );
  }

  if (!row && params.customerPhone) {
    const tail = normalizePhoneTail(params.customerPhone);
    if (tail.length === 10) {
      row = await db.queryOne<StudentDiscountUserLookupRow>(
        `SELECT s.id, s.user_id, s.status, s.source_token, s.source_url, s.student_account_id,
                s.activated_at, s.expires_at, s.print_sheets_used, s.binding_uses, s.created_at, s.updated_at
         FROM student_discount_entitlements s
         JOIN users u ON u.id = s.user_id
         WHERE RIGHT(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), 10) = $1
           AND ${EDUCATION_ENTITLEMENT_SQL}
           AND ${VERIFIED_STUDENT_ACCOUNT_SQL}
         ORDER BY s.activated_at DESC
         LIMIT 1`,
        [tail],
      );
    }
  }

  if (!row) return null;
  const summary = await mapSummaryWithCurrentAllowance(row);
  if (summary.status !== 'active') return null;
  return { id: row.id, user_id: row.user_id, summary };
}

async function lockActiveEntitlementByPhone(
  client: QueryClient,
  phone: string,
): Promise<StudentDiscountUserLookupRow | null> {
  const tail = normalizePhoneTail(phone);
  if (tail.length !== 10) return null;

  const result = await client.query<StudentDiscountUserLookupRow>(
    `SELECT s.id, s.user_id, s.status, s.source_token, s.source_url, s.student_account_id,
            s.activated_at, s.expires_at, s.print_sheets_used, s.binding_uses, s.created_at, s.updated_at
     FROM student_discount_entitlements s
     JOIN users u ON u.id = s.user_id
     WHERE RIGHT(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), 10) = $1
       AND ${EDUCATION_ENTITLEMENT_SQL}
       AND s.status = 'active'
       AND s.expires_at >= NOW()
       AND ${VERIFIED_STUDENT_ACCOUNT_SQL}
     ORDER BY s.activated_at DESC
     LIMIT 1
     FOR UPDATE OF s`,
    [tail],
  );
  return result.rows[0] ?? null;
}

async function loadReceiptItemSlugs(
  client: QueryClient,
  productIds: string[],
): Promise<Map<string, StudentDiscountReceiptItemLookupRow>> {
  if (productIds.length === 0) {
    return new Map();
  }

  const result = await client.query<StudentDiscountReceiptItemLookupRow>(
    `SELECT p.id AS product_id,
            COALESCE(p.metadata->>'service_option_slug', so.slug) AS service_option_slug,
            so.name AS service_option_name
     FROM products p
     LEFT JOIN service_options so ON so.product_id = p.id
     WHERE p.id = ANY($1::uuid[])`,
    [productIds],
  );

  return new Map(result.rows.map(row => [row.product_id, row]));
}

export async function restoreStudentDiscountUsageForReceiptWithClient(
  client: QueryClient,
  params: { receiptId: string },
): Promise<StudentDiscountReceiptUsage | null> {
  const result = await client.query<StudentDiscountRedemptionUsageRow>(
    `SELECT entitlement_id, user_id, allowance_period_id, benefit_type, SUM(units) AS units
     FROM student_discount_redemptions
     WHERE pos_receipt_id = $1
     GROUP BY entitlement_id, user_id, allowance_period_id, benefit_type`,
    [params.receiptId],
  );

  if (result.rows.length === 0) return null;

  const entitlementId = result.rows[0]!.entitlement_id;
  const userId = result.rows[0]!.user_id;
  await client.query(
    `SELECT id
     FROM student_discount_entitlements
     WHERE id = $1
     FOR UPDATE`,
    [entitlementId],
  );

  let printSheets = 0;
  let legacyPrintSheets = 0;
  let bindingUses = 0;
  for (const row of result.rows) {
    const units = Math.max(0, Math.floor(toNumber(row.units)));
    if (isStudentPrintDiscountBenefit(row.benefit_type)) {
      printSheets += units;
      if (row.allowance_period_id) {
        await client.query(
          `UPDATE student_allowance_periods
              SET sheets_used = GREATEST(0, sheets_used - $2),
                  updated_at = NOW()
            WHERE id = $1`,
          [row.allowance_period_id, units],
        );
      } else {
        legacyPrintSheets += units;
      }
    } else if (row.benefit_type === 'photo_print') {
      if (row.allowance_period_id) {
        await client.query(
          `UPDATE student_allowance_periods
              SET photos_used = GREATEST(0, photos_used - $2),
                  updated_at = NOW()
            WHERE id = $1`,
          [row.allowance_period_id, units],
        );
      }
    } else {
      bindingUses += units;
    }
  }

  await client.query(
    `UPDATE student_discount_entitlements
        SET print_sheets_used = GREATEST(0, print_sheets_used - $2),
            binding_uses = GREATEST(0, binding_uses - $3),
            updated_at = NOW()
      WHERE id = $1`,
    [entitlementId, legacyPrintSheets, bindingUses],
  );

  await client.query(
    `DELETE FROM student_discount_redemptions WHERE pos_receipt_id = $1`,
    [params.receiptId],
  );

  await client.query(
    `UPDATE pos_receipts
        SET metadata = COALESCE(metadata, '{}'::jsonb) - 'student_discount'
      WHERE id = $1`,
    [params.receiptId],
  );

  return {
    entitlement_id: entitlementId,
    user_id: userId,
    print_sheets: printSheets,
    binding_uses: bindingUses,
  };
}

export async function restoreStudentDiscountUsageForReceiptItemsWithClient(
  client: QueryClient,
  params: {
    receiptId: string;
    items: Array<{ product_id: string; quantity: number }>;
  },
): Promise<StudentDiscountReceiptUsage | null> {
  const requestedByProduct = new Map<string, number>();
  for (const item of params.items) {
    const quantity = Math.max(0, Math.floor(toNumber(item.quantity)));
    if (!item.product_id || quantity <= 0) continue;
    requestedByProduct.set(item.product_id, (requestedByProduct.get(item.product_id) ?? 0) + quantity);
  }
  if (requestedByProduct.size === 0) return null;

  const result = await client.query<StudentDiscountPartialRedemptionRow>(
    `SELECT id, entitlement_id, user_id, allowance_period_id, benefit_type, units,
            discount_amount, metadata
     FROM student_discount_redemptions
     WHERE pos_receipt_id = $1
     ORDER BY created_at ASC, id ASC`,
    [params.receiptId],
  );
  if (result.rows.length === 0) return null;

  const entitlementId = result.rows[0]!.entitlement_id;
  const userId = result.rows[0]!.user_id;
  await client.query(
    `SELECT id
     FROM student_discount_entitlements
     WHERE id = $1
     FOR UPDATE`,
    [entitlementId],
  );

  let printSheets = 0;
  let legacyPrintSheets = 0;
  let bindingUses = 0;

  for (const row of result.rows) {
    const productId = metadataProductId(row.metadata);
    if (!productId) continue;

    const requested = requestedByProduct.get(productId) ?? 0;
    if (requested <= 0) continue;

    const currentUnits = Math.max(0, Math.floor(toNumber(row.units)));
    const restoredUnits = Math.min(currentUnits, requested);
    if (restoredUnits <= 0) continue;

    requestedByProduct.set(productId, requested - restoredUnits);

    if (isStudentPrintDiscountBenefit(row.benefit_type)) {
      printSheets += restoredUnits;
      if (row.allowance_period_id) {
        await client.query(
          `UPDATE student_allowance_periods
              SET sheets_used = GREATEST(0, sheets_used - $2),
                  updated_at = NOW()
            WHERE id = $1`,
          [row.allowance_period_id, restoredUnits],
        );
      } else {
        legacyPrintSheets += restoredUnits;
      }
    } else {
      bindingUses += restoredUnits;
    }

    const remainingUnits = currentUnits - restoredUnits;
    if (remainingUnits <= 0) {
      await client.query(
        `DELETE FROM student_discount_redemptions WHERE id = $1`,
        [row.id],
      );
    } else {
      const originalDiscount = Math.max(0, toNumber(row.discount_amount));
      const nextDiscount = Math.round((originalDiscount * remainingUnits / currentUnits + Number.EPSILON) * 100) / 100;
      const refundMetadata: StudentDiscountRedemptionMetadata = {
        partial_refunded_units: metadataRefundedUnits(row.metadata) + restoredUnits,
        partial_refunded_at: new Date().toISOString(),
      };
      await client.query(
        `UPDATE student_discount_redemptions
            SET units = $2,
                discount_amount = $3,
                metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
          WHERE id = $1`,
        [
          row.id,
          remainingUnits,
          nextDiscount,
          JSON.stringify(refundMetadata),
        ],
      );
    }
  }

  if (printSheets <= 0 && bindingUses <= 0) return null;

  if (legacyPrintSheets > 0 || bindingUses > 0) {
    await client.query(
      `UPDATE student_discount_entitlements
          SET print_sheets_used = GREATEST(0, print_sheets_used - $2),
              binding_uses = GREATEST(0, binding_uses - $3),
              updated_at = NOW()
        WHERE id = $1`,
      [entitlementId, legacyPrintSheets, bindingUses],
    );
  }

  await client.query(
    `UPDATE pos_receipts
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
    [
      params.receiptId,
      JSON.stringify({
        student_discount_partial_refund: {
          print_sheets: printSheets,
          binding_uses: bindingUses,
          refunded_at: new Date().toISOString(),
        },
      }),
    ],
  );

  return {
    entitlement_id: entitlementId,
    user_id: userId,
    print_sheets: printSheets,
    binding_uses: bindingUses,
  };
}

export async function recordStudentDiscountUsageForReceiptWithClient(
  client: QueryClient,
  params: {
    receiptId: string;
    customerPhone?: string | null;
    items: StudentDiscountReceiptItem[];
  },
): Promise<StudentDiscountReceiptUsage | null> {
  if (!params.customerPhone) return null;

  const candidateItems = params.items.filter(item =>
    item.discount_type === 'student' || item.student_discount_benefit,
  );
  if (candidateItems.length === 0) return null;

  const entitlement = await lockActiveEntitlementByPhone(client, params.customerPhone);
  if (!entitlement) {
    throw new AppError(409, 'Студенческая скидка не активна для этого телефона', ErrorCode.VALIDATION_ERROR);
  }

  const allowance = await ensureCurrentStudentAllowancePeriodWithClient(client, {
    entitlementId: entitlement.id,
    userId: entitlement.user_id,
    lock: true,
  });

  const productIds = [
    ...new Set(candidateItems
      .map(item => item.product_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ];
  const productMap = await loadReceiptItemSlugs(client, productIds);

  let printSheets = 0;
  let bindingUses = 0;
  const inserts: Array<{
    benefitType: StudentDiscountBenefitType;
    units: number;
    discountAmount: number;
    allowancePeriodId: string | null;
    printFillPercent: number | null;
    printOrderId: string | null;
    metadata: StudentDiscountRedemptionMetadata;
  }> = [];

  for (const item of candidateItems) {
    const product = item.product_id ? productMap.get(item.product_id) : null;
    const benefitType = item.student_discount_benefit
      ?? classifyStudentDiscountBenefit(product?.service_option_slug, product?.service_option_name ?? item.product_name);
    if (!benefitType) continue;

    const requestedUnits = Math.max(1, Math.floor(toNumber(item.student_discount_units ?? item.quantity)));
    const discountAmount = Math.max(0, toNumber(item.discount_amount));
    if (discountAmount <= 0) continue;

    let studentUnitPrice = STUDENT_DISCOUNT_BINDING_PRICE;
    if (isStudentPrintDiscountBenefit(benefitType)) {
      const printPrice = studentPrintPrice(benefitType, item.print_fill_percent);
      if (printPrice === null) {
        assertStudentPrintFillEligible(item.print_fill_percent);
        throw new AppError(409, 'Не удалось определить образовательную цену печати', ErrorCode.VALIDATION_ERROR);
      }
      studentUnitPrice = printPrice;
    }

    const unitPrice = toNumber(item.unit_price);
    if (unitPrice > 0) {
      const maxExpectedDiscount = Math.max(0, unitPrice - studentUnitPrice) * requestedUnits;
      if (discountAmount - maxExpectedDiscount > 1) {
        throw new AppError(409, 'Сумма образовательной скидки не совпадает с правилом', ErrorCode.VALIDATION_ERROR);
      }
    }

    if (isStudentPrintDiscountBenefit(benefitType)) {
      printSheets += requestedUnits;
    } else {
      bindingUses += requestedUnits;
    }
    inserts.push({
      benefitType,
      units: requestedUnits,
      discountAmount,
      allowancePeriodId: isStudentPrintDiscountBenefit(benefitType) ? allowance.id : null,
      printFillPercent: isStudentPrintDiscountBenefit(benefitType)
        ? normalizeStudentPrintFillPercent(item.print_fill_percent)
        : null,
      printOrderId: item.print_order_id ?? null,
      metadata: {
        product_id: item.product_id ?? null,
        product_name: item.product_name,
        units: requestedUnits,
        source: item.print_order_id ? 'online_print' : 'pos',
        printOrderId: item.print_order_id ?? undefined,
      },
    });
  }

  if (printSheets <= 0 && bindingUses <= 0) {
    return null;
  }

  const summary = mapSummary(entitlement, allowance);
  if (printSheets > summary.print_sheets_remaining || bindingUses > summary.binding_remaining) {
    throw new AppError(409, 'Лимит образовательной скидки уже исчерпан', ErrorCode.VALIDATION_ERROR);
  }

  if (printSheets > 0) {
    const allowanceUpdate = await client.query<StudentAllowancePeriodUpdateRow>(
      `UPDATE student_allowance_periods
          SET sheets_used = sheets_used + $2,
              updated_at = NOW()
        WHERE id = $1
          AND sheets_used + $2 <= sheet_limit
        RETURNING id`,
      [allowance.id, printSheets],
    );
    if (!allowanceUpdate.rows[0]) {
      throw new AppError(409, '30-дневный лимит образовательной печати уже исчерпан', ErrorCode.VALIDATION_ERROR);
    }
  }

  if (bindingUses > 0) {
    await client.query(
      `UPDATE student_discount_entitlements
          SET binding_uses = binding_uses + $2,
              updated_at = NOW()
        WHERE id = $1`,
      [entitlement.id, bindingUses],
    );
  }

  const values: unknown[] = [];
  const placeholders = inserts.map((item, index) => {
    const offset = index * 11;
    values.push(
      entitlement.id,
      entitlement.user_id,
      params.receiptId,
      params.customerPhone,
      item.benefitType,
      item.units,
      item.discountAmount,
      item.allowancePeriodId,
      item.printFillPercent,
      item.printOrderId,
      JSON.stringify(item.metadata),
    );
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11}::jsonb)`;
  });

  await client.query(
    `INSERT INTO student_discount_redemptions
       (entitlement_id, user_id, pos_receipt_id, customer_phone, benefit_type, units,
        discount_amount, allowance_period_id, print_fill_percent, print_order_id, metadata)
     VALUES ${placeholders.join(',')}`,
    values,
  );

  await client.query(
    `UPDATE pos_receipts
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
    [
      params.receiptId,
      JSON.stringify({
        student_discount: {
          entitlement_id: entitlement.id,
          user_id: entitlement.user_id,
          allowance_period_id: allowance.id,
          allowance_period_start: allowance.period_start,
          allowance_period_end: allowance.period_end,
          print_sheets: printSheets,
          binding_uses: bindingUses,
        },
      }),
    ],
  );

  return {
    entitlement_id: entitlement.id,
    user_id: entitlement.user_id,
    print_sheets: printSheets,
    binding_uses: bindingUses,
  };
}

/**
 * Списание rolling-30 лимита образовательной льготы по фактически покрытым единицам
 * account-скидки (документы/фото). Вызывается ПОСЛЕ создания чека — кап объёма уже
 * выполнен на этапе расчёта цены (pricing-engine, account_discount), поэтому списание мягкое
 * (без проверки <= лимита). Документы → sheets_used (+ benefit_type 'print_a4_bw' в аудите),
 * фото → photos_used (+ benefit_type 'photo_print'). Идемпотентно по uq_sdr_receipt_benefit_product.
 */
export async function recordEducationVolumeUsageForReceiptWithClient(
  client: QueryClient,
  params: {
    receiptId: string;
    customerPhone?: string | null;
    entitlementId: string;
    userId: string;
    documents: number;
    photos: number;
    documentDiscountAmount?: number;
    photoDiscountAmount?: number;
    printOrderId?: string | null;
  },
): Promise<{ documents: number; photos: number } | null> {
  const documents = Math.max(0, Math.floor(toNumber(params.documents)));
  const photos = Math.max(0, Math.floor(toNumber(params.photos)));
  if (documents <= 0 && photos <= 0) return null;

  const allowance = await ensureCurrentStudentAllowancePeriodWithClient(client, {
    entitlementId: params.entitlementId,
    userId: params.userId,
    lock: true,
  });

  await client.query(
    `UPDATE student_allowance_periods
        SET sheets_used = sheets_used + $2,
            photos_used = photos_used + $3,
            updated_at = NOW()
      WHERE id = $1`,
    [allowance.id, documents, photos],
  );

  const rows: Array<{ benefitType: StudentDiscountBenefitType; units: number; discountAmount: number }> = [];
  if (documents > 0) {
    rows.push({ benefitType: 'print_a4_bw', units: documents, discountAmount: Math.max(0, toNumber(params.documentDiscountAmount)) });
  }
  if (photos > 0) {
    rows.push({ benefitType: 'photo_print', units: photos, discountAmount: Math.max(0, toNumber(params.photoDiscountAmount)) });
  }

  const source = params.printOrderId ? 'online_print' : 'pos';
  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const offset = index * 11;
    values.push(
      params.entitlementId,
      params.userId,
      params.receiptId,
      params.customerPhone ?? null,
      row.benefitType,
      row.units,
      row.discountAmount,
      allowance.id,
      null,
      params.printOrderId ?? null,
      JSON.stringify({ units: row.units, source }),
    );
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11}::jsonb)`;
  });

  await client.query(
    `INSERT INTO student_discount_redemptions
       (entitlement_id, user_id, pos_receipt_id, customer_phone, benefit_type, units,
        discount_amount, allowance_period_id, print_fill_percent, print_order_id, metadata)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (pos_receipt_id, benefit_type, COALESCE((metadata->>'product_id'),''))
       WHERE pos_receipt_id IS NOT NULL DO NOTHING`,
    values,
  );

  return { documents, photos };
}

/** Обёртка с собственной транзакцией — для вызова вне транзакции чека (best-effort пост-шаг). */
export async function recordEducationVolumeUsageForReceipt(
  params: {
    receiptId: string;
    customerPhone?: string | null;
    entitlementId: string;
    userId: string;
    documents: number;
    photos: number;
    documentDiscountAmount?: number;
    photoDiscountAmount?: number;
    printOrderId?: string | null;
  },
): Promise<{ documents: number; photos: number } | null> {
  return db.transaction(client => recordEducationVolumeUsageForReceiptWithClient(client, params));
}
