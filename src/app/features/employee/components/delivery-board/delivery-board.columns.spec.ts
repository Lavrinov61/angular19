import { buildDeliveryBoardColumns } from './delivery-board.columns';
import type { DeliveryQueueItem } from '../../services/delivery-operator.service';

const makeItem = (overrides: Partial<DeliveryQueueItem> = {}): DeliveryQueueItem => ({
  orderId: 'ord-1',
  orderNumber: '1042',
  orderStatus: 'ready',
  customerName: 'Иван',
  dropoffAddress: 'Соборный 21',
  zone: 'Зона 1',
  priceRub: 300,
  shipmentStatus: null,
  claimId: null,
  courierName: null,
  courierPhone: null,
  trackingUrl: null,
  needsAttention: false,
  createdAt: '2026-05-30T10:00:00Z',
  ...overrides,
});

function col(cols: ReturnType<typeof buildDeliveryBoardColumns>, key: string) {
  return cols.find((c) => c.key === key)!;
}

describe('buildDeliveryBoardColumns', () => {
  it('всегда 5 колонок в фиксированном порядке', () => {
    const cols = buildDeliveryBoardColumns([]);
    expect(cols.map((c) => c.key)).toEqual([
      'attention', 'ready', 'dispatched', 'in_transit', 'delivered',
    ]);
    expect(col(cols, 'delivered').collapsed).toBe(true);
  });

  it('needsAttention перебивает любой статус → колонка «Внимание»', () => {
    const cols = buildDeliveryBoardColumns([
      makeItem({ orderId: 'a', needsAttention: true, shipmentStatus: 'in_transit' }),
    ]);
    expect(col(cols, 'attention').items.map((i) => i.orderId)).toEqual(['a']);
    expect(col(cols, 'in_transit').items).toEqual([]);
  });

  it('null/pending без attention → «Готов к отправке»', () => {
    const cols = buildDeliveryBoardColumns([
      makeItem({ orderId: 'a', shipmentStatus: null }),
      makeItem({ orderId: 'b', shipmentStatus: 'pending' }),
    ]);
    expect(col(cols, 'ready').items.map((i) => i.orderId)).toEqual(['a', 'b']);
  });

  it('created/courier_assigned → «Курьер вызван»', () => {
    const cols = buildDeliveryBoardColumns([
      makeItem({ orderId: 'a', shipmentStatus: 'created' }),
      makeItem({ orderId: 'b', shipmentStatus: 'courier_assigned' }),
    ]);
    expect(col(cols, 'dispatched').items.map((i) => i.orderId)).toEqual(['a', 'b']);
  });

  it('picked_up/in_transit → «В пути»', () => {
    const cols = buildDeliveryBoardColumns([
      makeItem({ orderId: 'a', shipmentStatus: 'picked_up' }),
      makeItem({ orderId: 'b', shipmentStatus: 'in_transit' }),
    ]);
    expect(col(cols, 'in_transit').items.map((i) => i.orderId)).toEqual(['a', 'b']);
  });

  it('delivered/cancelled/failed → «Доставлено» (свёрнуто)', () => {
    const cols = buildDeliveryBoardColumns([
      makeItem({ orderId: 'a', shipmentStatus: 'delivered' }),
      makeItem({ orderId: 'b', shipmentStatus: 'cancelled' }),
      makeItem({ orderId: 'c', shipmentStatus: 'failed' }),
    ]);
    expect(col(cols, 'delivered').items.map((i) => i.orderId)).toEqual(['a', 'b', 'c']);
  });

  it('заказ не попадает в две колонки одновременно', () => {
    const cols = buildDeliveryBoardColumns([
      makeItem({ orderId: 'a', needsAttention: true, orderStatus: 'ready', shipmentStatus: null }),
    ]);
    const totalPlacements = cols.reduce((n, c) => n + c.items.length, 0);
    expect(totalPlacements).toBe(1);
    expect(col(cols, 'attention').items.length).toBe(1);
    expect(col(cols, 'ready').items.length).toBe(0);
  });
});
