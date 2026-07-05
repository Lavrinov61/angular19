/**
 * PrintDialogComponent v2 — профессиональный диалог печати
 *
 * Карточки принтеров с группировкой по студиям, быстрые пресеты,
 * canvas-preview с fit/fill/stretch/actual, цена, расширенные настройки,
 * автоопределение сублимации (зеркало включается автоматически).
 */
import {
  Component, ChangeDetectionStrategy, inject, signal, computed,
  effect, viewChild, ElementRef, OnInit, AfterViewInit, OnDestroy, DestroyRef, PLATFORM_ID,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatChipsModule } from '@angular/material/chips';
import {
  PrintApiService, Printer, PaperSize, BridgePrinterStatus,
  PrintPresetRecord, PrinterTelemetry, PrintJob, PrinterCapabilities,
} from '../../services/print-api.service';
import type {
  CreatePrintJobParams,
  CreateLayoutBatchParams,
  LayoutBatchImageParams,
  PreviewRequestParams,
} from '../../services/print-api.service';
import { Subject, switchMap, timer, takeWhile, map as rxMap, catchError, of, EMPTY, debounceTime, finalize } from 'rxjs';
import { ToastService } from '../../../../core/services/toast.service';
import { FaceValidationApiService, FaceValidationResult } from '../../services/face-validation-api.service';
import { PrintPreset } from '../../data/print-prices.data';
import {
  PHOTO_SIZE_PRESETS, DOCUMENT_PRESETS, DOCUMENT_FACE_REQUIREMENTS, POLAROID_600_TEMPLATE,
  BUSINESS_CARD_A4_TEMPLATE, BUSINESS_CARD_MEDIA_TYPE_LABEL,
  ENVELOPE_C6_KRAFT_TEMPLATE, ENVELOPE_C6_KRAFT_MEDIA_TYPE_LABEL,
  PhotoSizePreset, calculateLayout, calculateDocumentSet, calculateBusinessCardLayout,
  isBusinessCardMediaTypeId, LayoutCalcResult, detectBestPaperSize, parsePageRange,
} from '../../data/photo-size-presets';
import { CropOverlayComponent, CropRect } from '../../../../shared/components/crop-overlay/crop-overlay.component';
import { LayoutPreviewCanvasComponent } from '../layout-preview-canvas/layout-preview-canvas.component';
import { FaceValidationBadgeComponent, FaceValidationBadgeData } from '../../../../shared/components/face-validation-badge/face-validation-badge.component';
import {
  CoverageAnalysisService,
  CoverageFontStats,
  CoveragePageResult,
  CoveragePrice,
  CoverageResult,
} from '../../services/coverage-analysis.service';
import { CoverageBadgeComponent } from '../print-shared/coverage-badge.component';
import { InfraRealtimeService } from '../../services/infra-realtime.service';
import type { SyncCartItem } from '../../../../shared/interfaces/cart-sync.interface';

export interface PrintDialogData {
  file_url: string;
  file_name?: string;
  order_id?: string;
  order_type?: string;
  receipt_id?: string;
  /** Подсказка: какой принтер использовать */
  preferred_printer_type?: 'photo' | 'mfp' | 'document';
  /** Default priority for the job (0-10). POS sets 9 */
  default_priority?: number;
  /** Результат face validation (передаётся из чата) */
  face_validation?: FaceValidationResult;
  /** Комплект на документы — точная авто-раскладка на 10×15 */
  document_set?: {
    photoWmm: number;
    photoHmm: number;
    copies: number;
    layout: LayoutCalcResult;
    paper_size: string;
    quality?: string;
    printer_name?: string;
    media_type?: string;
    borderless?: boolean;
    detected_preset_id?: string;
    detected_label?: string;
    detected_dpi?: number;
    source_width_px?: number;
    source_height_px?: number;
    face_requirements?: { min_mm: number; max_mm: number; standard?: string };
  };
  /** C6 kraft envelope with the Svoe Foto document-set brand template. */
  envelope_c6?: {
    template: 'svoefoto-kraft';
    paper_size: string;
    media_type: string;
    paper_source: string;
    quality?: string;
    printer_name?: string;
  };
}

export interface PrintDialogResult {
  printed: boolean;
  job?: PrintJob;
  statusHandled?: boolean;
  addedToCart?: boolean;
  minimized?: boolean;
  cartItems?: SyncCartItem[];
}

interface PrintStatusStep {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly done: boolean;
  readonly active: boolean;
  readonly failed: boolean;
}

interface CoverageRequest {
  readonly fileUrl: string;
  readonly printerId: string;
  readonly paperSize: string;
  readonly paperFormat: string;
  readonly borderless: boolean;
  readonly fontSizeDeltaPt?: number;
  readonly colorMode: 'auto' | 'color' | 'bw';
}

type PresetCategoryId = 'business' | 'envelopes' | 'documents' | 'flyers' | 'photo' | 'sublimation';
type BusinessCardPhotoPresetId = 'business-card' | 'business-card-eu';
type DocumentScaleMode = 'fit' | 'actual' | 'custom';

interface ImageAspectInfo {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly ratio: number;
  readonly ratioLabel: string;
}

interface BusinessCardAspectHint {
  readonly label: string;
  readonly diffLabel: string;
  readonly warning: boolean;
}

interface PrintPaperSourceOption {
  readonly id: string;
  readonly name: string;
}

interface PresetCategory {
  readonly id: PresetCategoryId;
  readonly label: string;
  readonly icon: string;
  readonly presets: readonly PrintPreset[];
}

const PRESET_CATEGORY_DEFINITIONS: Record<PresetCategoryId, Omit<PresetCategory, 'presets'>> = {
  business: { id: 'business', label: 'Визитки', icon: 'contact_page' },
  envelopes: { id: 'envelopes', label: 'Конверты', icon: 'mail' },
  documents: { id: 'documents', label: 'Документы', icon: 'description' },
  flyers: { id: 'flyers', label: 'Флаеры', icon: 'campaign' },
  photo: { id: 'photo', label: 'Фотографии', icon: 'photo' },
  sublimation: { id: 'sublimation', label: 'Сублимация', icon: 'local_fire_department' },
};

const PRINT_JOB_STATUSES = [
  'queued',
  'sending',
  'processing',
  'printing',
  'completed',
  'failed',
  'cancelled',
  'converting',
  'paused',
  'held',
  'scheduled',
  'splitting',
  'finishing',
] as const satisfies readonly PrintJob['status'][];

const PRINT_JOB_STATUS_SET: ReadonlySet<string> = new Set(PRINT_JOB_STATUSES);
const PRINT_JOB_TERMINAL_STATUS_SET: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);
const BUSINESS_CARD_ASPECT_TARGETS = [
  { label: '90×50', ratio: 90 / 50 },
  { label: '85×55', ratio: 85 / 55 },
] as const;

function isPrintJobStatus(value: string): value is PrintJob['status'] {
  return PRINT_JOB_STATUS_SET.has(value);
}

function isTerminalPrintJobStatus(status: PrintJob['status']): boolean {
  return PRINT_JOB_TERMINAL_STATUS_SET.has(status);
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${value.toFixed(2).replace(/\.00$/, '')}:1`;
}

import { groupPrintersSmart, SmartPrinterGroup } from '../../utils/printer-grouping';
import { QuickPrintService } from '../../services/quick-print.service';

@Component({
  selector: 'app-print-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe, FormsModule, MatDialogModule, MatButtonModule, MatButtonToggleModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatCheckboxModule,
    MatIconModule, MatSlideToggleModule, MatProgressSpinnerModule,
    MatTooltipModule, MatDividerModule, MatDatepickerModule, MatChipsModule,
    CropOverlayComponent, LayoutPreviewCanvasComponent,
    FaceValidationBadgeComponent, CoverageBadgeComponent,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <span class="title-accent-bar"></span>
      <mat-icon class="title-icon">{{ dialogTitleIcon() }}</mat-icon>
      <span class="title-text">
        @if (printStatusMode()) {
          Статус печати: {{ printStatusFileName() }}
        } @else {
          Печать: {{ decodedFileName() }}
        }
      </span>
    </h2>

    <mat-dialog-content class="print-content"
                        [class.document-set-content]="!!documentSetLayout()"
                        [class.status-content]="printStatusMode()">
      @if (printStatusJob(); as job) {
        <section class="print-status-view"
                 [class.status-done]="job.status === 'completed'"
                 [class.status-failed]="job.status === 'failed'"
                 [class.status-cancelled]="job.status === 'cancelled'">
          <div class="print-status-hero">
            <div class="print-status-icon" [class.active]="printStatusActive(job.status)">
              @if (printStatusActive(job.status)) {
                <mat-spinner diameter="34"></mat-spinner>
              } @else {
                <mat-icon>{{ printStatusIcon(job.status) }}</mat-icon>
              }
            </div>

            <div class="print-status-copy">
              <span class="print-status-printer">{{ printStatusPrinterName(job) }}</span>
              <h3>{{ printStatusTitle(job.status) }}</h3>
              <p>{{ printStatusDescription(job) }}</p>
            </div>
          </div>

          <div class="print-status-progress"
               [class.indeterminate]="printStatusActive(job.status) && job.progress_percent == null">
            <span [style.width.%]="printProgressPercent(job)"></span>
          </div>

          <div class="print-status-details">
            <div>
              <span>Файл</span>
              <strong>{{ printStatusFileName() }}</strong>
            </div>
            <div>
              <span>Принтер</span>
              <strong>{{ printStatusPrinterName(job) }}</strong>
            </div>
            <div>
              <span>Параметры</span>
              <strong>{{ printJobOptionsLabel(job) }}</strong>
            </div>
            <div>
              <span>Задание</span>
              <strong>{{ shortPrintJobId(job.id) }}</strong>
            </div>
          </div>

          <div class="print-status-steps">
            @for (step of printStatusSteps(); track step.key) {
              <div class="print-status-step"
                   [class.done]="step.done"
                   [class.active]="step.active"
                   [class.failed]="step.failed">
                <span class="step-marker">
                  <mat-icon>{{ step.icon }}</mat-icon>
                </span>
                <span>{{ step.label }}</span>
              </div>
            }
          </div>

          @if (job.error_message && job.status === 'failed') {
            <div class="print-status-error">
              <mat-icon>error</mat-icon>
              <span>{{ job.error_message }}</span>
            </div>
          }
        </section>
      } @else {
      <!-- ═══ PRESETS ═══ -->
      @if (presetCategories().length) {
        <div class="presets-panel">
          <div class="preset-category-row" aria-label="Категории печати">
            @for (category of presetCategories(); track category.id) {
              <button mat-stroked-button
                      type="button"
                      class="preset-category"
                      [class.active]="category.id === activePresetCategoryId()"
                      (click)="selectPresetCategory(category.id)">
                <mat-icon>{{ category.icon }}</mat-icon>
                <span>{{ category.label }}</span>
                <span class="preset-count">{{ category.presets.length }}</span>
              </button>
            }
          </div>

          @if (activePresetCategory(); as category) {
            <div class="preset-actions-row" [attr.aria-label]="category.label">
              @for (preset of category.presets; track preset.id) {
                <button mat-stroked-button
                        type="button"
                        class="preset-chip"
                        [class.active]="activePresetMatches(preset)"
                        [matTooltip]="preset.label"
                        (click)="applyPreset(preset)">
                  <mat-icon>{{ preset.icon }}</mat-icon>
                  <span>{{ presetDisplayLabel(preset) }}</span>
                </button>
              }
            </div>
          }
        </div>
      } @else {
        <div class="presets-panel empty">
          <span class="preset-empty">Нет настроенных пресетов для выбранного принтера</span>
        </div>
      }

      <div class="main-grid">

        <!-- ═══ PREVIEW ═══ -->
        <div class="preview-panel" [class.document-preview-panel]="documentPagesPreviewActive()" #previewPanel>
          <div class="canvas-wrapper"
               [class.document-pages-wrapper]="documentPagesPreviewActive()"
               [style.width.px]="previewSize().w"
               [style.height.px]="previewWrapperHeight()">
            @switch (fileType()) {
              @case ('pdf') {
                @if (serverPreviewUrl()) {
                  <img [src]="serverPreviewUrl()!" class="server-preview document-pages-image"
                       [attr.width]="null"
                       [attr.height]="null"
                       [style.transform]="serverPreviewTransform()"
                       [style.filter]="printPreviewFilter()"
                       [style.transform-origin]="'center center'"
                       [style.cursor]="canvasZoom() > 1 ? 'grab' : 'zoom-in'"
                       (wheel)="onCanvasWheel($event)"
                       (mousedown)="onServerPreviewMouseDown($event)"
                       (mousemove)="onServerPreviewMouseMove($event)"
                       (mouseup)="onServerPreviewMouseUp()"
                       (mouseleave)="onServerPreviewMouseUp()"
                       draggable="false"
                       alt="Предпросмотр PDF" />
                  @if (serverPreviewLoading()) {
                    <div class="canvas-placeholder preview-updating">
                      <mat-spinner diameter="24"></mat-spinner>
                    </div>
                  }
                } @else if (serverPreviewLoading()) {
                  <div class="doc-loading">
                    <mat-spinner diameter="32"></mat-spinner>
                    <span>{{ documentWorkStatusLabel() || 'Готовим предпросмотр...' }}</span>
                  </div>
                } @else if (serverPreviewError()) {
                  <div class="doc-placeholder">
                    <mat-icon>error_outline</mat-icon>
                    <span>{{ serverPreviewError() }}</span>
                  </div>
                } @else {
                  <div class="doc-placeholder">
                    <mat-icon>picture_as_pdf</mat-icon>
                    <span>PDF документ</span>
                    @if (documentPageSummaryLabel(); as pageSummary) {
                      <small>{{ pageSummary }}</small>
                    }
                  </div>
                }
              }
              @case ('docx') {
                @if (serverPreviewUrl()) {
                  <img [src]="serverPreviewUrl()!" class="server-preview document-pages-image"
                       [attr.width]="null"
                       [attr.height]="null"
                       [style.transform]="serverPreviewTransform()"
                       [style.filter]="printPreviewFilter()"
                       [style.transform-origin]="'center center'"
                       [style.cursor]="canvasZoom() > 1 ? 'grab' : 'zoom-in'"
                       (wheel)="onCanvasWheel($event)"
                       (mousedown)="onServerPreviewMouseDown($event)"
                       (mousemove)="onServerPreviewMouseMove($event)"
                       (mouseup)="onServerPreviewMouseUp()"
                       (mouseleave)="onServerPreviewMouseUp()"
                       draggable="false"
                       alt="Предпросмотр печати" />
                  @if (serverPreviewLoading()) {
                    <div class="canvas-placeholder preview-updating">
                      <mat-spinner diameter="24"></mat-spinner>
                    </div>
                  }
                } @else if (serverPreviewLoading() || docLoading()) {
                  <div class="doc-loading">
                    <mat-spinner diameter="32"></mat-spinner>
                    <span>{{ documentWorkStatusLabel() || 'Готовим предпросмотр...' }}</span>
                  </div>
                } @else if (serverPreviewError()) {
                  <div class="doc-placeholder">
                    <mat-icon>error_outline</mat-icon>
                    <span>{{ serverPreviewError() }}</span>
                  </div>
                } @else {
                  <div class="doc-placeholder">
                    <mat-icon>description</mat-icon>
                    <span>Word документ</span>
                    @if (documentPageSummaryLabel(); as pageSummary) {
                      <small>{{ pageSummary }}</small>
                    }
                    @if (documentWorkStatusLabel(); as statusLabel) {
                      <small class="doc-placeholder-status">{{ statusLabel }}</small>
                    }
                  </div>
                }
              }
              @case ('xlsx') {
                @if (docLoading()) {
                  <div class="doc-loading">
                    <mat-spinner diameter="32"></mat-spinner>
                    <span>Загрузка таблицы...</span>
                  </div>
                } @else if (xlsPreviewData()) {
                  <div class="xlsx-preview-container">
                    <table class="xlsx-table">
                      <thead>
                        <tr>
                          @for (h of xlsPreviewData()!.headers; track h) {
                            <th>{{ h }}</th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (row of xlsPreviewData()!.rows; track $index) {
                          <tr>
                            @for (cell of row; track $index) {
                              <td>{{ cell }}</td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <div class="doc-placeholder">
                    <mat-icon>table_chart</mat-icon>
                    <span>Excel таблица</span>
                  </div>
                }
              }
              @case ('image') {
                @if (serverPreviewUrl()) {
                  <img [src]="serverPreviewUrl()!" class="server-preview"
                       [width]="previewSize().w" [height]="previewSize().h"
                       [attr.crossOrigin]="'anonymous'"
                       [style.transform]="serverPreviewTransform()"
                       [style.filter]="printPreviewFilter()"
                       [style.transform-origin]="'center center'"
                       [style.cursor]="canvasZoom() > 1 ? 'grab' : 'zoom-in'"
                       (wheel)="onCanvasWheel($event)"
                       (mousedown)="onServerPreviewMouseDown($event)"
                       (mousemove)="onServerPreviewMouseMove($event)"
                       (mouseup)="onServerPreviewMouseUp()"
                       (mouseleave)="onServerPreviewMouseUp()"
                       draggable="false"
                       alt="Предпросмотр печати" />
                  @if (serverPreviewLoading()) {
                    <div class="canvas-placeholder preview-updating">
                      <mat-spinner diameter="24"></mat-spinner>
                    </div>
                  }
                } @else if (serverPreviewLoading()) {
                  <div class="canvas-placeholder layout-preview-pending">
                    <mat-spinner diameter="32"></mat-spinner>
                    <span>Подготовка предпросмотра...</span>
                  </div>
                } @else if (serverPreviewError()) {
                  <div class="canvas-placeholder layout-preview-error">
                    <mat-icon>error_outline</mat-icon>
                    <span>{{ serverPreviewError() }}</span>
                  </div>
                } @else {
                  <div class="canvas-placeholder layout-preview-pending">
                    <mat-spinner diameter="32"></mat-spinner>
                    <span>Подготовка предпросмотра...</span>
                  </div>
                }
              }
              @default {
                <div class="doc-placeholder">
                  <mat-icon>insert_drive_file</mat-icon>
                  <span>{{ data.file_name || 'Файл' }}</span>
                </div>
              }
            }
          </div>
          @if (showCropOverlay() && fileType() === 'image' && imageLoaded()) {
            @if (cropPaperDims(); as cropPaper) {
              <app-crop-overlay
                [imageUrl]="data.file_url"
                [paperWidth]="cropPaper.w"
                [paperHeight]="cropPaper.h"
                [imageNaturalWidth]="imgNaturalW()"
                [imageNaturalHeight]="imgNaturalH()"
                [fitMode]="fit_mode() === 'fill' ? 'fill' : 'fit'"
                [borderless]="borderless()"
                (cropRect)="onCropRectChange($event)"
                (fitModeChange)="onCropFitModeChange($event)" />
            }
          }
          <div class="preview-toolbar">
            @if (fileType() === 'image') {
              <button mat-icon-button
                      class="crop-toggle-btn"
                      [class.active]="showCropOverlay()"
                      (click)="showCropOverlay.set(!showCropOverlay())"
                      matTooltip="Показать обрезку">
                <mat-icon>crop</mat-icon>
              </button>
            }
            @if (showPolaroidToggle()) {
              <button mat-icon-button
                      class="crop-toggle-btn"
                      [class.active]="polaroidMode()"
                      (click)="togglePolaroidMode()"
                      matTooltip="Polaroid рамка">
                <mat-icon>photo_camera</mat-icon>
              </button>
            }
            <button mat-icon-button (click)="rotate()" matTooltip="Повернуть 90°"
                    class="rotate-btn">
              <mat-icon>rotate_right</mat-icon>
            </button>
            @if (fileType() === 'image') {
              <button mat-icon-button
                      (click)="resetCanvasZoomPan()"
                      [matTooltip]="'Увеличение: ' + (canvasZoom() * 100 | number: '1.0-0') + '% (сбросить)'"
                      [class.zoom-active]="canvasZoom() !== 1">
                <mat-icon>{{ canvasZoom() !== 1 ? 'zoom_out_map' : 'zoom_in' }}</mat-icon>
              </button>
            }
            @if (isPdf() && pdfPageCount() > 1) {
              <div class="pdf-nav">
                <button mat-icon-button (click)="changePdfPage(-1)"
                        [disabled]="pdfCurrentPage() <= 1" class="pdf-nav-btn">
                  <mat-icon>chevron_left</mat-icon>
                </button>
                <mat-checkbox class="pdf-page-check"
                              [checked]="isPdfPageSelected(pdfCurrentPage())"
                              (change)="togglePdfPage(pdfCurrentPage())" />
                <span class="pdf-page-label">{{ pdfCurrentPage() }} / {{ pdfPageCount() }}</span>
                <button mat-icon-button (click)="changePdfPage(1)"
                        [disabled]="pdfCurrentPage() >= pdfPageCount()" class="pdf-nav-btn">
                  <mat-icon>chevron_right</mat-icon>
                </button>
                <mat-form-field appearance="outline" class="pdf-jump-field">
                  <mat-label>Стр.</mat-label>
                  <input #pdfPageJumpControl
                         matInput
                         type="number"
                         min="1"
                         [max]="pdfPageCount()"
                         [ngModel]="pdfCurrentPage()"
                         (change)="jumpToPdfPage(pdfPageJumpControl.value)"
                         (keyup.enter)="jumpToPdfPage(pdfPageJumpControl.value)" />
                </mat-form-field>
              </div>
              <div class="pdf-page-selection">
                <button mat-stroked-button class="pdf-sel-btn"
                        (click)="toggleAllPdfPages()">
                  {{ allPdfPagesSelected() ? 'Снять все' : 'Выбрать все' }}
                </button>
                <mat-form-field appearance="outline" class="pdf-range-field">
                  <mat-label>Диапазон</mat-label>
                  <input matInput
                         [ngModel]="pdfPageRangeInput()"
                         (ngModelChange)="onPdfRangeChange($event)"
                         placeholder="1-3, 5, 7-10" />
                  <mat-hint>Выбрано {{ selectedPdfPagesCount() }} из {{ pdfPageCount() }}</mat-hint>
                </mat-form-field>
              </div>
            }
            @if (isPdf()) {
              <mat-form-field appearance="outline" class="setting-field">
                <mat-label>Страницы</mat-label>
                <input matInput [ngModel]="pageRange()" (ngModelChange)="onPrintPageRangeChange($event)"
                       placeholder="Все страницы (напр. 1-3, 5, 7-10)">
              </mat-form-field>
            }
            @if (documentPageSummaryLabel(); as pageSummary) {
              <span class="document-page-chip">
                <mat-icon>article</mat-icon>
                {{ pageSummary }}
              </span>
            }
            @if (documentWorkStatusLabel(); as statusLabel) {
              <span class="document-status-chip" [class.pending]="coveragePending() || serverPreviewLoading()">
                <mat-icon>{{ coveragePending() || serverPreviewLoading() ? 'hourglass_empty' : 'info' }}</mat-icon>
                {{ statusLabel }}
              </span>
            }
            <span class="paper-label">{{ selectedPaper()?.name || paper_size() }}</span>
            @if (isSublimation()) {
              <span class="sublim-badge" matTooltip="Сублимационная печать — зеркало">
                <mat-icon>flip</mat-icon> Зеркало
              </span>
            }
          </div>
        </div>

        <!-- ═══ SETTINGS ═══ -->
        <div class="settings-panel">

          <!-- PRINTER CARDS -->
          @for (group of printerGroups(); track group.key) {
            <div class="studio-label">
              <mat-icon class="studio-icon">{{ group.icon }}</mat-icon>
              {{ group.label }}
            </div>
            <div class="printer-cards-row" [class.compact]="group.printers.length > 4">
              @for (p of group.printers; track p.id) {
                <div class="printer-card" role="button" tabindex="0"
                     [class.selected]="printer_id() === p.id"
                     [class.offline]="!isPrinterOnline(p)"
                     [matTooltip]="p.name + ' — ' + getPrinterTypeLabel(p)"
                     (click)="selectPrinter(p)"
                     (keydown.enter)="selectPrinter(p)"
                     (keydown.space)="selectPrinter(p)">
                  <mat-icon class="printer-type-icon"
                            [class]="'type-' + getEffectiveType(p)">
                    {{ getPrinterIcon(p) }}
                  </mat-icon>
                  <div class="printer-card-body">
                    <span class="printer-card-name">{{ p.name }}</span>
                    <span class="printer-card-type">{{ getPrinterTypeLabel(p) }}</span>
                  </div>
                  <span class="status-dot"
                        [class.online]="isPrinterOnline(p)"
                        [matTooltip]="isPrinterOnline(p) ? 'Онлайн' : 'Недоступен'">
                  </span>
                  @if (getSupplyDots(p.id); as dots) {
                    @if (dots.length) {
                      <div class="supply-indicator">
                        @for (item of dots; track item.key) {
                          <div class="supply-dot"
                               [style.background]="item.level > 30 ? '#4caf50' : item.level > 10 ? '#ff9800' : '#f44336'"
                               [matTooltip]="item.label + ': ' + item.level + '%'">
                          </div>
                        }
                      </div>
                    }
                  }
                </div>
              }
            </div>
          }

          @if (currentCapabilities(); as caps) {

            <!-- PRINT MODE -->
            @if (showPrintModeSection(caps)) {
              <div class="settings-section print-mode-section">
                <span class="settings-section-title">
                  <mat-icon>print</mat-icon> Режим печати
                </span>
                @if (currentPrinter()?.printer_type !== 'photo' || currentPrinterSupportsCoverage()) {
                  <div class="settings-row">
                    <mat-button-toggle-group
                      class="mode-toggles full-width"
                      [ngModel]="isBw() ? 'bw' : 'color'"
                      (ngModelChange)="setColorMode($event)">
                      <mat-button-toggle value="bw">
                        <mat-icon>contrast</mat-icon>
                        <span>Ч/Б</span>
                      </mat-button-toggle>
                      <mat-button-toggle value="color">
                        <mat-icon>palette</mat-icon>
                        <span>Цвет</span>
                      </mat-button-toggle>
                    </mat-button-toggle-group>
                  </div>
                }

                @if (isDocumentPrintWorkflow()) {
                  <div class="settings-row">
                    <mat-button-toggle-group
                      class="mode-toggles full-width"
                      [ngModel]="booklet() ? 'booklet' : 'normal'"
                      (ngModelChange)="setBookletMode($event)">
                      <mat-button-toggle value="normal">
                        <mat-icon>description</mat-icon>
                        <span>Обычная</span>
                      </mat-button-toggle>
                      <mat-button-toggle value="booklet">
                        <mat-icon>menu_book</mat-icon>
                        <span>Буклет</span>
                      </mat-button-toggle>
                    </mat-button-toggle-group>
                  </div>
                }

                @if (caps.duplex) {
                  <div class="settings-row">
                    <mat-button-toggle-group
                      class="mode-toggles full-width"
                      [ngModel]="duplex() ? 'duplex' : 'simplex'"
                      (ngModelChange)="setDuplexMode($event)">
                      <mat-button-toggle value="simplex">
                        <mat-icon>looks_one</mat-icon>
                        <span>Односторонняя</span>
                      </mat-button-toggle>
                      <mat-button-toggle value="duplex">
                        <mat-icon>auto_stories</mat-icon>
                        <span>Двусторонняя</span>
                      </mat-button-toggle>
                    </mat-button-toggle-group>
                  </div>
                }

                @if (isDocumentPrintWorkflow() && duplex()) {
                  <div class="settings-row">
                    <mat-button-toggle-group
                      class="mode-toggles full-width compact-mode-toggles"
                      [ngModel]="duplex_mode() === 'short_edge' ? 'short_edge' : 'long_edge'"
                      (ngModelChange)="setDuplexEdge($event)">
                      <mat-button-toggle value="long_edge">
                        <mat-icon>swap_vert</mat-icon>
                        <span>Длинный край</span>
                      </mat-button-toggle>
                      <mat-button-toggle value="short_edge">
                        <mat-icon>swap_horiz</mat-icon>
                        <span>Короткий край</span>
                      </mat-button-toggle>
                    </mat-button-toggle-group>
                  </div>
                }

                @if (visiblePaperSources(caps).length > 1) {
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>Лоток бумаги</mat-label>
                    <mat-select [ngModel]="paperSource()" (ngModelChange)="setPaperSource($event)">
                      @for (src of visiblePaperSources(caps); track src.id) {
                        <mat-option [value]="src.id">{{ src.name }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                }
              </div>
            }

            <!-- FIT MODE -->
            <div class="settings-section">
            <span class="settings-section-title">
              <mat-icon>aspect_ratio</mat-icon> Подгонка
            </span>
            <div class="fit-section">
              @if (isDocumentPrintWorkflow()) {
                <mat-button-toggle-group
                  [ngModel]="documentScaleMode()"
                  (ngModelChange)="setDocumentScaleMode($event)"
                  class="mode-toggles full-width scale-mode-toggles">
                  <mat-button-toggle value="fit">
                    <mat-icon>fit_screen</mat-icon>
                    <span>Подогнать</span>
                  </mat-button-toggle>
                  <mat-button-toggle value="actual">
                    <mat-icon>photo_size_select_actual</mat-icon>
                    <span>100%</span>
                  </mat-button-toggle>
                  <mat-button-toggle value="custom">
                    <mat-icon>tune</mat-icon>
                    <span>Масштаб</span>
                  </mat-button-toggle>
                </mat-button-toggle-group>

                @if (documentScaleMode() === 'custom') {
                  <div class="scale-control-row">
                    <input
                      class="scale-slider"
                      type="range"
                      min="25"
                      max="400"
                      step="5"
                      [ngModel]="scaling_percent()"
                      (ngModelChange)="setScalingPercent($event)"
                      aria-label="Масштаб в процентах">
                    <mat-form-field appearance="outline" class="scale-percent-field">
                      <mat-label>Процент</mat-label>
                      <input
                        matInput
                        type="number"
                        min="25"
                        max="400"
                        step="5"
                        [ngModel]="scaling_percent()"
                        (ngModelChange)="setScalingPercent($event)">
                      <span matTextSuffix>%</span>
                    </mat-form-field>
                  </div>
                }
              } @else {
                <mat-button-toggle-group [ngModel]="fit_mode()" (ngModelChange)="fit_mode.set($event); onFitChange()"
                                         class="fit-toggles">
                  <mat-button-toggle value="fill" matTooltip="Заполнить — обрезка по краям">
                    <mat-icon>crop</mat-icon>
                  </mat-button-toggle>
                  <mat-button-toggle value="fit" matTooltip="Вписать — белые поля">
                    <mat-icon>fit_screen</mat-icon>
                  </mat-button-toggle>
                  <mat-button-toggle value="stretch" matTooltip="Растянуть">
                    <mat-icon>aspect_ratio</mat-icon>
                  </mat-button-toggle>
                  <mat-button-toggle value="actual" matTooltip="1:1 — без масштабирования">
                    <mat-icon>photo_size_select_actual</mat-icon>
                  </mat-button-toggle>
                </mat-button-toggle-group>
              }
              @if (imageAspectInfo(); as aspect) {
                <div class="source-aspect-info" [class.warning]="businessCardAspectHint()?.warning">
                  <mat-icon>straighten</mat-icon>
                  <span>{{ aspect.widthPx }}×{{ aspect.heightPx }} px · {{ aspect.ratioLabel }}</span>
                  @if (businessCardAspectHint(); as hint) {
                    <span class="source-aspect-divider"></span>
                    <span>{{ hint.label }} · {{ hint.diffLabel }}</span>
                  }
                </div>
              }
            </div>

            <!-- BORDERLESS -->
            @if (caps.borderless) {
              <mat-checkbox [ngModel]="borderless()" (ngModelChange)="borderless.set($event); onSettingChange()">
                Без полей
              </mat-checkbox>
            }
            </div><!-- /settings-section fit -->

            <!-- PAPER & QUALITY -->
            <div class="settings-section">
            <span class="settings-section-title">
              <mat-icon>description</mat-icon> Бумага / Качество
            </span>
            <div class="settings-row">
              <mat-form-field appearance="outline" class="field-half">
                <mat-label>Бумага</mat-label>
                <mat-select [ngModel]="paper_size()" (ngModelChange)="onPaperSizeChange($event)">
                  @for (ps of caps.paper_sizes; track ps.id) {
                    <mat-option [value]="ps.id">{{ ps.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="field-half">
                <mat-label>Качество</mat-label>
                <mat-select [ngModel]="quality()" (ngModelChange)="quality.set($event); onSettingChange()">
                  @for (qm of caps.quality_modes; track qm.id) {
                    <mat-option [value]="qm.id">{{ qm.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            @if (recommendedFormat(); as rec) {
              <div class="recommended-hint" role="button" tabindex="0" (click)="applyRecommendedFormat(rec)" (keyup.enter)="applyRecommendedFormat(rec)">
                <mat-icon>auto_awesome</mat-icon>
                Рекомендуемый: {{ rec.label }}
              </div>
            }

            @if (caps.media_types.length > 1) {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Тип бумаги</mat-label>
                <mat-select [ngModel]="media_type()" (ngModelChange)="media_type.set($event); onSettingChange()">
                  @for (mt of caps.media_types; track mt.id) {
                    <mat-option [value]="mt.id">{{ mt.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }

            @if (showCoverageBadge()) {
              <app-coverage-badge
                [result]="coverageResult()"
                [loading]="coverageLoading()"
                [overridden]="coverageOverridden()" />
              @if (documentPageSummaryLabel(); as pageSummary) {
                <div class="document-page-summary">
                  <mat-icon>article</mat-icon>
                  <span>{{ pageSummary }}</span>
                  @if (coveragePagesPriceLabel(); as priceLabel) {
                    <strong>{{ priceLabel }}</strong>
                  }
                </div>
              }
              @if (showCoveragePages()) {
                <div class="coverage-pages-panel">
                  <div class="coverage-pages-title">
                    <span>
                      <mat-icon>format_color_fill</mat-icon>
                      Заливка страниц
                    </span>
                    @if (coverageSelectedSummaryLabel(); as selectedLabel) {
                      <em>{{ selectedLabel }}</em>
                    }
                  </div>
                  <div class="coverage-pages-list">
                    @if (coverageLoading() && !coveragePages().length) {
                      <div class="coverage-pages-loading">
                        <mat-spinner diameter="18"></mat-spinner>
                        <span>Считаем страницы...</span>
                      </div>
                    } @else {
                      @for (page of coveragePages(); track page.page_number) {
                        <button type="button"
                                class="coverage-page-row"
                                [class.selected]="isCoveragePageSelected(page.page_number)"
                                [class.high]="page.coverage_percent > 50"
                                [disabled]="!isPdf()"
                                (click)="selectCoveragePage(page.page_number)">
                          <span class="coverage-page-no">{{ page.page_number }}</span>
                          <span class="coverage-page-bar" aria-hidden="true">
                            <span [style.width.%]="coverageBarWidth(page.coverage_percent)"></span>
                          </span>
                          <span class="coverage-page-percent">{{ page.coverage_percent | number: '1.0-0' }}%</span>
                          <span class="coverage-page-price">{{ coveragePriceLabel(page.recommended_price) }} ₽</span>
                        </button>
                      }
                    }
                  </div>
                </div>
              }
            }
            </div><!-- /settings-section paper -->

            <!-- DOCUMENT PHOTO LAYOUT (auto or manual) -->
            @if (documentSetLayout(); as dsLayout) {
              <div class="doc-layout-section doc-set-mode">
                <span class="section-label">Комплект на документы</span>
                <div class="doc-layout-row">
                  <app-layout-preview-canvas
                    [layout]="dsLayout"
                    [paperW]="100"
                    [paperH]="150"
                    [maxCanvasW]="220"
                    [maxCanvasH]="330"
                    [imageUrl]="data.file_url"
                    templateMode="passport" />
                  <div class="doc-layout-info">
                    <span class="doc-layout-label">
                      {{ data.document_set!.detected_label || 'Фото на документы' }} ·
                      {{ data.document_set!.photoWmm }}×{{ data.document_set!.photoHmm }} мм
                    </span>
                    @if (data.document_set!.source_width_px && data.document_set!.source_height_px) {
                      <span class="doc-layout-source">
                        {{ data.document_set!.source_width_px }}×{{ data.document_set!.source_height_px }} px · {{ data.document_set!.detected_dpi || 800 }} DPI
                      </span>
                    }
                    <span class="doc-layout-count">{{ dsLayout.photosPerSheet }} шт на листе 10×15</span>
                    <span class="doc-layout-footer">10×15, с полями и линиями реза</span>
                    @if (faceValidationLoading()) {
                      <span class="face-chip loading">Проверка лица...</span>
                    } @else {
                      <app-face-validation-badge [faceValidation]="faceValidationBadge()" />
                    }
                  </div>
                </div>
              </div>
            }
            @if (!documentSetLayout() && documentLayout(); as docLayout) {
              <div class="doc-layout-section">
                <span class="section-label">Фото на документы</span>
                <div class="doc-layout-row">
                  <app-layout-preview-canvas
                    [layout]="docLayout"
                    [paperW]="100"
                    [paperH]="150"
                    [maxCanvasW]="140"
                    [maxCanvasH]="200"
                    templateMode="passport" />
                  <div class="doc-layout-info">
                    <span class="doc-layout-label">{{ activeDocPreset()!.label }}</span>
                    <span class="doc-layout-count">{{ docLayout.photosPerSheet }} шт на листе 10×15</span>
                    @if (!faceValidationLoading()) {
                      <app-face-validation-badge [faceValidation]="faceValidationBadge()" />
                    }
                  </div>
                </div>
              </div>
            }

            <!-- COPIES & PRICE -->
            <div class="settings-section copies-price-section">
            <span class="settings-section-title">
              <mat-icon>content_copy</mat-icon> Копии / Цена
            </span>
            <div class="copies-price-row">
              <div class="copies-section">
                <div class="copies-buttons">
                  <button mat-icon-button (click)="changeCopies(-1)"
                          [disabled]="copies() <= 1" class="copies-btn">
                    <mat-icon>remove</mat-icon>
                  </button>
                  <span class="copies-value">{{ copies() }}</span>
                  <button mat-icon-button (click)="changeCopies(1)"
                          [disabled]="copies() >= 99" class="copies-btn">
                    <mat-icon>add</mat-icon>
                  </button>
                </div>
              </div>
              <div class="price-display">
                @if (priceBreakdownLabel(); as breakdown) {
                  <span class="price-unit">{{ breakdown }}</span>
                  <span class="price-eq">=</span>
                }
                <span class="price-total">{{ formattedTotalPrice() }} ₽</span>
              </div>
            </div>

            <!-- SPLITTING -->
            @if (canSplit()) {
              <div class="settings-row split-row">
                <mat-slide-toggle [ngModel]="splitEnabled()" (ngModelChange)="splitEnabled.set($event)">
                  <mat-icon>call_split</mat-icon> Распределить по принтерам
                </mat-slide-toggle>
              </div>
              @if (splitEnabled()) {
                <div class="split-options">
                  <mat-button-toggle-group [value]="splitStrategy()" (change)="splitStrategy.set($event.value)" hideSingleSelectionIndicator>
                    <mat-button-toggle value="round_robin">Round Robin</mat-button-toggle>
                    <mat-button-toggle value="even">Равномерно</mat-button-toggle>
                  </mat-button-toggle-group>
                  <div class="split-printers">
                    @for (p of splitCandidates(); track p.id) {
                      <mat-checkbox [checked]="splitTargetPrinters().includes(p.id)"
                        (change)="toggleSplitPrinter(p.id)">{{ p.name }}</mat-checkbox>
                    }
                  </div>
                  @if (splitPreviewText()) {
                    <div class="split-preview">{{ splitPreviewText() }}</div>
                  }
                </div>
              }
            }

            <!-- ADVANCED SETTINGS -->
            <div class="advanced-toggle" role="button" tabindex="0"
                 (click)="showAdvanced.set(!showAdvanced())"
                 (keydown.enter)="showAdvanced.set(!showAdvanced())"
                 (keydown.space)="showAdvanced.set(!showAdvanced())"
                 >
              <mat-icon class="expand-icon">
                {{ showAdvanced() ? 'expand_less' : 'expand_more' }}
              </mat-icon>
              <span>Расширенные настройки</span>
            </div>

            @if (showAdvanced()) {
              <div class="advanced-body">
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Ориентация</mat-label>
                  <mat-select [ngModel]="orientation()" (ngModelChange)="orientation.set($event)">
                    <mat-option value="auto">Авто</mat-option>
                    <mat-option value="portrait">Книжная</mat-option>
                    <mat-option value="landscape">Альбомная</mat-option>
                  </mat-select>
                </mat-form-field>

                <div class="toggle-row">
                  <mat-icon class="toggle-icon">swap_horiz</mat-icon>
                  <span>Зеркальная печать</span>
                  <mat-slide-toggle [ngModel]="mirror()" (ngModelChange)="mirror.set($event)"
                                    class="toggle-ctrl">
                  </mat-slide-toggle>
                </div>

                @if (currentPrinter()?.printer_type === 'photo') {
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>Цветопередача (Rendering Intent)</mat-label>
                    <mat-select [ngModel]="renderingIntent()" (ngModelChange)="renderingIntent.set($event); onSettingChange()">
                      <mat-option value="perceptual">Перцептуальный (обычные фото)</mat-option>
                      <mat-option value="absolute_colorimetric">Абсолютный колориметрический (документы)</mat-option>
                      <mat-option value="relative_colorimetric">Относительный колориметрический</mat-option>
                      <mat-option value="saturation">Насыщенность</mat-option>
                    </mat-select>
                  </mat-form-field>
                }

                @if (currentPrinterSupportsCoverage()) {
                  <mat-form-field appearance="outline" class="setting-field">
                    <mat-label>На листе</mat-label>
                    <mat-select [ngModel]="pages_per_sheet()" (ngModelChange)="pages_per_sheet.set($event); onSettingChange()">
                      <mat-option [value]="1">1</mat-option>
                      <mat-option [value]="2">2</mat-option>
                      <mat-option [value]="4">4</mat-option>
                      <mat-option [value]="6">6</mat-option>
                      <mat-option [value]="9">9</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="setting-field">
                    <mat-label>DPI</mat-label>
                    <mat-select [ngModel]="target_dpi()" (ngModelChange)="target_dpi.set($event); onSettingChange()">
                      <mat-option [value]="300">300</mat-option>
                      <mat-option [value]="600">600</mat-option>
                      <mat-option [value]="1200">1200</mat-option>
                    </mat-select>
                  </mat-form-field>

                  @if (fontAdjustmentAvailable()) {
                    <mat-form-field appearance="outline" class="setting-field">
                      <mat-label>Шрифт DOC</mat-label>
                      <mat-select [ngModel]="docFontSizeDeltaPt()" (ngModelChange)="docFontSizeDeltaPt.set($event); onSettingChange()">
                        <mat-option [value]="0">Без изменения</mat-option>
                        <mat-option [value]="-1">-1 pt</mat-option>
                        <mat-option [value]="-2">-2 pt</mat-option>
                        <mat-option [value]="-3">-3 pt</mat-option>
                        <mat-option [value]="-4">-4 pt</mat-option>
                      </mat-select>
                    </mat-form-field>
                    @if (coverageFontStats(); as fontStats) {
                      <div class="document-page-summary doc-font-summary">
                        <mat-icon>format_size</mat-icon>
                        <span>{{ documentFontStatsLabel(fontStats) }}</span>
                        @if (adjustedDocumentFontStatsLabel(fontStats); as adjustedLabel) {
                          <strong>{{ adjustedLabel }}</strong>
                        }
                      </div>
                    }
                  }

                  <div class="toggle-row">
                    <mat-icon class="toggle-icon">savings</mat-icon>
                    <span>Экономия тонера</span>
                    <mat-slide-toggle [ngModel]="toner_save()" (ngModelChange)="toner_save.set($event)"
                                      class="toggle-ctrl">
                    </mat-slide-toggle>
                  </div>
                }

                @if (copies() > 1) {
                  <mat-checkbox [ngModel]="collate()" (ngModelChange)="collate.set($event)">
                    Подборка по копиям
                  </mat-checkbox>
                }

                @if (isBw()) {
                  <mat-form-field appearance="outline" class="setting-field">
                    <mat-label>Режим ч/б</mat-label>
                    <mat-select [ngModel]="gray_mode()" (ngModelChange)="gray_mode.set($event); onSettingChange()">
                      <mat-option value="">Авто</mat-option>
                      <mat-option value="true_gray">True Gray</mat-option>
                      <mat-option value="black_only">Только чёрный</mat-option>
                    </mat-select>
                  </mat-form-field>
                }

                @if (currentPrinterSupportsCoverage()) {
                  <mat-divider></mat-divider>
                  <span class="settings-label">Качество</span>

                  <div class="toggle-row">
                    <mat-icon class="toggle-icon">auto_fix_high</mat-icon>
                    <span>Авто-определение цвета</span>
                    <mat-slide-toggle [ngModel]="color_auto_detect()" (ngModelChange)="color_auto_detect.set($event)"
                                      class="toggle-ctrl">
                    </mat-slide-toggle>
                  </div>
                }

                @if (currentPrinter()?.printer_type === 'mfp') {
                  <!-- Финишинг (принтер) -->
                  <mat-divider></mat-divider>
                  <span class="settings-label">Финишинг (принтер)</span>

                  <mat-form-field appearance="outline" class="setting-field">
                    <mat-label>Край переплёта</mat-label>
                    <mat-select [ngModel]="binding_edge()" (ngModelChange)="binding_edge.set($event)">
                      <mat-option value="none">Нет</mat-option>
                      <mat-option value="left">Левый</mat-option>
                      <mat-option value="top">Верхний</mat-option>
                      <mat-option value="right">Правый</mat-option>
                      <mat-option value="bottom">Нижний</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="setting-field">
                    <mat-label>Скрепление</mat-label>
                    <mat-select [ngModel]="staple_position()" (ngModelChange)="staple_position.set($event)">
                      <mat-option value="">Нет</mat-option>
                      <mat-option value="top_left">Верх-лево</mat-option>
                      <mat-option value="top_right">Верх-право</mat-option>
                      <mat-option value="dual_left">Двойное (лево)</mat-option>
                      <mat-option value="dual_top">Двойное (верх)</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="setting-field">
                    <mat-label>Перфорация</mat-label>
                    <mat-select [ngModel]="hole_punch_type()" (ngModelChange)="hole_punch_type.set($event)">
                      <mat-option value="">Нет</mat-option>
                      <mat-option value="2_hole">2 отверстия</mat-option>
                      <mat-option value="4_hole">4 отверстия</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="setting-field">
                    <mat-label>Выходной лоток</mat-label>
                    <mat-select [ngModel]="output_bin()" (ngModelChange)="output_bin.set($event)">
                      <mat-option value="auto">Авто</mat-option>
                      <mat-option value="standard">Стандартный</mat-option>
                      <mat-option value="finisher_bin1">Финишер</mat-option>
                      <mat-option value="face_up">Лицом вверх</mat-option>
                    </mat-select>
                  </mat-form-field>
                }

                <!-- Водяной знак -->
                <mat-divider></mat-divider>
                <span class="settings-label">Водяной знак</span>
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Текст</mat-label>
                  <input matInput [ngModel]="watermarkText()" (ngModelChange)="watermarkText.set($event)"
                         placeholder="КОПИЯ, ОБРАЗЕЦ">
                </mat-form-field>

                @if (watermarkText()) {
                  <div style="display:flex;gap:12px">
                    <mat-form-field appearance="outline" style="flex:1">
                      <mat-label>Прозрачность</mat-label>
                      <input matInput type="number" [ngModel]="watermarkOpacity()"
                             (ngModelChange)="watermarkOpacity.set($event)" min="5" max="100" step="5">
                      <span matTextSuffix>%</span>
                    </mat-form-field>
                    <mat-form-field appearance="outline" style="flex:1">
                      <mat-label>Позиция</mat-label>
                      <mat-select [ngModel]="watermarkPosition()" (ngModelChange)="watermarkPosition.set($event)">
                        <mat-option value="center">По центру</mat-option>
                        <mat-option value="diagonal">По диагонали</mat-option>
                        <mat-option value="top">Сверху</mat-option>
                        <mat-option value="bottom">Снизу</mat-option>
                      </mat-select>
                    </mat-form-field>
                  </div>
                }

                <!-- Титульная страница -->
                <div class="toggle-row">
                  <mat-icon class="toggle-icon">flag</mat-icon>
                  <span>Титульная страница</span>
                  <mat-slide-toggle [ngModel]="bannerPage()" (ngModelChange)="bannerPage.set($event)">
                  </mat-slide-toggle>
                </div>
              </div>
            }
            </div><!-- /settings-section copies-price -->

            @if (showAdvanced()) {
              <!-- SCHEDULING -->
              <div class="settings-section">
                <span class="settings-section-title">
                  <mat-icon>schedule</mat-icon> Планирование
                </span>
                <div class="schedule-row">
                  <mat-form-field appearance="outline" class="field-half">
                    <mat-label>Дата</mat-label>
                    <input matInput [matDatepicker]="schedulePicker"
                           [ngModel]="scheduledDate()"
                           (ngModelChange)="scheduledDate.set($event)"
                           [min]="minScheduleDate" />
                    <mat-datepicker-toggle matIconSuffix [for]="schedulePicker"></mat-datepicker-toggle>
                    <mat-datepicker #schedulePicker></mat-datepicker>
                  </mat-form-field>
                  <mat-form-field appearance="outline" class="field-half">
                    <mat-label>Время</mat-label>
                    <input matInput type="time"
                           [ngModel]="scheduledTime()"
                           (ngModelChange)="scheduledTime.set($event)" />
                  </mat-form-field>
                </div>
                @if (scheduledDate()) {
                  <button mat-stroked-button class="clear-schedule-btn" (click)="clearSchedule()">
                    <mat-icon>clear</mat-icon> Убрать расписание
                  </button>
                }
              </div>

              <!-- FINISHING OPERATIONS -->
              <div class="settings-section">
                <span class="settings-section-title">
                  <mat-icon>content_cut</mat-icon> Финишные операции
                </span>
                <mat-chip-set class="finishing-chips">
                  @for (op of finishingOptions; track op.id) {
                    <mat-chip [highlighted]="isFinishingSelected(op.id)"
                              (click)="toggleFinishing(op.id)">
                      <mat-icon matChipAvatar>{{ op.icon }}</mat-icon>
                      {{ op.label }}
                    </mat-chip>
                  }
                </mat-chip-set>
              </div>
            }
          }
        </div>
      </div>

      <!-- Settings persistence banner -->
      @if (hasRestoredSettings()) {
        <div class="restore-banner">
          <mat-icon>history</mat-icon>
          <span>Восстановлены предыдущие настройки</span>
          <button mat-button class="restore-dismiss" (click)="hasRestoredSettings.set(false)">OK</button>
        </div>
      }
      }
    </mat-dialog-content>

    @if (!printStatusMode() && actionStatusLabel(); as statusLabel) {
      <div class="price-warning-chip" [class.pending]="coveragePending() || serverPreviewLoading()">
        <mat-icon>{{ coveragePending() || serverPreviewLoading() ? 'hourglass_empty' : 'warning_amber' }}</mat-icon>
        <span>{{ statusLabel }}</span>
      </div>
    }

    <mat-dialog-actions align="end">
      @if (printStatusMode()) {
        <button mat-flat-button color="primary" (click)="cancel()">Закрыть</button>
      } @else {
        <div class="footer-price-summary" aria-live="polite">
          <span class="footer-price-count">
            <mat-icon>{{ billingQuantityIcon() }}</mat-icon>
            {{ billingQuantityLabel() }}
          </span>
          <span class="footer-price-formula">{{ footerPriceBreakdownLabel() }}</span>
        </div>
        <button mat-stroked-button (click)="minimize()">
          <mat-icon>remove</mat-icon>
          Свернуть
        </button>
        <button mat-stroked-button (click)="cancel()">Отмена</button>
        <button mat-stroked-button class="print-action-btn"
          [disabled]="printActionDisabled()"
          [matTooltip]="printDisabledReason()"
          (click)="print()">
          @if (printing()) {
            <mat-spinner diameter="18" class="btn-spinner" />
          } @else {
            <mat-icon>print</mat-icon>
          }
          Напечатать
        </button>
        <button mat-flat-button color="primary" class="cart-action-btn"
          [disabled]="addToCartActionDisabled()"
          [matTooltip]="addToCartDisabledReason()"
          (click)="addToCart()">
          <mat-icon>point_of_sale</mat-icon>
          {{ paymentActionLabel() }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    /* ═══ DIALOG TITLE ═══ */
    .dialog-title {
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 10px;
      font-size: 17px; font-weight: 600;
      min-height: 54px;
      padding: 14px 18px 10px !important;
      color: var(--crm-text-primary);
      position: relative;
    }
    .title-accent-bar {
      position: absolute;
      left: 0; top: 0; bottom: 0; width: 4px;
      background: linear-gradient(180deg, var(--crm-accent), color-mix(in srgb, var(--crm-accent) 60%, var(--crm-printer-photo)));
      border-radius: 0 4px 4px 0;
    }
    .title-icon {
      font-size: 22px; width: 22px; height: 22px;
      color: var(--crm-accent);
    }
    .title-text {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: min(980px, calc(100vw - 220px));
      font-weight: 500;
    }

    .print-content {
      flex: 1 1 auto;
      display: flex !important;
      flex-direction: column;
      min-height: 0;
      max-height: none !important;
      padding: 0 !important;
      overflow: hidden !important;
    }
    .print-content.status-content {
      justify-content: center;
      padding: 22px !important;
      overflow: auto !important;
    }

    .print-status-view {
      width: min(760px, 100%);
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding: 26px;
      border: 1px solid var(--crm-border, var(--mat-sys-outline-variant));
      border-radius: var(--crm-radius-md, 10px);
      background: var(--crm-surface-2, rgba(255,255,255,0.03));
    }
    .print-status-hero {
      display: flex;
      align-items: center;
      gap: 18px;
      min-width: 0;
    }
    .print-status-icon {
      width: 64px;
      height: 64px;
      flex: 0 0 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: var(--crm-accent);
      background: color-mix(in srgb, var(--crm-accent) 14%, transparent);
    }
    .print-status-icon.active {
      background: color-mix(in srgb, var(--crm-status-info, #3b82f6) 12%, transparent);
    }
    .print-status-icon mat-icon {
      font-size: 34px;
      width: 34px;
      height: 34px;
    }
    .status-done .print-status-icon {
      color: var(--crm-status-success);
      background: color-mix(in srgb, var(--crm-status-success) 14%, transparent);
    }
    .status-failed .print-status-icon,
    .status-cancelled .print-status-icon {
      color: var(--crm-status-error);
      background: color-mix(in srgb, var(--crm-status-error) 12%, transparent);
    }
    .print-status-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .print-status-printer {
      font-size: 12px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .print-status-copy h3 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      line-height: 1.15;
      color: var(--crm-text-primary);
    }
    .print-status-copy p {
      margin: 0;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 14px;
      line-height: 1.45;
    }
    .print-status-progress {
      position: relative;
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: color-mix(in srgb, var(--crm-text-muted, #94a3b8) 18%, transparent);
    }
    .print-status-progress span {
      display: block;
      height: 100%;
      min-width: 8px;
      border-radius: inherit;
      background: var(--crm-accent);
      transition: width 220ms ease;
    }
    .print-status-progress.indeterminate span {
      width: 38% !important;
      animation: print-progress-slide 1.2s ease-in-out infinite;
    }
    .status-done .print-status-progress span {
      background: var(--crm-status-success);
    }
    .status-failed .print-status-progress span,
    .status-cancelled .print-status-progress span {
      background: var(--crm-status-error);
    }
    @keyframes print-progress-slide {
      0% { transform: translateX(-105%); }
      100% { transform: translateX(265%); }
    }
    .print-status-details {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .print-status-details div {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--crm-glass-border, var(--mat-sys-outline-variant));
      border-radius: var(--crm-radius-sm, 8px);
      background: color-mix(in srgb, var(--crm-surface-3, #ffffff) 6%, transparent);
    }
    .print-status-details span {
      display: block;
      margin-bottom: 5px;
      font-size: 11px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }
    .print-status-details strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      color: var(--crm-text-primary);
    }
    .print-status-steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .print-status-step {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      font-size: 12px;
    }
    .step-marker {
      width: 26px;
      height: 26px;
      flex: 0 0 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: 1px solid var(--crm-glass-border, var(--mat-sys-outline-variant));
      background: var(--crm-surface-1, transparent);
    }
    .step-marker mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .print-status-step.done,
    .print-status-step.active {
      color: var(--crm-text-primary);
    }
    .print-status-step.done .step-marker {
      color: var(--crm-status-success);
      border-color: color-mix(in srgb, var(--crm-status-success) 48%, transparent);
      background: color-mix(in srgb, var(--crm-status-success) 10%, transparent);
    }
    .print-status-step.active .step-marker {
      color: var(--crm-accent);
      border-color: color-mix(in srgb, var(--crm-accent) 60%, transparent);
      background: color-mix(in srgb, var(--crm-accent) 12%, transparent);
    }
    .print-status-step.failed .step-marker {
      color: var(--crm-status-error);
      border-color: color-mix(in srgb, var(--crm-status-error) 52%, transparent);
      background: color-mix(in srgb, var(--crm-status-error) 10%, transparent);
    }
    .print-status-error {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      border-radius: var(--crm-radius-sm, 8px);
      border: 1px solid color-mix(in srgb, var(--crm-status-error) 36%, transparent);
      background: color-mix(in srgb, var(--crm-status-error) 10%, transparent);
      color: var(--crm-status-error);
      font-size: 13px;
      line-height: 1.4;
    }
    .print-status-error mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-top: 1px;
    }

    /* ═══ PRESETS ═══ */
    .presets-panel {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--crm-border, var(--mat-sys-outline-variant));
      overflow: hidden;
    }
    .presets-panel.empty {
      padding: 8px 18px;
    }
    .preset-empty {
      font-size: 12px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }
    .preset-category-row,
    .preset-actions-row {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
      padding-bottom: 2px;
    }
    .preset-category-row {
      flex: 0 0 auto;
      max-width: min(46%, 520px);
    }
    .preset-actions-row {
      flex: 1 1 auto;
      min-width: 0;
    }
    .preset-category,
    .preset-chip {
      flex: 0 0 auto;
      border-radius: var(--crm-radius-sm, 8px) !important;
      transition: background var(--crm-transition-fast, 120ms) ease,
                  border-color var(--crm-transition-fast, 120ms) ease,
                  color var(--crm-transition-fast, 120ms) ease !important;
      border-color: var(--crm-glass-border, var(--mat-sys-outline-variant)) !important;
      white-space: nowrap;
    }
    .preset-category {
      font-size: 12px !important;
      min-height: 32px !important;
      padding: 0 10px !important;
    }
    .preset-category.active,
    .preset-chip.active {
      background: color-mix(in srgb, var(--crm-accent) 18%, transparent) !important;
      color: var(--crm-accent) !important;
      border-color: var(--crm-accent) !important;
    }
    .preset-category:hover,
    .preset-chip:hover {
      background: color-mix(in srgb, var(--crm-accent) 10%, transparent) !important;
      border-color: color-mix(in srgb, var(--crm-accent) 75%, transparent) !important;
    }
    .preset-category mat-icon,
    .preset-chip mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-right: 5px;
    }
    .preset-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      margin-left: 2px;
      padding: 0 5px;
      border-radius: 9px;
      font-size: 11px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      background: color-mix(in srgb, var(--crm-text-muted, #9ca3af) 12%, transparent);
    }
    .preset-chip {
      font-size: 12px !important;
      min-height: 34px !important;
      max-width: 240px;
      padding: 0 12px !important;
    }
    .preset-chip span {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ═══ MAIN GRID ═══ */
    .main-grid {
      flex: 1 1 auto;
      min-height: 0;
      height: 100%;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: minmax(420px, 1fr) minmax(430px, 520px);
      gap: 12px;
      padding: 12px 14px;
    }
    .document-set-content .main-grid {
      grid-template-columns: minmax(520px, 1fr) minmax(430px, 520px);
    }

    /* ═══ PREVIEW ═══ */
    .preview-panel {
      min-width: 0;
      min-height: 0;
      box-sizing: border-box;
      display: flex; flex-direction: column;
      align-items: center; gap: 12px;
      justify-content: center;
      padding: 4px 0;
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
    .preview-panel.document-preview-panel {
      justify-content: flex-start;
      padding-top: 0;
    }
    .canvas-wrapper {
      position: relative;
      flex: 0 0 auto;
      border: 1px solid var(--crm-border, var(--mat-sys-outline-variant));
      border-radius: var(--crm-radius-md, 10px); overflow: hidden;
      background: #ffffff;
      box-shadow: var(--crm-shadow-card, 0 2px 12px rgba(0,0,0,.08));
    }
    .canvas-wrapper.document-pages-wrapper {
      width: min(100%, 720px) !important;
      height: auto;
      min-height: 220px;
      overflow: visible;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      display: flex;
      justify-content: center;
    }
    .preview-sheet {
      display: block;
      width: 100%;
      height: 100%;
    }
    .canvas-placeholder {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,.8);
    }
    .server-preview {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 4px;
      transition: transform 60ms ease-out;
      user-select: none;
    }
    .server-preview.document-pages-image {
      width: 100%;
      max-width: 720px;
      height: auto;
      object-fit: contain;
      border-radius: var(--crm-radius-sm, 8px);
      background: #ffffff;
      box-shadow: var(--crm-shadow-card, 0 2px 12px rgba(0,0,0,.12));
    }
    .pdf-pages-preview {
      width: min(100%, 720px);
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 14px;
      overflow-anchor: none;
    }
    .pdf-page-preview {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 0 0 6px;
      border: 1px solid transparent;
      border-radius: var(--crm-radius-sm, 8px);
      background: transparent;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      transition: border-color var(--crm-transition-fast, 120ms) ease,
                  opacity var(--crm-transition-fast, 120ms) ease;
    }
    .pdf-page-preview img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--crm-radius-sm, 8px);
      background: #ffffff;
      box-shadow: var(--crm-shadow-card, 0 2px 12px rgba(0,0,0,.12));
    }
    .pdf-page-preview:not(.selected) img {
      opacity: 0.42;
    }
    .pdf-page-preview.selected {
      color: var(--crm-text-primary);
    }
    .pdf-page-preview.current {
      border-color: var(--crm-accent);
    }
    .zoom-active {
      color: var(--crm-accent) !important;
    }
    .preview-updating {
      background: rgba(0,0,0,0.15);
    }
    .layout-preview-pending {
      flex-direction: column;
      gap: 10px;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 12px;
      background: rgba(255,255,255,.92);
    }
    .layout-preview-error {
      flex-direction: column;
      gap: 8px;
      padding: 18px;
      text-align: center;
      color: var(--crm-danger, #b3261e);
      font-size: 12px;
      background: rgba(255,255,255,.94);
    }
    .layout-preview-error mat-icon {
      width: 24px;
      height: 24px;
      font-size: 24px;
    }
    .preview-toolbar {
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      justify-content: center;
    }
    .document-preview-panel .preview-toolbar {
      order: -1;
      position: sticky;
      top: 0;
      z-index: 3;
      width: min(100%, 720px);
      box-sizing: border-box;
      padding: 8px;
      border: 1px solid var(--crm-border, var(--mat-sys-outline-variant));
      border-radius: var(--crm-radius-sm, 8px);
      background: color-mix(in srgb, var(--crm-surface-0, #171717) 92%, transparent);
      backdrop-filter: blur(8px);
    }
    .crop-toggle-btn {
      width: 34px !important; height: 34px !important;
      transition: all var(--crm-transition-fast, 120ms) ease;
    }
    .crop-toggle-btn mat-icon { font-size: 18px; }
    .crop-toggle-btn.active {
      color: var(--crm-accent, var(--mat-sys-primary));
      background: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 12%, transparent);
      border-radius: 50%;
    }
    .rotate-btn {
      width: 34px !important; height: 34px !important;
    }
    .rotate-btn mat-icon { font-size: 18px; }
    .paper-label {
      font-size: 12px; color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-weight: 500;
    }
    .document-page-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 28px;
      padding: 0 9px;
      border: 1px solid var(--crm-glass-border, var(--mat-sys-outline-variant));
      border-radius: var(--crm-radius-sm, 8px);
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 12px;
      line-height: 1;
      white-space: nowrap;
    }
    .document-page-chip mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
      color: var(--crm-text-muted);
    }
    .document-status-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 28px;
      max-width: min(420px, 38vw);
      padding: 0 9px;
      border: 1px solid color-mix(in srgb, var(--crm-warning, #f59e0b) 34%, transparent);
      border-radius: var(--crm-radius-sm, 8px);
      color: var(--crm-warning, #f59e0b);
      background: color-mix(in srgb, var(--crm-warning, #f59e0b) 9%, transparent);
      font-size: 12px;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .document-status-chip.pending {
      color: var(--crm-accent, var(--mat-sys-primary));
      border-color: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 34%, transparent);
      background: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 9%, transparent);
    }
    .document-status-chip mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
      flex-shrink: 0;
    }
    .sublim-badge {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 11px; font-weight: 500;
      color: var(--crm-printer-sublimation); padding: 3px 10px;
      border-radius: var(--crm-radius-sm, 10px);
      background: color-mix(in srgb, var(--crm-printer-sublimation) 10%, transparent);
    }
    .sublim-badge mat-icon {
      font-size: 13px; width: 13px; height: 13px;
    }
    .pdf-placeholder, .doc-placeholder {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 10px; height: 100%;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
    }
    .doc-placeholder small {
      font-size: 12px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }
    .pdf-placeholder mat-icon, .doc-placeholder mat-icon {
      font-size: 48px; width: 48px; height: 48px; opacity: 0.5;
    }
    .pdf-loading, .doc-loading {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 10px; height: 100%; color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 13px;
    }
    .doc-placeholder-status {
      max-width: min(320px, 70vw);
      color: var(--crm-warning, var(--mat-sys-error));
      text-align: center;
    }
    .xlsx-preview-container {
      width: 100%; height: 100%;
      overflow: auto;
    }
    .xlsx-table {
      width: 100%; border-collapse: collapse;
      font-size: 10px;
    }
    .xlsx-table th, .xlsx-table td {
      border: 1px solid #ddd;
      padding: 3px 6px;
      white-space: nowrap;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .xlsx-table th {
      background: var(--crm-surface-raised, #f5f5f5);
      font-weight: 600;
      position: sticky; top: 0;
    }
    .pdf-nav {
      display: flex; align-items: center; gap: 4px;
    }
    .pdf-nav-btn {
      width: 30px !important; height: 30px !important;
    }
    .pdf-nav-btn mat-icon { font-size: 18px; }
    .pdf-page-label {
      font-size: 12px; color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      min-width: 40px; text-align: center;
    }
    .pdf-page-check {
      margin: 0 2px;
    }
    .pdf-jump-field {
      width: 74px;
      font-size: 12px;
    }
    .pdf-jump-field input {
      text-align: center;
    }
    .pdf-jump-field ::ng-deep .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }
    .pdf-page-selection {
      display: flex; align-items: flex-start; gap: 8px;
      margin-top: 4px; flex-wrap: wrap;
    }
    .pdf-sel-btn {
      font-size: 11px !important; min-height: 28px !important;
      padding: 0 10px !important; white-space: nowrap;
    }
    .pdf-range-field {
      width: 140px;
      font-size: 12px;
    }
    .recommended-hint {
      display: flex; align-items: center; gap: 5px;
      color: var(--crm-accent, var(--mat-sys-primary));
      font-size: 11px; cursor: pointer;
      padding: 4px 8px; margin: -2px 0 0;
      border-radius: var(--crm-radius-sm, 6px);
      transition: background var(--crm-transition-fast, 120ms) ease;
    }
    .recommended-hint:hover {
      background: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 12%, transparent);
    }
    .recommended-hint mat-icon {
      font-size: 14px; width: 14px; height: 14px;
    }

    /* ═══ SETTINGS ═══ */
    .settings-panel {
      min-height: 0;
      box-sizing: border-box;
      display: flex; flex-direction: column; gap: 10px;
      overflow-y: auto;
      max-height: none;
      padding-right: 4px;
    }

    /* PRINTER CARDS */
    .studio-label {
      font-size: 12px; font-weight: 600;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      margin: 2px 0 2px;
      display: flex; align-items: center; gap: 4px;
    }
    .studio-icon {
      font-size: 15px; width: 15px; height: 15px;
      color: var(--crm-text-muted, var(--mat-sys-outline));
    }
    .printer-cards-row {
      display: flex; gap: 8px; flex-wrap: wrap;
    }
    .printer-card {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
      border: 2px solid var(--crm-glass-border, var(--mat-sys-outline-variant));
      border-radius: var(--crm-radius-sm, 8px); cursor: pointer;
      transition: all var(--crm-transition-normal, 200ms) ease;
      flex: 1; min-width: 180px;
      background: var(--crm-surface-2, transparent);
    }
    .printer-card:hover {
      border-color: color-mix(in srgb, var(--crm-accent) 50%, transparent);
      box-shadow: var(--crm-shadow-card-hover, 0 4px 12px rgba(0,0,0,0.12));
      transform: translateY(-1px);
    }
    .printer-card.selected {
      border-color: var(--crm-accent);
      background: color-mix(in srgb, var(--crm-accent) 12%, transparent);
      box-shadow: 0 2px 10px color-mix(in srgb, var(--crm-accent) 20%, transparent);
    }
    .printer-card.offline { opacity: 0.45; }
    .supply-indicator { display: flex; gap: 3px; margin-left: auto; padding-left: 4px; }
    .supply-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .printer-type-icon {
      font-size: 28px; width: 28px; height: 28px; flex-shrink: 0;
    }
    .type-photo { color: var(--crm-printer-photo); }
    .type-mfp, .type-document { color: var(--crm-printer-mfp); }
    .type-sublimation { color: var(--crm-printer-sublimation); }
    .printer-card-body {
      display: flex; flex-direction: column; min-width: 0; gap: 1px;
    }
    .printer-card-name {
      font-size: 14px; font-weight: 500; line-height: 1.25;
      color: var(--crm-text-primary);
      word-break: break-word;
    }
    .printer-card-type {
      font-size: 11px; color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }
    .status-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--crm-status-error); flex-shrink: 0; margin-left: auto;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--crm-status-error) 25%, transparent);
    }
    .status-dot.online {
      background: var(--crm-status-success);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--crm-status-success) 25%, transparent);
      animation: pulse-online 2s ease-in-out infinite;
    }
    @keyframes pulse-online {
      0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--crm-status-success) 25%, transparent); }
      50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--crm-status-success) 15%, transparent); }
    }

    .printer-cards-row.compact .printer-card {
      min-width: 150px;
      padding: 8px 12px;
    }
    .printer-cards-row.compact .printer-type-icon {
      font-size: 22px; width: 22px; height: 22px;
    }
    .printer-cards-row.compact .printer-card-name {
      font-size: 12px;
    }
    .printer-cards-row.compact .printer-card-type {
      font-size: 10px;
    }

    /* SETTINGS SECTIONS */
    .settings-section {
      display: flex; flex-direction: column; gap: 8px;
      background: var(--crm-surface-2, rgba(255,255,255,0.03));
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.06));
      border-radius: var(--crm-radius-sm, 8px);
      padding: 12px;
    }
    .settings-section-title {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      letter-spacing: 0;
      margin-bottom: 2px;
    }
    .settings-section-title mat-icon {
      font-size: 16px; width: 16px; height: 16px;
      color: var(--crm-text-muted);
    }
    .document-page-summary {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 32px;
      padding: 7px 9px;
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: var(--crm-radius-sm, 8px);
      background: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 7%, transparent);
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 12px;
      line-height: 1.25;
    }
    .document-page-summary mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }
    .document-page-summary strong {
      margin-left: auto;
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
      font-weight: 600;
      white-space: nowrap;
    }
    .doc-font-summary {
      align-items: flex-start;
    }
    .doc-font-summary span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .coverage-pages-panel {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 9px;
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: var(--crm-radius-sm, 8px);
      background: color-mix(in srgb, var(--crm-surface-1, #1b1b1b) 80%, transparent);
    }
    .coverage-pages-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 12px;
      font-weight: 600;
    }
    .coverage-pages-title span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .coverage-pages-title mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-text-muted);
    }
    .coverage-pages-title em {
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      font-size: 11px;
      font-style: normal;
      font-weight: 500;
      white-space: nowrap;
    }
    .coverage-pages-list {
      display: grid;
      gap: 5px;
      max-height: 196px;
      overflow-y: auto;
      padding-right: 2px;
    }
    .coverage-pages-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 12px;
    }
    .coverage-page-row {
      display: grid;
      grid-template-columns: 30px minmax(80px, 1fr) 42px 54px;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 30px;
      padding: 5px 7px;
      border: 1px solid transparent;
      border-radius: var(--crm-radius-sm, 7px);
      background: rgba(255,255,255,0.035);
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font: inherit;
      text-align: left;
    }
    .coverage-page-row:not(:disabled) {
      cursor: pointer;
    }
    .coverage-page-row:not(:disabled):hover,
    .coverage-page-row.selected {
      border-color: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 45%, transparent);
      background: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 11%, transparent);
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
    }
    .coverage-page-row:disabled {
      cursor: default;
      opacity: 1;
    }
    .coverage-page-row.high .coverage-page-bar span {
      background: var(--crm-status-error, #f44336);
    }
    .coverage-page-no {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 22px;
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(255,255,255,0.06);
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
      font-size: 12px;
      font-weight: 700;
    }
    .coverage-page-bar {
      position: relative;
      display: block;
      height: 7px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
    }
    .coverage-page-bar span {
      position: absolute;
      inset: 0 auto 0 0;
      min-width: 3px;
      border-radius: inherit;
      background: var(--crm-accent, var(--mat-sys-primary));
    }
    .coverage-page-percent,
    .coverage-page-price {
      font-size: 12px;
      font-weight: 600;
      text-align: right;
      white-space: nowrap;
    }
    .coverage-page-price {
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
    }

    /* DOCUMENT LAYOUT */
    .doc-layout-section {
      display: flex; flex-direction: column; gap: 8px;
      padding: 8px 0;
    }
    .doc-layout-row {
      display: flex; gap: 14px; align-items: center;
    }
    .doc-layout-info {
      display: flex; flex-direction: column; gap: 3px;
    }
    .doc-layout-label {
      font-size: 13px; font-weight: 500; color: var(--crm-document-accent);
    }
    .doc-layout-count {
      font-size: 12px; color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
    }
    .doc-layout-source {
      font-size: 11px; color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }
    .doc-layout-footer {
      font-size: 11px; color: var(--crm-status-warning); font-style: italic;
    }
    .doc-set-mode {
      background: var(--crm-status-warning-container);
      border-radius: 8px;
      padding: 8px !important;
      border-left: 3px solid var(--crm-status-warning);
    }
    .face-chip {
      display: inline-block;
      margin-top: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      &.valid { background: #4caf50; color: #fff; }
      &.invalid { background: #f44336; color: #fff; }
      &.loading { background: #9e9e9e; color: #fff; }
    }

    /* FORM */
    .settings-row { display: flex; gap: 10px; }
    .field-half { flex: 1; }
    .full-width { width: 100%; }
    .section-label {
      font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      display: block; margin-bottom: 4px;
    }

    /* FIT MODE */
    .fit-section { display: flex; flex-direction: column; gap: 6px; }
    .fit-toggles {
      border-radius: var(--crm-radius-sm, 8px);
    }
    .fit-toggles mat-button-toggle mat-icon {
      font-size: 18px; width: 18px; height: 18px;
    }
    .mode-toggles {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      border-radius: var(--crm-radius-sm, 8px);
    }
    .mode-toggles mat-button-toggle {
      min-width: 0;
    }
    .mode-toggles mat-button-toggle mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }
    .compact-mode-toggles mat-button-toggle {
      font-size: 12px;
    }
    .scale-mode-toggles mat-button-toggle {
      min-height: 42px;
    }
    .scale-control-row {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) 92px;
      align-items: center;
      gap: 10px;
      min-height: 48px;
    }
    .scale-slider {
      width: 100%;
      accent-color: var(--crm-accent, var(--mat-sys-primary));
    }
    .scale-percent-field {
      width: 92px;
    }
    .scale-percent-field ::ng-deep .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }
    .source-aspect-info {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      min-height: 28px; padding: 5px 8px;
      border-radius: var(--crm-radius-sm, 8px);
      background: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 8%, transparent);
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 11px; line-height: 1.35;
    }
    .source-aspect-info.warning {
      background: color-mix(in srgb, var(--crm-status-warning, #ff9800) 12%, transparent);
      color: var(--crm-status-warning, #ff9800);
    }
    .source-aspect-info mat-icon {
      font-size: 15px; width: 15px; height: 15px; flex-shrink: 0;
    }
    .source-aspect-divider {
      width: 1px; height: 14px;
      background: color-mix(in srgb, currentColor 45%, transparent);
      opacity: 0.6;
    }

    /* COPIES & PRICE */
    .copies-price-row {
      display: flex; align-items: center;
      justify-content: space-between; padding: 4px 0;
    }
    .copies-section {
      display: flex; flex-direction: column; gap: 2px;
    }
    .copies-buttons {
      display: flex; align-items: center; gap: 4px;
    }
    .copies-btn {
      width: 34px !important; height: 34px !important;
    }
    .copies-btn mat-icon {
      font-size: 18px; width: 18px; height: 18px;
    }
    .copies-value {
      width: 36px; text-align: center;
      font-weight: 700; font-size: 20px;
      color: var(--crm-text-primary);
    }
    .price-display {
      display: flex; align-items: baseline; justify-content: flex-end; gap: 6px;
      font-size: 13px; color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      min-width: 0;
      text-align: right;
    }
    .price-unit {
      font-size: 13px;
      color: var(--crm-text-muted);
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .price-eq { font-size: 14px; color: var(--crm-text-muted); }
    .price-total {
      font-size: 22px; font-weight: 700;
      color: var(--crm-accent, var(--mat-sys-primary));
    }

    /* SPLITTING */
    .split-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 0;
    }
    .split-row mat-icon { font-size: 18px; width: 18px; height: 18px; margin-right: 4px; }
    .split-options {
      display: flex; flex-direction: column; gap: 10px;
      padding: 8px 0 4px 14px;
      border-left: 2px solid rgba(156,39,176,.3);
    }
    .split-printers {
      display: flex; flex-wrap: wrap; gap: 8px;
    }
    .split-preview {
      font-size: 12px; color: var(--crm-text-secondary);
      background: rgba(156,39,176,.08); padding: 6px 10px; border-radius: 8px;
    }

    /* ADVANCED */
    .advanced-toggle {
      display: flex; align-items: center; gap: 5px;
      cursor: pointer; padding: 8px 0 4px; font-size: 13px;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      user-select: none;
      transition: color var(--crm-transition-fast, 120ms) ease;
    }
    .advanced-toggle:hover { color: var(--crm-text-primary, var(--mat-sys-on-surface)); }
    .expand-icon {
      font-size: 20px; width: 20px; height: 20px;
      transition: transform var(--crm-transition-fast, 120ms) ease;
    }
    .advanced-body {
      display: flex; flex-direction: column; gap: 12px;
      padding: 8px 0 4px 14px;
      border-left: 2px solid var(--crm-glass-border, var(--mat-sys-outline-variant));
    }
    .toggle-row {
      display: flex; align-items: center; gap: 8px; font-size: 13px;
      color: var(--crm-text-primary);
    }
    .toggle-icon {
      font-size: 18px; width: 18px; height: 18px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }
    .toggle-ctrl { margin-left: auto; }

    /* ═══ SCHEDULING ═══ */
    .schedule-row {
      display: flex; gap: 10px;
    }
    .clear-schedule-btn {
      font-size: 11px !important;
      min-height: 28px !important;
      padding: 0 10px !important;
      mat-icon { font-size: 14px; width: 14px; height: 14px; margin-right: 3px; }
    }

    /* ═══ FINISHING ═══ */
    .finishing-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    /* ═══ RESTORE BANNER ═══ */
    .restore-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 24px;
      background: color-mix(in srgb, var(--crm-status-info) 10%, transparent);
      border-top: 1px solid color-mix(in srgb, var(--crm-status-info) 20%, transparent);
      color: var(--crm-status-info);
      font-size: 12px;
    }
    .restore-banner mat-icon {
      font-size: 16px; width: 16px; height: 16px;
    }
    .restore-dismiss {
      margin-left: auto;
      font-size: 11px !important;
      min-height: 24px !important;
      padding: 0 8px !important;
    }

    /* ═══ DIALOG ACTIONS ═══ */
    mat-dialog-actions {
      flex: 0 0 auto;
      padding: 12px 24px 18px !important;
      gap: 12px !important;
      border-top: 1px solid var(--crm-border, var(--mat-sys-outline-variant));
    }
    .footer-price-summary {
      margin-right: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      max-width: min(58vw, 760px);
      padding: 8px 12px;
      border: 1px solid var(--crm-border, var(--mat-sys-outline-variant));
      border-radius: var(--crm-radius-sm, 8px);
      background: color-mix(in srgb, var(--crm-surface-2, #222222) 78%, transparent);
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 13px;
      line-height: 1.3;
    }
    .footer-price-count {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
      font-weight: 600;
      white-space: nowrap;
    }
    .footer-price-count mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }
    .footer-price-formula {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    mat-dialog-actions button[mat-flat-button] {
      min-height: 44px !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      padding: 0 24px !important;
      border-radius: var(--crm-radius-sm, 8px) !important;
      letter-spacing: 0;
    }
    mat-dialog-actions button[mat-stroked-button] {
      min-height: 40px !important;
      font-size: 13px !important;
      border-radius: var(--crm-radius-sm, 8px) !important;
    }
    .cart-action-btn,
    .print-action-btn {
      min-height: 44px !important;
      font-weight: 600 !important;
    }
    .cart-action-btn mat-icon,
    .print-action-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 5px;
    }
    .btn-spinner { display: inline-flex; vertical-align: middle; }

    .price-warning-chip {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; margin: 0 24px 8px;
      background: color-mix(in srgb, var(--crm-warning, #f59e0b) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--crm-warning, #f59e0b) 40%, transparent);
      border-radius: 6px;
      color: var(--crm-warning, #f59e0b);
      font-size: 13px;
    }
    .price-warning-chip mat-icon {
      font-size: 18px; width: 18px; height: 18px;
    }
    .price-warning-chip.pending {
      color: var(--crm-accent, var(--mat-sys-primary));
      background: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 10%, transparent);
      border-color: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 34%, transparent);
    }
    @media (max-width: 1100px) {
      .print-content {
        overflow: auto !important;
      }
      .print-content.status-content {
        justify-content: flex-start;
      }
      .main-grid,
      .document-set-content .main-grid {
        grid-template-columns: 1fr;
        height: auto;
      }
      .presets-panel {
        flex-wrap: nowrap;
      }
      .preset-category-row {
        max-width: none;
      }
      .print-status-details,
      .print-status-steps {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .preview-panel,
      .settings-panel {
        min-height: 360px;
      }
      .settings-panel {
        overflow: visible;
      }
      mat-dialog-actions {
        align-items: stretch !important;
      }
      .footer-price-summary {
        order: -1;
        width: 100%;
        max-width: none;
        margin-right: 0;
      }
      .title-text {
        max-width: calc(100vw - 120px);
      }
    }

    @media (max-width: 640px) {
      .presets-panel {
        padding-inline: 12px;
      }
      .print-content.status-content {
        padding: 14px !important;
      }
      .print-status-view {
        padding: 18px;
      }
      .print-status-hero {
        align-items: flex-start;
        gap: 12px;
      }
      .print-status-icon {
        width: 48px;
        height: 48px;
        flex-basis: 48px;
      }
      .print-status-copy h3 {
        font-size: 20px;
      }
      .print-status-details,
      .print-status-steps {
        grid-template-columns: 1fr;
      }
      .footer-price-summary {
        flex-wrap: wrap;
      }
      .footer-price-formula {
        white-space: normal;
      }
    }
  `],
})
export class PrintDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly data: PrintDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PrintDialogComponent, PrintDialogResult>);
  private readonly printApi = inject(PrintApiService);
  private readonly toast = inject(ToastService);
  private readonly faceValidationApi = inject(FaceValidationApiService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly quickPrintService = inject(QuickPrintService);
  private readonly infraRealtime = inject(InfraRealtimeService);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('previewCanvas');
  private readonly previewPanelRef = viewChild<ElementRef<HTMLElement>>('previewPanel');

  // ── Signals ────────────────────────────────────────────
  printers = signal<Printer[]>([]);
  statuses = signal<BridgePrinterStatus[]>([]);
  telemetry = signal<PrinterTelemetry[]>([]);
  printing = signal(false);
  printStatusJob = signal<PrintJob | null>(null);
  imageLoaded = signal(false);
  isPdf = signal(false);
  pdfPageCount = signal(0);
  pdfCurrentPage = signal(1);
  pdfLoading = signal(false);
  showAdvanced = signal(false);
  rotation = signal(0);
  activePresetId = signal<string | null>(null);
  selectedBusinessCardPresetId = signal<BusinessCardPhotoPresetId | null>(null);
  selectedPresetCategoryId = signal<PresetCategoryId | null>(null);
  serverPreviewUrl = signal<string | null>(null);
  serverPreviewLoading = signal(false);
  serverPreviewError = signal<string | null>(null);
  apiPresets = signal<PrintPresetRecord[]>([]);
  xlsPreviewData = signal<{ headers: string[]; rows: string[][] } | null>(null);
  docLoading = signal(false);
  showCropOverlay = signal(false);
  cropRectValue = signal<CropRect | null>(null);
  polaroidMode = signal(false);
  imgNaturalW = signal(0);
  imgNaturalH = signal(0);
  recommendedFormat = signal<{ presetId: string; orientation: 'portrait' | 'landscape'; label: string } | null>(null);
  selectedPdfPages = signal<readonly number[]>([]);
  pdfPageRangeInput = signal('');
  readonly allPdfPagesSelected = computed(() => this.selectedPdfPages().length === 0);
  readonly selectedPdfPagesCount = computed(() => {
    const sel = this.selectedPdfPages().length;
    if (sel > 0) return sel;
    const pages = this.pdfPageCount();
    return pages > 0 ? pages : 1;
  });
  private readonly previewPanelBounds = signal({ width: 460, height: 620 });

  private previewRequest$ = new Subject<void>();
  private readonly previewObjectUrls = new Set<string>();
  private currentPreviewId = signal<string | null>(null);
  private serverPreviewRequestSeq = 0;
  private previewPanelResizeObserver: ResizeObserver | null = null;
  private printStatusSubscribed = false;
  private printStatusPollingJobId: string | null = null;

  // ── Form state (signals) ────────────────────────────────
  printer_id = signal('');
  paper_size = signal('A4');
  media_type = signal('');
  quality = signal('normal');
  fit_mode = signal<'fit' | 'fill' | 'stretch' | 'actual'>('fit');
  copies = signal(1);
  orientation = signal<'portrait' | 'landscape' | 'auto'>('auto');
  borderless = signal(false);
  isBw = signal(false);
  duplex = signal(false);
  mirror = signal(false);
  paperSource = signal('auto');
  renderingIntent = signal<'perceptual' | 'relative_colorimetric' | 'saturation' | 'absolute_colorimetric'>('perceptual');

  // ── MFP/Document extended ──
  pages_per_sheet = signal(1);
  target_dpi = signal(300);
  docFontSizeDeltaPt = signal(0);
  collate = signal(true);
  toner_save = signal(false);
  gray_mode = signal('');

  // ── Watermark & Banner ──
  watermarkText = signal('');
  watermarkOpacity = signal(50);
  watermarkPosition = signal<'center' | 'top' | 'bottom' | 'diagonal'>('diagonal');
  bannerPage = signal(false);

  // ── PDF page range ──
  pageRange = signal('');

  // ── MFP/Document finishing & layout ──
  output_bin = signal<'auto' | 'standard' | 'finisher_bin1' | 'face_up'>('auto');
  documentScaleMode = signal<DocumentScaleMode>('fit');
  scaling_percent = signal(100);
  duplex_mode = signal<'off' | 'long_edge' | 'short_edge'>('off');
  booklet = signal(false);
  color_auto_detect = signal(false);
  binding_edge = signal<'none' | 'left' | 'top' | 'right' | 'bottom'>('none');
  staple_position = signal('');
  hole_punch_type = signal('');

  // ── Canon MFP ──
  departmentId = signal('');
  securePin = signal('');

  // ── Scheduling ──
  scheduledDate = signal<Date | null>(null);
  scheduledTime = signal('');
  readonly minScheduleDate = new Date();

  // ── Splitting ──
  splitEnabled = signal(false);
  splitStrategy = signal<'round_robin' | 'even'>('round_robin');
  splitTargetPrinters = signal<string[]>([]);

  readonly splitCandidates = computed(() => {
    const current = this.currentPrinter();
    if (!current) return [];
    return this.printers().filter(p =>
      p.id !== current.id && p.printer_type === current.printer_type &&
      p.is_active && !p.queue_paused
    );
  });
  readonly canSplit = computed(() => this.copies() > 1 && this.splitCandidates().length > 0);

  readonly splitPreviewText = computed(() => {
    if (!this.splitEnabled()) return '';
    const n = 1 + this.splitTargetPrinters().length;
    if (n < 2) return '';
    const total = this.copies();
    const per = Math.floor(total / n);
    const rem = total % n;
    return `${total} копий \u2192 ${per}${rem ? '\u2013' + (per + 1) : ''} на принтер (${n} шт)`;
  });

  // ── Finishing operations ──
  selectedFinishingOps = signal<string[]>([]);
  readonly finishingOptions = [
    { id: 'trim', icon: 'content_cut', label: 'Обрезка' },
    { id: 'laminate', icon: 'layers', label: 'Ламинация' },
    { id: 'fold', icon: 'turn_right', label: 'Фальцовка' },
    { id: 'staple', icon: 'push_pin', label: 'Сшивка' },
    { id: 'punch', icon: 'radio_button_unchecked', label: 'Перфорация' },
  ];

  // ── Coverage analysis ──
  private readonly coverageService = inject(CoverageAnalysisService);
  coverageResult = signal<CoverageResult | null>(null);
  coverageLoading = signal(false);
  coverageOverridden = signal(false);
  coveragePending = signal(false);
  private activeCoverageRequestKey: string | null = null;

  showCoverageBadge = computed(() => {
    if (this.activeBusinessCardPreset()) return false;
    const type = this.fileType();
    if (type !== 'image' && !this.isDocumentFileType(type)) return false;
    const printer = this.currentPrinter();
    if (!printer) return false;
    const isMfpOrDoc = this.isCoveragePrinter(printer);
    const isA4 = this.paper_size() === 'A4' || this.paper_size() === 'A3';
    return isMfpOrDoc && isA4;
  });
  readonly currentPrinterSupportsCoverage = computed(() => this.isCoveragePrinter(this.currentPrinter()));

  readonly requiresCoveragePricing = computed(() =>
    this.showCoverageBadge() && !this.coverageOverridden(),
  );

  readonly knownDocumentPageCount = computed(() => {
    if (!this.isDocumentFileType()) return 0;
    const coveragePages = this.coverageResult()?.page_count ?? 0;
    return Math.max(this.pdfPageCount(), coveragePages);
  });

  readonly documentPageCount = computed(() => {
    if (!this.isDocumentFileType()) return 1;
    return Math.max(1, this.knownDocumentPageCount());
  });

  readonly selectedDocumentPagesCount = computed(() => {
    if (!this.isDocumentFileType()) return 1;
    const knownTotal = this.knownDocumentPageCount();
    if (!this.isPdf()) return Math.max(1, knownTotal);
    const selectedPages = this.selectedPdfPages();
    if (knownTotal <= 0) {
      return selectedPages.length > 0 ? selectedPages.length : 1;
    }
    const selected = selectedPages.filter(page => page >= 1 && page <= knownTotal);
    return selected.length > 0 ? selected.length : knownTotal;
  });

  readonly documentPageSummaryLabel = computed(() => {
    if (!this.isDocumentFileType()) return null;
    const knownTotal = this.knownDocumentPageCount();
    if (knownTotal <= 0) return null;
    if (this.isPdf()) {
      const selected = this.selectedDocumentPagesCount();
      if (selected !== knownTotal) {
        return `${selected} из ${knownTotal} ${this.pageWord(knownTotal)}`;
      }
    }
    return `${knownTotal} ${this.pageWord(knownTotal)}`;
  });

  readonly documentWorkStatusLabel = computed((): string | null => {
    if (!this.isDocumentFileType()) return null;
    const previewLoading = this.serverPreviewLoading();
    const coveragePending = this.coveragePending();

    if (previewLoading && coveragePending) {
      return 'Готовим предпросмотр, считаем страницы и цену';
    }
    if (previewLoading) return 'Готовим предпросмотр документа';
    if (coveragePending) return 'Считаем страницы и цену по заливке';

    const coverageIssue = this.coveragePricingUnavailableReason();
    return coverageIssue || null;
  });

  readonly coveragePages = computed((): readonly CoveragePageResult[] =>
    this.coverageResult()?.pages ?? [],
  );

  readonly coverageFontStats = computed((): CoverageFontStats | null =>
    this.coverageResult()?.font_stats ?? null,
  );

  readonly selectedCoveragePages = computed((): readonly CoveragePageResult[] => {
    const pages = this.coveragePages();
    if (!pages.length) return [];
    if (!this.isPdf()) return pages;
    const selectedPages = this.selectedPdfPages();
    if (!selectedPages.length) return pages;
    const selectedSet = new Set(selectedPages);
    return pages.filter(page => selectedSet.has(page.page_number));
  });

  readonly showCoveragePages = computed(() => {
    if (!this.showCoverageBadge()) return false;
    if (this.coverageLoading() && !this.coveragePages().length) return true;
    return this.coveragePages().length > 0;
  });

  readonly coveragePagePriceTotal = computed(() => {
    const pages = this.selectedCoveragePages();
    if (!pages.length) return null;
    return this.roundPrice(pages.reduce(
      (sum, page) => sum + this.toPriceNumber(page.recommended_price),
      0,
    ));
  });

  readonly coveragePagesPriceLabel = computed(() => {
    const total = this.coveragePagePriceTotal();
    if (total === null) return null;
    return `${this.formatPrice(total)} ₽`;
  });

  readonly coverageSelectedSummaryLabel = computed(() => {
    const pages = this.selectedCoveragePages().length;
    if (!pages) return null;
    const total = this.coveragePages().length;
    if (this.isPdf() && total > 0 && pages !== total) {
      return `${pages} из ${total}`;
    }
    return `${pages} ${this.pageWord(pages)}`;
  });

  // ── Settings persistence ──
  hasRestoredSettings = signal(false);
  private static readonly SETTINGS_KEY = 'print_dialog_last_settings';

  // ── Canvas zoom & pan (for interactive preview) ──
  canvasZoom = signal(1);     // 0.5–3.0 range
  canvasPanX = signal(0);     // Offset in px
  canvasPanY = signal(0);

  /** CSS transform for server preview img zoom/pan */
  readonly serverPreviewTransform = computed(() => {
    const zoom = this.canvasZoom();
    const panX = this.canvasPanX();
    const panY = this.canvasPanY();
    if (zoom === 1 && panX === 0 && panY === 0) return 'none';
    return `scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)`;
  });

  readonly printPreviewFilter = computed(() => this.isBw() ? 'grayscale(1)' : 'none');

  private serverPreviewDragStart: { x: number; y: number; panX: number; panY: number } | null = null;

  /** Redraw canvas when preview size or rotation changes */
  private readonly redrawEffect = effect(() => {
    this.previewSize();
    if (this.imgEl && this.imageLoaded()) this.scheduleDraw();
  });

  /** Auto-select rendering intent for document presets */
  private readonly renderingIntentEffect = effect(() => {
    const docPreset = this.activeDocPreset();
    const docSet = this.documentSetLayout();
    const isDocument = docPreset || docSet;

    if (isDocument && this.renderingIntent() === 'perceptual') {
      // For documents, use absolute colorimetric for better color accuracy
      this.renderingIntent.set('absolute_colorimetric');
    }
  });

  /** Prevent mirror toggle for non-sublimation printers */
  private readonly mirrorEffect = effect(() => {
    if (this.mirror() && !this.isSublimation()) {
      console.warn('[Print] Mirror disabled — printer не поддерживает сублимацию');
      this.mirror.set(false);
    }
  });

  private readonly printStatusUpdateEffect = effect(() => {
    const update = this.infraRealtime.printJobUpdate();
    const job = this.printStatusJob();
    if (!update || !job || update.job_id !== job.id || !isPrintJobStatus(update.status)) return;

    const progressPercent = update.progress_percent ?? job.progress_percent;
    const currentCopy = update.progress_current_copy ?? job.progress_current_copy;
    const totalCopies = update.progress_total_copies ?? job.progress_total_copies;
    if (
      job.status === update.status &&
      job.progress_percent === progressPercent &&
      job.progress_current_copy === currentCopy &&
      job.progress_total_copies === totalCopies
    ) {
      return;
    }

    this.printStatusJob.set({
      ...job,
      status: update.status,
      progress_percent: progressPercent,
      progress_current_copy: currentCopy,
      progress_total_copies: totalCopies,
      auto_balanced: update.auto_balanced ?? job.auto_balanced,
      group_id: update.group_id ?? job.group_id,
    });
  });

  private readonly printStatusSyncEffect = effect(() => {
    const job = this.printStatusJob();
    if (!job) return;
    const syncJob = this.infraRealtime.activePrintJobs().find(item => item.id === job.id);
    if (!syncJob || !isPrintJobStatus(syncJob.status)) return;
    if (
      job.status === syncJob.status &&
      job.file_name === syncJob.file_name &&
      job.copies === syncJob.copies &&
      job.paper_size === syncJob.paper_size
    ) {
      return;
    }

    this.printStatusJob.set({
      ...job,
      status: syncJob.status,
      file_name: syncJob.file_name ?? job.file_name,
      copies: syncJob.copies,
      paper_size: syncJob.paper_size,
      priority: syncJob.priority ?? job.priority,
    });
  });

  /** dev-only observability: surface unitPrice=0 with printer selected */
  private readonly unitPriceZeroWarnEffect = !environment.production
    ? effect(() => {
        const up = this.unitPrice();
        if (up !== 0) return;
        const p = this.currentPrinter();
        if (!p) return;
        const paperSize = this.paper_size();
        const presets = this.apiPresets();
        console.warn('[PrintDialog] unitPrice=0 with printer selected', {
          printerId: p.id,
          printerName: p.name,
          printerType: p.printer_type,
          paperSize,
          apiPresetsCount: presets.length,
          matchingPreset: presets.find(x =>
            x.paper_size === paperSize && this.pricePresetMatchesPrinter(x, p)) ?? null,
          coverageResult: this.coverageResult(),
          coverageOverridden: this.coverageOverridden(),
          coveragePending: this.coveragePending(),
        });
      })
    : undefined;

  private imgEl: HTMLImageElement | null = null;
  private drawTimer: ReturnType<typeof setTimeout> | null = null;
  private canvasDragStart: { x: number; y: number; panX: number; panY: number } | null = null;

  // ── Computed ───────────────────────────────────────────
  readonly decodedFileName = computed(() => {
    const raw = this.data.file_name ?? '';
    try {
      return decodeURIComponent(decodeURIComponent(raw));
    } catch {
      try { return decodeURIComponent(raw); } catch { return raw; }
    }
  });
  readonly printStatusMode = computed(() => this.printStatusJob() !== null);
  readonly printStatusFileName = computed(() =>
    this.printStatusJob()?.file_name || this.decodedFileName() || 'Файл'
  );
  readonly dialogTitleIcon = computed(() => {
    const job = this.printStatusJob();
    return job ? this.printStatusIcon(job.status) : 'print';
  });
  readonly printStatusSteps = computed((): PrintStatusStep[] => {
    const job = this.printStatusJob();
    const status = job?.status ?? 'queued';
    const stage = this.printStatusStage(status);
    const failed = status === 'failed' || status === 'cancelled';
    const completed = status === 'completed';
    const steps = [
      { key: 'queue', label: 'В очереди', icon: 'pending_actions', stage: 0 },
      { key: 'send', label: 'Отправка', icon: 'upload_file', stage: 1 },
      { key: 'print', label: 'Печать', icon: 'print', stage: 2 },
      { key: 'finish', label: completed ? 'Передано' : failed ? 'Проблема' : 'Финиш', icon: completed ? 'check_circle' : failed ? 'error' : 'task_alt', stage: 3 },
    ] as const;

    return steps.map(step => ({
      key: step.key,
      label: step.label,
      icon: step.icon,
      done: !failed && (completed || step.stage < stage),
      active: !failed && !completed && step.stage === stage,
      failed: failed && step.stage === Math.max(0, stage),
    }));
  });

  readonly sourceFileExtension = computed(() => this.resolveSourceFileExtension());
  readonly fileType = computed((): 'image' | 'pdf' | 'docx' | 'xlsx' | 'unknown' => {
    const extension = this.sourceFileExtension();

    if (extension === 'pdf') return 'pdf';
    if ([
      'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm',
      'rtf', 'odt', 'ott',
      'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'potm', 'odp', 'otp',
      'txt', 'log',
    ].includes(extension)) {
      return 'docx';
    }
    if ([
      'xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm',
      'ods', 'ots', 'csv', 'tsv',
    ].includes(extension)) return 'xlsx';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic'].includes(extension)) {
      return 'image';
    }
    return 'unknown';
  });
  readonly fontAdjustmentAvailable = computed(() =>
    ['doc', 'docx'].includes(this.sourceFileExtension()),
  );

  currentPrinter = computed(() => this.printers().find(p => p.id === this.printer_id()));
  currentCapabilities = computed(() => this.currentPrinter()?.capabilities);
  readonly documentPagesPreviewActive = computed(() =>
    this.fileType() === 'pdf' || this.fileType() === 'docx',
  );
  readonly previewWrapperHeight = computed(() =>
    this.documentPagesPreviewActive() ? null : this.previewSize().h,
  );

  selectedPaper = computed(() =>
    this.currentCapabilities()?.paper_sizes.find(ps => ps.id === this.paper_size()) ?? null,
  );

  isSublimation = computed(() => {
    const caps = this.currentCapabilities();
    if (!caps) return false;
    return caps.sublimation === true ||
      caps.media_types?.some(m => m.id === 'ds_transfer') === true;
  });

  printerGroups = computed((): SmartPrinterGroup[] => groupPrintersSmart(this.printers()));

  availablePresets = computed(() => {
    const apiPresets = this.apiPresets();
    const presets = apiPresets
      .filter(preset => preset.is_active)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru'))
      .map(preset => this.toPrintPreset(preset))
      .filter(preset => this.quickPresetHasMatchingPrinter(preset));
    return this.dedupePresets(presets);
  });

  readonly presetCategories = computed((): PresetCategory[] => {
    const groups = new Map<PresetCategoryId, PrintPreset[]>();
    for (const preset of this.availablePresets()) {
      const categoryId = this.presetCategoryId(preset);
      const current = groups.get(categoryId) ?? [];
      groups.set(categoryId, [...current, preset]);
    }

    const categories: PresetCategory[] = [];
    for (const categoryId of this.presetCategoryOrder()) {
      const presets = groups.get(categoryId) ?? [];
      if (!presets.length) continue;
      const definition = PRESET_CATEGORY_DEFINITIONS[categoryId];
      categories.push({ ...definition, presets });
    }
    return categories;
  });

  readonly activePresetCategoryId = computed((): PresetCategoryId | null => {
    const categories = this.presetCategories();
    if (!categories.length) return null;

    const selected = this.selectedPresetCategoryId();
    if (selected && categories.some(category => category.id === selected)) {
      return selected;
    }

    if (this.isDocumentFileType()) {
      const documents = categories.find(category => category.id === 'documents');
      if (documents) return documents.id;
    }

    if (this.isCanonC3226i(this.currentPrinter())) {
      const business = categories.find(category => category.id === 'business');
      if (business) return business.id;
    }

    return categories[0].id;
  });

  readonly activePresetCategory = computed(() =>
    this.presetCategories().find(category => category.id === this.activePresetCategoryId()) ?? null,
  );

  readonly activeBusinessCardPreset = computed(() => {
    const activeId = this.activePresetId();
    const direct = this.availablePresets().find(preset =>
      preset.id === activeId && this.isBusinessCardPreset(preset),
    );
    if (direct) return direct;

    const selectedBusinessPresetId = this.selectedBusinessCardPresetId();
    if (!selectedBusinessPresetId) return null;
    return this.availablePresets().find(preset =>
      this.isBusinessCardPreset(preset) &&
      this.businessCardPhotoPresetId(preset) === selectedBusinessPresetId,
    ) ?? null;
  });

  readonly businessCardLayout = computed((): LayoutCalcResult | null => {
    const preset = this.activeBusinessCardPreset();
    if (!preset) return null;
    return calculateBusinessCardLayout(this.businessCardPhotoPresetId(preset), this.copies());
  });

  previewSize = computed(() => {
    const paper = this.selectedPaper();
    if (!paper) return { w: 300, h: 420 };
    const panel = this.previewPanelBounds();
    const isDocumentSet = !!this.documentSetLayout();
    const isBusinessCard = !!this.businessCardLayout();
    const isDocumentFile = this.isDocumentFileType();
    const maxWLimit = isDocumentFile ? 720 : isDocumentSet ? 520 : isBusinessCard ? 420 : 460;
    const maxHLimit = isDocumentFile ? 980 : isDocumentSet ? 680 : isBusinessCard ? 560 : 620;
    const maxW = Math.min(maxWLimit, Math.max(240, panel.width - 24));
    const maxH = Math.min(maxHLimit, Math.max(300, panel.height - 72));
    const rot = this.rotation() % 180;
    const pW = rot === 0 ? paper.width_mm : paper.height_mm;
    const pH = rot === 0 ? paper.height_mm : paper.width_mm;
    const scale = Math.min(maxW / pW, maxH / pH);
    return { w: Math.round(pW * scale), h: Math.round(pH * scale) };
  });

  printerStatus = computed(() =>
    this.statuses().find(s =>
      s.printer_name === this.currentPrinter()?.cups_printer_name,
    ) ?? null,
  );

  printerOnline = computed(() => this.printerStatus()?.online ?? false);

  readonly databasePricePreset = computed((): PrintPresetRecord | null => {
    const printer = this.currentPrinter();
    if (!printer) return null;
    const paperSize = this.normalizeOptionId(this.paper_size());
    const candidates = this.apiPresets().filter(preset =>
      preset.is_active &&
      this.normalizeOptionId(preset.paper_size) === paperSize &&
      this.pricePresetMatchesPrinter(preset, printer));

    return this.pickBestPricePreset(candidates, printer);
  });

  unitPrice = computed(() => {
    const printer = this.currentPrinter();
    if (!printer) return 0;
    const businessPreset = this.activeBusinessCardPreset();
    if (businessPreset) {
      return businessPreset.price ?? 0;
    }

    // Для MFP/document A4/A3 цена документа приходит из анализа заливки, а не из технических print_presets.
    const coverage = this.coverageResult();
    if (this.requiresCoveragePricing()) {
      return coverage ? this.toPriceNumber(coverage.recommended_price) : 0;
    }

    // Цена из БД пресетов
    return this.databasePricePreset()?.price ?? 0;
  });

  totalPrice = computed(() => {
    const coveragePagesTotal = this.coveragePagePriceTotal();
    if (this.requiresCoveragePricing()) {
      if (coveragePagesTotal !== null) {
        return this.roundPrice(coveragePagesTotal * this.copies());
      }

      const coverage = this.coverageResult();
      if (coverage) {
        const pageMultiplier = this.isDocumentFileType() ? this.selectedDocumentPagesCount() : 1;
        return this.roundPrice(this.toPriceNumber(coverage.recommended_price) * this.copies() * pageMultiplier);
      }

      return 0;
    }

    const pageMultiplier = this.isDocumentFileType() ? this.selectedDocumentPagesCount() : 1;
    return this.roundPrice(this.unitPrice() * this.copies() * pageMultiplier);
  });

  formattedTotalPrice = computed(() => this.formatPrice(this.totalPrice()));

  readonly coveragePricingUnavailableReason = computed((): string => {
    if (!this.requiresCoveragePricing()) return '';
    if (this.coveragePending()) return 'Идёт анализ заливки для лазерной печати';
    if (!this.coverageResult()) return 'Цена по заливке не рассчитана — проверьте доступность файла и повторите анализ';
    if (this.totalPrice() <= 0) return 'Цена по заливке не найдена в БД для выбранного формата';
    return '';
  });

  readonly billingQuantityIcon = computed(() => {
    if (this.isDocumentFileType()) return 'article';
    if (this.businessCardLayout() || this.documentSetLayout() || this.documentLayout()) return 'grid_on';
    return 'insert_drive_file';
  });

  readonly billingQuantityLabel = computed(() => {
    const copies = this.copies();
    if (this.businessCardLayout() || this.documentSetLayout() || this.documentLayout()) {
      return copies > 1 ? `${copies} ${this.copyWord(copies)}` : '1 лист';
    }

    if (this.isDocumentFileType()) {
      if (this.knownDocumentPageCount() <= 0 && this.coveragePending()) {
        return 'Считаем страницы';
      }
      const pages = this.selectedDocumentPagesCount();
      const pagesPart = `${pages} ${this.pageWord(pages)}`;
      return copies > 1 ? `${pagesPart} × ${copies} ${this.copyWord(copies)}` : pagesPart;
    }

    return copies > 1 ? `${copies} ${this.copyWord(copies)}` : '1 файл';
  });

  readonly footerPriceBreakdownLabel = computed(() => {
    const status = this.footerPriceStatusLabel();
    if (status) return status;
    const breakdown = this.priceBreakdownLabel();
    if (breakdown) return `${breakdown} = ${this.formattedTotalPrice()} ₽`;
    return `${this.formattedTotalPrice()} ₽`;
  });

  readonly footerPriceStatusLabel = computed((): string | null => {
    if (this.coveragePending()) return 'Цена появится после анализа заливки';
    if (this.requiresCoveragePricing() && !this.coverageResult()) return 'Цена не рассчитана';
    return null;
  });

  priceBreakdownLabel = computed(() => {
    const copies = this.copies();
    const pages = this.selectedDocumentPagesCount();
    const coveragePagesTotal = this.coveragePagePriceTotal();

    if (this.requiresCoveragePricing() && !this.coverageResult()) {
      return '';
    }

    if (
      this.requiresCoveragePricing()
      && coveragePagesTotal !== null
    ) {
      const coveragePages = this.selectedCoveragePages();
      const pagePrices = coveragePages.map(page => this.toPriceNumber(page.recommended_price));
      const firstPrice = pagePrices[0] ?? 0;
      const hasSinglePagePrice = pagePrices.length === pages
        && firstPrice > 0
        && pagePrices.every(price => this.roundPrice(price) === this.roundPrice(firstPrice));
      const pagesPart = hasSinglePagePrice
        ? `${this.formatPrice(firstPrice)} ₽ × ${pages} ${this.pageWord(pages)}`
        : `${this.formatPrice(coveragePagesTotal)} ₽ за ${pages} ${this.pageWord(pages)} по заливке`;
      return copies > 1 ? `${pagesPart} × ${copies}` : pagesPart;
    }

    if (this.isDocumentFileType() && pages > 1) {
      const pagesPart = `${this.formatPrice(this.unitPrice())} ₽ × ${pages} ${this.pageWord(pages)}`;
      return copies > 1 ? `${pagesPart} × ${copies}` : pagesPart;
    }

    if (copies > 1) {
      return `${this.formatPrice(this.unitPrice())} ₽ × ${copies}`;
    }

    return '';
  });

  printDisabledReason = computed((): string => {
    if (this.printing()) return 'Отправка задания...';
    if (!this.data?.file_url) return 'Файл не получен — закройте и откройте диалог';
    if (!this.printer_id()) return 'Выберите принтер';
    const p = this.currentPrinter();
    if (!p) return 'Выбранный принтер не найден в списке — обновите страницу';
    const businessIssue = this.businessCardRequirementIssue();
    if (businessIssue) return businessIssue;
    const envelopeIssue = this.envelopeC6RequirementIssue();
    if (envelopeIssue) return envelopeIssue;
    if (!this.selectedPaper()) return `Формат ${this.paper_size()} не поддерживается выбранным принтером`;
    const coverageIssue = this.coveragePricingUnavailableReason();
    if (coverageIssue) return coverageIssue;
    if (this.totalPrice() === 0 && !this.coveragePending() && !this.coverageOverridden()) {
      return 'Цена не рассчитана (нет пресета под размер/тип принтера)';
    }
    return '';
  });

  printActionDisabled = computed(() => this.printDisabledReason() !== '');
  readonly addToCartDisabledReason = computed((): string => this.cartDisabledReason());
  readonly addToCartActionDisabled = computed(() => this.addToCartDisabledReason() !== '');

  priceWarning = computed((): string | null => {
    if (!this.currentPrinter()) return null;
    if (this.coveragePending()) return null;
    const coverageIssue = this.coveragePricingUnavailableReason();
    if (coverageIssue) return coverageIssue;
    if (this.coverageOverridden()) return null;
    if (this.totalPrice() > 0) return null;
    const printer = this.currentPrinter()!;
    if (this.activeBusinessCardPreset()) {
      return 'Нет цены из API для визиток Canon C3226i';
    }
    const paperSize = this.paper_size();
    const presetMatch = this.databasePricePreset();
    if (!presetMatch) {
      return `Нет пресета цены: ${paperSize} × ${printer.printer_type}. Обратитесь к менеджеру.`;
    }
    if (presetMatch.price <= 0) {
      return `В пресете цены «${presetMatch.name}» указана цена 0 ₽`;
    }
    return 'Стоимость не определена — проверьте настройки';
  });

  readonly actionStatusLabel = computed((): string | null => {
    if (this.printStatusMode()) return null;
    if (this.coveragePending()) return this.documentWorkStatusLabel() ?? 'Идёт анализ заливки для лазерной печати';
    const coverageIssue = this.coveragePricingUnavailableReason();
    if (coverageIssue) return coverageIssue;
    return this.priceWarning();
  });

  readonly paymentActionLabel = computed(() => {
    if (this.coveragePending()) return 'Принять оплату · расчёт';
    if (this.requiresCoveragePricing() && !this.coverageResult()) return 'Принять оплату · нет цены';
    return `Принять оплату · ${this.formattedTotalPrice()} ₽`;
  });

  showPolaroidToggle = computed(() =>
    this.fileType() === 'image' &&
    (this.paper_size() === '10x15' || this.paper_size() === '13x18'),
  );

  readonly imageAspectInfo = computed((): ImageAspectInfo | null => {
    if (this.fileType() !== 'image' || !this.imageLoaded()) return null;
    const sourceW = this.imgNaturalW();
    const sourceH = this.imgNaturalH();
    if (sourceW <= 0 || sourceH <= 0) return null;

    const rot = Math.abs(this.rotation()) % 180;
    const widthPx = rot === 90 ? sourceH : sourceW;
    const heightPx = rot === 90 ? sourceW : sourceH;
    const ratio = widthPx / heightPx;
    return {
      widthPx,
      heightPx,
      ratio,
      ratioLabel: formatRatio(ratio),
    };
  });

  /**
   * Шаблонные раскладки держат фиксированную ориентацию листа (паспорт-сеты,
   * коллажи, визитки, polaroid) — авто-разворот по пропорции снимка сломал бы сетку.
   */
  private hasTemplatedLayout(): boolean {
    return this.polaroidMode()
      || !!this.activeDocPreset()
      || !!this.documentSetLayout()
      || !!this.documentLayout()
      || !!this.businessCardLayout();
  }

  /**
   * Итоговая ориентация листа. При `auto` для ОДИНОЧНОГО фото лист поворачивается
   * под реальную пропорцию снимка (imageAspectInfo учитывает EXIF браузера + ручной
   * поворот) — иначе 10×15 насильно держался книжным и резал кадр. Явная ориентация
   * и шаблонные раскладки сохраняют прежнее поведение (по ручному повороту).
   */
  readonly resolvedOrientation = computed<'portrait' | 'landscape'>(() => {
    const orient = this.orientation();
    const rot = this.rotation() % 360;
    const byRot: 'portrait' | 'landscape' = (rot === 90 || rot === 270) ? 'landscape' : 'portrait';
    if (orient !== 'auto') return orient;
    if (this.hasTemplatedLayout()) return byRot;
    const aspect = this.imageAspectInfo();
    if (aspect && aspect.ratio > 0) return aspect.ratio >= 1 ? 'landscape' : 'portrait';
    return byRot;
  });

  /**
   * Размеры бумаги для кроп-рамки с учётом итоговой ориентации листа — чтобы рамка
   * обрезки совпадала с тем, как лист реально развернётся при печати.
   */
  readonly cropPaperDims = computed<{ w: number; h: number } | null>(() => {
    const paper = this.selectedPaper();
    if (!paper) return null;
    const lo = Math.min(paper.width_mm, paper.height_mm);
    const hi = Math.max(paper.width_mm, paper.height_mm);
    return this.resolvedOrientation() === 'landscape' ? { w: hi, h: lo } : { w: lo, h: hi };
  });

  readonly businessCardAspectHint = computed((): BusinessCardAspectHint | null => {
    const aspect = this.imageAspectInfo();
    if (!aspect) return null;

    const normalizedRatio = aspect.ratio >= 1 ? aspect.ratio : 1 / aspect.ratio;
    let best: (typeof BUSINESS_CARD_ASPECT_TARGETS)[number] = BUSINESS_CARD_ASPECT_TARGETS[0];
    let bestDiff = Math.abs(normalizedRatio - best.ratio) / best.ratio;

    for (const target of BUSINESS_CARD_ASPECT_TARGETS.slice(1)) {
      const diff = Math.abs(normalizedRatio - target.ratio) / target.ratio;
      if (diff < bestDiff) {
        best = target;
        bestDiff = diff;
      }
    }

    const orientationNote = aspect.ratio >= 1 ? '' : ' после поворота';
    return {
      label: `Ближе к ${best.label}${orientationNote}`,
      diffLabel: `отклонение ${(bestDiff * 100).toFixed(1)}%`,
      warning: bestDiff > 0.06,
    };
  });

  /** Document set mode: pre-calculated layout with branded footer */
  readonly documentSetLayout = signal<LayoutCalcResult | null>(null);
  readonly faceValidation = signal<FaceValidationResult | null>(null);
  readonly faceValidationLoading = signal(false);

  readonly faceValidationBadge = computed((): FaceValidationBadgeData | null => {
    const fv = this.faceValidation();
    if (!fv || !fv.face_detected) return null;
    // Get face requirements from active document preset or document_set data
    const docPreset = this.activeDocPreset();
    const req = docPreset ? DOCUMENT_FACE_REQUIREMENTS[docPreset.id] : undefined;
    const dsReq = this.data.document_set?.face_requirements;
    return {
      face_height_mm: fv.face_height_mm,
      gost_pass: fv.is_valid_passport,
      gost_height_min_mm: dsReq?.min_mm ?? req?.min_mm ?? 30,
      gost_height_max_mm: dsReq?.max_mm ?? req?.max_mm ?? 34,
      document_type: req?.standard ?? dsReq?.standard,
    };
  });

  // Document photo: detect when paper_size matches a document preset
  readonly documentPaperSize = signal<string | null>(null);

  readonly activeDocPreset = computed((): PhotoSizePreset | null => {
    const ps = this.documentPaperSize();
    if (!ps) return null;
    return DOCUMENT_PRESETS.find(d => d.id === ps) ?? null;
  });

  readonly documentLayout = computed((): LayoutCalcResult | null => {
    const preset = this.activeDocPreset();
    if (!preset) return null;
    return calculateDocumentSet(preset.id);
  });

  readonly layoutSheetPreviewActive = computed(() =>
    this.fileType() === 'image' &&
    !!this.data.file_url &&
    (!!this.businessCardLayout() || !!this.documentSetLayout() || !!this.documentLayout()),
  );

  // ── Init ───────────────────────────────────────────────
  ngOnInit(): void {
    this.printApi.getPrinters().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(printers => {
      console.log('[Print] Загружено принтеров:', printers.length, printers.map(p => `${p.name} (${p.printer_type})`));
      this.printers.set(printers);

      // Document set: prefer L8050 by name.
      // Список принтеров уже отфильтрован по студии сотрудника (JWT studio_id),
      // поэтому достаточно выбрать нужный струйник внутри студии:
      //   Соборный — два L8050 (левый/правый) → берём правый;
      //   Баррикадная — один L8050 → берётся он же.
      const dsName = this.data.document_set?.printer_name;
      let match: Printer | undefined;
      if (this.data.envelope_c6) {
        match = printers.find(p => this.isCanonC3226i(p));
      }
      if (!match && dsName) {
        const wanted = dsName.toLowerCase();
        const tag = (p: Printer) => `${p.name ?? ''} ${p.cups_printer_name ?? ''}`.toLowerCase();
        const candidates = printers.filter(p => tag(p).includes(wanted));
        match = candidates.find(p => /правый|right/.test(tag(p)))
          ?? candidates.find(p => p.printer_type === 'photo')
          ?? candidates[0];
      }
      if (!match) {
        const preferred = this.data.preferred_printer_type;
        const ft = this.fileType();
        const isDocument = ft === 'pdf' || ft === 'docx' || ft === 'xlsx';
        // PDF/DOCX/XLSX → prefer MFP/document printer; images → prefer photo
        const effectivePreferred = preferred
          ?? (isDocument ? 'mfp' : undefined);
        match = effectivePreferred
          ? printers.find(p => p.printer_type === effectivePreferred)
            ?? (isDocument ? printers.find(p => this.isCoveragePrinter(p)) : undefined)
            ?? printers[0]
          : printers[0];
      }
      if (match) {
        this.printer_id.set(match.id);
        this.applyPrinterDefaults(match);

        // PDF/DOCX/XLSX: force A4 if available, fit mode
        const ft = this.fileType();
        if (this.data.envelope_c6) {
          this.applyEnvelopeC6Defaults();
        } else if (this.data.document_set) {
          this.applyDocumentSetDefaults();
        } else if (ft === 'pdf' || ft === 'docx' || ft === 'xlsx') {
          this.applyDocumentFileDefaults(match);
        }
      }

      // Restore previous settings only for photo/layout jobs. Documents must open with standard B/W defaults.
      if (!this.data.envelope_c6 && !this.data.document_set && !this.isDocumentFileType()) {
        this.restoreSettingsFromStorage();
      }

      // Trigger coverage analysis for MFP/document printers
      this.triggerCoverageAnalysis();
      this.previewRequest$.next();
    });

    this.printApi.getPrinterStatuses().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: resp => {
        const s = resp.printers ?? [];
        console.log('[Print] Статусы принтеров:', s.map(p => `${p.printer_name}: ${p.online ? '🟢' : '🔴'} ${p.state}`));
        this.statuses.set(s);
      },
      error: (err) => {
        console.warn('[Print] Ошибка загрузки статусов:', err?.message || err);
      },
    });

    this.printApi.getTelemetry().pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => of([] as PrinterTelemetry[])),
    ).subscribe(t => this.telemetry.set(t));

    this.loadImage();

    if (this.data.envelope_c6) {
      this.applyEnvelopeC6Defaults();
    }

    // Document set mode — auto-configure all settings
    if (this.data.document_set) {
      this.applyDocumentSetDefaults();

      // Use pre-fetched face validation from chat, or auto-validate
      if (this.data.face_validation) {
        this.faceValidation.set(this.data.face_validation);
      } else {
        this.faceValidationLoading.set(true);
        this.faceValidationApi.validate(this.data.file_url, { dpi_override: 800 }).pipe(
          takeUntilDestroyed(this.destroyRef),
        ).subscribe({
          next: result => {
            this.faceValidation.set(result);
            this.faceValidationLoading.set(false);
          },
          error: (err) => {
            console.error('[Print] Face validation ошибка:', err);
            this.toast.error(err?.error?.error || 'Не удалось проверить фото');
            this.faceValidationLoading.set(false);
          },
        });
      }
    }

    // Server preview: debounce 300ms, request on settings change
    this.previewRequest$.pipe(
      debounceTime(300),
      switchMap(() => {
        const requestSeq = ++this.serverPreviewRequestSeq;
        if (!this.data.file_url || !this.usesServerPreview()) {
          this.serverPreviewLoading.set(false);
          this.serverPreviewError.set(null);
          this.currentPreviewId.set(null);
          this.clearServerPreviewUrl();
          return EMPTY;
        }
        this.serverPreviewLoading.set(true);
        this.serverPreviewError.set(null);
        const layoutSheetPayload = this.buildLayoutSheetPreviewPayload();
        if (layoutSheetPayload) {
          this.clearServerPreviewUrl();
          return this.printApi.requestLayoutSheetPreview(layoutSheetPayload).pipe(
            rxMap(blob => {
              if (this.isCurrentServerPreviewRequest(requestSeq)) {
                this.setServerPreviewBlob(blob);
              }
              return true;
            }),
            catchError(err => {
              if (this.isCurrentServerPreviewRequest(requestSeq)) {
                this.handlePreviewError(err, 'Не удалось собрать лист');
              }
              return EMPTY;
            }),
            finalize(() => {
              if (this.isCurrentServerPreviewRequest(requestSeq)) {
                this.serverPreviewLoading.set(false);
              }
            }),
          );
        }
        const size = this.previewSize();
        return this.printApi.requestPreview(this.buildPreviewRequest(size)).pipe(
          switchMap(resp => {
            if (!this.isCurrentServerPreviewRequest(requestSeq)) return EMPTY;
            const myPreviewId = resp.preview_id;
            this.currentPreviewId.set(myPreviewId);
            // Server-side document rendering can take longer for large PDFs.
            return timer(0, 500).pipe(
              takeWhile((_, i) => i < 240),
              switchMap(() => this.printApi.getPreviewImage(myPreviewId)),
              rxMap(blob => {
                if (!blob) return false; // still pending
                // Stale response — a newer preview was requested
                if (!this.isCurrentServerPreviewRequest(requestSeq) || this.currentPreviewId() !== myPreviewId) return true;
                this.setServerPreviewBlob(blob);
                return true; // done
              }),
              takeWhile(done => !done, true),
            );
          }),
          catchError(err => {
            if (this.isCurrentServerPreviewRequest(requestSeq)) {
              this.handlePreviewError(err, 'Не удалось подготовить предпросмотр');
            }
            return EMPTY;
          }),
          finalize(() => {
            if (this.isCurrentServerPreviewRequest(requestSeq)) {
              this.serverPreviewLoading.set(false);
            }
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    // Load prices and quick settings from API only.
    this.printApi.getPresets().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: apiPresets => this.apiPresets.set(apiPresets),
      error: () => this.toast.error('Не удалось загрузить цены печати'),
    });
  }

  // ── Printer helpers ────────────────────────────────────
  getEffectiveType(p: Printer): string {
    if (p.capabilities?.sublimation ||
        p.capabilities?.media_types?.some(m => m.id === 'ds_transfer')) {
      return 'sublimation';
    }
    if (this.isCoveragePrinter(p)) return p.printer_type === 'mfp' ? 'mfp' : 'document';
    return p.printer_type;
  }

  getPrinterIcon(p: Printer): string {
    switch (this.getEffectiveType(p)) {
      case 'photo': return 'photo_camera';
      case 'sublimation': return 'palette';
      case 'mfp': return 'print';
      case 'document': return 'description';
      default: return 'print';
    }
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.updatePreviewPanelBounds();
    window.addEventListener('resize', this.updatePreviewPanelBounds);
    window.visualViewport?.addEventListener('resize', this.updatePreviewPanelBounds);

    const panel = this.previewPanelRef()?.nativeElement;
    if (!panel || typeof ResizeObserver === 'undefined') return;

    this.previewPanelResizeObserver = new ResizeObserver(() => this.updatePreviewPanelBounds());
    this.previewPanelResizeObserver.observe(panel);
  }

  getPrinterTypeLabel(p: Printer): string {
    switch (this.getEffectiveType(p)) {
      case 'photo': return 'Фото';
      case 'sublimation': return 'Сублимация';
      case 'mfp': return 'МФУ';
      case 'document': return 'Документы';
      default: return 'Принтер';
    }
  }

  selectPresetCategory(categoryId: PresetCategoryId): void {
    this.selectedPresetCategoryId.set(categoryId);
  }

  presetDisplayLabel(preset: PrintPreset): string {
    if (this.isBusinessCardPreset(preset)) {
      return this.businessCardPhotoPresetId(preset) === 'business-card-eu'
        ? '85x55 на A4'
        : '90x50 на A4';
    }

    if (this.presetCategoryId(preset) === 'documents') {
      const media = this.normalizeOptionId(preset.mediaType);
      if (!media || media === 'plain') {
        return preset.paperSize;
      }
    }

    return preset.label
      .replace(/\s+Canon\s+C3226i\s*$/i, '')
      .replace(/\s+Canon\s*$/i, '')
      .replace(/\s+Epson\s+L8050\s*$/i, '')
      .trim();
  }

  isPrinterOnline(p: Printer): boolean {
    return this.statuses().find(s => s.printer_name === p.cups_printer_name)?.online ?? p.is_active;
  }

  private toPrintPreset(p: PrintPresetRecord): PrintPreset {
    return {
      id: p.id,
      icon: p.icon,
      label: p.name,
      printerType: p.printer_type,
      sublimation: p.sublimation,
      paperSize: p.paper_size,
      mediaType: p.media_type ?? undefined,
      quality: p.quality,
      fitMode: p.fit_mode,
      borderless: p.borderless,
      colorMode: p.color_mode,
      duplex: p.duplex,
      mirror: p.mirror,
      slug: p.slug,
      renderingIntent: (p.rendering_intent as PrintPreset['renderingIntent']) ?? undefined,
      price: p.price,
    };
  }

  private presetCategoryId(preset: PrintPreset): PresetCategoryId {
    if (this.isBusinessCardPreset(preset)) return 'business';
    if (this.isEnvelopeC6Preset(preset)) return 'envelopes';
    if (this.isFlyerPreset(preset)) return 'flyers';
    if (preset.sublimation) return 'sublimation';
    if (preset.printerType === 'mfp' || preset.printerType === 'document') return 'documents';
    return 'photo';
  }

  private presetCategoryOrder(): readonly PresetCategoryId[] {
    const printer = this.currentPrinter();
    if (this.isDocumentFileType()) {
      return ['documents', 'envelopes', 'flyers', 'business', 'photo', 'sublimation'];
    }
    if (this.isCanonC3226i(printer)) {
      return ['business', 'envelopes', 'documents', 'flyers', 'photo', 'sublimation'];
    }
    if (printer && this.isPrinterSublimation(printer)) {
      return ['sublimation', 'photo', 'envelopes', 'documents', 'flyers', 'business'];
    }
    if (printer?.printer_type === 'photo') {
      return ['photo', 'documents', 'envelopes', 'flyers', 'business', 'sublimation'];
    }
    return ['documents', 'envelopes', 'flyers', 'business', 'photo', 'sublimation'];
  }

  private quickPresetMatchesPrinter(preset: PrintPreset, printer: Printer): boolean {
    if (this.isBusinessCardPreset(preset)) {
      return this.isCanonC3226i(printer);
    }
    if (this.isEnvelopeC6Preset(preset)) {
      return this.isCanonC3226i(printer)
        && this.printerSupportsPaper(printer, preset.paperSize)
        && this.printerSupportsMedia(printer, preset.mediaType);
    }

    if (preset.sublimation) {
      return this.isPrinterSublimation(printer)
        && this.printerSupportsPaper(printer, preset.paperSize)
        && this.printerSupportsMedia(printer, preset.mediaType);
    }

    if (this.isPrinterSublimation(printer)) {
      return false;
    }

    if (this.isCoveragePrinter(printer)) {
      if (preset.printerType !== 'mfp' && preset.printerType !== 'document') return false;
      if (this.isPresetForAnotherMfp(preset, printer)) return false;
      return this.printerSupportsPaper(printer, preset.paperSize)
        && this.printerSupportsMedia(printer, preset.mediaType);
    }

    if (printer.printer_type === 'photo') {
      return preset.printerType === 'photo'
        && this.printerSupportsPaper(printer, preset.paperSize)
        && this.printerSupportsMedia(printer, preset.mediaType);
    }

    return false;
  }

  private quickPresetHasMatchingPrinter(preset: PrintPreset): boolean {
    return this.printers().some(printer => this.quickPresetMatchesPrinter(preset, printer));
  }

  private isPresetForAnotherMfp(preset: PrintPreset, printer: Printer): boolean {
    const text = this.normalizeOptionId(`${preset.slug ?? ''} ${preset.label}`);
    if (this.isCanonC3226i(printer)) {
      return text.includes('mf655');
    }
    return text.includes('c3226') && !this.isCanonC3226i(printer);
  }

  private printerSupportsPaper(printer: Printer, paperSize: string): boolean {
    const target = this.normalizeOptionId(paperSize);
    return printer.capabilities.paper_sizes.some(size => {
      const raw: unknown = size;
      if (typeof raw === 'string') {
        return this.normalizeOptionId(raw) === target;
      }
      return this.normalizeOptionId(size.id) === target || this.normalizeOptionId(size.name) === target;
    });
  }

  private printerSupportsMedia(printer: Printer, mediaType: string | undefined): boolean {
    if (!mediaType) return true;
    const target = this.normalizeOptionId(mediaType);
    return printer.capabilities.media_types.some(media =>
      this.normalizeOptionId(media.id) === target || this.normalizeOptionId(media.name) === target,
    );
  }

  private dedupePresets(presets: readonly PrintPreset[]): PrintPreset[] {
    const byKey = new Map<string, PrintPreset>();
    for (const preset of presets) {
      const key = this.presetDedupeKey(preset);
      const existing = byKey.get(key);
      if (!existing || this.presetDedupePriority(preset) > this.presetDedupePriority(existing)) {
        byKey.set(key, preset);
      }
    }
    return [...byKey.values()];
  }

  private presetDedupeKey(preset: PrintPreset): string {
    const category = this.presetCategoryId(preset);
    const paper = this.normalizeOptionId(preset.paperSize);
    const media = this.normalizeOptionId(preset.mediaType);

    if (category === 'business') {
      return `${category}|${this.businessCardPhotoPresetId(preset)}`;
    }

    if (category === 'documents') {
      const mediaGroup = !media || media === 'plain' ? 'plain' : media;
      return `${category}|${paper}|${mediaGroup}`;
    }

    return [
      category,
      paper,
      media,
      preset.borderless ? 'borderless' : 'with-fields',
      preset.mirror ? 'mirror' : 'normal',
    ].join('|');
  }

  private presetDedupePriority(preset: PrintPreset): number {
    const current = this.currentPrinter();
    let priority = current && this.quickPresetMatchesPrinter(preset, current) ? 100 : 0;
    const text = this.normalizeOptionId(`${preset.slug ?? ''} ${preset.label}`);

    if (preset.slug) priority += 20;
    if (text.includes('c3226') || text.includes('l8050') || text.includes('mf655') || text.includes('scf100')) {
      priority += 10;
    }
    if ((preset.price ?? 0) > 0) priority += 5;
    return priority;
  }

  activePresetMatches(preset: PrintPreset): boolean {
    const printer = this.currentPrinter();
    if (!printer) return false;
    if (this.isBusinessCardPreset(preset)) {
      const selectedBusinessPresetId = this.selectedBusinessCardPresetId();
      const presetMatches = selectedBusinessPresetId
        ? this.businessCardPhotoPresetId(preset) === selectedBusinessPresetId
        : this.activePresetId() === preset.id;
      if (!presetMatches) return false;

      const mediaType = this.media_type();
      const paperSource = this.paperSource();
      return this.isCanonC3226i(printer)
        && this.paper_size() === BUSINESS_CARD_A4_TEMPLATE.paperSize
        && this.isBusinessCardMediaType(mediaType)
        && this.printerSupportsMedia(printer, mediaType)
        && this.isBusinessCardPaperSource(paperSource)
        && this.printerSupportsPaperSource(printer, paperSource)
        && !this.duplex()
        && !this.borderless();
    }
    if (this.activePresetId() !== preset.id) return false;
    if (this.isEnvelopeC6Preset(preset)) {
      return this.envelopeC6SettingsMatch(printer);
    }
    if (this.paper_size() !== preset.paperSize) return false;
    if (preset.sublimation) return this.isPrinterSublimation(printer);
    if (preset.printerType === 'mfp' || preset.printerType === 'document') {
      return this.isCoveragePrinter(printer);
    }
    return printer.printer_type === 'photo' && !this.isPrinterSublimation(printer);
  }

  private readonly SUPPLY_LABELS: Record<string, string> = {
    cyan: 'Голубой', magenta: 'Пурпурный', yellow: 'Жёлтый', black: 'Чёрный',
    'light-cyan': 'Св. голубой', 'light-magenta': 'Св. пурпурный',
    toner: 'Тонер', drum: 'Барабан', waste: 'Отработка',
  };

  getSupplyDots(printerId: string): { key: string; label: string; level: number }[] {
    const t = this.telemetry().find(x => x.printer_id === printerId);
    if (!t?.supplies) return [];
    return Object.entries(t.supplies).map(([key, level]) => ({
      key,
      label: this.SUPPLY_LABELS[key] ?? key,
      level: typeof level === 'number' ? level : 0,
    }));
  }

  private isPrinterSublimation(printer: Printer): boolean {
    return printer.printer_type === 'sublimation'
      || printer.capabilities?.sublimation === true
      || printer.capabilities?.media_types?.some(m => m.id === 'ds_transfer') === true;
  }

  private isCoveragePrinter(printer: Printer | undefined): boolean {
    if (!printer || this.isPrinterSublimation(printer)) return false;
    const type = this.normalizeOptionId(printer.printer_type);
    const device = this.normalizeOptionId(`${printer.name} ${printer.cups_printer_name}`);

    const inkjetDevice = device.includes('inkjet')
      || device.includes('струй')
      || device.includes('epson')
      || device.includes('l805')
      || device.includes('l1800');
    if (inkjetDevice) return false;

    return type.includes('laser')
      || device.includes('laser')
      || device.includes('лазер')
      || device.includes('c3226')
      || device.includes('mf655')
      || device.includes('iradv')
      || device.includes('imagerunner');
  }

  private isBusinessCardPreset(preset: PrintPreset | null | undefined): boolean {
    if (!preset) return false;
    const text = `${preset.slug ?? ''} ${preset.label} ${preset.paperSize}`.toLowerCase();
    return text.includes('business-card')
      || text.includes('business_card')
      || text.includes('business card')
      || text.includes('vizit')
      || text.includes('визит');
  }

  private isEnvelopeC6Preset(preset: PrintPreset | null | undefined): boolean {
    if (!preset) return false;
    const text = this.normalizeOptionId(`${preset.slug ?? ''} ${preset.label} ${preset.paperSize}`);
    return text.includes('envelopec6')
      || text.includes('c6envelope')
      || text.includes('конвертc6');
  }

  private isFlyerPreset(preset: PrintPreset | null | undefined): boolean {
    if (!preset) return false;
    const text = `${preset.slug ?? ''} ${preset.label}`.toLowerCase();
    return text.includes('flyer')
      || text.includes('флаер')
      || text.includes('листовк');
  }

  private businessCardPhotoPresetId(preset: PrintPreset | null | undefined): BusinessCardPhotoPresetId {
    const text = `${preset?.slug ?? ''} ${preset?.label ?? ''}`.toLowerCase();
    if (text.includes('85') || text.includes('55') || text.includes('eu')) {
      return 'business-card-eu';
    }
    return 'business-card';
  }

  private isCanonC3226i(printer: Printer | undefined): boolean {
    if (!printer) return false;
    const text = `${printer.name} ${printer.cups_printer_name}`.toLowerCase();
    return text.includes(BUSINESS_CARD_A4_TEMPLATE.requiredPrinterNeedle)
      || text.includes('ir c3226');
  }

  private findCanonC3226iPrinter(): Printer | undefined {
    return this.printers().find(printer => this.isCanonC3226i(printer));
  }

  private normalizeOptionId(value: string | null | undefined): string {
    return (value ?? '').toLowerCase().replace(/[\s_\-/]/g, '');
  }

  private isBusinessCardPaperSource(value: string): boolean {
    const normalized = this.normalizeOptionId(value);
    return normalized === BUSINESS_CARD_A4_TEMPLATE.requiredPaperSourceId
      || normalized === 'universal'
      || normalized === 'universallot'
      || normalized === 'universaltray'
      || normalized === 'multipurpose'
      || normalized === 'multipurposetray'
      || normalized === 'bypass'
      || normalized === 'mp'
      || normalized === 'mptray'
      || normalized.includes('универс')
      || normalized.includes('ручн');
  }

  private findBusinessCardPaperSource(printer: Printer | undefined): string {
    const sources = printer?.capabilities?.paper_sources ?? [];
    return sources.find(source =>
      this.isBusinessCardPaperSource(source.id) || this.isBusinessCardPaperSource(source.name),
    )?.id ?? '';
  }

  private findEnvelopeC6PaperSize(printer: Printer | undefined): string {
    const papers = printer?.capabilities?.paper_sizes ?? [];
    return papers.find(paper => {
      const id = this.normalizeOptionId(paper.id);
      const name = this.normalizeOptionId(paper.name);
      return id === this.normalizeOptionId(ENVELOPE_C6_KRAFT_TEMPLATE.paperSize)
        || id === 'c6'
        || name === 'c6'
        || name.includes('конвертc6');
    })?.id ?? '';
  }

  private printerSupportsPaperSource(printer: Printer, paperSource: string | null | undefined): boolean {
    if (!paperSource) return false;
    const normalizedSource = this.normalizeOptionId(paperSource);
    return printer.capabilities?.paper_sources?.some(source =>
      this.normalizeOptionId(source.id) === normalizedSource
        || this.normalizeOptionId(source.name) === normalizedSource,
    ) === true;
  }

  private isBusinessCardMediaType(value: string): boolean {
    return isBusinessCardMediaTypeId(value);
  }

  private findBusinessCardMediaType(printer: Printer | undefined): string {
    const mediaTypes = printer?.capabilities?.media_types ?? [];
    return mediaTypes.find(media =>
      this.isBusinessCardMediaType(media.id) || this.isBusinessCardMediaType(media.name),
    )?.id ?? '';
  }

  private isEnvelopeMediaType(value: string): boolean {
    const normalized = this.normalizeOptionId(value);
    return normalized === ENVELOPE_C6_KRAFT_TEMPLATE.requiredMediaTypeId
      || normalized === 'kraft'
      || normalized === 'kraftenvelope'
      || normalized.includes('конверт');
  }

  private findEnvelopeMediaType(printer: Printer | undefined): string {
    const mediaTypes = printer?.capabilities?.media_types ?? [];
    return mediaTypes.find(media =>
      this.isEnvelopeMediaType(media.id) || this.isEnvelopeMediaType(media.name),
    )?.id ?? '';
  }

  private businessCardRequirementIssue(): string {
    const preset = this.activeBusinessCardPreset();
    if (!preset) return '';

    if (this.splitEnabled()) {
      return 'Визитки печатаются одним листом только на Canon C3226i';
    }

    const printer = this.currentPrinter();
    if (!printer || !this.isCanonC3226i(printer)) {
      return 'Для визиток нужен Canon C3226i';
    }
    if (this.paper_size() !== BUSINESS_CARD_A4_TEMPLATE.paperSize) {
      return 'Для визиток нужен формат A4';
    }

    if (!this.findBusinessCardMediaType(printer)) {
      return `Canon C3226i не отдал бумагу ${BUSINESS_CARD_MEDIA_TYPE_LABEL} из API`;
    }
    if (!this.isBusinessCardMediaType(this.media_type()) || !this.printerSupportsMedia(printer, this.media_type())) {
      return `Для визиток нужна бумага ${BUSINESS_CARD_MEDIA_TYPE_LABEL}`;
    }

    if (!this.findBusinessCardPaperSource(printer)) {
      return 'Canon C3226i не отдал универсальный лоток из API';
    }
    if (!this.isBusinessCardPaperSource(this.paperSource()) || !this.printerSupportsPaperSource(printer, this.paperSource())) {
      return 'Для визиток нужна подача из универсального лотка';
    }
    if (this.duplex()) {
      return 'Визитки печатаются только односторонне';
    }
    if (this.borderless()) {
      return 'Визитки печатаются с полями и линиями реза';
    }
    return '';
  }

  private envelopeC6ModeActive(): boolean {
    if (this.data.envelope_c6) return true;
    const activeId = this.activePresetId();
    return this.availablePresets().some(preset => preset.id === activeId && this.isEnvelopeC6Preset(preset));
  }

  private envelopeC6SettingsMatch(printer: Printer): boolean {
    return this.isCanonC3226i(printer)
      && this.normalizeOptionId(this.paper_size()) === this.normalizeOptionId(ENVELOPE_C6_KRAFT_TEMPLATE.paperSize)
      && this.isEnvelopeMediaType(this.media_type())
      && this.printerSupportsMedia(printer, this.media_type())
      && this.isBusinessCardPaperSource(this.paperSource())
      && this.printerSupportsPaperSource(printer, this.paperSource())
      && !this.duplex()
      && !this.borderless();
  }

  private envelopeC6RequirementIssue(): string {
    if (!this.envelopeC6ModeActive()) return '';

    if (this.splitEnabled()) {
      return 'Конверты C6 печатаются по одному только на Canon C3226i';
    }

    const printer = this.currentPrinter();
    if (!printer || !this.isCanonC3226i(printer)) {
      return 'Для конвертов C6 нужен Canon C3226i';
    }
    if (!this.findEnvelopeC6PaperSize(printer)) {
      return 'Canon C3226i не отдал формат C6 из API';
    }
    if (this.normalizeOptionId(this.paper_size()) !== this.normalizeOptionId(ENVELOPE_C6_KRAFT_TEMPLATE.paperSize)) {
      return 'Для конвертов нужен формат C6';
    }
    if (!this.findEnvelopeMediaType(printer)) {
      return `Canon C3226i не отдал тип бумаги ${ENVELOPE_C6_KRAFT_MEDIA_TYPE_LABEL} из API`;
    }
    if (!this.isEnvelopeMediaType(this.media_type()) || !this.printerSupportsMedia(printer, this.media_type())) {
      return `Для крафтовых конвертов нужен тип бумаги ${ENVELOPE_C6_KRAFT_MEDIA_TYPE_LABEL}`;
    }
    if (!this.findBusinessCardPaperSource(printer)) {
      return 'Canon C3226i не отдал универсальный лоток из API';
    }
    if (!this.isBusinessCardPaperSource(this.paperSource()) || !this.printerSupportsPaperSource(printer, this.paperSource())) {
      return 'Для конвертов нужна подача из универсального лотка';
    }
    if (this.duplex()) {
      return 'Конверты печатаются только односторонне';
    }
    if (this.borderless()) {
      return 'Конверты печатаются с полями принтера';
    }
    return '';
  }

  private pickBestPricePreset(
    presets: readonly PrintPresetRecord[],
    printer: Printer,
  ): PrintPresetRecord | null {
    return [...presets]
      .sort((a, b) => {
        const scoreDelta = this.pricePresetScore(b, printer) - this.pricePresetScore(a, printer);
        if (scoreDelta !== 0) return scoreDelta;
        const orderDelta = a.sort_order - b.sort_order;
        return orderDelta !== 0 ? orderDelta : a.name.localeCompare(b.name, 'ru');
      })[0] ?? null;
  }

  private pricePresetScore(preset: PrintPresetRecord, printer: Printer): number {
    let score = 0;
    if (preset.price > 0) score += 10_000;
    score += this.pricePresetPrinterScore(preset, printer) * 1_000;
    score += this.pricePresetMediaScore(preset) * 100;
    score += preset.color_mode === (this.isBw() ? 'bw' : 'color') ? 300 : -3_000;
    score += preset.duplex === this.duplex() ? 250 : -2_500;
    score += preset.borderless === this.borderless() ? 100 : -1_000;
    score += this.normalizeOptionId(preset.quality) === this.normalizeOptionId(this.quality()) ? 20 : 0;
    return score;
  }

  private pricePresetMediaScore(preset: PrintPresetRecord): number {
    const selected = this.normalizeOptionId(this.media_type());
    const media = this.normalizeOptionId(preset.media_type);
    if (media && selected === media) return 5;
    if (this.isPlainDocumentMedia(selected) && this.isPlainDocumentMedia(media)) return 4;
    if (!media) return 2;
    return -40;
  }

  private isPlainDocumentMedia(normalized: string): boolean {
    return !normalized ||
      normalized === 'plain' ||
      normalized === 'plainpaper' ||
      normalized === 'plain1' ||
      normalized === 'plain2' ||
      normalized === 'plain3' ||
      normalized === 'standardpaper' ||
      normalized === 'officepaper' ||
      normalized === 'copy' ||
      normalized === 'ordinary' ||
      normalized === 'normal' ||
      normalized === 'recycled' ||
      normalized.includes('обыч') ||
      normalized.includes('стандарт') ||
      normalized.includes('офис') ||
      normalized.includes('копир');
  }

  private pricePresetPrinterScore(preset: PrintPresetRecord, printer: Printer): number {
    const printerFamily = this.pricePrinterFamily(`${printer.name} ${printer.cups_printer_name}`);
    const presetFamily = this.pricePrinterFamily(`${preset.slug} ${preset.name}`);
    if (!printerFamily) return presetFamily ? 0 : 1;
    if (presetFamily === printerFamily) return 3;
    if (presetFamily) return -1;
    return 1;
  }

  private pricePrinterFamily(value: string): 'c3226' | 'mf655' | 'l8050' | 'scf100' | null {
    const text = this.normalizeOptionId(value);
    if (text.includes('c3226')) return 'c3226';
    if (text.includes('mf655')) return 'mf655';
    if (text.includes('l8050')) return 'l8050';
    if (text.includes('scf100')) return 'scf100';
    return null;
  }

  private pricePresetMatchesPrinter(preset: PrintPresetRecord, printer: Printer): boolean {
    const printerScore = this.pricePresetPrinterScore(preset, printer);
    if (printerScore < 0) return false;
    if (preset.sublimation) return this.isPrinterSublimation(printer);
    if (this.isPrinterSublimation(printer)) return preset.printer_type === 'photo' && preset.sublimation;
    if (this.isCoveragePrinter(printer)) {
      return preset.printer_type === 'mfp' || preset.printer_type === 'document';
    }
    if (printer.printer_type === 'photo') return preset.printer_type === 'photo' && !preset.sublimation;
    return false;
  }

  private getCoveragePaperFormat(): string {
    return this.paper_size()?.toLowerCase().replace(/\s/g, '') || 'a4';
  }

  private clearCoverageState(): void {
    this.activeCoverageRequestKey = null;
    this.coverageResult.set(null);
    this.coverageLoading.set(false);
    this.coveragePending.set(false);
    this.coverageOverridden.set(false);
  }

  /** Режим цвета для coverage-запроса: 'auto' (детект), либо явный выбор оператора. */
  private coverageColorMode(): 'auto' | 'color' | 'bw' {
    if (this.color_auto_detect()) return 'auto';
    return this.isBw() ? 'bw' : 'color';
  }

  private getCoverageRequestKey(request: CoverageRequest): string {
    return [
      request.fileUrl,
      request.printerId,
      request.paperSize,
      request.paperFormat,
      request.borderless ? 'borderless' : 'with-fields',
      request.fontSizeDeltaPt ?? 0,
      request.colorMode,
    ].join('|');
  }

  private matchesCoverageRequest(request: CoverageRequest): boolean {
    return this.showCoverageBadge()
      && this.data.file_url === request.fileUrl
      && this.printer_id() === request.printerId
      && this.paper_size() === request.paperSize
      && this.getCoveragePaperFormat() === request.paperFormat
      && this.borderless() === request.borderless
      && this.coverageColorMode() === request.colorMode;
  }

  private applyCoverageResult(request: CoverageRequest, result: CoverageResult | null): void {
    if (!this.matchesCoverageRequest(request)) return;
    if (this.activeCoverageRequestKey !== this.getCoverageRequestKey(request)) return;

    this.activeCoverageRequestKey = null;
    this.coveragePending.set(false);
    this.coverageResult.set(result);
    this.coverageLoading.set(false);
    this.coverageOverridden.set(false);
    this.applyCoveragePageCount(result);

    if (result) {
      const pages = result.page_count ?? result.pages?.length ?? 0;
      const pageText = pages > 1 ? ` · ${pages} ${this.pageWord(pages)}` : '';
      this.toast.info(`Заливка ${result.coverage_percent.toFixed(0)}%${pageText} → ${result.recommended_name} (${result.recommended_price}\u20BD)`);
    }
  }

  private applyCoveragePageCount(result: CoverageResult | null): void {
    const pageCount = result?.page_count ?? result?.pages?.length ?? 0;
    if (!this.isPdf() || pageCount <= 0) return;

    if (this.pdfPageCount() !== pageCount) {
      this.pdfPageCount.set(pageCount);
    }
    if (this.pdfCurrentPage() < 1 || this.pdfCurrentPage() > pageCount) {
      this.pdfCurrentPage.set(1);
    }
    this.clampSelectedPdfPages(pageCount);
  }

  private clampSelectedPdfPages(total: number): void {
    const selected = this.selectedPdfPages();
    if (!selected.length) return;
    const next = selected.filter(page => page >= 1 && page <= total);
    this.selectedPdfPages.set(next.length === 0 || next.length === total ? [] : next);
    this.syncPdfPageRangeFromSelection();
  }

  private triggerCoverageAnalysis(): void {
    if (this.activeBusinessCardPreset() || !this.showCoverageBadge()) {
      this.clearCoverageState();
      return;
    }

    const request: CoverageRequest = {
      fileUrl: this.data.file_url,
      printerId: this.printer_id(),
      paperSize: this.paper_size(),
      paperFormat: this.getCoveragePaperFormat(),
      borderless: this.borderless(),
      colorMode: this.coverageColorMode(),
      ...(this.fontAdjustmentAvailable() ? { fontSizeDeltaPt: this.docFontSizeDeltaPt() } : {}),
    };
    if (!request.fileUrl || !request.printerId) {
      this.clearCoverageState();
      return;
    }

    const requestKey = this.getCoverageRequestKey(request);
    if (this.coveragePending() && this.activeCoverageRequestKey === requestKey) return;
    this.activeCoverageRequestKey = requestKey;

    this.coverageResult.set(null);
    this.coverageLoading.set(true);
    this.coverageOverridden.set(false);
    this.coveragePending.set(true);

    this.coverageService.analyzeCoverage(request.fileUrl, request.paperFormat, {
      fontSizeDeltaPt: request.fontSizeDeltaPt,
      printerId: request.printerId,
      paperSize: request.paperSize,
      borderless: request.borderless,
      colorMode: request.colorMode,
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: result => this.applyCoverageResult(request, result),
      error: () => this.applyCoverageResult(request, null),
    });
  }

  selectPrinter(p: Printer): void {
    console.log('[Print] Выбран принтер:', p.name, '| id:', p.id, '| type:', p.printer_type, '| online:', this.isPrinterOnline(p));
    this.printer_id.set(p.id);
    this.applyPrinterDefaults(p);
    if (this.data.envelope_c6) {
      this.applyEnvelopeC6Defaults();
    } else if (this.data.document_set) {
      this.applyDocumentSetDefaults();
    } else if (this.isDocumentFileType()) {
      this.applyDocumentFileDefaults(p);
    }
    this.clearPresetSelection();
    this.selectedPresetCategoryId.set(null);
    this.triggerCoverageAnalysis();
  }

  // ── Presets ────────────────────────────────────────────
  applyPreset(preset: PrintPreset): void {
    const printers = this.printers();
    const current = this.currentPrinter();

    let target: Printer | undefined;
    if (this.isBusinessCardPreset(preset)) {
      target = this.findCanonC3226iPrinter();
      if (!target) {
        this.toast.error('Для визиток нужен Canon C3226i');
        return;
      }
      const mediaType = this.findBusinessCardMediaType(target);
      const paperSource = this.findBusinessCardPaperSource(target);
      if (!mediaType) {
        this.toast.error(`Canon C3226i не отдал бумагу ${BUSINESS_CARD_MEDIA_TYPE_LABEL} из API`);
        return;
      }
      if (!paperSource) {
        this.toast.error('Canon C3226i не отдал универсальный лоток из API');
        return;
      }

      this.printer_id.set(target.id);
      this.paper_size.set(BUSINESS_CARD_A4_TEMPLATE.paperSize);
      this.media_type.set(mediaType);
      this.paperSource.set(paperSource);
      this.quality.set(preset.quality);
      this.fit_mode.set('fit');
      this.documentScaleMode.set('fit');
      this.scaling_percent.set(100);
      this.borderless.set(false);
      this.isBw.set(false);
      this.duplex.set(false);
      this.duplex_mode.set('off');
      this.booklet.set(false);
      this.mirror.set(false);
      if (preset.renderingIntent) this.renderingIntent.set(preset.renderingIntent);
      this.activePresetId.set(preset.id);
      this.selectedBusinessCardPresetId.set(this.businessCardPhotoPresetId(preset));
      this.selectedPresetCategoryId.set(this.presetCategoryId(preset));
      this.syncDocumentPaperSize();
      this.clearServerPreviewUrl();
      this.clearCoverageState();
      this.scheduleDraw();
      this.previewRequest$.next();
      return;
    }

    if (this.isEnvelopeC6Preset(preset)) {
      target = this.findCanonC3226iPrinter();
      if (!target) {
        this.toast.error('Для конвертов C6 нужен Canon C3226i');
        return;
      }
      const paperSize = this.findEnvelopeC6PaperSize(target);
      const mediaType = this.findEnvelopeMediaType(target);
      const paperSource = this.findBusinessCardPaperSource(target);
      if (!paperSize) {
        this.toast.error('Canon C3226i не отдал формат C6 из API');
        return;
      }
      if (!mediaType) {
        this.toast.error(`Canon C3226i не отдал тип бумаги ${ENVELOPE_C6_KRAFT_MEDIA_TYPE_LABEL} из API`);
        return;
      }
      if (!paperSource) {
        this.toast.error('Canon C3226i не отдал универсальный лоток из API');
        return;
      }

      this.printer_id.set(target.id);
      this.paper_size.set(paperSize);
      this.media_type.set(mediaType);
      this.paperSource.set(paperSource);
      this.quality.set(preset.quality);
      this.fit_mode.set(preset.fitMode);
      this.documentScaleMode.set(preset.fitMode === 'actual' ? 'actual' : 'fit');
      this.scaling_percent.set(100);
      this.borderless.set(false);
      this.isBw.set(false);
      this.duplex.set(false);
      this.duplex_mode.set('off');
      this.booklet.set(false);
      this.mirror.set(false);
      if (preset.renderingIntent) this.renderingIntent.set(preset.renderingIntent);
      this.activePresetId.set(preset.id);
      this.selectedBusinessCardPresetId.set(null);
      this.selectedPresetCategoryId.set(this.presetCategoryId(preset));
      this.syncDocumentPaperSize();
      this.clearServerPreviewUrl();
      this.clearCoverageState();
      this.scheduleDraw();
      this.previewRequest$.next();
      return;
    }

    if (current && this.quickPresetMatchesPrinter(preset, current)) {
      target = current;
    } else if (preset.sublimation) {
      target = printers.find(p =>
        p.capabilities?.sublimation ||
        p.capabilities?.media_types?.some(m => m.id === 'ds_transfer'),
      );
    } else if (preset.printerType === 'mfp' || preset.printerType === 'document') {
      target = printers.find(p =>
        this.isCoveragePrinter(p),
      );
    } else {
      // Photo — exclude sublimation
      target = printers.find(p =>
        p.printer_type === preset.printerType &&
        !this.isCoveragePrinter(p) &&
        !p.capabilities?.sublimation &&
        !p.capabilities?.media_types?.some(m => m.id === 'ds_transfer'),
      ) ?? printers.find(p => p.printer_type === preset.printerType && !this.isCoveragePrinter(p));
    }
    if (!target) return;

    this.selectedBusinessCardPresetId.set(null);
    this.printer_id.set(target.id);
    this.paper_size.set(preset.paperSize);
    this.media_type.set(preset.mediaType ?? target.capabilities.media_types[0]?.id ?? '');
    this.quality.set(preset.quality);
    this.fit_mode.set(preset.fitMode);
    this.documentScaleMode.set(preset.fitMode === 'actual' ? 'actual' : 'fit');
    this.scaling_percent.set(100);
    this.borderless.set(preset.borderless && target.capabilities.borderless);
    this.isBw.set(preset.colorMode === 'bw');
    this.duplex.set(preset.duplex && target.capabilities.duplex);
    this.duplex_mode.set(this.duplex() ? 'long_edge' : 'off');
    this.booklet.set(false);
    this.mirror.set(preset.mirror);
    if (preset.renderingIntent) this.renderingIntent.set(preset.renderingIntent);
    this.activePresetId.set(preset.id);
    this.selectedPresetCategoryId.set(this.presetCategoryId(preset));
    this.syncDocumentPaperSize();
    this.clearServerPreviewUrl();
    this.scheduleDraw();
    this.previewRequest$.next();
    this.triggerCoverageAnalysis();
  }

  // ── Settings handlers ──────────────────────────────────
  onPaperSizeChange(paperSize: string): void {
    this.paper_size.set(paperSize);
    if (!this.shouldKeepBusinessCardMode()) {
      this.clearPresetSelection();
    }
    this.clearServerPreviewUrl();
    this.syncDocumentPaperSize();
    this.scheduleDraw();
    this.previewRequest$.next();
    this.clearCoverageState();
    this.triggerCoverageAnalysis();
  }

  onSettingChange(): void {
    if (!this.shouldKeepBusinessCardMode()) {
      this.clearPresetSelection();
    }
    this.clearServerPreviewUrl();
    this.syncDocumentPaperSize();
    this.scheduleDraw();
    this.previewRequest$.next();
    if (this.showCoverageBadge()) {
      this.triggerCoverageAnalysis();
    } else if (!this.showCoverageBadge()) {
      this.clearCoverageState();
    }
  }

  private syncDocumentPaperSize(): void {
    if (this.shouldKeepBusinessCardMode()) {
      this.documentPaperSize.set(null);
      return;
    }

    if (this.documentSetLayout()) {
      this.documentPaperSize.set(null);
      if (this.renderingIntent() === 'perceptual') {
        this.renderingIntent.set('absolute_colorimetric');
      }
      return;
    }

    const ps = this.paper_size();
    const isDoc = DOCUMENT_PRESETS.some(d => d.id === ps);
    this.documentPaperSize.set(isDoc ? ps : null);
    // Auto-set rendering intent: absolute_colorimetric for documents, perceptual for photos
    if (isDoc && this.renderingIntent() === 'perceptual') {
      this.renderingIntent.set('absolute_colorimetric');
    } else if (!isDoc && this.renderingIntent() === 'absolute_colorimetric') {
      this.renderingIntent.set('perceptual');
    }
  }

  onFitChange(): void {
    if (!this.shouldKeepBusinessCardMode()) {
      this.clearPresetSelection();
    }
    this.clearServerPreviewUrl();
    this.scheduleDraw();
    this.previewRequest$.next();
  }

  showPrintModeSection(caps: PrinterCapabilities): boolean {
    return this.currentPrinter()?.printer_type !== 'photo'
      || this.currentPrinterSupportsCoverage()
      || caps.duplex
      || this.visiblePaperSources(caps).length > 1;
  }

  isDocumentPrintWorkflow(): boolean {
    const printer = this.currentPrinter();
    return this.isDocumentFileType()
      && !this.documentSetLayout()
      && this.isCoveragePrinter(printer);
  }

  setColorMode(mode: string): void {
    const bw = mode !== 'color';
    this.isBw.set(bw);
    this.gray_mode.set(bw ? 'black_only' : '');
    this.color_auto_detect.set(false);
    this.onSettingChange();
  }

  setBookletMode(mode: string): void {
    const enabled = mode === 'booklet';
    this.booklet.set(enabled);
    if (enabled) {
      this.duplex.set(true);
      if (this.duplex_mode() === 'off') {
        this.duplex_mode.set('short_edge');
      }
    }
    this.onSettingChange();
  }

  setDuplexMode(mode: string): void {
    const enabled = mode === 'duplex';
    this.duplex.set(enabled);
    this.duplex_mode.set(enabled ? 'long_edge' : 'off');
    if (!enabled) {
      this.booklet.set(false);
    }
    this.onSettingChange();
  }

  setDuplexEdge(mode: string): void {
    const next = mode === 'short_edge' ? 'short_edge' : 'long_edge';
    this.duplex.set(true);
    this.duplex_mode.set(next);
    this.onSettingChange();
  }

  setDocumentScaleMode(mode: string): void {
    const next: DocumentScaleMode =
      mode === 'actual' || mode === 'custom' ? mode : 'fit';
    this.documentScaleMode.set(next);
    if (next === 'fit') {
      this.fit_mode.set('fit');
      this.scaling_percent.set(100);
    } else {
      this.fit_mode.set('actual');
      if (next === 'actual') {
        this.scaling_percent.set(100);
      }
    }
    this.onSettingChange();
  }

  setScalingPercent(value: string | number): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const next = Math.max(25, Math.min(400, Math.round(parsed)));
    this.documentScaleMode.set('custom');
    this.fit_mode.set('actual');
    this.scaling_percent.set(next);
    this.onSettingChange();
  }

  setPaperSource(source: string): void {
    this.paperSource.set(source || 'auto');
    this.onSettingChange();
  }

  visiblePaperSources(caps: PrinterCapabilities): readonly PrintPaperSourceOption[] {
    const printer = this.currentPrinter();
    const sourceOptions = caps.paper_sources ?? [];
    const shouldUseDocumentSources = this.isDocumentFileType() || this.isCoveragePrinter(printer);

    if (!shouldUseDocumentSources) {
      return sourceOptions.length
        ? sourceOptions.map(source => ({ id: source.id, name: source.name }))
        : [{ id: 'auto', name: 'Авто' }];
    }

    const desired = [
      { id: 'auto', name: 'Авто', aliases: ['auto', 'automatic', 'autoselect', 'default', 'printerdefault'] },
      { id: 'tray1', name: 'Лоток 1', aliases: ['tray1', 'cas1', 'cassette1', 'cassetteone', 'лоток1', 'лот1'] },
      { id: 'tray2', name: 'Лоток 2', aliases: ['tray2', 'cas2', 'cassette2', 'cassettetwo', 'лоток2', 'лот2'] },
      { id: 'universal', name: 'Универсальный', aliases: ['manual', 'universal', 'universallot', 'universaltray', 'multipurpose', 'multipurposetray', 'bypass', 'mp', 'mptray', 'универс', 'ручн'] },
    ] as const;

    const options = desired.map(option => ({
      id: this.findPaperSourceId(caps, option.aliases) ?? option.id,
      name: option.name,
    }));

    const seen = new Set<string>();
    return options.filter(option => {
      const key = this.normalizeOptionId(option.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private findPaperSourceId(
    caps: PrinterCapabilities,
    aliases: readonly string[],
  ): string | null {
    const sources = caps.paper_sources ?? [];
    const normalizedAliases = aliases.map(alias => this.normalizeOptionId(alias));
    const match = sources.find(source => {
      const id = this.normalizeOptionId(source.id);
      const name = this.normalizeOptionId(source.name);
      return normalizedAliases.some(alias =>
        id === alias || name === alias || id.includes(alias) || name.includes(alias),
      );
    });
    return match?.id ?? null;
  }

  private applyPrinterDefaults(printer: Printer): void {
    const caps = printer.capabilities;
    const isSub = caps?.sublimation ||
      caps?.media_types?.some(m => m.id === 'ds_transfer');
    const isPhoto = printer.printer_type === 'photo' && !isSub;

    this.paper_size.set(caps.paper_sizes[0]?.id ?? 'A4');
    this.media_type.set(caps.media_types[0]?.id ?? '');
    this.paperSource.set(caps.paper_sources?.[0]?.id ?? 'auto');

    if (isSub) {
      this.quality.set(caps.quality_modes.find(q => q.id === 'standard')?.id
        ?? caps.quality_modes[0]?.id ?? 'normal');
      this.borderless.set(false);
      this.fit_mode.set('fill');
      this.documentScaleMode.set('fit');
      this.scaling_percent.set(100);
      this.mirror.set(true);
      this.isBw.set(false);
      this.duplex.set(false);
      this.duplex_mode.set('off');
      this.booklet.set(false);
    } else if (isPhoto) {
      const bestQ = caps.quality_modes.find(q => q.id === 'photo')
        ?? caps.quality_modes.find(q => q.id === 'best')
        ?? caps.quality_modes[0];
      this.quality.set(bestQ?.id ?? 'normal');
      this.borderless.set(false);
      this.fit_mode.set('fill');
      this.documentScaleMode.set('fit');
      this.scaling_percent.set(100);
      this.mirror.set(false);
      this.isBw.set(false);
      this.duplex.set(false);
      this.duplex_mode.set('off');
      this.booklet.set(false);
    } else {
      const normalQ = caps.quality_modes.find(q => q.id === 'normal')
        ?? caps.quality_modes[0];
      this.quality.set(normalQ?.id ?? 'normal');
      this.borderless.set(false);
      this.fit_mode.set('fit');
      this.documentScaleMode.set('fit');
      this.scaling_percent.set(100);
      this.mirror.set(false);
      this.isBw.set(false);
      this.duplex.set(false);
      this.duplex_mode.set('off');
      this.booklet.set(false);
    }
    this.syncDocumentPaperSize();
    this.scheduleDraw();
  }

  private applyDocumentFileDefaults(printer: Printer): void {
    const caps = printer.capabilities;
    const a4 = caps.paper_sizes.find(ps =>
      this.normalizeOptionId(ps.id) === 'a4' || this.normalizeOptionId(ps.name) === 'a4',
    );
    const plainMedia = caps.media_types.find(media =>
      this.isPlainDocumentMedia(this.normalizeOptionId(media.id))
        || this.isPlainDocumentMedia(this.normalizeOptionId(media.name)),
    );
    const standardQuality = caps.quality_modes.find(mode => {
      const id = this.normalizeOptionId(mode.id);
      const name = this.normalizeOptionId(mode.name);
      return id === 'standard' || name === 'standard' || name.includes('стандарт');
    }) ?? caps.quality_modes.find(mode => {
      const id = this.normalizeOptionId(mode.id);
      const name = this.normalizeOptionId(mode.name);
      return id === 'normal' || name === 'normal' || name.includes('обыч');
    });

    this.paper_size.set(a4?.id ?? caps.paper_sizes[0]?.id ?? 'A4');
    this.media_type.set(plainMedia?.id ?? caps.media_types[0]?.id ?? '');
    this.quality.set(standardQuality?.id ?? caps.quality_modes[0]?.id ?? 'normal');
    this.fit_mode.set('fit');
    this.documentScaleMode.set('fit');
    this.scaling_percent.set(100);
    this.borderless.set(false);
    this.isBw.set(true);
    this.duplex.set(false);
    this.duplex_mode.set('off');
    this.booklet.set(false);
    this.gray_mode.set('black_only');
    this.color_auto_detect.set(false);
    this.toner_save.set(false);
    this.mirror.set(false);
    this.paperSource.set(this.findPaperSourceId(caps, ['auto', 'automatic', 'autoselect', 'default']) ?? 'auto');
    this.pages_per_sheet.set(1);
    this.target_dpi.set(300);
    this.docFontSizeDeltaPt.set(0);
    this.departmentId.set('');
    this.securePin.set('');
    this.syncDocumentPaperSize();
    this.clearServerPreviewUrl();
    this.scheduleDraw();
    this.previewRequest$.next();
  }

  private shouldKeepBusinessCardMode(): boolean {
    return this.selectedBusinessCardPresetId() !== null
      && this.paper_size() === BUSINESS_CARD_A4_TEMPLATE.paperSize;
  }

  private clearPresetSelection(): void {
    this.activePresetId.set(null);
    this.selectedBusinessCardPresetId.set(null);
  }

  private applyDocumentSetDefaults(): void {
    const ds = this.data.document_set;
    if (!ds) return;

    this.paper_size.set(ds.paper_size);
    this.media_type.set(ds.media_type ?? '');
    this.quality.set(ds.quality ?? 'high');
    this.fit_mode.set('fill');
    this.documentScaleMode.set('fit');
    this.scaling_percent.set(100);
    this.borderless.set(ds.borderless ?? false);
    this.isBw.set(false);
    this.duplex.set(false);
    this.duplex_mode.set('off');
    this.booklet.set(false);
    this.mirror.set(false);
    this.pages_per_sheet.set(1);
    this.target_dpi.set(ds.detected_dpi ?? 800);
    this.renderingIntent.set('absolute_colorimetric');
    this.documentSetLayout.set(ds.layout);
    this.syncDocumentPaperSize();
    this.scheduleDraw();
    this.previewRequest$.next();
  }

  private applyEnvelopeC6Defaults(): void {
    const envelope = this.data.envelope_c6;
    if (!envelope) return;

    const printer = this.currentPrinter();
    const paperSize = this.findEnvelopeC6PaperSize(printer) || envelope.paper_size || ENVELOPE_C6_KRAFT_TEMPLATE.paperSize;
    const mediaType = this.findEnvelopeMediaType(printer) || envelope.media_type || ENVELOPE_C6_KRAFT_TEMPLATE.requiredMediaTypeId;
    const paperSource = this.findBusinessCardPaperSource(printer) || envelope.paper_source || ENVELOPE_C6_KRAFT_TEMPLATE.requiredPaperSourceId;

    this.paper_size.set(paperSize);
    this.media_type.set(mediaType);
    this.paperSource.set(paperSource);
    this.quality.set(envelope.quality ?? 'normal');
    this.fit_mode.set('fit');
    this.documentScaleMode.set('fit');
    this.scaling_percent.set(100);
    this.borderless.set(false);
    this.isBw.set(false);
    this.duplex.set(false);
    this.duplex_mode.set('off');
    this.booklet.set(false);
    this.mirror.set(false);
    this.target_dpi.set(300);
    this.renderingIntent.set('relative_colorimetric');
    this.syncDocumentPaperSize();
    this.scheduleDraw();
    this.previewRequest$.next();
  }

  // ── Image loading ──────────────────────────────────────
  private loadImage(): void {
    const type = this.fileType();

    if (type === 'pdf') {
      this.isPdf.set(true);
      this.pdfLoading.set(false);
      this.imageLoaded.set(true);
      this.previewRequest$.next();
      return;
    }

    if (type === 'docx') {
      this.imageLoaded.set(true);
      return;
    }

    if (type === 'xlsx') {
      if (isPlatformBrowser(this.platformId)) {
        this.loadXlsxPreview();
      }
      this.imageLoaded.set(true);
      return;
    }

    if (type === 'unknown') {
      this.imageLoaded.set(true);
      return;
    }

    // type === 'image'
    if (this.usesRasterServerPreview()) {
      this.previewRequest$.next();
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.imgEl = img;
      this.imgNaturalW.set(img.naturalWidth);
      this.imgNaturalH.set(img.naturalHeight);
      this.imageLoaded.set(true);
      if (!this.usesRasterServerPreview()) {
        this.scheduleDraw();
      }
      this.autoDetectPaperSize(img.naturalWidth, img.naturalHeight);
      this.previewRequest$.next();
    };
    img.onerror = () => this.imageLoaded.set(true);
    img.src = this.data.file_url;
  }

  private autoDetectPaperSize(w: number, h: number): void {
    const detected = detectBestPaperSize(w, h, PHOTO_SIZE_PRESETS);
    const preset = PHOTO_SIZE_PRESETS.find(p => p.id === detected.presetId);
    if (!preset) return;
    const orientLabel = detected.orientation === 'portrait' ? 'портрет' : 'альбом';
    this.recommendedFormat.set({
      presetId: detected.presetId,
      orientation: detected.orientation,
      label: `${preset.label} (${orientLabel})`,
    });
    const printer = this.currentPrinter();
    if (printer?.printer_type === 'photo') {
      const hasPaper = printer.capabilities?.paper_sizes?.some(
        (ps: PaperSize) => ps.id === detected.presetId,
      );
      if (hasPaper) {
        this.paper_size.set(detected.presetId);
        this.onSettingChange();
      }
    }
  }

  applyRecommendedFormat(rec: { presetId: string; orientation: 'portrait' | 'landscape'; label: string }): void {
    this.paper_size.set(rec.presetId);
    this.onSettingChange();
  }

  // ── Canvas ─────────────────────────────────────────────
  private scheduleDraw(): void {
    if (this.drawTimer) clearTimeout(this.drawTimer);
    this.drawTimer = setTimeout(() => {
      this.drawTimer = null;
      this.drawPreview();
    }, 50);
  }

  private drawPreview(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.imgEl) return;

    const size = this.previewSize();
    if (canvas.width !== size.w || canvas.height !== size.h) {
      canvas.width = size.w;
      canvas.height = size.h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size.w, size.h);

    // Paper background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);

    const img = this.imgEl;
    const rot = this.rotation() % 360;
    const rotRad = (rot * Math.PI) / 180;

    const naturalW = rot === 90 || rot === 270 ? img.naturalHeight : img.naturalWidth;
    const naturalH = rot === 90 || rot === 270 ? img.naturalWidth : img.naturalHeight;

    if (this.polaroidMode()) {
      this.drawPolaroidSheetPreview(ctx, img, size);
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, size.w - 1, size.h - 1);
      return;
    }

    let dx = 0, dy = 0, dw = size.w, dh = size.h;

    switch (this.fit_mode()) {
      case 'fill': {
        const scale = Math.max(size.w / naturalW, size.h / naturalH);
        dw = naturalW * scale;
        dh = naturalH * scale;
        dx = (size.w - dw) / 2;
        dy = (size.h - dh) / 2;
        break;
      }
      case 'fit': {
        const scale = Math.min(size.w / naturalW, size.h / naturalH);
        dw = naturalW * scale;
        dh = naturalH * scale;
        dx = (size.w - dw) / 2;
        dy = (size.h - dh) / 2;
        break;
      }
      case 'actual': {
        const scale = Math.min(size.w / naturalW, size.h / naturalH) * 0.7;
        dw = naturalW * scale;
        dh = naturalH * scale;
        dx = (size.w - dw) / 2;
        dy = (size.h - dh) / 2;
        break;
      }
      // stretch: defaults (0,0,w,h)
    }

    // Mirror for sublimation preview
    ctx.save();
    if (this.mirror()) {
      ctx.translate(size.w, 0);
      ctx.scale(-1, 1);
    }

    // Apply zoom and pan
    const zoom = this.canvasZoom();
    const panX = this.canvasPanX();
    const panY = this.canvasPanY();
    ctx.translate(size.w / 2 + panX, size.h / 2 + panY);
    ctx.scale(zoom, zoom);
    ctx.rotate(rotRad);

    if (rot === 90 || rot === 270) {
      ctx.drawImage(img, -dh / 2 + dy, -dw / 2 + dx, dh, dw);
    } else {
      ctx.drawImage(img, dx - size.w / 2, dy - size.h / 2, dw, dh);
    }
    ctx.restore();

    // Margin indicators (dashed border inside paper)
    if (!this.borderless() && !this.polaroidMode()) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      const paper = this.selectedPaper();
      const marginMm = 3;
      const marginX = paper ? marginMm * (size.w / paper.width_mm) : 0;
      const marginY = paper ? marginMm * (size.h / paper.height_mm) : 0;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(marginX, marginY, size.w - marginX * 2, size.h - marginY * 2);
      ctx.setLineDash([]);
    }

    // Paper border
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size.w - 1, size.h - 1);
  }

  private drawPolaroidSheetPreview(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    size: { w: number; h: number },
  ): void {
    const paper = this.selectedPaper();
    if (!paper) return;
    const scaleX = size.w / paper.width_mm;
    const scaleY = size.h / paper.height_mm;
    const photoX = POLAROID_600_TEMPLATE.borderSideMm * scaleX;
    const photoY = POLAROID_600_TEMPLATE.borderTopMm * scaleY;
    const photoW = POLAROID_600_TEMPLATE.photoSizeMm * scaleX;
    const photoH = POLAROID_600_TEMPLATE.photoSizeMm * scaleY;
    const cutX = POLAROID_600_TEMPLATE.cardWidthMm * scaleX;
    const cutY = POLAROID_600_TEMPLATE.cardHeightMm * scaleY;

    this.drawImageCover(ctx, img, photoX, photoY, photoW, photoH);
    ctx.strokeStyle = '#42A5F5';
    ctx.lineWidth = 1;
    ctx.strokeRect(photoX, photoY, photoW, photoH);

    ctx.strokeStyle = '#c8c8c8';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(cutX, 0);
    ctx.lineTo(cutX, size.h);
    ctx.moveTo(0, cutY);
    ctx.lineTo(size.w, cutY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawImageCover(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const targetRatio = w / h;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;

    if (imgRatio > targetRatio) {
      sw = img.naturalHeight * targetRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / targetRatio;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  // ── PDF page selection ─────────────────────────────────
  changePdfPage(delta: number): void {
    const next = this.pdfCurrentPage() + delta;
    if (next < 1 || next > this.pdfPageCount()) return;
    this.pdfCurrentPage.set(next);
  }

  selectPdfPage(page: number): void {
    if (page < 1 || page > this.pdfPageCount()) return;
    this.pdfCurrentPage.set(page);
  }

  jumpToPdfPage(value: string | number | null | undefined): void {
    const raw = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isFinite(raw)) return;

    const total = this.pdfPageCount();
    if (total <= 0) return;

    const page = Math.min(total, Math.max(1, Math.trunc(raw)));
    this.selectPdfPage(page);
  }

  selectCoveragePage(page: number): void {
    if (!this.isPdf()) return;
    this.selectPdfPage(page);
  }

  isCoveragePageSelected(page: number): boolean {
    return !this.isPdf() || this.isPdfPageSelected(page);
  }

  coverageBarWidth(percent: number): number {
    if (!Number.isFinite(percent)) return 0;
    return Math.max(3, Math.min(100, percent));
  }

  coveragePriceLabel(price: CoveragePrice): string {
    return this.formatPrice(this.toPriceNumber(price));
  }

  documentFontStatsLabel(stats: CoverageFontStats): string {
    const sizes = this.formatFontSizes(stats.sizes_pt);
    const range = stats.min_pt === stats.max_pt
      ? `${this.formatFontSize(stats.min_pt)} pt`
      : `${this.formatFontSize(stats.min_pt)}-${this.formatFontSize(stats.max_pt)} pt`;
    return `Шрифты: ${sizes || range} · основной ${this.formatFontSize(stats.primary_pt)} pt`;
  }

  adjustedDocumentFontStatsLabel(stats: CoverageFontStats): string | null {
    const delta = this.docFontSizeDeltaPt();
    if (delta >= 0) return null;
    const adjusted = stats.sizes_pt.map(size => Math.max(4, size + delta));
    return `после: ${this.formatFontSizes(adjusted)} pt`;
  }

  private formatFontSizes(sizes: readonly number[]): string {
    const unique = Array.from(new Set(
      sizes
        .filter(size => Number.isFinite(size) && size > 0)
        .map(size => this.formatFontSize(size)),
    ));
    if (unique.length <= 5) return unique.join(', ');
    return `${unique.slice(0, 5).join(', ')} +${unique.length - 5}`;
  }

  private formatFontSize(size: number): string {
    return Number.isInteger(size) ? String(size) : size.toFixed(1).replace(/\.0$/, '');
  }

  isPdfPageSelected(page: number): boolean {
    const selected = this.selectedPdfPages();
    return selected.length === 0 || selected.includes(page);
  }

  togglePdfPage(page: number): void {
    const prev = this.selectedPdfPages();
    const total = this.pdfPageCount();
    if (total <= 0) return;
    if (prev.length === 0) {
      const allExcept = Array.from({ length: total }, (_, i) => i + 1).filter(p => p !== page);
      this.selectedPdfPages.set(allExcept);
    } else if (prev.includes(page)) {
      const next = prev.filter(p => p !== page);
      this.selectedPdfPages.set(next.length === 0 ? [] : next);
    } else {
      const next = [...prev, page].sort((a, b) => a - b);
      this.selectedPdfPages.set(next.length === total ? [] : next);
    }
    this.syncPdfPageRangeFromSelection();
  }

  toggleAllPdfPages(): void {
    if (this.pdfPageCount() <= 0) return;
    if (this.allPdfPagesSelected()) {
      // Currently all selected → deselect all (select just page 1)
      this.selectedPdfPages.set([1]);
    } else {
      // Not all selected → select all (empty array means all)
      this.selectedPdfPages.set([]);
    }
    this.syncPdfPageRangeFromSelection();
  }

  onPdfRangeChange(input: string): void {
    this.pdfPageRangeInput.set(input);
    this.pageRange.set(input.trim());
    if (!input.trim()) {
      this.selectedPdfPages.set([]);
      return;
    }
    const parsed = parsePageRange(input, this.pdfPageCount());
    this.selectedPdfPages.set(Array.from(parsed).sort((a, b) => a - b));
  }

  onPrintPageRangeChange(input: string): void {
    if (this.isPdf()) {
      this.onPdfRangeChange(input);
      return;
    }
    this.pageRange.set(input.trim());
  }

  private syncPdfPageRangeFromSelection(): void {
    const selected = this.selectedPdfPages();
    const value = selected.length ? selected.join(', ') : '';
    this.pdfPageRangeInput.set(value);
    this.pageRange.set(value);
  }

  // ── XLSX Preview ───────────────────────────────────────
  private async loadXlsxPreview(): Promise<void> {
    this.docLoading.set(true);
    try {
      const response = await fetch(this.data.file_url, { credentials: 'include' });
      const arrayBuffer = await response.arrayBuffer();
      const XLSX = await import('xlsx');

      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData: string[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as string[][];

      if (jsonData.length > 0) {
        this.xlsPreviewData.set({
          headers: jsonData[0].map(String),
          rows: jsonData.slice(1, 21).map(row => row.map(String)),
        });
      }
      this.docLoading.set(false);
    } catch {
      this.docLoading.set(false);
    }
  }

  printStatusActive(status: PrintJob['status']): boolean {
    return ['queued', 'converting', 'sending', 'processing', 'printing', 'splitting', 'finishing'].includes(status);
  }

  printStatusIcon(status: PrintJob['status']): string {
    switch (status) {
      case 'completed': return 'check_circle';
      case 'failed': return 'error';
      case 'cancelled': return 'cancel';
      case 'scheduled': return 'event';
      case 'paused': return 'pause_circle';
      case 'held': return 'pan_tool';
      case 'converting': return 'autorenew';
      case 'splitting': return 'call_split';
      case 'sending': return 'upload_file';
      case 'processing': return 'settings';
      case 'printing': return 'print';
      case 'finishing': return 'task_alt';
      case 'queued':
      default: return 'pending_actions';
    }
  }

  printStatusTitle(status: PrintJob['status']): string {
    switch (status) {
      case 'completed': return 'Передано принтеру';
      case 'failed': return 'Ошибка печати';
      case 'cancelled': return 'Печать отменена';
      case 'scheduled': return 'Печать запланирована';
      case 'paused': return 'Печать на паузе';
      case 'held': return 'Задание удержано';
      case 'converting': return 'Готовим файл';
      case 'splitting': return 'Разделяем тираж';
      case 'sending': return 'Отправляем на принтер';
      case 'processing': return 'Готовим к печати';
      case 'printing': return 'Идёт печать';
      case 'finishing': return 'Проверяем принтер';
      case 'queued':
      default: return 'Задание в очереди';
    }
  }

  printStatusDescription(job: PrintJob): string {
    switch (job.status) {
      case 'completed':
        return 'Задание больше не отображается в очереди, выбранный принтер не сообщает о работе над ним. Проверьте готовый отпечаток на выдаче.';
      case 'failed':
        return job.error_message || 'Принтер или очередь вернули ошибку. Подробности доступны в очереди печати.';
      case 'cancelled':
        return 'Задание снято с очереди.';
      case 'scheduled':
        return 'Задание будет отправлено в выбранное время.';
      case 'paused':
        return 'Очередь остановлена, задание продолжится после возобновления.';
      case 'held':
        return 'Задание ожидает ручного выпуска оператором.';
      case 'converting':
        return 'Документ преобразуется в формат, подходящий для печати.';
      case 'splitting':
        return 'Тираж распределяется между выбранными принтерами.';
      case 'sending':
        return 'Файл передаётся на выбранный принтер.';
      case 'processing':
        return 'Очередь печати приняла файл и готовит его к запуску на принтере.';
      case 'printing':
        return 'Задание находится в очереди или уже выполняется устройством.';
      case 'finishing':
        return 'Файл уже передан, система ждёт, пока выбранный принтер освободится.';
      case 'queued':
      default:
        return 'Файл принят, задание ждёт свободный принтер.';
    }
  }

  printStatusPrinterName(job: PrintJob): string {
    return job.printer_name || this.currentPrinter()?.name || 'Принтер';
  }

  printProgressPercent(job: PrintJob): number {
    if (typeof job.progress_percent === 'number') {
      return Math.max(0, Math.min(100, Math.round(job.progress_percent)));
    }
    switch (job.status) {
      case 'completed':
      case 'failed':
      case 'cancelled':
      case 'scheduled':
        return 100;
      case 'finishing':
        return 92;
      case 'printing':
        return 72;
      case 'sending':
        return 48;
      case 'processing':
        return 62;
      case 'splitting':
        return 38;
      case 'converting':
        return 28;
      case 'paused':
        return 34;
      case 'held':
        return 20;
      case 'queued':
      default:
        return 12;
    }
  }

  printJobOptionsLabel(job: PrintJob): string {
    const copies = job.copies || this.copies();
    return `${copies} ${this.copyWord(copies)} · ${job.paper_size || this.paper_size()}`;
  }

  shortPrintJobId(id: string): string {
    return id.length > 8 ? id.slice(-8) : id;
  }

  private printStatusStage(status: PrintJob['status']): number {
    switch (status) {
      case 'converting':
      case 'splitting':
      case 'sending':
      case 'processing':
        return 1;
      case 'printing':
        return 2;
      case 'completed':
      case 'failed':
      case 'cancelled':
      case 'finishing':
        return 3;
      case 'queued':
      case 'scheduled':
      case 'paused':
      case 'held':
      default:
        return 0;
    }
  }

  private copyWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'копия';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'копии';
    return 'копий';
  }

  private pageWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'страница';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'страницы';
    return 'страниц';
  }

  private toPriceNumber(value: CoveragePrice | number | null | undefined): number {
    if (value == null) return 0;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private roundPrice(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private formatPrice(value: number): string {
    const rounded = this.roundPrice(value);
    return Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  private ensurePrintStatusSubscription(): void {
    if (this.printStatusSubscribed) return;
    this.printStatusSubscribed = true;
    this.infraRealtime.subscribe();
  }

  private startPrintStatusPolling(jobId: string): void {
    if (this.printStatusPollingJobId === jobId) return;
    this.printStatusPollingJobId = jobId;

    timer(750, 2000).pipe(
      switchMap(() => this.printApi.getJob(jobId).pipe(
        catchError(() => of(null)),
      )),
      takeWhile(job => job === null || !isTerminalPrintJobStatus(job.status), true),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(job => {
      if (!job || !isPrintJobStatus(job.status)) return;
      this.printStatusJob.update(current => current && current.id === job.id
        ? { ...current, ...job }
        : current
      );
    });
  }

  private enterPrintStatus(job: PrintJob): void {
    this.ensurePrintStatusSubscription();
    this.printStatusJob.set(job);
    this.infraRealtime.requestPrintSync();
    this.startPrintStatusPolling(job.id);
  }

  // ── Actions ────────────────────────────────────────────
  togglePolaroidMode(): void {
    this.polaroidMode.update(v => !v);
    this.clearServerPreviewUrl();
    this.scheduleDraw();
    this.previewRequest$.next();
  }

  rotate(): void {
    this.rotation.update(r => (r + 90) % 360);
    this.clearServerPreviewUrl();
    this.scheduleDraw();
    this.previewRequest$.next();
  }

  changeCopies(delta: number): void {
    this.copies.update(c => Math.max(1, Math.min(99, c + delta)));
  }

  private cartDisabledReason(): string {
    if (this.printing()) return 'Сейчас отправляется задание печати';
    if (!this.data?.file_url) return 'Файл не получен — закройте и откройте диалог';
    if (!this.printer_id()) return 'Выберите принтер';
    const printer = this.currentPrinter();
    if (!printer) return 'Выбранный принтер не найден в списке — обновите страницу';
    const businessIssue = this.businessCardRequirementIssue();
    if (businessIssue) return businessIssue;
    const envelopeIssue = this.envelopeC6RequirementIssue();
    if (envelopeIssue) return envelopeIssue;
    if (!this.selectedPaper()) return `Формат ${this.paper_size()} не поддерживается выбранным принтером`;
    const coverageIssue = this.coveragePricingUnavailableReason();
    if (coverageIssue) return coverageIssue;
    if (this.totalPrice() === 0 && !this.coveragePending() && !this.coverageOverridden()) {
      return 'Цена не рассчитана (нет пресета под размер/тип принтера)';
    }
    return '';
  }

  addToCart(): void {
    const disabledReason = this.cartDisabledReason();
    if (disabledReason) {
      console.warn('[Print] Добавление в корзину заблокировано:', disabledReason);
      return;
    }

    const item = this.buildPrintCartItem();
    if (!item) {
      this.toast.error('Не удалось собрать задание для корзины');
      return;
    }

    this.saveSettingsToStorage();
    const presetId = this.activePresetId();
    if (presetId) {
      this.quickPrintService.saveLastPreset(presetId);
    }
    this.toast.success('Добавлено к оплате');
    this.dialogRef.close({ printed: false, addedToCart: true, cartItems: [item] });
  }

  private buildPrintCartItem(): SyncCartItem | null {
    const printer = this.currentPrinter();
    if (!printer) return null;

    const features = this.printCartFeatures();
    const request = this.buildDeferredPrintRequest(printer, this.data.file_url, this.data.file_name);
    if (!request) return null;

    const requestHash = this.hashString(JSON.stringify(request));
    const coverage = this.coverageResult();
    const quantity = this.printCartBillableQuantity();
    const priceTotal = this.totalPrice();
    const priceParts = this.printCartPriceParts(priceTotal, quantity);
    const billingLineName = this.printCartBillingLineName();
    return {
      serviceId: `print-job-${requestHash}-${Date.now()}`,
      name: `Печать: ${this.trimmedCartFileName()}`,
      description: features.join(' · '),
      price: priceParts.price,
      ...(priceParts.nextPrice !== null ? { nextPrice: priceParts.nextPrice } : {}),
      quantity,
      icon: 'print',
      displayDetails: {
        lines: [{
          name: billingLineName,
          quantity,
          unitPrice: priceParts.unitPrice,
          total: priceTotal,
        }],
        subtotal: priceTotal,
      },
      metadata: {
        kind: 'print-job',
        source: 'print-dialog',
        fileName: this.data.file_name ?? this.trimmedCartFileName(),
        fileUrl: this.data.file_url,
        features,
        printRequest: request,
        pageRange: this.pageRange() || null,
        selectedPages: this.selectedPdfPages(),
        selectedPageCount: this.selectedDocumentPagesCount(),
        knownPageCount: this.knownDocumentPageCount(),
        copies: this.copies(),
        billableQuantity: quantity,
        unitPrice: priceParts.unitPrice,
        priceTotal,
        coveragePercent: coverage?.coverage_percent ?? null,
        fontSizeDeltaPt: this.fontAdjustmentAvailable() ? this.docFontSizeDeltaPt() : null,
        createdAt: new Date().toISOString(),
      },
    };
  }

  private printCartBillableQuantity(): number {
    const copies = Math.max(1, Math.floor(this.copies()));
    if (this.businessCardLayout()) return copies;
    const pages = this.isDocumentFileType() ? this.selectedDocumentPagesCount() : 1;
    return Math.max(1, copies * pages);
  }

  private printCartPriceParts(total: number, quantity: number): { price: number; nextPrice: number | null; unitPrice: number } {
    const roundedTotal = this.roundPrice(total);
    if (quantity <= 1) {
      return { price: roundedTotal, nextPrice: null, unitPrice: roundedTotal };
    }

    const simpleUnitPrice = this.unitPrice();
    const roundedSimpleUnitPrice = this.roundPrice(simpleUnitPrice);
    const simpleTotal = this.roundPrice(roundedSimpleUnitPrice * quantity);
    if (roundedSimpleUnitPrice > 0 && simpleTotal === roundedTotal) {
      return { price: roundedSimpleUnitPrice, nextPrice: null, unitPrice: roundedSimpleUnitPrice };
    }

    const averagedUnitPrice = this.roundPrice(roundedTotal / quantity);
    const firstUnitPrice = this.roundPrice(roundedTotal - averagedUnitPrice * Math.max(0, quantity - 1));
    if (firstUnitPrice > 0 && firstUnitPrice !== averagedUnitPrice) {
      return { price: firstUnitPrice, nextPrice: averagedUnitPrice, unitPrice: averagedUnitPrice };
    }

    return { price: averagedUnitPrice, nextPrice: null, unitPrice: averagedUnitPrice };
  }

  private printCartBillingLineName(): string {
    if (this.businessCardLayout()) return 'Лист печати';
    if (this.isDocumentFileType()) return 'Страница документа';
    return 'Печать файла';
  }

  private buildDeferredPrintRequest(
    printer: Printer,
    fileUrl: string,
    fileName?: string,
  ): { mode: 'normal'; payload: CreatePrintJobParams } | { mode: 'layout-batch'; payload: CreateLayoutBatchParams } | null {
    if (this.businessCardLayout()) {
      const payload = this.buildBusinessCardLayoutPrintPayload(printer, fileUrl);
      return payload ? { mode: 'layout-batch', payload } : null;
    }

    return {
      mode: 'normal',
      payload: this.buildCreatePrintJobPayload(printer, fileUrl, fileName),
    };
  }

  private printCartFeatures(): string[] {
    const printer = this.currentPrinter()?.name ?? 'Принтер';
    const copies = this.copies();
    const pages = this.selectedDocumentPagesCount();
    const knownPages = this.knownDocumentPageCount();
    const pageText = this.isDocumentFileType()
      ? pages > 1 || knownPages > 0
        ? `${pages} ${this.pageWord(pages)}`
        : 'Документ'
      : 'Файл';

    return [
      printer,
      this.currentPaperLabel(),
      this.currentMediaLabel(),
      this.currentQualityLabel(),
      this.isBw() ? 'Ч/Б' : 'Цвет',
      this.duplex() ? 'Двусторонняя' : 'Односторонняя',
      this.currentPaperSourceLabel(),
      `${copies} ${this.copyWord(copies)}`,
      pageText,
    ].filter(value => value.trim().length > 0);
  }

  private currentPaperSourceLabel(): string {
    const caps = this.currentCapabilities();
    if (!caps) return 'Лоток: Авто';
    const source = this.visiblePaperSources(caps).find(option => option.id === this.paperSource());
    return `Лоток: ${source?.name ?? 'Авто'}`;
  }

  private currentPaperLabel(): string {
    return this.selectedPaper()?.name ?? this.paper_size();
  }

  private currentQualityLabel(): string {
    const quality = this.currentCapabilities()?.quality_modes.find(option => option.id === this.quality());
    return quality?.name ?? this.quality();
  }

  private currentMediaLabel(): string {
    const media = this.currentCapabilities()?.media_types.find(option => option.id === this.media_type());
    return media?.name ?? '';
  }

  private trimmedCartFileName(): string {
    const name = (this.data.file_name || this.data.file_url.split('/').pop() || 'файл').split('?')[0];
    return name.length > 54 ? `${name.slice(0, 25)}...${name.slice(-24)}` : name;
  }

  private hashString(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  print(): void {
    // Double-click guard
    if (this.printing()) {
      console.warn('[Print] Печать уже в процессе');
      return;
    }

    const disabledReason = this.printDisabledReason();
    if (disabledReason) {
      console.warn('[Print] Печать заблокирована:', disabledReason);
      return;
    }

    const printer = this.currentPrinter();
    if (!printer) {
      console.warn('[Print] Нет выбранного принтера — отмена');
      return;
    }

    this.printing.set(true);

    // Polaroid mode: generate via backend first, then print the result
    if (this.polaroidMode()) {
      console.log('[Print] Polaroid mode — генерация через backend...');
      const fv = this.faceValidation();
      const faceData = fv?.face_detected && fv.forehead_y != null && fv.chin_y != null ? {
        forehead_y: fv.forehead_y,
        chin_y: fv.chin_y,
        image_width: this.imgNaturalW(),
        image_height: this.imgNaturalH(),
      } : undefined;

      this.printApi.generatePolaroid(this.data.file_url, faceData).subscribe({
        next: polaroid => {
          console.log('[Print] Polaroid сгенерирован:', polaroid.url, `face=${polaroid.faceDetected}, ${polaroid.processingTimeMs}ms`);
          this.sendPrintJob(printer, polaroid.url, 'polaroid.jpg');
        },
        error: err => {
          console.error('[Print] ❌ Polaroid ошибка:', err?.error?.error || err?.message || err);
          this.printing.set(false);
          this.toast.error('Не удалось сгенерировать Polaroid');
        },
      });
      return;
    }

    this.sendPrintJob(printer, this.data.file_url, this.data.file_name);
  }

  private buildPreviewRequest(size: { w: number; h: number }): PreviewRequestParams {
    const fileType = this.fileType();
    const rot = this.rotation() % 360;
    const orientByRot = this.resolvedOrientation();

    const docSetLayout = this.documentSetLayout();
    const docLayout = this.documentLayout();
    const businessLayout = this.businessCardLayout();
    const documentSetSlug = this.data.document_set?.detected_preset_id
      ? `document-set:${this.data.document_set.detected_preset_id}`
      : 'document-set';

    return {
      printer_id: this.printer_id(),
      file_url: this.data.file_url,
      paper_size: this.paper_size(),
      color_mode: this.isBw() ? 'bw' : 'color',
      quality: this.quality(),
      orientation: orientByRot,
      borderless: this.polaroidMode() ? true : this.borderless(),
      media_type: this.media_type() || undefined,
      fit_mode: this.polaroidMode() ? 'fill' : this.fit_mode(),
      rotation: rot,
      ...this.getCropParams(),
      ...(this.polaroidMode() ? { document_template_slug: 'polaroid' } : {}),
      ...(this.activeDocPreset() ? { document_template_slug: this.activeDocPreset()!.id } : {}),
      ...(businessLayout ? {
        document_template_slug: 'business-card-a4',
        layout_rows: businessLayout.rows,
        layout_cols: businessLayout.cols,
        custom_photo_width_mm: businessLayout.photoCellW,
        custom_photo_height_mm: businessLayout.photoCellH,
        cut_margin_mm: businessLayout.cutMarginMm,
        cut_marks: true,
        cut_mark_length_mm: BUSINESS_CARD_A4_TEMPLATE.cutMarkLengthMm,
        cut_mark_offset_mm: BUSINESS_CARD_A4_TEMPLATE.cutMarkOffsetMm,
      } : docSetLayout ? {
        document_template_slug: documentSetSlug,
        layout_rows: docSetLayout.rows,
        layout_cols: docSetLayout.cols,
        custom_photo_width_mm: docSetLayout.photoCellW,
        custom_photo_height_mm: docSetLayout.photoCellH,
        cut_margin_mm: docSetLayout.cutMarginMm,
      } : docLayout ? {
        layout_rows: docLayout.rows,
        layout_cols: docLayout.cols,
        custom_photo_width_mm: docLayout.photoCellW,
        custom_photo_height_mm: docLayout.photoCellH,
        cut_margin_mm: docLayout.cutMarginMm,
      } : {}),
      ...(this.mirror() ? { mirror: true } : {}),
      ...(this.renderingIntent() !== 'perceptual' ? { rendering_intent: this.renderingIntent() } : {}),
      ...(fileType === 'image' && this.target_dpi() !== 300 ? { resolution_dpi: this.target_dpi() } : {}),
      ...(this.isDocumentFileType(fileType) && this.target_dpi() !== 300 ? { dpi: this.target_dpi() } : {}),
      ...(this.fontAdjustmentAvailable() && this.docFontSizeDeltaPt() < 0
        ? { font_size_delta_pt: this.docFontSizeDeltaPt() }
        : {}),
      ...(this.paperSource() && this.paperSource() !== 'auto' ? { paper_source: this.paperSource() } : {}),
      ...(this.pages_per_sheet() > 1 ? { pages_per_sheet: this.pages_per_sheet() } : {}),
      ...(this.duplex_mode() !== 'off' ? { duplex_mode: this.duplex_mode() } : {}),
      ...(this.booklet() ? { booklet: true } : {}),
      preview_width: size.w * 2,
      preview_height: size.h * 2,
    };
  }

  private usesServerPreview(): boolean {
    const fileType = this.fileType();
    return this.usesRasterServerPreview() || fileType === 'pdf' || fileType === 'docx';
  }

  private usesRasterServerPreview(): boolean {
    return this.fileType() === 'image';
  }

  private isDocumentFileType(fileType = this.fileType()): boolean {
    return fileType === 'pdf' || fileType === 'docx' || fileType === 'xlsx';
  }

  private resolveSourceFileExtension(): string {
    const candidates = [this.data.file_name ?? '', this.data.file_url ?? ''];
    for (const value of candidates) {
      const clean = value.split(/[?#]/, 1)[0] ?? '';
      const leaf = clean.split(/[\\/]/).pop() ?? clean;
      const decoded = this.tryDecodeFileName(leaf);
      const dotIndex = decoded.lastIndexOf('.');
      if (dotIndex >= 0 && dotIndex < decoded.length - 1) {
        return decoded.slice(dotIndex + 1).toLowerCase();
      }
    }
    return '';
  }

  private tryDecodeFileName(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private buildLayoutSheetPreviewPayload(): CreateLayoutBatchParams | null {
    if (!this.usesRasterServerPreview()) return null;

    const businessLayout = this.businessCardLayout();
    const docSetLayout = this.documentSetLayout();
    const docLayout = this.documentLayout();
    const layout = businessLayout ?? docSetLayout ?? docLayout;
    const paper = this.selectedPaper();

    if (!layout || layout.photosPerSheet <= 1 || !paper || !this.printer_id()) {
      return null;
    }

    const crop = this.getCropParams();
    const image: LayoutBatchImageParams = {
      file_url: this.data.file_url,
      fit_mode: businessLayout ? 'fill' : this.fit_mode(),
      rotation: this.rotation() % 360,
      ...(crop.crop_x !== undefined ? { crop_x: crop.crop_x } : {}),
      ...(crop.crop_y !== undefined ? { crop_y: crop.crop_y } : {}),
      ...(crop.crop_width !== undefined ? { crop_width: crop.crop_width } : {}),
      ...(crop.crop_height !== undefined ? { crop_height: crop.crop_height } : {}),
    };
    const images = Array.from({ length: layout.photosPerSheet }, () => ({ ...image }));
    const businessPreset = this.activeBusinessCardPreset();
    const docPreset = this.activeDocPreset();

    return {
      printer_id: this.printer_id(),
      images,
      paper_size: paper.id,
      paper_width_mm: paper.width_mm,
      paper_height_mm: paper.height_mm,
      photo_width_mm: layout.photoCellW,
      photo_height_mm: layout.photoCellH,
      cut_margin_mm: layout.cutMarginMm,
      cut_marks: true,
      color_mode: this.isBw() ? 'bw' : 'color',
      quality: this.quality(),
      borderless: this.borderless(),
      ...(this.media_type() ? { media_type: this.media_type() } : {}),
      ...(this.paperSource() && this.paperSource() !== 'auto' ? { paper_source: this.paperSource() } : {}),
      ...(this.mirror() ? { mirror: true } : {}),
      ...(businessPreset ? {
        template_mode: 'business-card',
        photo_preset_id: this.businessCardPhotoPresetId(businessPreset),
      } : docSetLayout ? {
        template_mode: 'passport',
        photo_preset_id: this.data.document_set?.detected_preset_id,
      } : docPreset ? {
        template_mode: 'passport',
        photo_preset_id: docPreset.id,
      } : {}),
    };
  }

  private buildBusinessCardLayoutPrintPayload(printer: Printer, fileUrl: string): CreateLayoutBatchParams | null {
    const layout = this.businessCardLayout();
    const paper = this.selectedPaper();
    const businessPreset = this.activeBusinessCardPreset();
    if (!layout || layout.photosPerSheet <= 1 || !paper || !businessPreset) {
      return null;
    }

    const crop = this.getCropParams();
    const image: LayoutBatchImageParams = {
      file_url: fileUrl,
      fit_mode: 'fill',
      rotation: this.rotation() % 360,
      ...(crop.crop_x !== undefined ? { crop_x: crop.crop_x } : {}),
      ...(crop.crop_y !== undefined ? { crop_y: crop.crop_y } : {}),
      ...(crop.crop_width !== undefined ? { crop_width: crop.crop_width } : {}),
      ...(crop.crop_height !== undefined ? { crop_height: crop.crop_height } : {}),
    };
    const sheetCount = Math.max(1, this.copies());
    const images = Array.from({ length: sheetCount * layout.photosPerSheet }, () => ({ ...image }));

    return {
      printer_id: printer.id,
      images,
      paper_size: paper.id,
      paper_width_mm: paper.width_mm,
      paper_height_mm: paper.height_mm,
      photo_width_mm: layout.photoCellW,
      photo_height_mm: layout.photoCellH,
      cut_margin_mm: layout.cutMarginMm,
      cut_marks: true,
      template_mode: 'business-card',
      photo_preset_id: this.businessCardPhotoPresetId(businessPreset),
      order_id: this.data.order_id,
      order_type: this.data.order_type,
      color_mode: this.isBw() ? 'bw' : 'color',
      quality: this.quality(),
      borderless: false,
      ...(this.media_type() ? { media_type: this.media_type() } : {}),
      ...(this.paperSource() && this.paperSource() !== 'auto' ? { paper_source: this.paperSource() } : {}),
      ...(this.data.default_priority ? { priority: this.data.default_priority } : {}),
      price_total: this.totalPrice(),
    };
  }

  private setServerPreviewBlob(blob: Blob): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.clearServerPreviewUrl();
    const newUrl = URL.createObjectURL(blob);
    this.previewObjectUrls.add(newUrl);
    this.serverPreviewUrl.set(newUrl);
    this.serverPreviewError.set(null);
  }

  private isCurrentServerPreviewRequest(requestSeq: number): boolean {
    return requestSeq === this.serverPreviewRequestSeq;
  }

  private clearServerPreviewUrl(): void {
    const oldUrl = this.serverPreviewUrl();
    if (!oldUrl) return;
    if (isPlatformBrowser(this.platformId)) {
      URL.revokeObjectURL(oldUrl);
      this.previewObjectUrls.delete(oldUrl);
    }
    this.serverPreviewUrl.set(null);
  }

  private handlePreviewError(err: unknown, fallback: string): void {
    const body = err instanceof HttpErrorResponse ? err.error : null;
    const apiMessage = this.errorBodyMessage(body);
    const statusMessage = err instanceof HttpErrorResponse && err.status
      ? `${fallback}: HTTP ${err.status}`
      : err instanceof HttpErrorResponse ? err.message : '';
    this.serverPreviewError.set(apiMessage || statusMessage || fallback);
    console.warn('[Print] Preview error:', err);
  }

  private errorBodyMessage(body: unknown): string {
    if (!body || typeof body !== 'object') return '';
    if ('error' in body && typeof body.error === 'string') return body.error;
    if ('message' in body && typeof body.message === 'string') return body.message;
    return '';
  }

  private readonly updatePreviewPanelBounds = (): void => {
    if (!isPlatformBrowser(this.platformId)) return;
    const panel = this.previewPanelRef()?.nativeElement;
    const fallbackHeight = Math.max(360, (window.visualViewport?.height ?? window.innerHeight) - 340);
    const width = panel && panel.clientWidth > 0 ? panel.clientWidth : 460;
    const height = panel && panel.clientHeight > 0 ? panel.clientHeight : fallbackHeight;
    this.previewPanelBounds.set({ width: Math.round(width), height: Math.round(height) });
    this.scheduleDraw();
  };

  private buildCreatePrintJobPayload(
    printer: Printer,
    fileUrl: string,
    fileName?: string,
  ): CreatePrintJobParams {
    const rot = this.rotation() % 360;
    const orientByRot = this.resolvedOrientation();

    const pdfPages = this.selectedPdfPages();
    const docSetLayout = this.documentSetLayout();
    const docLayout = this.documentLayout();
    const documentSetSlug = this.data.document_set?.detected_preset_id
      ? `document-set:${this.data.document_set.detected_preset_id}`
      : 'document-set';
    const fileType = this.fileType();
    const activeDocPreset = this.activeDocPreset();
    const scheduledAt = this.getScheduledAt();
    const coverage = this.coverageResult();

    return {
      printer_id: printer.id,
      file_url: fileUrl,
      file_name: fileName,
      copies: this.copies(),
      paper_size: this.paper_size(),
      color_mode: this.isBw() ? 'bw' : 'color',
      quality: this.quality(),
      duplex: this.duplex(),
      orientation: orientByRot,
      borderless: this.polaroidMode() ? true : this.borderless(),
      media_type: this.media_type() || undefined,
      fit_mode: this.polaroidMode() ? 'fill' : this.fit_mode(),
      rotation: rot,
      order_id: this.data.order_id,
      order_type: this.data.order_type,
      receipt_id: this.data.receipt_id,
      ...this.getCropParams(),
      ...(pdfPages.length > 0 ? { pages: [...pdfPages] } : {}),
      ...(this.polaroidMode() ? { template_type: 'polaroid' } : {}),
      ...(activeDocPreset ? { document_template_slug: activeDocPreset.id } : {}),
      ...(docSetLayout ? {
        document_template_slug: documentSetSlug,
        layout_rows: docSetLayout.rows,
        layout_cols: docSetLayout.cols,
        custom_photo_width_mm: docSetLayout.photoCellW,
        custom_photo_height_mm: docSetLayout.photoCellH,
        cut_margin_mm: docSetLayout.cutMarginMm,
      } : docLayout ? {
        layout_rows: docLayout.rows,
        layout_cols: docLayout.cols,
        custom_photo_width_mm: docLayout.photoCellW,
        custom_photo_height_mm: docLayout.photoCellH,
        cut_margin_mm: docLayout.cutMarginMm,
      } : {}),
      ...(this.mirror() ? { mirror: true } : {}),
      ...(this.data.default_priority ? { priority: this.data.default_priority } : {}),
      ...(this.renderingIntent() !== 'perceptual' ? { rendering_intent: this.renderingIntent() } : {}),
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      ...(this.selectedFinishingOps().length ? { finishing_ops: this.selectedFinishingOps() } : {}),
      ...(this.paperSource() && this.paperSource() !== 'auto' ? { paper_source: this.paperSource() } : {}),
      ...(this.pages_per_sheet() > 1 ? { pages_per_sheet: this.pages_per_sheet() } : {}),
      ...(fileType === 'image' && this.target_dpi() !== 300 ? { resolution_dpi: this.target_dpi() } : {}),
      ...(this.isDocumentFileType(fileType) && this.target_dpi() !== 300 ? { dpi: this.target_dpi() } : {}),
      ...(this.fontAdjustmentAvailable() && this.docFontSizeDeltaPt() < 0
        ? { font_size_delta_pt: this.docFontSizeDeltaPt() }
        : {}),
      ...(this.copies() > 1 ? { collate: this.collate() } : {}),
      ...(this.toner_save() ? { toner_save: 'on' } : {}),
      ...(this.gray_mode() ? { gray_mode: this.gray_mode() } : {}),
      ...(this.watermarkText() ? {
        watermark_text: this.watermarkText(),
        watermark_opacity: this.watermarkOpacity(),
        watermark_position: this.watermarkPosition(),
      } : {}),
      ...(this.bannerPage() ? { banner_page: true } : {}),
      ...(this.pageRange() ? { page_range: this.pageRange() } : {}),
      ...(this.departmentId() ? { department_id: this.departmentId() } : {}),
      ...(this.securePin() ? { secure_pin: this.securePin() } : {}),
      ...(this.output_bin() !== 'auto' ? { output_bin: this.output_bin() } : {}),
      ...(this.scaling_percent() !== 100 ? { scaling_percent: this.scaling_percent() } : {}),
      ...(this.duplex_mode() !== 'off' ? { duplex_mode: this.duplex_mode() } : {}),
      ...(this.booklet() ? { booklet: true } : {}),
      ...(this.color_auto_detect() ? { color_auto_detect: true } : {}),
      ...(this.binding_edge() !== 'none' ? { binding: this.binding_edge() } : {}),
      ...(this.staple_position() ? { staple_position: this.staple_position() } : {}),
      ...(this.hole_punch_type() ? { hole_punch_type: this.hole_punch_type() } : {}),
      price_total: this.totalPrice(),
      ...(this.showCoverageBadge() && coverage
        ? { coverage_percent: coverage.coverage_percent }
        : {}),
    };
  }

  /** Send the actual print job to the Rust print-api */
  private sendPrintJob(printer: Printer, fileUrl: string, fileName?: string): void {
    const params = {
      printer: printer.name,
      printer_id: printer.id,
      file_url: fileUrl?.slice(0, 80) + '...',
      paper_size: this.paper_size(),
      copies: this.copies(),
      quality: this.quality(),
      fit_mode: this.fit_mode(),
      color_mode: this.isBw() ? 'bw' : 'color',
    };
    console.log('[Print] Отправка задания:', params);

    this.ensurePrintStatusSubscription();
    this.infraRealtime.requestPrintSync();

    if (this.businessCardLayout()) {
      this.sendBusinessCardLayoutPrintJob(printer, fileUrl);
      return;
    }

    this.printApi.createPrintJob(this.buildCreatePrintJobPayload(printer, fileUrl, fileName)).subscribe({
      next: result => {
        this.handlePrintJobCreated(result.job, true);
      },
      error: (err: HttpErrorResponse) => {
        this.handlePrintError(err);
      },
    });
  }

  private sendBusinessCardLayoutPrintJob(printer: Printer, fileUrl: string): void {
    const payload = this.buildBusinessCardLayoutPrintPayload(printer, fileUrl);
    if (!payload) {
      this.printing.set(false);
      this.toast.error('Не удалось собрать лист визиток для печати');
      return;
    }

    console.log('[Print] Отправка листа визиток:', {
      printer: printer.name,
      printer_id: printer.id,
      sheets: Math.max(1, this.copies()),
      cards: payload.images.length,
      paper_size: payload.paper_size,
      quality: payload.quality,
      color_mode: payload.color_mode,
    });

    this.printApi.createLayoutBatchJobs(payload).subscribe({
      next: result => {
        const firstJob = result.jobs[0];
        if (!firstJob) {
          this.printing.set(false);
          this.toast.error('Сервер не вернул задание печати визиток');
          return;
        }

        this.handlePrintJobCreated(firstJob, false);
        if (result.total_sheets > 1) {
          this.toast.info(`Создано листов: ${result.total_sheets}`);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.handlePrintError(err);
      },
    });
  }

  private handlePrintJobCreated(job: PrintJob, allowSplit: boolean): void {
    console.log('[Print] ✅ Job создан:', job?.id, '| status:', job?.status, '| printer:', job?.printer_name);
    this.saveSettingsToStorage();
    const presetId = this.activePresetId();
    if (presetId) {
      this.quickPrintService.saveLastPreset(presetId);
    }
    this.printing.set(false);
    this.enterPrintStatus(job);

    if (!allowSplit || !this.splitEnabled() || this.splitTargetPrinters().length === 0) {
      return;
    }

    const printerIds = [this.printer_id(), ...this.splitTargetPrinters()];
    this.printApi.splitJob(job.id, {
      strategy: this.splitStrategy(),
      target_printers: printerIds,
    }).subscribe({
      next: () => {
        this.printStatusJob.update(current => current && current.id === job.id
          ? { ...current, status: 'splitting' }
          : current
        );
      },
      error: () => {
        this.toast.error('Задание создано, но разделение не удалось');
      },
    });
  }

  private handlePrintError(err: HttpErrorResponse): void {
    this.printing.set(false);
    const status = err?.status ?? 0;
    const detail =
      err?.error?.error ??
      err?.error?.message ??
      err?.error?.detail ??
      (typeof err?.error === 'string' ? err.error : null) ??
      err?.message ??
      err?.statusText ??
      'Неизвестная ошибка';
    const corrId = err?.error?.correlation_id ?? err?.error?.trace_id ?? err?.headers?.get?.('x-trace-id') ?? null;
    console.error('[Print] ❌ Ошибка отправки:', { status, detail, corrId, raw: err });
    const prefix = status > 0 ? `HTTP ${status}` : 'Сеть';
    const body = corrId ? `${detail} · id=${corrId}` : detail;
    this.toast.error(`${prefix}: ${body}`);
  }

  // ── Crop overlay handlers ───────────────────────────────
  onCropRectChange(rect: CropRect): void {
    this.cropRectValue.set(rect);
    this.clearServerPreviewUrl();
    this.scheduleDraw();
    this.previewRequest$.next();
  }

  onCropFitModeChange(mode: 'fit' | 'fill'): void {
    this.fit_mode.set(mode);
    this.onFitChange();
  }

  private getCropParams(): Partial<Pick<
    PreviewRequestParams,
    'crop_x' | 'crop_y' | 'crop_width' | 'crop_height' | 'crop_mode'
  >> {
    const crop = this.cropRectValue();
    if (!crop || (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1)) {
      return {};
    }
    return {
      crop_x: crop.x,
      crop_y: crop.y,
      crop_width: crop.width,
      crop_height: crop.height,
      crop_mode: this.fit_mode() === 'fill' ? 'fill' : 'fit',
    };
  }

  // ── Finishing operations ──
  isFinishingSelected(opId: string): boolean {
    return this.selectedFinishingOps().includes(opId);
  }

  toggleFinishing(opId: string): void {
    this.selectedFinishingOps.update(ops =>
      ops.includes(opId) ? ops.filter(o => o !== opId) : [...ops, opId],
    );
  }

  // ── Splitting helpers ──
  toggleSplitPrinter(id: string): void {
    this.splitTargetPrinters.update(ids =>
      ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id],
    );
  }

  // ── Scheduling helpers ──
  clearSchedule(): void {
    this.scheduledDate.set(null);
    this.scheduledTime.set('');
  }

  getScheduledAt(): string | null {
    const date = this.scheduledDate();
    if (!date) return null;
    const time = this.scheduledTime() || '09:00';
    const [h, m] = time.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h || 9, m || 0, 0, 0);
    return d.toISOString();
  }

  // ── Settings persistence ──
  private saveSettingsToStorage(): void {
    try {
      const settings = {
        printer_id: this.printer_id(),
        paper_size: this.paper_size(),
        media_type: this.media_type(),
        quality: this.quality(),
        fit_mode: this.fit_mode(),
        borderless: this.borderless(),
        isBw: this.isBw(),
        duplex: this.duplex(),
        orientation: this.orientation(),
        renderingIntent: this.renderingIntent(),
        finishing_ops: this.selectedFinishingOps(),
      };
      localStorage.setItem(PrintDialogComponent.SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* quota exceeded — ignore */ }
  }

  private restoreSettingsFromStorage(): void {
    try {
      const raw = localStorage.getItem(PrintDialogComponent.SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return;

      // Only restore if printer still exists
      const printers = this.printers();
      if (s.printer_id && printers.some(p => p.id === s.printer_id)) {
        this.printer_id.set(s.printer_id);
      }
      if (s.paper_size) this.paper_size.set(s.paper_size);
      if (s.media_type) this.media_type.set(s.media_type);
      if (s.quality) this.quality.set(s.quality);
      if (s.fit_mode) this.fit_mode.set(s.fit_mode);
      if (s.borderless != null) this.borderless.set(s.borderless);
      if (s.isBw != null) this.isBw.set(s.isBw);
      if (s.duplex != null) this.duplex.set(s.duplex);
      if (s.orientation) this.orientation.set(s.orientation);
      if (s.renderingIntent) this.renderingIntent.set(s.renderingIntent);
      if (Array.isArray(s.finishing_ops)) this.selectedFinishingOps.set(s.finishing_ops);

      this.hasRestoredSettings.set(true);
    } catch { /* corrupted data — ignore */ }
  }

  cancel(): void {
    const job = this.printStatusJob();
    if (job) {
      this.dialogRef.close({ printed: true, job, statusHandled: true });
      return;
    }
    this.dialogRef.close({ printed: false });
  }

  minimize(): void {
    this.dialogRef.close({ printed: false, minimized: true });
  }

  // ── Canvas zoom & pan handlers ────────────────────────────
  onCanvasWheel(e: WheelEvent): void {
    if (!this.canvasRef()?.nativeElement && !this.serverPreviewUrl()) return;
    e.preventDefault();
    const deltaScale = e.deltaY > 0 ? 0.9 : 1.1;
    this.canvasZoom.update(z => Math.max(0.5, Math.min(3, z * deltaScale)));
    this.scheduleDraw();
  }

  onCanvasMouseDown(e: MouseEvent): void {
    if (!this.canvasRef()?.nativeElement) return;
    this.canvasDragStart = {
      x: e.clientX,
      y: e.clientY,
      panX: this.canvasPanX(),
      panY: this.canvasPanY(),
    };
  }

  onCanvasMouseMove(e: MouseEvent): void {
    if (!this.canvasDragStart || !this.canvasRef()?.nativeElement) return;
    const deltaX = e.clientX - this.canvasDragStart.x;
    const deltaY = e.clientY - this.canvasDragStart.y;
    this.canvasPanX.set(this.canvasDragStart.panX + deltaX);
    this.canvasPanY.set(this.canvasDragStart.panY + deltaY);
    this.scheduleDraw();
  }

  onCanvasMouseUp(): void {
    this.canvasDragStart = null;
  }

  resetCanvasZoomPan(): void {
    this.canvasZoom.set(1);
    this.canvasPanX.set(0);
    this.canvasPanY.set(0);
    this.serverPreviewDragStart = null;
    if (!this.serverPreviewUrl()) this.scheduleDraw();
  }

  // ── Server preview zoom & pan handlers ────────────────
  onServerPreviewMouseDown(e: MouseEvent): void {
    e.preventDefault();
    this.serverPreviewDragStart = {
      x: e.clientX,
      y: e.clientY,
      panX: this.canvasPanX(),
      panY: this.canvasPanY(),
    };
  }

  onServerPreviewMouseMove(e: MouseEvent): void {
    if (!this.serverPreviewDragStart) return;
    const deltaX = e.clientX - this.serverPreviewDragStart.x;
    const deltaY = e.clientY - this.serverPreviewDragStart.y;
    this.canvasPanX.set(this.serverPreviewDragStart.panX + deltaX);
    this.canvasPanY.set(this.serverPreviewDragStart.panY + deltaY);
  }

  onServerPreviewMouseUp(): void {
    this.serverPreviewDragStart = null;
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.updatePreviewPanelBounds);
      window.visualViewport?.removeEventListener('resize', this.updatePreviewPanelBounds);
    }
    this.previewPanelResizeObserver?.disconnect();
    if (this.printStatusSubscribed) {
      this.printStatusSubscribed = false;
      this.infraRealtime.unsubscribe();
    }
    for (const url of this.previewObjectUrls) {
      URL.revokeObjectURL(url);
    }
    this.previewObjectUrls.clear();
  }
}
