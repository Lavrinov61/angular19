import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PaymentMethod } from '../models/pos.models';

export interface SplitPaymentEvent {
  subscriptionAmount: number;
  remainderMethod: 'cash' | 'card' | 'sbp' | 'transfer';
}

@Component({
  selector: 'app-pos-payment-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  host: { class: 'pos-payment-bar' },
  template: `
    <div class="payment-buttons">
      @if (canPaySubscription() && !hasSplitPayment()) {
        <button mat-flat-button class="pay-btn pay-sub"
                [disabled]="disabled()"
                (click)="paymentRequested.emit('subscription')">
          <mat-icon>card_membership</mat-icon> Подписка
        </button>
      }
      @if (canPaySubscription() && hasSplitPayment()) {
        <div class="split-buttons">
          <div class="split-label">Подписка + доплата:</div>
          <div class="split-options">
            <button mat-flat-button class="pay-btn pay-split-cash"
                    [disabled]="disabled() || cashDisabled()"
                    [matTooltip]="cashDisabled() ? 'Для приёма наличных необходима фискализация. Закройте смену и откройте с включённой ФР.' : ''"
                    (click)="splitPaymentRequested.emit({ subscriptionAmount: 0, remainderMethod: 'cash' })">
              <mat-icon>payments</mat-icon> + Нал
            </button>
            <button mat-flat-button class="pay-btn pay-split-card"
                    [disabled]="disabled() || terminalDisabled()"
                    [matTooltip]="terminalDisabled() ? terminalOfflineHint : ''"
                    (click)="splitPaymentRequested.emit({ subscriptionAmount: 0, remainderMethod: 'card' })">
              <mat-icon>credit_card</mat-icon> + Карта
            </button>
            <button mat-flat-button class="pay-btn pay-split-sbp"
                    [disabled]="disabled()"
                    (click)="splitPaymentRequested.emit({ subscriptionAmount: 0, remainderMethod: 'sbp' })">
              <mat-icon>qr_code_2</mat-icon> + СБП
            </button>
            <button mat-flat-button class="pay-btn pay-split-transfer"
                    [disabled]="disabled()"
                    (click)="splitPaymentRequested.emit({ subscriptionAmount: 0, remainderMethod: 'transfer' })">
              <mat-icon>account_balance</mat-icon> + Перевод
            </button>
          </div>
        </div>
      }
      <button mat-flat-button class="pay-btn pay-cash"
              [disabled]="disabled() || cashDisabled()"
              [matTooltip]="cashDisabled() ? 'Для приёма наличных необходима фискализация. Закройте смену и откройте с включённой ФР.' : ''"
              (click)="paymentRequested.emit('cash')">
        <mat-icon>payments</mat-icon> Наличные
      </button>
      <button mat-flat-button class="pay-btn pay-card"
              [disabled]="disabled() || terminalDisabled()"
              [matTooltip]="terminalDisabled() ? terminalOfflineHint : ''"
              (click)="paymentRequested.emit('card')">
        <mat-icon>credit_card</mat-icon> Карта
      </button>
      <button mat-flat-button class="pay-btn pay-sbp"
              [disabled]="disabled()"
              (click)="paymentRequested.emit('sbp')">
        <mat-icon>qr_code_2</mat-icon> СБП
      </button>
      <button mat-flat-button class="pay-btn pay-transfer"
              [disabled]="disabled()"
              (click)="paymentRequested.emit('transfer')">
        <mat-icon>account_balance</mat-icon> Перевод
      </button>
    </div>

    @if (splitHint()) {
      <div class="split-hint">
        <mat-icon>info_outline</mat-icon>
        <span>{{ splitHint() }}</span>
      </div>
    }

    @if (processing()) {
      <mat-progress-bar mode="indeterminate" class="payment-progress" />
    }

    <button mat-button class="clear-btn" (click)="clearRequested.emit()" [disabled]="disabled()">
      <mat-icon>delete_outline</mat-icon> Очистить чек
    </button>
  `,
  styles: [`
    :host { display: block; }
    .payment-buttons {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      padding: 8px 12px;
    }
    .pay-btn {
      height: 52px;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      mat-icon { font-size: 20px; }
    }
    .pay-sub {
      background: var(--crm-status-info) !important;
      color: #fff !important;
      grid-column: 1 / -1;
    }
    .pay-cash {
      background: var(--crm-status-success) !important;
      color: #fff !important;
    }
    .pay-card {
      background: var(--mat-sys-primary) !important;
      color: var(--mat-sys-on-primary) !important;
    }
    .pay-sbp {
      background: var(--crm-accent-dim) !important;
      color: #fff !important;
    }
    .pay-transfer {
      background: #2563eb !important;
      color: #fff !important;
    }
    .split-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      padding: 4px 12px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .split-buttons {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .split-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-status-info);
      padding: 0 4px;
    }
    .split-options {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .pay-split-cash {
      background: color-mix(in srgb, var(--crm-status-info) 60%, var(--crm-status-success)) !important;
      color: #fff !important;
    }
    .pay-split-card {
      background: color-mix(in srgb, var(--crm-status-info) 60%, var(--mat-sys-primary)) !important;
      color: #fff !important;
    }
    .pay-split-sbp {
      background: color-mix(in srgb, var(--crm-status-info) 60%, var(--crm-accent-dim)) !important;
      color: #fff !important;
    }
    .pay-split-transfer {
      background: color-mix(in srgb, var(--crm-status-info) 55%, #2563eb) !important;
      color: #fff !important;
    }
    .payment-progress { margin: 0 12px; }
    .clear-btn {
      width: 100%;
      margin: 4px 0 8px;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class PosPaymentBarComponent {
  readonly canPaySubscription = input(false);
  readonly hasSplitPayment = input(false);
  readonly disabled = input(false);
  readonly cashDisabled = input(false);
  readonly processing = input(false);
  readonly splitHint = input<string | null>(null);
  /** Статус терминала по телеметрии: true/false свежий снимок, null — нет данных (не блокируем). */
  readonly terminalOnline = input<boolean | null>(null);

  /** Блокируем карту ТОЛЬКО при явном свежем false (мягкая деградация при null). */
  readonly terminalDisabled = computed(() => this.terminalOnline() === false);

  readonly terminalOfflineHint =
    'Терминал недоступен, обновление или перезагрузка, примите оплату позже или другим способом';

  readonly paymentRequested = output<PaymentMethod>();
  readonly splitPaymentRequested = output<SplitPaymentEvent>();
  readonly clearRequested = output();
}
