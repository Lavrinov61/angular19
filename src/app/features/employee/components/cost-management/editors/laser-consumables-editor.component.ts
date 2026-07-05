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
  selector: 'app-laser-consumables-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <mat-card class="editor-card">
      <div class="editor-header">
        <mat-icon class="header-icon">print</mat-icon>
        <h3>Лазерные расходники</h3>
      </div>

      <!-- Бумага -->
      <div class="section-label">Бумага</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Тип</th>
              <th>Бренд</th>
              <th>Пачек</th>
              <th>Листов</th>
              <th>Цена (&#8381;)</th>
              <th class="col-auto">За лист</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of paperEntries(); track entry.key) {
              <tr>
                <td class="cell-label">{{ entry.key }}</td>
                <td>
                  <input class="cell-input" [(ngModel)]="entry.value.brand"
                         (ngModelChange)="markDirty()" />
                </td>
                <td>
                  <input class="cell-input cell-num" type="number"
                         [(ngModel)]="entry.value.pack_count"
                         (ngModelChange)="markDirty()" />
                </td>
                <td>
                  <input class="cell-input cell-num" type="number"
                         [(ngModel)]="entry.value.pack_sheets"
                         (ngModelChange)="markDirty()" />
                </td>
                <td>
                  <input class="cell-input cell-num" type="number"
                         [(ngModel)]="entry.value.total_price"
                         (ngModelChange)="markDirty()" />
                </td>
                <td class="col-auto cell-computed">
                  {{ calcPerSheet(entry.value) | number:'1.2-4' }} &#8381;
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Тонер -->
      <div class="section-label">Тонер</div>
      <div class="toner-meta">
        <span class="meta-label">Модель:</span> {{ tonerModel() }}
        <span class="meta-sep">|</span>
        <span class="meta-label">Тип:</span> {{ tonerType() }}
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Цвет</th>
              <th>Артикул</th>
              <th>Цена (&#8381;)</th>
              <th>Ресурс (стр)</th>
              <th class="col-auto">За стр</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of tonerEntries(); track entry.key) {
              <tr>
                <td class="cell-label">
                  <span class="color-dot" [style.background]="colorDot(entry.key)"></span>
                  {{ colorLabel(entry.key) }}
                </td>
                <td>
                  <input class="cell-input" [(ngModel)]="entry.value.part"
                         (ngModelChange)="markDirty()" />
                </td>
                <td>
                  <input class="cell-input cell-num" type="number"
                         [(ngModel)]="entry.value.price"
                         (ngModelChange)="markDirty()" />
                </td>
                <td>
                  <input class="cell-input cell-num" type="number"
                         [(ngModel)]="entry.value.yield_pages"
                         (ngModelChange)="markDirty()" />
                </td>
                <td class="col-auto cell-computed">
                  {{ calcPerPage(entry.value) | number:'1.4-4' }} &#8381;
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="toner-summary">
        <span>Тонер ч/б: <strong>{{ bwCost() | number:'1.4-4' }} &#8381;/стр</strong></span>
        <span class="meta-sep">|</span>
        <span>Цвет: <strong>{{ colorCost() | number:'1.4-4' }} &#8381;/стр</strong></span>
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
    .cell-num { width: 90px; text-align: right; }
    .cell-computed {
      font-weight: 600; color: var(--crm-accent); text-align: right; font-size: 12px;
    }

    .toner-meta {
      font-size: 12px; color: var(--crm-text-secondary); margin-bottom: 8px;
    }
    .meta-label { font-weight: 600; }
    .meta-sep { margin: 0 8px; opacity: 0.4; }

    .color-dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      margin-right: 4px; vertical-align: middle;
    }

    .toner-summary {
      margin-top: 12px; padding: 10px 12px; border-radius: 6px;
      background: rgba(139,92,246,0.08); font-size: 13px; color: var(--crm-text-primary);
    }

    .editor-actions { display: flex; gap: 8px; margin-top: 16px; }
    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }
  `],
})
export class LaserConsumablesEditorComponent {
  readonly data = input.required<Record<string, any>>();
  readonly save = output<Record<string, any>>();

  readonly editData = signal<Record<string, any>>({});

  constructor() {
    effect(() => this.editData.set(structuredClone(this.data())));
  }

  readonly paperEntries = computed(() => {
    const paper = this.editData()['paper'];
    if (!paper) return [];
    return Object.keys(paper).map(key => ({ key, value: paper[key] }));
  });

  readonly tonerModel = computed(() => this.editData()['toner']?.model ?? '');
  readonly tonerType = computed(() => this.editData()['toner']?.type ?? '');

  readonly tonerEntries = computed(() => {
    const toner = this.editData()['toner'];
    if (!toner) return [];
    return ['black', 'cyan', 'magenta', 'yellow']
      .filter(k => toner[k])
      .map(key => ({ key, value: toner[key] }));
  });

  readonly bwCost = computed(() => {
    const black = this.editData()['toner']?.['black'];
    return black ? this.calcPerPage(black) : 0;
  });

  readonly colorCost = computed(() => {
    const toner = this.editData()['toner'];
    if (!toner) return 0;
    const colors = ['cyan', 'magenta', 'yellow'].filter(k => toner[k]);
    const total = colors.reduce((sum, k) => sum + this.calcPerPage(toner[k]), 0);
    return this.bwCost() + total;
  });

  calcPerSheet(paper: any): number {
    const count = (paper.pack_count || 0) * (paper.pack_sheets || 0);
    return count > 0 ? (paper.total_price || 0) / count : 0;
  }

  calcPerPage(toner: any): number {
    return toner.yield_pages > 0 ? (toner.price || 0) / toner.yield_pages : 0;
  }

  colorDot(key: string): string {
    const map: Record<string, string> = {
      black: '#333', cyan: '#06b6d4', magenta: '#ec4899', yellow: '#eab308',
    };
    return map[key] ?? '#888';
  }

  colorLabel(key: string): string {
    const map: Record<string, string> = {
      black: 'Чёрный', cyan: 'Голубой', magenta: 'Пурпурный', yellow: 'Жёлтый',
    };
    return map[key] ?? key;
  }

  markDirty(): void {
    this.editData.update(d => ({ ...d }));
  }

  onSave(): void {
    const d = this.editData();
    if (d['paper']) {
      for (const key of Object.keys(d['paper'])) {
        d['paper'][key].per_sheet = this.calcPerSheet(d['paper'][key]);
      }
    }
    if (d['toner']) {
      for (const color of ['black', 'cyan', 'magenta', 'yellow']) {
        if (d['toner'][color]) {
          d['toner'][color].per_page = this.calcPerPage(d['toner'][color]);
        }
      }
    }
    d['toner_total_per_page'] = { bw: this.bwCost(), color: this.colorCost() };
    this.save.emit(d);
  }
}
