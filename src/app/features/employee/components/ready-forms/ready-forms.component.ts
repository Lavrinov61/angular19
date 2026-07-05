import { DatePipe, UpperCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize, firstValueFrom } from 'rxjs';
import { ReadyForm, ReadyFormsApiService } from '../../services/ready-forms-api.service';

interface ApiErrorBody {
  error?: unknown;
  message?: unknown;
}

@Component({
  selector: 'app-ready-forms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    UpperCasePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="ready-forms-page">
      <header class="page-header">
        <div>
          <h1>Готовые формы</h1>
          <p>Админское хранилище PSD, JPG и PNG файлов для повторного использования.</p>
        </div>
        <div class="summary">
          <span class="summary-value">{{ total() }}</span>
          <span class="summary-label">файлов</span>
        </div>
      </header>

      <section class="upload-panel">
        <div
          class="upload-zone"
          [class.has-files]="queuedFiles().length > 0"
          (dragover)="onDragOver($event)"
          (drop)="onDrop($event)"
        >
          <mat-icon>cloud_upload</mat-icon>
          <div class="upload-copy">
            <strong>Перетащите файлы сюда</strong>
            <span>или выберите PSD, JPG, PNG до 100 МБ</span>
          </div>
          <label class="file-picker" for="readyFormsFileInput">
            <mat-icon>attach_file</mat-icon>
            <span>Выбрать</span>
          </label>
          <input
            id="readyFormsFileInput"
            class="file-input"
            type="file"
            multiple
            accept=".psd,.jpg,.jpeg,.png,image/jpeg,image/png,image/vnd.adobe.photoshop"
            (change)="onFilesSelected($event)"
          />
        </div>

        @if (queuedFiles().length > 0) {
          <div class="queue">
            <div class="queue-list">
              @for (file of queuedFiles(); track file.name + file.size) {
                <span class="queued-file">
                  <mat-icon>{{ iconForExtension(file.name) }}</mat-icon>
                  {{ file.name }}
                  <small>{{ formatFileSize(file.size) }}</small>
                </span>
              }
            </div>
            <div class="queue-actions">
              <button mat-button type="button" (click)="clearQueue()" [disabled]="uploading()">Очистить</button>
              <button mat-flat-button color="primary" type="button" (click)="uploadQueued()" [disabled]="uploading()">
                <mat-icon>upload</mat-icon>
                Загрузить
              </button>
            </div>
          </div>
        }

        @if (uploading()) {
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        }
      </section>

      <section class="list-panel">
        <div class="list-toolbar">
          <mat-form-field appearance="outline" class="search-field">
            <mat-label>Поиск</mat-label>
            <input
              matInput
              [value]="query()"
              (input)="updateQuery($event)"
              (keydown.enter)="load()"
              placeholder="Название или имя файла"
            />
            @if (query()) {
              <button mat-icon-button matSuffix type="button" matTooltip="Очистить" (click)="clearSearch()">
                <mat-icon>close</mat-icon>
              </button>
            }
          </mat-form-field>
          <button mat-icon-button type="button" matTooltip="Обновить" (click)="load()" [disabled]="loading()">
            <mat-icon>refresh</mat-icon>
          </button>
        </div>

        @if (loading()) {
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        }

        @if (error()) {
          <div class="state state-error">
            <mat-icon>error</mat-icon>
            <span>{{ error() }}</span>
          </div>
        } @else if (!loading() && forms().length === 0) {
          <div class="state">
            <mat-icon>folder_open</mat-icon>
            <span>Готовых форм пока нет</span>
          </div>
        } @else {
          <div class="forms-list">
            @for (form of forms(); track form.id) {
              <article class="form-row">
                <div class="file-mark" [class.psd]="normalizedExtension(form) === 'psd'">
                  <mat-icon>{{ iconForForm(form) }}</mat-icon>
                </div>
                <div class="form-main">
                  <div class="form-title">{{ form.title }}</div>
                  <div class="form-meta">
                    <span>{{ form.originalName }}</span>
                    <span>{{ formatFileSize(form.fileSize) }}</span>
                    <span>{{ normalizedExtension(form) | uppercase }}</span>
                    <span>{{ form.createdAt | date:'dd.MM.yyyy HH:mm' }}</span>
                    @if (form.uploaderName) {
                      <span>{{ form.uploaderName }}</span>
                    }
                  </div>
                </div>
                <div class="form-actions">
                  <a
                    mat-icon-button
                    [href]="downloadUrl(form)"
                    [attr.download]="form.originalName"
                    matTooltip="Скачать"
                  >
                    <mat-icon>download</mat-icon>
                  </a>
                  <button mat-icon-button type="button" color="warn" matTooltip="Удалить" (click)="deleteForm(form)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </article>
            }
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100%;
      color: var(--crm-text-primary);
    }

    .ready-forms-page {
      display: grid;
      gap: 16px;
      padding: 16px;
      min-height: 100%;
      grid-template-rows: auto auto 1fr;
    }

    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0;
    }

    p {
      margin: 6px 0 0;
      color: var(--crm-text-secondary);
      font-size: 14px;
    }

    .summary {
      min-width: 112px;
      padding: 10px 14px;
      border: 1px solid var(--crm-glass-border);
      border-radius: 8px;
      background: var(--crm-surface);
      text-align: right;
    }

    .summary-value {
      display: block;
      font-size: 24px;
      line-height: 1;
      font-weight: 700;
    }

    .summary-label {
      color: var(--crm-text-secondary);
      font-size: 12px;
    }

    .upload-panel,
    .list-panel {
      border: 1px solid var(--crm-glass-border);
      border-radius: 8px;
      background: var(--crm-surface);
      overflow: hidden;
    }

    .upload-zone {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 14px;
      padding: 18px;
      border: 1px dashed color-mix(in srgb, var(--crm-primary) 45%, var(--crm-glass-border));
      border-radius: 8px;
      margin: 14px;
      min-height: 92px;
      background: color-mix(in srgb, var(--crm-primary) 7%, transparent);
    }

    .upload-zone.has-files {
      border-style: solid;
      background: color-mix(in srgb, var(--crm-success) 8%, transparent);
    }

    .upload-zone > mat-icon {
      width: 42px;
      height: 42px;
      font-size: 42px;
      color: var(--crm-primary);
    }

    .upload-copy {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .upload-copy strong {
      font-size: 16px;
      font-weight: 700;
    }

    .upload-copy span {
      color: var(--crm-text-secondary);
      font-size: 13px;
    }

    .file-picker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 40px;
      padding: 0 14px;
      border-radius: 6px;
      border: 1px solid var(--crm-glass-border);
      cursor: pointer;
      background: var(--crm-surface-raised);
      color: var(--crm-text-primary);
      font-weight: 600;
      white-space: nowrap;
    }

    .file-input {
      display: none;
    }

    .queue {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 0 14px 14px;
      align-items: flex-start;
    }

    .queue-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }

    .queued-file {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 320px;
      padding: 6px 10px;
      border-radius: 6px;
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-glass-border);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .queued-file mat-icon {
      flex: 0 0 auto;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .queued-file small {
      color: var(--crm-text-secondary);
      font-size: 12px;
    }

    .queue-actions {
      display: flex;
      gap: 8px;
      flex: 0 0 auto;
    }

    .list-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 14px 0;
    }

    .search-field {
      flex: 1;
    }

    .forms-list {
      display: grid;
      gap: 8px;
      padding: 0 14px 14px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 46px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      min-height: 70px;
      padding: 10px 12px;
      border: 1px solid var(--crm-glass-border);
      border-radius: 8px;
      background: var(--crm-surface-raised);
    }

    .file-mark {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-primary) 12%, transparent);
      color: var(--crm-primary);
    }

    .file-mark.psd {
      background: color-mix(in srgb, #31a8ff 14%, transparent);
      color: #1479b8;
    }

    .form-main {
      min-width: 0;
    }

    .form-title {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .form-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      margin-top: 5px;
      color: var(--crm-text-secondary);
      font-size: 12px;
    }

    .form-meta span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .form-actions {
      display: flex;
      gap: 4px;
    }

    .state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 180px;
      color: var(--crm-text-secondary);
      padding: 20px;
    }

    .state-error {
      color: var(--crm-danger);
    }

    @media (max-width: 720px) {
      .ready-forms-page {
        padding: 12px;
      }

      .page-header,
      .queue {
        flex-direction: column;
      }

      .summary {
        width: 100%;
        text-align: left;
      }

      .upload-zone {
        grid-template-columns: auto 1fr;
      }

      .file-picker {
        grid-column: 1 / -1;
        width: 100%;
      }

      .form-row {
        grid-template-columns: 42px minmax(0, 1fr);
      }

      .form-actions {
        grid-column: 1 / -1;
        justify-content: flex-end;
      }
    }
  `],
})
export class ReadyFormsComponent {
  private readonly api = inject(ReadyFormsApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly forms = signal<ReadyForm[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly queuedFiles = signal<File[]>([]);
  private readonly allowedExtensions = new Set(['psd', 'jpg', 'jpeg', 'png']);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list({ q: this.query().trim() || undefined }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: result => {
        this.forms.set(result.forms);
        this.total.set(result.total);
      },
      error: error => {
        this.error.set(this.errorMessage(error, 'Не удалось загрузить формы'));
      },
    });
  }

  updateQuery(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.query.set(target.value);
    }
  }

  clearSearch(): void {
    this.query.set('');
    this.load();
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    this.queueFiles(files);
  }

  onFilesSelected(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    this.queueFiles(target.files ? Array.from(target.files) : []);
    target.value = '';
  }

  clearQueue(): void {
    this.queuedFiles.set([]);
  }

  async uploadQueued(): Promise<void> {
    const files = this.queuedFiles();
    if (!files.length || this.uploading()) return;

    this.uploading.set(true);
    let uploaded = 0;

    try {
      for (const file of files) {
        try {
          await firstValueFrom(this.api.upload(file));
          uploaded += 1;
        } catch (error) {
          this.snack.open(this.errorMessage(error, `Не удалось загрузить ${file.name}`), 'OK', { duration: 5000 });
        }
      }
    } finally {
      this.uploading.set(false);
      this.queuedFiles.set([]);
    }

    if (uploaded > 0) {
      this.snack.open(`Загружено файлов: ${uploaded}`, 'OK', { duration: 3000 });
      this.load();
    }
  }

  deleteForm(form: ReadyForm): void {
    const confirmed = typeof window !== 'undefined' && window.confirm(`Удалить форму «${form.title}»?`);
    if (!confirmed) return;

    this.api.delete(form.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.forms.update(forms => forms.filter(item => item.id !== form.id));
        this.total.update(total => Math.max(0, total - 1));
        this.snack.open('Форма удалена', 'OK', { duration: 2500 });
      },
      error: error => {
        this.snack.open(this.errorMessage(error, 'Не удалось удалить форму'), 'OK', { duration: 5000 });
      },
    });
  }

  downloadUrl(form: ReadyForm): string {
    return this.api.downloadUrl(form.id);
  }

  iconForForm(form: ReadyForm): string {
    return this.iconForExtension(form.extension);
  }

  iconForExtension(fileNameOrExtension: string): string {
    const ext = this.normalizeExtension(fileNameOrExtension);
    if (ext === 'psd') return 'photo_size_select_large';
    if (ext === 'png') return 'image';
    return 'photo';
  }

  normalizedExtension(form: ReadyForm): string {
    return this.normalizeExtension(form.extension);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  private queueFiles(files: File[]): void {
    const validFiles = files.filter(file => this.isAllowedFile(file));
    const skipped = files.length - validFiles.length;

    if (skipped > 0) {
      this.snack.open('Можно загружать только PSD, JPG или PNG', 'OK', { duration: 4000 });
    }

    if (!validFiles.length) return;

    this.queuedFiles.update(current => [...current, ...validFiles]);
  }

  private isAllowedFile(file: File): boolean {
    return this.allowedExtensions.has(this.normalizeExtension(file.name));
  }

  private normalizeExtension(fileNameOrExtension: string): string {
    const lastSegment = fileNameOrExtension.toLowerCase().split('.').pop() || fileNameOrExtension.toLowerCase();
    return lastSegment.replace(/^\./, '');
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as ApiErrorBody | null;
      if (body && typeof body.error === 'string') return body.error;
      if (body && typeof body.message === 'string') return body.message;
    }
    return fallback;
  }
}
