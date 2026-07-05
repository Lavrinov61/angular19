import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TelephonyApiService, CallLog, type ServiceSurveyResponseItem } from './telephony-api.service';

const makeCallLog = (overrides: Partial<CallLog> = {}): CallLog => ({
  id: 'call-1',
  voximplant_session_id: null,
  direction: 'inbound',
  caller_number: '+79017654321',
  called_number: '+79014178668',
  client_user_id: null,
  operator_user_id: null,
  client_name: null,
  operator_name: null,
  status: 'completed',
  started_at: '2026-01-01T10:00:00Z',
  answered_at: '2026-01-01T10:00:05Z',
  ended_at: '2026-01-01T10:05:00Z',
  duration_seconds: 295,
  recording_url: null,
  notes: null,
  ...overrides,
});

const makeServiceSurveyResponse = (
  overrides: Partial<ServiceSurveyResponseItem> = {},
): ServiceSurveyResponseItem => ({
  call_id: 'call-1',
  session_id: 'service-survey-session-1',
  status: 'completed',
  caller_number: '+78633226575',
  called_number: '+79017654321',
  client_user_id: 'client-1',
  client_name: 'Виктория',
  operator_user_id: 'user-1',
  operator_name: 'Администратор',
  started_at: '2026-05-09T10:00:00Z',
  answered_at: '2026-05-09T10:00:05Z',
  ended_at: '2026-05-09T10:01:00Z',
  duration_seconds: 55,
  call_recording_url: 'https://records.example/call.mp3',
  notes: null,
  order_id: 'order-1',
  transcript_id: 'transcript-1',
  transcript_text: 'Добавьте срочное фото на документы.',
  confidence: 0.92,
  language_code: 'ru-RU',
  transcript_recording_url: 'https://records.example/call.mp3',
  transcript_created_at: '2026-05-09T10:01:00Z',
  ...overrides,
});

describe('TelephonyApiService', () => {
  let service: TelephonyApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TelephonyApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('makeCall()', () => {
    it('POSTs to /api/telephony/call with phone number', () => {
      service.makeCall('+79017654321').subscribe();
      const req = httpMock.expectOne('/api/telephony/call');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ phone: '+79017654321' });
      req.flush({ success: true, data: { callId: 'call-1', clientName: 'Иван' } });
    });
  });

  describe('startServiceSurveyCall()', () => {
    it('POSTs to /api/telephony/service-survey/call with phone number', () => {
      service.startServiceSurveyCall({ phone: '+79017654321' }).subscribe();
      const req = httpMock.expectOne('/api/telephony/service-survey/call');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ phone: '+79017654321' });
      req.flush({
        success: true,
        data: {
          callId: 'call-1',
          clientName: 'Иван',
          sessionId: 'service-survey-session',
          status: 'connecting',
          question: 'Что добавить?',
          queued: false,
          queuePosition: 0,
        },
      });
    });
  });

  describe('getCallHistory()', () => {
    it('GETs /api/telephony/calls without filters', () => {
      service.getCallHistory().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/telephony/calls');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [], total: 0 });
    });

    it('passes filter params when provided', () => {
      service.getCallHistory({ direction: 'inbound', limit: 20 }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/telephony/calls');
      expect(req.request.params.get('direction')).toBe('inbound');
      expect(req.request.params.get('limit')).toBe('20');
      req.flush({ success: true, data: [makeCallLog()], total: 1 });
    });
  });

  describe('getCallById()', () => {
    it('GETs /api/telephony/calls/:id', () => {
      service.getCallById('call-1').subscribe();
      const req = httpMock.expectOne('/api/telephony/calls/call-1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeCallLog() });
    });
  });

  describe('getServiceSurveyResponses()', () => {
    it('GETs service survey transcript list with filters', () => {
      service.getServiceSurveyResponses({
        q: 'срочное',
        status: 'completed',
        from: '2026-05-01',
        to: '2026-05-10',
        limit: 25,
        offset: 50,
      }).subscribe();

      const req = httpMock.expectOne(r => r.url === '/api/telephony/service-survey/responses');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('q')).toBe('срочное');
      expect(req.request.params.get('status')).toBe('completed');
      expect(req.request.params.get('from')).toBe('2026-05-01');
      expect(req.request.params.get('to')).toBe('2026-05-10');
      expect(req.request.params.get('limit')).toBe('25');
      expect(req.request.params.get('offset')).toBe('50');
      req.flush({ success: true, data: [makeServiceSurveyResponse()], total: 1 });
    });
  });

  describe('serviceSurveyRecordingUrl()', () => {
    it('builds the backend recording stream URL', () => {
      expect(service.serviceSurveyRecordingUrl('call/1')).toBe(
        '/api/telephony/service-survey/responses/call%2F1/recording',
      );
    });
  });

  describe('getServiceSurveyRecording()', () => {
    it('GETs the backend recording stream as a blob', () => {
      service.getServiceSurveyRecording('call/1').subscribe();

      const req = httpMock.expectOne('/api/telephony/service-survey/responses/call%2F1/recording');
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['audio']));
    });
  });

  describe('linkCall()', () => {
    it('POSTs to /api/telephony/calls/:id/link with entity data', () => {
      service.linkCall('call-1', 'order', 'ord-42').subscribe();
      const req = httpMock.expectOne('/api/telephony/calls/call-1/link');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ entity_type: 'order', entity_id: 'ord-42' });
      req.flush({ success: true });
    });
  });

  describe('createOpenAiRealtimeToken()', () => {
    it('POSTs token config to /api/telephony/openai/realtime-token', () => {
      service.createOpenAiRealtimeToken({
        voice: 'alloy',
        instructions: 'Answer briefly.',
        outputModalities: ['audio'],
        ttlSeconds: 300,
      }).subscribe();

      const req = httpMock.expectOne('/api/telephony/openai/realtime-token');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        voice: 'alloy',
        instructions: 'Answer briefly.',
        outputModalities: ['audio'],
        ttlSeconds: 300,
      });
      req.flush({
        success: true,
        data: {
          value: 'ek_test',
          expires_at: 1_800_000_000,
          session: {
            id: 'sess_1',
            object: 'realtime.session',
            type: 'realtime',
            model: 'gpt-realtime',
            output_modalities: ['audio'],
          },
        },
      });
    });
  });
});
