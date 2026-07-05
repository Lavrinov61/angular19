import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  CoverageAnalysisService,
  CoverageJobState,
  PageCountOutcome,
} from './coverage-analysis.service';

describe('CoverageAnalysisService', () => {
  let service: CoverageAnalysisService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CoverageAnalysisService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('countPages()', () => {
    it('POSTs file_url to /api/print/count-pages and maps success', () => {
      let outcome: PageCountOutcome | undefined;
      service.countPages('https://x/doc.pdf').subscribe(o => (outcome = o));
      const req = httpMock.expectOne('/api/print/count-pages');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.file_url).toBe('https://x/doc.pdf');
      // font_size_delta_pt опускается, если 0
      expect('font_size_delta_pt' in req.request.body).toBe(false);
      req.flush({ success: true, page_count: 9, document_type: 'pdf' });
      expect(outcome).toEqual({ ok: true, result: { page_count: 9, document_type: 'pdf' } });
    });

    it('includes font_size_delta_pt when non-zero (DOCX pagination)', () => {
      service.countPages('https://x/doc.docx', -2).subscribe();
      const req = httpMock.expectOne('/api/print/count-pages');
      expect(req.request.body.font_size_delta_pt).toBe(-2);
      req.flush({ success: true, page_count: 3, document_type: 'docx' });
    });

    it('rounds fractional page_count', () => {
      let outcome: PageCountOutcome | undefined;
      service.countPages('https://x/doc.pdf').subscribe(o => (outcome = o));
      httpMock.expectOne('/api/print/count-pages').flush({ success: true, page_count: 4.6, document_type: 'pdf' });
      expect(outcome).toEqual({ ok: true, result: { page_count: 5, document_type: 'pdf' } });
    });

    it('returns ok:false when success=false — NOT a silent ×1', () => {
      let outcome: PageCountOutcome | undefined;
      service.countPages('https://x/broken.pdf').subscribe(o => (outcome = o));
      httpMock.expectOne('/api/print/count-pages').flush({ success: false, page_count: 0, document_type: 'pdf', error: 'зашифрован' });
      expect(outcome?.ok).toBe(false);
      if (outcome && !outcome.ok) expect(outcome.error).toBe('зашифрован');
    });

    it('returns ok:false when page_count is non-positive — NOT a silent ×1', () => {
      let outcome: PageCountOutcome | undefined;
      service.countPages('https://x/doc.pdf').subscribe(o => (outcome = o));
      httpMock.expectOne('/api/print/count-pages').flush({ success: true, page_count: 0, document_type: 'pdf' });
      expect(outcome?.ok).toBe(false);
    });

    it('returns ok:false on HTTP error — NOT a silent ×1', () => {
      let outcome: PageCountOutcome | undefined;
      service.countPages('https://x/doc.pdf').subscribe(o => (outcome = o));
      httpMock.expectOne('/api/print/count-pages').flush('boom', { status: 422, statusText: 'Unprocessable' });
      expect(outcome?.ok).toBe(false);
    });
  });

  describe('startCoverageJob()', () => {
    it('POSTs CoverageRequest to /start and maps coverage_id', () => {
      let started: { coverage_id: string; status: string } | null | undefined;
      service.startCoverageJob('https://x/doc.pdf', 'a4', { printerId: 'p1', paperSize: 'A4', colorMode: 'bw' })
        .subscribe(s => (started = s));
      const req = httpMock.expectOne('/api/print/analyze-coverage/start');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.file_url).toBe('https://x/doc.pdf');
      expect(req.request.body.paper_format).toBe('a4');
      expect(req.request.body.printer_id).toBe('p1');
      expect(req.request.body.color_mode).toBe('bw');
      req.flush({ success: true, coverage_id: 'cov-abc', status: 'pending' });
      expect(started).toEqual({ coverage_id: 'cov-abc', status: 'pending' });
    });

    it('maps to null on failure (graceful — falls back to fixed tier)', () => {
      let started: { coverage_id: string; status: string } | null | undefined;
      service.startCoverageJob('https://x/doc.pdf').subscribe(s => (started = s));
      httpMock.expectOne('/api/print/analyze-coverage/start').flush('no', { status: 500, statusText: 'Error' });
      expect(started).toBeNull();
    });

    it('omits color_mode when auto', () => {
      service.startCoverageJob('https://x/doc.pdf', 'a4', { colorMode: 'auto' }).subscribe();
      const req = httpMock.expectOne('/api/print/analyze-coverage/start');
      expect('color_mode' in req.request.body).toBe(false);
      req.flush({ success: true, coverage_id: 'cov-1', status: 'pending' });
    });
  });

  describe('getCoverageJob()', () => {
    it('GETs /status/:id and returns the snapshot', () => {
      let state: CoverageJobState | undefined;
      service.getCoverageJob('cov-abc').subscribe(s => (state = s));
      const req = httpMock.expectOne('/api/print/analyze-coverage/status/cov-abc');
      expect(req.request.method).toBe('GET');
      req.flush({ stage: 'analyzing', page_count: 9, analyzed: 6, rendered: 9, document_type: 'pdf' });
      expect(state?.stage).toBe('analyzing');
      expect(state?.analyzed).toBe(6);
    });

    it('maps 404/error to {stage:"gone"}', () => {
      let state: CoverageJobState | undefined;
      service.getCoverageJob('cov-missing').subscribe(s => (state = s));
      httpMock.expectOne('/api/print/analyze-coverage/status/cov-missing').flush('gone', { status: 404, statusText: 'Not Found' });
      expect(state).toEqual({ stage: 'gone' });
    });

    it('url-encodes the coverage id', () => {
      service.getCoverageJob('cov a/b').subscribe();
      const req = httpMock.expectOne('/api/print/analyze-coverage/status/cov%20a%2Fb');
      req.flush({ stage: 'ready' });
    });
  });
});
