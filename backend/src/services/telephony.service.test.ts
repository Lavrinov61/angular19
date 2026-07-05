import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallLog } from './telephony.service.js';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn(),
    queryOne: vi.fn(),
  },
}));

vi.mock('../database/db.js', () => ({ default: mockDb }));
vi.mock('./crm-event-queue.service.js', () => ({ enqueueCrmEvent: vi.fn() }));
vi.mock('../websocket/broadcast-to-room.js', () => ({ broadcastToRoom: vi.fn() }));

const existingCallLog = {
  id: 'call-1',
  voximplant_session_id: 'service-survey-race',
  direction: 'outbound',
  caller_number: '+100',
  called_number: '+200',
  client_user_id: null,
  operator_user_id: null,
  status: 'connecting',
  started_at: '2026-06-04T09:50:00.000Z',
  answered_at: null,
  ended_at: null,
  duration_seconds: null,
  recording_url: null,
  notes: null,
  created_at: '2026-06-04T09:50:00.000Z',
} satisfies CallLog;

const updatedCallLog = {
  ...existingCallLog,
  status: 'active',
  answered_at: '2026-06-04T09:50:11.917Z',
} satisfies CallLog;

describe('recordServiceSurveyResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.query.mockResolvedValue([]);
  });

  it('recovers when concurrent service survey webhook already created the call log', async () => {
    const { recordServiceSurveyResult } = await import('./telephony.service.js');
    const duplicateSessionError = {
      code: '23505',
      constraint: 'call_logs_voximplant_session_id_key',
    };

    mockDb.queryOne
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(duplicateSessionError)
      .mockResolvedValueOnce(existingCallLog)
      .mockResolvedValueOnce(updatedCallLog);

    const result = await recordServiceSurveyResult({
      session_id: 'service-survey-race',
      event: 'answered',
      caller_number: '+100',
      occurred_at: '2026-06-04T09:50:11.917Z',
    });

    expect(result.callLog).toEqual(updatedCallLog);
    expect(mockDb.queryOne).toHaveBeenCalledTimes(4);
    expect(String(mockDb.queryOne.mock.calls[2]?.[0])).toContain(
      'SELECT * FROM call_logs WHERE voximplant_session_id = $1 LIMIT 1',
    );
  });
});
