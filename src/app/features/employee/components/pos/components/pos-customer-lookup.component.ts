import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PosService } from '../../../services/pos.service';
import { PosCustomerService } from '../../../services/pos-customer.service';

@Component({
  selector: 'app-pos-customer-lookup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatFormFieldModule, MatInputModule,
    MatIconModule, MatProgressSpinnerModule,
  ],
  host: { class: 'pos-customer-lookup' },
  template: `
    <mat-form-field appearance="outline" class="full-width customer-field">
      <mat-icon matPrefix>person_search</mat-icon>
      <input matInput [ngModel]="customerService.customerPhone()"
             (ngModelChange)="customerService.customerPhone.set($event)"
             placeholder="Телефон клиента" type="tel">
      @if (customerService.customerLoading()) {
        <mat-spinner matSuffix diameter="20" />
      }
    </mat-form-field>

    @if (posService.customer(); as customer) {
      <div class="customer-info">
        @if (customer.name) {
          <span class="customer-name">{{ customer.name }}</span>
        }
        @if (customer.loyalty) {
          <div class="loyalty-badge">
            <mat-icon>emoji_events</mat-icon>
            <span>{{ customer.loyalty.points }} бонусов</span>
            <span class="loyalty-level">Ур. {{ customer.loyalty.level }}</span>
          </div>
        }
        @if (customer.subscription) {
          <div class="sub-badge-line">
            <mat-icon>card_membership</mat-icon>
            <span>{{ customer.subscription.plan_name }}</span>
          </div>
          @for (credit of customer.subscription.credits; track credit.product_name) {
            <div class="credit-line">
              {{ credit.product_name }}: <strong>{{ credit.remaining }}</strong> ост.
            </div>
          }
        }
        @if (customer.studentDiscount; as student) {
          <div class="student-badge-line" [class.student-active]="student.status === 'active'">
            <mat-icon>school</mat-icon>
            <span>{{ studentStatusLabel(student.status) }}{{ studentTierSuffix(student.source_token) }}</span>
            <span class="student-expiry">до {{ formatStudentDate(student.expires_at) }}</span>
          </div>
          @if (student.status === 'active') {
            <div class="student-limits">
              <span>Печать: <strong>{{ student.print_sheets_remaining }}</strong></span>
              <span>Переплёт: <strong>{{ student.binding_remaining }}</strong></span>
            </div>
          }
        }
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      padding: 8px 12px 0;
    }
    .full-width { width: 100%; }
    .customer-field {
      :host ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    }
    .customer-info {
      padding: 0 4px 8px;
      font-size: 13px;
    }
    .customer-name {
      font-weight: 600;
      display: block;
      margin-bottom: 4px;
    }
    .loyalty-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--crm-status-warning);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .loyalty-level {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }
    .sub-badge-line {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-tertiary);
      margin-top: 4px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .credit-line {
      padding-left: 20px;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .student-badge-line {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      color: var(--mat-sys-on-surface-variant);
      font-weight: 600;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .student-active { color: var(--crm-status-success); }
    .student-expiry {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      font-weight: 400;
    }
    .student-limits {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding-left: 20px;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class PosCustomerLookupComponent {
  readonly posService = inject(PosService);
  readonly customerService = inject(PosCustomerService);

  studentStatusLabel(status: string): string {
    switch (status) {
      case 'active':
        return 'Студенческая скидка активна';
      case 'expired':
        return 'Студенческая скидка истекла';
      case 'revoked':
        return 'Студенческая скидка отключена';
      default:
        return 'Студенческая скидка';
    }
  }

  studentTierSuffix(sourceToken: string): string {
    if (sourceToken === 'education_subscription') return ' (с подпиской)';
    if (sourceToken === 'education_verified') return ' (без подписки)';
    return '';
  }

  formatStudentDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }
}
