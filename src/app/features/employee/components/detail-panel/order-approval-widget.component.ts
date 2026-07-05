import {
  Component, inject, input, output, signal, computed, effect,
  ChangeDetectionStrategy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Clipboard } from '@angular/cdk/clipboard';
import { ToastService } from '../../../../core/services/toast.service';
import { WebSocketService } from '../../../../core/services/websocket.service';

interface PresignResponse {
  success: boolean;
  data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] };
}

interface ApprovalVariant {
  id: string;
  variant_url: string;
  thumbnail_url: string | null;
  label: string | null;
  sort_order: number;
}

interface ApprovalPhoto {
  id: string;
  retouched_photo_url: string;
  thumbnail_url: string | null;
  status: string;
  comment: string | null;
  variants: ApprovalVariant[];
}

interface ApprovalSession {
  id: string;
  public_token: string;
  client_name: string;
  client_phone: string | null;
  status: string;
  chat_session_id: string | null;
  original_photo_url: string | null;
  link_sent_at: string | null;
  first_viewed_at: string | null;
  shareUrl: string;
}

/**
 * Согласование фото внутри карточки заказа — тот же поток, что виджет чата:
 * загрузить исходник, загрузить фото, по каждому фото добавить ВАРИАНТЫ ретуши
 * (лайтбокс с подписями), затем «Отправить клиенту». Дополнительно показывает
 * ответ клиента (одобрено / нужны правки + комментарии).
 *
 * Сессия привязывается к заказу (order_id = uuid). Создаётся с defer_send=true,
 * чтобы преждевременная ссылка не ушла клиенту до загрузки фото.
 */
@Component({
  selector: 'app-order-approval-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="approval-widget">
      <div class="widget-header">
        <mat-icon>auto_fix_high</mat-icon>
        <span>Согласование фото</span>
        @if (session()) {
          <div class="step-dots">
            @for (step of steps; track step.idx) {
              <div class="step-dot"
                   [class.done]="currentStep() > step.idx"
                   [class.active]="currentStep() === step.idx"
                   [matTooltip]="step.label">
                @if (currentStep() > step.idx) { <mat-icon>check</mat-icon> }
              </div>
              @if (step.idx < 2) {
                <div class="step-line" [class.done]="currentStep() > step.idx"></div>
              }
            }
          </div>
        }
      </div>

      @if (loading()) {
        <div class="widget-loading">
          <mat-icon class="spin">progress_activity</mat-icon>
          <span>Загрузка...</span>
        </div>
      } @else if (!session()) {
        <!-- Старт: одна кнопка, имя берём из заказа -->
        <div class="widget-create">
          @if (superRetouch()) {
            <div class="super-hint">
              <mat-icon>diamond</mat-icon>
              <span>Супер обработка: загрузите для клиента до 10 вариантов ретуши, клиент выберет лучший сам.</span>
            </div>
          }
          <div class="create-info">Загрузите обработанные фото, чтобы согласовать с клиентом</div>
          <button mat-flat-button class="create-btn" (click)="createSession()" [disabled]="creating()">
            <mat-icon>{{ creating() ? 'progress_activity' : 'cloud_upload' }}</mat-icon>
            {{ creating() ? 'Создание...' : 'Загрузить результаты' }}
          </button>
        </div>
      } @else {
        <div class="widget-content">
          @if (superRetouch()) {
            <div class="super-hint">
              <mat-icon>diamond</mat-icon>
              <span>Супер обработка: загрузите для клиента до 10 вариантов ретуши, клиент выберет лучший сам.</span>
            </div>
          }

          <!-- Ответ клиента -->
          @if (statusInfo(); as si) {
            <div class="client-status" [class]="'cs-' + si.kind">
              <mat-icon>{{ si.icon }}</mat-icon>
              <span>{{ si.text }}</span>
            </div>
          }

          <!-- Исходник (опционально) -->
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
              <mat-icon class="spin">progress_activity</mat-icon>
              <span>Загрузка {{ originalUploadProgress() }}%</span>
            } @else if (originalUrl()) {
              <img [src]="originalUrl()!" class="original-thumb" alt="Исходное фото" />
              <span class="original-uploaded">Загружен</span>
            } @else {
              <mat-icon>add_photo_alternate</mat-icon>
              <span>Перетащите исходник</span>
            }
            <input type="file" hidden #origInput accept="image/*" (change)="onOriginalSelected($event)" />
            <button mat-icon-button class="browse-btn" (click)="origInput.click()"
                    [disabled]="originalUploadProgress() > 0" matTooltip="Выбрать файл">
              <mat-icon>folder_open</mat-icon>
            </button>
          </div>

          <!-- Фото для согласования -->
          <div class="section-label">
            <mat-icon>auto_fix_high</mat-icon> Фото для согласования
            @if (photos().length) { <span class="count-pill">{{ photos().length }}</span> }
          </div>

          @if (photos().length) {
            <div class="photos-grid">
              @for (photo of photos(); track photo.id) {
                <div class="grid-thumb" [class]="'st-' + photo.status"
                     (click)="openLightbox(photo)" (keydown.enter)="openLightbox(photo)" tabindex="0">
                  <img [src]="photo.thumbnail_url || photo.retouched_photo_url" alt="Фото" />
                  @if (photo.variants.length) {
                    <span class="variant-badge">{{ photo.variants.length }} вар.</span>
                  }
                  @if (photo.status !== 'pending') {
                    <span class="status-dot" [matTooltip]="photoStatusLabel(photo.status)">
                      <mat-icon>{{ photo.status === 'approved' ? 'check_circle' : 'edit_note' }}</mat-icon>
                    </span>
                  }
                  @if (!isLocked()) {
                    <button class="thumb-remove" (click)="removePhoto(photo.id); $event.stopPropagation()" matTooltip="Удалить">
                      <mat-icon>close</mat-icon>
                    </button>
                  }
                </div>
              }
              @if (!isLocked()) {
                <div class="grid-add"
                     (dragover)="onDragOver($event, 'photos')"
                     (dragleave)="isDragPhotos.set(false)"
                     (drop)="onDropPhotos($event)"
                     [class.dragover]="isDragPhotos()">
                  @if (uploadProgress() > 0) {
                    <mat-icon class="spin">progress_activity</mat-icon>
                  } @else {
                    <mat-icon>add</mat-icon>
                  }
                  <input type="file" hidden #photoInput accept="image/*" multiple (change)="onPhotosSelected($event)" />
                  <button class="grid-add-click" (click)="photoInput.click()" aria-label="Добавить фото"></button>
                </div>
              }
            </div>
          } @else {
            <div class="dropzone"
                 (dragover)="onDragOver($event, 'photos')"
                 (dragleave)="isDragPhotos.set(false)"
                 (drop)="onDropPhotos($event)"
                 [class.dragover]="isDragPhotos()">
              @if (uploadProgress() > 0) {
                <mat-icon class="spin">progress_activity</mat-icon>
                <span>Загрузка {{ uploadProgress() }}%</span>
              } @else {
                <mat-icon>cloud_upload</mat-icon>
                <span>Перетащите фото или</span>
                <input type="file" hidden #photoInputEmpty accept="image/*" multiple (change)="onPhotosSelected($event)" />
                <button mat-stroked-button (click)="photoInputEmpty.click()">Выбрать</button>
              }
            </div>
          }

          <!-- Отправка (если у заказа нет чата — отдаём ссылку для копирования) -->
          <button mat-flat-button class="send-btn"
                  [disabled]="!photos().length || sending()"
                  (click)="onSendClick()">
            <mat-icon>{{ sendIcon() }}</mat-icon>
            {{ sendLabel() }}
          </button>

          <!-- Ссылка для клиента -->
          @if (photos().length) {
            <div class="share-row">
              <input class="share-input" [value]="fullShareUrl()" readonly />
              <button mat-icon-button (click)="copyLink()" matTooltip="Скопировать ссылку">
                <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
              </button>
            </div>
          }
        </div>
      }

      <!-- Лайтбокс: фото + варианты -->
      @if (lightboxPhoto(); as lb) {
        <div class="lightbox-overlay" (click)="closeLightbox()" (keydown.escape)="closeLightbox()" tabindex="0">
          <div class="lightbox-content" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()" tabindex="0">
            <button class="lightbox-close" (click)="closeLightbox()"><mat-icon>close</mat-icon></button>
            <img [src]="lightboxVariantUrl() || lb.retouched_photo_url" class="lightbox-img" alt="Фото для согласования" />

            @if (lb.comment && lb.status === 'rejected') {
              <div class="lightbox-comment">
                <mat-icon>format_quote</mat-icon>
                <span>{{ lb.comment }}</span>
              </div>
            }

            @if (lb.variants.length) {
              <div class="lightbox-variants">
                <div class="lightbox-variants-label">Варианты ретуши:</div>
                <div class="lightbox-variants-row">
                  <div class="lightbox-variant" [class.active]="!lightboxVariantUrl()">
                    <img [src]="lb.thumbnail_url || lb.retouched_photo_url"
                         (click)="lightboxVariantUrl.set(null)" (keydown.enter)="lightboxVariantUrl.set(null)" tabindex="0" alt="Основной вариант" />
                    <span>Основной</span>
                  </div>
                  @for (v of lb.variants; track v.id) {
                    <div class="lightbox-variant" [class.active]="lightboxVariantUrl() === v.variant_url">
                      <img [src]="v.thumbnail_url || v.variant_url"
                           (click)="lightboxVariantUrl.set(v.variant_url)" (keydown.enter)="lightboxVariantUrl.set(v.variant_url)" tabindex="0" alt="Вариант ретуши" />
                      <span>{{ v.label || ('Вар. ' + (v.sort_order + 1)) }}</span>
                      @if (!isLocked()) {
                        <button class="variant-remove-sm" (click)="removeVariant(lb.id, v.id)" matTooltip="Удалить вариант">
                          <mat-icon>close</mat-icon>
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>
            }

            @if (!isLocked()) {
              <div class="lightbox-actions">
                <input type="file" hidden #lbVarInput accept="image/*" multiple (change)="onVariantSelected($event, lb.id)" />
                <input class="label-input" placeholder="Название варианта (опц.)" [(ngModel)]="variantLabels[lb.id]" />
                <button mat-stroked-button (click)="lbVarInput.click()" [disabled]="variantUploading()"
                        matTooltip="Можно выбрать несколько файлов сразу">
                  <mat-icon [class.spin]="variantUploading()">{{ variantUploading() ? 'progress_activity' : 'add' }}</mat-icon> {{ variantBtnLabel() }}
                </button>
              </div>
            }
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
      position: relative;
    }
    .widget-header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px;
      background: var(--crm-accent-muted, rgba(245,158,11,.12));
      font-weight: 500; font-size: 13px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent, #f59e0b); }
    }
    .step-dots { display: flex; align-items: center; margin-left: auto; }
    .step-dot {
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--crm-surface-overlay, #272520);
      border: 2px solid var(--crm-border, rgba(255,255,255,.06));
      display: flex; align-items: center; justify-content: center; transition: all .2s;
      mat-icon { font-size: 11px; width: 11px; height: 11px; color: var(--crm-surface-base, #0c0b09); }
      &.active { border-color: var(--crm-accent, #f59e0b); background: var(--crm-accent-muted, rgba(245,158,11,.12)); }
      &.done { background: var(--crm-status-success, #34d399); border-color: var(--crm-status-success, #34d399); }
    }
    .step-line { width: 12px; height: 2px; background: var(--crm-border, rgba(255,255,255,.06)); transition: background .2s;
      &.done { background: var(--crm-status-success, #34d399); } }

    .widget-loading, .widget-create { padding: 18px 16px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
    .widget-loading { flex-direction: row; justify-content: center; color: var(--crm-text-muted, #7a7a7a); font-size: 13px; }
    .create-info { font-size: 12px; color: var(--crm-text-muted, #7a7a7a); text-align: center; }
    .create-btn { width: 100%; }

    .widget-content { padding: 12px; display: flex; flex-direction: column; gap: 10px; }

    .client-status {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: var(--crm-radius-md, 8px); font-size: 12.5px; font-weight: 500;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      &.cs-success { background: var(--crm-status-success-muted, rgba(52,211,153,.12)); color: var(--crm-status-success, #34d399); }
      &.cs-warn { background: rgba(239,68,68,.1); color: var(--crm-status-error, #ef4444); }
      &.cs-info { background: var(--crm-accent-muted, rgba(245,158,11,.12)); color: var(--crm-accent, #f59e0b); }
      &.cs-muted { background: var(--crm-glass-bg, rgba(255,255,255,.03)); color: var(--crm-text-secondary, #a0a0a0); }
    }

    .super-hint {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 8px 10px; border-radius: var(--crm-radius-md, 8px); font-size: 12.5px; font-weight: 500;
      background: var(--crm-accent-muted, rgba(245,158,11,.12)); color: var(--crm-accent, #f59e0b);
      mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    }

    .section-label {
      display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500;
      color: var(--crm-text-secondary, #a0a0a0);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      .optional { color: var(--crm-text-muted, #7a7a7a); font-weight: 400; }
      .count-pill { margin-left: 2px; font-size: 11px; padding: 0 6px; border-radius: 8px;
        background: var(--crm-accent-muted, rgba(245,158,11,.12)); color: var(--crm-accent, #f59e0b); }
    }

    .dropzone {
      border: 2px dashed var(--crm-border, rgba(255,255,255,.06));
      border-radius: var(--crm-radius-lg, 12px);
      padding: 20px; display: flex; flex-direction: column; align-items: center; gap: 6px;
      cursor: pointer; transition: all .2s; font-size: 12px; color: var(--crm-text-muted, #7a7a7a);
      background: var(--crm-glass-bg, rgba(255,255,255,.03)); position: relative;
      mat-icon { font-size: 28px; width: 28px; height: 28px; }
      &.dragover { border-color: var(--crm-accent, #f59e0b); background: var(--crm-accent-muted, rgba(245,158,11,.12)); }
      &--small { padding: 12px; flex-direction: row; }
    }
    .original-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; }
    .original-uploaded { font-size: 11px; color: var(--crm-status-success, #34d399); }
    .browse-btn { margin-left: auto; }

    .photos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; }
    .grid-thumb {
      position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; cursor: pointer;
      border: 2px solid var(--crm-border, rgba(255,255,255,.06)); transition: border-color .15s;
      &:hover { border-color: var(--crm-accent, #f59e0b); }
      img { width: 100%; height: 100%; object-fit: cover; display: block; }
      &.st-approved { border-color: var(--crm-status-success, #34d399); }
      &.st-rejected { border-color: var(--crm-status-error, #ef4444); }
    }
    .variant-badge {
      position: absolute; bottom: 3px; left: 3px; background: rgba(0,0,0,.7); color: #fff;
      font-size: 9px; padding: 1px 5px; border-radius: 4px; font-weight: 500;
    }
    .status-dot {
      position: absolute; bottom: 2px; right: 2px; display: flex;
      mat-icon { font-size: 16px; width: 16px; height: 16px; border-radius: 50%; background: rgba(0,0,0,.5); }
    }
    .grid-thumb.st-approved .status-dot mat-icon { color: var(--crm-status-success, #34d399); }
    .grid-thumb.st-rejected .status-dot mat-icon { color: var(--crm-status-error, #ef4444); }
    .thumb-remove {
      position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,.65); border: none; border-radius: 50%;
      color: #fff; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; opacity: 0; transition: opacity .15s;
      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }
    .grid-thumb:hover .thumb-remove { opacity: 1; }
    .grid-add {
      position: relative; aspect-ratio: 1; border-radius: 8px;
      border: 2px dashed var(--crm-border, rgba(255,255,255,.06));
      display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s;
      color: var(--crm-text-muted, #7a7a7a);
      mat-icon { font-size: 24px; width: 24px; height: 24px; }
      &.dragover { border-color: var(--crm-accent, #f59e0b); background: var(--crm-accent-muted, rgba(245,158,11,.12)); }
      &:hover { border-color: var(--crm-accent, #f59e0b); color: var(--crm-accent, #f59e0b); }
    }
    .grid-add-click { position: absolute; inset: 0; background: transparent; border: none; cursor: pointer; }

    .send-btn { width: 100%; margin-top: 2px; }

    .share-row { display: flex; gap: 4px; align-items: center; }
    .share-input {
      flex: 1; min-width: 0; font-size: 11px; padding: 6px 8px;
      border: 1px solid var(--crm-border, rgba(255,255,255,.06)); border-radius: var(--crm-radius-md, 8px);
      background: var(--crm-glass-bg, rgba(255,255,255,.03)); color: var(--crm-text-secondary, #a0a0a0);
    }

    .spin { animation: aw-spin 1s linear infinite; }
    @keyframes aw-spin { to { transform: rotate(360deg); } }

    /* Lightbox */
    .lightbox-overlay {
      position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.85);
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .lightbox-content {
      position: relative; max-width: 90vw; max-height: 90vh;
      display: flex; flex-direction: column; gap: 12px; align-items: center;
    }
    .lightbox-close {
      position: absolute; top: -12px; right: -12px; z-index: 10;
      background: rgba(255,255,255,.12); border: none; border-radius: 50%; color: #fff;
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer;
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }
    .lightbox-img { max-width: 100%; max-height: 56vh; border-radius: 8px; object-fit: contain; }
    .lightbox-comment {
      display: flex; align-items: flex-start; gap: 6px; max-width: 480px;
      padding: 8px 12px; border-radius: 8px; background: rgba(239,68,68,.12); color: #fecaca; font-size: 13px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; }
    }
    .lightbox-variants { width: 100%; max-width: 560px;
      .lightbox-variants-label { font-size: 11px; color: #aaa; margin-bottom: 6px; } }
    .lightbox-variants-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    .lightbox-variant {
      position: relative; flex-shrink: 0; text-align: center; cursor: pointer;
      img { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; border: 2px solid transparent; transition: border-color .15s;
        &:hover { border-color: var(--crm-accent, #f59e0b); } }
      span { display: block; font-size: 10px; color: #aaa; max-width: 56px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      &.active img { border-color: var(--crm-accent, #f59e0b); }
    }
    .variant-remove-sm {
      position: absolute; top: -4px; right: -4px; background: rgba(0,0,0,.7); border: none; border-radius: 50%;
      color: #fff; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; cursor: pointer;
      mat-icon { font-size: 10px; width: 10px; height: 10px; }
    }
    .lightbox-actions { display: flex; gap: 8px; align-items: center; width: 100%; max-width: 560px; }
    .label-input {
      flex: 1; padding: 6px 10px; font-size: 12px;
      background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #fff; outline: none;
      &:focus { border-color: var(--crm-accent, #f59e0b); }
    }
  `],
})
export class OrderApprovalWidgetComponent {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly clipboard = inject(Clipboard);
  private readonly wsService = inject(WebSocketService);
  private readonly platformId = inject(PLATFORM_ID);

  /** UUID заказа (photo_print_orders.id). */
  orderId = input.required<string>();
  chatSessionId = input<string | null>(null);
  clientName = input<string | null>(null);
  clientPhone = input<string | null>(null);
  refreshKey = input(0);
  /** Заказ с Супер-обработкой — показываем подсказку про до 10 вариантов. */
  superRetouch = input<boolean>(false);

  /**
   * Статус сессии согласования изменился (загрузка/переотправка/ответ клиента).
   * Родитель (панель заказа) перечитывает заказ — его статус мог автоматически
   * перейти (Готов / Завершён / На доработке) на бэке по этому же событию.
   */
  readonly approvalUpdated = output<string | null>();

  readonly session = signal<ApprovalSession | null>(null);
  readonly photos = signal<ApprovalPhoto[]>([]);
  readonly originalUrl = signal<string | null>(null);
  readonly loading = signal(false);
  readonly creating = signal(false);
  readonly sending = signal(false);
  readonly justSent = signal(false);
  readonly originalUploadProgress = signal(0);
  readonly uploadProgress = signal(0);
  readonly variantUploading = signal(false);
  /** Прогресс мультизагрузки вариантов: всего файлов и сколько уже загружено. */
  readonly variantUploadTotal = signal(0);
  readonly variantUploadDone = signal(0);
  readonly isDragOriginal = signal(false);
  readonly isDragPhotos = signal(false);
  readonly lightboxPhoto = signal<ApprovalPhoto | null>(null);
  readonly lightboxVariantUrl = signal<string | null>(null);
  readonly copied = signal(false);

  variantLabels: Record<string, string> = {};

  readonly steps = [
    { idx: 0, label: 'Загрузка' },
    { idx: 1, label: 'Отправка' },
    { idx: 2, label: 'У клиента' },
  ];

  readonly currentStep = computed(() => {
    const s = this.session();
    if (!s) return 0;
    if (s.link_sent_at || this.justSent()) return 2;
    if (this.photos().length === 0) return 0;
    return 1;
  });

  /** Сессия одобрена/завершена — загрузку блокируем. */
  readonly isLocked = computed(() => {
    const st = this.session()?.status;
    return st === 'approved' || st === 'completed';
  });

  readonly fullShareUrl = computed(() => {
    const s = this.session();
    return s ? `https://svoefoto.ru/photo-review/${s.public_token}` : '';
  });

  readonly hasChat = computed(() => !!this.session()?.chat_session_id);

  /** Подпись кнопки «Вариант»: при мультизагрузке показываем «N из M». */
  readonly variantBtnLabel = computed(() => {
    const total = this.variantUploadTotal();
    if (total > 1) return `${this.variantUploadDone()} из ${total}`;
    return 'Вариант';
  });

  readonly sendLabel = computed(() => {
    if (this.sending()) return 'Отправка...';
    if (!this.hasChat()) return 'Скопировать ссылку';
    const s = this.session();
    return (s?.link_sent_at || this.justSent()) ? 'Отправить повторно' : 'Отправить клиенту';
  });

  readonly sendIcon = computed(() => {
    if (this.sending()) return 'progress_activity';
    return this.hasChat() ? 'send' : 'content_copy';
  });

  /** Сводка ответа клиента под заголовком. */
  readonly statusInfo = computed<{ kind: string; icon: string; text: string } | null>(() => {
    const s = this.session();
    if (!s) return null;
    const rejected = this.photos().filter(p => p.status === 'rejected').length;
    const approved = this.photos().filter(p => p.status === 'approved').length;
    switch (s.status) {
      case 'changes_requested':
      case 'partially_approved':
        return { kind: 'warn', icon: 'edit_note', text: `Клиент просит правки: ${rejected} фото` };
      case 'approved':
      case 'completed':
        return { kind: 'success', icon: 'check_circle', text: 'Клиент одобрил все фото' };
      case 'in_review':
        return { kind: 'info', icon: 'visibility', text: approved ? `Просмотрено, одобрено ${approved}` : 'Клиент смотрит фото' };
      default:
        if (s.link_sent_at && !s.first_viewed_at) return { kind: 'muted', icon: 'schedule', text: 'Отправлено, ждём просмотра' };
        return null;
    }
  });

  private readonly orderEffect = effect(() => {
    const oid = this.orderId();
    this.refreshKey();
    if (oid && isPlatformBrowser(this.platformId)) {
      this.session.set(null);
      this.photos.set([]);
      this.originalUrl.set(null);
      this.justSent.set(false);
      this.loadByOrder(oid);
    }
  });

  private readonly wsEffect = effect(() => {
    const evt = this.wsService.approvalEvent();
    if (!evt) return;
    const sid = this.session()?.id;
    if (sid && (evt.data as Record<string, string>)['sessionId'] === sid) {
      this.loadSession(sid);
    }
  });

  private loadByOrder(orderId: string): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; data: { id: string }[] }>(
      `/api/photo-approvals/sessions?order_id=${orderId}&limit=1`,
    ).subscribe({
      next: (res) => {
        if (res.success && res.data?.length) {
          this.loadSession(res.data[0].id);
        } else {
          this.loading.set(false);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private loadSession(id: string): void {
    this.http.get<{ success: boolean; session: ApprovalSession; photos: ApprovalPhoto[] }>(
      `/api/photo-approvals/sessions/${id}`,
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.session.set(res.session);
          this.photos.set((res.photos || []).map(p => ({ ...p, variants: p.variants || [] })));
          this.originalUrl.set(res.session.original_photo_url);
          this.syncLightbox();
          this.approvalUpdated.emit(res.session.status);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить согласование');
      },
    });
  }

  /** После перезагрузки сессии обновить открытый в лайтбоксе снимок. */
  private syncLightbox(): void {
    const lb = this.lightboxPhoto();
    if (!lb) return;
    const fresh = this.photos().find(p => p.id === lb.id);
    this.lightboxPhoto.set(fresh ?? null);
    if (!fresh) this.lightboxVariantUrl.set(null);
  }

  createSession(): void {
    this.creating.set(true);
    this.http.post<{ success: boolean; session: ApprovalSession }>('/api/photo-approvals/sessions', {
      client_name: this.clientName()?.trim() || 'Клиент',
      client_phone: this.clientPhone()?.trim() || undefined,
      order_id: this.orderId(),
      chat_session_id: this.chatSessionId() || undefined,
      defer_send: true,
    }).subscribe({
      next: (res) => {
        if (res.success) this.session.set(res.session);
        this.creating.set(false);
      },
      error: () => {
        this.creating.set(false);
        this.toast.error('Не удалось создать согласование');
      },
    });
  }

  // ─── Drag & drop ────────────────────────────────────────────────────────────
  onDragOver(event: DragEvent, zone: 'original' | 'photos'): void {
    event.preventDefault();
    event.stopPropagation();
    if (zone === 'original') this.isDragOriginal.set(true); else this.isDragPhotos.set(true);
  }
  onDropOriginal(event: DragEvent): void {
    event.preventDefault();
    this.isDragOriginal.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) void this.uploadOriginal(file);
  }
  onDropPhotos(event: DragEvent): void {
    event.preventDefault();
    this.isDragPhotos.set(false);
    const files = event.dataTransfer?.files;
    if (files) for (const file of Array.from(files)) void this.uploadPhoto(file);
  }
  onOriginalSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) { void this.uploadOriginal(input.files[0]); input.value = ''; }
  }
  onPhotosSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) { for (const file of Array.from(input.files)) void this.uploadPhoto(file); input.value = ''; }
  }
  async onVariantSelected(event: Event, photoId: string): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (!files.length) return;
    // При мультивыборе грузим без подписи (label уйдёт только на первый файл),
    // варианты пронумеруются автоматически («Вар. N»). Один файл — с подписью, как раньше.
    const withLabel = files.length === 1;
    this.variantUploadTotal.set(files.length);
    this.variantUploadDone.set(0);
    try {
      // Последовательно (await каждый), чтобы sort_order MAX+1 на бэке не словил гонку.
      for (const file of files) {
        await this.uploadVariant(photoId, file, withLabel);
        this.variantUploadDone.update(n => n + 1);
      }
    } finally {
      this.variantUploadTotal.set(0);
      this.variantUploadDone.set(0);
    }
  }

  // ─── Загрузка через presign + PUT в S3 ──────────────────────────────────────
  private async presignAndPut(file: File, onProgress?: (pct: number) => void): Promise<string> {
    const presign = await firstValueFrom(
      this.http.post<PresignResponse>('/api/photo-approvals/direct-upload/presign', {
        files: [{ fileName: file.name, contentType: file.type, fileSize: file.size }],
      }),
    );
    const { s3Key, uploadUrl } = presign.data.uploads[0];
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(30 + Math.round((e.loaded / e.total) * 60));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`S3 PUT ${xhr.status}`));
      xhr.onerror = () => reject(new Error('S3 PUT network error'));
      xhr.send(file);
    });
    return s3Key;
  }

  private async uploadOriginal(file: File): Promise<void> {
    const s = this.session();
    if (!s || !file.type.startsWith('image/') || this.originalUploadProgress() > 0) return;
    this.originalUploadProgress.set(10);
    try {
      const s3Key = await this.presignAndPut(file, p => this.originalUploadProgress.set(p));
      this.originalUploadProgress.set(95);
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; original: { url: string; thumbnailUrl: string | null } }>(
          `/api/photo-approvals/sessions/${s.id}/photos`, { s3Key, role: 'original' },
        ),
      );
      if (res.success) this.originalUrl.set(res.original.thumbnailUrl || res.original.url);
    } catch {
      this.toast.error('Не удалось загрузить исходник');
    } finally {
      this.originalUploadProgress.set(0);
    }
  }

  private async uploadPhoto(file: File): Promise<void> {
    const s = this.session();
    if (!s || !file.type.startsWith('image/')) return;
    this.uploadProgress.set(10);
    try {
      const s3Key = await this.presignAndPut(file, p => this.uploadProgress.set(p));
      this.uploadProgress.set(95);
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; photo: ApprovalPhoto }>(
          `/api/photo-approvals/sessions/${s.id}/photos`, { s3Key },
        ),
      );
      if (res.success) this.photos.update(list => [...list, { ...res.photo, variants: [] }]);
    } catch {
      this.toast.error('Не удалось загрузить фото');
    } finally {
      this.uploadProgress.set(0);
    }
  }

  private async uploadVariant(photoId: string, file: File, withLabel = true): Promise<void> {
    const s = this.session();
    if (!s || !file.type.startsWith('image/')) return;
    this.variantUploading.set(true);
    try {
      const s3Key = await this.presignAndPut(file);
      const label = withLabel ? (this.variantLabels[photoId]?.trim() || '') : '';
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; variant: ApprovalVariant }>(
          `/api/photo-approvals/sessions/${s.id}/photos/${photoId}/variants`,
          { s3Key, label },
        ),
      );
      if (res.success) {
        this.photos.update(list => list.map(p =>
          p.id === photoId ? { ...p, variants: [...p.variants, res.variant] } : p));
        if (withLabel) this.variantLabels[photoId] = '';
        this.syncLightbox();
      }
    } catch {
      this.toast.error('Не удалось загрузить вариант');
    } finally {
      this.variantUploading.set(false);
    }
  }

  removePhoto(photoId: string): void {
    const s = this.session();
    if (!s) return;
    this.http.delete(`/api/photo-approvals/sessions/${s.id}/photos/${photoId}`).subscribe({
      next: () => {
        this.photos.update(list => list.filter(p => p.id !== photoId));
        if (this.lightboxPhoto()?.id === photoId) this.closeLightbox();
      },
      error: () => this.toast.error('Не удалось удалить фото'),
    });
  }

  removeVariant(photoId: string, variantId: string): void {
    const s = this.session();
    if (!s) return;
    this.http.delete(`/api/photo-approvals/sessions/${s.id}/photos/${photoId}/variants/${variantId}`).subscribe({
      next: () => {
        this.photos.update(list => list.map(p =>
          p.id === photoId ? { ...p, variants: p.variants.filter(v => v.id !== variantId) } : p));
        this.syncLightbox();
      },
      error: () => this.toast.error('Не удалось удалить вариант'),
    });
  }

  openLightbox(photo: ApprovalPhoto): void {
    this.lightboxPhoto.set(photo);
    this.lightboxVariantUrl.set(null);
  }
  closeLightbox(): void {
    this.lightboxPhoto.set(null);
    this.lightboxVariantUrl.set(null);
  }

  onSendClick(): void {
    if (!this.hasChat()) {
      this.copyLink();
      this.toast.success('Ссылка скопирована. Отправьте её клиенту');
      return;
    }
    this.send();
  }

  send(): void {
    const s = this.session();
    if (!s || !this.photos().length) return;
    this.sending.set(true);
    this.http.post<{ success: boolean }>(`/api/photo-approvals/sessions/${s.id}/send-to-chat`, {}).subscribe({
      next: (res) => {
        this.sending.set(false);
        if (res.success) {
          this.justSent.set(true);
          // Бэк перевёл заказ в «Готов» — даём родителю перечитать заказ.
          this.approvalUpdated.emit(this.session()?.status ?? null);
          this.toast.success(s.chat_session_id ? 'Фото отправлены клиенту' : 'Готово. Скопируйте ссылку клиенту');
        }
      },
      error: () => {
        this.sending.set(false);
        if (!s.chat_session_id) {
          this.toast.warning('У заказа нет чата. Скопируйте ссылку и отправьте клиенту');
        } else {
          this.toast.error('Не удалось отправить');
        }
      },
    });
  }

  copyLink(): void {
    this.clipboard.copy(this.fullShareUrl());
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  photoStatusLabel(status: string): string {
    if (status === 'approved') return 'Одобрено клиентом';
    if (status === 'rejected') return 'Клиент просит правки';
    return 'Ожидает';
  }
}
