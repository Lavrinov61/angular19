import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RetouchApiService } from './retouch-api.service';

describe('RetouchApiService', () => {
  let service: RetouchApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RetouchApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the retouch queue from the backend queue endpoint', () => {
    service.getQueue({ order_id: 'CRM-260630-JWBF' }).subscribe();

    const req = http.expectOne(request =>
      request.method === 'GET'
      && request.url === '/api/retouch/queue'
      && request.params.get('order_id') === 'CRM-260630-JWBF',
    );
    req.flush({ success: true, data: [] });
  });
});
