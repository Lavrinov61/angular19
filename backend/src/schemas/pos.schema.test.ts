import { describe, expect, it } from 'vitest';

import { bridgePaySchema } from './pos.schema.js';

describe('bridgePaySchema', () => {
  it('requires studioId so terminal commands route to the current point', () => {
    const result = bridgePaySchema.safeParse({
      amount: 100,
      orderId: 'order-1',
    });

    expect(result.success).toBe(false);
  });

  it('accepts explicit studioId for point-specific terminal routing', () => {
    const payload = {
      amount: 100,
      orderId: 'order-1',
      studioId: '22222222-2222-4222-8222-222222222222',
    };

    expect(bridgePaySchema.parse(payload)).toEqual(payload);
  });

  const STUDIO_ID = '22222222-2222-4222-8222-222222222222';

  it('accepts order-first cart snapshot with studioId/customerName/source', () => {
    const result = bridgePaySchema.safeParse({
      amount: 320,
      orderId: 'order-1',
      studioId: STUDIO_ID,
      snapshot: {
        items: [{ product_name: 'Печать', quantity: 2, unit_price: 50, total: 100 }],
        subtotal: 100,
        total: 100,
        studioId: STUDIO_ID,
        customerName: 'Анастасия',
        source: 'cart',
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects negative unit_price in snapshot items (54-ФЗ anti-tamper)', () => {
    const result = bridgePaySchema.safeParse({
      amount: 100,
      orderId: 'order-1',
      studioId: STUDIO_ID,
      snapshot: {
        items: [{ product_name: 'Скидка-хак', quantity: 1, unit_price: -100, total: -100 }],
        subtotal: -100,
        total: -100,
      },
    });

    expect(result.success).toBe(false);
  });

  it('accepts order-first pricing branch (услуги, бэк сам считает snapshot)', () => {
    const result = bridgePaySchema.safeParse({
      amount: 2100,
      orderId: 'order-1',
      studioId: STUDIO_ID,
      pricing: {
        category_slug: 'portrait',
        selected_options: [{ slug: 'portrait-basic', quantity: 1 }],
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects pricing branch without category_slug', () => {
    const result = bridgePaySchema.safeParse({
      amount: 2100,
      orderId: 'order-1',
      studioId: STUDIO_ID,
      pricing: {
        selected_options: [{ slug: 'portrait-basic', quantity: 1 }],
      },
    });

    expect(result.success).toBe(false);
  });
});
