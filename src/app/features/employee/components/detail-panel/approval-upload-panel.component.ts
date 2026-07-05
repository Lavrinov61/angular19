import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy, PLATFORM_ID, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Clipboard } from '@angular/cdk/clipboard';
import { ToastService } from '../../../../core/services/toast.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { EntityNotesComponent } from '../shared/entity-notes.component';

interface PresignResponse {
  success: boolean;
  data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] };
}

interface ApprovalSession {
  id: string;
  public_token: string;
  client_name: string;
  client_phone: string;
  title: string;
  status: string;
  total_photos: number;
  approved_count: number;
  rejected_count: number;
  first_viewed_at: string | null;
  created_at: string;
  shareUrl: string;
  chat_session_id: string | null;
  original_photo_url: string | null;
}

interface ApprovalPhoto {
  id: string;
  retouched_photo_url: string;
  thumbnail_url: string | null;
  original_photo_url: string | null;
  status: string;
  comment: string | null;
  rejected_at: string | null;
  annotations: {
    id: string;
    annotation: Record<string, unknown>;
    created_at: string;
  }[] | null;
}

@Component({
  selector: 'app-approval-upload-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatProgressBarModule, MatProgressSpinnerModule,
    MatChipsModule, MatDividerModule, MatTooltipModule,
    EntityNotesComponent,
  ],
  template: `
    @if (loading()) {
      <div class="center-state">
        <mat-spinner diameter="32" />
      </div>
    } @else if (!session()) {
      @if (orderId()) {
        <!-- Контекст заказа: одна кнопка, без формы -->
        <div class="order-context">
          <button mat-stroked-button class="start-btn" (click)="createSession()"
                  [disabled]="creating()">
            @if (creating()) {
              <mat-spinner diameter="20" />
            } @else {
              <mat-icon>cloud_upload</mat-icon>
            }
            Загрузить результаты
          </button>
          <span class="start-hint">Загрузить обработанные фото для согласования с клиентом</span>
        </div>
      } @else {
        <!-- Standalone: полная форма -->
        <div class="panel-content">
          <div class="panel-header">
            <mat-icon>photo_camera</mat-icon>
            <h3>Новое согласование</h3>
          </div>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Имя клиента</mat-label>
            <input matInput [(ngModel)]="clientName" required>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Телефон</mat-label>
            <input matInput [(ngModel)]="clientPhone" placeholder="+7 (___) ___-__-__">
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Название</mat-label>
            <input matInput [(ngModel)]="sessionTitle" placeholder="Фотосессия 16.02.2026">
          </mat-form-field>

          <button mat-flat-button class="create-btn" (click)="createSession()"
                  [disabled]="!clientName.trim() || creating()">
            @if (creating()) {
              <mat-spinner diameter="20" />
            } @else {
              <mat-icon>add</mat-icon>
            }
            Создать
          </button>
        </div>
      }
    } @else {
      <!-- Step 2+: Session exists -->
      <div class="panel-content">
        <div class="panel-header">
          <mat-icon>photo_camera</mat-icon>
          <h3>{{ session()!.title }}</h3>
        </div>

        <!-- Changes requested alert -->
        @if (hasChangesRequested()) {
          <div class="changes-alert">
            <mat-icon>warning_amber</mat-icon>
            <div>
              <strong>Клиент запросил правки</strong>
              <span>{{ rejectedCount() }} фото на доработку</span>
            </div>
          </div>
        }

        <!-- Rework section: rejected photos with context -->
        @if (rejectedPhotos().length > 0) {
          <div class="rework-section">
            @for (rp of rejectedPhotos(); track rp.id) {
              <div class="rework-card">
                <div class="rework-photo-row">
                  <img [src]="rp.thumbnail_url || rp.retouched_photo_url" class="rework-thumb"
                       (click)="expandedPhoto.set(rp)" (keydown.enter)="expandedPhoto.set(rp)" tabindex="0" alt="Фото на доработке" />
                  <div class="rework-details">
                    <span class="rework-status">На доработке</span>
                    @if (rp.comment) {
                      <div class="rework-comment">
                        <mat-icon>format_quote</mat-icon>
                        <span>{{ rp.comment }}</span>
                      </div>
                    }
                    @if (rp.annotations && rp.annotations.length > 0) {
                      @for (a of rp.annotations; track a.id) {
                        <div class="rework-annotation">
                          @if (a.annotation['type'] === 'operator_clarification') {
                            <mat-icon>support_agent</mat-icon>
                          } @else {
                            <mat-icon>push_pin</mat-icon>
                          }
                          <span>{{ a.annotation['comment'] }}</span>
                        </div>
                      }
                    }
                  </div>
                </div>
                <div class="clarification-row">
                  <input type="text" class="clarification-input"
                         placeholder="Уточнить у клиента..."
                         [value]="clarificationTexts()[rp.id] || ''"
                         (input)="setClarification(rp.id, $any($event.target).value)"
                         (keydown.enter)="sendClarification(rp.id)" />
                  <button mat-icon-button [disabled]="!clarificationTexts()[rp.id]?.trim()"
                          (click)="sendClarification(rp.id)">
                    <mat-icon>send</mat-icon>
                  </button>
                </div>
              </div>
            }
          </div>
        }

        <div class="session-info">
          <div class="info-row">
            <mat-icon>person</mat-icon>
            <span>{{ session()!.client_name }}</span>
          </div>
          @if (session()!.client_phone) {
            <div class="info-row">
              <mat-icon>phone</mat-icon>
              <span>{{ session()!.client_phone }}</span>
            </div>
          }
          <div class="info-row">
            <mat-icon>{{ statusIcon() }}</mat-icon>
            <span>{{ statusText() }}</span>
            @if (session()!.first_viewed_at) {
              <mat-chip class="viewed-chip">Просмотрено</mat-chip>
            }
          </div>
        </div>

        <mat-divider />

        <!-- Исходное фото (откадрированное, загружает сотрудник) -->
        <div class="source-photo-section">
          <div class="section-label"><mat-icon>photo_camera</mat-icon> Исходное фото</div>
          @if (session()?.original_photo_url) {
            <div class="source-photo-preview">
              <img [src]="session()!.original_photo_url!" alt="Исходник" class="source-thumb" />
              <a [href]="session()!.original_photo_url!" target="_blank" download matTooltip="Скачать исходник">
                <mat-icon>download</mat-icon>
              </a>
              @if (session()!.status !== 'completed' && session()!.status !== 'approved') {
                <button mat-icon-button matTooltip="Заменить" (click)="sourceFileInput.click()">
                  <mat-icon>swap_horiz</mat-icon>
                </button>
              }
            </div>
          } @else {
            <button class="source-upload-zone" (click)="sourceFileInput.click()" [class.uploading]="sourceUploading()" type="button">
              @if (sourceUploading()) {
                <mat-progress-bar mode="indeterminate"></mat-progress-bar>
              } @else {
                <mat-icon>add_photo_alternate</mat-icon>
                <span>Загрузить откадрированное фото</span>
              }
            </button>
          }
          <input #sourceFileInput type="file" accept="image/*" hidden
                 (change)="onSourceFileSelect($event)">
        </div>

        <mat-divider />

        <div class="section-label results-label"><mat-icon>auto_fix_high</mat-icon> Результаты обработки</div>

        <!-- Upload zone (compact when photos exist) -->
        @if (session()!.status !== 'completed' && session()!.status !== 'approved') {
          @if (photos().length === 0) {
            <div class="upload-zone"
                 (dragover)="onDragOver($event)"
                 (dragleave)="dragOver.set(false)"
                 (drop)="onDrop($event)"
                 [class.drag-over]="dragOver()">
              <mat-icon>cloud_upload</mat-icon>
              <span>Перетащите фото сюда</span>
              <span class="upload-hint">или</span>
              <button mat-stroked-button (click)="fileInput.click()">
                <mat-icon>add_photo_alternate</mat-icon>
                Выбрать файлы
              </button>
              <input #fileInput type="file" accept="image/*" multiple hidden
                     (change)="onFileSelect($event)">
            </div>
          } @else {
            <div class="compact-upload"
                 (dragover)="onDragOver($event)"
                 (dragleave)="dragOver.set(false)"
                 (drop)="onDrop($event)"
                 [class.drag-over]="dragOver()">
              <button mat-stroked-button (click)="fileInput.click()">
                <mat-icon>add_photo_alternate</mat-icon>
                Добавить фото
              </button>
              <input #fileInput type="file" accept="image/*" multiple hidden
                     (change)="onFileSelect($event)">
            </div>
          }

          @if (uploadProgress() > 0 && uploadProgress() < 100) {
            <mat-progress-bar mode="determinate" [value]="uploadProgress()" />
          }
        }

        <!-- Expanded photo overlay -->
        @if (expandedPhoto(); as ep) {
          <div class="expanded-overlay">
            <div class="expanded-header">
              <span class="expanded-title">
                @if (ep.status === 'rejected') {
                  <span class="status-badge-sm rejected">На доработке</span>
                } @else if (ep.status === 'approved') {
                  <span class="status-badge-sm approved">Одобрено</span>
                } @else {
                  <span class="status-badge-sm pending">Ожидает</span>
                }
                <span class="expanded-counter">Фото {{ expandedIndex() + 1 }} из {{ photos().length }}</span>
              </span>
              <div class="expanded-header-actions">
                <button mat-icon-button (click)="expandPrev()" [disabled]="expandedIndex() <= 0">
                  <mat-icon>chevron_left</mat-icon>
                </button>
                <button mat-icon-button (click)="expandNext()" [disabled]="expandedIndex() >= photos().length - 1">
                  <mat-icon>chevron_right</mat-icon>
                </button>
                <button mat-icon-button (click)="expandedPhoto.set(null)">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>
            @if (ep.comment) {
              <div class="expanded-comment">
                <mat-icon>edit_note</mat-icon>
                <span>{{ ep.comment }}</span>
              </div>
            }
            <div class="expanded-image-wrap">
              <img [src]="ep.retouched_photo_url" alt="">
              @if (ep.annotations) {
                @for (a of ep.annotations; track a.id; let i = $index) {
                  @if (a.annotation['x'] !== null) {
                    <div class="exp-pin"
                         [style.left.%]="a.annotation['x']"
                         [style.top.%]="a.annotation['y']">
                      <span class="exp-pin-num">{{ i + 1 }}</span>
                      <div class="exp-pin-tooltip">{{ a.annotation['comment'] }}</div>
                    </div>
                  }
                }
              }
            </div>
            @if (ep.annotations && ep.annotations.length > 0) {
              <div class="expanded-annotations">
                @for (a of ep.annotations; track a.id; let i = $index) {
                  <div class="exp-annotation-row">
                    @if (a.annotation['x'] !== null) {
                      <span class="exp-ann-pin">{{ i + 1 }}</span>
                    } @else {
                      <mat-icon>comment</mat-icon>
                    }
                    <span>{{ a.annotation['comment'] }}</span>
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- Photos grid -->
        @if (photos().length > 0) {
          <div class="photos-grid">
            @for (photo of photos(); track photo.id) {
              <div class="photo-thumb" [class]="'status-' + photo.status"
                   (click)="expandedPhoto.set(photo)" (keydown.enter)="expandedPhoto.set(photo)" tabindex="0">
                <img [src]="photo.thumbnail_url || photo.retouched_photo_url" alt="" loading="lazy">
                <div class="thumb-badge">
                  @switch (photo.status) {
                    @case ('approved') { <mat-icon>check_circle</mat-icon> }
                    @case ('rejected') { <mat-icon>cancel</mat-icon> }
                    @default { <mat-icon>hourglass_empty</mat-icon> }
                  }
                </div>
                @if (hasFeedback(photo)) {
                  <span class="feedback-dot"></span>
                }
                @if (session()!.status !== 'completed' && session()!.status !== 'approved') {
                  <button class="delete-thumb" mat-icon-button (click)="onDeleteClick($event, photo.id)">
                    <mat-icon>close</mat-icon>
                  </button>
                }
                @if (photo.status === 'rejected' && photo.comment) {
                  <div class="reject-reason-bar">{{ photo.comment.length > 50 ? photo.comment.slice(0, 50) + '...' : photo.comment }}</div>
                }
              </div>
            }
          </div>

          <div class="stats-row">
            <span class="stat">{{ photos().length }} фото</span>
            @if (approvedCount() > 0) {
              <span class="stat approved">{{ approvedCount() }} одобрено</span>
            }
            @if (rejectedCount() > 0) {
              <span class="stat rejected">{{ rejectedCount() }} отклонено</span>
            }
          </div>
        }

        <mat-divider />

        <!-- Quick reply to client -->
        @if (session()!.chat_session_id) {
          <div class="quick-reply-section">
            <div class="quick-reply-header">
              <mat-icon>chat</mat-icon>
              <span>Ответить клиенту</span>
              <button mat-icon-button matTooltip="Открыть чат"
                      (click)="navigateToItem.emit({ type: 'chat', id: session()!.chat_session_id! })">
                <mat-icon>open_in_new</mat-icon>
              </button>
            </div>
            <div class="quick-reply-row">
              <input type="text" class="quick-reply-input"
                     placeholder="Написать клиенту..."
                     [(ngModel)]="quickReplyText"
                     (keydown.enter)="sendQuickReply()" />
              <button mat-icon-button [disabled]="!quickReplyText.trim()"
                      (click)="sendQuickReply()">
                <mat-icon>send</mat-icon>
              </button>
            </div>
          </div>
        }

        <!-- Share link -->
        @if (photos().length > 0) {
          <div class="share-section">
            <div class="share-label">Ссылка для клиента:</div>
            <div class="share-url">
              <input matInput [value]="fullShareUrl()" readonly class="url-input">
              <button mat-icon-button (click)="copyLink()">
                <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
              </button>
            </div>
          </div>
        }

        @if (session()) {
          <app-entity-notes entityType="approval" [entityId]="session()!.id" />
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }

    .center-state {
      display: flex; align-items: center; justify-content: center;
      height: 100%; padding: 24px;
    }

    .panel-content { padding: 16px; }

    .panel-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
      mat-icon { color: var(--crm-accent); }
      h3 { margin: 0; font-size: var(--crm-text-lg); font-weight: 600; }
    }

    .full-width { width: 100%; }

    .create-btn {
      width: 100%;
      height: 44px;
    }

    .order-context {
      display: flex; flex-direction: column; align-items: center;
      gap: 10px; padding: 20px 16px;
    }

    .start-btn {
      width: 100%; height: 44px;
    }

    .start-hint {
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
      text-align: center;
      line-height: 1.4;
    }

    .session-info { margin-bottom: 12px; }
    .info-row {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 0; font-size: var(--crm-text-base);
      color: var(--crm-text-secondary);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .viewed-chip {
      font-size: var(--crm-text-sm); height: 22px;
      border-radius: var(--crm-radius-sm);
    }

    mat-divider { margin: 12px 0; }

    .upload-zone {
      display: flex; flex-direction: column; align-items: center;
      gap: 8px; padding: 24px 16px; margin: 8px 0;
      border: 2px dashed var(--crm-border);
      border-radius: var(--crm-radius-lg); text-align: center;
      color: var(--crm-text-muted);
      transition: border-color var(--crm-transition-normal), background var(--crm-transition-normal);

      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.5; }
      .upload-hint { font-size: 12px; opacity: 0.7; }

      &.drag-over {
        border-color: var(--crm-accent);
        background: var(--crm-accent-muted);
      }
    }

    .changes-alert {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; margin: 0 0 12px;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: var(--crm-radius-lg);
      color: var(--crm-status-error);

      mat-icon { font-size: 22px; width: 22px; height: 22px; flex-shrink: 0; }
      div { display: flex; flex-direction: column; gap: 2px; }
      strong { font-size: var(--crm-text-base); }
      span { font-size: var(--crm-text-sm); opacity: 0.8; }
    }

    .compact-upload {
      display: flex; align-items: center; justify-content: center;
      padding: 8px; margin: 8px 0;
      border: 1px dashed var(--crm-border);
      border-radius: var(--crm-radius-md);
      transition: border-color var(--crm-transition-normal);

      &.drag-over {
        border-color: var(--crm-accent);
        background: var(--crm-accent-muted);
      }
    }

    .photos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px; margin: 12px 0;
    }

    .photo-thumb {
      position: relative; aspect-ratio: 1; border-radius: var(--crm-radius-md);
      overflow: hidden; border: 2px solid transparent; cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;

      &:hover { transform: scale(1.03); box-shadow: 0 2px 12px rgba(0,0,0,0.3); }

      img { width: 100%; height: 100%; object-fit: cover; }

      &.status-approved { border-color: var(--crm-status-success); }
      &.status-rejected { border-color: var(--crm-status-error); }
    }

    .thumb-badge {
      position: absolute; bottom: 4px; right: 4px;
      background: rgba(0,0,0,0.6); border-radius: 50%;
      width: 22px; height: 22px; display: flex;
      align-items: center; justify-content: center;
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: white; }
    }

    .photo-thumb.status-approved .thumb-badge { background: var(--crm-status-success); }
    .photo-thumb.status-rejected .thumb-badge { background: var(--crm-status-error); }

    .feedback-dot {
      position: absolute; top: 4px; left: 4px;
      width: 10px; height: 10px; border-radius: 50%;
      background: #ef4444; border: 2px solid rgba(0,0,0,0.4);
      z-index: 2;
    }

    .delete-thumb {
      position: absolute; top: 2px; right: 2px;
      width: 24px; height: 24px;
      background: rgba(0,0,0,0.5);
      border: none; border-radius: var(--crm-radius-sm); cursor: pointer;
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: white; }
    }

    /* Expanded photo overlay */
    .expanded-overlay {
      position: relative;
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      margin: 8px 0; padding: 0;
      overflow: hidden;
    }
    .expanded-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px;
    }
    .expanded-title { display: flex; align-items: center; gap: 6px; flex: 1; }
    .status-badge-sm {
      font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600;
      &.rejected { background: rgba(239,68,68,0.15); color: var(--crm-status-error); }
      &.approved { background: rgba(34,197,94,0.15); color: var(--crm-status-success); }
      &.pending { background: rgba(255,255,255,0.1); color: var(--crm-text-muted); }
    }
    .expanded-image-wrap {
      position: relative; width: 100%;
      img { width: 100%; display: block; max-height: 70vh; object-fit: contain; background: #111; }
    }
    .exp-pin {
      position: absolute; transform: translate(-50%, -100%); z-index: 5; cursor: pointer;
      .exp-pin-num {
        display: flex; align-items: center; justify-content: center;
        width: 22px; height: 22px;
        border-radius: 50% 50% 50% 0;
        background: var(--crm-status-error); color: #fff;
        font-size: 10px; font-weight: 700;
        transform: rotate(-45deg);
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      }
      .exp-pin-tooltip {
        display: none; position: absolute; bottom: calc(100% + 4px);
        left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.85); color: #fff;
        padding: 4px 8px; border-radius: 6px; font-size: 11px;
        white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
      }
      &:hover .exp-pin-tooltip { display: block; }
    }
    .expanded-comment {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 10px 12px; margin: 0;
      background: rgba(239,68,68,0.06);
      border-top: 1px solid rgba(239,68,68,0.15);
      font-size: 13px; color: var(--crm-text-primary);
      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-status-error); flex-shrink: 0; margin-top: 1px; }
    }
    .expanded-annotations {
      padding: 8px 12px; max-height: 120px; overflow-y: auto;
      border-top: 1px solid var(--crm-border);
    }
    .exp-annotation-row {
      display: flex; align-items: flex-start; gap: 6px;
      padding: 4px 0; font-size: 12px; color: var(--crm-text-secondary);
      mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }
    }
    .exp-ann-pin {
      display: flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--crm-status-error); color: #fff;
      font-size: 10px; font-weight: 700; flex-shrink: 0;
    }
    .expanded-nav {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 6px; border-top: 1px solid var(--crm-border);
      font-size: 12px; color: var(--crm-text-muted);
    }

    .stats-row {
      display: flex; gap: 8px; margin: 8px 0;
    }
    .stat {
      font-size: 12px; padding: 2px 8px; border-radius: var(--crm-radius-sm);
      background: var(--crm-surface-raised); color: var(--crm-text-secondary);
      &.approved { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
      &.rejected { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    }

    .reject-reason-bar {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 3px 6px; font-size: 10px; line-height: 1.3;
      background: rgba(239, 68, 68, 0.85); color: #fff;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Rework section */
    .rework-section { display: flex; flex-direction: column; gap: 10px; margin: 0 0 12px; }

    .rework-card {
      background: rgba(239, 68, 68, 0.05);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: var(--crm-radius-lg);
      padding: 10px;
    }

    .rework-photo-row { display: flex; gap: 10px; }

    .rework-thumb {
      width: 64px; height: 64px; border-radius: var(--crm-radius-md);
      object-fit: cover; cursor: pointer; flex-shrink: 0;
      border: 2px solid var(--crm-status-error);
      transition: transform 0.15s;
      &:hover { transform: scale(1.05); }
    }

    .rework-details { flex: 1; min-width: 0; }

    .rework-status {
      font-size: 11px; font-weight: 600; color: var(--crm-status-error);
      text-transform: uppercase; letter-spacing: 0.04em;
    }

    .rework-comment {
      display: flex; align-items: flex-start; gap: 4px;
      margin-top: 4px; font-size: 13px; color: var(--crm-text-primary);
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-status-error); flex-shrink: 0; margin-top: 2px; }
    }

    .rework-annotation {
      display: flex; align-items: flex-start; gap: 4px;
      margin-top: 3px; font-size: 12px; color: var(--crm-text-secondary);
      mat-icon { font-size: 13px; width: 13px; height: 13px; flex-shrink: 0; margin-top: 1px; }
    }

    .clarification-row {
      display: flex; gap: 4px; align-items: center; margin-top: 8px;
    }

    .clarification-input {
      flex: 1; font-size: 12px; padding: 6px 10px;
      border: 1px solid var(--crm-border); border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised); color: var(--crm-text-primary);
      outline: none;
      &:focus { border-color: var(--crm-accent); }
      &::placeholder { color: var(--crm-text-muted); }
    }

    .quick-reply-section {
      margin: 4px 0 8px;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      padding: 8px 10px;
      background: var(--crm-surface-raised);
    }

    .quick-reply-header {
      display: flex; align-items: center; gap: 6px;
      margin-bottom: 6px; font-size: 13px; font-weight: 500;
      color: var(--crm-text-secondary);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      button { margin-left: auto; }
    }

    .quick-reply-row {
      display: flex; gap: 4px; align-items: center;
    }

    .quick-reply-input {
      flex: 1; font-size: 13px; padding: 7px 10px;
      border: 1px solid var(--crm-border); border-radius: var(--crm-radius-md);
      background: var(--crm-bg); color: var(--crm-text-primary); outline: none;
      &:focus { border-color: var(--crm-accent); }
      &::placeholder { color: var(--crm-text-muted); }
    }

    .expanded-counter {
      font-size: 12px; color: var(--crm-text-muted); margin-left: 8px;
    }

    .expanded-header-actions {
      display: flex; align-items: center; gap: 2px;
    }

    .source-photo-section { margin-bottom: 12px; }
    .section-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--crm-text-secondary); margin-bottom: 8px; }
    .section-label mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .results-label { margin-top: 12px; margin-bottom: 8px; }
    .source-photo-preview { display: inline-flex; align-items: flex-end; gap: 4px; }
    .source-thumb { width: 120px; height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid var(--crm-border-subtle); }
    .source-photos-grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .source-upload-zone { display: flex; align-items: center; gap: 8px; padding: 16px; background: var(--crm-surface-subtle); border: 2px dashed var(--crm-border-subtle); border-radius: 8px; color: var(--crm-text-secondary); font-size: 13px; cursor: pointer; transition: border-color 0.2s; }
    .source-upload-zone:hover { border-color: var(--crm-primary); color: var(--crm-primary); }
    .source-upload-zone.uploading { pointer-events: none; opacity: 0.7; }

    .share-section { margin-top: 4px; }
    .share-label {
      font-size: var(--crm-text-base); font-weight: 500; margin-bottom: 6px;
      color: var(--crm-text-primary);
    }
    .share-url {
      display: flex; gap: 4px; align-items: center; margin-bottom: 8px;
    }
    .url-input {
      flex: 1; font-size: 12px; padding: 6px 10px;
      border: 1px solid var(--crm-border); border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);
      color: var(--crm-text-primary);
    }

  `],
})
export class ApprovalUploadPanelComponent {
  private readonly http = inject(HttpClient);
  private readonly clipboard = inject(Clipboard);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly toast = inject(ToastService);
  private readonly wsService = inject(WebSocketService);

  sessionId = input<string | null>(null);
  orderId = input<string | null>(null);
  prefillName = input<string | null>(null);
  prefillPhone = input<string | null>(null);
  sourceUploading = signal(false);
  navigateToItem = output<{ type: string; id: string }>();

  session = signal<ApprovalSession | null>(null);
  photos = signal<ApprovalPhoto[]>([]);
  loading = signal(false);
  creating = signal(false);
  uploadProgress = signal(0);
  dragOver = signal(false);
  copied = signal(false);
  readonly expandedPhoto = signal<ApprovalPhoto | null>(null);

  clientName = '';
  clientPhone = '';
  sessionTitle = '';
  quickReplyText = '';

  approvedCount = computed(() => this.photos().filter(p => p.status === 'approved').length);
  rejectedCount = computed(() => this.photos().filter(p => p.status === 'rejected').length);

  readonly hasChangesRequested = computed(() =>
    ['changes_requested', 'partially_approved'].includes(this.session()?.status || '')
  );

  readonly rejectedPhotos = computed(() => this.photos().filter(p => p.status === 'rejected'));
  readonly clarificationTexts = signal<Record<string, string>>({});

  readonly expandedIndex = computed(() => {
    const ep = this.expandedPhoto();
    if (!ep) return -1;
    return this.photos().findIndex(p => p.id === ep.id);
  });

  statusIcon = computed(() => {
    const s = this.session()?.status;
    switch (s) {
      case 'pending': return 'schedule';
      case 'in_review': return 'visibility';
      case 'approved': return 'check_circle';
      case 'partially_approved': return 'rule';
      case 'changes_requested': return 'edit_note';
      case 'completed': return 'done_all';
      default: return 'info';
    }
  });

  statusText = computed(() => {
    const labels: Record<string, string> = {
      pending: 'Ожидает просмотра',
      in_review: 'На проверке',
      approved: 'Все одобрены',
      partially_approved: 'Частично одобрено',
      changes_requested: 'Нужны правки',
      completed: 'Завершено',
    };
    return labels[this.session()?.status || ''] || this.session()?.status || '';
  });

  fullShareUrl = computed(() => {
    const s = this.session();
    return s ? `https://svoefoto.ru/photo-review/${s.public_token}` : '';
  });


  private readonly sessionEffect = effect(() => {
    const id = this.sessionId();
    if (id && isPlatformBrowser(this.platformId)) {
      this.session.set(null);
      this.photos.set([]);
      this.loadSession(id);
    }
  });

  private readonly orderEffect = effect(() => {
    const oid = this.orderId();
    if (oid && isPlatformBrowser(this.platformId)) {
      this.session.set(null);
      this.photos.set([]);
      this.loadSessionByOrder(oid);
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

  hasFeedback(photo: ApprovalPhoto): boolean {
    return !!photo.comment || (photo.annotations != null && photo.annotations.length > 0);
  }

  onDeleteClick(event: Event, photoId: string): void {
    event.stopPropagation();
    this.deletePhoto(photoId);
  }

  expandPrev(): void {
    const idx = this.expandedIndex();
    if (idx > 0) this.expandedPhoto.set(this.photos()[idx - 1]);
  }

  expandNext(): void {
    const idx = this.expandedIndex();
    const list = this.photos();
    if (idx < list.length - 1) this.expandedPhoto.set(list[idx + 1]);
  }

  setClarification(photoId: string, text: string): void {
    this.clarificationTexts.update(m => ({ ...m, [photoId]: text }));
  }

  sendQuickReply(): void {
    const s = this.session();
    const text = this.quickReplyText.trim();
    if (!s?.chat_session_id || !text) return;

    this.http.post<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${s.chat_session_id}/reply`,
      { content: text }
    ).subscribe({
      next: () => {
        this.toast.success('Сообщение отправлено');
        this.quickReplyText = '';
      },
      error: () => this.toast.error('Не удалось отправить'),
    });
  }

  sendClarification(photoId: string): void {
    const s = this.session();
    const text = this.clarificationTexts()[photoId]?.trim();
    if (!s || !text) return;

    this.http.post<{ success: boolean; annotationId: string }>(
      `/api/photo-approvals/sessions/${s.id}/photos/${photoId}/clarification`,
      { text }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.toast.success('Уточнение отправлено');
          this.clarificationTexts.update(m => ({ ...m, [photoId]: '' }));
          this.loadSession(s.id);
        }
      },
      error: () => this.toast.error('Не удалось отправить уточнение'),
    });
  }

  private loadSession(id: string): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; session: ApprovalSession; photos: ApprovalPhoto[] }>(
      `/api/photo-approvals/sessions/${id}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.session.set(res.session);
          this.photos.set(res.photos || []);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить сессию');
      },
    });
  }

  private loadSessionByOrder(orderId: string): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; data: ApprovalSession[] }>(
      `/api/photo-approvals/sessions?order_id=${orderId}&limit=1`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data?.length) {
          this.loadSession(res.data[0].id);
        } else {
          this.clientName = this.prefillName() || '';
          this.clientPhone = this.prefillPhone() || '';
          this.loading.set(false);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  createSession(): void {
    const name = this.clientName.trim() || this.prefillName() || '';
    if (!name && !this.orderId()) return; // standalone: имя обязательно
    this.creating.set(true);

    this.http.post<{ success: boolean; session: ApprovalSession }>('/api/photo-approvals/sessions', {
      client_name: name,
      client_phone: this.clientPhone.trim() || this.prefillPhone() || null,
      title: this.sessionTitle.trim() || undefined,
      order_id: this.orderId() || undefined,
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.session.set(res.session);
        }
        this.creating.set(false);
      },
      error: () => {
        this.creating.set(false);
        this.toast.error('Не удалось создать сессию');
      },
    });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files) this.uploadFiles(Array.from(files));
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.uploadFiles(Array.from(input.files));
      input.value = '';
    }
  }

  onSourceFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      this.uploadSourceFile(input.files[0]);
      input.value = '';
    }
  }

  private async uploadSourceFile(file: File): Promise<void> {
    const s = this.session();
    if (!s || !file.type.startsWith('image/')) return;

    this.sourceUploading.set(true);
    try {
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
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject();
        xhr.onerror = () => reject();
        xhr.send(file);
      });

      await firstValueFrom(
        this.http.post(`/api/photo-approvals/sessions/${s.id}/photos`, { s3Key, role: 'original' }),
      );
      this.loadSession(s.id);
      this.toast.success('Исходное фото загружено');
    } catch {
      this.toast.error('Ошибка загрузки исходника');
    }
    this.sourceUploading.set(false);
  }

  private async uploadFiles(files: File[]): Promise<void> {
    const s = this.session();
    if (!s) return;

    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    let completed = 0;
    this.uploadProgress.set(1);

    for (const file of imageFiles) {
      try {
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
            if (e.lengthComputable) {
              const filePct = Math.round((e.loaded / e.total) * 100);
              this.uploadProgress.set(Math.round((completed / imageFiles.length) * 100 + filePct / imageFiles.length));
            }
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`S3 PUT ${xhr.status}`));
          xhr.onerror = () => reject(new Error('S3 PUT network error'));
          xhr.send(file);
        });

        const res = await firstValueFrom(
          this.http.post<{ success: boolean; photo: ApprovalPhoto }>(
            `/api/photo-approvals/sessions/${s.id}/photos`, { s3Key },
          ),
        );
        if (res.success) {
          this.photos.update(list => [...list, res.photo]);
          this.session.update(curr => curr ? { ...curr, total_photos: curr.total_photos + 1 } : null);
        }
        completed++;
      } catch {
        completed++;
        this.toast.error('Ошибка загрузки фото');
      }
    }
    this.uploadProgress.set(0);
  }

  deletePhoto(photoId: string): void {
    const s = this.session();
    if (!s) return;

    this.http.delete(`/api/photo-approvals/sessions/${s.id}/photos/${photoId}`).subscribe({
      next: () => {
        this.photos.update(list => list.filter(p => p.id !== photoId));
        this.session.update(s => s ? { ...s, total_photos: Math.max(s.total_photos - 1, 0) } : null);
      },
      error: () => this.toast.error('Не удалось удалить фото'),
    });
  }

  copyLink(): void {
    this.clipboard.copy(this.fullShareUrl());
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }
}
