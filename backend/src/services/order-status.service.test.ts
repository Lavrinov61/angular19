import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPoolQuery,
  mockDbTransaction,
  mockRecalculateQueue,
  mockUpdateEstimatedTimes,
  mockBroadcastToRoom,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockRecalculateQueue: vi.fn().mockResolvedValue(undefined),
  mockUpdateEstimatedTimes: vi.fn().mockResolvedValue(undefined),
  mockBroadcastToRoom: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: {
    transaction: mockDbTransaction,
  },
  pool: {
    query: mockPoolQuery,
  },
}));

vi.mock('./queue.service.js', () => ({
  recalculateQueue: mockRecalculateQueue,
  updateEstimatedTimes: mockUpdateEstimatedTimes,
}));

vi.mock('../websocket/broadcast-to-room.js', () => ({
  broadcastToRoom: mockBroadcastToRoom,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const appliedOrder = {
  id: 'order-uuid',
  order_id: 'CRM-TEST',
  status: 'completed',
  estimated_ready_at: null,
  chat_session_id: 'chat-1',
  contact_email: null,
  processing_started_at: null,
  processing_duration_minutes: null,
  oldStatus: 'new',
};

describe('syncOrderStatusForApproval', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockDbTransaction.mockReset().mockResolvedValue(appliedOrder);
    mockRecalculateQueue.mockReset().mockResolvedValue(undefined);
    mockUpdateEstimatedTimes.mockReset().mockResolvedValue(undefined);
    mockBroadcastToRoom.mockReset();
  });

  it('falls back to chat_session_id when approval session has no order_id', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{ order_id: null, chat_session_id: 'chat-1', status: 'approved' }],
      })
      .mockResolvedValueOnce({
        rows: [{ order_id: 'CRM-TEST', status: 'new' }],
      });

    const { syncOrderStatusForApproval } = await import('./order-status.service.js');

    await syncOrderStatusForApproval({ sessionId: 'session-1', trigger: 'reviewed' });

    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(String(mockPoolQuery.mock.calls[1]?.[0])).toContain('chat_session_id');
    expect(mockPoolQuery.mock.calls[1]?.[1]).toEqual(['chat-1']);
  });

  it('allows reviewed approved sessions to complete orders still in new status', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{ order_id: 'order-uuid', chat_session_id: 'chat-1', status: 'approved' }],
      })
      .mockResolvedValueOnce({
        rows: [{ order_id: 'CRM-TEST', status: 'new' }],
      });

    const { syncOrderStatusForApproval } = await import('./order-status.service.js');

    await syncOrderStatusForApproval({ sessionId: 'session-1', trigger: 'reviewed' });

    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses separate placeholders for uuid order_id lookup (varchar=uuid regression)', async () => {
    const orderUuid = 'fd633fd0-9ed4-4a2b-908d-658339ce2309';
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{ order_id: orderUuid, chat_session_id: 'chat-1', status: 'approved' }],
      })
      .mockResolvedValueOnce({
        rows: [{ order_id: 'CRM-TEST', status: 'new' }],
      });

    const { syncOrderStatusForApproval } = await import('./order-status.service.js');

    await syncOrderStatusForApproval({ sessionId: 'session-1', trigger: 'reviewed' });

    // id сравнивается как uuid, order_id — отдельным varchar-плейсхолдером ($2),
    // чтобы не уронить запрос в `character varying = uuid`.
    const lookupSql = String(mockPoolQuery.mock.calls[1]?.[0]);
    expect(lookupSql).toContain('id = $1::uuid');
    expect(lookupSql).toContain('order_id = $2');
    expect(lookupSql).not.toContain('order_id = $1');
    expect(mockPoolQuery.mock.calls[1]?.[1]).toEqual([orderUuid, orderUuid]);
  });
});
