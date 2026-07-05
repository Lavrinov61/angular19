import { Component, inject, signal, computed, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Clipboard } from '@angular/cdk/clipboard';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

export interface FinalPhotoUploadData {
  chatSessionId: string;
  clientName: string;
}

interface SelectedFile {
  file: File;
  previewUrl: string;
  s3Key?: string;
  uploaded: boolean;
}

interface PresignResponse {
  success: boolean;
  data: { uploads: { s3Key: string; uploadUrl: string }[] };
}

interface DeliverFinalsResponse {
  success: boolean;
  data: {
    sessionId: string;
    publicToken: string;
    downloadLink?: string;
    photoCount: number;
    hasUserAccount: boolean;
  };
}

const QUICK_TITLES = [
  'Фото на паспорт',
  'Фото на загранпаспорт',
  'Фото на визу',
  'Фото на документ',
  'Студийный портрет',
];

@Component({
  selector: 'app-final-photo-upload-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatChipsModule, MatProgressBarModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>add_a_photo</mat-icon> Выдать фото клиенту
    </h2>
    <mat-dialog-content>
      @if (success()) {
        <div class="success-state">
          <mat-icon class="success-icon">check_circle</mat-icon>
          @if (deliveredCount() > 1) {
            <p class="success-title">{{ deliveredCount() }} фото выданы!</p>
          } @else {
            <p class="success-title">Фото выдано!</p>
          }

          @if (hasUserAccount()) {
            <p class="success-subtitle">Клиенту отправлена ссылка для скачивания. Фото также будет в разделе «Мои фотографии».</p>
          } @else {
            <p class="success-subtitle success-subtitle--warning">
              <mat-icon class="warning-inline-icon">info</mat-icon>
              Ссылка отправлена в чат. Клиент может скачать фото по кнопке ниже.
            </p>
          }

          @if (publicUrl()) {
            <div class="share-section">
              <div class="share-label">Ссылка для скачивания:</div>
              <div class="share-url-row">
                <input readonly [value]="publicUrl()" class="url-input" (click)="copyLink()" />
                <button mat-icon-button (click)="copyLink()" [matTooltip]="copied() ? 'Скопировано!' : 'Скопировать ссылку'">
                  <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
                </button>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="client-name">
          <mat-icon>person</mat-icon> {{ data.clientName || 'Клиент' }}
        </div>

        <mat-form-field appearance="outline" class="title-field">
          <mat-label>Название</mat-label>
          <input matInput [(ngModel)]="titleInput" placeholder="Фото на паспорт" />
        </mat-form-field>

        <div class="quick-titles">
          @for (t of quickTitles; track t) {
            <button mat-stroked-button class="quick-btn"
                    [class.active]="titleInput === t"
                    (click)="titleInput = t">{{ t }}</button>
          }
        </div>

        @if (!hasFiles()) {
          <div class="dropzone"
               (dragover)="onDragOver($event)"
               (dragleave)="dragOver.set(false)"
               (drop)="onDrop($event)"
               tabindex="0" role="button" (click)="fileInput.click()" (keydown.enter)="fileInput.click()"
               [class.drag-over]="dragOver()">
            <mat-icon>cloud_upload</mat-icon>
            <p>Перетащите фото или нажмите для выбора</p>
            <span class="hint">Можно выбрать несколько файлов</span>
            <input #fileInput type="file" hidden accept="image/*" multiple (change)="onFileSelected($event)" />
          </div>
        } @else {
          <div class="preview-grid">
            @for (f of files(); track f.previewUrl; let i = $index) {
              <div class="preview-item">
                <img [src]="f.previewUrl" alt="Preview" />
                @if (!uploading()) {
                  <button mat-icon-button class="remove-btn" (click)="removeFile(i)">
                    <mat-icon>close</mat-icon>
                  </button>
                }
                @if (f.uploaded) {
                  <mat-icon class="uploaded-badge">check_circle</mat-icon>
                }
              </div>
            }
            @if (!uploading()) {
              <div class="preview-item add-item" (click)="addInput.click()"
                   tabindex="0" role="button" (keydown.enter)="addInput.click()">
                <mat-icon>add_photo_alternate</mat-icon>
                <input #addInput type="file" hidden accept="image/*" multiple (change)="onFileSelected($event)" />
              </div>
            }
          </div>
        }

        @if (uploading()) {
          <div class="upload-progress-wrap">
            <mat-progress-bar mode="determinate" [value]="uploadProgress()" />
            @if (progressLabel()) {
              <span class="progress-label">{{ progressLabel() }}</span>
            }
          </div>
        }

        @if (errorMsg()) {
          <p class="error-msg">{{ errorMsg() }}</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (success()) {
        <button mat-flat-button (click)="dialogRef.close(true)">Готово</button>
      } @else {
        <button mat-button (click)="dialogRef.close(false)" [disabled]="uploading()">Отмена</button>
        <button mat-flat-button color="primary"
                [disabled]="!canSubmit()"
                (click)="upload()">
          <mat-icon>upload</mat-icon>
          @if (files().length > 1) {
            Выдать {{ files().length }} фото
          } @else {
            Выдать клиенту
          }
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    h2 { display: flex; align-items: center; gap: 8px; }
    h2 mat-icon { color: var(--color-amber, #f59e0b); }
    .client-name {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 12px; border-radius: 8px;
      background: rgba(255,255,255,.05); margin-bottom: 12px;
      font-size: 14px; color: rgba(255,255,255,.7);
    }
    .title-field { width: 100%; }
    .quick-titles { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
    .quick-btn { font-size: 12px; height: 28px; line-height: 28px; }
    .quick-btn.active { background: var(--color-amber, #f59e0b); color: #000; }
    .dropzone {
      border: 2px dashed rgba(255,255,255,.2); border-radius: 12px;
      padding: 32px; text-align: center; cursor: pointer;
      transition: border-color .2s, background .2s;
    }
    .dropzone:hover, .dropzone.drag-over {
      border-color: var(--color-amber, #f59e0b);
      background: rgba(245,158,11,.05);
    }
    .dropzone mat-icon { font-size: 48px; width: 48px; height: 48px; color: rgba(255,255,255,.3); }
    .dropzone p { margin: 8px 0 0; color: rgba(255,255,255,.5); font-size: 13px; }
    .dropzone .hint { font-size: 11px; color: rgba(255,255,255,.3); }
    .preview-grid {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 8px; margin-bottom: 12px;
    }
    .preview-item {
      position: relative; aspect-ratio: 1;
      border-radius: 8px; overflow: hidden; background: #111;
    }
    .preview-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .preview-item .remove-btn {
      position: absolute; top: 2px; right: 2px;
      background: rgba(0,0,0,.7); width: 24px; height: 24px;
      min-width: unset; padding: 0;
    }
    .preview-item .remove-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .uploaded-badge {
      position: absolute; bottom: 4px; right: 4px;
      font-size: 20px; width: 20px; height: 20px;
      color: #22c55e; filter: drop-shadow(0 1px 2px rgba(0,0,0,.5));
    }
    .add-item {
      display: flex; align-items: center; justify-content: center;
      border: 2px dashed rgba(255,255,255,.15); cursor: pointer;
      transition: border-color .2s;
    }
    .add-item:hover { border-color: var(--color-amber, #f59e0b); }
    .add-item mat-icon { font-size: 32px; width: 32px; height: 32px; color: rgba(255,255,255,.3); }
    .upload-progress-wrap { margin: 8px 0; }
    .progress-label {
      display: block; text-align: center; font-size: 12px;
      color: rgba(255,255,255,.5); margin-top: 4px;
    }
    .error-msg { color: #ef4444; font-size: 13px; margin: 8px 0; }
    .success-state { text-align: center; padding: 16px 0; }
    .success-icon { font-size: 64px; width: 64px; height: 64px; color: #22c55e; }
    .success-title { font-size: 18px; font-weight: 600; margin: 8px 0 4px; }
    .success-count { font-size: 15px; font-weight: 600; color: var(--color-amber, #f59e0b); margin: 4px 0; }
    .success-subtitle { font-size: 13px; color: rgba(255,255,255,.6); margin-bottom: 12px; }
    .success-subtitle--warning {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #f59e0b;
      font-weight: 500;
    }
    .warning-inline-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #f59e0b;
    }
    .share-section {
      margin-top: 12px;
      text-align: left;
      width: 100%;
    }
    .share-label {
      font-size: 12px;
      color: rgba(255,255,255,.5);
      margin-bottom: 4px;
    }
    .share-url-row {
      display: flex;
      align-items: center;
      gap: 4px;
      background: rgba(255,255,255,.05);
      border-radius: 8px;
      padding: 4px 8px;
    }
    .url-input {
      flex: 1;
      border: none;
      background: none;
      color: #f59e0b;
      font-size: 13px;
      outline: none;
      font-family: monospace;
      cursor: pointer;
    }
  `],
})
export class FinalPhotoUploadDialogComponent {
  readonly data = inject<FinalPhotoUploadData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<FinalPhotoUploadDialogComponent>);
  private readonly http = inject(HttpClient);
  private readonly clipboard = inject(Clipboard);
  private readonly destroyRef = inject(DestroyRef);

  titleInput = 'Фото на паспорт';
  readonly quickTitles = QUICK_TITLES;

  readonly files = signal<SelectedFile[]>([]);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly success = signal(false);
  readonly errorMsg = signal('');
  readonly deliveredCount = signal(0);
  readonly publicToken = signal('');
  readonly downloadLink = signal('');
  readonly hasUserAccount = signal(false);
  readonly copied = signal(false);
  readonly dragOver = signal(false);

  readonly hasFiles = computed(() => this.files().length > 0);
  readonly canSubmit = computed(() =>
    this.files().length > 0 && this.titleInput.trim().length > 0 && !this.uploading(),
  );
  readonly progressLabel = computed(() => {
    const uploaded = this.files().filter(f => f.uploaded).length;
    const total = this.files().length;
    return total > 1 ? `Загружено ${uploaded}/${total}` : '';
  });
  readonly publicUrl = computed(() => {
    const link = this.downloadLink();
    if (link) return link;
    const token = this.publicToken();
    return token ? `https://svoefoto.ru/photo-review/${token}` : '';
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.files().forEach(f => URL.revokeObjectURL(f.previewUrl));
    });
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(true);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(false);
    if (e.dataTransfer?.files) this.addFiles(e.dataTransfer.files);
  }

  onFileSelected(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files) this.addFiles(input.files);
    input.value = '';
  }

  private addFiles(fileList: FileList): void {
    const newItems: SelectedFile[] = Array.from(fileList)
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({ file: f, previewUrl: URL.createObjectURL(f), uploaded: false }));
    this.files.update(prev => [...prev, ...newItems]);
    this.errorMsg.set('');
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const payload = err.error;
      if (typeof payload === 'object' && payload !== null) {
        const message = Reflect.get(payload, 'message');
        if (typeof message === 'string' && message.trim()) return message;
        const error = Reflect.get(payload, 'error');
        if (typeof error === 'string' && error.trim()) return error;
      }
      if (err.message) return err.message;
    }

    if (err instanceof Error && err.message) return err.message;
    return 'Не удалось выдать фото';
  }

  removeFile(index: number): void {
    const item = this.files()[index];
    if (item) URL.revokeObjectURL(item.previewUrl);
    this.files.update(prev => prev.filter((_, i) => i !== index));
  }

  async upload(): Promise<void> {
    const currentFiles = this.files();
    if (currentFiles.length === 0 || !this.titleInput.trim()) return;

    this.uploading.set(true);
    this.errorMsg.set('');
    this.uploadProgress.set(0);

    try {
      // 1. Get presigned URLs for all files
      const presignRes = await firstValueFrom(
        this.http.post<PresignResponse>('/api/photo-approvals/direct-upload/presign', {
          files: currentFiles.map(f => ({
            fileName: f.file.name,
            contentType: f.file.type || 'image/jpeg',
            fileSize: f.file.size,
          })),
        }),
      );
      const uploads = presignRes.data.uploads;

      // 2. Upload all files to S3 in parallel with progress tracking
      let completedCount = 0;
      const totalFiles = currentFiles.length;

      await Promise.all(currentFiles.map((sf, i) => new Promise<void>((resolve, reject) => {
        const fileWeight = 100 / totalFiles;
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploads[i].uploadUrl);
        xhr.setRequestHeader('Content-Type', sf.file.type || 'image/jpeg');

        xhr.upload.onprogress = (e: ProgressEvent) => {
          if (e.lengthComputable) {
            const fileProgress = (e.loaded / e.total) * fileWeight;
            const doneWeight = completedCount * fileWeight;
            this.uploadProgress.set(Math.round(doneWeight + fileProgress));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            completedCount++;
            this.files.update(prev => prev.map((f, idx) =>
              idx === i ? { ...f, s3Key: uploads[i].s3Key, uploaded: true } : f,
            ));
            this.uploadProgress.set(Math.round(completedCount * fileWeight));
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(sf.file);
      })));

      // 3. Call deliver-finals endpoint
      const deliverRes = await firstValueFrom(
        this.http.post<DeliverFinalsResponse>('/api/photo-approvals/deliver-finals', {
          chatSessionId: this.data.chatSessionId,
          title: this.titleInput.trim(),
          photos: this.files().map(f => ({
            s3Key: f.s3Key!,
            originalFilename: f.file.name,
          })),
        }),
      );

      if (deliverRes.success) {
        this.success.set(true);
        this.deliveredCount.set(deliverRes.data.photoCount);
        this.publicToken.set(deliverRes.data.publicToken);
        this.downloadLink.set(deliverRes.data.downloadLink || '');
        this.hasUserAccount.set(deliverRes.data.hasUserAccount);
      }
    } catch (err: unknown) {
      this.uploading.set(false);
      this.uploadProgress.set(0);
      this.errorMsg.set(this.getErrorMessage(err));
    }
  }

  copyLink(): void {
    this.clipboard.copy(this.publicUrl());
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }
}
