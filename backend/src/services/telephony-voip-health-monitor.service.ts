import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import {
  getSdkUsers,
  isVoximplantSdkConfigured,
  type UserInfo,
} from './voximplant-management-sdk.service.js';
import {
  getRecentVoipFailureSummary,
  getVoipPhoneHealthSnapshot,
  recordVoipHealthFailure,
  recordVoipHealthRecovery,
  type VoipPhoneHealthSnapshot,
} from './telephony.service.js';

const log = createLogger('telephony-voip-health-monitor');

const DEFAULT_TARGET_USER = 'soborny101';
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_FAILURE_THRESHOLD = 1;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let firstRunHandle: ReturnType<typeof setTimeout> | null = null;
let running = false;

export type VoipHealthCheckStatus = 'disabled' | 'skipped' | 'healthy' | 'failed';

export interface VoipHealthCheckResult {
  status: VoipHealthCheckStatus;
  targetUser: string;
  checkedAt: string;
  reason?: string;
  taskId?: string;
  taskNumber?: number;
  createdTask?: boolean;
  recentFailureCount?: number;
  lastFailureAt?: string | null;
  recoveredIncident?: boolean;
}

interface MonitorConfig {
  enabled: boolean;
  targetUser: string;
  intervalMs: number;
  windowMinutes: number;
  failureThreshold: number;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getMonitorConfig(): MonitorConfig {
  return {
    enabled: process.env['TELEPHONY_VOIP_HEALTH_ENABLED'] !== 'false',
    targetUser: process.env['TELEPHONY_STUDIO_VOIP_USER'] || DEFAULT_TARGET_USER,
    intervalMs: parsePositiveInteger(process.env['TELEPHONY_VOIP_HEALTH_INTERVAL_MS'], DEFAULT_INTERVAL_MS),
    windowMinutes: parsePositiveInteger(process.env['TELEPHONY_VOIP_HEALTH_WINDOW_MINUTES'], DEFAULT_WINDOW_MINUTES),
    failureThreshold: parsePositiveInteger(process.env['TELEPHONY_VOIP_HEALTH_FAILURE_THRESHOLD'], DEFAULT_FAILURE_THRESHOLD),
  };
}

function findTargetUser(users: UserInfo[], targetUser: string): UserInfo | null {
  return users.find((user) => user.userName === targetUser) || null;
}

function isActiveUser(user: UserInfo): boolean {
  return user.active !== false;
}

async function createFailureResult(
  monitorConfig: MonitorConfig,
  checkedAt: string,
  reason: string,
  message: string,
  recentFailureCount?: number,
  lastFailureAt?: string | null,
  userActive?: boolean | null,
): Promise<VoipHealthCheckResult> {
  const task = await recordVoipHealthFailure({
    targetUser: monitorConfig.targetUser,
    reason,
    message,
    windowMinutes: monitorConfig.windowMinutes,
    failureCount: recentFailureCount,
    lastFailureAt,
    userActive,
    checkedAt,
  });

  return {
    status: 'failed',
    targetUser: monitorConfig.targetUser,
    checkedAt,
    reason,
    taskId: task.taskId,
    taskNumber: task.taskNumber,
    createdTask: task.createdTask,
    recentFailureCount,
    lastFailureAt,
  };
}

/**
 * Один цикл проверки: control-plane Voximplant user + passive fail-rate из call_logs.
 */
export async function runTelephonyVoipHealthCheckOnce(): Promise<VoipHealthCheckResult> {
  const monitorConfig = getMonitorConfig();
  const checkedAt = new Date().toISOString();

  if (!monitorConfig.enabled) {
    return {
      status: 'disabled',
      targetUser: monitorConfig.targetUser,
      checkedAt,
      reason: 'disabled_by_env',
    };
  }

  if (!isVoximplantSdkConfigured()) {
    return {
      status: 'skipped',
      targetUser: monitorConfig.targetUser,
      checkedAt,
      reason: 'voximplant_sdk_not_configured',
    };
  }

  let target: UserInfo | null = null;

  try {
    const users = await getSdkUsers({
      applicationName: config.voximplant.applicationName,
      userName: monitorConfig.targetUser,
      count: 10,
    });
    target = findTargetUser(users.result || [], monitorConfig.targetUser);
  } catch (error: unknown) {
    return createFailureResult(
      monitorConfig,
      checkedAt,
      'voximplant_sdk_error',
      `Не удалось проверить Voximplant user ${monitorConfig.targetUser}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!target) {
    return createFailureResult(
      monitorConfig,
      checkedAt,
      'voximplant_user_missing',
      `Voximplant user ${monitorConfig.targetUser} не найден в приложении ${config.voximplant.applicationName}.`,
      undefined,
      undefined,
      false,
    );
  }

  if (!isActiveUser(target)) {
    return createFailureResult(
      monitorConfig,
      checkedAt,
      'voximplant_user_inactive',
      `Voximplant user ${monitorConfig.targetUser} выключен или неактивен.`,
      undefined,
      undefined,
      false,
    );
  }

  const recent = await getRecentVoipFailureSummary(monitorConfig.targetUser, monitorConfig.windowMinutes);
  if (recent.failureCount >= monitorConfig.failureThreshold) {
    return createFailureResult(
      monitorConfig,
      checkedAt,
      'recent_inbound_failures',
      `За последние ${monitorConfig.windowMinutes} минут есть недозвоны на ${monitorConfig.targetUser}. Нужно проверить телефон и линию.`,
      recent.failureCount,
      recent.lastFailureAt,
      true,
    );
  }

  const recoveredIncident = await recordVoipHealthRecovery(monitorConfig.targetUser, checkedAt);
  return {
    status: 'healthy',
    targetUser: monitorConfig.targetUser,
    checkedAt,
    recentFailureCount: recent.failureCount,
    lastFailureAt: recent.lastFailureAt,
    recoveredIncident,
  };
}

async function runScheduledCheck(): Promise<void> {
  if (running) {
    log.warn('Previous VoIP health check is still running');
    return;
  }

  running = true;
  try {
    const result = await runTelephonyVoipHealthCheckOnce();
    if (result.status === 'failed') {
      log.warn('VoIP health check failed', {
        targetUser: result.targetUser,
        reason: result.reason,
        taskId: result.taskId,
        createdTask: result.createdTask,
      });
    } else {
      log.debug('VoIP health check completed', {
        status: result.status,
        targetUser: result.targetUser,
        reason: result.reason,
      });
    }
  } catch (error: unknown) {
    log.error('VoIP health check crashed', { error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
}

export function startTelephonyVoipHealthMonitor(): void {
  const monitorConfig = getMonitorConfig();
  if (!monitorConfig.enabled) {
    log.info('VoIP health monitor disabled by env');
    return;
  }

  if (intervalHandle) {
    log.warn('VoIP health monitor already running');
    return;
  }

  firstRunHandle = setTimeout(() => {
    void runScheduledCheck();
  }, 15_000);
  intervalHandle = setInterval(() => {
    void runScheduledCheck();
  }, monitorConfig.intervalMs);

  log.info('VoIP health monitor started', {
    targetUser: monitorConfig.targetUser,
    intervalMs: monitorConfig.intervalMs,
    windowMinutes: monitorConfig.windowMinutes,
    failureThreshold: monitorConfig.failureThreshold,
  });
}

export function stopTelephonyVoipHealthMonitor(): void {
  if (firstRunHandle) {
    clearTimeout(firstRunHandle);
    firstRunHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('VoIP health monitor stopped');
  }
}

export function isTelephonyVoipHealthMonitorRunning(): boolean {
  return intervalHandle !== null;
}

export function isTelephonyVoipHealthMonitorEnabled(): boolean {
  return getMonitorConfig().enabled;
}

export async function getTelephonyVoipHealthSnapshot(): Promise<VoipPhoneHealthSnapshot> {
  const monitorConfig = getMonitorConfig();
  return getVoipPhoneHealthSnapshot(monitorConfig.targetUser, monitorConfig.windowMinutes);
}
