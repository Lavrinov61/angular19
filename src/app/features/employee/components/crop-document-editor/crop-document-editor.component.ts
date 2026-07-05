import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  ElementRef,
  viewChild,
  DestroyRef,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { AiRetouchJobsService } from '../../../../core/services/ai-retouch-jobs.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { computeCropPlan } from '../../../../shared/utils/crop-geometry';
import {
  groupRetouchOptions,
  type RetouchOptionGroupView,
  type RetouchOptionLike,
} from '../../../../shared/utils/retouch-options.util';
import type {
  CropPlan,
  CropWarning,
  DocumentCropPreset,
  DocumentPresetOption,
} from '../../../../core/models/ai-retouch.models';
import {
  addReferenceToActiveItem,
  createInitialWorkspaceState,
  createWorkItemFromAsset,
  getActiveWorkItem,
  getAssetById,
  removeReferenceFromActiveItem,
  setActiveWorkItem,
  updateActivePrompt,
  updateActiveResult,
  type PhotoWorkspaceAsset,
  type PhotoWorkspaceAssetSource,
  type PhotoWorkspaceState,
  type PhotoWorkspaceWorkItem,
} from './photo-workspace-state';

/** Данные, передаваемые в диалог из галереи согласования. */
export interface CropDocumentEditorData {
  photoUrl: string;
  sessionId: string;
  photoId?: string;
  resultMode?: 'approval_photo' | 'work_result';
  assets?: readonly PhotoWorkspaceAsset[];
  clientWishes?: string;
  retouchLevelLabel?: string;
  retouchOptions?: readonly RetouchOptionLike[];
  onOriginalSaved?: () => void;
}

/** Результат закрытия диалога. */
export interface CropDocumentEditorResult {
  applied: boolean;
  resultPhotoId?: string | null;
  resultUrl?: string | null;
  savedAsOriginal?: boolean;
}

/**
 * Фронт-зеркало геометрии пресетов. Используется для ЖИВОГО превью рамки в редакторе.
 * Боевая геометрия кадрирования грузится бэком из `document_crop_presets` по `documentType`
 * (граница доверия). Здесь — только для предрасчёта рамки/warnings.
 */
const PASSPORT_RF_PRESET: DocumentCropPreset = {
  photoWmm: 35,
  photoHmm: 45,
  topMarginMm: 5,
  headHeightMm: 32,
  dpi: 800,
  jpegQuality: 92,
};

const VISA_SCHENGEN_PRESET: DocumentCropPreset = {
  photoWmm: 35,
  photoHmm: 45,
  topMarginMm: 3,
  headHeightMm: 32,
  dpi: 800,
  jpegQuality: 92,
};

const PHOTO_3X4_PRESET: DocumentCropPreset = {
  photoWmm: 30,
  photoHmm: 40,
  topMarginMm: 3,
  headHeightMm: 26,
  dpi: 800,
  jpegQuality: 92,
};

/** Опции селектора документа. */
const DOCUMENT_OPTIONS: readonly (DocumentPresetOption & { preset: DocumentCropPreset })[] = [
  {
    slug: 'passport_rf',
    label: 'Паспорт РФ 35×45',
    aspectRatio: PASSPORT_RF_PRESET.photoWmm / PASSPORT_RF_PRESET.photoHmm,
    preset: PASSPORT_RF_PRESET,
  },
  {
    slug: 'visa_schengen',
    label: 'Виза Шенген 35×45',
    aspectRatio: VISA_SCHENGEN_PRESET.photoWmm / VISA_SCHENGEN_PRESET.photoHmm,
    preset: VISA_SCHENGEN_PRESET,
  },
  {
    slug: 'photo_3x4',
    label: 'Фото 3×4',
    aspectRatio: PHOTO_3X4_PRESET.photoWmm / PHOTO_3X4_PRESET.photoHmm,
    preset: PHOTO_3X4_PRESET,
  },
];

type DragLine = 'crown' | 'chin' | 'center' | null;

/** Минимальный зазор макушка↔подбородок в px оригинала (анти-вырождение). */
const MIN_FACE_GAP_PX = 10;
const MAX_ROTATION_DEG = 10;

/**
 * Редактор «Кадрирование под документ» (`crop_document`).
 *
 * Открывается как `MatDialog`. Рендерит фото в `<img>` и три перетаскиваемые линии
 * поверх (CSS/DOM, НЕ `<canvas>`): синяя «Макушка» (crownY), зелёная «Подбородок»
 * (chinY), жёлтая вертикальная «Центр» (centerX). Координаты — в px ОРИГИНАЛА,
 * маппинг в проценты контейнера. По каждому перетаскиванию строит живой план через
 * `computeCropPlan` и рисует рамку 35×45 + затемнение вне рамки + warnings в мм.
 * По «Применить» создаёт job операции `crop_document` и поллит результат.
 */
@Component({
  selector: 'app-crop-document-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <section class="cde-workspace">
      <header class="cde-workspace-header">
        <div class="cde-title">
          <mat-icon>crop</mat-icon>
          <div>
            <h2>Кадрировать под документ</h2>
            <p>{{ activeAsset()?.name || 'Фото' }}</p>
          </div>
        </div>
        <button mat-icon-button type="button" (click)="cancel()" [disabled]="applying()" matTooltip="Закрыть">
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <div class="cde-work-item-tabs">
        @for (item of workspace().workItems; track item.id) {
          <button
            type="button"
            class="cde-work-tab"
            [class.is-active]="item.id === workspace().activeWorkItemId"
            (click)="activateWorkItem(item.id)">
            <mat-icon>{{ item.resultUrl ? 'check_circle' : 'photo' }}</mat-icon>
            <span>{{ item.label }}</span>
          </button>
        }
      </div>

      <div class="cde-workspace-body">
        <aside class="cde-assets-panel">
          <h3>Фото</h3>
          <div class="cde-asset-list">
            @for (asset of workspace().assets; track asset.id) {
              <div
                class="cde-asset"
                [class.is-main]="isMainAsset(asset)"
                [class.is-reference]="isReferenceAsset(asset)">
                <button type="button" class="cde-asset-preview" (click)="makeMainPhoto(asset)">
                  <img [src]="asset.thumbnailUrl || asset.url" [alt]="asset.name" loading="lazy" />
                  <span class="cde-asset-source">
                    <mat-icon>{{ sourceIcon(asset.source) }}</mat-icon>
                    {{ sourceLabel(asset) }}
                  </span>
                  <span class="cde-asset-name">{{ asset.name }}</span>
                </button>
                <button
                  type="button"
                  class="cde-reference-toggle"
                  (click)="toggleReference(asset)"
                  [disabled]="activeWorkItem()?.sourceAssetId === asset.id">
                  <mat-icon>{{ isReferenceAsset(asset) ? 'remove_circle' : 'add_circle' }}</mat-icon>
                  {{ isReferenceAsset(asset) ? 'Убрать' : 'Референс' }}
                </button>
              </div>
            }
          </div>
        </aside>

        <main class="cde-editor-panel">
          <div class="cde-toolbar">
            <mat-select
              class="cde-doc-select"
              [value]="documentType()"
              (selectionChange)="onDocumentChange($event.value)"
              [disabled]="applying()">
              @for (opt of documentOptions; track opt.slug) {
                <mat-option [value]="opt.slug">{{ opt.label }}</mat-option>
              }
            </mat-select>

            <button
              mat-stroked-button
              class="cde-auto-btn"
              (click)="runAutoDetect()"
              [disabled]="detecting() || applying() || !imageReady()"
              matTooltip="Повторно определить линии лица">
              <mat-icon>auto_fix_high</mat-icon>
              Авто
            </button>

            <button
              mat-icon-button
              type="button"
              class="cde-tool-toggle"
              [class.is-active]="gridEnabled()"
              (click)="toggleGrid()"
              matTooltip="Сетка горизонта">
              <mat-icon>grid_4x4</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              class="cde-tool-toggle"
              [class.is-active]="contrastLines()"
              (click)="toggleContrastLines()"
              matTooltip="Контрастные линии">
              <mat-icon>contrast</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              class="cde-tool-toggle"
              [class.is-active]="thirdsEnabled()"
              (click)="toggleThirds()"
              matTooltip="Сетка 1/3">
              <mat-icon>grid_3x3</mat-icon>
            </button>
          </div>

          <div class="cde-rotation">
            <mat-icon>rotate_right</mat-icon>
            <label for="cde-rotation-range">Наклон</label>
            <input
              id="cde-rotation-range"
              type="range"
              min="-10"
              max="10"
              step="0.1"
              [value]="rotationDeg()"
              (input)="onRotationInput($event)"
              [disabled]="applying()" />
            <span>{{ rotationDeg().toFixed(1) }}°</span>
          </div>

          <div class="cde-stage" #stage>
            <div
              class="cde-workarea"
              #canvas
              [style.aspect-ratio]="canvasAspect()">
              <img
                class="cde-img"
                [src]="activePhotoUrl()"
                [style.transform]="imageTransform()"
                draggable="false"
                (load)="onImageLoad($event)"
                (error)="onImageError()"
                alt="Фото для кадрирования" />

              @if (imageReady() && gridEnabled()) {
                <div class="cde-grid" [class.cde-grid-contrast]="contrastLines()">
                  @for (pct of gridPercents; track pct) {
                    <span class="cde-grid-line cde-grid-line-h" [style.top.%]="pct"></span>
                    <span class="cde-grid-line cde-grid-line-v" [style.left.%]="pct"></span>
                  }
                  @if (thirdsEnabled()) {
                    @for (pct of thirdsPercents; track pct) {
                      <span class="cde-grid-line cde-grid-line-third-h" [style.top.%]="pct"></span>
                      <span class="cde-grid-line cde-grid-line-third-v" [style.left.%]="pct"></span>
                    }
                  }
                </div>
              }

              @if (imageReady() && plan()) {
                <div class="cde-shade cde-shade-top" [style.height.%]="frame().top"></div>
                <div class="cde-shade cde-shade-bottom" [style.height.%]="100 - frame().top - frame().height"></div>
                <div
                  class="cde-shade cde-shade-left"
                  [style.top.%]="frame().top"
                  [style.height.%]="frame().height"
                  [style.width.%]="frame().left"></div>
                <div
                  class="cde-shade cde-shade-right"
                  [style.top.%]="frame().top"
                  [style.height.%]="frame().height"
                  [style.width.%]="100 - frame().left - frame().width"></div>

                <div
                  class="cde-frame"
                  [style.top.%]="frame().top"
                  [style.left.%]="frame().left"
                  [style.width.%]="frame().width"
                  [style.height.%]="frame().height"></div>
              }

              @if (imageReady()) {
                <div
                  class="cde-line cde-line-crown"
                  [style.top.%]="crownPct()"
                  (pointerdown)="onLineDown($event, 'crown')">
                  <span class="cde-line-label">Макушка</span>
                </div>
                <div
                  class="cde-line cde-line-chin"
                  [style.top.%]="chinPct()"
                  (pointerdown)="onLineDown($event, 'chin')">
                  <span class="cde-line-label">Подбородок</span>
                </div>
                <div
                  class="cde-vline cde-vline-center"
                  [style.left.%]="centerPct()"
                  (pointerdown)="onLineDown($event, 'center')">
                  <span class="cde-vline-label">Центр</span>
                </div>
              }

              @if (detecting()) {
                <div class="cde-overlay">
                  <mat-spinner diameter="36" />
                  <span>Определяю линии лица…</span>
                </div>
              }
            </div>
          </div>

          <div class="cde-editor-footer">
            <div>
              <p class="cde-status">{{ statusText() }}</p>
              <p class="cde-hint">Макушку ИИ оценивает приблизительно — поправьте линию.</p>
            </div>
            <div class="cde-footer-actions">
              @if (applyError()) {
                <button mat-stroked-button color="warn" (click)="apply()" [disabled]="applying()">
                  <mat-icon>refresh</mat-icon>
                  Повторить
                </button>
              }
              <button
                mat-flat-button
                color="primary"
                (click)="apply()"
                [disabled]="applying() || !imageReady()">
                @if (applying()) {
                  <mat-spinner diameter="18" class="cde-btn-spinner" />
                  Кадрирую…
                } @else {
                  Кадрировать
                }
              </button>
            </div>
          </div>

          @if (warnings().length) {
            <ul class="cde-warnings">
              @for (w of warnings(); track w.code) {
                <li><mat-icon>info</mat-icon> {{ warningText(w) }}</li>
              }
            </ul>
          }

          @if (applyError()) {
            <p class="cde-error"><mat-icon>error</mat-icon> {{ applyError() }}</p>
          }
        </main>

        <aside class="cde-controls-panel">
          <section class="cde-panel-section">
            <h3>Референсы</h3>
            @if (activeReferences().length) {
              <div class="cde-reference-list">
                @for (asset of activeReferences(); track asset.id) {
                  <img [src]="asset.thumbnailUrl || asset.url" [alt]="asset.name" />
                }
              </div>
            } @else {
              <p class="cde-empty">Референсы не выбраны</p>
            }
          </section>

          <section class="cde-panel-section">
            <h3>Пожелания клиента</h3>
            <p class="cde-client-wishes">{{ data.clientWishes || 'Нет пожеланий' }}</p>
          </section>

          @if (data.retouchLevelLabel || retouchOptionGroups().length) {
            <section class="cde-panel-section">
              <h3>Варианты обработки</h3>
              @if (data.retouchLevelLabel) {
                <div class="cde-retouch-level">
                  <mat-icon>auto_fix_high</mat-icon>
                  <span>{{ data.retouchLevelLabel }}</span>
                </div>
              }
              @if (retouchOptionGroups().length) {
                <div class="cde-retouch-groups">
                  @for (group of retouchOptionGroups(); track group.key) {
                    <div class="cde-retouch-group">
                      @if (group.name) {
                        <div class="cde-retouch-group-name">{{ group.name }}</div>
                      }
                      <div class="cde-retouch-chips">
                        @for (item of group.items; track item.key) {
                          <span class="cde-retouch-chip">{{ item.label }}</span>
                        }
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <p class="cde-empty">Детализация обработки не выбрана</p>
              }
            </section>
          }

          <section class="cde-panel-section">
            <h3>Промпт сотрудника</h3>
            <textarea
              class="cde-prompt"
              [value]="activeWorkItem()?.employeePrompt || ''"
              (input)="onPromptInput($event)"
              placeholder="Например: аккуратно перенести очки с референса, сохранить пропорции лица"></textarea>
          </section>

          @if (activeWorkItem()?.resultUrl; as resultUrl) {
            <section class="cde-panel-section cde-result">
              <div class="cde-result-head">
                <mat-icon>crop</mat-icon>
                <span>Кадрированный файл готов для {{ activeWorkItem()?.label }}</span>
              </div>
              <a [href]="resultUrl" target="_blank" rel="noopener">
                <img [src]="resultUrl" alt="Кадрированный результат" />
              </a>
              <div class="cde-result-actions">
                <button mat-stroked-button (click)="downloadResult()">
                  <mat-icon>download</mat-icon>
                  Скачать
                </button>
                <button
                  mat-flat-button
                  color="primary"
                  (click)="saveAsOriginal()"
                  [disabled]="savingOriginal() || !!activeWorkItem()?.savedAsOriginal">
                  @if (savingOriginal()) {
                    <mat-spinner diameter="18" class="cde-btn-spinner" />
                  } @else {
                    <mat-icon>{{ activeWorkItem()?.savedAsOriginal ? 'check' : 'image' }}</mat-icon>
                  }
                  <span>{{ savingOriginal() ? 'Сохраняю…' : activeWorkItem()?.savedAsOriginal ? 'В исходнике' : 'Сохранить как исходник' }}</span>
                </button>
              </div>
            </section>
          }
        </aside>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      height: calc(100vh - 32px);
      overflow: hidden;
      background: #181818;
      color: #f3f4f6;
    }

    .cde-workspace {
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: calc(100vh - 32px);
      min-height: 620px;
      background: #181818;
      color: #f3f4f6;
    }

    .cde-workspace-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: #1c1c1c;
    }

    .cde-title {
      display: flex; align-items: center; gap: 8px;
      mat-icon { color: var(--crm-accent, #5b8def); }
      h2 { margin: 0; font-size: 22px; line-height: 1.15; font-weight: 700; }
      p { margin: 3px 0 0; font-size: 12px; color: #a3a3a3; }
    }

    .cde-work-item-tabs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: #171717;
    }

    .cde-work-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.04);
      color: #d4d4d4;
      cursor: pointer;
      white-space: nowrap;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      &.is-active {
        border-color: rgba(245, 158, 11, 0.75);
        background: rgba(245, 158, 11, 0.16);
        color: #fff;
      }
    }

    .cde-workspace-body {
      min-height: 0;
      display: grid;
      grid-template-columns: 220px minmax(460px, 1fr) 300px;
      gap: 12px;
      padding: 12px;
    }

    .cde-assets-panel,
    .cde-controls-panel {
      min-height: 0;
      overflow: auto;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.035);
      padding: 10px;
      h3 {
        margin: 0 0 10px;
        font-size: 13px;
        line-height: 1.2;
        color: #e5e5e5;
      }
    }

    .cde-editor-panel {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.025);
      padding: 12px;
    }

    .cde-asset-list {
      display: grid;
      gap: 10px;
    }

    .cde-asset {
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.22);
      &.is-main { border-color: rgba(245, 158, 11, 0.65); }
      &.is-reference { box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.75) inset; }
    }

    .cde-asset-preview {
      display: grid;
      gap: 5px;
      width: 100%;
      padding: 0 0 7px;
      border: 0;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      img {
        display: block;
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        background: #262626;
      }
    }

    .cde-asset-source,
    .cde-asset-name {
      margin: 0 8px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cde-asset-source {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #f59e0b;
      font-size: 11px;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .cde-asset-name {
      color: #e5e5e5;
      font-size: 12px;
    }

    .cde-reference-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      width: calc(100% - 12px);
      min-height: 28px;
      margin: 0 6px 6px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
      color: #d4d4d4;
      font-size: 12px;
      cursor: pointer;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:disabled { opacity: 0.45; cursor: default; }
    }

    .cde-panel-section {
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      &:first-child { padding-top: 0; }
      &:last-child { border-bottom: 0; }
    }

    .cde-reference-list {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      img {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 6px;
        background: #fff;
      }
    }

    .cde-empty,
    .cde-client-wishes {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
      color: #a3a3a3;
      white-space: pre-wrap;
    }

    .cde-retouch-level {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 0 9px;
      margin-bottom: 8px;
      border-radius: 999px;
      background: rgba(245, 158, 11, 0.14);
      color: #fbbf24;
      font-size: 12px;
      font-weight: 700;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .cde-retouch-groups {
      display: grid;
      gap: 8px;
    }

    .cde-retouch-group-name {
      margin-bottom: 4px;
      color: #d4d4d4;
      font-size: 11px;
      font-weight: 700;
    }

    .cde-retouch-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }

    .cde-retouch-chip {
      max-width: 100%;
      min-height: 24px;
      padding: 4px 7px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.06);
      color: #e5e5e5;
      font-size: 11px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .cde-prompt {
      width: 100%;
      min-height: 98px;
      resize: vertical;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.28);
      color: #f3f4f6;
      font: inherit;
      font-size: 12px;
      line-height: 1.4;
      box-sizing: border-box;
    }

    .cde-toolbar {
      display: flex; align-items: center; gap: 12px;
      margin-bottom: 10px;
    }
    .cde-doc-select { flex: 1; min-width: 0; }
    .cde-auto-btn mat-icon { font-size: 18px; width: 18px; height: 18px; margin-right: 4px; }
    .cde-tool-toggle {
      color: #a3a3a3;
      &.is-active {
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.14);
      }
    }

    .cde-rotation {
      display: grid;
      grid-template-columns: 18px auto minmax(120px, 1fr) 48px;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      font-size: 12px;
      color: #a3a3a3;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      input { width: 100%; accent-color: var(--crm-accent, #f59e0b); }
      span { text-align: right; font-variant-numeric: tabular-nums; }
    }

    .cde-stage {
      display: flex; justify-content: center;
      background: #1e1e1e; border-radius: 8px; padding: 8px;
    }
    .cde-workarea {
      position: relative; max-width: 100%; max-height: 56vh;
      width: auto; user-select: none; touch-action: none;
      line-height: 0;
    }
    .cde-img {
      display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none;
      transform-origin: center center;
    }

    .cde-grid {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 2;
    }

    .cde-grid-line {
      position: absolute;
      opacity: 0.55;
    }

    .cde-grid-line-h {
      left: 0;
      right: 0;
      border-top: 1px dashed rgba(255, 255, 255, 0.62);
    }

    .cde-grid-line-v {
      top: 0;
      bottom: 0;
      border-left: 1px dashed rgba(255, 255, 255, 0.46);
    }

    .cde-grid-line-third-h,
    .cde-grid-line-third-v {
      opacity: 0.8;
      border-color: rgba(255, 193, 7, 0.65);
    }

    .cde-grid-contrast .cde-grid-line {
      filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #fff);
    }

    .cde-shade {
      position: absolute; background: rgba(0, 0, 0, 0.5);
      pointer-events: none; z-index: 3;
    }
    .cde-shade-top { top: 0; left: 0; right: 0; }
    .cde-shade-bottom { bottom: 0; left: 0; right: 0; }
    .cde-shade-left { left: 0; }
    .cde-shade-right { right: 0; }

    .cde-frame {
      position: absolute; pointer-events: none; z-index: 4;
      border: 2px solid rgba(255, 255, 255, 0.92);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    }

    .cde-line {
      position: absolute; left: 0; right: 0; height: 14px;
      margin-top: -7px; z-index: 5; cursor: ns-resize;
      display: flex; align-items: center;
    }
    .cde-line::before {
      content: ''; position: absolute; left: 0; right: 0; top: 6px;
      height: 2px;
    }
    .cde-line-crown::before { background: #3b82f6; }
    .cde-line-chin::before { background: #22c55e; }
    .cde-line-label {
      position: relative; z-index: 1; font-size: 10px; line-height: 1;
      padding: 1px 5px; border-radius: 3px; color: #fff; margin-left: 4px;
    }
    .cde-line-crown .cde-line-label { background: #3b82f6; }
    .cde-line-chin .cde-line-label { background: #22c55e; }

    .cde-vline {
      position: absolute; top: 0; bottom: 0; width: 14px;
      margin-left: -7px; z-index: 5; cursor: ew-resize;
      display: flex; justify-content: center;
    }
    .cde-vline::before {
      content: ''; position: absolute; top: 0; bottom: 0; left: 6px;
      width: 2px; background: #eab308;
    }
    .cde-vline-label {
      position: relative; z-index: 1; font-size: 10px; line-height: 1;
      padding: 1px 5px; border-radius: 3px; color: #1e1e1e;
      background: #eab308; margin-top: 4px; align-self: flex-start;
      white-space: nowrap;
    }

    .cde-overlay {
      position: absolute; inset: 0; z-index: 6;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 13px;
      line-height: 1.2;
    }

    .cde-editor-footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-top: 10px;
    }
    .cde-footer-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .cde-status { margin: 0 0 2px; font-size: 12px; color: #e5e5e5; }
    .cde-hint { margin: 0; font-size: 11px; color: var(--crm-text-muted, #888); }

    .cde-warnings {
      margin: 8px 0 0; padding: 0; list-style: none;
      li {
        display: flex; align-items: center; gap: 6px;
        font-size: 12px; color: #b45309; margin-top: 4px;
        mat-icon { font-size: 16px; width: 16px; height: 16px; }
      }
    }

    .cde-error {
      display: flex; align-items: center; gap: 6px;
      margin: 8px 0 0; font-size: 12px; color: var(--crm-status-error, #dc2626);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .cde-btn-spinner { display: inline-block; margin-right: 6px; vertical-align: middle; }

    .cde-result {
      margin-top: 12px;
      border: 1px solid var(--crm-border, rgba(255,255,255,.12));
      border-radius: 8px;
      padding: 10px;
      background: var(--crm-surface-raised, rgba(255,255,255,.04));
    }
    .cde-result-head {
      display: flex; align-items: center; gap: 6px;
      margin-bottom: 8px; font-size: 13px; font-weight: 600;
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent, #f59e0b); }
    }
    .cde-result img {
      display: block; max-height: 220px; max-width: 100%; margin: 0 auto 10px;
      border-radius: 6px; background: #fff;
    }
    .cde-result-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }

    @media (max-width: 1100px) {
      .cde-workspace-body {
        grid-template-columns: 180px minmax(360px, 1fr);
      }
      .cde-controls-panel {
        grid-column: 1 / -1;
        max-height: 240px;
      }
    }
  `],
})
export class CropDocumentEditorComponent {
  readonly data = inject<CropDocumentEditorData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<CropDocumentEditorComponent, CropDocumentEditorResult>>(MatDialogRef);
  private readonly document = inject(DOCUMENT);
  private readonly jobsService = inject(AiRetouchJobsService);
  private readonly wsService = inject(WebSocketService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly canvasRef = viewChild<ElementRef<HTMLDivElement>>('canvas');

  readonly documentOptions = DOCUMENT_OPTIONS;
  private readonly initialAssets = this.normalizeInitialAssets();
  readonly workspace = signal<PhotoWorkspaceState>(
    createInitialWorkspaceState({
      assets: this.initialAssets,
      initialAssetUrl: this.data.photoUrl,
    }),
  );
  readonly activeWorkItem = computed<PhotoWorkspaceWorkItem | null>(() => getActiveWorkItem(this.workspace()));
  readonly activeAsset = computed<PhotoWorkspaceAsset | null>(() => {
    const state = this.workspace();
    const item = getActiveWorkItem(state);
    return item ? getAssetById(state, item.sourceAssetId) : null;
  });
  readonly activePhotoUrl = computed(() => this.activeAsset()?.url ?? this.data.photoUrl);
  readonly activePhotoId = computed(() => this.activeAsset()?.photoId ?? this.data.photoId ?? '');
  readonly activeReferences = computed(() => {
    const state = this.workspace();
    const item = getActiveWorkItem(state);
    if (!item) return [];
    return item.referenceAssetIds
      .map(id => getAssetById(state, id))
      .filter((asset): asset is PhotoWorkspaceAsset => asset !== null);
  });
  readonly retouchOptionGroups = computed<RetouchOptionGroupView[]>(() =>
    groupRetouchOptions(this.data.retouchOptions ?? []),
  );

  // Размеры исходного изображения (px), берутся на (load).
  private readonly imgWidth = signal(0);
  private readonly imgHeight = signal(0);
  readonly imageReady = computed(() => this.imgWidth() > 0 && this.imgHeight() > 0);

  // Положения трёх линий в px ОРИГИНАЛА.
  private readonly crownY = signal(0);
  private readonly chinY = signal(0);
  private readonly centerX = signal(0);
  readonly rotationDeg = signal(0);

  readonly documentType = signal<string>(DOCUMENT_OPTIONS[0].slug);
  readonly detecting = signal(false);
  readonly applying = signal(false);
  readonly savingOriginal = signal(false);
  readonly savedAsOriginal = signal(false);
  readonly applyError = signal<string | null>(null);
  readonly statusText = signal('Загрузка фото…');
  readonly workResultUrl = signal<string | null>(null);
  readonly gridEnabled = signal(true);
  readonly contrastLines = signal(true);
  readonly thirdsEnabled = signal(false);
  readonly gridPercents = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
  readonly thirdsPercents = [100 / 3, 200 / 3] as const;
  private readonly workResultJobId = signal<string | null>(null);

  private readonly preset = computed<DocumentCropPreset>(() => {
    const opt = DOCUMENT_OPTIONS.find((o) => o.slug === this.documentType());
    return (opt ?? DOCUMENT_OPTIONS[0]).preset;
  });

  // Живой план кадрирования — пересчёт на каждое перетаскивание линий.
  readonly plan = computed<CropPlan | null>(() => {
    if (!this.imageReady()) return null;
    try {
      return computeCropPlan(
        { crownY: this.crownY(), chinY: this.chinY(), centerX: this.centerX() },
        this.preset(),
        { width: this.imgWidth(), height: this.imgHeight() },
      );
    } catch {
      // RangeError при crown>=chin — не падаем, рамку не рисуем.
      return null;
    }
  });

  readonly warnings = computed<CropWarning[]>(() => this.plan()?.warnings ?? []);

  // Соотношение сторон контейнера = пропорции исходного изображения.
  readonly canvasAspect = computed(() => {
    const w = this.imgWidth();
    const h = this.imgHeight();
    return w && h ? `${w} / ${h}` : '3 / 4';
  });

  // Позиции линий в процентах контейнера (для CSS).
  readonly crownPct = computed(() => this.pctY(this.crownY()));
  readonly chinPct = computed(() => this.pctY(this.chinY()));
  readonly centerPct = computed(() => this.pctX(this.centerX()));
  readonly imageTransform = computed(() => `rotate(${this.rotationDeg()}deg)`);

  /**
   * Рамка документа в процентах контейнера. Берём идеальную область (без учёта
   * extend) из тех же чисел, что computeCropPlan: cropW/cropH по pxPerMm и idealTop/Left.
   * Так рамка показывает реальные пропорции 35×45, даже когда уходит за край.
   */
  readonly frame = computed(() => {
    const p = this.preset();
    const crown = this.crownY();
    const chin = this.chinY();
    const center = this.centerX();
    const imgW = this.imgWidth();
    const imgH = this.imgHeight();
    const pxPerMm = (chin - crown) / p.headHeightMm;
    if (!isFinite(pxPerMm) || pxPerMm <= 0 || !imgW || !imgH) {
      return { top: 0, left: 0, width: 0, height: 0 };
    }
    const cropW = p.photoWmm * pxPerMm;
    const cropH = p.photoHmm * pxPerMm;
    const idealTop = crown - p.topMarginMm * pxPerMm;
    const idealLeft = center - cropW / 2;
    return {
      top: (idealTop / imgH) * 100,
      left: (idealLeft / imgW) * 100,
      width: (cropW / imgW) * 100,
      height: (cropH / imgH) * 100,
    };
  });

  // --- drag state ---
  private dragLine: DragLine = null;
  private pollSub: Subscription | null = null;

  private readonly boundMove = this.onPointerMove.bind(this);
  private readonly boundUp = this.onPointerUp.bind(this);

  private currentJobId: string | null = null;

  constructor() {
    // Мгновенное завершение по WS-событию completed/failed для нашего job
    // (поллинг — фолбэк). Срабатывает только когда уже создан job (currentJobId).
    // effect() сам очищается при уничтожении компонента.
    effect(() => {
      const evt = this.wsService.retouchEvent();
      if (!evt || !this.currentJobId || evt.jobId !== this.currentJobId) return;
      if (evt.event === 'retouch:completed') {
        this.finishSuccess(evt.resultPhotoId ?? null);
      } else if (evt.event === 'retouch:failed') {
        this.finishFailure(evt.error ?? 'Не удалось обработать фото');
      }
    });

    // Гарантированный cleanup при уничтожении компонента: если диалог закрыли
    // ВО ВРЕМЯ перетаскивания линии (Escape/клик по backdrop), onPointerUp может
    // не вызваться → глобальные document-слушатели остались бы висеть (утечка).
    // Здесь же останавливаем поллинг на случай закрытия во время ожидания job.
    // (takeUntilDestroyed уже рвёт HTTP-потоки, но stopPolling чистит явную ссылку.)
    this.destroyRef.onDestroy(() => {
      this.removeDragListeners();
      this.stopPolling();
    });
  }

  onImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) {
      this.onImageError();
      return;
    }
    this.imgWidth.set(w);
    this.imgHeight.set(h);
    // Дефолтные линии до авто-детекта: ⅓/⅔ высоты, центр посередине.
    this.crownY.set(Math.round(h / 3));
    this.chinY.set(Math.round((h * 2) / 3));
    this.centerX.set(Math.round(w / 2));
    this.statusText.set('Определяю линии лица…');
    this.runAutoDetect();
  }

  onImageError(): void {
    this.statusText.set('Не удалось загрузить фото.');
  }

  onDocumentChange(slug: string): void {
    this.documentType.set(slug);
  }

  onRotationInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (Number.isFinite(value)) {
      this.rotationDeg.set(clamp(value, -MAX_ROTATION_DEG, MAX_ROTATION_DEG));
    }
  }

  toggleGrid(): void {
    this.gridEnabled.update(value => !value);
  }

  toggleContrastLines(): void {
    this.contrastLines.update(value => !value);
  }

  toggleThirds(): void {
    this.thirdsEnabled.update(value => !value);
  }

  runAutoDetect(): void {
    if (!this.imageReady() || this.detecting()) return;
    this.detecting.set(true);
    this.jobsService
      .detectCropLines(this.activePhotoUrl())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.detecting.set(false);
          if (
            res.faceDetected &&
            res.crownY != null &&
            res.chinY != null &&
            res.centerX != null
          ) {
            const w = this.imgWidth();
            const h = this.imgHeight();
            let crown = clamp(res.crownY, 0, h);
            let chin = clamp(res.chinY, 0, h);
            // Гарантируем crown < chin с минимальным зазором.
            if (chin - crown < MIN_FACE_GAP_PX) {
              chin = Math.min(h, crown + MIN_FACE_GAP_PX);
            }
            if (crown >= chin) crown = Math.max(0, chin - MIN_FACE_GAP_PX);
            this.crownY.set(crown);
            this.chinY.set(chin);
            this.centerX.set(clamp(res.centerX, 0, w));
            if (res.tilt != null && Number.isFinite(res.tilt)) {
              this.rotationDeg.set(clamp(-res.tilt, -MAX_ROTATION_DEG, MAX_ROTATION_DEG));
            }
            this.statusText.set('Линии и наклон расставлены автоматически — проверьте перед кадрированием.');
          } else {
            this.statusText.set('Лицо не распознано — расставьте линии вручную.');
          }
        },
        error: () => {
          this.detecting.set(false);
          this.statusText.set('Авто-определение не удалось — расставьте линии вручную.');
        },
      });
  }

  onLineDown(event: PointerEvent, line: Exclude<DragLine, null>): void {
    if (this.applying()) return;
    event.preventDefault();
    this.dragLine = line;
    this.document.addEventListener('pointermove', this.boundMove);
    this.document.addEventListener('pointerup', this.boundUp);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragLine) return;
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    if (this.dragLine === 'center') {
      const fracX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      this.centerX.set(Math.round(fracX * this.imgWidth()));
      return;
    }

    const fracY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const y = Math.round(fracY * this.imgHeight());

    if (this.dragLine === 'crown') {
      // Макушка не может опуститься ниже подбородка (минус зазор).
      this.crownY.set(Math.min(y, this.chinY() - MIN_FACE_GAP_PX));
    } else {
      // Подбородок не может подняться выше макушки (плюс зазор).
      this.chinY.set(Math.max(y, this.crownY() + MIN_FACE_GAP_PX));
    }
  }

  private onPointerUp(): void {
    this.removeDragListeners();
  }

  /** Снимает глобальные drag-слушатели и сбрасывает drag-состояние. Идемпотентно. */
  private removeDragListeners(): void {
    this.dragLine = null;
    this.document.removeEventListener('pointermove', this.boundMove);
    this.document.removeEventListener('pointerup', this.boundUp);
  }

  apply(): void {
    if (this.applying() || !this.imageReady()) return;
    this.applyError.set(null);
    this.workResultUrl.set(null);
    this.workResultJobId.set(null);
    this.savedAsOriginal.set(false);
    this.workspace.update(state => updateActiveResult(state, {
      resultUrl: null,
      resultPhotoId: null,
      jobId: null,
      savedAsOriginal: false,
    }));
    this.applying.set(true);
    this.statusText.set('Отправляю на кадрирование…');

    this.jobsService
      .createCropJob({
        sessionId: this.data.sessionId,
        photoId: this.activePhotoId(),
        photoUrl: this.activePhotoUrl(),
        resultMode: this.data.resultMode ?? 'approval_photo',
        params: {
          documentType: this.documentType(),
          crownY: this.crownY(),
          chinY: this.chinY(),
          centerX: this.centerX(),
          rotationDeg: this.rotationDeg(),
        },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.currentJobId = res.job_id;
          this.startPolling(res.job_id);
        },
        error: (err) => {
          this.finishFailure(this.messageFromError(err));
        },
      });
  }

  private startPolling(jobId: string): void {
    this.stopPolling();
    this.pollSub = interval(800)
      .pipe(
        switchMap(() => this.jobsService.pollJob(jobId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (status) => {
          if (status.status === 'completed') {
            this.finishSuccess(status.result_photo_id, status.result_url);
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            this.finishFailure(status.error ?? 'Не удалось обработать фото');
          }
        },
        error: () => {
          // Сетевой сбой поллинга — продолжаем по WS / следующей итерации.
        },
      });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  private finishSuccess(resultPhotoId: string | null, resultUrl: string | null = null): void {
    if (!this.applying()) return;
    this.stopPolling();
    this.applying.set(false);
    if (this.data.resultMode === 'work_result') {
      this.workspace.update(state => updateActiveResult(state, {
        resultUrl,
        resultPhotoId,
        jobId: this.currentJobId,
        savedAsOriginal: false,
      }));
      this.workResultUrl.set(resultUrl);
      this.workResultJobId.set(this.currentJobId);
      this.statusText.set('Кадрирование готово. Можно скачать файл или сохранить его как исходник согласования.');
      return;
    }
    this.dialogRef.close({ applied: true, resultPhotoId, resultUrl });
  }

  private finishFailure(message: string): void {
    this.stopPolling();
    this.applying.set(false);
    this.applyError.set(message);
    this.statusText.set('Ошибка кадрирования.');
  }

  cancel(): void {
    this.stopPolling();
    const active = this.activeWorkItem();
    this.dialogRef.close({
      applied: !!active?.resultUrl,
      resultPhotoId: active?.resultPhotoId ?? null,
      resultUrl: active?.resultUrl ?? null,
      savedAsOriginal: active?.savedAsOriginal ?? false,
    });
  }

  downloadResult(): void {
    const url = this.activeWorkItem()?.resultUrl;
    if (!url) return;
    const link = this.document.createElement('a');
    link.href = url;
    link.download = url.split('/').pop() || 'cropped-document.jpg';
    link.target = '_blank';
    this.document.body.appendChild(link);
    link.click();
    this.document.body.removeChild(link);
  }

  saveAsOriginal(): void {
    const item = this.activeWorkItem();
    const jobId = item?.jobId;
    if (!item || !jobId || this.savingOriginal() || item.savedAsOriginal) return;
    this.savingOriginal.set(true);
    this.jobsService
      .saveJobResultAsOriginal(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingOriginal.set(false);
          this.workspace.update(state => updateActiveResult(state, {
            resultUrl: item.resultUrl,
            resultPhotoId: item.resultPhotoId,
            jobId,
            savedAsOriginal: true,
          }));
          this.savedAsOriginal.set(true);
          this.statusText.set('Кадрированный файл сохранён в исходник согласования.');
          this.data.onOriginalSaved?.();
        },
        error: () => {
          this.savingOriginal.set(false);
          this.applyError.set('Не удалось сохранить файл как исходник.');
        },
      });
  }

  makeMainPhoto(asset: PhotoWorkspaceAsset): void {
    const before = this.activePhotoUrl();
    this.workspace.update(state => createWorkItemFromAsset(state, asset.id));
    if (this.activePhotoUrl() !== before) {
      this.resetImageStateForActivePhoto();
    }
  }

  activateWorkItem(id: string): void {
    if (this.workspace().activeWorkItemId === id) return;
    this.workspace.update(state => setActiveWorkItem(state, id));
    this.resetImageStateForActivePhoto();
  }

  toggleReference(asset: PhotoWorkspaceAsset): void {
    const item = this.activeWorkItem();
    if (!item || item.sourceAssetId === asset.id) return;
    this.workspace.update(state =>
      item.referenceAssetIds.includes(asset.id)
        ? removeReferenceFromActiveItem(state, asset.id)
        : addReferenceToActiveItem(state, asset.id),
    );
  }

  isMainAsset(asset: PhotoWorkspaceAsset): boolean {
    return this.workspace().workItems.some(item => item.sourceAssetId === asset.id);
  }

  isReferenceAsset(asset: PhotoWorkspaceAsset): boolean {
    return this.activeWorkItem()?.referenceAssetIds.includes(asset.id) ?? false;
  }

  sourceLabel(asset: PhotoWorkspaceAsset): string {
    switch (asset.source) {
      case 'order': return 'Заказ';
      case 'chat': return 'Чат';
      case 'approval': return 'Согласование';
      case 'result': return 'Результат';
    }
  }

  sourceIcon(source: PhotoWorkspaceAssetSource): string {
    switch (source) {
      case 'order': return 'assignment';
      case 'chat': return 'chat';
      case 'approval': return 'rate_review';
      case 'result': return 'auto_fix_high';
    }
  }

  onPromptInput(event: Event): void {
    const input = event.target as HTMLTextAreaElement;
    this.workspace.update(state => updateActivePrompt(state, input.value));
  }

  warningText(w: CropWarning): string {
    switch (w.code) {
      case 'extend_top':
        return `Добавлю ${w.valueMm} мм белого сверху (мало поля над макушкой).`;
      case 'extend_bottom':
        return `Добавлю ${w.valueMm} мм белого снизу.`;
      case 'extend_left':
        return `Добавлю ${w.valueMm} мм белого слева.`;
      case 'extend_right':
        return `Добавлю ${w.valueMm} мм белого справа.`;
      case 'low_resolution':
        return 'Голова на фото мелкая — возможна нерезкость результата.';
      default:
        return '';
    }
  }

  private pctY(y: number): number {
    const h = this.imgHeight();
    return h ? (y / h) * 100 : 0;
  }

  private pctX(x: number): number {
    const w = this.imgWidth();
    return w ? (x / w) * 100 : 0;
  }

  private messageFromError(err: unknown): string {
    return errorMessageField(errorBodyField(err), 'error')
      ?? errorMessageField(errorBodyField(err), 'message')
      ?? errorMessageField(err, 'message')
      ?? 'Не удалось отправить на кадрирование';
  }

  private normalizeInitialAssets(): readonly PhotoWorkspaceAsset[] {
    if (this.data.assets?.length) return this.data.assets;
    return [{
      id: 'initial-photo',
      url: this.data.photoUrl,
      name: 'Фото',
      source: 'order',
      photoId: this.data.photoId,
    }];
  }

  private resetImageStateForActivePhoto(): void {
    this.imgWidth.set(0);
    this.imgHeight.set(0);
    this.crownY.set(0);
    this.chinY.set(0);
    this.centerX.set(0);
    this.rotationDeg.set(0);
    this.applyError.set(null);
    this.workResultUrl.set(this.activeWorkItem()?.resultUrl ?? null);
    this.workResultJobId.set(this.activeWorkItem()?.jobId ?? null);
    this.savedAsOriginal.set(this.activeWorkItem()?.savedAsOriginal ?? false);
    this.statusText.set('Загрузка фото…');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function errorBodyField(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) return null;
  return Reflect.get(err, 'error');
}

function errorMessageField(err: unknown, key: string): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const value = Reflect.get(err, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}
