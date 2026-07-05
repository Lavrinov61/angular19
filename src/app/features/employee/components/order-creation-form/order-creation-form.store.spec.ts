import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { ToastService } from '../../../../core/services/toast.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { PricingApiService } from '../../../../core/services/pricing-api.service';
import { DashboardDataService } from '../../services/dashboard-data.service';
import { OrdersApiService } from '../../services/orders-api.service';
import { PosApiService } from '../../services/pos-api.service';
import {
  OrderCreationFormStore,
  type ChatSearchResult,
  type ServiceBlock,
} from './order-creation-form.store';
import type { RetouchConfigEvent } from '../../../../shared/components/retouch-configurator/retouch-configurator.component';

class MockToastService {
  readonly warning = vi.fn();
  readonly success = vi.fn();
  readonly error = vi.fn();
}

class MockPosApiService {
  lookupCustomer() {
    return of(null);
  }
}

class MockPricingApiService {
  calculateV2() {
    return of(null);
  }
}

class MockDashboardDataService {
  readonly documentTemplates = signal([]);
  readonly loadDocumentTemplates = vi.fn();
  readonly resolveDocumentTemplateId = vi.fn(() => null);
}

class MockOrdersApiService {}

class MockWebSocketService {
  readonly visitorNewMessage = signal<{
    sessionId: string;
    content: string;
    messageType: string;
    timestamp: Date;
  } | null>(null);
}

const makeChatResult = (overrides: Partial<ChatSearchResult> = {}): ChatSearchResult => ({
  id: 'session-1',
  clientName: 'Анна',
  clientPhone: '+79001234567',
  channel: 'telegram',
  preview: 'Добрый день',
  ...overrides,
});

/**
 * photo-docs блок с группой processing-level (4 уровня) для проверки денежного пути.
 * Legacy-features (без tierIndex) → processingTierSubs использует name-based наследование
 * и avg-цену (priceDiff/newFeatures). У extended появляется 1 новая фича по 200 ₽ →
 * её отключение вычитает 200. У super фича есть, но цена фиксируется guard'ом.
 */
function makeDocsBlock(): ServiceBlock {
  const opt = (slug: string, name: string, priceStudio: number, featureNames: string[]) => ({
    id: `id-${slug}`,
    slug,
    name,
    priceStudio,
    basePrice: priceStudio,
    estimatedMinutes: 10,
    description: null,
    features: featureNames.map(n => ({ name: n })),
    quantity: 0,
  });
  return {
    id: 'block-docs',
    categorySlug: 'photo-docs',
    categoryName: 'Фото на документы',
    categoryIcon: 'badge',
    groups: [
      {
        slug: 'processing-level',
        name: 'Уровень обработки',
        selectionType: 'single',
        isRequired: true,
        options: [
          opt('processing-basic', 'Базовая', 600, ['Кадрирование']),
          opt('processing-extended', 'Расширенная', 800, ['Кадрирование', 'Цвет кожи']),
          opt('processing-max', 'Максимальная', 1400, ['Кадрирование', 'Цвет кожи', 'Фон']),
          opt('processing-super', 'Супер', 3000, ['Кадрирование', 'Цвет кожи', 'Фон', 'Ретушь', 'Макияж']),
        ],
      },
    ],
  };
}

/** Выбрать уровень обработки в блоке (single select). */
function selectTier(block: ServiceBlock, tierSlug: string): ServiceBlock {
  return {
    ...block,
    groups: block.groups.map(g =>
      g.slug !== 'processing-level'
        ? g
        : { ...g, options: g.options.map(o => ({ ...o, quantity: o.slug === tierSlug ? 1 : 0 })) },
    ),
  };
}

/**
 * portrait-блок с обобщённой группой processing-level (БЕЗ features — фикс-цены уровней,
 * без скидочных под-фич). Проверяет, что category-agnostic getProcessingBlock/денежный путь
 * работают для portrait так же, как для photo-docs (super=фикс, без обработки=0).
 */
function makePortraitBlock(): ServiceBlock {
  const opt = (slug: string, name: string, priceStudio: number) => ({
    id: `id-portrait-${slug}`,
    slug,
    name,
    priceStudio,
    basePrice: priceStudio,
    estimatedMinutes: 30,
    description: null,
    features: [],
    quantity: 0,
  });
  return {
    id: 'block-portrait',
    categorySlug: 'portrait',
    categoryName: 'Портретная съёмка',
    categoryIcon: 'portrait',
    groups: [
      {
        slug: 'processing-level',
        name: 'Уровень обработки',
        selectionType: 'single',
        isRequired: false,
        options: [
          opt('processing-none', 'Без обработки', 0),
          opt('processing-basic', 'Базовая обработка', 700),
          opt('processing-extended', 'Расширенная обработка', 950),
          opt('processing-max', 'Максимальная обработка', 1400),
          opt('processing-super', 'Супер обработка', 3000),
        ],
      },
    ],
  };
}

describe('OrderCreationFormStore', () => {
  let store: OrderCreationFormStore;
  let httpMock: HttpTestingController;
  let toast: MockToastService;
  let ws: MockWebSocketService;

  beforeEach(() => {
    toast = new MockToastService();
    ws = new MockWebSocketService();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        OrderCreationFormStore,
        { provide: ToastService, useValue: toast },
        { provide: PosApiService, useClass: MockPosApiService },
        { provide: PricingApiService, useClass: MockPricingApiService },
        { provide: DashboardDataService, useClass: MockDashboardDataService },
        { provide: OrdersApiService, useClass: MockOrdersApiService },
        { provide: WebSocketService, useValue: ws },
      ],
    });

    store = TestBed.inject(OrderCreationFormStore);
    httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne(req =>
      req.url === '/api/pricing/categories' && req.params.get('crm') === 'true',
    ).flush({ success: true, categories: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  function expectChatInboxRequest() {
    return httpMock.expectOne(req =>
      req.url === '/api/crm/inbox'
      && req.params.get('types') === 'chat'
      && req.params.get('limit') === '20'
      && !req.params.has('search'),
    );
  }

  it('warns when deferred payment is selected without a linked chat', () => {
    const warned = store.warnIfLaterPaymentWithoutChat('later');

    expect(warned).toBe(true);
    expect(toast.warning).toHaveBeenCalledWith(
      'Оплата позже: чат не привязан. Клиент не получит автоматическое сообщение о сроке готовности.',
    );
  });

  it('does not warn for deferred payment when a chat is linked', () => {
    store.linkChat('session-1', 'Анна');

    const warned = store.warnIfLaterPaymentWithoutChat('later');

    expect(warned).toBe(false);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('does not warn for immediate payment without a linked chat', () => {
    const warned = store.warnIfLaterPaymentWithoutChat('cash');

    expect(warned).toBe(false);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('refetches chats each time the picker opens', () => {
    vi.useFakeTimers();

    store.openChatPicker();
    vi.advanceTimersByTime(300);
    expectChatInboxRequest().flush({
      success: true,
      data: [makeChatResult({ id: 'old-session', clientName: 'Старый чат' })],
    });

    expect(store.chatSearchResults()[0]?.id).toBe('old-session');

    store.closeChatPicker();
    store.openChatPicker();
    vi.advanceTimersByTime(300);
    expectChatInboxRequest().flush({
      success: true,
      data: [makeChatResult({ id: 'new-session', clientName: 'Новый чат' })],
    });

    expect(store.chatSearchResults()[0]?.id).toBe('new-session');
  });

  it('refreshes an open chat picker when a visitor message arrives', () => {
    vi.useFakeTimers();

    store.openChatPicker();
    vi.advanceTimersByTime(300);
    expectChatInboxRequest().flush({
      success: true,
      data: [makeChatResult({ id: 'old-session', clientName: 'Старый чат' })],
    });

    ws.visitorNewMessage.set({
      sessionId: 'new-session',
      content: 'Новый клиент',
      messageType: 'text',
      timestamp: new Date(),
    });
    TestBed.flushEffects();
    vi.advanceTimersByTime(300);

    expectChatInboxRequest().flush({
      success: true,
      data: [makeChatResult({ id: 'new-session', clientName: 'Новый чат' })],
    });

    expect(store.chatSearchResults()[0]?.id).toBe('new-session');
  });

  // ── Денежный путь конфигуратора «Супер обработки» ──────────────────────────
  describe('processingAdjustedPrice + retouchConfig', () => {
    it('Супер: фикс-цена 3000, галочки НЕ вычитают (даже при disabledFeatures)', () => {
      store.serviceBlocks.set([selectTier(makeDocsBlock(), 'processing-super')]);
      // Симулируем, что в disabledFeatures как-то попали имена фич super — guard их игнорирует.
      store.disabledFeatures.set(new Map([['block-docs' as never, ['Ретушь', 'Макияж']]]));

      expect(store.processingAdjustedPrice('block-docs', 'processing-super')).toBe(3000);
    });

    it('extended: отключение неунаследованной фичи вычитает её цену (3000-неприменимо)', () => {
      store.serviceBlocks.set([selectTier(makeDocsBlock(), 'processing-extended')]);
      // Без отключений — полная цена уровня
      expect(store.processingAdjustedPrice('block-docs', 'processing-extended')).toBe(800);
      // Отключаем новую фичу 'Цвет кожи' (pricePerFeature=200) → 800-200
      store.disabledFeatures.set(new Map([['block-docs' as never, ['Цвет кожи']]]));
      expect(store.processingAdjustedPrice('block-docs', 'processing-extended')).toBe(600);
    });

    it('basic/max: guard не задевает — поведение прежнее', () => {
      store.serviceBlocks.set([selectTier(makeDocsBlock(), 'processing-basic')]);
      expect(store.processingAdjustedPrice('block-docs', 'processing-basic')).toBe(600);
      store.serviceBlocks.set([selectTier(makeDocsBlock(), 'processing-max')]);
      expect(store.processingAdjustedPrice('block-docs', 'processing-max')).toBe(1400);
    });

    it('docsSubtotal на Супере = фикс 3000 даже при наличии disabled', () => {
      store.serviceBlocks.set([selectTier(makeDocsBlock(), 'processing-super')]);
      store.disabledFeatures.set(new Map([['block-docs' as never, ['Ретушь']]]));
      // Нужен хотя бы один документ, иначе docsSubtotal=0
      store.toggleDocument({
        slug: 'passport-rf', name: 'Паспорт РФ', icon: 'credit_card',
        defaultSize: '3,5×4,5', requiresCountry: false, customSize: false,
      });
      // docsSubtotal = setTotal (паспорт) + adjusted(super)=3000
      const subtotal = store.docsSubtotal();
      expect(subtotal).toBeGreaterThanOrEqual(3000);
    });

    it('setRetouchConfig хранит снимок; смена уровня на не-Супер обнуляет', () => {
      const cfg: RetouchConfigEvent = { gender: 'female', groups: { skin: ['smooth'] }, notes: 'мягко' };
      store.setRetouchConfig(cfg);
      expect(store.retouchConfig()).toEqual(cfg);

      // Смена уровня обработки на basic → конфиг ретуши сбрасывается
      store.serviceBlocks.set([makeDocsBlock()]);
      store.setBlockOption('block-docs', 'processing-level', 'processing-basic', 1);
      expect(store.retouchConfig()).toBeNull();
    });

    it('выбор Супер через setBlockOption НЕ обнуляет retouchConfig', () => {
      store.serviceBlocks.set([makeDocsBlock()]);
      const cfg: RetouchConfigEvent = { gender: 'any', groups: { skin: ['smooth'] } };
      store.setRetouchConfig(cfg);
      store.setBlockOption('block-docs', 'processing-level', 'processing-super', 1);
      expect(store.retouchConfig()).toEqual(cfg);
    });
  });

  // ── Обобщение processing-level на portrait (category-agnostic) ─────────────
  describe('portrait processing-level (generalized)', () => {
    it('Супер в portrait: фикс-цена 3000 (тот же guard, что в photo-docs)', () => {
      store.serviceBlocks.set([selectTier(makePortraitBlock(), 'processing-super')]);
      expect(store.processingAdjustedPrice('block-portrait', 'processing-super')).toBe(3000);
    });

    it('Базовая/Расширенная/Максимальная в portrait: фикс-цена price_studio (без features → без скидок)', () => {
      // Без feature-rows processingTierSubs пуст → adjustedPrice = полная цена уровня (скидок нет).
      store.serviceBlocks.set([selectTier(makePortraitBlock(), 'processing-basic')]);
      expect(store.processingTierSubs().get('processing-basic')).toEqual([]);
      expect(store.processingAdjustedPrice('block-portrait', 'processing-basic')).toBe(700);
      store.serviceBlocks.set([selectTier(makePortraitBlock(), 'processing-extended')]);
      expect(store.processingAdjustedPrice('block-portrait', 'processing-extended')).toBe(950);
      store.serviceBlocks.set([selectTier(makePortraitBlock(), 'processing-max')]);
      expect(store.processingAdjustedPrice('block-portrait', 'processing-max')).toBe(1400);
      // «Без обработки» = 0
      store.serviceBlocks.set([selectTier(makePortraitBlock(), 'processing-none')]);
      expect(store.processingAdjustedPrice('block-portrait', 'processing-none')).toBe(0);
    });

    it('portrait: смена уровня на не-Супер обнуляет retouchConfig (data-driven по группе)', () => {
      store.serviceBlocks.set([makePortraitBlock()]);
      store.setRetouchConfig({ gender: 'any', groups: { skin: ['smooth'] } });
      store.setBlockOption('block-portrait', 'processing-level', 'processing-basic', 1);
      expect(store.retouchConfig()).toBeNull();
    });

    it('portrait: выбор Супер сохраняет retouchConfig', () => {
      store.serviceBlocks.set([makePortraitBlock()]);
      const cfg: RetouchConfigEvent = { gender: 'female', groups: { skin: ['smooth'] } };
      store.setRetouchConfig(cfg);
      store.setBlockOption('block-portrait', 'processing-level', 'processing-super', 1);
      expect(store.retouchConfig()).toEqual(cfg);
    });

    it('РЕГРЕСС: два блока с processing-level → цена берётся из нужного блока по blockId', () => {
      // photo-docs super (фикс 3000) + portrait basic — getProcessingBlock(blockId) не путает блоки.
      store.serviceBlocks.set([
        selectTier(makeDocsBlock(), 'processing-super'),
        selectTier(makePortraitBlock(), 'processing-basic'),
      ]);
      expect(store.processingAdjustedPrice('block-docs', 'processing-super')).toBe(3000);
      // portrait basic: без features adjustedPrice = полная цена 700, и блок не перепутан с photo-docs
      expect(store.processingAdjustedPrice('block-portrait', 'processing-basic')).toBe(700);
      // и наоборот — super, запрошенный для portrait-блока, отдаёт portrait-цену (тоже 3000)
      store.serviceBlocks.set([
        selectTier(makeDocsBlock(), 'processing-basic'),
        selectTier(makePortraitBlock(), 'processing-super'),
      ]);
      expect(store.processingAdjustedPrice('block-portrait', 'processing-super')).toBe(3000);
    });
  });
});
