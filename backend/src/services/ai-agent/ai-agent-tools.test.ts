import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeTool, getToolDeclarations, getToolRiskClass, type ToolContext } from './ai-agent-tools.js';
import { getStudentDiscountForPhone } from '../student-discount.service.js';
import {
  checkSubscription,
  checkSubscriptionByUserId,
  getPlanById,
  initSubscription,
} from '../subscription.service.js';
import { getCategories, getCategoryBySlug, validateSelection, calculatePrice } from '../pricing-engine.service.js';
import { handleFinalizeOrder } from '../../routes/chat/chat-order.service.js';
import { generateChatPaymentUrl } from '../payment-link.service.js';
import { mergeMetadata, removeMetadataKeys } from '../../routes/chat/conversation-adapter.js';
import { config } from '../../config/index.js';
import db from '../../database/db.js';
import { getStudiosEffectiveStatus, type StudioStatusRow } from '../studio-status.service.js';

/** Фикстура: историческая строка Баррикадной ещё есть в БД, но не публична. */
const STUDIOS_WITH_HISTORICAL_BARRIKADNAYA: StudioStatusRow[] = [
  { id: 's-sob', name: 'Своё Фото — Соборный', location_code: 'soborny', address: 'ул. Соборный 21', status: 'open', status_message: null, status_until: null },
  { id: 's-bar', name: 'Своё Фото — Баррикадная', location_code: 'barrikadnaya-4', address: 'ул. 2-ая Баррикадная 4', status: 'open', status_message: null, status_until: null },
];

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../database/db.js', () => ({
  default: { queryOne: vi.fn(), query: vi.fn(), transaction: vi.fn() },
}));

// studio-status: по умолчанию публична только точка на Соборном.
vi.mock('../studio-status.service.js', () => ({
  getStudiosEffectiveStatus: vi.fn().mockResolvedValue([
    { id: 's-sob', name: 'Своё Фото — Соборный', location_code: 'soborny', address: 'ул. Соборный 21', status: 'open', status_message: null, status_until: null },
  ]),
  STUDIO_SHORT_LABELS: { soborny: 'Соборный 21' },
  isStudioLabelOpen: vi.fn().mockResolvedValue(true),
  resolveOpenProductionLabel: vi.fn(async (label: string) => label),
}));

vi.mock('../pricing-engine.service.js', () => ({
  getCategories: vi.fn(),
  getCategoryBySlug: vi.fn(),
  calculatePrice: vi.fn(),
  validateSelection: vi.fn(),
}));

vi.mock('../subscription.service.js', () => ({
  checkSubscription: vi.fn(),
  checkSubscriptionByUserId: vi.fn(),
  getPlanById: vi.fn(),
  initSubscription: vi.fn(),
}));

vi.mock('../student-discount.service.js', () => ({
  getStudentDiscountForPhone: vi.fn(),
}));

vi.mock('../../routes/chat/chat-order.service.js', () => ({
  handleFinalizeOrder: vi.fn(),
}));

vi.mock('../payment-link.service.js', () => ({
  generateChatPaymentUrl: vi.fn(),
}));

vi.mock('../../routes/chat/conversation-adapter.js', () => ({
  mergeMetadata: vi.fn(),
  removeMetadataKeys: vi.fn(),
}));

// config мокаем мутабельным объектом: тесты переключают orderingEnabled/maxAutoOrder.
vi.mock('../../config/index.js', () => ({
  config: { ai: { orderingEnabled: false, maxAutoOrder: 5000 } },
}));

const baseCtx: ToolContext = {
  conversationId: 'conv-1',
  contactId: 'contact-1',
  userId: 'user-1',
  phone: '+79011234567',
};

interface PickupPointToolRow {
  address: string;
}

interface TemporarilyClosedPickupPoint {
  name: string;
}

interface PickupPointsToolResult {
  pickup_points: PickupPointToolRow[];
  temporarily_closed?: TemporarilyClosedPickupPoint[];
}

interface CatalogToolOption {
  slug: string;
  base_price: number;
  pricing_role?: string;
  price_behavior?: string;
  pricing_note?: string;
}

interface CatalogToolOptionGroup {
  slug: string;
  pricing_role?: string;
  price_behavior?: string;
  options: CatalogToolOption[];
}

interface CatalogToolCategory {
  slug: string;
  pricing_guidance?: {
    model: string;
    total_price_source: string;
    total_requires_calculate_price: boolean;
    rules: string[];
    included?: string[];
    examples?: Array<{
      label: string;
      selected_options: string[];
      formula: string;
      total: number;
    }>;
  };
  option_groups: CatalogToolOptionGroup[];
}

interface CatalogToolResult {
  categories: CatalogToolCategory[];
}

function readProp(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function isPickupPointToolRow(value: unknown): value is PickupPointToolRow {
  return typeof readProp(value, 'address') === 'string';
}

function isPickupPointsToolResult(value: unknown): value is PickupPointsToolResult {
  const pickupPoints = readProp(value, 'pickup_points');
  return Array.isArray(pickupPoints) && pickupPoints.every(isPickupPointToolRow);
}

function isCatalogToolOption(value: unknown): value is CatalogToolOption {
  return typeof readProp(value, 'slug') === 'string'
    && typeof readProp(value, 'base_price') === 'number';
}

function isCatalogToolOptionGroup(value: unknown): value is CatalogToolOptionGroup {
  const options = readProp(value, 'options');
  return typeof readProp(value, 'slug') === 'string'
    && Array.isArray(options)
    && options.every(isCatalogToolOption);
}

function isCatalogToolCategory(value: unknown): value is CatalogToolCategory {
  const groups = readProp(value, 'option_groups');
  return typeof readProp(value, 'slug') === 'string'
    && Array.isArray(groups)
    && groups.every(isCatalogToolOptionGroup);
}

function isCatalogToolResult(value: unknown): value is CatalogToolResult {
  const categories = readProp(value, 'categories');
  return Array.isArray(categories) && categories.every(isCatalogToolCategory);
}

function findCatalogGroup(category: CatalogToolCategory, slug: string): CatalogToolOptionGroup {
  const group = category.option_groups.find(candidate => candidate.slug === slug);
  if (!group) throw new Error(`Expected catalog group ${slug}`);
  return group;
}

function findCatalogOption(group: CatalogToolOptionGroup, slug: string): CatalogToolOption {
  const option = group.options.find(candidate => candidate.slug === slug);
  if (!option) throw new Error(`Expected catalog option ${slug}`);
  return option;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks НЕ очищает очередь mockResolvedValueOnce. У db-моков очередь
  // once-ответов могла бы протечь в следующий тест (особенно когда вызов
  // отвергается схемой ДО обращения к БД). Сбрасываем реализацию db-моков
  // полностью: все тесты задают mockResolvedValueOnce непосредственно перед
  // использованием, базовая реализация им не нужна.
  vi.mocked(db.queryOne).mockReset();
  vi.mocked(db.query).mockReset();
  vi.mocked(db.transaction).mockReset();
  // По умолчанию оформление выключено (поведение Этапа 2). Тесты Этапа 3
  // включают флаг явно.
  config.ai.orderingEnabled = false;
  config.ai.maxAutoOrder = 5000;
});

/**
 * Мок db.transaction(cb): прогоняет cb с фейковым client, чей query настраивается
 * через сценарий. Возвращает массив ответов по порядку запросов внутри
 * upsertConfirmation: [advisory-lock, SELECT existing, (INSERT)].
 *   - existingRow=null -> черновик ещё не создан: produce() выполнится, затем
 *     вернётся insertedRow;
 *   - existingRow!=null -> повтор: produce() НЕ выполнится, вернётся existingRow.
 */
/** Минимальный фейковый PoolClient: upsertConfirmation использует только .query. */
interface FakeClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

function mockTransaction(opts: { existingRow: unknown; insertedRow?: unknown }): void {
  vi.mocked(db.transaction).mockImplementation((async (cb: (client: FakeClient) => Promise<unknown>) => {
    const query = vi.fn(async (sql: string) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{}] };
      if (/SELECT[\s\S]*FROM ai_agent_confirmations/i.test(sql)) {
        return { rows: opts.existingRow ? [opts.existingRow] : [] };
      }
      if (/INSERT INTO ai_agent_confirmations/i.test(sql)) {
        return { rows: opts.insertedRow ? [opts.insertedRow] : [] };
      }
      return { rows: [] };
    });
    return cb({ query });
  }) as typeof db.transaction);
}

describe('getToolDeclarations', () => {
  it('при orderingEnabled=false возвращает только read-инструменты (поведение Этапа 2)', () => {
    config.ai.orderingEnabled = false;
    const decls = getToolDeclarations();
    const names = decls.map(d => d.function.name);

    const expected = [
      'get_service_catalog',
      'calculate_price',
      'validate_selection',
      'check_subscription',
      'get_student_discount',
      'get_order_status',
      'get_my_bookings',
      'list_pickup_points',
      'handoff_to_operator',
    ];
    expect(names.sort()).toEqual(expected.sort());

    // Write-draft и payment-link инструменты Этапа 3 при выключенном флаге
    // модель НЕ видит вовсе.
    const orderingTools = [
      'create_print_order_draft',
      'create_subscription_draft',
      'create_booking_draft',
      'create_retouch_draft',
      'request_payment_link',
    ];
    for (const t of orderingTools) {
      expect(names).not.toContain(t);
    }

    // Никаких денежных/мутирующих инструментов в декларациях никогда.
    const forbidden = [
      'record_payment',
      'pay_with_subscription',
      'create_payment',
      'purchase_subscription',
      'cancel_subscription',
      'set_order_status',
      'update_order_status',
      'create_order',
    ];
    for (const bad of forbidden) {
      expect(names).not.toContain(bad);
    }

    // Каждый инструмент это function с JSON-Schema parameters.
    for (const d of decls) {
      expect(d.type).toBe('function');
      expect(typeof d.function.name).toBe('string');
      expect(typeof d.function.description).toBe('string');
      expect(typeof d.function.parameters).toBe('object');
    }
  });

  it('при orderingEnabled=true добавляет write-draft и request_payment_link', () => {
    config.ai.orderingEnabled = true;
    const names = getToolDeclarations().map(d => d.function.name);

    // Read-инструменты остаются.
    expect(names).toContain('get_service_catalog');
    expect(names).toContain('calculate_price');

    // Появляются инструменты оформления Этапа 3.
    expect(names).toContain('create_print_order_draft');
    expect(names).toContain('create_subscription_draft');
    expect(names).toContain('create_booking_draft');
    expect(names).toContain('create_retouch_draft');
    expect(names).toContain('request_payment_link');

    // Прямых денежных инструментов по-прежнему нет (hard-deny на уровне реестра).
    const forbidden = ['record_payment', 'pay_with_subscription', 'purchase_subscription', 'create_payment'];
    for (const bad of forbidden) {
      expect(names).not.toContain(bad);
    }
  });
});

describe('executeTool: hard-deny', () => {
  it('неизвестное имя инструмента -> denied (handler не вызывается)', async () => {
    const res = await executeTool('record_payment', '{"amount":100}', baseCtx);
    expect(res.outcome).toBe('denied');
    expect(res.result).toBeUndefined();
  });

  it('денежное/мутирующее имя -> denied', async () => {
    for (const name of ['purchase_subscription', 'set_order_status', 'create_order']) {
      const res = await executeTool(name, '{}', baseCtx);
      expect(res.outcome).toBe('denied');
    }
  });
});

describe('executeTool: handoff_to_operator', () => {
  it('доступен без orderingEnabled и возвращает escalate=true', async () => {
    config.ai.orderingEnabled = false;

    const res = await executeTool(
      'handoff_to_operator',
      '{"reason":"custom_service","message":"Подключу сотрудника, он уточнит детали."}',
      baseCtx,
    );

    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({
      escalate: true,
      reason: 'custom_service',
      message: 'Подключу сотрудника, он уточнит детали.',
    });
  });
});

describe('executeTool: rejected_schema', () => {
  it('битый JSON -> rejected_schema', async () => {
    const res = await executeTool('calculate_price', '{not valid json', baseCtx);
    expect(res.outcome).toBe('rejected_schema');
    expect(res.result).toBeUndefined();
  });

  it('аргументы не проходят Zod (нет обязательного categorySlug) -> rejected_schema', async () => {
    const res = await executeTool('calculate_price', '{"selectedOptions":[]}', baseCtx);
    expect(res.outcome).toBe('rejected_schema');
  });

  it('лишнее поле при strict-схеме -> rejected_schema', async () => {
    const res = await executeTool('list_pickup_points', '{"unexpected":true}', baseCtx);
    expect(res.outcome).toBe('rejected_schema');
  });

  it('неверный тип quantity -> rejected_schema', async () => {
    const res = await executeTool(
      'calculate_price',
      '{"categorySlug":"photo-docs","selectedOptions":[{"option_slug":"x","quantity":"two"}]}',
      baseCtx,
    );
    expect(res.outcome).toBe('rejected_schema');
  });
});

describe('calculate_price: ламинирование (категория lamination)', () => {
  it('laminate-a4 qty=1 -> 100 руб (валидные args проходят схему, результат pricing-engine проброшен)', async () => {
    // pricing-engine считает по реальному каталогу (после миграции lamination:
    // laminate-a4=100, laminate-a5=70). В юните он замокан -> возвращаем итог,
    // который вернёт БД, и проверяем, что executeTool пробрасывает его как есть.
    vi.mocked(calculatePrice).mockResolvedValue(pricedOk(100));

    const res = await executeTool(
      'calculate_price',
      '{"categorySlug":"lamination","selectedOptions":[{"option_slug":"laminate-a4","quantity":1}]}',
      baseCtx,
    );

    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ breakdown: { total: 100 }, validation: { valid: true } });
    // pricing-engine вызван с категорией lamination и опцией laminate-a4 qty 1.
    expect(calculatePrice).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'lamination',
        selectedOptions: [{ option_slug: 'laminate-a4', quantity: 1 }],
      }),
    );
  });

  it('laminate-a5 qty=1 -> 70 руб (опция меньшего формата)', async () => {
    vi.mocked(calculatePrice).mockResolvedValue(pricedOk(70));

    const res = await executeTool(
      'calculate_price',
      '{"categorySlug":"lamination","selectedOptions":[{"option_slug":"laminate-a5","quantity":1}]}',
      baseCtx,
    );

    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ breakdown: { total: 70 }, validation: { valid: true } });
    expect(calculatePrice).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'lamination',
        selectedOptions: [{ option_slug: 'laminate-a5', quantity: 1 }],
      }),
    );
  });
});

/** Полный summary льготы для happy-path (форма student-discount.service). */
const activeStudentSummary = {
  status: 'active' as const,
  source_token: 'education_verified',
  activated_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2026-12-31T00:00:00.000Z',
  print_sheets_limit: 100,
  print_sheets_used: 10,
  print_sheets_remaining: 90,
  print_sheet_price: 5,
  max_print_fill_percent: 100,
  photo_limit: 100,
  photo_used: 0,
  photo_remaining: 100,
  allowance_period_id: 'ap-1',
  allowance_period_start: '2026-01-01T00:00:00.000Z',
  allowance_period_end: '2026-01-31T00:00:00.000Z',
  binding_limit: 1,
  binding_uses: 0,
  binding_remaining: 1,
};

/**
 * Строка resolveIdentity (форма IdentityRow) для контакта, верифицированного НА
 * КАНАЛЕ ТЕКУЩЕГО сообщения. resolveIdentity фильтрует verified-запись по каналу
 * (cu.channel = $2), поэтому verified:true возвращается только если запрос ходит
 * по тому же каналу, где есть channel_users.verified_at.
 */
function verifiedIdentityRow(phone: string | null, userId: string | null) {
  return {
    contact_phone: phone,
    contact_user_id: userId,
    verified_phone: phone,
    verified_user_id: userId,
    verified: true,
  };
}

/**
 * Строка resolveIdentity для контакта БЕЗ verified-записи на канале текущего
 * сообщения (нет channel_users.verified_at для cu.channel = ctx.channel). Это и
 * случай «вообще не верифицирован», и случай «verified только на ЧУЖОМ канале»
 * (для запроса с другого канала verified-строка LATERAL не подберётся).
 */
function unverifiedIdentityRow(phone: string | null, userId: string | null) {
  return {
    contact_phone: phone,
    contact_user_id: userId,
    verified_phone: null,
    verified_user_id: null,
    verified: false,
  };
}

describe('get_student_discount: identity из БД + verified-gate', () => {
  it('игнорирует phone из аргументов модели; телефон берётся из БД по contactId', async () => {
    // ctx.channel задан -> resolveChannel не ходит в БД; resolveIdentity ->
    // верифицированный на этом канале контакт с телефоном из channel_users.
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow('+79011234567', null));
    vi.mocked(getStudentDiscountForPhone).mockResolvedValue(activeStudentSummary);
    const ctx = { ...baseCtx, channel: 'telegram' as const };

    // Модель пытается подсунуть чужой телефон -> strict-схема отвергает аргументы.
    const res = await executeTool('get_student_discount', '{"phone":"+79990000000"}', ctx);
    expect(res.outcome).toBe('rejected_schema');

    // С пустыми аргументами телефон приходит ИЗ БД, чужой номер недостижим.
    const ok = await executeTool('get_student_discount', '{}', ctx);
    expect(ok.outcome).toBe('executed');
    expect(getStudentDiscountForPhone).toHaveBeenCalledTimes(1);
    expect(getStudentDiscountForPhone).toHaveBeenCalledWith('+79011234567');
    expect(getStudentDiscountForPhone).not.toHaveBeenCalledWith('+79990000000');
    // ctx.phone (аргумент конструктора baseCtx) совпадает с БД-телефоном, но
    // источник истины именно БД: ctx.phone не передаётся в сервис напрямую.
    expect(ok.result).toMatchObject({ eligible: true, print_sheets_remaining: 90 });
  });

  it('верифицированный контакт без телефона в БД -> eligible:false, сервис не вызывается', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow(null, null));
    const res = await executeTool('get_student_discount', '{}', { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ eligible: false });
    expect(getStudentDiscountForPhone).not.toHaveBeenCalled();
  });

  it('НЕверифицированный контакт на слабом канале (vk) -> need_verification, сервис не вызывается', async () => {
    // ctx.channel='vk' -> resolveChannel не ходит в БД; resolveIdentity: на vk
    // нет verified-записи -> need_verification.
    vi.mocked(db.queryOne).mockResolvedValueOnce(unverifiedIdentityRow('+79011234567', 'user-1'));
    const res = await executeTool('get_student_discount', '{}', { ...baseCtx, channel: 'vk' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ need_verification: true });
    expect(getStudentDiscountForPhone).not.toHaveBeenCalled();
  });

  it('НЕверифицированный контакт на крипто-канале (telegram) -> данные отдаются', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(unverifiedIdentityRow('+79011234567', null));
    vi.mocked(getStudentDiscountForPhone).mockResolvedValue(activeStudentSummary);
    const res = await executeTool('get_student_discount', '{}', { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ eligible: true, print_sheets_remaining: 90 });
    expect(getStudentDiscountForPhone).toHaveBeenCalledWith('+79011234567');
  });

  it('P1-1: verified ТОЛЬКО на чужом канале (telegram), запрос с max -> need_verification (нет кросс-канальной утечки)', async () => {
    // Атака: у контакта есть verified-запись на telegram (телефон жертвы), но
    // сообщение пришло с max (слабый канал, склейка по shared-телефону). При
    // channel='max' LATERAL ищет verified-запись с cu.channel='max' и НЕ находит
    // (verified-telegram отфильтрована) -> resolveIdentity.verified=false ->
    // слабый канал -> gate. ПДн жертвы не выдаются.
    vi.mocked(db.queryOne).mockResolvedValueOnce(unverifiedIdentityRow('+79011111111', 'victim-user'));
    const res = await executeTool('get_student_discount', '{}', { ...baseCtx, channel: 'max' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ need_verification: true });
    expect(getStudentDiscountForPhone).not.toHaveBeenCalled();
  });

  it('verified на ТОМ ЖЕ канале (max) -> данные отдаются (verified-gate по каналу хода)', async () => {
    // Контрапункт к P1-1: если verified-запись есть ИМЕННО на канале текущего
    // сообщения (max), LATERAL её подберёт -> verified=true -> ПДн отдаются даже
    // на слабом канале (верификация именно здесь и есть основание доверия).
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow('+79011234567', null));
    vi.mocked(getStudentDiscountForPhone).mockResolvedValue(activeStudentSummary);
    const res = await executeTool('get_student_discount', '{}', { ...baseCtx, channel: 'max' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ eligible: true, print_sheets_remaining: 90 });
    expect(getStudentDiscountForPhone).toHaveBeenCalledWith('+79011234567');
  });
});

describe('check_subscription: identity из БД + verified-gate', () => {
  it('верифицированный контакт: предпочитает userId из БД, не принимает аргументы', async () => {
    // ctx.channel задан -> resolveChannel не ходит в БД; единственный queryOne -
    // resolveIdentity (verified на этом канале).
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow('+79011234567', 'user-db'));
    vi.mocked(checkSubscriptionByUserId).mockResolvedValue({
      plan_name: 'Доки PRO',
      plan_category: 'doc-print',
      status: 'active',
      monthly_price: 199,
      current_period_end: '2026-12-31T00:00:00.000Z',
    } as never);

    const res = await executeTool('check_subscription', '{}', { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('executed');
    // userId берётся ИЗ БД ('user-db'), а не из ctx.userId ('user-1').
    expect(checkSubscriptionByUserId).toHaveBeenCalledWith('user-db');
    expect(checkSubscription).not.toHaveBeenCalled();
    expect(res.result).toMatchObject({ active: true, plan_name: 'Доки PRO' });
  });

  it('НЕверифицированный контакт на слабом канале (max) -> need_verification', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(unverifiedIdentityRow('+79011234567', 'user-1'));
    const res = await executeTool('check_subscription', '{}', { ...baseCtx, channel: 'max' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ need_verification: true });
    expect(checkSubscriptionByUserId).not.toHaveBeenCalled();
    expect(checkSubscription).not.toHaveBeenCalled();
  });

  it('ctx.channel не задан -> канал резолвится из conversations; web (слабый) -> need_verification', async () => {
    // Порядок запросов: 1) resolveChannel (SELECT channel FROM conversations -> web,
    // т.к. ctx.channel не задан); 2) resolveIdentity по каналу web -> не верифиц.
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ channel: 'web' })
      .mockResolvedValueOnce(unverifiedIdentityRow('+79011234567', 'user-1'));
    const res = await executeTool('check_subscription', '{}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ need_verification: true });
    expect(checkSubscriptionByUserId).not.toHaveBeenCalled();
  });

  it('без contactId -> need_verification (БД для identity не трогается)', async () => {
    // Порядок: 1) resolveChannel (ctx.channel не задан) делает ОДИН запрос канала;
    // 2) resolveIdentity при contactId=null сразу возвращает unverified БЕЗ запроса.
    vi.mocked(db.queryOne).mockResolvedValueOnce({ channel: 'telegram' });
    const res = await executeTool('check_subscription', '{}', { ...baseCtx, contactId: null });
    expect(res.outcome).toBe('executed');
    // На крипто-канале неверифицированный контакт без contactId -> identity пустая,
    // данных нет: telegram пускает, но userId/phone null -> active:false.
    expect(res.result).toEqual({ active: false });
  });
});

describe('get_order_status: скоуп строго по ctx.contactId', () => {
  it('без contactId -> единое "не найдено", БД не трогается', async () => {
    const res = await executeTool('get_order_status', '{"orderId":"SF-123"}', {
      ...baseCtx,
      contactId: null,
    });
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ found: false });
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it('заказ чужого контакта -> "не найдено" (found:false)', async () => {
    // 1) резолв телефона контакта; 2) заказ по телефону не нашёлся (чужой).
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ phone: '+79011234567' })
      .mockResolvedValueOnce(null);

    const res = await executeTool('get_order_status', '{"orderId":"SF-999"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ found: false });
  });

  it('свой заказ -> отдаёт статус', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ phone: '+79011234567' })
      .mockResolvedValueOnce({
        order_id: 'SF-123',
        status: 'processing',
        payment_status: 'paid',
        total_price: '300.00',
        created_at: '2026-06-01T10:00:00.000Z',
        estimated_ready_at: '2026-06-01T11:00:00.000Z',
      });

    const res = await executeTool('get_order_status', '{"orderId":"SF-123"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ found: true, order_id: 'SF-123', status: 'processing' });
  });

  it('pending-заказ с непривязанным оплаченным POS-чеком того же клиента -> эскалация вместо просьбы оплатить', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ phone: '+79011234567' })
      .mockResolvedValueOnce({
        order_id: 'SF-123',
        status: 'ready',
        payment_status: 'pending',
        total_price: '2100.00',
        created_at: '2026-06-25T08:20:00.000Z',
        estimated_ready_at: '2026-06-25T09:00:00.000Z',
      })
      .mockResolvedValueOnce({
        receipt_count: 2,
        total_paid: '3500.00',
        latest_receipt_at: '2026-06-25T08:25:59.000Z',
      });

    const res = await executeTool('get_order_status', '{"orderId":"SF-123"}', baseCtx);

    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({
      found: true,
      order_id: 'SF-123',
      payment_status: 'pending',
      effective_payment_status: 'requires_operator_check',
      escalate: true,
      reason: 'payment_requires_operator_check',
      possible_unlinked_pos_payment: {
        receipt_count: 2,
        total_paid: '3500.00',
      },
    });
  });
});

describe('get_my_bookings: скоуп строго по ctx.contactId', () => {
  it('без contactId -> bookings пустой, БД не трогается', async () => {
    const res = await executeTool('get_my_bookings', '{}', { ...baseCtx, contactId: null });
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ bookings: [] });
    expect(db.queryOne).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('контакт без user_id и телефона -> bookings пустой, записи не запрашиваются', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ user_id: null, phone: null });
    const res = await executeTool('get_my_bookings', '{}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ bookings: [] });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('отдаёт ближайшие записи клиента (услуга, время МСК, студия, статус)', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ user_id: 'user-9', phone: '+79188900890' });
    vi.mocked(db.query).mockResolvedValueOnce([
      {
        status: 'confirmed',
        service_name: 'Фото на документы',
        start_time: '2026-06-03T09:00:00.000Z',
        start_local: '03.06 12:00',
        studio_name: 'Своё Фото — Соборный',
        studio_address: 'ул. Соборный 21, Ростов-на-Дону',
      },
    ]);

    const res = await executeTool('get_my_bookings', '{}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({
      bookings: [
        {
          service_name: 'Фото на документы',
          start_time: '2026-06-03T09:00:00.000Z',
          start_local: '03.06 12:00',
          status: 'confirmed',
          studio_name: 'Своё Фото — Соборный',
          studio_address: 'ул. Соборный 21, Ростов-на-Дону',
        },
      ],
    });
    // Скоуп: и user_id контакта, и хвост его телефона переданы параметрами запроса.
    const queryArgs = vi.mocked(db.query).mock.calls[0];
    expect(queryArgs?.[1]).toEqual(['user-9', '9188900890']);
  });

  it('нет записей -> bookings пустой', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ user_id: 'user-9', phone: '+79188900890' });
    vi.mocked(db.query).mockResolvedValueOnce([]);
    const res = await executeTool('get_my_bookings', '{}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ bookings: [] });
  });
});

describe('executeTool: error', () => {
  it('исключение внутри handler -> outcome error', async () => {
    // Верифицированный контакт (гейт пропускает) -> доходим до сервиса, он падает.
    // ctx.channel задан -> единственный queryOne это resolveIdentity.
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow(null, 'user-1'));
    vi.mocked(checkSubscriptionByUserId).mockRejectedValue(new Error('db down'));
    const res = await executeTool('check_subscription', '{}', { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('error');
    expect(res.rejectedReason).toContain('db down');
  });
});

describe('list_pickup_points', () => {
  it('возвращает только открытую публичную точку самовывоза', async () => {
    const res = await executeTool('list_pickup_points', '{}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(isPickupPointsToolResult(res.result)).toBe(true);
    if (!isPickupPointsToolResult(res.result)) throw new Error('Expected pickup points result');
    const result = res.result;
    const addresses = result.pickup_points.map(p => p.address);
    expect(addresses).toContain('Соборный 21');
    expect(addresses).not.toContain('2-я Баррикадная 4');
  });

  it('историческую точку Баррикадной из БД не отдаёт клиенту', async () => {
    vi.mocked(getStudiosEffectiveStatus).mockResolvedValueOnce(STUDIOS_WITH_HISTORICAL_BARRIKADNAYA);
    const res = await executeTool('list_pickup_points', '{}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(isPickupPointsToolResult(res.result)).toBe(true);
    if (!isPickupPointsToolResult(res.result)) throw new Error('Expected pickup points result');
    const result = res.result;
    const addresses = result.pickup_points.map(p => p.address);
    expect(addresses).toContain('Соборный 21');
    expect(addresses).not.toContain('2-я Баррикадная 4');
    expect(result.temporarily_closed).toBeUndefined();
  });
});

describe('get_service_catalog: happy-path', () => {
  /** Минимальная категория в форме pricing-engine (optionGroups в camelCase). */
  const sampleCategory = {
    slug: 'photo-docs',
    name: 'Документы',
    description: 'Фото на документы',
    price_range: { min: 200, max: 500 },
    valid_delivery_methods: ['pickup'],
    optionGroups: [
      {
        slug: 'doc-type',
        name: 'Тип документа',
        selection_type: 'single',
        is_required: true,
        options: [
          {
            slug: 'passport-rf',
            name: 'Паспорт РФ',
            description: null,
            base_price: 300,
            price_online: 300,
            price_studio: 350,
            popular: true,
          },
        ],
      },
    ],
  };

  const polygraphyCategory = {
    ...sampleCategory,
    slug: 'polygraphy',
    name: 'Визитки и полиграфия',
    description: 'Визитки, листовки и другая полиграфия',
    ai_aliases: ['business-cards', 'business cards', 'визитки'],
    optionGroups: [
      {
        slug: 'polygraphy-items',
        name: 'Визитки и полиграфия',
        selection_type: 'single',
        is_required: true,
        options: [
          {
            slug: 'km-визитки-бумага-100-шт',
            name: 'Визитки (бумага) 100 шт.',
            description: null,
            base_price: 600,
            price_online: null,
            price_studio: 600,
            popular: false,
          },
        ],
      },
    ],
  };

  it('без аргументов возвращает каталог с нужными полями (getCategories)', async () => {
    vi.mocked(getCategories).mockResolvedValue([sampleCategory] as never);

    const res = await executeTool('get_service_catalog', '{}', baseCtx);

    expect(res.outcome).toBe('executed');
    expect(getCategories).toHaveBeenCalledTimes(1);
    expect(getCategoryBySlug).not.toHaveBeenCalled();

    expect(isCatalogToolResult(res.result)).toBe(true);
    if (!isCatalogToolResult(res.result)) throw new Error('Expected catalog result');
    const result = res.result;
    expect(result.categories[0].slug).toBe('photo-docs');
    // optionGroups -> option_groups (snake_case в выдаче для модели).
    expect(result.categories[0].option_groups[0].slug).toBe('doc-type');
    expect(result.categories[0].option_groups[0].options[0].base_price).toBe(300);
  });

  it('с categorySlug зовёт getCategoryBySlug, не getCategories', async () => {
    vi.mocked(getCategoryBySlug).mockResolvedValue(sampleCategory as never);

    const res = await executeTool('get_service_catalog', '{"categorySlug":"photo-docs"}', baseCtx);

    expect(res.outcome).toBe('executed');
    expect(getCategoryBySlug).toHaveBeenCalledWith('photo-docs');
    expect(getCategories).not.toHaveBeenCalled();

    expect(isCatalogToolResult(res.result)).toBe(true);
    if (!isCatalogToolResult(res.result)) throw new Error('Expected catalog result');
    const result = res.result;
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].slug).toBe('photo-docs');
  });

  it('пустой categorySlug от модели трактует как весь каталог, а не rejected_schema', async () => {
    vi.mocked(getCategories).mockResolvedValue([sampleCategory] as never);

    const res = await executeTool('get_service_catalog', '{"categorySlug":""}', baseCtx);

    expect(res.outcome).toBe('executed');
    expect(getCategories).toHaveBeenCalledTimes(1);
    expect(getCategoryBySlug).not.toHaveBeenCalled();
    expect(isCatalogToolResult(res.result)).toBe(true);
    if (!isCatalogToolResult(res.result)) throw new Error('Expected catalog result');
    expect(res.result.categories[0].slug).toBe('photo-docs');
  });

  it('человеческий/угаданный slug business-cards находит категорию визиток из БД-алиасов', async () => {
    vi.mocked(getCategoryBySlug).mockResolvedValue(null);
    vi.mocked(getCategories).mockResolvedValue([sampleCategory, polygraphyCategory] as never);

    const res = await executeTool('get_service_catalog', '{"categorySlug":"business-cards"}', baseCtx);

    expect(res.outcome).toBe('executed');
    expect(getCategoryBySlug).toHaveBeenCalledWith('business-cards');
    expect(getCategories).toHaveBeenCalledTimes(1);
    expect(isCatalogToolResult(res.result)).toBe(true);
    if (!isCatalogToolResult(res.result)) throw new Error('Expected catalog result');
    expect(res.result.categories).toHaveLength(1);
    expect(res.result.categories[0].slug).toBe('polygraphy');
  });

  it('photo-docs явно размечает базовую услугу и ретушь как отдельную доплату', async () => {
    vi.mocked(getCategoryBySlug).mockResolvedValue({
      ...sampleCategory,
      optionGroups: [
        {
          slug: 'document-type',
          name: 'Тип документа',
          selection_type: 'single',
          is_required: true,
          options: [
            {
              slug: 'passport-rf',
              name: 'Паспорт РФ',
              description: null,
              base_price: 700,
              price_online: 700,
              price_studio: 700,
              popular: true,
            },
          ],
        },
        {
          slug: 'processing-level',
          name: 'Ретушь и обработка',
          selection_type: 'single',
          is_required: false,
          options: [
            {
              slug: 'processing-extended',
              name: 'Расширенная обработка',
              description: null,
              base_price: 950,
              price_online: 950,
              price_studio: 950,
              popular: true,
            },
          ],
        },
      ],
    } as never);

    const res = await executeTool('get_service_catalog', '{"categorySlug":"photo-docs"}', baseCtx);

    expect(res.outcome).toBe('executed');
    expect(isCatalogToolResult(res.result)).toBe(true);
    if (!isCatalogToolResult(res.result)) throw new Error('Expected catalog result');
    const category = res.result.categories[0];
    expect(category.pricing_guidance).toMatchObject({
      model: 'base_service_plus_addons',
      total_price_source: 'calculate_price',
      total_requires_calculate_price: true,
    });
    expect(category.pricing_guidance?.rules).toContain('Ретушь, обработка, срочность и дополнительные услуги прибавляются к базовой услуге; цена такой опции не является итоговой ценой.');
    expect(category.pricing_guidance?.included).toContain('электронный вид фотографии');
    expect(category.pricing_guidance?.examples).toContainEqual({
      label: 'Паспорт РФ с расширенной обработкой',
      selected_options: ['passport-rf', 'processing-extended'],
      formula: '700 + 950',
      total: 1650,
    });

    const documentType = findCatalogGroup(category, 'document-type');
    const passport = findCatalogOption(documentType, 'passport-rf');
    expect(documentType).toMatchObject({
      pricing_role: 'base_service',
      price_behavior: 'base_price_starts_total',
    });
    expect(passport).toMatchObject({
      pricing_role: 'base_service',
      price_behavior: 'base_price_starts_total',
    });

    const processing = findCatalogGroup(category, 'processing-level');
    const extended = findCatalogOption(processing, 'processing-extended');
    expect(processing).toMatchObject({
      pricing_role: 'addon',
      price_behavior: 'price_adds_to_base_total',
    });
    expect(extended).toMatchObject({
      pricing_role: 'addon',
      price_behavior: 'price_adds_to_base_total',
      pricing_note: 'Доплата к базовой услуге; не самостоятельная итоговая цена.',
    });
  });

  it('portrait объясняет, что ретушь прибавляется к базовым 900 рублям', async () => {
    vi.mocked(getCategoryBySlug).mockResolvedValue({
      ...sampleCategory,
      slug: 'portrait',
      name: 'Портретная съёмка',
      description: 'Портретное фото',
      optionGroups: [
        {
          slug: 'portrait-processing',
          name: 'Портрет',
          selection_type: 'quantity',
          is_required: true,
          options: [
            {
              slug: 'portrait-photo',
              name: 'Понравившаяся фотография',
              description: null,
              base_price: 900,
              price_online: 900,
              price_studio: 900,
              popular: true,
            },
          ],
        },
        {
          slug: 'processing-level',
          name: 'Ретушь',
          selection_type: 'single',
          is_required: false,
          options: [
            {
              slug: 'processing-extended',
              name: 'Расширенная обработка',
              description: null,
              base_price: 950,
              price_online: 950,
              price_studio: 950,
              popular: true,
            },
          ],
        },
      ],
    } as never);

    const res = await executeTool('get_service_catalog', '{"categorySlug":"portrait"}', baseCtx);

    expect(res.outcome).toBe('executed');
    expect(isCatalogToolResult(res.result)).toBe(true);
    if (!isCatalogToolResult(res.result)) throw new Error('Expected catalog result');
    const category = res.result.categories[0];
    expect(category.pricing_guidance?.included).toEqual(expect.arrayContaining([
      'бесплатная фотосессия',
      'выбор понравившегося кадра',
      'кадрирование',
      'электронный вид фотографии',
    ]));
    expect(category.pricing_guidance?.examples).toContainEqual({
      label: 'Портрет с расширенной обработкой',
      selected_options: ['portrait-photo', 'processing-extended'],
      formula: '900 + 950',
      total: 1850,
    });

    const portraitProcessing = findCatalogGroup(category, 'portrait-processing');
    const portraitPhoto = findCatalogOption(portraitProcessing, 'portrait-photo');
    expect(portraitPhoto).toMatchObject({
      pricing_role: 'base_service',
      price_behavior: 'base_price_starts_total',
    });

    const retouch = findCatalogGroup(category, 'processing-level');
    expect(retouch).toMatchObject({
      pricing_role: 'addon',
      price_behavior: 'price_adds_to_base_total',
    });
  });
});

describe('validate_selection: happy-path', () => {
  it('пробрасывает categorySlug и selectedOptions в validateSelection', async () => {
    vi.mocked(validateSelection).mockResolvedValue({ valid: true, errors: [] } as never);

    const res = await executeTool(
      'validate_selection',
      '{"categorySlug":"photo-docs","selectedOptions":["passport-rf"]}',
      baseCtx,
    );

    expect(res.outcome).toBe('executed');
    expect(validateSelection).toHaveBeenCalledWith({
      categorySlug: 'photo-docs',
      selectedOptions: ['passport-rf'],
    });
    expect(res.result).toMatchObject({ valid: true });
  });
});

// ============================================================================
// Этап 3: оформление + ссылка на оплату
// ============================================================================

/** Результат calculatePrice (форма pricing-engine) с заданным total. */
function pricedOk(total: number) {
  return {
    breakdown: {
      base_items: [{ option_slug: 'passport-rf', name: 'Паспорт РФ', unit_price: total, quantity: 1, subtotal: total }],
      subtotal: total,
      promo_discount: null,
      loyalty_discount: null,
      total,
      savings: 0,
    },
    product_ids: [],
    validation: { valid: true, warnings: [], errors: [] },
  };
}

interface ConfirmationDraftPayloadFixture {
  draft_ref: string;
  kind: string;
  validated_args: unknown;
  description: string;
  payment_url?: string;
}

interface ConfirmationRowFixture {
  id: string;
  action_type: string;
  draft_payload: ConfirmationDraftPayloadFixture;
  quoted_total: number;
  status: string;
  confirm_token: string;
  expires_at: string;
}

/** Строка ai_agent_confirmations (форма ConfirmationRow). */
function confirmationRow(over: Partial<ConfirmationRowFixture> = {}): ConfirmationRowFixture {
  return {
    id: 'cf-1',
    action_type: 'print_order_draft',
    draft_payload: { draft_ref: 'chat-conv-1-1001', kind: 'print_order_draft', validated_args: {}, description: 'Заказ: Документы' },
    quoted_total: 300,
    status: 'pending',
    confirm_token: 'tok',
    expires_at: '2026-06-04T00:00:00.000Z',
    ...over,
  };
}

const printArgs = JSON.stringify({
  categorySlug: 'photo-docs',
  selectedOptions: [{ option_slug: 'passport-rf', quantity: 1 }],
  deliveryMethod: 'pickup',
  studio: 'soborny',
});

describe('Этап 3: gate по orderingEnabled', () => {
  it('write-draft при orderingEnabled=false -> denied (handler не вызывается)', async () => {
    config.ai.orderingEnabled = false;
    for (const name of ['create_print_order_draft', 'create_subscription_draft', 'request_payment_link', 'create_booking_draft', 'create_retouch_draft']) {
      const res = await executeTool(name, '{}', baseCtx);
      expect(res.outcome).toBe('denied');
      expect(res.result).toBeUndefined();
    }
    // Сервисы оформления не дёрнулись.
    expect(calculatePrice).not.toHaveBeenCalled();
    expect(handleFinalizeOrder).not.toHaveBeenCalled();
    expect(initSubscription).not.toHaveBeenCalled();
    expect(generateChatPaymentUrl).not.toHaveBeenCalled();
  });
});

describe('create_print_order_draft', () => {
  beforeEach(() => {
    config.ai.orderingEnabled = true;
  });

  it('pickup без studio -> reject (точка студии обязательна, заказ не создаётся)', async () => {
    const res = await executeTool(
      'create_print_order_draft',
      JSON.stringify({
        categorySlug: 'photo-docs',
        selectedOptions: [{ option_slug: 'passport-rf', quantity: 1 }],
        deliveryMethod: 'pickup',
      }),
      baseCtx,
    );
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: false, need: 'studio' });
    expect(calculatePrice).not.toHaveBeenCalled();
    expect(handleFinalizeOrder).not.toHaveBeenCalled();
  });

  it('самовывоз в закрытую историческую точку -> rejected_schema (заказ не считается)', async () => {
    const res = await executeTool(
      'create_print_order_draft',
      JSON.stringify({
        categorySlug: 'photo-docs',
        selectedOptions: [{ option_slug: 'passport-rf', quantity: 1 }],
        deliveryMethod: 'pickup',
        studio: 'barrikadnaya',
      }),
      baseCtx,
    );
    expect(res.outcome).toBe('rejected_schema');
    expect(calculatePrice).not.toHaveBeenCalled();
    expect(handleFinalizeOrder).not.toHaveBeenCalled();
  });

  it('сумма берётся из СЕРВЕРА (calculatePrice), не из аргументов модели', async () => {
    vi.mocked(calculatePrice).mockResolvedValue(pricedOk(300) as never);
    vi.mocked(getCategoryBySlug).mockResolvedValue({ name: 'Документы' } as never);
    vi.mocked(handleFinalizeOrder).mockResolvedValue({ content: 'ok' } as never);
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ phone: '+79011234567' }) // resolveContactPhone
      .mockResolvedValueOnce({ order_number: '1001' }); // conversations.metadata.orderNumber -> order_id
    mockTransaction({ existingRow: null, insertedRow: confirmationRow({ quoted_total: 300 }) });

    // Модель пытается подсунуть свою цену в аргументах: strict-схема её отвергает.
    const tampered = await executeTool(
      'create_print_order_draft',
      JSON.stringify({
        categorySlug: 'photo-docs',
        selectedOptions: [{ option_slug: 'passport-rf', quantity: 1 }],
        deliveryMethod: 'pickup',
        studio: 'soborny',
        price: 1, // лишнее поле
        total: 1,
      }),
      baseCtx,
    );
    expect(tampered.outcome).toBe('rejected_schema');

    // Честный вызов: сумма = из calculatePrice (300), не что-либо из модели.
    const res = await executeTool('create_print_order_draft', printArgs, baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, total: 300, draft_ref: 'chat-conv-1-1001' });

    // handleFinalizeOrder получил pendingOrder с СЕРВЕРНОЙ ценой 300.
    const finalizeArgs = vi.mocked(handleFinalizeOrder).mock.calls[0];
    expect(finalizeArgs[0]).toBe('conv-1');
    expect(finalizeArgs[1]).toMatchObject({ pickup: 'Соборный 21', production: 'Соборный 21' });
    expect(finalizeArgs[2]?.metadata?.pendingOrder).toMatchObject({ price: 300 });
    expect(finalizeArgs[2]?.visitor_phone).toBe('+79011234567');

    // Осадок оформления вычищается после успешного создания заказа (P2: иначе
    // web-обработчики могли бы провести дубль из залежавшегося pendingOrder).
    expect(removeMetadataKeys).toHaveBeenCalledWith('conv-1', ['pendingOrder', 'pendingDelivery', 'phoneAsked']);
  });

  it('серверная сумма выше порога maxAutoOrder -> escalate (заказ не создаётся)', async () => {
    config.ai.maxAutoOrder = 5000;
    vi.mocked(calculatePrice).mockResolvedValue(pricedOk(9000) as never);
    vi.mocked(getCategoryBySlug).mockResolvedValue({ name: 'Документы' } as never);

    const res = await executeTool('create_print_order_draft', printArgs, baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ escalate: true, reason: 'amount_over_threshold' });
    expect(handleFinalizeOrder).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('идемпотентность: повторный ход с теми же аргументами -> тот же draft, заказ повторно не создаётся', async () => {
    vi.mocked(calculatePrice).mockResolvedValue(pricedOk(300) as never);
    vi.mocked(getCategoryBySlug).mockResolvedValue({ name: 'Документы' } as never);
    // Транзакция находит уже существующую запись -> produce() не вызывается.
    mockTransaction({ existingRow: confirmationRow({ quoted_total: 300 }) });

    const res = await executeTool('create_print_order_draft', printArgs, baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, total: 300, already_created: true, draft_ref: 'chat-conv-1-1001' });

    // Реальный заказ повторно НЕ создавался (produce не выполнялся).
    expect(handleFinalizeOrder).not.toHaveBeenCalled();
    expect(mergeMetadata).not.toHaveBeenCalled();
  });

  it('некорректный состав (validation.valid=false) -> reject, заказ не создаётся', async () => {
    vi.mocked(calculatePrice).mockResolvedValue({
      breakdown: { base_items: [], subtotal: 0, promo_discount: null, loyalty_discount: null, total: 0, savings: 0 },
      product_ids: [],
      validation: { valid: false, warnings: [], errors: ['нет типа документа'] },
    } as never);

    const res = await executeTool('create_print_order_draft', printArgs, baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: false, reason: 'invalid_selection' });
    expect(handleFinalizeOrder).not.toHaveBeenCalled();
  });

  it('P1: deliveryMethod=electronic (без studio) -> черновик создаётся, delivery=онлайн', async () => {
    vi.mocked(calculatePrice).mockResolvedValue(pricedOk(200) as never);
    vi.mocked(getCategoryBySlug).mockResolvedValue({ name: 'Документы' } as never);
    vi.mocked(handleFinalizeOrder).mockResolvedValue({ content: 'ok' } as never);
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ phone: '+79011234567' }) // resolveContactPhone
      .mockResolvedValueOnce({ order_number: '1002' }); // orderNumber из metadata
    mockTransaction({
      existingRow: null,
      insertedRow: confirmationRow({ quoted_total: 200, draft_payload: { draft_ref: 'chat-conv-1-1002', kind: 'print_order_draft', validated_args: {}, description: 'Заказ: Документы' } }),
    });

    const res = await executeTool(
      'create_print_order_draft',
      JSON.stringify({ categorySlug: 'photo-docs', selectedOptions: [{ option_slug: 'passport-rf', quantity: 1 }], deliveryMethod: 'electronic' }),
      baseCtx,
    );
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, total: 200, draft_ref: 'chat-conv-1-1002', delivery_method: 'electronic' });
    // Без studio: delivery = онлайн/электронный вид (studio-гейт не применяется).
    const deliveryArg = vi.mocked(handleFinalizeOrder).mock.calls[0][1];
    expect(deliveryArg).toMatchObject({ pickup: 'Электронный вид (без печати)', production: 'Онлайн' });
  });

  it('P1: deliveryMethod=postal (без studio) -> черновик создаётся, delivery=онлайн (studio-гейт не для postal)', async () => {
    vi.mocked(calculatePrice).mockResolvedValue(pricedOk(250) as never);
    vi.mocked(getCategoryBySlug).mockResolvedValue({ name: 'Документы' } as never);
    vi.mocked(handleFinalizeOrder).mockResolvedValue({ content: 'ok' } as never);
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ phone: '+79011234567' })
      .mockResolvedValueOnce({ order_number: '1003' });
    mockTransaction({
      existingRow: null,
      insertedRow: confirmationRow({ quoted_total: 250, draft_payload: { draft_ref: 'chat-conv-1-1003', kind: 'print_order_draft', validated_args: {}, description: 'Заказ: Документы' } }),
    });

    const res = await executeTool(
      'create_print_order_draft',
      JSON.stringify({ categorySlug: 'photo-docs', selectedOptions: [{ option_slug: 'passport-rf', quantity: 1 }], deliveryMethod: 'postal' }),
      baseCtx,
    );
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, total: 250, draft_ref: 'chat-conv-1-1003', delivery_method: 'postal' });
    // postal без studio проходит (гейт studio только для pickup); delivery = онлайн-форма.
    const deliveryArg = vi.mocked(handleFinalizeOrder).mock.calls[0][1];
    expect(deliveryArg).toMatchObject({ pickup: 'Электронный вид (без печати)', production: 'Онлайн' });
    expect(handleFinalizeOrder).toHaveBeenCalledTimes(1);
  });
});

describe('create_subscription_draft', () => {
  beforeEach(() => {
    config.ai.orderingEnabled = true;
  });

  const planRow = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Доки PRO',
    category: 'doc-print',
    base_price: 199,
    min_price: null,
    billing_period: 'monthly',
    is_active: true,
  };
  const planArgs = JSON.stringify({ plan_id: planRow.id });

  it('неверифицированный клиент на слабом канале -> need_verification, подписка не создаётся', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(unverifiedIdentityRow('+79011234567', 'user-1'));
    const res = await executeTool('create_subscription_draft', planArgs, { ...baseCtx, channel: 'vk' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toEqual({ need_verification: true });
    expect(getPlanById).not.toHaveBeenCalled();
    expect(initSubscription).not.toHaveBeenCalled();
  });

  it('monthly_price берётся из ПЛАНА (server), не из аргументов модели', async () => {
    vi.mocked(getPlanById).mockResolvedValue(planRow as never);
    vi.mocked(initSubscription).mockResolvedValue({ id: 'sub-1' } as never);
    mockTransaction({
      existingRow: null,
      insertedRow: confirmationRow({ action_type: 'subscription_draft', quoted_total: 199, draft_payload: { draft_ref: 'sub-1', kind: 'subscription_draft', validated_args: {}, description: 'Подписка: Доки PRO' } }),
    });

    // Модель пытается подсунуть monthly_price -> strict-схема отвергает ДО БД.
    const tampered = await executeTool(
      'create_subscription_draft',
      JSON.stringify({ plan_id: planRow.id, monthly_price: 1 }),
      { ...baseCtx, channel: 'telegram' },
    );
    expect(tampered.outcome).toBe('rejected_schema');

    // Честный вызов: verified на telegram -> гейт пропускает, identity из БД.
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow('+79011234567', 'user-db'));
    const res = await executeTool('create_subscription_draft', planArgs, { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, draft_ref: 'sub-1', monthly_price: 199, plan_name: 'Доки PRO' });

    // initSubscription вызван с ценой из плана (199), не из модели.
    expect(initSubscription).toHaveBeenCalledTimes(1);
    expect(vi.mocked(initSubscription).mock.calls[0][0]).toMatchObject({
      plan_id: planRow.id,
      monthly_price: 199,
      phone: '+79011234567',
    });
  });

  it('цена плана выше порога -> escalate, подписка не создаётся', async () => {
    config.ai.maxAutoOrder = 100;
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow('+79011234567', 'user-db'));
    vi.mocked(getPlanById).mockResolvedValue(planRow as never); // 199 > 100

    const res = await executeTool('create_subscription_draft', planArgs, { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ escalate: true, reason: 'amount_over_threshold' });
    expect(initSubscription).not.toHaveBeenCalled();
  });

  it('план не найден -> reject', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow('+79011234567', 'user-db'));
    vi.mocked(getPlanById).mockResolvedValue(null);
    const res = await executeTool('create_subscription_draft', planArgs, { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: false, reason: 'plan_not_found' });
    expect(initSubscription).not.toHaveBeenCalled();
  });

  it('P1: повтор -> тот же черновик, initSubscription повторно НЕ вызывается (нет двойной pending-подписки)', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow('+79011234567', 'user-db'));
    vi.mocked(getPlanById).mockResolvedValue(planRow as never);
    // Транзакция находит уже существующую запись подтверждения -> produce() не выполнится.
    mockTransaction({
      existingRow: confirmationRow({
        action_type: 'subscription_draft',
        quoted_total: 199,
        draft_payload: { draft_ref: 'sub-1', kind: 'subscription_draft', validated_args: {}, description: 'Подписка: Доки PRO' },
      }),
    });

    const res = await executeTool('create_subscription_draft', planArgs, { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, already_created: true, draft_ref: 'sub-1', monthly_price: 199 });
    // initSubscription НЕ вызывался повторно: второй черновик подписки не создаётся.
    expect(initSubscription).not.toHaveBeenCalled();
  });

  it('P1: verified без userId (только phone) -> подписка оформляется по телефону (user_id undefined)', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(verifiedIdentityRow('+79011234567', null)); // userId=null
    vi.mocked(getPlanById).mockResolvedValue(planRow as never);
    vi.mocked(initSubscription).mockResolvedValue({ id: 'sub-phone' } as never);
    mockTransaction({
      existingRow: null,
      insertedRow: confirmationRow({
        action_type: 'subscription_draft',
        quoted_total: 199,
        draft_payload: { draft_ref: 'sub-phone', kind: 'subscription_draft', validated_args: {}, description: 'Подписка: Доки PRO' },
      }),
    });

    const res = await executeTool('create_subscription_draft', planArgs, { ...baseCtx, channel: 'telegram' });
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, draft_ref: 'sub-phone' });
    // initSubscription вызван с user_id undefined и телефоном из БД (ветка «контакт без аккаунта»).
    expect(initSubscription).toHaveBeenCalledTimes(1);
    expect(vi.mocked(initSubscription).mock.calls[0][0]).toMatchObject({
      user_id: undefined,
      phone: '+79011234567',
      plan_id: planRow.id,
      monthly_price: 199,
    });
  });
});

describe('create_booking_draft / create_retouch_draft: эскалация на оператора', () => {
  beforeEach(() => {
    config.ai.orderingEnabled = true;
  });

  it('create_booking_draft -> escalate (бот запись сам не подтверждает, без side-effect)', async () => {
    const res = await executeTool('create_booking_draft', '{}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ escalate: true, reason: 'booking_requires_operator' });
    // Никаких записей/транзакций: бот ничего не оформил.
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('create_booking_draft передаёт собранное пожелание (что/когда) оператору в details', async () => {
    const res = await executeTool(
      'create_booking_draft',
      JSON.stringify({ serviceName: 'Семейная съёмка', date: '2026-06-10', time: '15:00' }),
      baseCtx,
    );
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({
      escalate: true,
      reason: 'booking_requires_operator',
      details: { serviceName: 'Семейная съёмка', date: '2026-06-10', time: '15:00' },
    });
  });

  it('create_retouch_draft -> escalate (бот задачу ретушёру сам не запускает, без side-effect)', async () => {
    const res = await executeTool('create_retouch_draft', JSON.stringify({ retouchLevel: 'Максимальная' }), baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({
      escalate: true,
      reason: 'retouch_requires_operator',
      details: { retouchLevel: 'Максимальная' },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('лишнее поле в аргументах booking/retouch -> rejected_schema (strict)', async () => {
    const r1 = await executeTool('create_booking_draft', '{"unexpected":true}', baseCtx);
    expect(r1.outcome).toBe('rejected_schema');
    const r2 = await executeTool('create_retouch_draft', '{"x":1}', baseCtx);
    expect(r2.outcome).toBe('rejected_schema');
  });
});

describe('request_payment_link', () => {
  beforeEach(() => {
    config.ai.orderingEnabled = true;
  });

  it('сумма ссылки берётся из СЕРВЕРА (перечитан заказ), не из аргументов; ссылка через generateChatPaymentUrl', async () => {
    // 1) draft из ai_agent_confirmations; 2) перечитанный заказ photo_print_orders.
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(confirmationRow({ draft_payload: { draft_ref: 'chat-conv-1-1001', kind: 'print_order_draft', validated_args: {}, description: 'Заказ: Документы' } }) as never)
      .mockResolvedValueOnce({
        order_id: 'chat-conv-1-1001',
        total_price: '300.00',
        payment_status: 'pending',
        status: 'pending_payment',
        chat_session_id: 'conv-1',
      } as never);
    vi.mocked(generateChatPaymentUrl).mockReturnValue('https://svoefoto.ru/api/actions/pay/TOKEN');
    mockTransaction({
      existingRow: null,
      insertedRow: confirmationRow({ action_type: 'request_payment_link', quoted_total: 300, expires_at: '2026-06-04T00:00:00.000Z', draft_payload: { draft_ref: 'chat-conv-1-1001', kind: 'request_payment_link', validated_args: {}, description: 'Заказ: Документы', payment_url: 'https://svoefoto.ru/api/actions/pay/TOKEN' } }),
    });

    const res = await executeTool('request_payment_link', '{"draft_ref":"chat-conv-1-1001"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, payment_url: 'https://svoefoto.ru/api/actions/pay/TOKEN', amount: 300 });

    // generateChatPaymentUrl вызван с СЕРВЕРНОЙ суммой 300 (из total_price заказа).
    expect(generateChatPaymentUrl).toHaveBeenCalledTimes(1);
    const [orderId, amount] = vi.mocked(generateChatPaymentUrl).mock.calls[0];
    expect(orderId).toBe('chat-conv-1-1001');
    expect(amount).toBe(300);
  });

  it('подделка суммы в аргументах игнорируется (strict-схема), draft_ref обязателен', async () => {
    const res = await executeTool('request_payment_link', '{"draft_ref":"x","amount":1}', baseCtx);
    expect(res.outcome).toBe('rejected_schema');
    expect(generateChatPaymentUrl).not.toHaveBeenCalled();
  });

  it('идемпотентность: повтор -> та же ссылка, generateChatPaymentUrl повторно не зовётся', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(confirmationRow({ draft_payload: { draft_ref: 'chat-conv-1-1001', kind: 'print_order_draft', validated_args: {}, description: 'Заказ' } }) as never)
      .mockResolvedValueOnce({
        order_id: 'chat-conv-1-1001',
        total_price: '300.00',
        payment_status: 'pending',
        status: 'pending_payment',
        chat_session_id: 'conv-1',
      } as never);
    // Запись ссылки уже есть -> produce() не вызывается.
    mockTransaction({
      existingRow: confirmationRow({ action_type: 'request_payment_link', quoted_total: 300, draft_payload: { draft_ref: 'chat-conv-1-1001', kind: 'request_payment_link', validated_args: {}, description: 'Заказ', payment_url: 'https://svoefoto.ru/api/actions/pay/OLD' } }),
    });

    const res = await executeTool('request_payment_link', '{"draft_ref":"chat-conv-1-1001"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, payment_url: 'https://svoefoto.ru/api/actions/pay/OLD' });
    expect(generateChatPaymentUrl).not.toHaveBeenCalled();
  });

  it('черновик не найден -> reject, ссылка не выдаётся', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(null); // draft не найден
    const res = await executeTool('request_payment_link', '{"draft_ref":"nope"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: false, reason: 'draft_not_found' });
    expect(generateChatPaymentUrl).not.toHaveBeenCalled();
  });

  it('заказ уже оплачен -> reject (ссылку повторно не выдаём)', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(confirmationRow({ draft_payload: { draft_ref: 'chat-conv-1-1001', kind: 'print_order_draft', validated_args: {}, description: 'Заказ' } }) as never)
      .mockResolvedValueOnce({
        order_id: 'chat-conv-1-1001',
        total_price: '300.00',
        payment_status: 'paid',
        status: 'paid',
        chat_session_id: 'conv-1',
      } as never);
    const res = await executeTool('request_payment_link', '{"draft_ref":"chat-conv-1-1001"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: false, reason: 'already_paid' });
    expect(generateChatPaymentUrl).not.toHaveBeenCalled();
  });

  it('сумма заказа выше порога -> escalate', async () => {
    config.ai.maxAutoOrder = 100;
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(confirmationRow({ draft_payload: { draft_ref: 'chat-conv-1-1001', kind: 'print_order_draft', validated_args: {}, description: 'Заказ' } }) as never)
      .mockResolvedValueOnce({
        order_id: 'chat-conv-1-1001',
        total_price: '9000.00',
        payment_status: 'pending',
        status: 'pending_payment',
        chat_session_id: 'conv-1',
      } as never);
    const res = await executeTool('request_payment_link', '{"draft_ref":"chat-conv-1-1001"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ escalate: true, reason: 'amount_over_threshold' });
    expect(generateChatPaymentUrl).not.toHaveBeenCalled();
  });

  it('P0 (regression-guard): черновик из ЧУЖОГО диалога -> draft_not_found, ссылка не выдаётся', async () => {
    // recomputeDraftForPayment фильтрует черновик по conversation_id = ctx.conversationId.
    // draft_ref существует, но принадлежит другому диалогу -> WHERE не подбирает -> null.
    // Регрессия: модель не может оформить ссылку на чужой заказ (утечка суммы/InvoiceId).
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);
    const res = await executeTool('request_payment_link', '{"draft_ref":"chat-other-conv-1234"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: false, reason: 'draft_not_found' });
    expect(generateChatPaymentUrl).not.toHaveBeenCalled();
  });

  it('P1-1: подписка -> orderId ссылки несёт префикс SUB- (webhook /check распознаёт подписку)', async () => {
    // 1) draft subscription из ai_agent_confirmations; 2) user_subscriptions (pending).
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(confirmationRow({
        action_type: 'subscription_draft',
        draft_payload: { draft_ref: '22222222-2222-2222-2222-222222222222', kind: 'subscription_draft', validated_args: {}, description: 'Подписка: Доки PRO' },
      }) as never)
      .mockResolvedValueOnce({ id: '22222222-2222-2222-2222-222222222222', monthly_price: 199, status: 'pending', plan_name: 'Доки PRO' } as never);
    vi.mocked(generateChatPaymentUrl).mockReturnValue('https://svoefoto.ru/api/actions/pay/TOKEN');
    mockTransaction({
      existingRow: null,
      insertedRow: confirmationRow({
        action_type: 'request_payment_link',
        quoted_total: 199,
        draft_payload: { draft_ref: '22222222-2222-2222-2222-222222222222', kind: 'request_payment_link', validated_args: {}, description: 'Подписка: Доки PRO', payment_url: 'https://svoefoto.ru/api/actions/pay/TOKEN' },
      }),
    });

    const res = await executeTool('request_payment_link', '{"draft_ref":"22222222-2222-2222-2222-222222222222"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: true, payment_url: 'https://svoefoto.ru/api/actions/pay/TOKEN', amount: 199 });
    // КЛЮЧЕВОЕ: orderId, уходящий в InvoiceId виджета, = 'SUB-<uuid>' (без префикса
    // webhook вернул бы code 10 и подписку нельзя было бы оплатить).
    expect(generateChatPaymentUrl).toHaveBeenCalledTimes(1);
    const [orderId, amount] = vi.mocked(generateChatPaymentUrl).mock.calls[0];
    expect(orderId).toBe('SUB-22222222-2222-2222-2222-222222222222');
    expect(amount).toBe(199);
  });

  it('P1: подписка уже не pending (active) -> reject (not_pending), ссылка не выдаётся', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(confirmationRow({
        action_type: 'subscription_draft',
        draft_payload: { draft_ref: '22222222-2222-2222-2222-222222222222', kind: 'subscription_draft', validated_args: {}, description: 'Подписка: Доки PRO' },
      }) as never)
      .mockResolvedValueOnce({ id: '22222222-2222-2222-2222-222222222222', monthly_price: 199, status: 'active', plan_name: 'Доки PRO' } as never);
    const res = await executeTool('request_payment_link', '{"draft_ref":"22222222-2222-2222-2222-222222222222"}', baseCtx);
    expect(res.outcome).toBe('executed');
    expect(res.result).toMatchObject({ ok: false, reason: 'not_pending' });
    expect(generateChatPaymentUrl).not.toHaveBeenCalled();
  });
});

describe('hard-deny денежных целей (Этап 3 не открывает прямые платежи)', () => {
  it('даже при orderingEnabled=true прямые денежные имена -> denied', async () => {
    config.ai.orderingEnabled = true;
    for (const name of ['record_payment', 'pay_with_subscription', 'purchase_subscription', 'create_payment', 'set_order_status']) {
      const res = await executeTool(name, '{}', baseCtx);
      expect(res.outcome).toBe('denied');
      expect(res.result).toBeUndefined();
    }
  });
});

describe('getToolRiskClass (честный risk_class для аудита)', () => {
  it('write-draft инструменты -> write_draft (не read)', () => {
    expect(getToolRiskClass('create_print_order_draft')).toBe('write_draft');
    expect(getToolRiskClass('create_subscription_draft')).toBe('write_draft');
    expect(getToolRiskClass('create_booking_draft')).toBe('write_draft');
    expect(getToolRiskClass('create_retouch_draft')).toBe('write_draft');
  });

  it('request_payment_link -> confirm_required', () => {
    expect(getToolRiskClass('request_payment_link')).toBe('confirm_required');
  });

  it('read-инструменты -> read', () => {
    expect(getToolRiskClass('get_service_catalog')).toBe('read');
    expect(getToolRiskClass('calculate_price')).toBe('read');
    expect(getToolRiskClass('get_order_status')).toBe('read');
    expect(getToolRiskClass('handoff_to_operator')).toBe('read');
  });

  it('неизвестное/денежное имя -> forbidden (как трактует executeTool: denied)', () => {
    expect(getToolRiskClass('record_payment')).toBe('forbidden');
    expect(getToolRiskClass('unknown_tool')).toBe('forbidden');
  });
});
