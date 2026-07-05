import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_.:-]{1,80}$/i;

interface JsonObject {
  readonly [key: string]: unknown;
}

export interface AgentConfig {
  serverUrl: string;
  socketPath: string;
  agentId: string;
  studioId?: string;
  userId?: string;
  token: string;
  requirePrivateServerUrl: boolean;
  heartbeatIntervalMs: number;
  sound: {
    enabled: boolean;
    macosSound: string;
  };
  toast: {
    enabled: boolean;
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function parseJsonFile(path: string): JsonObject {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isObject(parsed)) {
    throw new Error(`Config must be a JSON object: ${path}`);
  }
  return parsed;
}

function parseConfigPath(argv: readonly string[]): string {
  const explicitIndex = argv.indexOf('--config');
  if (explicitIndex >= 0 && argv[explicitIndex + 1]) {
    return resolve(argv[explicitIndex + 1]);
  }

  const envPath = stringValue(process.env['NOTIFIER_AGENT_CONFIG']);
  if (envPath) return resolve(envPath);

  return resolve(process.cwd(), 'config.json');
}

function envOverride(name: string, current: string | undefined): string | undefined {
  return stringValue(process.env[name]) ?? current;
}

function validateServerUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('serverUrl must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

function validateUuid(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!UUID_RE.test(value)) throw new Error(`${name} must be a UUID`);
  return value;
}

function validateAgentId(value: string): string {
  if (!AGENT_ID_RE.test(value)) {
    throw new Error('agentId must contain 2-81 latin letters, digits, dots, underscores, colons or hyphens');
  }
  return value;
}

function ipv4IsPrivate(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  if (parts.some(part => !/^\d{1,3}$/.test(part))) return false;
  const nums = parts.map(part => Number.parseInt(part, 10));
  if (nums.some(num => !Number.isInteger(num) || num < 0 || num > 255)) return false;

  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function hostLooksPrivate(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost') return true;
  if (ipv4IsPrivate(host)) return true;
  if (host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  return host.endsWith('.local')
    || host.endsWith('.lan')
    || host.endsWith('.internal')
    || host.endsWith('.vpn');
}

function assertPrivateServerUrl(serverUrl: string): void {
  const url = new URL(serverUrl);
  if (!hostLooksPrivate(url.hostname)) {
    throw new Error('serverUrl must be an internal VPN/LAN host. Set requirePrivateServerUrl=false only for controlled tests.');
  }
}

export function loadConfig(argv: readonly string[] = process.argv): AgentConfig {
  const configPath = parseConfigPath(argv);
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = parseJsonFile(configPath);
  const soundRaw = objectValue(raw['sound']);
  const toastRaw = objectValue(raw['toast']);

  const serverUrl = validateServerUrl(envOverride('NOTIFIER_SERVER_URL', stringValue(raw['serverUrl'])) ?? '');
  const agentId = validateAgentId(envOverride('NOTIFIER_AGENT_ID', stringValue(raw['agentId'])) ?? '');
  const studioId = validateUuid('studioId', envOverride('NOTIFIER_STUDIO_ID', stringValue(raw['studioId'])));
  const userId = validateUuid('userId', envOverride('NOTIFIER_USER_ID', stringValue(raw['userId'])));
  const token = envOverride('NOTIFIER_AGENT_TOKEN', stringValue(raw['token'])) ?? '';

  if (!token) throw new Error('token is required');
  if (!studioId && !userId) throw new Error('studioId or userId is required');

  const requirePrivateServerUrl = booleanValue(raw['requirePrivateServerUrl']) ?? true;
  if (requirePrivateServerUrl) assertPrivateServerUrl(serverUrl);

  return {
    serverUrl,
    socketPath: stringValue(raw['socketPath']) ?? '/socket.io/',
    agentId,
    studioId,
    userId,
    token,
    requirePrivateServerUrl,
    heartbeatIntervalMs: numberValue(raw['heartbeatIntervalMs']) ?? 30_000,
    sound: {
      enabled: booleanValue(soundRaw['enabled']) ?? true,
      macosSound: stringValue(soundRaw['macosSound']) ?? '/System/Library/Sounds/Glass.aiff',
    },
    toast: {
      enabled: booleanValue(toastRaw['enabled']) ?? true,
    },
  };
}
