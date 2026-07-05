import { AppError } from '../middleware/errorHandler.js';

// ── Enum вместо магических строк ──────────────────────────────────
export const OrderItemType = {
  SERVICE: 'service',
  DOCUMENT_PHOTO: 'document_photo',
  PRINT: 'print',
} as const;
export type OrderItemType = (typeof OrderItemType)[keyof typeof OrderItemType];

// ── Discriminated union ───────────────────────────────────────────
interface OrderItemBase {
  name: string;
  price: number;
  quantity: number;
}

export interface ServiceItem extends OrderItemBase {
  type: typeof OrderItemType.SERVICE;
}

export interface DocumentPhotoItem extends OrderItemBase {
  type: typeof OrderItemType.DOCUMENT_PHOTO;
  document: string;
}

export interface PrintItem extends OrderItemBase {
  type: typeof OrderItemType.PRINT;
  uploadedUrl: string;
  format: string;
  paperType: string;
}

export type OrderItem = ServiceItem | DocumentPhotoItem | PrintItem;

// ── Валидация (приватная) ─────────────────────────────────────────

function validateBase(
  name: unknown,
  price: unknown,
  quantity: unknown,
): { name: string; price: number; quantity: number } {
  if (typeof name !== 'string' || !name.trim())
    throw new AppError(400, 'OrderItem: name обязателен');
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0)
    throw new AppError(400, `OrderItem: некорректная цена "${price}"`);
  const q = Math.floor(Number(quantity));
  if (!Number.isFinite(q) || q < 1)
    throw new AppError(400, `OrderItem: некорректное количество "${quantity}"`);
  return { name: name.trim(), price: p, quantity: q };
}

function validateString(val: unknown, field: string): string {
  if (typeof val !== 'string' || !val.trim())
    throw new AppError(400, `OrderItem: ${field} обязателен`);
  return val.trim();
}

// ── Типизированные фабрики ────────────────────────────────────────

export function createServiceItem(
  name: unknown,
  price: unknown,
  quantity: unknown,
): ServiceItem {
  return { type: OrderItemType.SERVICE, ...validateBase(name, price, quantity) };
}

export function createDocumentPhotoItem(
  name: unknown,
  price: unknown,
  quantity: unknown,
  document: unknown,
): DocumentPhotoItem {
  return {
    type: OrderItemType.DOCUMENT_PHOTO,
    ...validateBase(name, price, quantity),
    document: validateString(document, 'document'),
  };
}

export function createPrintItem(
  name: unknown,
  price: unknown,
  quantity: unknown,
  uploadedUrl: unknown,
  format: unknown,
  paperType: unknown,
): PrintItem {
  return {
    type: OrderItemType.PRINT,
    ...validateBase(name, price, quantity),
    uploadedUrl: validateString(uploadedUrl, 'uploadedUrl'),
    format: validateString(format, 'format'),
    paperType: validateString(paperType, 'paperType'),
  };
}

// ── Сериализация — единая точка для JSON.stringify ─────────────────

export function serializeItems(items: OrderItem[]): string {
  if (items.length === 0)
    throw new AppError(400, 'OrderItem: заказ должен содержать хотя бы одну позицию');
  return JSON.stringify(items);
}
