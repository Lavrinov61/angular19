import { describe, it, expect } from 'vitest';
import { mapOrderType, mapRawOrders, OrderHistoryRaw } from './order-mapping.utils';
import { OrderType, OrderItemType } from '../models/order-history.model';

// ─── mapOrderType ─────────────────────────────────────────────────────

describe('mapOrderType', () => {
  it('returns DOCUMENT_PHOTO for photo-docs slug', () => {
    expect(mapOrderType(undefined, 'photo-docs')).toBe(OrderType.DOCUMENT_PHOTO);
  });

  it('returns DOCUMENT_PHOTO for foto-na-documenty slug', () => {
    expect(mapOrderType(undefined, 'foto-na-documenty')).toBe(OrderType.DOCUMENT_PHOTO);
  });

  it('returns PHOTO_EDITING for voennaya-retush slug', () => {
    expect(mapOrderType(undefined, 'voennaya-retush')).toBe(OrderType.PHOTO_EDITING);
  });

  it('returns PHOTO_EDITING for photo-editing slug', () => {
    expect(mapOrderType(undefined, 'photo-editing')).toBe(OrderType.PHOTO_EDITING);
  });

  it('returns PHOTO_RESTORATION for photo-restoration slug', () => {
    expect(mapOrderType(undefined, 'photo-restoration')).toBe(OrderType.PHOTO_RESTORATION);
  });

  it('returns PHOTO_PRINTING for photo-printing slug', () => {
    expect(mapOrderType(undefined, 'photo-printing')).toBe(OrderType.PHOTO_PRINTING);
  });

  it('returns PHOTO_SESSION for photo-session slug', () => {
    expect(mapOrderType(undefined, 'photo-session')).toBe(OrderType.PHOTO_SESSION);
  });

  it('categorySlug takes priority over serviceName heuristic', () => {
    expect(mapOrderType('Печать фото', 'photo-docs')).toBe(OrderType.DOCUMENT_PHOTO);
  });

  it('falls back to name heuristic when no slug', () => {
    expect(mapOrderType('Фото на документы (экспресс)')).toBe(OrderType.DOCUMENT_PHOTO);
    expect(mapOrderType('Фотосессия в студии')).toBe(OrderType.PHOTO_SESSION);
    expect(mapOrderType('Реставрация фото')).toBe(OrderType.PHOTO_RESTORATION);
    expect(mapOrderType('Печать 10x15')).toBe(OrderType.PHOTO_PRINTING);
    expect(mapOrderType('Военная ретушь')).toBe(OrderType.PHOTO_EDITING);
  });

  it('returns DOCUMENT_PHOTO when no slug and no name', () => {
    expect(mapOrderType()).toBe(OrderType.DOCUMENT_PHOTO);
    expect(mapOrderType(undefined, undefined)).toBe(OrderType.DOCUMENT_PHOTO);
  });
});

// ─── mapRawOrders ─────────────────────────────────────────────────────

describe('mapRawOrders', () => {
  const baseRaw: OrderHistoryRaw = {
    id: 'SF-100',
    total_price: 350,
    status: 'processing',
    payment_status: 'paid',
    mode: 'custom',
    items: [],
    created_at: '2026-01-15T10:00:00Z',
    service_type: 'photo-docs',
  };

  it('maps basic fields correctly', () => {
    const [order] = mapRawOrders([baseRaw], 'user-1');
    expect(order.id).toBe('SF-100');
    expect(order.userId).toBe('user-1');
    expect(order.totalPrice).toBe(350);
    expect(order.orderType).toBe(OrderType.DOCUMENT_PHOTO);
    expect(order.serviceType).toBe('photo-docs');
  });

  it('populates documentPhoto when first item is document_photo', () => {
    const raw: OrderHistoryRaw = {
      ...baseRaw,
      items: [{
        type: OrderItemType.DOCUMENT_PHOTO,
        name: 'Фото на паспорт',
        price: 350,
        quantity: 1,
        document: 'Паспорт РФ',
      }],
      photo_format: '3.5×4.5',
      delivery_method: 'electronic',
    };
    const [order] = mapRawOrders([raw], 'user-1');
    expect(order.documentPhoto).toBeDefined();
    expect(order.documentPhoto!.documentType).toBe('Паспорт РФ');
    expect(order.documentPhoto!.format).toBe('3.5×4.5');
    expect(order.documentPhoto!.withDigital).toBe(true);
  });

  it('documentPhoto.format is empty when photo_format is null', () => {
    const raw: OrderHistoryRaw = {
      ...baseRaw,
      items: [{
        type: OrderItemType.DOCUMENT_PHOTO,
        name: 'Фото',
        price: 350,
        quantity: 1,
        document: 'Паспорт',
      }],
      photo_format: null,
    };
    const [order] = mapRawOrders([raw], 'user-1');
    expect(order.documentPhoto!.format).toBe('');
  });

  it('withRetouching is true for voennaya-retush service', () => {
    const raw: OrderHistoryRaw = {
      ...baseRaw,
      service_type: 'voennaya-retush',
      items: [{
        type: OrderItemType.DOCUMENT_PHOTO,
        name: 'Военная ретушь',
        price: 1500,
        quantity: 1,
        document: 'Военный билет',
      }],
    };
    const [order] = mapRawOrders([raw], 'user-1');
    expect(order.documentPhoto!.withRetouching).toBe(true);
  });

  it('does not populate documentPhoto for service items', () => {
    const raw: OrderHistoryRaw = {
      ...baseRaw,
      items: [{ type: OrderItemType.SERVICE, name: 'Фотосессия', price: 2000, quantity: 1 }],
    };
    const [order] = mapRawOrders([raw], 'user-1');
    expect(order.documentPhoto).toBeUndefined();
  });

  it('handles empty items array', () => {
    const [order] = mapRawOrders([baseRaw], 'user-1');
    expect(order.items).toEqual([]);
    expect(order.documentPhoto).toBeUndefined();
  });

  it('spreads optional fields only when present', () => {
    const [order] = mapRawOrders([baseRaw], 'user-1');
    expect(order.receiptUrl).toBeUndefined();
    expect(order.paidAt).toBeUndefined();
    expect(order.paymentCardInfo).toBeUndefined();
    expect(order.uniformType).toBeUndefined();
    expect(order.photoFormat).toBeUndefined();
    expect(order.deliveryMethod).toBeUndefined();
  });

  it('spreads optional fields when present', () => {
    const raw: OrderHistoryRaw = {
      ...baseRaw,
      receipt_url: 'https://receipt.example.com',
      paid_at: '2026-01-15T10:05:00Z',
      payment_card_info: '**** 1234',
      uniform_type: 'Сухопутные войска',
      photo_format: '3×4',
      delivery_method: 'pickup',
    };
    const [order] = mapRawOrders([raw], 'user-1');
    expect(order.receiptUrl).toBe('https://receipt.example.com');
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(order.paymentCardInfo).toBe('**** 1234');
    expect(order.uniformType).toBe('Сухопутные войска');
    expect(order.photoFormat).toBe('3×4');
    expect(order.deliveryMethod).toBe('pickup');
  });
});
