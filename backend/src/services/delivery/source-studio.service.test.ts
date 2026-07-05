import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../database/db.js', () => ({
  default: { query: vi.fn() },
}));

const { selectNearestStudio } = await import('./source-studio.service.js');
const dbModule = await import('../../database/db.js');
const db = { query: vi.mocked(dbModule.default.query) };

// Реальные студии (как из БД, после SQL-фильтра валидных координат).
const SOBORNY = { id: 'studio-soborny', location_code: 'soborny', lat: 47.2357, lng: 39.7015 };

describe('selectNearestStudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('выбирает ближайшую студию по гаверсину', async () => {
    db.query.mockResolvedValue([SOBORNY]);
    // Точка рядом с Соборным
    const studio = await selectNearestStudio(39.702, 47.236);
    expect(studio.locationCode).toBe('soborny');
    expect(studio.distanceMeters).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(studio.distanceMeters)).toBe(true);
  });

  it('использует Соборный даже для дальних адресов, потому что другие точки закрыты', async () => {
    db.query.mockResolvedValue([SOBORNY]);
    const studio = await selectNearestStudio(39.718, 47.222);
    expect(studio.locationCode).toBe('soborny');
  });

  it('P0-1: SQL фильтрует фантомов (coordinates ? lat/lng + allowlist location_code)', async () => {
    db.query.mockResolvedValue([SOBORNY]);
    await selectNearestStudio(39.7, 47.23);
    const firstCall = db.query.mock.calls[0];
    if (!firstCall) throw new Error('Expected db.query call');
    const [sql, params] = firstCall;
    if (!params) throw new Error('Expected query params');
    // allowlist по location_code, а НЕ по status='open'
    expect(sql).toMatch(/location_code\s*=\s*ANY/i);
    expect(sql).not.toMatch(/status\s*=\s*'open'/i);
    // оператор существования jsonb-ключа отсекает coordinates={}
    expect(sql).toMatch(/coordinates\s*\?\s*'lat'/i);
    expect(sql).toMatch(/coordinates\s*\?\s*'lng'/i);
    expect(params[0]).toEqual(['soborny']);
  });

  it('P0-1: фантом со status=open coordinates={} (NaN lat/lng) НЕ выбирается, не даёт NaN-студию', async () => {
    // Имитируем строку, проскользнувшую с непарсимыми координатами (defence-in-depth фильтр в коде).
    const PHANTOM = { id: 'phantom-online', location_code: 'online', lat: Number.NaN, lng: Number.NaN };
    db.query.mockResolvedValue([PHANTOM, SOBORNY]);
    const studio = await selectNearestStudio(39.702, 47.236);
    expect(studio.studioId).toBe('studio-soborny');
    expect(Number.isFinite(studio.distanceMeters)).toBe(true);
  });

  it('P0-1: только фантомы (все NaN) → ошибка конфигурации, НЕ NaN-студия', async () => {
    const PHANTOM1 = { id: 'phantom-online', location_code: 'online', lat: Number.NaN, lng: Number.NaN };
    const PHANTOM2 = { id: 'phantom-null', location_code: 'x', lat: Number.NaN, lng: Number.NaN };
    db.query.mockResolvedValue([PHANTOM1, PHANTOM2]);
    await expect(selectNearestStudio(39.7, 47.23)).rejects.toThrow(/конфигурации/i);
  });

  it('пустой результат БД → ошибка конфигурации', async () => {
    db.query.mockResolvedValue([]);
    await expect(selectNearestStudio(39.7, 47.23)).rejects.toThrow(/конфигурации/i);
  });

  it('невалидные координаты точки доставки → ошибка', async () => {
    await expect(selectNearestStudio(Number.NaN, 47.2)).rejects.toThrow(/невалидные координаты/i);
  });
});
