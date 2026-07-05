import db from '../database/db.js';
import { cacheGet, cacheSet } from './redis-cache.service.js';
import type { PosShift } from './pos.service.js';
import { POS_AGENT_ONLINE_WINDOW_SECONDS } from './pos-agent-availability.service.js';
import type {
  FiscalAgentAvailabilityRow,
  FiscalShiftStatusSource,
  PosBridgeTransactionStatusRow,
  PosShiftFiscalStatus,
  ShiftFiscalLookupRow,
  ShiftFiscalTransactionStateRow,
} from '../types/views/pos-views.js';

const POS_TELEMETRY_CACHE_TTL_SEC = 90;

interface UnknownRecord {
  [key: string]: unknown;
}

export interface PosTelemetrySnapshot {
  studio_id: string;
  agent_id: string | null;
  terminal_online: boolean;
  fiscal_online: boolean;
  shift_status: string;
  timestamp_ms: number;
}

export interface FiscalShiftDeviceStatus {
  fiscalReady: boolean;
  fiscalAvailable: boolean;
  source: FiscalShiftStatusSource;
  telemetry: PosTelemetrySnapshot | null;
  transactionId: string | null;
  publicStatus: PosShiftFiscalStatus;
}

type FiscalShiftStatusInput = Pick<ShiftFiscalLookupRow, 'id' | 'studio_id' | 'opened_at' | 'status'>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function timestampValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function posTelemetryCacheKey(studioId: string): string {
  return `pos:telemetry:${studioId}`;
}

function normalizeTelemetrySnapshot(value: unknown): PosTelemetrySnapshot | null {
  if (!isUnknownRecord(value)) return null;

  const studioId = stringValue(value['studio_id']);
  const shiftStatus = stringValue(value['shift_status']);
  const terminalOnline = booleanValue(value['terminal_online']);
  const fiscalOnline = booleanValue(value['fiscal_online']);

  if (!studioId || !shiftStatus || terminalOnline === null || fiscalOnline === null) {
    return null;
  }

  return {
    studio_id: studioId,
    agent_id: stringValue(value['agent_id']),
    terminal_online: terminalOnline,
    fiscal_online: fiscalOnline,
    shift_status: shiftStatus,
    timestamp_ms: timestampValue(value['timestamp_ms']),
  };
}

export async function cachePosTelemetrySnapshot(value: unknown): Promise<void> {
  const snapshot = normalizeTelemetrySnapshot(value);
  if (!snapshot) return;

  await cacheSet(posTelemetryCacheKey(snapshot.studio_id), snapshot, POS_TELEMETRY_CACHE_TTL_SEC);
}

async function getCachedPosTelemetry(studioId: string): Promise<PosTelemetrySnapshot | null> {
  const cached = await cacheGet<unknown>(posTelemetryCacheKey(studioId));
  return normalizeTelemetrySnapshot(cached);
}

function telemetryCheckedAt(telemetry: PosTelemetrySnapshot | null): string | null {
  return telemetry ? new Date(telemetry.timestamp_ms).toISOString() : null;
}

function commandTimestampMs(command: ShiftFiscalTransactionStateRow | null): number | null {
  if (!command) return null;
  const raw = command.completed_at ?? command.initiated_at;
  if (!raw) return null;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : null;
}

function commandTimestamp(command: ShiftFiscalTransactionStateRow | null): string | null {
  return command?.completed_at ?? command?.initiated_at ?? null;
}

function isCurrentOpenCommand(
  openCommand: ShiftFiscalTransactionStateRow | null,
  latestCompletedCommand: ShiftFiscalTransactionStateRow | null,
): boolean {
  if (!openCommand) return false;
  if (latestCompletedCommand?.transaction_type !== 'shift_close') return true;

  const openTime = commandTimestampMs(openCommand);
  const closeTime = commandTimestampMs(latestCompletedCommand);
  if (openTime === null || closeTime === null) return false;
  return openTime > closeTime;
}

function isWaitingShiftCommandStatus(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'processing' || status === 'queued';
}

function telemetryConfirmsFiscalShiftTransaction(
  transactionType: string,
  telemetry: PosTelemetrySnapshot | null,
): boolean {
  if (!telemetry?.fiscal_online) return false;
  if (transactionType === 'shift_open') return telemetry.shift_status === 'open';
  if (transactionType === 'shift_close') return telemetry.shift_status === 'closed';
  return false;
}

async function markShiftCommandCompletedFromTelemetry(
  commandId: string,
  telemetry: PosTelemetrySnapshot,
): Promise<void> {
  await db.query(
    `UPDATE pos_transactions
     SET status = 'completed',
         error_message = NULL,
         completed_at = COALESCE(completed_at, to_timestamp($2::double precision / 1000.0))
     WHERE id = $1
       AND COALESCE(status, '') IN ('pending', 'processing', 'queued')`,
    [commandId, telemetry.timestamp_ms],
  );
}

async function reconcileShiftCommandStateFromTelemetry(
  command: ShiftFiscalTransactionStateRow | null,
  telemetry: PosTelemetrySnapshot | null,
): Promise<ShiftFiscalTransactionStateRow | null> {
  if (!command || !isWaitingShiftCommandStatus(command.status)) return command;
  if (!telemetry) return command;
  if (!telemetryConfirmsFiscalShiftTransaction(command.transaction_type, telemetry)) return command;

  await markShiftCommandCompletedFromTelemetry(command.id, telemetry);
  return {
    ...command,
    status: 'completed',
  };
}

export async function reconcileFiscalShiftTransactionFromTelemetry(
  transaction: PosBridgeTransactionStatusRow,
): Promise<PosBridgeTransactionStatusRow> {
  if (!isWaitingShiftCommandStatus(transaction.status)) return transaction;
  if (transaction.transaction_type !== 'shift_open' && transaction.transaction_type !== 'shift_close') {
    return transaction;
  }

  const telemetry = await getCachedPosTelemetry(transaction.studio_id);
  if (!telemetry) return transaction;
  if (!telemetryConfirmsFiscalShiftTransaction(transaction.transaction_type, telemetry)) return transaction;

  await markShiftCommandCompletedFromTelemetry(transaction.id, telemetry);
  return {
    ...transaction,
    status: 'completed',
    error_message: null,
  };
}

function buildPublicFiscalStatus(input: {
  ready: boolean;
  available: boolean;
  source: FiscalShiftStatusSource;
  telemetry: PosTelemetrySnapshot | null;
  latestCompletedCommand: ShiftFiscalTransactionStateRow | null;
  openCommand: ShiftFiscalTransactionStateRow | null;
}): PosShiftFiscalStatus {
  const currentOpenCommand = input.ready
    && isCurrentOpenCommand(input.openCommand, input.latestCompletedCommand)
    ? input.openCommand
    : null;

  return {
    ready: input.ready,
    available: input.available,
    source: input.source,
    shift_status: input.telemetry?.shift_status
      ?? (input.latestCompletedCommand?.transaction_type === 'shift_open' ? 'open' : null)
      ?? (input.latestCompletedCommand?.transaction_type === 'shift_close' ? 'closed' : null),
    checked_at: telemetryCheckedAt(input.telemetry),
    opened_at: commandTimestamp(currentOpenCommand),
    opened_by: currentOpenCommand?.initiated_by_name ?? null,
    opened_by_id: currentOpenCommand?.initiated_by ?? null,
    transaction_id: currentOpenCommand?.id ?? input.latestCompletedCommand?.id ?? null,
    command_status: currentOpenCommand?.status ?? input.latestCompletedCommand?.status ?? null,
  };
}

async function getFiscalAgentAvailable(studioId: string): Promise<boolean> {
  const row = await db.queryOne<FiscalAgentAvailabilityRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM agents
       WHERE studio_id = $1
         AND agent_type = 'pos'
         AND is_active = true
         AND is_online = true
         AND last_heartbeat_at IS NOT NULL
         AND last_heartbeat_at >= NOW() - ($2::int * INTERVAL '1 second')
     ) AS available`,
    [studioId, POS_AGENT_ONLINE_WINDOW_SECONDS],
  );
  return row?.available ?? false;
}

async function getLatestCompletedFiscalShiftCommand(
  shift: FiscalShiftStatusInput,
): Promise<ShiftFiscalTransactionStateRow | null> {
  return db.queryOne<ShiftFiscalTransactionStateRow>(
    `SELECT pt.id,
            pt.transaction_type,
            pt.status,
            pt.initiated_at,
            pt.completed_at,
            pt.initiated_by,
            u.display_name AS initiated_by_name
     FROM pos_transactions pt
     LEFT JOIN users u ON u.id = pt.initiated_by
     WHERE pt.studio_id = $1
       AND pt.transaction_type IN ('shift_open', 'shift_close')
       AND pt.status = 'completed'
       AND (
         $2::timestamptz IS NULL
         OR pt.initiated_at >= $2::timestamptz - INTERVAL '10 seconds'
       )
     ORDER BY pt.completed_at DESC NULLS LAST, pt.initiated_at DESC NULLS LAST
     LIMIT 1`,
    [shift.studio_id, shift.opened_at],
  );
}

async function getLatestOpenFiscalShiftCommand(
  shift: FiscalShiftStatusInput,
): Promise<ShiftFiscalTransactionStateRow | null> {
  return db.queryOne<ShiftFiscalTransactionStateRow>(
    `SELECT pt.id,
            pt.transaction_type,
            pt.status,
            pt.initiated_at,
            pt.completed_at,
            pt.initiated_by,
            u.display_name AS initiated_by_name
     FROM pos_transactions pt
     LEFT JOIN users u ON u.id = pt.initiated_by
     WHERE pt.studio_id = $1
       AND pt.transaction_type = 'shift_open'
       AND COALESCE(pt.status, '') <> 'failed'
       AND (
         $2::timestamptz IS NULL
         OR pt.initiated_at >= $2::timestamptz - INTERVAL '10 seconds'
       )
     ORDER BY pt.completed_at DESC NULLS LAST, pt.initiated_at DESC NULLS LAST
     LIMIT 1`,
    [shift.studio_id, shift.opened_at],
  );
}

export async function getFiscalShiftStatusForShift(
  shift: FiscalShiftStatusInput,
): Promise<FiscalShiftDeviceStatus> {
  const fiscalAvailable = await getFiscalAgentAvailable(shift.studio_id);

  if (shift.status !== 'open') {
    const publicStatus = buildPublicFiscalStatus({
      ready: false,
      available: fiscalAvailable,
      source: 'none',
      telemetry: null,
      latestCompletedCommand: null,
      openCommand: null,
    });
    return {
      fiscalReady: false,
      fiscalAvailable,
      source: 'none',
      telemetry: null,
      transactionId: null,
      publicStatus,
    };
  }

  const telemetry = await getCachedPosTelemetry(shift.studio_id);
  if (telemetry) {
    const fiscalReady = telemetry.fiscal_online && telemetry.shift_status === 'open';
    const latestCompletedCommand = await getLatestCompletedFiscalShiftCommand(shift);
    const openCommand = fiscalReady
      ? await reconcileShiftCommandStateFromTelemetry(await getLatestOpenFiscalShiftCommand(shift), telemetry)
      : null;
    const publicStatus = buildPublicFiscalStatus({
      ready: fiscalReady,
      available: fiscalAvailable || telemetry.fiscal_online,
      source: 'telemetry',
      telemetry,
      latestCompletedCommand,
      openCommand,
    });

    return {
      fiscalReady,
      fiscalAvailable: publicStatus.available,
      source: 'telemetry',
      telemetry,
      transactionId: publicStatus.transaction_id,
      publicStatus,
    };
  }

  const transaction = await getLatestCompletedFiscalShiftCommand(shift);
  const fiscalReady = transaction?.transaction_type === 'shift_open';
  const publicStatus = buildPublicFiscalStatus({
    ready: fiscalReady,
    available: fiscalAvailable,
    source: transaction ? 'transaction' : 'none',
    telemetry: null,
    latestCompletedCommand: transaction,
    openCommand: fiscalReady ? transaction : null,
  });

  return {
    fiscalReady,
    fiscalAvailable,
    source: transaction ? 'transaction' : 'none',
    telemetry: null,
    transactionId: publicStatus.transaction_id,
    publicStatus,
  };
}

export async function withFiscalShiftDeviceStatus(shift: PosShift): Promise<PosShift> {
  const fiscalStatus = await getFiscalShiftStatusForShift(shift);
  return {
    ...shift,
    fiscal_enabled: fiscalStatus.fiscalReady,
    fiscal_status: fiscalStatus.publicStatus,
  };
}

/**
 * Свежесть снимка telemetry: моложе TTL кэша (90с).
 *
 * Снимок старше TTL → доверять нельзя (терминал мог уйти офлайн без свежего
 * false-снимка). Гард при устаревшем снимке деградирует мягко — пускает оплату.
 */
export function isTelemetryFresh(
  telemetry: PosTelemetrySnapshot | null,
  nowMs: number = Date.now(),
): boolean {
  if (!telemetry) return false;
  return nowMs - telemetry.timestamp_ms <= POS_TELEMETRY_CACHE_TTL_SEC * 1000;
}

/** Состояние гарда приёма карты по telemetry терминала. */
export interface TerminalGateState {
  /** true — приём карты блокировать (свежий снимок terminal_online=false). */
  blocked: boolean;
  /** Онлайн ли терминал по telemetry: true/false/null (нет/устарел снимок). */
  terminalOnline: boolean | null;
  /** ISO-время снимка telemetry или null. */
  checkedAt: string | null;
  /** Машинная причина исхода (для логов/диагностики). */
  reason: 'fresh_offline' | 'fresh_online' | 'stale' | 'no_telemetry';
}

/**
 * Состояние гарда «приём карты при офлайне терминала» (контур #3).
 *
 * Мягкая деградация (бриф §53, P1-5): блокируем приём карты ТОЛЬКО при СВЕЖЕМ
 * снимке `terminal_online=false`. Нет снимка или снимок устарел (>TTL) →
 * blocked=false (не блокируем ложно — лучше пропустить, чем сорвать оплату). По
 * логам инцидента агент публиковал свежий `terminal=false` каждые 60с, пока
 * терминал офлайн → гард сработает в реальном кейсе.
 *
 * Сам решение «503 при terminalOnline=false» + фича-флаг — в роуте /bridge/pay (S2).
 */
export async function getTerminalGateState(studioId: string): Promise<TerminalGateState> {
  const telemetry = await getCachedPosTelemetry(studioId);

  if (!telemetry) {
    return { blocked: false, terminalOnline: null, checkedAt: null, reason: 'no_telemetry' };
  }

  const checkedAt = telemetryCheckedAt(telemetry);

  if (!isTelemetryFresh(telemetry)) {
    return { blocked: false, terminalOnline: null, checkedAt, reason: 'stale' };
  }

  if (!telemetry.terminal_online) {
    return { blocked: true, terminalOnline: false, checkedAt, reason: 'fresh_offline' };
  }

  return { blocked: false, terminalOnline: true, checkedAt, reason: 'fresh_online' };
}

export async function isFiscalShiftOpenForShift(shiftId: string): Promise<boolean> {
  const shift = await db.queryOne<ShiftFiscalLookupRow>(
    `SELECT id, studio_id, opened_at, status
     FROM pos_shifts
     WHERE id = $1`,
    [shiftId],
  );

  if (!shift) return false;

  const fiscalStatus = await getFiscalShiftStatusForShift(shift);
  return fiscalStatus.fiscalReady;
}
