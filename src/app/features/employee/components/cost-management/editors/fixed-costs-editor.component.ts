import {
  Component, ChangeDetectionStrategy, input, output, signal, computed, effect,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-fixed-costs-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <mat-card class="editor-card">
      <div class="editor-header">
        <mat-icon class="header-icon">account_balance</mat-icon>
        <h3>Постоянные расходы</h3>
      </div>

      <!-- Аренда -->
      <div class="section-label">Аренда</div>
      <div class="cost-row">
        <div class="field-group field-lg">
          <label class="field-label" for="fc-rent-amount">Сумма (&#8381;/мес)</label>
          <input id="fc-rent-amount" class="field-input field-num" type="number"
                 [ngModel]="rent()?.amount"
                 (ngModelChange)="updateRent('amount', $event)" />
        </div>
        <div class="field-group field-lg">
          <label class="field-label" for="fc-rent-note">Примечание</label>
          <input id="fc-rent-note" class="field-input"
                 [ngModel]="rent()?.note"
                 (ngModelChange)="updateRent('note', $event)" />
        </div>
      </div>

      <!-- Персонал -->
      <div class="section-label">Персонал</div>
      <div class="cost-row">
        <div class="field-group">
          <label class="field-label" for="fc-staff-rate">Ставка (&#8381;/день)</label>
          <input id="fc-staff-rate" class="field-input field-num" type="number"
                 [ngModel]="staff()?.daily_rate"
                 (ngModelChange)="updateStaff('daily_rate', $event)" />
        </div>
        <div class="field-group">
          <label class="field-label" for="fc-staff-hours">Часов/день</label>
          <input id="fc-staff-hours" class="field-input field-num" type="number"
                 [ngModel]="staff()?.hours"
                 (ngModelChange)="updateStaff('hours', $event)" />
        </div>
        <div class="field-group">
          <span class="field-label computed-label-inline">В месяц (авто)</span>
          <div class="computed-inline">{{ staffMonthly() | number:'1.0-0' }} &#8381;</div>
        </div>
      </div>

      <!-- Электричество -->
      <div class="section-label">Электричество</div>
      <div class="cost-row">
        <div class="field-group">
          <label class="field-label" for="fc-elec-rate">Тариф (&#8381;/кВт&#183;ч)</label>
          <input id="fc-elec-rate" class="field-input field-num" type="number" step="0.01"
                 [ngModel]="electricity()?.rate_per_kwh"
                 (ngModelChange)="updateElectricity('rate_per_kwh', $event)" />
        </div>
        <div class="field-group">
          <label class="field-label" for="fc-elec-consumption">Потребление принтера (кВт)</label>
          <input id="fc-elec-consumption" class="field-input field-num" type="number" step="0.01"
                 [ngModel]="electricity()?.printer_consumption_kw"
                 (ngModelChange)="updateElectricity('printer_consumption_kw', $event)" />
        </div>
        <div class="field-group">
          <span class="field-label computed-label-inline">В месяц (авто)</span>
          <div class="computed-inline">{{ electricityMonthly() | number:'1.0-0' }} &#8381;</div>
        </div>
      </div>

      <!-- Итого -->
      <div class="total-block">
        <mat-icon>functions</mat-icon>
        <span>Итого постоянные расходы: <strong>{{ totalFixed() | number:'1.0-0' }} &#8381;/мес</strong></span>
      </div>

      <div class="editor-actions">
        <button mat-flat-button class="save-btn" (click)="onSave()">
          <mat-icon>save</mat-icon> Сохранить
        </button>
      </div>
    </mat-card>
  `,
  styles: [`
    .editor-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.07);
      padding: 20px; border-radius: 8px;
    }
    .editor-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
      h3 { font-size: 16px; font-weight: 600; color: var(--crm-text-primary); margin: 0; }
    }
    .header-icon { color: var(--crm-accent); font-size: 20px; width: 20px; height: 20px; }

    .section-label {
      font-size: 11px; font-weight: 600; color: var(--crm-text-secondary);
      text-transform: uppercase; letter-spacing: 0.05em; margin: 16px 0 8px;
    }

    .cost-row {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;
    }
    .field-group { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
    .field-lg { min-width: 200px; }
    .field-label { font-size: 11px; font-weight: 600; color: var(--crm-text-secondary); }
    .field-input {
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px; padding: 8px 10px; color: var(--crm-text-primary);
      font-size: 13px; width: 100%; box-sizing: border-box;
      &:focus { border-color: var(--crm-accent); outline: none; }
    }
    .field-num { font-variant-numeric: tabular-nums; }

    .computed-label-inline { color: var(--crm-accent); }
    .computed-inline {
      font-size: 16px; font-weight: 600; color: var(--crm-accent);
      padding: 6px 0;
    }

    .total-block {
      display: flex; align-items: center; gap: 8px; margin-top: 20px;
      padding: 12px 14px; border-radius: 6px;
      background: rgba(139,92,246,0.12); border: 1px solid rgba(139,92,246,0.25);
      font-size: 14px; color: var(--crm-text-primary);
      mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--crm-accent); }
    }

    .editor-actions { display: flex; gap: 8px; margin-top: 16px; }
    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }
  `],
})
export class FixedCostsEditorComponent {
  readonly data = input.required<Record<string, any>>();
  readonly save = output<Record<string, any>>();

  readonly editData = signal<Record<string, any>>({});

  constructor() {
    effect(() => this.editData.set(structuredClone(this.data())));
  }

  readonly rent = computed(() => this.editData()['rent'] ?? null);
  readonly staff = computed(() => this.editData()['staff'] ?? null);
  readonly electricity = computed(() => this.editData()['electricity'] ?? null);

  readonly staffMonthly = computed(() => {
    const s = this.staff();
    return s ? (s.daily_rate || 0) * 30 : 0;
  });

  readonly electricityMonthly = computed(() => {
    const e = this.electricity();
    if (!e) return 0;
    return (e.printer_consumption_kw || 0) * 8 * 30 * (e.rate_per_kwh || 0);
  });

  readonly totalFixed = computed(() => {
    const rentAmt = this.rent()?.amount || 0;
    return rentAmt + this.staffMonthly() + this.electricityMonthly();
  });

  updateRent(field: string, value: any): void {
    this.editData.update(d => ({
      ...d, rent: { ...d['rent'], [field]: value },
    }));
  }

  updateStaff(field: string, value: any): void {
    this.editData.update(d => ({
      ...d, staff: { ...d['staff'], [field]: value },
    }));
  }

  updateElectricity(field: string, value: any): void {
    this.editData.update(d => ({
      ...d, electricity: { ...d['electricity'], [field]: value },
    }));
  }

  onSave(): void {
    const d = this.editData();
    if (d['staff']) {
      d['staff'].monthly_estimate = this.staffMonthly();
    }
    if (d['electricity']) {
      d['electricity'].monthly_estimate = this.electricityMonthly();
    }
    d['total_fixed_estimate'] = this.totalFixed();
    this.save.emit(d);
  }
}
