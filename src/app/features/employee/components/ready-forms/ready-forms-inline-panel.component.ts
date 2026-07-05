import { DatePipe, UpperCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize, firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { ReadyForm, ReadyFormsApiService } from '../../services/ready-forms-api.service';

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

@Component({
  selector: 'app-ready-forms-inline-panel',
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
    @if (isAdmin()) {
      <div class="forms-inline">
        <div class="forms-toolbar">
          <mat-form-field appearance="outline" class="search-field" subscriptSizing="dynamic">
            <mat-label>Найти форму</mat-label>
            <input
              matInput
              [value]="query()"
              (input)="updateQuery($event)"
              (keydown.enter)="load()"
              placeholder="Название или файл"
            />
            @if (query()) {
              <button mat-icon-button matSuffix type="button" matTooltip="Очистить" (click)="clearSearch()">
                <mat-icon>close</mat-icon>
              </button>
            }
          </mat-form-field>

          <button mat-icon-button type="button" matTooltip="Обновить" [disabled]="loading()" (click)="load()">
            <mat-icon>refresh</mat-icon>
          </button>

          <button mat-stroked-button type="button" class="upload-btn" [disabled]="uploading()" (click)="fileInput.click()">
            <mat-icon>upload</mat-icon>
            Загрузить
          </button>
          <input
            #fileInput
            class="file-input"
            type="file"
            multiple
            accept=".psd,.jpg,.jpeg,.png,image/jpeg,image/png,image/vnd.adobe.photoshop"
            (change)="onFilesSelected($event)"
          />
        </div>

        @if (loading() || uploading()) {
          <mat-progress-bar mode="indeterminate" />
        }

        @if (selectedForm(); as form) {
          <div class="selected-form">
            <div class="selected-main">
              <mat-icon>{{ iconForForm(form) }}</mat-icon>
              <div>
                <span class="selected-label">Выбрана форма</span>
                <strong>{{ form.title }}</strong>
              </div>
            </div>
            <a
              mat-stroked-button
              [href]="downloadUrl(form)"
              [attr.download]="form.originalName"
              (click)="$event.stopPropagation()"
            >
              <mat-icon>download</mat-icon>
              Скачать
            </a>
          </div>
        }

        @if (error()) {
          <div class="forms-state state-error">
            <mat-icon>error</mat-icon>
            <span>{{ error() }}</span>
          </div>
        } @else if (!loading() && forms().length === 0) {
          <div class="forms-state">
            <mat-icon>folder_open</mat-icon>
            <span>Готовых форм пока нет</span>
          </div>
        } @else {
          <div class="forms-list">
            @for (form of forms(); track form.id) {
              <article
                class="form-row"
                role="button"
                tabindex="0"
                [class.selected]="isSelected(form)"
                (click)="selectForm(form)"
                (keydown.enter)="selectForm(form)"
                (keydown.space)="selectFormFromKeyboard($event, form)"
              >
                <div class="file-mark" [class.psd]="normalizedExtension(form) === 'psd'">
                  <mat-icon>{{ iconForForm(form) }}</mat-icon>
                </div>
                <div class="form-main">
                  <div class="form-title">{{ form.title }}</div>
                  <div class="form-meta">
                    <span>{{ form.originalName }}</span>
                    <span>{{ formatFileSize(form.fileSize) }}</span>
                    <span>{{ normalizedExtension(form) | uppercase }}</span>
                    <span>{{ form.createdAt | date:'dd.MM HH:mm' }}</span>
                  </div>
                </div>
                <a
                  mat-icon-button
                  class="download-action"
                  [href]="downloadUrl(form)"
                  [attr.download]="form.originalName"
                  matTooltip="Скачать"
                  (click)="$event.stopPropagation()"
                >
                  <mat-icon>download</mat-icon>
                </a>
              </article>
            }
          </div>
        }
      </div>
    } @else {
      <div class="forms-state">
        <mat-icon>lock</mat-icon>
        <span>Доступно только администратору</span>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      color: var(--crm-text-primary);
    }

    .forms-inline {
      display: grid;
      gap: 10px;
      padding: 2px 0 4px;
    }

    .forms-toolbar {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) auto auto;
      align-items: center;
      gap: 8px;
    }

    .search-field {
      min-width: 0;
    }

    .upload-btn {
      white-space: nowrap;
      mat-icon { margin-right: 4px; }
    }

    .file-input {
      display: none;
    }

    .selected-form {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid color-mix(in srgb, var(--crm-primary) 35%, var(--crm-border));
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-primary) 8%, transparent);
    }

    .selected-main {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;

      mat-icon {
        color: var(--crm-primary);
        flex: 0 0 auto;
      }

      div {
        min-width: 0;
        display: grid;
        gap: 1px;
      }

      strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
      }
    }

    .selected-label {
      color: var(--crm-text-secondary);
      font-size: 11px;
    }

    .forms-list {
      display: grid;
      gap: 6px;
      max-height: 280px;
      overflow: auto;
      padding-right: 2px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) 34px;
      align-items: center;
      gap: 10px;
      min-height: 56px;
      padding: 8px 10px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: var(--crm-surface);
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease;

      &:hover,
      &:focus-visible,
      &.selected {
        border-color: color-mix(in srgb, var(--crm-primary) 50%, var(--crm-border));
        background: color-mix(in srgb, var(--crm-primary) 7%, var(--crm-surface));
        outline: none;
      }
    }

    .file-mark {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      background: color-mix(in srgb, var(--crm-primary) 12%, transparent);
      color: var(--crm-primary);

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .file-mark.psd {
      background: color-mix(in srgb, #31a8ff 14%, transparent);
      color: #31a8ff;
    }

    .form-main {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .form-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 700;
    }

    .form-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      color: var(--crm-text-secondary);
      font-size: 11px;

      span {
        min-width: 0;
        overflow-wrap: anywhere;
      }
    }

    .download-action {
      justify-self: end;
    }

    .forms-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 72px;
      padding: 12px;
      color: var(--crm-text-secondary);
      font-size: 13px;
    }

    .state-error {
      color: var(--crm-danger, var(--crm-status-error));
    }

    @media (max-width: 720px) {
      .forms-toolbar {
        grid-template-columns: 1fr auto;
      }

      .upload-btn {
        grid-column: 1 / -1;
      }

      .selected-form {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `],
})
export class ReadyFormsInlinePanelComponent {
  private readonly api = inject(ReadyFormsApiService);
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly allowedExtensions = new Set(['psd', 'jpg', 'jpeg', 'png']);
  private readonly maxFileSizeBytes = 100 * 1024 * 1024;

  protected readonly isAdmin = this.auth.isAdmin;
  protected readonly forms = signal<ReadyForm[]>([]);
  protected readonly loading = signal(false);
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly selectedFormId = signal<string | null>(null);
  protected readonly selectedForm = computed(() => {
    const id = this.selectedFormId();
    return id ? this.forms().find(form => form.id === id) ?? null : null;
  });

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.load();
    }
  }

  protected load(preferredSelectedId?: string): void {
    if (!this.isAdmin()) return;

    this.loading.set(true);
    this.error.set(null);
    this.api.list({ q: this.query().trim() || undefined, limit: 50 }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: result => {
        this.forms.set(result.forms);
        this.syncSelection(preferredSelectedId);
      },
      error: error => {
        this.error.set(this.errorMessage(error, 'Не удалось загрузить формы'));
      },
    });
  }

  protected updateQuery(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.query.set(target.value);
    }
  }

  protected clearSearch(): void {
    this.query.set('');
    this.load();
  }

  protected selectForm(form: ReadyForm): void {
    this.selectedFormId.set(form.id);
  }

  protected selectFormFromKeyboard(event: Event, form: ReadyForm): void {
    event.preventDefault();
    this.selectForm(form);
  }

  protected async onFilesSelected(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const files = target.files ? Array.from(target.files) : [];
    target.value = '';
    await this.uploadFiles(files);
  }

  protected isSelected(form: ReadyForm): boolean {
    return this.selectedFormId() === form.id;
  }

  protected downloadUrl(form: ReadyForm): string {
    return this.api.downloadUrl(form.id);
  }

  protected iconForForm(form: ReadyForm): string {
    return this.iconForExtension(form.extension);
  }

  protected normalizedExtension(form: ReadyForm): string {
    return this.normalizeExtension(form.extension);
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  private async uploadFiles(files: File[]): Promise<void> {
    const validFiles = files.filter(file => this.isAllowedFile(file));
    const skipped = files.length - validFiles.length;

    if (skipped > 0) {
      this.snack.open('Можно загружать только PSD, JPG или PNG до 100 МБ', 'OK', { duration: 4000 });
    }

    if (!validFiles.length || this.uploading()) return;

    this.uploading.set(true);
    let uploaded = 0;
    let lastUploadedId: string | undefined;

    try {
      for (const file of validFiles) {
        try {
          const form = await firstValueFrom(this.api.upload(file).pipe(takeUntilDestroyed(this.destroyRef)));
          uploaded += 1;
          lastUploadedId = form.id;
        } catch (error) {
          this.snack.open(this.errorMessage(error, `Не удалось загрузить ${file.name}`), 'OK', { duration: 5000 });
        }
      }
    } finally {
      this.uploading.set(false);
    }

    if (uploaded > 0) {
      this.snack.open(`Загружено файлов: ${uploaded}`, 'OK', { duration: 3000 });
      this.load(lastUploadedId);
    }
  }

  private syncSelection(preferredSelectedId?: string): void {
    const availableIds = new Set(this.forms().map(form => form.id));
    const nextId = preferredSelectedId ?? this.selectedFormId();

    if (nextId && availableIds.has(nextId)) {
      this.selectedFormId.set(nextId);
      return;
    }

    if (this.selectedFormId() && !availableIds.has(this.selectedFormId()!)) {
      this.selectedFormId.set(null);
    }
  }

  private isAllowedFile(file: File): boolean {
    return file.size <= this.maxFileSizeBytes && this.allowedExtensions.has(this.normalizeExtension(file.name));
  }

  private iconForExtension(fileNameOrExtension: string): string {
    const ext = this.normalizeExtension(fileNameOrExtension);
    if (ext === 'psd') return 'photo_size_select_large';
    if (ext === 'png') return 'image';
    return 'photo';
  }

  private normalizeExtension(fileNameOrExtension: string): string {
    const lastSegment = fileNameOrExtension.toLowerCase().split('.').pop() || fileNameOrExtension.toLowerCase();
    return lastSegment.replace(/^\./, '');
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = readRecord(error.error);
      const errorText = body?.['error'];
      const messageText = body?.['message'];
      if (typeof errorText === 'string') return errorText;
      if (typeof messageText === 'string') return messageText;
    }
    return fallback;
  }
}
