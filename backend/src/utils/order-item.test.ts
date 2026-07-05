import { describe, it, expect } from 'vitest';
import {
  OrderItemType,
  createServiceItem,
  createDocumentPhotoItem,
  createPrintItem,
  serializeItems,
} from './order-item.js';

describe('createServiceItem', () => {
  it('creates a valid service item', () => {
    const item = createServiceItem('Фотосессия', 1500, 1);
    expect(item).toEqual({
      type: OrderItemType.SERVICE,
      name: 'Фотосессия',
      price: 1500,
      quantity: 1,
    });
  });

  it('trims name whitespace', () => {
    const item = createServiceItem('  Ретушь  ', 500, 1);
    expect(item.name).toBe('Ретушь');
  });

  it('floors fractional quantity', () => {
    const item = createServiceItem('Услуга', 100, 2.7);
    expect(item.quantity).toBe(2);
  });

  it('throws on empty name', () => {
    expect(() => createServiceItem('', 100, 1)).toThrow('name обязателен');
  });

  it('throws on negative price', () => {
    expect(() => createServiceItem('Услуга', -1, 1)).toThrow('некорректная цена');
  });

  it('throws on zero quantity', () => {
    expect(() => createServiceItem('Услуга', 100, 0)).toThrow('некорректное количество');
  });

  it('accepts price of 0 (free item)', () => {
    const item = createServiceItem('Бесплатная консультация', 0, 1);
    expect(item.price).toBe(0);
  });
});

describe('createDocumentPhotoItem', () => {
  it('creates a valid document photo item with only 4 fields', () => {
    const item = createDocumentPhotoItem('Фото на паспорт', 350, 1, 'Паспорт РФ');
    expect(item).toEqual({
      type: OrderItemType.DOCUMENT_PHOTO,
      name: 'Фото на паспорт',
      price: 350,
      quantity: 1,
      document: 'Паспорт РФ',
    });
  });

  it('does not contain order-level fields', () => {
    const item = createDocumentPhotoItem('Фото', 350, 1, 'Паспорт РФ');
    expect(item).not.toHaveProperty('format');
    expect(item).not.toHaveProperty('uniformType');
    expect(item).not.toHaveProperty('deliveryMethod');
    expect(item).not.toHaveProperty('categorySlug');
  });

  it('throws on empty document', () => {
    expect(() => createDocumentPhotoItem('Фото', 350, 1, '')).toThrow('document обязателен');
  });

  it('trims document whitespace', () => {
    const item = createDocumentPhotoItem('Фото', 350, 1, '  Паспорт РФ  ');
    expect(item.document).toBe('Паспорт РФ');
  });
});

describe('createPrintItem', () => {
  it('creates a valid print item', () => {
    const item = createPrintItem('Печать 10x15', 15, 3, '/uploads/photo.jpg', '10x15', 'glossy');
    expect(item).toEqual({
      type: OrderItemType.PRINT,
      name: 'Печать 10x15',
      price: 15,
      quantity: 3,
      uploadedUrl: '/uploads/photo.jpg',
      format: '10x15',
      paperType: 'glossy',
    });
  });

  it('throws on empty uploadedUrl', () => {
    expect(() => createPrintItem('Печать', 15, 1, '', '10x15', 'glossy')).toThrow('uploadedUrl обязателен');
  });

  it('throws on empty format', () => {
    expect(() => createPrintItem('Печать', 15, 1, '/photo.jpg', '', 'glossy')).toThrow('format обязателен');
  });

  it('throws on empty paperType', () => {
    expect(() => createPrintItem('Печать', 15, 1, '/photo.jpg', '10x15', '')).toThrow('paperType обязателен');
  });
});

describe('serializeItems', () => {
  it('serializes a non-empty array to JSON', () => {
    const items = [createServiceItem('Услуга', 100, 1)];
    const json = serializeItems(items);
    expect(JSON.parse(json)).toEqual([{ type: 'service', name: 'Услуга', price: 100, quantity: 1 }]);
  });

  it('throws on empty array', () => {
    expect(() => serializeItems([])).toThrow('хотя бы одну позицию');
  });
});
