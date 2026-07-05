import {
  Component, ChangeDetectionStrategy, inject, signal, computed, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  RetouchApiService, RetouchDetail, RetouchOption,
} from '../../services/retouch-api.service';
import { ToastService } from '../../../../core/services/toast.service';

/** Данные, передаваемые в диалог при открытии с карточки заказа. */
export interface OrderApprovalDialogData {
  retouchTaskId: string;
  orderLabel?: string;
  clientName?: string | null;
}

/** Результат закрытия диалога (для обновления очереди). */
export interface OrderApprovalDialogResult {
  sent: boolean;
}

interface RetouchOptionItemView { key: string; label: string; }
interface RetouchOptionGroupView { key: string; name: string; items: RetouchOptionItemView[]; }

interface PresignUpload { s3Key: string; uploadUrl: string; contentType: string; }
interface PresignResponse { success: boolean; data: { uploads: PresignUpload[] }; }

/**
 * Компактный диалог «Отправить на согласование» прямо с карточки очереди заказов.
 * Показывает исходник + параметры обработки (как полноценная карточка ретуши),
 * принимает результат и одной кнопкой отправляет клиенту на согласование.
 *
 * Серверные предусловия: upload-result и send-for-approval требуют, чтобы задача
 * была назначена текущему сотруднику. Поэтому перед загрузкой/отправкой диалог
 * сам «берёт задачу в работу» (start), если она ещё open/assigned.
 */
@Component({
  selector: 'app-order-approval-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title class="oa-title">
      <mat-icon>send</mat-icon>
      На согласование
      @if (data.orderLabel) { <span class="oa-order">{{ data.orderLabel }}</span> }
    </h2>

    <mat-dialog-content class="oa-content">
      @if (loading()) {
        <div class="oa-loading">
          <mat-spinner diameter="28"></mat-spinner>
          <span>Загрузка задачи…</span>
        </div>
      } @else if (detail()) {
        @let d = detail()!;
        <div class="oa-grid">
          <!-- Левая колонка: исходник + результат -->
          <div class="oa-col">
            <div class="oa-block">
              <div class="oa-block-title"><mat-icon>image</mat-icon> Исходник</div>
              @if (d.task.source_photo_url) {
                <div class="oa-photo">
                  <img [src]="d.task.source_photo_url" alt="Исходник" />
                </div>
              } @else {
                <div class="oa-nophoto">Исходник не загружен</div>
              }
            </div>

            <div class="oa-block">
              <div class="oa-block-title"><mat-icon>cloud_upload</mat-icon> Результат обработки</div>
              @if (resultPreview(); as preview) {
                <div class="oa-photo oa-result">
                  <img [src]="preview" alt="Результат" />
                  <button mat-icon-button class="oa-remove" type="button"
                          [disabled]="uploading() || submitting()"
                          (click)="clearUploaded()">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              } @else {
                <label class="oa-drop" [class.busy]="uploading()">
                  <input type="file" hidden accept="image/*" [disabled]="uploading()" (change)="onFileSelected($event)" />
                  @if (uploading()) {
                    <mat-spinner diameter="26"></mat-spinner>
                    <span>Загрузка… {{ uploadProgress() }}%</span>
                  } @else {
                    <mat-icon>add_photo_alternate</mat-icon>
                    <span>Загрузить готовое фото</span>
                  }
                </label>
              }
            </div>
          </div>

          <!-- Правая колонка: параметры -->
          <div class="oa-col">
            <div class="oa-block">
              <div class="oa-block-title"><mat-icon>tune</mat-icon> Параметры</div>
              <div class="oa-params">
                @if (d.task.title) {
                  <div class="oa-param"><span>Документ</span><b>{{ d.task.title }}</b></div>
                }
                <div class="oa-param">
                  <span>Обработка</span>
                  <b class="oa-level" [class]="'lvl-' + d.task.retouch_level">{{ levelLabel(d.task.retouch_level) }}</b>
                </div>
                @if (data.clientName) {
                  <div class="oa-param"><span>Клиент</span><b>{{ data.clientName }}</b></div>
                }
                @if (d.task.revision_count > 0) {
                  <div class="oa-param"><span>Ревизия</span><b class="oa-rev">#{{ d.task.revision_count }}</b></div>
                }
              </div>

              @if (d.task.retouch_options.length) {
                <div class="oa-options">
                  @for (grp of groupedOptions(d.task.retouch_options); track grp.key) {
                    <div class="oa-optgroup">
                      @if (grp.name) { <div class="oa-optgroup-name">{{ grp.name }}</div> }
                      <div class="oa-chips">
                        @for (opt of grp.items; track opt.key) {
                          <span class="oa-chip">{{ opt.label }}</span>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>

            @if (d.task.revision_count > 0 && d.feedback?.length) {
              <div class="oa-block oa-feedback">
                <div class="oa-block-title"><mat-icon>rate_review</mat-icon> Что просили доработать</div>
                @for (fb of d.feedback!; track $index) {
                  <div class="oa-fb">{{ fb.comment }}</div>
                }
              </div>
            }
          </div>
        </div>

        @if (claimError()) {
          <div class="oa-error">
            <mat-icon>lock</mat-icon>
            <span>{{ claimError() }}</span>
          </div>
        }
      } @else {
        <div class="oa-error">
          <mat-icon>error_outline</mat-icon>
          <span>Не удалось загрузить задачу</span>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="submitting()" (click)="close()">Отмена</button>
      <button mat-flat-button color="primary" type="button"
              [disabled]="!canSend()"
              (click)="send()">
        <mat-icon>send</mat-icon>
        {{ submitting() ? 'Отправка…' : 'Отправить клиенту' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    .oa-title { display: flex; align-items: center; gap: 8px; font-size: 18px;
      mat-icon { color: var(--mat-sys-primary); font-size: 22px; width: 22px; height: 22px; } }
    .oa-order { color: var(--mat-sys-primary); font-weight: 600; }
    .oa-content { min-width: 520px; max-width: 720px; }
    .oa-loading { display: flex; align-items: center; gap: 10px; padding: 28px; justify-content: center;
      color: var(--mat-sys-on-surface-variant); }
    .oa-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
    .oa-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .oa-block { border: 1px solid var(--mat-sys-outline-variant); border-radius: 10px; padding: 12px; }
    .oa-block-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600;
      margin-bottom: 8px; color: var(--mat-sys-on-surface);
      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); } }
    .oa-photo { position: relative; border-radius: 8px; overflow: hidden; background: var(--mat-sys-surface-variant);
      img { width: 100%; max-height: 240px; object-fit: contain; display: block; } }
    .oa-result img { max-height: 200px; }
    .oa-remove { position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,.55); color: #fff; }
    .oa-nophoto { padding: 20px; text-align: center; font-size: 12px; color: var(--mat-sys-outline); }
    .oa-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
      min-height: 120px; border: 2px dashed var(--mat-sys-outline-variant); border-radius: 10px;
      cursor: pointer; font-size: 12px; color: var(--mat-sys-on-surface-variant);
      background: var(--mat-sys-surface-variant); transition: border-color .15s, background .15s;
      &:hover { border-color: var(--mat-sys-primary); }
      &.busy { cursor: default; }
      mat-icon { font-size: 28px; width: 28px; height: 28px; } }
    .oa-params { display: flex; flex-direction: column; gap: 6px; }
    .oa-param { display: flex; justify-content: space-between; gap: 10px; font-size: 12px;
      span { color: var(--mat-sys-on-surface-variant); }
      b { color: var(--mat-sys-on-surface); text-align: right; } }
    .oa-level { padding: 1px 8px; border-radius: 6px; font-size: 11px; }
    .lvl-basic { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .lvl-extended { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .lvl-maximum { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .lvl-super { background: linear-gradient(135deg, #b8860b, #ffd700, #b8860b); color: #2b1d00; font-weight: 700; }
    .oa-rev { color: var(--mat-sys-error); }
    .oa-options { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    .oa-optgroup-name { font-size: 11px; font-weight: 600; color: var(--mat-sys-on-surface-variant); margin-bottom: 3px; }
    .oa-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .oa-chip { font-size: 11px; padding: 2px 6px; border-radius: 5px;
      background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant); }
    .oa-feedback { border-left: 3px solid var(--mat-sys-error); }
    .oa-fb { font-size: 12px; padding: 6px 8px; border-radius: 6px; margin-bottom: 4px;
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .oa-error { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px 12px;
      border-radius: 8px; font-size: 13px;
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
      mat-icon { font-size: 18px; width: 18px; height: 18px; } }
    @media (max-width: 600px) {
      .oa-content { min-width: 0; }
      .oa-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class OrderApprovalDialogComponent {
  private readonly api = inject(RetouchApiService);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject<MatDialogRef<OrderApprovalDialogComponent, OrderApprovalDialogResult>>(MatDialogRef);
  readonly data = inject<OrderApprovalDialogData>(MAT_DIALOG_DATA);

  readonly detail = signal<RetouchDetail | null>(null);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly submitting = signal(false);
  readonly uploadedFile = signal<{ url: string; key: string } | null>(null);
  readonly claimError = signal<string | null>(null);

  /** Превью результата: только что загруженное ИЛИ уже сохранённый result. */
  readonly resultPreview = computed(() => {
    const local = this.uploadedFile();
    if (local) return local.url;
    return this.detail()?.task.result_photo_url ?? null;
  });

  readonly canSend = computed(() =>
    !this.loading() && !this.uploading() && !this.submitting()
    && !this.claimError() && !!this.resultPreview());

  constructor() {
    this.loadDetail();
    this.destroyRef.onDestroy(() => {
      const current = this.uploadedFile();
      if (current) URL.revokeObjectURL(current.url);
    });
  }

  private loadDetail(): void {
    this.loading.set(true);
    this.api.getDetail(this.data.retouchTaskId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => { this.detail.set(res.data); this.loading.set(false); },
        error: () => { this.toast.error('Не удалось загрузить задачу'); this.loading.set(false); },
      });
  }

  /** Берёт задачу в работу, если она ещё не назначена (open/assigned). Иначе no-op. */
  private async ensureClaimed(): Promise<boolean> {
    const d = this.detail();
    if (!d) return false;
    if (d.task.status !== 'open' && d.task.status !== 'assigned') return true;
    try {
      const res = await firstValueFrom(this.api.start(d.task.id));
      this.detail.update(prev => prev ? { ...prev, task: res.data } : prev);
      return true;
    } catch {
      // Кто-то уже взял задачу — перечитаем актуальное состояние
      try {
        const fresh = await firstValueFrom(this.api.getDetail(d.task.id));
        this.detail.set(fresh.data);
      } catch { /* оставляем как есть */ }
      return true;
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) { void this.uploadFile(file); input.value = ''; }
  }

  private async uploadFile(file: File): Promise<void> {
    const d = this.detail();
    if (!d) return;
    this.uploading.set(true);
    this.uploadProgress.set(8);
    try {
      await this.ensureClaimed();

      const presign = await firstValueFrom(
        this.http.post<PresignResponse>('/api/photo-approvals/direct-upload/presign', {
          files: [{ fileName: file.name, contentType: file.type, fileSize: file.size }],
        }),
      );
      const upload = presign.data.uploads[0];
      this.uploadProgress.set(30);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload.uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            this.uploadProgress.set(30 + Math.round((e.loaded / e.total) * 60));
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
          ? resolve() : reject(new Error(`S3 PUT ${xhr.status}`));
        xhr.onerror = () => reject(new Error('S3 PUT network error'));
        xhr.send(file);
      });

      this.uploadProgress.set(95);
      const res = await firstValueFrom(this.api.uploadResult(d.task.id, upload.s3Key));
      this.uploadedFile.set({ url: URL.createObjectURL(file), key: upload.s3Key });
      this.detail.update(prev => prev ? { ...prev, task: res.data } : prev);
      this.claimError.set(null);
      this.toast.success('Результат загружен');
    } catch (err) {
      if (this.isForbidden(err)) {
        this.claimError.set('Задача в работе у другого сотрудника. Откройте «Очередь ретуши».');
      } else {
        this.toast.error('Не удалось загрузить файл');
      }
    } finally {
      this.uploading.set(false);
      this.uploadProgress.set(0);
    }
  }

  clearUploaded(): void {
    const current = this.uploadedFile();
    if (current) URL.revokeObjectURL(current.url);
    this.uploadedFile.set(null);
  }

  async send(): Promise<void> {
    const d = this.detail();
    if (!d || !this.canSend()) return;
    this.submitting.set(true);
    try {
      await this.ensureClaimed();
      await firstValueFrom(this.api.sendForApproval(d.task.id));
      this.toast.success('Отправлено клиенту на согласование');
      this.dialogRef.close({ sent: true });
    } catch (err) {
      if (this.isForbidden(err)) {
        this.claimError.set('Задача в работе у другого сотрудника. Откройте «Очередь ретуши».');
      } else {
        this.toast.error('Не удалось отправить на согласование');
      }
      this.submitting.set(false);
    }
  }

  close(): void {
    this.dialogRef.close({ sent: false });
  }

  private isForbidden(err: unknown): boolean {
    return err instanceof HttpErrorResponse && err.status === 403;
  }

  levelLabel(level: string): string {
    const labels: Record<string, string> = {
      basic: 'Базовая', extended: 'Расширенная', maximum: 'Максимальная', super: 'Супер',
    };
    return labels[level] ?? level;
  }

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
}
