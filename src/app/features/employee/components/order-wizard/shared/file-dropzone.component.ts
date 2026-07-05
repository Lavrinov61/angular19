import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { UploadFile } from '../order-wizard.types';

@Component({
  selector: 'app-file-dropzone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'file-dropzone' },
  template: `
    <div
      class="fdz-zone"
      [class.fdz-zone--over]="isDragOver()"
      [class.fdz-zone--has-files]="files().length > 0"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
      (click)="fileInput.click()"
      tabindex="0"
      role="button"
      (keydown.enter)="fileInput.click()"
    >
      @if (files().length === 0) {
        <mat-icon class="fdz-icon">cloud_upload</mat-icon>
        <p class="fdz-text">Перетащите файлы сюда или нажмите для выбора</p>
        <span class="fdz-hint">{{ accept() || 'Любые файлы' }}</span>
      } @else {
        <div class="fdz-thumbs">
          @for (f of files(); track f.id) {
            <div class="fdz-thumb">
              @if (f.isImage) {
                <img [src]="f.previewUrl" [alt]="f.name" />
              } @else {
                <mat-icon class="fdz-file-icon">insert_drive_file</mat-icon>
              }
              <button
                type="button"
                class="fdz-remove"
                (click)="removeFile(f.id); $event.stopPropagation()"
                aria-label="Удалить"
              >
                <mat-icon>close</mat-icon>
              </button>
              <span class="fdz-fname">{{ f.name }}</span>
            </div>
          }
          <button
            type="button"
            class="fdz-add"
            (click)="fileInput.click(); $event.stopPropagation()"
          >
            <mat-icon>add</mat-icon>
          </button>
        </div>
      }

      <input
        #fileInput
        type="file"
        [accept]="accept()"
        [multiple]="multiple()"
        hidden
        (change)="onFilesSelected($event)"
      />
    </div>
  `,
  styles: [`
    :host { display: block; }

    .fdz-zone {
      border: 2px dashed var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-lg, 12px);
      padding: 28px 16px;
      text-align: center;
      cursor: pointer;
      transition: border-color var(--crm-transition-fast, 120ms ease),
                  background var(--crm-transition-fast, 120ms ease);
      background: rgba(255, 255, 255, 0.01);
      min-height: 100px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;

      &--over {
        border-color: var(--crm-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.06);
      }

      &--has-files {
        padding: 12px;
        border-style: solid;
        border-color: var(--crm-border, rgba(255, 255, 255, 0.06));
        min-height: auto;
      }
    }

    .fdz-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--crm-accent, #f59e0b);
      margin-bottom: 8px;
    }

    .fdz-text {
      margin: 0;
      font-weight: 600;
      font-size: 13px;
      color: var(--crm-text-primary, #ececec);
    }

    .fdz-hint {
      display: block;
      margin-top: 4px;
      font-size: 11px;
      color: var(--crm-text-muted, #7a7a7a);
    }

    .fdz-thumbs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      width: 100%;
    }

    .fdz-thumb {
      position: relative;
      width: 72px;
      height: 72px;
      border-radius: var(--crm-radius-md, 8px);
      overflow: hidden;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      background: var(--crm-surface, #131210);
      display: flex;
      align-items: center;
      justify-content: center;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    }

    .fdz-file-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--crm-text-muted, #7a7a7a);
    }

    .fdz-fname {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 2px 4px;
      font-size: 8px;
      background: rgba(0, 0, 0, 0.7);
      color: var(--crm-text-secondary, #a0a0a0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .fdz-remove {
      position: absolute;
      right: 2px;
      top: 2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 0;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 12px;
        width: 12px;
        height: 12px;
      }
    }

    .fdz-add {
      width: 72px;
      height: 72px;
      border-radius: var(--crm-radius-md, 8px);
      border: 2px dashed var(--crm-border, rgba(255, 255, 255, 0.06));
      background: transparent;
      color: var(--crm-text-muted, #7a7a7a);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color var(--crm-transition-fast, 120ms ease),
                  color var(--crm-transition-fast, 120ms ease);

      &:hover {
        border-color: var(--crm-accent, #f59e0b);
        color: var(--crm-accent, #f59e0b);
      }
    }
  `],
})
export class FileDropzoneComponent {
  readonly files = input.required<readonly UploadFile[]>();
  readonly accept = input('image/*');
  readonly multiple = input(true);

  readonly filesAdded = output<File[]>();
  readonly fileRemoved = output<string>();

  readonly isDragOver = signal(false);

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    const list = event.dataTransfer?.files;
    if (list?.length) {
      this.filesAdded.emit(Array.from(list));
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.filesAdded.emit(Array.from(input.files));
    input.value = '';
  }

  removeFile(id: string): void {
    this.fileRemoved.emit(id);
  }
}
