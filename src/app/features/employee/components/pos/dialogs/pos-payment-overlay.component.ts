import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnDestroy,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { PosCashTenderedComponent } from './pos-cash-tendered.component';
import { PosCardProgressComponent, CardPaymentStatus } from './pos-card-progress.component';
import {
  PosApiService, PosReceipt, PosReceiptPayment, PosReceiptItem, PosPaymentSnapshot,
} from '../../../services/pos-api.service';
import { PaymentMethod } from '../models/pos.models';
import { PosKeyboardService, PosShortcut } from '../../../services/pos-keyboard.service';
import { CartItem } from '../../../services/pos.service';
import {
  IN_DOUBT_PAYMENT_MESSAGE,
  isInDoubtPaymentError,
  startAndWaitForBridgePayment,
} from '../../../utils/pos-bridge-payment.util';
import {
  DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS,
  approvedCardFiscalRetryMessage,
  receiptFiscalInitialStatus,
  waitForReceiptFiscalization,
} from '../../../utils/pos-receipt-fiscalization.util';
import { employeeApiErrorMessage } from '../../../utils/api-error-message';
import { firstValueFrom, type Subscription } from 'rxjs';
import { receiptPaymentsRequireFiscal } from '../utils/pos-fiscal-feedback.util';

type OverlayStep = 'select-method' | 'process-payment' | 'result';
type OverlayResultState = 'success' | 'fiscal-pending';
type CreateReceiptPayload = Parameters<PosApiService['createReceipt']>[0];

interface SplitPayment {
  method: PosReceiptPayment['payment_type'];
  amount: number;
}

interface CardApprovedPaymentContext {
  readonly runId: number;
  readonly transactionId: string;
}

interface PendingCardFiscalPayment extends CardApprovedPaymentContext {
  readonly receipt: PosReceipt;
}

export interface PosPaymentOverlayData {
  total: number;
  method: PaymentMethod | null;
  items: CartItem[];
  customerPhone?: string;
  customerName?: string;
  loyaltyProfileId?: string;
  subscriptionId?: string;
  shiftId: string;
  employeeId: string;
  studioId: string;
  canPaySubscription: boolean;
  subscriptionSavings: number;
  remainderAfterSubscription: number;
  subscriptionCoverage: { productId: string; savedAmount: number }[];
  receiptItems: PosReceiptItem[];
}

export interface PosPaymentOverlayResult {
  success: boolean;
  receipt?: {
    id: string;
    receipt_number: string;
    total: number;
    items?: { product_name: string; quantity: number; unit_price: number; total: number }[];
  };
}

@Component({
  selector: 'app-pos-payment-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatSelectModule, FormsModule, DecimalPipe,
    PosCashTenderedComponent, PosCardProgressComponent,
  ],
  template: `
    @switch (step()) {
      @case ('select-method') {
        <h2 mat-dialog-title>Способ оплаты</h2>
        <mat-dialog-content>
          <div class="amount-display">{{ data.total | number:'1.0-0' }} ₽</div>
          <div class="methods-grid">
            <button mat-flat-button class="method-btn" (click)="selectMethod('cash')">
              <mat-icon>payments</mat-icon>
              <span class="method-label">Наличные</span>
              <span class="method-hint">F1</span>
            </button>
            <button mat-flat-button class="method-btn" (click)="selectMethod('card')">
              <mat-icon>credit_card</mat-icon>
              <span class="method-label">Карта</span>
              <span class="method-hint">F2</span>
            </button>
            <button mat-flat-button class="method-btn" (click)="selectMethod('sbp')">
              <mat-icon>qr_code_2</mat-icon>
              <span class="method-label">СБП</span>
              <span class="method-hint">F3</span>
            </button>
            <button mat-flat-button class="method-btn" (click)="selectMethod('transfer')">
              <mat-icon>account_balance</mat-icon>
              <span class="method-label">Перевод</span>
            </button>
            @if (data.canPaySubscription) {
              <button mat-flat-button class="method-btn" (click)="selectMethod('subscription')">
                <mat-icon>card_membership</mat-icon>
                <span class="method-label">Подписка</span>
                <span class="method-hint">F4</span>
              </button>
            }
            <button mat-stroked-button class="method-btn split-btn" (click)="enableSplitMode()">
              <mat-icon>call_split</mat-icon>
              <span class="method-label">Разделить оплату</span>
            </button>
          </div>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button (click)="close()">Отмена</button>
        </mat-dialog-actions>
      }

      @case ('process-payment') {
        <h2 mat-dialog-title>
          @if (splitMode()) {
            Разделённая оплата
          } @else {
            {{ methodLabel() }}
          }
        </h2>
        <mat-dialog-content>
          @if (splitMode()) {
            <div class="split-payment">
              @for (payment of splitPayments(); track $index) {
                <div class="split-row">
                  <mat-select [(value)]="payment.method" class="split-method">
                    <mat-option value="cash">Наличные</mat-option>
                    <mat-option value="card">Карта</mat-option>
                    <mat-option value="sbp">СБП</mat-option>
                  </mat-select>
                  <input type="number" class="split-amount" [(ngModel)]="payment.amount"
                         min="0" [max]="data.total" step="10" />
                  <span class="split-currency">₽</span>
                  @if (splitPayments().length > 2) {
                    <button mat-icon-button (click)="removeSplitMethod($index)" class="split-remove">
                      <mat-icon>close</mat-icon>
                    </button>
                  }
                </div>
              }
              <div class="split-remainder" [class.negative]="splitRemainder() !== 0">
                Остаток: {{ splitRemainder() | number:'1.0-0' }} ₽
              </div>
              <div class="split-actions">
                <button mat-stroked-button (click)="addSplitMethod()" [disabled]="splitPayments().length >= 4">
                  <mat-icon>add</mat-icon> Добавить
                </button>
                <button mat-flat-button (click)="processSplitPayment()"
                        [disabled]="splitRemainder() !== 0 || processing()">
                  @if (processing()) {
                    <mat-spinner diameter="20" />
                  } @else {
                    Оплатить
                  }
                </button>
              </div>
            </div>
          } @else {
            @switch (selectedMethod()) {
              @case ('cash') {
                <app-pos-cash-tendered [total]="data.total" (confirmed)="onCashConfirmed($event)" />
              }
              @case ('card') {
                <app-pos-card-progress
                  [amount]="data.total"
                  [status]="cardStatus()"
                  [errorMessage]="errorMessage()"
                  (cancelRequested)="cancelCardPayment()"
                  (retryRequested)="retryCardPayment()"
                  (acknowledgeRequested)="acknowledgeInDoubtPayment()"
                  (closeRequested)="acknowledgeInDoubtPayment()" />
              }
              @case ('sbp') {
                <div class="sbp-confirm">
                  <div class="amount-display">{{ data.total | number:'1.0-0' }} ₽</div>
                  <p class="sbp-text">Подтвердите получение оплаты по СБП</p>
                  <button mat-flat-button class="confirm-btn" (click)="confirmSbpPayment()"
                          [disabled]="processing()">
                    @if (processing()) {
                      <mat-spinner diameter="20" />
                    } @else {
                      <mat-icon>check</mat-icon>
                      Подтвердить
                    }
                  </button>
                </div>
              }
              @case ('transfer') {
                <div class="transfer-confirm">
                  <div class="amount-display">{{ data.total | number:'1.0-0' }} ₽</div>
                  <p class="sbp-text">Подтвердите, что перевод поступил. Чек будет создан без фискализации.</p>
                  <button mat-flat-button class="confirm-btn" (click)="confirmTransferPayment()"
                          [disabled]="processing()">
                    @if (processing()) {
                      <mat-spinner diameter="20" />
                    } @else {
                      <mat-icon>check</mat-icon>
                      Перевод получен
                    }
                  </button>
                </div>
              }
              @case ('subscription') {
                <div class="subscription-confirm">
                  <div class="amount-display">{{ data.total | number:'1.0-0' }} ₽</div>
                  @if (data.subscriptionSavings > 0) {
                    <p class="sub-savings">Покрыто подпиской: {{ data.subscriptionSavings | number:'1.0-0' }} ₽</p>
                    @if (data.remainderAfterSubscription > 0) {
                      <p class="sub-remainder">Доплата наличными: {{ data.remainderAfterSubscription | number:'1.0-0' }} ₽</p>
                    }
                  }
                  <button mat-flat-button class="confirm-btn" (click)="confirmSubscriptionPayment()"
                          [disabled]="processing()">
                    @if (processing()) {
                      <mat-spinner diameter="20" />
                    } @else {
                      <mat-icon>check</mat-icon>
                      Подтвердить
                    }
                  </button>
                </div>
              }
            }
          }
        </mat-dialog-content>
        @if (!splitMode()) {
          <mat-dialog-actions align="end">
            <button mat-button (click)="goBack()" [disabled]="processing()">Назад</button>
          </mat-dialog-actions>
        }
      }

      @case ('result') {
        <mat-dialog-content>
          @if (errorMessage()) {
            <div class="result-error">
              <mat-icon class="result-icon">error</mat-icon>
              <p>{{ errorMessage() }}</p>
              <button mat-flat-button (click)="retry()">Попробовать ещё раз</button>
            </div>
          } @else {
            <div class="result-success" [class.result-pending]="resultState() === 'fiscal-pending'">
              <mat-icon class="result-icon check-appear">
                {{ resultState() === 'fiscal-pending' ? 'hourglass_top' : 'check_circle' }}
              </mat-icon>
              <p>{{ resultState() === 'fiscal-pending' ? 'Ожидаем фискализацию на ККТ' : 'Чек создан' }}</p>
            </div>
          }
        </mat-dialog-content>
      }
    }
  `,
  styles: [`
    .amount-display {
      text-align: center;
      font-size: 48px;
      font-weight: 700;
      color: var(--mat-sys-primary);
      padding: 16px 0;
    }

    .methods-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .method-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 80px;
      gap: 4px;
      position: relative;
    }

    .method-label {
      font-size: 14px;
      font-weight: 500;
    }

    .method-hint {
      font-size: 11px;
      opacity: 0.6;
    }

    .split-btn {
      grid-column: 1 / -1;
      height: 48px;
      flex-direction: row;
      gap: 8px;
    }

    /* Split payment */
    .split-payment {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 8px 0;
    }

    .split-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .split-method {
      flex: 1;
    }

    .split-amount {
      width: 120px;
      font-size: 18px;
      text-align: right;
      padding: 8px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      outline: none;
      &:focus { border-color: var(--mat-sys-primary); }
      &::-webkit-outer-spin-button,
      &::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      -moz-appearance: textfield;
    }

    .split-currency {
      font-size: 16px;
      color: var(--mat-sys-on-surface-variant);
    }

    .split-remove {
      flex-shrink: 0;
    }

    .split-remainder {
      text-align: center;
      font-size: 16px;
      font-weight: 500;
      color: var(--mat-sys-on-surface-variant);
      padding: 8px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      &.negative { color: var(--mat-sys-error); }
    }

    .split-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      button { min-height: 48px; }
    }

    /* SBP / Transfer / Subscription confirm */
    .sbp-confirm, .transfer-confirm, .subscription-confirm {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 16px 0;
    }

    .sbp-text {
      font-size: 16px;
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .sub-savings {
      font-size: 16px;
      color: var(--mat-sys-primary);
      margin: 0;
      font-weight: 500;
    }

    .sub-remainder {
      font-size: 14px;
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .confirm-btn {
      min-height: 56px;
      min-width: 200px;
      font-size: 18px;
    }

    /* Results */
    .result-success, .result-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 32px;
      text-align: center;
      p { font-size: 20px; font-weight: 500; margin: 0; }
    }

    .result-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
    }

    .result-success .result-icon { color: var(--mat-sys-primary); }
    .result-success.result-pending .result-icon { color: var(--mat-sys-tertiary); }
    .result-error .result-icon { color: var(--mat-sys-error); }

    .check-appear {
      animation: check-appear 0.4s ease-out;
    }

    @keyframes check-appear {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }
  `],
})
export class PosPaymentOverlayComponent implements OnDestroy {
  readonly data = inject<PosPaymentOverlayData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PosPaymentOverlayComponent, PosPaymentOverlayResult>);
  private readonly posApi = inject(PosApiService);
  private readonly keyboard = inject(PosKeyboardService);

  readonly step = signal<OverlayStep>(this.data.method ? 'process-payment' : 'select-method');
  readonly selectedMethod = signal<PaymentMethod | null>(this.data.method);
  readonly processing = signal(false);
  readonly cardStatus = signal<CardPaymentStatus>('waiting');
  readonly errorMessage = signal<string | null>(null);
  readonly resultState = signal<OverlayResultState>('success');
  readonly splitMode = signal(false);
  readonly splitPayments = signal<SplitPayment[]>([]);

  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private cardStartTimer: ReturnType<typeof setTimeout> | null = null;
  private cardPaymentRunId = 0;
  private pendingCardFiscalPayment: PendingCardFiscalPayment | null = null;
  private readonly keyboardSub: Subscription;

  readonly methodLabel = computed(() => {
    switch (this.selectedMethod()) {
      case 'cash': return 'Наличные';
      case 'card': return 'Карта';
      case 'sbp': return 'СБП';
      case 'transfer': return 'Перевод';
      case 'subscription': return 'Подписка';
      default: return 'Оплата';
    }
  });

  readonly splitRemainder = computed(() => {
    const total = this.data.total;
    const paid = this.splitPayments().reduce((sum, p) => sum + (p.amount || 0), 0);
    return Math.round((total - paid) * 100) / 100;
  });

  constructor() {
    // If method is pre-selected and it's card, start bridge immediately
    if (this.data.method === 'card') {
      this.startCardPayment();
    }

    this.keyboardSub = this.keyboard.shortcuts$.subscribe(s => this.handleShortcut(s));
  }

  ngOnDestroy(): void {
    if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
    this.cancelCardWait();
    this.keyboardSub.unsubscribe();
  }

  selectMethod(method: PaymentMethod): void {
    this.selectedMethod.set(method);
    this.step.set('process-payment');

    if (method === 'card') {
      this.startCardPayment();
    }
  }

  enableSplitMode(): void {
    this.splitMode.set(true);
    this.splitPayments.set([
      { method: 'cash', amount: 0 },
      { method: 'card', amount: 0 },
    ]);
    this.step.set('process-payment');
  }

  addSplitMethod(): void {
    const current = this.splitPayments();
    if (current.length >= 4) return;
    this.splitPayments.set([...current, { method: 'cash', amount: 0 }]);
  }

  removeSplitMethod(index: number): void {
    const current = this.splitPayments();
    if (current.length <= 2) return;
    this.splitPayments.set(current.filter((_, i) => i !== index));
  }

  onCashConfirmed(_tendered: number): void {
    this.processing.set(true);
    const payments: PosReceiptPayment[] = [
      { payment_type: 'cash', amount: this.data.total },
    ];
    this.createReceipt(payments);
  }

  confirmSbpPayment(): void {
    this.processing.set(true);
    const payments: PosReceiptPayment[] = [
      { payment_type: 'sbp', amount: this.data.total },
    ];
    this.createReceipt(payments);
  }

  confirmTransferPayment(): void {
    this.processing.set(true);
    const payments: PosReceiptPayment[] = [
      { payment_type: 'transfer', amount: this.data.total },
    ];
    this.createReceipt(payments);
  }

  confirmSubscriptionPayment(): void {
    this.processing.set(true);
    const payments: PosReceiptPayment[] = [];

    if (this.data.subscriptionSavings > 0) {
      payments.push({ payment_type: 'subscription', amount: this.data.subscriptionSavings });
      if (this.data.remainderAfterSubscription > 0) {
        payments.push({ payment_type: 'cash', amount: this.data.remainderAfterSubscription });
      }
    } else {
      payments.push({ payment_type: 'subscription', amount: this.data.total });
    }

    this.createReceipt(payments);
  }

  cancelCardPayment(): void {
    if (this.pendingCardFiscalPayment || this.cardStatus() === 'fiscal_error') {
      this.errorMessage.set(
        'Банк уже одобрил оплату. Вставьте бумагу и нажмите «Повторить чек»; оплату повторно не запускайте.',
      );
      return;
    }

    this.cancelCardWait();
    this.processing.set(false);
    this.cardStatus.set('cancelled');
    this.goBack();
  }

  retryCardPayment(): void {
    const pendingFiscal = this.pendingCardFiscalPayment;
    if (this.cardStatus() === 'fiscal_error' && pendingFiscal) {
      this.retryPendingCardFiscalization(pendingFiscal);
      return;
    }

    if (this.cardStatus() === 'fiscal_error') {
      this.errorMessage.set(
        'Банк уже одобрил оплату. Не запускайте оплату повторно; откройте журнал чеков и повторите фискализацию.',
      );
      return;
    }

    // Защита от двойного списания: при неизвестном статусе оплаты повторный
    // запуск запрещён, даже если кнопка «Повторить» сюда как-то дотянется.
    if (this.cardStatus() === 'in_doubt') {
      this.errorMessage.set(
        'Банк мог одобрить оплату, повторно её не запускайте. Разберите оплату через журнал чеков.',
      );
      return;
    }

    this.startCardPayment();
  }

  processSplitPayment(): void {
    if (this.splitRemainder() !== 0) return;
    this.processing.set(true);

    const payments: PosReceiptPayment[] = this.splitPayments()
      .filter(p => p.amount > 0)
      .map(p => ({ payment_type: p.method, amount: p.amount }));

    this.createReceipt(payments);
  }

  goBack(): void {
    if (this.processing()) return;
    if (this.pendingCardFiscalPayment || this.cardStatus() === 'fiscal_error') {
      this.errorMessage.set(
        'Сначала повторите фискализацию чека. Банк уже одобрил оплату, повторная оплата запрещена без сверки терминала.',
      );
      return;
    }

    this.cancelCardWait();
    this.selectedMethod.set(null);
    this.splitMode.set(false);
    this.step.set('select-method');
    this.cardStatus.set('waiting');
  }

  retry(): void {
    this.errorMessage.set(null);
    this.step.set(this.selectedMethod() ? 'process-payment' : 'select-method');

    if (this.selectedMethod() === 'card') {
      this.startCardPayment();
    }
  }

  close(): void {
    this.dialogRef.close({ success: false });
  }

  private handleShortcut(shortcut: PosShortcut): void {
    if (this.step() === 'select-method') {
      switch (shortcut) {
        case 'pay_cash': this.selectMethod('cash'); break;
        case 'pay_card': this.selectMethod('card'); break;
        case 'pay_sbp': this.selectMethod('sbp'); break;
        case 'pay_subscription':
          if (this.data.canPaySubscription) this.selectMethod('subscription');
          break;
        case 'cancel': this.close(); break;
      }
    } else if (this.step() === 'process-payment') {
      if (shortcut === 'cancel') {
        if (this.selectedMethod() === 'card') {
          this.cancelCardPayment();
        } else {
          this.goBack();
        }
      }
    }
  }

  private startCardPayment(): void {
    const runId = this.nextCardPaymentRun();
    this.pendingCardFiscalPayment = null;
    this.processing.set(true);
    this.cardStatus.set('waiting');
    this.errorMessage.set(null);
    const orderId = `POS-${Date.now()}`;

    this.cardStartTimer = setTimeout(() => {
      if (runId !== this.cardPaymentRunId) return;
      this.cardStatus.set('processing');
      void this.runCardPayment(orderId, runId);
    }, 500);
  }

  private async runCardPayment(orderId: string, runId: number): Promise<void> {
    try {
      const result = await startAndWaitForBridgePayment(this.posApi, {
        amount: this.data.total,
        orderId,
        studioId: this.data.studioId,
        snapshot: this.buildPaymentSnapshot(),
      });
      if (runId !== this.cardPaymentRunId) return;

      this.cardStatus.set('fiscalizing');
      this.errorMessage.set(null);
      const payments: PosReceiptPayment[] = [{
        payment_type: 'card',
        amount: this.data.total,
        transaction_id: result.transactionId,
        card_info: result.cardInfo,
      }];
      void this.createCardReceiptAndWaitFiscalization(payments, {
        runId,
        transactionId: result.transactionId,
      });
    } catch (error) {
      if (runId !== this.cardPaymentRunId) return;
      this.processing.set(false);
      // Таймаут/обрыв связи (op1 без определённого ответа): результат неизвестен,
      // деньги могли списаться. Не показываем «оплата не прошла» и не предлагаем повтор.
      if (isInDoubtPaymentError(error)) {
        this.cardStatus.set('in_doubt');
        this.errorMessage.set(employeeApiErrorMessage(error, IN_DOUBT_PAYMENT_MESSAGE));
        return;
      }
      this.cardStatus.set('error');
      this.errorMessage.set(employeeApiErrorMessage(error, 'Оплата по карте не прошла'));
    }
  }

  /** «Проверить позже»/«Закрыть» при неизвестном статусе оплаты: закрываем диалог без повтора. */
  acknowledgeInDoubtPayment(): void {
    this.cancelCardWait();
    this.processing.set(false);
    this.dialogRef.close({ success: false });
  }

  private nextCardPaymentRun(): number {
    this.cancelCardWait();
    this.cardPaymentRunId += 1;
    return this.cardPaymentRunId;
  }

  private cancelCardWait(): void {
    this.cardPaymentRunId += 1;
    if (this.cardStartTimer) {
      clearTimeout(this.cardStartTimer);
      this.cardStartTimer = null;
    }
  }

  private receiptRequiresFiscal(payments: readonly PosReceiptPayment[]): boolean {
    return receiptPaymentsRequireFiscal(payments);
  }

  /**
   * Снимок корзины для оплаты картой: если оплата зависнет (in_doubt), backend
   * сохранит его и позволит допробить чек без потери позиций. subtotal/total
   * считаются как в buildReceiptPayload, чтобы createReceipt на стороне resolve
   * принял payload без доращивания.
   */
  private buildPaymentSnapshot(): PosPaymentSnapshot {
    const items = this.data.receiptItems;
    return {
      items,
      subtotal: items.reduce((s, i) => s + i.unit_price * i.quantity, 0),
      discount_total: items.reduce((s, i) => s + i.discount_amount, 0),
      total: this.data.total,
      shiftId: this.data.shiftId,
      customerPhone: this.data.customerPhone,
      customerName: this.data.customerName,
      loyaltyProfileId: this.data.loyaltyProfileId,
    };
  }

  private buildReceiptPayload(payments: PosReceiptPayment[]): CreateReceiptPayload {
    const isSubscription = payments.some(p => p.payment_type === 'subscription');
    const items = this.data.receiptItems.map(item => {
      if (isSubscription && this.data.subscriptionCoverage.length > 0) {
        const cov = this.data.subscriptionCoverage.find(c => c.productId === item.product_id);
        if (cov) {
          return { ...item, subscription_credits_used: cov.savedAmount };
        }
      }
      return item;
    });

    return {
      shift_id: this.data.shiftId,
      employee_id: this.data.employeeId,
      studio_id: this.data.studioId,
      customer_phone: this.data.customerPhone,
      customer_name: this.data.customerName,
      loyalty_profile_id: this.data.loyaltyProfileId,
      subscription_id: this.data.subscriptionId,
      items,
      payments,
      subtotal: items.reduce((s, i) => s + i.unit_price * i.quantity, 0),
      discount_total: items.reduce((s, i) => s + i.discount_amount, 0),
      points_discount: items.reduce((s, i) => s + i.points_used, 0),
      subscription_credit_used: isSubscription
        ? this.data.subscriptionSavings
        : 0,
      total: this.data.total,
      fiscal_required: this.receiptRequiresFiscal(payments),
    };
  }

  private createReceipt(payments: PosReceiptPayment[]): void {
    this.posApi.createReceipt(this.buildReceiptPayload(payments)).subscribe({
      next: (receipt) => {
        this.processing.set(false);
        this.errorMessage.set(null);
        this.resultState.set(this.receiptRequiresFiscal(payments) ? 'fiscal-pending' : 'success');
        this.step.set('result');

        // Auto-close after 1.5 seconds
        this.autoCloseTimer = setTimeout(() => {
          this.dialogRef.close({
            success: true,
            receipt: {
              id: receipt.id,
              receipt_number: receipt.receipt_number,
              total: receipt.total,
              items: receipt.items.map(i => ({
                product_name: i.product_name,
                quantity: i.quantity,
                unit_price: i.unit_price,
                total: i.total,
              })),
            },
          });
        }, 1500);
      },
      error: (err: unknown) => {
        this.processing.set(false);
        this.errorMessage.set(employeeApiErrorMessage(err, 'Не удалось создать чек'));
        this.step.set('result');
      },
    });
  }

  private async createCardReceiptAndWaitFiscalization(
    payments: PosReceiptPayment[],
    context: CardApprovedPaymentContext,
  ): Promise<void> {
    let pendingFiscal: PendingCardFiscalPayment | null = null;

    try {
      const receipt = await firstValueFrom(this.posApi.createReceipt(this.buildReceiptPayload(payments)));
      if (!this.isActiveCardPaymentRun(context.runId)) return;

      if (!this.receiptRequiresFiscal(payments)) {
        this.completeCardPaymentWithReceipt(receipt);
        return;
      }

      pendingFiscal = { ...context, receipt };
      this.pendingCardFiscalPayment = pendingFiscal;

      await waitForReceiptFiscalization(this.posApi, receipt.id, {
        timeoutMs: DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS,
        initialStatus: receiptFiscalInitialStatus(receipt),
      });
      if (!this.isActiveCardPaymentRun(context.runId)) return;
      this.completeCardPaymentWithReceipt(receipt);
    } catch (error) {
      if (!this.isActiveCardPaymentRun(context.runId)) return;
      this.failApprovedCardFiscalization(
        employeeApiErrorMessage(error, 'Чек не фискализирован'),
        pendingFiscal,
      );
    }
  }

  private retryPendingCardFiscalization(context: PendingCardFiscalPayment): void {
    if (!this.isActiveCardPaymentRun(context.runId)) return;

    this.processing.set(true);
    this.cardStatus.set('fiscalizing');
    this.errorMessage.set(null);
    this.posApi.retryFiscal(context.receipt.id).subscribe({
      next: () => {
        void this.waitForPendingCardFiscalization(context, false);
      },
      error: () => {
        void this.waitForPendingCardFiscalization(context, false);
      },
    });
  }

  private async waitForPendingCardFiscalization(
    context: PendingCardFiscalPayment,
    useInitialStatus: boolean,
  ): Promise<void> {
    try {
      await waitForReceiptFiscalization(this.posApi, context.receipt.id, {
        timeoutMs: DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS,
        initialStatus: useInitialStatus ? receiptFiscalInitialStatus(context.receipt) : null,
      });
      if (!this.isActiveCardPaymentRun(context.runId)) return;
      this.completeCardPaymentWithReceipt(context.receipt);
    } catch (error) {
      if (!this.isActiveCardPaymentRun(context.runId)) return;
      this.failApprovedCardFiscalization(
        employeeApiErrorMessage(error, 'Чек не фискализирован'),
        context,
      );
    }
  }

  private failApprovedCardFiscalization(
    reason: string,
    pendingFiscal: PendingCardFiscalPayment | null,
  ): void {
    if (pendingFiscal) this.pendingCardFiscalPayment = pendingFiscal;
    this.processing.set(false);
    this.cardStatus.set('fiscal_error');
    this.errorMessage.set(approvedCardFiscalRetryMessage(reason));
  }

  private completeCardPaymentWithReceipt(receipt: PosReceipt): void {
    this.pendingCardFiscalPayment = null;
    this.processing.set(false);
    this.cardStatus.set('success');
    this.errorMessage.set(null);

    this.autoCloseTimer = setTimeout(() => {
      this.dialogRef.close({
        success: true,
        receipt: this.toOverlayReceipt(receipt),
      });
    }, 700);
  }

  private isActiveCardPaymentRun(runId: number): boolean {
    return runId === this.cardPaymentRunId;
  }

  private toOverlayReceipt(receipt: PosReceipt): PosPaymentOverlayResult['receipt'] {
    return {
      id: receipt.id,
      receipt_number: receipt.receipt_number,
      total: receipt.total,
      items: receipt.items.map(i => ({
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total: i.total,
      })),
    };
  }
}
