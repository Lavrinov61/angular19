import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OrderWizardStore } from '../order-wizard.store';
import type { PaymentMethod } from '../order-wizard.types';

@Component({
  selector: 'app-order-summary-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatProgressSpinnerModule,
  ],
  host: { class: 'order-summary-step' },
  template: `
    <div class="oss-layout">
      <!-- ═══ LEFT: Summary ═══ -->
      <div class="oss-left">
        <!-- Order summary -->
        <div class="oss-card">
          <h3 class="oss-card-title">
            <mat-icon>receipt_long</mat-icon>
            Сводка заказа
          </h3>
          <div class="oss-summary-grid">
            @if (store.selectedServiceType(); as svc) {
              <div class="oss-row">
                <span class="oss-row-label">Тип услуги</span>
                <span class="oss-row-value">{{ svc.name }}</span>
              </div>
            }
            @if (store.selectedDocumentType(); as doc) {
              <div class="oss-row">
                <span class="oss-row-label">Документ</span>
                <span class="oss-row-value">{{ doc.name }}</span>
              </div>
            }
            @if (store.selectedPhotoSize(); as size) {
              <div class="oss-row">
                <span class="oss-row-label">Размер</span>
                <span class="oss-row-value">{{ size }} мм</span>
              </div>
            }
            @if (store.selectedTier(); as tier) {
              <div class="oss-row">
                <span class="oss-row-label">Обработка</span>
                <span class="oss-row-value">{{ tier.name }}</span>
              </div>
            }
            <div class="oss-row">
              <span class="oss-row-label">Файлов</span>
              <span class="oss-row-value">{{ store.clientFiles().length }}</span>
            </div>
          </div>
        </div>

        <!-- Client info -->
        <div class="oss-card">
          <h3 class="oss-card-title">
            <mat-icon>person</mat-icon>
            Клиент
          </h3>
          <div class="oss-fields">
            <mat-form-field appearance="outline" class="oss-field">
              <mat-label>Телефон</mat-label>
              <input
                matInput
                type="tel"
                placeholder="+7 (___) ___-__-__"
                [ngModel]="store.clientPhone()"
                (ngModelChange)="store.onPhoneChange($event)"
              />
              @if (store.customerLookup(); as lookup) {
                <mat-hint>
                  @if (lookup.loyalty) {
                    {{ lookup.loyalty.levelName }} | {{ lookup.loyalty.points }} баллов
                  } @else {
                    Новый клиент
                  }
                </mat-hint>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="oss-field">
              <mat-label>Имя клиента</mat-label>
              <input
                matInput
                [ngModel]="store.clientName()"
                (ngModelChange)="store.clientName.set($event)"
              />
            </mat-form-field>
          </div>
        </div>

        <!-- Deadline & Priority -->
        <div class="oss-card">
          <h3 class="oss-card-title">
            <mat-icon>schedule</mat-icon>
            Сроки и приоритет
          </h3>
          <div class="oss-fields">
            <mat-form-field appearance="outline" class="oss-field">
              <mat-label>Срок готовности</mat-label>
              <input
                matInput
                [matDatepicker]="picker"
                [ngModel]="store.deadline()"
                (ngModelChange)="store.deadline.set($event)"
              />
              <mat-datepicker-toggle matIconSuffix [for]="picker" />
              <mat-datepicker #picker />
            </mat-form-field>

            <mat-form-field appearance="outline" class="oss-field">
              <mat-label>Приоритет</mat-label>
              <mat-select
                [value]="store.priority()"
                (selectionChange)="store.priority.set($event.value)"
              >
                <mat-option value="normal">Обычный</mat-option>
                <mat-option value="urgent">Срочный</mat-option>
                <mat-option value="vip">VIP</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
        </div>

        <!-- Assignment -->
        <div class="oss-card">
          <h3 class="oss-card-title">
            <mat-icon>assignment_ind</mat-icon>
            Назначение
          </h3>
          <mat-form-field appearance="outline" class="oss-field-full">
            <mat-label>Ответственный сотрудник</mat-label>
            <mat-select
              [value]="store.assignedEmployeeId()"
              (selectionChange)="store.assignedEmployeeId.set($event.value)"
            >
              <mat-option [value]="null">Не назначен</mat-option>
              @for (emp of store.employees(); track emp.id) {
                <mat-option [value]="emp.id">{{ emp.display_name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <!-- Comment -->
        <div class="oss-card">
          <h3 class="oss-card-title">
            <mat-icon>comment</mat-icon>
            Комментарий
          </h3>
          <textarea
            class="oss-textarea"
            placeholder="Внутренний комментарий к заказу..."
            [value]="store.comment()"
            (input)="store.comment.set(asText($event))"
            rows="2"
          ></textarea>
        </div>
      </div>

      <!-- ═══ RIGHT: Payment ═══ -->
      <div class="oss-right">
        <!-- Reminders -->
        @if (store.reminders().length > 0) {
          <div class="oss-reminders">
            <mat-icon>notifications_active</mat-icon>
            <div class="oss-reminders-list">
              @for (r of store.reminders(); track r) {
                <p class="oss-reminder-text">{{ r }}</p>
              }
            </div>
          </div>
        }

        <!-- Total -->
        <div class="oss-total-card">
          <div class="oss-total-breakdown">
            @if (store.selectedTier(); as tier) {
              <div class="oss-total-line">
                <span>{{ tier.name }}</span>
                <span class="oss-total-amount">{{ tier.price }} ₽</span>
              </div>
            }
            @if (store.supportTeam()) {
              <div class="oss-total-line">
                <span>Поддержать команду</span>
                <span class="oss-total-amount">39 ₽</span>
              </div>
            }
          </div>
          <div class="oss-total-divider"></div>
          <div class="oss-total-grand">
            <span>Итого</span>
            <span class="oss-total-grand-amount">{{ store.grandTotal() }} ₽</span>
          </div>
        </div>

        <!-- Support team -->
        <mat-checkbox
          [checked]="store.supportTeam()"
          (change)="store.supportTeam.set($event.checked)"
          class="oss-support-check"
        >
          Поддержать команду +39 ₽
        </mat-checkbox>

        <!-- Payment buttons -->
        <div class="oss-pay-buttons">
          <button
            class="oss-pay-btn oss-pay-btn--cash"
            [disabled]="!store.canSubmit() || store.submitting()"
            (click)="pay('cash')"
          >
            <mat-icon>payments</mat-icon>
            Наличные
          </button>
          <button
            class="oss-pay-btn oss-pay-btn--card"
            [disabled]="!store.canSubmit() || store.submitting()"
            (click)="pay('card')"
          >
            <mat-icon>credit_card</mat-icon>
            Карта
          </button>
          <button
            class="oss-pay-btn oss-pay-btn--sbp"
            [disabled]="!store.canSubmit() || store.submitting()"
            (click)="pay('sbp')"
          >
            <mat-icon>qr_code_2</mat-icon>
            СБП
          </button>
          <button
            class="oss-pay-btn oss-pay-btn--online"
            [disabled]="!store.canSubmit() || store.submitting()"
            (click)="pay('online')"
          >
            <mat-icon>language</mat-icon>
            Онлайн
          </button>
          <button
            class="oss-pay-btn oss-pay-btn--later"
            [disabled]="!store.canSubmit() || store.submitting()"
            (click)="pay('later')"
          >
            <mat-icon>schedule</mat-icon>
            Позже
          </button>
        </div>

        @if (store.submitting()) {
          <div class="oss-submitting">
            <mat-spinner diameter="20" />
            <span>Создание заказа...</span>
          </div>
        }

        <!-- Back -->
        <button class="oss-back-btn" (click)="store.prevStep()">
          <mat-icon>arrow_back</mat-icon> Назад
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .oss-layout {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 20px;
      align-items: start;

      @media (max-width: 840px) {
        grid-template-columns: 1fr;
      }
    }

    .oss-left {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .oss-right {
      display: flex;
      flex-direction: column;
      gap: 14px;
      position: sticky;
      top: 20px;
    }

    .oss-card {
      padding: 16px;
      background: var(--crm-surface-raised, #1b1a17);
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-lg, 12px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .oss-card-title {
      margin: 0;
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
        color: var(--crm-accent, #f59e0b);
      }
    }

    .oss-summary-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .oss-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .oss-row-label {
      font-size: 12px;
      color: var(--crm-text-muted, #7a7a7a);
    }

    .oss-row-value {
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary, #ececec);
    }

    .oss-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;

      @media (max-width: 540px) {
        grid-template-columns: 1fr;
      }
    }

    .oss-field, .oss-field-full {
      width: 100%;
    }

    .oss-textarea {
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

    /* ── Right column ── */

    .oss-reminders {
      display: flex;
      gap: 10px;
      padding: 12px 14px;
      background: rgba(251, 191, 36, 0.06);
      border: 1px solid rgba(251, 191, 36, 0.2);
      border-radius: var(--crm-radius-md, 8px);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-status-warning, #fbbf24);
        flex-shrink: 0;
        margin-top: 2px;
      }
    }

    .oss-reminders-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .oss-reminder-text {
      margin: 0;
      font-size: 11px;
      color: var(--crm-status-warning, #fbbf24);
      line-height: 1.4;
    }

    .oss-total-card {
      padding: 16px;
      background: var(--crm-surface-raised, #1b1a17);
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-lg, 12px);
    }

    .oss-total-breakdown {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .oss-total-line {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    .oss-total-amount {
      font-family: var(--crm-font-mono, monospace);
      font-weight: 600;
    }

    .oss-total-divider {
      height: 1px;
      background: var(--crm-border, rgba(255, 255, 255, 0.06));
      margin: 10px 0;
    }

    .oss-total-grand {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      font-weight: 700;
      color: var(--crm-text-primary, #ececec);
    }

    .oss-total-grand-amount {
      font-size: 22px;
      font-weight: 800;
      color: var(--crm-accent, #f59e0b);
      font-family: var(--crm-font-mono, monospace);
    }

    .oss-support-check {
      font-size: 13px;
    }

    .oss-pay-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .oss-pay-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 12px 8px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-md, 8px);
      background: var(--crm-surface-raised, #1b1a17);
      color: var(--crm-text-primary, #ececec);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--crm-transition-fast, 120ms ease);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover:not(:disabled) {
        background: var(--crm-surface-overlay, #272520);
        border-color: var(--crm-accent, #f59e0b);
      }

      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      &--cash mat-icon { color: #34d399; }
      &--card mat-icon { color: #60a5fa; }
      &--sbp mat-icon { color: #c084fc; }
      &--online mat-icon { color: #f59e0b; }
      &--later {
        grid-column: 1 / -1;
        mat-icon { color: var(--crm-text-muted, #7a7a7a); }
      }
    }

    .oss-submitting {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 10px;
      font-size: 13px;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    .oss-back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      background: transparent;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-md, 8px);
      color: var(--crm-text-secondary, #a0a0a0);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--crm-transition-fast, 120ms ease);
      align-self: flex-start;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover {
        background: var(--crm-surface-hover, rgba(255, 255, 255, 0.035));
        color: var(--crm-text-primary, #ececec);
      }
    }
  `],
})
export class OrderSummaryStepComponent {
  readonly store = inject(OrderWizardStore);

  pay(method: PaymentMethod): void {
    this.store.submitPayment(method);
  }

  asText(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }
}
