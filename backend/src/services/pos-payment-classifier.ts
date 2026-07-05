/**
 * Классификатор исхода безналичной оплаты (op1) кассы.
 *
 * Корень инцидента CRM-260602-HGKP: при перезагрузке терминала PAX сразу
 * после оплаты ответ с RRN не вернулся, обрыв связи касса↔INPAS драйвер
 * записали как `failed`, чек не выбили, расхождение касса↔банк никто не
 * поймал. Истина: timeout/обрыв НЕ равен отказу — деньги могли списаться.
 *
 * Чистые функции (без БД/IO) — переиспользуемы Rust-портом Этапа 2 и
 * покрыты vitest на реальных сэмплах из логов инцидента.
 *
 * Эффективный статус оплаты живёт в COALESCE(payment_resolution, status):
 * Node пишет только `payment_resolution` (in_doubt/resolved_*), Rust пишет
 * `status` как раньше — это физически исключает гонку Rust↔Node.
 */

/** Результат классификации провалившейся (success=false) оплаты op1. */
export type FailedPaymentClassification = 'in_doubt' | 'failed';

/** Минимально необходимые поля транзакции для классификации. */
export interface FailedPaymentInput {
  /** Текст ошибки терминала/драйвера (pos_transactions.error_message). */
  readonly error_message?: string | null;
  /** RRN банковской операции (pos_transactions.rrn). Есть → банк ответил. */
  readonly rrn?: string | null;
}

/**
 * Маркеры неопределённости (in_doubt) — обрыв/таймаут, ответ банка НЕ получен.
 * Источник: реальные логи инцидента (POS_AGENT_LOGS / INCIDENT_HGKP):
 *  - `Connection error: ...:9015` — обрыв связи касса↔INPAS DualConnector;
 *  - `Вышел таймаут ожидания ответа платежа` — field 19 INPAS (op1 timeout);
 *  - общий `timeout` / `вышел таймаут` — таймаут на любом уровне;
 *  - `error sending request` — запрос не доставлен (терминал офлайн).
 */
const IN_DOUBT_MARKERS: readonly string[] = [
  'connection error',
  'вышел таймаут',
  'таймаут ожидания',
  'timeout',
  'timed out',
  'error sending request',
  'connection refused',
  'connection reset',
  'econnrefused',
  'econnreset',
  'etimedout',
];

/**
 * Маркеры явного отказа терминала (failed) — банк/терминал ОТВЕТИЛ отказом,
 * деньги НЕ списаны. Если совпал такой маркер — это настоящий failed, не in_doubt.
 * Source: типовые ответы эквайринга (field 39 != 0 с текстом отказа).
 */
const EXPLICIT_DECLINE_MARKERS: readonly string[] = [
  'отклонен',
  'отклонён',
  'declined',
  'недостаточно средств',
  'insufficient funds',
  'отказ',
  'отменен клиентом',
  'отменён клиентом',
  'cancelled by',
  'отмена операции',
  'неверный пин',
  'неверный pin',
  'incorrect pin',
  'карта заблокирована',
  'card blocked',
  'do not honor',
  'error 16',
  'код ошибки 16',
];

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function hasMarker(haystack: string, markers: readonly string[]): boolean {
  return markers.some(marker => haystack.includes(marker));
}

/**
 * Классифицирует провалившуюся оплату (success=false / status='failed').
 *
 * Правила (в порядке приоритета):
 *  1. Есть RRN → банк гарантированно ответил → исход определён → `failed`
 *     (явный отказ; при успехе сюда бы не попали).
 *  2. Текст содержит явный отказ (declined/недостаточно средств/...) → `failed`.
 *  3. Текст содержит маркер обрыва/таймаута → `in_doubt`.
 *  4. Текст пустой (нет ответа вообще) → `in_doubt` (таймаут без сообщения).
 *  5. Иначе (есть текст, но не распознан) → `failed` (консервативно: не
 *     помечаем сомнительным то, что выглядит как обычная ошибка).
 *
 * Замечание: для безопасности денег важнее НЕ пропустить in_doubt, чем НЕ
 * пометить лишний failed как in_doubt. Но правило 5 оставляет нераспознанный
 * текст в `failed`, чтобы не плодить ложные in_doubt на обычных отказах —
 * корпус маркеров обрыва покрывает реальные кейсы инцидента.
 */
export function classifyFailedPayment(input: FailedPaymentInput): FailedPaymentClassification {
  const rrn = normalize(input.rrn);
  if (rrn.length > 0) {
    return 'failed';
  }

  const message = normalize(input.error_message);

  if (message.length > 0 && hasMarker(message, EXPLICIT_DECLINE_MARKERS)) {
    return 'failed';
  }

  if (message.length === 0) {
    // Нет RRN и нет текста ошибки — ответ терминала не получен вовсе.
    return 'in_doubt';
  }

  if (hasMarker(message, IN_DOUBT_MARKERS)) {
    return 'in_doubt';
  }

  return 'failed';
}

/** Поля строки pos_transactions для расчёта эффективного статуса оплаты. */
export interface EffectivePaymentStatusInput {
  readonly status?: string | null;
  readonly payment_resolution?: string | null;
}

/**
 * Эффективный статус оплаты = COALESCE(payment_resolution, status).
 *
 * `payment_resolution` (in_doubt/resolved_paid/resolved_unpaid) пишет только
 * Node и доминирует над сырым `status` из Rust. Если resolution не задан —
 * берём сырой status. Хелпер используется и в SELECT'ах, и в логике фронта.
 */
export function effectivePaymentStatus(row: EffectivePaymentStatusInput): string | null {
  const resolution = row.payment_resolution;
  if (typeof resolution === 'string' && resolution.trim().length > 0) {
    return resolution;
  }
  return row.status ?? null;
}
