import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { ShiftsApiService, EmployeeEarnings } from '../../services/shifts-api.service';
import { PayrollApiService, PayoutRecord, BankAccount } from '../../services/payroll-api.service';
import { BankAccountFormComponent } from './bank-account-form.component';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  approved: 'Одобрено',
  paid: 'Выплачено',
};

const STATUS_COLORS: Record<string, string> = {
  draft: '#f59e0b',
  approved: '#3b82f6',
  paid: '#22c55e',
};

@Component({
  selector: 'app-my-earnings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, MatButtonModule, MatTooltipModule, MatChipsModule, BankAccountFormComponent],
  template: `
    <div class="me-page">
      <!-- Header -->
      <header class="me-header glass-card">
        <div class="me-header-left">
          <mat-icon class="me-header-icon">account_balance_wallet</mat-icon>
          <h1 class="me-title">Мои заработки</h1>
        </div>
        <div class="me-month-nav">
          <button mat-icon-button (click)="prevMonth()" matTooltip="Предыдущий месяц">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <span class="me-month-label">{{ monthLabel() }}</span>
          <button mat-icon-button (click)="nextMonth()" matTooltip="Следующий месяц">
            <mat-icon>chevron_right</mat-icon>
          </button>
        </div>
      </header>

      @if (loading()) {
        <div class="me-loading glass-card">Загрузка...</div>
      } @else if (error()) {
        <div class="me-error glass-card">{{ error() }}</div>
      } @else {
        @if (earnings(); as e) {
        <!-- Summary cards -->
        <div class="me-summary">
          <div class="me-stat glass-card">
            <mat-icon class="me-stat-icon gross">payments</mat-icon>
            <div class="me-stat-value">{{ e.gross_earnings | number:'1.0-0' }} &#8381;</div>
            <div class="me-stat-label">Gross (до налогов)</div>
          </div>
          <div class="me-stat glass-card">
            <mat-icon class="me-stat-icon ndfl">receipt_long</mat-icon>
            <div class="me-stat-value ndfl">{{ e.ndfl.ndfl_amount | number:'1.0-0' }} &#8381;</div>
            <div class="me-stat-label">НДФЛ ({{ e.ndfl.effective_rate | number:'1.1-1' }}%)</div>
          </div>
          <div class="me-stat glass-card">
            <mat-icon class="me-stat-icon net">account_balance_wallet</mat-icon>
            <div class="me-stat-value net">{{ e.net_earnings | number:'1.0-0' }} &#8381;</div>
            <div class="me-stat-label">На руки</div>
          </div>
          <div class="me-stat glass-card">
            <mat-icon class="me-stat-icon contrib">business</mat-icon>
            <div class="me-stat-value contrib">{{ e.employer_contributions.total | number:'1.0-0' }} &#8381;</div>
            <div class="me-stat-label">Соцвзносы</div>
          </div>
        </div>

        <!-- Breakdown -->
        <div class="me-breakdown glass-card">
          <h2 class="me-section-title">Разбивка дохода</h2>
          <div class="me-breakdown-table">
            <div class="me-brow">
              <span class="me-blabel">Оклад ({{ e.completed_shifts }}/{{ e.total_shifts }} смен x {{ e.daily_rate | number:'1.0-0' }} &#8381;)</span>
              <span class="me-bvalue">{{ e.base_pay | number:'1.0-0' }} &#8381;</span>
            </div>
            <div class="me-brow">
              <span class="me-blabel">POS комиссия ({{ e.commission_rate }}% от {{ e.pos_revenue | number:'1.0-0' }} &#8381;)</span>
              <span class="me-bvalue">{{ (e.pos_revenue * e.commission_rate / 100) | number:'1.0-0' }} &#8381;</span>
            </div>
            <div class="me-brow">
              <span class="me-blabel">Онлайн комиссия ({{ e.online_orders_count }} заказов, {{ e.online_revenue | number:'1.0-0' }} &#8381;)</span>
              <span class="me-bvalue">{{ e.online_commission | number:'1.0-0' }} &#8381;</span>
            </div>
            @if (e.trial_bonus > 0) {
              <div class="me-brow">
                <span class="me-blabel">Бонус за стажировку ({{ e.trial_shifts }} смен)</span>
                <span class="me-bvalue">{{ e.trial_bonus | number:'1.0-0' }} &#8381;</span>
              </div>
            }
            <div class="me-brow me-brow-total">
              <span class="me-blabel"><strong>Gross</strong></span>
              <span class="me-bvalue gross"><strong>{{ e.gross_earnings | number:'1.0-0' }} &#8381;</strong></span>
            </div>
            <div class="me-brow">
              <span class="me-blabel ndfl-label">НДФЛ</span>
              <span class="me-bvalue ndfl">-{{ e.ndfl.ndfl_amount | number:'1.0-0' }} &#8381;</span>
            </div>
            <div class="me-brow me-brow-total">
              <span class="me-blabel"><strong>На руки</strong></span>
              <span class="me-bvalue net"><strong>{{ e.net_earnings | number:'1.0-0' }} &#8381;</strong></span>
            </div>
          </div>
        </div>

        <!-- Pension points -->
        @if (e.pension_points.monthly > 0) {
          <div class="me-pension glass-card">
            <h2 class="me-section-title">Пенсионные баллы</h2>
            <div class="me-pension-grid">
              <div class="me-pension-item">
                <span class="me-pension-val">{{ e.pension_points.monthly | number:'1.2-2' }}</span>
                <span class="me-pension-lbl">за месяц</span>
              </div>
              <div class="me-pension-item">
                <span class="me-pension-val">{{ e.pension_points.ytd | number:'1.2-2' }}</span>
                <span class="me-pension-lbl">за год</span>
              </div>
              <div class="me-pension-item">
                <span class="me-pension-val">+{{ e.pension_points.estimated_monthly_pension_increment | number:'1.0-0' }} &#8381;</span>
                <span class="me-pension-lbl">к пенсии/мес</span>
              </div>
            </div>
          </div>
        }
        }
      }

      <!-- Payouts history -->
      <div class="me-payouts glass-card">
        <h2 class="me-section-title">История выплат</h2>
        @if (payoutsLoading()) {
          <div class="me-loading-inline">Загрузка...</div>
        } @else if (payouts().length === 0) {
          <div class="me-empty">Выплат пока нет</div>
        } @else {
          <div class="me-payouts-table">
            <div class="me-prow me-prow-header">
              <span class="me-pcol-period">Период</span>
              <span class="me-pcol-amount">Комиссия</span>
              <span class="me-pcol-net">На руки</span>
              <span class="me-pcol-status">Статус</span>
              <span class="me-pcol-date">Дата выплаты</span>
            </div>
            @for (p of payouts(); track p.id) {
              <div class="me-prow">
                <span class="me-pcol-period">{{ formatPeriod(p.period) }}</span>
                <span class="me-pcol-amount">{{ p.total_commission | number:'1.0-0' }} &#8381;</span>
                <span class="me-pcol-net">{{ p.net_amount !== null ? (p.net_amount | number:'1.0-0') + ' \u20BD' : '—' }}</span>
                <span class="me-pcol-status">
                  <span class="me-status-chip" [style.background]="statusColor(p.status)">
                    {{ statusLabel(p.status) }}
                  </span>
                </span>
                <span class="me-pcol-date">{{ p.paid_at ? formatDate(p.paid_at) : '—' }}</span>
              </div>
            }
          </div>
        }
      </div>

      <!-- Bank account -->
      <div class="me-bank glass-card">
        <div class="me-bank-header">
          <h2 class="me-section-title">Реквизиты для выплат</h2>
          @if (!editingBank() && bankAccount()) {
            <button mat-icon-button (click)="editingBank.set(true)" matTooltip="Редактировать">
              <mat-icon>edit</mat-icon>
            </button>
          }
        </div>

        @if (editingBank()) {
          <app-bank-account-form
            [account]="bankAccount()"
            (saved)="onBankSaved($event)"
            (cancelled)="editingBank.set(false)" />
        } @else {
          @if (bankAccount(); as ba) {
          <div class="me-bank-info">
            <div class="me-bank-row">
              <mat-icon>account_balance</mat-icon>
              <span class="me-bank-label">Банк</span>
              <span class="me-bank-value">{{ ba.bank_name ?? '—' }}</span>
            </div>
            <div class="me-bank-row">
              <mat-icon>credit_card</mat-icon>
              <span class="me-bank-label">Счёт / карта</span>
              <span class="me-bank-value">{{ ba.account_identifier ?? '—' }}</span>
            </div>
            <div class="me-bank-row">
              <mat-icon>person</mat-icon>
              <span class="me-bank-label">Получатель</span>
              <span class="me-bank-value">{{ ba.recipient_name }}</span>
            </div>
            <div class="me-bank-row">
              <mat-icon>sync</mat-icon>
              <span class="me-bank-label">Способ</span>
              <span class="me-bank-value">{{ ba.method === 'phone_transfer' ? 'По номеру телефона' : 'По номеру карты' }}</span>
            </div>
          </div>
          } @else {
          <div class="me-bank-empty">
            <p>Реквизиты не указаны</p>
            <button mat-stroked-button (click)="editingBank.set(true)">
              <mat-icon>add</mat-icon>
              Добавить реквизиты
            </button>
          </div>
          }
        }
      </div>
    </div>
  `,
  styles: `
    .me-page { padding: 16px; max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }

    .glass-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--crm-radius-lg, 12px);
      backdrop-filter: blur(12px);
    }

    .me-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px;
    }
    .me-header-left { display: flex; align-items: center; gap: 12px; }
    .me-header-icon { color: var(--crm-accent, #f59e0b); font-size: 28px; width: 28px; height: 28px; }
    .me-title { margin: 0; font-size: 20px; font-weight: 600; color: var(--crm-text-primary, #fff); }
    .me-month-nav { display: flex; align-items: center; gap: 4px; }
    .me-month-label {
      min-width: 140px; text-align: center; font-size: 15px; font-weight: 500;
      color: var(--crm-text-primary, #fff); text-transform: capitalize;
    }

    .me-loading, .me-error { padding: 40px; text-align: center; color: var(--crm-text-secondary, #999); }
    .me-error { color: var(--crm-status-error, #ef4444); }
    .me-loading-inline, .me-empty { padding: 20px; text-align: center; color: var(--crm-text-secondary, #999); font-size: 13px; }

    /* Summary */
    .me-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .me-stat { padding: 16px; text-align: center; }
    .me-stat-icon { font-size: 28px; width: 28px; height: 28px; margin-bottom: 8px; }
    .me-stat-icon.gross { color: var(--crm-text-primary, #fff); }
    .me-stat-icon.ndfl { color: var(--crm-status-error, #ef4444); }
    .me-stat-icon.net { color: #22c55e; }
    .me-stat-icon.contrib { color: #3b82f6; }
    .me-stat-value { font-size: 22px; font-weight: 700; color: var(--crm-text-primary, #fff); }
    .me-stat-value.ndfl { color: var(--crm-status-error, #ef4444); }
    .me-stat-value.net { color: #22c55e; }
    .me-stat-value.contrib { color: #3b82f6; }
    .me-stat-label { font-size: 12px; color: var(--crm-text-secondary, #999); margin-top: 4px; }

    /* Breakdown */
    .me-breakdown { padding: 20px; }
    .me-section-title {
      margin: 0 0 16px; font-size: 15px; font-weight: 600;
      color: var(--crm-text-primary, #fff);
    }
    .me-breakdown-table { display: flex; flex-direction: column; gap: 8px; }
    .me-brow {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; border-radius: 8px;
      font-size: 13px; color: var(--crm-text-primary, #fff);
    }
    .me-brow:hover { background: rgba(255,255,255,0.03); }
    .me-brow-total {
      background: rgba(255,255,255,0.06);
      border-top: 1px solid rgba(255,255,255,0.08);
      margin-top: 4px; padding-top: 12px;
    }
    .me-blabel { flex: 1; }
    .me-blabel.ndfl-label { color: var(--crm-status-error, #ef4444); }
    .me-bvalue { font-variant-numeric: tabular-nums; font-weight: 500; }
    .me-bvalue.gross { color: var(--crm-accent, #f59e0b); }
    .me-bvalue.ndfl { color: var(--crm-status-error, #ef4444); }
    .me-bvalue.net { color: #22c55e; }

    /* Pension */
    .me-pension { padding: 20px; }
    .me-pension-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .me-pension-item { text-align: center; }
    .me-pension-val { display: block; font-size: 20px; font-weight: 700; color: #3b82f6; }
    .me-pension-lbl { font-size: 12px; color: var(--crm-text-secondary, #999); }

    /* Payouts */
    .me-payouts { padding: 20px; }
    .me-payouts-table { display: flex; flex-direction: column; }
    .me-prow {
      display: grid; grid-template-columns: 1fr 1fr 1fr 120px 1fr;
      align-items: center; padding: 10px 12px; font-size: 13px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      color: var(--crm-text-primary, #fff);
    }
    .me-prow:hover { background: rgba(255,255,255,0.03); }
    .me-prow-header {
      font-size: 11px; font-weight: 500; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--crm-text-secondary, #999);
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .me-prow-header:hover { background: transparent; }
    .me-pcol-amount, .me-pcol-net { font-variant-numeric: tabular-nums; }
    .me-status-chip {
      display: inline-block; padding: 2px 10px; border-radius: 12px;
      font-size: 11px; font-weight: 600; color: #fff;
    }

    /* Bank */
    .me-bank { padding: 20px; }
    .me-bank-header { display: flex; align-items: center; justify-content: space-between; }
    .me-bank-info { display: flex; flex-direction: column; gap: 10px; }
    .me-bank-row {
      display: flex; align-items: center; gap: 12px; font-size: 14px;
      color: var(--crm-text-primary, #fff);

      mat-icon {
        font-size: 20px; width: 20px; height: 20px;
        color: var(--crm-text-muted, #9ca3af);
      }
    }
    .me-bank-label { color: var(--crm-text-secondary, #999); min-width: 120px; }
    .me-bank-value { font-weight: 500; }
    .me-bank-empty { text-align: center; padding: 16px; color: var(--crm-text-secondary, #999); }
    .me-bank-empty p { margin: 0 0 12px; }
  `,
})
export class MyEarningsComponent implements OnInit {
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly payrollApi = inject(PayrollApiService);

  readonly selectedMonth = signal(new Date());
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly earnings = signal<EmployeeEarnings | null>(null);
  readonly payouts = signal<PayoutRecord[]>([]);
  readonly payoutsLoading = signal(false);
  readonly bankAccount = signal<BankAccount | null>(null);
  readonly editingBank = signal(false);

  readonly monthLabel = computed(() => {
    const d = this.selectedMonth();
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  });

  readonly monthParam = computed(() => {
    const d = this.selectedMonth();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  ngOnInit(): void {
    this.loadEarnings();
    this.loadPayouts();
    this.loadBankAccount();
  }

  prevMonth(): void {
    const d = new Date(this.selectedMonth());
    d.setMonth(d.getMonth() - 1);
    this.selectedMonth.set(d);
    this.loadEarnings();
  }

  nextMonth(): void {
    const d = new Date(this.selectedMonth());
    d.setMonth(d.getMonth() + 1);
    this.selectedMonth.set(d);
    this.loadEarnings();
  }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  statusColor(status: string): string {
    return STATUS_COLORS[status] ?? '#999';
  }

  formatPeriod(period: string): string {
    const [year, month] = period.split('-');
    const d = new Date(Number(year), Number(month) - 1);
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  onBankSaved(account: BankAccount): void {
    this.bankAccount.set(account);
    this.editingBank.set(false);
  }

  private loadEarnings(): void {
    this.loading.set(true);
    this.error.set(null);
    this.shiftsApi.getMyEarnings(this.monthParam()).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.earnings.set(res.data);
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Ошибка загрузки';
        this.error.set(msg);
        this.loading.set(false);
      },
    });
  }

  private loadPayouts(): void {
    this.payoutsLoading.set(true);
    this.payrollApi.getMyPayouts().subscribe({
      next: (res) => {
        this.payouts.set(res.payouts ?? []);
        this.payoutsLoading.set(false);
      },
      error: () => {
        this.payoutsLoading.set(false);
      },
    });
  }

  private loadBankAccount(): void {
    this.payrollApi.getMyBankAccount().subscribe({
      next: (res) => {
        const primary = res.accounts?.find(a => a.is_primary) ?? res.accounts?.[0] ?? null;
        this.bankAccount.set(primary);
      },
    });
  }
}
