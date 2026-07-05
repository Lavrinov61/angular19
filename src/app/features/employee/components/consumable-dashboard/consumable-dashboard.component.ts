import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import {
  PrintApiService, ConsumableStock, ConsumableAlert, ConsumableTransaction,
  CreateConsumableStockDto, RefillConsumableDto,
} from '../../services/print-api.service';

interface BridgeDevice {
  id: string;
  name: string;
  is_online: boolean;
}

const CONSUMABLE_LABELS: Record<string, string> = {
  cyan: 'Голубой', magenta: 'Пурпурный', yellow: 'Жёлтый', black: 'Чёрный',
  photo_black: 'Фото чёрный', light_cyan: 'Свет. голубой', light_magenta: 'Свет. пурпурный',
  paper_10x15: 'Бумага 10x15', paper_13x18: 'Бумага 13x18', paper_a4: 'Бумага A4',
  toner_black: 'Тонер чёрный', toner_color: 'Тонер цветной', drum: 'Барабан',
};

const INK_COLORS: Record<string, string> = {
  cyan: '#22d3ee', magenta: '#f472b6', yellow: '#fbbf24', black: '#4b5563',
  photo_black: '#1f2937', light_cyan: '#67e8f9', light_magenta: '#f9a8d4',
};

@Component({
  selector: 'app-consumable-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, DatePipe, DecimalPipe,
    MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatProgressBarModule,
    MatTooltipModule, MatDividerModule,
  ],
  template: `
    <div class="cd-page">
      <div class="cd-header">
        <div>
          <h2 class="cd-title">Расходники</h2>
          <p class="cd-subtitle">Уровни запасов, алерты, заправки</p>
        </div>
        <button mat-flat-button class="add-btn" (click)="showAddForm.set(!showAddForm())">
          <mat-icon>add</mat-icon> Добавить
        </button>
      </div>

      <!-- Alerts -->
      @if (alerts().length > 0) {
        <mat-card class="cd-alerts-card">
          <div class="alerts-header">
            <mat-icon class="alert-icon">warning</mat-icon>
            <span>Низкий уровень ({{ alerts().length }})</span>
          </div>
          <div class="alerts-list">
            @for (a of alerts(); track a.id) {
              <div class="alert-row">
                <span class="alert-type" [style.color]="inkColor(a.consumable_type)">
                  {{ consumableLabel(a.consumable_type) }}
                </span>
                <span class="alert-station">{{ a.station_name }}</span>
                <span class="alert-level">
                  {{ a.current_amount | number:'1.0-1' }} / {{ a.low_threshold | number:'1.0-0' }} {{ a.unit }}
                </span>
                @if (a.percent_remaining !== null && a.percent_remaining !== undefined) {
                  <span class="alert-percent" [class.critical]="a.percent_remaining < 10">
                    {{ a.percent_remaining | number:'1.0-1' }}%
                  </span>
                }
              </div>
            }
          </div>
        </mat-card>
      }

      <!-- Add form -->
      @if (showAddForm()) {
        <mat-card class="cd-form-card">
          <div class="form-title">Новый расходник</div>
          <form [formGroup]="addForm" (ngSubmit)="addStock()" class="cd-form">
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Станция</mat-label>
                <mat-select formControlName="station_id">
                  @for (d of devices(); track d.id) {
                    <mat-option [value]="d.id">{{ d.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Тип расходника</mat-label>
                <mat-select formControlName="consumable_type">
                  @for (ct of consumableTypes; track ct) {
                    <mat-option [value]="ct">{{ consumableLabel(ct) }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Текущее кол-во</mat-label>
                <input matInput type="number" formControlName="current_amount" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Макс. ёмкость</mat-label>
                <input matInput type="number" formControlName="max_capacity" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Ед. изм.</mat-label>
                <input matInput formControlName="unit" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Мин. порог</mat-label>
                <input matInput type="number" formControlName="low_threshold" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Цена за ед.</mat-label>
                <input matInput type="number" formControlName="cost_per_unit" />
                <span matTextSuffix>&#8381;</span>
              </mat-form-field>
            </div>
            <div class="form-actions">
              <button mat-flat-button type="submit" [disabled]="addForm.invalid || saving()" class="save-btn">
                @if (saving()) { <mat-spinner diameter="16" /> }
                @else { <mat-icon>save</mat-icon> }
                Создать
              </button>
              <button mat-button type="button" (click)="showAddForm.set(false)">Отмена</button>
            </div>
          </form>
        </mat-card>
      }

      <!-- Refill dialog -->
      @if (refillingId()) {
        <mat-card class="cd-form-card">
          <div class="form-title">Заправка: {{ refillingName() }}</div>
          <form [formGroup]="refillForm" (ngSubmit)="doRefill()" class="cd-form">
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Количество</mat-label>
                <input matInput type="number" formControlName="amount" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-lg">
                <mat-label>Комментарий</mat-label>
                <input matInput formControlName="notes" placeholder="Заправка синих чернил" />
              </mat-form-field>
            </div>
            <div class="form-actions">
              <button mat-flat-button type="submit" [disabled]="refillForm.invalid || saving()" class="save-btn">
                @if (saving()) { <mat-spinner diameter="16" /> }
                @else { <mat-icon>local_gas_station</mat-icon> }
                Заправить
              </button>
              <button mat-button type="button" (click)="refillingId.set(null)">Отмена</button>
            </div>
          </form>
        </mat-card>
      }

      <!-- Stock list -->
      @if (loading()) {
        <div class="cd-loading"><mat-spinner diameter="32" /></div>
      } @else if (stocks().length === 0) {
        <div class="cd-empty">
          <mat-icon>water_drop</mat-icon>
          <span>Расходники не добавлены</span>
        </div>
      } @else {
        <div class="cd-list">
          @for (s of stocksByStation(); track s.stationId) {
            <div class="station-group">
              <div class="station-header">
                <mat-icon class="station-icon">dns</mat-icon>
                <span class="station-name">{{ s.stationName || 'Без станции' }}</span>
              </div>
              <div class="stock-grid">
                @for (item of s.items; track item.id) {
                  <mat-card class="stock-card" [class.stock-low]="isLow(item)">
                    <div class="stock-card__header">
                      <div class="stock-type-row">
                        <span class="stock-dot" [style.background]="inkColor(item.consumable_type)"></span>
                        <span class="stock-type">{{ consumableLabel(item.consumable_type) }}</span>
                      </div>
                      <button mat-icon-button matTooltip="Заправить"
                              (click)="startRefill(item)" class="refill-btn">
                        <mat-icon>local_gas_station</mat-icon>
                      </button>
                    </div>

                    <div class="stock-bar-container">
                      <mat-progress-bar
                        [mode]="'determinate'"
                        [value]="stockPercent(item)"
                        [color]="isLow(item) ? 'warn' : 'primary'"
                      />
                      <span class="stock-percent-label">{{ stockPercent(item) | number:'1.0-0' }}%</span>
                    </div>

                    <div class="stock-values">
                      <span>{{ item.current_amount | number:'1.0-1' }} {{ item.unit }}</span>
                      @if (item.max_capacity) {
                        <span class="stock-max">/ {{ item.max_capacity | number:'1.0-0' }}</span>
                      }
                    </div>

                    @if (item.cost_per_unit) {
                      <div class="stock-cost">
                        {{ item.cost_per_unit | number:'1.2-2' }} &#8381;/{{ item.unit }}
                      </div>
                    }

                    @if (item.last_refilled_at) {
                      <div class="stock-refilled">
                        <mat-icon class="meta-icon">schedule</mat-icon>
                        {{ item.last_refilled_at | date:'dd.MM HH:mm' }}
                      </div>
                    }
                  </mat-card>
                }
              </div>
            </div>
          }
        </div>

        <!-- Transaction log -->
        @if (transactions().length > 0) {
          <mat-card class="cd-transactions-card">
            <div class="txn-header">
              <mat-icon>receipt_long</mat-icon>
              <span>Последние операции</span>
            </div>
            <div class="txn-list">
              @for (tx of transactions(); track tx.id) {
                <div class="txn-row">
                  <span class="txn-type" [class.txn-refill]="tx.transaction_type === 'refill'"
                        [class.txn-usage]="tx.transaction_type === 'usage'">
                    {{ tx.transaction_type === 'refill' ? '+' : '-' }}{{ tx.amount | number:'1.0-1' }}
                  </span>
                  <span class="txn-notes">{{ tx.notes || tx.transaction_type }}</span>
                  <span class="txn-date">{{ tx.created_at | date:'dd.MM HH:mm' }}</span>
                </div>
              }
            </div>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [`
    .cd-page { max-width: 900px; margin: 0 auto; padding: 20px 16px; }

    .cd-header {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px;
    }

    .cd-title { font-size: 18px; font-weight: 600; color: var(--crm-text-primary); margin: 0 0 2px; }
    .cd-subtitle { font-size: 12px; color: var(--crm-text-secondary); margin: 0; }

    .add-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }

    /* ── ALERTS ── */

    .cd-alerts-card {
      background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2);
      border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;
    }

    .alerts-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
      font-size: 13px; font-weight: 600; color: #f87171;
    }

    .alert-icon { font-size: 18px; width: 18px; height: 18px; }

    .alerts-list { display: flex; flex-direction: column; gap: 6px; }

    .alert-row {
      display: flex; align-items: center; gap: 10px; font-size: 12px;
      padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,0.2);
    }

    .alert-type { font-weight: 600; min-width: 120px; }
    .alert-station { color: var(--crm-text-secondary); flex: 1; }
    .alert-level { font-family: var(--crm-font-mono, monospace); font-size: 11px; color: var(--crm-text-secondary); }
    .alert-percent { font-weight: 600; color: #fbbf24; }
    .alert-percent.critical { color: #f87171; }

    /* ── FORMS ── */

    .cd-form-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.07);
      padding: 20px; margin-bottom: 16px; border-radius: 8px;
    }

    .form-title { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); margin-bottom: 16px; }
    .cd-form { display: flex; flex-direction: column; gap: 4px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .field-lg { flex: 2; min-width: 200px; }
    .field-md { flex: 1; min-width: 160px; }
    .field-sm { flex: 1; min-width: 90px; }

    .form-actions {
      display: flex; gap: 8px; align-items: center; padding-top: 8px;
    }

    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      mat-spinner { display: inline-block; }
    }

    /* ── STOCK ── */

    .cd-loading, .cd-empty {
      display: flex; align-items: center; justify-content: center; gap: 12px;
      padding: 48px; color: var(--crm-text-secondary); font-size: 14px;
      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
    }

    .cd-list { display: flex; flex-direction: column; gap: 20px; }

    .station-group { }

    .station-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
    }

    .station-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-text-secondary); }
    .station-name { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); }

    .stock-grid {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
      @media (min-width: 700px) { grid-template-columns: repeat(3, 1fr); }
    }

    .stock-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px; padding: 12px 14px; transition: border-color 150ms;
    }

    .stock-low { border-color: rgba(248,113,113,0.3); }

    .stock-card__header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
    }

    .stock-type-row { display: flex; align-items: center; gap: 6px; }
    .stock-dot { width: 8px; height: 8px; border-radius: 50%; }
    .stock-type { font-size: 12px; font-weight: 600; color: var(--crm-text-primary); }

    .refill-btn {
      width: 28px; height: 28px; margin: -4px -6px 0 0;
      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-accent); }
    }

    .stock-bar-container {
      display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
      mat-progress-bar { flex: 1; }
    }

    .stock-percent-label { font-size: 11px; font-weight: 600; color: var(--crm-text-secondary); min-width: 32px; text-align: right; }

    .stock-values { font-size: 13px; color: var(--crm-text-primary); margin-bottom: 2px; }
    .stock-max { color: var(--crm-text-secondary); font-size: 12px; }

    .stock-cost {
      font-size: 11px; color: var(--crm-text-secondary); margin-top: 2px;
    }

    .stock-refilled {
      display: flex; align-items: center; gap: 4px;
      font-size: 10px; color: var(--crm-text-secondary); margin-top: 4px;
    }

    .meta-icon { font-size: 12px; width: 12px; height: 12px; }

    /* ── TRANSACTIONS ── */

    .cd-transactions-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px; padding: 14px 16px; margin-top: 20px;
    }

    .txn-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
      font-size: 13px; font-weight: 600; color: var(--crm-text-primary);
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-text-secondary); }
    }

    .txn-list { display: flex; flex-direction: column; gap: 4px; }

    .txn-row {
      display: flex; align-items: center; gap: 10px; font-size: 12px;
      padding: 4px 8px; border-radius: 4px; background: rgba(255,255,255,0.02);
    }

    .txn-type { font-weight: 700; font-family: var(--crm-font-mono, monospace); min-width: 60px; }
    .txn-refill { color: #34d399; }
    .txn-usage { color: #f87171; }
    .txn-notes { flex: 1; color: var(--crm-text-secondary); }
    .txn-date { font-size: 11px; color: var(--crm-text-secondary); }
  `],
})
export class ConsumableDashboardComponent implements OnInit {
  private readonly api = inject(PrintApiService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);

  readonly stocks = signal<ConsumableStock[]>([]);
  readonly alerts = signal<ConsumableAlert[]>([]);
  readonly transactions = signal<ConsumableTransaction[]>([]);
  readonly devices = signal<BridgeDevice[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly showAddForm = signal(false);
  readonly refillingId = signal<string | null>(null);
  readonly refillingName = signal('');

  readonly consumableTypes = Object.keys(CONSUMABLE_LABELS);

  readonly stocksByStation = computed(() => {
    const grouped = new Map<string, { stationId: string; stationName: string; items: ConsumableStock[] }>();
    for (const s of this.stocks()) {
      const key = s.station_id;
      if (!grouped.has(key)) {
        grouped.set(key, { stationId: key, stationName: s.station_name ?? '', items: [] });
      }
      grouped.get(key)!.items.push(s);
    }
    return [...grouped.values()];
  });

  readonly addForm: FormGroup = this.fb.group({
    station_id: ['', Validators.required],
    consumable_type: ['cyan', Validators.required],
    current_amount: [0],
    max_capacity: [null as number | null],
    unit: ['ml'],
    low_threshold: [null as number | null],
    cost_per_unit: [null as number | null],
  });

  readonly refillForm: FormGroup = this.fb.group({
    amount: [0, [Validators.required, Validators.min(0.1)]],
    notes: [''],
  });

  ngOnInit(): void {
    this.loadAll();
  }

  private loadAll(): void {
    this.loading.set(true);
    this.api.getConsumableStock().subscribe({
      next: stocks => { this.stocks.set(stocks); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.api.getConsumableAlerts().subscribe({
      next: alerts => this.alerts.set(alerts),
    });
    this.api.getConsumableTransactions(undefined, 30).subscribe({
      next: txns => this.transactions.set(txns),
    });
    this.http.get<{ success: boolean; bridges: BridgeDevice[] }>('/api/print/bridges').subscribe({
      next: res => this.devices.set(res.bridges ?? []),
    });
  }

  consumableLabel(type: string): string {
    return CONSUMABLE_LABELS[type] ?? type;
  }

  inkColor(type: string): string {
    return INK_COLORS[type] ?? '#9ca3af';
  }

  stockPercent(item: ConsumableStock): number {
    if (!item.max_capacity || item.max_capacity <= 0) return 50;
    return Math.min(100, Math.max(0, (item.current_amount / item.max_capacity) * 100));
  }

  isLow(item: ConsumableStock): boolean {
    return item.low_threshold != null && item.current_amount <= item.low_threshold;
  }

  startRefill(item: ConsumableStock): void {
    this.refillingId.set(item.id);
    this.refillingName.set(this.consumableLabel(item.consumable_type));
    this.refillForm.reset({ amount: 0, notes: '' });
  }

  addStock(): void {
    if (this.addForm.invalid || this.saving()) return;
    this.saving.set(true);

    const v = this.addForm.value;
    const dto: CreateConsumableStockDto = {
      station_id: v.station_id, consumable_type: v.consumable_type,
      current_amount: v.current_amount, max_capacity: v.max_capacity,
      unit: v.unit || 'ml', low_threshold: v.low_threshold,
      cost_per_unit: v.cost_per_unit,
    };

    this.api.createConsumableStock(dto).subscribe({
      next: stock => {
        this.stocks.update(list => [...list, stock]);
        this.saving.set(false);
        this.showAddForm.set(false);
      },
      error: () => this.saving.set(false),
    });
  }

  doRefill(): void {
    const id = this.refillingId();
    if (!id || this.refillForm.invalid || this.saving()) return;
    this.saving.set(true);

    const dto: RefillConsumableDto = {
      amount: this.refillForm.value.amount,
      notes: this.refillForm.value.notes || undefined,
    };

    this.api.refillConsumable(id, dto).subscribe({
      next: stock => {
        this.stocks.update(list => list.map(s => s.id === id ? stock : s));
        this.saving.set(false);
        this.refillingId.set(null);
        // Refresh alerts and transactions
        this.api.getConsumableAlerts().subscribe({ next: alerts => this.alerts.set(alerts) });
        this.api.getConsumableTransactions(undefined, 30).subscribe({ next: txns => this.transactions.set(txns) });
      },
      error: () => this.saving.set(false),
    });
  }
}
