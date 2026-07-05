import type { DeliveryQueueItem } from '../../services/delivery-operator.service';

export interface BoardColumn {
  key: string;
  title: string;
  icon: string;
  items: DeliveryQueueItem[];
  /** Свёрнутая колонка (терминальные) — рендерится компактнее. */
  collapsed?: boolean;
}

/**
 * Чистая раскладка очереди доставки по канбан-колонкам. Приоритет колонок
 * (важно для исключения двойного учёта в badge):
 * 1. needsAttention → «Внимание» (перебивает всё)
 * 2. курьер не вызван (null/pending) → «Готов к отправке»
 * 3. delivered/cancelled/failed → «Доставлено» (свёрнуто)
 * 4. picked_up/in_transit → «В пути»
 * 5. created/courier_assigned → «Курьер вызван»
 */
export function buildDeliveryBoardColumns(queue: readonly DeliveryQueueItem[]): BoardColumn[] {
  const attention: DeliveryQueueItem[] = [];
  const readyToDispatch: DeliveryQueueItem[] = [];
  const dispatched: DeliveryQueueItem[] = [];
  const inTransit: DeliveryQueueItem[] = [];
  const delivered: DeliveryQueueItem[] = [];

  for (const item of queue) {
    const s = item.shipmentStatus;
    const notDispatched = s === null || s === 'pending';
    if (item.needsAttention) {
      attention.push(item);
    } else if (notDispatched) {
      readyToDispatch.push(item);
    } else if (s === 'delivered' || s === 'cancelled' || s === 'failed') {
      delivered.push(item);
    } else if (s === 'picked_up' || s === 'in_transit') {
      inTransit.push(item);
    } else {
      // created / courier_assigned
      dispatched.push(item);
    }
  }

  return [
    { key: 'attention', title: 'Внимание', icon: 'warning', items: attention },
    { key: 'ready', title: 'Готов к отправке', icon: 'inventory_2', items: readyToDispatch },
    { key: 'dispatched', title: 'Курьер вызван', icon: 'person_pin', items: dispatched },
    { key: 'in_transit', title: 'В пути', icon: 'local_shipping', items: inTransit },
    { key: 'delivered', title: 'Доставлено', icon: 'check_circle', items: delivered, collapsed: true },
  ];
}
