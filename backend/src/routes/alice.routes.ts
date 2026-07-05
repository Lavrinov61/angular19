import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { config } from '../config/index.js';
import { generateOrderId } from '../utils/secure-random.js';
import type { AlicePhotographerLookupRow, AliceUserLookupRow } from '../types/views/alice-views.js';

const router = Router();

type AliceSession = {
  message_id: number;
  session_id: string;
  skill_id: string;
  user_id: string;
  new: boolean;
};

type AliceEntity = {
  type: string;
  value?: unknown;
};

interface AliceRequestPayload {
  readonly [key: string]: unknown;
}

interface AliceIntentMap {
  readonly [key: string]: unknown;
}

interface AliceEntityObjectValue {
  readonly [key: string]: unknown;
}

type AliceRequestData = {
  command?: string;
  original_utterance?: string;
  payload?: AliceRequestPayload;
  nlu?: {
    entities?: AliceEntity[];
    intents?: AliceIntentMap;
  };
};

type AliceWebhookRequest = {
  version: string;
  session: AliceSession;
  request: AliceRequestData;
  state?: {
    session?: AliceSessionState;
  };
};

type AliceButton = {
  title: string;
  payload?: AliceRequestPayload;
  url?: string;
  hide?: boolean;
};

type AliceWebhookResponse = {
  version: string;
  session: AliceSession;
  response: {
    text: string;
    end_session: boolean;
    buttons?: AliceButton[];
  };
  session_state?: AliceSessionState;
};

type ServiceConfig = {
  id: string;
  title: string;
  price: number;
  durationMinutes: number;
  keywords: string[];
};

type PrintState = {
  photoUrls?: string[];
  format?: string;
  paperType?: 'glossy' | 'matte';
  quantity?: number;
};

type AliceSessionState = {
  flow?: 'booking' | 'print';
  serviceId?: string;
  serviceName?: string;
  dateTime?: string;
  durationMinutes?: number;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  print?: PrintState;
};

const BOOKING_SERVICES: ServiceConfig[] = [
  {
    id: 'foto-na-document',
    title: 'Фото на документы',
    price: 700,
    durationMinutes: 15,
    keywords: ['документ', 'паспорт', 'загран', 'виза', 'грин', 'грин-карт', 'грингард'],
  },
  {
    id: 'portretnaya-sjomka',
    title: 'Портретная съёмка',
    price: 900,
    durationMinutes: 30,
    keywords: ['портрет', 'бизнес', 'резюме', 'карьера', 'карьерный профиль'],
  },
];

const PRINT_UNIT_PRICE = 20;

type DateTimeEntityValue = {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  year_is_relative?: boolean;
  month_is_relative?: boolean;
  day_is_relative?: boolean;
  hour_is_relative?: boolean;
  minute_is_relative?: boolean;
};

function buildResponse(
  session: AliceSession,
  text: string,
  sessionState?: AliceSessionState,
  buttons?: AliceButton[],
): AliceWebhookResponse {
  return {
    version: '1.0',
    session,
    response: {
      text,
      end_session: false,
      ...(buttons ? { buttons } : {}),
    },
    ...(sessionState ? { session_state: sessionState } : {}),
  };
}

function getSessionState(body: AliceWebhookRequest): AliceSessionState {
  const rawState = body.state?.session;
  if (!rawState || typeof rawState !== 'object') {
    return {};
  }
  return rawState;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function isValidPhone(phone: string): boolean {
  const digits = normalizePhone(phone);
  return digits.length >= 10 && digits.length <= 15;
}

function extractPhone(entities: AliceEntity[] | undefined, command: string): string | null {
  if (entities) {
    const phoneEntity = entities.find((entity) => entity.type === 'YANDEX.PHONE');
    if (phoneEntity && typeof phoneEntity.value === 'object' && phoneEntity.value) {
      const value = phoneEntity.value as AliceEntityObjectValue;
      if (typeof value['number'] === 'string') {
        return value['number'];
      }
    }
  }

  const match = command.match(/\+?\d[\d\s()-]{8,}\d/);
  return match ? match[0] : null;
}

function extractName(entities: AliceEntity[] | undefined): string | null {
  if (!entities) return null;
  const fioEntity = entities.find((entity) => entity.type === 'YANDEX.FIO');
  if (!fioEntity || typeof fioEntity.value !== 'object' || !fioEntity.value) return null;
  const value = fioEntity.value as AliceEntityObjectValue;
  const parts = [value['first_name'], value['middle_name'], value['last_name']]
    .filter((part): part is string => typeof part === 'string' && part.length > 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

function resolveDateTime(value: DateTimeEntityValue): Date | null {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let day = now.getDate();
  let hour = now.getHours();
  let minute = now.getMinutes();

  if (value.year !== undefined) {
    year = value.year_is_relative ? year + value.year : value.year;
  }
  if (value.month !== undefined) {
    month = value.month_is_relative ? month + value.month : value.month;
  }
  if (value.day !== undefined) {
    day = value.day_is_relative ? day + value.day : value.day;
  }
  if (value.hour !== undefined) {
    hour = value.hour_is_relative ? hour + value.hour : value.hour;
  }
  if (value.minute !== undefined) {
    minute = value.minute_is_relative ? minute + value.minute : value.minute;
  }

  if (value.hour === undefined && value.hour_is_relative === undefined) {
    return null;
  }

  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(result.getTime()) ? null : result;
}

function extractDateTime(entities: AliceEntity[] | undefined): Date | null {
  if (!entities) return null;
  const dtEntity = entities.find((entity) => entity.type === 'YANDEX.DATETIME');
  if (!dtEntity || typeof dtEntity.value !== 'object' || !dtEntity.value) return null;
  return resolveDateTime(dtEntity.value as DateTimeEntityValue);
}

function matchService(command: string): ServiceConfig | null {
  for (const service of BOOKING_SERVICES) {
    if (service.keywords.some((keyword) => command.includes(keyword))) {
      return service;
    }
  }
  return null;
}

function extractFormat(command: string): string | null {
  const match = command.match(/(\d{1,2})\s*[xх]\s*(\d{1,2})/i);
  if (!match) return null;
  return `${match[1]}x${match[2]}`;
}

function extractQuantity(entities: AliceEntity[] | undefined, command: string): number | null {
  if (entities) {
    const numberEntity = entities.find((entity) => entity.type === 'YANDEX.NUMBER');
    if (numberEntity && typeof numberEntity.value === 'number') {
      return Math.max(1, Math.round(numberEntity.value));
    }
  }

  const match = command.match(/\b(\d{1,3})\b/);
  if (!match) return null;
  return Math.max(1, parseInt(match[1], 10));
}

function extractPhotoUrls(command: string): string[] {
  const urls = command.match(/https?:\/\/\S+/gi) || [];
  return urls.map((url) => url.replace(/[.,)]+$/, ''));
}

function determinePaperType(command: string): 'glossy' | 'matte' {
  if (command.includes('мат')) return 'matte';
  return 'glossy';
}

function getBaseUrl(req: Request): string {
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto ? forwardedProto.split(',')[0] : req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

async function getOrCreateClient(name: string, phone: string, email?: string): Promise<AliceUserLookupRow> {
  const normalizedPhone = normalizePhone(phone);
  const fallbackEmail = email?.toLowerCase().trim() || (normalizedPhone ? `guest+${normalizedPhone}@svoefoto.local` : `guest-${uuidv4()}@svoefoto.local`);

  let user = await db.queryOne<AliceUserLookupRow>(
    'SELECT id, email FROM users WHERE email = $1',
    [fallbackEmail],
  );

  if (!user && normalizedPhone) {
    user = await db.queryOne<AliceUserLookupRow>(
      'SELECT id, email FROM users WHERE phone = $1',
      [phone],
    );
  }

  if (!user) {
    const userId = uuidv4();
    await db.query(
      `INSERT INTO users (id, email, display_name, phone, role, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, fallbackEmail, name.trim(), phone.trim(), 'client', true, false],
    );
    return { id: userId, email: fallbackEmail };
  }

  await db.query(
    'UPDATE users SET phone = COALESCE(phone, $1), updated_at = NOW() WHERE id = $2',
    [phone.trim(), user.id],
  );

  return user;
}

async function resolvePhotographerId(): Promise<string | null> {
  const fallback = await db.queryOne<AlicePhotographerLookupRow>(
    'SELECT id FROM photographers ORDER BY verified DESC, created_at ASC LIMIT 1',
    [],
  );
  return fallback?.id || null;
}

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as AliceWebhookRequest;
  const session = body.session;
  const commandRaw = (body.request.command || body.request.original_utterance || '').trim();
  const command = commandRaw.toLowerCase();
  const entities = body.request.nlu?.entities || [];
  const payload = body.request.payload;

  const tokenRequired = config.alice.webhookToken;
  if (tokenRequired) {
    const providedToken = req.query['token'];
    if (typeof providedToken !== 'string' || providedToken !== tokenRequired) {
      res.status(401).json(buildResponse(session, 'Недоступно: неверный токен.', undefined));
      return;
    }
  }

  let state: AliceSessionState = { ...getSessionState(body) };
  if (payload && typeof payload === 'object') {
    if (typeof payload['flow'] === 'string') {
      state.flow = payload['flow'] as 'booking' | 'print';
    }
    if (typeof payload['serviceId'] === 'string') {
      state.serviceId = payload['serviceId'];
      state.serviceName = typeof payload['serviceName'] === 'string' ? payload['serviceName'] : state.serviceName;
    }
  }

  if (!state.flow) {
    if (command.includes('печать') || command.includes('печат')) {
      state.flow = 'print';
    } else if (command.includes('запис') || command.includes('съёмк') || command.includes('съемк')) {
      state.flow = 'booking';
    }
  }

  if (!state.flow) {
    const buttons: AliceButton[] = [
      { title: 'Запись на съёмку', payload: { flow: 'booking' }, hide: true },
      { title: 'Печать фото', payload: { flow: 'print' }, hide: true },
    ];
    res.json(buildResponse(session, 'Что нужно сделать: запись на съёмку или печать фото?', state, buttons));
    return;
  }

  if (state.flow === 'booking') {
    const matchedService = matchService(command);
    if (!state.serviceId && matchedService) {
      state.serviceId = matchedService.id;
      state.serviceName = matchedService.title;
      state.durationMinutes = matchedService.durationMinutes;
    }

    if (!state.serviceId) {
      const buttons: AliceButton[] = BOOKING_SERVICES.map((service) => ({
        title: service.title,
        payload: { flow: 'booking', serviceId: service.id, serviceName: service.title },
        hide: true,
      }));
      res.json(buildResponse(session, 'Какую услугу выбрать?', state, buttons));
      return;
    }

    if (!state.dateTime) {
      const dateTime = extractDateTime(entities);
      if (dateTime && dateTime.getTime() > Date.now()) {
        state.dateTime = dateTime.toISOString();
      } else {
        res.json(buildResponse(session, 'На какую дату и время вас записать?', state));
        return;
      }
    }

    if (!state.contactName) {
      const name = extractName(entities);
      if (name) {
        state.contactName = name;
      } else {
        res.json(buildResponse(session, 'Как к вам обращаться?', state));
        return;
      }
    }

    if (!state.contactPhone) {
      const phone = extractPhone(entities, commandRaw);
      if (phone && isValidPhone(phone)) {
        state.contactPhone = phone;
      } else {
        res.json(buildResponse(session, 'Укажите номер телефона для подтверждения записи.', state));
        return;
      }
    }

    const service = BOOKING_SERVICES.find((item) => item.id === state.serviceId) || BOOKING_SERVICES[0];
    const duration = state.durationMinutes || service.durationMinutes || 60;
    const startDate = new Date(state.dateTime);
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    const client = await getOrCreateClient(state.contactName, state.contactPhone, state.contactEmail);
    const photographerId = await resolvePhotographerId();
    if (!photographerId) {
      res.json(buildResponse(session, 'Не удалось подобрать фотографа. Попробуйте позже.', {}));
      return;
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
      [photographerId, startDate, endDate],
    );

    if (conflicts.length > 0) {
      state.dateTime = undefined;
      res.json(buildResponse(session, 'Это время занято. Назовите другой слот.', state));
      return;
    }

    const priceData = {
      totalPrice: service.price,
      basePrice: service.price,
      currency: 'RUB',
    };

    const metadata = {
      source: 'yandex_alice',
      serviceType: 'studio',
      persons: 1,
      clientInfo: {
        name: state.contactName,
        phone: state.contactPhone,
        email: state.contactEmail || client.email,
      },
    };

    const booking = await db.queryOne(
      `INSERT INTO bookings (client_id, photographer_id, service_id, start_time, end_time, price, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING *`,
      [
        client.id,
        photographerId,
        service.id,
        startDate,
        endDate,
        JSON.stringify(priceData),
        JSON.stringify(metadata),
        'pending',
      ],
    );

    let paymentUrl: string | null = null;
    if (booking && priceData.totalPrice > 0) {
      const order = await db.queryOne(
        `INSERT INTO orders (client_id, photographer_id, booking_id, type, status, payment_status, total_amount, currency, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING id`,
        [
          client.id,
          photographerId,
          booking.id,
          'booking',
          'pending',
          'pending',
          priceData.totalPrice,
          priceData.currency,
          JSON.stringify({ source: 'yandex_alice' }),
        ],
      );

      // Внешний канал ведёт на сайт; оплата выполняется через виджет в чате.
      const orderRef = order?.id || booking.id;
      paymentUrl = `${getBaseUrl(req)}/chat?order=${encodeURIComponent(String(orderRef))}`;
    }

    const buttons: AliceButton[] | undefined = paymentUrl
      ? [{ title: 'Оплатить', url: paymentUrl, hide: false }]
      : undefined;

    const confirmation = paymentUrl
      ? `Запись создана! Съёмка: ${service.title}.\nДата: ${startDate.toLocaleString('ru-RU')}\nСумма: ${service.price}₽.\nОткройте сайт по кнопке ниже и оплатите через виджет.`
      : `Запись создана! Съёмка: ${service.title}.\nДата: ${startDate.toLocaleString('ru-RU')}. Мы свяжемся для подтверждения.`;

    res.json(buildResponse(session, confirmation, {}, buttons));
    return;
  }

  if (state.flow === 'print') {
    const printState: PrintState = { ...(state.print || {}) };

    if (!printState.photoUrls || printState.photoUrls.length === 0) {
      const urls = extractPhotoUrls(commandRaw);
      if (urls.length > 0) {
        printState.photoUrls = urls;
      } else {
        res.json(buildResponse(session, 'Пришлите ссылку на фото для печати.', { ...state, print: printState }));
        return;
      }
    }

    if (!printState.format) {
      printState.format = extractFormat(command) || '10x15';
    }

    if (!printState.paperType) {
      printState.paperType = determinePaperType(command);
    }

    if (!printState.quantity) {
      printState.quantity = extractQuantity(entities, command) || 1;
    }

    if (!state.contactName) {
      const name = extractName(entities);
      if (name) {
        state.contactName = name;
      } else {
        res.json(buildResponse(session, 'Как к вам обращаться?', { ...state, print: printState }));
        return;
      }
    }

    if (!state.contactPhone) {
      const phone = extractPhone(entities, commandRaw);
      if (phone && isValidPhone(phone)) {
        state.contactPhone = phone;
      } else {
        res.json(buildResponse(session, 'Укажите номер телефона для связи.', { ...state, print: printState }));
        return;
      }
    }

    const contactEmail = state.contactEmail;
    const totalPhotos = (printState.photoUrls || []).length;
    const totalCopies = (printState.quantity || 1) * totalPhotos;
    const totalPrice = totalCopies * PRINT_UNIT_PRICE;

    const orderId = generateOrderId();
    await db.query(
      `INSERT INTO photo_print_orders (
        order_id,
        mode,
        contact_name,
        contact_phone,
        contact_email,
        comments,
        total_price,
        items,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        orderId,
        'simple',
        state.contactName.trim(),
        state.contactPhone.trim(),
        contactEmail || null,
        null,
        totalPrice,
        JSON.stringify(
          (printState.photoUrls || []).map((url) => ({
            uploadedUrl: url,
            format: printState.format,
            paperType: printState.paperType,
            quantity: printState.quantity,
          })),
        ),
        'new',
      ],
    );

    let paymentUrl: string | null = null;
    paymentUrl = `${getBaseUrl(req)}/chat?order=${encodeURIComponent(orderId)}`;

    const buttons: AliceButton[] | undefined = paymentUrl
      ? [{ title: 'Оплатить', url: paymentUrl, hide: false }]
      : undefined;

    const responseText = paymentUrl
      ? `Заказ на печать создан. Формат ${printState.format}, копий: ${totalCopies}. Сумма ${totalPrice}₽. Откройте сайт по кнопке ниже и оплатите через виджет.`
      : `Заказ на печать создан. Формат ${printState.format}, копий: ${totalCopies}. Сумма ${totalPrice}₽.`;

    res.json(buildResponse(session, responseText, {}, buttons));
    return;
  }

  res.json(buildResponse(session, 'Я могу записать на съёмку или оформить печать фото. Что нужно?'));
});

export default router;
