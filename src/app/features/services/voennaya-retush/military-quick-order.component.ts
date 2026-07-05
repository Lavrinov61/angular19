import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface UploadPreview {
  id: string;
  file: File;
  url: string;
}

export interface MilitaryQuickOrderEvent {
  files: File[];
  customerNote: string;
}

export interface MilitaryGuestMessengerLink {
  id: string;
  label: string;
  href: string;
  icon: string;
}

const MAX_FILES = 5;
const MIN_NOTE_LENGTH = 6;

@Component({
  selector: 'app-military-quick-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <section class="brief-order" aria-label="Заявка на военную ретушь">
      <header>
        <span>Заявка в чат</span>
        @if (requiresPhoneAuth()) {
          <h2>Выберите способ отправки</h2>
          <p>На сайте фото загружается после входа по телефону. Без входа можно отправить снимок в мессенджер ниже.</p>
        } @else {
          <h2>Пришлите фото и напишите задачу</h2>
          <p>Форму, звание, знаки, медали, размер и срок уточним в переписке до оплаты.</p>
        }
      </header>

      @if (requiresPhoneAuth()) {
        @if (guestMessengerLinks().length > 0) {
          <div class="messenger-fallback" aria-label="Отправить фото без входа">
            <span>Без входа</span>
            <div class="messenger-links">
              @for (link of guestMessengerLinks(); track link.id) {
                <a
                  [href]="link.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="messenger-link"
                  [class.messenger-link--max]="link.id === 'max'"
                  [class.messenger-link--vk]="link.id === 'vk'"
                  (click)="messengerRequested.emit(link.label)"
                >
                  <mat-icon [svgIcon]="link.icon" aria-hidden="true" />
                  {{ link.label }}
                </a>
              }
            </div>
          </div>
        }
      } @else {
        <div
          class="dropzone"
          [class.dropzone--over]="isDragOver()"
          [class.dropzone--filled]="previews().length > 0"
          role="button"
          tabindex="0"
          aria-label="Загрузить фото"
          (click)="handleFileInputRequest(fileInput)"
          (keydown.enter)="handleFileInputRequest(fileInput)"
          (keydown.space)="handleFileInputRequest(fileInput); $event.preventDefault()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
        >
          @if (previews().length === 0) {
            <mat-icon>cloud_upload</mat-icon>
            <strong>Загрузить фото</strong>
            <span>Можно селфи, старое фото, HEIC или обычное изображение</span>
          } @else {
            <div class="thumbs">
              @for (preview of previews(); track preview.id) {
                <figure>
                  <img [src]="preview.url" [alt]="preview.file.name" />
                  <button
                    type="button"
                    aria-label="Удалить фото"
                    (click)="removePreview(preview.id); $event.stopPropagation()"
                  >
                    <mat-icon>close</mat-icon>
                  </button>
                </figure>
              }

              @if (previews().length < maxFiles) {
                <button type="button" class="add-photo" (click)="fileInput.click(); $event.stopPropagation()" aria-label="Добавить фото">
                  <mat-icon>add_photo_alternate</mat-icon>
                </button>
              }
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

        <button type="button" class="camera-button" (click)="handleCameraInputRequest(cameraInput)">
          <mat-icon>photo_camera</mat-icon>
          Сделать фото
        </button>
        <input
          #cameraInput
          type="file"
          accept="image/*"
          capture="user"
          hidden
          (change)="onFilesSelected($event)"
        />

        <label class="note-field">
          <span>Что нужно сделать?</span>
          <textarea
            rows="4"
            [value]="customerNote()"
            (input)="onNoteInput($event)"
            placeholder="Например: парадная форма морской пехоты, старший лейтенант, знак Гвардии, две медали слева, размер 9x12. Если не знаю точные названия - уточните в чате."
          ></textarea>
        </label>

        <p class="hint">Не знаете точные названия формы или медалей? Пишите своими словами.</p>
      }

      <button
        type="button"
        class="submit-button"
        [disabled]="!canSubmit()"
        (click)="submit()"
      >
        @if (isSubmitting()) {
          <mat-icon>hourglass_empty</mat-icon>
          Отправляем
        } @else if (requiresPhoneAuth()) {
          <mat-icon>cloud_upload</mat-icon>
          Загрузить на сайте
        } @else {
          <mat-icon>send</mat-icon>
          Отправить в чат
        }
      </button>

      @if (submitError()) {
        <p class="error" role="alert">{{ submitError() }}</p>
      }
    </section>
  `,
  styles: [`
    :host {
      display: block;
    }

    .brief-order {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 8px;
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      box-shadow: var(--ed-shadow-md, 0 4px 16px rgba(0, 0, 0, 0.4));
    }

    header {
      display: grid;
      gap: 5px;
    }

    header span {
      color: var(--ed-accent, #f59e0b);
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    h2,
    p {
      margin: 0;
      letter-spacing: 0;
    }

    h2 {
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-display, 'Oswald', Arial, sans-serif);
      font-size: 1.35rem;
      font-weight: 800;
      line-height: 1.12;
      text-transform: uppercase;
    }

    header p,
    .hint,
    .auth-hint {
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .dropzone {
      display: grid;
      min-height: 132px;
      place-items: center;
      gap: 7px;
      padding: 14px;
      border: 1px dashed var(--ed-outline, #3a3a3a);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      color: var(--ed-on-surface, #f5f5f5);
      text-align: center;
      cursor: pointer;
      transition: border-color 160ms ease, background-color 160ms ease;
    }

    .dropzone--over {
      border-color: var(--ed-accent, #f59e0b);
      background: rgba(245, 158, 11, 0.08);
    }

    .dropzone--filled {
      place-items: stretch;
      background: #101010;
    }

    .messenger-fallback {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid rgba(245, 158, 11, 0.26);
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.06);
    }

    .messenger-fallback > span {
      color: var(--ed-accent, #f59e0b);
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .messenger-links {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .messenger-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 42px;
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 8px;
      background: var(--ed-surface-container-high, #222222);
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.93rem;
      font-weight: 800;
      text-decoration: none;
    }

    .messenger-link mat-icon {
      width: 20px;
      height: 20px;
      color: var(--ed-accent, #f59e0b);
      font-size: 20px;
    }

    .messenger-link--max {
      border-color: rgba(245, 158, 11, 0.45);
    }

    .messenger-link--vk {
      border-color: rgba(76, 117, 163, 0.55);
    }

    .messenger-link--vk mat-icon {
      color: #6ea8e5;
    }

    .dropzone > mat-icon {
      width: 34px;
      height: 34px;
      color: var(--ed-accent, #f59e0b);
      font-size: 34px;
    }

    .dropzone strong {
      font-size: 1rem;
    }

    .dropzone span {
      max-width: 280px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.84rem;
      line-height: 1.35;
    }

    .thumbs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      width: 100%;
    }

    figure {
      position: relative;
      overflow: hidden;
      min-height: 86px;
      margin: 0;
      border-radius: 8px;
      background: #000000;
    }

    figure img {
      width: 100%;
      height: 100%;
      min-height: 86px;
      object-fit: cover;
    }

    figure button,
    .add-photo {
      display: inline-grid;
      place-items: center;
      border: 0;
      cursor: pointer;
    }

    figure button {
      position: absolute;
      top: 5px;
      right: 5px;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(23, 36, 45, 0.82);
      color: #ffffff;
    }

    figure button mat-icon,
    .add-photo mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }

    .add-photo {
      min-height: 86px;
      border: 1px dashed var(--ed-outline, #3a3a3a);
      border-radius: 8px;
      background: var(--ed-surface-container-high, #222222);
      color: var(--ed-accent, #f59e0b);
    }

    .camera-button,
    .submit-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 46px;
      border-radius: 8px;
      font: inherit;
      font-weight: 800;
      letter-spacing: 0;
      cursor: pointer;
    }

    .camera-button {
      border: 1px solid var(--ed-outline, #3a3a3a);
      background: var(--ed-surface-container-high, #222222);
      color: var(--ed-on-surface, #f5f5f5);
    }

    .submit-button {
      border: 0;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
    }

    .submit-button:disabled {
      background: var(--ed-outline-variant, #2a2a2a);
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: not-allowed;
    }

    .note-field {
      display: grid;
      gap: 7px;
    }

    .note-field span {
      color: var(--ed-on-surface, #f5f5f5);
      font-weight: 800;
    }

    textarea {
      width: 100%;
      min-height: 104px;
      resize: vertical;
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 8px;
      padding: 10px 11px;
      background: #101010;
      color: var(--ed-on-surface, #f5f5f5);
      font: inherit;
      font-size: 0.95rem;
      line-height: 1.45;
      outline: none;
    }

    textarea:focus {
      border-color: var(--ed-accent, #f59e0b);
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
    }

    textarea::placeholder {
      color: var(--ed-on-surface-muted, #666666);
    }

    textarea:disabled {
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: not-allowed;
      opacity: 1;
    }

    .error {
      padding: 9px 10px;
      border: 1px solid rgba(239, 68, 68, 0.38);
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.12);
      color: #fca5a5;
      font-size: 0.9rem;
      font-weight: 700;
    }

    .auth-hint {
      padding: 9px 10px;
      border: 1px solid rgba(245, 158, 11, 0.34);
      border-radius: 8px;
      background: var(--ed-accent-container, #451a03);
      color: var(--ed-on-accent-container, #fef3c7);
      font-weight: 700;
    }

    @media (min-width: 600px) {
      .brief-order {
        padding: 18px;
      }

      h2 {
        font-size: 1.55rem;
      }

      .dropzone {
        min-height: 158px;
      }

      .thumbs {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
  `],
})
export class MilitaryQuickOrderComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  readonly requiresPhoneAuth = input(false);
  readonly guestMessengerLinks = input<readonly MilitaryGuestMessengerLink[]>([]);
  readonly quickOrderSubmitted = output<MilitaryQuickOrderEvent>();
  readonly phoneAuthRequested = output<void>();
  readonly messengerRequested = output<string>();

  readonly maxFiles = MAX_FILES;
  readonly previews = signal<UploadPreview[]>([]);
  readonly customerNote = signal('');
  readonly isDragOver = signal(false);
  readonly isSubmitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly hasValidBrief = computed(() =>
    this.previews().length > 0
    && this.customerNote().trim().length >= MIN_NOTE_LENGTH
  );

  readonly canSubmit = computed(() =>
    !this.isSubmitting()
    && (this.requiresPhoneAuth() || this.hasValidBrief())
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePreviews(this.previews()));
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.requiresPhoneAuth()) return;
    if (!isPlatformBrowser(this.platformId)) return;
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    if (this.requiresPhoneAuth()) return;
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    if (this.requiresPhoneAuth()) {
      this.requestPhoneAuth();
      return;
    }
    this.addFiles(event.dataTransfer?.files ?? null);
  }

  onFilesSelected(event: Event): void {
    if (this.requiresPhoneAuth()) return;

    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    this.addFiles(target.files);
    target.value = '';
  }

  handleFileInputRequest(fileInput: HTMLInputElement): void {
    if (this.requiresPhoneAuth()) {
      this.requestPhoneAuth();
      return;
    }

    fileInput.click();
  }

  handleCameraInputRequest(cameraInput: HTMLInputElement): void {
    if (this.requiresPhoneAuth()) {
      this.requestPhoneAuth();
      return;
    }

    cameraInput.click();
  }

  onNoteInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;

    this.customerNote.set(target.value);
    if (this.submitError()) {
      this.submitError.set(null);
    }
  }

  removePreview(id: string): void {
    const preview = this.previews().find(item => item.id === id);
    if (preview) {
      URL.revokeObjectURL(preview.url);
    }
    this.previews.update(items => items.filter(item => item.id !== id));
  }

  submit(): void {
    if (this.requiresPhoneAuth()) {
      this.requestPhoneAuth();
      return;
    }

    if (!this.hasValidBrief() || this.isSubmitting()) return;

    this.submitError.set(null);
    this.isSubmitting.set(true);
    this.quickOrderSubmitted.emit({
      files: this.previews().map(preview => preview.file),
      customerNote: this.customerNote().trim(),
    });
  }

  resetForm(): void {
    this.revokePreviews(this.previews());
    this.previews.set([]);
    this.customerNote.set('');
    this.isSubmitting.set(false);
    this.submitError.set(null);
  }

  resetSubmitting(error?: string): void {
    this.isSubmitting.set(false);
    this.submitError.set(error ?? null);
  }

  private addFiles(files: FileList | null): void {
    if (!files || !isPlatformBrowser(this.platformId)) return;

    const availableSlots = MAX_FILES - this.previews().length;
    if (availableSlots <= 0) return;

    const nextPreviews = Array.from(files)
      .filter(file => this.isAcceptedImage(file))
      .slice(0, availableSlots)
      .map(file => ({
        id: this.createPreviewId(file),
        file,
        url: URL.createObjectURL(file),
      }));

    if (!nextPreviews.length) {
      this.submitError.set('Загрузите изображение в формате JPG, PNG, WEBP, HEIC или HEIF.');
      return;
    }

    this.submitError.set(null);
    this.previews.update(items => [...items, ...nextPreviews]);
  }

  private isAcceptedImage(file: File): boolean {
    if (file.type.startsWith('image/')) return true;

    const name = file.name.toLowerCase();
    return name.endsWith('.heic') || name.endsWith('.heif');
  }

  private createPreviewId(file: File): string {
    const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${file.name}-${file.size}-${randomPart}`;
  }

  private requestPhoneAuth(): void {
    if (this.isSubmitting()) return;
    this.phoneAuthRequested.emit();
  }

  private revokePreviews(previews: UploadPreview[]): void {
    for (const preview of previews) {
      URL.revokeObjectURL(preview.url);
    }
  }
}
