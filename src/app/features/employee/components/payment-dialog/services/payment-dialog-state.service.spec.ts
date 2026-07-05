/// <reference types="node" />

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PricingApiService,
  type AccountDiscountSummary,
  type WaterfallItem,
  type WaterfallV2Request,
  type WaterfallV2Response,
} from '../../../../../core/services/pricing-api.service';
import type { UiServiceOption } from '../models/payment-dialog.models';
import { PaymentDialogStateService } from './payment-dialog-state.service';

// Образовательная льгота приходит ОТДЕЛЬНЫМ шагом waterfall (discounts.account),
// позиция при этом остаётся «чистой» — это и есть скидка, которую кассир должен
// увидеть, привязав телефон верифицированного студента.
const EDU_ACCOUNT_DISCOUNT: AccountDiscountSummary = {
  accountType: 'education',
  label: 'Образовательный (без подписки)',
  source: 'education_verification',
  percent: 50,
  amount: 200,
  description: 'Образовательный (без подписки): 50% на документы А4',
};

const A4_OPTION: UiServiceOption = {
  id: '7fb9da71-9eba-4c00-9e37-d396dcde080e',
  slug: 'km-а4-до-75',
  name: 'А4 до 75%',
  categorySlug: 'copy-print',
  groupSlug: 'copy-print-items',
  description: '',
  price: 40,
  priceMax: null,
  icon: 'sell',
  popular: false,
  originalPrice: null,
  features: [],
  productId: null,
};

function waterfallItem(overrides: Partial<WaterfallItem> = {}): WaterfallItem {
  return {
    serviceOptionId: A4_OPTION.id,
    slug: A4_OPTION.slug,
    name: A4_OPTION.name,
    basePrice: 40,
    quantity: 10,
    unitPrice: 40,
    subtotal: 400,
    discountApplied: 'none',
    discountAmount: 0,
    discountLabel: null,
    categoryRank: null,
    finalPrice: 400,
    volumeHint: null,
    nextThreshold: null,
    ...overrides,
  };
}

function response(account: AccountDiscountSummary | null): WaterfallV2Response {
  return {
    success: true,
    items: [waterfallItem(account ? { finalPrice: 200, subtotal: 400 } : {})],
    subtotal: 400,
    total: account ? 200 : 400,
    savings: account ? 200 : 0,
    discounts: {
      subscriber: null,
      account,
      student: null,
      loyalty: null,
      promo: null,
      partner: null,
    },
  };
}

describe('PaymentDialogStateService.setCustomerPhone', () => {
  let state: PaymentDialogStateService;
  let calculateV2: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    calculateV2 = vi.fn<(req: WaterfallV2Request) => Promise<WaterfallV2Response>>();
    // Без телефона — каталог (нет account-скидки); с телефоном — −50% education.
    calculateV2.mockImplementation((req: WaterfallV2Request) =>
      Promise.resolve(response(req.customerPhone ? EDU_ACCOUNT_DISCOUNT : null)),
    );

    TestBed.configureTestingModule({
      providers: [
        PaymentDialogStateService,
        { provide: PricingApiService, useValue: { calculateV2 } },
      ],
    });

    state = TestBed.inject(PaymentDialogStateService);
    state.pricingChannel.set('pos');
  });

  async function flushRecalc(): Promise<void> {
    // recalcTrigger$ debounced 300ms; затем дать разрешиться промису fetchPricing.
    await vi.advanceTimersByTimeAsync(350);
  }

  it('attaches the phone and recalculates, surfacing the education account discount', async () => {
    state.selectService(A4_OPTION, 'Копии и печать');
    state.setQuantity(A4_OPTION.id, 10);
    await flushRecalc();

    // До телефона — каталог 400 ₽, скидки нет.
    expect(state.customerPhone()).toBeNull();
    expect(state.accountDiscount()).toBeNull();
    expect(calculateV2).toHaveBeenLastCalledWith(
      expect.objectContaining({ customerPhone: undefined }),
    );

    // Кассир привязывает телефон верифицированного студента.
    state.setCustomerPhone('79526030804');
    await flushRecalc();

    expect(state.customerPhone()).toBe('79526030804');
    expect(calculateV2).toHaveBeenLastCalledWith(
      expect.objectContaining({ customerPhone: '79526030804' }),
    );
    const account = state.accountDiscount();
    expect(account).not.toBeNull();
    expect(account?.accountType).toBe('education');
    expect(account?.percent).toBe(50);
    expect(account?.amount).toBe(200);
  });

  it('does not recalculate when the phone is unchanged', async () => {
    state.selectService(A4_OPTION, 'Копии и печать');
    await flushRecalc();
    const callsBefore = calculateV2.mock.calls.length;

    state.setCustomerPhone(null);
    await flushRecalc();

    // Телефон не менялся (был null) → нового запроса нет.
    expect(calculateV2.mock.calls.length).toBe(callsBefore);
  });

  it('skips pricing when there are no items, even after a phone is set', async () => {
    state.setCustomerPhone('79526030804');
    await flushRecalc();

    // Пустая корзина — triggerRecalc раньше выходит, calculateV2 не зовётся.
    expect(calculateV2).not.toHaveBeenCalled();
    expect(state.accountDiscount()).toBeNull();
  });

  it('uses client identity for pricing without exposing the resolved phone to the browser', async () => {
    state.setCustomerIdentity({ clientUserId: 'user-1', clientContactId: 'contact-1' });
    state.selectService(A4_OPTION, 'Копии и печать');
    await flushRecalc();

    expect(state.customerPhone()).toBeNull();
    expect(state.customerIdentity()).toEqual({ clientUserId: 'user-1', clientContactId: 'contact-1' });
    expect(calculateV2).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customerPhone: undefined,
        clientUserId: 'user-1',
        clientContactId: 'contact-1',
      }),
    );
  });

  it('clears identity pricing when the cashier clears the attached customer phone', async () => {
    state.setCustomerIdentity({ clientUserId: 'user-1' });
    state.selectService(A4_OPTION, 'Копии и печать');
    await flushRecalc();
    calculateV2.mockClear();

    state.setCustomerPhone(null);
    await flushRecalc();

    expect(state.customerIdentity()).toBeNull();
    expect(calculateV2).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customerPhone: undefined,
        clientUserId: undefined,
        clientContactId: undefined,
      }),
    );
  });
});

// Заказ из чата (кнопка «Оплата» в переписке) шёл через applyCartPrefill, который
// раньше клал selectedItems=[] и хранил фикс-цену каталога во «внешней корзине» —
// waterfall не запускался, и образовательная скидка клиента из чата НЕ применялась
// (даже когда телефон уже резолвлен из чата). Фикс восстанавливает каталожные позиции
// в selectedItems → waterfall считает цену с учётом клиента.
describe('PaymentDialogStateService.applyCartPrefill (заказ из чата)', () => {
  let state: PaymentDialogStateService;
  let calculateV2: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    calculateV2 = vi.fn<(req: WaterfallV2Request) => Promise<WaterfallV2Response>>();
    calculateV2.mockImplementation((req: WaterfallV2Request) =>
      Promise.resolve(response(req.customerPhone ? EDU_ACCOUNT_DISCOUNT : null)),
    );

    TestBed.configureTestingModule({
      providers: [
        PaymentDialogStateService,
        { provide: PricingApiService, useValue: { calculateV2 } },
      ],
    });

    state = TestBed.inject(PaymentDialogStateService);
    state.pricingChannel.set('crm'); // заказ из чата = канал crm
    // Каталог с позицией A4 — чтобы префилл из чата сопоставился по id/slug.
    state.categories.set([{
      slug: 'copy-print',
      name: 'Копии и печать',
      icon: 'sell',
      groups: [{ name: 'Печать', slug: 'copy-print-items', options: [A4_OPTION] }],
      allOptions: [A4_OPTION],
    }]);
  });

  async function flushRecalc(): Promise<void> {
    await vi.advanceTimersByTimeAsync(350);
  }

  it('каталожная корзина из чата + телефон студента → waterfall с телефоном → education −50%', async () => {
    // Клиент из чата уже резолвлен (телефон верифицированного студента).
    state.setCustomerPhone('79526030804');

    // Префилл операторской корзины (каталожная позиция, каталог-сумма 400 ₽).
    state.applyCartPrefill(
      [{ id: A4_OPTION.id, slug: A4_OPTION.slug, name: A4_OPTION.name, price: 40, quantity: 10 }],
      400,
      'Печать',
      null,
    );
    await flushRecalc();

    // Позиции восстановлены в selectedItems → waterfall вызван С телефоном → скидка пришла.
    expect(state.selectedItems().length).toBe(1);
    expect(state.selectedItems()[0]?.quantity).toBe(10);
    expect(calculateV2).toHaveBeenLastCalledWith(
      expect.objectContaining({ customerPhone: '79526030804' }),
    );
    const account = state.accountDiscount();
    expect(account).not.toBeNull();
    expect(account?.accountType).toBe('education');
    expect(account?.percent).toBe(50);
    expect(account?.amount).toBe(200);
  });

  it('несопоставимая (кастомная) позиция → внешняя корзина, без пересчёта/скидки', async () => {
    state.setCustomerPhone('79526030804');
    state.applyCartPrefill(
      [{ id: null, slug: null, name: 'Кастомная услуга', price: 123, quantity: 1 }],
      123,
      'Кастом',
      null,
    );
    await flushRecalc();

    // Не сопоставилось с каталогом → selectedItems пуст, waterfall по позициям не идёт,
    // account-скидки нет (фикс-цена внешней корзины сохранена как было).
    expect(state.selectedItems().length).toBe(0);
    expect(state.accountDiscount()).toBeNull();
  });

  it('сохраняет внешнюю корзину печати и добавляет к ней выбранные позиции каталога', () => {
    state.applyCartPrefill(
      [{ id: null, slug: null, name: 'Фото 10x15 см: исходник.jpg', price: 10, quantity: 1 }],
      10,
      'Фото 10x15 см',
      {
        lines: [{
          name: 'Фото 10x15 см: исходник.jpg',
          quantity: 1,
          unitPrice: 10,
          total: 10,
          priceNote: 'Epson L8050 · 10x15 см · 1 копия',
          discountLabel: null,
          discountAmount: 0,
        }],
        subtotal: 10,
        savings: 0,
      },
    );

    state.selectService(A4_OPTION, 'Копии и печать');
    state.setQuantity(A4_OPTION.id, 2);

    expect(state.cartPrefillDetails()?.lines).toHaveLength(1);
    expect(state.selectedItems()).toEqual([
      expect.objectContaining({ service: A4_OPTION, categoryName: 'Копии и печать', quantity: 2 }),
    ]);
    expect(state.amountBeforeLoyalty()).toBe(90);
    expect(state.finalAmount()).toBe(90);

    const cartDetails = state.buildCartDetails();
    expect(cartDetails.lines.map(line => line.name)).toEqual([
      'Фото 10x15 см: исходник.jpg',
      'А4 до 75%',
    ]);
    expect(cartDetails.subtotal).toBe(90);
    expect(cartDetails.savings).toBe(0);
  });

  it('сохраняет внешнюю корзину печати при добавлении ручной позиции', () => {
    state.applyCartPrefill(
      [{ id: null, slug: null, name: 'Фото 10x15 см: исходник.jpg', price: 10, quantity: 1 }],
      10,
      'Фото 10x15 см',
      {
        lines: [{
          name: 'Фото 10x15 см: исходник.jpg',
          quantity: 1,
          unitPrice: 10,
          total: 10,
          priceNote: null,
          discountLabel: null,
          discountAmount: 0,
        }],
        subtotal: 10,
        savings: 0,
      },
    );

    state.setManualAmount('25');

    expect(state.cartPrefillDetails()?.lines).toHaveLength(1);
    expect(state.amountBeforeLoyalty()).toBe(35);
    expect(state.buildCartDetails().lines.map(line => line.name)).toEqual([
      'Фото 10x15 см: исходник.jpg',
      'Дополнительно',
    ]);
  });
});
