/**
 * Сверка эквайринга при закрытии смены (контур #2).
 *
 * При закрытии POS-смены инициируется bank_settlement (op59), отчёт терминала
 * парсится, безнал кассы (SUM card completed за смену) сравнивается с итогом
 * терминала, результат пишется в `pos_shift_reconciliation`. Закрытие смены НЕ
 * блокируется (бриф: только сверка + запись + индикация). Авто-алерт владельцу
 * — ТОЛЬКО за фича-флагом POS_RECON_ALERT_ENABLED (default OFF, P0-1: на проде
 * соответствие касса card ↔ терминал карты/QR неоднозначно, копим данные).
 *
 * Ограничения INPAS DualConnector (см. RUST_POS_AGENT_CONTEXT / память):
 *  - op59 отдаёт ТОЛЬКО plain-text отчёт (field 90), без структурированных сумм
 *    → парсер хрупкий, fail-soft (нераспознан формат → low_confidence, не алерт);
 *  - повторная op59 за день даёт ПУСТОЙ отчёт (батч обнулён) → no_operations,
 *    НЕ ложное расхождение;
 *  - битый win-1251 в отчёте (mojibake) → parse_error.
 *
 * Реальные сэмплы отчёта (pos_transactions.terminal_response.bank_report,
 * терминал 11087928):
 *   ОПЕРАЦИИ ПО КАРТАМ:68'360.50 RUB
 *   ОПЕРАЦИИ ПО QR:     9'656.00 RUB
 *   ИТОГО :            78'016.50 RUB
 * Разделитель тысяч = апостроф; «RUB» латиницей; пустой отчёт = «ОТЧЕТ ЗАВЕРШЕН»
 * без строк операций.
 */
import db from '../database/db.js';
import { config } from '../config/index.js';
import { recordBusinessEvent } from './business-observability.service.js';
import { findPosAgentId } from './cash-drawer.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pos-reconciliation');

/** Порог расхождения касса↔терминал (₽), мельче — округление/комиссии. */
const RECONCILIATION_DIFF_THRESHOLD_RUB = 1;

/** Окно, в течение которого уже сделанная op59 считается «свежей» (дедуп). */
const RECENT_SETTLEMENT_WINDOW_HOURS = 12;

/** Статусы строки pos_shift_reconciliation (зафиксированы в S0 DDL). */
export type ReconciliationStatus =
  | 'pending'
  | 'ok'
  | 'mismatch'
  | 'low_confidence'
  | 'no_operations'
  | 'settlement_failed'
  | 'no_agent';

/** Результат парсинга plain-text отчёта op59. */
export interface ParsedSettlementReport {
  /** Сумма «ОПЕРАЦИИ ПО КАРТАМ» (₽) или null, если строка не распознана. */
  cardSum: number | null;
  /** Сумма «ОПЕРАЦИИ ПО QR» (₽) или null. */
  qrSum: number | null;
  /** Сумма «ИТОГО» (₽) или null. */
  totalSum: number | null;
  /** true — формат распознан и есть хотя бы одна сумма; false — fail-soft. */
  confident: boolean;
  /** Машинная причина исхода парсинга (для status/notes). */
  reason: 'parsed' | 'no_operations' | 'parse_error' | 'empty';
}

/**
 * Парсит сырую сумму вида `68'360.50` / `9 656,00` / `78016.50` в число рублей.
 * Убирает апострофы и пробелы (разделители тысяч), запятую трактует как точку.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/['\s ]/g, '')
    .replace(',', '.')
    .replace(/[^0-9.]/g, '');
  if (cleaned.length === 0) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Извлекает сумму из строки отчёта по списку меток (первое совпадение).
 * Пример: matchLine(text, ['ОПЕРАЦИИ ПО КАРТАМ']) → 68360.50.
 */
function matchAmount(report: string, labels: readonly string[]): number | null {
  const lines = report.split(/\r?\n/);
  for (const line of lines) {
    const upper = line.toUpperCase();
    for (const label of labels) {
      const idx = upper.indexOf(label.toUpperCase());
      if (idx >= 0) {
        const tail = line.slice(idx + label.length);
        const parsed = parseAmount(tail);
        if (parsed !== null) return parsed;
      }
    }
  }
  return null;
}

/**
 * Признак mojibake (битая кодировка win-1251) — много U+FFFD или подряд `?`.
 * Реальный сэмпл aa24cbb3: bank_report = «??? ?????? ??? ?????».
 */
function looksLikeMojibake(report: string): boolean {
  if (report.includes('�')) return true;
  // Несколько групп из >=3 подряд знаков вопроса — почти наверняка битая кодировка.
  const questionGroups = report.match(/\?{3,}/g);
  return (questionGroups?.length ?? 0) >= 2;
}

/**
 * Парсер отчёта op59 (fail-soft). Никогда не бросает; неуверенность → confident:false.
 */
export function parseSettlementReport(report: string | null | undefined): ParsedSettlementReport {
  const text = (report ?? '').trim();

  if (text.length === 0) {
    return { cardSum: null, qrSum: null, totalSum: null, confident: false, reason: 'empty' };
  }

  if (looksLikeMojibake(text)) {
    return { cardSum: null, qrSum: null, totalSum: null, confident: false, reason: 'parse_error' };
  }

  const cardSum = matchAmount(text, ['ОПЕРАЦИИ ПО КАРТАМ']);
  const qrSum = matchAmount(text, ['ОПЕРАЦИИ ПО QR']);
  const totalSum = matchAmount(text, ['ИТОГО']);

  const hasAnyAmount = cardSum !== null || qrSum !== null || totalSum !== null;

  if (!hasAnyAmount) {
    // Отчёт завершён, но строк операций нет → батч пуст (повторная op59 за день).
    const completed = text.toUpperCase().includes('ОТЧЕТ ЗАВЕРШЕН') || text.toUpperCase().includes('ОТЧЁТ ЗАВЕРШЕН');
    return {
      cardSum: null,
      qrSum: null,
      totalSum: null,
      confident: false,
      reason: completed ? 'no_operations' : 'parse_error',
    };
  }

  return { cardSum, qrSum, totalSum, confident: true, reason: 'parsed' };
}

/** Числовые входы для оценки сверки. */
export interface ReconciliationEvalInput {
  /** Безнал кассы за смену (₽): SUM card completed, без transfer/cash. */
  cashCardNet: number;
  /** Разобранный отчёт терминала. */
  parsed: ParsedSettlementReport;
}

/** Итог оценки сверки. */
export interface ReconciliationEvalResult {
  status: ReconciliationStatus;
  /** Лучшая «терминальная» сумма для сравнения (карты, либо итого, либо null). */
  terminalCompareSum: number | null;
  /** Абсолютное расхождение касса↔терминал (₽) или null. */
  diff: number | null;
  notes: string;
}

/**
 * Оценивает результат сверки БЕЗ записи в БД и БЕЗ алерта (чистая логика).
 *
 * Сравнение касса card ↔ терминал: P0-1 — на проде неоднозначно (касса card
 * может включать QR). Для оценки берём сумму «по картам» как первичную; если её
 * нет, но есть «ИТОГО» — сравниваем с итого (помечая в notes). Расхождение
 * больше порога → mismatch; в пределах порога → ok.
 */
export function evaluateReconciliation(input: ReconciliationEvalInput): ReconciliationEvalResult {
  const { cashCardNet, parsed } = input;

  if (parsed.reason === 'no_operations' || parsed.reason === 'empty') {
    return {
      status: 'no_operations',
      terminalCompareSum: null,
      diff: null,
      notes: 'Отчёт терминала без операций (батч пуст или повторная сверка за день)',
    };
  }

  if (!parsed.confident) {
    return {
      status: 'low_confidence',
      terminalCompareSum: null,
      diff: null,
      notes: 'Формат отчёта терминала не распознан, сверка не выполнена',
    };
  }

  const terminalCompareSum = parsed.cardSum ?? parsed.totalSum;
  if (terminalCompareSum === null) {
    return {
      status: 'low_confidence',
      terminalCompareSum: null,
      diff: null,
      notes: 'В отчёте терминала нет суммы по картам и итога',
    };
  }

  const diff = Math.round((cashCardNet - terminalCompareSum) * 100) / 100;
  const base = parsed.cardSum !== null
    ? 'сравнение с суммой по картам терминала'
    : 'сравнение с итогом терминала (сумма по картам отсутствует)';

  if (Math.abs(diff) <= RECONCILIATION_DIFF_THRESHOLD_RUB) {
    return {
      status: 'ok',
      terminalCompareSum,
      diff,
      notes: `Суммы совпадают (${base})`,
    };
  }

  return {
    status: 'mismatch',
    terminalCompareSum,
    diff,
    notes: `Расхождение касса ${cashCardNet.toFixed(2)} ₽ и терминал ${terminalCompareSum.toFixed(2)} ₽ (${base})`,
  };
}

/**
 * Безнал кассы за смену для сверки (₽): SUM card completed.
 *
 * Контракт P0-1: только `card`. `transfer` (банк-перевод НЕ через терминал) и
 * `cash` исключены. Колонок is_refund/voided_at в pos_receipt_payments НЕТ
 * (проверено по схеме) — поэтому фильтр только по payment_type/status, как в
 * существующей агрегации налички (pos.service.ts:535).
 */
export async function computeShiftCardNet(shiftId: string): Promise<number> {
  const row = await db.queryOne<{ sum: string }>(
    `SELECT COALESCE(SUM(rp.amount), 0) AS sum
     FROM pos_receipt_payments rp
     JOIN pos_receipts r ON rp.receipt_id = r.id
     WHERE r.shift_id = $1
       AND rp.payment_type = 'card'
       AND rp.status = 'completed'`,
    [shiftId],
  );
  const value = Number.parseFloat(row?.sum ?? '0');
  return Number.isFinite(value) ? value : 0;
}

/** Запись pos_shift_reconciliation для дозаписи (минимальный набор). */
interface PendingReconciliationRow {
  id: string;
  shift_id: string;
  studio_id: string;
  cash_card_sum: string | null;
}

/**
 * Дозапись результата op59 в pending-строку сверки.
 *
 * Вызывается из redis-subscriber при `pos:transaction_update`, когда
 * settlement_tx_id совпадает с pending-строкой (P0-2). Парсит отчёт ИЗ
 * пейлоада, считает diff, пишет статус. Алерт — только за флагом.
 *
 * @param settlementTxId id транзакции bank_settlement (из payload).
 * @param bankReport     сырой текст отчёта op59 (из payload или БД).
 * @param settlementStatus статус транзакции settlement из payload ('completed'/'failed'/...).
 */
export async function finalizeShiftReconciliation(
  settlementTxId: string,
  bankReport: string | null | undefined,
  settlementStatus: string | null | undefined,
): Promise<void> {
  const pending = await db.queryOne<PendingReconciliationRow>(
    `SELECT id, shift_id, studio_id, cash_card_sum
     FROM pos_shift_reconciliation
     WHERE settlement_tx_id = $1 AND status = 'pending'`,
    [settlementTxId],
  );
  if (!pending) {
    // Чужая транзакция / уже финализирована — no-op.
    return;
  }

  // Если op59 не завершилась успехом — settlement_failed (отчёта нет/ненадёжен).
  const settlementOk = (settlementStatus ?? '').toLowerCase() === 'completed';

  let evalResult: ReconciliationEvalResult;
  let parsed: ParsedSettlementReport;

  if (!settlementOk) {
    parsed = { cardSum: null, qrSum: null, totalSum: null, confident: false, reason: 'parse_error' };
    evalResult = {
      status: 'settlement_failed',
      terminalCompareSum: null,
      diff: null,
      notes: `Сверка эквайринга (op59) не завершилась (status=${settlementStatus ?? 'unknown'})`,
    };
  } else {
    parsed = parseSettlementReport(bankReport);
    const cashCardNet = Number.parseFloat(pending.cash_card_sum ?? '0') || 0;
    evalResult = evaluateReconciliation({ cashCardNet, parsed });
  }

  await db.query(
    `UPDATE pos_shift_reconciliation
     SET terminal_card_sum = $2,
         terminal_qr_sum = $3,
         terminal_total_sum = $4,
         status = $5,
         raw_report = $6,
         notes = $7,
         updated_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [
      pending.id,
      parsed.cardSum,
      parsed.qrSum,
      parsed.totalSum,
      evalResult.status,
      bankReport ?? null,
      evalResult.notes,
    ] as unknown[],
  );

  log.info('shift reconciliation finalized', {
    reconciliationId: pending.id,
    shiftId: pending.shift_id,
    settlementTxId,
    status: evalResult.status,
    diff: evalResult.diff,
  });

  maybeAlertReconciliation({
    studioId: pending.studio_id,
    shiftId: pending.shift_id,
    reconciliationId: pending.id,
    status: evalResult.status,
    diff: evalResult.diff,
    notes: evalResult.notes,
  });
}

interface AlertReconciliationInput {
  studioId: string;
  shiftId: string;
  reconciliationId: string;
  status: ReconciliationStatus;
  diff: number | null;
  notes: string;
}

/**
 * Авто-алерт владельцу о расхождении — ТОЛЬКО за флагом POS_RECON_ALERT_ENABLED
 * (default OFF). Бизнес-событие пишется всегда (наблюдаемость), но `alert:true`
 * выставляется лишь при включённом флаге и статусе, требующем внимания.
 */
function maybeAlertReconciliation(input: AlertReconciliationInput): void {
  const needsAttention =
    input.status === 'mismatch' ||
    input.status === 'low_confidence' ||
    input.status === 'settlement_failed';

  const alertEnabled = config.pos.reconAlertEnabled && needsAttention;

  recordBusinessEvent({
    domain: 'pos',
    event: 'shift_reconciliation',
    outcome: input.status === 'ok' || input.status === 'no_operations' ? 'success' : 'failure',
    severity: needsAttention ? 'warn' : 'info',
    entityType: 'pos_shift_reconciliation',
    entityId: input.reconciliationId,
    metadata: {
      studio_id: input.studioId,
      shift_id: input.shiftId,
      status: input.status,
      diff: input.diff,
      notes: input.notes,
    },
    alert: alertEnabled
      ? {
          key: `pos_reconciliation_${input.studioId}`,
          title: 'Расхождение сверки кассы и терминала',
        }
      : false,
  });
}

/** Результат постановки сверки в очередь. */
export interface EnqueueReconciliationResult {
  reconciliationId: string | null;
  /** Поставлена ли op59 (false — дедуп/нет агента/уже есть строка). */
  enqueued: boolean;
  status: ReconciliationStatus;
}

/**
 * Ставит сверку смены в очередь: фиксирует безнал кассы, INSERT pending-строки и
 * (при отсутствии дедупа) bank_settlement (op59).
 *
 * Дедуп (P1-1): если bank_settlement для этой студии уже завершилась за
 * последние RECENT_SETTLEMENT_WINDOW_HOURS — повторную op59 НЕ слать (она
 * обнулит батч и даст пустой отчёт). Строка сверки помечается no_operations с
 * пояснением, владелец смотрит существующую сверку.
 *
 * Идемпотентность: UNIQUE(shift_id) — повторный вызов на закрытой смене не
 * создаёт дубль (ON CONFLICT DO NOTHING).
 *
 * Вызывается fire-and-forget из closeShift (S2) — НЕ блокирует закрытие.
 */
export async function enqueueShiftReconciliation(
  shiftId: string,
  studioId: string,
): Promise<EnqueueReconciliationResult> {
  // Уже есть строка сверки для смены? (UNIQUE shift_id) — не дублируем.
  const existing = await db.queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM pos_shift_reconciliation WHERE shift_id = $1`,
    [shiftId],
  );
  if (existing) {
    log.info('shift reconciliation already exists, skipping', { shiftId, status: existing.status });
    return { reconciliationId: existing.id, enqueued: false, status: existing.status as ReconciliationStatus };
  }

  const cashCardNet = await computeShiftCardNet(shiftId);

  const agentId = await findPosAgentId(studioId);

  // Дедуп op59: была ли завершённая bank_settlement за окно?
  const recentSettlement = await db.queryOne<{ id: string }>(
    `SELECT id FROM pos_transactions
     WHERE studio_id = $1
       AND transaction_type = 'bank_settlement'
       AND status = 'completed'
       AND initiated_at >= NOW() - ($2::int * INTERVAL '1 hour')
     ORDER BY initiated_at DESC
     LIMIT 1`,
    [studioId, RECENT_SETTLEMENT_WINDOW_HOURS],
  );

  // Нет агента — записываем no_agent, op59 не слать.
  if (!agentId) {
    const row = await insertReconciliationRow({
      shiftId,
      studioId,
      settlementTxId: null,
      cashCardNet,
      status: 'no_agent',
      notes: 'POS-агент не подключён, сверка эквайринга не выполнена',
    });
    return { reconciliationId: row?.id ?? null, enqueued: false, status: 'no_agent' };
  }

  // Дедуп: недавняя завершённая op59 — батч уже обнулён, повторно не слать.
  if (recentSettlement) {
    const row = await insertReconciliationRow({
      shiftId,
      studioId,
      settlementTxId: recentSettlement.id,
      cashCardNet,
      status: 'no_operations',
      notes: 'Сверка эквайринга уже выполнялась за смену, повторная op59 не отправлена',
    });
    return { reconciliationId: row?.id ?? null, enqueued: false, status: 'no_operations' };
  }

  // Ставим op59 в очередь (PG NOTIFY → print-api → MQTT → агент).
  const settlementTx = await db.queryOne<{ id: string }>(
    `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, status, initiated_by)
     VALUES ($1, $2, 'bank_settlement', 0, 'pending', NULL)
     RETURNING id`,
    [studioId, agentId],
  );

  const row = await insertReconciliationRow({
    shiftId,
    studioId,
    settlementTxId: settlementTx?.id ?? null,
    cashCardNet,
    status: 'pending',
    notes: 'Ожидание отчёта эквайринга (op59)',
  });

  log.info('shift reconciliation enqueued', {
    shiftId,
    studioId,
    settlementTxId: settlementTx?.id,
    cashCardNet,
  });

  return { reconciliationId: row?.id ?? null, enqueued: !!settlementTx?.id, status: 'pending' };
}

interface InsertReconciliationInput {
  shiftId: string;
  studioId: string;
  settlementTxId: string | null;
  cashCardNet: number;
  status: ReconciliationStatus;
  notes: string;
}

/** INSERT pos_shift_reconciliation с защитой от гонки (ON CONFLICT shift_id). */
async function insertReconciliationRow(
  input: InsertReconciliationInput,
): Promise<{ id: string } | null> {
  return db.queryOne<{ id: string }>(
    `INSERT INTO pos_shift_reconciliation
       (shift_id, studio_id, settlement_tx_id, cash_card_sum, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (shift_id) DO NOTHING
     RETURNING id`,
    [
      input.shiftId,
      input.studioId,
      input.settlementTxId,
      input.cashCardNet,
      input.status,
      input.notes,
    ] as unknown[],
  );
}
