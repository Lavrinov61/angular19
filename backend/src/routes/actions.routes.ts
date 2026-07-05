import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  createBookingSchema,
  createPhotoPrintOrderSchema,
  createPaymentLinkSchema,
  type CreateBookingInput,
  type CreatePaymentLinkInput,
  type CreatePhotoPrintOrderInput,
} from '../schemas/actions.schema.js';
import { decodePaymentToken } from '../services/payment-link.service.js';
import { generateOrderId } from '../utils/secure-random.js';
import type { ActionsIdLookupRow, ActionsUserLookupRow } from '../types/views/actions-route-views.js';

const router = Router();
const DEFAULT_CLOUDPAYMENTS_TAXATION_SYSTEM = 1;

type ContactInfo = {
  name: string;
  phone: string;
  email?: string;
};

type PhotoPrintItemInput = {
  uploadedUrl?: string;
  photoUrl?: string;
  format: string;
  paperType: string;
  quantity: number;
};

interface OpenApiSpec {
  [key: string]: unknown;
}

interface BookingPriceData {
  totalPrice: number;
  basePrice: number;
  currency: string;
}

interface BookingMetadata {
  [key: string]: unknown;
  source: 'chatgpt_actions';
  serviceType: 'studio' | 'onLocation';
  persons: number;
  clientInfo: {
    name: string;
    phone: string;
    email: string;
  };
  location?: {
    address: string;
    city: string;
    coordinates: NonNullable<CreateBookingInput['location']>['coordinates'] | null;
  };
  notes?: string;
}

function resolveCloudPaymentsTaxationSystem(): number {
  const taxationSystem = Number(config.cloudPayments.taxationSystem);
  if (!Number.isInteger(taxationSystem) || taxationSystem < 0 || taxationSystem > 5) {
    return DEFAULT_CLOUDPAYMENTS_TAXATION_SYSTEM;
  }
  return taxationSystem;
}

function getBaseUrl(req: Request): string {
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto ? forwardedProto.split(',')[0] : req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function isValidPhone(phone: string): boolean {
  const digits = normalizePhone(phone);
  return digits.length >= 10 && digits.length <= 15;
}

function extractApiKey(req: Request): string | null {
  const headerKey = req.get('x-api-key');
  if (headerKey) return headerKey.trim();
  const auth = req.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

function requireActionsApiKey(req: Request, _res: Response, next: NextFunction): void {
  const configuredKey = config.actions.apiKey;
  if (!configuredKey) {
    throw new AppError(500, 'Actions API key not configured');
  }

  const providedKey = extractApiKey(req);
  if (!providedKey || providedKey !== configuredKey) {
    throw new AppError(401, 'Invalid API key');
  }

  next();
}

// Payment token encoding/decoding imported from '../services/payment-link.service.js'

async function getOrCreateClient(contact: ContactInfo): Promise<ActionsUserLookupRow> {
  const email = contact.email?.trim().toLowerCase();
  const phone = contact.phone.trim();
  const normalizedPhone = normalizePhone(phone);
  const fallbackEmail = email || (normalizedPhone ? `guest+${normalizedPhone}@svoefoto.local` : `guest-${uuidv4()}@svoefoto.local`);

  let user = await db.queryOne<ActionsUserLookupRow>(
    'SELECT id, email FROM users WHERE email = $1',
    [email || fallbackEmail],
  );

  if (!user && normalizedPhone) {
    user = await db.queryOne<ActionsUserLookupRow>(
      'SELECT id, email FROM users WHERE phone = $1',
      [phone],
    );
  }

  if (!user) {
    const userId = uuidv4();
    await db.query(
      `INSERT INTO users (id, email, display_name, phone, role, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, fallbackEmail, contact.name.trim(), phone, 'client', true, false],
    );
    return { id: userId, email: fallbackEmail };
  }

  if (phone) {
    await db.query(
      'UPDATE users SET phone = COALESCE(phone, $1), updated_at = NOW() WHERE id = $2',
      [phone, user.id],
    );
  }

  return user;
}

async function resolvePhotographerId(requestedId?: string): Promise<string | null> {
  if (requestedId) {
    const found = await db.queryOne<ActionsIdLookupRow>(
      'SELECT id FROM photographers WHERE id = $1',
      [requestedId],
    );
    return found?.id || null;
  }

  const fallback = await db.queryOne<ActionsIdLookupRow>(
    'SELECT id FROM photographers ORDER BY verified DESC, created_at ASC LIMIT 1',
    [],
  );
  return fallback?.id || null;
}

function buildOpenApiSpec(baseUrl: string): OpenApiSpec {
  const serverUrl = `${baseUrl}/api/actions`;

  return {
    openapi: '3.1.0',
    info: {
      title: 'Svoe Foto Actions API',
      version: '1.0.0',
      description: 'Actions API for ChatGPT to create bookings, photo print orders, and payment links.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/photographers': {
        get: {
          operationId: 'listPhotographers',
          summary: 'List photographers',
          parameters: [
            { name: 'city', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
          ],
          responses: {
            '200': {
              description: 'Photographers list',
            },
          },
        },
      },
      '/availability': {
        get: {
          operationId: 'getAvailability',
          summary: 'Get busy slots for a photographer',
          parameters: [
            { name: 'photographerId', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'start', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
            { name: 'end', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            '200': {
              description: 'Busy slots for the date range',
            },
          },
        },
      },
      '/bookings': {
        post: {
          operationId: 'createBooking',
          summary: 'Create a booking request',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    serviceId: { type: 'string' },
                    serviceType: { type: 'string', enum: ['studio', 'onLocation'] },
                    startTime: { type: 'string', format: 'date-time' },
                    endTime: { type: 'string', format: 'date-time' },
                    photographerId: { type: 'string' },
                    price: {
                      type: 'object',
                      properties: {
                        totalPrice: { type: 'number' },
                        basePrice: { type: 'number' },
                        currency: { type: 'string', default: 'RUB' },
                      },
                    },
                    contact: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        phone: { type: 'string' },
                        email: { type: 'string' },
                      },
                      required: ['name', 'phone'],
                    },
                    notes: { type: 'string' },
                    persons: { type: 'integer', minimum: 1 },
                    location: {
                      type: 'object',
                      properties: {
                        address: { type: 'string' },
                        city: { type: 'string' },
                        coordinates: {
                          type: 'object',
                          properties: {
                            lat: { type: 'number' },
                            lng: { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                  required: ['serviceId', 'startTime', 'endTime', 'contact'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Booking created',
            },
          },
        },
      },
      '/bookings/{bookingId}': {
        get: {
          operationId: 'getBookingStatus',
          summary: 'Get booking status',
          parameters: [
            { name: 'bookingId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Booking status',
            },
          },
        },
      },
      '/photo-print-orders': {
        post: {
          operationId: 'createPhotoPrintOrder',
          summary: 'Create a photo print order',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    mode: { type: 'string', enum: ['simple', 'custom'] },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          uploadedUrl: { type: 'string' },
                          photoUrl: { type: 'string' },
                          format: { type: 'string' },
                          paperType: { type: 'string' },
                          quantity: { type: 'integer', minimum: 1 },
                        },
                        required: ['format', 'paperType', 'quantity'],
                      },
                    },
                    contact: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        phone: { type: 'string' },
                        email: { type: 'string' },
                        comments: { type: 'string' },
                      },
                      required: ['name', 'phone'],
                    },
                    totalPrice: { type: 'number' },
                  },
                  required: ['mode', 'items', 'contact', 'totalPrice'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Photo print order created',
            },
          },
        },
      },
      '/photo-print-orders/{orderId}': {
        get: {
          operationId: 'getPhotoPrintOrderStatus',
          summary: 'Get photo print order status',
          parameters: [
            { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Order status',
            },
          },
        },
      },
      '/payment-links': {
        post: {
          operationId: 'createPaymentLink',
          summary: 'Create a payment link',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    orderType: { type: 'string', enum: ['photo_print', 'booking', 'custom'] },
                    orderId: { type: 'string' },
                    amount: { type: 'number' },
                    currency: { type: 'string', default: 'RUB' },
                    description: { type: 'string' },
                    email: { type: 'string' },
                    phone: { type: 'string' },
                  },
                  required: ['orderType', 'orderId'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Payment link',
            },
          },
        },
      },
      '/pay/{token}': {
        get: {
          operationId: 'openPaymentPage',
          summary: 'Open payment page',
          security: [],
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'HTML payment page',
            },
          },
        },
      },
    },
  };
}

router.get('/openapi.json', (req: Request, res: Response) => {
  res.json(buildOpenApiSpec(getBaseUrl(req)));
});

router.get('/pay/:token', (req: Request, res: Response) => {
  const secret = config.actions.paymentSecret;
  if (!secret) {
    res.status(500).send('Платёжная система временно недоступна');
    return;
  }

  const payload = decodePaymentToken(req.params['token'], secret);
  if (!payload) {
    res.status(400).send(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ошибка</title>
<style>body{font-family:Arial,sans-serif;background:#f6f6f6;padding:40px;text-align:center;}.card{max-width:400px;margin:0 auto;background:#fff;padding:24px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.08);}.btn{background:#0a6cff;color:#fff;border:none;padding:12px 18px;border-radius:8px;cursor:pointer;font-size:16px;text-decoration:none;display:inline-block;margin-top:16px;}</style>
</head><body><div class="card"><h2>Недействительная ссылка</h2><p>Ссылка на оплату повреждена или недействительна.</p><a class="btn" href="/foto-na-documenty-online">Вернуться в чат</a></div></body></html>`);
    return;
  }

  if (payload.expiresAt < Date.now()) {
    res.status(410).send(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ссылка устарела</title>
<style>body{font-family:Arial,sans-serif;background:#f6f6f6;padding:40px;text-align:center;}.card{max-width:400px;margin:0 auto;background:#fff;padding:24px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.08);}.btn{background:#0a6cff;color:#fff;border:none;padding:12px 18px;border-radius:8px;cursor:pointer;font-size:16px;text-decoration:none;display:inline-block;margin-top:16px;}</style>
</head><body><div class="card"><h2>Ссылка на оплату устарела</h2><p>Вернитесь в чат и запросите новую ссылку на оплату.</p><a class="btn" href="/foto-na-documenty-online">Вернуться в чат</a></div></body></html>`);
    return;
  }

  const receipt = {
    items: [
      {
        label: payload.description,
        price: payload.amount,
        quantity: 1,
        amount: payload.amount,
        vat: null,
        method: 4,
        object: 4,
        measurementUnit: 'шт',
      },
    ],
    taxationSystem: resolveCloudPaymentsTaxationSystem(),
    email: payload.email,
    phone: payload.phone,
    amounts: {
      electronic: payload.amount,
      advancePayment: 0,
      credit: 0,
      provision: 0,
    },
  };

  const paymentConfig = {
    publicTerminalId: config.cloudPayments.publicId,
    description: payload.description,
    paymentSchema: 'Single',
    currency: payload.currency,
    amount: payload.amount,
    skin: 'modern',
    autoClose: 3,
    externalId: payload.orderId,
    receipt,
    retryPayment: true,
    emailBehavior: payload.email ? 'Hidden' : 'Optional',
    metadata: {
      source: 'chatgpt_actions',
      orderType: payload.orderType,
      orderId: payload.orderId,
    },
    userInfo: {
      accountId: payload.orderId,
      email: payload.email,
      phone: payload.phone,
    },
  };

  const html = `
<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Оплата — Своё Фото</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f6f6f6; color: #222; margin: 0; padding: 40px; }
      .card { max-width: 560px; margin: 0 auto; background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
      .title { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
      .subtitle { color: #666; margin-bottom: 24px; }
      .amount { font-size: 28px; font-weight: 700; margin-bottom: 24px; }
      .btn { background: #0a6cff; color: #fff; border: none; padding: 12px 18px; border-radius: 8px; cursor: pointer; font-size: 16px; }
      .btn:disabled { opacity: 0.6; cursor: default; }
      .hint { margin-top: 16px; color: #666; font-size: 14px; }
      .error { color: #c0392b; margin-top: 16px; }
      .success { color: #22c55e; margin-top: 16px; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="title">Оплата заказа</div>
      <div class="subtitle">${payload.description}</div>
      <div class="amount">${payload.amount.toFixed(0)} ₽</div>
      <button id="payBtn" class="btn">Оплатить</button>
      <div id="status" class="hint">Безопасная оплата через CloudPayments</div>
    </div>

    <script src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"></script>
    <script>
      var config = ${JSON.stringify(paymentConfig)};
      var button = document.getElementById('payBtn');
      var status = document.getElementById('status');

      function startPayment() {
        if (!window.cp || !window.cp.CloudPayments) {
          status.textContent = 'Не удалось загрузить форму оплаты. Обновите страницу.';
          status.className = 'error';
          return;
        }
        button.disabled = true;
        status.textContent = 'Открываем форму оплаты...';

        var widget = new window.cp.CloudPayments();
        widget.pay('charge', config, {
          onSuccess: function() {
            status.textContent = '✅ Оплата прошла!';
            status.className = 'success';
            button.style.display = 'none';
            var countdown = 3;
            var timer = setInterval(function() {
              countdown--;
              status.textContent = '✅ Оплата прошла! Закрываем через ' + countdown + '...';
              if (countdown <= 0) {
                clearInterval(timer);
                window.close();
                setTimeout(function() { window.location.href = '/foto-na-documenty-online'; }, 1000);
              }
            }, 1000);
          },
          onFail: function() {
            status.textContent = 'Оплата отменена или не прошла. Попробуйте ещё раз.';
            status.className = 'error';
            button.disabled = false;
          },
          onComplete: function() {}
        });
      }

      button.addEventListener('click', startPayment);
      setTimeout(startPayment, 400);
    </script>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.use(requireActionsApiKey);

router.get('/photographers', async (req: Request, res: Response): Promise<void> => {
  const { city, search, limit = '10' } = req.query as Record<string, string>;
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

  let whereConditions: string[] = [];
  const queryParams: unknown[] = [];
  let paramIndex = 1;

  if (city) {
    whereConditions.push(`(location->>'city') = $${paramIndex++}`);
    queryParams.push(city);
  }

  if (search) {
    whereConditions.push(`(name ILIKE $${paramIndex++} OR bio ILIKE $${paramIndex})`);
    const searchPattern = `%${search}%`;
    queryParams.push(searchPattern, searchPattern);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const photographers = await db.query(
    `SELECT id, name, bio, location, specializations, pricing, rating, verified
     FROM photographers
     ${whereClause}
     ORDER BY verified DESC, created_at DESC
     LIMIT $${paramIndex++}`,
    [...queryParams, limitNum],
  );

  res.json({ success: true, data: photographers });
});

router.get('/availability', async (req: Request, res: Response): Promise<void> => {
  const { photographerId, start, end } = req.query as Record<string, string>;

  if (!photographerId || !start || !end) {
    throw new AppError(400, 'photographerId, start, end are required');
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    throw new AppError(400, 'Invalid date range');
  }

  const busySlots = await db.query(
    `SELECT id, start_time, end_time, status
     FROM bookings
     WHERE photographer_id = $1
       AND status != 'cancelled'
       AND (
         (start_time <= $2 AND end_time > $2)
         OR (start_time < $3 AND end_time >= $3)
         OR (start_time >= $2 AND end_time <= $3)
       )
     ORDER BY start_time ASC`,
    [photographerId, startDate, endDate],
  );

  res.json({ success: true, data: busySlots });
});

router.post('/bookings', validate(createBookingSchema), async (req: Request, res: Response): Promise<void> => {
  const body: CreateBookingInput = req.body;
  const {
    serviceId,
    serviceType,
    startTime,
    endTime,
    photographerId,
    price,
    contact,
    notes,
    persons,
    location,
  } = body;

  if (!serviceId || !startTime || !endTime || !contact?.name || !contact?.phone) {
    throw new AppError(400, 'Missing required fields');
  }

  if (!isValidPhone(contact.phone)) {
    throw new AppError(400, 'Invalid phone number');
  }

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    throw new AppError(400, 'Invalid start/end time');
  }

  if (serviceType === 'onLocation' && !location?.address) {
    throw new AppError(400, 'Location is required for on-location services');
  }

  const client = await getOrCreateClient(contact);
  const resolvedPhotographerId = await resolvePhotographerId(photographerId);
  if (!resolvedPhotographerId) {
    throw new AppError(400, 'Photographer not found');
  }

  const conflicts = await db.query(
    `SELECT id FROM bookings
     WHERE photographer_id = $1
       AND (
         (start_time <= $2 AND end_time > $2)
         OR (start_time < $3 AND end_time >= $3)
         OR (start_time >= $2 AND end_time <= $3)
       )
       AND status != 'cancelled'`,
    [resolvedPhotographerId, startDate, endDate],
  );

  if (conflicts.length > 0) {
    throw new AppError(409, 'Time slot is not available');
  }

  const priceData: BookingPriceData = {
    totalPrice: Number(price?.totalPrice ?? price?.total ?? 0),
    basePrice: Number(price?.basePrice ?? 0),
    currency: price?.currency || 'RUB',
  };

  const metadata: BookingMetadata = {
    source: 'chatgpt_actions',
    serviceType: serviceType || 'studio',
    persons: persons || 1,
    clientInfo: {
      name: contact.name,
      phone: contact.phone,
      email: contact.email || client.email,
    },
  };

  if (location?.address) {
    metadata['location'] = {
      address: location.address,
      city: location.city || 'Ростов-на-Дону',
      coordinates: location.coordinates || null,
    };
  }

  if (notes) {
    metadata['notes'] = notes;
  }

  const booking = await db.queryOne(
    `INSERT INTO bookings (client_id, photographer_id, service_id, start_time, end_time, price, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING *`,
    [
      client.id,
      resolvedPhotographerId,
      serviceId,
      startDate,
      endDate,
      JSON.stringify(priceData),
      JSON.stringify(metadata),
      'pending',
    ],
  );

  let orderId: string | null = null;
  if (booking && priceData['totalPrice'] > 0) {
    const order = await db.queryOne(
      `INSERT INTO orders (client_id, photographer_id, booking_id, type, status, payment_status, total_amount, currency, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id`,
      [
        client.id,
        resolvedPhotographerId,
        booking.id,
        'booking',
        'pending',
        'pending',
        priceData['totalPrice'],
        priceData['currency'] || 'RUB',
        JSON.stringify({ source: 'chatgpt_actions' }),
      ],
    );
    orderId = order?.id || null;
  }

  res.status(201).json({
    success: true,
    data: {
      bookingId: booking?.id,
      orderId,
      status: booking?.status,
      photographerId: booking?.photographer_id,
      startTime: booking?.start_time,
      endTime: booking?.end_time,
    },
  });
});

router.get('/bookings/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const booking = await db.queryOne(
    'SELECT id, status, start_time, end_time, photographer_id, service_id FROM bookings WHERE id = $1',
    [id],
  );

  if (!booking) {
    throw new AppError(404, 'Booking not found');
  }

  res.json({ success: true, data: booking });
});

router.post('/photo-print-orders', validate(createPhotoPrintOrderSchema), async (req: Request, res: Response): Promise<void> => {
  const body: CreatePhotoPrintOrderInput = req.body;

  if (!body.items || body.items.length === 0) {
    throw new AppError(400, 'At least one photo is required');
  }

  if (!body.contact?.name || body.contact.name.trim().length < 2) {
    throw new AppError(400, 'Contact name is required');
  }

  if (!body.contact?.phone || !isValidPhone(body.contact.phone)) {
    throw new AppError(400, 'Valid phone number is required');
  }

  const normalizedItems = body.items.map((item) => ({
    ...item,
    uploadedUrl: item.uploadedUrl || item.photoUrl,
  }));

  const invalidItems = normalizedItems.filter((item) => !item.uploadedUrl);
  if (invalidItems.length > 0) {
    throw new AppError(400, 'Each item must include uploadedUrl or photoUrl');
  }

  const orderId = generateOrderId();
  const itemsJson = JSON.stringify(normalizedItems);
  const priorityText = itemsJson.toLowerCase();
  const priority = priorityText.includes('vip') || priorityText.includes('вип') ? 'vip'
    : priorityText.includes('срочн') || priorityText.includes('urgent') ? 'urgent' : 'normal';
  const order = await db.queryOne(
    `INSERT INTO photo_print_orders (
      order_id,
      mode,
      contact_name,
      contact_phone,
      contact_email,
      comments,
      total_price,
      items,
      status,
      priority
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING order_id, status, created_at`,
    [
      orderId,
      body.mode,
      body.contact.name.trim(),
      body.contact.phone.trim(),
      body.contact.email?.trim() || null,
      body.contact.comments?.trim() || null,
      body.totalPrice,
      itemsJson,
      'new',
      priority,
    ],
  );

  res.status(201).json({
    success: true,
    data: {
      orderId: order?.order_id || orderId,
      status: order?.status || 'new',
      createdAt: order?.created_at || new Date().toISOString(),
    },
  });
});

router.get('/photo-print-orders/:orderId', async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params;
  const order = await db.queryOne(
    'SELECT order_id, status, created_at, total_price FROM photo_print_orders WHERE order_id = $1',
    [orderId],
  );

  if (!order) {
    throw new AppError(404, 'Order not found');
  }

  res.json({
    success: true,
    data: {
      orderId: order.order_id,
      status: order.status,
      createdAt: order.created_at,
      totalPrice: order.total_price,
    },
  });
});

router.post('/payment-links', validate(createPaymentLinkSchema), async (req: Request, res: Response): Promise<void> => {
  const body: CreatePaymentLinkInput = req.body;
  const {
    orderType,
    orderId,
    amount,
    currency,
    description,
    email,
    phone,
  } = body;

  if (!orderType || !orderId) {
    throw new AppError(400, 'orderType and orderId are required');
  }

  let resolvedAmount = Number(amount);
  let resolvedCurrency = currency || 'RUB';
  let resolvedDescription = description || `Order ${orderId}`;
  let resolvedEmail = email;
  let resolvedPhone = phone;

  if (orderType === 'photo_print') {
    const order = await db.queryOne(
      'SELECT order_id, total_price, contact_email, contact_phone FROM photo_print_orders WHERE order_id = $1',
      [orderId],
    );
    if (!order) {
      throw new AppError(404, 'Photo print order not found');
    }
    resolvedAmount = Number(order.total_price);
    resolvedDescription = description || `Photo print order ${order.order_id}`;
    resolvedEmail = resolvedEmail || order.contact_email || undefined;
    resolvedPhone = resolvedPhone || order.contact_phone || undefined;
  } else if (orderType === 'booking') {
    const order = await db.queryOne(
      'SELECT id, total_amount, currency FROM orders WHERE id = $1 AND type = $2',
      [orderId, 'booking'],
    );
    if (!order) {
      throw new AppError(404, 'Booking order not found');
    }
    resolvedAmount = Number(order.total_amount || 0);
    resolvedCurrency = order.currency || resolvedCurrency;
    resolvedDescription = description || `Booking order ${order.id}`;
  } else if (orderType === 'custom') {
    if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
      throw new AppError(400, 'amount is required for custom payments');
    }
  }

  if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
    throw new AppError(400, 'Invalid amount');
  }

  const paymentUrl = `${getBaseUrl(req)}/chat?order=${encodeURIComponent(orderId)}&source=payment-link`;

  res.json({
    success: true,
    data: {
      paymentUrl,
      amount: resolvedAmount,
      currency: resolvedCurrency,
      description: resolvedDescription,
      email: resolvedEmail,
      phone: resolvedPhone,
    },
  });
});

export default router;
