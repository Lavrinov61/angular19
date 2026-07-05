import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { OrderWizardStore } from '../order-wizard.store';
import { FileDropzoneComponent } from '../shared/file-dropzone.component';

@Component({
  selector: 'app-file-upload-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, FileDropzoneComponent],
  host: { class: 'file-upload-step' },
  template: `
    <div class="fus-content">
      <!-- Client files (required) -->
      <div class="fus-section">
        <div class="fus-label-row">
          <h3 class="fus-label">Фотографии / документы клиента</h3>
          <span class="fus-badge fus-badge--required">Обязательно</span>
        </div>
        <app-file-dropzone
          [files]="store.clientFiles()"
          accept="image/*,.heic,.heif,.pdf"
          [multiple]="true"
          (filesAdded)="store.addClientFiles($event)"
          (fileRemoved)="store.removeClientFile($event)"
        />
      </div>

      <!-- Form example files (optional, for form-substitution) -->
      @if (store.showFormExampleUpload()) {
        <div class="fus-section">
          <div class="fus-label-row">
            <h3 class="fus-label">Пример формы</h3>
            <span class="fus-badge fus-badge--optional">Необязательно</span>
          </div>
          <app-file-dropzone
            [files]="store.formExampleFiles()"
            accept="image/*,.pdf"
            [multiple]="true"
            (filesAdded)="store.addFormExampleFiles($event)"
            (fileRemoved)="store.removeFormExampleFile($event)"
          />
        </div>
      }

      <!-- Actions -->
      <div class="fus-actions">
        <button class="fus-btn fus-btn--outline" (click)="store.prevStep()">
          <mat-icon>arrow_back</mat-icon> Назад
        </button>
        <button
          class="fus-btn fus-btn--primary"
          [disabled]="!store.step3Complete()"
          (click)="store.nextStep()"
        >
          Далее <mat-icon>arrow_forward</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .fus-content {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .fus-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .fus-label-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .fus-label {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary, #ececec);
    }

    .fus-badge {
      padding: 2px 8px;
      border-radius: 100px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .fus-badge--required {
      background: rgba(245, 158, 11, 0.15);
      color: var(--crm-accent, #f59e0b);
    }

    .fus-badge--optional {
      background: rgba(255, 255, 255, 0.04);
      color: var(--crm-text-muted, #7a7a7a);
    }

    .fus-actions {
      display: flex;
      gap: 10px;
      padding-top: 4px;
    }

    .fus-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      border: none;
      border-radius: var(--crm-radius-md, 8px);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--crm-transition-fast, 120ms ease);

      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .fus-btn--primary {
      background: var(--crm-accent, #f59e0b);
      color: var(--crm-on-accent, #0a0a0a);

      &:hover:not(:disabled) { background: var(--crm-accent-hover, #fbbf24); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .fus-btn--outline {
      background: transparent;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      color: var(--crm-text-secondary, #a0a0a0);
      &:hover {
        background: var(--crm-surface-hover, rgba(255, 255, 255, 0.035));
        color: var(--crm-text-primary, #ececec);
      }
    }
  `],
})
export class FileUploadStepComponent {
  readonly store = inject(OrderWizardStore);
}
