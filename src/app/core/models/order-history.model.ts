/**
 * Модель для истории заказов
 */
export enum OrderItemType {
  DOCUMENT_PHOTO = 'document_photo',
  SERVICE = 'service',
  PRODUCT = 'product',
}

export interface OrderHistoryItem {
  type: OrderItemType;
  name: string;
  price: number;
  quantity: number;
  document?: string;
}

export interface OrderHistory {
  id: string;
  userId: string;
  orderType: OrderType;
  createdAt: Date;
  status: OrderStatus;
  totalPrice: number;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  serviceType?: string;
  items?: OrderHistoryItem[];
  receiptUrl?: string;
  paidAt?: Date;
  paymentCardInfo?: string;
  uniformType?: string;
  photoFormat?: string;
  deliveryMethod?: string;

  // Для фотосессий
  photoSession?: {
    sessionId: string;
    title: string;
    date: Date;
    photographerName: string;
    location: string;
    photoCount?: number;
    durationMinutes: number;
  };
  
  // Для фото на документы
  documentPhoto?: {
    documentType: string;
    quantity: number;
    format: string;
    withDigital: boolean;
    withRetouching: boolean;
  };
  
  // Для реставрации фотографий
  photoRestoration?: {
    originalPhotoUrl?: string;
    restoredPhotoUrl?: string;
    complexity: 'simple' | 'medium' | 'complex';
    comments?: string;
    restorationLevel: string;
  };
  
  // Для печати фотографий
  photoPrinting?: {
    quantity: number;
    format: string;
    paperType: string;
    withFrame?: boolean;
    frameType?: string;
  };
  
  // Дополнительная информация
  additionalInfo?: {
    comments?: string;
    specialRequirements?: string;
    deliveryInfo?: {
      address?: string;
      method: 'pickup' | 'delivery';
      trackingNumber?: string;
    };
  };
}

/**
 * Тип заказа
 */
export enum OrderType {
  PHOTO_SESSION = 'photo_session',         // Фотосессия
  DOCUMENT_PHOTO = 'document_photo',       // Фото на документы
  PHOTO_RESTORATION = 'photo_restoration', // Реставрация фотографий
  PHOTO_PRINTING = 'photo_printing',       // Печать фотографий
  PHOTO_EDITING = 'photo_editing',         // Ретушь и обработка
  PHOTO_PRODUCTS = 'photo_products',       // Фотопродукция (кружки, календари и т.д.)
  FRAMING = 'framing'                      // Багетные работы
}

/**
 * Статус заказа
 */
export enum OrderStatus {
  NEW = 'new',                      // Новый заказ
  PROCESSING = 'processing',        // В обработке
  WAITING_APPROVAL = 'waiting',     // Ожидает подтверждения клиента
  READY = 'ready',                  // Готов к выдаче
  COMPLETED = 'completed',          // Завершен
  CANCELLED = 'cancelled',          // Отменен
  REFUNDED = 'refunded'             // Возврат средств
}

/**
 * Статус оплаты
 */
export enum PaymentStatus {
  PENDING = 'pending',              // Ожидает оплаты
  PARTIAL = 'partial',              // Частично оплачено
  PAID = 'paid',                    // Полностью оплачено
  REFUNDED = 'refunded',            // Возврат средств
  CANCELLED = 'cancelled'           // Отменено
}
