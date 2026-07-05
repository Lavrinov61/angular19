import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('BatchPrintDialogComponent layout template', () => {
  it('shows business-card chips before a label preset is selected', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );

    expect(source).toContain('@if (labelLayoutControlsAvailable(row))');
    expect(source).not.toContain('@if (labelLayoutControlsAvailable(row) && isLabelMode())');
  });

  it('keeps the primary print action distinct from print settings and queue monitoring', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );

    expect(source).toContain('Параметры');
    expect(source).toContain('Очередь принтера');
    expect(source).toContain('queueMonitorJobs');
    expect(source).not.toContain('<mat-icon>print</mat-icon>\n                      Печать');
    expect(source).not.toContain('вкладку «Печать»');
  });

  it('does not restart the Rust sheet preview for print-only stock changes', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );
    const keyStart = source.indexOf('private layoutPreviewRenderCacheKey');
    const keyEnd = source.indexOf('private layoutBatchGroupKey');
    const keySource = source.slice(keyStart, keyEnd);

    expect(source).toContain('distinctUntilChanged((prev, curr) => prev.key === curr.key)');
    expect(keyStart).toBeGreaterThan(-1);
    expect(keySource).not.toContain('media_type');
    expect(keySource).not.toContain('paper_source');
    expect(keySource).not.toContain('quality');
    expect(keySource).not.toContain('color_mode');
    expect(source).toContain('media_type: first.media_type || undefined');
    expect(source).toContain("...(first.paper_source && first.paper_source !== 'auto' ? { paper_source: first.paper_source } : {})");
  });

  it('allows business-card media and paper-source overrides without blocking print', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );
    const mediaSelectStart = source.indexOf('<mat-label>Тип бумаги</mat-label>');
    const mediaSelectEnd = source.indexOf('<mat-label>Источник бумаги</mat-label>');
    const mediaSelectSource = source.slice(mediaSelectStart, mediaSelectEnd);
    const sourceSelectStart = source.indexOf('<mat-label>Источник бумаги</mat-label>');
    const sourceSelectEnd = source.indexOf('@if (shouldShowCoverageBadge(row))');
    const sourceSelectSource = source.slice(sourceSelectStart, sourceSelectEnd);
    const requirementStart = source.indexOf('private businessCardRequirementIssue()');
    const requirementEnd = source.indexOf('private shouldAnalyzeCoverageForRow');
    const requirementSource = source.slice(requirementStart, requirementEnd);
    const mediaOptionsStart = source.indexOf('getMediaTypesForRow(row: BatchPrintRow)');
    const mediaOptionsEnd = source.indexOf('selectedMediaTypeLabel(row: BatchPrintRow)');
    const mediaOptionsSource = source.slice(mediaOptionsStart, mediaOptionsEnd);
    const sourceOptionsStart = source.indexOf('getPaperSourcesForRow(row: BatchPrintRow)');
    const sourceOptionsEnd = source.indexOf('photoEnhanceAvailable(row: BatchPrintRow)');
    const sourceOptionsSource = source.slice(sourceOptionsStart, sourceOptionsEnd);

    expect(source).not.toContain('businessCardSettingsGuardEffect');
    expect(source).not.toContain('syncBusinessCardRowsToRequiredSettings');
    expect(mediaSelectSource).not.toContain('[disabled]="isBusinessCardSelected()"');
    expect(sourceSelectSource).not.toContain('[disabled]="isBusinessCardSelected()"');
    expect(requirementSource).toContain('isBusinessCardMediaType(row.media_type)');
    expect(requirementSource).toContain('printerSupportsExactMedia(printer, row.media_type)');
    expect(requirementSource).toContain('isBusinessCardPaperSource(row.paper_source)');
    expect(requirementSource).toContain('printerSupportsPaperSource(printer, row.paper_source)');
    expect(mediaOptionsSource).not.toContain('findBusinessCardMediaType');
    expect(sourceOptionsSource).not.toContain('findBusinessCardPaperSource');
  });

  it('sends the requested business-card quantity to layout batch printing', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );
    const expandStart = source.indexOf('private expandRowForLayout');
    const expandEnd = source.indexOf('submitPrintAction(): void');
    const expandSource = source.slice(expandStart, expandEnd);
    const totalStart = source.indexOf('readonly totalLayoutPhotos');
    const totalEnd = source.indexOf('readonly customCuttingService');
    const totalSource = source.slice(totalStart, totalEnd);
    const priceStart = source.indexOf('private layoutBatchGroupTotal');
    const priceEnd = source.indexOf('private buildNormalPrintCartEntries');
    const priceSource = source.slice(priceStart, priceEnd);

    expect(expandSource).toContain('return this.normalizedLabelQuantity() * copies');
    expect(totalSource).toContain('labelQuantity * Math.max(1, row.copies)');
    expect(priceSource).toContain('this.layoutSheetUnitPrice(first) * this.layoutSheetsForGroup(group, layout)');
    expect(expandSource).not.toContain('this.isDocumentMode() || this.isBusinessCardSelected()');
  });

  it('drives page count from the fast count-pages source for every document (P0-1)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );
    const triggerStart = source.indexOf('private triggerPageCountForRow(index: number): void');
    const triggerEnd = source.indexOf('private triggerCoverageForRows(): void');
    const triggerSource = source.slice(triggerStart, triggerEnd);

    // page_count считается для КАЖДОГО документа, минуя coverage-гейт (только image пропускается).
    expect(triggerStart).toBeGreaterThan(-1);
    expect(triggerSource).toContain("row.file.type === 'image'");
    expect(triggerSource).toContain('this.coverageService.countPages(row.file.url, fontDelta)');
    expect(triggerSource).not.toContain('shouldAnalyzeCoverageForRow');
    // Инициализация при загрузке файлов идёт ДО coverage-анализа.
    expect(source).toContain('this.triggerPageCountForRows();\n    this.triggerCoverageForRows();');
  });

  it('prefers fast page_count and never silently finalizes ×1 for documents (P1-3)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );
    const knownStart = source.indexOf('knownDocumentPageCount(row: BatchPrintRow): number | null');
    const knownEnd = source.indexOf('isPageCountPending(row: BatchPrintRow): boolean');
    const knownSource = source.slice(knownStart, knownEnd);
    const selectedStart = source.indexOf('selectedDocumentPageCount(row: BatchPrintRow): number');
    const selectedEnd = source.indexOf('rowPageRangeIssue(row: BatchPrintRow): string');
    const selectedSource = source.slice(selectedStart, selectedEnd);

    // Источник истины: coverage.page_count → row.page_count (fast) → pages.length.
    expect(knownSource).toContain('row.coverage_result?.page_count');
    expect(knownSource).toContain('row.page_count');
    // Документ с неизвестным числом страниц → 0 (НЕ молчаливый ×1); «1» только для image.
    expect(selectedSource).toContain("if (row.file.type === 'image') return 1;");
    expect(selectedSource).toContain('this.knownDocumentPageCount(row) ?? 0');
    expect(selectedSource).not.toContain('this.knownDocumentPageCount(row) ?? 1');
  });

  it('shows reading/failed states instead of a fake ×1 price in the billing window (P1-4)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );
    const labelStart = source.indexOf('rowBillableLabel(row: BatchPrintRow): string');
    const labelEnd = source.indexOf('rowTotal(row: BatchPrintRow): number');
    const labelSource = source.slice(labelStart, labelEnd);

    // Pending → «Читаю документ…», провал count → «не удалось определить число страниц».
    expect(labelSource).toContain('Читаю документ…');
    expect(labelSource).toContain('не удалось определить число страниц');
    // Итог цены прячется, пока число страниц не определено.
    expect(source).toContain('@if (isRowTotalReady(row)) {');
    // Провал count-pages выставляет явный флаг, а не ×1.
    expect(source).toContain('page_count_failed: true');
  });

  it('runs coverage as a polled background job for documents and keeps page_count on failure', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/batch-print-dialog/batch-print-dialog.component.ts'),
      'utf8',
    );
    const jobStart = source.indexOf('private startDocumentCoverageJob(request: CoverageRequest): void');
    const jobEnd = source.indexOf('private coverageRequestKey(request: CoverageRequest): string');
    const jobSource = source.slice(jobStart, jobEnd);

    expect(jobStart).toBeGreaterThan(-1);
    expect(jobSource).toContain('this.coverageService.startCoverageJob');
    expect(jobSource).toContain('timer(0, 1000)');
    expect(jobSource).toContain('this.coverageService.getCoverageJob(start.coverage_id)');
    expect(jobSource).toContain('takeWhile');
    expect(jobSource).toContain('switchMap');
    // Провал/исчезновение → fixed-тир, цена не ломается.
    expect(source).toContain('private applyCoverageFailure(request: CoverageRequest): void');
    // Изображения остаются на синхронном пути анализа.
    expect(source).toContain("if (row.file.type === 'image') {\n      this.coverageService.analyzeCoverage(");
  });
});
