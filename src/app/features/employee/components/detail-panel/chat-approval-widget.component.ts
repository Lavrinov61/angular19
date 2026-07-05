import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../../core/services/toast.service';

interface PresignResponse {
  success: boolean;
  data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] };
}

interface UploadedPhoto {
  id: string;
  retouched_photo_url: string;
  thumbnail_url: string | null;
  status: string;
  variants: UploadedVariant[];
}

interface UploadedVariant {
  id: string;
  variant_url: string;
  thumbnail_url: string | null;
  label: string | null;
  sort_order: number;
}

interface ApprovalSession {
  id: string;
  public_token: string;
  client_name: string;
  status: string;
  chat_session_id: string;
  total_photos: number;
}

@Component({
  selector: 'app-chat-approval-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="approval-widget">
      <div class="widget-header">
        <mat-icon>photo_camera</mat-icon>
        <span>Согласование фото</span>
        <div class="step-dots">
          @for (step of steps; track step.idx) {
            <div class="step-dot"
                 [class.done]="currentStep() > step.idx"
                 [class.active]="currentStep() === step.idx"
                 [matTooltip]="step.label">
              @if (currentStep() > step.idx) {
                <mat-icon>check</mat-icon>
              }
            </div>
            @if (step.idx < 3) {
              <div class="step-line" [class.done]="currentStep() > step.idx"></div>
            }
          }
        </div>
        <button mat-icon-button class="close-btn" (click)="closed.emit()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      @if (sent()) {
        <div class="widget-success">
          <div class="success-icon">
            <mat-icon>check_circle</mat-icon>
          </div>
          <div class="success-title">Отправлено!</div>
          <div class="success-sub">Клиент получит ссылку для согласования</div>
          <button mat-flat-button class="close-success-btn" (click)="closed.emit()">
            Закрыть
          </button>
        </div>
      } @else if (!session()) {
        <div class="widget-create">
          <div class="create-info">Создать сессию согласования для этого чата</div>
          <input class="widget-input" placeholder="Название (опц.)" [(ngModel)]="titleInput" />
          <button mat-flat-button class="create-btn" (click)="createSession()" [disabled]="creating()">
            <mat-icon>add_photo_alternate</mat-icon>
            {{ creating() ? 'Создание...' : 'Создать' }}
          </button>
        </div>
      } @else {
        <div class="widget-content">
          <!-- Original photo (optional) -->
          <div class="section-label">
            <mat-icon>image</mat-icon> Исходник
            <span class="optional">(опционально)</span>
          </div>
          <div class="dropzone dropzone--small"
               (dragover)="onDragOver($event, 'original')"
               (dragleave)="isDragOriginal.set(false)"
               (drop)="onDropOriginal($event)"
               [class.dragover]="isDragOriginal()">
            @if (originalUploadProgress() > 0) {
              <div class="original-progress">
                <div class="mini-progress">
                  <svg viewBox="0 0 36 36">
                    <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                    <path class="ring-fg" [attr.stroke-dasharray]="originalUploadProgress() + ', 100'" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                  </svg>
                  <span>{{ originalUploadProgress() }}%</span>
                </div>
                <span class="original-progress-text">Загрузка исходника</span>
              </div>
            } @else if (originalUrl()) {
              <img [src]="originalUrl()" class="original-thumb" alt="Исходное фото" />
              <span class="original-uploaded">Загружен</span>
            } @else {
              <mat-icon>add_photo_alternate</mat-icon>
              <span>Перетащите исходник</span>
            }
            <input type="file" hidden #origInput accept="image/*" (change)="onOriginalSelected($event)" />
            <button mat-icon-button class="browse-btn" (click)="origInput.click()" [disabled]="originalUploadProgress() > 0" matTooltip="Выбрать файл">
              <mat-icon>folder_open</mat-icon>
            </button>
          </div>

          <!-- Retouched photos -->
          <div class="section-label">
            <mat-icon>auto_fix_high</mat-icon> Фото для согласования
          </div>

          <!-- Compact grid when photos exist -->
          @if (photos().length) {
            <div class="photos-grid">
              @for (photo of photos(); track photo.id) {
                <div class="grid-thumb" (click)="openLightbox(photo)" (keydown.enter)="openLightbox(photo)" tabindex="0">
                  <img [src]="photo.thumbnail_url || photo.retouched_photo_url" alt="Фото" />
                  @if (photo.variants.length) {
                    <span class="variant-badge">{{ photo.variants.length }} вар.</span>
                  }
                  <button class="thumb-remove" (click)="removePhoto(photo.id); $event.stopPropagation()" matTooltip="Удалить">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              }
              <!-- Add more tile -->
              <div class="grid-add"
                   (dragover)="onDragOver($event, 'photos')"
                   (dragleave)="isDragPhotos.set(false)"
                   (drop)="onDropPhotos($event)"
                   [class.dragover]="isDragPhotos()">
                @if (uploadProgress() > 0) {
                  <div class="mini-progress">
                    <svg viewBox="0 0 36 36">
                      <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                      <path class="ring-fg" [attr.stroke-dasharray]="uploadProgress() + ', 100'" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                    </svg>
                    <span>{{ uploadProgress() }}%</span>
                  </div>
                } @else {
                  <mat-icon>add</mat-icon>
                }
                <input type="file" hidden #photoInput accept="image/*" multiple (change)="onPhotosSelected($event)" />
                <button class="grid-add-click" (click)="photoInput.click()" aria-label="Добавить фото"></button>
              </div>
            </div>
          } @else {
            <!-- Full dropzone when no photos -->
            <div class="dropzone"
                 (dragover)="onDragOver($event, 'photos')"
                 (dragleave)="isDragPhotos.set(false)"
                 (drop)="onDropPhotos($event)"
                 [class.dragover]="isDragPhotos()">
              @if (uploadProgress() > 0) {
                <div class="upload-overlay">
                  <div class="upload-ring">
                    <svg viewBox="0 0 36 36">
                      <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                      <path class="ring-fg" [attr.stroke-dasharray]="uploadProgress() + ', 100'" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                    </svg>
                    <span>{{ uploadProgress() }}%</span>
                  </div>
                </div>
              } @else {
                <mat-icon>cloud_upload</mat-icon>
                <span>Перетащите фото или</span>
                <input type="file" hidden #photoInputEmpty accept="image/*" multiple (change)="onPhotosSelected($event)" />
                <button mat-stroked-button (click)="photoInputEmpty.click()">Выбрать</button>
              }
            </div>
          }

          <!-- Send button -->
          <button mat-flat-button class="send-btn"
                  [disabled]="!photos().length || sending()"
                  (click)="sendToChat()">
            <mat-icon>send</mat-icon>
            {{ sending() ? 'Отправка...' : 'Отправить клиенту' }}
          </button>
        </div>
      }

      <!-- Lightbox overlay -->
      @if (lightboxPhoto()) {
        <div class="lightbox-overlay" (click)="closeLightbox()" (keydown.enter)="closeLightbox()" tabindex="0">
          <div class="lightbox-content" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
            <button class="lightbox-close" (click)="closeLightbox()">
              <mat-icon>close</mat-icon>
            </button>
            <img [src]="lightboxPhoto()!.retouched_photo_url" class="lightbox-img" alt="Ретушированное фото" />
            @if (lightboxPhoto()!.variants.length) {
              <div class="lightbox-variants">
                <div class="lightbox-variants-label">Варианты:</div>
                <div class="lightbox-variants-row">
                  @for (v of lightboxPhoto()!.variants; track v.id) {
                    <div class="lightbox-variant">
                      <img [src]="v.thumbnail_url || v.variant_url" (click)="lightboxVariantUrl.set(v.variant_url)" (keydown.enter)="lightboxVariantUrl.set(v.variant_url)" tabindex="0" alt="Вариант обработки" />
                      <span>{{ v.label || 'Вар.' + (v.sort_order + 1) }}</span>
                      <button class="variant-remove-sm" (click)="removeVariant(lightboxPhoto()!.id, v.id)">
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                  }
                </div>
              </div>
            }
            @if (lightboxVariantUrl()) {
              <div class="lightbox-variant-preview">
                <img [src]="lightboxVariantUrl()!" alt="Предпросмотр варианта" />
                <button class="lightbox-back" (click)="lightboxVariantUrl.set(null)">
                  <mat-icon>arrow_back</mat-icon> Назад
                </button>
              </div>
            }
            <!-- Add variant from lightbox -->
            <div class="lightbox-actions">
              <input type="file" hidden #lbVarInput accept="image/*" (change)="onVariantSelected($event, lightboxPhoto()!.id)" />
              <input class="label-input" placeholder="Название варианта" [(ngModel)]="variantLabels[lightboxPhoto()!.id]" />
              <button mat-stroked-button (click)="lbVarInput.click()">
                <mat-icon>add</mat-icon> Вариант
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .approval-widget {
      border: 1px solid var(--crm-border, rgba(255,255,255,.06));
      border-radius: var(--crm-radius-lg, 12px);
      background: var(--crm-surface-raised, #1b1a17);
      overflow: hidden;
      margin: 8px;
      position: relative;
    }
    .widget-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--crm-accent-muted, rgba(245,158,11,.12));
      font-weight: 500;
      font-size: 13px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent, #f59e0b); }
      .close-btn { margin-left: auto; }
    }

    /* Step dots */
    .step-dots {
      display: flex;
      align-items: center;
      gap: 0;
      margin-left: auto;
      margin-right: 4px;
    }
    .step-dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--crm-surface-overlay, #272520);
      border: 2px solid var(--crm-border, rgba(255,255,255,.06));
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all .2s;
      mat-icon { font-size: 11px; width: 11px; height: 11px; color: var(--crm-surface-base, #0c0b09); }
      &.active {
        border-color: var(--crm-accent, #f59e0b);
        background: var(--crm-accent-muted, rgba(245,158,11,.12));
        box-shadow: 0 0 6px rgba(245,158,11,.3);
      }
      &.done {
        background: var(--crm-status-success, #34d399);
        border-color: var(--crm-status-success, #34d399);
      }
    }
    .step-line {
      width: 12px;
      height: 2px;
      background: var(--crm-border, rgba(255,255,255,.06));
      transition: background .2s;
      &.done { background: var(--crm-status-success, #34d399); }
    }

    /* Success state */
    .widget-success {
      padding: 32px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      text-align: center;
    }
    .success-icon {
      animation: successPop .4s cubic-bezier(.34,1.56,.64,1);
      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: var(--crm-status-success, #34d399);
      }
    }
    @keyframes successPop {
      0% { transform: scale(0); opacity: 0; }
      60% { transform: scale(1.2); }
      100% { transform: scale(1); opacity: 1; }
    }
    .success-title { font-size: 16px; font-weight: 600; color: var(--crm-text-primary, #ececec); }
    .success-sub { font-size: 12px; color: var(--crm-text-muted, #7a7a7a); }
    .close-success-btn { margin-top: 12px; }

    /* Create session */
    .widget-create {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      .create-info { font-size: 12px; color: var(--crm-text-muted, #7a7a7a); }
    }
    .widget-input, .label-input {
      background: var(--crm-glass-bg, rgba(255,255,255,.03));
      border: 1px solid var(--crm-border, rgba(255,255,255,.06));
      border-radius: var(--crm-radius-md, 8px);
      padding: 8px 12px;
      color: var(--crm-text-primary, #ececec);
      font-size: 13px;
      outline: none;
      &:focus { border-color: var(--crm-accent, #f59e0b); }
    }
    .label-input {
      flex: 1;
      padding: 4px 8px;
      font-size: 11px;
      min-width: 0;
    }
    .create-btn { width: 100%; }
    .widget-content { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .section-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--crm-text-secondary, #a0a0a0);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      .optional { color: var(--crm-text-muted, #7a7a7a); font-weight: 400; }
    }

    /* Dropzone */
    .dropzone {
      border: 2px dashed var(--crm-border, rgba(255,255,255,.06));
      border-radius: var(--crm-radius-lg, 12px);
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all .2s;
      font-size: 12px;
      color: var(--crm-text-muted, #7a7a7a);
      background: var(--crm-glass-bg, rgba(255,255,255,.03));
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      position: relative;
      mat-icon { font-size: 28px; width: 28px; height: 28px; }
      &.dragover {
        border-color: var(--crm-accent, #f59e0b);
        background: var(--crm-accent-muted, rgba(245,158,11,.12));
        box-shadow: inset 0 0 20px rgba(245,158,11,.08);
      }
      &--small { padding: 12px; flex-direction: row; }
    }

    .upload-overlay { display: flex; align-items: center; justify-content: center; padding: 12px; }
    .upload-ring {
      position: relative;
      width: 48px;
      height: 48px;
      svg { width: 48px; height: 48px; transform: rotate(-90deg); }
      .ring-bg { fill: none; stroke: var(--crm-surface-overlay, #272520); stroke-width: 3; }
      .ring-fg { fill: none; stroke: var(--crm-accent, #f59e0b); stroke-width: 3; stroke-linecap: round; transition: stroke-dasharray .3s; }
      span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: var(--crm-accent, #f59e0b); }
    }

    .original-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; }
    .original-uploaded { font-size: 11px; color: var(--crm-status-success, #34d399); }
    .original-progress {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .original-progress-text {
      font-size: 11px;
      color: var(--crm-text-secondary, #a0a0a0);
      white-space: nowrap;
    }
    .browse-btn { margin-left: auto; }

    /* Compact photos grid */
    .photos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 6px;
    }
    .grid-thumb {
      position: relative;
      aspect-ratio: 1;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      border: 1px solid var(--crm-border, rgba(255,255,255,.06));
      transition: border-color .15s;
      &:hover { border-color: var(--crm-accent, #f59e0b); }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    }
    .variant-badge {
      position: absolute;
      bottom: 3px;
      left: 3px;
      background: rgba(0,0,0,.7);
      color: #fff;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 4px;
      font-weight: 500;
    }
    .thumb-remove {
      position: absolute;
      top: 2px;
      right: 2px;
      background: rgba(0,0,0,.65);
      border: none;
      border-radius: 50%;
      color: #fff;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity .15s;
      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }
    .grid-thumb:hover .thumb-remove { opacity: 1; }

    /* Add tile */
    .grid-add {
      position: relative;
      aspect-ratio: 1;
      border-radius: 8px;
      border: 2px dashed var(--crm-border, rgba(255,255,255,.06));
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all .15s;
      color: var(--crm-text-muted, #7a7a7a);
      mat-icon { font-size: 24px; width: 24px; height: 24px; }
      &.dragover {
        border-color: var(--crm-accent, #f59e0b);
        background: var(--crm-accent-muted, rgba(245,158,11,.12));
      }
      &:hover { border-color: var(--crm-accent, #f59e0b); color: var(--crm-accent, #f59e0b); }
    }
    .grid-add-click {
      position: absolute;
      inset: 0;
      background: transparent;
      border: none;
      cursor: pointer;
    }
    .mini-progress {
      position: relative;
      width: 36px;
      height: 36px;
      svg { width: 36px; height: 36px; transform: rotate(-90deg); }
      .ring-bg { fill: none; stroke: var(--crm-surface-overlay, #272520); stroke-width: 3; }
      .ring-fg { fill: none; stroke: var(--crm-accent, #f59e0b); stroke-width: 3; stroke-linecap: round; transition: stroke-dasharray .3s; }
      span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 600; color: var(--crm-accent, #f59e0b); }
    }

    /* Send button */
    .send-btn { width: 100%; margin-top: 4px; }

    /* Lightbox */
    .lightbox-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0,0,0,.85);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      animation: fadeIn .2s;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .lightbox-content {
      position: relative;
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
    }
    .lightbox-close {
      position: absolute;
      top: -12px;
      right: -12px;
      z-index: 10;
      background: rgba(255,255,255,.12);
      border: none;
      border-radius: 50%;
      color: #fff;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }
    .lightbox-img {
      max-width: 100%;
      max-height: 60vh;
      border-radius: 8px;
      object-fit: contain;
    }
    .lightbox-variants {
      width: 100%;
      .lightbox-variants-label {
        font-size: 11px;
        color: #aaa;
        margin-bottom: 6px;
      }
    }
    .lightbox-variants-row {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .lightbox-variant {
      position: relative;
      flex-shrink: 0;
      text-align: center;
      cursor: pointer;
      img {
        width: 56px;
        height: 56px;
        object-fit: cover;
        border-radius: 6px;
        border: 2px solid transparent;
        transition: border-color .15s;
        &:hover { border-color: var(--crm-accent, #f59e0b); }
      }
      span {
        display: block;
        font-size: 10px;
        color: #aaa;
        max-width: 56px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
    .variant-remove-sm {
      position: absolute;
      top: -4px;
      right: -4px;
      background: rgba(0,0,0,.7);
      border: none;
      border-radius: 50%;
      color: #fff;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      mat-icon { font-size: 10px; width: 10px; height: 10px; }
    }
    .lightbox-variant-preview {
      position: relative;
      img { max-width: 100%; max-height: 50vh; border-radius: 8px; object-fit: contain; }
    }
    .lightbox-back {
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(0,0,0,.6);
      border: none;
      border-radius: 6px;
      color: #fff;
      padding: 4px 10px;
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      font-size: 12px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .lightbox-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      width: 100%;
    }
  `],
})
export class ChatApprovalWidgetComponent {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  chatSessionId = input.required<string>();
  visitorName = input<string>('');
  visitorPhone = input<string>('');
  closed = output<void>();

  readonly session = signal<ApprovalSession | null>(null);
  readonly photos = signal<UploadedPhoto[]>([]);
  readonly originalUrl = signal<string | null>(null);
  readonly creating = signal(false);
  readonly sending = signal(false);
  readonly sent = signal(false);
  readonly originalUploadProgress = signal(0);
  readonly uploadProgress = signal(0);
  readonly isDragOriginal = signal(false);
  readonly isDragPhotos = signal(false);
  readonly lightboxPhoto = signal<UploadedPhoto | null>(null);
  readonly lightboxVariantUrl = signal<string | null>(null);

  titleInput = '';
  variantLabels: Record<string, string> = {};

  readonly steps = [
    { idx: 0, label: 'Сессия' },
    { idx: 1, label: 'Загрузка' },
    { idx: 2, label: 'Отправка' },
    { idx: 3, label: 'Готово' },
  ];

  readonly currentStep = computed(() => {
    if (this.sent()) return 3;
    if (!this.session()) return 0;
    if (this.photos().length === 0) return 1;
    return 2;
  });

  openLightbox(photo: UploadedPhoto): void {
    this.lightboxPhoto.set(photo);
    this.lightboxVariantUrl.set(null);
  }

  closeLightbox(): void {
    this.lightboxPhoto.set(null);
    this.lightboxVariantUrl.set(null);
  }

  createSession(): void {
    this.creating.set(true);
    this.http.post<{ success: boolean; session: ApprovalSession }>('/api/photo-approvals/sessions', {
      client_name: this.visitorName() || 'Клиент',
      client_phone: this.visitorPhone() || undefined,
      chat_session_id: this.chatSessionId(),
      title: this.titleInput || undefined,
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.session.set(res.session);
          this.toast.success('Сессия согласования создана');
        }
        this.creating.set(false);
      },
      error: () => {
        this.toast.error('Не удалось создать сессию');
        this.creating.set(false);
      },
    });
  }

  onDragOver(event: DragEvent, zone: 'original' | 'photos'): void {
    event.preventDefault();
    event.stopPropagation();
    if (zone === 'original') this.isDragOriginal.set(true);
    else this.isDragPhotos.set(true);
  }

  onDropOriginal(event: DragEvent): void {
    event.preventDefault();
    this.isDragOriginal.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.uploadOriginal(file);
  }

  onOriginalSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      this.uploadOriginal(input.files[0]);
      input.value = '';
    }
  }

  private async uploadOriginal(file: File): Promise<void> {
    const sess = this.session();
    if (!sess) return;
    if (this.originalUploadProgress() > 0) return;
    this.originalUploadProgress.set(10);
    try {
      const presign = await firstValueFrom(
        this.http.post<PresignResponse>('/api/photo-approvals/direct-upload/presign', {
          files: [{ fileName: file.name, contentType: file.type, fileSize: file.size }],
        }),
      );
      const { s3Key, uploadUrl } = presign.data.uploads[0];
      this.originalUploadProgress.set(30);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            this.originalUploadProgress.set(30 + Math.round((e.loaded / e.total) * 60));
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`S3 PUT ${xhr.status}`));
        xhr.onerror = () => reject(new Error('S3 PUT network error'));
        xhr.send(file);
      });

      this.originalUploadProgress.set(95);
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; original: { url: string; thumbnailUrl: string } }>(
          `/api/photo-approvals/sessions/${sess.id}/photos`, { s3Key, role: 'original' },
        ),
      );
      if (res.success) this.originalUrl.set(res.original.thumbnailUrl || res.original.url);
    } catch {
      this.toast.error('Не удалось загрузить исходник');
    } finally {
      this.originalUploadProgress.set(0);
    }
  }

  onDropPhotos(event: DragEvent): void {
    event.preventDefault();
    this.isDragPhotos.set(false);
    const files = event.dataTransfer?.files;
    if (files) {
      for (const file of Array.from(files)) {
        this.uploadPhoto(file);
      }
    }
  }

  onPhotosSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      for (const file of Array.from(input.files)) {
        this.uploadPhoto(file);
      }
      input.value = '';
    }
  }

  private async uploadPhoto(file: File): Promise<void> {
    const sess = this.session();
    if (!sess) return;
    this.uploadProgress.set(10);
    try {
      const presign = await firstValueFrom(
        this.http.post<PresignResponse>('/api/photo-approvals/direct-upload/presign', {
          files: [{ fileName: file.name, contentType: file.type, fileSize: file.size }],
        }),
      );
      const { s3Key, uploadUrl } = presign.data.uploads[0];
      this.uploadProgress.set(30);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            this.uploadProgress.set(30 + Math.round((e.loaded / e.total) * 60));
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`S3 PUT ${xhr.status}`));
        xhr.onerror = () => reject(new Error('S3 PUT network error'));
        xhr.send(file);
      });

      this.uploadProgress.set(95);
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; photo: UploadedPhoto }>(
          `/api/photo-approvals/sessions/${sess.id}/photos`, { s3Key },
        ),
      );
      if (res.success) {
        const photo = { ...res.photo, variants: [] };
        this.photos.update(list => [...list, photo]);
      }
    } catch {
      this.toast.error('Не удалось загрузить фото');
    } finally {
      this.uploadProgress.set(0);
    }
  }

  removePhoto(photoId: string): void {
    const sess = this.session();
    if (!sess) return;
    this.http.delete(`/api/photo-approvals/sessions/${sess.id}/photos/${photoId}`).subscribe({
      next: () => {
        this.photos.update(list => list.filter(p => p.id !== photoId));
        if (this.lightboxPhoto()?.id === photoId) this.closeLightbox();
      },
      error: () => this.toast.error('Не удалось удалить'),
    });
  }

  onVariantSelected(event: Event, photoId: string): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      this.uploadVariant(photoId, input.files[0]);
      input.value = '';
    }
  }

  private async uploadVariant(photoId: string, file: File): Promise<void> {
    const sess = this.session();
    if (!sess) return;
    try {
      const presign = await firstValueFrom(
        this.http.post<PresignResponse>('/api/photo-approvals/direct-upload/presign', {
          files: [{ fileName: file.name, contentType: file.type, fileSize: file.size }],
        }),
      );
      const { s3Key, uploadUrl } = presign.data.uploads[0];
      await firstValueFrom(this.http.put(uploadUrl, file, { headers: { 'Content-Type': file.type } }));
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; variant: UploadedVariant }>(
          `/api/photo-approvals/sessions/${sess.id}/photos/${photoId}/variants`, { s3Key, label: this.variantLabels[photoId] || '' },
        ),
      );
      if (res.success) {
        this.photos.update(list => list.map(p =>
          p.id === photoId ? { ...p, variants: [...p.variants, res.variant] } : p
        ));
        this.variantLabels[photoId] = '';
      }
    } catch {
      this.toast.error('Не удалось загрузить вариант');
    }
  }

  removeVariant(photoId: string, variantId: string): void {
    const sess = this.session();
    if (!sess) return;
    this.http.delete(
      `/api/photo-approvals/sessions/${sess.id}/photos/${photoId}/variants/${variantId}`
    ).subscribe({
      next: () => {
        this.photos.update(list => list.map(p =>
          p.id === photoId ? { ...p, variants: p.variants.filter(v => v.id !== variantId) } : p
        ));
      },
      error: () => this.toast.error('Не удалось удалить вариант'),
    });
  }

  sendToChat(): void {
    const sess = this.session();
    if (!sess) return;
    this.sending.set(true);
    this.http.post<{ success: boolean; reviewUrl: string }>(
      `/api/photo-approvals/sessions/${sess.id}/send-to-chat`, {}
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.toast.success('Фото отправлены клиенту');
          this.sent.set(true);
        }
        this.sending.set(false);
      },
      error: () => {
        this.toast.error('Не удалось отправить');
        this.sending.set(false);
      },
    });
  }
}
