import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CrmSearchService, SearchResult } from './crm-search.service';

describe('CrmSearchService', () => {
  let service: CrmSearchService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CrmSearchService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('search()', () => {
    it('GETs /api/crm/search with q param', () => {
      service.search('Иван').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/search');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('q')).toBe('Иван');
      req.flush({ success: true, data: [] });
    });

    it('returns the search results', () => {
      let result: SearchResult[] | undefined;
      service.search('заказ').subscribe(d => (result = d));
      const item: SearchResult = {
        type: 'order', id: 'ord-1', title: 'Заказ #001',
        subtitle: '500 ₽', icon: '📦', route: '/orders/ord-1',
      };
      httpMock.expectOne(r => r.url === '/api/crm/search')
        .flush({ success: true, data: [item] });
      expect(result).toHaveLength(1);
      expect(result![0].type).toBe('order');
    });

    it('returns empty array when no results', () => {
      let result: SearchResult[] | undefined;
      service.search('xyz999').subscribe(d => (result = d));
      httpMock.expectOne(r => r.url === '/api/crm/search')
        .flush({ success: true, data: [] });
      expect(result).toEqual([]);
    });

    it('sends different query values correctly', () => {
      service.search('бронирование').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/search');
      expect(req.request.params.get('q')).toBe('бронирование');
      req.flush({ success: true, data: [] });
    });
  });
});
