import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  fetchWithCB: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: {
    query: mocks.dbQuery,
  },
}));

vi.mock('../utils/circuit-breaker.js', () => ({
  fetchWithCB: mocks.fetchWithCB,
  SERVICE_BREAKERS: {
    reviewSync: { name: 'review-sync' },
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    reviewSync: {
      enabled: true,
      intervalHours: 24,
      locations: [
        {
          slug: 'soborny',
          name: 'Соборный',
          dgisOrgId: '70000001006548410',
          dgisUrl: 'https://2gis.test/soborny',
          yandexReviewUrl: 'https://yandex.test/soborny/reviews/',
        },
      ],
    },
  },
}));

function htmlResponse(html: string): { ok: boolean; status: number; text: () => Promise<string> } {
  return {
    ok: true,
    status: 200,
    text: async () => html,
  };
}

describe('review sync service', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.dbQuery.mockReset().mockResolvedValue([]);
    mocks.fetchWithCB.mockReset();
  });

  it('syncs 2GIS and Yandex stats for each configured location', async () => {
    mocks.fetchWithCB
      .mockResolvedValueOnce(htmlResponse('<meta name="description" content="80 отзывов о Своё Фото. Рейтинг 4.7 на основе 116 оценок" />'))
      .mockResolvedValueOnce(htmlResponse('<meta itemProp="reviewCount" content="296"/><meta itemProp="ratingValue" content="5.0"/>'));

    const { triggerSync } = await import('./review-sync.service.js');

    await triggerSync();

    const upsertCalls = mocks.dbQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO review_platform_stats'));
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0]?.[1]?.slice(0, 6)).toEqual([
      '2gis',
      'soborny',
      'Соборный',
      'https://2gis.test/soborny',
      4.7,
      80,
    ]);
    expect(upsertCalls[1]?.[1]?.slice(0, 6)).toEqual([
      'yandex',
      'soborny',
      'Соборный',
      'https://yandex.test/soborny/reviews/',
      5,
      296,
    ]);
  });

  it('computes average rating from platform rows instead of hardcoding it', async () => {
    mocks.dbQuery.mockResolvedValueOnce([
      {
        platform: '2gis',
        location_slug: 'soborny',
        location_name: 'Соборный',
        rating: '4.7',
        review_count: 80,
        last_synced_at: '2026-05-22T10:00:00.000Z',
      },
      {
        platform: 'yandex',
        location_slug: 'soborny',
        location_name: 'Соборный',
        rating: '5.0',
        review_count: 296,
        last_synced_at: '2026-05-22T10:05:00.000Z',
      },
      {
        platform: 'google',
        location_slug: 'soborny',
        location_name: 'Соборный',
        rating: '1.0',
        review_count: 1000,
        last_synced_at: '2026-04-02T10:05:00.000Z',
      },
    ]);

    const { getAggregatedStats } = await import('./review-sync.service.js');

    const stats = await getAggregatedStats();

    expect(stats.totalReviews).toBe(376);
    expect(stats.averageRating).toBe(4.9);
    expect(stats.platforms.map(p => p.platform)).toEqual(['2gis', 'yandex']);
  });
});
