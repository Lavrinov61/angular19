import {
  Component, ChangeDetectionStrategy, computed, inject, signal, OnInit,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  PosApiService, PosInDoubtPayment, PosOrphanPayment, PosReceipt, PosReceiptPayment, PosShift, ShiftReport,
} from '../../../services/pos-api.service';
import { employeeApiErrorMessage } from '../../../utils/api-error-message';

export interface ReceiptJournalDialogData {
  shiftId: string;
  studioId: string;
  /** Открыть журнал сразу на нужной вкладке (например, баннер зависших оплат). */
  initialFilter?: ReceiptFilter;
}

type ReceiptFilter = 'all' | 'sales' | 'refunds' | 'failed' | 'in_doubt' | 'orphan';
type FiscalStatus = NonNullable<PosReceipt['fiscal_status']>;

/** Статусы фискализации, для которых показываем ручную кнопку «Фискализировать». */
const RETRYABLE_FISCAL_STATUSES: readonly FiscalStatus[] = ['pending', 'queued', 'failed'];

@Component({
  selector: 'app-pos-receipt-journal-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ClipboardModule,
    DatePipe,
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title class="journal-title">
      <span class="title-main">
        <mat-icon class="title-icon">receipt_long</mat-icon>
        Журнал чеков
      </span>
      <button mat-icon-button type="button" (click)="refresh()" [disabled]="loading()" matTooltip="Обновить">
        <mat-icon>refresh</mat-icon>
      </button>
    </h2>

    <mat-dialog-content class="journal-content">
      @if (loading()) {
        <div class="journal-loading">
          <mat-spinner diameter="32" />
        </div>
      } @else {
        @if (error()) {
          <div class="journal-error">
            <mat-icon>error</mat-icon>
            <span>{{ error() }}</span>
          </div>
        }

        @if (report(); as shiftReport) {
          <section class="shift-strip" aria-label="Итоги смены">
            <div class="shift-title">
              <span>Смена #{{ shiftReport.shift.shift_number }}</span>
              <small>{{ shiftReport.studio_name }}</small>
            </div>
            <div class="metric">
              <span>Нетто</span>
              <strong>{{ shiftReport.net_sales | number:'1.0-2' }} ₽</strong>
            </div>
            <div class="metric">
              <span>Чеки</span>
              <strong>{{ shiftReport.receipts_count }}</strong>
            </div>
            <div class="metric">
              <span>Возвраты</span>
              <strong>{{ shiftReport.refunds_count }}</strong>
            </div>
            <div class="metric">
              <span>Карта / СБП</span>
              <strong>{{ (shiftReport.card_payments + shiftReport.sbp_payments) | number:'1.0-2' }} ₽</strong>
            </div>
            <div class="metric">
              <span>Наличные</span>
              <strong>{{ shiftReport.cash_payments | number:'1.0-2' }} ₽</strong>
            </div>
          </section>
        }

        <div class="journal-tools">
          <mat-form-field class="shift-field" appearance="outline" subscriptSizing="dynamic">
            <mat-label>Смена</mat-label>
            <select
              matNativeControl
              [ngModel]="selectedShiftId()"
              (ngModelChange)="selectShift($event)"
              [disabled]="loading()"
            >
              @for (shift of shifts(); track shift.id) {
                <option [value]="shift.id">
                  Смена #{{ shift.shift_number }} · {{ shift.opened_at | date:'dd.MM HH:mm' }} · {{ shift.status === 'open' ? 'открыта' : 'закрыта' }}
                </option>
              }
            </select>
          </mat-form-field>

          <mat-form-field class="search-field" appearance="outline" subscriptSizing="dynamic">
            <mat-icon matPrefix>search</mat-icon>
            <input
              matInput
              placeholder="Чек, клиент, товар"
              [ngModel]="query()"
              (ngModelChange)="setQuery($event)"
            >
            @if (query()) {
              <button mat-icon-button matSuffix type="button" (click)="clearQuery()" matTooltip="Очистить">
                <mat-icon>close</mat-icon>
              </button>
            }
          </mat-form-field>

          <div class="filter-tabs" role="tablist" aria-label="Фильтр чеков">
            <button type="button" role="tab" class="filter-tab" [class.active]="filter() === 'all'" (click)="setFilter('all')">
              Все <span>{{ totalCount() }}</span>
            </button>
            <button type="button" role="tab" class="filter-tab" [class.active]="filter() === 'sales'" (click)="setFilter('sales')">
              Продажи <span>{{ salesCount() }}</span>
            </button>
            <button type="button" role="tab" class="filter-tab" [class.active]="filter() === 'refunds'" (click)="setFilter('refunds')">
              Возвраты <span>{{ refundsCount() }}</span>
            </button>
            <button type="button" role="tab" class="filter-tab warning" [class.active]="filter() === 'failed'" (click)="setFilter('failed')">
              Ошибки ФНС <span>{{ failedFiscalCount() }}</span>
            </button>
            <button type="button" role="tab" class="filter-tab warning" [class.active]="filter() === 'in_doubt'" (click)="setFilter('in_doubt')">
              Зависшие <span>{{ inDoubtCount() }}</span>
            </button>
            <button type="button" role="tab" class="filter-tab warning" [class.active]="filter() === 'orphan'" (click)="setFilter('orphan')">
              Оплата без чека <span>{{ orphanCount() }}</span>
            </button>
          </div>
        </div>

        @if (filter() === 'orphan') {
          @if (visibleOrphanPayments().length === 0) {
            <div class="journal-empty">
              <mat-icon>verified</mat-icon>
              <p>{{ query() ? 'Оплаты без чека не найдены' : 'Оплат без чека нет' }}</p>
            </div>
          } @else {
            <div class="in-doubt-intro">
              <mat-icon>receipt_long</mat-icon>
              <span>Деньги по карте списались, но чек не пробит. Оформите чек по каждой — приход уйдёт в ФНС без повторного списания.</span>
            </div>
            <div class="in-doubt-list" aria-label="Оплаты без чека">
              @for (payment of visibleOrphanPayments(); track payment.id) {
                <div class="in-doubt-card">
                  <div class="in-doubt-info">
                    <div class="in-doubt-head">
                      <strong class="in-doubt-amount">{{ payment.amount | number:'1.0-2' }} ₽</strong>
                      @if (payment.initiatedAt) {
                        <span class="in-doubt-time">{{ payment.initiatedAt | date:'dd.MM HH:mm' }}</span>
                      }
                    </div>
                    <span class="in-doubt-meta">
                      Операция {{ shortId(payment.id) }}
                      @if (payment.terminalOrderId || payment.orderId) {
                        · {{ payment.terminalOrderId || payment.orderId }}
                      }
                      @if (payment.initiatedByName) {
                        · {{ payment.initiatedByName }}
                      }
                    </span>
                    @if (payment.snapshot?.items?.length) {
                      <span class="in-doubt-items">
                        {{ payment.snapshot?.items?.length }} поз.: {{ inDoubtItemsSummary(payment) }}
                      </span>
                    } @else {
                      <span class="in-doubt-items">Позиции не сохранены — введёте вручную</span>
                    }
                  </div>
                  <button mat-flat-button type="button" (click)="openOrphanReceiptDialog(payment)">
                    <mat-icon>receipt</mat-icon>
                    Оформить чек
                  </button>
                </div>
              }
            </div>
          }
        } @else if (filter() === 'in_doubt') {
          @if (visibleInDoubtPayments().length === 0) {
            <div class="journal-empty">
              <mat-icon>verified</mat-icon>
              <p>{{ query() ? 'Зависшие оплаты не найдены' : 'Зависших оплат нет' }}</p>
            </div>
          } @else {
            <div class="in-doubt-intro">
              <mat-icon>help_outline</mat-icon>
              <span>Оплаты с неизвестным статусом. Деньги могли списаться, разберите каждую и не запускайте оплату повторно.</span>
            </div>
            <div class="in-doubt-list" aria-label="Зависшие оплаты">
              @for (payment of visibleInDoubtPayments(); track payment.id) {
                <div class="in-doubt-card">
                  <div class="in-doubt-info">
                    <div class="in-doubt-head">
                      <strong class="in-doubt-amount">{{ payment.amount | number:'1.0-2' }} ₽</strong>
                      @if (payment.initiatedAt) {
                        <span class="in-doubt-time">{{ payment.initiatedAt | date:'dd.MM HH:mm' }}</span>
                      }
                    </div>
                    <span class="in-doubt-meta">
                      Операция {{ shortId(payment.id) }}
                      @if (payment.terminalOrderId || payment.orderId) {
                        · {{ payment.terminalOrderId || payment.orderId }}
                      }
                      @if (payment.initiatedByName) {
                        · {{ payment.initiatedByName }}
                      }
                    </span>
                    @if (payment.errorMessage) {
                      <span class="in-doubt-error">{{ payment.errorMessage }}</span>
                    }
                    @if (payment.snapshot?.items?.length) {
                      <span class="in-doubt-items">
                        {{ payment.snapshot?.items?.length }} поз.: {{ inDoubtItemsSummary(payment) }}
                      </span>
                    }
                  </div>
                  <button mat-flat-button type="button" (click)="openResolveDialog(payment)">
                    <mat-icon>fact_check</mat-icon>
                    Разобрать
                  </button>
                </div>
              }
            </div>
          }
        } @else {
          @if (visibleInDoubtPayments().length > 0) {
            <section class="in-doubt-summary" aria-label="Оплаты с неизвестным статусом">
              <div class="in-doubt-summary-head">
                <mat-icon>help_outline</mat-icon>
                <div>
                  <strong>
                    {{ visibleInDoubtPayments().length }}
                    {{ inDoubtPaymentWord(visibleInDoubtPayments().length) }}
                    с неизвестным статусом
                  </strong>
                  <span>Проверьте каждую операцию до повторной оплаты.</span>
                </div>
                <button mat-stroked-button type="button" (click)="setFilter('in_doubt')">
                  Открыть список
                </button>
              </div>
              <div class="in-doubt-mini-list">
                @for (payment of inDoubtPreviewPayments(); track payment.id) {
                  <button type="button" class="in-doubt-mini-card" (click)="openResolveDialog(payment)">
                    <strong>{{ payment.amount | number:'1.0-2' }} ₽</strong>
                    <span>
                      @if (payment.initiatedAt) {
                        {{ payment.initiatedAt | date:'HH:mm' }}
                      }
                      @if (payment.initiatedByName) {
                        · {{ payment.initiatedByName }}
                      }
                    </span>
                    <small>
                      {{ payment.terminalOrderId || payment.orderId || 'Без заказа' }}
                      · {{ shortId(payment.id) }}
                    </small>
                  </button>
                }
              </div>
            </section>
          }

          @if (receipts().length === 0) {
            <div class="journal-empty">
              <mat-icon>receipt</mat-icon>
              <p>Нет чеков в этой смене</p>
            </div>
          } @else {
          <div class="journal-workspace">
            <section class="journal-list" aria-label="Список чеков">
              @if (filteredReceipts().length === 0) {
                <div class="journal-empty compact">
                  <mat-icon>search_off</mat-icon>
                  <p>Чеки не найдены</p>
                </div>
              }

              @for (r of filteredReceipts(); track r.id) {
                <button
                  type="button"
                  class="receipt-row"
                  [class.active]="selectedReceipt().id === r.id"
                  [class.voided]="isVoided(r)"
                  [class.refund]="r.is_refund"
                  (click)="selectReceipt(r)"
                >
                  <span class="receipt-main">
                    <span class="receipt-line">
                      <span class="receipt-number">ФД {{ r.receipt_number }}</span>
                      <span class="receipt-time">{{ r.created_at | date:'HH:mm' }}</span>
                    </span>
                    <span class="receipt-subline">
                      @if (r.customer_name || r.customer_phone) {
                        {{ r.customer_name || r.customer_phone }}
                      } @else {
                        Без клиента
                      }
                    </span>
                  </span>
                  <span class="receipt-side">
                    <span class="receipt-total">{{ r.total | number:'1.0-2' }} ₽</span>
                    <span class="receipt-chips">
                      @for (p of r.payments; track $index) {
                        <span class="payment-chip" [class]="'chip-' + p.payment_type">
                          {{ paymentLabel(p.payment_type) }}
                        </span>
                      }
                      <span class="status-badge" [class]="receiptKindClass(r)">{{ receiptKindLabel(r) }}</span>
                      <span class="status-badge fiscal" [class]="fiscalStatusClass(r)">{{ fiscalStatusLabel(r.fiscal_status) }}</span>
                      @if (fiscalErrorSummary(r); as fiscalError) {
                        <span class="status-badge fiscal-problem" [matTooltip]="r.fiscal_last_error || fiscalError">{{ fiscalError }}</span>
                      }
                    </span>
                  </span>
                </button>
              }
            </section>

            <section class="receipt-detail" aria-label="Выбранный чек">
              @if (selectedReceipt(); as receipt) {
                <header class="detail-header">
                  <div>
                    <span class="detail-kicker">{{ receiptKindLabel(receipt) }}</span>
                    <h3>ФД {{ receipt.receipt_number }}</h3>
                    <p>{{ receipt.created_at | date:'dd.MM.yyyy HH:mm' }}</p>
                  </div>
                  <strong>{{ receipt.total | number:'1.0-2' }} ₽</strong>
                </header>

                <div class="detail-status" [class]="fiscalStatusClass(receipt)">
                  <mat-icon>{{ fiscalStatusIcon(receipt.fiscal_status) }}</mat-icon>
                  <div>
                    <span>{{ fiscalStatusLabel(receipt.fiscal_status) }}</span>
                    @if (receipt.fiscal_attempts) {
                      <small>Попыток: {{ receipt.fiscal_attempts }}</small>
                    }
                  </div>
                </div>

                @if (fiscalErrorSummary(receipt); as fiscalError) {
                  <div class="fiscal-error">
                    <mat-icon>report</mat-icon>
                    <div>
                      <strong>{{ fiscalError }}</strong>
                      @if (receipt.fiscal_last_error && receipt.fiscal_last_error !== fiscalError) {
                        <small>{{ receipt.fiscal_last_error }}</small>
                      }
                    </div>
                  </div>
                }

                <div class="detail-actions">
                  <button mat-stroked-button type="button" (click)="copyReceiptSummary(receipt)">
                    <mat-icon>content_copy</mat-icon>
                    Скопировать
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    (click)="printReceiptCopy(receipt)"
                    [disabled]="actionLoadingId() === receipt.id || !!receipt.voided_at"
                  >
                    <mat-icon>print</mat-icon>
                    Печать копии
                  </button>
                  <button mat-stroked-button type="button" (click)="openRefundDialog(receipt)" [disabled]="!canActOnReceipt(receipt)">
                    <mat-icon>undo</mat-icon>
                    Возврат
                  </button>
                  <button mat-stroked-button type="button" (click)="openVoidDialog(receipt)" [disabled]="!canActOnReceipt(receipt)">
                    <mat-icon>block</mat-icon>
                    Аннулировать
                  </button>
                  @if (canRetryFiscal(receipt)) {
                    <button
                      mat-flat-button
                      type="button"
                      (click)="retryFiscal(receipt)"
                      [disabled]="actionLoadingId() === receipt.id"
                    >
                      <mat-icon>sync</mat-icon>
                      {{ receipt.fiscal_status === 'failed' ? 'Повторить ФНС' : 'Фискализировать' }}
                    </button>
                  }
                  @if (receipt.fiscal_status === 'failed' && !receipt.is_refund) {
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="createFiscalCorrection(receipt)"
                      [disabled]="actionLoadingId() === receipt.id"
                    >
                      <mat-icon>receipt</mat-icon>
                      Чек коррекции
                    </button>
                  }
                </div>

                <mat-divider />

                <div class="detail-grid">
                  <div class="detail-block">
                    <h4>Клиент</h4>
                    <p>{{ receipt.customer_name || 'Не указан' }}</p>
                    @if (receipt.customer_phone) {
                      <small>{{ receipt.customer_phone }}</small>
                    }
                  </div>
                  <div class="detail-block">
                    <h4>Кассир</h4>
                    <p>{{ receipt.employee_name || 'Не указан' }}</p>
                    <small>{{ receipt.studio_name || 'Студия не указана' }}</small>
                  </div>
                </div>

                <div class="detail-section">
                  <h4>Позиции</h4>
                  <div class="item-list">
                    @for (item of receipt.items; track $index) {
                      <div class="item-row">
                        <span class="item-name">{{ item.product_name }}</span>
                        <span class="item-qty">{{ item.quantity | number:'1.0-3' }} × {{ item.unit_price | number:'1.0-2' }} ₽</span>
                        <strong>{{ item.total | number:'1.0-2' }} ₽</strong>
                      </div>
                    }
                  </div>
                </div>

                <div class="detail-section">
                  <h4>Оплата</h4>
                  <div class="payment-list">
                    @for (payment of receipt.payments; track $index) {
                      <div class="payment-row">
                        <span class="payment-label">
                          {{ paymentLabel(payment.payment_type) }}
                          @if (payment.transaction_id) {
                            <small>Операция {{ shortId(payment.transaction_id) }}</small>
                          }
                          @if (payment.effective_status) {
                            <small class="terminal-status" [class]="terminalPaymentStatusClass(payment.effective_status)">
                              {{ terminalPaymentStatusLabel(payment.effective_status) }}
                            </small>
                          }
                          @if (payment.terminal_error_message) {
                            <small class="payment-error">{{ payment.terminal_error_message }}</small>
                          }
                        </span>
                        <strong>{{ payment.amount | number:'1.0-2' }} ₽</strong>
                      </div>
                    }
                  </div>
                </div>

                @if (receipt.discount_total || receipt.points_discount || receipt.subscription_credit_used) {
                  <div class="detail-section">
                    <h4>Скидки</h4>
                    <div class="payment-list">
                      @if (receipt.discount_total) {
                        <div class="payment-row">
                          <span>Скидка</span>
                          <strong>{{ receipt.discount_total | number:'1.0-2' }} ₽</strong>
                        </div>
                      }
                      @if (receipt.points_discount) {
                        <div class="payment-row">
                          <span>Баллы</span>
                          <strong>{{ receipt.points_discount | number:'1.0-2' }} ₽</strong>
                        </div>
                      }
                      @if (receipt.subscription_credit_used) {
                        <div class="payment-row">
                          <span>Абонемент</span>
                          <strong>{{ receipt.subscription_credit_used | number:'1.0-2' }} ₽</strong>
                        </div>
                      }
                    </div>
                  </div>
                }
              } @else {
                <div class="journal-empty compact">
                  <mat-icon>receipt_long</mat-icon>
                  <p>Выберите чек</p>
                </div>
              }
            </section>
          </div>
          }
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close>Закрыть</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .journal-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0;
    }
    .title-main {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .title-icon {
      color: var(--mat-sys-primary);
    }

    .journal-content {
      width: min(1000px, calc(100vw - 48px));
      min-height: min(640px, calc(100vh - 190px));
      overflow: hidden;
    }

    .journal-loading, .journal-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      gap: 8px;
      mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--mat-sys-on-surface-variant); }
      p { color: var(--mat-sys-on-surface-variant); margin: 0; }
    }
    .journal-empty.compact {
      min-height: 180px;
      padding: 20px;
    }

    .journal-error {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-status-error) 12%, transparent);
      color: var(--crm-status-error);
      font-size: 13px;
    }

    .shift-strip {
      display: grid;
      grid-template-columns: minmax(160px, 1.3fr) repeat(5, minmax(88px, 1fr));
      gap: 1px;
      overflow: hidden;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-outline-variant);
      margin-bottom: 12px;
    }
    .shift-title, .metric {
      min-width: 0;
      padding: 10px 12px;
      background: var(--mat-sys-surface-container-low);
    }
    .shift-title {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .shift-title span {
      font-size: 16px;
      font-weight: 700;
      color: var(--mat-sys-on-surface);
    }
    .shift-title small, .metric span {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .metric {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .metric strong {
      font-size: 15px;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
    }

    .journal-tools {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .shift-field {
      flex: 0 0 240px;
      min-width: 210px;
    }
    .search-field {
      flex: 1 1 280px;
      min-width: 220px;
    }
    .filter-tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      padding: 3px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
    }
    .filter-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 0 10px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .filter-tab span {
      min-width: 18px;
      padding: 1px 5px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
      text-align: center;
      font-size: 11px;
      font-weight: 700;
    }
    .filter-tab.active {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    .filter-tab.active span {
      background: color-mix(in srgb, var(--mat-sys-on-primary) 24%, transparent);
      color: var(--mat-sys-on-primary);
    }
    .filter-tab.warning.active {
      background: var(--crm-status-error);
    }

    .in-doubt-intro {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-status-warning) 12%, transparent);
      color: var(--crm-status-warning);
      font-size: 13px;
      line-height: 1.35;
      mat-icon { flex: 0 0 auto; }
    }
    .in-doubt-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: auto;
      max-height: min(440px, calc(100vh - 360px));
    }
    .in-doubt-summary {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
      padding: 10px;
      border: 1px solid color-mix(in srgb, var(--crm-status-warning) 36%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-status-warning) 10%, var(--mat-sys-surface-container-lowest));
    }
    .in-doubt-summary-head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      color: var(--crm-status-warning);
    }
    .in-doubt-summary-head div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .in-doubt-summary-head strong {
      color: var(--mat-sys-on-surface);
      font-size: 14px;
    }
    .in-doubt-summary-head span {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }
    .in-doubt-mini-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 6px;
    }
    .in-doubt-mini-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas:
        "amount meta"
        "id id";
      gap: 2px 8px;
      align-items: baseline;
      padding: 8px 10px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .in-doubt-mini-card strong {
      grid-area: amount;
      white-space: nowrap;
    }
    .in-doubt-mini-card span {
      grid-area: meta;
      min-width: 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .in-doubt-mini-card small {
      grid-area: id;
      min-width: 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .in-doubt-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-left: 3px solid var(--crm-status-warning);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
    }
    .in-doubt-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .in-doubt-head {
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .in-doubt-amount {
      font-size: 16px;
      color: var(--mat-sys-on-surface);
    }
    .in-doubt-time {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .in-doubt-meta, .in-doubt-error, .in-doubt-items {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: min(560px, 70vw);
    }
    .in-doubt-card button {
      flex: 0 0 auto;
      mat-icon { margin-right: 4px; }
    }

    .journal-workspace {
      display: grid;
      grid-template-columns: minmax(320px, 0.95fr) minmax(360px, 1.25fr);
      gap: 12px;
      min-height: 0;
      height: min(510px, calc(100vh - 340px));
    }

    .journal-list, .receipt-detail {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-lowest);
    }
    .journal-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
    }

    .receipt-row {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 66px;
      padding: 9px 10px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .receipt-row:hover {
      background: var(--mat-sys-surface-container);
    }
    .receipt-row.active {
      border-color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, var(--mat-sys-surface-container-low));
    }
    .receipt-row.voided .receipt-number, .receipt-row.voided .receipt-total {
      text-decoration: line-through;
    }
    .receipt-row.voided {
      opacity: 0.6;
    }
    .receipt-row.refund {
      border-left: 3px solid var(--crm-status-warning);
    }

    .receipt-main {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .receipt-line {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .receipt-number {
      font-weight: 600;
      font-size: 13px;
      color: var(--mat-sys-on-surface);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .receipt-time {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .receipt-subline {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .receipt-side {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 5px;
      min-width: 136px;
    }
    .receipt-total {
      font-weight: 700;
      font-size: 14px;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
    }
    .receipt-chips {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .payment-chip {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 500;
    }
    .chip-cash { background: color-mix(in srgb, var(--crm-status-success) 20%, transparent); color: var(--crm-status-success); }
    .chip-card { background: color-mix(in srgb, var(--mat-sys-primary) 20%, transparent); color: var(--mat-sys-primary); }
    .chip-sbp { background: color-mix(in srgb, var(--crm-accent-dim) 20%, transparent); color: var(--crm-accent-dim); }
    .chip-online { background: color-mix(in srgb, var(--mat-sys-tertiary) 20%, transparent); color: var(--mat-sys-tertiary); }
    .chip-subscription { background: color-mix(in srgb, var(--crm-status-warning) 20%, transparent); color: var(--crm-status-warning); }

    .status-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    .status-badge.sale { background: color-mix(in srgb, var(--crm-status-success) 16%, transparent); color: var(--crm-status-success); }
    .status-badge.refund { background: color-mix(in srgb, var(--crm-status-warning) 18%, transparent); color: var(--crm-status-warning); }
    .status-badge.voided { background: color-mix(in srgb, var(--crm-status-error) 18%, transparent); color: var(--crm-status-error); }
    .status-badge.fiscal.success { background: color-mix(in srgb, var(--crm-status-success) 16%, transparent); color: var(--crm-status-success); }
    .status-badge.fiscal.failed { background: color-mix(in srgb, var(--crm-status-error) 18%, transparent); color: var(--crm-status-error); }
    .status-badge.fiscal-problem {
      background: var(--crm-status-error);
      color: white;
    }
    .status-badge.fiscal.pending, .status-badge.fiscal.queued, .status-badge.fiscal.processing {
      background: color-mix(in srgb, var(--crm-status-warning) 18%, transparent);
      color: var(--crm-status-warning);
    }
    .status-badge.fiscal.skipped, .status-badge.fiscal.unknown {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }

    .receipt-detail {
      padding: 14px;
    }
    .detail-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }
    .detail-header h3 {
      margin: 2px 0;
      font-size: 22px;
      line-height: 1.15;
      color: var(--mat-sys-on-surface);
    }
    .detail-header p, .detail-kicker {
      margin: 0;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .detail-kicker {
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0;
    }
    .detail-header strong {
      font-size: 22px;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
    }

    .detail-status, .fiscal-error {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 10px;
      font-size: 13px;
    }
    .detail-status div {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .detail-status small, .fiscal-error small {
      color: var(--mat-sys-on-surface-variant);
    }
    .fiscal-error div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .fiscal-error strong {
      font-weight: 700;
    }
    .detail-status.success {
      background: color-mix(in srgb, var(--crm-status-success) 12%, transparent);
      color: var(--crm-status-success);
    }
    .detail-status.failed, .fiscal-error {
      background: color-mix(in srgb, var(--crm-status-error) 12%, transparent);
      color: var(--crm-status-error);
    }
    .detail-status.pending, .detail-status.queued, .detail-status.processing {
      background: color-mix(in srgb, var(--crm-status-warning) 12%, transparent);
      color: var(--crm-status-warning);
    }
    .detail-status.skipped, .detail-status.unknown {
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);
    }

    .detail-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0 14px;
    }
    .detail-actions button {
      min-height: 36px;
    }
    .detail-actions mat-icon {
      margin-right: 4px;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 14px 0;
    }
    .detail-block {
      min-width: 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
    }
    .detail-block h4, .detail-section h4 {
      margin: 0 0 6px;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      font-weight: 700;
    }
    .detail-block p {
      margin: 0 0 2px;
      color: var(--mat-sys-on-surface);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-block small {
      color: var(--mat-sys-on-surface-variant);
    }
    .detail-section {
      margin-top: 14px;
    }
    .item-list, .payment-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      overflow: hidden;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-outline-variant);
    }
    .item-row, .payment-row {
      display: grid;
      gap: 8px;
      align-items: center;
      padding: 9px 10px;
      background: var(--mat-sys-surface-container-lowest);
      min-width: 0;
    }
    .item-row {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
    .payment-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .item-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-qty {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      white-space: nowrap;
    }
    .item-row strong, .payment-row strong {
      white-space: nowrap;
    }
    .payment-label {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .payment-label small {
      color: var(--mat-sys-on-surface-variant);
      font-size: 11px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .terminal-status.resolved-paid {
      color: var(--crm-status-success);
      font-weight: 600;
    }
    .terminal-status.resolved-unpaid,
    .terminal-status.failed {
      color: var(--crm-status-error);
      font-weight: 600;
    }
    .terminal-status.in-doubt {
      color: var(--crm-status-warning);
      font-weight: 600;
    }
    .payment-error {
      max-width: min(460px, 70vw);
    }

    @media (max-width: 860px) {
      .journal-content {
        width: calc(100vw - 32px);
        overflow: auto;
      }
      .shift-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .journal-tools {
        align-items: stretch;
        flex-direction: column;
      }
      .shift-field {
        flex: 1 1 auto;
        width: 100%;
      }
      .filter-tabs {
        overflow-x: auto;
      }
      .journal-workspace {
        grid-template-columns: 1fr;
        height: auto;
      }
      .journal-list, .receipt-detail {
        max-height: none;
      }
      .detail-grid {
        grid-template-columns: 1fr;
      }
      .item-row {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .item-row strong {
        grid-column: 2;
      }
      .in-doubt-summary-head {
        grid-template-columns: auto minmax(0, 1fr);
      }
      .in-doubt-summary-head button {
        grid-column: 1 / -1;
        justify-self: start;
      }
    }
  `],
})
export class PosReceiptJournalDialogComponent implements OnInit {
  readonly data = inject<ReceiptJournalDialogData>(MAT_DIALOG_DATA);
  private readonly posApi = inject(PosApiService);
  private readonly dialog = inject(MatDialog);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);

  readonly receipts = signal<PosReceipt[]>([]);
  readonly inDoubtPayments = signal<PosInDoubtPayment[]>([]);
  readonly orphanPayments = signal<PosOrphanPayment[]>([]);
  readonly report = signal<ShiftReport | null>(null);
  readonly shifts = signal<PosShift[]>([]);
  readonly selectedShiftId = signal(this.data.shiftId);
  readonly totalCount = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly filter = signal<ReceiptFilter>(this.data.initialFilter ?? 'all');
  readonly selectedReceiptId = signal<string | null>(null);
  readonly actionLoadingId = signal<string | null>(null);

  readonly filteredReceipts = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('ru-RU');
    return this.receipts().filter(receipt => (
      this.matchesFilter(receipt, this.filter()) && this.matchesQuery(receipt, query)
    ));
  });

  readonly visibleInDoubtPayments = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('ru-RU');
    return this.inDoubtPayments().filter(payment => this.matchesInDoubtQuery(payment, query));
  });

  readonly inDoubtPreviewPayments = computed(() => this.visibleInDoubtPayments().slice(0, 3));

  readonly visibleOrphanPayments = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('ru-RU');
    return this.orphanPayments().filter(payment => this.matchesInDoubtQuery(payment, query));
  });

  readonly selectedReceipt = computed(() => {
    const selectedId = this.selectedReceiptId();
    return this.receipts().find(receipt => receipt.id === selectedId) ?? this.filteredReceipts()[0] ?? null;
  });

  readonly salesCount = computed(() => this.receipts().filter(receipt => !receipt.is_refund && !this.isVoided(receipt)).length);
  readonly refundsCount = computed(() => this.receipts().filter(receipt => receipt.is_refund).length);
  readonly failedFiscalCount = computed(() => this.receipts().filter(receipt => receipt.fiscal_status === 'failed').length);
  readonly inDoubtCount = computed(() => this.inDoubtPayments().length);
  readonly orphanCount = computed(() => this.orphanPayments().length);

  private static readonly PAYMENT_LABELS: Record<string, string> = {
    cash: 'Нал',
    card: 'Карта',
    sbp: 'СБП',
    online: 'Онлайн',
    subscription: 'Подписка',
    transfer: 'Перевод',
  };

  private static readonly FISCAL_LABELS: Record<FiscalStatus, string> = {
    pending: 'Ожидает',
    queued: 'В очереди',
    processing: 'Отправляется',
    success: 'ФНС принят',
    failed: 'Ошибка ФНС',
    skipped: 'Без ФНС',
  };

  ngOnInit(): void {
    this.loadShiftChoices();
    this.loadReceipts();
  }

  paymentLabel(type: string): string {
    return PosReceiptJournalDialogComponent.PAYMENT_LABELS[type] || type;
  }

  inDoubtPaymentWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'оплата';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'оплаты';
    return 'оплат';
  }

  shortId(id: string | null | undefined): string {
    if (!id) return '';
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  terminalPaymentStatusLabel(status: string | null | undefined): string {
    switch (status) {
      case 'resolved_paid': return 'Разобрано: оплачено';
      case 'resolved_unpaid': return 'Разобрано: не оплачено';
      case 'in_doubt': return 'Неизвестный статус';
      case 'completed': return 'Терминал: оплачено';
      case 'failed': return 'Терминал: отказ/ошибка';
      case 'pending': return 'Терминал: ожидает';
      case 'processing': return 'Терминал: выполняется';
      default: return status || 'Статус неизвестен';
    }
  }

  terminalPaymentStatusClass(status: string | null | undefined): string {
    switch (status) {
      case 'resolved_paid':
      case 'completed':
        return 'resolved-paid';
      case 'resolved_unpaid':
      case 'failed':
        return 'resolved-unpaid';
      case 'in_doubt':
      case 'pending':
      case 'processing':
        return 'in-doubt';
      default:
        return 'unknown';
    }
  }

  isVoided(r: PosReceipt): boolean {
    return Boolean(r.voided_at) || (r.total === 0 && !r.is_refund);
  }

  receiptKindLabel(receipt: PosReceipt): string {
    if (this.isVoided(receipt)) return 'Аннулирован';
    if (receipt.is_refund) return 'Возврат';
    return 'Продажа';
  }

  receiptKindClass(receipt: PosReceipt): string {
    if (this.isVoided(receipt)) return 'voided';
    if (receipt.is_refund) return 'refund';
    return 'sale';
  }

  fiscalStatusLabel(status: PosReceipt['fiscal_status']): string {
    if (!status) return 'Неизвестно';
    return PosReceiptJournalDialogComponent.FISCAL_LABELS[status] ?? status;
  }

  fiscalStatusClass(receipt: PosReceipt): string {
    return receipt.fiscal_status ?? 'unknown';
  }

  fiscalStatusIcon(status: PosReceipt['fiscal_status']): string {
    switch (status) {
      case 'success': return 'check_circle';
      case 'failed': return 'error';
      case 'queued':
      case 'processing':
      case 'pending': return 'sync';
      case 'skipped': return 'remove_circle_outline';
      default: return 'help';
    }
  }

  fiscalErrorSummary(receipt: PosReceipt): string | null {
    if (receipt.fiscal_status !== 'failed') return null;
    const message = receipt.fiscal_last_error?.trim();
    if (!message) return null;
    const normalized = message.toLocaleLowerCase('ru-RU');
    if (normalized.includes('нет бумаги')) return 'Нет бумаги в ККТ';
    return message.replace(/^DLL error:\s*/i, '').trim();
  }

  canActOnReceipt(receipt: PosReceipt): boolean {
    return !this.isVoided(receipt) && !receipt.is_refund;
  }

  canRetryFiscal(receipt: PosReceipt): boolean {
    return RETRYABLE_FISCAL_STATUSES.includes(receipt.fiscal_status as FiscalStatus);
  }

  setFilter(filter: ReceiptFilter): void {
    this.filter.set(filter);
    this.selectFirstVisibleReceipt();
  }

  setQuery(value: string): void {
    this.query.set(value);
    this.selectFirstVisibleReceipt();
  }

  clearQuery(): void {
    this.query.set('');
    this.selectFirstVisibleReceipt();
  }

  selectReceipt(receipt: PosReceipt): void {
    this.selectedReceiptId.set(receipt.id);
  }

  selectShift(shiftId: string): void {
    if (!shiftId || shiftId === this.selectedShiftId()) return;
    this.selectedShiftId.set(shiftId);
    this.selectedReceiptId.set(null);
    this.loadReceipts();
  }

  refresh(): void {
    this.loadShiftChoices();
    this.loadReceipts();
  }

  copyReceiptSummary(receipt: PosReceipt): void {
    const lines = [
      `ФД ${receipt.receipt_number}`,
      `Дата: ${new Date(receipt.created_at).toLocaleString('ru-RU')}`,
      `Сумма: ${receipt.total} ₽`,
      `Статус ФНС: ${this.fiscalStatusLabel(receipt.fiscal_status)}`,
      ...receipt.items.map(item => `${item.product_name}: ${item.quantity} × ${item.unit_price} = ${item.total} ₽`),
    ];
    const copied = this.clipboard.copy(lines.join('\n'));
    this.snackBar.open(copied ? 'Данные чека скопированы' : 'Не удалось скопировать', 'OK', { duration: 2200 });
  }

  printReceiptCopy(receipt: PosReceipt): void {
    this.actionLoadingId.set(receipt.id);
    this.posApi.printReceiptCopy(receipt.id).subscribe({
      next: () => {
        this.actionLoadingId.set(null);
        this.snackBar.open('Копия отправлена на АТОЛ', 'OK', { duration: 2600 });
      },
      error: (error: unknown) => {
        this.actionLoadingId.set(null);
        this.snackBar.open(employeeApiErrorMessage(error, 'Не удалось распечатать копию'), 'OK', { duration: 3200 });
      },
    });
  }

  retryFiscal(receipt: PosReceipt): void {
    this.actionLoadingId.set(receipt.id);
    this.posApi.retryFiscal(receipt.id).subscribe({
      next: () => {
        this.snackBar.open('Чек отправлен на повторную фискализацию', 'OK', { duration: 2600 });
        this.loadReceipts();
      },
      error: () => {
        this.actionLoadingId.set(null);
        this.snackBar.open('Не удалось отправить чек в ФНС', 'OK', { duration: 3200 });
      },
    });
  }

  createFiscalCorrection(receipt: PosReceipt): void {
    this.actionLoadingId.set(receipt.id);
    this.posApi.createFiscalCorrection(receipt.id).subscribe({
      next: () => {
        this.snackBar.open('Чек коррекции поставлен в очередь', 'OK', { duration: 2600 });
        this.loadReceipts();
      },
      error: () => {
        this.actionLoadingId.set(null);
        this.snackBar.open('Не удалось создать чек коррекции', 'OK', { duration: 3200 });
      },
    });
  }

  openVoidDialog(receipt: PosReceipt): void {
    import('./pos-void-confirm-dialog.component').then(m => {
      const ref = this.dialog.open(m.PosVoidConfirmDialogComponent, {
        width: '420px',
        data: { receipt, shiftId: this.selectedShiftId() },
      });
      ref.afterClosed().subscribe(result => {
        if (result) this.loadReceipts();
      });
    });
  }

  openRefundDialog(receipt: PosReceipt): void {
    import('./pos-partial-refund-dialog.component').then(m => {
      const ref = this.dialog.open(m.PosPartialRefundDialogComponent, {
        width: '520px',
        data: { receipt, shiftId: this.selectedShiftId(), studioId: this.data.studioId },
      });
      ref.afterClosed().subscribe(result => {
        if (result) this.loadReceipts();
      });
    });
  }

  private loadReceipts(): void {
    const shiftId = this.selectedShiftId();
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      page: this.posApi.getReceiptsPage({ shift_id: shiftId, limit: 100 }),
      report: this.posApi.getShiftReport(shiftId),
      // Зависшие оплаты живут по студии (не по смене) и без созданного чека —
      // мягко: если запрос упадёт, журнал чеков всё равно покажем.
      inDoubt: this.posApi.getInDoubtPayments(this.data.studioId).pipe(
        catchError(() => of([] as PosInDoubtPayment[])),
      ),
      // Осиротевшие оплаты (списание прошло, чека нет) — тоже по студии, мягко.
      orphan: this.posApi.getOrphanPayments(this.data.studioId).pipe(
        catchError(() => of([] as PosOrphanPayment[])),
      ),
    }).subscribe({
      next: ({ page, report, inDoubt, orphan }) => {
        this.receipts.set(page.items);
        this.inDoubtPayments.set(inDoubt);
        this.orphanPayments.set(orphan);
        this.totalCount.set(page.total);
        this.report.set(report);
        this.ensureShiftChoice(report.shift);
        const selectedId = this.selectedReceiptId();
        const nextSelectedId = selectedId && page.items.some(receipt => receipt.id === selectedId)
          ? selectedId
          : page.items[0]?.id ?? null;
        this.selectedReceiptId.set(nextSelectedId);
        this.loading.set(false);
        this.actionLoadingId.set(null);
      },
      error: () => {
        this.error.set('Не удалось загрузить журнал чеков');
        this.receipts.set([]);
        this.report.set(null);
        this.loading.set(false);
        this.actionLoadingId.set(null);
      },
    });
  }

  inDoubtItemsSummary(payment: PosInDoubtPayment): string {
    const items = payment.snapshot?.items ?? [];
    return items.map(item => item.product_name).filter(Boolean).join(', ');
  }

  openResolveDialog(payment: PosInDoubtPayment): void {
    import('./pos-indoubt-resolve-dialog.component').then(m => {
      const ref = this.dialog.open(m.PosInDoubtResolveDialogComponent, {
        width: '560px',
        maxWidth: 'calc(100vw - 24px)',
        data: { payment, studioId: this.data.studioId },
      });
      ref.afterClosed().subscribe(result => {
        if (result?.resolved) {
          if (result.receiptId) {
            this.filter.set('all');
            this.selectedReceiptId.set(result.receiptId);
          }
          this.loadReceipts();
        }
      });
    });
  }

  openOrphanReceiptDialog(payment: PosOrphanPayment): void {
    import('./pos-orphan-receipt-dialog.component').then(m => {
      const ref = this.dialog.open(m.PosOrphanReceiptDialogComponent, {
        width: '560px',
        maxWidth: 'calc(100vw - 24px)',
        data: { payment, studioId: this.data.studioId },
      });
      ref.afterClosed().subscribe(result => {
        if (result?.resolved) {
          if (result.receiptId) {
            this.filter.set('all');
            this.selectedReceiptId.set(result.receiptId);
          }
          this.loadReceipts();
        }
      });
    });
  }

  private loadShiftChoices(): void {
    this.posApi.getShifts({ studio_id: this.data.studioId, limit: 30 }).subscribe({
      next: response => {
        this.shifts.set(this.mergeShiftChoices(response.items));
      },
      error: () => {
        const report = this.report();
        if (report) this.ensureShiftChoice(report.shift);
      },
    });
  }

  private ensureShiftChoice(shift: PosShift): void {
    this.shifts.set(this.mergeShiftChoices([shift, ...this.shifts()]));
  }

  private mergeShiftChoices(items: PosShift[]): PosShift[] {
    const byId = new Map<string, PosShift>();
    for (const shift of items) byId.set(shift.id, shift);
    return Array.from(byId.values()).sort((a, b) => (
      new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()
    ));
  }

  private selectFirstVisibleReceipt(): void {
    const visible = this.filteredReceipts();
    const selectedId = this.selectedReceiptId();
    if (selectedId && visible.some(receipt => receipt.id === selectedId)) return;
    this.selectedReceiptId.set(visible[0]?.id ?? null);
  }

  private matchesFilter(receipt: PosReceipt, filter: ReceiptFilter): boolean {
    switch (filter) {
      case 'sales': return !receipt.is_refund && !this.isVoided(receipt);
      case 'refunds': return receipt.is_refund;
      case 'failed': return receipt.fiscal_status === 'failed';
      default: return true;
    }
  }

  private matchesQuery(receipt: PosReceipt, query: string): boolean {
    if (!query) return true;
    const haystack = [
      receipt.receipt_number,
      receipt.customer_name,
      receipt.customer_phone,
      receipt.employee_name,
      receipt.studio_name,
      ...receipt.items.map(item => item.product_name),
      ...receipt.payments.flatMap(payment => this.paymentSearchTerms(payment)),
    ].filter((value): value is string => Boolean(value));
    return haystack.some(value => value.toLocaleLowerCase('ru-RU').includes(query));
  }

  private matchesInDoubtQuery(payment: PosInDoubtPayment, query: string): boolean {
    if (!query) return true;
    const haystack = [
      payment.id,
      payment.orderId,
      payment.terminalOrderId,
      payment.initiatedByName,
      payment.status,
      payment.errorMessage,
      String(payment.amount),
      ...(payment.snapshot?.items ?? []).map(item => item.product_name),
    ].filter((value): value is string => Boolean(value));
    return haystack.some(value => value.toLocaleLowerCase('ru-RU').includes(query));
  }

  private paymentSearchTerms(payment: PosReceiptPayment): string[] {
    return [
      payment.payment_type,
      payment.transaction_id,
      payment.transaction_status,
      payment.payment_resolution,
      payment.effective_status,
      payment.effective_status ? this.terminalPaymentStatusLabel(payment.effective_status) : null,
      payment.terminal_error_message,
    ].filter((value): value is string => Boolean(value));
  }
}
