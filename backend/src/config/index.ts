import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { createLogger } from '../utils/logger.js';
import { getProcessRole } from '../websocket/role.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('config');

// Load .env from multiple possible locations (SSR/build/runtime safe)
const candidateEnvPaths = [
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
];

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const voximplantEnabled = !!process.env['VOXIMPLANT_ACCOUNT_ID'] && !!process.env['VOXIMPLANT_API_KEY'];
const voximplantCredentialsPath = process.env['VOXIMPLANT_CREDENTIALS_PATH'] || '';
const voximplantSmsEnabled = voximplantEnabled && process.env['VOXIMPLANT_SMS_ENABLED'] === 'true';
const voximplantSmsMode = process.env['VOXIMPLANT_SMS_MODE'] === 'two_way' ? 'two_way' : 'a2p';
const voximplantVoiceCallRuleId = process.env['VOXIMPLANT_VOICE_CALL_RULE_ID']
  || process.env['VOXIMPLANT_FLASH_CALL_RULE_ID']
  || '';
const voximplantVoiceCallCallerIds = (process.env['VOXIMPLANT_VOICE_CALLER_IDS']
  || process.env['VOXIMPLANT_FLASH_CALLER_IDS']
  || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const publicBaseUrl = (
  process.env['BASE_URL']
  || process.env['PUBLIC_BASE_URL']
  || 'https://svoefoto.ru'
).replace(/\/+$/, '');
const defaultAlfaBankApiBaseUrl = 'https://alfa.rbsuat.com/payment/rest';
const voximplantVoiceCallCallbackUrl = process.env['VOXIMPLANT_VOICE_CALL_CALLBACK_URL']
  || process.env['VOXIMPLANT_FLASH_CALL_CALLBACK_URL']
  || `${publicBaseUrl}/api/telephony/voice-otp/event`;
const voximplantVoiceCallCallbackSecret = process.env['VOXIMPLANT_VOICE_CALL_CALLBACK_SECRET']
  || process.env['VOXIMPLANT_FLASH_CALL_CALLBACK_SECRET']
  || '';
// Единый секрет аутентификации всех Voximplant webhook-эндпоинтов
// (/incoming-call, /call-event, /voice-otp/event, /service-survey/result).
// Fallback на старый callbackSecret для обратной совместимости.
const voximplantWebhookSecret = process.env['VOXIMPLANT_WEBHOOK_SECRET']
  || voximplantVoiceCallCallbackSecret
  || '';
// 'dual-accept' (по умолчанию) — принимать подписанные и неподписанные (grace) запросы;
// 'enforce' — требовать валидную подпись/секрет, fail-closed при пустом секрете в проде.
const voximplantWebhookAuthMode: 'dual-accept' | 'enforce' =
  process.env['VOXIMPLANT_WEBHOOK_AUTH_MODE'] === 'enforce' ? 'enforce' : 'dual-accept';
const voximplantWebhookMaxSkewSec = parseInt(
  process.env['VOXIMPLANT_WEBHOOK_MAX_SKEW_SEC'] || '300',
  10,
);
const voximplantVoiceCallEnabled = voximplantEnabled
  && (process.env['VOXIMPLANT_VOICE_CALL_ENABLED'] ?? process.env['VOXIMPLANT_FLASH_CALL_ENABLED']) !== 'false'
  && !!voximplantVoiceCallRuleId
  && voximplantVoiceCallCallerIds.length > 0;
const voximplantVoiceCallConfig = {
  enabled: voximplantVoiceCallEnabled,
  ruleId: voximplantVoiceCallRuleId,
  callerIds: voximplantVoiceCallCallerIds,
  callbackUrl: voximplantVoiceCallCallbackUrl,
  callbackSecret: voximplantVoiceCallCallbackSecret,
  ttlSeconds: parseInt(
    process.env['VOXIMPLANT_VOICE_CALL_TTL_SECONDS']
      || process.env['VOXIMPLANT_FLASH_CALL_TTL_SECONDS']
      || '120',
    10,
  ),
  hangupAfterMs: parseInt(
    process.env['VOXIMPLANT_VOICE_CALL_HANGUP_MS']
      || process.env['VOXIMPLANT_FLASH_CALL_HANGUP_MS']
      || '15000',
    10,
  ),
  dispatcher: {
    dispatchTimeoutMs: parseInt(
      process.env['VOXIMPLANT_VOICE_CALL_DISPATCH_TIMEOUT_MS'] || '12000',
      10,
    ),
    providerTimeoutMs: parseInt(
      process.env['VOXIMPLANT_VOICE_CALL_PROVIDER_TIMEOUT_MS'] || '10000',
      10,
    ),
    retryDelayMs: parseInt(
      process.env['VOXIMPLANT_VOICE_CALL_RETRY_DELAY_MS'] || '250',
      10,
    ),
    maxAttempts: parseInt(
      process.env['VOXIMPLANT_VOICE_CALL_MAX_ATTEMPTS'] || '2',
      10,
    ),
    slotsPerCaller: parseInt(
      process.env['VOXIMPLANT_VOICE_CALL_SLOTS_PER_CALLER'] || '1',
      10,
    ),
    slotLockTtlMs: parseInt(
      process.env['VOXIMPLANT_VOICE_CALL_SLOT_LOCK_TTL_MS'] || '30000',
      10,
    ),
  },
};
const voximplantStudioClickToCallConfig = {
  enabled: voximplantEnabled && process.env['VOXIMPLANT_STUDIO_CLICK_TO_CALL_ENABLED'] !== 'false',
  outboundRuleId: process.env['VOXIMPLANT_STUDIO_OUTBOUND_RULE_ID'] || '8860948',
  sipUser: process.env['TELEPHONY_STUDIO_VOIP_USER'] || 'soborny101',
  callerId: process.env['VOXIMPLANT_STUDIO_CALLER_ID'] || '+78633226575',
};
const DEFAULT_SERVICE_SURVEY_QUESTION = 'Здравствуйте, это "Своё Фото". Мы хотим стать удобнее для клиентов. Подскажите, какую услугу нам стоит добавить?';
// Первая реплика разговорного опроса: короткое живое приветствие и один простой вопрос.
// Без тире (правило копирайтинга проекта). Предгенерируется в аудио, чтобы старт
// звучал мгновенно. Дальше диалог ведёт мозг.
const DEFAULT_SERVICE_SURVEY_GREETING = 'Здравствуйте! Это Своё Фото. Удобно пару минут? Хотим задать короткий вопрос.';
// Системный промпт для realtime-режима Grok Voice Agent (бот сам ведёт весь диалог
// speech-to-speech). Без тире.
const DEFAULT_REALTIME_INSTRUCTIONS = 'Контекст: звонок от Своё Фото клиенту. Своё Фото: фото на документы, печать и дизайн. Причина звонка: узнать, нужна ли клиенту помощь по услугам. Разговор на русском.';
const voximplantServiceSurveyConfig = {
  enabled: voximplantEnabled && process.env['VOXIMPLANT_SERVICE_SURVEY_ENABLED'] !== 'false',
  outboundRuleId: process.env['VOXIMPLANT_SERVICE_SURVEY_RULE_ID']
    || process.env['VOXIMPLANT_STUDIO_OUTBOUND_RULE_ID']
    || voximplantStudioClickToCallConfig.outboundRuleId,
  callerId: process.env['VOXIMPLANT_SERVICE_SURVEY_CALLER_ID'] || voximplantStudioClickToCallConfig.callerId,
  question: process.env['VOXIMPLANT_SERVICE_SURVEY_QUESTION'] || DEFAULT_SERVICE_SURVEY_QUESTION,
  maxAnswerMs: parseInt(process.env['VOXIMPLANT_SERVICE_SURVEY_MAX_ANSWER_MS'] || '45000', 10),
  // ─── Разговорный режим (опрос-забота вместо одностороннего IVR) ───
  // Включён по умолчанию; откат на старый односторонний робот = env=false.
  conversational: process.env['VOXIMPLANT_SERVICE_SURVEY_CONVERSATIONAL'] !== 'false',
  greeting: process.env['VOXIMPLANT_SERVICE_SURVEY_GREETING'] || DEFAULT_SERVICE_SURVEY_GREETING,
  // Сколько ходов клиента слушаем, прежде чем вежливо завершить (страховка от зацикливания).
  maxTurns: parseInt(process.env['VOXIMPLANT_SERVICE_SURVEY_MAX_TURNS'] || '6', 10),
  // Голосовой движок: 'grok_realtime' = ЖИВОЙ realtime Grok Voice Agent (speech-to-speech,
  // перебивание, голос Irina) — мозг и голос целиком в Grok; 'remote' = TTS-каскад через
  // OpenRouter (фолбэк); 'voximplant' = встроенный TTS Яндекс (последний фолбэк).
  voiceEngine: (process.env['VOXIMPLANT_SERVICE_SURVEY_VOICE_ENGINE'] || 'remote') as 'remote' | 'voximplant' | 'grok_realtime',
  // Модель и голос синтеза речи (OpenRouter /audio/speech). По умолчанию ГОЛОС GROK
  // (x-ai/grok-voice-tts-1.0, голоса Eve/Ara/Rex/Sal/Leo, 20+ языков, $15/M симв) —
  // доступен на нашем ключе OpenRouter, без отдельного ключа xAI. Альтернатива:
  // openai/gpt-4o-mini-tts-2025-12-15 (alloy/shimmer/coral/...). ВАЖНО: суффикс версии в id обязателен.
  voiceModel: process.env['VOXIMPLANT_SERVICE_SURVEY_VOICE_MODEL'] || 'x-ai/grok-voice-tts-1.0',
  voiceName: process.env['VOXIMPLANT_SERVICE_SURVEY_VOICE_NAME'] || 'Eve',
  // Тон озвучки (instructions) — поддерживает только OpenAI TTS, Grok игнорит. Пусто = выкл.
  voiceInstructions: process.env['VOXIMPLANT_SERVICE_SURVEY_VOICE_INSTRUCTIONS'] || '',
  // Мозг диалога (текст реплик) через OpenRouter. По умолчанию Grok (тот же вендор,
  // что и голос; реагирует быстрее Claude — короче пауза в звонке). Альтернатива для
  // более «тёплой» эмпатии: anthropic/claude-sonnet-4.6 (там же включается prompt-caching).
  brainModel: process.env['VOXIMPLANT_SERVICE_SURVEY_BRAIN_MODEL'] || 'x-ai/grok-4.20',
  // ─── Realtime (Grok Voice Agent) ───
  // Модель/голос голос-агента xAI через готовый Voximplant Grok Voice Agent client.
  // Ключ xAI хранится в секрете Voximplant XAI_API_KEY.
  realtimeModel: process.env['VOXIMPLANT_SERVICE_SURVEY_REALTIME_MODEL'] || 'grok-voice-think-fast-1.0',
  realtimeVoice: process.env['VOXIMPLANT_SERVICE_SURVEY_REALTIME_VOICE'] || 'om17cury',
  realtimeInstructions: DEFAULT_REALTIME_INSTRUCTIONS,
  realtimeBridgeUrl: process.env['VOXIMPLANT_SERVICE_SURVEY_REALTIME_BRIDGE_URL']
    || `${publicBaseUrl}/api/telephony/service-survey/realtime`,
  realtimeBridgeTokenTtlMs: parseInt(
    process.env['VOXIMPLANT_SERVICE_SURVEY_REALTIME_BRIDGE_TOKEN_TTL_MS'] || '1800000',
    10,
  ),
};
const defaultMailAddress = 'info@svoefoto.ru';
const defaultMailAliases = [defaultMailAddress, 'info@fmagnus.org'];
const mailAddressAliases = (process.env['MAIL_ADDRESS_ALIASES'] || defaultMailAliases.join(','))
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);
const DEFAULT_CLOUDPAYMENTS_TAXATION_SYSTEM = 1;

function parseCloudPaymentsTaxationSystem(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_CLOUDPAYMENTS_TAXATION_SYSTEM), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) {
    return DEFAULT_CLOUDPAYMENTS_TAXATION_SYSTEM;
  }
  return parsed;
}

if (process.env['NODE_ENV'] !== 'production') {
  if (process.env['DB_PASSWORD']) {
    logger.info('✅ .env loaded successfully');
  } else {
    logger.warn('⚠️  .env not loaded or DB_PASSWORD not set');
  }
}

export const config = {
  /** PM2-split process role — 'api' | 'scheduler' | 'worker-ai' | 'worker-outbound' | 'worker-bot' | 'telephony' | 'monolith'. */
  role: getProcessRole(),
  database: {
    host: process.env['DB_HOST'] || 'localhost',
    port: parseInt(process.env['DB_PORT'] || '6432', 10),
    database: process.env['DB_NAME'] || 'magnus_photo_db',
    user: process.env['DB_USER'] || 'magnus_user',
    password: process.env['DB_PASSWORD'] || '',
    ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : false,
    pool: {
      max: parseInt(process.env['DB_POOL_MAX'] || '12', 10),
      min: 4,
      connectionTimeoutMillis: parseInt(process.env['DB_POOL_CONNECTION_TIMEOUT_MS'] || '3000', 10),
      idleTimeoutMillis: parseInt(process.env['DB_POOL_IDLE_TIMEOUT_MS'] || '15000', 10),
      statementTimeoutMs: parseInt(process.env['DB_POOL_STATEMENT_TIMEOUT_MS'] || '10000', 10),
    },
  },
  jwt: {
    secret: (() => {
      const s = process.env['JWT_SECRET'];
      if (!s) {
        logger.error('JWT_SECRET is not set! Refusing to start with insecure fallback.');
        if (process.env['NODE_ENV'] === 'production') throw new Error('JWT_SECRET is required in production');
        return 'DEV_ONLY_UNSAFE_SECRET';
      }
      return s;
    })(),
    /** Previous JWT secret for key rotation. Optional — set JWT_SECRET_PREVIOUS during rotation. */
    secretPrevious: process.env['JWT_SECRET_PREVIOUS'] || '',
    expiresIn: process.env['JWT_EXPIRES_IN'] || '15m',
    refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] || '30d',
  },
  yandex: {
    clientId: process.env['YANDEX_CLIENT_ID'] || '',
    clientSecret: process.env['YANDEX_CLIENT_SECRET'] || '',
    redirectUri: process.env['YANDEX_REDIRECT_URI'] || 'http://localhost:3000/api/auth/yandex/callback',
  },
  google: {
    clientId: process.env['GOOGLE_CLIENT_ID'] || '',
    clientSecret: process.env['GOOGLE_CLIENT_SECRET'] || '',
    redirectUri: process.env['GOOGLE_REDIRECT_URI'] || 'http://localhost:3000/api/auth/google/callback',
  },
  apple: {
    clientId: process.env['APPLE_CLIENT_ID'] || '',
    clientSecret: process.env['APPLE_CLIENT_SECRET'] || '',
    redirectUri: process.env['APPLE_REDIRECT_URI'] || 'http://localhost:3000/api/auth/apple/callback',
    teamId: process.env['APPLE_TEAM_ID'] || '',
    keyId: process.env['APPLE_KEY_ID'] || '',
  },
  sber: {
    clientId: process.env['SBER_CLIENT_ID'] || '',
    clientSecret: process.env['SBER_CLIENT_SECRET'] || '',
    redirectUri: process.env['SBER_REDIRECT_URI'] || 'https://svoefoto.ru/api/auth/sber/callback',
  },
  mts: {
    clientId: process.env['MTS_CLIENT_ID'] || '',
    clientSecret: process.env['MTS_CLIENT_SECRET'] || '',
    redirectUri: process.env['MTS_REDIRECT_URI'] || 'https://svoefoto.ru/api/auth/mts/callback',
  },
  vk: {
    // OAuth (вход через VK ID — id.vk.com, OpenID Connect)
    clientId: process.env['VK_CLIENT_ID'] || '',
    clientSecret: process.env['VK_CLIENT_SECRET'] || '',
    redirectUri: process.env['VK_REDIRECT_URI'] || 'https://svoefoto.ru/api/auth/vk/callback',
    // Callback API (чат-бот, webhook)
    groupToken: process.env['VK_GROUP_TOKEN'] || '',
    groupId: process.env['VK_GROUP_ID'] || '',
    confirmationCode: process.env['VK_CONFIRMATION_CODE'] || '',
    secretKey: process.env['VK_SECRET_KEY'] || '',
    enabled: !!process.env['VK_GROUP_TOKEN'],
  },
  telegram: {
    botToken: process.env['TELEGRAM_BOT_TOKEN'] || '',
    botUsername: process.env['TELEGRAM_BOT_USERNAME'] || 'FmagnusBot',
    adminChatIds: (process.env['TELEGRAM_ADMIN_CHAT_IDS'] || '').split(',').filter(Boolean),
    gatewayToken: process.env['TELEGRAM_GATEWAY_TOKEN'] || '',
    webhookSecret: process.env['TELEGRAM_WEBHOOK_SECRET'] || '',
    apiUrl: process.env['TELEGRAM_API_URL'] || 'https://api.telegram.org',
    enabled: !!process.env['TELEGRAM_BOT_TOKEN'],
  },
  server: {
    port: parseInt(process.env['PORT'] || '3000', 10),
    nodeEnv: process.env['NODE_ENV'] || 'production',
    shutdownTimeoutMs: parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] || '30000', 10),
  },
  upload: {
    dir: process.env['UPLOAD_DIR'] || './uploads',
    maxFileSize: parseInt(process.env['MAX_FILE_SIZE'] || '10485760', 10), // 10MB
    allowedMimeTypes: (process.env['ALLOWED_MIME_TYPES'] || 'image/jpeg,image/png,image/webp,image/gif').split(','),
  },
  cors: {
    origin: process.env['CORS_ORIGIN'] || 'http://localhost:4200',
  },
  mobileGrpc: {
    internalSecret: process.env['MOBILE_GRPC_INTERNAL_SECRET']
      || process.env['GRPC_INTERNAL_AUTH_SECRET']
      || process.env['JWT_SECRET']
      || '',
  },
  redis: {
    host: process.env['REDIS_HOST'] || 'localhost',
    port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
    password: process.env['REDIS_PASSWORD'] || undefined,
    tls: process.env['REDIS_TLS'] === 'true' ? {} : undefined,
  },
  cloudPayments: {
    publicId: process.env['CLOUDPAYMENTS_PUBLIC_ID'] || '',
    apiSecret: process.env['CLOUDPAYMENTS_API_SECRET'] || '',
    taxationSystem: parseCloudPaymentsTaxationSystem(process.env['CLOUDPAYMENTS_TAXATION_SYSTEM']),
  },
  alfaBank: {
    enabled: process.env['ALFABANK_PAYMENTS_ENABLED'] === 'true',
    apiBaseUrl: (process.env['ALFABANK_API_BASE_URL'] || defaultAlfaBankApiBaseUrl).replace(/\/+$/, ''),
    userName: process.env['ALFABANK_USER_NAME'] || '',
    password: process.env['ALFABANK_PASSWORD'] || '',
    returnUrl: process.env['ALFABANK_RETURN_URL'] || `${publicBaseUrl}/payments/alfabank/return`,
    failUrl: process.env['ALFABANK_FAIL_URL'] || `${publicBaseUrl}/payments/alfabank/fail`,
    webhookSecret: process.env['ALFABANK_WEBHOOK_SECRET'] || '',
  },
  actions: {
    apiKey: process.env['ACTIONS_API_KEY'] || '',
    paymentSecret: process.env['ACTIONS_PAYMENT_SECRET'] || process.env['ACTIONS_API_KEY'] || '',
  },
  alice: {
    webhookToken: process.env['ALICE_WEBHOOK_TOKEN'] || '',
  },
  yandexGpt: {
    apiKey: process.env['YANDEX_CLOUD_API_KEY'] || '',
    folderId: process.env['YANDEX_CLOUD_FOLDER_ID'] || 'b1gttu8ne7l6jcpgn6cs',
    model: process.env['YANDEX_CLOUD_MODEL'] || 'yandexgpt-lite',
  },
  // AI Provider abstraction (ПЛАН 9)
  ai: {
    provider: process.env['AI_PROVIDER'] || 'gemini',   // 'gemini' | 'grok' | 'claude'
    geminiApiKey: process.env['GEMINI_API_KEY'] || '',
    grokApiKey: process.env['GROK_API_KEY'] || '',
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'] || '',
    autoReplyEnabled: process.env['AI_AUTO_REPLY_ENABLED'] === 'true',  // default: false (выключено)
    // Старый LLM-воркер CRM-подсказок (ai_chat_worker.py через Gemini): резюме/
    // подсказки оператору/приоритет задач. Заменяется новым ИИ-агентом, по умолчанию
    // ВЫКЛЮЧЕН (был сломан: Gemini free-tier 429 + auth-fail). При false функции
    // возвращают безопасные фолбэки и НЕ спавнят python-воркер.
    crmLegacyEnabled: process.env['AI_CRM_LEGACY_ENABLED'] === 'true',  // default: false
    // AI-агент через OpenRouter (Этап 0-1)
    openrouterApiKey: process.env['OPENROUTER_API_KEY'] || '',
    agentModel: process.env['AI_AGENT_MODEL'] || 'anthropic/claude-sonnet-4.6',
    agentClassifierModel: process.env['AI_AGENT_CLASSIFIER_MODEL'] || 'deepseek/deepseek-chat-v3.1',  // НЕ reasoning: сразу выводит вердикт (v4-flash рассуждал, упирался в maxTokens -> пустой ответ -> ложный handoff на каждом сообщении)
    agentEnabled: process.env['AI_AGENT_ENABLED'] === 'true',  // default: false (тёмный запуск)
    // Этап 3: оформление заказов и ссылки оплаты (включается отдельно после смоука)
    orderingEnabled: process.env['AI_AGENT_ORDERING_ENABLED'] === 'true',  // default: false
    // порог авто-оформления, руб. NaN-guard: мисконфиг (напр. '=abc') НЕ должен
    // молча отключать порог (serverTotal > NaN === false во всех проверках ->
    // бот оформил бы заказ любой суммы). Фолбэк 5000, как дефолт.
    maxAutoOrder: (() => {
      const n = Number.parseInt(process.env['AI_AGENT_MAX_AUTO_ORDER'] ?? '', 10);
      return Number.isFinite(n) && n > 0 ? n : 5000;
    })(),
    // Потолок tool-циклов одного хода оркестратора. Был хардкод 6 -> частые дорогие
    // эскалации max_steps на сложных вопросах. Поднят до 8 (env). NaN-guard как maxAutoOrder.
    maxSteps: (() => {
      const n = Number.parseInt(process.env['AI_AGENT_MAX_STEPS'] ?? '', 10);
      return Number.isFinite(n) && n > 0 ? n : 8;
    })(),
    // Авто-возврат диалога operator->bot после паузы тишины оператора (по новому
    // сообщению клиента). default ON (это починка залипших диалогов, не новое клиентское
    // поведение). Мгновенный стоп без передеплоя: Redis-ключ ai:auto_return='false'.
    autoReturnEnabled: process.env['AI_AGENT_AUTO_RETURN_ENABLED'] !== 'false',  // default: true
    // Порог тишины (мин) для возврата после авто-эскалации бота (set_by='agent_handoff').
    handoffReturnMinutes: (() => {
      const n = Number.parseInt(process.env['AI_AGENT_HANDOFF_RETURN_MINUTES'] ?? '', 10);
      return Number.isFinite(n) && n > 0 ? n : 30;
    })(),
    // Порог тишины (мин) для возврата после перехвата живым оператором (set_by='operator:<uuid>').
    operatorReturnMinutes: (() => {
      const n = Number.parseInt(process.env['AI_AGENT_OPERATOR_RETURN_MINUTES'] ?? '', 10);
      return Number.isFinite(n) && n > 0 ? n : 240;
    })(),
    // Короткое сервисное подтверждение на голые вложения (файлы/фото на печать).
    // default OFF (тёмный запуск — новое клиентское сообщение, включается после смоука текста).
    filesAckEnabled: process.env['AI_AGENT_FILES_ACK_ENABLED'] === 'true',  // default: false
    // Cooldown (ч) между подтверждениями файлов в одном диалоге: постоянный клиент при
    // повторном обращении через cooldown снова получит подтверждение, а не висит в тишине.
    filesAckCooldownHours: (() => {
      const n = Number.parseInt(process.env['AI_AGENT_FILES_ACK_COOLDOWN_HOURS'] ?? '', 10);
      return Number.isFinite(n) && n > 0 ? n : 12;
    })(),
  },
  webPush: {
    publicKey: process.env['WEB_PUSH_PUBLIC_KEY'] || '',
    privateKey: process.env['WEB_PUSH_PRIVATE_KEY'] || '',
    subject: process.env['WEB_PUSH_SUBJECT'] || 'mailto:info@svoefoto.ru',
  },
  dadata: {
    apiKey: process.env['DADATA_API_KEY'] || '',
    secretKey: process.env['DADATA_SECRET_KEY'] || '',
    cleanerUrl: 'https://cleaner.dadata.ru/api/v1/clean/address',
  },
  mail: {
    address: defaultMailAddress,
    aliases: Array.from(new Set([defaultMailAddress, ...mailAddressAliases])),
  },
  smtp: {
    host: process.env['SMTP_HOST'] || 'smtp.yandex.ru',
    port: parseInt(process.env['SMTP_PORT'] || '465', 10),
    user: process.env['SMTP_USER'] || defaultMailAddress,
    password: process.env['SMTP_PASSWORD'] || '',
    from: process.env['SMTP_FROM'] || `"Своё Фото" <${defaultMailAddress}>`,
  },
  maxBot: {
    accessToken: process.env['MAX_BOT_ACCESS_TOKEN'] || '',
    apiUrl: process.env['MAX_BOT_API_URL'] || 'https://platform-api.max.ru',
    webhookSecret: process.env['MAX_WEBHOOK_SECRET'] || '',
    enabled: !!process.env['MAX_BOT_ACCESS_TOKEN'],
  },
  reviewSync: {
    enabled: process.env['REVIEW_SYNC_ENABLED'] !== 'false',
    intervalHours: parseInt(process.env['REVIEW_SYNC_INTERVAL_HOURS'] || '24', 10),
    locations: [
      {
        slug: 'soborny',
        name: 'Соборный',
        dgisOrgId: '70000001006548410',
        dgisUrl: 'https://2gis.ru/rostov-on-don/firm/70000001006548410',
        googleReviewUrl: 'https://g.page/r/CdLAfLUuNAGrEBM/review',
        yandexReviewUrl: 'https://yandex.ru/maps/org/magnusfoto/50414539463/reviews/',
      },
    ],
  },
  /** @deprecated bridge.posUrl — Python print-bridge-service is inactive; Rust print-api handles printing via MQTT. Safe to remove after 2026-04-30. */
  bridge: {
    url: process.env['BRIDGE_API_URL'] || 'http://localhost:5052',
    posUrl: process.env['POS_BRIDGE_URL'] || 'http://localhost:8888',
  },
  pos: {
    /**
     * Гард приёма карты при офлайне терминала (S4/S2). Default OFF —
     * включается после смоука на живой кассе. Мягкая деградация: при
     * отсутствии/устаревшей telemetry гард пускает оплату.
     */
    terminalGateEnabled: process.env['POS_TERMINAL_GATE_ENABLED'] === 'true',
    /**
     * Авто-алерт владельцу о расхождении касса↔терминал при закрытии смены.
     * Default OFF — сначала копим данные сверки, потом включаем (P0-1:
     * соответствие касса card ↔ терминал карты/QR на проде неоднозначно).
     */
    reconAlertEnabled: process.env['POS_RECON_ALERT_ENABLED'] === 'true',
    /**
     * Разрешение зависших (in_doubt) оплат через POST /payments/:id/resolve:
     * outcome='paid' создаёт чек по сохранённым позициям и фискализирует приход
     * БЕЗ повторного списания. Default OFF — денежно-фискальное поведение,
     * включается после смоука на живой кассе. При OFF resolve только метит
     * payment_resolution (старое поведение Этапа 1).
     */
    indoubtResolveEnabled: process.env['POS_INDOUBT_RESOLVE_ENABLED'] === 'true',
    /**
     * Детектор осиротевших карт-оплат (completed без чека): GET /payments/orphan
     * отдаёт список + leader-only sweep шлёт уведомления сотруднику/клиенту,
     * POST /payments/:id/create-receipt оформляет чек. Default OFF — денежно-
     * фискальное поведение и наружное уведомление клиента, включается после
     * смоука. При OFF /payments/orphan отдаёт пустой список, sweep рано выходит,
     * create-receipt запрещён.
     */
    orphanDetectEnabled: process.env['POS_ORPHAN_DETECT_ENABLED'] === 'true',
    /** Возраст completed-оплаты (мин) для детекта orphan: completed_at <= NOW()-N. */
    orphanPaymentAgeMinutes: parseInt(process.env['POS_ORPHAN_PAYMENT_AGE_MINUTES'] || '5', 10),
    /** Интервал тика orphan-sweep (мс). */
    orphanCheckIntervalMs: parseInt(process.env['POS_ORPHAN_CHECK_INTERVAL_MS'] || '180000', 10),
    /**
     * Авто-уведомление клиента в привязанный чат о факте получения оплаты
     * (orphan-sweep). Default OFF — наружное сообщение, включается отдельно от
     * orphanDetectEnabled. При OFF клиенту ничего не шлём, только сотруднику.
     */
    orphanClientNotifyEnabled: process.env['POS_ORPHAN_CLIENT_NOTIFY_ENABLED'] === 'true',
    /**
     * Авто-ретрай фискализации (leader-only sweep): повторный enqueueFiscal для
     * pending/failed-чеков без completed fiscal_sale. Default OFF — включается
     * после смоука. При OFF sweep рано выходит, ручная кнопка fiscal-retry работает.
     */
    fiscalAutoretryEnabled: process.env['POS_FISCAL_AUTORETRY_ENABLED'] === 'true',
    /** Интервал тика fiscal-retry-sweep (мс). */
    fiscalAutoretryIntervalMs: parseInt(process.env['POS_FISCAL_AUTORETRY_INTERVAL_MS'] || '300000', 10),
    /** Стоп ретрая по числу fiscal_sale/refund-tx у чека (анти-зацикливание). */
    fiscalAutoretryMax: parseInt(process.env['POS_FISCAL_AUTORETRY_MAX'] || '5', 10),
    /**
     * Окно свежести чека (мин) для fiscal-retry-sweep: pr.created_at > NOW()-N.
     * Default 1440 (24ч) — legacy failed/queued (старше суток) sweep НЕ трогает,
     * только ручная кнопка (P1.2: иначе обстрел старого до COUNT>=MAX).
     */
    fiscalAutoretryMaxAgeMinutes: parseInt(process.env['POS_FISCAL_AUTORETRY_MAX_AGE_MINUTES'] || '1440', 10),
    /**
     * Брать ли в fiscal-retry-sweep застрявшие queued/processing-чеки. Default
     * OFF — застрявший queued может иметь in-flight fiscal_sale на ATOL (риск
     * двойного чека); включение — backlog с abandon-CAS по подтверждению ATOL.
     */
    fiscalSweepIncludeStuck: process.env['POS_FISCAL_SWEEP_INCLUDE_STUCK'] === 'true',
    /** Порог «зависшего» queued/processing (мин) при fiscalSweepIncludeStuck=true. */
    fiscalAutoretryStaleMinutes: parseInt(process.env['POS_FISCAL_AUTORETRY_STALE_MINUTES'] || '15', 10),
    /**
     * Order-first персистентность состава заказа в command_payload payment-tx ДО
     * отправки на терминал. При ON /bridge/pay канонизирует и сохраняет snapshot
     * (прямая корзина) либо строит его из pricing (услуги) серверным расчётом —
     * чтобы при обрыве/in_doubt чек допробивался без потери номенклатуры. Default
     * OFF — при OFF /bridge/pay пишет старый payload {orderId} (обратная
     * совместимость со старым фронтом). Денежная 54-ФЗ-сверка суммы остаётся на
     * материализации чека, /bridge/pay её НЕ делает (совместимо со сплитом).
     */
    orderFirstEnabled: process.env['POS_ORDER_FIRST_ENABLED'] === 'true',
  },
  chat: {
    botEnabled: process.env['CHAT_BOT_ENABLED'] !== 'false',
    useAiFirst: process.env['CHAT_USE_AI_FIRST'] !== 'false',
  },
  openai: {
    apiKey: process.env['OPENAI_API_KEY'] || '',
    baseUrl: process.env['OPENAI_BASE_URL'] || 'https://api.openai.com',
    enabled: !!process.env['OPENAI_API_KEY'],
    realtime: {
      model: process.env['OPENAI_REALTIME_MODEL'] || 'gpt-realtime',
      voice: process.env['OPENAI_REALTIME_VOICE'] || 'alloy',
      tokenTtlSeconds: parseInt(process.env['OPENAI_REALTIME_TOKEN_TTL_SECONDS'] || '600', 10),
      timeoutMs: parseInt(process.env['OPENAI_REALTIME_TIMEOUT_MS'] || '15000', 10),
    },
  },
  xai: {
    apiKey: process.env['XAI_API_KEY'] || process.env['GROK_API_KEY'] || '',
    realtimeUrl: process.env['XAI_REALTIME_URL'] || '',
  },
  voximplant: {
    accountId: process.env['VOXIMPLANT_ACCOUNT_ID'] || '',
    apiKey: process.env['VOXIMPLANT_API_KEY'] || '',
    credentialsPath: voximplantCredentialsPath,
    applicationName: process.env['VOXIMPLANT_APP_NAME'] || 'svoefoto',
    apiBaseUrl: process.env['VOXIMPLANT_API_BASE_URL'] || 'https://api.voximplant.com/platform_api',
    enabled: voximplantEnabled,
    smsEnabled: voximplantSmsEnabled,
    smsFrom: process.env['VOXIMPLANT_SMS_FROM'] || 'SvoeFoto',
    smsMode: voximplantSmsMode,
    voiceCall: voximplantVoiceCallConfig,
    studioClickToCall: voximplantStudioClickToCallConfig,
    serviceSurvey: voximplantServiceSurveyConfig,
    webhook: {
      secret: voximplantWebhookSecret,
      authMode: voximplantWebhookAuthMode,
      maxSkewSec: voximplantWebhookMaxSkewSec,
    },
    // Deprecated alias kept for compatibility with older code paths and env naming.
    flashCall: voximplantVoiceCallConfig,
  },
  // WhatsApp Business Cloud API (ПЛАН 10)
  whatsapp: {
    phoneNumberId: process.env['WHATSAPP_PHONE_NUMBER_ID'] || '',
    accessToken: process.env['WHATSAPP_ACCESS_TOKEN'] || '',
    verifyToken: process.env['WHATSAPP_VERIFY_TOKEN'] || '',
    appSecret: process.env['WHATSAPP_APP_SECRET'] || '',
    businessAccountId: process.env['WHATSAPP_BUSINESS_ACCOUNT_ID'] || '',
    mediaDeliveryUrl: process.env['WHATSAPP_MEDIA_DELIVERY_URL'] || '',
    enabled: !!process.env['WHATSAPP_ACCESS_TOKEN'],
  },
  instagram: {
    accessToken: process.env['INSTAGRAM_ACCESS_TOKEN'] || '',
    appSecret: process.env['INSTAGRAM_APP_SECRET'] || '',
    verifyToken: process.env['INSTAGRAM_VERIFY_TOKEN'] || '',
    businessAccountId: process.env['INSTAGRAM_BUSINESS_ACCOUNT_ID'] || '',
    proxyUrl: process.env['INSTAGRAM_PROXY_URL'] || '',
    enabled: !!process.env['INSTAGRAM_ACCESS_TOKEN'],
  },
  imap: {
    host: process.env['IMAP_HOST'] || 'imap.yandex.ru',
    port: parseInt(process.env['IMAP_PORT'] || '993', 10),
    secure: process.env['IMAP_SECURE'] !== 'false',
    user: process.env['IMAP_USER'] || process.env['SMTP_USER'] || defaultMailAddress,
    password: process.env['IMAP_PASSWORD'] || process.env['SMTP_PASSWORD'] || '',
    mailbox: process.env['IMAP_MAILBOX'] || 'INBOX',
    pollIntervalMs: parseInt(process.env['IMAP_POLL_INTERVAL_MS'] || '30000', 10),
  },
  crmStorage: {
    dir: process.env['CRM_STORAGE_DIR'] || '/var/www/apimain/storage/crm',
    maxFileSizeBytes: parseInt(process.env['CRM_MAX_FILE_SIZE'] || String(100 * 1024 * 1024), 10), // 100MB
  },
  sms: {
    testMode: process.env['VOXIMPLANT_SMS_TEST'] === 'true',
    enabled: voximplantSmsEnabled,
  },
  internalApiKey: process.env['INTERNAL_API_KEY'] || '',
  s3: {
    enabled: process.env['STORAGE_TYPE'] === 's3',
    endpoint: process.env['S3_ENDPOINT'] || 'http://127.0.0.1:9000',
    region: process.env['S3_REGION'] || 'ru-1',
    bucket: process.env['S3_BUCKET'] || '',
    accessKeyId: process.env['S3_ACCESS_KEY'] || '',
    secretAccessKey: process.env['S3_SECRET_KEY'] || '',
    publicUrl: process.env['S3_PUBLIC_URL'] || '',
    externalDeliveryUrl: process.env['S3_EXTERNAL_DELIVERY_URL'] || '',
  },
  guestSession: {
    secret: process.env['GUEST_SESSION_SECRET'] || (process.env['JWT_SECRET'] ? process.env['JWT_SECRET'] + '_guest' : 'DEV_ONLY_GUEST_SECRET'),
    strictMode: process.env['SESSION_TOKEN_STRICT_MODE'] !== 'false', // default: true (strict)
  },
  featureFlags: {
    paymentLinksEnabled: (process.env['ENABLE_PAYMENT_LINKS'] ?? 'true') === 'true',
    // Account-first gift activation (new multi-step flow). Default ON.
    giftActivationEnabled: (process.env['ENABLE_GIFT_ACTIVATION'] ?? 'true') === 'true',
    // Legacy single-shot POST /subscriptions/redeem-gift. Default OFF —
    // superseded by gift-activation, kept behind a flag for rollback.
    legacyRedeemGiftEnabled: (process.env['ENABLE_LEGACY_REDEEM_GIFT'] ?? 'false') === 'true',
  },
  print: {
    enabled: process.env['PRINT_ENABLED'] !== 'false',
  },
  printApi: {
    // Loopback к Rust print-api (:3004). Node ходит сюда напрямую (минуя nginx :3001),
    // т.к. /api/print/* у nginx уходит в Rust — внутренний вызов идёт на 127.0.0.1.
    internalUrl: (process.env['PRINT_API_INTERNAL_URL'] || 'http://127.0.0.1:3004').replace(/\/+$/, ''),
  },
  printEstimate: {
    // userId служебного JWT для edu-калькулятора печати. Валидный UUID (nil), чтобы
    // Rust require_auth (uuid::Uuid::parse_str) не падал; studio останется None.
    serviceUserId: process.env['PRINT_ESTIMATE_SERVICE_USER_ID'] || '00000000-0000-0000-0000-000000000000',
  },
  channelRateLimits: {
    telegram: { max: parseInt(process.env['RATE_LIMIT_TELEGRAM'] || '30', 10), duration: 1000 },
    vk: { max: parseInt(process.env['RATE_LIMIT_VK'] || '20', 10), duration: 1000 },
    max: { max: parseInt(process.env['RATE_LIMIT_MAX'] || '25', 10), duration: 1000 },
    whatsapp: { max: parseInt(process.env['RATE_LIMIT_WHATSAPP'] || '80', 10), duration: 1000 },
    instagram: { max: parseInt(process.env['RATE_LIMIT_INSTAGRAM'] || '3', 10), duration: 1000 },
  } as Record<string, { max: number; duration: number }>,
  fal: {
    apiKey: process.env['FAL_API_KEY'] || '',
    enabled: !!process.env['FAL_API_KEY'],
    pollIntervalMs: parseInt(process.env['FAL_POLL_INTERVAL_MS'] || '2000', 10),
    timeoutMs: parseInt(process.env['FAL_TIMEOUT_MS'] || '300000', 10),
  },
  delivery: {
    senderPostalCode: process.env['SENDER_POSTAL_CODE'] || '344002', // пер. Соборный 21, Ростов-на-Дону
    defaultWeight: 50, // вес фото в конверте, грамм (fallback)
    tariffUrl: 'https://tariff.pochta.ru/v2/calculate/tariff/delivery',
    objectType: 23030, // посылка онлайн обыкновенная (с трекингом)
    // Pochta Russia Otpravka API (автоматическое создание отправлений)
    otpravkaToken: process.env['POCHTA_OTPRAVKA_TOKEN'] || '',
    otpravkaLogin: process.env['POCHTA_OTPRAVKA_LOGIN'] || '',
    otpravkaPassword: process.env['POCHTA_OTPRAVKA_PASSWORD'] || '',
    // Данные отправителя
    senderName: process.env['SENDER_NAME'] || 'ИП Лавринова Елена Борисовна',
    senderPhone: process.env['SENDER_PHONE'] || '+79014178668',
    senderAddress: process.env['SENDER_ADDRESS'] || 'пер. Соборный 21, Ростов-на-Дону',
  },
  yandexDelivery: {
    // Курьерская доставка печати через Яндекс.Доставку (Cargo v2). По умолчанию off.
    enabled: process.env['DELIVERY_YANDEX_ENABLED'] === 'true',
    token: process.env['YANDEX_DELIVERY_TOKEN'] || '',
    baseUrl: process.env['YANDEX_DELIVERY_BASE_URL'] || 'https://b2b.taxi.yandex.net',
    webhookSecret: process.env['YANDEX_DELIVERY_WEBHOOK_SECRET'] || '',
    taxiClass: process.env['YANDEX_DELIVERY_TAXI_CLASS'] || 'courier',
  },
};
