import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { config } from './config/index.js';
import phoneAuthRouter from './routes/phone-auth.routes.js';
import telephonyRoutes from './routes/telephony.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/request-logger.js';
import { requestContextMiddleware } from './middleware/request-context.js';
import { httpMetricsMiddleware } from './middleware/http-metrics.js';
import { getMetrics, getContentType } from './services/metrics.service.js';

interface TelephonyHealthCheck {
  ok: boolean;
  error?: string;
  status?: 'ok' | 'skipped';
}

interface TelephonyAppDeps {
  checkDb: () => Promise<unknown>;
  checkRedis: () => Promise<unknown>;
  checkVoiceOtpDispatcher: () => Promise<unknown>;
  checkPhoneAuthRoutes: () => Promise<unknown>;
  checkVoximplantConfig: () => Promise<unknown>;
  checkPhoneAuthProviderPreflight?: () => Promise<'ok' | 'skipped' | unknown>;
}

export function createTelephonyApp(deps: TelephonyAppDeps): Express {
  const app = express();
  const corsOrigins = config.cors.origin.split(',').map(value => value.trim());

  app.set('trust proxy', 2);
  app.use(requestContextMiddleware);
  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  }));

  if (config.server.nodeEnv === 'production') {
    app.use((req, res, next) => {
      const host = req.hostname;
      const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      if (req.headers['x-forwarded-proto'] !== 'https' && !isLoopback && req.path !== '/health') {
        res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
        return;
      }
      next();
    });
  }

  app.use(httpMetricsMiddleware);
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  app.get('/health', async (_req: Request, res: Response): Promise<void> => {
    const checks: Record<string, TelephonyHealthCheck> = {};
    const readinessKeys = [
      'db',
      'redis',
      'voiceOtpDispatcher',
      'phoneAuthRoutes',
      'voximplantConfig',
      ...(deps.checkPhoneAuthProviderPreflight ? ['providerPreflight'] : []),
    ];

    try {
      await deps.checkDb();
      checks['db'] = { ok: true, status: 'ok' };
    } catch (error: unknown) {
      checks['db'] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      await deps.checkRedis();
      checks['redis'] = { ok: true, status: 'ok' };
    } catch (error: unknown) {
      checks['redis'] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      await deps.checkVoiceOtpDispatcher();
      checks['voiceOtpDispatcher'] = { ok: true, status: 'ok' };
    } catch (error: unknown) {
      checks['voiceOtpDispatcher'] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      await deps.checkPhoneAuthRoutes();
      checks['phoneAuthRoutes'] = { ok: true, status: 'ok' };
    } catch (error: unknown) {
      checks['phoneAuthRoutes'] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      await deps.checkVoximplantConfig();
      checks['voximplantConfig'] = { ok: true, status: 'ok' };
    } catch (error: unknown) {
      checks['voximplantConfig'] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (deps.checkPhoneAuthProviderPreflight) {
      try {
        const result = await deps.checkPhoneAuthProviderPreflight();
        checks['providerPreflight'] = {
          ok: true,
          status: result === 'skipped' ? 'skipped' : 'ok',
        };
      } catch (error: unknown) {
        checks['providerPreflight'] = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const ready = readinessKeys.every((key) => checks[key]?.ok);
    res.status(ready ? 200 : 503).json({
      ready,
      role: config.role,
      checks,
    });
  });

  app.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
    res.set('Content-Type', getContentType());
    res.end(await getMetrics());
  });

  app.use('/api/auth', phoneAuthRouter);
  app.use('/api/telephony', telephonyRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
