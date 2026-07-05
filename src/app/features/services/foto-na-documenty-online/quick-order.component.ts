/**
 * QuickOrderComponent, упрощённый inline-заказ фото на документы.
 *
 * 3 шага в одном экране:
 *   1. Загрузить фото (drag-drop / file picker / camera selfie)
 *   2. Выбрать тип документа (chips)
 *   3. Выбрать обработку (Базовая / Расширенная) → Заказать
 *
 * Цены загружаются динамически из PricingApiService.
 * Эмитит QuickOrderEvent для родителя, который вызывает submitOrderToChat().
 */

import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  computed,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import {
  PricingApiService,
  PricingServiceOption,
  SelectedOption,
} from '../../../core/services/pricing-api.service';
import { QUICK_ORDER_DOCS, QuickOrderDoc } from './foto-na-documenty-online.data';

// ── Public types ────────────────────────────────────────────────────────────

interface UploadPreview {
  id: string;
  file: File;
  url: string;
}

type QuickOrderTierSlug = 'processing-basic' | 'processing-extended';

export interface QuickOrderEvent {
  files: File[];
  selectedDoc: string;
  selectedDocSlug: string;
  tierSlug: string;
  tierName: string;
  total: number;
  selectedOptions: SelectedOption[];
  customerNote?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-quick-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <section class="qo">
      <div class="qo-ambient"></div>
      <div class="qo-inner">

        <div class="qo-header">
          <h2 class="qo-title">
            <span>Быстрый заказ</span>
            <span class="accent">3 шага</span>
          </h2>
          <p class="qo-subtitle">Загрузите фото, укажите документ, получите результат</p>
        </div>

        <!-- ═══ STEP 1: Upload ═══ -->
        <div class="qo-step">
          <div class="qo-step-head">
            <span class="qo-step-num">1</span>
            <span class="qo-step-label">Загрузите фото</span>
          </div>

          <div
            class="qo-dropzone"
            [class.qo-dropzone--over]="isDragOver()"
            [class.qo-dropzone--has-files]="previews().length > 0"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event)"
            tabindex="0" role="button" (keydown.enter)="fileInput.click()"
            (click)="fileInput.click()"
          >
            @if (previews().length === 0) {
              <mat-icon class="qo-dropzone-icon">cloud_upload</mat-icon>
              <p class="qo-dropzone-text">Перетащите фото сюда или нажмите для выбора</p>
              <span class="qo-dropzone-hint">JPG, PNG, HEIC, от 1 фото</span>
            } @else {
              <div class="qo-thumbs">
                @for (p of previews(); track p.id) {
                  <div class="qo-thumb">
                    <img [src]="p.url" [alt]="p.file.name" />
                    <button
                      type="button"
                      class="qo-thumb-remove"
                      (click)="removePreview(p.id); $event.stopPropagation()"
                      aria-label="Удалить"
                    >
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                }
                <button type="button" class="qo-thumb-add" (click)="fileInput.click(); $event.stopPropagation()">
                  <mat-icon>add_photo_alternate</mat-icon>
                </button>
              </div>
            }

            <input
              #fileInput
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              (change)="onFilesSelected($event)"
            />
          </div>

          <!-- Camera selfie button (mobile) -->
          <button
            type="button"
            class="qo-camera-btn"
            (click)="cameraInput.click()"
          >
            <mat-icon>photo_camera</mat-icon>
            Сделать селфи
          </button>
          <input
            #cameraInput
            type="file"
            accept="image/*"
            capture="user"
            hidden
            (change)="onFilesSelected($event)"
          />
        </div>

        <!-- ═══ STEP 2: Document type ═══ -->
        <div class="qo-step">
          <div class="qo-step-head">
            <span class="qo-step-num">2</span>
            <span class="qo-step-label">Для какого документа</span>
          </div>

          <div class="qo-chips">
            @for (doc of documentTypes; track doc.slug) {
              <button
                type="button"
                class="qo-chip"
                [class.qo-chip--active]="selectedDocSlug() === doc.slug"
                (click)="selectDoc(doc)"
              >
                <mat-icon>{{ doc.icon }}</mat-icon>
                <span>{{ doc.name }}</span>
              </button>
            }
          </div>
        </div>

        <!-- ═══ STEP 3: Tier + CTA ═══ -->
        <div class="qo-step">
          <div class="qo-step-head">
            <span class="qo-step-num">3</span>
            <span class="qo-step-label">Уровень обработки</span>
          </div>

          <div class="qo-tier-segment">
            <button
              type="button"
              class="qo-tier-btn"
              [class.qo-tier-btn--active]="selectedTierSlug() === 'processing-basic'"
              (click)="selectTier('processing-basic')"
            >
              <span class="qo-tier-name">Базовая</span>
              <span class="qo-tier-price">{{ expressPrice() }} ₽</span>
              <span class="qo-tier-desc">Фон, формат, лицо и плечи</span>
            </button>
            <button
              type="button"
              class="qo-tier-btn"
              [class.qo-tier-btn--active]="selectedTierSlug() === 'processing-extended'"
              (click)="selectTier('processing-extended')"
            >
              <span class="qo-tier-badge">Популярный</span>
              <span class="qo-tier-name">Расширенная</span>
              <span class="qo-tier-price">{{ professionalPrice() }} ₽</span>
              <span class="qo-tier-desc">Плюс очки, блики и сложные правки</span>
            </button>
          </div>

          <!-- Notes toggle -->
          <button type="button" class="qo-note-toggle" (click)="showNote.set(!showNote())">
            <mat-icon>{{ showNote() ? 'expand_less' : 'edit_note' }}</mat-icon>
            {{ showNote() ? 'Скрыть пожелания' : 'Добавить пожелания' }}
          </button>

          @if (showNote()) {
            <textarea
              class="qo-note-input"
              [value]="customerNote()"
              (input)="onNoteInput($event)"
              rows="3"
              placeholder="Укажите нужные размеры, тип формы, особые требования"
            ></textarea>
          }

          <!-- CTA -->
          <button
            type="button"
            class="qo-cta"
            [class.qo-cta--ready]="canSubmit()"
            [disabled]="!canSubmit() || isSubmitting()"
            (click)="submit()"
          >
            @if (isSubmitting()) {
              <mat-icon>hourglass_empty</mat-icon>
              Отправляем...
            } @else {
              <mat-icon>arrow_forward</mat-icon>
              Заказать за {{ currentPrice() }} ₽
            }
          </button>

          @if (submitError()) {
            <div class="qo-error" role="alert">{{ submitError() }}</div>
          }
        </div>

        <!-- Trust micro-strip -->
        <div class="qo-trust">
          <span><mat-icon>verified</mat-icon> Гарантия приёма</span>
          <span><mat-icon>edit</mat-icon> Бесплатные правки</span>
          <span><mat-icon>bolt</mat-icon> Готово от 10 мин</span>
        </div>

        <!-- Configurator link -->
        <p class="qo-configurator-hint">
          Хотите больше опций?
          <a href="#pricing" (click)="scrollToConfigurator($event)">Открыть полный конфигуратор</a>
        </p>

      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }

    .qo {
      position: relative;
      padding: 48px 16px 56px;
      background: var(--ed-surface-dim, #111111);
      overflow: hidden;

      @media (min-width: 600px) { padding: 64px 24px 72px; }
      @media (min-width: 1024px) { padding: 80px 40px 88px; }
    }

    .qo-ambient {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse 70% 50% at 50% 0%, rgba(245, 158, 11, 0.06) 0%, transparent 70%),
        radial-gradient(ellipse 40% 40% at 80% 80%, rgba(245, 158, 11, 0.03) 0%, transparent 60%);
      pointer-events: none;
    }

    .qo-inner {
      position: relative;
      max-width: 640px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }

    /* ── Header ── */

    .qo-header { text-align: center; }

    .qo-title {
      margin: 0;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      font-size: clamp(1.5rem, 5vw, 2.25rem);
      line-height: 1;
      color: var(--ed-on-surface, #f5f5f5);

      .accent { color: var(--ed-accent, #f59e0b); }
    }

    .qo-subtitle {
      margin: 10px 0 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.95rem;
      line-height: 1.5;
    }

    /* ── Steps ── */

    .qo-step {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .qo-step-head {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .qo-step-num {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      border-radius: 50%;
      font-weight: 700;
      font-size: 0.85rem;
    }

    .qo-step-label {
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    /* ── Dropzone ── */

    .qo-dropzone {
      border: 2px dashed var(--ed-outline, #3a3a3a);
      border-radius: 16px;
      padding: 32px 16px;
      text-align: center;
      cursor: pointer;
      transition: border-color 180ms ease, background-color 180ms ease;
      background: rgba(255, 255, 255, 0.01);
      min-height: 120px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;

      &--over {
        border-color: var(--ed-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.08);
      }

      &--has-files {
        padding: 12px;
        border-style: solid;
        border-color: var(--ed-outline-variant, #2a2a2a);
        min-height: auto;
      }
    }

    .qo-dropzone-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: var(--ed-accent, #f59e0b);
      margin-bottom: 8px;
    }

    .qo-dropzone-text {
      margin: 0;
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .qo-dropzone-hint {
      display: block;
      margin-top: 6px;
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    /* ── Thumbnails ── */

    .qo-thumbs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      width: 100%;
    }

    .qo-thumb {
      position: relative;
      width: 80px;
      height: 80px;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: #000;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    }

    .qo-thumb-remove {
      position: absolute;
      right: 4px;
      top: 4px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 0;
      background: rgba(0, 0, 0, 0.72);
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 13px;
        width: 13px;
        height: 13px;
      }
    }

    .qo-thumb-add {
      width: 80px;
      height: 80px;
      border-radius: 10px;
      border: 2px dashed var(--ed-outline, #3a3a3a);
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 160ms ease, color 160ms ease;

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        color: var(--ed-accent, #f59e0b);
      }
    }

    /* ── Camera button (mobile only) ── */

    .qo-camera-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 20px;
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 12px;
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      font: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: border-color 160ms ease, background 160ms ease;

      mat-icon {
        color: var(--ed-accent, #f59e0b);
      }

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.06);
      }

      @media (min-width: 1024px) {
        display: none;
      }
    }

    /* ── Document chips ── */

    .qo-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .qo-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 24px;
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      font: inherit;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
      user-select: none;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-on-surface-variant, #a0a0a0);
        transition: color 160ms ease;
      }

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        transform: translateY(-1px);

        mat-icon { color: var(--ed-accent, #f59e0b); }
      }

      &--active {
        border-color: var(--ed-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.12);

        mat-icon { color: var(--ed-accent, #f59e0b); }
        span { color: var(--ed-accent, #f59e0b); font-weight: 600; }
      }
    }

    /* ── Tier segment ── */

    .qo-tier-segment {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;

      @media (max-width: 399px) {
        grid-template-columns: 1fr;
      }
    }

    .qo-tier-btn {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 16px 12px;
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 14px;
      background: var(--ed-surface-container, #1a1a1a);
      cursor: pointer;
      transition: border-color 200ms ease, background 200ms ease, box-shadow 200ms ease;
      text-align: center;
      font-family: inherit;
      color: var(--ed-on-surface, #f5f5f5);

      &:hover {
        border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 50%, transparent);
      }

      &--active {
        border-color: var(--ed-accent, #f59e0b);
        background: color-mix(in srgb, var(--ed-accent, #f59e0b) 8%, var(--ed-surface, #0a0a0a));
        box-shadow: 0 2px 12px color-mix(in srgb, var(--ed-accent, #f59e0b) 20%, transparent);
      }
    }

    .qo-tier-badge {
      position: absolute;
      top: -9px;
      left: 50%;
      transform: translateX(-50%);
      padding: 2px 10px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 0.7rem;
      font-weight: 800;
      border-radius: 100px;
      white-space: nowrap;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .qo-tier-name {
      font-size: 0.95rem;
      font-weight: 700;
    }

    .qo-tier-price {
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
    }

    .qo-tier-desc {
      font-size: 0.78rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.3;
    }

    /* ── Notes ── */

    .qo-note-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      padding: 6px 0;
      transition: color 160ms ease;

      &:hover { color: var(--ed-on-surface, #f5f5f5); }

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .qo-note-input {
      width: 100%;
      border: 1px solid var(--ed-outline, #3a3a3a);
      background: #101010;
      color: var(--ed-on-surface, #f5f5f5);
      border-radius: 12px;
      padding: 10px 12px;
      font: inherit;
      font-size: 0.9rem;
      resize: vertical;
      min-height: 70px;
      outline: none;
      transition: border-color 160ms ease;

      &:focus { border-color: var(--ed-accent, #f59e0b); }

      &::placeholder { color: var(--ed-on-surface-muted, #666666); }
    }

    /* ── CTA ── */

    .qo-cta {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px 28px;
      border: none;
      border-radius: 16px;
      background: var(--ed-outline-variant, #2a2a2a);
      color: var(--ed-on-surface-variant, #a0a0a0);
      font: inherit;
      font-size: 1.05rem;
      font-weight: 800;
      cursor: not-allowed;
      transition: background 300ms ease, color 300ms ease, box-shadow 300ms ease, transform 150ms ease;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &--ready {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
        cursor: pointer;
        animation: qo-pulse 3s infinite;

        &:hover:not([disabled]) {
          box-shadow: 0 6px 24px color-mix(in srgb, var(--ed-accent, #f59e0b) 30%, transparent);
          transform: translateY(-1px);
        }

        &:active:not([disabled]) { transform: scale(0.97); }
      }

      &[disabled] { cursor: not-allowed; }
    }

    @keyframes qo-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.3); }
      50% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
    }

    /* ── Error ── */

    .qo-error {
      padding: 10px 14px;
      background: rgba(220, 38, 38, 0.12);
      border: 1px solid rgba(220, 38, 38, 0.4);
      border-radius: 8px;
      color: #fca5a5;
      font-size: 0.85rem;
      line-height: 1.4;
    }

    /* ── Trust strip ── */

    .qo-trust {
      display: flex;
      gap: 16px;
      justify-content: center;
      flex-wrap: wrap;
      padding-top: 4px;

      span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.78rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        white-space: nowrap;

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
          color: var(--ed-accent, #f59e0b);
        }
      }
    }

    /* ── Configurator link ── */

    .qo-configurator-hint {
      text-align: center;
      margin: 0;
      font-size: 0.82rem;
      color: var(--ed-on-surface-muted, #666666);

      a {
        color: var(--ed-accent, #f59e0b);
        text-decoration: none;
        font-weight: 600;

        &:hover { text-decoration: underline; }
      }
    }
  `],
})
export class QuickOrderComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly pricing = inject(PricingApiService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs / Outputs ──

  readonly isNewCustomer = input(true);
  readonly quickOrderSubmitted = output<QuickOrderEvent>();

  // ── Data ──

  readonly documentTypes: QuickOrderDoc[] = QUICK_ORDER_DOCS;

  // ── State ──

  readonly selectedDocSlug = signal<string | null>(null);
  readonly selectedTierSlug = signal<QuickOrderTierSlug>('processing-extended');
  readonly previews = signal<UploadPreview[]>([]);
  readonly isDragOver = signal(false);
  readonly customerNote = signal('');
  readonly showNote = signal(false);
  readonly isSubmitting = signal(false);
  readonly submitError = signal<string | null>(null);

  private readonly selectedDocName = computed(() =>
    this.documentTypes.find(d => d.slug === this.selectedDocSlug())?.name ?? ''
  );

  // ── Computed: prices from PricingApiService ──

  private readonly photoDocsCategory = computed(() =>
    this.pricing.getCategoryBySlug('photo-docs')
  );

  private readonly processingGroup = computed(() =>
    this.photoDocsCategory()?.optionGroups.find(g => g.slug === 'processing-level') ?? null
  );

  private readonly basicOption = computed((): PricingServiceOption | null =>
    this.processingGroup()?.options.find(o => o.slug === 'processing-basic') ?? null
  );

  private readonly retouchOption = computed((): PricingServiceOption | null =>
    this.processingGroup()?.options.find(o => o.slug === 'processing-extended') ?? null
  );

  readonly expressPrice = computed(() => {
    const opt = this.basicOption();
    if (!opt) return 700; // fallback
    return this.pricing.resolveOptionPrice(opt, 'electronic', this.isNewCustomer());
  });

  readonly professionalPrice = computed(() => {
    const opt = this.retouchOption();
    if (!opt) return 950; // fallback
    return this.pricing.resolveOptionPrice(opt, 'electronic', this.isNewCustomer());
  });

  readonly currentPrice = computed(() =>
    this.selectedTierSlug() === 'processing-basic' ? this.expressPrice() : this.professionalPrice()
  );

  readonly canSubmit = computed(() =>
    this.previews().length > 0 && this.selectedDocSlug() !== null && !this.isSubmitting()
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.clearPreviews());
  }

  // ── Actions ──

  selectDoc(doc: QuickOrderDoc): void {
    this.selectedDocSlug.set(doc.slug);
  }

  selectTier(slug: QuickOrderTierSlug): void {
    this.selectedTierSlug.set(slug);
  }

  submit(): void {
    if (!this.canSubmit() || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    this.submitError.set(null);

    const tierSlug = this.selectedTierSlug();
    const tierName = tierSlug === 'processing-basic' ? 'Базовая обработка' : 'Расширенная обработка';
    const note = this.customerNote().trim();

    this.quickOrderSubmitted.emit({
      files: this.previews().map(p => p.file),
      selectedDoc: this.selectedDocName(),
      selectedDocSlug: this.selectedDocSlug()!,
      tierSlug,
      tierName,
      total: this.currentPrice(),
      selectedOptions: [{ option_slug: tierSlug, quantity: 1 }],
      customerNote: note || undefined,
    });
  }

  /** Called by parent when submission fails */
  resetSubmitting(error?: string): void {
    this.isSubmitting.set(false);
    if (error) this.submitError.set(error);
  }

  /** Called by parent on successful submission */
  resetForm(): void {
    this.clearPreviews();
    this.selectedDocSlug.set(null);
    this.selectedTierSlug.set('processing-extended');
    this.customerNote.set('');
    this.showNote.set(false);
    this.isSubmitting.set(false);
    this.submitError.set(null);
  }

  scrollToConfigurator(event: Event): void {
    event.preventDefault();
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // ── Drag & Drop ──

  onDragOver(event: DragEvent): void {
    this.suppressEvent(event);
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    this.suppressEvent(event);
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    this.suppressEvent(event);
    this.isDragOver.set(false);
    const list = event.dataTransfer?.files;
    if (list?.length) this.addFiles(Array.from(list));
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.addFiles(Array.from(input.files));
    input.value = '';
  }

  removePreview(id: string): void {
    const target = this.previews().find(p => p.id === id);
    if (target) URL.revokeObjectURL(target.url);
    this.previews.update(items => items.filter(p => p.id !== id));
  }

  onNoteInput(event: Event): void {
    this.customerNote.set((event.target as HTMLTextAreaElement).value);
  }

  // ── Private ──

  private suppressEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private addFiles(files: File[]): void {
    const valid = files.filter(f => f.type.startsWith('image/'));
    if (!valid.length) return;

    const additions: UploadPreview[] = valid.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      url: URL.createObjectURL(f),
    }));

    this.previews.update(items => [...items, ...additions]);
  }

  private clearPreviews(): void {
    for (const p of this.previews()) URL.revokeObjectURL(p.url);
    this.previews.set([]);
  }
}
