import { TestBed } from '@angular/core/testing';
import { PosService } from './pos.service';
import { Product } from './catalog-api.service';

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'prod-1',
  category_id: null,
  name: 'Фото 10×15',
  product_type: 'product',
  code: null,
  barcode: null,
  unit: 'шт',
  sell_price: 50,
  cost_price: 20,
  vat_rate: 'none',
  is_discount_allowed: true,
  is_bonus_allowed: true,
  is_subscription_eligible: false,
  subscription_credit_value: null,
  image_url: null,
  sort_order: 1,
  is_active: true,
  is_favorite: false,
  ...overrides,
});

describe('PosService', () => {
  let service: PosService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PosService);
    service.clear();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('items is empty', () => {
      expect(service.items()).toEqual([]);
    });

    it('isEmpty is true', () => {
      expect(service.isEmpty()).toBe(true);
    });

    it('itemCount is 0', () => {
      expect(service.itemCount()).toBe(0);
    });

    it('total is 0', () => {
      expect(service.total()).toBe(0);
    });

    it('customer is null', () => {
      expect(service.customer()).toBeNull();
    });
  });

  // ─── addItem() ────────────────────────────────────────────────────────────

  describe('addItem()', () => {
    it('adds a new item with default quantity 1', () => {
      const product = makeProduct();
      service.addItem(product);

      expect(service.items()).toHaveLength(1);
      expect(service.items()[0].product.id).toBe('prod-1');
      expect(service.items()[0].quantity).toBe(1);
    });

    it('sets unit_price from product.sell_price', () => {
      service.addItem(makeProduct({ sell_price: 75 }));
      expect(service.items()[0].unit_price).toBe(75);
    });

    it('initialises discount fields to 0', () => {
      service.addItem(makeProduct());
      const item = service.items()[0];
      expect(item.discount_amount).toBe(0);
      expect(item.discount_percent).toBe(0);
      expect(item.points_used).toBe(0);
      expect(item.subscription_credits_used).toBe(0);
    });

    it('increments quantity when the same product is added again', () => {
      const product = makeProduct();
      service.addItem(product);
      service.addItem(product, 3);

      expect(service.items()).toHaveLength(1);
      expect(service.items()[0].quantity).toBe(4);
    });

    it('adds multiple different products as separate items', () => {
      service.addItem(makeProduct({ id: 'a' }));
      service.addItem(makeProduct({ id: 'b' }));
      expect(service.items()).toHaveLength(2);
    });

    it('adds item with custom quantity', () => {
      service.addItem(makeProduct(), 5);
      expect(service.items()[0].quantity).toBe(5);
    });

    it('sets isEmpty to false after adding', () => {
      service.addItem(makeProduct());
      expect(service.isEmpty()).toBe(false);
    });
  });

  // ─── removeItem() ─────────────────────────────────────────────────────────

  describe('removeItem()', () => {
    it('removes the item by productId', () => {
      service.addItem(makeProduct({ id: 'x' }));
      service.removeItem('x');
      expect(service.items()).toHaveLength(0);
    });

    it('does nothing when productId is not in cart', () => {
      service.addItem(makeProduct({ id: 'a' }));
      service.removeItem('nonexistent');
      expect(service.items()).toHaveLength(1);
    });

    it('removes only the target item, leaving others intact', () => {
      service.addItem(makeProduct({ id: 'a' }));
      service.addItem(makeProduct({ id: 'b' }));
      service.removeItem('a');
      expect(service.items()).toHaveLength(1);
      expect(service.items()[0].product.id).toBe('b');
    });
  });

  // ─── updateQuantity() ────────────────────────────────────────────────────

  describe('updateQuantity()', () => {
    it('updates quantity of existing item', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 100 }));
      service.updateQuantity('p1', 3);
      expect(service.items()[0].quantity).toBe(3);
    });

    it('removes item when quantity is 0', () => {
      service.addItem(makeProduct({ id: 'p1' }));
      service.updateQuantity('p1', 0);
      expect(service.items()).toHaveLength(0);
    });

    it('removes item when quantity is negative', () => {
      service.addItem(makeProduct({ id: 'p1' }));
      service.updateQuantity('p1', -1);
      expect(service.items()).toHaveLength(0);
    });

    it('recalculates total after quantity change', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 100 }));
      service.updateQuantity('p1', 5);
      expect(service.items()[0].total).toBe(500);
    });
  });

  // ─── applyDiscount() ─────────────────────────────────────────────────────

  describe('applyDiscount()', () => {
    it('applies percentage discount and calculates discount_amount', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 100 }));
      service.applyDiscount('p1', 10);
      const item = service.items()[0];
      expect(item.discount_percent).toBe(10);
      expect(item.discount_amount).toBe(10);
    });

    it('applies 0% discount (no change)', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 100 }));
      service.applyDiscount('p1', 0);
      expect(service.items()[0].discount_amount).toBe(0);
    });

    it('applies 50% discount on quantity 2', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 100 }), 2);
      service.applyDiscount('p1', 50);
      expect(service.items()[0].discount_amount).toBe(100);
      expect(service.items()[0].total).toBe(100);
    });

    it('does not affect other items', () => {
      service.addItem(makeProduct({ id: 'a', sell_price: 100 }));
      service.addItem(makeProduct({ id: 'b', sell_price: 200 }));
      service.applyDiscount('a', 10);
      expect(service.items().find(i => i.product.id === 'b')!.discount_amount).toBe(0);
    });
  });

  // ─── computed signals ─────────────────────────────────────────────────────

  describe('computed signals', () => {
    it('itemCount sums quantities', () => {
      service.addItem(makeProduct({ id: 'a' }), 2);
      service.addItem(makeProduct({ id: 'b' }), 3);
      expect(service.itemCount()).toBe(5);
    });

    it('subtotal sums unit_price × quantity', () => {
      service.addItem(makeProduct({ id: 'a', sell_price: 100 }), 2);
      service.addItem(makeProduct({ id: 'b', sell_price: 50 }), 1);
      expect(service.subtotal()).toBe(250);
    });

    it('discountTotal sums all discount_amounts', () => {
      service.addItem(makeProduct({ id: 'a', sell_price: 100 }), 2);
      service.addItem(makeProduct({ id: 'b', sell_price: 100 }));
      service.applyDiscount('a', 10);
      expect(service.discountTotal()).toBe(20);
    });

    it('total = subtotal - discountTotal - pointsTotal, minimum 0', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 100 }));
      service.applyDiscount('p1', 10);
      // subtotal=100, discount=10, points=0 → total=90
      expect(service.total()).toBe(90);
    });

    it('raises positive local totals below the minimum check to 10', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 5 }));

      expect(service.minimumCheckSurcharge()).toBe(5);
      expect(service.total()).toBe(10);
    });

    it('total never goes below 0', () => {
      // Manually set an item with discount > subtotal
      service.addItem(makeProduct({ id: 'p1', sell_price: 10 }));
      service.applyDiscount('p1', 100);
      expect(service.total()).toBeGreaterThanOrEqual(0);
    });

    it('total rounds to 2 decimal places', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 1 }), 3);
      service.applyDiscount('p1', 33);
      expect(Number.isFinite(service.total())).toBe(true);
      const decimals = (service.total().toString().split('.')[1] ?? '').length;
      expect(decimals).toBeLessThanOrEqual(2);
    });
  });

  // ─── setCustomer() ───────────────────────────────────────────────────────

  describe('setCustomer()', () => {
    it('sets customer info', () => {
      const info = { phone: '+79001234567', name: 'Иван' };
      service.setCustomer(info);
      expect(service.customer()).toEqual(info);
    });

    it('clears customer when null is passed', () => {
      service.setCustomer({ phone: '+7' });
      service.setCustomer(null);
      expect(service.customer()).toBeNull();
    });
  });

  // ─── clear() ─────────────────────────────────────────────────────────────

  describe('clear()', () => {
    it('empties the cart and clears the customer', () => {
      service.addItem(makeProduct());
      service.setCustomer({ phone: '+7' });
      service.clear();
      expect(service.items()).toEqual([]);
      expect(service.customer()).toBeNull();
      expect(service.isEmpty()).toBe(true);
    });
  });

  // ─── getReceiptItems() ───────────────────────────────────────────────────

  describe('getReceiptItems()', () => {
    it('returns empty array for empty cart', () => {
      expect(service.getReceiptItems()).toEqual([]);
    });

    it('maps items to receipt format with all required fields', () => {
      const product = makeProduct({ id: 'r1', sell_price: 100, vat_rate: '20%' });
      service.addItem(product, 2);

      const receipt = service.getReceiptItems();
      expect(receipt).toHaveLength(1);
      expect(receipt[0]).toMatchObject({
        product_id: 'r1',
        product_name: 'Фото 10×15',
        quantity: 2,
        unit_price: 100,
        vat_rate: '20%',
      });
    });

    it('includes discount fields in receipt', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 100 }), 2);
      service.applyDiscount('p1', 10);
      const receipt = service.getReceiptItems();
      expect(receipt[0].discount_percent).toBe(10);
      expect(receipt[0].discount_amount).toBe(20);
    });

    it('applies account-discount waterfall lines to fiscal receipt totals', () => {
      service.addItem(makeProduct({ id: 'prod-1', name: 'А4 до 15%', sell_price: 10 }), 4);
      Object.assign(service, { serviceOptionIdByProductId: new Map([['prod-1', 'opt-a4']]) });
      service.waterfallResult.set({
        success: true,
        items: [{
          serviceOptionId: 'opt-a4',
          slug: 'a4-up-to-15',
          name: 'А4 до 15%',
          basePrice: 10,
          quantity: 4,
          unitPrice: 10,
          subtotal: 40,
          discountApplied: 'none',
          discountAmount: 0,
          discountLabel: null,
          studentDiscountBenefit: null,
          studentDiscountUnits: 0,
          categoryRank: null,
          finalPrice: 40,
          volumeHint: null,
          nextThreshold: null,
        }],
        subtotal: 40,
        total: 20,
        savings: 20,
        waterfall: [],
        discounts: {
          subscriber: null,
          account: {
            accountType: 'education',
            label: 'Студенческий доступ',
            source: 'education_verification',
            percent: 50,
            amount: 20,
            lines: [{
              serviceOptionId: 'opt-a4',
              name: 'А4 до 15%',
              kind: 'document_print',
              label: 'Студенческий доступ',
              percent: 50,
              amount: 20,
              quantity: 4,
            }],
          },
          student: null,
          loyalty: null,
          promo: null,
          partner: null,
        },
      });

      const receipt = service.getReceiptItems();

      expect(receipt[0]).toMatchObject({
        unit_price: 10,
        discount_amount: 20,
        discount_type: 'account',
        discount_label: 'Студенческий доступ',
        total: 20,
      });
    });

    it('adds a receipt line for the local minimum check surcharge', () => {
      service.addItem(makeProduct({ id: 'p1', sell_price: 5 }));

      const receipt = service.getReceiptItems();

      expect(receipt).toHaveLength(2);
      expect(receipt[1]).toMatchObject({
        product_id: null,
        product_name: 'Минимальный чек',
        unit_price: 5,
        total: 5,
        discount_type: 'minimum_check',
      });
    });

    it('does not mutate the cart items', () => {
      service.addItem(makeProduct());
      service.getReceiptItems();
      expect(service.items()).toHaveLength(1);
    });
  });
});
