import {
  Component, ChangeDetectionStrategy, inject,
  signal, computed, DestroyRef, afterNextRender, OnDestroy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { RetouchApiService, RetouchDetail, RetouchOption } from '../../services/retouch-api.service';
import { ToastService } from '../../../../core/services/toast.service';

/** View-модель для сгруппированного рендера опций ретуши в шаблоне. */
interface RetouchOptionItemView { key: string; label: string; }
interface RetouchOptionGroupView { key: string; name: string; items: RetouchOptionItemView[]; }

interface PresignResponse {
  success: boolean;
  data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] };
}

@Component({
  selector: 'app-retouch-task-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatCardModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatProgressSpinnerModule, MatExpansionModule,
  ],
  template: `
    <div class="task-card-page">
      @if (loading()) {
        <div class="loading">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Загрузка...</span>
        </div>
      } @else if (detail()) {
        <div class="card-header">
          <a routerLink="/employee/retouch-queue" class="back-link">
            <mat-icon>arrow_back</mat-icon>
            Назад к очереди
          </a>
          <div class="header-right">
            <h2>Задача #{{ detail()!.task.task_number }}
              @if (detail()!.task.title) {
                — {{ detail()!.task.title }}
              }
            </h2>
            @if (detail()!.task.priority === 'urgent') {
              <span class="priority-badge">Срочно</span>
            }
            @if (workDuration()) {
              <span class="timer">
                <mat-icon>timer</mat-icon>
                {{ workDuration() }}
              </span>
            }
          </div>
        </div>

        <div class="card-body">
          <div class="col-left">
            <!-- Source photo -->
            <mat-card class="section-card">
              <div class="section-title">
                <mat-icon>image</mat-icon>
                Исходник
              </div>
              @if (detail()!.task.source_photo_url) {
                <div class="source-photo">
                  <img [src]="detail()!.task.source_photo_url" alt="Исходное фото" />
                </div>
                <a mat-stroked-button
                   [href]="detail()!.task.source_photo_url"
                   target="_blank" download
                   class="download-btn">
                  <mat-icon>download</mat-icon>
                  Скачать оригинал
                </a>
              } @else {
                <div class="no-photo">Фото не загружено</div>
              }
            </mat-card>

            <!-- Upload result -->
            <mat-card class="section-card">
              <div class="section-title">
                <mat-icon>cloud_upload</mat-icon>
                Загрузка результата
              </div>

              @if (uploadedFile()) {
                <div class="preview-photo">
                  <img [src]="uploadedFile()!.url" alt="Результат" />
                  <button mat-icon-button class="remove-preview" (click)="uploadedFile.set(null)">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              } @else {
                <div class="dropzone"
                     (dragover)="onDragOver($event)"
                     (dragleave)="isDragging.set(false)"
                     (drop)="onDrop($event)"
                     [class.dragover]="isDragging()">
                  @if (uploading()) {
                    <mat-spinner diameter="32"></mat-spinner>
                    <span>Загрузка... {{ uploadProgress() }}%</span>
                  } @else {
                    <mat-icon>cloud_upload</mat-icon>
                    <span>Перетащите файл или</span>
                    <input type="file" hidden #fileInput accept="image/*" (change)="onFileSelected($event)" />
                    <button mat-stroked-button (click)="fileInput.click()">Выбрать</button>
                  }
                </div>
              }

              <button mat-flat-button color="primary"
                      class="submit-btn"
                      [disabled]="!canSubmit()"
                      (click)="sendForApproval()">
                <mat-icon>send</mat-icon>
                {{ submitting() ? 'Отправка...' : 'Отправить на согласование' }}
              </button>
            </mat-card>
          </div>

          <div class="col-right">
            <!-- Parameters -->
            <mat-card class="section-card">
              <div class="section-title">
                <mat-icon>tune</mat-icon>
                Параметры
              </div>
              <div class="params-list">
                @if (detail()!.task.title) {
                  <div class="param-row">
                    <span class="param-label">Документ</span>
                    <span class="param-value">{{ detail()!.task.title }}</span>
                  </div>
                }
                <div class="param-row">
                  <span class="param-label">Обработка</span>
                  <span class="level-chip" [class]="'level-' + detail()!.task.retouch_level">
                    {{ levelLabel(detail()!.task.retouch_level) }}
                  </span>
                </div>
                @if (detail()!.task.retouch_options.length) {
                  <div class="param-row">
                    <span class="param-label">Опции</span>
                    <div class="options-groups">
                      @for (grp of groupedOptions(detail()!.task.retouch_options); track grp.key) {
                        <div class="option-group">
                          @if (grp.name) {
                            <div class="option-group-name">{{ grp.name }}</div>
                          }
                          <div class="chips-wrap">
                            @for (opt of grp.items; track opt.key) {
                              <span class="option-chip">{{ opt.label }}</span>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  </div>
                }
                @if (detail()!.task.client_name) {
                  <div class="param-row">
                    <span class="param-label">Клиент</span>
                    <span class="param-value">{{ detail()!.task.client_name }}</span>
                  </div>
                }
                @if (detail()!.task.client_phone) {
                  <div class="param-row">
                    <span class="param-label">Телефон</span>
                    <span class="param-value">{{ detail()!.task.client_phone }}</span>
                  </div>
                }
                @if (detail()!.task.studio_name) {
                  <div class="param-row">
                    <span class="param-label">Студия</span>
                    <span class="param-value">{{ detail()!.task.studio_name }}</span>
                  </div>
                }
              </div>
            </mat-card>

            <!-- Feedback (if revisions) -->
            @if (detail()!.task.revision_count > 0 && detail()!.feedback?.length) {
              <mat-card class="section-card feedback-card">
                <div class="section-title">
                  <mat-icon>rate_review</mat-icon>
                  Feedback (ревизия {{ detail()!.task.revision_count }})
                </div>
                @for (fb of detail()!.feedback!; track $index) {
                  <div class="feedback-item">
                    <mat-icon>comment</mat-icon>
                    <span>{{ fb.comment }}</span>
                  </div>
                }
              </mat-card>
            }

            <!-- History -->
            <mat-accordion>
              <mat-expansion-panel>
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    <mat-icon>history</mat-icon>
                    История
                  </mat-panel-title>
                </mat-expansion-panel-header>
                @if (detail()!.history.length) {
                  <div class="history-list">
                    @for (entry of detail()!.history; track $index) {
                      <div class="history-item">
                        <div class="history-transition">
                          <span class="history-status">{{ statusLabel(entry.from_status) }}</span>
                          <mat-icon>arrow_forward</mat-icon>
                          <span class="history-status">{{ statusLabel(entry.to_status) }}</span>
                        </div>
                        <div class="history-meta">
                          <span>{{ entry.changed_by }}</span>
                          <span>{{ formatDate(entry.created_at) }}</span>
                        </div>
                        @if (entry.reason) {
                          <div class="history-reason">{{ entry.reason }}</div>
                        }
                      </div>
                    }
                  </div>
                } @else {
                  <p class="no-history">Нет записей</p>
                }
              </mat-expansion-panel>
            </mat-accordion>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .task-card-page { padding: 16px; max-width: 1200px; margin: 0 auto; }
    .loading {
      display: flex; align-items: center; gap: 12px;
      padding: 48px; justify-content: center;
      color: var(--mat-sys-on-surface-variant);
    }

    /* Header */
    .card-header { margin-bottom: 20px; }
    .back-link {
      display: inline-flex; align-items: center; gap: 4px;
      color: var(--mat-sys-primary); text-decoration: none;
      font-size: 13px; margin-bottom: 8px;
      &:hover { text-decoration: underline; }
    }
    .header-right {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .header-right h2 {
      margin: 0; font-size: 20px; color: var(--mat-sys-on-surface);
    }
    .priority-badge {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      padding: 2px 10px; border-radius: 4px;
      font-size: 12px; font-weight: 500;
    }
    .timer {
      display: flex; align-items: center; gap: 4px;
      font-size: 13px; color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    /* Body — 2 columns */
    .card-body {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 16px;
      align-items: start;
    }
    .col-left, .col-right { display: flex; flex-direction: column; gap: 16px; }

    /* Section cards */
    .section-card { padding: 16px; }
    .section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 500;
      color: var(--mat-sys-on-surface); margin-bottom: 12px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-primary); }
    }

    /* Source photo */
    .source-photo {
      border-radius: 8px; overflow: hidden; margin-bottom: 12px;
      background: var(--mat-sys-surface-variant);
      img { width: 100%; max-height: 400px; object-fit: contain; display: block; }
    }
    .download-btn { width: 100%; }
    .no-photo {
      padding: 24px; text-align: center;
      color: var(--mat-sys-outline); font-size: 13px;
    }

    /* Upload dropzone */
    .dropzone {
      border: 2px dashed var(--mat-sys-outline-variant);
      border-radius: 12px; padding: 24px;
      display: flex; flex-direction: column; align-items: center;
      gap: 8px; cursor: pointer; transition: all .2s;
      font-size: 13px; color: var(--mat-sys-on-surface-variant);
      background: var(--mat-sys-surface-variant);
      mat-icon { font-size: 32px; width: 32px; height: 32px; }
      &.dragover {
        border-color: var(--mat-sys-primary);
        background: rgba(var(--mat-sys-primary-rgb, 103,80,164), .08);
      }
    }
    .preview-photo {
      position: relative; border-radius: 8px; overflow: hidden;
      margin-bottom: 12px; background: var(--mat-sys-surface-variant);
      img { width: 100%; max-height: 300px; object-fit: contain; display: block; }
    }
    .remove-preview {
      position: absolute; top: 8px; right: 8px;
      background: rgba(0,0,0,.6); color: #fff;
    }
    .submit-btn { width: 100%; margin-top: 12px; }

    /* Params */
    .params-list { display: flex; flex-direction: column; gap: 10px; }
    .param-row {
      display: flex; align-items: flex-start; gap: 8px;
    }
    .param-label {
      font-size: 12px; color: var(--mat-sys-on-surface-variant);
      min-width: 80px; flex-shrink: 0;
    }
    .param-value { font-size: 13px; color: var(--mat-sys-on-surface); }
    .level-chip {
      padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;
    }
    .level-basic {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .level-extended {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    .level-maximum {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .level-super {
      background: linear-gradient(135deg, #b8860b 0%, #ffd700 50%, #b8860b 100%);
      color: #2b1d00; font-weight: 700;
      box-shadow: 0 0 0 1px rgba(255, 215, 0, .4);
    }
    .options-groups { display: flex; flex-direction: column; gap: 8px; }
    .option-group { display: flex; flex-direction: column; gap: 3px; }
    .option-group-name {
      font-size: 11px; font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
    }
    .chips-wrap { display: flex; flex-wrap: wrap; gap: 4px; }
    .option-chip {
      font-size: 11px; padding: 2px 6px; border-radius: 4px;
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }

    /* Feedback */
    .feedback-card { border-left: 3px solid var(--mat-sys-error); }
    .feedback-item {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 8px; border-radius: 6px; margin-bottom: 6px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font-size: 13px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; }
    }

    /* History */
    mat-expansion-panel { margin: 0; }
    mat-panel-title {
      display: flex; align-items: center; gap: 8px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }
    .history-list { display: flex; flex-direction: column; gap: 10px; }
    .history-item {
      padding: 8px; border-radius: 6px;
      background: var(--mat-sys-surface-variant);
    }
    .history-transition {
      display: flex; align-items: center; gap: 6px; font-size: 13px;
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--mat-sys-outline); }
    }
    .history-status {
      padding: 1px 6px; border-radius: 4px; font-size: 11px;
      background: var(--mat-sys-surface); color: var(--mat-sys-on-surface-variant);
    }
    .history-meta {
      display: flex; gap: 12px; margin-top: 4px;
      font-size: 11px; color: var(--mat-sys-outline);
    }
    .history-reason {
      margin-top: 4px; font-size: 12px; font-style: italic;
      color: var(--mat-sys-on-surface-variant);
    }
    .no-history { color: var(--mat-sys-outline); font-size: 13px; }
  `],
})
export class RetouchTaskCardComponent implements OnDestroy {
  private readonly api = inject(RetouchApiService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly detail = signal<RetouchDetail | null>(null);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly submitting = signal(false);
  readonly uploadedFile = signal<{ url: string; key: string } | null>(null);
  readonly isDragging = signal(false);

  readonly canSubmit = computed(() => !!this.uploadedFile() && !this.submitting());

  private timerInterval?: ReturnType<typeof setInterval>;

  readonly workDuration = computed(() => {
    const d = this.detail();
    if (!d?.task.started_at) return null;
    const start = new Date(d.task.started_at).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - start);
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}ч ${m}м` : `${m}м`;
  });

  constructor() {
    afterNextRender(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id) this.loadDetail(id);
      this.timerInterval = setInterval(() => {
        // trigger recomputation of workDuration
        this.detail.update(d => d ? { ...d } : null);
      }, 60000);
    });
  }

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  private loadDetail(id: string): void {
    this.loading.set(true);
    this.api.getDetail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.detail.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.toast.error('Не удалось загрузить задачу');
          this.loading.set(false);
        },
      });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.uploadFile(file);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      this.uploadFile(input.files[0]);
      input.value = '';
    }
  }

  private async uploadFile(file: File): Promise<void> {
    const d = this.detail();
    if (!d) return;
    this.uploading.set(true);
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
        this.api.uploadResult(d.task.id, s3Key),
      );

      const objectUrl = URL.createObjectURL(file);
      this.uploadedFile.set({ url: objectUrl, key: s3Key });
      this.detail.update(prev => prev ? { ...prev, task: res.data } : null);
      this.toast.success('Файл загружен');
    } catch {
      this.toast.error('Не удалось загрузить файл');
    } finally {
      this.uploading.set(false);
      this.uploadProgress.set(0);
    }
  }

  sendForApproval(): void {
    const d = this.detail();
    if (!d) return;
    this.submitting.set(true);
    this.api.sendForApproval(d.task.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.detail.update(prev => prev ? { ...prev, task: res.data } : null);
          this.toast.success('Отправлено на согласование');
          this.submitting.set(false);
        },
        error: () => {
          this.toast.error('Не удалось отправить');
          this.submitting.set(false);
        },
      });
  }

  levelLabel(level: string): string {
    const labels: Record<string, string> = {
      basic: 'Базовая', extended: 'Расширенная', maximum: 'Максимальная', super: 'Супер',
    };
    return labels[level] ?? level;
  }

  /**
   * Группирует опции ретуши по group_name (объектный формат
   * {group, group_name, slug, label}). Исторический строковый формат —
   * единая группа без заголовка (fallback opt.label ?? opt).
   */
  groupedOptions(options: readonly RetouchOption[]): RetouchOptionGroupView[] {
    const groups: RetouchOptionGroupView[] = [];
    const byKey = new Map<string, RetouchOptionGroupView>();
    options.forEach((opt, index) => {
      const isObj = typeof opt === 'object' && opt !== null;
      const groupName = isObj ? (opt.group_name ?? '') : '';
      const groupKey = isObj ? (opt.group ?? opt.group_name ?? '') : '';
      const label = isObj ? (opt.label ?? opt.slug ?? '') : opt;
      const itemKey = isObj ? (opt.slug ?? `i${index}`) : `s${index}`;
      const mapKey = groupName ? `${groupKey}|${groupName}` : '';
      let group = byKey.get(mapKey);
      if (!group) {
        group = { key: mapKey || 'flat', name: groupName, items: [] };
        byKey.set(mapKey, group);
        groups.push(group);
      }
      group.items.push({ key: itemKey, label });
    });
    return groups;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      open: 'Открыта', assigned: 'Назначена', in_progress: 'В работе',
      waiting: 'Согласование', completed: 'Завершена', cancelled: 'Отменена',
    };
    return labels[status] ?? status;
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
}
