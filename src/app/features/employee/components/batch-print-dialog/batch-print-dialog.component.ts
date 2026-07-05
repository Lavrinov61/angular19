import { isPlatformBrowser } from '@angular/common';
import { Component, ChangeDetectionStrategy, inject, signal, computed, input, output, OnInit, OnDestroy, PLATFORM_ID, DestroyRef, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EMPTY, Observable, Subject, catchError, concat, concatMap, debounceTime, distinctUntilChanged, finalize, forkJoin, from, map, of, switchMap, takeUntil, takeWhile, tap, throwError, timer, toArray } from 'rxjs';
import { PrintApiService, Printer, PaperSize, MediaType, BridgePrinterStatus, PrintPresetRecord } from '../../services/print-api.service';
import type { CreateLayoutBatchParams, CreatePrintJobParams, LayoutBatchImageParams, PreviewRequestParams, PrintJob } from '../../services/print-api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { PricingApiService, type PricingServiceOption } from '../../../../core/services/pricing-api.service';
import { PrintPreset } from '../../data/print-prices.data';
import { SyncCartItem } from '../../../../shared/interfaces/cart-sync.interface';
import { getFileIcon, getFileCategory } from '../../../../shared/utils/file-helpers';
import {
  PHOTO_SIZE_PRESETS, PHOTO_PRESETS, DOCUMENT_PRESETS, COLLAGE_PRESETS, LABEL_PRESETS,
  BUSINESS_CARD_A4_TEMPLATE, BUSINESS_CARD_MEDIA_TYPE_LABEL,
  PhotoSizePreset, calculateLayout, calculateDocumentSet, calculateBusinessCardLayout,
  isBusinessCardPresetId, isBusinessCardMediaTypeId, LayoutCalcResult, TemplateMode,
} from '../../data/photo-size-presets';
import { detectPrinterGroups, splitJobsRoundRobin } from '../../utils/printer-split';
import type { ChatPhotoOrderHint } from '../../utils/chat-photo-order-hint.util';
import { CropOverlayComponent, CropRect } from '../../../../shared/components/crop-overlay/crop-overlay.component';
import {
  CoverageAnalysisService,
  CoverageFontStats,
  CoveragePrice,
  CoverageResult,
  CoverageJobState,
} from '../../services/coverage-analysis.service';
import { CoverageBadgeComponent } from '../print-shared/coverage-badge.component';

export interface BatchPrintDialogData {
  files: { msgId: string; url: string; name: string; type: 'image' | 'file' }[];
  sessionId: string;
  action?: 'cart' | 'print';
  orderType?: string;
  photoOrderHint?: ChatPhotoOrderHint | null;
}

type FitMode = 'fit' | 'fill' | 'stretch' | 'actual';
type ColorMode = 'color' | 'bw';
type RotationDegrees = 0 | 90 | 180 | 270;
type PrintRowStatus = 'completed' | 'failed';
type PrintRowResult = { status: PrintRowStatus; error?: string };
type PrintResultState = Readonly<Record<number, PrintRowResult | undefined>>;
type PreviewImageState = Readonly<Record<string, string | undefined>>;
type PreviewLoadingState = Readonly<Record<string, boolean | undefined>>;
type PreviewErrorState = Readonly<Record<string, string | undefined>>;
type SettingsView = 'print' | 'layout';
type BatchPrintRequest =
  | { mode: 'normal'; payload: CreatePrintJobParams }
  | { mode: 'layout-batch'; payload: CreateLayoutBatchParams };
type PageRangeParseResult = { pages: number[]; issue: string };
type PresetCategoryId = 'business' | 'documents' | 'flyers' | 'photo' | 'sublimation';

const QUEUE_MONITOR_STATUS_PARAM = [
  'queued',
  'converting',
  'sending',
  'processing',
  'printing',
  'splitting',
  'finishing',
  'paused',
  'held',
  'scheduled',
  'failed',
].join(',');
const QUEUE_MONITOR_PROCESSING_STATUSES = new Set(['converting', 'sending', 'processing', 'printing', 'splitting', 'finishing']);
const QUEUE_MONITOR_WAITING_STATUSES = new Set(['queued', 'paused', 'held', 'scheduled']);

const CANON_C3226I_MEDIA_WEIGHT_LABELS: Readonly<Record<string, string>> = {
  thin1: '52-59 г/м²',
  тонкая1: '52-59 г/м²',
  thin2: '60-63 г/м²',
  тонкая2: '60-63 г/м²',
  plainpaper1: '64-75 г/м²',
  plain1: '64-75 г/м²',
  ordinary: '64-75 г/м²',
  обычная: '64-75 г/м²',
  обычная1: '64-75 г/м²',
  plainpaper2: '76-90 г/м²',
  plain2: '76-90 г/м²',
  обычная2: '76-90 г/м²',
  plainpaper3: '91-105 г/м²',
  plain3: '91-105 г/м²',
  обычная3: '91-105 г/м²',
  recycled1: '64-75 г/м²',
  переработанная: '64-75 г/м²',
  переработанная1: '64-75 г/м²',
  recycled2: '76-90 г/м²',
  переработанная2: '76-90 г/м²',
  recycled3: '91-105 г/м²',
  переработанная3: '91-105 г/м²',
  color: '64-82 г/м²',
  colour: '64-82 г/м²',
  цветная: '64-82 г/м²',
  bond: '83-99 г/м²',
  bondpaper: '83-99 г/м²',
  высокосортная: '83-99 г/м²',
  heavy1: '106-128 г/м²',
  плотная1: '106-128 г/м²',
  heavy2: '129-150 г/м²',
  плотная2: '129-150 г/м²',
  heavy3: '151-163 г/м²',
  плотная3: '151-163 г/м²',
  heavy4: '164-220 г/м²',
  плотная4: '164-220 г/м²',
  heavy5: '221-256 г/м²',
  плотная5: '221-256 г/м²',
  heavy6: '221-256 г/м²',
  плотная6: '221-256 г/м²',
  heavy7: '257-300 г/м²',
  плотная7: '257-300 г/м²',
  '1sidecoated1': '106-128 г/м²',
  '2sidecoated1': '106-128 г/м²',
  мелованная1: '106-128 г/м²',
  '1sidecoated2': '129-150 г/м²',
  '2sidecoated2': '129-150 г/м²',
  мелованная2: '129-150 г/м²',
  '1sidecoated3': '151-163 г/м²',
  '2sidecoated3': '151-163 г/м²',
  мелованная3: '151-163 г/м²',
  '1sidecoated4': '164-220 г/м²',
  '2sidecoated4': '164-220 г/м²',
  мелованная4: '164-220 г/м²',
  '1sidecoated5': '221-256 г/м²',
  '2sidecoated5': '221-256 г/м²',
  мелованная5: '221-256 г/м²',
  labels: '118-185 г/м²',
  label: '118-185 г/м²',
  этикетки: '118-185 г/м²',
};

interface PresetCategory {
  id: PresetCategoryId;
  label: string;
  icon: string;
  presets: PrintPreset[];
}

const PRESET_CATEGORY_DEFINITIONS: Record<PresetCategoryId, Omit<PresetCategory, 'presets'>> = {
  photo: { id: 'photo', label: 'Фото', icon: 'photo_library' },
  documents: { id: 'documents', label: 'Документы', icon: 'description' },
  flyers: { id: 'flyers', label: 'Полиграфия', icon: 'auto_stories' },
  business: { id: 'business', label: 'Визитки', icon: 'contact_page' },
  sublimation: { id: 'sublimation', label: 'Сублимация', icon: 'local_fire_department' },
};

export interface BatchPrintDialogResult {
  cartItems?: SyncCartItem[];
  queuedCount?: number;
  printedCount?: number;
  printed?: boolean;
  minimized?: boolean;
}

const EMPTY_BATCH_PRINT_DATA: BatchPrintDialogData = {
  files: [],
  sessionId: 'inline-print',
  action: 'cart',
  orderType: 'chat',
};

interface BatchPrintCartEntry {
  name: string;
  description: string;
  price: number;
  icon: string;
  request: BatchPrintRequest;
}

type CoverageRequest = {
  msgId: string;
  fileUrl: string;
  printerId: string;
  paperSize: string;
  paperFormat: string;
  borderless: boolean;
  fontSizeDeltaPt: number;
  colorMode: ColorMode;
};

interface BatchPrintRow {
  file: BatchPrintDialogData['files'][0];
  printer_id: string;
  paper_size: string;
  media_type: string;
  paper_source: string;
  copies: number;
  page_range: string;
  font_size_delta_pt: number;
  price: number;
  fit_mode: FitMode;
  borderless: boolean;
  color_mode: ColorMode;
  duplex: boolean;
  quality: string;
  rotation: RotationDegrees;
  crop_rect: CropRect | null;
  photo_enhance: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  image_width: number | null;
  image_height: number | null;
  coverage_result: CoverageResult | null;
  coverage_loading: boolean;
  coverage_overridden: boolean;
  /** Число страниц из быстрого count-pages — источник истины для цены, развязан от анализа заливки. null = ещё не/не определено. */
  page_count: number | null;
  /** Идёт быстрый подсчёт страниц (count-pages). */
  page_count_loading: boolean;
  /** count-pages упал (битый/зашифр. PDF) — НЕ показываем ×1, требуем ручной диапазон. */
  page_count_failed: boolean;
  /** Прогресс фоновой coverage-задачи (тир заливки + X/N). null = задача не запущена/неприменима. */
  coverage_progress: { stage: string; done: number; total: number } | null;
  edit_key: number;
}

@Component({
  selector: 'app-batch-print-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.inline-print-host]': 'inlineMode()',
  },
  imports: [
    MatDialogModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule,
    MatIconModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatProgressBarModule,
    MatTooltipModule, RouterLink, FormsModule, CropOverlayComponent,
    CoverageBadgeComponent,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <div class="title-main">
        <mat-icon>print</mat-icon>
        <span>Пакетная печать</span>
        <span class="file-count-badge">{{ totalFiles() }}</span>
      </div>
      <div class="title-summary">
        <span>{{ totalBillableLabel() }}</span>
        <span class="summary-sep">&middot;</span>
        <span>{{ totalAmountLabel() }} &#8381;</span>
      </div>
    </h2>

    <mat-dialog-content class="batch-dialog-content">
      @if (!printers().length && !printersLoaded()) {
        <div class="state-row">
          <mat-spinner diameter="24" />
          <span>Загрузка принтеров...</span>
        </div>
      } @else if (!rows().length) {
        <div class="state-row empty-rows">
          <mat-icon>print_disabled</mat-icon>
          <span>Нет файлов для печати</span>
        </div>
      } @else {
        @if (printing() && batchProgress() !== null) {
          <mat-progress-bar mode="determinate" [value]="batchProgress()!" class="batch-progress" />
        }

        <div class="batch-print-workspace">
          <aside class="files-panel">
            <div class="panel-heading">
              <div>
                <span class="section-label">Файлы</span>
                <strong>{{ totalFiles() }}</strong>
              </div>
              <span>{{ totalBillableLabel() }}</span>
            </div>

            <div class="file-list">
              @for (row of rows(); track row.file.msgId; let i = $index) {
                <div class="file-card"
                     role="button"
                     tabindex="0"
                     [class.file-selected]="selectedRowIndex() === i"
                     [class.row-completed]="getRowStatus(i) === 'completed'"
                     [class.row-failed]="getRowStatus(i) === 'failed'"
                     (click)="selectRow(i)"
                     (keydown.enter)="selectRow(i)"
                     (keydown.space)="$event.preventDefault(); selectRow(i)">
                  <span class="file-index">{{ i + 1 }}</span>
                  <span class="file-thumb">
                    <mat-icon [class]="row.file.type === 'image' ? 'image-file' : getFileCategory(row.file.url)">
                      {{ row.file.type === 'image' ? 'image' : getFileIcon(row.file.url) }}
                    </mat-icon>
                  </span>
                  <span class="file-info">
                    <span class="file-name" [title]="row.file.name">{{ row.file.name }}</span>
                    <span class="file-meta">
                      {{ row.paper_size }} · {{ rowBillableLabel(row) }}@if (isRowTotalReady(row)) { · {{ rowTotal(row) }} &#8381;}
                      @if (row.coverage_loading) {
                        <span> · анализ</span>
                      } @else if (row.coverage_result) {
                        <span> · заливка {{ row.coverage_result.coverage_percent.toFixed(0) }}%</span>
                      }
                    </span>
                  </span>
                  @if (getRowStatus(i) === 'completed') {
                    <mat-icon class="row-state done" matTooltip="Готово">check_circle</mat-icon>
                  } @else if (getRowStatus(i) === 'failed') {
                    <mat-icon class="row-state failed" matTooltip="Ошибка">error</mat-icon>
                  }
                  <button type="button"
                          mat-icon-button
                          class="remove-btn"
                          matTooltip="Убрать"
                          (click)="$event.stopPropagation(); removeRow(i)">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              }
            </div>
          </aside>

          <main class="batch-preview-panel">
            @if (selectedRow(); as row) {
              <div class="preview-header">
                <div class="preview-title">
                  <mat-icon>{{ row.file.type === 'image' ? 'photo_size_select_large' : getFileIcon(row.file.url) }}</mat-icon>
                  <span [title]="row.file.name">{{ row.file.name }}</span>
                </div>
                <div class="preview-nav">
                  <button mat-icon-button
                          type="button"
                          matTooltip="Предыдущий файл"
                          [disabled]="!canSelectPrevious()"
                          (click)="selectPreviousRow()">
                    <mat-icon>chevron_left</mat-icon>
                  </button>
                  <span class="preview-meta">
                    {{ selectedRowIndex() + 1 }} / {{ totalFiles() }} · {{ getPaperLabelForRow(row) }} · {{ rowBillableLabel(row) }}
                  </span>
                  <button mat-icon-button
                          type="button"
                          matTooltip="Следующий файл"
                          [disabled]="!canSelectNext()"
                          (click)="selectNextRow()">
                    <mat-icon>chevron_right</mat-icon>
                  </button>
                </div>
              </div>

              @if (row.file.type === 'image') {
                <div class="preview-stage">
                  @if (sheetLayoutActive()) {
                    @if (row.image_width && row.image_height) {
                      @if (selectedPhotoDimensions(); as photo) {
                        <div class="layout-edit-stage">
                          <div class="layout-crop-pane">
                            <app-crop-overlay
                              class="batch-crop-preview layout-crop-preview"
                              [imageUrl]="previewImageUrlForRow(row)"
                              [imageFilter]="imagePreviewFilter(row)"
                              [paperWidth]="photo.width"
                              [paperHeight]="photo.height"
                              [imageNaturalWidth]="row.image_width"
                              [imageNaturalHeight]="row.image_height"
                              [fitMode]="cropOverlayFitMode(row)"
                              [borderless]="true"
                              [initialCropRect]="row.crop_rect"
                              [resetKey]="row.file.msgId + ':' + row.edit_key + ':' + photo.width + 'x' + photo.height"
                              (cropRect)="updateSelectedCrop($event)"
                              (fitModeChange)="updateSelectedCropFit($event)" />
                          </div>
                          <div class="layout-sheet-pane">
                            @if (layoutPreviewUrl(); as previewUrl) {
                              <img class="batch-sheet-preview-image"
                                   [src]="previewUrl"
                                   alt="Предпросмотр листа" />
                            } @else if (layoutPreviewLoading()) {
                              <div class="preview-loading">
                                <mat-spinner diameter="28" />
                                <span>Rust preview...</span>
                              </div>
                            } @else if (layoutPreviewError(); as previewError) {
                              <div class="preview-loading">
                                <mat-icon>error_outline</mat-icon>
                                <span>{{ previewError }}</span>
                              </div>
                            } @else {
                              <div class="preview-loading">
                                <mat-icon>image_not_supported</mat-icon>
                                <span>Rust preview не готов</span>
                              </div>
                            }
                          </div>
                        </div>
                      }
                    } @else {
                      @if (previewImageErrorForRow(row); as previewError) {
                        <div class="preview-loading">
                          <mat-icon>error_outline</mat-icon>
                          <span>{{ previewError }}</span>
                        </div>
                      } @else {
                        <div class="preview-loading">
                          <mat-spinner diameter="28" />
                          <span>Подготовка предпросмотра...</span>
                        </div>
                      }
                    }
                  } @else if (row.image_width && row.image_height) {
                      @if (getPaperForRow(row); as paper) {
                        <div class="preview-rotation-frame" [style.transform]="'rotate(' + row.rotation + 'deg)'">
                          <app-crop-overlay
                            class="batch-crop-preview"
                            [imageUrl]="previewImageUrlForRow(row)"
                            [imageFilter]="imagePreviewFilter(row)"
                            [paperWidth]="cropPaperWidthForRow(row, paper)"
                            [paperHeight]="cropPaperHeightForRow(row, paper)"
                            [imageNaturalWidth]="row.image_width"
                            [imageNaturalHeight]="row.image_height"
                            [fitMode]="cropOverlayFitMode(row)"
                            [borderless]="row.borderless"
                            [initialCropRect]="row.crop_rect"
                            [resetKey]="row.file.msgId + ':' + row.edit_key + ':' + cropPaperWidthForRow(row, paper) + 'x' + cropPaperHeightForRow(row, paper)"
                            (cropRect)="updateSelectedCrop($event)"
                            (fitModeChange)="updateSelectedCropFit($event)" />
                        </div>
                      } @else {
                        <div class="preview-loading">
                          <mat-icon>error_outline</mat-icon>
                          <span>Формат не поддерживается выбранным принтером</span>
                        </div>
                      }
                  } @else {
                    @if (previewImageErrorForRow(row); as previewError) {
                      <div class="preview-loading">
                        <mat-icon>error_outline</mat-icon>
                        <span>{{ previewError }}</span>
                      </div>
                    } @else {
                      <div class="preview-loading">
                        <mat-spinner diameter="28" />
                        <span>Подготовка предпросмотра...</span>
                      </div>
                    }
                  }
                </div>

                <div class="preview-tools">
                  <mat-button-toggle-group [ngModel]="row.fit_mode"
                                           (ngModelChange)="updateSelectedFitMode($event)"
                                           class="preview-fit-toggle"
                                           hideSingleSelectionIndicator>
                    <mat-button-toggle value="fill" matTooltip="Заполнить с обрезкой">
                      <mat-icon>crop_free</mat-icon>
                    </mat-button-toggle>
                    <mat-button-toggle value="fit" matTooltip="Вписать без обрезки">
                      <mat-icon>fit_screen</mat-icon>
                    </mat-button-toggle>
                    <mat-button-toggle value="stretch" matTooltip="Растянуть">
                      <mat-icon>open_in_full</mat-icon>
                    </mat-button-toggle>
                    <mat-button-toggle value="actual" matTooltip="1:1">
                      <mat-icon>crop_original</mat-icon>
                    </mat-button-toggle>
                  </mat-button-toggle-group>

                  <button mat-icon-button matTooltip="Повернуть" (click)="rotateSelectedRow()">
                    <mat-icon>rotate_right</mat-icon>
                  </button>
                  <button mat-icon-button matTooltip="Сбросить кадр" (click)="resetSelectedImage()">
                    <mat-icon>center_focus_strong</mat-icon>
                  </button>
                </div>

                <div class="preview-details">
                  <span><mat-icon>straighten</mat-icon>{{ row.image_width }}×{{ row.image_height }} px</span>
                  <span><mat-icon>screen_rotation</mat-icon>{{ row.rotation }}°</span>
                  @if (row.crop_rect && row.fit_mode === 'fill') {
                    <span><mat-icon>crop</mat-icon>{{ cropPercent(row.crop_rect) }}%</span>
                  }
                </div>
              } @else {
                <div class="document-preview document-preview-stage">
                  @if (documentPreviewUrl(); as previewUrl) {
                    <img class="document-preview-image" [src]="previewUrl" [alt]="'Предпросмотр ' + row.file.name" />
                  } @else if (documentPreviewLoading()) {
                    <div class="preview-loading">
                      <mat-spinner diameter="28" />
                      <span>Готовим предпросмотр документа</span>
                    </div>
                  } @else if (documentPreviewError(); as previewError) {
                    <div class="preview-loading">
                      <mat-icon>error_outline</mat-icon>
                      <span>{{ previewError }}</span>
                    </div>
                  } @else {
                    <div class="preview-loading">
                      <mat-icon [class]="getFileCategory(row.file.url)">{{ getFileIcon(row.file.url) }}</mat-icon>
                      <span>Предпросмотр документа не запрошен</span>
                    </div>
                  }
                </div>
              }
            }
          </main>

          <aside class="settings-panel">
            @if (selectedRow(); as row) {
              <div class="settings-view-switch">
                <button mat-flat-button color="primary"
                        type="button"
                        class="settings-print-btn"
                        [disabled]="printActionDisabled()"
                        [matTooltip]="printDisabledReason()"
                        (click)="submitPrintAction()">
                  @if (printing() || coveragePending()) {
                    <mat-spinner diameter="18" />
                  } @else {
                    <mat-icon>{{ printActionIcon() }}</mat-icon>
                  }
                  {{ printActionLabel() }}
                </button>

                @if (layoutSettingsAvailable(row)) {
                  <mat-button-toggle-group [ngModel]="settingsView()"
                                           (ngModelChange)="setSettingsView($event)"
                                           hideSingleSelectionIndicator>
                    <mat-button-toggle value="print">
                      <mat-icon>tune</mat-icon>
                      Параметры
                    </mat-button-toggle>
                    <mat-button-toggle value="layout">
                      <mat-icon>straighten</mat-icon>
                      Точный размер
                    </mat-button-toggle>
                  </mat-button-toggle-group>
                }
              </div>

              @switch (settingsView()) {
                @case ('print') {
                  <section class="settings-section selected-settings">
                    <div class="section-heading">
                      <mat-icon>tune</mat-icon>
                      <span>Выбранный файл</span>
                    </div>

                    <mat-form-field appearance="outline" class="full-field">
                      <mat-label>Принтер</mat-label>
                      <mat-select [ngModel]="row.printer_id"
                                  [disabled]="isBusinessCardSelected()"
                                  (ngModelChange)="updateSelectedPrinter($event)">
                        @for (p of printers(); track p.id) {
                          <mat-option [value]="p.id">{{ p.name }}</mat-option>
                        }
                        @if (!printers().length) {
                          <mat-option value="">— нет принтеров —</mat-option>
                        }
                      </mat-select>
                      @if (isBusinessCardSelected()) {
                        <mat-hint>Визитки печатаются только на Canon C3226i. Чтобы выбрать другой принтер, смените размер во вкладке «Точный размер».</mat-hint>
                      }
                    </mat-form-field>

                    <div class="settings-grid" [class.single-column]="!qualitySettingsAvailable(row)">
                      <mat-form-field appearance="outline">
                        <mat-label>Формат</mat-label>
                        <mat-select [ngModel]="row.paper_size"
                                    [disabled]="isBusinessCardSelected()"
                                    (ngModelChange)="updateSelectedPaper($event)">
                          @for (ps of getPaperSizesForRow(row); track ps.id) {
                            <mat-option [value]="ps.id">{{ ps.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>

                      @if (qualitySettingsAvailable(row)) {
                        <mat-form-field appearance="outline">
                          <mat-label>Качество</mat-label>
                          <mat-select [ngModel]="row.quality" (ngModelChange)="updateSelectedQuality($event)">
                            @for (qm of getQualityModesForRow(row); track qm.id) {
                              <mat-option [value]="qm.id">{{ qm.name }}</mat-option>
                            }
                          </mat-select>
                        </mat-form-field>
                      }
                    </div>

                    @if (isBusinessCardSelected() || getMediaTypesForRow(row).length > 1) {
                      <mat-form-field appearance="outline" class="full-field">
                        <mat-label>Тип бумаги</mat-label>
                        <mat-select [ngModel]="row.media_type"
                                    (ngModelChange)="updateSelectedMediaType($event)">
                          <mat-select-trigger>{{ selectedMediaTypeLabel(row) }}</mat-select-trigger>
                          @for (mt of getMediaTypesForRow(row); track mt.id) {
                            <mat-option [value]="mt.id">{{ mediaTypeLabel(row, mt) }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    }

                    @if (isBusinessCardSelected() || getPaperSourcesForRow(row).length > 1) {
                      <mat-form-field appearance="outline" class="full-field">
                        <mat-label>Источник бумаги</mat-label>
                        <mat-select [ngModel]="row.paper_source"
                                    (ngModelChange)="updateSelectedPaperSource($event)">
                          @for (src of getPaperSourcesForRow(row); track src.id) {
                            <mat-option [value]="src.id">{{ src.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    }

                    @if (shouldShowCoverageBadge(row)) {
                      <app-coverage-badge
                        class="coverage-row"
                        [result]="row.coverage_result"
                        [loading]="row.coverage_loading"
                        [overridden]="row.coverage_overridden" />
                    }

                    @if (coverageProgressLabel(row); as progress) {
                      <div class="coverage-progress" role="status">
                        <mat-spinner diameter="16" />
                        <span>{{ progress }}</span>
                      </div>
                    } @else if (coverageTierUnresolved(row)) {
                      <div class="coverage-tier-note" role="note">
                        <mat-icon>info</mat-icon>
                        <span>Тир заливки не уточнён — цена по фиксированному тарифу</span>
                      </div>
                    }

                    @if (row.file.type !== 'image') {
                      @if (isPageCountPending(row)) {
                        <div class="page-count-status" role="status">
                          <mat-spinner diameter="16" />
                          <span>Читаю документ…</span>
                        </div>
                      } @else if (isPageCountFailed(row)) {
                        <div class="page-count-status page-count-status--error" role="alert">
                          <mat-icon>error_outline</mat-icon>
                          <span>Не удалось определить число страниц — укажите диапазон вручную</span>
                        </div>
                      }
                      <mat-form-field appearance="outline" class="full-field page-range-field">
                        <mat-label>Страницы</mat-label>
                        <input matInput
                               [ngModel]="row.page_range"
                               (ngModelChange)="updateSelectedPageRange($event)"
                               placeholder="1-3, 5" />
                        @if (rowPageRangeIssue(row)) {
                          <mat-hint class="page-range-error">{{ rowPageRangeIssue(row) }}</mat-hint>
                        } @else if (knownDocumentPageCount(row); as pageCount) {
                          <mat-hint>Всего {{ pageCount }} стр. · {{ selectedDocumentPageCount(row) }} к печати</mat-hint>
                        } @else if (isPageCountPending(row)) {
                          <mat-hint>Читаю документ…</mat-hint>
                        }
                      </mat-form-field>
                    }

                    @if (isWordDocument(row)) {
                      <mat-form-field appearance="outline" class="full-field">
                        <mat-label>Шрифт документа</mat-label>
                        <mat-select [ngModel]="row.font_size_delta_pt" (ngModelChange)="updateSelectedFontSizeDelta($event)">
                          @for (delta of docFontSizeDeltaOptions; track delta) {
                            <mat-option [value]="delta">
                              {{ delta === 0 ? 'Без изменения' : delta + ' pt' }}
                            </mat-option>
                          }
                        </mat-select>
                        <mat-hint>Применится ко всему DOC/DOCX</mat-hint>
                      </mat-form-field>
                      @if (row.coverage_result?.font_stats; as fontStats) {
                        <div class="doc-font-summary">
                          <mat-icon>format_size</mat-icon>
                          <span>{{ rowFontStatsLabel(row, fontStats) }}</span>
                        </div>
                      }
                    }

                    <div class="copies-row">
                      <span>Копии</span>
                      <div class="copies-ctrl">
                        <button mat-icon-button class="copies-btn"
                                (click)="changeSelectedCopies(-1)"
                                [disabled]="row.copies <= 1">
                          <mat-icon>remove</mat-icon>
                        </button>
                        <span class="copies-num">{{ row.copies }}</span>
                        <button mat-icon-button class="copies-btn" (click)="changeSelectedCopies(1)">
                          <mat-icon>add</mat-icon>
                        </button>
                      </div>
                      @if (isRowTotalReady(row)) {
                        <strong>{{ rowTotal(row) }} &#8381;</strong>
                      } @else {
                        <strong class="price-pending">—</strong>
                      }
                    </div>

                    @if (getPrinterForRow(row); as printer) {
                      <div class="option-grid">
                        @if (printer.capabilities.borderless) {
                          <mat-checkbox [ngModel]="row.borderless" (ngModelChange)="setSelectedBorderless($event)">
                            Без полей
                          </mat-checkbox>
                        }
                        @if (printer.capabilities.duplex) {
                          <mat-checkbox [ngModel]="row.duplex" (ngModelChange)="setSelectedDuplex($event)">
                            Двусторонняя
                          </mat-checkbox>
                        }
                        @if (printer.capabilities.color) {
                          <div class="color-mode-switch" role="group" aria-label="Режим цвета">
                            <button mat-button type="button" class="color-mode-btn"
                                    [class.active]="row.color_mode === 'bw'"
                                    (click)="setSelectedColorMode('bw')">
                              <mat-icon>filter_b_and_w</mat-icon>
                              Ч/Б
                            </button>
                            <button mat-button type="button" class="color-mode-btn"
                                    [class.active]="row.color_mode === 'color'"
                                    (click)="setSelectedColorMode('color')">
                              <mat-icon>palette</mat-icon>
                              Цветная
                            </button>
                          </div>
                        }
                      </div>
                    }

                    @if (row.file.type === 'image') {
                      <div class="photo-adjustments">
                        <div class="photo-adjustment-header">
                          @if (photoEnhanceAvailable(row)) {
                            <mat-checkbox [ngModel]="row.photo_enhance"
                                          (ngModelChange)="setSelectedPhotoEnhance($event)">
                              PhotoEnhance
                            </mat-checkbox>
                          }
                          <button mat-stroked-button type="button" class="small-action-btn" (click)="rotateSelectedRow()">
                            <mat-icon>rotate_right</mat-icon>
                            90°
                          </button>
                        </div>

                        <label class="slider-row">
                          <span>Яркость</span>
                          <input #brightnessSlider
                                 type="range"
                                 min="-40"
                                 max="40"
                                 step="1"
                                 [ngModel]="row.brightness"
                                 (input)="updateSelectedBrightness(brightnessSlider.value)" />
                          <strong>{{ row.brightness > 0 ? '+' + row.brightness : row.brightness }}</strong>
                        </label>

                        <label class="slider-row">
                          <span>Контраст</span>
                          <input #contrastSlider
                                 type="range"
                                 min="-40"
                                 max="40"
                                 step="1"
                                 [ngModel]="row.contrast"
                                 (input)="updateSelectedContrast(contrastSlider.value)" />
                          <strong>{{ row.contrast > 0 ? '+' + row.contrast : row.contrast }}</strong>
                        </label>

                        <label class="slider-row">
                          <span>Насыщенность</span>
                          <input #saturationSlider
                                 type="range"
                                 min="-60"
                                 max="60"
                                 step="1"
                                 [ngModel]="row.saturation"
                                 (input)="updateSelectedSaturation(saturationSlider.value)" />
                          <strong>{{ row.saturation > 0 ? '+' + row.saturation : row.saturation }}</strong>
                        </label>

                        <button mat-stroked-button type="button" class="small-action-btn" (click)="resetSelectedPhotoAdjustments()">
                          <mat-icon>restart_alt</mat-icon>
                          Сбросить цвет
                        </button>
                      </div>
                    }

                    <button mat-stroked-button type="button"
                            class="apply-all-btn"
                            [disabled]="rows().length < 2"
                            (click)="applySelectedSettingsToAll()">
                      <mat-icon>done_all</mat-icon>
                      Применить к пакету
                    </button>
                  </section>

                }

                @case ('layout') {
                  @if (layoutSettingsAvailable(row)) {
                    <section class="settings-section layout-section">
                      <div class="section-heading">
                        <mat-icon>straighten</mat-icon>
                        <span>Точный размер</span>
                      </div>

                      @if (photoLayoutControlsAvailable(row) || isBusinessCardSelected()) {
                        <div class="photo-size-row">
                          <span class="section-label">Размер фото</span>
                          <div class="size-chips">
                            @for (size of photoPresets; track size.id) {
                              <button mat-stroked-button class="size-chip"
                                      [class.active]="selectedPhotoSize().id === size.id"
                                      (click)="selectPhotoSize(size)">
                                @if (size.icon) { <mat-icon>{{ size.icon }}</mat-icon> }
                                {{ size.label }}
                              </button>
                            }
                            <button mat-stroked-button class="size-chip"
                                    [class.active]="selectedPhotoSize().id === 'custom'"
                                    (click)="selectCustomSize()">
                              <mat-icon>straighten</mat-icon>
                              Свой размер
                            </button>
                          </div>
                        </div>
                      }

                      @if (labelLayoutControlsAvailable(row)) {
                        <div class="photo-size-row">
                          <span class="section-label">Визитки / этикетки</span>
                          <div class="size-chips">
                            @for (size of labelPresets; track size.id) {
                              <button mat-stroked-button class="size-chip label-chip"
                                      [class.active]="selectedPhotoSize().id === size.id"
                                      (click)="selectLabelSize(size)">
                                @if (size.icon) { <mat-icon>{{ size.icon }}</mat-icon> }
                                {{ size.label }}
                              </button>
                            }
                          </div>
                        </div>
                      }

                      @if (photoLayoutControlsAvailable(row) && selectedPhotoSize().id === 'custom') {
                        <div class="custom-size-row">
                          <mat-form-field appearance="outline" class="size-field">
                            <mat-label>Ш, см</mat-label>
                            <input matInput type="text" inputmode="decimal"
                                   [ngModel]="customPhotoWCm()"
                                   (ngModelChange)="setCustomPhotoWidthCm($event)"
                                   placeholder="3,7" />
                          </mat-form-field>
                          <span class="size-x">&times;</span>
                          <mat-form-field appearance="outline" class="size-field">
                            <mat-label>В, см</mat-label>
                            <input matInput type="text" inputmode="decimal"
                                   [ngModel]="customPhotoHCm()"
                                   (ngModelChange)="setCustomPhotoHeightCm($event)"
                                   placeholder="4,7" />
                          </mat-form-field>
                        </div>
                      }

                      @if (photoLayoutControlsAvailable(row) && isDocumentMode()) {
                        <div class="mode-info-bar document-info-bar">
                          <mat-icon>badge</mat-icon>
                          <span>{{ selectedPhotoSize().label }}, {{ layoutResult()?.photosPerSheet ?? 0 }} шт на листе 10×15</span>
                        </div>
                      }

                      @if (photoLayoutControlsAvailable(row) && isCollageMode()) {
                        <div class="mode-info-bar collage-info-bar">
                          <mat-icon>grid_on</mat-icon>
                          <span>{{ selectedPhotoSize().label }}, {{ layoutResult()?.sheetsNeeded ?? 1 }} {{ layoutResult()?.sheetsNeeded === 1 ? 'лист' : 'листов' }}</span>
                        </div>
                      }

                      @if (isLabelMode()) {
                        <div class="label-config-bar">
                          <mat-icon>contact_page</mat-icon>
                          <span>{{ selectedPhotoSize().label }}: {{ layoutResult()?.photosPerSheet ?? 0 }} шт на листе A4</span>
                          <mat-form-field appearance="outline" class="label-qty-field">
                            <mat-label>Кол-во</mat-label>
                            <input matInput type="number" min="1" max="1000"
                                   [ngModel]="labelQuantity()"
                                   (ngModelChange)="setLabelQuantity($event)" />
                          </mat-form-field>
                          <span class="label-sheets-hint">
                            {{ labelSheetsNeeded() }} {{ sheetWord(labelSheetsNeeded()) }} A4
                          </span>
                        </div>
                      }

                      @if (layoutResult(); as layout) {
                        @if (layoutSheetPreviewAvailable(layout)) {
                          <div class="layout-info-row">
                            @if (layoutPreviewUrl(); as previewUrl) {
                              <img class="batch-sheet-preview-image compact"
                                   [src]="previewUrl"
                                   alt="Предпросмотр листа" />
                            } @else if (layoutPreviewLoading()) {
                              <div class="preview-loading compact">
                                <mat-spinner diameter="22" />
                                <span>Rust preview...</span>
                              </div>
                            } @else if (layoutPreviewError(); as previewError) {
                              <div class="preview-loading compact">
                                <mat-icon>error_outline</mat-icon>
                                <span>{{ previewError }}</span>
                              </div>
                            } @else {
                              <div class="preview-loading compact">
                                <mat-icon>image_not_supported</mat-icon>
                                <span>Rust preview не готов</span>
                              </div>
                            }
                            <div class="layout-stats">
                              <div class="stat-row">
                                <mat-icon>grid_on</mat-icon>
                                <span>{{ layout.cols }}&times;{{ layout.rows }} = <strong>{{ layout.photosPerSheet }} фото/лист</strong></span>
                              </div>
                              @if (layout.sheetsNeeded) {
                                <div class="stat-row">
                                  <mat-icon>content_copy</mat-icon>
                                  <span>{{ totalLayoutPhotos() }} {{ layoutItemUnitLabel() }} = <strong>{{ layout.sheetsNeeded }} {{ sheetWord(layout.sheetsNeeded) }}</strong></span>
                                </div>
                              }
                              @if (customCuttingQuantity() > 0) {
                                <div class="stat-row">
                                  <mat-icon>content_cut</mat-icon>
                                  <span>
                                    Резка: <strong>{{ customCuttingQuantity() }} &times; {{ customCuttingUnitPrice() > 0 ? customCuttingUnitPrice() + ' ₽' : 'нет цены' }}</strong>
                                  </span>
                                </div>
                              }
                              <div class="stat-row">
                                <mat-icon>delete_outline</mat-icon>
                                <span>Отходы: {{ layout.wastePercent }}%</span>
                              </div>
                              @if (photoLayoutControlsAvailable(row) && !isDocumentMode() && !isBusinessCardSelected()) {
                                <mat-form-field appearance="outline" class="paper-select">
                                  <mat-label>Бумага</mat-label>
                                  <mat-select [ngModel]="selectedPaperForLayout()" (ngModelChange)="setLayoutPaper($event)">
                                    @for (ps of getAvailablePapers(); track ps.id) {
                                      <mat-option [value]="ps.id">{{ ps.name }}</mat-option>
                                    }
                                  </mat-select>
                                </mat-form-field>
                              }
                            </div>
                          </div>
                        }
                      }
                    </section>
                  } @else {
                    <section class="settings-section">
                      <div class="section-heading">
                        <mat-icon>print</mat-icon>
                        <span>Параметры лазерной печати</span>
                      </div>
                      <p class="settings-note">Для лазерного A4/A3 используйте вкладку «Параметры»: формат бумаги, страницы, цветность, двусторонняя печать и заливка находятся там.</p>
                    </section>
                  }
                }

              }
              @if (directPrintMode()) {
                <section class="settings-section queue-monitor-section">
                  <div class="section-heading queue-monitor-heading">
                    <div class="queue-monitor-title">
                      <mat-icon>pending_actions</mat-icon>
                      <span>Очередь принтера</span>
                    </div>
                    <div class="queue-monitor-actions">
                      <a mat-icon-button
                         routerLink="/employee/print-queue"
                         matTooltip="Открыть полную очередь"
                         aria-label="Открыть полную очередь">
                        <mat-icon>open_in_new</mat-icon>
                      </a>
                      <button mat-icon-button
                              type="button"
                              [disabled]="queueMonitorLoading()"
                              (click)="refreshQueueMonitor()"
                              matTooltip="Обновить очередь"
                              aria-label="Обновить очередь принтера">
                        @if (queueMonitorLoading()) {
                          <mat-spinner diameter="18" />
                        } @else {
                          <mat-icon>refresh</mat-icon>
                        }
                      </button>
                    </div>
                  </div>

                  @if (selectedQueuePrinter(); as printer) {
                    <div class="queue-printer-card"
                         [class.offline]="!queuePrinterOnline()"
                         [class.paused]="printer.queue_paused">
                      <div class="queue-printer-main">
                        <span class="queue-status-dot" [class.online]="queuePrinterOnline()"></span>
                        <span class="queue-printer-name">{{ printer.name }}</span>
                        @if (printer.queue_paused) {
                          <span class="queue-printer-badge">Пауза</span>
                        }
                      </div>
                      <div class="queue-printer-meta">
                        <span>{{ queuePrinterOnline() ? 'Онлайн' : 'Недоступен' }}</span>
                        <span>{{ queuePrinterDepthLabel() }}</span>
                      </div>
                    </div>

                    <div class="queue-stat-grid">
                      <div class="queue-stat">
                        <strong>{{ queueMonitorCounts().total }}</strong>
                        <span>активно</span>
                      </div>
                      <div class="queue-stat">
                        <strong>{{ queueMonitorCounts().waiting }}</strong>
                        <span>ждёт</span>
                      </div>
                      <div class="queue-stat" [class.problem]="queueMonitorCounts().problems > 0">
                        <strong>{{ queueMonitorCounts().problems }}</strong>
                        <span>ошибки</span>
                      </div>
                    </div>

                    @if (queueMonitorError()) {
                      <div class="queue-monitor-state error">
                        <mat-icon>error_outline</mat-icon>
                        <span>{{ queueMonitorError() }}</span>
                      </div>
                    } @else if (queueMonitorLoading() && !queueMonitorJobs().length) {
                      <div class="queue-monitor-state">
                        <mat-spinner diameter="22" />
                        <span>Загружаем очередь</span>
                      </div>
                    } @else if (queueMonitorVisibleJobs().length) {
                      <div class="queue-job-list">
                        @for (job of queueMonitorVisibleJobs(); track job.id) {
                          <div class="queue-job-row">
                            <mat-icon class="queue-job-icon">{{ queueJobStatusIcon(job.status) }}</mat-icon>
                            <div class="queue-job-info">
                              <span class="queue-job-name" [title]="queueJobTitle(job)">{{ queueJobTitle(job) }}</span>
                              <span class="queue-job-meta">
                                {{ job.paper_size }} · {{ job.copies }} коп. · {{ queueJobAgeLabel(job) }}
                              </span>
                            </div>
                            <span [class]="queueJobStatusClass(job.status)">
                              {{ queueJobStatusLabel(job.status) }}
                            </span>
                          </div>
                        }
                      </div>
                      @if (queueMonitorHiddenCount() > 0) {
                        <a mat-button routerLink="/employee/print-queue" class="queue-more-link">
                          Ещё {{ queueMonitorHiddenCount() }} в полной очереди
                        </a>
                      }
                    } @else {
                      <div class="queue-monitor-state empty">
                        <mat-icon>check_circle_outline</mat-icon>
                        <span>Активных заданий нет</span>
                      </div>
                    }

                    @if (queueMonitorRefreshedAt(); as refreshedAt) {
                      <div class="queue-refresh-time">
                        Обновлено {{ formatQueueMonitorTime(refreshedAt) }}
                      </div>
                    }
                  } @else {
                    <div class="queue-monitor-state empty">
                      <mat-icon>print_disabled</mat-icon>
                      <span>Выберите принтер</span>
                    </div>
                  }
                </section>
              }
            }
          </aside>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions class="summary-bar">
      <div class="summary-info">
        <span class="summary-detail">{{ totalFiles() }} файлов</span>
        <span class="summary-sep">&middot;</span>
        <span class="summary-detail">{{ totalBillableLabel() }}</span>
        <span class="summary-sep">&middot;</span>
        <span class="summary-total">{{ totalAmountLabel() }} &#8381;</span>
      </div>
      <button mat-button type="button" (click)="cancel()">Отмена</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
      color: #111827;
      --crm-surface-base: #f4f7fb;
      --crm-surface: #ffffff;
      --crm-surface-raised: #ffffff;
      --crm-surface-overlay: #f8fafc;
      --crm-surface-hover: #f3f6fa;
      --crm-surface-active: #eef2f7;
      --crm-text: #111827;
      --crm-text-primary: #111827;
      --crm-text-secondary: #374151;
      --crm-text-muted: #6b7280;
      --crm-accent: #f59e0b;
      --crm-accent-hover: #d97706;
      --crm-accent-dim: #b45309;
      --crm-accent-muted: rgba(245, 158, 11, 0.12);
      --crm-accent-container: #fff7ed;
      --crm-border: #dbe3ed;
      --crm-border-subtle: #edf1f5;
      --crm-border-focus: rgba(245, 158, 11, 0.48);
      --crm-glass-border: #dbe3ed;
      --crm-status-info: #2563eb;
      --crm-status-info-container: #eff6ff;
      --crm-status-success: #15803d;
      --crm-status-success-container: #ecfdf5;
      --crm-status-warning: #b45309;
      --crm-status-warning-container: #fffbeb;
      --crm-status-error: #dc2626;
      --crm-status-error-container: #fef2f2;
      --crm-danger: #dc2626;
      --crm-document-accent: #1976d2;
      --crm-collage-accent: #7b1fa2;
      --mat-sys-primary: #f59e0b;
      --mat-sys-on-primary: #111827;
      --mat-sys-surface: #ffffff;
      --mat-sys-surface-container: #ffffff;
      --mat-sys-surface-container-low: #f8fafc;
      --mat-sys-surface-container-high: #f1f5f9;
      --mat-sys-on-surface: #111827;
      --mat-sys-on-surface-variant: #4b5563;
      --mat-sys-outline: #cbd5e1;
      --mat-sys-outline-variant: #e2e8f0;
      --mat-sys-error: #dc2626;
    }

    :host ::ng-deep .mat-mdc-text-field-wrapper {
      background: #ffffff;
    }

    :host ::ng-deep .mat-mdc-select-value,
    :host ::ng-deep .mat-mdc-select-arrow,
    :host ::ng-deep .mat-mdc-floating-label,
    :host ::ng-deep .mat-mdc-input-element {
      color: #111827 !important;
    }

    :host ::ng-deep .mat-mdc-form-field-hint {
      color: #6b7280 !important;
    }

    :host ::ng-deep .mat-button-toggle-group {
      border-color: #dbe3ed;
      background: #ffffff;
    }

    :host ::ng-deep .mat-button-toggle {
      color: #374151;
      background: #ffffff;
      border-color: #dbe3ed;
    }

    :host ::ng-deep .mat-button-toggle-checked {
      color: #111827;
      background: #fff7ed;
    }

    .dialog-title {
      display: flex; align-items: center; gap: 8px;
      mat-icon { color: var(--crm-accent); }
    }
    .file-count-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 24px; height: 24px; padding: 0 6px;
      border-radius: 12px; font-size: 12px; font-weight: 600;
      background: var(--crm-accent); color: #fff;
    }

    .batch-dialog-content {
      max-height: calc(94vh - 132px) !important;
      min-height: min(680px, calc(94vh - 132px));
      overflow: hidden !important;
      padding: 0 20px 12px !important;
    }
    .batch-preview-panel {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow: hidden;
      padding: 14px;
      border: 1px solid var(--crm-border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--crm-surface-raised) 72%, transparent);
    }
    .preview-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .preview-title {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text);
    }
    .preview-title span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .preview-title mat-icon {
      flex: 0 0 20px;
      color: var(--crm-accent);
    }
    .preview-meta {
      flex: 0 0 auto;
      font-size: 12px;
      color: var(--crm-text-muted);
      white-space: nowrap;
    }
    .preview-nav {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .preview-nav button {
      width: 30px !important;
      height: 30px !important;
      padding: 0 !important;
    }
    .preview-nav mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }
    .preview-stage {
      flex: 1 1 auto;
      min-height: 360px;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 10px;
      background-color: #f8fafc;
      background-image:
        linear-gradient(45deg, rgba(148, 163, 184, 0.18) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(148, 163, 184, 0.18) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.18) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.18) 75%);
      background-size: 18px 18px;
      background-position: 0 0, 0 9px, 9px -9px, -9px 0;
      border: 1px solid var(--crm-border);
    }
    .preview-rotation-frame {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-origin: center;
      transition: transform 120ms ease;
    }
    .batch-crop-preview {
      width: 100% !important;
      height: 100%;
      max-width: 100% !important;
      max-height: 100%;
      min-height: 0;
      display: grid !important;
      align-items: center;
      justify-content: center;
    }
    .batch-sheet-preview-image {
      display: block;
      max-width: 100%;
      max-height: 100%;
      height: auto;
      object-fit: contain;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
    }
    .layout-info-row .batch-sheet-preview-image {
      width: 108px;
      max-height: 152px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32);
    }
    :host ::ng-deep .batch-crop-preview .crop-container {
      border-color: rgba(245, 158, 11, 0.55);
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
    }
    .layout-edit-stage {
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(260px, 0.9fr) minmax(220px, 0.7fr);
      gap: 16px;
      align-items: center;
    }
    .layout-crop-pane,
    .layout-sheet-pane {
      min-width: 0;
      min-height: 0;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .layout-sheet-pane .batch-sheet-preview-image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .layout-crop-preview {
      max-height: 100%;
    }
    .preview-loading,
    .document-preview {
      min-height: 280px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--crm-text-muted);
      text-align: center;
    }
    .document-preview mat-icon {
      width: 64px;
      height: 64px;
      font-size: 64px;
      color: var(--crm-text-muted);
    }
    .document-preview-stage {
      width: 100%;
      height: 100%;
      min-height: 320px;
    }
    .document-preview-image {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      background: #ffffff;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
    }
    .document-preview-stage .preview-loading {
      min-height: 280px;
    }
    .preview-tools {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .preview-fit-toggle {
      margin-right: auto;
      ::ng-deep .mat-button-toggle {
        width: 42px;
        height: 34px;
        .mat-button-toggle-button { padding: 0; }
        mat-icon { font-size: 18px; width: 18px; height: 18px; }
      }
    }
    .preview-details {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--crm-text-muted);
    }
    .preview-details span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .preview-details mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }

    .preset-category-row,
    .preset-actions-row,
    .presets-bar {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .preset-category {
      font-size: 12px;
      min-height: 30px;
      padding: 0 9px;
      border-radius: 8px !important;
      mat-icon { font-size: 15px; width: 15px; height: 15px; margin-right: 4px; }
      &.active {
        background: color-mix(in srgb, var(--crm-accent) 14%, transparent) !important;
        color: var(--crm-accent) !important;
        border-color: var(--crm-accent) !important;
      }
    }
    .preset-count {
      min-width: 18px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      background: color-mix(in srgb, currentColor 14%, transparent);
    }
    .preset-chip {
      font-size: 12px; min-height: 30px; padding: 0 10px;
      border-radius: 16px !important;
      max-width: 100%;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
      span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      &.active {
        background: var(--crm-accent) !important;
        color: #fff !important;
        border-color: var(--crm-accent) !important;
      }
    }
    .preset-empty {
      font-size: 12px;
      color: var(--crm-text-muted);
    }

    .state-row {
      display: flex; align-items: center; gap: 12px;
      padding: 24px; color: var(--crm-text-muted);
    }
    .empty-rows {
      padding: 24px; text-align: center; color: var(--crm-text-muted);
    }

    .batch-progress {
      margin-bottom: 8px;
    }

    .copies-ctrl {
      display: flex; align-items: center; gap: 2px;
    }
    .copies-btn {
      width: 28px !important; height: 28px !important; padding: 0 !important;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .copies-num {
      font-size: 13px; font-weight: 500;
      min-width: 22px; text-align: center;
    }

    .remove-btn {
      width: 28px !important; height: 28px !important; padding: 0 !important;
      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); }
      &:hover mat-icon { color: var(--crm-status-error); }
    }

    .summary-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 20px !important;
    }
    .summary-info {
      display: flex; align-items: center; gap: 6px;
      margin-right: auto;
    }
    .summary-detail {
      font-size: 13px; color: var(--crm-text-secondary);
    }
    .summary-sep {
      color: var(--crm-text-muted);
    }
    .summary-total {
      font-size: 14px; font-weight: 600; color: var(--crm-accent);
    }
    .summary-bar button mat-icon,
    .summary-bar button mat-spinner {
      margin-right: 4px;
    }

    .layout-section {
      padding: 8px 0; display: flex; flex-direction: column; gap: 8px;
      border-bottom: 1px solid var(--crm-border);
      margin-bottom: 8px;
    }
    .photo-size-row { display: flex; flex-direction: column; gap: 4px; }
    .size-chips { display: flex; gap: 4px; flex-wrap: wrap; }
    .size-chip {
      font-size: 12px; min-height: 28px; padding: 0 10px;
      border-radius: 14px;
    }
    .size-chip.active {
      background: var(--mat-sys-primary); color: var(--mat-sys-on-primary);
      border-color: var(--mat-sys-primary);
    }
    .size-chip mat-icon { font-size: 14px; width: 14px; height: 14px; margin-right: 2px; }
    .doc-chip.active {
      background: var(--crm-document-accent); color: #fff;
      border-color: var(--crm-document-accent);
    }
    .collage-chip.active {
      background: var(--crm-collage-accent); color: #fff;
      border-color: var(--crm-collage-accent);
    }
    .collage-info-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px; border-radius: 8px;
      background: color-mix(in srgb, var(--crm-collage-accent) 10%, transparent);
      font-size: 12px; color: var(--crm-collage-accent);
    }
    .collage-info-bar mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-collage-accent); }
    .document-info-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px; border-radius: 8px;
      background: color-mix(in srgb, var(--crm-document-accent) 10%, transparent);
      font-size: 12px; color: var(--crm-document-accent);
    }
    .document-info-bar mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-document-accent); }
    .label-config-bar {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; border-radius: 8px;
      background: color-mix(in srgb, var(--crm-accent, #f59e0b) 10%, transparent);
      font-size: 13px; color: var(--crm-accent, #f59e0b);
    }
    .label-config-bar mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .label-qty-field { width: 130px; }
    .label-qty-field .mat-mdc-form-field-infix { padding-top: 6px !important; padding-bottom: 6px !important; }
    .label-sheets-hint { font-weight: 600; white-space: nowrap; }
    .custom-size-row { display: flex; align-items: center; gap: 6px; }
    .size-field { width: 80px; }
    .size-x { font-weight: 600; color: var(--crm-text-muted); }
    .layout-info-row { display: flex; gap: 16px; align-items: flex-start; }
    .layout-stats { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .stat-row { display: flex; align-items: center; gap: 6px; }
    .stat-row mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); }
    .paper-select { width: 120px; margin-top: 4px; }
    .section-label {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--crm-text-muted);
    }
    .dual-printer-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-radius: 8px;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent);
      font-size: 13px; margin-bottom: 8px;
    }
    .dual-printer-bar mat-icon { color: var(--mat-sys-primary); }
      .dual-info { font-size: 11px; color: var(--crm-text-muted); margin-left: auto; }

      .dialog-title {
        justify-content: space-between;
        min-height: 52px;
        padding: 14px 18px 10px !important;
      }
      .title-main,
      .title-summary {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .title-main {
        gap: 8px;
        color: var(--crm-text);
      }
      .title-summary {
        gap: 6px;
        font: 600 13px/1.2 system-ui, sans-serif;
        color: var(--crm-text-muted);
      }

      .batch-dialog-content {
        height: calc(100vh - 148px);
        max-height: calc(100vh - 148px) !important;
        min-height: 0;
        overflow: hidden !important;
        padding: 0 14px 12px !important;
      }
      .batch-progress {
        margin: 0 0 10px;
      }
      .batch-print-workspace {
        display: grid;
        grid-template-columns: minmax(230px, 16vw) minmax(520px, 1fr) minmax(340px, 22vw);
        gap: 12px;
        height: 100%;
        min-height: 0;
      }
      :host.inline-print-host {
        display: block;
        min-width: 0;
      }
      :host.inline-print-host .dialog-title {
        margin: 0;
        border-bottom: 1px solid var(--crm-border);
        background: var(--crm-surface);
      }
      :host.inline-print-host .batch-dialog-content {
        height: min(860px, calc(100vh - 260px));
        max-height: none !important;
        min-height: 620px;
      }
      :host.inline-print-host .summary-bar {
        position: sticky;
        bottom: 0;
        z-index: 4;
        margin: 0;
        border-top: 1px solid var(--crm-border);
        background: var(--crm-surface);
      }
      .files-panel,
      .batch-preview-panel,
      .settings-panel {
        min-width: 0;
        min-height: 0;
        border: 1px solid var(--crm-border);
        border-radius: 8px;
        background: color-mix(in srgb, var(--crm-surface-raised) 72%, transparent);
      }
      .files-panel,
      .settings-panel {
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .settings-panel {
        overflow: auto;
      }
      .panel-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 12px;
        border-bottom: 1px solid var(--crm-border);
        color: var(--crm-text-muted);
        font-size: 12px;
      }
      .panel-heading div {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .panel-heading strong {
        color: var(--crm-text);
        font-size: 18px;
        line-height: 1;
      }
      .section-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
        color: var(--crm-text-muted);
      }

      .file-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
        overflow: auto;
        padding: 10px;
      }
      .file-card {
        width: 100%;
        min-height: 70px;
        display: grid;
        grid-template-columns: 24px 52px minmax(0, 1fr) 20px 28px;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--crm-text);
        cursor: pointer;
        text-align: left;
      }
      .file-card:hover {
        background: var(--crm-surface-hover);
      }
      .file-card.file-selected {
        border-color: color-mix(in srgb, var(--crm-accent) 58%, transparent);
        background: color-mix(in srgb, var(--crm-accent) 12%, transparent);
      }
      .file-card.row-completed {
        box-shadow: inset 3px 0 0 var(--crm-status-success);
      }
      .file-card.row-failed {
        box-shadow: inset 3px 0 0 var(--crm-status-error);
      }
      .file-index {
        color: var(--crm-text-muted);
        font-size: 12px;
        text-align: center;
      }
      .file-thumb {
        width: 52px;
        height: 52px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 6px;
        background: #f1f5f9;
      }
      .file-thumb mat-icon {
        width: 30px;
        height: 30px;
        font-size: 30px;
        color: var(--crm-text-muted);
      }
      .file-thumb mat-icon.image-file { color: var(--crm-accent); }
      .file-thumb mat-icon.pdf { color: #e53935; }
      .file-thumb mat-icon.word { color: #1976d2; }
      .file-thumb mat-icon.excel { color: #388e3c; }
      .file-thumb mat-icon.presentation { color: #e64a19; }
      .file-thumb mat-icon.csv { color: #558b2f; }
      .file-thumb mat-icon.text { color: #757575; }
      .file-thumb mat-icon.archive { color: #795548; }
      .file-info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .file-name {
        overflow: hidden;
        color: var(--crm-text);
        font-size: 13px;
        font-weight: 600;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file-meta {
        overflow: hidden;
        color: var(--crm-text-muted);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-state {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
      .row-state.done {
        color: var(--crm-status-success);
      }
      .row-state.failed {
        color: var(--crm-status-error);
      }

      .batch-preview-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow: hidden;
        padding: 12px;
      }
      .preview-header {
        align-items: center;
        min-height: 34px;
      }
      .preview-title {
        font-size: 15px;
      }
      .preview-stage {
        flex: 1 1 auto;
        min-height: 0;
        padding: 18px;
        border-radius: 8px;
      }
      .preview-rotation-frame {
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        min-height: 0;
        align-items: center;
      }
      .batch-crop-preview {
        width: 100% !important;
        height: 100%;
        max-width: 100% !important;
        max-height: 100%;
        min-height: 0;
      }
      :host ::ng-deep .batch-crop-preview .crop-container {
        border-color: rgba(245, 158, 11, 0.7);
      }
      :host ::ng-deep .batch-crop-preview .crop-footer {
        color: var(--crm-text-muted);
      }
      .preview-tools {
        min-height: 40px;
        padding-top: 2px;
      }
      .preview-fit-toggle {
        ::ng-deep .mat-button-toggle {
          width: 44px;
          height: 36px;
          .mat-button-toggle-button { padding: 0; }
          mat-icon { font-size: 18px; width: 18px; height: 18px; }
        }
      }
      .preview-details {
        min-height: 24px;
      }

      .settings-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        border-bottom: 1px solid var(--crm-border);
      }
      .settings-view-switch {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border-bottom: 1px solid var(--crm-border);
        background: color-mix(in srgb, var(--crm-surface-raised) 92%, transparent);
      }
      .settings-print-btn {
        width: 100%;
        min-height: 40px;
        border-radius: 8px !important;
        font-weight: 700;
      }
      .settings-print-btn mat-icon,
      .settings-print-btn mat-spinner {
        margin-right: 6px;
      }
      .settings-view-switch mat-button-toggle-group {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        overflow: hidden;
        border-radius: 8px;
      }
      .settings-view-switch mat-button-toggle {
        min-width: 0;
      }
      :host ::ng-deep .settings-view-switch .mat-button-toggle-button {
        width: 100%;
        min-height: 36px;
        padding: 0 8px;
      }
      :host ::ng-deep .settings-view-switch .mat-button-toggle-label-content {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        width: 100%;
        min-width: 0;
        padding: 0;
        font-size: 12px;
        line-height: 1;
      }
      .settings-view-switch mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
      .settings-section:last-child {
        border-bottom: 0;
      }
      .section-heading {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--crm-text);
        font-size: 13px;
        font-weight: 700;
      }
      .section-heading mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
        color: var(--crm-accent);
      }
      .settings-note {
        margin: 0;
        color: var(--crm-text-secondary);
        font-size: 13px;
        line-height: 1.35;
      }
      .full-field,
      .settings-grid mat-form-field {
        width: 100%;
      }
      .settings-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
      }
      .settings-grid.single-column {
        grid-template-columns: minmax(0, 1fr);
      }
      .coverage-row {
        max-width: 100%;
        align-self: flex-start;
      }
      :host ::ng-deep app-coverage-badge.coverage-row .coverage-badge {
        max-width: 100%;
        white-space: normal;
        line-height: 1.25;
      }
      :host ::ng-deep .page-range-error {
        color: var(--crm-danger);
      }
      .coverage-progress,
      .coverage-tier-note,
      .page-count-status {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        line-height: 1.3;
        color: var(--crm-text-secondary);
        padding: 6px 9px;
        border-radius: var(--crm-radius-sm, 8px);
        background: color-mix(in srgb, var(--crm-accent, #ffab00) 6%, transparent);
      }
      .coverage-progress mat-spinner,
      .page-count-status mat-spinner {
        flex-shrink: 0;
      }
      .coverage-tier-note mat-icon,
      .page-count-status mat-icon {
        font-size: 17px;
        width: 17px;
        height: 17px;
        flex-shrink: 0;
        color: var(--crm-text-muted);
      }
      .page-count-status--error {
        background: color-mix(in srgb, var(--crm-danger, #ff5252) 9%, transparent);
        color: var(--crm-danger);
      }
      .page-count-status--error mat-icon {
        color: var(--crm-danger);
      }
      .price-pending {
        color: var(--crm-text-muted);
      }
      .doc-font-summary {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        min-height: 30px;
        padding: 7px 9px;
        border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
        border-radius: var(--crm-radius-sm, 8px);
        background: color-mix(in srgb, var(--crm-accent, #ffab00) 7%, transparent);
        color: var(--crm-text-secondary);
        font-size: 12px;
        line-height: 1.25;
      }
      .doc-font-summary mat-icon {
        font-size: 17px;
        width: 17px;
        height: 17px;
        color: var(--crm-text-muted);
        flex-shrink: 0;
      }
      .doc-font-summary span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .settings-panel mat-form-field {
        margin-bottom: -8px;
      }
      .copies-row {
        display: grid;
        grid-template-columns: minmax(70px, 1fr) auto auto;
        align-items: center;
        gap: 10px;
        color: var(--crm-text-secondary);
        font-size: 13px;
      }
      .copies-row strong {
        color: var(--crm-accent);
      }
      .copies-ctrl {
        justify-content: center;
        gap: 4px;
      }
      .copies-btn,
      .remove-btn {
        width: 30px !important;
        height: 30px !important;
        padding: 0 !important;
      }
      .copies-btn mat-icon,
      .remove-btn mat-icon {
        width: 17px;
        height: 17px;
        font-size: 17px;
      }
      .copies-num {
        min-width: 28px;
        color: var(--crm-text);
        font-size: 14px;
        font-weight: 700;
        text-align: center;
      }
      .option-grid {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .apply-all-btn {
        min-height: 34px;
        border-radius: 8px !important;
      }
      .apply-all-btn mat-icon {
        width: 17px;
        height: 17px;
        font-size: 17px;
        margin-right: 4px;
      }
      .apply-all-btn {
        justify-content: center;
      }
      .color-mode-switch {
        display: inline-flex;
        border: 1px solid var(--crm-border);
        border-radius: 8px;
        overflow: hidden;
      }
      .color-mode-btn {
        min-height: 34px;
        border-radius: 0 !important;
        color: var(--crm-text-secondary);
        background: transparent;
      }
      .color-mode-btn.active {
        background: var(--crm-accent);
        color: #fff;
      }
      .color-mode-btn mat-icon {
        width: 17px;
        height: 17px;
        font-size: 17px;
        margin-right: 4px;
      }
      .photo-adjustments {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
        border: 1px solid var(--crm-border);
        border-radius: 8px;
        background: color-mix(in srgb, var(--crm-surface) 72%, transparent);
      }
      .photo-adjustment-header,
      .photo-actions-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .slider-row {
        display: grid;
        grid-template-columns: minmax(86px, 1fr) minmax(120px, 1.4fr) 36px;
        align-items: center;
        gap: 8px;
        color: var(--crm-text-secondary);
        font-size: 12px;
      }
      .slider-row input[type="range"] {
        width: 100%;
        accent-color: var(--crm-accent);
      }
      .slider-row strong {
        color: var(--crm-text);
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .small-action-btn {
        min-height: 32px;
        border-radius: 8px !important;
      }
      .small-action-btn mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
        margin-right: 4px;
      }

      .queue-monitor-section {
        gap: 9px;
        background: color-mix(in srgb, var(--crm-surface) 86%, transparent);
      }
      .queue-monitor-heading {
        justify-content: space-between;
      }
      .queue-monitor-title,
      .queue-monitor-actions,
      .queue-printer-main,
      .queue-printer-meta {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .queue-monitor-title {
        gap: 8px;
      }
      .queue-monitor-actions {
        gap: 2px;
      }
      .queue-monitor-actions a,
      .queue-monitor-actions button {
        width: 30px !important;
        height: 30px !important;
        padding: 0 !important;
      }
      .queue-monitor-actions mat-icon,
      .queue-monitor-actions mat-spinner {
        width: 17px;
        height: 17px;
        font-size: 17px;
      }
      .queue-printer-card {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 9px 10px;
        border: 1px solid var(--crm-border);
        border-radius: 8px;
        background: var(--crm-surface-overlay);
      }
      .queue-printer-card.offline {
        border-color: color-mix(in srgb, var(--crm-status-error) 38%, var(--crm-border));
      }
      .queue-printer-card.paused {
        border-color: color-mix(in srgb, var(--crm-accent) 55%, var(--crm-border));
      }
      .queue-printer-main {
        gap: 8px;
      }
      .queue-printer-name {
        min-width: 0;
        overflow: hidden;
        color: var(--crm-text);
        font-size: 13px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .queue-printer-meta {
        justify-content: space-between;
        gap: 8px;
        color: var(--crm-text-muted);
        font-size: 12px;
      }
      .queue-status-dot {
        width: 9px;
        height: 9px;
        flex: 0 0 9px;
        border-radius: 50%;
        background: var(--crm-status-error);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--crm-status-error) 14%, transparent);
      }
      .queue-status-dot.online {
        background: var(--crm-status-success);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--crm-status-success) 14%, transparent);
      }
      .queue-printer-badge {
        padding: 2px 6px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--crm-accent) 12%, transparent);
        color: var(--crm-accent);
        font-size: 11px;
        font-weight: 700;
      }
      .queue-stat-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }
      .queue-stat {
        min-height: 50px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        padding: 8px;
        border: 1px solid var(--crm-border);
        border-radius: 8px;
        background: color-mix(in srgb, var(--crm-surface-overlay) 84%, transparent);
      }
      .queue-stat strong {
        color: var(--crm-text);
        font-size: 18px;
        line-height: 1;
      }
      .queue-stat span {
        color: var(--crm-text-muted);
        font-size: 11px;
      }
      .queue-stat.problem strong {
        color: var(--crm-status-error);
      }
      .queue-monitor-state {
        min-height: 46px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 10px;
        border: 1px dashed var(--crm-border);
        border-radius: 8px;
        color: var(--crm-text-secondary);
        font-size: 12px;
      }
      .queue-monitor-state mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
        color: var(--crm-text-muted);
      }
      .queue-monitor-state.error {
        border-color: color-mix(in srgb, var(--crm-status-error) 45%, var(--crm-border));
        color: var(--crm-status-error);
      }
      .queue-monitor-state.empty mat-icon {
        color: var(--crm-status-success);
      }
      .queue-job-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .queue-job-row {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) auto;
        align-items: center;
        gap: 7px;
        min-height: 44px;
        padding: 7px 8px;
        border: 1px solid var(--crm-border);
        border-radius: 8px;
        background: var(--crm-surface-overlay);
      }
      .queue-job-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
        color: var(--crm-text-muted);
      }
      .queue-job-info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .queue-job-name,
      .queue-job-meta {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .queue-job-name {
        color: var(--crm-text);
        font-size: 12px;
        font-weight: 700;
      }
      .queue-job-meta {
        color: var(--crm-text-muted);
        font-size: 11px;
      }
      .queue-status-chip {
        max-width: 98px;
        overflow: hidden;
        padding: 3px 7px;
        border-radius: 999px;
        background: var(--crm-surface-active);
        color: var(--crm-text-secondary);
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .queue-status-chip.status-queued,
      .queue-status-chip.status-scheduled,
      .queue-status-chip.status-held,
      .queue-status-chip.status-paused {
        background: color-mix(in srgb, var(--crm-accent) 12%, transparent);
        color: var(--crm-accent);
      }
      .queue-status-chip.status-sending,
      .queue-status-chip.status-processing,
      .queue-status-chip.status-printing,
      .queue-status-chip.status-converting,
      .queue-status-chip.status-splitting,
      .queue-status-chip.status-finishing {
        background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
        color: var(--mat-sys-primary);
      }
      .queue-status-chip.status-failed {
        background: color-mix(in srgb, var(--crm-status-error) 12%, transparent);
        color: var(--crm-status-error);
      }
      .queue-more-link {
        align-self: flex-start;
        min-height: 28px;
        padding: 0 6px !important;
        color: var(--crm-text-secondary);
        font-size: 12px;
      }
      .queue-refresh-time {
        color: var(--crm-text-muted);
        font-size: 11px;
        text-align: right;
      }

      .preset-category-row,
      .preset-actions-row,
      .presets-bar {
        margin: 0;
      }
      .preset-actions-row {
        max-height: 154px;
        overflow: auto;
      }
      .preset-chip,
      .preset-category,
      .size-chip {
        min-height: 30px;
        border-radius: 8px !important;
        font-size: 12px;
      }
      .preset-chip mat-icon,
      .preset-category mat-icon,
      .size-chip mat-icon {
        width: 15px;
        height: 15px;
        font-size: 15px;
      }
      .layout-section {
        margin: 0;
        padding: 12px;
      }
      .photo-size-row {
        gap: 6px;
      }
      .size-chips {
        gap: 6px;
      }
      .custom-size-row {
        gap: 8px;
      }
      .mode-info-bar,
      .label-config-bar,
      .dual-printer-bar {
        border-radius: 8px;
      }
      .label-config-bar {
        align-items: center;
        flex-wrap: wrap;
      }
      .layout-info-row {
        display: grid;
        grid-template-columns: 108px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
      }
      .layout-stats {
        min-width: 0;
      }
      .paper-select {
        width: 100%;
      }
      .dual-printer-bar {
        margin: 0;
        flex-wrap: wrap;
      }
      .dual-info {
        margin-left: 0;
      }

      @media (max-width: 1200px) {
        .layout-edit-stage {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(220px, 1fr) minmax(180px, 0.72fr);
        }
      }

      @media (max-width: 1360px) {
        .batch-print-workspace {
          grid-template-columns: minmax(210px, 0.7fr) minmax(440px, 1.4fr) minmax(320px, 0.9fr);
        }
      }

      @media (max-width: 1100px) {
        .batch-dialog-content {
          height: auto;
          max-height: calc(100vh - 148px) !important;
          overflow: auto !important;
        }
        .batch-print-workspace {
          grid-template-columns: 1fr;
          height: auto;
        }
        .files-panel,
        .batch-preview-panel,
        .settings-panel {
          min-height: 360px;
        }
        .file-list {
          max-height: 320px;
        }
        .settings-panel {
          overflow: visible;
        }
        .layout-edit-stage {
          min-height: 520px;
        }
      }
    `],
})
export class BatchPrintDialogComponent implements OnInit, OnDestroy {
  private readonly printApi = inject(PrintApiService);
  private readonly pricingApi = inject(PricingApiService);
  private readonly coverageService = inject(CoverageAnalysisService);
  private readonly toast = inject(ToastService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly dialogRef = inject(MatDialogRef<BatchPrintDialogComponent, BatchPrintDialogResult>, { optional: true });
  private readonly dialogData = inject<BatchPrintDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  readonly inlineData = input<BatchPrintDialogData | null>(null);
  readonly inlineResult = output<BatchPrintDialogResult>();
  readonly data = computed<BatchPrintDialogData>(() => this.inlineData() ?? this.dialogData ?? EMPTY_BATCH_PRINT_DATA);
  readonly inlineMode = computed(() => this.dialogRef === null);
  private readonly dataVersion = computed(() => {
    const data = this.data();
    return JSON.stringify({
      sessionId: data.sessionId,
      action: data.action ?? 'cart',
      orderType: data.orderType ?? 'chat',
      files: data.files.map(file => ({
        msgId: file.msgId,
        url: file.url,
        name: file.name,
        type: file.type,
      })),
      photoOrderHint: data.photoOrderHint ? {
        widthMm: data.photoOrderHint.widthMm,
        heightMm: data.photoOrderHint.heightMm,
        whiteBorder: data.photoOrderHint.whiteBorder,
      } : null,
    });
  });
  private lastRowsDataVersion = '';
  private lastPhotoOrderHintDataVersion = '';
  readonly getFileIcon = getFileIcon;
  readonly getFileCategory = getFileCategory;
  readonly previewImageUrls = signal<PreviewImageState>({});
  readonly previewImageLoading = signal<PreviewLoadingState>({});
  readonly previewImageErrors = signal<PreviewErrorState>({});
  private readonly imageObjectUrls = new Map<string, string>();
  private readonly imagePreloadQueue: BatchPrintRow[] = [];
  private readonly imagePreloadInFlight = new Set<string>();
  private readonly previewCacheOrder: string[] = [];
  private readonly maxPreviewCacheEntries = 8;
  private readonly maxPreviewPreloads = 2;
  private activeImagePreloads = 0;
  private destroyed = false;

  readonly printers = signal<Printer[]>([]);
  readonly printersLoaded = signal(false);
  readonly rows = signal<BatchPrintRow[]>([]);
  readonly selectedRowIndex = signal(0);
  readonly printing = signal(false);

  readonly apiPresets = signal<PrintPresetRecord[]>([]);
  readonly activePresetId = signal<string | null>(null);
  readonly selectedPresetCategoryId = signal<PresetCategoryId | null>(null);
  readonly settingsView = signal<SettingsView>('print');

  // Photo size — grouped
  readonly photoPresets = PHOTO_PRESETS;
  readonly documentPresets = DOCUMENT_PRESETS;
  readonly collagePresets = COLLAGE_PRESETS;
  readonly labelPresets = LABEL_PRESETS;
  readonly selectedPhotoSize = signal<PhotoSizePreset>(PHOTO_SIZE_PRESETS[0]);
  readonly docFontSizeDeltaOptions = [0, -1, -2, -3, -4, -5, -6, -7, -8];
  readonly customPhotoW = signal(100);
  readonly customPhotoH = signal(100);
  readonly cutMargin = signal(2);
  readonly cutMarksEnabled = signal(true);
  readonly selectedPaperForLayout = signal('A4');
  readonly selectedPhotoDimensions = computed(() => {
    const preset = this.selectedPhotoSize();
    return {
      width: preset.id === 'custom' ? this.customPhotoW() : preset.width_mm,
      height: preset.id === 'custom' ? this.customPhotoH() : preset.height_mm,
    };
  });
  readonly customPhotoWCm = computed(() => this.formatCustomCm(this.customPhotoW()));
  readonly customPhotoHCm = computed(() => this.formatCustomCm(this.customPhotoH()));

  readonly isDocumentMode = computed(() => this.selectedPhotoSize().group === 'document');
  readonly isCollageMode = computed(() => this.selectedPhotoSize().group === 'collage');
  readonly isLabelMode = computed(() => this.selectedPhotoSize().group === 'label');
  readonly labelQuantity = signal(100);
  readonly labelSheetsNeeded = computed(() => {
    const layout = this.layoutResult();
    if (!layout || !this.isLabelMode()) return 0;
    return Math.max(1, Math.ceil(this.normalizedLabelQuantity() / Math.max(1, layout.photosPerSheet)));
  });
  readonly activeTemplateMode = computed((): TemplateMode =>
    this.isDocumentMode() ? 'passport'
      : this.isCollageMode() ? 'collage'
      : this.isLabelMode() ? (this.selectedPhotoSize().templateMode ?? 'label')
      : (this.selectedPhotoSize().templateMode ?? 'none'),
  );

  readonly layoutResult = computed((): LayoutCalcResult | null => {
    const preset = this.selectedPhotoSize();
    if (preset.id === 'full') return null;

    const pw = preset.id === 'custom' ? this.customPhotoW() : preset.width_mm;
    const ph = preset.id === 'custom' ? this.customPhotoH() : preset.height_mm;

    const totalPhotos = this.totalLayoutPhotos();

    // Document presets always use 10x15 paper and 1mm cut margin
    if (preset.group === 'document') {
      const documentLayout = calculateDocumentSet(preset.id);
      if (!documentLayout) return null;
      return {
        ...documentLayout,
        sheetsNeeded: Math.ceil(totalPhotos / documentLayout.photosPerSheet),
      };
    }

    // Label/business card presets always use A4 paper.
    if (preset.group === 'label') {
      if (isBusinessCardPresetId(preset.id)) {
        return calculateBusinessCardLayout(preset.id, totalPhotos);
      }
      return calculateLayout(
        pw, ph, 210, 297, this.cutMargin(), totalPhotos,
        preset.templateMode, preset.bottomPaddingMm, preset.id,
      );
    }

    const paper = this.getSelectedPaper();
    if (!paper) return null;
    if (!this.photoSizeFitsPaper(pw, ph, paper)) return null;

    return calculateLayout(
      pw, ph, paper.width_mm, paper.height_mm,
      this.cutMargin(), totalPhotos,
      preset.templateMode, preset.bottomPaddingMm,
      preset.id,
    );
  });

  readonly sheetLayoutActive = computed(() => {
    const layout = this.layoutResult();
    const row = this.rows()[this.selectedRowIndex()] ?? null;
    return !!layout
      && !!row
      && this.layoutSettingsAvailable(row)
      && this.shouldUseLayoutSheetForActiveSize(layout);
  });

  // Dual printer
  readonly statuses = signal<BridgePrinterStatus[]>([]);
  readonly printerGroups = computed(() => detectPrinterGroups(this.printers(), this.statuses()));
  readonly splitEnabled = signal(false);
  readonly queueMonitorJobs = signal<PrintJob[]>([]);
  readonly queueMonitorTotal = signal(0);
  readonly queueMonitorLoading = signal(false);
  readonly queueMonitorError = signal('');
  readonly queueMonitorRefreshedAt = signal<Date | null>(null);
  private readonly queueMonitorRequest$ = new Subject<string>();
  private queueMonitorInterval?: ReturnType<typeof setInterval>;

  printerNames(printers: Printer[]): string {
    return printers.map(p => p.name).join(' + ');
  }
  readonly urgentPrint = signal(false);
  readonly dualProgress = signal<{ a: { done: number; total: number }; b: { done: number; total: number } } | null>(null);

  readonly printResults = signal<PrintResultState>({});

  readonly completedCount = computed(() => {
    const results = this.printResults();
    return Object.values(results).filter(r => r?.status === 'completed' || r?.status === 'failed').length;
  });

  readonly batchProgress = computed(() => {
    const total = this.rows().length;
    if (!total) return null;
    const done = this.completedCount();
    if (!done) return null;
    return Math.round((done / total) * 100);
  });

  readonly presets = computed<PrintPreset[]>(() => {
    return this.apiPresets()
      .filter(p => p.is_active)
      .map(p => ({
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
        price: p.price,
      }));
  });
  readonly quickPresets = computed(() => {
    const presets = this.presets()
      .filter(preset => this.quickPresetHasMatchingPrinter(preset))
      .sort((a, b) => this.presetDedupePriority(b) - this.presetDedupePriority(a));
    return this.dedupePresets(presets);
  });
  readonly presetCategories = computed((): PresetCategory[] => {
    const groups = new Map<PresetCategoryId, PrintPreset[]>();
    for (const preset of this.quickPresets()) {
      const categoryId = this.presetCategoryId(preset);
      const existing = groups.get(categoryId);
      if (existing) {
        existing.push(preset);
      } else {
        groups.set(categoryId, [preset]);
      }
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => this.presetCategoryOrder(left) - this.presetCategoryOrder(right))
      .map(([id, categoryPresets]) => ({
        ...PRESET_CATEGORY_DEFINITIONS[id],
        presets: categoryPresets.sort((a, b) => this.presetSortLabel(a).localeCompare(this.presetSortLabel(b), 'ru')),
      }));
  });
  readonly activePresetCategoryId = computed((): PresetCategoryId | null => {
    const categories = this.presetCategories();
    if (!categories.length) return null;

    const selected = this.selectedPresetCategoryId();
    if (selected && categories.some(category => category.id === selected)) return selected;

    const row = this.selectedRow();
    const printer = row ? this.getPrinterForRow(row) : undefined;
    const inferred = this.inferPresetCategoryForPrinter(printer, row);
    if (inferred && categories.some(category => category.id === inferred)) return inferred;

    return categories[0]?.id ?? null;
  });
  readonly activePresetCategory = computed(() =>
    this.presetCategories().find(category => category.id === this.activePresetCategoryId()) ?? null,
  );

  readonly totalFiles = computed(() => this.rows().length);
  readonly totalCopies = computed(() => this.rows().reduce((s, r) => s + r.copies, 0));
  readonly totalLayoutPhotos = computed(() => {
    const imageRows = this.rows().filter(row => row.file.type === 'image');
    if (this.isLabelMode()) {
      const labelQuantity = this.normalizedLabelQuantity();
      return imageRows.reduce((sum, row) => sum + labelQuantity * Math.max(1, row.copies), 0);
    }
    if (this.isDocumentMode()) {
      const documentLayout = calculateDocumentSet(this.selectedPhotoSize().id);
      const perSheet = Math.max(1, documentLayout?.photosPerSheet ?? 1);
      return imageRows.reduce((sum, row) => sum + Math.max(1, row.copies) * perSheet, 0);
    }
    return imageRows.reduce((sum, row) => sum + Math.max(1, row.copies), 0);
  });
  readonly layoutItemUnitLabel = computed(() => this.isLabelMode() ? 'шт' : 'фото');
  readonly totalBillableLabel = computed(() => {
    const total = this.totalCopies();
    const layout = this.layoutResult();
    if (layout && this.shouldUseLayoutBatch(this.rows()) && this.isLabelMode()) {
      const quantity = this.totalLayoutPhotos();
      const sheets = this.layoutSheetsForGroup(this.rows(), layout);
      return `${quantity} шт · ${sheets} ${this.sheetWord(sheets)}`;
    }
    return `${total} ${this.copyWord(total)}`;
  });
  readonly customCuttingService = computed(() => this.findCuttingServiceOption());
  readonly customCuttingQuantity = computed(() => this.customCuttingQuantityForRows(this.rows()));
  readonly customCuttingUnitPrice = computed(() => {
    const service = this.customCuttingService();
    return service ? this.pricingApi.resolveOptionPrice(service, 'pickup') : 0;
  });
  readonly customCuttingTotal = computed(() => this.customCuttingQuantity() * this.customCuttingUnitPrice());
  readonly customCuttingPriceIssue = computed(() => {
    if (this.customCuttingQuantity() <= 0) return '';
    if (this.pricingApi.loading()) return 'Загружаем цену резки из API';
    if (!this.customCuttingService()) return 'Нет услуги резки в каталоге цен';
    if (this.customCuttingUnitPrice() <= 0) return 'Нет цены из API: резка нестандартного размера';
    return '';
  });
  readonly layoutPreviewUrl = signal<string | null>(null);
  readonly layoutPreviewLoading = signal(false);
  readonly layoutPreviewError = signal<string | null>(null);
  readonly documentPreviewUrl = signal<string | null>(null);
  readonly documentPreviewLoading = signal(false);
  readonly documentPreviewError = signal<string | null>(null);
  private readonly layoutPreviewRequest$ = new Subject<void>();
  private readonly documentPreviewRequest$ = new Subject<void>();
  // Последний «контентный» ключ документного превью — чтобы не перезапрашивать
  // (и не перекачивать) превью при смене настроек, не влияющих на растр страниц.
  private lastDocumentPreviewKey = '';
  private readonly layoutPreviewObjectUrls = new Set<string>();
  private readonly documentPreviewObjectUrls = new Set<string>();
  private readonly documentPreviewCache = new Map<string, string>();
  private readonly documentPreviewCacheOrder: string[] = [];
  private readonly maxDocumentPreviewCacheEntries = 12;
  private documentPreviewRequestSeq = 0;
  // Дедуп быстрого подсчёта страниц: per-msgId ключ последнего запроса (fileUrl + fontDelta).
  // Закрывает «шторм» параллельных запросов при смене настроек.
  private readonly pageCountRequestKey = new Map<string, string>();
  // Per-msgId дедуп фоновой coverage-задачи: cache-key последнего старта + Subject отмены polling.
  private readonly coverageJobKey = new Map<string, string>();
  private readonly coverageJobCancel = new Map<string, Subject<void>>();
  readonly totalAmount = computed(() => {
    const rows = this.rows();
    const layout = this.layoutResult();
    if (layout && this.shouldUseLayoutBatch(rows)) {
      return this.layoutBatchTotalForRows(rows, layout) + this.customCuttingTotal();
    }
    return rows.reduce((s, r) => s + this.rowTotal(r), 0) + this.customCuttingTotal();
  });
  /** Есть документная строка без определённого числа страниц (цена ещё/уже не известна). */
  readonly hasUnbillableDocRow = computed(() =>
    this.rows().some(row => row.file.type !== 'image' && this.selectedDocumentPageCount(row) <= 0),
  );
  /** Сумма для шапки/кнопки: «—», пока есть неоплатобельная документная строка (не врём цифрой). */
  readonly totalAmountLabel = computed(() => this.hasUnbillableDocRow() ? '—' : `${this.totalAmount()}`);
  readonly missingPrices = computed(() => this.rows().some(row => row.price <= 0));
  readonly coveragePending = computed(() => this.rows().some(r => r.coverage_loading));
  readonly directPrintMode = computed(() => this.data().action === 'print');
  readonly printActionIcon = computed(() => this.directPrintMode() ? 'print' : 'shopping_cart');
  readonly printActionLabel = computed(() => {
    if (this.coveragePending()) return 'Анализ заливки...';
    if (this.printing()) return this.directPrintMode() ? 'Отправка...' : 'Добавление...';
    if (!this.directPrintMode()) {
      if (this.customCuttingPriceIssue()) return 'Нет цены резки';
      if (this.missingPrices()) return 'Нет цены';
      if (this.hasUnbillableDocRow()) return 'Уточняется число страниц';
      return `В корзину · ${this.totalAmount()} ₽`;
    }
    return 'Печать';
  });
  readonly printDisabledReason = computed(() => {
    if (!this.rows().length) return 'Нет файлов для печати';
    if (this.printing()) return 'Подготовка задания...';
    const businessIssue = this.businessCardRequirementIssue();
    if (businessIssue) return businessIssue;
    if (this.coveragePending()) return 'Идёт анализ заливки для лазерной печати';
    if (!this.directPrintMode()) {
      const cuttingIssue = this.customCuttingPriceIssue();
      if (cuttingIssue) return cuttingIssue;
    }
    const pageRangeIssue = this.rows()
      .map(row => this.rowPageRangeIssue(row))
      .find(issue => !!issue);
    if (pageRangeIssue) return pageRangeIssue;
    // Денежный гейт: документная строка без определённого числа страниц (count в полёте/провал
    // и нет валидного ручного диапазона) → НЕ финализировать заказ на 0 ₽.
    const unbillableDoc = this.rows().find(row =>
      row.file.type !== 'image' && this.selectedDocumentPageCount(row) <= 0,
    );
    if (unbillableDoc) {
      return unbillableDoc.page_count_loading
        ? 'Идёт подсчёт страниц…'
        : 'Не удалось определить число страниц — укажите диапазон';
    }
    const unsupportedPaper = this.rows().find(row => !this.getPaperForRow(row));
    if (unsupportedPaper) {
      const printer = this.getPrinterForRow(unsupportedPaper)?.name ?? 'принтер';
      return `Формат ${unsupportedPaper.paper_size} не поддерживается: ${printer}`;
    }
    const missingQuality = this.rows().find(row => !row.quality);
    if (missingQuality) {
      const printer = this.getPrinterForRow(missingQuality)?.name ?? 'принтер';
      return `Нет режима качества из API: ${printer}`;
    }
    if (!this.directPrintMode()) {
      const missing = this.rows().find(row => row.price <= 0);
      if (missing) {
        const paper = this.getPaperLabelForRow(missing);
        const printer = this.getPrinterForRow(missing)?.name ?? 'принтер';
        return `Нет цены из API: ${paper}, ${printer}`;
      }
    }
    return '';
  });
  readonly printActionDisabled = computed(() => this.printDisabledReason() !== '');
  readonly canSelectPrevious = computed(() => this.selectedRowIndex() > 0);
  readonly canSelectNext = computed(() => this.selectedRowIndex() < this.totalFiles() - 1);
  readonly selectedRow = computed(() => {
    const rows = this.rows();
    return rows[this.selectedRowIndex()] ?? rows[0] ?? null;
  });
  readonly selectedQueuePrinter = computed(() => {
    const row = this.selectedRow();
    if (!row?.printer_id) return null;
    return this.printers().find(printer => printer.id === row.printer_id) ?? null;
  });
  readonly selectedQueuePrinterStatus = computed(() => {
    const printer = this.selectedQueuePrinter();
    if (!printer) return null;
    const candidates = new Set([printer.cups_printer_name, printer.name].filter(Boolean));
    return this.statuses().find(status => candidates.has(status.printer_name)) ?? null;
  });
  readonly queueMonitorCounts = computed(() => {
    const jobs = this.queueMonitorJobs();
    const total = this.queueMonitorTotal() || jobs.length;
    return {
      total,
      waiting: jobs.filter(job => QUEUE_MONITOR_WAITING_STATUSES.has(job.status)).length,
      processing: jobs.filter(job => QUEUE_MONITOR_PROCESSING_STATUSES.has(job.status)).length,
      problems: jobs.filter(job => job.status === 'failed').length,
    };
  });
  readonly queueMonitorVisibleJobs = computed(() => this.queueMonitorJobs().slice(0, 5));
  readonly queueMonitorHiddenCount = computed(() =>
    Math.max(0, this.queueMonitorCounts().total - this.queueMonitorVisibleJobs().length),
  );

  readonly settingsViewGuardEffect = effect(() => {
    const row = this.selectedRow();
    const view = this.settingsView();
    if (view !== 'layout' || (row && this.layoutSettingsAvailable(row))) return;

    queueMicrotask(() => {
      if (this.destroyed) return;
      this.ensureSettingsViewAvailable();
    });
  });

  readonly queueMonitorSelectionEffect = effect(() => {
    const directPrintMode = this.directPrintMode();
    const printerId = this.selectedRow()?.printer_id ?? '';
    if (!directPrintMode) return;

    queueMicrotask(() => {
      if (this.destroyed) return;
      if (printerId) {
        this.queueMonitorRequest$.next(printerId);
      } else {
        this.resetQueueMonitor();
      }
    });
  });

  readonly layoutPreviewRefreshEffect = effect(() => {
    this.sheetLayoutActive();
    this.layoutResult();
    this.selectedRowIndex();
    this.selectedPhotoSize();
    this.customPhotoW();
    this.customPhotoH();
    this.cutMargin();
    this.cutMarksEnabled();
    this.selectedPaperForLayout();
    this.rows().map(row => ({
      id: row.file.msgId,
      url: row.file.url,
      type: row.file.type,
      copies: row.copies,
      printerId: row.printer_id,
      mediaType: row.media_type,
      paperSource: row.paper_source,
      quality: row.quality,
      colorMode: row.color_mode,
      borderless: row.borderless,
      fitMode: row.fit_mode,
      rotation: row.rotation,
      crop: row.crop_rect,
      photoEnhance: this.photoEnhanceAvailable(row) && row.photo_enhance,
      brightness: row.brightness,
      contrast: row.contrast,
      saturation: row.saturation,
    }));
    this.layoutPreviewRequest$.next();
  });

  readonly documentPreviewRefreshEffect = effect(() => {
    const row = this.selectedRow();
    if (!row || row.file.type === 'image') {
      this.lastDocumentPreviewKey = '';
      this.documentPreviewRequest$.next();
      return;
    }

    // Перерисовываем документное превью ТОЛЬКО при смене полей, влияющих на растр
    // страниц (файл, цвет, размер шрифта Word). printer/paper_size/media/source/
    // quality/borderless/fit/rotation меняют раскладку при ПЕЧАТИ, но не картинку
    // постраничного превью — иначе каждая правка перекачивает мегабайтный блоб по
    // медленному каналу студии.
    const contentKey = [
      row.file.msgId,
      row.file.url,
      row.color_mode,
      row.font_size_delta_pt,
    ].join('|');
    if (contentKey === this.lastDocumentPreviewKey) return;
    this.lastDocumentPreviewKey = contentKey;
    this.documentPreviewRequest$.next();
  });

  private readonly dataRowsResetEffect = effect(() => {
    const version = this.dataVersion();
    if (version === this.lastRowsDataVersion) return;
    this.lastRowsDataVersion = version;
    if (!this.printersLoaded()) return;

    queueMicrotask(() => {
      if (this.destroyed || version !== this.lastRowsDataVersion) return;
      this.initRows();
    });
  });

  private readonly photoOrderHintEffect = effect(() => {
    const version = this.dataVersion();
    const hint = this.data().photoOrderHint ?? null;
    const printersLoaded = this.printersLoaded();
    const rowsReady = this.rows().length > 0;
    if (!hint || !printersLoaded || !rowsReady || version === this.lastPhotoOrderHintDataVersion) return;

    queueMicrotask(() => {
      if (this.destroyed || version !== this.dataVersion() || version === this.lastPhotoOrderHintDataVersion) return;
      this.lastPhotoOrderHintDataVersion = version;
      this.applyPhotoOrderHint(hint);
    });
  });

  ngOnInit(): void {
    this.pricingApi.loadCategories();
    this.startQueueMonitor();
    if (isPlatformBrowser(this.platformId)) {
      this.queueMonitorInterval = setInterval(() => this.refreshQueueMonitor(), 10_000);
    }

    this.layoutPreviewRequest$.pipe(
      debounceTime(250),
      map(() => {
        const payload = this.buildLayoutPreviewPayload();
        return {
          payload,
          key: payload ? this.layoutPreviewRenderCacheKey(payload) : 'empty',
        };
      }),
      distinctUntilChanged((prev, curr) => prev.key === curr.key),
      switchMap(({ payload }) => {
        if (!payload) {
          this.layoutPreviewLoading.set(false);
          this.layoutPreviewError.set(null);
          this.clearLayoutPreviewUrl();
          return EMPTY;
        }

        this.layoutPreviewLoading.set(true);
        this.layoutPreviewError.set(null);
        this.clearLayoutPreviewUrl();
        return this.printApi.requestLayoutSheetPreview(payload).pipe(
          tap(blob => {
            this.setLayoutPreviewBlob(blob);
            this.layoutPreviewLoading.set(false);
          }),
          catchError(() => {
            this.layoutPreviewLoading.set(false);
            this.layoutPreviewError.set('Rust preview недоступен');
            this.clearLayoutPreviewUrl();
            return EMPTY;
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.documentPreviewRequest$.pipe(
      debounceTime(300),
      switchMap(() => {
        const requestSeq = ++this.documentPreviewRequestSeq;
        const row = this.selectedRow();
        if (!row || row.file.type === 'image' || !row.file.url) {
          this.documentPreviewLoading.set(false);
          this.documentPreviewError.set(null);
          this.clearDocumentPreviewUrl();
          return EMPTY;
        }

        const previewRowId = row.file.msgId;
        const previewRequest = this.buildDocumentPreviewRequest(row);
        const previewCacheKey = this.documentPreviewCacheKey(previewRequest);
        const cachedPreviewUrl = this.documentPreviewCache.get(previewCacheKey);
        if (cachedPreviewUrl) {
          this.rememberDocumentPreviewCacheKey(previewCacheKey);
          this.documentPreviewLoading.set(false);
          this.documentPreviewError.set(null);
          this.documentPreviewUrl.set(cachedPreviewUrl);
          this.enforceDocumentPreviewCacheLimit(previewCacheKey);
          return EMPTY;
        }

        this.documentPreviewLoading.set(true);
        this.documentPreviewError.set(null);
        this.clearDocumentPreviewUrl();

        // Двухфазно: сначала ТОЛЬКО первая страница (рендерится мгновенно, оператор сразу
        // видит документ), затем в фоне — полная лента всех страниц (для прокрутки),
        // которая бесшумно заменяет первую страницу, когда готова. Первая фаза best-effort:
        // её сбой не мешает второй.
        const page1Request: PreviewRequestParams = { ...previewRequest, page: 1 };
        const page1CacheKey = this.documentPreviewCacheKey(page1Request);
        const phase1$ = this
          .loadDocumentPreviewPhase(page1Request, page1CacheKey, requestSeq, previewRowId)
          .pipe(catchError(() => EMPTY));
        const phase2$ = this
          .loadDocumentPreviewPhase(previewRequest, previewCacheKey, requestSeq, previewRowId);

        return concat(phase1$, phase2$).pipe(
          catchError(() => {
            if (this.isCurrentDocumentPreviewRequest(requestSeq, previewRowId)) {
              this.documentPreviewError.set('Не удалось подготовить предпросмотр документа');
              this.clearDocumentPreviewUrl();
            }
            return EMPTY;
          }),
          finalize(() => {
            if (this.isCurrentDocumentPreviewRequest(requestSeq, previewRowId)) {
              this.documentPreviewLoading.set(false);
              if (!this.documentPreviewUrl() && !this.documentPreviewError()) {
                this.documentPreviewError.set('Предпросмотр документа ещё не готов');
              }
            }
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    forkJoin({
      printers: this.printApi.getPrinters(),
      presets: this.printApi.getPresets(),
    }).subscribe({
      next: ({ printers, presets }) => {
        this.printers.set(printers.filter(p => p.is_active));
        this.apiPresets.set(presets);
        this.printersLoaded.set(true);
        this.initRows();
        this.printApi.getPrinterStatuses().subscribe({
          next: resp => this.statuses.set(resp.printers ?? []),
          error: () => { /* printer statuses optional */ },
        });
      },
      error: () => {
        this.printersLoaded.set(true);
        this.toast.error('Не удалось загрузить принтеры или цены печати');
      },
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.queueMonitorInterval) {
      clearInterval(this.queueMonitorInterval);
    }
    if (isPlatformBrowser(this.platformId)) {
      for (const url of this.layoutPreviewObjectUrls) {
        URL.revokeObjectURL(url);
      }
      for (const url of this.documentPreviewObjectUrls) {
        URL.revokeObjectURL(url);
      }
      for (const url of this.imageObjectUrls.values()) {
        URL.revokeObjectURL(url);
      }
    }
    this.layoutPreviewObjectUrls.clear();
    this.documentPreviewObjectUrls.clear();
    this.documentPreviewCache.clear();
    this.documentPreviewCacheOrder.length = 0;
    this.imageObjectUrls.clear();
    for (const cancel of this.coverageJobCancel.values()) {
      cancel.next();
      cancel.complete();
    }
    this.coverageJobCancel.clear();
    this.coverageJobKey.clear();
    this.pageCountRequestKey.clear();
  }

  refreshQueueMonitor(): void {
    const printerId = this.selectedRow()?.printer_id ?? '';
    if (!printerId) {
      this.resetQueueMonitor();
      return;
    }
    this.queueMonitorRequest$.next(printerId);
  }

  queuePrinterOnline(): boolean {
    const status = this.selectedQueuePrinterStatus();
    return status ? status.online : true;
  }

  queuePrinterDepthLabel(): string {
    const printer = this.selectedQueuePrinter();
    const status = this.selectedQueuePrinterStatus();
    const depth = Math.max(
      this.queueMonitorCounts().total,
      printer?.queue_depth ?? 0,
      status?.jobs_count ?? 0,
    );
    return `${depth} ${this.pluralRu(depth, 'задание', 'задания', 'заданий')}`;
  }

  queueJobTitle(job: PrintJob): string {
    return job.file_name || this.shortQueueJobUrl(job.file_url) || job.id.slice(0, 8);
  }

  queueJobAgeLabel(job: PrintJob): string {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(job.created_at).getTime()) / 60_000));
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    return `${hours} ч ${minutes % 60} мин`;
  }

  queueJobStatusIcon(status: string): string {
    switch (status) {
      case 'queued': return 'hourglass_empty';
      case 'converting': return 'transform';
      case 'splitting': return 'call_split';
      case 'sending': return 'upload';
      case 'processing': return 'hourglass_top';
      case 'printing': return 'print';
      case 'finishing': return 'content_cut';
      case 'paused': return 'pause_circle';
      case 'held': return 'back_hand';
      case 'scheduled': return 'schedule';
      case 'failed': return 'error';
      default: return 'pending_actions';
    }
  }

  queueJobStatusLabel(status: string): string {
    switch (status) {
      case 'queued': return 'Ожидание';
      case 'converting': return 'Конвертация';
      case 'splitting': return 'Разделение';
      case 'sending': return 'Отправка';
      case 'processing': return 'Обработка';
      case 'printing': return 'Печать';
      case 'finishing': return 'Финализация';
      case 'paused': return 'Пауза';
      case 'held': return 'Удержано';
      case 'scheduled': return 'Запланировано';
      case 'failed': return 'Ошибка';
      default: return status;
    }
  }

  queueJobStatusClass(status: string): string {
    return `queue-status-chip status-${status}`;
  }

  formatQueueMonitorTime(date: Date): string {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  private startQueueMonitor(): void {
    this.queueMonitorRequest$.pipe(
      debounceTime(120),
      switchMap(printerId => {
        if (!printerId) {
          this.resetQueueMonitor();
          return EMPTY;
        }
        this.queueMonitorLoading.set(true);
        this.queueMonitorError.set('');
        return forkJoin({
          queue: this.printApi.getQueue({
            printer_id: printerId,
            status: QUEUE_MONITOR_STATUS_PARAM,
            limit: 100,
            sort_by: 'created_at',
            sort_order: 'desc',
          }),
          statuses: this.printApi.getPrinterStatuses().pipe(
            catchError(() => of({ printers: this.statuses() })),
          ),
        }).pipe(
          tap(({ queue, statuses }) => {
            this.queueMonitorJobs.set(queue.jobs);
            this.queueMonitorTotal.set(queue.total);
            this.statuses.set(statuses.printers ?? []);
            this.queueMonitorRefreshedAt.set(new Date());
          }),
          catchError(() => {
            this.queueMonitorError.set('Не удалось загрузить очередь принтера');
            return EMPTY;
          }),
          finalize(() => this.queueMonitorLoading.set(false)),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();
  }

  private resetQueueMonitor(): void {
    this.queueMonitorJobs.set([]);
    this.queueMonitorTotal.set(0);
    this.queueMonitorError.set('');
    this.queueMonitorRefreshedAt.set(null);
    this.queueMonitorLoading.set(false);
  }

  private shortQueueJobUrl(url: string): string {
    if (!url) return '';
    try {
      const parsed = new URL(url, isPlatformBrowser(this.platformId) ? window.location.origin : 'https://svoefoto.ru');
      const name = parsed.pathname.split('/').filter(Boolean).pop();
      return name ? decodeURIComponent(name) : parsed.hostname;
    } catch {
      const parts = url.split('/').filter(Boolean);
      return parts[parts.length - 1] ?? url;
    }
  }

  private pluralRu(value: number, one: string, few: string, many: string): string {
    const mod10 = Math.abs(value) % 10;
    const mod100 = Math.abs(value) % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  private initRows(): void {
    const printers = this.printers();
    const photoPrinter = printers.find(p => p.printer_type === 'photo' && !this.isCoveragePrinter(p)) ?? printers[0];
    const mfpPrinter = printers.find(p => this.isCoveragePrinter(p)) ?? printers[0];

    const rows: BatchPrintRow[] = this.data().files.map(file => {
      const isImage = file.type === 'image';
      const printer = isImage ? photoPrinter : mfpPrinter;
      const paperSize = this.getPreferredPaperSize(printer, isImage ? '10x15' : 'A4');
      const mediaType = this.getDefaultMediaTypeForPaper(printer, paperSize);
      const isPhoto = printer?.printer_type === 'photo';
      return {
        file,
        printer_id: printer?.id ?? '',
        paper_size: paperSize,
        media_type: mediaType,
        paper_source: this.getDefaultPaperSource(printer),
        copies: 1,
        page_range: '',
        font_size_delta_pt: 0,
        price: this.getPrice(paperSize, printer, mediaType),
        fit_mode: (isPhoto ? 'fill' : 'fit') as FitMode,
        borderless: isPhoto && (printer?.capabilities.borderless ?? false),
        // Документы по умолчанию Ч/Б (дешевле и обычно текст); фото и фотопринтер — цвет.
        color_mode: ((isImage || isPhoto) ? 'color' : 'bw') as ColorMode,
        duplex: !isImage && (printer?.capabilities?.duplex ?? false),
        quality: this.getDefaultQuality(printer),
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
      };
    });
    this.rows.set(rows);
    this.selectedRowIndex.set(0);
    this.ensureSelectedImageMetadata();
    this.triggerPageCountForRows();
    this.triggerCoverageForRows();
  }

  private ensureSelectedImageMetadata(): void {
    const rows = this.rows();
    const selectedIndex = this.selectedRowIndex();
    const protectedKeys = new Set<string>();
    for (const offset of [0, 1, -1, 2]) {
      const row = rows[selectedIndex + offset] ?? (offset === 0 ? rows[0] : null);
      if (!row || row.file.type !== 'image') continue;
      protectedKeys.add(row.file.msgId);
      this.queueImageAsset(row, offset === 0);
    }
    this.enforcePreviewCacheLimit(protectedKeys);
  }

  private queueImageAsset(row: BatchPrintRow, priority = false): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (row.file.type !== 'image' || !row.file.url) return;

    const msgId = row.file.msgId;
    if (this.imageObjectUrls.has(msgId) && row.image_width && row.image_height) {
      this.rememberPreviewCacheKey(msgId);
      return;
    }
    if (this.imagePreloadInFlight.has(msgId)) return;

    const queuedIndex = this.imagePreloadQueue.findIndex(queued => queued.file.msgId === msgId);
    if (queuedIndex >= 0) {
      if (priority) {
        const [queued] = this.imagePreloadQueue.splice(queuedIndex, 1);
        if (queued) this.imagePreloadQueue.unshift(queued);
      }
      return;
    }

    if (priority) {
      this.imagePreloadQueue.unshift(row);
    } else {
      this.imagePreloadQueue.push(row);
    }
    this.drainImagePreloadQueue();
  }

  private drainImagePreloadQueue(): void {
    if (!isPlatformBrowser(this.platformId) || this.destroyed) return;

    while (this.activeImagePreloads < this.maxPreviewPreloads && this.imagePreloadQueue.length) {
      const row = this.imagePreloadQueue.shift();
      if (!row) return;

      const msgId = row.file.msgId;
      if (this.imagePreloadInFlight.has(msgId)) continue;

      this.activeImagePreloads += 1;
      this.imagePreloadInFlight.add(msgId);
      void this.loadImageAsset(row).finally(() => {
        this.activeImagePreloads = Math.max(0, this.activeImagePreloads - 1);
        this.imagePreloadInFlight.delete(msgId);
        this.drainImagePreloadQueue();
      });
    }
  }

  private async loadImageAsset(row: BatchPrintRow): Promise<void> {
    const msgId = row.file.msgId;
    if (this.destroyed) return;

    this.previewImageLoading.update(prev => ({ ...prev, [msgId]: true }));
    this.previewImageErrors.update(prev => {
      const next: Record<string, string | undefined> = { ...prev };
      delete next[msgId];
      return next;
    });

    let createdObjectUrl: string | null = null;
    try {
      const response = await fetch(this.previewAssetUrl(row.file.url), { credentials: 'include', cache: 'force-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      createdObjectUrl = URL.createObjectURL(blob);
      const dimensions = await this.decodeImageDimensions(createdObjectUrl);

      if (this.destroyed) {
        URL.revokeObjectURL(createdObjectUrl);
        return;
      }

      const previousObjectUrl = this.imageObjectUrls.get(msgId);
      if (previousObjectUrl && previousObjectUrl !== createdObjectUrl) {
        URL.revokeObjectURL(previousObjectUrl);
      }
      this.imageObjectUrls.set(msgId, createdObjectUrl);
      this.rememberPreviewCacheKey(msgId);
      const previewObjectUrl = createdObjectUrl;
      this.previewImageUrls.update(prev => ({ ...prev, [msgId]: previewObjectUrl }));
      createdObjectUrl = null;

      this.rows.update(prev => prev.map(r => {
        if (r.file.msgId !== msgId) return r;
        const next: BatchPrintRow = {
          ...r,
          image_width: dimensions.width,
          image_height: dimensions.height,
        };
        return this.withFixedPrice(this.clearCoverage(next));
      }));
      this.triggerCoverageForRowMsgId(msgId);
    } catch {
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
      if (!this.destroyed) {
        this.previewImageErrors.update(prev => ({
          ...prev,
          [msgId]: 'Не удалось загрузить файл предпросмотра',
        }));
      }
    } finally {
      if (!this.destroyed) {
        this.previewImageLoading.update(prev => ({ ...prev, [msgId]: false }));
      }
    }
  }

  private decodeImageDimensions(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Image decode failed'));
      img.src = src;
    });
  }

  private rememberPreviewCacheKey(msgId: string): void {
    const index = this.previewCacheOrder.indexOf(msgId);
    if (index >= 0) this.previewCacheOrder.splice(index, 1);
    this.previewCacheOrder.push(msgId);
  }

  private enforcePreviewCacheLimit(protectedKeys = new Set<string>()): void {
    while (this.previewCacheOrder.length > this.maxPreviewCacheEntries) {
      const candidate = this.previewCacheOrder.find(msgId => !protectedKeys.has(msgId));
      if (!candidate) return;
      this.removePreviewObjectUrl(candidate);
    }
  }

  private removePreviewObjectUrl(msgId: string): void {
    const objectUrl = this.imageObjectUrls.get(msgId);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    this.imageObjectUrls.delete(msgId);

    const orderIndex = this.previewCacheOrder.indexOf(msgId);
    if (orderIndex >= 0) this.previewCacheOrder.splice(orderIndex, 1);

    this.previewImageUrls.update(prev => {
      const next: Record<string, string | undefined> = { ...prev };
      delete next[msgId];
      return next;
    });
  }

  private getPrice(paperSize: string, printer: Printer | undefined, mediaType: string): number {
    return this.getBestPricePreset(paperSize, printer, mediaType)?.price ?? 0;
  }

  private pricePresetMatchesPrinter(preset: PrintPresetRecord, printer: Printer): boolean {
    if (preset.sublimation) {
      return printer.printer_type === 'sublimation'
        || printer.capabilities?.sublimation === true
        || printer.capabilities?.media_types?.some(m => m.id === 'ds_transfer') === true;
    }
    if (printer.printer_type === 'sublimation') return preset.sublimation;
    if (this.isCoveragePrinter(printer)) {
      return preset.printer_type === 'mfp' || preset.printer_type === 'document';
    }
    if (printer.printer_type === 'photo') return preset.printer_type === 'photo' && !preset.sublimation;
    return false;
  }

  private getDefaultMediaTypeForPaper(printer: Printer | undefined, paperSize: string): string {
    if (!printer) return '';
    const preset = this.getPricePresetCandidates(paperSize, printer)
      .filter(candidate => !!candidate.media_type && this.printerSupportsMedia(printer, candidate.media_type))
      .sort((a, b) =>
        this.presetStudioScore(b, printer) - this.presetStudioScore(a, printer)
        || a.sort_order - b.sort_order
        || a.price - b.price,
      )[0];
    if (preset?.media_type) return this.resolvePrinterMediaTypeId(printer, preset.media_type);
    return printer.capabilities?.media_types?.[0]?.id ?? '';
  }

  private getBestPricePreset(
    paperSize: string,
    printer: Printer | undefined,
    mediaType: string | null | undefined,
  ): PrintPresetRecord | null {
    if (!printer) return null;
    const candidates = this.getPricePresetCandidates(paperSize, printer)
      .map(preset => ({
        preset,
        mediaScore: this.mediaTypeMatchScore(preset.media_type, mediaType),
        studioScore: this.presetStudioScore(preset, printer),
      }))
      .filter(item => item.mediaScore > 0 && item.studioScore > 0)
      .sort((a, b) =>
        b.studioScore - a.studioScore
        || b.mediaScore - a.mediaScore
        || a.preset.sort_order - b.preset.sort_order
        || a.preset.price - b.preset.price,
      );
    return candidates[0]?.preset ?? null;
  }

  private getPricePresetCandidates(paperSize: string, printer: Printer): PrintPresetRecord[] {
    const normalizedPaper = this.normalizeOptionId(paperSize);
    return this.apiPresets().filter(preset =>
      preset.is_active &&
      this.normalizeOptionId(preset.paper_size) === normalizedPaper &&
      this.pricePresetMatchesPrinter(preset, printer) &&
      this.presetStudioMatchesPrinterRecord(preset, printer),
    );
  }

  private presetStudioMatchesPrinterRecord(preset: PrintPresetRecord, printer: Printer): boolean {
    if (!preset.studio_id) return true;
    return !!printer.studio_id && preset.studio_id === printer.studio_id;
  }

  private presetStudioScore(preset: PrintPresetRecord, printer: Printer): number {
    if (preset.studio_id && printer.studio_id && preset.studio_id === printer.studio_id) return 2;
    if (!preset.studio_id) return 1;
    return 0;
  }

  private mediaTypeMatchScore(
    presetMedia: string | null | undefined,
    selectedMedia: string | null | undefined,
  ): number {
    const presetNormalized = this.normalizeOptionId(presetMedia);
    const selectedNormalized = this.normalizeOptionId(selectedMedia);
    if (presetNormalized && selectedNormalized && presetNormalized === selectedNormalized) return 3;
    if (presetNormalized && selectedNormalized && this.mediaPricingGroup(presetMedia) === this.mediaPricingGroup(selectedMedia)) return 2;
    if (!presetNormalized) return selectedNormalized ? 1 : 2;
    return 0;
  }

  private mediaPricingGroup(value: string | null | undefined): string {
    const normalized = this.normalizeOptionId(value);
    if (!normalized) return '';
    if (
      normalized.includes('heavy6') ||
      normalized.includes('heavy7') ||
      normalized.includes('221256') ||
      normalized.includes('257300') ||
      normalized.includes('250') ||
      normalized.includes('300') ||
      normalized.includes('плотная6') ||
      normalized.includes('плотная7')
    ) {
      return 'business-card-stock';
    }
    if (
      normalized.includes('satin') ||
      normalized.includes('satine') ||
      normalized.includes('semigloss') ||
      normalized.includes('semiglossy') ||
      normalized.includes('supergloss') ||
      normalized.includes('superglossy') ||
      normalized.includes('premiumgloss') ||
      normalized.includes('полуглян') ||
      normalized.includes('сатин') ||
      normalized.includes('суперглян')
    ) {
      return 'premium-photo';
    }
    if (
      normalized.includes('gloss') ||
      normalized.includes('glossy') ||
      normalized.includes('matte') ||
      normalized.includes('мат') ||
      normalized.includes('глян')
    ) {
      return 'standard-photo';
    }
    return normalized;
  }

  private resolvePrinterMediaTypeId(printer: Printer, mediaType: string): string {
    const mediaTypes = printer.capabilities?.media_types ?? [];
    const normalized = this.normalizeOptionId(mediaType);
    const exact = mediaTypes.find(media => this.normalizeOptionId(media.id) === normalized);
    if (exact) return exact.id;
    const named = mediaTypes.find(media => this.normalizeOptionId(media.name) === normalized);
    if (named) return named.id;
    const group = this.mediaPricingGroup(mediaType);
    const grouped = mediaTypes.find(media =>
      this.mediaPricingGroup(media.id) === group || this.mediaPricingGroup(media.name) === group,
    );
    return grouped?.id ?? mediaType;
  }

  private getDefaultPaperSource(printer: Printer | undefined): string {
    return printer?.capabilities?.paper_sources?.[0]?.id ?? 'auto';
  }

  private getPreferredPaperSize(printer: Printer | undefined, preferred: string): string {
    const papers = printer?.capabilities?.paper_sizes ?? [];
    return papers.find(p => p.id === preferred)?.id ?? papers[0]?.id ?? preferred;
  }

  private getDefaultQuality(printer: Printer | undefined): string {
    const modes = printer?.capabilities?.quality_modes ?? [];
    if (!modes.length) return 'normal';

    if (printer?.printer_type === 'photo' && !this.isPrinterSublimation(printer)) {
      const photoMode = modes.find(mode => {
        const id = this.normalizeOptionId(mode.id);
        const name = this.normalizeOptionId(mode.name);
        return id === 'photo' || id === 'best' || name.includes('фото') || name.includes('лучшее');
      });
      if (photoMode) return photoMode.id;
    }

    const standardMode = modes.find(mode => {
      const id = this.normalizeOptionId(mode.id);
      const name = this.normalizeOptionId(mode.name);
      return id === 'standard'
        || id === 'normal'
        || name.includes('standard')
        || name.includes('стандарт')
        || name.includes('обыч');
    });

    return standardMode?.id ?? modes[0]?.id ?? 'normal';
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

  isBusinessCardSelected(): boolean {
    return isBusinessCardPresetId(this.selectedPhotoSize().id);
  }

  private businessCardPhotoPresetIdFromPreset(preset: PrintPreset | null | undefined): 'business-card' | 'business-card-eu' {
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

  private formatMediaTypeLabel(printer: Printer | undefined, media: MediaType): string {
    if (!this.isCanonC3226i(printer)) return media.name;
    const weightLabel = this.canonC3226iMediaWeightLabel(media);
    if (!weightLabel || this.mediaTypeNameAlreadyHasWeight(media.name)) return media.name;
    return `${media.name} · ${weightLabel}`;
  }

  private canonC3226iMediaWeightLabel(media: MediaType): string {
    const ids = [media.id, media.name].map(value => this.normalizeOptionId(value));
    return ids.map(id => CANON_C3226I_MEDIA_WEIGHT_LABELS[id]).find(label => !!label) ?? '';
  }

  private mediaTypeNameAlreadyHasWeight(name: string): boolean {
    return /\d+\s*[-–]\s*\d+\s*(?:г\/м²|г\/м2|gsm)/i.test(name);
  }

  private findCanonC3226iPrinter(): Printer | undefined {
    return this.printers().find(printer => this.isCanonC3226i(printer));
  }

  private normalizeOptionId(value: string | null | undefined): string {
    return (value ?? '').toLowerCase().replace(/[\s_\-/]/g, '');
  }

  private findCuttingServiceOption(): PricingServiceOption | null {
    const options = this.pricingApi.categories()
      .flatMap(category => category.optionGroups)
      .flatMap(group => group.options);

    const exact = options.find(option => option.slug.trim().toLowerCase() === 'cutting');
    if (exact) return exact;

    return options.find(option => {
      const text = `${option.slug} ${option.name}`.toLowerCase();
      return text.includes('cutting') || text.includes('trim') || text.includes('резка') || text.includes('подрезка');
    }) ?? null;
  }

  private customCuttingQuantityForRows(rows: readonly BatchPrintRow[]): number {
    if (this.selectedPhotoSize().id !== 'custom') return 0;
    return rows.reduce((sum, row) => {
      if (row.file.type !== 'image') return sum;
      return sum + Math.max(0, Math.trunc(Number(row.copies) || 0));
    }, 0);
  }

  private customPhotoSizeLabel(): string {
    return `${this.customPhotoWCm()}×${this.customPhotoHCm()} см`;
  }

  selectPresetCategory(categoryId: PresetCategoryId): void {
    this.selectedPresetCategoryId.set(categoryId);
  }

  activePresetMatches(preset: PrintPreset): boolean {
    const row = this.selectedRow();
    if (!row) return false;
    const printer = this.getPrinterForRow(row);
    if (!printer || !this.quickPresetMatchesPrinter(preset, printer)) return false;

    return this.normalizeOptionId(row.paper_size) === this.normalizeOptionId(preset.paperSize)
      && this.mediaTypeMatchScore(preset.mediaType, row.media_type) > 0
      && (!preset.quality || row.quality === preset.quality)
      && row.fit_mode === preset.fitMode
      && row.color_mode === preset.colorMode
      && row.duplex === preset.duplex
      && row.borderless === (preset.borderless && printer.capabilities.borderless);
  }

  presetDisplayLabel(preset: PrintPreset): string {
    const media = preset.mediaType
      ? this.getMediaTypeNameForPreset(preset)
      : '';
    const label = preset.label
      .replace(/^фото\s+/i, '')
      .replace(/\s+фото$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (label.length <= 22) return label;
    return [preset.paperSize, media].filter(part => !!part).join(' ');
  }

  setCustomPhotoWidthCm(value: string | number): void {
    this.customPhotoW.set(this.parseCmToMm(value, this.customPhotoW()));
    this.refreshCustomPhotoLayout();
  }

  setCustomPhotoHeightCm(value: string | number): void {
    this.customPhotoH.set(this.parseCmToMm(value, this.customPhotoH()));
    this.refreshCustomPhotoLayout();
  }

  setLayoutPaper(paperId: string): void {
    const effectivePaperId = this.selectedPhotoSize().id === 'custom'
      ? this.resolveFittingLayoutPaperId(paperId)
      : paperId;
    this.selectedPaperForLayout.set(effectivePaperId);
    if (!this.isDocumentMode() && !this.isBusinessCardSelected()) {
      this.applyLayoutPaperToImageRows(effectivePaperId);
    }
    this.activePresetId.set(null);
  }

  private parseCmToMm(value: string | number, fallbackMm: number): number {
    const numeric = Number(String(value).trim().replace(',', '.'));
    if (!Number.isFinite(numeric)) return fallbackMm;
    return Math.max(10, Math.min(500, Math.round(numeric * 10)));
  }

  private formatCustomCm(mm: number): string {
    const cm = mm / 10;
    return (Number.isInteger(cm) ? String(cm) : cm.toFixed(1)).replace('.', ',');
  }

  private applyPhotoOrderHint(hint: ChatPhotoOrderHint): void {
    this.customPhotoW.set(hint.widthMm);
    this.customPhotoH.set(hint.heightMm);
    this.selectedPhotoSize.set(this.buildCustomPhotoPreset(hint.label));
    this.cutMargin.set(this.defaultCustomCutMargin(hint.widthMm, hint.heightMm));
    this.settingsView.set('layout');

    const paperId = this.minimumLayoutPaperForPhotoSize(hint.widthMm, hint.heightMm)?.id
      ?? this.selectedPaperForLayout();
    this.setLayoutPaper(paperId);
    if (hint.whiteBorder) {
      this.applyImageFitMode('fit');
    }
    this.activePresetId.set(null);
  }

  private refreshCustomPhotoLayout(): void {
    if (this.selectedPhotoSize().id !== 'custom') return;

    this.selectedPhotoSize.set(this.buildCustomPhotoPreset());
    this.cutMargin.set(this.defaultCustomCutMargin(this.customPhotoW(), this.customPhotoH()));
    const paperId = this.minimumLayoutPaperForPhotoSize(this.customPhotoW(), this.customPhotoH())?.id
      ?? this.selectedPaperForLayout();
    this.setLayoutPaper(paperId);
  }

  private buildCustomPhotoPreset(label = this.customPhotoSizeLabel()): PhotoSizePreset {
    return {
      id: 'custom',
      label,
      group: 'photo',
      width_mm: this.customPhotoW(),
      height_mm: this.customPhotoH(),
    };
  }

  private minimumLayoutPaperForPhotoSize(widthMm: number, heightMm: number): PaperSize | null {
    const candidates = this.getAvailablePapers().filter(paper => this.photoSizeFitsPaper(widthMm, heightMm, paper));
    if (!candidates.length) return null;

    const productionOrder = ['10x15', '15x20', '15x21', '20x30', 'A4', 'A3'];
    for (const paperId of productionOrder) {
      const match = candidates.find(paper => paper.id === paperId);
      if (match) return match;
    }

    return candidates
      .slice()
      .sort((a, b) => (a.width_mm * a.height_mm) - (b.width_mm * b.height_mm))[0] ?? null;
  }

  private findPaperIdForPhotoPreset(size: PhotoSizePreset): string | null {
    if (size.width_mm <= 0 || size.height_mm <= 0) return null;

    const exact = this.getAvailablePapers().find(paper =>
      paper.id.toLowerCase() === size.id.toLowerCase()
      || paper.name.replace(/\s+/g, '').toLowerCase() === size.label.replace(/\s+/g, '').toLowerCase(),
    );
    if (exact) return exact.id;

    return this.minimumLayoutPaperForPhotoSize(size.width_mm, size.height_mm)?.id ?? null;
  }

  private photoSizeFitsPaper(widthMm: number, heightMm: number, paper: PaperSize): boolean {
    return (widthMm <= paper.width_mm && heightMm <= paper.height_mm)
      || (widthMm <= paper.height_mm && heightMm <= paper.width_mm);
  }

  private photoSizeMatchesPaper(widthMm: number, heightMm: number, paper: PaperSize): boolean {
    return (widthMm === paper.width_mm && heightMm === paper.height_mm)
      || (widthMm === paper.height_mm && heightMm === paper.width_mm);
  }

  private defaultCustomCutMargin(widthMm: number, heightMm: number): number {
    const sideA = Math.min(widthMm, heightMm);
    const sideB = Math.max(widthMm, heightMm);
    if ((sideA === 50 && sideB === 75) || (sideA === 75 && sideB === 100)) {
      return 0;
    }
    return 2;
  }

  private resolveFittingLayoutPaperId(paperId: string): string {
    const requestedPaper = this.getAvailablePapers().find(paper => paper.id === paperId) ?? null;
    if (requestedPaper && this.photoSizeFitsPaper(this.customPhotoW(), this.customPhotoH(), requestedPaper)) {
      return requestedPaper.id;
    }

    return this.minimumLayoutPaperForPhotoSize(this.customPhotoW(), this.customPhotoH())?.id
      ?? paperId;
  }

  private applyImageFitMode(fitMode: FitMode): void {
    this.rows.update(rows => rows.map(row => row.file.type === 'image'
      ? { ...row, fit_mode: fitMode }
      : row));
  }

  private applyLayoutPaperToImageRows(paperId: string): void {
    this.rows.update(rows => rows.map(row => {
      if (row.file.type !== 'image') return row;
      const printer = this.findPrinterForPaper(row, paperId) ?? this.getPrinterForRow(row);
      const mediaType = this.getDefaultMediaTypeForPaper(printer, paperId);
      const next: BatchPrintRow = {
        ...row,
        printer_id: printer?.id ?? row.printer_id,
        paper_size: paperId,
        media_type: mediaType,
        paper_source: this.getDefaultPaperSource(printer),
        quality: this.getDefaultQuality(printer),
        fit_mode: 'fill',
        borderless: printer?.printer_type === 'photo' && (printer.capabilities.borderless ?? false),
      };
      return this.withFixedPrice(this.clearCoverage(next));
    }));
    this.triggerCoverageForRows();
  }

  private findPrinterForPaper(row: BatchPrintRow, paperId: string): Printer | undefined {
    const current = this.getPrinterForRow(row);
    if (current && this.printerSupportsPaper(current, paperId)) return current;
    return this.printers().find(printer =>
      printer.printer_type === 'photo' &&
      !this.isPrinterSublimation(printer) &&
      this.printerSupportsPaper(printer, paperId),
    ) ?? this.printers().find(printer => this.printerSupportsPaper(printer, paperId));
  }

  private getPresetRecord(preset: PrintPreset | string): PrintPresetRecord | undefined {
    const id = typeof preset === 'string' ? preset : preset.id;
    return this.apiPresets().find(record => record.id === id);
  }

  private quickPresetHasMatchingPrinter(preset: PrintPreset): boolean {
    return this.printers().some(printer => this.quickPresetMatchesPrinter(preset, printer));
  }

  private quickPresetMatchesPrinter(preset: PrintPreset, printer: Printer): boolean {
    const record = this.getPresetRecord(preset);
    if (record) {
      if (!this.pricePresetMatchesPrinter(record, printer)) return false;
      if (!this.presetStudioMatchesPrinterRecord(record, printer)) return false;
    } else {
      if (preset.sublimation && !this.isPrinterSublimation(printer)) return false;
      const coveragePrinter = this.isCoveragePrinter(printer);
      if (coveragePrinter
        && preset.printerType !== 'mfp' && preset.printerType !== 'document') return false;
      if (!coveragePrinter
        && !preset.sublimation
        && printer.printer_type === 'photo'
        && preset.printerType !== 'photo') return false;
      if (!coveragePrinter && printer.printer_type !== 'photo') return false;
    }
    return this.printerSupportsPaper(printer, preset.paperSize)
      && this.printerSupportsMedia(printer, preset.mediaType);
  }

  private presetCategoryId(preset: PrintPreset): PresetCategoryId {
    if (this.isBusinessCardPreset(preset)) return 'business';
    if (preset.sublimation) return 'sublimation';
    if (this.isFlyerPreset(preset)) return 'flyers';
    if (preset.printerType === 'mfp' || preset.printerType === 'document') return 'documents';
    return 'photo';
  }

  private inferPresetCategoryForPrinter(
    printer: Printer | undefined,
    row: BatchPrintRow | null,
  ): PresetCategoryId | null {
    if (this.isBusinessCardSelected()) return 'business';
    if (row?.file.type !== 'image') return 'documents';
    if (this.isPrinterSublimation(printer)) return 'sublimation';
    if (this.isCoveragePrinter(printer)) return 'documents';
    if (printer?.printer_type === 'photo') return 'photo';
    return null;
  }

  private presetCategoryOrder(categoryId: PresetCategoryId): number {
    switch (categoryId) {
      case 'photo': return 0;
      case 'documents': return 1;
      case 'flyers': return 2;
      case 'business': return 3;
      case 'sublimation': return 4;
    }
  }

  private presetSortLabel(preset: PrintPreset): string {
    return `${preset.paperSize} ${preset.mediaType ?? ''} ${preset.label}`;
  }

  private dedupePresets(presets: PrintPreset[]): PrintPreset[] {
    const byKey = new Map<string, PrintPreset>();
    for (const preset of presets) {
      const key = this.presetDedupeKey(preset);
      if (!byKey.has(key)) byKey.set(key, preset);
    }
    return Array.from(byKey.values());
  }

  private presetDedupeKey(preset: PrintPreset): string {
    return [
      this.presetCategoryId(preset),
      preset.printerType,
      preset.sublimation ? 'sublimation' : 'standard',
      this.normalizeOptionId(preset.paperSize),
      this.mediaPricingGroup(preset.mediaType),
      this.isBusinessCardPreset(preset) ? this.businessCardPhotoPresetIdFromPreset(preset) : '',
    ].join('|');
  }

  private presetDedupePriority(preset: PrintPreset): number {
    const record = this.getPresetRecord(preset);
    const matchingPrinterScore = record
      ? Math.max(0, ...this.printers().map(printer => this.presetStudioScore(record, printer)))
      : 0;
    return matchingPrinterScore * 1000
      + (preset.price ?? 0)
      - (record?.sort_order ?? 0) / 1000;
  }

  private isPrinterSublimation(printer: Printer | undefined): boolean {
    return printer?.printer_type === 'sublimation'
      || printer?.capabilities?.sublimation === true
      || printer?.capabilities?.media_types?.some(media => media.id === 'ds_transfer') === true;
  }

  private isFlyerPreset(preset: PrintPreset): boolean {
    const text = `${preset.slug ?? ''} ${preset.label} ${preset.paperSize}`.toLowerCase();
    return text.includes('flyer')
      || text.includes('флаер')
      || text.includes('листов')
      || text.includes('буклет')
      || text.includes('poster')
      || text.includes('плакат');
  }

  private printerSupportsPaper(printer: Printer, paperSize: string): boolean {
    const normalizedPaper = this.normalizeOptionId(paperSize);
    return printer.capabilities?.paper_sizes?.some(paper =>
      this.normalizeOptionId(paper.id) === normalizedPaper ||
      this.normalizeOptionId(paper.name) === normalizedPaper,
    ) === true;
  }

  private printerSupportsMedia(printer: Printer, mediaType: string | null | undefined): boolean {
    if (!mediaType) return true;
    const normalizedMedia = this.normalizeOptionId(mediaType);
    const mediaGroup = this.mediaPricingGroup(mediaType);
    return printer.capabilities?.media_types?.some(media =>
      this.normalizeOptionId(media.id) === normalizedMedia ||
      this.normalizeOptionId(media.name) === normalizedMedia ||
      this.mediaPricingGroup(media.id) === mediaGroup ||
      this.mediaPricingGroup(media.name) === mediaGroup,
    ) === true;
  }

  private printerSupportsExactMedia(printer: Printer, mediaType: string | null | undefined): boolean {
    if (!mediaType) return false;
    const normalizedMedia = this.normalizeOptionId(mediaType);
    return printer.capabilities?.media_types?.some(media =>
      this.normalizeOptionId(media.id) === normalizedMedia ||
      this.normalizeOptionId(media.name) === normalizedMedia,
    ) === true;
  }

  private printerSupportsPaperSource(printer: Printer, paperSource: string | null | undefined): boolean {
    if (!paperSource) return false;
    const normalizedSource = this.normalizeOptionId(paperSource);
    return printer.capabilities?.paper_sources?.some(source =>
      this.normalizeOptionId(source.id) === normalizedSource ||
      this.normalizeOptionId(source.name) === normalizedSource,
    ) === true;
  }

  private getMediaTypeNameForPreset(preset: PrintPreset): string {
    const printer = this.printers().find(candidate => this.quickPresetMatchesPrinter(preset, candidate));
    if (!printer || !preset.mediaType) return preset.mediaType ?? '';
    const resolved = this.resolvePrinterMediaTypeId(printer, preset.mediaType);
    return printer.capabilities.media_types.find(media => media.id === resolved)?.name ?? preset.mediaType;
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

  private isBusinessCardMediaType(value: string): boolean {
    return isBusinessCardMediaTypeId(value);
  }

  private findBusinessCardMediaType(printer: Printer | undefined): string {
    const mediaTypes = printer?.capabilities?.media_types ?? [];
    return mediaTypes.find(media =>
      this.isBusinessCardMediaType(media.id) || this.isBusinessCardMediaType(media.name),
    )?.id ?? '';
  }

  private businessCardRequirementIssue(): string {
    if (!this.isBusinessCardSelected()) return '';

    if (this.splitEnabled()) return 'Визитки печатаются только на Canon C3226i без разделения по принтерам';

    const target = this.findCanonC3226iPrinter();
    if (!target) return 'Для визиток нужен Canon C3226i';

    const badPrinter = this.rows().find(row => !this.isCanonC3226i(this.getPrinterForRow(row)));
    if (badPrinter) return 'Для визиток все файлы должны идти на Canon C3226i';

    const badPaper = this.rows().find(row => row.paper_size !== BUSINESS_CARD_A4_TEMPLATE.paperSize);
    if (badPaper) return 'Для визиток нужен формат A4';

    const badMedia = this.rows().find(row => {
      const printer = this.getPrinterForRow(row);
      return !printer
        || !this.isBusinessCardMediaType(row.media_type)
        || !this.printerSupportsExactMedia(printer, row.media_type);
    });
    if (badMedia) return `Для визиток нужна бумага ${BUSINESS_CARD_MEDIA_TYPE_LABEL}`;

    const badSource = this.rows().find(row => {
      const printer = this.getPrinterForRow(row);
      return !printer
        || !this.isBusinessCardPaperSource(row.paper_source)
        || !this.printerSupportsPaperSource(printer, row.paper_source);
    });
    if (badSource) return 'Для визиток нужна подача из универсального лотка';

    const badMode = this.rows().find(row => row.duplex || row.borderless);
    if (badMode) return 'Визитки печатаются односторонне, с полями и линиями реза';

    return '';
  }

  private shouldAnalyzeCoverageForRow(row: BatchPrintRow): boolean {
    if (this.isBusinessCardSelected()) return false;
    const printer = this.getPrinterForRow(row);
    const isA4Like = row.paper_size === 'A4' || row.paper_size === 'A3';
    return this.isCoveragePrinter(printer) && isA4Like && !!row.file.url;
  }

  shouldShowCoverageBadge(row: BatchPrintRow): boolean {
    return this.shouldAnalyzeCoverageForRow(row);
  }

  /** Человекочитаемый прогресс фоновой coverage-задачи: «✓ Документ прочитан / Рендер / Анализ заливки X/N». null = нет активной задачи. */
  coverageProgressLabel(row: BatchPrintRow): string | null {
    const progress = row.coverage_progress;
    if (!progress) return null;
    switch (progress.stage) {
      case 'counting':
        return 'Читаю документ…';
      case 'rendering':
        return progress.total > 0 ? `Рендер страниц (${progress.total})…` : 'Рендер страниц…';
      case 'analyzing':
        return progress.total > 0
          ? `Анализ заливки ${progress.done}/${progress.total}`
          : 'Анализ заливки…';
      default:
        return null;
    }
  }

  /** Тир заливки не уточнён (задача упала/исчезла) — цена держится на фикс-тарифе. */
  coverageTierUnresolved(row: BatchPrintRow): boolean {
    return this.shouldAnalyzeCoverageForRow(row)
      && !row.coverage_result
      && row.coverage_progress?.stage === 'failed';
  }

  private getFixedPriceForRow(row: BatchPrintRow): number {
    return this.getPrice(row.paper_size, this.getPrinterForRow(row), row.media_type);
  }

  private clearCoverage(row: BatchPrintRow): BatchPrintRow {
    // page_count НЕ трогаем: это тот же файл, число страниц остаётся валидным при смене
    // бумаги/принтера. Сбрасываем только результат/прогресс анализа заливки.
    return {
      ...row,
      coverage_result: null,
      coverage_loading: false,
      coverage_overridden: false,
      coverage_progress: null,
    };
  }

  private withFixedPrice(row: BatchPrintRow): BatchPrintRow {
    return {
      ...row,
      price: this.getFixedPriceForRow(row),
    };
  }

  private getCoveragePaperFormat(row: BatchPrintRow): string {
    return row.paper_size.toLowerCase().replace(/\s/g, '') || 'a4';
  }

  private pageCountFontDeltaForRow(row: BatchPrintRow): number {
    return this.isWordDocument(row) ? row.font_size_delta_pt : 0;
  }

  private triggerPageCountForRows(): void {
    this.rows().forEach((_, index) => this.triggerPageCountForRow(index));
  }

  /**
   * P0-1 (денежный фикс): универсальный быстрый подсчёт страниц для КАЖДОГО документа,
   * НЕЗАВИСИМО от coverage-гейта/принтера/формата. Источник истины `row.page_count` для
   * числа страниц и цены — без него ×1 живёт для не-laser/A5/любого формата.
   * Изображения пропускаем (у них «страница» = 1, page_count не нужен).
   */
  private triggerPageCountForRow(index: number): void {
    const row = this.rows()[index];
    if (!row || row.file.type === 'image' || !row.file.url) return;

    const fontDelta = this.pageCountFontDeltaForRow(row);
    const requestKey = `${row.file.url}::${fontDelta}`;
    // Дедуп: тот же файл+шрифт уже посчитан/считается — не дёргаем повторно.
    if (this.pageCountRequestKey.get(row.file.msgId) === requestKey && (row.page_count !== null || row.page_count_loading)) {
      return;
    }
    this.pageCountRequestKey.set(row.file.msgId, requestKey);

    const msgId = row.file.msgId;
    this.rows.update(rows => rows.map(current =>
      current.file.msgId === msgId
        ? { ...current, page_count_loading: true, page_count_failed: false }
        : current,
    ));

    this.coverageService.countPages(row.file.url, fontDelta).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(outcome => {
      // Гонка: пока летел запрос, файл/шрифт строки мог смениться — применяем только если ключ актуален.
      if (this.pageCountRequestKey.get(msgId) !== requestKey) return;
      this.rows.update(rows => rows.map(current => {
        if (current.file.msgId !== msgId) return current;
        if (outcome.ok) {
          return {
            ...current,
            page_count: outcome.result.page_count,
            page_count_loading: false,
            page_count_failed: false,
          };
        }
        // P1-4: провал count-pages — НЕ молчаливое ×1, явный флаг + требование ручного диапазона.
        return {
          ...current,
          page_count: null,
          page_count_loading: false,
          page_count_failed: true,
        };
      }));
    });
  }

  private triggerCoverageForRows(): void {
    this.rows().forEach((_, index) => this.triggerCoverageForRow(index));
  }

  private triggerCoverageForRowMsgId(msgId: string): void {
    const index = this.rows().findIndex(row => row.file.msgId === msgId);
    if (index >= 0) this.triggerCoverageForRow(index);
  }

  private triggerCoverageForRow(index: number): void {
    const row = this.rows()[index];
    if (!row) return;

    if (!this.shouldAnalyzeCoverageForRow(row)) {
      this.cancelCoverageJob(row.file.msgId);
      this.rows.update(rows => rows.map(current =>
        current.file.msgId === row.file.msgId
          ? this.withFixedPrice(this.clearCoverage(current))
          : current,
      ));
      return;
    }

    const request: CoverageRequest = {
      msgId: row.file.msgId,
      fileUrl: row.file.url,
      printerId: row.printer_id,
      paperSize: row.paper_size,
      paperFormat: this.getCoveragePaperFormat(row),
      borderless: row.borderless,
      fontSizeDeltaPt: this.pageCountFontDeltaForRow(row),
      colorMode: row.color_mode,
    };

    // Дедуп лишнего рестарта (например, повторный triggerCoverageForRows() из applyPhotoOrderHint):
    // если для документа УЖЕ летит фоновая задача с тем же coverageRequestKey и строка ещё грузится,
    // не перезапускаем её — иначе сбросили бы прогресс и погасили здоровый поллинг.
    // При РЕАЛЬНОЙ смене настроек jobKey отличается → гард не сработает → перезапуск произойдёт.
    if (row.file.type !== 'image'
      && row.coverage_loading
      && this.coverageJobCancel.has(request.msgId)
      && this.coverageJobKey.get(request.msgId) === this.coverageRequestKey(request)) {
      return;
    }

    const fixedPrice = this.getFixedPriceForRow(row);

    this.rows.update(rows => rows.map(current =>
      this.matchesCoverageRequest(current, request)
        ? {
            ...current,
            price: fixedPrice,
            coverage_result: null,
            coverage_loading: true,
            coverage_overridden: false,
            coverage_progress: null,
          }
        : current,
    ));

    // Изображения — существующий синхронный путь без изменений.
    if (row.file.type === 'image') {
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
      return;
    }

    // Документы — фоновая coverage-задача (структурно убирает 504) + опрос прогресса.
    this.startDocumentCoverageJob(request);
  }

  /**
   * Запускает фоновую coverage-задачу для документа и опрашивает её статус.
   * page_count для цены НЕ зависит от этой задачи (его даёт count-pages); задача даёт
   * только уточнение тира заливки + прогресс X/N. Провал/исчезновение задачи → держим
   * page_count и помечаем «тир заливки не уточнён», цену НЕ ломаем.
   */
  private startDocumentCoverageJob(request: CoverageRequest): void {
    const jobKey = this.coverageRequestKey(request);
    // ВАЖЕН ПОРЯДОК: сперва гасим прошлую задачу (resetCoverageJobCancel → cancelCoverageJob
    // делает coverageJobKey.delete(msgId)), и лишь ПОТОМ регистрируем ключ нового job.
    // Обратный порядок (как было до фикса) затирал свежий ключ в том же синхронном вызове,
    // и гард в switchMap (coverageJobKey.get(msgId) !== jobKey) всегда давал EMPTY —
    // поллинг /status не стартовал ни разу.
    const cancel$ = this.resetCoverageJobCancel(request.msgId);
    this.coverageJobKey.set(request.msgId, jobKey);

    this.coverageService.startCoverageJob(request.fileUrl, request.paperFormat, {
      fontSizeDeltaPt: request.fontSizeDeltaPt,
      printerId: request.printerId,
      paperSize: request.paperSize,
      borderless: request.borderless,
      colorMode: request.colorMode,
    }).pipe(
      switchMap(start => {
        // Запрос устарел (сменились настройки строки) — игнорируем.
        if (this.coverageJobKey.get(request.msgId) !== jobKey) return EMPTY;
        if (!start) {
          // Старт не удался (например, эндпоинт ещё не задеплоен) — фолбэк на фикс-тир без падения.
          this.applyCoverageResult(request, null);
          return EMPTY;
        }
        return timer(0, 1000).pipe(
          switchMap(() => this.coverageService.getCoverageJob(start.coverage_id)),
          tap(state => this.applyCoverageProgress(request, state)),
          takeWhile(state => state.stage !== 'ready' && state.stage !== 'failed' && state.stage !== 'gone', true),
          // Защита от вечного поллинга: ~600 тиков (10 мин), затем сдаёмся на фикс-тир.
          takeWhile((_state, i) => i < 600, true),
        );
      }),
      takeUntil(cancel$),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: state => {
        if (this.coverageJobKey.get(request.msgId) !== jobKey) return;
        if (state.stage === 'ready' && state.result) {
          this.applyCoverageResult(request, state.result);
        } else if (state.stage === 'failed' || state.stage === 'gone') {
          this.applyCoverageFailure(request);
        }
      },
      error: () => this.applyCoverageFailure(request),
    });
  }

  private coverageRequestKey(request: CoverageRequest): string {
    return [
      request.fileUrl, request.paperFormat, request.paperSize,
      request.printerId, request.colorMode, request.borderless, request.fontSizeDeltaPt,
    ].join('::');
  }

  private resetCoverageJobCancel(msgId: string): Subject<void> {
    this.cancelCoverageJob(msgId);
    const cancel$ = new Subject<void>();
    this.coverageJobCancel.set(msgId, cancel$);
    return cancel$;
  }

  private cancelCoverageJob(msgId: string): void {
    const existing = this.coverageJobCancel.get(msgId);
    if (existing) {
      existing.next();
      existing.complete();
      this.coverageJobCancel.delete(msgId);
    }
    this.coverageJobKey.delete(msgId);
  }

  /** Обновляет прогресс фоновой coverage-задачи (этап + X/N), не трогая цену/page_count. */
  private applyCoverageProgress(request: CoverageRequest, state: CoverageJobState): void {
    if (state.stage === 'ready' || state.stage === 'failed' || state.stage === 'gone') return;
    const total = typeof state.page_count === 'number' && state.page_count > 0 ? state.page_count : 0;
    const done = state.stage === 'analyzing' ? (state.analyzed ?? 0) : 0;
    this.rows.update(rows => rows.map(row => {
      if (!this.matchesCoverageRequest(row, request) || !this.shouldAnalyzeCoverageForRow(row)) return row;
      return { ...row, coverage_progress: { stage: state.stage, done, total } };
    }));
  }

  /** Провал/исчезновение coverage-задачи: держим fixed-тир + page_count, помечаем «тир не уточнён». */
  private applyCoverageFailure(request: CoverageRequest): void {
    this.rows.update(rows => rows.map(row => {
      if (!this.matchesCoverageRequest(row, request) || !this.shouldAnalyzeCoverageForRow(row)) return row;
      return {
        ...row,
        coverage_result: null,
        coverage_loading: false,
        coverage_overridden: false,
        coverage_progress: { stage: 'failed', done: 0, total: 0 },
        price: this.getFixedPriceForRow(row),
      };
    }));
  }

  private matchesCoverageRequest(row: BatchPrintRow, request: CoverageRequest): boolean {
    return row.file.msgId === request.msgId
      && row.file.url === request.fileUrl
      && row.printer_id === request.printerId
      && row.paper_size === request.paperSize
      && row.borderless === request.borderless
      && row.color_mode === request.colorMode
      && (this.isWordDocument(row) ? row.font_size_delta_pt : 0) === request.fontSizeDeltaPt;
  }

  private applyCoverageResult(request: CoverageRequest, result: CoverageResult | null): void {
    this.rows.update(rows => rows.map(row => {
      if (!this.matchesCoverageRequest(row, request) || !this.shouldAnalyzeCoverageForRow(row)) {
        return row;
      }
      const fixedPrice = this.getFixedPriceForRow(row);
      return {
        ...row,
        coverage_result: result,
        coverage_loading: false,
        coverage_overridden: false,
        price: result ? this.toCoveragePriceNumber(result.recommended_price) : fixedPrice,
      };
    }));
  }

  private toCoveragePriceNumber(value: CoveragePrice | number | null | undefined): number {
    if (value == null) return 0;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  knownDocumentPageCount(row: BatchPrintRow): number | null {
    if (row.file.type === 'image') return null;
    // Приоритет: coverage.page_count (точнее, если задача дошла до ready) → быстрый count-pages
    // (row.page_count, источник истины для цены) → длина массива страниц coverage.
    const coveragePageCount = row.coverage_result?.page_count;
    if (typeof coveragePageCount === 'number' && Number.isFinite(coveragePageCount) && coveragePageCount > 0) {
      return Math.round(coveragePageCount);
    }
    if (typeof row.page_count === 'number' && Number.isFinite(row.page_count) && row.page_count > 0) {
      return Math.round(row.page_count);
    }
    const pagesCount = row.coverage_result?.pages?.length ?? 0;
    return pagesCount > 0 ? pagesCount : null;
  }

  /** Документ, число страниц которого ещё считается (count-pages в полёте, результата нет). */
  isPageCountPending(row: BatchPrintRow): boolean {
    if (row.file.type === 'image') return false;
    return this.knownDocumentPageCount(row) === null && row.page_count_loading && !row.page_count_failed;
  }

  /** count-pages упал — число страниц не определено, цену по ×N не финализируем. */
  isPageCountFailed(row: BatchPrintRow): boolean {
    if (row.file.type === 'image') return false;
    return this.knownDocumentPageCount(row) === null && row.page_count_failed;
  }

  selectedDocumentPageCount(row: BatchPrintRow): number {
    if (row.file.type === 'image') return 1;
    const parsed = this.parsePageRangeForRow(row);
    if (!parsed.issue && parsed.pages.length) return parsed.pages.length;
    // Документ: НЕ молчаливый ×1. Если число страниц неизвестно (pending/failed) — 0 (цена
    // не финализируется; шаблон показывает «Читаю документ…»/«не удалось…»).
    return this.knownDocumentPageCount(row) ?? 0;
  }

  rowPageRangeIssue(row: BatchPrintRow): string {
    if (row.file.type === 'image') return '';
    return this.parsePageRangeForRow(row).issue;
  }

  rowBillableLabel(row: BatchPrintRow): string {
    if (row.file.type === 'image') {
      if (this.isLabelMode()) {
        const layout = this.layoutResult();
        const quantity = layout ? this.layoutRepeatCountForRow(row, layout) : this.normalizedLabelQuantity();
        const sheets = layout ? this.layoutSheetsForGroup([row], layout) : 1;
        return `${quantity} шт / ${sheets} ${this.sheetWord(sheets)}`;
      }
      return `${row.copies} ${this.copyWord(row.copies)}`;
    }
    // Документ с неизвестным числом страниц — не показываем «1 стр.»/ложную цену в окне счёта.
    if (this.isPageCountPending(row)) return 'Читаю документ…';
    if (this.isPageCountFailed(row)) return 'не удалось определить число страниц';
    return `${this.selectedDocumentPageCount(row)} стр. × ${row.copies} ${this.copyWord(row.copies)}`;
  }

  rowTotal(row: BatchPrintRow): number {
    const copies = Math.max(1, row.copies);
    const coveragePageTotal = this.coveragePagePriceTotal(row);
    if (row.file.type === 'image') {
      if (this.isLabelMode()) {
        const layout = this.layoutResult();
        const sheets = layout ? this.layoutSheetsForGroup([row], layout) : 1;
        return Math.round(this.layoutSheetUnitPrice(row) * sheets);
      }
      if (coveragePageTotal > 0) {
        return Math.round(coveragePageTotal * copies);
      }
      return Math.round(row.price * copies);
    }

    if (coveragePageTotal > 0) {
      return Math.round(coveragePageTotal * copies);
    }

    // Документ: число страниц неизвестно (pending/failed) → 0 (цену не финализируем как ×1).
    // selectedDocumentPageCount вернёт 0 в этих случаях, поэтому итог честно «—» в шаблоне.
    return Math.round(row.price * this.selectedDocumentPageCount(row) * copies);
  }

  /**
   * Единый предикат «строка оплатобельна» — число печатаемых страниц > 0.
   * selectedDocumentPageCount уже учитывает валидный ручной диапазон (parsePageRangeForRow),
   * поэтому failed-count + диапазон «1-9» делает строку оплатобельной (и показывает цену).
   * Изображение — всегда оплатобельно (его «страница» = 1).
   */
  isRowTotalReady(row: BatchPrintRow): boolean {
    if (row.file.type === 'image') return true;
    return this.selectedDocumentPageCount(row) > 0;
  }

  rowFontStatsLabel(row: BatchPrintRow, stats: CoverageFontStats): string {
    const base = `Шрифты: ${this.formatFontSizes(stats.sizes_pt)} · основной ${this.formatFontSize(stats.primary_pt)} pt`;
    if (row.font_size_delta_pt >= 0) return base;
    const adjusted = stats.sizes_pt.map(size => Math.max(4, size + row.font_size_delta_pt));
    return `${base} · после ${this.formatFontSizes(adjusted)} pt`;
  }

  updateSelectedPageRange(pageRange: string): void {
    this.updateSelectedRow(row => ({ ...row, page_range: pageRange }));
  }

  updateSelectedFontSizeDelta(delta: number): void {
    const nextDelta = Number(delta);
    const normalized = Number.isFinite(nextDelta) ? Math.max(-8, Math.min(0, Math.trunc(nextDelta))) : 0;
    this.updateSelectedRow(row => ({ ...row, font_size_delta_pt: normalized }));
    // Шрифт DOCX меняет пагинацию → пересчитать число страниц (дедуп пропустит, если файл/шрифт те же).
    this.triggerPageCountForRow(this.selectedRowIndex());
    this.triggerCoverageForRow(this.selectedRowIndex());
  }

  isWordDocument(row: BatchPrintRow): boolean {
    if (row.file.type === 'image') return false;
    const name = `${row.file.name} ${row.file.url}`.toLowerCase();
    return /\.(docx|doc)(?:$|[?#\s])/.test(name);
  }

  private parsePageRangeForRow(row: BatchPrintRow): PageRangeParseResult {
    if (row.file.type === 'image') return { pages: [], issue: '' };

    const raw = row.page_range.trim();
    if (!raw) return { pages: [], issue: '' };

    const knownPageCount = this.knownDocumentPageCount(row);
    const pages = new Set<number>();
    for (const chunk of raw.split(',')) {
      const part = chunk.trim();
      if (!part) continue;

      const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        const issue = this.validatePageRangePart(start, end, knownPageCount);
        if (issue) return { pages: [], issue };
        for (let page = start; page <= end; page += 1) pages.add(page);
        continue;
      }

      if (!/^\d+$/.test(part)) {
        return { pages: [], issue: `Некорректные страницы: ${part}` };
      }

      const page = Number(part);
      const issue = this.validatePageRangePart(page, page, knownPageCount);
      if (issue) return { pages: [], issue };
      pages.add(page);
    }

    if (!pages.size) return { pages: [], issue: 'Укажите страницы' };
    return { pages: Array.from(pages).sort((a, b) => a - b), issue: '' };
  }

  private validatePageRangePart(start: number, end: number, knownPageCount: number | null): string {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) {
      return 'Номера страниц должны быть больше 0';
    }
    if (start > end) return 'Начальная страница больше конечной';
    if (!knownPageCount && end - start > 999) return 'Диапазон страниц слишком большой';
    if (knownPageCount && end > knownPageCount) {
      return `В документе ${knownPageCount} стр.`;
    }
    return '';
  }

  private selectedDocumentPages(row: BatchPrintRow): number[] {
    const parsed = this.parsePageRangeForRow(row);
    return parsed.issue ? [] : parsed.pages;
  }

  private coveragePagePriceTotal(row: BatchPrintRow): number {
    if (!row.coverage_result || row.coverage_overridden) return 0;
    const coveragePages = row.coverage_result.pages ?? [];
    if (!coveragePages.length) {
      return this.toCoveragePriceNumber(row.coverage_result.recommended_price);
    }

    const selectedPages = this.selectedDocumentPages(row);
    const selectedSet = selectedPages.length ? new Set(selectedPages) : null;
    const total = coveragePages
      .filter(page => selectedSet === null || selectedSet.has(page.page_number))
      .reduce((sum, page) => sum + this.toCoveragePriceNumber(page.recommended_price), 0);

    return total > 0 ? total : this.toCoveragePriceNumber(row.coverage_result.recommended_price);
  }

  private copyWord(count: number): string {
    const normalized = Math.abs(count) % 100;
    const last = normalized % 10;
    if (normalized > 10 && normalized < 20) return 'копий';
    if (last === 1) return 'копия';
    if (last >= 2 && last <= 4) return 'копии';
    return 'копий';
  }

  sheetWord(count: number): string {
    const normalized = Math.abs(count) % 100;
    const last = normalized % 10;
    if (normalized > 10 && normalized < 20) return 'листов';
    if (last === 1) return 'лист';
    if (last >= 2 && last <= 4) return 'листа';
    return 'листов';
  }

  setLabelQuantity(value: unknown): void {
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    const quantity = Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
    this.labelQuantity.set(Math.max(1, Math.min(1000, quantity)));
  }

  private normalizedLabelQuantity(): number {
    const value = Number(this.labelQuantity());
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(1000, Math.trunc(value)));
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

  applyPresetV2(preset: PrintPreset): void {
    const printers = this.printers();
    this.selectedPresetCategoryId.set(this.presetCategoryId(preset));
    if (this.isBusinessCardPreset(preset)) {
      const target = this.findCanonC3226iPrinter();
      if (!target) {
        this.toast.error('Для визиток нужен Canon C3226i');
        return;
      }
      const mediaType = this.findBusinessCardMediaType(target)
        || this.getDefaultMediaTypeForPaper(target, BUSINESS_CARD_A4_TEMPLATE.paperSize);
      const paperSource = this.findBusinessCardPaperSource(target)
        || this.getDefaultPaperSource(target);

      const photoPresetId = this.businessCardPhotoPresetIdFromPreset(preset);
      const photoPreset = LABEL_PRESETS.find(size => size.id === photoPresetId)
        ?? LABEL_PRESETS.find(size => size.id === 'business-card');
      if (photoPreset) {
        this.selectedPhotoSize.set(photoPreset);
      }
      this.selectedPaperForLayout.set(BUSINESS_CARD_A4_TEMPLATE.paperSize);
      this.cutMargin.set(BUSINESS_CARD_A4_TEMPLATE.cutMarginMm);
      const price = preset.price ?? 0;
      this.rows.update(rows => rows.map(row => ({
        ...row,
        printer_id: target.id,
        paper_size: BUSINESS_CARD_A4_TEMPLATE.paperSize,
        media_type: mediaType,
        paper_source: paperSource,
        quality: preset.quality,
        fit_mode: 'fill' as FitMode,
        borderless: false,
        duplex: false,
        color_mode: 'color' as ColorMode,
        price,
        coverage_result: null,
        coverage_loading: false,
        coverage_overridden: false,
      })));
      this.activePresetId.set(preset.id);
      this.triggerCoverageForRows();
      return;
    }

    const selected = this.selectedRow();
    const current = selected ? this.getPrinterForRow(selected) : undefined;
    const target = current && this.quickPresetMatchesPrinter(preset, current)
      ? current
      : preset.sublimation
        ? printers.find(p => this.isPrinterSublimation(p) && this.quickPresetMatchesPrinter(preset, p))
        : preset.printerType === 'mfp' || preset.printerType === 'document'
          ? printers.find(p => this.isCoveragePrinter(p) && this.quickPresetMatchesPrinter(preset, p))
          : printers.find(p => p.printer_type === 'photo' && !this.isCoveragePrinter(p) && !this.isPrinterSublimation(p) && this.quickPresetMatchesPrinter(preset, p));
    if (!target) return;

    const mediaType = preset.mediaType
      ? this.resolvePrinterMediaTypeId(target, preset.mediaType)
      : this.getDefaultMediaTypeForPaper(target, preset.paperSize);
    const price = this.getPrice(preset.paperSize, target, mediaType);
    this.rows.update(rows => rows.map(r => ({
      ...r,
      printer_id: target.id,
      paper_size: preset.paperSize,
      media_type: mediaType,
      paper_source: this.getDefaultPaperSource(target),
      quality: preset.quality,
      fit_mode: preset.fitMode ?? 'fill',
      borderless: preset.borderless && target.capabilities.borderless,
      duplex: preset.duplex && target.capabilities.duplex,
      color_mode: preset.colorMode ?? 'color',
      price,
      coverage_result: null,
      coverage_loading: false,
      coverage_overridden: false,
    })));
    this.activePresetId.set(preset.id);
    if (this.isCoveragePrinter(target) && (preset.paperSize === 'A4' || preset.paperSize === 'A3')) {
      this.triggerCoverageForRows();
    }
  }

  updateRowPrinter(index: number, printerId: string): void {
    this.rows.update(rows => {
      const updated = [...rows];
      const row = { ...updated[index], printer_id: printerId };
      const printer = this.printers().find(p => p.id === printerId);
      const isPhoto = printer?.printer_type === 'photo';
      const supportsCurrentPaper = printer?.capabilities?.paper_sizes?.some(p => p.id === row.paper_size) ?? false;
      if (printer && !supportsCurrentPaper) {
        row.paper_size = printer.capabilities.paper_sizes[0]?.id ?? row.paper_size;
      }
      row.media_type = this.getDefaultMediaTypeForPaper(printer, row.paper_size);
      row.paper_source = this.getDefaultPaperSource(printer);
      row.fit_mode = isPhoto ? 'fill' : 'fit';
      row.borderless = isPhoto && (printer?.capabilities.borderless ?? false);
      row.quality = this.getDefaultQuality(printer);
      if (printer && !printer.capabilities.color) {
        row.color_mode = 'bw';
      }
      if (printer && !printer.capabilities.duplex) {
        row.duplex = false;
      }
      if (!this.photoEnhanceAvailableForPrinter(row, printer)) {
        row.photo_enhance = false;
      }
      updated[index] = this.withFixedPrice(this.clearCoverage(row));
      return updated;
    });
    this.activePresetId.set(null);
    this.triggerCoverageForRow(index);
  }

  updateRowPaper(index: number, paperSize: string): void {
    this.rows.update(rows => {
      const updated = [...rows];
      const row = { ...updated[index], paper_size: paperSize };
      row.media_type = this.getDefaultMediaTypeForPaper(this.getPrinterForRow(row), paperSize);
      updated[index] = this.withFixedPrice(this.clearCoverage(row));
      return updated;
    });
    this.activePresetId.set(null);
    this.triggerCoverageForRow(index);
  }

  changeCopies(index: number, delta: number): void {
    this.rows.update(rows => {
      const updated = [...rows];
      const row = { ...updated[index] };
      row.copies = Math.max(1, row.copies + delta);
      updated[index] = row;
      return updated;
    });
  }

  removeRow(index: number): void {
    const removed = this.rows()[index];
    if (removed) {
      this.cancelCoverageJob(removed.file.msgId);
      this.pageCountRequestKey.delete(removed.file.msgId);
    }
    this.rows.update(rows => rows.filter((_, i) => i !== index));
    const current = this.selectedRowIndex();
    const nextLength = this.rows().length;
    if (!nextLength) {
      this.selectedRowIndex.set(0);
    } else if (current === index) {
      this.selectedRowIndex.set(Math.min(index, nextLength - 1));
    } else if (current > index) {
      this.selectedRowIndex.set(current - 1);
    }
    this.ensureSelectedImageMetadata();
  }

  selectRow(index: number): void {
    if (index < 0 || index >= this.rows().length) return;
    this.selectedRowIndex.set(index);
    this.ensureSelectedImageMetadata();
    this.ensureSettingsViewAvailable();
  }

  selectPreviousRow(): void {
    this.selectRow(this.selectedRowIndex() - 1);
  }

  selectNextRow(): void {
    this.selectRow(this.selectedRowIndex() + 1);
  }

  setSettingsView(view: string): void {
    if (!this.isSettingsView(view)) return;
    if (view === 'layout') {
      const row = this.selectedRow();
      if (!row || !this.layoutSettingsAvailable(row)) {
        this.settingsView.set('print');
        return;
      }
    }
    this.settingsView.set(view);
  }

  private ensureSettingsViewAvailable(): void {
    const row = this.selectedRow();
    if (this.settingsView() === 'layout' && (!row || !this.layoutSettingsAvailable(row))) {
      this.settingsView.set('print');
    }
  }

  private isSettingsView(view: string): view is SettingsView {
    return view === 'print' || view === 'layout';
  }

  updateSelectedPrinter(printerId: string): void {
    if (this.isBusinessCardSelected()) {
      this.ensureSettingsViewAvailable();
      return;
    }
    this.updateRowPrinter(this.selectedRowIndex(), printerId);
    this.ensureSettingsViewAvailable();
  }

  updateSelectedPaper(paperSize: string): void {
    if (this.isBusinessCardSelected()) {
      return;
    }
    this.updateRowPaper(this.selectedRowIndex(), paperSize);
  }

  updateSelectedMediaType(mediaType: string): void {
    this.updateSelectedRow(row => this.withFixedPrice(this.clearCoverage({ ...row, media_type: mediaType })));
    this.activePresetId.set(null);
    this.triggerCoverageForRow(this.selectedRowIndex());
  }

  updateSelectedPaperSource(paperSource: string): void {
    this.updateSelectedRow(row => ({ ...row, paper_source: paperSource }));
    this.activePresetId.set(null);
  }

  updateSelectedQuality(quality: string): void {
    this.updateRowField(this.selectedRowIndex(), 'quality', quality);
  }

  changeSelectedCopies(delta: number): void {
    this.changeCopies(this.selectedRowIndex(), delta);
  }

  setSelectedBorderless(borderless: boolean): void {
    this.updateRowField(this.selectedRowIndex(), 'borderless', borderless);
  }

  setSelectedDuplex(duplex: boolean): void {
    this.updateRowField(this.selectedRowIndex(), 'duplex', duplex);
  }

  setSelectedColorMode(mode: ColorMode): void {
    this.setColorMode(this.selectedRowIndex(), mode);
  }

  setSelectedPhotoEnhance(enabled: boolean): void {
    this.updateSelectedRow(row => ({
      ...row,
      photo_enhance: this.photoEnhanceAvailable(row) ? enabled : false,
    }));
    this.activePresetId.set(null);
  }

  updateSelectedBrightness(value: string | number): void {
    this.updateSelectedPhotoAdjustment('brightness', value, -40, 40);
  }

  updateSelectedContrast(value: string | number): void {
    this.updateSelectedPhotoAdjustment('contrast', value, -40, 40);
  }

  updateSelectedSaturation(value: string | number): void {
    this.updateSelectedPhotoAdjustment('saturation', value, -60, 60);
  }

  resetSelectedPhotoAdjustments(): void {
    this.updateSelectedRow(row => ({
      ...row,
      photo_enhance: false,
      brightness: 0,
      contrast: 0,
      saturation: 0,
    }));
    this.activePresetId.set(null);
  }

  applySelectedSettingsToAll(): void {
    const selected = this.selectedRow();
    if (!selected) return;

    const selectedMsgId = selected.file.msgId;
    const selectedPhotoEnhance = this.photoEnhanceAvailable(selected) && selected.photo_enhance;

    this.rows.update(rows => rows.map(row => {
      if (row.file.msgId === selectedMsgId) return row;
      const fitChanged = row.fit_mode !== selected.fit_mode;
      const next: BatchPrintRow = {
        ...row,
        printer_id: selected.printer_id,
        paper_size: selected.paper_size,
        media_type: selected.media_type,
        paper_source: selected.paper_source,
        copies: selected.copies,
        font_size_delta_pt: selected.font_size_delta_pt,
        fit_mode: selected.fit_mode,
        borderless: selected.borderless,
        color_mode: selected.color_mode,
        duplex: selected.duplex,
        quality: selected.quality,
        photo_enhance: false,
        brightness: selected.brightness,
        contrast: selected.contrast,
        saturation: selected.saturation,
        crop_rect: selected.fit_mode === 'fill' ? row.crop_rect : null,
        edit_key: fitChanged ? row.edit_key + 1 : row.edit_key,
      };
      next.photo_enhance = this.photoEnhanceAvailable(next) ? selectedPhotoEnhance : false;
      return this.withFixedPrice(this.clearCoverage(next));
    }));
    this.activePresetId.set(null);
    this.rows().forEach((row, index) => {
      if (row.file.msgId !== selectedMsgId) this.triggerCoverageForRow(index);
    });
  }

  cropOverlayFitMode(row: BatchPrintRow): 'fit' | 'fill' {
    return row.fit_mode === 'fill' ? 'fill' : 'fit';
  }

  updateSelectedCrop(cropRect: CropRect): void {
    this.updateSelectedRow(row => ({ ...row, crop_rect: cropRect }));
    this.activePresetId.set(null);
  }

  updateSelectedCropFit(fitMode: 'fit' | 'fill'): void {
    this.updateSelectedRow(row => ({
      ...row,
      fit_mode: fitMode,
      crop_rect: fitMode === 'fill' ? row.crop_rect : null,
      edit_key: row.edit_key + 1,
    }));
    this.activePresetId.set(null);
  }

  updateSelectedFitMode(fitMode: FitMode): void {
    this.updateSelectedRow(row => ({
      ...row,
      fit_mode: fitMode,
      crop_rect: fitMode === 'fill' ? row.crop_rect : null,
      edit_key: row.edit_key + 1,
    }));
    this.activePresetId.set(null);
  }

  rotateSelectedRow(): void {
    this.updateSelectedRow(row => ({ ...row, rotation: this.nextRotation(row.rotation) }));
    this.activePresetId.set(null);
  }

  resetSelectedImage(): void {
    this.updateSelectedRow(row => ({
      ...row,
      rotation: 0,
      crop_rect: null,
      edit_key: row.edit_key + 1,
    }));
    this.activePresetId.set(null);
  }

  cropPercent(cropRect: CropRect): number {
    return Math.round((1 - cropRect.width * cropRect.height) * 100);
  }

  getPaperForRow(row: BatchPrintRow): PaperSize | null {
    return this.getPrinterForRow(row)?.capabilities?.paper_sizes?.find(p => p.id === row.paper_size) ?? null;
  }

  cropPaperWidthForRow(row: BatchPrintRow, paper: PaperSize): number {
    return this.orientedCropPaperSize(row, paper).width;
  }

  cropPaperHeightForRow(row: BatchPrintRow, paper: PaperSize): number {
    return this.orientedCropPaperSize(row, paper).height;
  }

  private orientedCropPaperSize(row: BatchPrintRow, paper: PaperSize): { width: number; height: number } {
    const shortSide = Math.min(paper.width_mm, paper.height_mm);
    const longSide = Math.max(paper.width_mm, paper.height_mm);
    if (shortSide === longSide || row.file.type !== 'image' || !row.image_width || !row.image_height) {
      return { width: paper.width_mm, height: paper.height_mm };
    }

    // Matches print-agent orientation:auto: ordinary image prints are oriented from image proportions.
    return row.image_width > row.image_height
      ? { width: longSide, height: shortSide }
      : { width: shortSide, height: longSide };
  }

  getPaperLabelForRow(row: BatchPrintRow): string {
    return this.getPaperForRow(row)?.name ?? row.paper_size;
  }

  previewImageUrlForRow(row: BatchPrintRow): string {
    return this.previewImageUrls()[row.file.msgId] ?? this.previewAssetUrl(row.file.url);
  }

  previewImageErrorForRow(row: BatchPrintRow): string {
    return this.previewImageErrors()[row.file.msgId] ?? '';
  }

  imagePreviewFilter(row: BatchPrintRow): string {
    const photoEnhance = this.photoEnhanceAvailable(row) && row.photo_enhance;
    const photoBrightness = photoEnhance ? 4 : 0;
    const photoContrast = photoEnhance ? 8 : 0;
    const photoSaturation = photoEnhance ? 12 : 0;
    const brightness = 100 + row.brightness + photoBrightness;
    const contrast = 100 + row.contrast + photoContrast;
    const saturation = 100 + row.saturation + photoSaturation;
    return [
      `brightness(${this.clampNumber(brightness, 60, 144)}%)`,
      `contrast(${this.clampNumber(contrast, 60, 148)}%)`,
      `saturate(${this.clampNumber(saturation, 40, 172)}%)`,
    ].join(' ');
  }

  private previewAssetUrl(url: string): string {
    try {
      const origin = isPlatformBrowser(this.platformId) ? window.location.origin : 'http://localhost';
      const parsed = new URL(url, origin);
      if (!parsed.pathname.startsWith('/media/')) return url;

      parsed.searchParams.set('preview', 'print');
      parsed.searchParams.set('w', '1400');
      if (url.startsWith('/') && parsed.origin === origin) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private updateSelectedPhotoAdjustment(
    field: 'brightness' | 'contrast' | 'saturation',
    value: string | number,
    min: number,
    max: number,
  ): void {
    const normalized = this.normalizeNumericInput(value, min, max);
    this.updateSelectedRow(row => ({ ...row, [field]: normalized }));
    this.activePresetId.set(null);
  }

  private normalizeNumericInput(value: string | number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value.replace(',', '.'));
    return this.clampNumber(Number.isFinite(parsed) ? Math.round(parsed) : 0, min, max);
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private updateSelectedRow(updater: (row: BatchPrintRow) => BatchPrintRow): void {
    const index = this.selectedRowIndex();
    this.rows.update(rows => {
      if (!rows[index]) return rows;
      return rows.map((row, i) => i === index ? updater(row) : row);
    });
  }

  private nextRotation(rotation: RotationDegrees): RotationDegrees {
    switch (rotation) {
      case 0: return 90;
      case 90: return 180;
      case 180: return 270;
      case 270: return 0;
    }
  }

  getPrinterForRow(row: BatchPrintRow): Printer | undefined {
    return this.printers().find(p => p.id === row.printer_id);
  }

  updateRowField<K extends keyof BatchPrintRow>(
    index: number, field: K, value: BatchPrintRow[K],
  ): void {
    this.rows.update(rows => {
      const updated = [...rows];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    this.activePresetId.set(null);
  }

  setColorMode(index: number, mode: ColorMode): void {
    const rows = this.rows();
    if (!rows[index] || rows[index].color_mode === mode) return;
    this.rows.update(rs => {
      const updated = [...rs];
      updated[index] = { ...updated[index], color_mode: mode };
      return updated;
    });
    this.activePresetId.set(null);
    // Цена/тир зависят от цвета (≤15% заливки: ч/б 10₽ ↔ цвет 12₽) — пересчитываем
    // через бэкенд analyze-coverage с выбранным color_mode. Для строк без coverage
    // (не лазер/не A4-A3) triggerCoverageForRow проставит fixed-цену.
    this.triggerCoverageForRow(index);
  }

  getQualityModesForRow(row: BatchPrintRow): { id: string; name: string }[] {
    const printer = this.printers().find(p => p.id === row.printer_id);
    return printer?.capabilities?.quality_modes ?? [];
  }

  qualitySettingsAvailable(row: BatchPrintRow): boolean {
    const printer = this.getPrinterForRow(row);
    if (!printer || this.isCanonC3226i(printer)) return false;
    return this.getQualityModesForRow(row).length > 1;
  }

  getPaperSizesForRow(row: BatchPrintRow): PaperSize[] {
    if (this.isBusinessCardSelected()) {
      const target = this.findCanonC3226iPrinter();
      const paper = target?.capabilities?.paper_sizes?.find(size => size.id === BUSINESS_CARD_A4_TEMPLATE.paperSize);
      return paper ? [paper] : [];
    }
    const printer = this.printers().find(p => p.id === row.printer_id);
    return printer?.capabilities?.paper_sizes ?? [];
  }

  getMediaTypesForRow(row: BatchPrintRow): MediaType[] {
    const printer = this.printers().find(p => p.id === row.printer_id);
    return printer?.capabilities?.media_types ?? [];
  }

  selectedMediaTypeLabel(row: BatchPrintRow): string {
    const media = this.getMediaTypesForRow(row).find(mt => mt.id === row.media_type);
    return media ? this.mediaTypeLabel(row, media) : row.media_type;
  }

  mediaTypeLabel(row: BatchPrintRow, media: MediaType): string {
    return this.formatMediaTypeLabel(this.getPrinterForRow(row), media);
  }

  getPaperSourcesForRow(row: BatchPrintRow): { id: string; name: string }[] {
    const printer = this.printers().find(p => p.id === row.printer_id);
    return printer?.capabilities?.paper_sources ?? [];
  }

  photoEnhanceAvailable(row: BatchPrintRow): boolean {
    return this.photoEnhanceAvailableForPrinter(row, this.getPrinterForRow(row));
  }

  private photoEnhanceAvailableForPrinter(row: BatchPrintRow, printer: Printer | undefined): boolean {
    return row.file.type === 'image' && this.isEpsonPhotoInkjet(printer);
  }

  private isEpsonPhotoInkjet(printer: Printer | undefined): boolean {
    if (!printer || printer.printer_type !== 'photo' || this.isPrinterSublimation(printer)) return false;
    const device = this.normalizeOptionId(`${printer.name} ${printer.cups_printer_name}`);
    return device.includes('epson')
      || device.includes('l805')
      || device.includes('l1800')
      || device.includes('inkjet')
      || device.includes('струй');
  }

  getRowStatus(index: number): PrintRowStatus | undefined {
    return this.printResults()[index]?.status;
  }

  layoutSettingsAvailable(row: BatchPrintRow): boolean {
    return this.photoLayoutControlsAvailable(row)
      || this.labelLayoutControlsAvailable(row);
  }

  photoLayoutControlsAvailable(row: BatchPrintRow): boolean {
    if (row.file.type !== 'image') return false;
    return !this.isCoveragePrinter(this.getPrinterForRow(row));
  }

  labelLayoutControlsAvailable(row: BatchPrintRow): boolean {
    return row.file.type === 'image';
  }

  selectPhotoSize(size: PhotoSizePreset): void {
    this.selectedPhotoSize.set(size);
    if (size.id === 'full') {
      const selected = this.selectedRow();
      this.selectedPaperForLayout.set(selected?.paper_size ?? this.selectedPaperForLayout());
      this.applyImageFitMode('fill');
      return;
    }
    if (size.templateMode === 'polaroid') {
      this.setLayoutPaper('10x15');
      return;
    }
    const paperId = this.findPaperIdForPhotoPreset(size);
    if (paperId) {
      this.setLayoutPaper(paperId);
    }
  }

  selectDocumentSize(size: PhotoSizePreset): void {
    this.selectedPhotoSize.set(size);
    // Document presets: auto-set 10x15, fill mode, 1mm margin
    this.selectedPaperForLayout.set('10x15');
    this.cutMargin.set(1);
    this.applyLayoutPaperToImageRows('10x15');
  }

  selectCollageSize(size: PhotoSizePreset): void {
    this.selectedPhotoSize.set(size);
    // Collage on A4 by default, 10x15 for small collages
    const paper = size.id === '2-on-10x15' ? '10x15' : 'A4';
    this.cutMargin.set(1);
    this.setLayoutPaper(paper);
  }

  selectLabelSize(size: PhotoSizePreset): void {
    if (isBusinessCardPresetId(size.id)) {
      const target = this.findCanonC3226iPrinter();
      if (!target) {
        // Принтер не найден — не переключаемся в режим визитки, иначе UI
        // заблокируется (disabled принтер/формат) без какой-либо настройки.
        this.toast.error('Для визиток нужен Canon C3226i');
        return;
      }
      this.selectedPhotoSize.set(size);
      const mediaType = this.findBusinessCardMediaType(target)
        || this.getDefaultMediaTypeForPaper(target, BUSINESS_CARD_A4_TEMPLATE.paperSize);
      const paperSource = this.findBusinessCardPaperSource(target)
        || this.getDefaultPaperSource(target);

      this.selectedPaperForLayout.set(BUSINESS_CARD_A4_TEMPLATE.paperSize);
      this.cutMargin.set(BUSINESS_CARD_A4_TEMPLATE.cutMarginMm);
      const presetCandidates = this.presets().filter(p =>
        this.isBusinessCardPreset(p) && this.quickPresetMatchesPrinter(p, target),
      );
      const preset = presetCandidates.find(p =>
        this.isBusinessCardPreset(p) && this.businessCardPhotoPresetIdFromPreset(p) === size.id,
      ) ?? presetCandidates.find(p => this.isBusinessCardPreset(p));
      const price = preset?.price ?? 0;
      this.rows.update(rows => rows.map(row => ({
        ...row,
        printer_id: target.id,
        paper_size: BUSINESS_CARD_A4_TEMPLATE.paperSize,
        media_type: mediaType,
        paper_source: paperSource,
        quality: preset?.quality ?? this.getDefaultQuality(target),
        fit_mode: 'fill' as FitMode,
        color_mode: 'color' as ColorMode,
        borderless: false,
        duplex: false,
        price,
        coverage_result: null,
        coverage_loading: false,
        coverage_overridden: false,
      })));
      this.activePresetId.set(preset?.id ?? null);
      this.triggerCoverageForRows();
      return;
    }

    // Labels (этикетки): 2mm достаточно (порезка по одному листу)
    this.selectedPhotoSize.set(size);
    this.selectedPaperForLayout.set('A4');
    this.cutMargin.set(2);
    this.rows.update(rows => rows.map(r => {
      const printer = this.findPrinterForPaper(r, 'A4') ?? this.getPrinterForRow(r);
      const mediaType = this.getDefaultMediaTypeForPaper(printer, 'A4');
      return this.withFixedPrice(this.clearCoverage({
        ...r,
        printer_id: printer?.id ?? r.printer_id,
        paper_size: 'A4',
        media_type: mediaType,
        paper_source: this.getDefaultPaperSource(printer),
        quality: this.getDefaultQuality(printer),
        fit_mode: 'fit' as FitMode,
        color_mode: 'color' as ColorMode, borderless: false,
      }));
    }));
    this.triggerCoverageForRows();
  }

  selectCustomSize(): void {
    this.selectedPhotoSize.set(this.buildCustomPhotoPreset());
    this.cutMargin.set(this.defaultCustomCutMargin(this.customPhotoW(), this.customPhotoH()));
    const paperId = this.minimumLayoutPaperForPhotoSize(this.customPhotoW(), this.customPhotoH())?.id
      ?? this.selectedPaperForLayout();
    this.setLayoutPaper(paperId);
  }

  getSelectedPaper(): PaperSize | null {
    const selectedId = this.selectedPaperForLayout();
    return this.printers()
      .flatMap(p => p.capabilities?.paper_sizes ?? [])
      .find((p: PaperSize) => p.id === selectedId) ?? null;
  }

  getAvailablePapers(): PaperSize[] {
    const byId = new Map<string, PaperSize>();
    for (const printer of this.printers()) {
      for (const paper of printer.capabilities?.paper_sizes ?? []) {
        if (!byId.has(paper.id)) byId.set(paper.id, paper);
      }
    }
    const order = ['10x15', '13x18', '15x20', '15x21', '20x30', 'A5', 'A4', 'A3'];
    return Array.from(byId.values()).sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai >= 0 || bi >= 0) {
        return (ai >= 0 ? ai : Number.MAX_SAFE_INTEGER) - (bi >= 0 ? bi : Number.MAX_SAFE_INTEGER);
      }
      return a.name.localeCompare(b.name, 'ru');
    });
  }

  private getCropParams(row: BatchPrintRow): Partial<Pick<
    CreatePrintJobParams,
    'crop_x' | 'crop_y' | 'crop_width' | 'crop_height' | 'crop_mode'
  >> {
    if (row.file.type !== 'image') return {};

    const cropMode: 'fit' | 'fill' = row.fit_mode === 'fill' ? 'fill' : 'fit';
    if (row.fit_mode !== 'fill' || !row.crop_rect) {
      return { crop_mode: cropMode };
    }

    const width = this.roundCropFraction(row.crop_rect.width);
    const height = this.roundCropFraction(row.crop_rect.height);
    const x = this.roundCropFraction(Math.min(1 - width, row.crop_rect.x));
    const y = this.roundCropFraction(Math.min(1 - height, row.crop_rect.y));

    return {
      crop_mode: cropMode,
      crop_x: x,
      crop_y: y,
      crop_width: width,
      crop_height: height,
    };
  }

  private roundCropFraction(value: number): number {
    const bounded = Math.max(0, Math.min(1, value));
    return Math.round(bounded * 10000) / 10000;
  }

  private sublimationPrinterIds(): Set<string> {
    return new Set(
      this.printers()
        .filter(printer =>
          printer.capabilities?.sublimation
          || printer.capabilities?.media_types?.some(media => media.id === 'ds_transfer'),
        )
        .map(printer => printer.id),
    );
  }

  private rowCoveragePercent(row: BatchPrintRow): number | null {
    const result = row.coverage_result;
    if (!result) return null;

    const selectedPages = this.selectedDocumentPages(row);
    const pages = result.pages ?? [];
    if (selectedPages.length && pages.length) {
      const selectedSet = new Set(selectedPages);
      const selectedCoverage = pages.filter(page => selectedSet.has(page.page_number));
      if (selectedCoverage.length) {
        const average = selectedCoverage.reduce((sum, page) => sum + page.coverage_percent, 0) / selectedCoverage.length;
        return Math.round(average * 100) / 100;
      }
    }

    return result.coverage_percent;
  }

  private buildNormalCartName(row: BatchPrintRow): string {
    const label = this.getPaperLabelForRow(row);
    if (row.coverage_result) {
      return `Печать ${label}: ${row.coverage_result.recommended_name}`;
    }
    return row.file.type === 'image'
      ? `Фото ${label}: ${row.file.name}`
      : `Документ ${label}: ${row.file.name}`;
  }

  private buildNormalCartDescription(row: BatchPrintRow): string {
    const parts = [
      this.getPrinterForRow(row)?.name ?? '',
      this.getPaperLabelForRow(row),
      this.rowBillableLabel(row),
    ];
    if (row.file.type !== 'image' && row.page_range.trim()) {
      parts.push(`стр. ${row.page_range.trim()}`);
    }
    if (this.isWordDocument(row) && row.font_size_delta_pt < 0) {
      parts.push(`шрифт ${row.font_size_delta_pt} pt`);
    }
    const coveragePercent = this.rowCoveragePercent(row);
    if (coveragePercent !== null) {
      parts.push(`заливка ${coveragePercent.toFixed(0)}%`);
    }
    return parts.filter(part => !!part).join(' · ');
  }

  private buildLayoutCartName(group: readonly BatchPrintRow[]): string {
    const first = group[0];
    return `Пакетная печать ${this.getPaperLabelForRow(first)}`;
  }

  private buildLayoutCartDescription(group: readonly BatchPrintRow[], layout: LayoutCalcResult): string {
    const first = group[0];
    const images = group.flatMap(row => this.expandRowForLayout(row, layout));
    const sheets = this.layoutSheetsForGroup(group, layout);
    return [
      this.getPrinterForRow(first)?.name ?? '',
      `${group.length} файлов`,
      `${sheets} лист.`,
      `${images.length} фото`,
    ].filter(part => !!part).join(' · ');
  }

  private layoutBatchTotalForRows(rows: readonly BatchPrintRow[], layout: LayoutCalcResult): number {
    const groups = new Map<string, BatchPrintRow[]>();
    for (const row of rows) {
      if (row.file.type !== 'image' || !row.file.url) continue;
      const key = this.layoutBatchGroupKey(row);
      const group = groups.get(key);
      if (group) {
        group.push(row);
      } else {
        groups.set(key, [row]);
      }
    }
    return Array.from(groups.values()).reduce((sum, group) => sum + this.layoutBatchGroupTotal(group, layout), 0);
  }

  private layoutBatchGroupTotal(group: readonly BatchPrintRow[], layout: LayoutCalcResult): number {
    if (this.isDocumentMode()) {
      return group.reduce((sum, row) => sum + this.rowTotal(row), 0);
    }
    const first = group[0];
    if (!first) return 0;
    return Math.round(this.layoutSheetUnitPrice(first) * this.layoutSheetsForGroup(group, layout));
  }

  private layoutSheetsForGroup(group: readonly BatchPrintRow[], layout: LayoutCalcResult): number {
    const images = group.flatMap(row => this.expandRowForLayout(row, layout));
    return Math.max(1, Math.ceil(images.length / Math.max(1, layout.photosPerSheet)));
  }

  private layoutSheetUnitPrice(row: BatchPrintRow): number {
    return row.price > 0 ? row.price : this.getFixedPriceForRow(row);
  }

  private buildNormalPrintCartEntries(targetRows: BatchPrintRow[], traceId: string): BatchPrintCartEntry[] {
    const isDocMode = this.isDocumentMode();
    const sublimationIds = this.sublimationPrinterIds();

    return targetRows
      .filter(row => row.file.url)
      .map(row => {
        const cropParams = this.getCropParams(row);
        const pages = row.file.type === 'image' ? [] : this.selectedDocumentPages(row);
        const coveragePercent = this.rowCoveragePercent(row);
        const photoEnhance = this.photoEnhanceAvailable(row) && row.photo_enhance;
        const payload: CreatePrintJobParams = {
          printer_id: row.printer_id,
          file_url: row.file.url,
          file_name: row.file.name,
          copies: row.copies,
          paper_size: row.paper_size,
          media_type: row.media_type || undefined,
          ...(row.paper_source && row.paper_source !== 'auto' ? { paper_source: row.paper_source } : {}),
          fit_mode: row.fit_mode,
          rotation: row.rotation,
          borderless: row.borderless,
          color_mode: row.color_mode,
          quality: row.quality,
          duplex: row.duplex,
          order_id: this.data().sessionId,
          order_type: this.data().orderType ?? 'chat',
          price_total: this.rowTotal(row),
          trace_id: traceId,
          ...cropParams,
          ...(pages.length ? { pages, page_range: row.page_range.trim() } : {}),
          ...(this.isWordDocument(row) && row.font_size_delta_pt < 0
            ? { font_size_delta_pt: row.font_size_delta_pt }
            : {}),
          ...(coveragePercent !== null ? { coverage_percent: coveragePercent } : {}),
          ...(this.urgentPrint() ? { priority: 8 } : {}),
          ...(isDocMode ? { rendering_intent: 'absolute_colorimetric' } : {}),
          ...(sublimationIds.has(row.printer_id) ? { mirror: true } : {}),
          ...(row.file.type === 'image' ? {
            photo_enhance: photoEnhance,
            brightness: row.brightness,
            contrast: row.contrast,
            saturation: row.saturation,
          } : {}),
        };
        return {
          name: this.buildNormalCartName(row),
          description: this.buildNormalCartDescription(row),
          price: this.rowTotal(row),
          icon: row.file.type === 'image' ? 'photo_size_select_actual' : 'description',
          request: { mode: 'normal', payload },
        };
      });
  }

  private shouldUseLayoutBatch(targetRows: readonly BatchPrintRow[] = this.rows()): boolean {
    const layout = this.layoutResult();
    if (this.activeTemplateMode() === 'polaroid') return false;
    return !!layout
      && this.shouldUseLayoutSheetForActiveSize(layout)
      && targetRows.length > 0
      && targetRows.every(row => row.file.type === 'image' && !!row.file.url);
  }

  private shouldUseLayoutSheetForActiveSize(_layout: LayoutCalcResult): boolean {
    return this.activeTemplateMode() !== 'none'
      || this.selectedPhotoSize().id === 'custom'
      || this.selectedExactPhotoSizeNeedsSheetLayout();
  }

  layoutSheetPreviewAvailable(layout: LayoutCalcResult): boolean {
    return this.shouldUseLayoutSheetForActiveSize(layout);
  }

  private selectedExactPhotoSizeNeedsSheetLayout(): boolean {
    const preset = this.selectedPhotoSize();
    if (preset.group !== 'photo' || preset.id === 'full' || preset.id === 'custom') return false;
    if (preset.width_mm <= 0 || preset.height_mm <= 0) return false;

    const paper = this.getSelectedPaper();
    if (!paper) return false;
    return !this.photoSizeMatchesPaper(preset.width_mm, preset.height_mm, paper);
  }

  private getSelectedPhotoDimensions(): { width: number; height: number } {
    return this.selectedPhotoDimensions();
  }

  private buildLayoutPreviewPayload(): CreateLayoutBatchParams | null {
    const layout = this.layoutResult();
    if (!layout || !this.sheetLayoutActive()) return null;

    const paper = this.getSelectedPaper();
    const selected = this.selectedRow();
    if (!paper || !selected || selected.file.type !== 'image' || !selected.file.url) return null;

    const groupKey = this.layoutBatchGroupKey(selected);
    const group = this.rows().filter(row =>
      row.file.type === 'image' &&
      !!row.file.url &&
      this.layoutBatchGroupKey(row) === groupKey,
    );
    if (!group.length) return null;

    const first = group[0];
    const photo = this.getSelectedPhotoDimensions();
    const preset = this.selectedPhotoSize();
    const templateMode = this.activeTemplateMode();
    const perSheet = Math.max(1, layout.photosPerSheet);
    const images = group.flatMap(row => this.expandRowForLayout(row, layout)).slice(0, perSheet);
    if (!images.length) return null;

    const sublimation = this.printers()
      .filter(p => p.capabilities?.sublimation || p.capabilities?.media_types?.some(m => m.id === 'ds_transfer'))
      .some(p => p.id === first.printer_id);

    return {
      printer_id: first.printer_id,
      images,
      paper_size: paper.id,
      paper_width_mm: paper.width_mm,
      paper_height_mm: paper.height_mm,
      photo_width_mm: photo.width,
      photo_height_mm: photo.height,
      cut_margin_mm: layout.cutMarginMm,
      cut_marks: this.cutMarksEnabled(),
      ...(templateMode === 'none' ? {} : { template_mode: templateMode }),
      ...(preset.bottomPaddingMm ? { bottom_padding_mm: preset.bottomPaddingMm } : {}),
      photo_preset_id: preset.id,
      color_mode: first.color_mode,
      quality: first.quality,
      media_type: first.media_type || undefined,
      ...(first.paper_source && first.paper_source !== 'auto' ? { paper_source: first.paper_source } : {}),
      borderless: first.borderless,
      ...(sublimation ? { mirror: true } : {}),
    };
  }

  private layoutPreviewRenderCacheKey(payload: CreateLayoutBatchParams): string {
    return JSON.stringify({
      printer_id: payload.printer_id,
      images: payload.images.map(image => ({
        file_url: image.file_url,
        fit_mode: image.fit_mode,
        rotation: image.rotation,
        crop_x: image.crop_x,
        crop_y: image.crop_y,
        crop_width: image.crop_width,
        crop_height: image.crop_height,
        photo_enhance: image.photo_enhance,
        brightness: image.brightness,
        contrast: image.contrast,
        saturation: image.saturation,
      })),
      paper_size: payload.paper_size,
      paper_width_mm: payload.paper_width_mm,
      paper_height_mm: payload.paper_height_mm,
      photo_width_mm: payload.photo_width_mm,
      photo_height_mm: payload.photo_height_mm,
      cut_margin_mm: payload.cut_margin_mm,
      cut_marks: payload.cut_marks,
      template_mode: payload.template_mode,
      bottom_padding_mm: payload.bottom_padding_mm,
      photo_preset_id: payload.photo_preset_id,
      borderless: payload.borderless,
      mirror: payload.mirror,
    });
  }

  private layoutBatchGroupKey(row: BatchPrintRow): string {
    return [
      row.printer_id,
      row.quality,
      row.color_mode,
      row.media_type,
      row.paper_source,
      row.borderless ? 'borderless' : 'framed',
    ].join('|');
  }

  /**
   * Одна фаза загрузки документного превью: запрос рендера → поллинг готовности →
   * показ блоба. Если блоб уже в кэше под этим ключом — показывает мгновенно.
   * Используется дважды: для первой страницы (быстро) и для полной ленты.
   */
  private loadDocumentPreviewPhase(
    request: PreviewRequestParams,
    cacheKey: string,
    requestSeq: number,
    previewRowId: string,
  ): Observable<boolean> {
    const cached = this.documentPreviewCache.get(cacheKey);
    if (cached) {
      if (this.isCurrentDocumentPreviewRequest(requestSeq, previewRowId)) {
        this.rememberDocumentPreviewCacheKey(cacheKey);
        this.documentPreviewUrl.set(cached);
        this.enforceDocumentPreviewCacheLimit(cacheKey);
      }
      return of(true);
    }
    return this.printApi.requestPreview(request).pipe(
      switchMap(response => timer(0, 250).pipe(
        takeWhile((_, index) => index < 240),
        switchMap(() => this.printApi.getPreviewImage(response.preview_id)),
        map(blob => {
          if (!blob) return false;
          if (this.isCurrentDocumentPreviewRequest(requestSeq, previewRowId)) {
            this.setDocumentPreviewBlob(blob, cacheKey);
          }
          return true;
        }),
        takeWhile(done => !done, true),
      )),
    );
  }

  private buildDocumentPreviewRequest(row: BatchPrintRow): PreviewRequestParams {
    const rotation = row.rotation % 360;
    const orientation: 'portrait' | 'landscape' = rotation === 90 || rotation === 270 ? 'landscape' : 'portrait';

    return {
      file_url: this.absoluteFileUrl(row.file.url),
      printer_id: row.printer_id || undefined,
      paper_size: row.paper_size,
      orientation,
      color_mode: row.color_mode,
      quality: row.quality || undefined,
      borderless: row.borderless,
      media_type: row.media_type || undefined,
      fit_mode: row.fit_mode,
      rotation,
      paper_source: row.paper_source && row.paper_source !== 'auto' ? row.paper_source : undefined,
      // Экранное превью (не печать): меньше ширина и dpi → легче блоб (качается в браузер
      // по каналу студии) и быстрее серверный рендер. На качество печати (300 dpi) не влияет.
      preview_width: 1000,
      preview_height: 1300,
      dpi: 120,
      font_size_delta_pt: this.isWordDocument(row) && row.font_size_delta_pt < 0 ? row.font_size_delta_pt : undefined,
    };
  }

  private setDocumentPreviewBlob(blob: Blob, cacheKey: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.removeDocumentPreviewCacheEntry(cacheKey);
    const url = URL.createObjectURL(blob);
    this.documentPreviewObjectUrls.add(url);
    this.documentPreviewCache.set(cacheKey, url);
    this.rememberDocumentPreviewCacheKey(cacheKey);
    this.documentPreviewUrl.set(url);
    this.documentPreviewError.set(null);
    this.enforceDocumentPreviewCacheLimit(cacheKey);
  }

  private clearDocumentPreviewUrl(): void {
    this.documentPreviewUrl.set(null);
  }

  private isCurrentDocumentPreviewRequest(requestSeq: number, rowId: string): boolean {
    return requestSeq === this.documentPreviewRequestSeq && this.selectedRow()?.file.msgId === rowId;
  }

  private documentPreviewCacheKey(request: PreviewRequestParams): string {
    return JSON.stringify(request);
  }

  private rememberDocumentPreviewCacheKey(cacheKey: string): void {
    const index = this.documentPreviewCacheOrder.indexOf(cacheKey);
    if (index >= 0) this.documentPreviewCacheOrder.splice(index, 1);
    this.documentPreviewCacheOrder.push(cacheKey);
  }

  private enforceDocumentPreviewCacheLimit(protectedKey?: string): void {
    while (this.documentPreviewCacheOrder.length > this.maxDocumentPreviewCacheEntries) {
      const candidate = this.documentPreviewCacheOrder.find(key => key !== protectedKey);
      if (!candidate) return;
      this.removeDocumentPreviewCacheEntry(candidate);
    }
  }

  private removeDocumentPreviewCacheEntry(cacheKey: string): void {
    const url = this.documentPreviewCache.get(cacheKey);
    this.documentPreviewCache.delete(cacheKey);

    const orderIndex = this.documentPreviewCacheOrder.indexOf(cacheKey);
    if (orderIndex >= 0) this.documentPreviewCacheOrder.splice(orderIndex, 1);

    if (!url) return;
    if (this.documentPreviewUrl() === url) {
      this.documentPreviewUrl.set(null);
    }
    if (isPlatformBrowser(this.platformId)) {
      URL.revokeObjectURL(url);
    }
    this.documentPreviewObjectUrls.delete(url);
  }

  private absoluteFileUrl(url: string): string {
    if (!isPlatformBrowser(this.platformId)) return url;
    try {
      return new URL(url, window.location.origin).toString();
    } catch {
      return url;
    }
  }

  private setLayoutPreviewBlob(blob: Blob): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.clearLayoutPreviewUrl();
    const url = URL.createObjectURL(blob);
    this.layoutPreviewObjectUrls.add(url);
    this.layoutPreviewUrl.set(url);
  }

  private clearLayoutPreviewUrl(): void {
    const current = this.layoutPreviewUrl();
    if (!current) return;
    if (isPlatformBrowser(this.platformId)) {
      URL.revokeObjectURL(current);
      this.layoutPreviewObjectUrls.delete(current);
    }
    this.layoutPreviewUrl.set(null);
  }

  private buildLayoutBatchCartEntries(targetRows: BatchPrintRow[]): BatchPrintCartEntry[] {
    const layout = this.layoutResult();
    if (!layout || !this.shouldUseLayoutSheetForActiveSize(layout)) return [];

    const groups = new Map<string, BatchPrintRow[]>();
    for (const row of targetRows) {
      if (row.file.type !== 'image' || !row.file.url) continue;
      const key = this.layoutBatchGroupKey(row);
      const group = groups.get(key);
      if (group) {
        group.push(row);
      } else {
        groups.set(key, [row]);
      }
    }

    const paper = this.getSelectedPaper();
    if (!paper) return [];
    const photo = this.getSelectedPhotoDimensions();
    const preset = this.selectedPhotoSize();
    const templateMode = this.activeTemplateMode();
    const sublimationIds = this.sublimationPrinterIds();

    return Array.from(groups.values()).map(group => {
      const first = group[0];
      const images = group.flatMap(row => this.expandRowForLayout(row, layout));
      const payload: CreateLayoutBatchParams = {
        printer_id: first.printer_id,
        images,
        paper_size: paper.id,
        paper_width_mm: paper.width_mm,
        paper_height_mm: paper.height_mm,
        photo_width_mm: photo.width,
        photo_height_mm: photo.height,
        cut_margin_mm: layout.cutMarginMm,
        cut_marks: this.cutMarksEnabled(),
        ...(templateMode === 'none' ? {} : { template_mode: templateMode }),
        ...(preset.bottomPaddingMm ? { bottom_padding_mm: preset.bottomPaddingMm } : {}),
        photo_preset_id: preset.id,
        order_id: this.data().sessionId,
        order_type: this.data().orderType ?? 'chat',
        color_mode: first.color_mode,
        quality: first.quality,
        media_type: first.media_type || undefined,
        ...(first.paper_source && first.paper_source !== 'auto' ? { paper_source: first.paper_source } : {}),
        borderless: first.borderless,
        price_total: this.layoutBatchGroupTotal(group, layout),
        ...(this.urgentPrint() ? { priority: 8 } : {}),
        ...(sublimationIds.has(first.printer_id) ? { mirror: true } : {}),
      };
      return {
        name: this.buildLayoutCartName(group),
        description: this.buildLayoutCartDescription(group, layout),
        price: payload.price_total ?? this.layoutBatchGroupTotal(group, layout),
        icon: 'dashboard_customize',
        request: { mode: 'layout-batch', payload },
      };
    });
  }

  private expandRowForLayout(row: BatchPrintRow, layout: LayoutCalcResult): LayoutBatchImageParams[] {
    const cropParams = this.getCropParams(row);
    const image: LayoutBatchImageParams = {
      file_url: row.file.url,
      fit_mode: row.fit_mode,
      rotation: row.rotation,
      photo_enhance: this.photoEnhanceAvailable(row) && row.photo_enhance,
      brightness: row.brightness,
      contrast: row.contrast,
      saturation: row.saturation,
      ...(cropParams.crop_x != null ? { crop_x: cropParams.crop_x } : {}),
      ...(cropParams.crop_y != null ? { crop_y: cropParams.crop_y } : {}),
      ...(cropParams.crop_width != null ? { crop_width: cropParams.crop_width } : {}),
      ...(cropParams.crop_height != null ? { crop_height: cropParams.crop_height } : {}),
    };
    const repeat = this.layoutRepeatCountForRow(row, layout);
    return Array.from({ length: Math.max(1, repeat) }, () => ({ ...image }));
  }

  private layoutRepeatCountForRow(row: BatchPrintRow, layout: LayoutCalcResult): number {
    const copies = Math.max(1, row.copies);
    if (this.isLabelMode()) {
      return this.normalizedLabelQuantity() * copies;
    }
    if (this.isDocumentMode()) {
      return copies * Math.max(1, layout.photosPerSheet);
    }
    return copies;
  }

  submitPrintAction(): void {
    const disabledReason = this.printDisabledReason();
    if (disabledReason) {
      this.toast.error(disabledReason);
      return;
    }
    const rows = this.rows();
    if (!rows.length) return;
    this.printing.set(true);
    this.printResults.set({});

    const isPolaroid = this.selectedPhotoSize()?.templateMode === 'polaroid';

    if (isPolaroid) {
      const urls = rows
        .filter(r => r.file.type === 'image' && r.file.url)
        .map(r => r.file.url);
      this.printApi.generatePolaroidBatch(urls).subscribe({
        next: batch => {
          const urlMap = new Map(batch.results.map(r => [r.originalUrl, r.url]));
          const polaroidRows = rows.map(r => {
            if (r.file.type !== 'image') return r;
            const printer = this.getPrinterForRow(r);
            const paperSize = this.getPreferredPaperSize(printer, '10x15');
            const mediaType = this.getDefaultMediaTypeForPaper(printer, paperSize);
            const next: BatchPrintRow = {
              ...r,
              file: { ...r.file, url: urlMap.get(r.file.url) || r.file.url },
              paper_size: paperSize,
              media_type: mediaType,
              fit_mode: 'fill' as FitMode,
              borderless: printer?.printer_type === 'photo' && (printer.capabilities.borderless ?? false),
              crop_rect: null,
              rotation: 0,
              photo_enhance: false,
              brightness: 0,
              contrast: 0,
              saturation: 0,
            };
            return this.withFixedPrice(this.clearCoverage(next));
          });
          this.completePrintAction(polaroidRows);
        },
        error: () => {
          this.printing.set(false);
          this.toast.error('Не удалось сгенерировать Polaroid');
        },
      });
      return;
    }

    this.completePrintAction(rows);
  }

  cancel(): void {
    this.finish();
  }

  private closeWithPrintCartItems(rows: BatchPrintRow[]): void {
    const entries = this.buildDeferredPrintCartEntries(rows, this.createBatchTraceId());
    if (!entries.length) {
      this.printing.set(false);
      this.toast.error('Нет файлов для печати');
      return;
    }

    const cartItems = entries.map((entry, index) => this.buildPrintCartItem(entry, index));
    const cuttingItem = this.buildCustomCuttingCartItem(rows);
    if (cuttingItem) {
      cartItems.push(cuttingItem);
    }
    this.printing.set(false);
    this.finish({ cartItems, queuedCount: entries.length });
  }

  private completePrintAction(rows: BatchPrintRow[]): void {
    if (this.directPrintMode()) {
      this.sendPrintJobs(rows);
      return;
    }
    this.closeWithPrintCartItems(rows);
  }

  private sendPrintJobs(rows: BatchPrintRow[]): void {
    const entries = this.buildDeferredPrintCartEntries(rows, this.createBatchTraceId());
    if (!entries.length) {
      this.printing.set(false);
      this.toast.error('Нет файлов для печати');
      return;
    }

    let printedCount = 0;
    from(entries.map(entry => ({ entry, rowIndexes: this.rowIndexesForEntry(entry, rows) }))).pipe(
      concatMap(({ entry, rowIndexes }) => this.createPrintJobsForEntry(entry).pipe(
        tap(count => {
          printedCount += count;
          this.markPrintRows(rowIndexes, 'completed');
        }),
        catchError(error => {
          this.markPrintRows(rowIndexes, 'failed');
          return throwError(() => error);
        }),
      )),
      toArray(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.printing.set(false);
        this.refreshQueueMonitor();
        this.toast.success(`Отправлено в печать: ${printedCount}`);
        this.finish({ printed: true, printedCount, queuedCount: printedCount });
      },
      error: () => {
        this.printing.set(false);
        this.toast.error('Не удалось отправить пакет в печать');
      },
    });
  }

  private createPrintJobsForEntry(entry: BatchPrintCartEntry) {
    if (entry.request.mode === 'layout-batch') {
      return this.printApi.createLayoutBatchJobs(entry.request.payload).pipe(
        map(result => Math.max(1, result.jobs.length)),
      );
    }
    return this.printApi.createPrintJob(entry.request.payload).pipe(
      map(() => 1),
    );
  }

  private finish(result?: BatchPrintDialogResult): void {
    if (this.dialogRef) {
      this.dialogRef.close(result);
      return;
    }
    if (result) {
      this.inlineResult.emit(result);
    }
  }

  private rowIndexesForEntry(entry: BatchPrintCartEntry, rows: readonly BatchPrintRow[]): number[] {
    if (entry.request.mode === 'normal') {
      const url = entry.request.payload.file_url;
      return rows
        .map((row, index) => row.file.url === url ? index : -1)
        .filter(index => index >= 0);
    }

    const urls = new Set(entry.request.payload.images.map(image => image.file_url));
    return rows
      .map((row, index) => urls.has(row.file.url) ? index : -1)
      .filter(index => index >= 0);
  }

  private markPrintRows(indexes: readonly number[], status: PrintRowStatus): void {
    if (!indexes.length) return;
    this.printResults.update(current => {
      const next: Record<number, PrintRowResult | undefined> = { ...current };
      for (const index of indexes) {
        next[index] = { status };
      }
      return next;
    });
  }

  private buildDeferredPrintCartEntries(rows: BatchPrintRow[], traceId: string): BatchPrintCartEntry[] {
    const useLayoutBatch = this.shouldUseLayoutBatch(rows);
    const buckets = this.splitRowsIfNeeded(rows);
    if (useLayoutBatch) {
      return buckets.flatMap(bucket => this.buildLayoutBatchCartEntries(bucket));
    }
    return buckets.flatMap(bucket => this.buildNormalPrintCartEntries(bucket, traceId));
  }

  private createBatchTraceId(): string {
    if (isPlatformBrowser(this.platformId) && globalThis.crypto?.randomUUID) {
      return `batch-print:${globalThis.crypto.randomUUID()}`;
    }
    return `batch-print:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private splitRowsIfNeeded(rows: BatchPrintRow[]): BatchPrintRow[][] {
    if (!this.splitEnabled()) return [rows];
    const group = this.printerGroups()[0];
    if (!group || group.printers.length < 2) return [rows];
    return splitJobsRoundRobin(rows, group.printers.map(p => p.id));
  }

  private buildCustomCuttingCartItem(rows: readonly BatchPrintRow[]): SyncCartItem | null {
    const quantity = this.customCuttingQuantityForRows(rows);
    if (quantity <= 0) return null;

    const service = this.customCuttingService();
    const unitPrice = this.customCuttingUnitPrice();
    if (!service || unitPrice <= 0) return null;

    const sizeLabel = this.customPhotoSizeLabel();
    const now = Date.now();
    return {
      serviceId: `custom-photo-cutting-${service.id}-${now}`,
      serviceOptionId: service.id,
      name: `${service.name || 'Резка'} ${sizeLabel}`,
      description: `Нестандартный размер, 1 резка на фото`,
      price: unitPrice,
      quantity,
      icon: service.icon ?? 'content_cut',
      metadata: {
        kind: 'custom-photo-cutting',
        source: 'batch-print-dialog',
        sizeLabel,
        widthMm: this.customPhotoW(),
        heightMm: this.customPhotoH(),
        createdAt: new Date(now).toISOString(),
      },
    };
  }

  private buildPrintCartItem(entry: BatchPrintCartEntry, index: number): SyncCartItem {
    return {
      serviceId: `print-queue-${Date.now()}-${index}`,
      name: entry.name,
      description: entry.description,
      price: entry.price,
      quantity: 1,
      icon: entry.icon,
      metadata: {
        kind: 'print-job',
        source: 'batch-print-dialog',
        printRequest: entry.request,
        createdAt: new Date().toISOString(),
      },
    };
  }
}
