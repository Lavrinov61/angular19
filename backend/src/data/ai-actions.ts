import { createLogger } from '../utils/logger.js';

const logger = createLogger('ai-actions');

export type AiActionName =
  | 'select_document'
  | 'select_tariff'
  | 'upload_photo'
  | 'confirm_order'
  | 'select_pickup'
  | 'request_delivery'
  | 'show_prices'
  | 'show_examples'
  | 'go_to_main_menu'
  | 'check_slots'
  | 'create_booking'
  | 'add_to_cart'
  | 'open_cart';

export interface AiActionDefinition {
  name: AiActionName;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, { type: 'string'; enum?: string[]; description?: string }>;
    required?: string[];
  };
}

export interface AiActionCall {
  name: string;
  param?: string;
}

export interface AiActionButtonData {
  readonly [key: string]: unknown;
}

export interface AiActionButtonMapping {
  buttonValue: string;
  buttonData?: AiActionButtonData;
  followupInput?: string;
}

export const DOCUMENT_ACTIONS: Record<string, string> = {
  passport_rf: 'Паспорт РФ',
  zagran: 'Загранпаспорт',
  visa: 'Виза',
  driver: 'Водительское удостоверение',
  student: 'Студенческий билет',
  work_pass: 'Пропуск на работу',
  military: 'Военный билет',
  other: 'Другой документ',
};

// ============================================================================
// Sync fallback data (inline — pricing engine DB is the primary source)
// ============================================================================

export const TARIFF_ACTIONS: Record<string, string> = {
  no_processing: 'Базовая обработка (700₽)',
  with_processing: 'Расширенная обработка (950₽)',
  vip: 'Максимальная обработка (1 400₽)',
  all_docs: 'VIP «Все документы» (2 490₽)',
};

export const PICKUP_ACTIONS: Record<string, string> = {
  pickup_soborny: 'pickup_soborny',
};

/** Каталог услуг для добавления в корзину — цены фиксированные, AI не может их менять */
export interface CartServiceDef {
  name: string;
  onlinePrice: number;
  studioPrice: number;
  nextOnlinePrice?: number;
  nextStudioPrice?: number;
  icon: string;
}

// Inline fallback — pricing engine DB is the primary source (see loadCartServices)
export const CART_SERVICES: Record<string, CartServiceDef> = {
  basic:    { name: 'Базовая обработка',                  onlinePrice: 700, studioPrice: 700, nextOnlinePrice: 700, icon: 'photo_camera' },
  retouch:  { name: 'Расширенная обработка',              onlinePrice: 950, studioPrice: 950, icon: 'auto_fix_high' },
  vip:      { name: 'Максимальная обработка',             onlinePrice: 1400, studioPrice: 1400, icon: 'bolt' },
  all_docs: { name: 'VIP «Все документы»',               onlinePrice: 2490, studioPrice: 700, icon: 'folder_copy' },
  neuro_mini:     { name: 'Нейрофотосессия (1 фото)',          onlinePrice: 450,  studioPrice: 450, icon: 'psychology' },
  neuro_standard: { name: 'Нейрофотосессия стандарт (4 фото)', onlinePrice: 990,  studioPrice: 990, icon: 'collections' },
  neuro_full:     { name: 'Нейрофотосессия полная (10-15 фото)', onlinePrice: 3000, studioPrice: 3000, icon: 'auto_awesome' },
  restore_simple:  { name: 'Простая реставрация фото',          onlinePrice: 450,  studioPrice: 450, icon: 'healing' },
  restore_medium:  { name: 'Реставрация средней сложности',     onlinePrice: 900,  studioPrice: 900, icon: 'auto_fix_high' },
  restore_complex: { name: 'Сложная реставрация фото',          onlinePrice: 1800, studioPrice: 1800, icon: 'construction' },
};

// ============================================================================
// Async DB-driven versions (Phase 2: pricing engine)
// ============================================================================

let _cartServicesCache: Record<string, CartServiceDef> | null = null;
let _tariffActionsCache: Record<string, string> | null = null;

/**
 * Загрузить CART_SERVICES из pricing engine (DB).
 * Fallback: статический CART_SERVICES если DB недоступна.
 */
export async function loadCartServices(): Promise<Record<string, CartServiceDef>> {
  if (_cartServicesCache) return _cartServicesCache;

  try {
    const { getCategoryBySlug } = await import('../services/pricing-engine.service.js');
    const category = await getCategoryBySlug('photo-docs');
    if (!category) return CART_SERVICES; // fallback to static

    const result: Record<string, CartServiceDef> = {};
    const processingGroup = category.optionGroups.find(g => g.slug === 'processing-level');
    if (processingGroup) {
      for (const opt of processingGroup.options) {
        result[opt.name] = {
          name: opt.name,
          onlinePrice: opt.price_online ?? opt.base_price,
          studioPrice: opt.price_studio ?? opt.base_price,
          nextOnlinePrice: opt.price_next_unit ?? opt.price_online ?? opt.base_price,
          nextStudioPrice: opt.price_next_unit ?? opt.price_studio ?? opt.base_price,
          icon: opt.icon || 'photo_camera',
        };
      }
    }

    // Merge: DB options + static-only services (neuro, restore, etc.)
    _cartServicesCache = { ...CART_SERVICES, ...result };
    return _cartServicesCache;
  } catch (err) {
    logger.error('[ai-actions] Failed to load cart services from DB, using static fallback', { error: String(err) });
    return CART_SERVICES;
  }
}

/**
 * Загрузить TARIFF_ACTIONS из pricing engine (DB).
 * Fallback: статический TARIFF_ACTIONS.
 */
export async function loadTariffActions(): Promise<Record<string, string>> {
  if (_tariffActionsCache) return _tariffActionsCache;

  try {
    const { getCategoryBySlug } = await import('../services/pricing-engine.service.js');
    const category = await getCategoryBySlug('photo-docs');
    if (!category) return TARIFF_ACTIONS;

    const result: Record<string, string> = {};
    const processingGroup = category.optionGroups.find(g => g.slug === 'processing-level');
    if (processingGroup) {
      for (const opt of processingGroup.options) {
        const price = opt.price_online ?? opt.base_price;
        result[opt.slug] = `${opt.name} (${price}₽)`;
      }
    }

    _tariffActionsCache = result;
    return _tariffActionsCache;
  } catch (err) {
    logger.error('[ai-actions] Failed to load tariff actions from DB, using static fallback', { error: String(err) });
    return TARIFF_ACTIONS;
  }
}

/**
 * Инициализировать async AI actions при старте сервера.
 * Подгружает данные из DB и заполняет кэш.
 */
export async function initAiActions(): Promise<void> {
  await Promise.all([
    loadCartServices(),
    loadTariffActions(),
  ]);

  // Update add_to_cart enum with dynamic keys from DB
  if (_cartServicesCache) {
    const dynamicServiceKeys = Object.keys(_cartServicesCache);
    AI_ACTIONS = AI_ACTIONS.map(action => {
      if (action.name !== 'add_to_cart' || !action.parameters) return action;
      return {
        ...action,
        parameters: {
          ...action.parameters,
          properties: {
            ...action.parameters.properties,
            service: {
              ...action.parameters.properties['service'],
              enum: dynamicServiceKeys,
            },
          },
        },
      };
    });
    ACTIONS_BY_NAME = AI_ACTIONS.reduce<Record<string, AiActionDefinition>>((acc, a) => {
      acc[a.name] = a;
      return acc;
    }, {});
  }

  logger.info('[ai-actions] Initialized from pricing engine DB');
}

/** Сброс кэша (при обновлении цен в админке) */
export function invalidateAiActionsCache(): void {
  _cartServicesCache = null;
  _tariffActionsCache = null;
}

export let AI_ACTIONS: AiActionDefinition[] = [
  {
    name: 'select_document',
    description: 'Выбрать тип документа.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: Object.keys(DOCUMENT_ACTIONS),
          description: 'Тип документа.',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'select_tariff',
    description: 'Выбрать тариф услуги.',
    parameters: {
      type: 'object',
      properties: {
        tariff: {
          type: 'string',
          enum: Object.keys(TARIFF_ACTIONS),
          description: 'Тариф.',
        },
      },
      required: ['tariff'],
    },
  },
  {
    name: 'upload_photo',
    description: 'Попросить клиента загрузить фото.',
  },
  {
    name: 'confirm_order',
    description: 'Подтвердить заказ без апсейла.',
  },
  {
    name: 'select_pickup',
    description: 'Выбрать точку самовывоза.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          enum: Object.keys(PICKUP_ACTIONS),
          description: 'Точка самовывоза.',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'request_delivery',
    description: 'Запросить доставку на дом с адресом.',
    parameters: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Адрес доставки.',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'show_prices',
    description: 'Показать цены и тарифы.',
  },
  {
    name: 'show_examples',
    description: 'Показать примеры работ.',
  },
  {
    name: 'go_to_main_menu',
    description: 'Вернуться в главное меню.',
  },
  {
    name: 'check_slots',
    description: 'Показать свободные слоты для записи на дату.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Дата в формате YYYY-MM-DD.',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'create_booking',
    description: 'Записать клиента на услугу. Параметр: service|date|time|clientName|clientPhone (через |).',
    parameters: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'service|date|time|clientName|clientPhone через разделитель |.',
        },
      },
      required: ['data'],
    },
  },
  {
    name: 'add_to_cart',
    description: 'Добавить услугу в корзину клиента на сайте.',
    parameters: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          enum: Object.keys(CART_SERVICES),
          description: 'ID услуги из каталога.',
        },
      },
      required: ['service'],
    },
  },
  {
    name: 'open_cart',
    description: 'Открыть корзину клиента на сайте.',
  },
];

let ACTIONS_BY_NAME = AI_ACTIONS.reduce<Record<string, AiActionDefinition>>((acc, action) => {
  acc[action.name] = action;
  return acc;
}, {});

const DEFAULT_ACTIONS: AiActionName[] = [
  'show_prices',
  'show_examples',
  'select_document',
  'select_tariff',
  'upload_photo',
  'go_to_main_menu',
  'check_slots',
  'create_booking',
  'add_to_cart',
  'open_cart',
];

const STEP_ACTIONS: Record<string, AiActionName[]> = {
  document_select: ['select_document', 'go_to_main_menu'],
  document_after_photo: ['select_document', 'go_to_main_menu'],
  service_select: ['select_tariff', 'go_to_main_menu'],
  waiting_photo: ['upload_photo', 'go_to_main_menu'],
  pickup_select: ['select_pickup', 'request_delivery'],
  delivery_awaiting_address: ['request_delivery', 'go_to_main_menu'],
  delivery_awaiting_phone: ['go_to_main_menu'],
  after_examples: ['select_document', 'select_tariff', 'upload_photo', 'show_prices', 'add_to_cart', 'go_to_main_menu'],
  after_question: ['select_document', 'select_tariff', 'upload_photo', 'show_prices', 'add_to_cart', 'check_slots', 'create_booking', 'go_to_main_menu'],
  cart_added: ['add_to_cart', 'open_cart', 'go_to_main_menu'],
  returning_visitor: ['add_to_cart', 'open_cart', 'go_to_main_menu'],
  cart_opened: ['add_to_cart', 'go_to_main_menu'],
  main_menu: DEFAULT_ACTIONS,
  order_confirmed: ['confirm_order', 'select_pickup', 'request_delivery', 'add_to_cart'],
};

export function getAvailableActionsForStep(step: string | null): AiActionDefinition[] {
  const actionNames = (step && STEP_ACTIONS[step]) ? STEP_ACTIONS[step] : DEFAULT_ACTIONS;
  return actionNames.map(name => ACTIONS_BY_NAME[name]).filter(Boolean);
}

export function mapAiActionToButton(action: AiActionCall): AiActionButtonMapping | null {
  const name = action.name?.trim();
  const param = action.param?.trim();

  switch (name) {
    case 'select_document': {
      if (!param || !DOCUMENT_ACTIONS[param]) return null;
      return { buttonValue: DOCUMENT_ACTIONS[param] };
    }
    case 'select_tariff': {
      if (!param || !TARIFF_ACTIONS[param]) return null;
      return { buttonValue: TARIFF_ACTIONS[param] };
    }
    case 'upload_photo':
      return { buttonValue: 'send_photo' };
    case 'confirm_order':
      return { buttonValue: 'skip_upsell' };
    case 'select_pickup': {
      if (!param || !PICKUP_ACTIONS[param]) return null;
      return { buttonValue: PICKUP_ACTIONS[param] };
    }
    case 'request_delivery': {
      if (!param) return null;
      return { buttonValue: 'delivery_home', followupInput: param };
    }
    case 'show_prices':
      return { buttonValue: 'view_prices' };
    case 'show_examples':
      return { buttonValue: 'view_examples' };
    case 'go_to_main_menu':
      return { buttonValue: 'main_menu' };
    case 'add_to_cart': {
      if (!param || !CART_SERVICES[param]) return null;
      return {
        buttonValue: 'add_to_cart',
        buttonData: { serviceId: param },
      };
    }
    case 'open_cart':
      return { buttonValue: 'open_cart' };
    default:
      return null;
  }
}
