import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchPrintDialogComponent } from './batch-print-dialog.component';
import { PrintApiService } from '../../services/print-api.service';
import { PricingApiService } from '../../../../core/services/pricing-api.service';
import { ToastService } from '../../../../core/services/toast.service';
import {
  CoverageAnalysisService,
  type CoverageJobStartResult,
  type CoverageJobState,
  type CoverageResult,
} from '../../services/coverage-analysis.service';

/**
 * Поведенческие тесты фоновой coverage-задачи документа (slice S1).
 * Регрессия 3345adaa: coverageJobKey ставился ДО resetCoverageJobCancel, который его
 * удалял в том же синхронном вызове → гард в switchMap всегда давал EMPTY → поллинг
 * /status не стартовал НИ РАЗУ (прод: 738× POST /start, 0× GET /status).
 *
 * Компонент инстанцируется БЕЗ detectChanges()/ngOnInit (паттерн billing-спека).
 * Методы вызываются напрямую, фейковые таймеры прокручивают timer(0, 1000).
 */

const printApiMock = {
  getPrinters: vi.fn(() => of([])),
  getPresets: vi.fn(() => of([])),
  getPrinterStatuses: vi.fn(() => of({ printers: [] })),
  // Превью-пайплайн (documentPreviewRefreshEffect) может задеться при прокрутке таймеров —
  // глушим, чтобы он не падал на undefined и не зашумлял тест поллинга coverage.
  requestPreview: vi.fn(() => of({ preview_id: 'pv-1', status: 'queued' })),
  getPreviewImage: vi.fn(() => of(null)),
};

const pricingApiMock = {
  categories: signal([]),
  loading: signal(false),
  loadCategories: vi.fn(),
  resolveOptionPrice: vi.fn(() => 0),
};

const toastMock = { error: vi.fn(), success: vi.fn() };

type AnyRow = Record<string, unknown>;

function makeDocRow(overrides: AnyRow = {}): AnyRow {
  return {
    file: { msgId: 'm1', url: 'https://x/doc.pdf', name: 'doc.pdf', type: 'file' },
    printer_id: 'p1',
    paper_size: 'A4',
    media_type: 'plain',
    paper_source: 'auto',
    copies: 1,
    page_range: '',
    font_size_delta_pt: 0,
    price: 10,
    fit_mode: 'fit',
    borderless: false,
    color_mode: 'bw',
    duplex: false,
    quality: 'high',
    rotation: 0,
    crop_rect: null,
    photo_enhance: false,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    image_width: null,
    image_height: null,
    coverage_result: null,
    coverage_loading: false,
    coverage_overridden: false,
    page_count: null,
    page_count_loading: false,
    page_count_failed: false,
    coverage_progress: null,
    edit_key: 0,
    ...overrides,
  };
}

const READY_RESULT: CoverageResult = {
  coverage_percent: 42,
  coverage_cmyk: { c: 0, m: 0, y: 0, k: 42 },
  recommended_slug: 'km-а4-до-75',
  recommended_price: '12.00',
  recommended_name: 'А4 до 75%',
  tier: '75',
  page_count: 3,
};

interface CoverageServiceMock {
  startCoverageJob: ReturnType<typeof vi.fn>;
  getCoverageJob: ReturnType<typeof vi.fn>;
  analyzeCoverage: ReturnType<typeof vi.fn>;
  countPages: ReturnType<typeof vi.fn>;
}

function createComponent(coverageMock: CoverageServiceMock): {
  comp: BatchPrintDialogComponent;
  setRows: (rows: AnyRow[]) => void;
} {
  TestBed.configureTestingModule({
    imports: [BatchPrintDialogComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PrintApiService, useValue: printApiMock },
      { provide: PricingApiService, useValue: pricingApiMock },
      { provide: ToastService, useValue: toastMock },
      { provide: CoverageAnalysisService, useValue: coverageMock },
    ],
  });
  const fixture = TestBed.createComponent(BatchPrintDialogComponent);
  const comp = fixture.componentInstance;
  // Доступ к приватным методам для стабов (компонент огромный, типы приватны).
  const internals = comp as unknown as Record<string, (...args: unknown[]) => unknown>;
  // НЕ вызываем detectChanges()/ngOnInit — иначе запустятся effects/HTTP.
  // shouldAnalyzeCoverageForRow стабим в true: тест проверяет логику поллинга,
  // а не резолв принтера/формата.
  vi.spyOn(internals, 'shouldAnalyzeCoverageForRow').mockReturnValue(true);
  vi.spyOn(internals, 'getFixedPriceForRow').mockReturnValue(10);
  // initRows пересобирает rows из пустых dialog-data; при прокрутке таймеров Angular
  // флашит dataRowsResetEffect и затирает выставленные тестом строки. Глушим no-op.
  vi.spyOn(internals, 'initRows').mockImplementation(() => undefined);
  const setRows = (rows: AnyRow[]) =>
    (comp as unknown as { rows: { set: (v: unknown) => void } }).rows.set(rows);
  return { comp, setRows };
}

function getRow(comp: BatchPrintDialogComponent, index = 0): AnyRow {
  return (comp as unknown as { rows: () => AnyRow[] }).rows()[index];
}

describe('BatchPrintDialogComponent — coverage polling (S1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('(а) после успешного start ОПРАШИВАЕТ status и применяет coverage_result к строке', () => {
    const start: CoverageJobStartResult = { coverage_id: 'cov-1', status: 'queued' };
    const ready: CoverageJobState = { stage: 'ready', result: READY_RESULT, page_count: 3 };
    const coverageMock: CoverageServiceMock = {
      startCoverageJob: vi.fn(() => of(start)),
      getCoverageJob: vi.fn(() => of(ready)),
      analyzeCoverage: vi.fn(() => of(null)),
      countPages: vi.fn(() => of({ ok: false, error: 'n/a' })),
    };
    const { comp, setRows } = createComponent(coverageMock);
    setRows([makeDocRow()]);

    (comp as unknown as { triggerCoverageForRow: (i: number) => void }).triggerCoverageForRow(0);
    // timer(0, 1000): первый тик на 0мс → getCoverageJob вызывается.
    vi.advanceTimersByTime(0);

    // Доказательство фикса: поллинг РЕАЛЬНО стартовал (раньше был 0 вызовов).
    expect(coverageMock.startCoverageJob).toHaveBeenCalledTimes(1);
    expect(coverageMock.getCoverageJob).toHaveBeenCalledWith('cov-1');

    // Результат применён к строке: цена стала льготным тиром (12), coverage_result проставлен.
    const row = getRow(comp);
    expect((row['coverage_result'] as CoverageResult | null)?.tier).toBe('75');
    expect(row['price']).toBe(12);
    expect(row['coverage_loading']).toBe(false);
  });

  it('(б) повторный triggerCoverageForRow с ТЕМ ЖЕ ключом во время активного job НЕ убивает поллинг', () => {
    const start: CoverageJobStartResult = { coverage_id: 'cov-1', status: 'queued' };
    const ready: CoverageJobState = { stage: 'ready', result: READY_RESULT, page_count: 3 };
    // Первый getCoverageJob ещё «не готов» (analyzing), второй — ready.
    const analyzing: CoverageJobState = { stage: 'analyzing', page_count: 3, analyzed: 1 };
    const coverageMock: CoverageServiceMock = {
      startCoverageJob: vi.fn(() => of(start)),
      getCoverageJob: vi
        .fn()
        .mockReturnValueOnce(of(analyzing))
        .mockReturnValue(of(ready)),
      analyzeCoverage: vi.fn(() => of(null)),
      countPages: vi.fn(() => of({ ok: false, error: 'n/a' })),
    };
    const { comp, setRows } = createComponent(coverageMock);
    setRows([makeDocRow()]);

    (comp as unknown as { triggerCoverageForRow: (i: number) => void }).triggerCoverageForRow(0);
    vi.advanceTimersByTime(0); // первый тик → analyzing

    // Имитируем повторный триггер (например, applyPhotoOrderHint → triggerCoverageForRows)
    // с теми же настройками, пока job ещё летит (coverage_loading=true).
    (comp as unknown as { triggerCoverageForRow: (i: number) => void }).triggerCoverageForRow(0);

    // Дедуп: повторный триггер НЕ запустил второй start.
    expect(coverageMock.startCoverageJob).toHaveBeenCalledTimes(1);

    // Поллинг продолжается → следующий тик отдаёт ready, результат применяется.
    vi.advanceTimersByTime(1000);
    const row = getRow(comp);
    expect((row['coverage_result'] as CoverageResult | null)?.tier).toBe('75');
    expect(row['price']).toBe(12);
  });

  it('(в) смена настроек (другой jobKey) отменяет старый job и запускает новый поллинг', () => {
    const start1: CoverageJobStartResult = { coverage_id: 'cov-1', status: 'queued' };
    const start2: CoverageJobStartResult = { coverage_id: 'cov-2', status: 'queued' };
    const pending: CoverageJobState = { stage: 'analyzing', page_count: 3, analyzed: 0 };
    const ready: CoverageJobState = { stage: 'ready', result: READY_RESULT, page_count: 3 };
    const coverageMock: CoverageServiceMock = {
      startCoverageJob: vi
        .fn()
        .mockReturnValueOnce(of(start1))
        .mockReturnValueOnce(of(start2)),
      getCoverageJob: vi
        .fn()
        .mockReturnValueOnce(of(pending)) // cov-1 ещё не готов
        .mockReturnValue(of(ready)), // cov-2 → ready
      analyzeCoverage: vi.fn(() => of(null)),
      countPages: vi.fn(() => of({ ok: false, error: 'n/a' })),
    };
    const { comp, setRows } = createComponent(coverageMock);
    setRows([makeDocRow({ color_mode: 'bw' })]);

    (comp as unknown as { triggerCoverageForRow: (i: number) => void }).triggerCoverageForRow(0);
    vi.advanceTimersByTime(0); // cov-1 первый тик → pending

    // РЕАЛЬНАЯ смена настроек строки (color_mode bw→color) → другой coverageRequestKey.
    setRows([makeDocRow({ color_mode: 'color' })]);
    (comp as unknown as { triggerCoverageForRow: (i: number) => void }).triggerCoverageForRow(0);
    vi.advanceTimersByTime(0); // cov-2 первый тик → ready

    // Новый job запущен (дедуп НЕ сработал — ключ изменился).
    expect(coverageMock.startCoverageJob).toHaveBeenCalledTimes(2);
    expect(coverageMock.getCoverageJob).toHaveBeenCalledWith('cov-2');

    // Результат cov-2 применён к актуальной (color) строке.
    const row = getRow(comp);
    expect(row['color_mode']).toBe('color');
    expect((row['coverage_result'] as CoverageResult | null)?.tier).toBe('75');
  });
});
