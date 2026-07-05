export const DEFAULT_SSH_HOST = 'soborny-pc';

export const CLEAR_RECYCLE_BIN_CONFIRM = 'CLEAR_RECYCLE_BIN';
export const SET_HIBERNATION_CONFIRM = 'SET_HIBERNATION';
export const START_COMPONENT_CLEANUP_CONFIRM = 'START_COMPONENT_CLEANUP';
export const KILL_PROCESS_CONFIRM = 'KILL_PROCESS';

export function sshHost(): string {
  return process.env['SOBORNY_SSH_HOST'] || DEFAULT_SSH_HOST;
}

export function sshConnectTimeoutSeconds(): number {
  return parsePositiveInt(process.env['SOBORNY_SSH_CONNECT_TIMEOUT_SECONDS'], 10);
}

export function sshCommandTimeoutMs(defaultMs = 120000): number {
  return parsePositiveInt(process.env['SOBORNY_SSH_COMMAND_TIMEOUT_MS'], defaultMs);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
