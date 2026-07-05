import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AiCrmApiService, ChatSummary, SuggestedReply, AssignmentSuggestion, PriorityScore } from './ai-crm-api.service';

const makeSummary = (): ChatSummary => ({
  summary: 'Клиент интересуется печатью фото',
  clientIntent: 'заказ',
  keyFacts: ['20 фото', '10×15'],
  sentiment: 'positive',
});

describe('AiCrmApiService', () => {
  let service: AiCrmApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AiCrmApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getChatSummary()', () => {
    it('GETs /api/ai-crm/summary/:sessionId', () => {
      service.getChatSummary('sess-1').subscribe();
      const req = httpMock.expectOne('/api/ai-crm/summary/sess-1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeSummary() });
    });
  });

  describe('getSuggestedReplies()', () => {
    it('GETs /api/ai-crm/suggestions/:sessionId', () => {
      service.getSuggestedReplies('sess-1').subscribe();
      const req = httpMock.expectOne('/api/ai-crm/suggestions/sess-1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] as SuggestedReply[] });
    });
  });

  describe('getAssignmentSuggestions()', () => {
    it('GETs /api/ai-crm/assignment/:taskId', () => {
      service.getAssignmentSuggestions('task-1').subscribe();
      const req = httpMock.expectOne('/api/ai-crm/assignment/task-1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] as AssignmentSuggestion[] });
    });
  });

  describe('autoAssignTask()', () => {
    it('POSTs to /api/ai-crm/auto-assign/:taskId', () => {
      service.autoAssignTask('task-1').subscribe();
      const req = httpMock.expectOne('/api/ai-crm/auto-assign/task-1');
      expect(req.request.method).toBe('POST');
      req.flush({ success: true, data: { assignedTo: 'emp-1' } });
    });
  });

  describe('scorePriority()', () => {
    it('POSTs to /api/ai-crm/priority with title and description', () => {
      service.scorePriority('Срочный заказ', 'Клиент требует 10 фото к завтрашнему дню').subscribe();
      const req = httpMock.expectOne('/api/ai-crm/priority');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.title).toBe('Срочный заказ');
      const result: PriorityScore = { priority: 'urgent', reason: 'Дедлайн', confidence: 0.9 };
      req.flush({ success: true, data: result });
    });
  });

  describe('getFollowUpCandidates()', () => {
    it('GETs /api/ai-crm/follow-up/candidates', () => {
      service.getFollowUpCandidates().subscribe();
      const req = httpMock.expectOne('/api/ai-crm/follow-up/candidates');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });
  });

  describe('getInsights()', () => {
    it('GETs /api/ai-crm/insights', () => {
      service.getInsights().subscribe();
      const req = httpMock.expectOne('/api/ai-crm/insights');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: { forecast: [], recommendations: [], trends: [] } });
    });
  });
});
