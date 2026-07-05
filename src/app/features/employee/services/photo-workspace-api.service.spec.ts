import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PhotoWorkspaceApiService } from './photo-workspace-api.service';

describe('PhotoWorkspaceApiService', () => {
  let service: PhotoWorkspaceApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PhotoWorkspaceApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a workspace item', () => {
    service.createItem('order-1', {
      sourceAssetUrl: '/media/source.jpg',
      sourceAssetName: 'Фото',
      tariffLevel: 'basic',
    }).subscribe();

    const req = http.expectOne('/api/photo-workspace/orders/order-1/items');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      sourceAssetUrl: '/media/source.jpg',
      sourceAssetName: 'Фото',
      tariffLevel: 'basic',
    });
    req.flush({ success: true, data: { id: 'item-1' } });
  });
});
