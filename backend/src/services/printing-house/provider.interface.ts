/**
 * Абстракция провайдера типографий (ПЛАН 12)
 * Заменяет прямую зависимость от Контур.Маркет
 */

export interface PrintProduct {
  id: string;
  name: string;
  category: string;
  minQuantity: number;
  unit: 'sheet' | 'piece' | 'set';
}

export interface PrintSpecs {
  quantity: number;
  format?: string;
  material?: string;
  lamination?: boolean;
  sides?: 1 | 2;
}

export interface PrintOrder {
  productId: string;
  specs: PrintSpecs;
  customerName: string;
  customerPhone: string;
  deliveryAddress?: string;
  notes?: string;
}

export type PrintOrderStatus = 'pending' | 'in_production' | 'shipped' | 'delivered' | 'cancelled';

export interface PrintingHouseProvider {
  name: string;

  /**
   * Получить каталог продуктов
   */
  getProducts(): Promise<PrintProduct[]>;

  /**
   * Рассчитать цену
   */
  calculatePrice(productId: string, specs: PrintSpecs): Promise<number>;

  /**
   * Создать заказ
   */
  createOrder(order: PrintOrder): Promise<{ orderId: string; estimatedDays: number }>;

  /**
   * Статус заказа
   */
  getOrderStatus(orderId: string): Promise<PrintOrderStatus>;

  /**
   * Отменить заказ
   */
  cancelOrder(orderId: string): Promise<void>;
}
