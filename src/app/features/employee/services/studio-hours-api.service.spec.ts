import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { StudioHoursApiService, StudioWithHours, StudioWorkingHour } from './studio-hours-api.service';

const makeStudio = (): StudioWithHours => ({
  id: 'studio-1',
  name: 'Студия Собор',
  location_code: 'SOB',
  hours: [],
});

const makeHours = (): StudioWorkingHour[] => [
  { day_of_week: 0, start_time: '09:00', end_time: '19:30', is_open: true },
  { day_of_week: 6, start_time: '10:00', end_time: '18:00', is_open: true },
];

describe('StudioHoursApiService', () => {
  let service: StudioHoursApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(StudioHoursApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getAllStudios()', () => {
    it('GETs /studio-hours and returns array of studios', () => {
      let result: StudioWithHours[] | null = null;
      service.getAllStudios().subscribe(r => (result = r));
      const req = httpMock.expectOne('/studio-hours');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [makeStudio()] });
      expect(result).toHaveLength(1);
      expect(result![0].id).toBe('studio-1');
    });
  });

  describe('getStudioHours()', () => {
    it('GETs /studio-hours/:studioId and returns studio', () => {
      let result: StudioWithHours | null = null;
      service.getStudioHours('studio-1').subscribe(r => (result = r));
      const req = httpMock.expectOne('/studio-hours/studio-1');
      expect(req.request.method).toBe('GET');
      const studio = { ...makeStudio(), hours: makeHours() };
      req.flush({ success: true, data: studio });
      expect(result!.hours).toHaveLength(2);
    });
  });

  describe('updateHours()', () => {
    it('PUTs to /studio-hours/:studioId with hours payload', () => {
      const hours = makeHours();
      let result: StudioWorkingHour[] | null = null;
      service.updateHours('studio-1', hours).subscribe(r => (result = r));
      const req = httpMock.expectOne('/studio-hours/studio-1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ hours });
      req.flush({ success: true, data: hours });
      expect(result).toHaveLength(2);
    });
  });
});
