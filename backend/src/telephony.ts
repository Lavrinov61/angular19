import { createServer, type Server } from 'http';

import { runHealthCheck } from './bootstrap/health.js';
import {
  createRedisHealthCheck,
  type RedisHealthCheck,
} from './bootstrap/worker-health-server.js';
import { registerShutdownHandlers } from './bootstrap/shutdown.js';
import { config } from './config/index.js';
import db from './database/db.js';
import {
  ensurePhoneAuthRoutesAvailable,
  runPhoneAuthProviderPreflight,
} from './routes/phone-auth.routes.js';
import {
  isVoiceOtpDispatcherReady,
  shutdownVoiceOtpDispatcher,
  startVoiceOtpDispatchWorker,
} from './services/voice-otp-dispatcher.service.js';
import {
  isTelephonyVoipHealthMonitorEnabled,
  isTelephonyVoipHealthMonitorRunning,
  startTelephonyVoipHealthMonitor,
  stopTelephonyVoipHealthMonitor,
} from './services/telephony-voip-health-monitor.service.js';
import { isVoximplantVoiceCallConfigured } from './services/voximplant.service.js';
import { registerXaiRealtimeBridge } from './services/xai-realtime-bridge.service.js';
import { createTelephonyApp } from './telephony-app.js';
import { createLogger } from './utils/logger.js';
import { wsPubSub } from './websocket/ws-pubsub.service.js';

const log = createLogger('telephony-entry');
const HOST = '127.0.0.1';

let httpServer: Server | null = null;
let redisHealth: RedisHealthCheck | null = null;

async function shutdownStep(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    log.info(`shutdown step OK: ${label}`);
  } catch (error: unknown) {
    log.error(`shutdown step FAILED: ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function closeHttpServer(): Promise<void> {
  if (!httpServer) return;

  await new Promise<void>((resolve, reject) => {
    httpServer?.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  httpServer = null;
}

async function cleanup(): Promise<void> {
  await shutdownStep('http-server', () => closeHttpServer());
  await shutdownStep('voip-health-monitor', () => stopTelephonyVoipHealthMonitor());
  await shutdownStep('voice-otp-dispatcher', () => shutdownVoiceOtpDispatcher());
  await shutdownStep('ws-pubsub', () => wsPubSub.shutdown());

  if (redisHealth) {
    await shutdownStep('health-redis', () => redisHealth?.close());
    redisHealth = null;
  }

  await shutdownStep('pg-pool', () => db.close());
}

async function main(): Promise<void> {
  if (process.argv.includes('--health') || process.argv.includes('--health-check')) {
    await runHealthCheck(async () => {
      const healthRedis = createRedisHealthCheck('health-telephony-cli');
      try {
        await db.query('SELECT 1');
        await healthRedis.check();
        ensurePhoneAuthRoutesAvailable();
        if (!isVoximplantVoiceCallConfigured()) {
          throw new Error('Voximplant voice OTP is not fully configured');
        }
        await runPhoneAuthProviderPreflight();
      } finally {
        await healthRedis.close();
      }
    });
    return;
  }

  if (config.role !== 'telephony') {
    log.error('telephony.ts started with unexpected PROCESS_ROLE', { role: config.role });
    process.exit(78);
  }

  try {
    await db.query('SELECT NOW()');
    log.info('Database connected (telephony)');

    redisHealth = createRedisHealthCheck('health-telephony');
    startVoiceOtpDispatchWorker();
    startTelephonyVoipHealthMonitor();
    const app = createTelephonyApp({
      checkDb: async () => {
        await db.query('SELECT 1');
        return 'ok';
      },
      checkRedis: redisHealth.check,
      checkVoiceOtpDispatcher: async () => {
        if (!isVoiceOtpDispatcherReady()) {
          throw new Error('voice OTP dispatcher worker is not running');
        }
        return 'ok';
      },
      checkPhoneAuthRoutes: async () => {
        ensurePhoneAuthRoutesAvailable();
        return 'ok';
      },
      checkVoximplantConfig: async () => {
        if (!isVoximplantVoiceCallConfigured()) {
          throw new Error('Voximplant voice OTP is not fully configured');
        }
        if (isTelephonyVoipHealthMonitorEnabled() && !isTelephonyVoipHealthMonitorRunning()) {
          throw new Error('VoIP health monitor is not running');
        }
        return 'ok';
      },
      checkPhoneAuthProviderPreflight: runPhoneAuthProviderPreflight,
    });

    httpServer = createServer(app);
    registerXaiRealtimeBridge(httpServer, {
      path: '/api/telephony/service-survey/realtime',
      tokenSecret: config.jwt.secret,
      xaiApiKey: config.xai.apiKey,
      xaiRealtimeUrl: config.xai.realtimeUrl || undefined,
    });

    registerShutdownHandlers('telephony', cleanup, config.server.shutdownTimeoutMs);

    httpServer.listen(config.server.port, HOST, () => {
      log.info('Telephony server listening', {
        host: HOST,
        port: config.server.port,
        env: config.server.nodeEnv,
        role: config.role,
      });
      process.send?.('ready');
    });

    httpServer.on('error', (error: NodeJS.ErrnoException) => {
      log.error('Telephony HTTP server error — exiting', {
        code: error.code,
        message: error.message,
      });
      process.exit(1);
    });
  } catch (error: unknown) {
    log.error('Failed to start telephony server', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  log.error('telephony main crashed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
