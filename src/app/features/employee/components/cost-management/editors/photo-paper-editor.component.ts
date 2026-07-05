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
  selector: 'app-photo-paper-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <mat-card class="editor-card">
      <div class="editor-header">
        <mat-icon class="header-icon">photo_library</mat-icon>
        <h3>Фотобумага (закупочные цены)</h3>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Название</th>
              <th>Листов</th>
              <th>Цена (&#8381;)</th>
              <th class="col-auto">За лист</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of entries(); track entry.key) {
              <tr>
                <td>
                  <input class="cell-input" [(ngModel)]="entry.value.name"
                         (ngModelChange)="markDirty()" />
                </td>
                <td>
                  <input class="cell-input cell-num" type="number"
                         [(ngModel)]="entry.value.sheets"
                         (ngModelChange)="markDirty()" />
                </td>
                <td>
                  <input class="cell-input cell-num" type="number"
                         [(ngModel)]="entry.value.price"
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

      <div class="summary-row">
        {{ entries().length }} позиций
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

    .summary-row {
      margin-top: 12px; font-size: 12px; color: var(--crm-text-secondary);
    }

    .editor-actions { display: flex; gap: 8px; margin-top: 16px; }
    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }
  `],
})
export class PhotoPaperEditorComponent {
  readonly data = input.required<Record<string, any>>();
  readonly save = output<Record<string, any>>();

  readonly editData = signal<Record<string, any>>({});

  constructor() {
    effect(() => this.editData.set(structuredClone(this.data())));
  }

  readonly entries = computed(() => {
    const d = this.editData();
    return Object.keys(d).map(key => ({ key, value: d[key] }));
  });

  calcPerSheet(paper: any): number {
    return paper.sheets > 0 ? (paper.price || 0) / paper.sheets : 0;
  }

  markDirty(): void {
    this.editData.update(d => ({ ...d }));
  }

  onSave(): void {
    const d = this.editData();
    for (const key of Object.keys(d)) {
      d[key].per_sheet = this.calcPerSheet(d[key]);
    }
    this.save.emit(d);
  }
}
