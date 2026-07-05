import {
  Component, ChangeDetectionStrategy, input, output, signal, computed, effect,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

interface VolumeCosts {
  a4_bw: number;
  a4_color: number;
  a3_bw: number;
  a3_color: number;
}

@Component({
  selector: 'app-cost-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatCardModule, MatButtonModule, MatIconModule],
  template: `
    <mat-card class="editor-card">
      <div class="editor-header">
        <mat-icon class="header-icon">analytics</mat-icon>
        <h3>Себестоимость страницы</h3>
      </div>

      <div class="table-wrap">
        <table class="summary-table">
          <thead>
            <tr>
              <th>Объём</th>
              <th>A4 ч/б</th>
              <th>A4 цвет</th>
              <th>A3 ч/б</th>
              <th>A3 цвет</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.label) {
              <tr [class.retail-row]="row.isRetail">
                <td class="cell-label">{{ row.label }}</td>
                <td [class]="cellClass(row.costs.a4_bw, retail()?.a4_bw, row.isRetail)">
                  {{ row.costs.a4_bw | number:'1.2-2' }} &#8381;
                </td>
                <td [class]="cellClass(row.costs.a4_color, retail()?.a4_color, row.isRetail)">
                  {{ row.costs.a4_color | number:'1.2-2' }} &#8381;
                </td>
                <td [class]="cellClass(row.costs.a3_bw, retail()?.a3_bw, row.isRetail)">
                  {{ row.costs.a3_bw | number:'1.2-2' }} &#8381;
                </td>
                <td [class]="cellClass(row.costs.a3_color, retail()?.a3_color, row.isRetail)">
                  {{ row.costs.a3_color | number:'1.2-2' }} &#8381;
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="legend">
        <span class="legend-item"><span class="dot dot-green"></span> Маржа > 50%</span>
        <span class="legend-item"><span class="dot dot-yellow"></span> Маржа > 30%</span>
        <span class="legend-item"><span class="dot dot-red"></span> Маржа &lt; 30%</span>
      </div>

      <div class="editor-actions">
        <button mat-flat-button class="recalc-btn" (click)="recalculate()">
          <mat-icon>refresh</mat-icon> Пересчитать
        </button>
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

    .table-wrap { overflow-x: auto; }
    .summary-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
      th {
        text-align: center; padding: 8px 12px; font-weight: 600; font-size: 11px;
        color: var(--crm-text-secondary); border-bottom: 1px solid rgba(255,255,255,0.08);
        &:first-child { text-align: left; }
      }
      td {
        text-align: center; padding: 8px 12px; font-variant-numeric: tabular-nums;
        border-bottom: 1px solid rgba(255,255,255,0.04);
        &:first-child { text-align: left; }
      }
    }
    .cell-label { font-weight: 600; color: var(--crm-text-primary); white-space: nowrap; }

    .cell-green { color: #22c55e; font-weight: 600; }
    .cell-yellow { color: #eab308; font-weight: 600; }
    .cell-red { color: #ef4444; font-weight: 600; }
    .cell-neutral { color: var(--crm-text-primary); }

    .retail-row {
      td { font-weight: 700; background: rgba(139,92,246,0.06); }
    }

    .legend {
      display: flex; gap: 16px; margin-top: 12px; font-size: 11px; color: var(--crm-text-secondary);
    }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-green { background: #22c55e; }
    .dot-yellow { background: #eab308; }
    .dot-red { background: #ef4444; }

    .editor-actions { display: flex; gap: 8px; margin-top: 16px; }
    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }
    .recalc-btn {
      background: rgba(255,255,255,0.08); color: var(--crm-text-primary);
      font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }
  `],
})
export class CostSummaryComponent {
  readonly data = input.required<Record<string, any>>();
  readonly allConfigs = input<Record<string, any>>();
  readonly save = output<Record<string, any>>();

  readonly editData = signal<Record<string, any>>({});

  constructor() {
    effect(() => this.editData.set(structuredClone(this.data())));
  }

  readonly retail = computed((): VolumeCosts | null => {
    return this.editData()['retail_prices'] ?? null;
  });

  readonly rows = computed(() => {
    const d = this.editData();
    const result: { label: string; costs: VolumeCosts; isRetail: boolean }[] = [];
    const volumeKeys: { key: string; label: string }[] = [
      { key: 'at_5k_pages', label: '5K стр/мес' },
      { key: 'at_50k_pages', label: '50K стр/мес' },
      { key: 'at_1m_pages', label: '1M стр/мес' },
    ];
    for (const v of volumeKeys) {
      const costs = d[v.key] ?? { a4_bw: 0, a4_color: 0, a3_bw: 0, a3_color: 0 };
      result.push({ label: v.label, costs, isRetail: false });
    }
    const r = d['retail_prices'] ?? { a4_bw: 0, a4_color: 0, a3_bw: 0, a3_color: 0 };
    result.push({ label: 'Розничная цена', costs: r, isRetail: true });
    return result;
  });

  cellClass(cost: number, retailPrice: number | undefined, isRetail: boolean): string {
    if (isRetail) return 'cell-neutral';
    if (!retailPrice || retailPrice <= 0) return 'cell-neutral';
    const margin = (retailPrice - cost) / retailPrice;
    if (margin > 0.5) return 'cell-green';
    if (margin > 0.3) return 'cell-yellow';
    return 'cell-red';
  }

  recalculate(): void {
    const configs = this.allConfigs();
    if (!configs) return;

    const paper = configs['laser_consumables']?.paper;
    const tonerTotal = configs['laser_consumables']?.toner_total_per_page;
    const equipment = configs['equipment']?.printer;
    const fixedTotal = configs['fixed_costs']?.total_fixed_estimate ?? 0;

    const a4Sheet = paper?.a4_80g?.per_sheet ?? 0;
    const a3Sheet = paper?.a3_80g?.per_sheet ?? 0;
    const bwToner = tonerTotal?.bw ?? 0;
    const colorToner = tonerTotal?.color ?? 0;
    const amort = equipment?.per_page_amortization ?? 0;

    const calcVolume = (volume: number): VolumeCosts => {
      const fixedPerPage = volume > 0 ? fixedTotal / volume : 0;
      return {
        a4_bw: a4Sheet + bwToner + amort + fixedPerPage,
        a4_color: a4Sheet + colorToner + amort + fixedPerPage,
        a3_bw: a3Sheet + bwToner + amort + fixedPerPage,
        a3_color: a3Sheet + colorToner + amort + fixedPerPage,
      };
    };

    this.editData.update(d => ({
      ...d,
      at_5k_pages: calcVolume(5000),
      at_50k_pages: calcVolume(50000),
      at_1m_pages: calcVolume(1000000),
    }));
  }

  onSave(): void {
    this.save.emit(this.editData());
  }
}
