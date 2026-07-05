import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { OrderWizardStore } from '../order-wizard.store';
import type { WizardServiceType } from '../order-wizard.types';

@Component({
  selector: 'app-order-type-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'order-type-step' },
  template: `
    <div class="ots-content">
      <h3 class="ots-heading">Выберите тип услуги</h3>
      <div class="ots-grid">
        @for (type of store.wizardServiceTypes(); track type.slug) {
          <button
            class="ots-card"
            [class.ots-card--selected]="store.selectedServiceType()?.slug === type.slug"
            (click)="onSelect(type)"
          >
            <mat-icon class="ots-card-icon">{{ type.icon }}</mat-icon>
            <span class="ots-card-name">{{ type.name }}</span>
            <span class="ots-card-desc">{{ type.description }}</span>
            <span class="ots-card-price">{{ type.priceRange }}</span>
          </button>
        }
      </div>

      <div class="ots-actions">
        <button
          class="ots-btn ots-btn--primary"
          [disabled]="!store.step1Complete()"
          (click)="store.nextStep()"
        >
          Далее <mat-icon>arrow_forward</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .ots-content {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .ots-heading {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    .ots-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;

      @media (max-width: 640px) {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .ots-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 20px 12px;
      background: var(--crm-surface-raised, #1b1a17);
      border: 2px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-lg, 12px);
      cursor: pointer;
      transition: all var(--crm-transition-normal, 200ms ease);
      text-align: center;
      font-family: inherit;
      color: var(--crm-text-primary, #ececec);
      box-shadow: var(--crm-shadow-card, 0 1px 3px rgba(0, 0, 0, 0.3));

      &:hover {
        border-color: rgba(245, 158, 11, 0.3);
        transform: translateY(-2px);
        box-shadow: var(--crm-shadow-card-hover, 0 4px 16px rgba(0, 0, 0, 0.35));
      }

      &--selected {
        border-color: var(--crm-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.06);
        box-shadow: var(--crm-shadow-accent-glow, 0 0 20px rgba(245, 158, 11, 0.15));
      }
    }

    .ots-card-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--crm-accent, #f59e0b);
    }

    .ots-card-name {
      font-size: 13px;
      font-weight: 700;
      line-height: 1.2;
    }

    .ots-card-desc {
      font-size: 11px;
      color: var(--crm-text-muted, #7a7a7a);
      line-height: 1.3;
    }

    .ots-card-price {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-accent, #f59e0b);
      font-family: var(--crm-font-mono, monospace);
    }

    .ots-actions {
      display: flex;
      justify-content: flex-end;
    }

    .ots-btn {
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

    .ots-btn--primary {
      background: var(--crm-accent, #f59e0b);
      color: var(--crm-on-accent, #0a0a0a);

      &:hover:not(:disabled) {
        background: var(--crm-accent-hover, #fbbf24);
        box-shadow: var(--crm-shadow-accent-glow);
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }
  `],
})
export class OrderTypeStepComponent {
  readonly store = inject(OrderWizardStore);

  onSelect(type: WizardServiceType): void {
    this.store.selectServiceType(type);
  }
}
