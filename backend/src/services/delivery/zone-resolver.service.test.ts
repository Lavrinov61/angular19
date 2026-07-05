import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// cacheGetOrFetch вызывает fetchFn напрямую (как при Redis miss / Redis down).
vi.mock('../redis-cache.service.js', () => ({
  cacheGetOrFetch: vi.fn(
    async (_key: string, _ttl: number, _early: number, fetchFn: () => Promise<unknown>) =>
      fetchFn(),
  ),
}));

vi.mock('../../database/db.js', () => ({
  default: { query: vi.fn() },
}));

const { resolveZone } = await import('./zone-resolver.service.js');
const dbModule = await import('../../database/db.js');
const db = dbModule.default as unknown as { query: ReturnType<typeof vi.fn> };

/** Сетка 4 зон в порядке ASC по max_distance_m (как из БД). */
const ZONES = [
  { id: 1, name: 'Зона 1 (центр)', max_distance_m: 5000, price_rub: '300.00', min_order_rub: '0.00', taxi_class: 'courier', is_active: true },
  { id: 2, name: 'Зона 2', max_distance_m: 10000, price_rub: '400.00', min_order_rub: '0.00', taxi_class: 'courier', is_active: true },
  { id: 3, name: 'Зона 3 (дальняя)', max_distance_m: 18000, price_rub: '450.00', min_order_rub: '2000.00', taxi_class: 'courier', is_active: true },
  { id: 4, name: 'Зона 4 (за Доном)', max_distance_m: 2000000000, price_rub: '550.00', min_order_rub: '3000.00', taxi_class: 'courier', is_active: true },
];

describe('resolveZone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockResolvedValue(ZONES);
  });

  it('дистанция 0 → зона 1 (центр)', async () => {
    const zone = await resolveZone(0);
    expect(zone?.zoneId).toBe(1);
    expect(zone?.priceRub).toBe(300);
    expect(zone?.minOrderRub).toBe(0);
  });

  it('граница зоны 1 (ровно 5000) → зона 1', async () => {
    const zone = await resolveZone(5000);
    expect(zone?.zoneId).toBe(1);
  });

  it('5001 → переход в зону 2', async () => {
    const zone = await resolveZone(5001);
    expect(zone?.zoneId).toBe(2);
    expect(zone?.priceRub).toBe(400);
  });

  it('граница зоны 2 (10000) → зона 2; 10001 → зона 3 с мин.заказом 2000', async () => {
    expect((await resolveZone(10000))?.zoneId).toBe(2);
    const z3 = await resolveZone(10001);
    expect(z3?.zoneId).toBe(3);
    expect(z3?.minOrderRub).toBe(2000);
  });

  it('дальняя дистанция → зона 4 (за Доном), мин.заказ 3000', async () => {
    const zone = await resolveZone(50000);
    expect(zone?.zoneId).toBe(4);
    expect(zone?.priceRub).toBe(550);
    expect(zone?.minOrderRub).toBe(3000);
  });

  it('дробная дистанция округляется вверх (4999.5 → ≤5000 → зона 1)', async () => {
    expect((await resolveZone(4999.5))?.zoneId).toBe(1);
  });

  it('невалидная дистанция (NaN/отрицательная) → null', async () => {
    expect(await resolveZone(Number.NaN)).toBeNull();
    expect(await resolveZone(-100)).toBeNull();
  });

  it('ни одна зона не покрывает (нет зоны 4) → null', async () => {
    db.query.mockResolvedValue(ZONES.slice(0, 1)); // только зона 1 (max 5000)
    expect(await resolveZone(9999)).toBeNull();
  });

  it('SELECT фильтрует по is_active', async () => {
    await resolveZone(1000);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/is_active\s*=\s*true/i);
    expect(sql).toMatch(/ORDER BY max_distance_m ASC/i);
  });
});
