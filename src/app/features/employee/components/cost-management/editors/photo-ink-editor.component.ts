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

const INK_COLORS: { key: string; label: string; dot: string }[] = [
  { key: 'black', label: 'Чёрный', dot: '#333' },
  { key: 'cyan', label: 'Голубой', dot: '#06b6d4' },
  { key: 'magenta', label: 'Пурпурный', dot: '#ec4899' },
  { key: 'yellow', label: 'Жёлтый', dot: '#eab308' },
  { key: 'light_cyan', label: 'Светло-голубой', dot: '#67e8f9' },
  { key: 'light_magenta', label: 'Светло-пурпурный', dot: '#f9a8d4' },
];

@Component({
  selector: 'app-photo-ink-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <mat-card class="editor-card">
      <div class="editor-header">
        <mat-icon class="header-icon">colorize</mat-icon>
        <h3>Чернила ({{ printerModel() }})</h3>
      </div>

      <!-- Принтер -->
      <div class="section-label">Принтер</div>
      <div class="info-row">
        <div class="info-item">
          <span class="info-label">Модель</span>
          <span class="info-value">{{ printerModel() }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Цена</span>
          <span class="info-value">{{ printerPrice() | number:'1.0-0' }} &#8381;</span>
        </div>
      </div>

      <!-- Чернила -->
      <div class="section-label">Чернила — {{ inkBrand() }}, {{ inkVolume() }} мл</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Цвет</th>
              <th>Цена за {{ inkVolume() }}мл (&#8381;)</th>
            </tr>
          </thead>
          <tbody>
            @for (color of inkColors; track color.key) {
              @if (getColor(color.key); as c) {
                <tr>
                  <td class="cell-label">
                    <span class="color-dot" [style.background]="color.dot"></span>
                    {{ color.label }}
                  </td>
                  <td>
                    <input class="cell-input cell-num" type="number"
                           [(ngModel)]="c.price"
                           (ngModelChange)="markDirty()" />
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <div class="computed-row">
        <div class="computed-item">
          <span class="computed-label">6 бутылок</span>
          <span class="computed-value">{{ totalBottles() | number:'1.0-0' }} &#8381;</span>
        </div>
        <div class="computed-item">
          <span class="computed-label">Стоимость за мл</span>
          <span class="computed-value">{{ costPerMl() | number:'1.2-4' }} &#8381;</span>
        </div>
      </div>

      <!-- Расход -->
      <div class="section-label">Расход чернил</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Формат</th>
              <th>Чернил (мл)</th>
              <th class="col-auto">Стоимость чернил</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of yieldEntries(); track entry.key) {
              <tr>
                <td class="cell-label">{{ yieldLabel(entry.key) }}</td>
                <td>
                  <input class="cell-input cell-num" type="number" step="0.01"
                         [(ngModel)]="entry.value.ink_ml"
                         (ngModelChange)="markDirty()" />
                </td>
                <td class="col-auto cell-computed">
                  {{ calcInkCost(entry.value) | number:'1.2-4' }} &#8381;
                </td>
              </tr>
            }
          </tbody>
        </table>
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

    .info-row { display: flex; gap: 24px; margin-bottom: 8px; }
    .info-item { display: flex; flex-direction: column; gap: 2px; }
    .info-label { font-size: 11px; color: var(--crm-text-secondary); }
    .info-value { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); }

    .table-wrap { overflow-x: auto; }
    .data-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
      th {
        text-align: left; padding: 6px 8px; font-weight: 600; font-size: 11px;
        color: var(--crm-text-secondary); border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      td { padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); }
    }
    .col-auto { text-align: right; white-space: nowrap; }
    .cell-label { font-weight: 500; color: var(--crm-text-primary); white-space: nowrap; }
    .cell-input {
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px; padding: 4px 8px; color: var(--crm-text-primary);
      font-size: 13px; width: 100%; box-sizing: border-box;
      &:focus { border-color: var(--crm-accent); outline: none; }
    }
    .cell-num { width: 120px; text-align: right; }
    .cell-computed {
      font-weight: 600; color: var(--crm-accent); text-align: right; font-size: 12px;
    }

    .color-dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      margin-right: 4px; vertical-align: middle;
    }

    .computed-row {
      display: flex; gap: 24px; margin-top: 12px; padding: 10px 12px;
      border-radius: 6px; background: rgba(139,92,246,0.08);
    }
    .computed-item { display: flex; flex-direction: column; gap: 2px; }
    .computed-label { font-size: 11px; color: var(--crm-text-secondary); }
    .computed-value { font-size: 14px; font-weight: 600; color: var(--crm-accent); }

    .editor-actions { display: flex; gap: 8px; margin-top: 16px; }
    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }
  `],
})
export class PhotoInkEditorComponent {
  readonly data = input.required<Record<string, any>>();
  readonly save = output<Record<string, any>>();

  readonly editData = signal<Record<string, any>>({});
  readonly inkColors = INK_COLORS;

  constructor() {
    effect(() => this.editData.set(structuredClone(this.data())));
  }

  readonly printerModel = computed(() => this.editData()['printer']?.model ?? '');
  readonly printerPrice = computed(() => this.editData()['printer']?.purchase_price ?? 0);
  readonly inkBrand = computed(() => this.editData()['ink_set']?.brand ?? '');
  readonly inkVolume = computed(() => this.editData()['ink_set']?.volume_ml ?? 500);

  readonly totalBottles = computed(() => {
    const colors = this.editData()['ink_set']?.colors;
    if (!colors) return 0;
    return INK_COLORS.reduce((sum, c) => sum + (colors[c.key]?.price || 0), 0);
  });

  readonly costPerMl = computed(() => {
    const total = this.totalBottles();
    const totalMl = INK_COLORS.length * this.inkVolume();
    return totalMl > 0 ? total / totalMl : 0;
  });

  readonly yieldEntries = computed(() => {
    const y = this.editData()['estimated_yield'];
    if (!y) return [];
    return Object.keys(y).map(key => ({ key, value: y[key] }));
  });

  getColor(key: string): any {
    return this.editData()['ink_set']?.colors?.[key] ?? null;
  }

  calcInkCost(entry: any): number {
    return (entry.ink_ml || 0) * this.costPerMl();
  }

  yieldLabel(key: string): string {
    const map: Record<string, string> = {
      '10x15_photo': 'Фото 10x15',
      'a4_photo': 'Фото A4',
    };
    return map[key] ?? key;
  }

  markDirty(): void {
    this.editData.update(d => ({ ...d }));
  }

  onSave(): void {
    const d = this.editData();
    const cpm = this.costPerMl();
    if (d['ink_set']) {
      d['ink_set'].total_6_bottles = this.totalBottles();
      d['ink_set'].total_volume_ml = INK_COLORS.length * this.inkVolume();
      d['ink_set'].cost_per_ml = cpm;
    }
    if (d['estimated_yield']) {
      for (const key of Object.keys(d['estimated_yield'])) {
        d['estimated_yield'][key].ink_cost = (d['estimated_yield'][key].ink_ml || 0) * cpm;
      }
    }
    this.save.emit(d);
  }
}
