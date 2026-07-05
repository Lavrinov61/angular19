import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { OrderWizardStore } from '../order-wizard.store';
import { VisaCountrySelectorComponent } from '../shared/visa-country-selector.component';
import { DocumentRequirementsCardComponent } from '../shared/document-requirements-card.component';
import type { WizardDocumentType, ProcessingTier } from '../order-wizard.types';

@Component({
  selector: 'app-document-details-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatIconModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    VisaCountrySelectorComponent,
    DocumentRequirementsCardComponent,
  ],
  host: { class: 'document-details-step' },
  template: `
    <div class="dds-content">
      <!-- Alert banner -->
      @if (store.showPassportVisaAlert()) {
        <div class="dds-alert">
          <mat-icon>warning_amber</mat-icon>
          <span>Проверьте актуальные требования к фото. Для загранпаспорта нового образца биометрическое фото делается в МФЦ.</span>
        </div>
      }

      <!-- Document type chips -->
      <div class="dds-section">
        <h3 class="dds-label">Тип документа</h3>
        <div class="dds-chips">
          @for (doc of store.documentTypes(); track doc.slug) {
            <button
              class="dds-chip"
              [class.dds-chip--active]="store.selectedDocumentType()?.slug === doc.slug"
              (click)="onSelectDoc(doc)"
            >
              <mat-icon>{{ doc.icon }}</mat-icon>
              <span>{{ doc.name }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Visa country selector -->
      @if (store.selectedDocumentType()?.requiresCountry) {
        <app-visa-country-selector />
      }

      <!-- Document requirements -->
      @if (store.activeDocumentTemplate(); as tpl) {
        <app-document-requirements-card [template]="tpl" />
      }

      <!-- Photo size -->
      @if (store.availablePhotoSizes().length > 0) {
        <div class="dds-section">
          <mat-form-field appearance="outline" class="dds-field">
            <mat-label>Размер фото</mat-label>
            <mat-select
              [value]="store.selectedPhotoSize()"
              (selectionChange)="store.selectedPhotoSize.set($event.value)"
            >
              @for (size of store.availablePhotoSizes(); track size) {
                <mat-option [value]="size">{{ size }} мм</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      }

      <!-- Medals checkbox -->
      <div class="dds-section">
        <mat-checkbox
          [checked]="store.hasMedalsAndChevrons()"
          (change)="store.hasMedalsAndChevrons.set($event.checked)"
        >
          Медали и шевроны на форме
        </mat-checkbox>

        @if (store.hasMedalsAndChevrons()) {
          <textarea
            class="dds-textarea"
            placeholder="Опишите медали, шевроны, нашивки..."
            [value]="store.medalsDescription()"
            (input)="store.medalsDescription.set(asText($event))"
            rows="2"
          ></textarea>
        }
      </div>

      <!-- Processing tier -->
      <div class="dds-section">
        <h3 class="dds-label">Уровень обработки</h3>
        <div class="dds-tier-segment">
          @for (tier of store.processingTiers(); track tier.slug) {
            <button
              class="dds-tier"
              [class.dds-tier--active]="store.selectedTier()?.slug === tier.slug"
              (click)="onSelectTier(tier)"
            >
              @if (tier.popular) {
                <span class="dds-tier-badge">Популярный</span>
              }
              <span class="dds-tier-name">{{ tier.name }}</span>
              <span class="dds-tier-price">{{ tier.price }} ₽</span>
              <span class="dds-tier-desc">{{ tier.description }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Actions -->
      <div class="dds-actions">
        <button class="dds-btn dds-btn--outline" (click)="store.prevStep()">
          <mat-icon>arrow_back</mat-icon> Назад
        </button>
        <button
          class="dds-btn dds-btn--primary"
          [disabled]="!store.step2Complete()"
          (click)="store.nextStep()"
        >
          Далее <mat-icon>arrow_forward</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .dds-content {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .dds-alert {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      background: var(--crm-status-warning-container, rgba(251, 191, 36, 0.08));
      border: 1px solid rgba(251, 191, 36, 0.25);
      border-radius: var(--crm-radius-md, 8px);
      font-size: 12px;
      color: var(--crm-status-warning, #fbbf24);
      line-height: 1.4;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin-top: 1px;
      }
    }

    .dds-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .dds-label {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--crm-text-muted, #7a7a7a);
    }

    .dds-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .dds-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: 20px;
      background: var(--crm-surface-raised, #1b1a17);
      color: var(--crm-text-primary, #ececec);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all var(--crm-transition-fast, 120ms ease);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-text-muted, #7a7a7a);
        transition: color var(--crm-transition-fast, 120ms ease);
      }

      &:hover {
        border-color: rgba(245, 158, 11, 0.4);
        mat-icon { color: var(--crm-accent, #f59e0b); }
      }

      &--active {
        border-color: var(--crm-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.1);
        mat-icon { color: var(--crm-accent, #f59e0b); }
        span { color: var(--crm-accent, #f59e0b); font-weight: 600; }
      }
    }

    .dds-field {
      max-width: 280px;
    }

    .dds-textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-md, 8px);
      background: var(--crm-surface, #131210);
      color: var(--crm-text-primary, #ececec);
      font: inherit;
      font-size: 13px;
      resize: vertical;
      outline: none;
      transition: border-color var(--crm-transition-fast, 120ms ease);

      &:focus { border-color: var(--crm-accent, #f59e0b); }
      &::placeholder { color: var(--crm-text-muted, #7a7a7a); }
    }

    .dds-tier-segment {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;

      @media (max-width: 440px) {
        grid-template-columns: 1fr;
      }
    }

    .dds-tier {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 16px 12px;
      border: 2px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-lg, 12px);
      background: var(--crm-surface-raised, #1b1a17);
      cursor: pointer;
      transition: all var(--crm-transition-normal, 200ms ease);
      text-align: center;
      font-family: inherit;
      color: var(--crm-text-primary, #ececec);

      &:hover {
        border-color: rgba(245, 158, 11, 0.4);
      }

      &--active {
        border-color: var(--crm-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.06);
        box-shadow: var(--crm-shadow-accent-glow);
      }
    }

    .dds-tier-badge {
      position: absolute;
      top: -9px;
      left: 50%;
      transform: translateX(-50%);
      padding: 2px 10px;
      background: var(--crm-accent, #f59e0b);
      color: var(--crm-on-accent, #0a0a0a);
      font-size: 10px;
      font-weight: 800;
      border-radius: 100px;
      white-space: nowrap;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .dds-tier-name {
      font-size: 14px;
      font-weight: 700;
    }

    .dds-tier-price {
      font-size: 18px;
      font-weight: 800;
      color: var(--crm-accent, #f59e0b);
      font-family: var(--crm-font-mono, monospace);
    }

    .dds-tier-desc {
      font-size: 11px;
      color: var(--crm-text-muted, #7a7a7a);
      line-height: 1.3;
    }

    .dds-actions {
      display: flex;
      gap: 10px;
      padding-top: 4px;
    }

    .dds-btn {
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

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .dds-btn--primary {
      background: var(--crm-accent, #f59e0b);
      color: var(--crm-on-accent, #0a0a0a);

      &:hover:not(:disabled) { background: var(--crm-accent-hover, #fbbf24); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .dds-btn--outline {
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
export class DocumentDetailsStepComponent {
  readonly store = inject(OrderWizardStore);

  onSelectDoc(doc: WizardDocumentType): void {
    this.store.selectDocumentType(doc);
  }

  onSelectTier(tier: ProcessingTier): void {
    this.store.selectTier(tier);
  }

  asText(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }
}
