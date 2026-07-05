import db from '../database/db.js';

/**
 * Акция «Фото на студенческий — пакет 4 комплекта по 200 ₽» (800 ₽ за раз).
 *
 * Правила (решение владельца):
 *  - условие = подтверждённый образовательный аккаунт (`student_accounts.status='verified'`),
 *    БЕЗ требования платной подписки 199 ₽ (тариф education_verified тоже подходит);
 *  - продаётся пакетом РОВНО из 4 комплектов «Фото на студенческий» (`photo-student`) по 200 ₽,
 *    ни больше ни меньше — промо-цена включается только при количестве = размеру пакета;
 *  - один пакет на образовательный аккаунт навсегда (lifetime). Списание привязано к чеку POS
 *    и откатывается при возврате/аннулировании, освобождая акцию повторно.
 *
 * Леджер: `student_id_photo_promo_redemptions` (1 неотменённый ряд = пакет использован).
 */

interface QueryClient {
  query<Row = unknown>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Размер пакета (комплектов) — ровно столько и продаётся по промо-цене. */
export const STUDENT_ID_PHOTO_PROMO_PACK_QTY = readIntEnv('EDU_STUDENT_ID_PHOTO_PACK_QTY', 4);
/** Промо-цена одного комплекта «Фото на студенческий», ₽. */
export const STUDENT_ID_PHOTO_PROMO_UNIT_PRICE = readIntEnv('EDU_STUDENT_ID_PHOTO_PRICE', 200);
/** Slug услуги-комплекта в POS-каталоге (service_options). */
export const STUDENT_ID_PHOTO_PROMO_SLUG = 'photo-student';

export interface StudentIdPhotoPromoState {
  studentAccountId: string;
  userId: string;
  /** true — акция ещё доступна (аккаунт подтверждён и пакет не использован в текущем окне). */
  available: boolean;
  /** Ключ окна: 'lifetime' (без подписки, один раз) либо 'YYYY-MM-DD' периода (подписка, каждый месяц). */
  periodKey: string;
  /** true — активная образовательная подписка (пакет обновляется каждые 30 дней). */
  isSubscriber: boolean;
}

export interface StudentIdPhotoPromoPricing {
  /** Итоговая цена всего пакета (unitPrice × packQty). */
  total: number;
  /** Кол-во комплектов в пакете. */
  units: number;
  /** Цена одного комплекта по акции. */
  unitPrice: number;
  /** Сумма экономии относительно базовой цены. */
  discountAmount: number;
  label: string;
}

function normalizePhoneTail(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

interface PromoStateRow {
  student_account_id: string;
  user_id: string;
  period_key: string;
  is_subscriber: boolean;
  available: boolean;
}

const VERIFIED_ACCOUNT_WHERE = `
  a.status = 'verified'
  AND (a.expires_at IS NULL OR a.expires_at >= NOW())
`;

// Формула начала текущего rolling-30 окна по activated_at энтайтлмента — каноничный аналог
// currentStudentAllowancePeriodStartSql() из student-discount.service (инлайн, чтобы не тащить
// связность/моки большого модуля; период стабилен = 30 дней).
const ALLOWANCE_PERIOD_DAYS = 30;
const ALLOWANCE_PERIOD_SECONDS = ALLOWANCE_PERIOD_DAYS * 24 * 60 * 60;
const SUBSCRIBER_PERIOD_START_SQL = `s.activated_at + (
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - s.activated_at)) / ${ALLOWANCE_PERIOD_SECONDS})::integer)
  * INTERVAL '${ALLOWANCE_PERIOD_DAYS} days'
)`;
/** Ключ периода подписчика = дата начала текущего rolling-30 окна (YYYY-MM-DD). */
const SUBSCRIBER_PERIOD_KEY_SQL = `to_char((${SUBSCRIBER_PERIOD_START_SQL}), 'YYYY-MM-DD')`;

/**
 * Хвост запроса состояния акции: по найденному verified-аккаунту (CTE acct) определяет тариф
 * (подписка education_subscription → ключ периода; иначе 'lifetime') и доступность пакета в
 * текущем окне (нет списания с этим period_key).
 */
const PROMO_STATE_TAIL_SQL = `
  sub AS (
    SELECT ${SUBSCRIBER_PERIOD_KEY_SQL} AS period_start_key
    FROM student_discount_entitlements s
    JOIN acct ON acct.user_id = s.user_id
    WHERE s.source_token = 'education_subscription'
      AND s.status = 'active'
      AND (s.expires_at IS NULL OR s.expires_at >= NOW())
    ORDER BY s.activated_at DESC
    LIMIT 1
  )
  SELECT acct.student_account_id, acct.user_id,
         COALESCE((SELECT period_start_key FROM sub), 'lifetime') AS period_key,
         ((SELECT period_start_key FROM sub) IS NOT NULL) AS is_subscriber,
         NOT EXISTS (
           SELECT 1 FROM student_id_photo_promo_redemptions r
           WHERE r.student_account_id = acct.student_account_id
             AND r.period_key = COALESCE((SELECT period_start_key FROM sub), 'lifetime')
         ) AS available
  FROM acct
`;

/**
 * Услуга-комплект «Фото на студенческий». Совпадение по slug (`photo-student`) либо
 * по названию («фото на студенческий»), чтобы переживать смену slug-схемы каталога.
 */
export function isStudentIdPhotoPromoTarget(slug: string | null | undefined, name = ''): boolean {
  const normalizedSlug = (slug ?? '').trim().toLowerCase();
  if (normalizedSlug === STUDENT_ID_PHOTO_PROMO_SLUG) return true;
  const normalizedName = name.trim().toLowerCase().replace(/ё/g, 'е');
  return normalizedName.includes('фото на студенческий');
}

/**
 * Состояние акции для клиента (по userId или телефону). null — если нет подтверждённого
 * образовательного аккаунта. available=false — аккаунт есть, но пакет уже использован.
 */
export async function getStudentIdPhotoPromoState(params: {
  userId?: string | null;
  customerPhone?: string | null;
}): Promise<StudentIdPhotoPromoState | null> {
  let row: PromoStateRow | null = null;

  if (params.userId) {
    row = await db.queryOne<PromoStateRow>(
      `WITH acct AS (
         SELECT a.id AS student_account_id, a.user_id
         FROM student_accounts a
         WHERE ${VERIFIED_ACCOUNT_WHERE}
           AND a.user_id = $1
         ORDER BY a.verified_at DESC NULLS LAST
         LIMIT 1
       ),
       ${PROMO_STATE_TAIL_SQL}`,
      [params.userId],
    );
  }

  if (!row && params.customerPhone) {
    const tail = normalizePhoneTail(params.customerPhone);
    if (tail.length === 10) {
      row = await db.queryOne<PromoStateRow>(
        `WITH acct AS (
           SELECT a.id AS student_account_id, a.user_id
           FROM student_accounts a
           JOIN users u ON u.id = a.user_id
           WHERE ${VERIFIED_ACCOUNT_WHERE}
             AND RIGHT(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), 10) = $1
           ORDER BY a.verified_at DESC NULLS LAST
           LIMIT 1
         ),
         ${PROMO_STATE_TAIL_SQL}`,
        [tail],
      );
    }
  }

  if (!row) return null;
  return {
    studentAccountId: row.student_account_id,
    userId: row.user_id,
    available: row.available,
    periodKey: row.period_key,
    isSubscriber: row.is_subscriber,
  };
}

/**
 * Промо-цена пакета для позиции. Возвращает null, если позиция не подходит, акция недоступна,
 * количество ≠ размеру пакета, или базовая цена уже не выше промо-цены.
 */
export function calculateStudentIdPhotoPromoForItem(params: {
  state: StudentIdPhotoPromoState | null;
  slug: string;
  name: string;
  basePrice: number;
  quantity: number;
}): StudentIdPhotoPromoPricing | null {
  const { state } = params;
  if (!state || !state.available) return null;
  if (!isStudentIdPhotoPromoTarget(params.slug, params.name)) return null;
  if (params.quantity !== STUDENT_ID_PHOTO_PROMO_PACK_QTY) return null;
  if (params.basePrice <= STUDENT_ID_PHOTO_PROMO_UNIT_PRICE) return null;

  const units = STUDENT_ID_PHOTO_PROMO_PACK_QTY;
  const total = STUDENT_ID_PHOTO_PROMO_UNIT_PRICE * units;
  const discountAmount = Math.max(0, params.basePrice * units - total);
  return {
    total,
    units,
    unitPrice: STUDENT_ID_PHOTO_PROMO_UNIT_PRICE,
    discountAmount,
    label: `Акция: ${units} комплекта по ${STUDENT_ID_PHOTO_PROMO_UNIT_PRICE}₽`,
  };
}

/**
 * Списать пакет на образовательный аккаунт при пробитии чека / оплате счёта. Идемпотентно и
 * гонко-безопасно: UNIQUE(student_account_id, period_key) + ON CONFLICT DO NOTHING — один пакет
 * на (аккаунт × окно: 'lifetime' либо период подписки). Возвращает true, если списание записано.
 */
export async function recordStudentIdPhotoPromoForReceiptWithClient(
  client: QueryClient,
  params: {
    receiptId: string | null;
    studentAccountId: string;
    userId: string;
    periodKey: string;
    units: number;
    unitPrice: number;
    discountAmount: number;
    customerPhone?: string | null;
    printOrderId?: string | null;
    paymentLinkId?: string | null;
    source?: 'pos' | 'online' | 'online_print';
  },
): Promise<boolean> {
  const source = params.source
    ?? (params.paymentLinkId ? 'online' : params.printOrderId ? 'online_print' : 'pos');
  const result = await client.query<{ id: string }>(
    `INSERT INTO student_id_photo_promo_redemptions
       (student_account_id, user_id, period_key, units, unit_price, discount_amount,
        pos_receipt_id, print_order_id, payment_link_id, customer_phone, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (student_account_id, period_key) DO NOTHING
     RETURNING id`,
    [
      params.studentAccountId,
      params.userId,
      params.periodKey,
      params.units,
      params.unitPrice,
      params.discountAmount,
      params.receiptId,
      params.printOrderId ?? null,
      params.paymentLinkId ?? null,
      params.customerPhone ?? null,
      JSON.stringify({ source }),
    ],
  );
  return result.rows.length > 0;
}

/** Откат пакета при возврате/аннулировании чека — освобождает акцию в этом окне повторно. */
export async function restoreStudentIdPhotoPromoForReceiptWithClient(
  client: QueryClient,
  params: { receiptId: string },
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `DELETE FROM student_id_photo_promo_redemptions
      WHERE pos_receipt_id = $1
      RETURNING id`,
    [params.receiptId],
  );
  return result.rows.length;
}

/** Откат пакета при возврате онлайн-оплаты по счёту (payment_link). */
export async function restoreStudentIdPhotoPromoForPaymentLinkWithClient(
  client: QueryClient,
  params: { paymentLinkId: string },
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `DELETE FROM student_id_photo_promo_redemptions
      WHERE payment_link_id = $1
      RETURNING id`,
    [params.paymentLinkId],
  );
  return result.rows.length;
}
