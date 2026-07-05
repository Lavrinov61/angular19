import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import type {
  CallLog,
  CallTranscript,
  ClientLookupResult,
  MissedInboundCallResult,
  ServiceSurveyResult,
} from '../services/telephony.service.js';
import type {
  ServiceSurveyRecordingRow,
  ServiceSurveyResponseRow,
} from '../types/views/service-survey-views.js';
import { getStudiosEffectiveStatus } from '../services/studio-status.service.js';

const {
  createOpenAiRealtimeClientSecretMock,
  fetchWithTimeoutMock,
  mockAuthUserRef,
  runServiceSurveyRealtimeToolMock,
} = vi.hoisted(() => ({
  createOpenAiRealtimeClientSecretMock: vi.fn(),
  fetchWithTimeoutMock: vi.fn(),
  mockAuthUserRef: {
    current: {
      id: 'user-1',
      role: 'admin',
      permissions: ['inbox:manage', 'reports:view'],
    },
  },
  runServiceSurveyRealtimeToolMock: vi.fn(),
}));

interface MockAuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    permissions: string[];
  };
}

vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: MockAuthRequest, _res: Response, next: NextFunction) => {
    req.user = mockAuthUserRef.current;
    next();
  },
  requirePermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../config/index.js', () => ({
  config: {
    voximplant: {
      studioClickToCall: {
        callerId: '+78633226575',
        sipUser: 'soborny101',
      },
      voiceCall: {
        callbackSecret: 'test-voice-otp-secret',
      },
      webhook: {
        secret: 'test-voice-otp-secret',
        authMode: 'dual-accept',
        maxSkewSec: 300,
      },
    },
  },
}));

vi.mock('../services/telephony.service.js', () => ({
  lookupClientByPhone: vi.fn(),
  createCallLog: vi.fn(),
  createOrUpdateInboundCallLog: vi.fn(),
  updateCallLogBySession: vi.fn(),
  recordMissedInboundCall: vi.fn(),
  recordServiceSurveyResult: vi.fn(),
  getServiceSurveyResponses: vi.fn(),
  getServiceSurveyRecording: vi.fn(),
  getCallHistory: vi.fn(),
  getCallById: vi.fn(),
  linkCallToEntity: vi.fn(),
  updateCallLog: vi.fn(),
  getAvailableOperators: vi.fn(),
  transferCall: vi.fn(),
}));

vi.mock('../services/voximplant.service.js', () => ({
  startVoximplantStudioClickToCall: vi.fn(),
  startVoximplantServiceSurveyCall: vi.fn(),
}));

// studio-status: мокаем, чтобы не тянуть реальный db.js при импорте роутов
// (тест мокает config без config.database). Публична только точка на Соборном.
vi.mock('../services/studio-status.service.js', () => ({
  getStudiosEffectiveStatus: vi.fn().mockResolvedValue([
    { id: 's-sob', name: 'Своё Фото — Соборный', location_code: 'soborny', address: 'ул. Соборный 21', status: 'open', status_message: null, status_until: null },
  ]),
  STUDIO_SHORT_LABELS: { soborny: 'Соборный 21' },
  isStudioLabelOpen: vi.fn().mockResolvedValue(true),
  resolveOpenProductionLabel: vi.fn(async (label: string) => label),
}));

vi.mock('../services/service-survey-call-queue.service.js', () => ({
  enqueueServiceSurveyCall: vi.fn(),
  scheduleNextQueuedServiceSurveyCall: vi.fn(),
  ServiceSurveyCallStartError: class ServiceSurveyCallStartError extends Error {},
}));

vi.mock('../services/service-survey-realtime-tools.service.js', () => ({
  runServiceSurveyRealtimeTool: runServiceSurveyRealtimeToolMock,
}));

vi.mock('../services/phone-otp-event.service.js', () => ({
  recordPhoneOtpEventSafely: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/telephony-voip-health-monitor.service.js', () => ({
  getTelephonyVoipHealthSnapshot: vi.fn(),
  runTelephonyVoipHealthCheckOnce: vi.fn(),
}));

vi.mock('../services/openai-realtime.service.js', () => ({
  createOpenAiRealtimeClientSecret: createOpenAiRealtimeClientSecretMock,
}));

vi.mock('../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

vi.mock('../middleware/upload-limiter.js', () => ({
  createUploadLimiter: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../websocket/broadcast-to-room.js', () => ({
  broadcastToRoom: vi.fn(),
}));

let app: import('express').Express;
let telephonyService: typeof import('../services/telephony.service.js');
let voximplantService: typeof import('../services/voximplant.service.js');
let serviceSurveyQueue: typeof import('../services/service-survey-call-queue.service.js');
let phoneOtpEventService: typeof import('../services/phone-otp-event.service.js');
let voipHealthMonitor: typeof import('../services/telephony-voip-health-monitor.service.js');
let broadcastModule: typeof import('../websocket/broadcast-to-room.js');

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./telephony.routes.js');
  telephonyService = await import('../services/telephony.service.js');
  voximplantService = await import('../services/voximplant.service.js');
  serviceSurveyQueue = await import('../services/service-survey-call-queue.service.js');
  phoneOtpEventService = await import('../services/phone-otp-event.service.js');
  voipHealthMonitor = await import('../services/telephony-voip-health-monitor.service.js');
  broadcastModule = await import('../websocket/broadcast-to-room.js');
  app = createTestApp(router);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthUserRef.current = {
    id: 'user-1',
    role: 'admin',
    permissions: ['inbox:manage', 'reports:view'],
  };
});

function createCallLog(overrides: Partial<CallLog> = {}): CallLog {
  return {
    id: 'call-1',
    voximplant_session_id: 'session-1',
    direction: 'inbound',
    caller_number: '+79030000000',
    called_number: '+78633226575',
    client_user_id: 'client-1',
    operator_user_id: null,
    status: 'ringing',
    started_at: '2026-05-09T10:00:00.000Z',
    answered_at: null,
    ended_at: null,
    duration_seconds: null,
    recording_url: null,
    notes: null,
    created_at: '2026-05-09T10:00:00.000Z',
    ...overrides,
  };
}

function createCallTranscript(overrides: Partial<CallTranscript> = {}): CallTranscript {
  return {
    id: 'transcript-1',
    call_log_id: 'call-1',
    source: 'voximplant_asr',
    transcript_text: 'Добавьте срочное фото на документы.',
    confidence: 0.92,
    language_code: 'ru-RU',
    is_final: true,
    recording_url: 'https://records.example/call.mp3',
    raw_payload: null,
    created_at: '2026-05-09T10:01:00.000Z',
    ...overrides,
  };
}

function createServiceSurveyResponse(overrides: Partial<ServiceSurveyResponseRow> = {}): ServiceSurveyResponseRow {
  return {
    call_id: 'call-1',
    session_id: 'service-survey-session-1',
    status: 'completed',
    caller_number: '+78633226575',
    called_number: '+79030000000',
    client_user_id: 'client-1',
    client_name: 'Виктория',
    operator_user_id: 'user-1',
    operator_name: 'Администратор',
    started_at: '2026-05-09T10:00:00.000Z',
    answered_at: '2026-05-09T10:00:05.000Z',
    ended_at: '2026-05-09T10:01:00.000Z',
    duration_seconds: 55,
    call_recording_url: 'https://records.example/call.mp3',
    notes: null,
    order_id: 'order-1',
    transcript_id: 'transcript-1',
    transcript_text: 'Добавьте срочное фото на документы.',
    confidence: 0.92,
    language_code: 'ru-RU',
    transcript_recording_url: 'https://records.example/call.mp3',
    transcript_created_at: '2026-05-09T10:01:00.000Z',
    ...overrides,
  };
}

function createServiceSurveyRecording(overrides: Partial<ServiceSurveyRecordingRow> = {}): ServiceSurveyRecordingRow {
  return {
    call_id: 'call-1',
    recording_url: 'https://records.example/call.mp3',
    ...overrides,
  };
}

describe('GET /intercom-route', () => {
  it('базовая карта ведёт оба коротких номера на Соборный', async () => {
    const res = await request(app).get('/intercom-route');
    expect(res.status).toBe(200);
    expect(res.body.route).toEqual({ '1': 'soborny101', '2': 'soborny101' });
  });

  it('пустой статус не меняет маршрут "2" с Соборного', async () => {
    vi.mocked(getStudiosEffectiveStatus).mockResolvedValueOnce([]);
    const res = await request(app).get('/intercom-route');
    expect(res.status).toBe(200);
    expect(res.body.route).toEqual({ '1': 'soborny101', '2': 'soborny101' });
  });
});

describe('POST /incoming-call', () => {
  it('creates or updates inbound call log and broadcasts incoming call', async () => {
    const client = {
      id: 'client-1',
      display_name: 'Client Name',
      phone: '+79030000000',
      email: null,
      orders_count: 2,
    } satisfies ClientLookupResult;

    vi.mocked(telephonyService.lookupClientByPhone).mockResolvedValue(client);
    vi.mocked(telephonyService.createOrUpdateInboundCallLog).mockResolvedValue(createCallLog());

    const res = await request(app)
      .post('/incoming-call')
      .send({
        caller_number: '+79030000000',
        called_number: '+78633226575',
        session_id: 'session-1',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(telephonyService.createOrUpdateInboundCallLog).toHaveBeenCalledWith({
      voximplant_session_id: 'session-1',
      caller_number: '+79030000000',
      called_number: '+78633226575',
      client_user_id: 'client-1',
    });
    expect(broadcastModule.broadcastToRoom).toHaveBeenCalledWith('telephony:incoming_call', 'employee:dashboard', expect.objectContaining({
      callId: 'call-1',
      callerNumber: '+79030000000',
      calledNumber: '+78633226575',
      clientId: 'client-1',
    }));
  });
});

describe('POST /call-event', () => {
  it('records missed inbound calls and returns callback task id', async () => {
    const missedResult = {
      callLog: createCallLog({ status: 'missed', ended_at: '2026-05-09T10:01:00.000Z' }),
      client: null,
      taskId: 'task-1',
      taskNumber: 123,
      createdTask: true,
    } satisfies MissedInboundCallResult;

    vi.mocked(telephonyService.recordMissedInboundCall).mockResolvedValue(missedResult);

    const res = await request(app)
      .post('/call-event')
      .send({
        session_id: 'session-1',
        event: 'missed',
        caller_number: '+79030000000',
        called_number: '+78633226575',
        reason: 'operator_unavailable',
        failure_code: 480,
        failure_name: 'Temporarily Unavailable',
        scenario: 'studio-inbound',
        destination_user: 'soborny101',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      call_id: 'call-1',
      task_id: 'task-1',
      task_number: 123,
      created_task: true,
    });
    expect(telephonyService.recordMissedInboundCall).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'session-1',
      reason: 'operator_unavailable',
      destination_user: 'soborny101',
    }));
    expect(broadcastModule.broadcastToRoom).toHaveBeenCalledWith('telephony:call_event', 'employee:dashboard', expect.objectContaining({
      callId: 'call-1',
      event: 'missed',
      taskId: 'task-1',
    }));
  });

  it('marks non-inbound failed events without creating callback task', async () => {
    vi.mocked(telephonyService.updateCallLogBySession).mockResolvedValue(createCallLog({
      status: 'failed',
      ended_at: '2026-05-09T10:02:00.000Z',
    }));

    const res = await request(app)
      .post('/call-event')
      .send({
        session_id: 'crm-click-session',
        event: 'failed',
        reason: 'operator_timeout',
        scenario: 'studio-outbound',
        destination_user: 'soborny101',
        occurred_at: '2026-05-09T10:02:00.000Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(telephonyService.recordMissedInboundCall).not.toHaveBeenCalled();
    expect(telephonyService.updateCallLogBySession).toHaveBeenCalledWith(
      'crm-click-session',
      expect.objectContaining({
        status: 'failed',
        ended_at: '2026-05-09T10:02:00.000Z',
      }),
    );
    expect(broadcastModule.broadcastToRoom).toHaveBeenCalledWith('telephony:call_event', 'employee:dashboard', expect.objectContaining({
      event: 'failed',
      status: 'failed',
    }));
  });
});

describe('POST /call', () => {
  it('starts operator-first Voximplant click-to-call and stores outbound log', async () => {
    const client = {
      id: 'client-1',
      display_name: 'Client Name',
      phone: '+79030000000',
      email: null,
      orders_count: 2,
    } satisfies ClientLookupResult;

    vi.mocked(telephonyService.lookupClientByPhone).mockResolvedValue(client);
    vi.mocked(telephonyService.createCallLog).mockResolvedValue(createCallLog({
      direction: 'outbound',
      status: 'connecting',
      caller_number: '+78633226575',
      called_number: '+79030000000',
      operator_user_id: 'user-1',
    }));
    vi.mocked(voximplantService.startVoximplantStudioClickToCall).mockResolvedValue({
      success: true,
      requestId: 'request-1',
      callSessionHistoryId: 'history-1',
      callerId: '+78633226575',
      operatorUser: 'soborny101',
    });

    const res = await request(app)
      .post('/call')
      .send({ phone: '+79030000000' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      callId: 'call-1',
      clientName: 'Client Name',
      status: 'connecting',
    });
    expect(telephonyService.createCallLog).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'outbound',
      caller_number: '+78633226575',
      called_number: '+79030000000',
      operator_user_id: 'user-1',
      client_user_id: 'client-1',
      status: 'connecting',
    }));
    expect(voximplantService.startVoximplantStudioClickToCall).toHaveBeenCalledWith(expect.objectContaining({
      destinationPhone: '+79030000000',
      operatorUser: 'soborny101',
      callerId: '+78633226575',
    }));
  });
});

describe('POST /voice-otp/event', () => {
  it('accepts Voximplant callbacks with blank optional fields and records diagnostics', async () => {
    const res = await request(app)
      .post('/voice-otp/event')
      .set('x-svf-voximplant-secret', 'test-voice-otp-secret')
      .send({
        type: 'voice_otp_event',
        event: 'connected',
        sessionId: '4717482792',
        callId: '',
        destination: '+79381137288',
        callerId: '+78633226575',
        eventCode: 200,
        successful: true,
        reason: '',
        timestamp: '2026-05-27T19:00:56.000Z',
        details: {
          code: 200,
          headerNames: ['Call-ID'],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(phoneOtpEventService.recordPhoneOtpEventSafely).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+79381137288',
      eventType: 'voximplant_webhook_event',
      provider: 'voximplant',
      providerRequestId: '4717482792',
      callSessionHistoryId: '4717482792',
      callerId: '+78633226575',
    }));

    const eventInput = vi.mocked(phoneOtpEventService.recordPhoneOtpEventSafely).mock.calls[0]?.[0];
    expect(eventInput?.details).toEqual(expect.objectContaining({
      event: 'connected',
      sessionId: '4717482792',
      eventCode: 200,
      successful: true,
      timestamp: '2026-05-27T19:00:56.000Z',
      eventDetails: {
        code: 200,
        headerNames: ['Call-ID'],
      },
    }));
    expect(eventInput?.details).not.toHaveProperty('callId');
    expect(eventInput?.details).not.toHaveProperty('reason');
  });

  it('accepts playback-start diagnostics for voice OTP audio tracking', async () => {
    const res = await request(app)
      .post('/voice-otp/event')
      .set('x-svf-voximplant-secret', 'test-voice-otp-secret')
      .send({
        type: 'voice_otp_event',
        event: 'playback_started',
        sessionId: 4717482792,
        destination: '+79381137288',
      });

    expect(res.status).toBe(200);
    expect(phoneOtpEventService.recordPhoneOtpEventSafely).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'voximplant_webhook_event',
      providerRequestId: '4717482792',
      details: expect.objectContaining({
        event: 'playback_started',
        sessionId: '4717482792',
      }),
    }));
  });
});

describe('GET /service-survey/responses', () => {
  it('returns service survey responses with transcript metadata', async () => {
    vi.mocked(telephonyService.getServiceSurveyResponses).mockResolvedValue({
      items: [createServiceSurveyResponse()],
      total: 1,
    });

    const res = await request(app)
      .get('/service-survey/responses')
      .query({
        q: 'срочное',
        status: 'completed',
        from: '2026-05-01',
        to: '2026-05-10',
        limit: '25',
        offset: '50',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      total: 1,
      data: [
        {
          call_id: 'call-1',
          status: 'completed',
          transcript_text: 'Добавьте срочное фото на документы.',
          call_recording_url: 'https://records.example/call.mp3',
        },
      ],
    });
    expect(telephonyService.getServiceSurveyResponses).toHaveBeenCalledWith({
      q: 'срочное',
      status: 'completed',
      from: '2026-05-01',
      to: '2026-05-10',
      limit: 25,
      offset: 50,
    });
  });

  it('rejects invalid date filters', async () => {
    const res = await request(app)
      .get('/service-survey/responses')
      .query({ from: '10.05.2026' });

    expect(res.status).toBe(400);
    expect(telephonyService.getServiceSurveyResponses).not.toHaveBeenCalled();
  });

  it('rejects non-admin users even when they have reports permission', async () => {
    mockAuthUserRef.current = {
      id: 'user-2',
      role: 'employee',
      permissions: ['reports:view'],
    };

    const res = await request(app).get('/service-survey/responses');

    expect(res.status).toBe(403);
    expect(telephonyService.getServiceSurveyResponses).not.toHaveBeenCalled();
  });
});

describe('GET /service-survey/responses/:callId/recording', () => {
  it('streams service survey recording through the backend and forwards range requests', async () => {
    vi.mocked(telephonyService.getServiceSurveyRecording).mockResolvedValue(createServiceSurveyRecording({
      recording_url: 'https://93.184.216.34/call.mp3',
    }));
    fetchWithTimeoutMock.mockResolvedValue(new Response('audio-bytes', {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': '11',
        'Content-Range': 'bytes 0-10/11',
        'Content-Type': 'audio/mpeg',
      },
    }));

    const res = await request(app)
      .get('/service-survey/responses/call-1/recording')
      .set('Range', 'bytes=0-10');

    expect(res.status).toBe(206);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['content-range']).toBe('bytes 0-10/11');
    expect(telephonyService.getServiceSurveyRecording).toHaveBeenCalledWith('call-1');

    const firstFetchCall = fetchWithTimeoutMock.mock.calls[0];
    expect(firstFetchCall?.[0]).toBe('https://93.184.216.34/call.mp3');
    const fetchOptions = firstFetchCall?.[1] as RequestInit | undefined;
    if (!fetchOptions || !(fetchOptions.headers instanceof Headers)) {
      throw new Error('Expected Headers instance');
    }
    expect(fetchOptions.method).toBe('GET');
    expect(fetchOptions.redirect).toBe('manual');
    expect(fetchOptions.headers.get('Range')).toBe('bytes=0-10');
  });

  it('returns 404 when the service survey has no recording URL', async () => {
    vi.mocked(telephonyService.getServiceSurveyRecording).mockResolvedValue(createServiceSurveyRecording({
      recording_url: null,
    }));

    const res = await request(app).get('/service-survey/responses/call-1/recording');

    expect(res.status).toBe(404);
    expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
  });

  it('rejects non-admin users', async () => {
    mockAuthUserRef.current = {
      id: 'user-2',
      role: 'employee',
      permissions: ['reports:view'],
    };

    const res = await request(app).get('/service-survey/responses/call-1/recording');

    expect(res.status).toBe(403);
    expect(telephonyService.getServiceSurveyRecording).not.toHaveBeenCalled();
  });
});

describe('POST /service-survey/call', () => {
  it('enqueues a recorded service survey call and starts it when the queue is idle', async () => {
    const orderId = '11111111-1111-4111-8111-111111111111';

    vi.mocked(serviceSurveyQueue.enqueueServiceSurveyCall).mockResolvedValue({
      callLog: createCallLog({
        id: 'call-1',
        voximplant_session_id: 'service-survey-session-1',
        direction: 'outbound',
        status: 'connecting',
        caller_number: '+78633226575',
        called_number: '+79030000000',
        operator_user_id: 'user-1',
      }),
      clientName: 'Client Name',
      sessionId: 'service-survey-session-1',
      status: 'connecting',
      question: 'Что улучшить?',
      queued: false,
      queuePosition: 0,
    });

    const res = await request(app)
      .post('/service-survey/call')
      .send({
        phone: '+79030000000',
        order_id: orderId,
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      callId: 'call-1',
      clientName: 'Client Name',
      status: 'connecting',
      queued: false,
      queuePosition: 0,
    });
    expect(serviceSurveyQueue.enqueueServiceSurveyCall).toHaveBeenCalledWith({
      phone: '+79030000000',
      orderId,
      clientId: undefined,
      operatorUserId: 'user-1',
    });
  });

  it('keeps the service survey call queued when another survey call is active', async () => {
    vi.mocked(serviceSurveyQueue.enqueueServiceSurveyCall).mockResolvedValue({
      callLog: createCallLog({
        id: 'call-2',
        voximplant_session_id: 'service-survey-session-2',
        direction: 'outbound',
        status: 'queued',
        caller_number: '+78633226575',
        called_number: '+79030000001',
        operator_user_id: 'user-1',
      }),
      clientName: null,
      sessionId: 'service-survey-session-2',
      status: 'queued',
      question: 'Что улучшить?',
      queued: true,
      queuePosition: 2,
    });

    const res = await request(app)
      .post('/service-survey/call')
      .send({ phone: '+79030000001' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      callId: 'call-2',
      status: 'queued',
      queued: true,
      queuePosition: 2,
    });
    expect(voximplantService.startVoximplantServiceSurveyCall).not.toHaveBeenCalled();
  });

  it('returns 502 when an idle queue cannot start Voximplant', async () => {
    vi.mocked(serviceSurveyQueue.enqueueServiceSurveyCall).mockRejectedValue(
      new serviceSurveyQueue.ServiceSurveyCallStartError('not configured'),
    );

    const res = await request(app)
      .post('/service-survey/call')
      .send({ phone: '+79030000000' });

    expect(res.status).toBe(502);
  });
});

describe('POST /service-survey/result', () => {
  it('records survey transcript and recording metadata from VoxEngine', async () => {
    const surveyResult = {
      callLog: createCallLog({
        status: 'completed',
        recording_url: 'https://records.example/call.mp3',
      }),
      transcript: createCallTranscript(),
    } satisfies ServiceSurveyResult;

    vi.mocked(telephonyService.recordServiceSurveyResult).mockResolvedValue(surveyResult);

    const res = await request(app)
      .post('/service-survey/result')
      .send({
        session_id: 'service-survey-1',
        event: 'completed',
        caller_number: '+78633226575',
        called_number: '+79030000000',
        transcript: 'Добавьте срочное фото на документы.',
        confidence: 0.92,
        language_code: 'ru-RU',
        recording_url: 'https://records.example/call.mp3',
        duration_seconds: 34,
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      call_id: 'call-1',
      transcript_id: 'transcript-1',
    });
    expect(telephonyService.recordServiceSurveyResult).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'service-survey-1',
      event: 'completed',
      transcript: 'Добавьте срочное фото на документы.',
      recording_url: 'https://records.example/call.mp3',
    }));
    expect(serviceSurveyQueue.scheduleNextQueuedServiceSurveyCall).toHaveBeenCalledWith('completed');
    expect(broadcastModule.broadcastToRoom).toHaveBeenCalledWith('telephony:call_event', 'employee:dashboard', expect.objectContaining({
      callId: 'call-1',
      event: 'completed',
      scenario: 'service_survey',
      transcriptId: 'transcript-1',
      recordingUrl: 'https://records.example/call.mp3',
    }));
  });
});

describe('POST /service-survey/tool', () => {
  it('executes a Grok realtime function call through the service survey tool runner', async () => {
    runServiceSurveyRealtimeToolMock.mockResolvedValue({
      toolName: 'get_service_catalog',
      outcome: 'executed',
      output: '{"categories":[]}',
    });

    const res = await request(app)
      .post('/service-survey/tool')
      .set('x-svf-voximplant-secret', 'test-voice-otp-secret')
      .send({
        session_id: 'service-survey-1',
        tool_name: 'get_service_catalog',
        arguments: '{"query":"визитки"}',
        caller_number: '+78633226575',
        called_number: '+79030000000',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        tool_name: 'get_service_catalog',
        outcome: 'executed',
        output: '{"categories":[]}',
      },
    });
    expect(runServiceSurveyRealtimeToolMock).toHaveBeenCalledWith({
      sessionId: 'service-survey-1',
      toolName: 'get_service_catalog',
      rawArguments: '{"query":"визитки"}',
      callerNumber: '+78633226575',
      calledNumber: '+79030000000',
      trustedIdentity: true,
    });
  });
});

describe('POST /health/voip-phone/check', () => {
  it('runs a manual VoIP health check', async () => {
    vi.mocked(voipHealthMonitor.runTelephonyVoipHealthCheckOnce).mockResolvedValue({
      status: 'healthy',
      targetUser: 'soborny101',
      checkedAt: '2026-05-09T10:00:00.000Z',
      recentFailureCount: 0,
      lastFailureAt: null,
      recoveredIncident: false,
    });

    const res = await request(app)
      .post('/health/voip-phone/check')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(voipHealthMonitor.runTelephonyVoipHealthCheckOnce).toHaveBeenCalledTimes(1);
  });
});

describe('POST /openai/realtime-token', () => {
  it('returns a short-lived OpenAI client secret', async () => {
    vi.mocked(createOpenAiRealtimeClientSecretMock).mockResolvedValue({
      value: 'ek_test',
      expires_at: 1_800_000_000,
      session: {
        id: 'sess_1',
        object: 'realtime.session',
        type: 'realtime',
        model: 'gpt-realtime',
        output_modalities: ['audio'],
      },
    });

    const res = await request(app)
      .post('/openai/realtime-token')
      .send({
        voice: 'alloy',
        instructions: 'Answer briefly.',
        outputModalities: ['audio'],
        ttlSeconds: 300,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(createOpenAiRealtimeClientSecretMock).toHaveBeenCalledWith({
      voice: 'alloy',
      instructions: 'Answer briefly.',
      outputModalities: ['audio'],
      ttlSeconds: 300,
    });
  });

  it('validates ttlSeconds bounds', async () => {
    const res = await request(app)
      .post('/openai/realtime-token')
      .send({ ttlSeconds: 9 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('ttlSeconds');
    expect(createOpenAiRealtimeClientSecretMock).not.toHaveBeenCalled();
  });

  it('requires audio modality when voice is provided', async () => {
    const res = await request(app)
      .post('/openai/realtime-token')
      .send({
        voice: 'alloy',
        outputModalities: ['text'],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('outputModalities');
    expect(createOpenAiRealtimeClientSecretMock).not.toHaveBeenCalled();
  });
});
