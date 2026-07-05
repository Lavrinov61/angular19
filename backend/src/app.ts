import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { config } from './config/index.js';
import { CSP_MEDIA_SOURCES } from './config/media-domains.js';
import { createLogger } from './utils/logger.js';
import { createRateLimitStore } from './middleware/rate-limit-store.js';
import { shouldSkipAuthLimiter } from './routes/auth-route-policy.js';

const log = createLogger('app');
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/request-logger.js';
import { requestContextMiddleware } from './middleware/request-context.js';
import { httpMetricsMiddleware } from './middleware/http-metrics.js';
import { authenticateToken, requirePermission } from './middleware/auth.js';
import { ipAllowlistAuditOnly } from './middleware/ip-allowlist.js';
import { getMetrics, getContentType } from './services/metrics.service.js';

// Import routes
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import privacyConsentsRoutes from './routes/privacy-consents.routes.js';
import photographersRoutes from './routes/photographers.routes.js';
import studiosRoutes from './routes/studios.routes.js';
import fleetRoutes from './routes/fleet.routes.js';
import shootingLocationsRoutes from './routes/shooting-locations.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import photosRoutes from './routes/photos.routes.js';
import filesRoutes from './routes/files.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import nativeNotifierRoutes from './routes/native-notifier.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import photoApprovalsRoutes from './routes/photo-approvals.routes.js';
import photoWorkspaceRoutes from './routes/photo-workspace.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import chatRoutes from './routes/chat.routes.js';
import photoPrintOrdersRoutes from './routes/photo-print-orders.routes.js';
import documentPrintOrdersRoutes from './routes/document-print-orders.routes.js';
import restorationOrdersRoutes from './routes/restoration-orders.routes.js';
import visitorChatRoutes from './routes/visitor-chat.routes.js';
import { registerCustomerChatRoutes } from './routes/customer-chat.mount.js';
import paymentsRoutes from './routes/payments.routes.js';
import alfabankPaymentsRoutes from './routes/alfabank-payments.routes.js';
import pricesRoutes from './routes/prices.routes.js';
import actionsRoutes from './routes/actions.routes.js';
import aliceRoutes from './routes/alice.routes.js';
import loyaltyRoutes from './routes/loyalty.routes.js';
import appConfigRoutes from './routes/app-config.routes.js';
import channelStatusRoutes from './routes/channel-status.routes.js';
import appEventsRoutes from './routes/app-events.routes.js';
import appLogsRoutes from './routes/app-logs.routes.js';
import photoEnhanceRoutes from './routes/photo-enhance.routes.js';
import faceValidationRoutes from './routes/face-validation.routes.js';
// app-loyalty.routes.ts merged into unified loyalty.routes.ts (Phase 2C)
import promotionsRoutes from './routes/promotions.routes.js';
import addressRoutes from './routes/address.routes.js';
import shippingRoutes from './routes/shipping.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
import tasksRoutes from './routes/tasks.routes.js';
import shiftsRoutes from './routes/shifts.routes.js';
import healthRoutes, { getReadinessResponse } from './routes/health.routes.js';
import crmBookingRoutes from './routes/crm-booking.routes.js';
import reviewsRoutes from './routes/reviews.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import posRoutes from './routes/pos.routes.js';
import employeeSalesRoutes from './routes/employee-sales.routes.js';
import commissionRulesRoutes from './routes/commission-rules.routes.js';
import consumableRulesRoutes from './routes/consumable-rules.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import subscriptionsRoutes from './routes/subscriptions.routes.js';
import giftActivationRoutes from './routes/gift-activation.routes.js';
import studentVerificationsRoutes from './routes/student-verifications.routes.js';
import kbRoutes from './routes/kb.routes.js';
import educationPrintEstimateRoutes from './routes/education/print-estimate.routes.js';
import b2bRoutes, { b2bAdminRoutes } from './routes/b2b.routes.js';
import crmInboxRoutes from './routes/crm-inbox.routes.js';
import photoReviewRoutes from './routes/photo-review.routes.js';
import telephonyRoutes from './routes/telephony.routes.js';
import crmReportsRoutes from './routes/crm-reports.routes.js';
import crmAuditRoutes from './routes/crm-audit.routes.js';
import crmOperatorStatsRoutes from './routes/crm-operator-stats.routes.js';
import crmClientsRoutes from './routes/crm-clients.routes.js';
import crmCustomerTagsRoutes from './routes/crm-customer-tags.routes.js';
import crmSearchRoutes from './routes/crm-search.routes.js';
import dashboardBatchRouter from './routes/crm-dashboard-batch.routes.js';
import staffChatRoutes from './routes/staff-chat.routes.js';
import aiCrmRoutes from './routes/ai-crm.routes.js';
import aiPricingRoutes from './routes/ai-pricing.routes.js';
import aiAssistRoutes from './routes/ai-assist.routes.js';
import employeeGamificationRoutes from './routes/employee-gamification.routes.js';
import internalRoutes from './routes/internal.routes.js';
import pricingRoutes from './routes/pricing.routes.js';
import crmEmailRoutes from './routes/crm-email.routes.js';
import crmFilesRoutes from './routes/crm-files.routes.js';
import workflowsRoutes from './routes/workflows.routes.js';
import partnersRoutes from './routes/partners.routes.js';
import partnerPublicRoutes from './routes/partner-public.routes.js';
import crmAnalyticsRoutes from './routes/crm-analytics.routes.js';
import crmRegistrationsRoutes from './routes/crm-registrations.routes.js';
import galleryRoutes from './routes/gallery.routes.js';
import photographerPublicRoutes from './routes/photographer-public.routes.js';
import publicBookingRoutes from './routes/public-booking.routes.js';
import statsRoutes from './routes/stats.routes.js';
import studioHoursRoutes from './routes/studio-hours.routes.js';
import orderAssignmentsRoutes from './routes/order-assignments.routes.js';
import inventoryReceiptsRoutes from './routes/inventory-receipts.routes.js';
import whatsappWebhookRoutes from './routes/webhooks/whatsapp.routes.js';
import vkWebhookRoutes from './routes/webhooks/vk.routes.js';
import maxWebhookRoutes from './routes/webhooks/max.routes.js';
import telegramWebhookRoutes from './routes/webhooks/telegram.routes.js';
import instagramWebhookRoutes from './routes/webhooks/instagram.routes.js';
import bitrixArchiveRoutes from './routes/bitrix-archive.routes.js';
// @deprecated — nginx routes /api/print/* to Rust print-api :3004. Safe to delete after 2026-04-30.
// import printRoutes from './routes/print.routes.js';
import printPublicRoutes from './routes/print-public.routes.js';
import productionRoutes from './routes/production.routes.js';
import rbacRoutes from './routes/rbac.routes.js';
import replayRoutes from './routes/replay.routes.js';
import channelAdminRoutes from './routes/channel-admin.routes.js';
import broadcastRoutes from './routes/broadcast.routes.js';
import broadcastCampaignsRoutes from './routes/broadcast-campaigns.routes.js';
import broadcastFlyerUploadRouter from './routes/broadcast-flyer-upload.routes.js';
import campaignsRoutes from './routes/campaigns.routes.js';
import mediaDlqRoutes from './routes/media-dlq.routes.js';
import mediaSignedRoutes from './routes/media-signed.routes.js';
import upsellRoutes from './routes/upsell.routes.js';
import trackingRoutes from './routes/tracking.routes.js';
import documentTemplatesRoutes from './routes/document-templates.routes.js';
import slaConfigRoutes from './routes/sla-config.routes.js';
import accountChannelsRoutes from './routes/account-channels.routes.js';
import orderDelayRoutes from './routes/order-delay.routes.js';
import polaroidRoutes from './routes/polaroid.routes.js';
import mediaProxyRoutes from './routes/media-proxy.routes.js';
import payrollRoutes from './routes/payroll.routes.js';
import retouchRoutes from './routes/retouch.routes.js';
import aiRetouchRoutes from './routes/ai-retouch.routes.js';
import readyFormsRoutes from './routes/ready-forms.routes.js';

const app = express();

interface UnknownObject {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null;
}

function getCookieAccessToken(req: Request): string | undefined {
  const cookies: unknown = req.cookies;
  if (!isRecord(cookies)) return undefined;
  const token = cookies['access_token'];
  return typeof token === 'string' ? token : undefined;
}

function getRateLimitUserId(token: string): string | null {
  const decoded: unknown = jwt.decode(token);
  if (!isRecord(decoded)) return null;

  const userId = decoded['userId'];
  if (typeof userId === 'string' && userId.length > 0) return userId;

  const id = decoded['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf.toString();
}

// Trust proxy chain: Client → CDN → nginx → Express = 2 proxies
// Selectel Dedicated — no ALB in the chain.
app.set('trust proxy', 2);

// Request context (correlation IDs via AsyncLocalStorage) — before requestLogger
app.use(requestContextMiddleware);

// Request logging (errors ≥400 only)
app.use(requestLogger);

// Security middleware — CSP allows Angular SSR inline scripts/styles + CDN + fonts
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", ...CSP_MEDIA_SOURCES],
      connectSrc: ["'self'", "wss:", "https://ws.svoefoto.ru", ...CSP_MEDIA_SOURCES, "https://api.telegram.org"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
      mediaSrc: ["'self'", "blob:", ...CSP_MEDIA_SOURCES],
      frameSrc: ["'none'"],
    },
  },
}));

// CORS — разрешаем несколько origins
const corsOrigins = config.cors.origin.split(',').map(s => s.trim());
app.use(cors({
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  credentials: true,
}));

// CloudPayments webhook endpoints — исключены из rate-limit (100 ретраев по документации)
const CP_WEBHOOK_PATHS = new Set(['/check', '/pay', '/fail', '/receipt', '/confirm', '/cancel', '/refund', '/recurrent', '/sbp-token', '/kkt']);

// Rate limiting — глобальный лимит для всех API
// passOnStoreError: при Redis down пропускаем трафик (fail-open)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: 'Слишком много запросов. Подождите немного.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('api:'),
  handler: (req, res, _next, options) => {
    log.warn('429 hit from apiLimiter', { url: req.originalUrl, method: req.method });
    res.status(options.statusCode).send(options.message);
  },
  keyGenerator: (req) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    const token = getCookieAccessToken(req) ?? bearer;
    if (token) {
      try {
        const userId = getRateLimitUserId(token);
        if (userId) return `u:${userId}`;
      } catch { /* fall through to IP */ }
    }
    return req.ip ?? 'unknown';
  },
  skip: (req) => {
    // ALB health checks — не считать в rate limit
    if (req.path.startsWith('/health')) return true;
    // Пропускаем CloudPayments webhook-и — они могут ретраить до 100 раз
    const lastSegment = req.path.substring(req.path.lastIndexOf('/'));
    return req.path.includes('/payments/') && CP_WEBHOOK_PATHS.has(lastSegment);
  },
});

// Строгий лимит для авторизации (brute force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // 15 попыток за 15 минут
  message: 'Слишком много попыток входа. Подождите 15 минут.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('auth:'),
  skip: (req) => shouldSkipAuthLimiter(req.method, req.path),
});

// Лимит для загрузки файлов
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // 100 загрузок за 15 минут
  message: 'Слишком много загрузок. Подождите немного.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('upload:'),
});

// Лимит для face validation (дорогостоящая операция: download + Rust image processing)
// P0 SECURITY FIX: prevent DoS via concurrent workers
const faceValidationLimiter = rateLimit({
  windowMs: 60_000, // 1 минута
  max: 20, // 20 валидаций за минуту per user (reasonable for operators)
  message: 'Слишком много запросов на валидацию лиц. Подождите немного.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('rl:face-validate:'),
  skip: (req) => {
    if (req.path === '/health') return true;
    return false;
  },
});

// HTTPS enforcement in production (nginx fallback)
// Skip for loopback requests (SSR → API on localhost)
if (config.server.nodeEnv === 'production') {
  app.use((req, res, next) => {
    const host = req.hostname;
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (req.headers['x-forwarded-proto'] !== 'https' && !isLoopback && !req.path.startsWith('/health')) {
      return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
    }
    next();
  });
}

// HTTP metrics (Prometheus histograms/counters)
app.use(httpMetricsMiddleware);

// Cookie parsing — needed for httpOnly JWT cookies
app.use(cookieParser());

// Body parsing — rawBody нужен для CloudPayments webhook HMAC verification
// CloudPayments отправляет application/x-www-form-urlencoded
app.use(express.json({ limit: '5mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '5mb', verify: captureRawBody }));

// Root health mirrors /api/health/ready for direct local checks and legacy
// callers that still hit the API process directly instead of nginx.
app.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { statusCode, body } = await getReadinessResponse();
    res.status(statusCode).json(body);
  } catch {
    res.status(503).json({ ready: false });
    return;
  }
});

/**
 * Регистрирует API роуты на переданном Express app
 * Используется для интеграции с SSR сервером
 */
export function registerApiRoutes(targetApp: Pick<Express, 'use' | 'get'>, prefix = '/api'): void {
  // Body parsing — scoped к API роутам (не в server.ts, это Angular SSR concern)
  // verify сохраняет rawBody для HMAC signature verification (CloudPayments webhooks)
  // CloudPayments отправляет application/x-www-form-urlencoded — verify нужен на обоих парсерах
  targetApp.use(prefix, cookieParser());
  targetApp.use(prefix, express.json({ limit: '10mb', verify: captureRawBody }));
  targetApp.use(prefix, express.urlencoded({ extended: true, limit: '10mb', verify: captureRawBody }));

  // apiLimiter убран: internal CRM за JWT, NAT single-IP, лимит 2000/15min режет офис.
  // Остались только таргетированные лимитеры: authLimiter (brute-force), webhookLimiter (публичные).
  targetApp.use(`${prefix}/auth`, authLimiter);
  targetApp.use(`${prefix}/files/upload`, uploadLimiter);
  targetApp.use(`${prefix}/face-validation/validate`, faceValidationLimiter); // P0 SECURITY FIX

  // API routes
  targetApp.use(`${prefix}/auth`, authRoutes);
  targetApp.use(`${prefix}/users`, usersRoutes);
  targetApp.use(`${prefix}/privacy`, privacyConsentsRoutes);
  targetApp.use(`${prefix}/photographers`, photographersRoutes);
  targetApp.use(`${prefix}/studios`, studiosRoutes);
  targetApp.use(`${prefix}/fleet`, fleetRoutes);
  targetApp.use(`${prefix}/shooting-locations`, shootingLocationsRoutes);
  targetApp.use(`${prefix}/bookings`, bookingsRoutes);
  targetApp.use(`${prefix}/orders/photo-print`, photoPrintOrdersRoutes);
  targetApp.use(`${prefix}/orders/document-print`, documentPrintOrdersRoutes);
  targetApp.use(`${prefix}/restoration-orders`, restorationOrdersRoutes);
  // Статические sub-пути ДО динамического /orders (иначе /:id перехватывает)
  targetApp.use(`${prefix}/orders/assignments`, orderAssignmentsRoutes);
  targetApp.use(`${prefix}/orders`, ordersRoutes);
  targetApp.use(`${prefix}/order-delay`, orderDelayRoutes);
  targetApp.use(`${prefix}/photo-enhance`, photoEnhanceRoutes);
  targetApp.use(`${prefix}/face-validation`, faceValidationRoutes);
  targetApp.use(`${prefix}/polaroid`, polaroidRoutes);
  targetApp.use(`${prefix}/photos`, photosRoutes);
  targetApp.use(`${prefix}/files`, filesRoutes);
  targetApp.use(`${prefix}/notifications`, notificationsRoutes);
  targetApp.use(`${prefix}/native-notifier`, ipAllowlistAuditOnly({ logTag: 'native-notifier' }), nativeNotifierRoutes);
  targetApp.use(`${prefix}/schedule`, scheduleRoutes);
  targetApp.use(`${prefix}/photo-approvals`, photoApprovalsRoutes);
  targetApp.use(`${prefix}/photo-workspace`, photoWorkspaceRoutes);
  targetApp.use(`${prefix}/dashboard`, dashboardRoutes);
  registerCustomerChatRoutes(targetApp, prefix, {
    customerChatRoutes: visitorChatRoutes,
    bookingChatRoutes: chatRoutes,
  });
  targetApp.use(`${prefix}/media`, mediaSignedRoutes);
  targetApp.use(`${prefix}/payments/alfabank`, alfabankPaymentsRoutes);
  targetApp.use(`${prefix}/payments`, paymentsRoutes);
  targetApp.use(`${prefix}/prices`, pricesRoutes);
  targetApp.use(`${prefix}/actions`, actionsRoutes);
  targetApp.use(`${prefix}/alice`, aliceRoutes);
  targetApp.use(`${prefix}/loyalty`, loyaltyRoutes);
  targetApp.use(`${prefix}/app-config`, appConfigRoutes);
  targetApp.use(`${prefix}/channel-status`, channelStatusRoutes);
  targetApp.use(`${prefix}/app-events`, appEventsRoutes);
  targetApp.use(`${prefix}/app-logs`, appLogsRoutes);
  // /api/app-loyalty merged into /api/loyalty (Phase 2C)
  targetApp.use(`${prefix}/promotions`, promotionsRoutes);
  targetApp.use(`${prefix}/address`, addressRoutes);
  targetApp.use(`${prefix}/shipping`, shippingRoutes);
  // Курьерская доставка печати (Яндекс.Доставка) — quote/webhook/tracking. За флагом DELIVERY_YANDEX_ENABLED.
  targetApp.use(`${prefix}/delivery`, deliveryRoutes);
  targetApp.use(`${prefix}/tasks`, tasksRoutes);
  targetApp.use(`${prefix}/shifts`, shiftsRoutes);
  targetApp.use(`${prefix}/payroll`, payrollRoutes);
  targetApp.use(`${prefix}/retouch`, retouchRoutes);
  targetApp.use(`${prefix}/photo-retouch`, aiRetouchRoutes);
  targetApp.use(`${prefix}/health`, healthRoutes);
  targetApp.use(`${prefix}/crm-booking`, crmBookingRoutes);
  targetApp.use(`${prefix}/reviews`, reviewsRoutes);
  targetApp.use(`${prefix}/catalog`, catalogRoutes);
  targetApp.use(`${prefix}/document-templates`, documentTemplatesRoutes);
  // Статический sub-path ДО основного /pos (Express 5: static before dynamic)
  targetApp.use(`${prefix}/pos/sales`, employeeSalesRoutes);
  targetApp.use(`${prefix}/pos/commissions`, commissionRulesRoutes);
  targetApp.use(`${prefix}/pos/consumable-rules`, consumableRulesRoutes);
  targetApp.use(`${prefix}/pos/inventory`, inventoryRoutes);
  targetApp.use(`${prefix}/pos`, posRoutes);
  // Static sub-path BEFORE dynamic /subscriptions/:id (Express 5: static first).
  targetApp.use(`${prefix}/subscriptions/gift-activation`, giftActivationRoutes);
  targetApp.use(`${prefix}/subscriptions`, subscriptionsRoutes);
  targetApp.use(`${prefix}/student-verifications`, studentVerificationsRoutes);
  targetApp.use(`${prefix}/kb`, kbRoutes);
  targetApp.use(`${prefix}/education/print-estimate`, educationPrintEstimateRoutes);
  targetApp.use(`${prefix}/b2b`, b2bRoutes);
  targetApp.use(`${prefix}/account/channels`, accountChannelsRoutes);

  // CRM PULT IP-guard (audit-only by default).
  // Mounted before CRM / staff-chat / ai-crm route trees so every request is
  // observed. Route-level authenticateToken still runs as usual — this
  // middleware only emits warn + Prometheus counter when req.ip ∉ TRUSTED_CIDRS.
  targetApp.use(`${prefix}/crm`, ipAllowlistAuditOnly({ logTag: 'crm' }));
  targetApp.use(`${prefix}/staff-chat`, ipAllowlistAuditOnly({ logTag: 'staff-chat' }));
  targetApp.use(`${prefix}/ai-crm`, ipAllowlistAuditOnly({ logTag: 'ai-crm' }));

  targetApp.use(`${prefix}/crm`, crmInboxRoutes);
  targetApp.use(`${prefix}/photo-review`, photoReviewRoutes);
  if (config.role === 'monolith') {
    targetApp.use(`${prefix}/telephony`, telephonyRoutes);
  }
  targetApp.use(`${prefix}/crm/reports`, crmReportsRoutes);
  targetApp.use(`${prefix}/crm/audit`, crmAuditRoutes);
  targetApp.use(`${prefix}/crm/operator-stats`, crmOperatorStatsRoutes);
  targetApp.use(`${prefix}/crm/clients`, crmClientsRoutes);
  targetApp.use(`${prefix}/crm/customer-tags`, crmCustomerTagsRoutes);
  targetApp.use(`${prefix}/crm/search`, crmSearchRoutes);
  targetApp.use(`${prefix}/crm/dashboard`, dashboardBatchRouter);
  targetApp.use(`${prefix}/staff-chat`, staffChatRoutes);
  targetApp.use(`${prefix}/ai-crm`, aiCrmRoutes);
  targetApp.use(`${prefix}/crm/ai-assist`, aiAssistRoutes);
  targetApp.use(`${prefix}/ai-pricing`, aiPricingRoutes);
  targetApp.use(`${prefix}/gamification`, employeeGamificationRoutes);
  targetApp.use(`${prefix}/upsell`, upsellRoutes);
  targetApp.use(`${prefix}/internal`, internalRoutes);
  targetApp.use(`${prefix}/pricing`, pricingRoutes);
  targetApp.use(`${prefix}/crm/email`, crmEmailRoutes);
  targetApp.use(`${prefix}/files/crm`, crmFilesRoutes);
  targetApp.use(`${prefix}/workflows`, workflowsRoutes);
  targetApp.use(`${prefix}/partners`, partnersRoutes);
  targetApp.use(`${prefix}/partner`, partnerPublicRoutes);
  targetApp.use(`${prefix}/crm/sla-config`, slaConfigRoutes);
  targetApp.use(`${prefix}/crm/analytics`, crmAnalyticsRoutes);
  targetApp.use(`${prefix}/crm/registrations`, crmRegistrationsRoutes);
  targetApp.use(`${prefix}/gallery`, galleryRoutes);
  // Публичный алиас для photographers (совместимость с фронтендом)
  targetApp.use(`${prefix}/public/photographers`, photographersRoutes);
  // Публичные endpoint-ы фотографа (booking-request, availability, message)
  targetApp.use(`${prefix}/photographer`, photographerPublicRoutes);
  // Публичное Booking API
  targetApp.use(`${prefix}/booking`, publicBookingRoutes);
  // Публичная статистика (клиенты, etc.)
  targetApp.use(`${prefix}/stats`, statsRoutes);
  // Рабочие часы студий
  targetApp.use(`${prefix}/studio-hours`, studioHoursRoutes);
  // Inventory receipts + low stock
  targetApp.use(`${prefix}/inventory`, inventoryReceiptsRoutes);
  // @deprecated — nginx routes /api/print/* to Rust print-api :3004. Safe to delete after 2026-04-30.
  // targetApp.use(`${prefix}/print`, printRoutes);
  // Публичный API фотопечати (форматы, расчёт цен, статус заказа)
  targetApp.use(`${prefix}/print-online`, printPublicRoutes);
  // Управление типографиями и производственными заказами
  targetApp.use(`${prefix}/production`, productionRoutes);
  // Enterprise RBAC Admin API
  targetApp.use(`${prefix}/rbac`, rbacRoutes);
  // Session Replay + Поведенческая аналитика + Heatmap
  targetApp.use(`${prefix}/replay`, replayRoutes);
  // CRM PULT IP-guard for /admin/* — audit-only, mounted after authenticateToken
  // so user_id is captured in warn logs. Order matters: auth → ip-guard → handler.
  // Channel Admin — omnichannel management panel
  targetApp.use(`${prefix}/admin/channels`, authenticateToken, ipAllowlistAuditOnly({ logTag: 'admin' }), requirePermission('settings:manage'), channelAdminRoutes);
  // Broadcast — mass messaging to messenger conversations
  targetApp.use(`${prefix}/admin/broadcast`, authenticateToken, ipAllowlistAuditOnly({ logTag: 'admin' }), requirePermission('settings:manage'), broadcastRoutes);
  // Broadcast flyer upload — presigned S3 (images only). Mounted BEFORE /admin/campaigns
  // so /upload/{presign,complete} matches this router (own auth chain from the factory)
  // and never falls through to the campaigns router. URL is permanent + worker-fetchable.
  targetApp.use(`${prefix}/admin/campaigns/upload`, broadcastFlyerUploadRouter);
  // Broadcast campaigns — Telegram campaign list/create/recipients/go-live + dispatch + stats
  targetApp.use(`${prefix}/admin/campaigns`, authenticateToken, ipAllowlistAuditOnly({ logTag: 'admin' }), requirePermission('settings:manage'), broadcastCampaignsRoutes);
  // Media DLQ — dead letter queue inspection + retry
  targetApp.use(`${prefix}/admin/media/dlq`, authenticateToken, ipAllowlistAuditOnly({ logTag: 'admin' }), requirePermission('settings:manage'), mediaDlqRoutes);
  // B2B automation admin — organizations, verification, bank matching, documents
  targetApp.use(`${prefix}/admin/b2b`, authenticateToken, ipAllowlistAuditOnly({ logTag: 'admin' }), requirePermission('settings:manage'), b2bAdminRoutes);
  // Ready-made forms — PSD/JPG/PNG repository for admins only
  targetApp.use(`${prefix}/admin/ready-forms`, authenticateToken, ipAllowlistAuditOnly({ logTag: 'admin' }), readyFormsRoutes);
  // Ad tracking clicks, QR scans, visitor sessions (public — anonymous visitors)
  targetApp.use(`${prefix}/tracking`, trackingRoutes);
  // Marketing campaigns CRUD + redemption tracking
  targetApp.use(`${prefix}/campaigns`, campaignsRoutes);
  // Webhook rate limiter (Phase 3B.3: 100 req/min per IP)
  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Too many webhook requests.',
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: createRateLimitStore('wh:'),
  });

  // Webhooks — внешние каналы (WhatsApp, VK, Max, Telegram)
  targetApp.use(`${prefix}/webhooks/whatsapp`, webhookLimiter, whatsappWebhookRoutes);
  targetApp.use(`${prefix}/webhooks/vk`, webhookLimiter, vkWebhookRoutes);
  targetApp.use(`${prefix}/webhooks/max`, webhookLimiter, maxWebhookRoutes);
  targetApp.use(`${prefix}/webhooks/telegram`, webhookLimiter, telegramWebhookRoutes);
  targetApp.use(`${prefix}/webhooks/instagram`, webhookLimiter, instagramWebhookRoutes);

  // Bitrix24 Drive archive — OAuth install/handler (no app auth) + admin endpoints
  targetApp.use(`${prefix}/bitrix-archive`, webhookLimiter, bitrixArchiveRoutes);

  // Prometheus metrics endpoint (admin-only scrape target)
  targetApp.get(`${prefix}/metrics`, authenticateToken, requirePermission('settings:manage'), async (_req: Request, res: Response) => {
    res.set('Content-Type', getContentType());
    res.end(await getMetrics());
  });

  // Bull Board — BullMQ queue monitoring (Phase 3A.4)
  import('@bull-board/api').then(({ createBullBoard }) =>
    import('@bull-board/api/bullMQAdapter').then(({ BullMQAdapter }) =>
      import('@bull-board/express').then(({ ExpressAdapter }) =>
        Promise.all([
            import('./services/connectors/pipeline/webhook-receiver.js'),
            import('./services/connectors/pipeline/outbound-worker.js'),
            import('./services/connectors/pipeline/inbound-worker.js'),
            import('./services/connectors/pipeline/dlq-worker.js'),
            import('./services/voice-otp-dispatcher.service.js'),
          ]).then(([{ getInboundQueue, getStatusQueue }, { outboundQueue }, { mediaQueue }, { dlqQueue }, { getVoiceOtpDispatchQueue }]) => {
          const serverAdapter = new ExpressAdapter();
          serverAdapter.setBasePath(`${prefix}/admin/queues`);
          const allQueues = [getInboundQueue(), getStatusQueue(), outboundQueue, mediaQueue, dlqQueue, getVoiceOtpDispatchQueue()];
          createBullBoard({
            queues: allQueues.map(q => new BullMQAdapter(q)),
            serverAdapter,
          });
          targetApp.use(
            `${prefix}/admin/queues`,
            authenticateToken,
            requirePermission('settings:manage'),
            serverAdapter.getRouter(),
          );
          log.info('BullBoard mounted', { path: `${prefix}/admin/queues` });
        }),
      ),
    ),
  ).catch((err: unknown) => log.warn('BullBoard init skipped', { error: err instanceof Error ? err.message : String(err) }));
}

// Public media proxy — streams S3 objects through our domain (no auth, long cache)
app.use('/media', mediaProxyRoutes);

// Prometheus metrics endpoint (no /api prefix; nginx должен блокировать извне).
// Защита — на уровне network: bind 127.0.0.1 + nginx deny публичного доступа.
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', getContentType());
  res.end(await getMetrics());
});

// Монтируем API роутер на /api для standalone использования
registerApiRoutes(app);

// Error handling (только для ошибок, не 404)
app.use(errorHandler);

export default app;
