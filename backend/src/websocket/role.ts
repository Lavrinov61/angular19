/**
 * Process role detection for PM2-split deployment.
 *
 * В split-режиме один codebase запускается как несколько PM2 процессов:
 * - `api`              — HTTP/Socket.IO, нет shedulers
 * - `scheduler`        — pg_try_advisory_lock leader, только cron/periodic
 * - `worker-ai`        — обработка AI chat очередей
 * - `worker-outbound`  — outbound messenger delivery
 * - `worker-bot`       — bot/polling
 * - `worker-vk`        — VK marketing broadcast dispatcher/queue (отдельный rate-домен)
 * - `telephony`        — dedicated HTTP process for /api/telephony/*
 * - `monolith`         — legacy single-process (default, до завершения split)
 *
 * Process role читается из `process.env.PROCESS_ROLE` на старте. Используется для:
 *  - gating shedulers (только api/monolith/scheduler)
 *  - выбора broadcast-канала в `broadcastToRoom` (api → io.emit, worker → pub/sub)
 *  - логирования source для observability
 *
 * NB: имя `PROCESS_ROLE` (не просто `ROLE`) — process-level convention
 * (аналогично POD_NAME в K8s, DD_SERVICE в Datadog). `ROLE` был бы слишком
 * generic и мог бы collide с RBAC user roles или аналитикой.
 */
export type ProcessRole =
  | 'api'
  | 'scheduler'
  | 'worker-ai'
  | 'worker-outbound'
  | 'worker-bot'
  | 'worker-vk'
  | 'telephony'
  | 'monolith';

const VALID_ROLES: ReadonlySet<ProcessRole> = new Set<ProcessRole>([
  'api',
  'scheduler',
  'worker-ai',
  'worker-outbound',
  'worker-bot',
  'worker-vk',
  'telephony',
  'monolith',
]);

let cachedRole: ProcessRole | null = null;

/** Returns the current process role. Defaults to 'monolith' if PROCESS_ROLE env is unset or invalid. */
export function getProcessRole(): ProcessRole {
  if (cachedRole !== null) return cachedRole;
  const raw = (process.env['PROCESS_ROLE'] || '').trim();
  cachedRole = VALID_ROLES.has(raw as ProcessRole) ? (raw as ProcessRole) : 'monolith';
  return cachedRole;
}

/**
 * Returns true if this process owns the Socket.IO instance and can directly emit to clients.
 * `api` and `monolith` both run the HTTP/Socket.IO server.
 */
export function isApiProcess(): boolean {
  const r = getProcessRole();
  return r === 'api' || r === 'monolith';
}

/** Returns true if this process does not own Socket.IO and must publish via pub/sub. */
export function isWorkerProcess(): boolean {
  const r = getProcessRole();
  return r !== 'api' && r !== 'monolith';
}

/**
 * Test-only — resets cached role so env override в spec'ах работает.
 * НЕ использовать в продакшн-коде.
 */
export function __resetRoleCacheForTests(): void {
  cachedRole = null;
}
