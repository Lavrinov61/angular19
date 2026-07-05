import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../database/db.js';

const router = Router();

const __dirname2 = dirname(fileURLToPath(import.meta.url));

function readAppVersion(): string {
  try {
    const versionFile = resolve(__dirname2, '../../../src/app/core/constants/version.ts');
    const content = readFileSync(versionFile, 'utf-8');
    const match = content.match(/APP_VERSION\s*=\s*['"](.+?)['"]/);
    return match?.[1] ?? 'unknown';
  } catch { return 'unknown'; }
}

function envFlagEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function isGrpcEnabled(featureFlags: Record<string, boolean>): boolean {
  return featureFlags['grpc_enabled'] === true
    || envFlagEnabled('GRPC_ENABLED')
    || envFlagEnabled('MOBILE_GRPC_ENABLED');
}

interface FeatureFlag {
  key: string;
  enabled: boolean;
  platforms: string[];
  min_app_version: string | null;
}

/**
 * GET /api/app-config — публичный endpoint для мобильных приложений.
 * Возвращает конфигурацию: min version, maintenance, feature flags, store URLs.
 * Без авторизации — нужен до логина.
 */
router.get('/', async (req: Request, res: Response) => {
  const platform = (req.query['platform'] as string) || 'android';

  // Feature flags из БД (если таблица существует)
  let featureFlags: Record<string, boolean> = {};
  try {
    const rows = await db.query<FeatureFlag>(
      `SELECT key, enabled, platforms, min_app_version
       FROM feature_flags
       WHERE enabled = true
         AND (platforms IS NULL OR $1 = ANY(platforms))`,
      [platform],
    );
    for (const row of rows) {
      featureFlags[row.key] = true;
    }
  } catch {
    // Таблица может не существовать ещё — возвращаем пустые флаги
  }

  const features: Record<string, boolean> = {
    ...featureFlags,
    grpc_enabled: isGrpcEnabled(featureFlags),
  };

  res.json({
    success: true,
    data: {
      // Версионирование
      api_version: '1.0',
      app_version: readAppVersion(),

      // Минимальные версии Android-приложения
      android: {
        min_version: '1.0.0',      // ниже → force update
        recommended_version: '1.0.0',
        store_urls: {
          google_play: 'https://play.google.com/store/apps/details?id=ru.svoefoto.app',
          rustore: 'https://apps.rustore.ru/app/ru.svoefoto.app',
          app_gallery: 'https://appgallery.huawei.com/app/ru.svoefoto.app',
        },
      },

      // Maintenance mode
      maintenance: {
        enabled: false,
        message: null as string | null,
        estimated_end: null as string | null,
      },

      // Endpoints
      endpoints: {
        api: 'https://svoefoto.ru/api',
        websocket: 'wss://fmagnus.org',
        websocket_path: '/socket.io/',
        grpc: 'grpc.svoefoto.ru:443',  // будущий gRPC gateway
      },

      // Feature flags
      features,

      // OAuth providers (активные)
      auth_providers: ['yandex', 'google', 'vk', 'phone'],

      // Certificate pinning (ISRG Root X1 + X2)
      certificate_pins: [
        'sha256/C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=',
        'sha256/diGVwi4G0bBg0iVDBO0bFnG5JFk4q7jVDwX5KrOQGFY=',
      ],

      // Rate limits (для клиента — чтобы не нарваться)
      rate_limits: {
        api_per_15min: 600,
        auth_per_15min: 15,
        upload_per_15min: 100,
      },

      // Upload limits
      upload: {
        max_file_size_bytes: 10485760, // 10MB
        allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      },
    },
  });
});

export default router;
