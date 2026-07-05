/**
 * Локальный провайдер типографий
 * Использует собственный pricing engine вместо Контур.Маркет
 */

import db from '../../database/db.js';
import type {
  PrintingHouseProvider, PrintProduct, PrintSpecs, PrintOrder, PrintOrderStatus
} from './provider.interface.js';

export class LocalPrintingHouseProvider implements PrintingHouseProvider {
  readonly name = 'local';

  async getProducts(): Promise<PrintProduct[]> {
    const rows = await db.query<{
      id: string; name: string; service_category_slug: string; is_active: boolean;
    }>(
      `SELECT so.id, so.name, sc.slug as service_category_slug
       FROM service_options so
       JOIN option_groups og ON so.option_group_id = og.id
       JOIN service_categories sc ON og.service_category_id = sc.id
       WHERE so.is_active = true AND og.is_active = true
       ORDER BY sc.sort_order, so.sort_order`
    );

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      category: r.service_category_slug,
      minQuantity: 1,
      unit: 'piece' as const,
    }));
  }

  async calculatePrice(productId: string, specs: PrintSpecs): Promise<number> {
    const option = await db.queryOne<{
      base_price: number; price_online: number; price_next_unit: number | null;
    }>(
      `SELECT base_price, price_online, price_next_unit FROM service_options WHERE id = $1`,
      [productId]
    );

    if (!option) throw new Error(`Продукт ${productId} не найден`);

    const unitPrice = option.base_price;
    const additionalPrice = option.price_next_unit || unitPrice;

    if (specs.quantity <= 1) return unitPrice;
    return unitPrice + (specs.quantity - 1) * additionalPrice;
  }

  async createOrder(order: PrintOrder): Promise<{ orderId: string; estimatedDays: number }> {
    // TODO: Интеграция с реальной типографией (PrimaPrint, PechatiRu и т.д.)
    // Пока создаём запись в photo_print_orders
    const result = await db.queryOne<{ id: string }>(
      `INSERT INTO photo_print_orders (
         order_number, status, contact_name, contact_phone, notes, delivery_method
       ) VALUES (
         'TP-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM()*9999)::TEXT, 4, '0'),
         'pending', $1, $2, $3, 'pickup'
       ) RETURNING id`,
      [order.customerName, order.customerPhone, order.notes || '']
    );

    return {
      orderId: result?.id || 'unknown',
      estimatedDays: 3,
    };
  }

  async getOrderStatus(orderId: string): Promise<PrintOrderStatus> {
    const order = await db.queryOne<{ status: string }>(
      `SELECT status FROM photo_print_orders WHERE id = $1`,
      [orderId]
    );

    const statusMap: Record<string, PrintOrderStatus> = {
      'pending': 'pending',
      'in_production': 'in_production',
      'ready': 'shipped',
      'delivered': 'delivered',
      'cancelled': 'cancelled',
    };

    return statusMap[order?.status || ''] || 'pending';
  }

  async cancelOrder(orderId: string): Promise<void> {
    await db.query(
      `UPDATE photo_print_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [orderId]
    );
  }
}
