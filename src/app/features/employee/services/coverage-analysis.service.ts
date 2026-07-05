import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, tap, catchError, timeout } from 'rxjs/operators';

export type CoveragePrice = number | string;

export interface CoverageCmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface CoveragePageResult {
  page_number: number;
  coverage_percent: number;
  coverage_cmyk: CoverageCmyk;
  recommended_slug: string;
  recommended_price: CoveragePrice;
  recommended_name: string;
  tier: string;
}

export interface CoverageFontStats {
  sizes_pt: readonly number[];
  min_pt: number;
  max_pt: number;
  primary_pt: number;
  explicit_size_count: number;
}

export interface CoverageResult {
  coverage_percent: number;
  coverage_cmyk: CoverageCmyk;
  recommended_slug: string;
  recommended_price: CoveragePrice;
  recommended_name: string;
  tier: string;
  page_count?: number;
  pages?: readonly CoveragePageResult[];
  document_type?: string;
  font_stats?: CoverageFontStats | null;
}

export type CoverageColorMode = 'auto' | 'color' | 'bw';

export interface CoverageAnalysisOptions {
  dpi?: number;
  fontSizeDeltaPt?: number;
  printerId?: string;
  paperSize?: string;
  borderless?: boolean;
  /** Override авто-детекта цвета: 'color'/'bw' меняют тир/цену (≤15%: 10₽ ч/б ↔ 12₽ цвет). 'auto'/undefined — авто. */
  colorMode?: CoverageColorMode;
}

/** Быстрый подсчёт страниц — источник истины для числа страниц и цены, развязан от анализа заливки. */
export interface PageCountResult {
  page_count: number;
  document_type: string;
}

/**
 * Результат `countPages`. `error` отличает «запрос упал» (битый/зашифр. PDF, провал
 * конверсии) от «не звали» (`null`). При ошибке фронт показывает «не удалось определить
 * число страниц» и требует ручной диапазон — НИКОГДА не финализирует цену как ×1.
 */
export type PageCountOutcome =
  | { ok: true; result: PageCountResult }
  | { ok: false; error: string };

/** Стадии фоновой coverage-задачи (зеркалят snake_case-снимок из print-api). */
export type CoverageJobStage = 'counting' | 'rendering' | 'analyzing' | 'ready' | 'failed' | 'gone';

/** Снимок состояния фоновой coverage-задачи (GET /status/:id). `gone` — синтетический (404). */
export interface CoverageJobState {
  stage: CoverageJobStage;
  page_count?: number | null;
  document_type?: string;
  rendered?: number;
  analyzed?: number;
  result?: CoverageResult;
  error?: string;
}

export interface CoverageJobStartResult {
  coverage_id: string;
  status: string;
}

@Injectable({ providedIn: 'root' })
export class CoverageAnalysisService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, CoverageResult>();

  analyzeCoverage(
    fileUrl: string,
    paperFormat = 'a4',
    options: CoverageAnalysisOptions = {},
  ): Observable<CoverageResult | null> {
    const dpi = options.dpi ?? 0;
    const fontSizeDeltaPt = options.fontSizeDeltaPt ?? 0;
    const printerId = options.printerId ?? '';
    const paperSize = options.paperSize ?? '';
    const borderless = options.borderless ?? false;
    const colorMode = options.colorMode ?? 'auto';
    const cacheKey = `${fileUrl}::${paperFormat}::${dpi}::${fontSizeDeltaPt}::${printerId}::${paperSize}::${borderless}::${colorMode}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return of(cached);

    return this.http.post<{ success: boolean; result: CoverageResult }>('/api/print/analyze-coverage', {
      file_url: fileUrl,
      paper_format: paperFormat,
      ...(dpi > 0 ? { dpi } : {}),
      ...(fontSizeDeltaPt !== 0 ? { font_size_delta_pt: fontSizeDeltaPt } : {}),
      ...(printerId ? { printer_id: printerId } : {}),
      ...(paperSize ? { paper_size: paperSize } : {}),
      ...(borderless ? { borderless } : {}),
      ...(colorMode !== 'auto' ? { color_mode: colorMode } : {}),
    }).pipe(
      map(res => res.result),
      timeout(180_000),
      tap(result => this.cache.set(cacheKey, result)),
      catchError(() => of(null)),
    );
  }

  /**
   * Универсальный быстрый подсчёт страниц для ЛЮБОГО документа, БЕЗ привязки к
   * принтеру/формату/гейту заливки. Источник истины для числа страниц и цены.
   * Различает провал запроса (`{ ok:false, error }`) от «не звали» — провал НЕ молчит ×1.
   */
  countPages(fileUrl: string, fontSizeDeltaPt = 0): Observable<PageCountOutcome> {
    return this.http.post<{ success: boolean; page_count: number; document_type: string; error?: string }>(
      '/api/print/count-pages',
      {
        file_url: fileUrl,
        ...(fontSizeDeltaPt !== 0 ? { font_size_delta_pt: fontSizeDeltaPt } : {}),
      },
    ).pipe(
      timeout(30_000),
      map(res => {
        if (!res.success || typeof res.page_count !== 'number' || !Number.isFinite(res.page_count) || res.page_count <= 0) {
          return { ok: false as const, error: res.error || 'Не удалось определить число страниц' };
        }
        return {
          ok: true as const,
          result: { page_count: Math.round(res.page_count), document_type: res.document_type || 'document' },
        };
      }),
      catchError(() => of<PageCountOutcome>({ ok: false, error: 'Не удалось определить число страниц' })),
    );
  }

  /**
   * Стартует фоновую coverage-задачу (только для coverage-eligible: лазер A4/A3).
   * Возвращает `coverage_id` для последующего опроса `getCoverageJob`. Старт мгновенный
   * (count/render/analyze идут в фоне).
   */
  startCoverageJob(
    fileUrl: string,
    paperFormat = 'a4',
    options: CoverageAnalysisOptions = {},
  ): Observable<CoverageJobStartResult | null> {
    const dpi = options.dpi ?? 0;
    const fontSizeDeltaPt = options.fontSizeDeltaPt ?? 0;
    const printerId = options.printerId ?? '';
    const paperSize = options.paperSize ?? '';
    const borderless = options.borderless ?? false;
    const colorMode = options.colorMode ?? 'auto';

    return this.http.post<{ success: boolean; coverage_id: string; status: string }>(
      '/api/print/analyze-coverage/start',
      {
        file_url: fileUrl,
        paper_format: paperFormat,
        ...(dpi > 0 ? { dpi } : {}),
        ...(fontSizeDeltaPt !== 0 ? { font_size_delta_pt: fontSizeDeltaPt } : {}),
        ...(printerId ? { printer_id: printerId } : {}),
        ...(paperSize ? { paper_size: paperSize } : {}),
        ...(borderless ? { borderless } : {}),
        ...(colorMode !== 'auto' ? { color_mode: colorMode } : {}),
      },
    ).pipe(
      timeout(30_000),
      map(res => (res.success && res.coverage_id ? { coverage_id: res.coverage_id, status: res.status } : null)),
      catchError(() => of(null)),
    );
  }

  /** Опрос состояния фоновой coverage-задачи. 404/ошибка → `{ stage: 'gone' }`. */
  getCoverageJob(coverageId: string): Observable<CoverageJobState> {
    return this.http.get<CoverageJobState>(`/api/print/analyze-coverage/status/${encodeURIComponent(coverageId)}`).pipe(
      timeout(15_000),
      catchError(() => of<CoverageJobState>({ stage: 'gone' })),
    );
  }
}
