// NOTE: initNodeFederation НЕ нужен — CRM рендерится как CSR (RenderMode.Client).
// SSR сервер обрабатывает только публичные страницы сайта, federation — только на клиенте.

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import Redis from 'ioredis';
import { createServer } from 'node:http';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');
const SSR_HOST = '127.0.0.1';

// ─── SSR Redis cache ─────────────────────────────────────
let _ssrRedis: Redis | null = null;
let _ssrRedisReady = false;
function getSsrRedis(): Redis | null {
  if (!_ssrRedis) {
    const pw = process.env['REDIS_PASSWORD'];
    const host = process.env['REDIS_HOST'] || 'localhost';
    const port = parseInt(process.env['REDIS_PORT'] || '6379', 10);
    try {
      _ssrRedis = new Redis({
        host,
        port,
        password: pw || undefined,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 3000)),
        lazyConnect: true,
      });
      _ssrRedis.on('error', (err) => {
        if (_ssrRedisReady) console.warn('[SSR Redis] Connection error:', err.message);
      });
      _ssrRedis.on('ready', () => {
        _ssrRedisReady = true;
        console.log(`[SSR Redis] Connected to ${host}:${port}`);
      });
      _ssrRedis.on('close', () => { _ssrRedisReady = false; });
      _ssrRedis.connect().catch((err) => {
        console.warn('[SSR Redis] Initial connect failed:', err.message);
        _ssrRedis?.disconnect();
        _ssrRedis = null;
      });
    } catch { return null; }
  }
  return _ssrRedisReady ? _ssrRedis : null;
}
// Публичные страницы с коротким TTL 60s
const SSR_CACHE_PATHS = new Set(['/', '/services', '/contacts', '/about', '/testimonials', '/gallery', '/online-uslugi', '/rebranding']);
const SSR_CACHE_TTL = 60;

const app = express();
app.set('trust proxy', 2); // Behind ALB → nginx (2 proxies)
// allowedHosts configured via angular.json or app.config.server.ts
const angularApp = new AngularNodeAppEngine();

const yandexMapsScriptSrc = [
  'https://api-maps.yandex.ru',
  'https://yastatic.net',
  'https://*.maps.yandex.net',
  'https://*.maps.yandex.ru',
  'https://geocode-maps.yandex.ru',
  'https://suggest-maps.yandex.ru',
  'https://log.api-maps.yandex.ru',
  'https://regions-service.s3.yandex.net',
];

// HTTP server
const httpServer = createServer(app);

// Gzip/Brotli compression — сжимает JS/CSS/HTML на ~60-70%
app.use(compression({ threshold: 1024 }));

// Security and parsing middleware
app.use(helmet({
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://fonts.googleapis.com", "https://fpjscdn.net", "https://fpnpmcdn.net", "https://widget.cloudpayments.ru", "https://api.cloudpayments.ru", "https://mc.yandex.ru", ...yandexMapsScriptSrc],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://yastatic.net"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      connectSrc: ["'self'", "https:", "wss:", "ws:"],
      workerSrc: ["'self'", "blob:"],
      mediaSrc: ["'self'", "blob:", "https://svoefoto.ru"],
      frameSrc: ["'self'", "https://widget.cloudpayments.ru", "https://api-maps.yandex.ru", "https://yandex.ru"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));

// CORS for API
const corsOrigins = (process.env['CORS_ORIGIN'] || 'http://localhost:4200').split(',').map(s => s.trim());
app.use(cors({
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  credentials: true,
}));

// Body parsing живёт в registerApiRoutes() — Angular SSR не нуждается в json/urlencoded парсерах

/**
 * Serve static files from /browser with optimized caching headers
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      // Service Worker — НИКОГДА не кешировать
      if (path.includes('ngsw') || path.endsWith('sw.js') || path.endsWith('manifest.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return;
      }
      // Увеличиваем время жизни кеша для статических ресурсов
      if (path.match(/\.(jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot)$/i)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 год
      } else if (path.match(/\.(js|css)$/i)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 год
      } else if (path.match(/\.(html)$/i)) {
        res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 час для HTML
      }
    }
  }),
);

/**
 * Health check — SSR сервер
 */
app.get('/ssr-health', (_req, res) => {
  res.json({ success: true, service: 'ssr', port: process.env['PORT'] || 4000 });
});

/**
 * 301 редиректы для старых URL — важно для SEO
 */
const permanentRedirects: Record<string, string> = {
  '/document_copy': '/document-copy',
  '/document_print': '/document-print',
  '/premium_print': '/premium-print',
  '/document_plus': '/document-plus',
  '/foto_na_document': '/foto-na-document',
  '/foto-passport': '/foto-na-document',
  '/passport-foto': '/foto-na-pasport',
  '/magnusfoto': '/rebranding',
  '/online-services': '/online-uslugi',
  '/terms': '/oferta',
  '/contact': '/contacts',
};

app.use((req, res, next) => {
  const target = permanentRedirects[req.path];
  if (target) {
    return res.redirect(301, target);
  }
  next();
});


/**
 * Handle all other requests by rendering the Angular application.
 * Публичные страницы кешируются в Redis на 60s (SSR HTML cache).
 */
app.use(async (req, res, next) => {
  const isCacheable = req.method === 'GET'
    && !req.headers.cookie?.includes('token')
    && !req.path.startsWith('/employee')
    && !req.path.startsWith('/user-profile')
    && (SSR_CACHE_PATHS.has(req.path) || req.path.startsWith('/foto-'));

  const redis = isCacheable ? getSsrRedis() : null;
  const cacheKey = redis ? `ssr:${req.path}` : '';

  if (redis && cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Cache', 'HIT');
        res.send(cached);
        return;
      }
    } catch { /* Redis недоступен — fallback к обычному рендеру */ }
  }

  const response = await angularApp.handle(req);
  if (!response) {
    next();
    return;
  }

  // Кешируем HTML асинхронно (не блокируем ответ)
  if (redis && cacheKey && response.status === 200) {
    response.clone().text().then(html => {
      redis.set(cacheKey, html, 'EX', SSR_CACHE_TTL).catch(() => { /* noop */ });
    }).catch(() => { /* noop */ });
  }

  await writeResponseToNodeResponse(response, res);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number.parseInt(process.env['PORT'] || '4000', 10);

  httpServer.listen(port, SSR_HOST, () => {
    console.log(`[SSR Server] Listening on http://${SSR_HOST}:${port}`);
    process.send?.('ready');
  });
}

// Graceful shutdown — для pm2 kill_timeout и корректного завершения
function gracefulShutdown(signal: string) {
  console.log(`[SSR Server] ${signal} received, shutting down gracefully...`);
  httpServer.close(() => {
    _ssrRedis?.disconnect();
    process.exit(0);
  });
  // Force exit after 5s if connections don't close
  setTimeout(() => {
    console.log('[SSR Server] Forced exit after timeout');
    process.exit(0);
  }, 5000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Request handler used by the Angular CLI (for dev-server and during build).
 */
export const reqHandler = createNodeRequestHandler(app);
