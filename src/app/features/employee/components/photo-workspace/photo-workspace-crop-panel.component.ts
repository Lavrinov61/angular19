import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AiRetouchJobsService } from '../../../../core/services/ai-retouch-jobs.service';
import type {
  CropPlan,
  CropWarning,
  DocumentCropPreset,
  DocumentPresetOption,
} from '../../../../core/models/ai-retouch.models';
import { computeCropPlan } from '../../../../shared/utils/crop-geometry';
import type { PhotoWorkspaceCropPayloadDto, PhotoWorkspaceEnvelopeDto } from '../../models/photo-workspace.model';

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

const PHOTO_9X12_PRESET: DocumentCropPreset = {
  photoWmm: 90,
  photoHmm: 120,
  topMarginMm: 10,
  headHeightMm: 65,
  dpi: 800,
  jpegQuality: 92,
};

const PHOTO_4X6_PRESET: DocumentCropPreset = {
  photoWmm: 40,
  photoHmm: 60,
  topMarginMm: 5,
  headHeightMm: 34,
  dpi: 800,
  jpegQuality: 92,
};

type DocumentOption = DocumentPresetOption & { preset: DocumentCropPreset };

const DOCUMENT_OPTIONS: readonly DocumentOption[] = [
  {
    slug: 'passport_rf',
    label: 'Паспорт РФ 35x45',
    aspectRatio: PASSPORT_RF_PRESET.photoWmm / PASSPORT_RF_PRESET.photoHmm,
    preset: PASSPORT_RF_PRESET,
  },
  {
    slug: 'visa_schengen',
    label: 'Виза Шенген 35x45',
    aspectRatio: VISA_SCHENGEN_PRESET.photoWmm / VISA_SCHENGEN_PRESET.photoHmm,
    preset: VISA_SCHENGEN_PRESET,
  },
  {
    slug: 'photo_3x4',
    label: 'Фото 3x4',
    aspectRatio: PHOTO_3X4_PRESET.photoWmm / PHOTO_3X4_PRESET.photoHmm,
    preset: PHOTO_3X4_PRESET,
  },
  {
    slug: 'photo_9x12',
    label: 'Фото 9x12',
    aspectRatio: PHOTO_9X12_PRESET.photoWmm / PHOTO_9X12_PRESET.photoHmm,
    preset: PHOTO_9X12_PRESET,
  },
  {
    slug: 'photo_4x6',
    label: 'Фото 4x6',
    aspectRatio: PHOTO_4X6_PRESET.photoWmm / PHOTO_4X6_PRESET.photoHmm,
    preset: PHOTO_4X6_PRESET,
  },
];

type DragLine = 'crown' | 'chin' | 'center' | null;

const MIN_FACE_GAP_PX = 10;
const MAX_ROTATION_DEG = 10;

@Component({
  selector: 'app-photo-workspace-crop-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <section class="pwc-panel">
      <header class="pwc-header">
        <mat-icon>crop</mat-icon>
        <h3>Кадрирование</h3>
      </header>

      @if (envelope(); as env) {
        @if (!cropFormatConfirmed()) {
          <div class="pwc-format-step">
            <div class="pwc-format-copy">
              <strong>Выберите формат</strong>
              <span>Кадрирование откроется только после выбора нужного варианта.</span>
            </div>

            <div class="pwc-format-grid">
              @for (opt of documentOptions; track opt.slug) {
                <button
                  type="button"
                  class="pwc-format-option"
                  [class.is-active]="selectedDocumentType() === opt.slug"
                  (click)="selectDocumentType(opt.slug)">
                  <span>{{ opt.label }}</span>
                  <small>{{ formatOptionSize(opt) }}</small>
                </button>
              }
            </div>

            <div class="pwc-format-actions">
              <button mat-flat-button type="button" [disabled]="!selectedDocumentType()" (click)="beginCrop()">
                <mat-icon>crop</mat-icon>
                К кадрированию
              </button>
            </div>
          </div>
        } @else {
        <div class="pwc-toolbar">
          <button
            mat-stroked-button
            type="button"
            class="pwc-format-change"
            (click)="changeCropFormat()"
            matTooltip="Сменить формат кадрирования">
            <mat-icon>badge</mat-icon>
            {{ selectedDocumentOption().label }}
          </button>

          <button
            mat-stroked-button
            type="button"
            [disabled]="detecting() || !imageReady()"
            (click)="runAutoDetect()"
            matTooltip="Повторно определить линии лица">
            @if (detecting()) {
              <mat-spinner diameter="16" />
            } @else {
              <mat-icon>auto_fix_high</mat-icon>
            }
            Авто
          </button>

          <button
            mat-icon-button
            type="button"
            class="pwc-toggle"
            [class.is-active]="gridEnabled()"
            (click)="toggleGrid()"
            matTooltip="Сетка горизонта">
            <mat-icon>grid_4x4</mat-icon>
          </button>
          <button
            mat-icon-button
            type="button"
            class="pwc-toggle"
            [class.is-active]="contrastLines()"
            (click)="toggleContrastLines()"
            matTooltip="Контрастные линии">
            <mat-icon>contrast</mat-icon>
          </button>
          <button
            mat-icon-button
            type="button"
            class="pwc-toggle"
            [class.is-active]="thirdsEnabled()"
            (click)="toggleThirds()"
            matTooltip="Сетка 1/3">
            <mat-icon>grid_3x3</mat-icon>
          </button>
        </div>

        <div class="pwc-rotation">
          <mat-icon>rotate_right</mat-icon>
          <label for="pwc-rotation-range">Наклон</label>
          <input
            id="pwc-rotation-range"
            type="range"
            min="-10"
            max="10"
            step="0.1"
            [value]="rotationDeg()"
            (input)="onRotationInput($event)" />
          <span>{{ rotationDeg().toFixed(1) }}°</span>
        </div>

        <div class="pwc-stage">
          <div
            class="pwc-workarea"
            #canvas
            [style.aspect-ratio]="canvasAspect()"
            [style.--pwc-image-aspect]="canvasAspectRatio()">
            <img
              class="pwc-img"
              [src]="env.item.source_asset_url"
              [style.transform]="imageTransform()"
              draggable="false"
              (load)="onImageLoad($event)"
              (error)="onImageError()"
              alt="Фото для кадрирования" />

            @if (imageReady() && gridEnabled()) {
              <div class="pwc-grid" [class.pwc-grid-contrast]="contrastLines()">
                @for (pct of gridPercents; track pct) {
                  <span class="pwc-grid-line pwc-grid-line-h" [style.top.%]="pct"></span>
                  <span class="pwc-grid-line pwc-grid-line-v" [style.left.%]="pct"></span>
                }
                @if (thirdsEnabled()) {
                  @for (pct of thirdsPercents; track pct) {
                    <span class="pwc-grid-line pwc-grid-line-third-h" [style.top.%]="pct"></span>
                    <span class="pwc-grid-line pwc-grid-line-third-v" [style.left.%]="pct"></span>
                  }
                }
              </div>
            }

            @if (imageReady() && plan()) {
              <div class="pwc-shade pwc-shade-top" [style.height.%]="shadeTop()"></div>
              <div class="pwc-shade pwc-shade-bottom" [style.height.%]="shadeBottom()"></div>
              <div
                class="pwc-shade pwc-shade-left"
                [style.top.%]="shadeMiddleTop()"
                [style.height.%]="shadeMiddleHeight()"
                [style.width.%]="shadeLeft()"></div>
              <div
                class="pwc-shade pwc-shade-right"
                [style.top.%]="shadeMiddleTop()"
                [style.height.%]="shadeMiddleHeight()"
                [style.width.%]="shadeRight()"></div>
              <div
                class="pwc-frame"
                [style.top.%]="frame().top"
                [style.left.%]="frame().left"
                [style.width.%]="frame().width"
                [style.height.%]="frame().height"></div>
            }

            @if (imageReady()) {
              <div
                class="pwc-line pwc-line-crown"
                [style.top.%]="crownPct()"
                (pointerdown)="onLineDown($event, 'crown')">
                <span class="pwc-line-label">Макушка</span>
              </div>
              <div
                class="pwc-line pwc-line-chin"
                [style.top.%]="chinPct()"
                (pointerdown)="onLineDown($event, 'chin')">
                <span class="pwc-line-label">Подбородок</span>
              </div>
              <div
                class="pwc-vline pwc-vline-center"
                [style.left.%]="centerPct()"
                (pointerdown)="onLineDown($event, 'center')">
                <span class="pwc-vline-label">Центр</span>
              </div>
            }

            @if (detecting()) {
              <div class="pwc-overlay">
                <mat-spinner diameter="34" />
                <span>Определяю линии лица...</span>
              </div>
            }
          </div>
        </div>

        <div class="pwc-footer">
          <div>
            <p class="pwc-status">{{ statusText() }}</p>
            <p class="pwc-hint">Макушку ИИ оценивает приблизительно - поправьте линию перед кадрированием.</p>
          </div>
          <div class="pwc-actions">
            <button mat-stroked-button type="button" [disabled]="!imageReady()" (click)="emitSave()">
              <mat-icon>save</mat-icon>
              Сохранить
            </button>
            <button mat-flat-button type="button" [disabled]="!imageReady()" (click)="emitRun()">
              <mat-icon>crop</mat-icon>
              Кадрировать
            </button>
          </div>
        </div>

        @if (warnings().length) {
          <ul class="pwc-warnings">
            @for (warning of warnings(); track warning.code) {
              <li><mat-icon>info</mat-icon> {{ warningText(warning) }}</li>
            }
          </ul>
        }

        @if (env.item.crop_result_url) {
          <section class="pwc-result">
            <div>
              <strong>Кадрированный файл</strong>
              <span>Внутренний результат, клиенту не отправляется</span>
            </div>
            <a [href]="env.item.crop_result_url" target="_blank" rel="noopener">
              <img [src]="env.item.crop_result_thumbnail_url || env.item.crop_result_url" alt="Кадрированный результат" />
            </a>
            <a mat-stroked-button [href]="env.item.crop_result_url" target="_blank" rel="noopener">
              <mat-icon>download</mat-icon>
              Скачать
            </a>
          </section>
        }
        }
      } @else {
        <div class="pwc-empty">Нет активного фото</div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 0; height: 100%; }
    .pwc-panel { display: flex; flex-direction: column; gap: 8px; min-height: 0; height: 100%; }
    .pwc-header, .pwc-toolbar, .pwc-rotation, .pwc-actions, .pwc-result { display: flex; align-items: center; }
    .pwc-header { gap: 7px; flex: 0 0 auto; }
    .pwc-header mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; }
    h3, p { margin: 0; }
    h3 { font-size: 13px; font-weight: 650; }
    .pwc-format-step {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      justify-content: center;
      gap: 14px;
      min-height: 260px;
      padding: 8px 0;
    }
    .pwc-format-copy {
      display: grid;
      gap: 3px;
      color: var(--crm-text-secondary);
    }
    .pwc-format-copy strong { color: var(--crm-text); font-size: 14px; }
    .pwc-format-copy span { font-size: 12px; line-height: 1.35; }
    .pwc-format-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(146px, 1fr));
      gap: 8px;
    }
    .pwc-format-option {
      display: grid;
      gap: 5px;
      min-height: 66px;
      padding: 10px 12px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      color: var(--crm-text);
      background: var(--crm-surface);
      text-align: left;
      cursor: pointer;
    }
    .pwc-format-option:hover,
    .pwc-format-option.is-active {
      border-color: var(--crm-accent);
      background: var(--crm-accent-muted);
    }
    .pwc-format-option span {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 13px;
      font-weight: 650;
      line-height: 1.2;
    }
    .pwc-format-option small { color: var(--crm-text-muted); font-size: 11px; line-height: 1.2; }
    .pwc-format-actions { display: flex; justify-content: flex-end; }
    .pwc-toolbar { gap: 8px; flex: 0 0 auto; flex-wrap: wrap; }
    .pwc-format-change { min-width: min(220px, 100%); justify-content: flex-start; }
    .pwc-toggle.is-active { color: var(--crm-accent); background: var(--crm-accent-muted); }
    .pwc-rotation {
      display: grid;
      grid-template-columns: 18px auto minmax(110px, 1fr) 48px;
      gap: 8px;
      flex: 0 0 auto;
      color: var(--crm-text-muted);
      font-size: 12px;
    }
    .pwc-rotation mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pwc-rotation input { width: 100%; accent-color: var(--crm-accent); }
    .pwc-rotation span { text-align: right; font-variant-numeric: tabular-nums; }
    .pwc-stage {
      display: grid;
      place-items: center;
      flex: 1 1 0;
      min-height: 0;
      border-radius: 8px;
      background: var(--crm-surface-raised);
      padding: 8px;
      overflow: hidden;
    }
    .pwc-workarea {
      position: relative;
      width: auto;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      user-select: none;
      touch-action: none;
      line-height: 0;
      overflow: hidden;
    }
    .pwc-img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
      transform-origin: center center;
    }
    .pwc-grid { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
    .pwc-grid-line { position: absolute; opacity: 0.55; }
    .pwc-grid-line-h { left: 0; right: 0; border-top: 1px dashed rgba(255, 255, 255, 0.72); }
    .pwc-grid-line-v { top: 0; bottom: 0; border-left: 1px dashed rgba(255, 255, 255, 0.52); }
    .pwc-grid-line-third-h, .pwc-grid-line-third-v { opacity: 0.82; border-color: rgba(245, 158, 11, 0.72); }
    .pwc-grid-contrast .pwc-grid-line { filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #fff); }
    .pwc-shade { position: absolute; z-index: 3; pointer-events: none; background: rgba(0, 0, 0, 0.5); }
    .pwc-shade-top { top: 0; left: 0; right: 0; }
    .pwc-shade-bottom { bottom: 0; left: 0; right: 0; }
    .pwc-shade-left { left: 0; }
    .pwc-shade-right { right: 0; }
    .pwc-frame {
      position: absolute;
      z-index: 4;
      pointer-events: none;
      border: 2px solid rgba(255, 255, 255, 0.94);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.42);
    }
    .pwc-line {
      position: absolute;
      left: 0;
      right: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      height: 14px;
      margin-top: -7px;
      cursor: ns-resize;
    }
    .pwc-line::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 6px;
      height: 2px;
    }
    .pwc-line-crown::before { background: #3b82f6; }
    .pwc-line-chin::before { background: #22c55e; }
    .pwc-line-label {
      position: relative;
      z-index: 1;
      margin-left: 4px;
      padding: 1px 5px;
      border-radius: 3px;
      color: #fff;
      font-size: 10px;
      line-height: 1;
    }
    .pwc-line-crown .pwc-line-label { background: #3b82f6; }
    .pwc-line-chin .pwc-line-label { background: #22c55e; }
    .pwc-vline {
      position: absolute;
      top: 0;
      bottom: 0;
      z-index: 5;
      display: flex;
      justify-content: center;
      width: 14px;
      margin-left: -7px;
      cursor: ew-resize;
    }
    .pwc-vline::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 6px;
      width: 2px;
      background: #eab308;
    }
    .pwc-vline-label {
      position: relative;
      z-index: 1;
      align-self: flex-start;
      margin-top: 4px;
      padding: 1px 5px;
      border-radius: 3px;
      color: #1f2937;
      background: #eab308;
      font-size: 10px;
      line-height: 1;
      white-space: nowrap;
    }
    .pwc-overlay {
      position: absolute;
      inset: 0;
      z-index: 6;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-size: 13px;
      line-height: 1.2;
    }
    .pwc-footer { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex: 0 0 auto; }
    .pwc-actions { gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .pwc-status { color: var(--crm-text-secondary); font-size: 12px; }
    .pwc-hint { margin-top: 2px; color: var(--crm-text-muted); font-size: 11px; }
    .pwc-warnings { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .pwc-warnings li { display: flex; gap: 6px; align-items: center; color: var(--crm-status-warning); font-size: 12px; }
    .pwc-warnings mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pwc-result {
      gap: 10px;
      flex: 0 0 auto;
      padding: 8px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: var(--crm-surface-raised);
    }
    .pwc-result div { min-width: 0; flex: 1; }
    .pwc-result strong, .pwc-result span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pwc-result strong { font-size: 13px; }
    .pwc-result span { color: var(--crm-text-muted); font-size: 11.5px; }
    .pwc-result img { display: block; width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: #fff; }
    .pwc-empty { display: grid; place-items: center; min-height: 160px; color: var(--crm-text-muted); border: 1px dashed var(--crm-border); border-radius: 8px; }

    @media (max-width: 720px) {
      .pwc-stage { min-height: 280px; }
      .pwc-workarea {
        width: 100%;
        max-height: 62vh;
      }
      .pwc-format-grid { grid-template-columns: 1fr; }
      .pwc-format-actions { justify-content: flex-start; }
      .pwc-footer, .pwc-result { align-items: stretch; flex-direction: column; }
      .pwc-actions { justify-content: flex-start; }
    }
  `],
})
export class PhotoWorkspaceCropPanelComponent {
  private readonly jobsService = inject(AiRetouchJobsService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly canvasRef = viewChild<ElementRef<HTMLDivElement>>('canvas');

  readonly envelope = input<PhotoWorkspaceEnvelopeDto | null>(null);
  readonly saveCrop = output<PhotoWorkspaceCropPayloadDto>();
  readonly runCrop = output<PhotoWorkspaceCropPayloadDto>();

  readonly documentOptions = DOCUMENT_OPTIONS;
  readonly documentType = signal(DOCUMENT_OPTIONS[0].slug);
  readonly selectedDocumentType = signal<string | null>(null);
  readonly cropFormatConfirmed = signal(false);
  readonly detecting = signal(false);
  readonly statusText = signal('Загрузка фото...');
  readonly gridEnabled = signal(true);
  readonly contrastLines = signal(true);
  readonly thirdsEnabled = signal(false);
  readonly gridPercents = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
  readonly thirdsPercents = [100 / 3, 200 / 3] as const;

  private readonly imgWidth = signal(0);
  private readonly imgHeight = signal(0);
  private readonly crownY = signal(0);
  private readonly chinY = signal(0);
  private readonly centerX = signal(0);
  readonly rotationDeg = signal(0);

  readonly imageReady = computed(() => this.imgWidth() > 0 && this.imgHeight() > 0);
  readonly imageTransform = computed(() => `rotate(${this.rotationDeg()}deg)`);
  readonly canvasAspect = computed(() => {
    const w = this.imgWidth();
    const h = this.imgHeight();
    return w && h ? `${w} / ${h}` : '3 / 4';
  });
  readonly canvasAspectRatio = computed(() => {
    const w = this.imgWidth();
    const h = this.imgHeight();
    return w && h ? w / h : 0.75;
  });
  readonly selectedDocumentOption = computed(() => documentOptionFor(this.documentType()));

  private readonly preset = computed<DocumentCropPreset>(() => {
    return documentOptionFor(this.documentType()).preset;
  });

  readonly plan = computed<CropPlan | null>(() => {
    if (!this.imageReady()) return null;
    try {
      return computeCropPlan(
        { crownY: this.crownY(), chinY: this.chinY(), centerX: this.centerX() },
        this.preset(),
        { width: this.imgWidth(), height: this.imgHeight() },
      );
    } catch {
      return null;
    }
  });

  readonly warnings = computed<CropWarning[]>(() => this.plan()?.warnings ?? []);
  readonly crownPct = computed(() => this.pctY(this.crownY()));
  readonly chinPct = computed(() => this.pctY(this.chinY()));
  readonly centerPct = computed(() => this.pctX(this.centerX()));
  readonly frame = computed(() => {
    const p = this.preset();
    const crown = this.crownY();
    const chin = this.chinY();
    const center = this.centerX();
    const imgW = this.imgWidth();
    const imgH = this.imgHeight();
    const pxPerMm = (chin - crown) / p.headHeightMm;
    if (!Number.isFinite(pxPerMm) || pxPerMm <= 0 || !imgW || !imgH) {
      return { top: 0, left: 0, width: 0, height: 0 };
    }
    const cropW = p.photoWmm * pxPerMm;
    const cropH = p.photoHmm * pxPerMm;
    return {
      top: ((crown - p.topMarginMm * pxPerMm) / imgH) * 100,
      left: ((center - cropW / 2) / imgW) * 100,
      width: (cropW / imgW) * 100,
      height: (cropH / imgH) * 100,
    };
  });
  readonly shadeTop = computed(() => clamp(this.frame().top, 0, 100));
  readonly shadeBottom = computed(() => clamp(100 - this.frame().top - this.frame().height, 0, 100));
  readonly shadeMiddleTop = computed(() => clamp(this.frame().top, 0, 100));
  readonly shadeMiddleHeight = computed(() => clamp(this.frame().height, 0, 100));
  readonly shadeLeft = computed(() => clamp(this.frame().left, 0, 100));
  readonly shadeRight = computed(() => clamp(100 - this.frame().left - this.frame().width, 0, 100));

  private dragLine: DragLine = null;
  private readonly boundMove = this.onPointerMove.bind(this);
  private readonly boundUp = this.onPointerUp.bind(this);
  private activeEnvelopeId: string | null = null;

  private readonly envelopeFormatEffect = effect(() => {
    const env = this.envelope();
    const itemId = env?.item.id ?? null;
    if (itemId === this.activeEnvelopeId) return;

    this.activeEnvelopeId = itemId;
    const saved = readCropPayload(env?.item.crop_payload);
    const initialDocumentType = normalizeDocumentType(saved?.documentType ?? env?.item.document_type);
    this.selectedDocumentType.set(null);
    this.documentType.set(initialDocumentType);
    this.cropFormatConfirmed.set(false);
    this.detecting.set(false);
    this.imgWidth.set(0);
    this.imgHeight.set(0);
    this.crownY.set(0);
    this.chinY.set(0);
    this.centerX.set(0);
    this.rotationDeg.set(0);
    this.statusText.set(itemId ? 'Выберите формат кадрирования.' : 'Загрузка фото...');
    this.removeDragListeners();
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.removeDragListeners());
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
    this.applyInitialLines(w, h);
    this.statusText.set('Расставьте линии или нажмите Авто.');
  }

  onImageError(): void {
    this.imgWidth.set(0);
    this.imgHeight.set(0);
    this.statusText.set('Не удалось загрузить фото.');
  }

  selectDocumentType(slug: string): void {
    this.selectedDocumentType.set(normalizeDocumentType(slug));
  }

  beginCrop(): void {
    const selectedDocumentType = this.selectedDocumentType();
    if (!selectedDocumentType) return;

    const documentType = normalizeDocumentType(selectedDocumentType);
    this.documentType.set(documentType);
    this.selectedDocumentType.set(documentType);
    this.cropFormatConfirmed.set(true);
    this.statusText.set(this.imageReady() ? 'Расставьте линии или нажмите Авто.' : 'Загрузка фото...');
  }

  changeCropFormat(): void {
    this.selectedDocumentType.set(null);
    this.cropFormatConfirmed.set(false);
    this.detecting.set(false);
    this.statusText.set('Выберите формат кадрирования.');
    this.removeDragListeners();
  }

  formatOptionSize(option: DocumentOption): string {
    return `${option.preset.photoWmm}x${option.preset.photoHmm} мм`;
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
    const url = this.envelope()?.item.source_asset_url;
    if (!url || !this.imageReady() || this.detecting()) return;
    this.detecting.set(true);
    this.jobsService
      .detectCropLines(url)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          this.detecting.set(false);
          if (
            response.faceDetected
            && response.crownY != null
            && response.chinY != null
            && response.centerX != null
          ) {
            const w = this.imgWidth();
            const h = this.imgHeight();
            let crown = clamp(response.crownY, 0, h);
            let chin = clamp(response.chinY, 0, h);
            if (chin - crown < MIN_FACE_GAP_PX) {
              chin = Math.min(h, crown + MIN_FACE_GAP_PX);
            }
            if (crown >= chin) crown = Math.max(0, chin - MIN_FACE_GAP_PX);
            this.crownY.set(crown);
            this.chinY.set(chin);
            this.centerX.set(clamp(response.centerX, 0, w));
            if (response.tilt != null && Number.isFinite(response.tilt)) {
              this.rotationDeg.set(clamp(-response.tilt, -MAX_ROTATION_DEG, MAX_ROTATION_DEG));
            }
            this.statusText.set('Линии расставлены автоматически - проверьте перед кадрированием.');
            return;
          }
          this.statusText.set('Лицо не распознано - расставьте линии вручную.');
        },
        error: () => {
          this.detecting.set(false);
          this.statusText.set('Авто-определение не удалось - расставьте линии вручную.');
        },
      });
  }

  onLineDown(event: PointerEvent, line: Exclude<DragLine, null>): void {
    if (!this.isBrowser) return;
    event.preventDefault();
    this.dragLine = line;
    this.document.addEventListener('pointermove', this.boundMove);
    this.document.addEventListener('pointerup', this.boundUp);
  }

  emitSave(): void {
    if (!this.imageReady() || !this.cropFormatConfirmed()) return;
    this.saveCrop.emit(this.buildPayload());
    this.statusText.set('Линии сохранены.');
  }

  emitRun(): void {
    if (!this.imageReady() || !this.cropFormatConfirmed()) return;
    this.runCrop.emit(this.buildPayload());
    this.statusText.set('Кадрирование отправлено.');
  }

  warningText(warning: CropWarning): string {
    switch (warning.code) {
      case 'extend_top':
        return `Добавлю ${warning.valueMm} мм белого сверху.`;
      case 'extend_bottom':
        return `Добавлю ${warning.valueMm} мм белого снизу.`;
      case 'extend_left':
        return `Добавлю ${warning.valueMm} мм белого слева.`;
      case 'extend_right':
        return `Добавлю ${warning.valueMm} мм белого справа.`;
      case 'low_resolution':
        return 'Голова на фото мелкая - возможна нерезкость результата.';
      default:
        return '';
    }
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
      this.crownY.set(Math.min(y, this.chinY() - MIN_FACE_GAP_PX));
    } else {
      this.chinY.set(Math.max(y, this.crownY() + MIN_FACE_GAP_PX));
    }
  }

  private onPointerUp(): void {
    this.removeDragListeners();
  }

  private removeDragListeners(): void {
    if (!this.isBrowser) return;
    this.dragLine = null;
    this.document.removeEventListener('pointermove', this.boundMove);
    this.document.removeEventListener('pointerup', this.boundUp);
  }

  private pctY(y: number): number {
    const h = this.imgHeight();
    return h ? (y / h) * 100 : 0;
  }

  private pctX(x: number): number {
    const w = this.imgWidth();
    return w ? (x / w) * 100 : 0;
  }

  private applyInitialLines(width: number, height: number): void {
    const saved = readCropPayload(this.envelope()?.item.crop_payload);
    const documentType = normalizeDocumentType(
      this.cropFormatConfirmed()
        ? this.documentType()
        : saved?.documentType ?? this.envelope()?.item.document_type,
    );
    this.documentType.set(documentType);
    this.selectedDocumentType.set(documentType);

    if (saved && saved.imageNaturalWidth === width && saved.imageNaturalHeight === height) {
      this.crownY.set(clamp(saved.crownY, 0, height));
      this.chinY.set(clamp(saved.chinY, 0, height));
      this.centerX.set(clamp(saved.centerX, 0, width));
      this.rotationDeg.set(clamp(saved.rotationDeg, -MAX_ROTATION_DEG, MAX_ROTATION_DEG));
      return;
    }

    this.crownY.set(Math.round(height / 3));
    this.chinY.set(Math.round((height * 2) / 3));
    this.centerX.set(Math.round(width / 2));
    this.rotationDeg.set(0);
  }

  private buildPayload(): PhotoWorkspaceCropPayloadDto {
    return {
      documentType: this.documentType(),
      crownY: Math.round(this.crownY()),
      chinY: Math.round(this.chinY()),
      centerX: Math.round(this.centerX()),
      rotationDeg: this.rotationDeg(),
      imageNaturalWidth: this.imgWidth(),
      imageNaturalHeight: this.imgHeight(),
      updatedAt: new Date().toISOString(),
    };
  }
}

function readCropPayload(payload: PhotoWorkspaceEnvelopeDto['item']['crop_payload'] | null | undefined): PhotoWorkspaceCropPayloadDto | null {
  const documentType = stringField(payload, 'documentType');
  const crownY = numberField(payload, 'crownY');
  const chinY = numberField(payload, 'chinY');
  const centerX = numberField(payload, 'centerX');
  const rotationDeg = numberField(payload, 'rotationDeg');
  const imageNaturalWidth = numberField(payload, 'imageNaturalWidth');
  const imageNaturalHeight = numberField(payload, 'imageNaturalHeight');
  const updatedAt = stringField(payload, 'updatedAt');
  if (
    !documentType
    || crownY == null
    || chinY == null
    || centerX == null
    || rotationDeg == null
    || imageNaturalWidth == null
    || imageNaturalHeight == null
  ) {
    return null;
  }
  return {
    documentType,
    crownY,
    chinY,
    centerX,
    rotationDeg,
    imageNaturalWidth,
    imageNaturalHeight,
    updatedAt: updatedAt ?? '',
  };
}

function numberField(source: unknown, key: string): number | null {
  const value: unknown = objectField(source, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringField(source: unknown, key: string): string | null {
  const value: unknown = objectField(source, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function objectField(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  return Reflect.get(source, key);
}

function documentOptionFor(value: string | null | undefined): DocumentOption {
  const normalized = normalizeDocumentType(value);
  return DOCUMENT_OPTIONS.find(option => option.slug === normalized) ?? DOCUMENT_OPTIONS[0];
}

function normalizeDocumentType(value: string | null | undefined): string {
  if (value === 'schengen') return 'visa_schengen';
  if (typeof value === 'string' && DOCUMENT_OPTIONS.some(option => option.slug === value)) return value;
  return DOCUMENT_OPTIONS[0].slug;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
