import {
  Component,
  ChangeDetectionStrategy,
  input,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { DocumentTemplate } from '../order-wizard.types';

@Component({
  selector: 'app-document-requirements-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'document-requirements-card' },
  template: `
    <div class="drc-card">
      <h4 class="drc-title">
        <mat-icon>info_outline</mat-icon>
        Требования к фото
      </h4>
      <div class="drc-grid">
        <div class="drc-item">
          <span class="drc-label">Размер фото</span>
          <span class="drc-value">{{ template().photo_width_mm }} x {{ template().photo_height_mm }} мм</span>
        </div>
        @if (template().background) {
          <div class="drc-item">
            <span class="drc-label">Фон</span>
            <span class="drc-value drc-bg-row">
              <span
                class="drc-bg-dot"
                [style.background]="template().background"
              ></span>
              {{ template().background }}
            </span>
          </div>
        }
        @if (template().head_height_mm) {
          <div class="drc-item">
            <span class="drc-label">Высота головы</span>
            <span class="drc-value">{{ template().head_height_mm }} мм</span>
          </div>
        }
        @if (template().photos_per_sheet) {
          <div class="drc-item">
            <span class="drc-label">Фото на листе</span>
            <span class="drc-value">{{ template().photos_per_sheet }} шт.</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .drc-card {
      padding: 14px 16px;
      background: var(--crm-surface-raised, #1b1a17);
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-lg, 12px);
    }

    .drc-title {
      margin: 0 0 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary, #ececec);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-status-info, #60a5fa);
      }
    }

    .drc-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .drc-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .drc-label {
      font-size: 11px;
      color: var(--crm-text-muted, #7a7a7a);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .drc-value {
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary, #ececec);
      font-family: var(--crm-font-mono, monospace);
    }

    .drc-bg-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--crm-font-sans, sans-serif);
    }

    .drc-bg-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      flex-shrink: 0;
    }
  `],
})
export class DocumentRequirementsCardComponent {
  readonly template = input.required<DocumentTemplate>();
}
