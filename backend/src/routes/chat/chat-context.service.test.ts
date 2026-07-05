import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем DB
const mockQuery = vi.fn();
vi.mock('../../database/db.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Мокаем customer.service
const mockFindOrCreate = vi.fn();
vi.mock('../../services/customer.service.js', () => ({
  findOrCreateCustomer: (...args: unknown[]) => mockFindOrCreate(...args),
  hasUsedBasicPromo: (c: { used_basic_promo: boolean }) => c.used_basic_promo,
}));

// Мокаем pricing helpers (DOCUMENT_TYPES / SERVICE_OPTIONS нужны для getSessionContext)
vi.mock('./chat-pricing.helpers.js', () => ({
  DOCUMENT_TYPES: [{ id: 'passport_rf', value: 'Паспорт РФ', label: 'Паспорт РФ', icon: 'badge', color: '#667eea' }],
  SERVICE_OPTIONS: [{ id: 'no_processing', value: 'Экспресс', label: 'Экспресс — 490₽', icon: 'photo_camera', color: '#43e97b' }],
}));

const {
  isReturningBasicCustomer,
  getVisitorIdFromSession,
  invalidateCustomerCache,
  getSessionContext,
  updateSessionContext,
} = await import('./chat-context.service.js');

describe('isReturningBasicCustomer (с кешированием)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCustomerCache('session-1');
  });

  it('возвращает false для несуществующей сессии', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await isReturningBasicCustomer('session-1');
    expect(result).toBe(false);
  });

  it('возвращает false для нового клиента (used_basic_promo=false)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ visitor_id: 'v-1' }] });
    mockFindOrCreate.mockResolvedValueOnce({ id: 'c-1', used_basic_promo: false });

    const result = await isReturningBasicCustomer('session-1');
    expect(result).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockFindOrCreate).toHaveBeenCalledTimes(1);
  });

  it('возвращает true для вернувшегося клиента (used_basic_promo=true)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ visitor_id: 'v-2' }] });
    mockFindOrCreate.mockResolvedValueOnce({ id: 'c-2', used_basic_promo: true });

    const result = await isReturningBasicCustomer('session-1');
    expect(result).toBe(true);
  });

  it('второй вызов берёт из кеша (0 DB-запросов)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ visitor_id: 'v-3' }] });
    mockFindOrCreate.mockResolvedValueOnce({ id: 'c-3', used_basic_promo: true });

    await isReturningBasicCustomer('session-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockFindOrCreate).toHaveBeenCalledTimes(1);

    // Второй вызов — кеш
    const result = await isReturningBasicCustomer('session-1');
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1); // Не увеличилось
    expect(mockFindOrCreate).toHaveBeenCalledTimes(1); // Не увеличилось
  });

  it('invalidateCustomerCache сбрасывает кеш', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ visitor_id: 'v-4' }] });
    mockFindOrCreate.mockResolvedValueOnce({ id: 'c-4', used_basic_promo: false });
    await isReturningBasicCustomer('session-1');

    // Инвалидация
    invalidateCustomerCache('session-1');

    // Следующий вызов — снова DB
    mockQuery.mockResolvedValueOnce({ rows: [{ visitor_id: 'v-4' }] });
    mockFindOrCreate.mockResolvedValueOnce({ id: 'c-4', used_basic_promo: true });
    const result = await isReturningBasicCustomer('session-1');
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2); // Два вызова
  });
});

describe('getVisitorIdFromSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCustomerCache('session-2');
  });

  it('возвращает visitor_id из DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ visitor_id: 'visitor-abc' }] });
    const id = await getVisitorIdFromSession('session-2');
    expect(id).toBe('visitor-abc');
  });

  it('возвращает пустую строку для несуществующей сессии', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const id = await getVisitorIdFromSession('session-2');
    expect(id).toBe('');
  });
});

describe('getSessionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает дефолтный контекст для несуществующей сессии', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const ctx = await getSessionContext('session-none');
    expect(ctx).toEqual({
      hasPhoto: false,
      photoCount: 0,
      selectedDoc: null,
      selectedTariff: null,
      orderNumber: 1,
      categorySlug: null,
      selectedOptions: {},
      currentOptionStep: null,
    });
  });

  it('возвращает кэшированный контекст из JSONB', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        context: { hasPhoto: true, photoCount: 3, selectedDoc: 'Паспорт РФ', selectedTariff: 'С обработкой', orderNumber: 2 },
        metadata: {},
      }],
    });
    const ctx = await getSessionContext('session-cached');
    expect(ctx.hasPhoto).toBe(true);
    expect(ctx.photoCount).toBe(3);
    expect(ctx.selectedDoc).toBe('Паспорт РФ');
    expect(ctx.orderNumber).toBe(2);
  });

  it('upgradedTariff из metadata приоритетнее context', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        context: { hasPhoto: true, photoCount: 1, selectedDoc: null, selectedTariff: 'Без обработки', orderNumber: 1 },
        metadata: { upgradedTariff: 'С обработкой' },
      }],
    });
    const ctx = await getSessionContext('session-upgraded');
    expect(ctx.selectedTariff).toBe('С обработкой');
  });
});

describe('updateSessionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('вызывает UPDATE с JSONB merge', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await updateSessionContext('session-x', { selectedDoc: 'Виза' });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE(context'),
      [JSON.stringify({ selectedDoc: 'Виза' }), 'session-x'],
    );
  });
});
