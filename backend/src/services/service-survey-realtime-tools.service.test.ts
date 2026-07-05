import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createBookingMock,
  dbQueryOneMock,
  executeToolMock,
  getAvailableSlotsMock,
  getStudiosMock,
} = vi.hoisted(() => ({
  createBookingMock: vi.fn(),
  dbQueryOneMock: vi.fn(),
  executeToolMock: vi.fn(),
  getAvailableSlotsMock: vi.fn(),
  getStudiosMock: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: {
    queryOne: dbQueryOneMock,
  },
}));

vi.mock('./ai-agent/ai-agent-tools.js', () => ({
  executeTool: executeToolMock,
}));

vi.mock('./booking-autonomous.service.js', () => ({
  createBooking: createBookingMock,
  getAvailableSlots: getAvailableSlotsMock,
  getStudios: getStudiosMock,
}));

const { runServiceSurveyRealtimeTool } = await import('./service-survey-realtime-tools.service.js');

describe('service survey realtime tools', () => {
  beforeEach(() => {
    createBookingMock.mockReset();
    dbQueryOneMock.mockReset();
    executeToolMock.mockReset();
    getAvailableSlotsMock.mockReset();
    getStudiosMock.mockReset();
  });

  it('executes allowed read tools with trusted phone contact context', async () => {
    dbQueryOneMock.mockResolvedValueOnce({
      id: 'contact-1',
      user_id: 'user-1',
      phone: '79030000000',
    });
    executeToolMock.mockResolvedValueOnce({
      outcome: 'executed',
      result: { categories: [] },
    });

    const result = await runServiceSurveyRealtimeTool({
      sessionId: 'service-survey-1',
      toolName: 'get_service_catalog',
      rawArguments: '{"query":"визитки"}',
      callerNumber: '+78633226575',
      calledNumber: '+79030000000',
      trustedIdentity: true,
    });

    expect(result).toEqual({
      toolName: 'get_service_catalog',
      outcome: 'executed',
      output: '{"categories":[]}',
    });
    expect(dbQueryOneMock).toHaveBeenCalledWith(expect.stringContaining('FROM contacts'), ['9030000000']);
    expect(executeToolMock).toHaveBeenCalledWith(
      'get_service_catalog',
      '{"query":"визитки"}',
      expect.objectContaining({
        conversationId: 'service-survey:service-survey-1',
        contactId: 'contact-1',
        userId: 'user-1',
        phone: '79030000000',
        trustedIdentity: true,
      }),
    );
  });

  it('does not execute write or payment tools in realtime phone calls', async () => {
    const result = await runServiceSurveyRealtimeTool({
      sessionId: 'service-survey-1',
      toolName: 'request_payment_link',
      rawArguments: '{"draft_ref":"order-1"}',
      callerNumber: '+78633226575',
      calledNumber: '+79030000000',
      trustedIdentity: true,
    });

    expect(result.toolName).toBe('request_payment_link');
    expect(result.outcome).toBe('denied');
    expect(result.output).toContain('tool_denied');
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it('creates a phone booking using the current call phone instead of model-provided phone', async () => {
    dbQueryOneMock
      .mockResolvedValueOnce({
        id: 'contact-1',
        display_name: 'Анна',
        user_id: 'user-1',
        phone: '79030000000',
      })
      .mockResolvedValueOnce({
        id: 'studio-1',
        name: 'Своё Фото — Соборный',
        location_code: 'soborny',
        address: 'Соборный 21',
      });
    getAvailableSlotsMock.mockResolvedValueOnce({
      date: '2026-06-10',
      studioId: 'studio-1',
      slots: [
        { time: '10:00', endTime: '10:15', available: true },
      ],
    });
    createBookingMock.mockResolvedValueOnce({ success: true, bookingId: 'booking-1' });

    const result = await runServiceSurveyRealtimeTool({
      sessionId: 'service-survey-1',
      toolName: 'create_booking',
      rawArguments: '{"studio":"soborny","date":"2026-06-10","time":"10:00","service":"photo_documents","clientName":"Анна"}',
      callerNumber: '+78633226575',
      calledNumber: '+79030000000',
      trustedIdentity: true,
    });

    expect(result.outcome).toBe('executed');
    expect(result.output).toContain('"booking_id":"booking-1"');
    expect(createBookingMock).toHaveBeenCalledWith(expect.objectContaining({
      studioId: 'studio-1',
      date: '2026-06-10',
      time: '10:00',
      duration: 15,
      clientName: 'Анна',
      clientPhone: '79030000000',
      serviceName: 'Фото на документы',
      serviceCategorySlug: 'photo-docs',
      source: 'phone',
    }));
  });
});
