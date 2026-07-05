import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQuery } = vi.hoisted(() => ({
  dbQuery: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: { query: dbQuery },
}));

import { getStudiosEffectiveStatus, STUDIO_SHORT_LABELS } from './studio-status.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  dbQuery.mockResolvedValue([]);
});

describe('studio-status.service', () => {
  it('читает из БД и открытую публичную точку, и закрытые известные исторические адреса для AI-контекста', async () => {
    await getStudiosEffectiveStatus();

    const params: unknown = dbQuery.mock.calls[0]?.[1];
    expect(params).toEqual([['soborny', 'barrikadnaya-4']]);
  });

  it('оставляет публичный список самовывоза только на Соборном', () => {
    expect(STUDIO_SHORT_LABELS).toEqual({ soborny: 'Соборный 21' });
  });
});
