import { OrderHistory, OrderHistoryItem, OrderItemType, OrderType, OrderStatus, PaymentStatus } from '../models/order-history.model';

export interface OrderHistoryRaw {
  id: string;
  total_price: number;
  status: string;
  payment_status: string;
  mode: string;
  items: OrderHistoryItem[];
  created_at: string;
  service_type?: string;
  receipt_url?: string;
  paid_at?: string;
  payment_card_info?: string;
  uniform_type?: string;
  photo_format?: string | null;
  delivery_method?: string;
}

export interface OrdersHistoryApiResponse {
  success: boolean;
  data: OrderHistoryRaw[];
  total?: number;
}

export function mapOrderType(serviceName?: string, categorySlug?: string): OrderType {
  if (categorySlug) {
    const slug = categorySlug.toLowerCase();
    if (slug === 'photo-docs' || slug === 'foto-na-documenty') return OrderType.DOCUMENT_PHOTO;
    if (slug === 'voennaya-retush' || slug === 'photo-editing') return OrderType.PHOTO_EDITING;
    if (slug === 'photo-restoration') return OrderType.PHOTO_RESTORATION;
    if (slug === 'photo-printing') return OrderType.PHOTO_PRINTING;
    if (slug === 'photo-session') return OrderType.PHOTO_SESSION;
  }
  if (!serviceName) return OrderType.DOCUMENT_PHOTO;
  const s = serviceName.toLowerCase();
  if (s.includes('документ') || s.includes('паспорт') || s.includes('id')) return OrderType.DOCUMENT_PHOTO;
  if (s.includes('сессия') || s.includes('съёмка') || s.includes('съемка')) return OrderType.PHOTO_SESSION;
  if (s.includes('реставрация')) return OrderType.PHOTO_RESTORATION;
  if (s.includes('печать')) return OrderType.PHOTO_PRINTING;
  if (s.includes('ретушь') || s.includes('обработка') || s.includes('парадный')) return OrderType.PHOTO_EDITING;
  return OrderType.DOCUMENT_PHOTO;
}

export function mapRawOrders(raw: OrderHistoryRaw[], userId: string): OrderHistory[] {
  return raw.map(r => {
    const firstItem = Array.isArray(r.items) ? r.items[0] : undefined;
    const orderType = mapOrderType(firstItem?.name, r.service_type);
    const order: OrderHistory = {
      id: r.id,
      userId,
      orderType,
      createdAt: new Date(r.created_at),
      status: (r.status as OrderStatus) ?? OrderStatus.NEW,
      totalPrice: Number(r.total_price) || 0,
      paymentStatus: (r.payment_status as PaymentStatus) ?? PaymentStatus.PENDING,
      items: Array.isArray(r.items) ? r.items : [],
      ...(r.service_type !== undefined ? { serviceType: r.service_type } : {}),
      ...(r.receipt_url !== undefined ? { receiptUrl: r.receipt_url } : {}),
      ...(r.paid_at !== undefined ? { paidAt: new Date(r.paid_at) } : {}),
      ...(r.payment_card_info !== undefined ? { paymentCardInfo: r.payment_card_info } : {}),
      ...(r.uniform_type !== undefined ? { uniformType: r.uniform_type } : {}),
      ...(typeof r.photo_format === 'string' ? { photoFormat: r.photo_format } : {}),
      ...(r.delivery_method !== undefined ? { deliveryMethod: r.delivery_method } : {}),
    };
    if (firstItem?.type === OrderItemType.DOCUMENT_PHOTO && firstItem.document) {
      order.documentPhoto = {
        documentType: firstItem.document,
        quantity: firstItem.quantity ?? 1,
        format: typeof r.photo_format === 'string' ? r.photo_format : '',
        withDigital: r.delivery_method === 'electronic',
        withRetouching: r.service_type === 'voennaya-retush',
      };
    }
    return order;
  });
}
