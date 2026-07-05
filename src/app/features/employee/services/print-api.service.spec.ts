import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PrintApiService, Printer, PrintJob, CreatePrintJobParams } from './print-api.service';

const makePrinter = (overrides: Partial<Printer> = {}): Printer => ({
  id: 'printer-1',
  name: 'Canon Photo',
  printer_type: 'photo',
  cups_printer_name: 'Canon_SELPHY',
  win_printer_name: 'Canon SELPHY',
  studio_id: 'studio-1',
  capabilities: {
    paper_sizes: [],
    media_types: [],
    quality_modes: [],
    color: true,
    duplex: false,
    borderless: true,
    max_dpi: 300,
  },
  is_active: true,
  ...overrides,
});

const makeJob = (overrides: Partial<PrintJob> = {}): PrintJob => ({
  id: 'job-1',
  printer_id: 'printer-1',
  file_url: 'https://example.com/photo.jpg',
  file_name: 'photo.jpg',
  copies: 1,
  paper_size: '10x15',
  color_mode: 'color',
  quality: 'high',
  duplex: false,
  orientation: 'portrait',
  borderless: true,
  media_type: null,
  fit_mode: 'fit',
  status: 'queued',
  error_message: null,
  order_id: null,
  order_type: null,
  created_by: 'emp-1',
  studio_id: 'studio-1',
  completed_at: null,
  created_at: '2026-01-01T10:00:00Z',
  ...overrides,
});

describe('PrintApiService', () => {
  let service: PrintApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PrintApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── getPrinters ─────────────────────────────────────────────────────────

  describe('getPrinters()', () => {
    it('GETs /api/print/printers without params by default', () => {
      service.getPrinters().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/print/printers');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, printers: [] });
    });

    it('passes studio_id when provided', () => {
      service.getPrinters('studio-1').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/print/printers');
      expect(req.request.params.get('studio_id')).toBe('studio-1');
      req.flush({ success: true, printers: [] });
    });

    it('returns the printers array', () => {
      let result: Printer[] | undefined;
      service.getPrinters().subscribe(p => (result = p));
      httpMock.expectOne(r => r.url === '/api/print/printers')
        .flush({ success: true, printers: [makePrinter()] });
      expect(result).toHaveLength(1);
      expect(result![0].id).toBe('printer-1');
    });
  });

  // ─── getAllPrinters ───────────────────────────────────────────────────────

  describe('getAllPrinters()', () => {
    it('GETs /api/print/printers/all', () => {
      service.getAllPrinters().subscribe();
      const req = httpMock.expectOne('/api/print/printers/all');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, printers: [] });
    });
  });

  // ─── createPrintJob ──────────────────────────────────────────────────────

  describe('createPrintJob()', () => {
    it('POSTs to /api/print/jobs with job params', () => {
      const params: CreatePrintJobParams = {
        printer_id: 'printer-1',
        file_url: 'https://example.com/photo.jpg',
        copies: 2,
        paper_size: '10x15',
        color_mode: 'color',
      };
      service.createPrintJob(params).subscribe();
      const req = httpMock.expectOne('/api/print/jobs');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(params);
      req.flush({ success: true, job: makeJob() });
    });
  });

  // ─── getQueue ────────────────────────────────────────────────────────────

  describe('getQueue()', () => {
    it('GETs /api/print/jobs without filters by default', () => {
      service.getQueue().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/print/jobs');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, jobs: [] });
    });

    it('passes printer_id and status filters', () => {
      service.getQueue({ printer_id: 'printer-1', status: 'queued' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/print/jobs');
      expect(req.request.params.get('printer_id')).toBe('printer-1');
      expect(req.request.params.get('status')).toBe('queued');
      req.flush({ success: true, jobs: [] });
    });

    it('converts limit to string in params', () => {
      service.getQueue({ limit: 20 }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/print/jobs');
      expect(req.request.params.get('limit')).toBe('20');
      req.flush({ success: true, jobs: [] });
    });
  });

  // ─── cancelJob ───────────────────────────────────────────────────────────

  describe('cancelJob()', () => {
    it('POSTs to /api/print/jobs/:id/cancel', () => {
      service.cancelJob('job-1').subscribe();
      const req = httpMock.expectOne('/api/print/jobs/job-1/cancel');
      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  // ─── retryJob ────────────────────────────────────────────────────────────

  describe('retryJob()', () => {
    it('POSTs to /api/print/jobs/:id/retry', () => {
      service.retryJob('job-2').subscribe();
      const req = httpMock.expectOne('/api/print/jobs/job-2/retry');
      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  // ─── createPrinterRecord ─────────────────────────────────────────────────

  describe('createPrinterRecord()', () => {
    it('POSTs to /api/print/printers with printer data', () => {
      const dto = {
        name: 'New Printer', printer_type: 'photo' as const,
        cups_printer_name: 'CUPS_PRINTER',
        win_printer_name: 'WIN_PRINTER',
        capabilities: makePrinter().capabilities,
      };
      service.createPrinterRecord(dto).subscribe();
      const req = httpMock.expectOne('/api/print/printers');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush({ success: true, printer: makePrinter() });
    });
  });

  // ─── deletePrinterRecord ─────────────────────────────────────────────────

  describe('deletePrinterRecord()', () => {
    it('DELETEs /api/print/printers/:id', () => {
      service.deletePrinterRecord('printer-1').subscribe();
      const req = httpMock.expectOne('/api/print/printers/printer-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
