import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { BatchPrintDialogComponent } from './batch-print-dialog.component';
import { PrintApiService } from '../../services/print-api.service';
import { PricingApiService } from '../../../../core/services/pricing-api.service';
import { ToastService } from '../../../../core/services/toast.service';

/**
 * Поведенческие тесты денежного пути batch-print-dialog (slice S2).
 * Компонент инстанцируется БЕЗ detectChanges()/ngOnInit — эффекты и HTTP не запускаются,
 * методы вызываются напрямую. rows/printers ставятся через приватные signals.
 */

const printApiMock = {
  getPrinters: vi.fn(() => of([])),
  getPresets: vi.fn(() => of([])),
  getPrinterStatuses: vi.fn(() => of({ printers: [] })),
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

function createComponent(): { comp: BatchPrintDialogComponent; setRows: (rows: AnyRow[]) => void } {
  TestBed.configureTestingModule({
    imports: [BatchPrintDialogComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PrintApiService, useValue: printApiMock },
      { provide: PricingApiService, useValue: pricingApiMock },
      { provide: ToastService, useValue: toastMock },
    ],
  });
  const fixture = TestBed.createComponent(BatchPrintDialogComponent);
  const comp = fixture.componentInstance;
  // НЕ вызываем detectChanges()/ngOnInit — иначе запустятся effects/HTTP.
  const setRows = (rows: AnyRow[]) => (comp as unknown as { rows: { set: (v: unknown) => void } }).rows.set(rows);
  return { comp, setRows };
}

describe('BatchPrintDialogComponent — billing money path (S2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  describe('rowTotal()', () => {
    it('документ с известным page_count считает price × N × copies (НЕ ×1, НЕ 0)', () => {
      const { comp } = createComponent();
      // coverage упал (coverage_result=null), но быстрый count дал 9 страниц.
      const row = makeDocRow({ page_count: 9, price: 10, copies: 2, page_count_failed: true });
      expect(comp.rowTotal(row as never)).toBe(180); // 10 × 9 × 2
    });

    it('документ с неизвестным числом страниц → 0 (цена не финализируется как ×1)', () => {
      const { comp } = createComponent();
      const row = makeDocRow({ page_count: null, price: 10, copies: 2, page_count_loading: true });
      expect(comp.rowTotal(row as never)).toBe(0);
    });

    it('failed-count + валидный ручной диапазон «1-9» → цена за 9 страниц', () => {
      const { comp } = createComponent();
      const row = makeDocRow({ page_count: null, page_count_failed: true, page_range: '1-9', price: 10, copies: 1 });
      expect(comp.rowTotal(row as never)).toBe(90);
    });
  });

  describe('toCoveragePriceNumber()', () => {
    it('парсит строку BigDecimal "10.00" → 10', () => {
      const { comp } = createComponent();
      const fn = (comp as unknown as { toCoveragePriceNumber: (v: unknown) => number }).toCoveragePriceNumber;
      expect(fn.call(comp, '10.00')).toBe(10);
    });

    it('парсит строку "12" → 12', () => {
      const { comp } = createComponent();
      const fn = (comp as unknown as { toCoveragePriceNumber: (v: unknown) => number }).toCoveragePriceNumber;
      expect(fn.call(comp, '12')).toBe(12);
    });

    it('парсит запятую-разделитель "10,50" → 10.5', () => {
      const { comp } = createComponent();
      const fn = (comp as unknown as { toCoveragePriceNumber: (v: unknown) => number }).toCoveragePriceNumber;
      expect(fn.call(comp, '10,50')).toBe(10.5);
    });
  });

  describe('isRowTotalReady()', () => {
    it('false при неизвестном числе страниц (N=0)', () => {
      const { comp } = createComponent();
      const row = makeDocRow({ page_count: null, page_count_loading: true });
      expect(comp.isRowTotalReady(row as never)).toBe(false);
    });

    it('true при failed-count + валидном ручном диапазоне «1-9»', () => {
      const { comp } = createComponent();
      const row = makeDocRow({ page_count: null, page_count_failed: true, page_range: '1-9' });
      expect(comp.isRowTotalReady(row as never)).toBe(true);
    });

    it('true для изображения всегда', () => {
      const { comp } = createComponent();
      const row = makeDocRow({ file: { msgId: 'i', url: 'https://x/p.jpg', name: 'p.jpg', type: 'image' } });
      expect(comp.isRowTotalReady(row as never)).toBe(true);
    });
  });

  describe('printDisabledReason() — денежный гейт', () => {
    it('блокирует документ с page_count_failed и пустым диапазоном', () => {
      const { comp, setRows } = createComponent();
      // getPaperForRow truthy, чтобы дойти до денежного гейта (он раньше проверок бумаги).
      vi.spyOn(comp, 'getPaperForRow').mockReturnValue({ id: 'A4' } as never);
      setRows([makeDocRow({ page_count: null, page_count_failed: true, page_range: '' })]);
      expect(comp.printDisabledReason()).toContain('Не удалось определить число страниц');
    });

    it('показывает «Идёт подсчёт страниц…», пока count в полёте', () => {
      const { comp, setRows } = createComponent();
      vi.spyOn(comp, 'getPaperForRow').mockReturnValue({ id: 'A4' } as never);
      setRows([makeDocRow({ page_count: null, page_count_loading: true, page_range: '' })]);
      expect(comp.printDisabledReason()).toContain('Идёт подсчёт страниц');
    });

    it('РАЗБЛОКИРУЕТ документ с failed-count, если задан валидный диапазон «1-9»', () => {
      const { comp, setRows } = createComponent();
      vi.spyOn(comp, 'getPaperForRow').mockReturnValue({ id: 'A4' } as never);
      setRows([makeDocRow({ page_count: null, page_count_failed: true, page_range: '1-9', price: 10, quality: 'high' })]);
      expect(comp.printDisabledReason()).toBe('');
    });

    it('РАЗБЛОКИРУЕТ документ с известным page_count', () => {
      const { comp, setRows } = createComponent();
      vi.spyOn(comp, 'getPaperForRow').mockReturnValue({ id: 'A4' } as never);
      setRows([makeDocRow({ page_count: 9, price: 10, quality: 'high' })]);
      expect(comp.printDisabledReason()).toBe('');
    });
  });
});
