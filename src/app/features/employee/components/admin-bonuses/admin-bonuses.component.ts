import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { ShiftsApiService, AdminEmployeeEarnings } from '../../services/shifts-api.service';
import { PayrollApiService, PayoutRecord } from '../../services/payroll-api.service';
import { AdminCommissionSummaryComponent } from './admin-commission-summary.component';
import { ToastService } from '../../../../core/services/toast.service';

const NDFL_RATE = 0.13;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  employee: 'Сотрудник',
  photographer: 'Фотограф',
};

@Component({
  selector: 'app-admin-bonuses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule, AdminCommissionSummaryComponent],
  host: { class: 'admin-bonuses-host' },
  template: `
    <div class="ab-page">
      <!-- Header -->
      <header class="ab-header glass-card">
        <div class="ab-header-left">
          <mat-icon class="ab-header-icon">payments</mat-icon>
          <h1 class="ab-title">Бонусы и зарплаты</h1>
        </div>
        <div class="ab-month-nav">
          <button mat-icon-button (click)="prevMonth()">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <span class="ab-month-label">{{ monthLabel() }}</span>
          <button mat-icon-button (click)="nextMonth()">
            <mat-icon>chevron_right</mat-icon>
          </button>
        </div>
      </header>

      <!-- Summary cards -->
      <div class="ab-summary">
        <div class="ab-stat glass-card">
          <div class="ab-stat-value">{{ allEarnings().length }}</div>
          <div class="ab-stat-label">Сотрудников</div>
        </div>
        <div class="ab-stat glass-card">
          <div class="ab-stat-value">{{ totals().revenue | number:'1.0-0' }} &#8381;</div>
          <div class="ab-stat-label">Общая выручка</div>
        </div>
        <div class="ab-stat glass-card">
          <div class="ab-stat-value">{{ totals().totalEarnings | number:'1.0-0' }} &#8381;</div>
          <div class="ab-stat-label">ФОТ (gross)</div>
        </div>
        <div class="ab-stat glass-card">
          <div class="ab-stat-value">{{ totals().netPay | number:'1.0-0' }} &#8381;</div>
          <div class="ab-stat-label">ФОТ (на руки)</div>
        </div>
      </div>

      <!-- Commission Summary -->
      @if (allEarnings().length > 0) {
        <app-admin-commission-summary [earnings]="allEarnings()" />
      }

      <!-- Table -->
      @if (loading()) {
        <div class="ab-loading glass-card">Загрузка...</div>
      } @else if (error()) {
        <div class="ab-error glass-card">{{ error() }}</div>
      } @else {
        <div class="ab-table-wrap glass-card">
          <div class="ab-table-scroll">
            <table class="ab-table">
              <thead>
                <tr>
                  <th class="ab-th-name">Сотрудник</th>
                  <th>Роль</th>
                  <th class="ab-th-num">Ставка</th>
                  <th class="ab-th-num">%</th>
                  <th class="ab-th-num">Смен</th>
                  <th class="ab-th-num">POS</th>
                  <th class="ab-th-num">Доп.</th>
                  <th class="ab-th-num">Онлайн</th>
                  <th class="ab-th-num">Выручка</th>
                  <th class="ab-th-num">Оклад</th>
                  <th class="ab-th-num">Комиссия</th>
                  <th class="ab-th-num">Gross</th>
                  <th class="ab-th-num">НДФЛ</th>
                  <th class="ab-th-num">На руки</th>
                  <th>Статус</th>
                  <th>Реквизиты</th>
                  <th class="ab-th-action"></th>
                </tr>
              </thead>
              <tbody>
                @for (e of allEarnings(); track e.employee_id) {
                  <tr class="ab-row">
                    <td class="ab-td-name">
                      <div class="ab-avatar" [matTooltip]="e.display_name">
                        {{ initials(e.display_name) }}
                      </div>
                      <span>{{ e.display_name }}</span>
                    </td>
                    <td class="ab-td-role">{{ roleLabel(e.role) }}</td>

                    @if (editingId() === e.employee_id) {
                      <td class="ab-td-num">
                        <input type="number" class="ab-input" [(ngModel)]="editRate" min="0" step="100">
                      </td>
                      <td class="ab-td-num">
                        <input type="number" class="ab-input ab-input-sm" [(ngModel)]="editCommission" min="0" max="100" step="1">
                      </td>
                    } @else {
                      <td class="ab-td-num">{{ e.daily_rate | number:'1.0-0' }} &#8381;</td>
                      <td class="ab-td-num">{{ e.commission_rate }}%</td>
                    }

                    <td class="ab-td-num">{{ e.completed_shifts }}/{{ e.total_shifts }}</td>
                    <td class="ab-td-num ab-pos">{{ e.pos_revenue | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-manual">
                      <input type="number" class="ab-input ab-input-manual"
                             [ngModel]="e.manual_revenue"
                             (ngModelChange)="onManualChange(e.employee_id, $event)"
                             (blur)="saveManual(e.employee_id)"
                             min="0" step="100"
                             placeholder="0">
                    </td>
                    <td class="ab-td-num ab-online">{{ e.online_revenue | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-revenue"><strong>{{ e.revenue | number:'1.0-0' }}</strong></td>
                    <td class="ab-td-num">{{ e.base_pay | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-commission">{{ e.commission | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-gross">{{ e.total_earnings | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-ndfl">{{ ndfl(e.total_earnings) | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-net">{{ netPay(e.total_earnings) | number:'1.0-0' }}</td>
                    <td class="ab-td-status">
                      @if (getPayoutForEmployee(e.employee_id); as p) {
                        <span class="ab-status-chip" [class]="'ab-status-' + p.status">
                          {{ payoutStatusLabel(p.status) }}
                        </span>
                      } @else {
                        <span class="ab-status-chip ab-status-draft">Черновик</span>
                      }
                    </td>
                    <td class="ab-td-bank">
                      @if (getPayoutForEmployee(e.employee_id)?.payout_account; as acc) {
                        <span class="ab-bank-brief">{{ acc.bank_name ?? '' }} {{ acc.recipient_name }}</span>
                      } @else {
                        <span class="ab-bank-none">—</span>
                      }
                    </td>
                    <td class="ab-td-action">
                      @if (editingId() === e.employee_id) {
                        <button mat-icon-button class="ab-btn-save" (click)="saveRate(e.employee_id)" [disabled]="saving()">
                          <mat-icon>check</mat-icon>
                        </button>
                        <button mat-icon-button class="ab-btn-cancel" (click)="cancelEdit()">
                          <mat-icon>close</mat-icon>
                        </button>
                      } @else {
                        <button mat-icon-button class="ab-btn-edit" (click)="startEdit(e)" matTooltip="Изменить ставку">
                          <mat-icon>edit</mat-icon>
                        </button>
                        @if (getPayoutForEmployee(e.employee_id); as p) {
                          @if (p.status === 'draft') {
                            <button mat-icon-button class="ab-btn-approve" (click)="approvePayout(p)" matTooltip="Одобрить" [disabled]="saving()">
                              <mat-icon>thumb_up</mat-icon>
                            </button>
                          }
                          @if (p.status === 'approved') {
                            <button mat-icon-button class="ab-btn-pay" (click)="openPayDialog(p)" matTooltip="Оплатить">
                              <mat-icon>payment</mat-icon>
                            </button>
                          }
                        }
                      }
                    </td>
                  </tr>
                }
              </tbody>
              @if (allEarnings().length > 0) {
                <tfoot>
                  <tr class="ab-row ab-row-total">
                    <td class="ab-td-name"><strong>Итого</strong></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td class="ab-td-num">{{ totals().shifts }}</td>
                    <td class="ab-td-num ab-pos">{{ totals().posRevenue | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-manual">{{ totals().manualRevenue | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-online">{{ totals().onlineRevenue | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-revenue"><strong>{{ totals().revenue | number:'1.0-0' }}</strong></td>
                    <td class="ab-td-num">{{ totals().basePay | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-commission"><strong>{{ totals().commission | number:'1.0-0' }}</strong></td>
                    <td class="ab-td-num ab-gross"><strong>{{ totals().totalEarnings | number:'1.0-0' }}</strong></td>
                    <td class="ab-td-num ab-ndfl">{{ totals().ndfl | number:'1.0-0' }}</td>
                    <td class="ab-td-num ab-net"><strong>{{ totals().netPay | number:'1.0-0' }}</strong></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .ab-page { padding: 16px; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }

    .glass-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--crm-radius-lg, 12px);
      backdrop-filter: blur(12px);
    }

    .ab-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px;
    }
    .ab-header-left { display: flex; align-items: center; gap: 12px; }
    .ab-header-icon { color: var(--crm-accent, #f59e0b); font-size: 28px; width: 28px; height: 28px; }
    .ab-title { margin: 0; font-size: 20px; font-weight: 600; color: var(--crm-text-primary, #fff); }
    .ab-month-nav { display: flex; align-items: center; gap: 4px; }
    .ab-month-label { min-width: 140px; text-align: center; font-size: 15px; font-weight: 500; color: var(--crm-text-primary, #fff); text-transform: capitalize; }

    .ab-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .ab-stat { padding: 16px; text-align: center; }
    .ab-stat-value { font-size: 22px; font-weight: 700; color: var(--crm-text-primary, #fff); }
    .ab-stat-label { font-size: 12px; color: var(--crm-text-secondary, #999); margin-top: 4px; }

    .ab-loading, .ab-error { padding: 40px; text-align: center; color: var(--crm-text-secondary, #999); }
    .ab-error { color: var(--crm-status-error, #ef4444); }

    .ab-table-wrap { padding: 0; overflow: hidden; }
    .ab-table-scroll { overflow-x: auto; }
    .ab-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
      color: var(--crm-text-primary, #fff);
    }
    .ab-table thead { border-bottom: 1px solid rgba(255,255,255,0.08); }
    .ab-table th {
      padding: 10px 12px; font-weight: 500; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--crm-text-secondary, #999);
      white-space: nowrap;
    }
    .ab-th-name { text-align: left; }
    .ab-th-num { text-align: right; }
    .ab-th-action { width: 70px; }

    .ab-row { border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s; }
    .ab-row:hover { background: rgba(255,255,255,0.03); }
    .ab-row-total { background: rgba(255,255,255,0.06); border-top: 2px solid rgba(255,255,255,0.12); }

    .ab-td-name { padding: 10px 12px; display: flex; align-items: center; gap: 10px; white-space: nowrap; }
    .ab-td-role { padding: 10px 8px; font-size: 11px; color: var(--crm-text-secondary, #999); }
    .ab-td-num { padding: 10px 12px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ab-td-action { padding: 6px 8px; display: flex; gap: 2px; justify-content: center; }

    .ab-avatar {
      width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 600;
      background: linear-gradient(135deg, var(--crm-accent, #f59e0b), #e67e22);
      color: #fff; flex-shrink: 0;
    }

    .ab-pos { color: var(--crm-text-secondary, #999); }
    .ab-manual { color: #a78bfa; }
    .ab-online { color: var(--mat-sys-tertiary, #6D63FF); }
    .ab-revenue { color: var(--crm-accent, #f59e0b); }
    .ab-commission { color: #3b82f6; }
    .ab-gross { color: var(--crm-text-primary, #fff); }
    .ab-ndfl { color: var(--crm-status-error, #ef4444); }
    .ab-net { color: #22c55e; }

    .ab-input {
      width: 80px; padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.06); color: var(--crm-text-primary, #fff);
      font-size: 13px; text-align: right; font-variant-numeric: tabular-nums;
    }
    .ab-input:focus { outline: none; border-color: var(--crm-accent, #f59e0b); }
    .ab-input-sm { width: 56px; }
    .ab-input-manual {
      width: 80px; padding: 4px 8px; border-radius: 6px;
      border: 1px solid rgba(167,139,250,0.3);
      background: rgba(167,139,250,0.08); color: #a78bfa;
      font-size: 13px; text-align: right; font-variant-numeric: tabular-nums;
    }
    .ab-input-manual:focus { outline: none; border-color: #a78bfa; }

    .ab-td-status { padding: 10px 8px; }
    .ab-td-bank { padding: 10px 8px; font-size: 11px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ab-bank-brief { color: var(--crm-text-secondary, #999); }
    .ab-bank-none { color: var(--crm-text-muted, #666); }

    .ab-status-chip {
      display: inline-block; padding: 2px 10px; border-radius: 12px;
      font-size: 11px; font-weight: 600; color: #fff;
    }
    .ab-status-draft { background: #f59e0b; }
    .ab-status-approved { background: #3b82f6; }
    .ab-status-paid { background: #22c55e; }

    .ab-btn-edit { opacity: 0.4; transition: opacity 0.15s; }
    .ab-btn-edit:hover { opacity: 1; }
    .ab-btn-save { color: #22c55e; }
    .ab-btn-cancel { color: var(--crm-status-error, #ef4444); }
    .ab-btn-approve { color: #3b82f6; opacity: 0.7; transition: opacity 0.15s; }
    .ab-btn-approve:hover { opacity: 1; }
    .ab-btn-pay { color: #22c55e; opacity: 0.7; transition: opacity 0.15s; }
    .ab-btn-pay:hover { opacity: 1; }

    @media (max-width: 768px) {
      .ab-summary { grid-template-columns: repeat(2, 1fr); }
      .ab-header { flex-direction: column; gap: 12px; }
    }
  `,
})
export class AdminBonusesComponent implements OnInit {
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly payrollApi = inject(PayrollApiService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);

  readonly selectedMonth = signal(new Date());
  readonly allEarnings = signal<AdminEmployeeEarnings[]>([]);
  readonly payoutsMap = signal<Map<string, PayoutRecord>>(new Map());
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);

  editRate = 0;
  editCommission = 0;

  /** Pending manual revenue changes (employee_id → amount) */
  private pendingManual = new Map<string, number>();

  readonly monthLabel = computed(() => {
    const d = this.selectedMonth();
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  });

  readonly monthParam = computed(() => {
    const d = this.selectedMonth();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  readonly totals = computed(() => {
    const list = this.allEarnings();
    let posRevenue = 0, manualRevenue = 0, onlineRevenue = 0, revenue = 0, basePay = 0, commission = 0, totalEarnings = 0, shifts = 0;
    for (const e of list) {
      posRevenue += e.pos_revenue;
      manualRevenue += e.manual_revenue;
      onlineRevenue += e.online_revenue ?? 0;
      revenue += e.revenue;
      basePay += e.base_pay;
      commission += e.commission;
      totalEarnings += e.total_earnings;
      shifts += e.completed_shifts;
    }
    const ndfl = Math.round(totalEarnings * NDFL_RATE);
    const netPay = totalEarnings - ndfl;
    return { posRevenue, manualRevenue, onlineRevenue, revenue, basePay, commission, totalEarnings, ndfl, netPay, shifts };
  });

  ngOnInit(): void {
    this.loadData();
  }

  prevMonth(): void {
    const d = new Date(this.selectedMonth());
    d.setMonth(d.getMonth() - 1);
    this.selectedMonth.set(d);
    this.loadData();
  }

  nextMonth(): void {
    const d = new Date(this.selectedMonth());
    d.setMonth(d.getMonth() + 1);
    this.selectedMonth.set(d);
    this.loadData();
  }

  initials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  roleLabel(role: string): string {
    return ROLE_LABELS[role] ?? role;
  }

  ndfl(gross: number): number {
    return Math.round(gross * NDFL_RATE);
  }

  netPay(gross: number): number {
    return gross - Math.round(gross * NDFL_RATE);
  }

  startEdit(e: AdminEmployeeEarnings): void {
    this.editingId.set(e.employee_id);
    this.editRate = e.daily_rate;
    this.editCommission = e.commission_rate;
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveRate(employeeId: string): void {
    this.saving.set(true);
    this.shiftsApi.updateCompensation(employeeId, {
      daily_rate: this.editRate,
      commission_rate: this.editCommission,
    }).subscribe({
      next: () => {
        this.editingId.set(null);
        this.saving.set(false);
        this.loadData();
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }

  onManualChange(employeeId: string, value: number): void {
    this.pendingManual.set(employeeId, value || 0);
  }

  saveManual(employeeId: string): void {
    const amount = this.pendingManual.get(employeeId);
    if (amount === undefined) return;
    this.pendingManual.delete(employeeId);

    this.shiftsApi.upsertManualRevenue({
      employee_id: employeeId,
      month: this.monthParam(),
      amount,
    }).subscribe({
      next: () => this.loadData(),
    });
  }

  getPayoutForEmployee(employeeId: string): PayoutRecord | undefined {
    return this.payoutsMap().get(employeeId);
  }

  payoutStatusLabel(status: string): string {
    const labels: Record<string, string> = { draft: 'Черновик', approved: 'Одобрено', paid: 'Выплачено' };
    return labels[status] ?? status;
  }

  approvePayout(p: PayoutRecord): void {
    this.saving.set(true);
    this.payrollApi.markPaid(p.id, {
      payment_method: 'approval_only',
      net_amount: p.total_commission,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Выплата одобрена');
        this.loadPayouts();
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Не удалось одобрить');
      },
    });
  }

  openPayDialog(p: PayoutRecord): void {
    import('./payout-mark-paid-dialog.component').then(m => {
      const ref = this.dialog.open(m.PayoutMarkPaidDialogComponent, {
        data: { payout: p },
        panelClass: 'dark-dialog',
      });
      ref.afterClosed().subscribe(result => {
        if (result) this.loadPayouts();
      });
    });
  }

  private loadData(): void {
    this.loading.set(true);
    this.error.set(null);
    this.pendingManual.clear();
    this.shiftsApi.getAdminEarnings(this.monthParam()).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.allEarnings.set(res.data);
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Ошибка загрузки';
        this.error.set(msg);
        this.loading.set(false);
      },
    });
    this.loadPayouts();
  }

  private loadPayouts(): void {
    this.payrollApi.getPayouts(this.monthParam()).subscribe({
      next: (res) => {
        const map = new Map<string, PayoutRecord>();
        for (const p of res.payouts ?? []) {
          map.set(p.employee_id, p);
        }
        this.payoutsMap.set(map);
      },
    });
  }
}
