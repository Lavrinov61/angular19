import db from '../database/db.js';
import type {
  RestorationOrderWorkloadRow,
  RestorationRetouchTaskWorkloadRow,
} from '../types/views/restoration-workload-views.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('restoration-workload');

export type RestorationTier = 'simple' | 'medium' | 'complex' | 'pro';
export type RestorationLoadLevel = 'normal' | 'busy' | 'heavy' | 'surge';

export interface RestorationWorkloadSnapshot {
  readonly activeOrders: number;
  readonly activeRetouchTasks: number;
  readonly activeWorkUnits: number;
  readonly completedToday: number;
  readonly dayCapacity: number;
  readonly currentDayLoad: number;
  readonly loadLevel: RestorationLoadLevel;
  readonly leadTimeLabel: string;
  readonly message: string;
  readonly updatedAt: string;
  readonly leadTimeByTier: Record<RestorationTier, string>;
}

interface RestorationWorkloadInput {
  readonly activeOrders: number;
  readonly activeRetouchTasks: number;
  readonly completedToday: number;
  readonly now?: Date;
}

interface RestorationOrderWorkload {
  readonly activeOrders: number;
  readonly completedToday: number;
}

const RESTORATION_DAY_CAPACITY = 8;

const LEAD_TIME_BY_LEVEL: Record<RestorationLoadLevel, Record<RestorationTier, string>> = {
  normal: {
    simple: 'в течение дня',
    medium: 'в течение дня',
    complex: '1-2 дня',
    pro: 'после оценки',
  },
  busy: {
    simple: '1-2 дня',
    medium: '1-2 дня',
    complex: '2-3 дня',
    pro: '3-5 дней',
  },
  heavy: {
    simple: '2-3 дня',
    medium: '2-3 дня',
    complex: '3-5 дней',
    pro: 'после оценки',
  },
  surge: {
    simple: 'по согласованию',
    medium: 'по согласованию',
    complex: 'по согласованию',
    pro: 'по согласованию',
  },
};

const PUBLIC_LEAD_TIME_BY_LEVEL: Record<RestorationLoadLevel, string> = {
  normal: 'в течение дня',
  busy: '1-2 дня',
  heavy: '2-3 дня',
  surge: 'по согласованию',
};

const MESSAGE_BY_LEVEL: Record<RestorationLoadLevel, string> = {
  normal: 'Сейчас обычная очередь: простые и средние исходники обычно берём в работу в течение дня.',
  busy: 'Очередь выше обычной: срок считаем с запасом и уточняем после оценки исходника.',
  heavy: 'Сейчас плотная загрузка ретуши: точный срок подтвердим перед запуском ручной работы.',
  surge: 'Сейчас высокий поток заказов: фиксированный срок не обещаем, подтвердим его после оценки.',
};

export function buildRestorationWorkloadSnapshot(input: RestorationWorkloadInput): RestorationWorkloadSnapshot {
  const activeOrders = normalizePositiveInteger(input.activeOrders);
  const activeRetouchTasks = normalizePositiveInteger(input.activeRetouchTasks);
  const completedToday = normalizePositiveInteger(input.completedToday);
  const activeWorkUnits = activeOrders + activeRetouchTasks;
  const currentDayLoad = Math.min(
    999,
    Math.round(((activeWorkUnits + completedToday) / RESTORATION_DAY_CAPACITY) * 100),
  );
  const loadLevel = resolveLoadLevel(activeWorkUnits, currentDayLoad);
  const now = input.now ?? new Date();

  return {
    activeOrders,
    activeRetouchTasks,
    activeWorkUnits,
    completedToday,
    dayCapacity: RESTORATION_DAY_CAPACITY,
    currentDayLoad,
    loadLevel,
    leadTimeLabel: PUBLIC_LEAD_TIME_BY_LEVEL[loadLevel],
    message: MESSAGE_BY_LEVEL[loadLevel],
    updatedAt: now.toISOString(),
    leadTimeByTier: LEAD_TIME_BY_LEVEL[loadLevel],
  };
}

export function leadTimeForRestorationTier(
  tier: RestorationTier,
  workload: RestorationWorkloadSnapshot,
): string {
  return workload.leadTimeByTier[tier];
}

export async function getRestorationWorkload(): Promise<RestorationWorkloadSnapshot> {
  const [orders, activeRetouchTasks] = await Promise.all([
    loadOrderWorkload(),
    loadActiveRetouchTasks(),
  ]);

  return buildRestorationWorkloadSnapshot({
    activeOrders: orders.activeOrders,
    activeRetouchTasks,
    completedToday: orders.completedToday,
  });
}

async function loadOrderWorkload(): Promise<RestorationOrderWorkload> {
  const row = await db.queryOne<RestorationOrderWorkloadRow>(
    `SELECT
       COUNT(*) FILTER (
         WHERE (
           status IN ('new', 'paid', 'processing')
           OR (status = 'pending_payment' AND created_at >= NOW() - INTERVAL '24 hours')
         )
       ) AS active_orders,
       COUNT(*) FILTER (
         WHERE status IN ('ready', 'completed') AND updated_at >= CURRENT_DATE
       ) AS completed_today
       FROM photo_print_orders
       WHERE service_type = 'restoration'
          OR mode = 'restoration'`,
  );

  return {
    activeOrders: parseCount(row?.active_orders),
    completedToday: parseCount(row?.completed_today),
  };
}

async function loadActiveRetouchTasks(): Promise<number> {
  try {
    const row = await db.queryOne<RestorationRetouchTaskWorkloadRow>(
      `SELECT COUNT(*) AS active_retouch_tasks
       FROM work_tasks
       WHERE task_type = 'retouch'
         AND status IN ('open', 'assigned', 'in_progress', 'waiting')`,
    );
    return parseCount(row?.active_retouch_tasks);
  } catch (error) {
    if (pgErrorCode(error) === '42P01') {
      log.warn('work_tasks table is unavailable; using restoration orders only for workload');
      return 0;
    }
    throw error;
  }
}

function resolveLoadLevel(activeWorkUnits: number, currentDayLoad: number): RestorationLoadLevel {
  if (activeWorkUnits >= 20 || currentDayLoad >= 240) {
    return 'surge';
  }
  if (activeWorkUnits >= 12 || currentDayLoad >= 160) {
    return 'heavy';
  }
  if (activeWorkUnits >= 6 || currentDayLoad >= 90) {
    return 'busy';
  }
  return 'normal';
}

function parseCount(value: string | number | bigint | null | undefined): number {
  if (typeof value === 'number') {
    return normalizePositiveInteger(value);
  }
  if (typeof value === 'bigint') {
    return normalizePositiveInteger(Number(value));
  }
  if (typeof value === 'string') {
    return normalizePositiveInteger(Number.parseInt(value, 10));
  }
  return 0;
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function pgErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return typeof descriptor?.value === 'string' ? descriptor.value : null;
}
