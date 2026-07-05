import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsersApiService, StaffUser, CreateUserDto } from './users-api.service';

const makeUser = (overrides: Partial<StaffUser> = {}): StaffUser => ({
  id: 'user-1',
  email: 'ivan@example.com',
  display_name: 'Иван Иванов',
  first_name: 'Иван',
  last_name: 'Иванов',
  department: null,
  phone: '+79001234567',
  role: 'employee',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('UsersApiService', () => {
  let service: UsersApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsersApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── getUsers ─────────────────────────────────────────────────────────────

  describe('getUsers()', () => {
    it('GETs /api/users/ without filters by default', () => {
      service.getUsers().subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/users/'));
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });

    it('appends role filter to query string', () => {
      service.getUsers({ role: 'employee' }).subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/users/'));
      expect(req.request.urlWithParams).toContain('role=employee');
      req.flush({ success: true, data: [] });
    });

    it('appends search filter to query string', () => {
      service.getUsers({ search: 'Иван' }).subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/users/'));
      expect(req.request.urlWithParams).toContain('search=');
      req.flush({ success: true, data: [] });
    });

    it('appends is_active filter', () => {
      service.getUsers({ is_active: false }).subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/users/'));
      expect(req.request.urlWithParams).toContain('is_active=false');
      req.flush({ success: true, data: [] });
    });

    it('returns the users array', () => {
      let result: StaffUser[] | undefined;
      service.getUsers().subscribe(u => (result = u));
      httpMock.expectOne(r => r.url.startsWith('/api/users/')).flush({ success: true, data: [makeUser()] });
      expect(result).toHaveLength(1);
      expect(result![0].id).toBe('user-1');
    });
  });

  // ─── createUser ──────────────────────────────────────────────────────────

  describe('createUser()', () => {
    it('POSTs to /api/users with the user data', () => {
      const dto: CreateUserDto = {
        email: 'new@example.com',
        first_name: 'Новый',
        display_name: 'Новый',
        role: 'employee',
        password: 'secret123',
      };
      service.createUser(dto).subscribe();
      const req = httpMock.expectOne('/api/users');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush({ success: true, data: makeUser() });
    });
  });

  // ─── updateUser ──────────────────────────────────────────────────────────

  describe('updateUser()', () => {
    it('PUTs to /api/users/:id with update data', () => {
      service.updateUser('user-1', { display_name: 'Обновлено', is_active: false }).subscribe();
      const req = httpMock.expectOne('/api/users/user-1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ display_name: 'Обновлено', is_active: false });
      req.flush({ success: true, data: makeUser({ display_name: 'Обновлено' }) });
    });
  });

  // ─── deactivateUser ──────────────────────────────────────────────────────

  describe('deactivateUser()', () => {
    it('DELETEs /api/users/:id', () => {
      service.deactivateUser('user-1').subscribe();
      const req = httpMock.expectOne('/api/users/user-1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true, data: makeUser({ is_active: false }) });
    });
  });
});
