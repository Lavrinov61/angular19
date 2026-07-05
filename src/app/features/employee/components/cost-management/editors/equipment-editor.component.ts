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
import { MatChipsModule } from '@angular/material/chips';

@Component({
  selector: 'app-equipment-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    <mat-card class="editor-card">
      <div class="editor-header">
        <mat-icon class="header-icon">precision_manufacturing</mat-icon>
        <h3>Оборудование</h3>
      </div>

      @if (printer(); as p) {
        <div class="fields-grid">
          <div class="field-group">
            <label class="field-label" for="eq-model">Модель</label>
            <input id="eq-model" class="field-input" [(ngModel)]="p.model" (ngModelChange)="markDirty()" />
          </div>
          <div class="field-group">
            <label class="field-label" for="eq-type">Тип</label>
            <input id="eq-type" class="field-input" [(ngModel)]="p.type" (ngModelChange)="markDirty()" />
          </div>
          <div class="field-group">
            <label class="field-label" for="eq-price">Цена (&#8381;)</label>
            <input id="eq-price" class="field-input field-num" type="number"
                   [(ngModel)]="p.purchase_price" (ngModelChange)="markDirty()" />
          </div>
          <div class="field-group">
            <label class="field-label" for="eq-lifecycle">Ресурс (стр)</label>
            <input id="eq-lifecycle" class="field-input field-num" type="number"
                   [(ngModel)]="p.estimated_lifecycle_pages" (ngModelChange)="markDirty()" />
          </div>
          <div class="field-group">
            <label class="field-label" for="eq-speed">Скорость (стр/мин)</label>
            <input id="eq-speed" class="field-input field-num" type="number"
                   [(ngModel)]="p.speed_ppm" (ngModelChange)="markDirty()" />
          </div>
          <div class="field-group">
            <label class="field-label" for="eq-duty">Макс. нагрузка (стр/мес)</label>
            <input id="eq-duty" class="field-input field-num" type="number"
                   [(ngModel)]="p.max_monthly_duty" (ngModelChange)="markDirty()" />
          </div>
        </div>

        <div class="amortization-block">
          <mat-icon>calculate</mat-icon>
          <span>Амортизация: <strong>{{ amortization() | number:'1.4-4' }} &#8381;/стр</strong></span>
        </div>

        @if (features().length) {
          <div class="section-label">Возможности</div>
          <mat-chip-set class="chip-set">
            @for (feat of features(); track feat) {
              <mat-chip>{{ feat }}</mat-chip>
            }
          </mat-chip-set>
        }

        @if (paperSizes().length) {
          <div class="section-label">Форматы бумаги</div>
          <mat-chip-set class="chip-set">
            @for (size of paperSizes(); track size) {
              <mat-chip>{{ size }}</mat-chip>
            }
          </mat-chip-set>
        }
      }

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

    .fields-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }
    .field-group { display: flex; flex-direction: column; gap: 4px; }
    .field-label { font-size: 11px; font-weight: 600; color: var(--crm-text-secondary); }
    .field-input {
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px; padding: 8px 10px; color: var(--crm-text-primary);
      font-size: 13px; width: 100%; box-sizing: border-box;
      &:focus { border-color: var(--crm-accent); outline: none; }
    }
    .field-num { font-variant-numeric: tabular-nums; }

    .amortization-block {
      display: flex; align-items: center; gap: 8px; margin-top: 16px;
      padding: 10px 12px; border-radius: 6px; background: rgba(139,92,246,0.08);
      font-size: 13px; color: var(--crm-text-primary);
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent); }
    }

    .chip-set { display: flex; flex-wrap: wrap; gap: 4px; }

    .editor-actions { display: flex; gap: 8px; margin-top: 16px; }
    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }
  `],
})
export class EquipmentEditorComponent {
  readonly data = input.required<Record<string, any>>();
  readonly save = output<Record<string, any>>();

  readonly editData = signal<Record<string, any>>({});

  constructor() {
    effect(() => this.editData.set(structuredClone(this.data())));
  }

  readonly printer = computed(() => this.editData()['printer'] ?? null);

  readonly amortization = computed(() => {
    const p = this.printer();
    if (!p || !p.estimated_lifecycle_pages) return 0;
    return (p.purchase_price || 0) / p.estimated_lifecycle_pages;
  });

  readonly features = computed(() => {
    const p = this.printer();
    return Array.isArray(p?.features) ? p.features : [];
  });

  readonly paperSizes = computed(() => {
    const p = this.printer();
    return Array.isArray(p?.paper_sizes) ? p.paper_sizes : [];
  });

  markDirty(): void {
    this.editData.update(d => ({ ...d }));
  }

  onSave(): void {
    const d = this.editData();
    if (d['printer']) {
      d['printer'].per_page_amortization = this.amortization();
    }
    this.save.emit(d);
  }
}
