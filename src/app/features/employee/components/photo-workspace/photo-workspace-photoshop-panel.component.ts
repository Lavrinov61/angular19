import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { PhotoWorkspaceEnvelopeDto, PhotoWorkspaceVariantDto } from '../../models/photo-workspace.model';

export type PhotoWorkspacePhotoshopUploadMode = 'complete' | 'replace';

export interface PhotoWorkspacePhotoshopUploadRequest {
  variant: PhotoWorkspaceVariantDto;
  file: File;
  mode: PhotoWorkspacePhotoshopUploadMode;
}

export interface PhotoWorkspaceCheckedUpdate {
  variant: PhotoWorkspaceVariantDto;
  checked: boolean;
}

@Component({
  selector: 'app-photo-workspace-photoshop-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatCheckboxModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  template: `
    <section class="pwps-panel">
      <header class="pwps-header">
        <mat-icon>brush</mat-icon>
        <h3>Photoshop и отправка</h3>
        <span>{{ checkedCount() }} проверено</span>
      </header>

      @if (uploadingVariantId()) {
        <mat-progress-bar mode="determinate" [value]="uploadProgress()" />
      }

      <div class="pwps-actions">
        <button
          mat-stroked-button
          type="button"
          disabled
          matTooltip="Backend route для создания photoshop_only варианта еще не подключен">
          <mat-icon>add_photo_alternate</mat-icon>
          Добавить Photoshop-вариант
        </button>
        <button
          mat-flat-button
          type="button"
          [disabled]="!canSend() || sending()"
          (click)="sendVerified.emit()">
          <mat-icon>send</mat-icon>
          Отправить клиенту
        </button>
      </div>

      <div class="pwps-list">
        @for (variant of variants(); track variant.id) {
          <article class="pwps-card">
            <header>
              <div>
                <strong>{{ variant.preset_label }}</strong>
                <span>{{ variant.status }}</span>
              </div>
              <mat-checkbox
                [checked]="!!variant.checked_at"
                [disabled]="!variant.photoshop_url || uploadingVariantId() === variant.id"
                (change)="checkedChange.emit({ variant, checked: $event.checked })">
                Проверено
              </mat-checkbox>
            </header>

            <div class="pwps-compare" [class.has-photoshop]="!!variant.photoshop_url">
              <section>
                <h4>AI</h4>
                @if (variant.ai_original_url) {
                  <a [href]="variant.ai_original_url" target="_blank" rel="noopener">
                    <img [src]="variant.ai_original_thumbnail_url || variant.ai_original_url" [alt]="variant.preset_label + ' AI'" />
                  </a>
                  <a mat-stroked-button [href]="variant.ai_original_url" target="_blank" rel="noopener">
                    <mat-icon>download</mat-icon>
                    Скачать AI
                  </a>
                } @else {
                  <div class="pwps-empty">AI-файл не готов</div>
                }
              </section>

              <section>
                <h4>Photoshop</h4>
                @if (variant.photoshop_url) {
                  <a [href]="variant.photoshop_url" target="_blank" rel="noopener">
                    <img [src]="variant.photoshop_thumbnail_url || variant.photoshop_url" [alt]="variant.preset_label + ' Photoshop'" />
                  </a>
                } @else {
                  <div class="pwps-empty">Photoshop-файл не загружен</div>
                }
                <label class="pwps-upload" [class.is-busy]="uploadingVariantId() === variant.id">
                  <input
                    type="file"
                    hidden
                    accept="image/*,.psd,image/vnd.adobe.photoshop"
                    [disabled]="uploadingVariantId() === variant.id"
                    (change)="onFileSelected($event, variant, variant.sent_at ? 'replace' : 'complete')" />
                  <mat-icon>cloud_upload</mat-icon>
                  <span>{{ variant.photoshop_url ? 'Заменить' : 'Загрузить Photoshop' }}</span>
                </label>
              </section>
            </div>

            @if (variant.sent_at) {
              <div class="pwps-sent">
                <mat-icon>task_alt</mat-icon>
                <span>Отправлен клиенту</span>
                <button mat-stroked-button type="button" (click)="deleteApprovalFile.emit(variant)">
                  <mat-icon>delete</mat-icon>
                  Удалить из согласования
                </button>
              </div>
            }
          </article>
        }
        @if (!variants().length) {
          <div class="pwps-empty">Нет вариантов для Photoshop</div>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pwps-panel, .pwps-list, .pwps-card { display: flex; flex-direction: column; }
    .pwps-panel { gap: 10px; }
    .pwps-list { gap: 9px; }
    .pwps-header, .pwps-actions, .pwps-card header, .pwps-sent { display: flex; align-items: center; gap: 7px; }
    .pwps-header mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; }
    h3, h4 { margin: 0; }
    h3 { font-size: 13px; font-weight: 650; }
    h4 { color: var(--crm-text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .pwps-header span { margin-left: auto; color: var(--crm-text-muted); font-size: 12px; }
    .pwps-actions { flex-wrap: wrap; }
    .pwps-card { gap: 9px; padding: 9px; border-radius: 8px; background: var(--crm-surface-raised); }
    .pwps-card header div { min-width: 0; flex: 1; }
    .pwps-card strong, .pwps-card span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pwps-card strong { font-size: 13px; }
    .pwps-card span { color: var(--crm-text-muted); font-size: 12px; }
    .pwps-compare { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .pwps-compare.has-photoshop { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pwps-compare section { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
    .pwps-compare img { display: block; width: 100%; max-height: 240px; object-fit: contain; border-radius: 8px; background: var(--crm-surface-base); }
    .pwps-upload {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid var(--crm-border);
      border-radius: 7px;
      color: var(--crm-text-secondary);
      background: var(--crm-surface-base);
      font-size: 12px;
      cursor: pointer;
    }
    .pwps-upload.is-busy { opacity: 0.65; cursor: progress; }
    .pwps-upload mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pwps-sent {
      padding: 7px 8px;
      border-radius: 8px;
      color: var(--crm-status-success);
      background: var(--crm-status-success-muted);
      font-size: 12px;
      flex-wrap: wrap;
    }
    .pwps-sent span { flex: 1; min-width: 100px; color: inherit; }
    .pwps-empty { padding: 10px; border: 1px dashed var(--crm-border); border-radius: 8px; color: var(--crm-text-muted); font-size: 12px; text-align: center; }

    @media (max-width: 720px) {
      .pwps-compare.has-photoshop { grid-template-columns: 1fr; }
    }
  `],
})
export class PhotoWorkspacePhotoshopPanelComponent {
  readonly envelope = input<PhotoWorkspaceEnvelopeDto | null>(null);
  readonly uploadingVariantId = input<string | null>(null);
  readonly uploadProgress = input(0);
  readonly sending = input(false);
  readonly uploadPhotoshop = output<PhotoWorkspacePhotoshopUploadRequest>();
  readonly checkedChange = output<PhotoWorkspaceCheckedUpdate>();
  readonly sendVerified = output<void>();
  readonly deleteApprovalFile = output<PhotoWorkspaceVariantDto>();

  readonly variants = computed(() => this.envelope()?.variants.filter(variant => variant.enabled) ?? []);
  readonly checkedCount = computed(() => this.variants().filter(variant => !!variant.checked_at).length);
  readonly canSend = computed(() => this.variants().some(variant => !!variant.checked_at && !!variant.photoshop_url));

  onFileSelected(event: Event, variant: PhotoWorkspaceVariantDto, mode: PhotoWorkspacePhotoshopUploadMode): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file) {
      this.uploadPhotoshop.emit({ variant, file, mode });
    }
    input.value = '';
  }
}
