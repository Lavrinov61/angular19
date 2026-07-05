import type { PaymentCartDetails, SelectedItem, UiServiceOption } from '../models/payment-dialog.models';
import {
  buildReceiptItemsFromCartDetails,
  singlePricingCategorySlug,
} from './pricing-receipt.util';

function service(id: string, slug: string, categorySlug: string): UiServiceOption {
  return {
    id,
    slug,
    name: slug,
    categorySlug,
    groupSlug: `${categorySlug}-items`,
    description: '',
    price: 100,
    priceMax: null,
    icon: 'sell',
    popular: false,
    originalPrice: null,
    features: [],
    productId: null,
  };
}

function item(id: string, slug: string, categorySlug: string): SelectedItem {
  return {
    service: service(id, slug, categorySlug),
    categoryName: categorySlug,
    quantity: 1,
  };
}

describe('singlePricingCategorySlug', () => {
  it('returns the category slug when every selected service belongs to it', () => {
    expect(singlePricingCategorySlug([
      item('copy-1', 'km-а4-ксерокопия', 'copy-print'),
      item('copy-2', 'binding-spring-a4', 'copy-print'),
    ])).toBe('copy-print');
  });

  it('does not route mixed-category services through one pricing category', () => {
    expect(singlePricingCategorySlug([
      item('copy-1', 'km-а4-ксерокопия', 'copy-print'),
      item('lamination-1', 'lamination', 'scan-services'),
    ])).toBeNull();
  });
});

describe('buildReceiptItemsFromCartDetails', () => {
  it('preserves all calculated lines for explicit mixed-category POS receipts', () => {
    const cart: PaymentCartDetails = {
      subtotal: 350,
      savings: 25,
      lines: [
        {
          name: 'А4 до 15%',
          quantity: 2,
          unitPrice: 100,
          total: 200,
          priceNote: null,
          discountLabel: null,
          discountAmount: 0,
        },
        {
          name: 'Ламинирование',
          quantity: 1,
          unitPrice: 175,
          total: 150,
          priceNote: null,
          discountLabel: 'скидка',
          discountAmount: 25,
        },
      ],
    };

    expect(buildReceiptItemsFromCartDetails(cart)).toEqual([
      {
        product_id: null,
        product_name: 'А4 до 15%',
        quantity: 2,
        unit_price: 100,
        discount_amount: 0,
        discount_percent: 0,
        points_used: 0,
        subscription_credits_used: 0,
        total: 200,
      },
      {
        product_id: null,
        product_name: 'Ламинирование',
        quantity: 1,
        unit_price: 175,
        discount_amount: 25,
        discount_percent: 0,
        points_used: 0,
        subscription_credits_used: 0,
        total: 150,
      },
    ]);
  });
});
