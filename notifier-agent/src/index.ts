import os from 'node:os';
import { io } from 'socket.io-client';
import { loadConfig } from './config.js';
import { parseNotificationPayload, showNativeNotification } from './notify.js';

const AGENT_VERSION = '0.1.0';
const RECENT_NOTIFICATION_TTL_MS = 10 * 60 * 1000;

function log(level: 'info' | 'warn' | 'error', message: string, details?: readonly string[]): void {
  const suffix = details && details.length > 0 ? ` ${details.join(' ')}` : '';
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function cleanupRecentNotifications(recent: Map<string, number>): void {
  const cutoff = Date.now() - RECENT_NOTIFICATION_TTL_MS;
  for (const [id, seenAt] of recent) {
    if (seenAt < cutoff) recent.delete(id);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const recentNotifications = new Map<string, number>();

  const socket = io(config.serverUrl, {
    path: config.socketPath,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    timeout: 10000,
    auth: {
      agentType: 'native-notifier',
      agentId: config.agentId,
      agentToken: config.token,
      studioId: config.studioId,
      userId: config.userId,
      hostname: os.hostname(),
      platform: process.platform,
      version: AGENT_VERSION,
    },
  });

  socket.on('connect', () => {
    log('info', 'connected', [`agent=${config.agentId}`, `server=${config.serverUrl}`]);
    socket.emit('native-notifier:heartbeat', { at: new Date().toISOString() });
  });

  socket.on('native-notifier:hello', () => {
    log('info', 'server accepted native notifier session');
  });

  socket.on('connect_error', (error: Error) => {
    log('warn', 'connect failed', [error.message]);
  });

  socket.on('disconnect', (reason: string) => {
    log('warn', 'disconnected', [reason]);
  });

  socket.on('native-notifier:notification', async (rawPayload: unknown) => {
    const payload = parseNotificationPayload(rawPayload);
    if (!payload) {
      log('warn', 'ignored malformed notification payload');
      return;
    }

    cleanupRecentNotifications(recentNotifications);
    if (recentNotifications.has(payload.id)) return;
    recentNotifications.set(payload.id, Date.now());

    try {
      await showNativeNotification(config, payload);
      socket.emit('native-notifier:test-result', {
        id: payload.id,
        ok: true,
        at: new Date().toISOString(),
      });
      log('info', 'notification shown', [`type=${payload.type}`]);
    } catch (error) {
      socket.emit('native-notifier:test-result', {
        id: payload.id,
        ok: false,
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      log('warn', 'notification failed', [error instanceof Error ? error.message : String(error)]);
    }
  });

  const heartbeatTimer = setInterval(() => {
    if (socket.connected) {
      socket.emit('native-notifier:heartbeat', { at: new Date().toISOString() });
    }
  }, config.heartbeatIntervalMs);

  const shutdown = (): void => {
    clearInterval(heartbeatTimer);
    socket.close();
    log('info', 'stopped');
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => {
  log('error', 'fatal startup error', [error instanceof Error ? error.message : String(error)]);
  process.exitCode = 1;
});
