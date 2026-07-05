import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_TYPES,
  extractPrice,
  formatPriceBreakdown,
  formatServiceDescription,
  buildOrderConfirmedButtons,
  buildWidgetPaymentButton,
} from './chat-pricing.helpers.js';

describe('DOCUMENT_TYPES', () => {
  it('содержит 8 типов документов', () => {
    expect(DOCUMENT_TYPES).toHaveLength(8);
  });

  it('первый документ — Паспорт РФ', () => {
    expect(DOCUMENT_TYPES[0]!.value).toBe('Паспорт РФ');
  });

  it('последний — Другой документ', () => {
    expect(DOCUMENT_TYPES[DOCUMENT_TYPES.length - 1]!.value).toBe('Другой документ');
  });
});

describe('extractPrice', () => {
  it('"Экспресс" новый клиент → 190₽ (промо)', async () => {
    expect(await extractPrice('Экспресс', false)).toBe(190);
  });

  it('"Экспресс" вернувшийся → 490₽', async () => {
    expect(await extractPrice('Экспресс', true)).toBe(490);
  });

  it('"Профессиональный" — 490₽ для нового и 890₽ для вернувшегося', async () => {
    expect(await extractPrice('Профессиональный', false)).toBe(490);
    expect(await extractPrice('Профессиональный', true)).toBe(890);
  });
});

describe('formatPriceBreakdown', () => {
  it('1 фото → просто цена', () => {
    expect(formatPriceBreakdown(190, 190, 490, 1)).toBe('**190₽**');
  });

  it('2 фото с промо → показывает обе цены', () => {
    expect(formatPriceBreakdown(680, 190, 490, 2)).toBe('190₽ + 490₽ = **680₽**');
  });

  it('3 фото с промо → формула с множителем', () => {
    expect(formatPriceBreakdown(1170, 190, 490, 3)).toBe('190₽ + 490₽ × 2 = **1170₽**');
  });

  it('2 фото без скидки → простое умножение', () => {
    expect(formatPriceBreakdown(1780, 890, 890, 2)).toBe('890₽ × 2 фото = **1780₽**');
  });
});

describe('formatServiceDescription', () => {
  it('форматирует тариф', () => {
    expect(formatServiceDescription('Экспресс')).toBe('Фото на документы (экспресс)');
  });

  it('убирает цену из старого формата', () => {
    expect(formatServiceDescription('Профессиональный (890₽)')).toBe('Фото на документы (профессиональный)');
  });
});

describe('buildOrderConfirmedButtons', () => {
  it('генерирует 5 кнопок', async () => {
    const buttons = await buildOrderConfirmedButtons('Экспресс', 'Паспорт РФ');
    expect(buttons).toHaveLength(5);
  });

  it('первая кнопка — печать, вторая — электронный вид', async () => {
    const buttons = await buildOrderConfirmedButtons('Экспресс');
    expect(buttons[0]!.value).toBe('online_print_yes');
    expect(buttons[1]!.value).toBe('online_print_no');
  });

  it('цена для нового клиента (1 фото) = 190₽', async () => {
    const buttons = await buildOrderConfirmedButtons('Экспресс', undefined, undefined, 1, false);
    const data = buttons[0]!.data as Record<string, number>;
    expect(data['price']).toBe(190);
  });

  it('цена для вернувшегося клиента (1 фото) = 490₽', async () => {
    const buttons = await buildOrderConfirmedButtons('Экспресс', undefined, undefined, 1, true);
    const data = buttons[0]!.data as Record<string, number>;
    expect(data['price']).toBe(490);
  });

  it('цена за 2 фото нового = 190 + 490 = 680₽', async () => {
    const buttons = await buildOrderConfirmedButtons('Экспресс', undefined, undefined, 2, false);
    const data = buttons[0]!.data as Record<string, number>;
    expect(data['price']).toBe(680);
  });

  it('цена за 2 фото вернувшегося = 490 + 490 = 980₽', async () => {
    const buttons = await buildOrderConfirmedButtons('Экспресс', undefined, undefined, 2, true);
    const data = buttons[0]!.data as Record<string, number>;
    expect(data['price']).toBe(980);
  });

  it('"Профессиональный" (новый клиент) — 490₽ + 890₽ = 1380₽', async () => {
    const buttons = await buildOrderConfirmedButtons('Профессиональный', undefined, undefined, 2, false);
    const data = buttons[0]!.data as Record<string, number>;
    expect(data['price']).toBe(1380);
  });
});

describe('buildWidgetPaymentButton', () => {
  it('генерирует кнопку оплаты с ценой', () => {
    const btn = buildWidgetPaymentButton('order-123', 680, 'Фото');
    expect(btn.value).toBe('pay_online_widget');
    expect(btn.label).toContain('680₽');
    expect((btn.data as Record<string, unknown>)['orderId']).toBe('order-123');
    expect((btn.data as Record<string, unknown>)['price']).toBe(680);
  });
});
