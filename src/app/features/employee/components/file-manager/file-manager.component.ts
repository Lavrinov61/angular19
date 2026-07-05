import {
  Component, inject, signal, input,
  ChangeDetectionStrategy, OnInit, OnChanges
} from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ToastService } from '../../../../core/services/toast.service';

interface CrmFile {
  id: number;
  uuid: string;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  entity_type: string | null;
  entity_id: string | null;
  uploaded_by: string;
  tags: string[];
  clamav_status: 'pending' | 'clean' | 'infected' | 'error' | 'skipped';
  created_at: string;
  url: string;
}

@Component({
  selector: 'app-file-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DatePipe,
    DecimalPipe,
  ],
  template: `
    <div style="display:flex;flex-direction:column;gap:0;height:100%">

      <!-- Header -->
      <div style="padding:10px 14px;border-bottom:1px solid var(--crm-border);display:flex;align-items:center;gap:8px;flex-shrink:0">
        <mat-icon style="color:var(--crm-accent);font-size:17px;width:17px;height:17px">folder</mat-icon>
        <span style="font-size:13px;font-weight:600;color:var(--crm-text-primary);flex:1">
          Файлы @if (entityType()) { — {{ entityTypeLabel() }} }
        </span>
        <span style="font-size:11px;color:var(--crm-text-secondary)">{{ files().length }} файлов</span>
      </div>

      <!-- Drop zone -->
      <div
        [style]="dropZoneStyle()"
        (click)="fileInput.click()"
        (keydown.enter)="fileInput.click()"
        tabindex="0"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)">
        <mat-icon style="font-size:22px;width:22px;height:22px;margin-bottom:4px;color:var(--crm-text-secondary)">cloud_upload</mat-icon>
        <span style="font-size:12px;color:var(--crm-text-secondary)">
          @if (uploading()) {
            Загрузка...
          } @else {
            Нажмите или перетащите файл
          }
        </span>
        <input
          #fileInput
          type="file"
          multiple
          style="display:none"
          (change)="onFileSelected($event)"
        >
      </div>

      <!-- Upload progress -->
      @if (uploadProgress() > 0 && uploadProgress() < 100) {
        <div style="padding:4px 14px;flex-shrink:0">
          <mat-progress-bar mode="determinate" [value]="uploadProgress()" style="border-radius:2px" />
        </div>
      }

      <!-- File list -->
      <div style="flex:1;overflow-y:auto">
        @if (loading()) {
          <div style="display:flex;justify-content:center;padding:30px">
            <mat-progress-spinner diameter="22" mode="indeterminate" />
          </div>
        } @else if (files().length === 0) {
          <div style="padding:30px 20px;text-align:center;color:var(--crm-text-secondary)">
            <mat-icon style="font-size:32px;width:32px;height:32px;display:block;margin:0 auto 6px">folder_open</mat-icon>
            <div style="font-size:12px">Файлов нет</div>
          </div>
        } @else {
          @for (file of files(); track file.uuid) {
            <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--crm-border);transition:background 0.15s"
                 (mouseenter)="hoveredFile.set(file.uuid)"
                 (mouseleave)="hoveredFile.set(null)"
                 [style.background]="hoveredFile() === file.uuid ? 'var(--crm-surface-hover)' : 'transparent'">

              <!-- File icon -->
              <div style="width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0"
                   [style.background]="mimeColor(file.mime_type)">
                <mat-icon style="font-size:16px;width:16px;height:16px;color:#fff">{{ mimeIcon(file.mime_type) }}</mat-icon>
              </div>

              <!-- Info -->
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;color:var(--crm-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                     [matTooltip]="file.original_name">
                  {{ file.original_name }}
                </div>
                <div style="font-size:10px;color:var(--crm-text-secondary);margin-top:1px">
                  {{ formatSize(+file.size_bytes) }} · {{ file.created_at | date:'dd.MM.yy HH:mm' }}
                  @if (file.clamav_status === 'clean') {
                    · <span style="color:#4caf50">✓ безопасен</span>
                  }
                  @if (file.clamav_status === 'infected') {
                    · <span style="color:#ef5350">⚠ вирус</span>
                  }
                </div>
              </div>

              <!-- Actions -->
              <div style="display:flex;gap:2px;flex-shrink:0">
                <a [href]="file.url" target="_blank" download
                   mat-icon-button style="width:26px;height:26px"
                   matTooltip="Скачать">
                  <mat-icon style="font-size:14px;width:14px;height:14px">download</mat-icon>
                </a>
                <button mat-icon-button style="width:26px;height:26px;color:var(--crm-text-secondary)"
                        matTooltip="Удалить"
                        (click)="deleteFile(file)">
                  <mat-icon style="font-size:14px;width:14px;height:14px">delete</mat-icon>
                </button>
              </div>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class FileManagerComponent implements OnInit, OnChanges {
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  // Inputs — link files to an entity (optional)
  entityType = input<string | null>(null);
  entityId = input<string | null>(null);

  // State
  files = signal<CrmFile[]>([]);
  loading = signal(false);
  uploading = signal(false);
  uploadProgress = signal(0);
  isDragging = signal(false);
  hoveredFile = signal<string | null>(null);

  ngOnInit(): void {
    this.loadFiles();
  }

  ngOnChanges(): void {
    this.loadFiles();
  }

  entityTypeLabel(): string {
    const labels: Record<string, string> = {
      order: 'заказ', task: 'задача', booking: 'запись',
      client: 'клиент', email: 'письмо', shared: 'общие',
    };
    return labels[this.entityType() || ''] || this.entityType() || '';
  }

  loadFiles(): void {
    this.loading.set(true);
    const params = new URLSearchParams({ limit: '100' });
    if (this.entityType()) params.set('entity_type', this.entityType()!);
    if (this.entityId()) params.set('entity_id', this.entityId()!);

    this.http.get<{ success: boolean; data: CrmFile[] }>(`/api/files/crm?${params}`).subscribe({
      next: r => {
        this.files.set(r.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить файлы');
      },
    });
  }

  dropZoneStyle(): string {
    const dragging = this.isDragging();
    return `margin:10px 12px;border:2px dashed ${dragging ? 'var(--crm-accent)' : 'var(--crm-border)'};
      border-radius:8px;padding:16px;text-align:center;cursor:pointer;
      display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;
      background:${dragging ? 'rgba(139,92,246,0.06)' : 'var(--crm-surface-hover)'};
      transition:all 0.2s`;
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging.set(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) this.uploadFiles(files);
  }

  onFileSelected(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (files.length) this.uploadFiles(files);
    input.value = '';
  }

  uploadFiles(files: File[]): void {
    const uploads = files.map(file => this.uploadSingle(file));
    Promise.allSettled(uploads).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed === 0) {
        this.toast.success(`${files.length} файлов загружено`);
      } else if (failed < files.length) {
        this.toast.error(`${failed} из ${files.length} файлов не удалось загрузить`);
      }
    });
  }

  private uploadSingle(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      this.uploading.set(true);
      this.uploadProgress.set(0);

      const formData = new FormData();
      formData.append('file', file);
      if (this.entityType()) formData.append('entity_type', this.entityType()!);
      if (this.entityId()) formData.append('entity_id', this.entityId()!);

      this.http.post<{ success: boolean; data: { uuid: string; originalName: string; url: string; mimeType: string; sizeBytes: number; clamavStatus: string } }>(
        '/api/files/crm/upload',
        formData,
        { reportProgress: true, observe: 'events' }
      ).subscribe({
        next: event => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.uploadProgress.set(Math.round(event.loaded / event.total * 100));
          } else if (event.type === HttpEventType.Response) {
            this.uploading.set(false);
            this.uploadProgress.set(100);
            if (event.body?.data) {
              this.files.update(prev => [{
                id: 0,
                uuid: event.body!.data.uuid,
                original_name: event.body!.data.originalName,
                mime_type: event.body!.data.mimeType,
                size_bytes: String(event.body!.data.sizeBytes),
                entity_type: this.entityType(),
                entity_id: this.entityId(),
                uploaded_by: '',
                tags: [],
                clamav_status: event.body!.data.clamavStatus as CrmFile['clamav_status'],
                created_at: new Date().toISOString(),
                url: event.body!.data.url,
              }, ...prev]);
            }
            setTimeout(() => this.uploadProgress.set(0), 1500);
            resolve();
          }
        },
        error: err => {
          this.uploading.set(false);
          this.uploadProgress.set(0);
          const msg = err?.error?.message || `Файл ${file.name} не загружен`;
          this.toast.error(msg);
          reject(new Error(msg));
        },
      });
    });
  }

  deleteFile(file: CrmFile): void {
    if (!confirm(`Удалить файл "${file.original_name}"?`)) return;

    this.http.delete(`/api/files/crm/${file.uuid}`).subscribe({
      next: () => {
        this.files.update(prev => prev.filter(f => f.uuid !== file.uuid));
        this.toast.success('Файл удалён');
      },
      error: () => this.toast.error('Не удалось удалить файл'),
    });
  }

  mimeIcon(mime: string): string {
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'picture_as_pdf';
    if (mime.includes('word')) return 'article';
    if (mime.includes('excel') || mime.includes('spreadsheet') || mime === 'text/csv') return 'table_chart';
    if (mime.includes('zip')) return 'folder_zip';
    return 'insert_drive_file';
  }

  mimeColor(mime: string): string {
    if (mime.startsWith('image/')) return '#7c3aed';
    if (mime === 'application/pdf') return '#ef5350';
    if (mime.includes('word')) return '#1565c0';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return '#2e7d32';
    if (mime.includes('zip')) return '#e65100';
    return '#616161';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
