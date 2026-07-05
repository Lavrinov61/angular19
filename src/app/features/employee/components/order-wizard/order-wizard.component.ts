import {
  Component,
  ChangeDetectionStrategy,
  inject,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { OrderWizardStore } from './order-wizard.store';
import { OrderTypeStepComponent } from './steps/order-type-step.component';
import { DocumentDetailsStepComponent } from './steps/document-details-step.component';
import { FormSubstitutionStepComponent } from './steps/form-substitution-step.component';
import { FileUploadStepComponent } from './steps/file-upload-step.component';
import { OrderSummaryStepComponent } from './steps/order-summary-step.component';

@Component({
  selector: 'app-order-wizard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [OrderWizardStore],
  host: { class: 'order-wizard' },
  imports: [
    MatStepperModule,
    MatButtonModule,
    MatIconModule,
    OrderTypeStepComponent,
    DocumentDetailsStepComponent,
    FormSubstitutionStepComponent,
    FileUploadStepComponent,
    OrderSummaryStepComponent,
  ],
  template: `
    <header class="ow-header">
      <button class="ow-back-btn" (click)="onBack()">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <div class="ow-header-text">
        <h1 class="ow-title">Новый заказ</h1>
        @if (store.selectedServiceType(); as svc) {
          <span class="ow-subtitle">{{ svc.name }}</span>
        }
      </div>
    </header>

    <mat-stepper
      #stepper
      [linear]="true"
      [selectedIndex]="store.currentStep()"
      (selectionChange)="store.currentStep.set($event.selectedIndex)"
      class="ow-stepper"
    >
      <mat-step [completed]="store.step1Complete()" label="Тип услуги">
        <app-order-type-step />
      </mat-step>

      <mat-step [completed]="store.step2Complete()" label="Детали">
        @switch (store.detailsVariant()) {
          @case ('document') {
            <app-document-details-step />
          }
          @case ('form-substitution') {
            <app-form-substitution-step />
          }
          @default {
            <!-- Simple variant: skip details, auto-complete -->
            <div class="ow-simple-skip">
              <p class="ow-simple-text">Дополнительные детали не требуются</p>
              <div class="ow-step-actions">
                <button class="ow-btn ow-btn--outline" (click)="store.prevStep()">
                  <mat-icon>arrow_back</mat-icon> Назад
                </button>
                <button class="ow-btn ow-btn--primary" (click)="store.nextStep()">
                  Далее <mat-icon>arrow_forward</mat-icon>
                </button>
              </div>
            </div>
          }
        }
      </mat-step>

      <mat-step [completed]="store.step3Complete()" label="Файлы">
        <app-file-upload-step />
      </mat-step>

      <mat-step label="Оформление">
        <app-order-summary-step />
      </mat-step>
    </mat-stepper>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--crm-surface-base, #0c0b09);
      color: var(--crm-text-primary, #ececec);
      overflow-y: auto;
    }

    .ow-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      background: var(--crm-surface, #131210);
      flex-shrink: 0;
    }

    .ow-back-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-md, 8px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      cursor: pointer;
      transition: all var(--crm-transition-fast, 120ms ease);

      &:hover {
        background: var(--crm-surface-hover, rgba(255, 255, 255, 0.035));
        color: var(--crm-text-primary, #ececec);
      }
    }

    .ow-header-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .ow-title {
      margin: 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 18px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      line-height: 1.2;
    }

    .ow-subtitle {
      font-size: 12px;
      color: var(--crm-accent, #f59e0b);
      font-weight: 500;
    }

    .ow-stepper {
      flex: 1;
      background: transparent;

      ::ng-deep {
        .mat-horizontal-stepper-header-container {
          padding: 12px 20px;
          background: var(--crm-surface, #131210);
          border-bottom: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
        }

        .mat-step-header {
          padding: 0 8px;

          .mat-step-icon {
            background: var(--crm-surface-overlay, #272520);
            color: var(--crm-text-secondary, #a0a0a0);
          }

          .mat-step-icon-selected,
          .mat-step-icon-state-edit {
            background: var(--crm-accent, #f59e0b);
            color: var(--crm-on-accent, #0a0a0a);
          }

          .mat-step-label {
            color: var(--crm-text-muted, #7a7a7a);
            font-size: 12px;
          }

          .mat-step-label-active {
            color: var(--crm-text-primary, #ececec);
          }

          .mat-step-label-selected {
            color: var(--crm-accent, #f59e0b);
            font-weight: 600;
          }
        }

        .mat-horizontal-content-container {
          padding: 20px;
        }

        .mat-stepper-horizontal-line {
          border-color: var(--crm-border, rgba(255, 255, 255, 0.06));
        }
      }
    }

    .ow-simple-skip {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 24px 0;
    }

    .ow-simple-text {
      margin: 0;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 14px;
    }

    .ow-step-actions {
      display: flex;
      gap: 10px;
    }

    .ow-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      border-radius: var(--crm-radius-md, 8px);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--crm-transition-fast, 120ms ease);
      border: none;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .ow-btn--primary {
      background: var(--crm-accent, #f59e0b);
      color: var(--crm-on-accent, #0a0a0a);

      &:hover {
        background: var(--crm-accent-hover, #fbbf24);
        box-shadow: var(--crm-shadow-accent-glow, 0 0 20px rgba(245, 158, 11, 0.15));
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }

    .ow-btn--outline {
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
export class OrderWizardComponent {
  readonly store = inject(OrderWizardStore);
  private readonly router = inject(Router);
  private readonly stepper = viewChild<MatStepper>('stepper');

  onBack(): void {
    this.router.navigate(['/workspace']);
  }
}
