import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../database/db.js', () => ({ default: mockDb }));
vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireUser: (req: { user?: { id: string } }) => {
    req.user = { id: 'employee-1' };
  },
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./kb.routes.js');
  app = createTestApp(router);
});

describe('Knowledge Base routes', () => {
  beforeEach(() => {
    vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
    vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  });

  it('returns text search results in the Angular KB service contract', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      {
        id: 'entity-1',
        entity_type: 'process',
        slug: 'instruction-education-student-verification',
        name: 'Инструкция: проверка студентов в пульте',
        summary: 'Как сотруднику проверять студентов',
        category_path: 'instructions/education',
        tags: ['студенты', 'инструкция'],
        confidence: '1.00',
        is_verified: true,
        rank: 0.75,
        headline: '**студентов** в пульте',
      },
    ]);

    const res = await request(app)
      .post('/search')
      .send({ q: 'студент', limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      results: [
        {
          id: 'entity-1',
          entity_type: 'process',
          slug: 'instruction-education-student-verification',
          name: 'Инструкция: проверка студентов в пульте',
          summary: 'Как сотруднику проверять студентов',
          category_path: 'instructions/education',
          tags: ['студенты', 'инструкция'],
          confidence: 1,
          is_verified: true,
          rank: 0.75,
          headline: '<mark>студентов</mark> в пульте',
        },
      ],
      total: 1,
      query: 'студент',
      method: 'fts',
    });
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('kb_search_text'),
      ['студент', null, null, 'active', 10, 0],
    );
  });
});
