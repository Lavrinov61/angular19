import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TasksApiService, WorkTask } from './tasks-api.service';

const makeTask = (overrides: Partial<WorkTask> = {}): WorkTask => ({
  id: 'task-1',
  task_number: 42,
  task_type: 'photo_order',
  priority: 'normal',
  status: 'open',
  title: 'Test task',
  created_at: '2025-01-01T10:00:00Z',
  updated_at: '2025-01-01T10:00:00Z',
  ...overrides,
});

const okEnvelope = (data: unknown) => ({ success: true, data });

describe('TasksApiService', () => {
  let service: TasksApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TasksApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ─── getTaskList ─────────────────────────────────────────────────────────

  describe('getTaskList()', () => {
    it('GETs /api/tasks with no params when called without arguments', () => {
      service.getTaskList().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/tasks');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, data: [], total: 0, page: 1, limit: 50 });
    });

    it('adds all provided filter params to the query string', () => {
      service.getTaskList({ status: 'open', priority: 'urgent', page: 2, limit: 20 }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/tasks');
      expect(req.request.params.get('status')).toBe('open');
      expect(req.request.params.get('priority')).toBe('urgent');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('limit')).toBe('20');
      req.flush({ success: true, data: [], total: 0, page: 2, limit: 20 });
    });

    it('does NOT add undefined params to the query string', () => {
      service.getTaskList({ status: 'open', studio_id: undefined }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/tasks');
      expect(req.request.params.has('studio_id')).toBe(false);
      req.flush({ success: true, data: [], total: 0, page: 1, limit: 50 });
    });
  });

  // ─── getTask ──────────────────────────────────────────────────────────────

  describe('getTask()', () => {
    it('GETs /api/tasks/:id', () => {
      service.getTask('task-99').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-99');
      expect(req.request.method).toBe('GET');
      req.flush(okEnvelope(makeTask({ id: 'task-99' })));
    });
  });

  // ─── getBoard ────────────────────────────────────────────────────────────

  describe('getBoard()', () => {
    it('GETs /api/tasks/board with no params by default', () => {
      service.getBoard().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/tasks/board');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush(okEnvelope({ open: [], assigned: [], in_progress: [], waiting: [], handed_off: [] }));
    });

    it('adds studio_id param when provided', () => {
      service.getBoard('studio-5').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/tasks/board');
      expect(req.request.params.get('studio_id')).toBe('studio-5');
      req.flush(okEnvelope({ open: [], assigned: [], in_progress: [], waiting: [], handed_off: [] }));
    });
  });

  // ─── getMyTasks ──────────────────────────────────────────────────────────

  describe('getMyTasks()', () => {
    it('GETs /api/tasks/my', () => {
      service.getMyTasks().subscribe();
      const req = httpMock.expectOne('/api/tasks/my');
      expect(req.request.method).toBe('GET');
      req.flush(okEnvelope([]));
    });
  });

  // ─── createTask ──────────────────────────────────────────────────────────

  describe('createTask()', () => {
    it('POSTs to /api/tasks with the task payload', () => {
      const partial: Partial<WorkTask> = { title: 'New task', task_type: 'walk_in', priority: 'high' };
      service.createTask(partial).subscribe();

      const req = httpMock.expectOne('/api/tasks');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(partial);
      req.flush(okEnvelope(makeTask(partial)));
    });
  });

  // ─── updateTask ──────────────────────────────────────────────────────────

  describe('updateTask()', () => {
    it('PUTs to /api/tasks/:id with the update payload', () => {
      const updates: Partial<WorkTask> = { status: 'in_progress', priority: 'urgent' };
      service.updateTask('task-7', updates).subscribe();

      const req = httpMock.expectOne('/api/tasks/task-7');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updates);
      req.flush(okEnvelope(makeTask({ id: 'task-7', ...updates })));
    });
  });

  // ─── updateStatus ────────────────────────────────────────────────────────

  describe('updateStatus()', () => {
    it('PUTs to /api/tasks/:id/status with { status }', () => {
      service.updateStatus('task-8', 'completed').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-8/status');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ status: 'completed' });
      req.flush(okEnvelope(makeTask({ status: 'completed' })));
    });
  });

  // ─── assignTask ──────────────────────────────────────────────────────────

  describe('assignTask()', () => {
    it('PUTs to /api/tasks/:id/assign with { assigned_to }', () => {
      service.assignTask('task-10', 'user-55').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-10/assign');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ assigned_to: 'user-55' });
      req.flush(okEnvelope(makeTask({ assigned_to: 'user-55' })));
    });

    it('sends null to unassign a task', () => {
      service.assignTask('task-10', null).subscribe();
      const req = httpMock.expectOne('/api/tasks/task-10/assign');
      expect(req.request.body).toEqual({ assigned_to: null });
      req.flush(okEnvelope(makeTask()));
    });
  });

  // ─── addNote ─────────────────────────────────────────────────────────────

  describe('addNote()', () => {
    it('POSTs to /api/tasks/:id/notes with content and default note_type "comment"', () => {
      service.addNote('task-1', 'Note text').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-1/notes');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ content: 'Note text', note_type: 'comment' });
      req.flush(okEnvelope({ id: 'note-1', task_id: 'task-1', author_id: 'u1', note_type: 'comment', content: 'Note text', created_at: '' }));
    });

    it('uses the provided noteType when supplied', () => {
      service.addNote('task-1', 'Status changed', 'status_change').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-1/notes');
      expect(req.request.body.note_type).toBe('status_change');
      req.flush(okEnvelope({}));
    });
  });

  // ─── handoffTask ─────────────────────────────────────────────────────────

  describe('handoffTask()', () => {
    it('POSTs to /api/tasks/:id/handoff with handoff_note and optional to_employee_id', () => {
      service.handoffTask('task-5', 'Handoff note', 'emp-99').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-5/handoff');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ handoff_note: 'Handoff note', to_employee_id: 'emp-99' });
      req.flush(okEnvelope({}));
    });

    it('sends undefined to_employee_id when omitted', () => {
      service.handoffTask('task-5', 'Note only').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-5/handoff');
      expect(req.request.body).toEqual({ handoff_note: 'Note only', to_employee_id: undefined });
      req.flush(okEnvelope({}));
    });
  });

  // ─── getAnalytics ─────────────────────────────────────────────────────────

  describe('getAnalytics()', () => {
    it('GETs /api/tasks/analytics with no params by default', () => {
      service.getAnalytics().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/tasks/analytics');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush(okEnvelope({}));
    });

    it('adds date_from, date_to, studio_id, employee_id when provided', () => {
      service.getAnalytics({ date_from: '2025-01-01', date_to: '2025-01-31', employee_id: 'emp-1' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/tasks/analytics');
      expect(req.request.params.get('date_from')).toBe('2025-01-01');
      expect(req.request.params.get('date_to')).toBe('2025-01-31');
      expect(req.request.params.get('employee_id')).toBe('emp-1');
      req.flush(okEnvelope({}));
    });

    it('omits undefined params from the query string', () => {
      service.getAnalytics({ date_from: '2025-01-01', studio_id: undefined }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/tasks/analytics');
      expect(req.request.params.has('studio_id')).toBe(false);
      req.flush(okEnvelope({}));
    });
  });

  // ─── getClientContext ────────────────────────────────────────────────────

  describe('getClientContext()', () => {
    it('GETs /api/tasks/:id/client-context', () => {
      service.getClientContext('task-3').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-3/client-context');
      expect(req.request.method).toBe('GET');
      req.flush(okEnvelope(null));
    });
  });

  // ─── linkTask / unlinkTask ───────────────────────────────────────────────

  describe('linkTask()', () => {
    it('POSTs to /api/tasks/:id/link with target and link_type', () => {
      service.linkTask('task-1', 'task-2', 'duplicate').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-1/link');
      expect(req.request.body).toEqual({ target_task_id: 'task-2', link_type: 'duplicate' });
      req.flush(okEnvelope({}));
    });

    it('defaults link_type to "related"', () => {
      service.linkTask('task-1', 'task-2').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-1/link');
      expect(req.request.body.link_type).toBe('related');
      req.flush(okEnvelope({}));
    });
  });

  describe('unlinkTask()', () => {
    it('DELETEs /api/tasks/:taskId/link/:linkId', () => {
      service.unlinkTask('task-1', 'link-99').subscribe();
      const req = httpMock.expectOne('/api/tasks/task-1/link/link-99');
      expect(req.request.method).toBe('DELETE');
      req.flush(okEnvelope({}));
    });
  });
});
