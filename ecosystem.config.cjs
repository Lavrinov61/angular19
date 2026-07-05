// Загружаем секреты из backend/.env в process.env
const path = require('path');
const dotenvPath = path.join(__dirname, 'backend', '.env');
try { require('dotenv').config({ path: dotenvPath }); }
catch (_) {
  // dotenv не установлен на верхнем уровне — пробуем из backend
  try { require('./backend/node_modules/dotenv').config({ path: dotenvPath }); }
  catch (_) { /* .env переменные должны быть в окружении */ }
}

const splitEnabled = process.env.SPLIT_ENABLED === 'true';
const directDbPort = process.env.DB_PORT || 5432;
const pooledDbPort = 6432;
const appDbPort = splitEnabled ? pooledDbPort : directDbPort;
const telephonyPort = process.env.TELEPHONY_PORT || 3009;
const prodCwd = '/var/www/apimain/angular-app';

// Общие переменные окружения для обоих процессов
// Секреты читаются из process.env (загружаются из backend/.env)
const sharedEnv = {
  NODE_ENV: 'production',
  SPLIT_ENABLED: splitEnabled ? 'true' : 'false',
  BASE_URL: process.env.BASE_URL || 'https://svoefoto.ru',
  // Database
  DB_HOST: process.env.DB_HOST || 'rc1b-ihjtr0uu8m7vgdjb.mdb.yandexcloud.net',
  DB_PORT: appDbPort,
  DB_SSL: process.env.DB_SSL || 'true',
  DB_NAME: process.env.DB_NAME || 'magnus_photo_db',
  DB_USER: process.env.DB_USER || 'magnus_user',
  DB_PASSWORD: process.env.DB_PASSWORD || undefined,
  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'https://svoefoto.ru,http://localhost:4200',
  // Redis
  REDIS_HOST: process.env.REDIS_HOST || 'rc1b-ke99dutk1jbectc6.mdb.yandexcloud.net',
  REDIS_PORT: process.env.REDIS_PORT || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  // Telegram: Telegram's webhook delivery to 84.38.189.58 currently times out before nginx,
  // while outbound Bot API access works through the configured proxy. Keep inbound on permanent
  // polling so customer messages are pulled immediately instead of waiting for fallback recovery.
  TELEGRAM_POLLING_MODE: process.env.TELEGRAM_POLLING_MODE || 'always',
  TELEGRAM_WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL || 'https://svoefoto.ru/api/webhooks/telegram',
  HTTP_PROXY: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy,
  HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy,
  http_proxy: process.env.http_proxy || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy,
  https_proxy: process.env.https_proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.http_proxy,
  NO_PROXY: process.env.NO_PROXY || process.env.no_proxy,
  no_proxy: process.env.no_proxy || process.env.NO_PROXY,
  TELEPHONY_PORT: splitEnabled ? telephonyPort : 3001,
};

const baseApp = {
  cwd: prodCwd,
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  watch: false,
  max_restarts: 15,
  min_uptime: '10s',
  exp_backoff_restart_delay: 100,
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
};

const apiApp = {
  ...baseApp,
  name: 'magnus-photo-api',
  script: 'backend/dist/server.js',
  wait_ready: true,
  listen_timeout: 10000,
  kill_timeout: 30000,
  max_memory_restart: splitEnabled ? '1024M' : '800M',
  env: {
    ...sharedEnv,
    PROCESS_ROLE: splitEnabled ? 'api' : 'monolith',
    PORT: 3001,
    API_PORT: 3001,
    DB_POOL_MAX: splitEnabled ? 15 : 12,
  },
};

const ssrApp = {
  ...baseApp,
  name: 'magnus-photo-ssr',
  script: 'dist/magnus-photo/server/server.mjs',
  wait_ready: true,
  listen_timeout: 15000,
  kill_timeout: 5000,
  max_memory_restart: '768M',
  env: {
    ...sharedEnv,
    PORT: 4000,
    API_PORT: 3001,
  },
};

const splitApps = [
  {
    ...baseApp,
    name: 'magnus-photo-scheduler',
    script: 'backend/dist/scheduler.js',
    wait_ready: true,
    listen_timeout: 15000,
    kill_timeout: 30000,
    max_memory_restart: '400M',
    env: {
      ...sharedEnv,
      PROCESS_ROLE: 'scheduler',
      PORT: 3008,
      DB_PORT: directDbPort,
      DB_POOL_MAX: 3,
    },
  },
  {
    ...baseApp,
    name: 'magnus-photo-worker-ai',
    script: 'backend/dist/workers/ai.js',
    wait_ready: true,
    listen_timeout: 15000,
    kill_timeout: 30000,
    max_memory_restart: '500M',
    env: {
      ...sharedEnv,
      PROCESS_ROLE: 'worker-ai',
      PORT: 3005,
      DB_POOL_MAX: 6,
    },
  },
  {
    ...baseApp,
    name: 'magnus-photo-worker-outbound',
    script: 'backend/dist/workers/outbound.js',
    wait_ready: true,
    listen_timeout: 15000,
    kill_timeout: 30000,
    max_memory_restart: '500M',
    env: {
      ...sharedEnv,
      PROCESS_ROLE: 'worker-outbound',
      PORT: 3006,
      DB_POOL_MAX: 8,
    },
  },
  {
    ...baseApp,
    name: 'magnus-photo-worker-bot',
    script: 'backend/dist/workers/bot.js',
    wait_ready: true,
    listen_timeout: 15000,
    kill_timeout: 30000,
    max_memory_restart: '500M',
    env: {
      ...sharedEnv,
      PROCESS_ROLE: 'worker-bot',
      PORT: 3007,
      DB_POOL_MAX: 6,
    },
  },
  {
    ...baseApp,
    name: 'magnus-photo-telephony',
    script: 'backend/dist/telephony.js',
    wait_ready: true,
    listen_timeout: 10000,
    kill_timeout: 30000,
    max_memory_restart: '384M',
    env: {
      ...sharedEnv,
      PROCESS_ROLE: 'telephony',
      PORT: telephonyPort,
      API_PORT: 3001,
      DB_POOL_MAX: 4,
    },
  },
  {
    ...baseApp,
    name: 'magnus-photo-worker-vk',
    script: 'backend/dist/workers/vk.js',
    wait_ready: true,
    listen_timeout: 15000,
    kill_timeout: 30000,
    max_memory_restart: '384M',
    env: {
      ...sharedEnv,
      PROCESS_ROLE: 'worker-vk',
      PORT: 3010,
      DB_POOL_MAX: 4,
    },
  },
];

module.exports = {
  apps: splitEnabled ? [apiApp, ssrApp, ...splitApps] : [apiApp, ssrApp],
};
