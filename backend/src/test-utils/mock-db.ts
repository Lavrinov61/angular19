import { vi } from 'vitest';

/**
 * Mock for db default export (Database singleton with query/queryOne/transaction).
 * Use in vi.mock calls:
 *
 *   vi.mock('../database/db.js', () => ({ default: mockDb }));
 *
 * Then configure responses per-test:
 *   vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ id: '1', email: 'a@b.com' });
 */
export const mockDb = {
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  transaction: vi.fn().mockImplementation(async (fn: (client: unknown) => unknown) => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    return fn(mockClient);
  }),
  getClient: vi.fn().mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }),
  getPool: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

/**
 * Mock for pool named export (pg Pool).
 * Use in vi.mock calls:
 *
 *   vi.mock('../database/db.js', () => ({ default: mockDb, pool: mockPool }));
 */
export const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn(),
  end: vi.fn(),
};

/**
 * Shorthand to configure mockDb.query to return a list of rows.
 */
export function mockQueryRows<T>(rows: T[]): void {
  vi.mocked(mockDb.query).mockResolvedValueOnce(rows as never);
}

/**
 * Shorthand to configure mockDb.queryOne to return a single row.
 */
export function mockQueryOne<T>(row: T | null): void {
  vi.mocked(mockDb.queryOne).mockResolvedValueOnce(row as never);
}

/**
 * Resets all mock implementations to defaults.
 * Call in beforeEach.
 */
export function resetMockDb(): void {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockDb.transaction).mockReset().mockImplementation(async (fn: (client: unknown) => unknown) => {
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    return fn(mockClient);
  });
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] } as never);
}
