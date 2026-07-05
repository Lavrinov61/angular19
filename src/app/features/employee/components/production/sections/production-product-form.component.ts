import {
  Component, inject, signal, computed, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import {
  ProductionApiService, PrintingHouseProduct, ProductReferenceData, CategoryAttributeConfig,
} from '../../../services/production-api.service';
import { CATEGORY_LABELS, UNIT_LABELS, CATEGORY_ATTRIBUTE_SCHEMA } from '../production.constants';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';

interface PriceModEntry {
  type: 'absolute' | 'percent' | 'multiplier';
  value: number;
  lead_time_delta: number;
}

@Component({
  selector: 'app-production-product-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatCheckboxModule, MatSlideToggleModule,
    MatProgressSpinnerModule, MatExpansionModule, MatTooltipModule,
    MatSnackBarModule, FormsModule,
  ],
  template: `
    <div class="dialog-header">
      <div class="dialog-title-wrap">
        <span class="dialog-title">{{ product ? 'Редактировать продукт' : 'Новый продукт' }}</span>
        @if (houseName) {
          <span class="house-badge">{{ houseName }}</span>
        }
      </div>
      <button mat-icon-button mat-dialog-close aria-label="Закрыть"><mat-icon>close</mat-icon></button>
    </div>

    <mat-dialog-content class="dialog-content">
      <!-- ── Секция 1: Основные поля ── -->
      <div class="section-label">ОСНОВНОЕ</div>
      <div class="form-grid">
        <mat-form-field class="span-2">
          <mat-label>Название *</mat-label>
          <input matInput [(ngModel)]="form.name" name="name" required />
          <mat-error>Обязательное поле</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Категория</mat-label>
          <mat-select [(ngModel)]="form.category" name="category" (ngModelChange)="onCategoryChange($event)">
            @for (entry of categoryEntries; track entry[0]) {
              <mat-option [value]="entry[0]">{{ entry[1] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>SKU</mat-label>
          <input matInput [(ngModel)]="form.sku" name="sku" placeholder="Код в типографии" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Базовая цена (₽) *</mat-label>
          <input matInput [(ngModel)]="form.base_price" name="base_price" type="number" min="0" required />
          <mat-error>Обязательное поле</mat-error>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Единица</mat-label>
          <mat-select [(ngModel)]="form.price_unit" name="price_unit">
            @for (entry of unitEntries; track entry[0]) {
              <mat-option [value]="entry[0]">{{ entry[1] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Срок пр-ва (дн.)</mat-label>
          <input matInput [(ngModel)]="form.lead_time_days" name="lead_time_days" type="number" min="0" />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Мин. кол-во</mat-label>
          <input matInput [(ngModel)]="form.min_quantity" name="min_quantity" type="number" min="1" />
        </mat-form-field>
      </div>

      <div class="form-row-wrap">
        <mat-checkbox [(ngModel)]="form.express_available" name="express_available">
          Экспресс-производство
        </mat-checkbox>
        @if (form.express_available) {
          <mat-form-field subscriptSizing="dynamic" class="express-pct">
            <mat-label>Наценка (%)</mat-label>
            <input matInput [(ngModel)]="form.express_surcharge_pct" name="express_surcharge_pct" type="number" />
          </mat-form-field>
        }
        <mat-checkbox [(ngModel)]="form.is_active" name="is_active">Активен</mat-checkbox>
      </div>

      <mat-form-field class="full-width" subscriptSizing="dynamic">
        <mat-label>Примечание</mat-label>
        <textarea matInput [(ngModel)]="form.notes" name="notes" rows="2"></textarea>
      </mat-form-field>

      <!-- ── Секция 2: Спецификации ── -->
      @if (categorySchema().length > 0) {
        <div class="section-divider"></div>
        <div class="section-label">
          СПЕЦИФИКАЦИИ
          @if (loadingRef()) {
            <mat-spinner diameter="12" class="inline-spinner"></mat-spinner>
          }
        </div>
        <div class="specs-grid">
          @for (attr of categorySchema(); track attr.key) {
            <!-- Multiselect -->
            @if (attr.type === 'multiselect' && refByType()[attr.refType ?? '']?.length) {
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>{{ attr.label }}</mat-label>
                <mat-select multiple
                  [ngModel]="specValues()[attr.key]"
                  (ngModelChange)="setSpecValues(attr.key, $event)"
                  [name]="'spec_' + attr.key">
                  @for (item of refByType()[attr.refType ?? '']; track item.ref_key) {
                    <mat-option [value]="item.ref_key">{{ item.display_name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
            <!-- Range -->
            @if (attr.type === 'range') {
              <div class="range-field">
                <span class="range-label">{{ attr.label }}</span>
                <div class="range-inputs">
                  <mat-form-field subscriptSizing="dynamic" class="range-input">
                    <mat-label>от</mat-label>
                    <input matInput type="number" min="1"
                      [ngModel]="rangeValues()[attr.key]?.min ?? 0"
                      (ngModelChange)="setRange(attr.key, 'min', $event)"
                      [name]="'range_min_' + attr.key" />
                  </mat-form-field>
                  <mat-form-field subscriptSizing="dynamic" class="range-input">
                    <mat-label>до</mat-label>
                    <input matInput type="number" min="1"
                      [ngModel]="rangeValues()[attr.key]?.max ?? 0"
                      (ngModelChange)="setRange(attr.key, 'max', $event)"
                      [name]="'range_max_' + attr.key" />
                  </mat-form-field>
                </div>
              </div>
            }
            <!-- Boolean toggle -->
            @if (attr.type === 'boolean') {
              <div class="toggle-field">
                <mat-slide-toggle
                  [ngModel]="boolValues()[attr.key]"
                  (ngModelChange)="setBool(attr.key, $event)"
                  [name]="'bool_' + attr.key">
                  {{ attr.label }}
                </mat-slide-toggle>
              </div>
            }
          }
        </div>
      }

      <!-- ── Секция 3: Модификаторы цен ── -->
      @if (modifierEntries().length > 0) {
        <div class="section-divider"></div>
        <mat-expansion-panel class="modifiers-panel">
          <mat-expansion-panel-header>
            <mat-panel-title class="panel-title">
              <mat-icon class="panel-icon">tune</mat-icon>
              Модификаторы цен
            </mat-panel-title>
            <mat-panel-description class="panel-desc">
              {{ activeModifiersCount() }} из {{ modifierEntries().length }} настроено
            </mat-panel-description>
          </mat-expansion-panel-header>

          <div class="modifiers-hint">
            Укажите надбавки или множители для каждой опции относительно базовой цены <strong>{{ form.base_price }} ₽</strong>.
          </div>

          <div class="modifiers-table">
            <div class="mod-header">
              <span>Опция</span><span>Тип</span><span>Значение</span><span>+Дни</span>
            </div>
            @for (entry of modifierEntries(); track entry.key) {
              <div class="mod-row" [class.mod-active]="priceModifiers()[entry.key]">
                <span class="mod-option-label">{{ entry.label }}</span>
                <select class="mod-select"
                  [ngModel]="priceModifiers()[entry.key]?.type ?? ''"
                  (ngModelChange)="setModType(entry.key, $event)"
                  [name]="'mod_type_' + entry.key">
                  <option value="">—</option>
                  <option value="absolute">+ ₽</option>
                  <option value="percent">+ %</option>
                  <option value="multiplier">× коэф.</option>
                </select>
                @if (priceModifiers()[entry.key]) {
                  <input class="mod-input" type="number" step="any"
                    [ngModel]="priceModifiers()[entry.key]!.value"
                    (ngModelChange)="setModValue(entry.key, 'value', $event)"
                    [name]="'mod_val_' + entry.key"
                    [placeholder]="modValuePlaceholder(priceModifiers()[entry.key]!.type)" />
                  <input class="mod-input mod-days" type="number" min="0"
                    [ngModel]="priceModifiers()[entry.key]!.lead_time_delta"
                    (ngModelChange)="setModValue(entry.key, 'lead_time_delta', $event)"
                    [name]="'mod_days_' + entry.key"
                    placeholder="0" />
                } @else {
                  <span class="mod-empty">—</span>
                  <span class="mod-empty">—</span>
                }
              </div>
            }
          </div>
        </mat-expansion-panel>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      @if (product) {
        <button mat-stroked-button color="warn" [disabled]="saving()" (click)="remove()"
                aria-label="Удалить продукт">
          Удалить
        </button>
      }
      <button mat-flat-button color="primary"
              [disabled]="!form.name || form.base_price === null || saving()"
              (click)="save()">
        @if (saving()) { <mat-spinner diameter="18" /> } @else { <mat-icon>save</mat-icon> }
        {{ product ? 'Сохранить' : 'Добавить' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host { display: flex; flex-direction: column; }

    .dialog-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .dialog-title-wrap {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .dialog-title {
      font-size: 14px; font-weight: 600; letter-spacing: 0.02em;
      color: var(--crm-text-primary, #ececec);
    }
    .house-badge {
      font-size: 11px; font-weight: 500; letter-spacing: 0.01em;
      color: var(--crm-accent, #8b5cf6);
      background: rgba(139, 92, 246, 0.12);
      padding: 2px 8px; border-radius: 10px;
    }

    .dialog-content {
      padding: 16px 20px; overflow-y: auto;
      max-height: 70vh; display: flex; flex-direction: column; gap: 12px;
    }

    .section-label {
      display: flex; align-items: center; gap: 8px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
      color: var(--crm-text-secondary, #a0a0a0); margin-bottom: 4px;
    }
    .inline-spinner { display: inline-flex; }
    .section-divider {
      height: 1px; background: rgba(255,255,255,0.06); margin: 4px 0;
    }

    /* Основные поля — 3-колоночная сетка */
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
    }
    .form-grid .span-2 { grid-column: span 2; }
    .full-width { width: 100%; }

    .form-row-wrap {
      display: flex; flex-wrap: wrap; align-items: center; gap: 16px;
    }
    .express-pct { width: 120px; }

    /* Спецификации — 2-колоночная сетка */
    .specs-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .range-field {
      display: flex; flex-direction: column; gap: 6px;
    }
    .range-label {
      font-size: 11px; color: var(--crm-text-secondary, #a0a0a0);
    }
    .range-inputs { display: flex; gap: 8px; }
    .range-input { flex: 1; }

    .toggle-field {
      display: flex; align-items: center;
      padding: 8px 0;
    }

    /* Модификаторы */
    .modifiers-panel {
      background: var(--crm-surface-base, #0d0d0d) !important;
      border: 1px solid rgba(255,255,255,0.06) !important;
      border-radius: 6px !important;
      box-shadow: none !important;
    }
    .modifiers-panel .mat-expansion-panel-header {
      padding: 0 12px; height: 40px;
    }
    .panel-title {
      font-size: 12px; font-weight: 600;
      display: flex; align-items: center; gap: 6px;
      color: var(--crm-text-primary, #ececec);
    }
    .panel-icon { font-size: 16px; width: 16px; height: 16px; }
    .panel-desc { font-size: 11px; color: var(--crm-text-secondary, #a0a0a0); }

    .modifiers-hint {
      font-size: 11px; color: var(--crm-text-secondary, #a0a0a0);
      padding: 0 0 10px; line-height: 1.5;
    }
    .modifiers-hint strong { color: var(--crm-accent, #8b5cf6); }

    .modifiers-table { display: flex; flex-direction: column; gap: 2px; }
    .mod-header {
      display: grid;
      grid-template-columns: 1fr 110px 90px 60px;
      gap: 8px; padding: 4px 6px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
      color: var(--crm-text-secondary, #a0a0a0);
    }
    .mod-row {
      display: grid;
      grid-template-columns: 1fr 110px 90px 60px;
      gap: 8px; padding: 5px 6px;
      border-radius: 4px;
      transition: background 120ms;
    }
    .mod-row:hover { background: rgba(255,255,255,0.03); }
    .mod-active { background: rgba(139,92,246,0.05) !important; }

    .mod-option-label {
      font-size: 12px; color: var(--crm-text-primary, #ececec);
      display: flex; align-items: center; gap: 6px;
    }
    .mod-option-label::before {
      content: ''; display: inline-block;
      width: 3px; height: 12px; border-radius: 2px;
      background: rgba(255,255,255,0.15);
    }
    .mod-active .mod-option-label::before {
      background: var(--crm-accent, #8b5cf6);
    }

    .mod-select {
      width: 100%; height: 28px;
      background: var(--crm-surface-base, #141414);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      color: var(--crm-text-primary, #ececec);
      font-size: 12px; padding: 0 6px;
      outline: none; cursor: pointer;
    }
    .mod-select:focus { border-color: var(--crm-accent, #8b5cf6); }

    .mod-input {
      width: 100%; height: 28px;
      background: var(--crm-surface-base, #141414);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      color: var(--crm-text-primary, #ececec);
      font-size: 12px; font-family: var(--crm-font-mono, monospace);
      padding: 0 6px; outline: none; box-sizing: border-box;
    }
    .mod-input:focus { border-color: var(--crm-accent, #8b5cf6); }
    .mod-days { color: var(--crm-text-secondary, #a0a0a0); }
    .mod-empty { font-size: 12px; color: rgba(255,255,255,0.2); display: flex; align-items: center; }

    mat-dialog-actions { padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.06); }
  `,
})
export class ProductionProductFormComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialogRef = inject(MatDialogRef<ProductionProductFormComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly data = inject<{ product?: PrintingHouseProduct; houseId?: string; houseName?: string }>(MAT_DIALOG_DATA);

  readonly saving = signal(false);
  readonly loadingRef = signal(false);

  readonly categoryEntries = Object.entries(CATEGORY_LABELS);
  readonly unitEntries = Object.entries(UNIT_LABELS);

  product?: PrintingHouseProduct;
  houseId = '';
  houseName = '';

  // ─── Form basic fields ─────────────────────────────────────────────────────
  form = {
    name: '', category: 'photo_print', sku: '', min_quantity: 1,
    base_price: 0, price_unit: 'piece', lead_time_days: 3,
    express_available: false, express_surcharge_pct: 50,
    notes: '', is_active: true,
  };

  // ─── Spec values signals ───────────────────────────────────────────────────
  private _specValues = signal<Record<string, string[]>>({});
  private _rangeValues = signal<Record<string, { min: number; max: number; step: number }>>({});
  private _boolValues = signal<Record<string, boolean>>({});
  private _priceModifiers = signal<Record<string, PriceModEntry>>({});

  readonly specValues = this._specValues.asReadonly();
  readonly rangeValues = this._rangeValues.asReadonly();
  readonly boolValues = this._boolValues.asReadonly();
  readonly priceModifiers = this._priceModifiers.asReadonly();

  // ─── Reference data ────────────────────────────────────────────────────────
  private _allRefData = signal<ProductReferenceData[]>([]);

  /** Reference data grouped by ref_type */
  readonly refByType = computed(() => {
    const map: Record<string, ProductReferenceData[]> = {};
    for (const item of this._allRefData()) {
      if (!map[item.ref_type]) map[item.ref_type] = [];
      map[item.ref_type].push(item);
    }
    return map;
  });

  /** Schema for current category */
  readonly categorySchema = computed<CategoryAttributeConfig[]>(() => {
    return CATEGORY_ATTRIBUTE_SCHEMA[this.form.category] ?? [];
  });

  /** All possible modifier entries from current spec selections */
  readonly modifierEntries = computed<{ key: string; label: string }[]>(() => {
    const entries: { key: string; label: string }[] = [];
    const refMap = this.refByType();
    const specs = this._specValues();
    const bools = this._boolValues();

    for (const attr of this.categorySchema()) {
      if (attr.type === 'multiselect') {
        const selected = specs[attr.key] ?? [];
        const refItems = attr.refType ? (refMap[attr.refType] ?? []) : [];
        for (const val of selected) {
          const item = refItems.find(r => r.ref_key === val);
          entries.push({
            key: `${attr.key}:${val}`,
            label: `${attr.label} — ${item?.display_name ?? val}`,
          });
        }
      } else if (attr.type === 'boolean' && bools[attr.key]) {
        entries.push({ key: `${attr.key}:true`, label: attr.label });
      }
    }
    return entries;
  });

  readonly activeModifiersCount = computed(() =>
    Object.keys(this._priceModifiers()).length,
  );

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit() {
    this.product = this.data.product;
    this.houseId = this.data.houseId ?? this.data.product?.printing_house_id ?? '';
    this.houseName = this.data.houseName ?? this.data.product?.printing_house_name ?? '';

    if (this.product) {
      this.form = {
        name: this.product.name,
        category: this.product.category,
        sku: this.product.sku ?? '',
        min_quantity: this.product.min_quantity,
        base_price: this.product.base_price,
        price_unit: this.product.price_unit,
        lead_time_days: this.product.lead_time_days,
        express_available: this.product.express_available,
        express_surcharge_pct: this.product.express_surcharge_pct,
        notes: this.product.notes ?? '',
        is_active: this.product.is_active,
      };
      this.parseOptionsFromProduct(this.product.options);
    }

    this.loadReferenceData(this.form.category);
  }

  private parseOptionsFromProduct(opts: Record<string, unknown>): void {
    const specs: Record<string, string[]> = {};
    const ranges: Record<string, { min: number; max: number; step: number }> = {};
    const bools: Record<string, boolean> = {};
    const modifiers: Record<string, PriceModEntry> = {};

    const schema = CATEGORY_ATTRIBUTE_SCHEMA[this.form.category] ?? [];
    for (const attr of schema) {
      const val = opts[attr.key];
      if (attr.type === 'multiselect' && Array.isArray(val)) {
        specs[attr.key] = val.map(String);
      } else if (attr.type === 'range' && val && typeof val === 'object') {
        const r = val as Record<string, number>;
        ranges[attr.key] = { min: r['min'] ?? 0, max: r['max'] ?? 0, step: r['step'] ?? 1 };
      } else if (attr.type === 'boolean') {
        bools[attr.key] = Boolean(val);
      }
    }

    const rawMods = opts['price_modifiers'];
    if (rawMods && typeof rawMods === 'object') {
      for (const [k, v] of Object.entries(rawMods as Record<string, PriceModEntry>)) {
        modifiers[k] = v;
      }
    }

    this._specValues.set(specs);
    this._rangeValues.set(ranges);
    this._boolValues.set(bools);
    this._priceModifiers.set(modifiers);
  }

  onCategoryChange(category: string): void {
    this.form.category = category;
    // Reset spec values when category changes
    this._specValues.set({});
    this._rangeValues.set({});
    this._boolValues.set({});
    this._priceModifiers.set({});
    this.loadReferenceData(category);
  }

  private loadReferenceData(category: string): void {
    this.loadingRef.set(true);
    this.api.getReferenceData(undefined, category)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => { this._allRefData.set(data); this.loadingRef.set(false); },
        error: () => { this.loadingRef.set(false); },
      });
  }

  // ─── Spec value setters ────────────────────────────────────────────────────

  setSpecValues(key: string, values: string[]): void {
    this._specValues.update(prev => ({ ...prev, [key]: values }));
    // Убираем модификаторы для снятых значений
    const newMods: Record<string, PriceModEntry> = {};
    for (const [k, v] of Object.entries(this._priceModifiers())) {
      const [attrKey] = k.split(':');
      if (attrKey !== key || values.some(val => k === `${key}:${val}`)) {
        newMods[k] = v;
      }
    }
    this._priceModifiers.set(newMods);
  }

  setRange(key: string, field: 'min' | 'max', val: number): void {
    this._rangeValues.update(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? { min: 0, max: 0, step: 1 }), [field]: val },
    }));
  }

  setBool(key: string, val: boolean): void {
    this._boolValues.update(prev => ({ ...prev, [key]: val }));
  }

  // ─── Price modifier setters ────────────────────────────────────────────────

  setModType(key: string, type: string): void {
    if (!type) {
      this._priceModifiers.update(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      this._priceModifiers.update(prev => ({
        ...prev,
        [key]: { type: type as PriceModEntry['type'], value: 0, lead_time_delta: 0 },
      }));
    }
  }

  setModValue(key: string, field: 'value' | 'lead_time_delta', val: number): void {
    this._priceModifiers.update(prev => {
      if (!prev[key]) return prev;
      return { ...prev, [key]: { ...prev[key], [field]: Number(val) } };
    });
  }

  modValuePlaceholder(type: PriceModEntry['type']): string {
    if (type === 'absolute') return '+500';
    if (type === 'percent') return '+15';
    if (type === 'multiplier') return '1.55';
    return '0';
  }

  // ─── Build options JSONB for save ──────────────────────────────────────────

  private buildOptions(): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    const schema = CATEGORY_ATTRIBUTE_SCHEMA[this.form.category] ?? [];
    const specs = this._specValues();
    const ranges = this._rangeValues();
    const bools = this._boolValues();

    for (const attr of schema) {
      if (attr.type === 'multiselect') {
        const val = specs[attr.key];
        if (val?.length) opts[attr.key] = val;
      } else if (attr.type === 'range') {
        const val = ranges[attr.key];
        if (val && (val.min > 0 || val.max > 0)) opts[attr.key] = val;
      } else if (attr.type === 'boolean') {
        const val = bools[attr.key];
        if (val) opts[attr.key] = true;
      }
    }

    const mods = this._priceModifiers();
    if (Object.keys(mods).length > 0) opts['price_modifiers'] = mods;

    return opts;
  }

  // ─── Save / Delete ─────────────────────────────────────────────────────────

  save() {
    this.saving.set(true);
    const options = this.buildOptions();
    const payload: Partial<PrintingHouseProduct> = {
      ...this.form,
      options,
      // Sync legacy arrays from new options structure
      available_formats: (options['sizes'] as string[]) ?? [],
      available_materials: (options['papers'] as string[]) ?? [],
    };

    const isNew = !this.product;
    const req$ = this.product
      ? this.api.updateProduct(this.product.id, payload)
      : this.api.createProduct(this.houseId, payload);

    req$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open(isNew ? 'Продукт добавлен' : 'Изменения сохранены', 'OK', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: err => {
        this.saving.set(false);
        this.snackBar.open(err?.error?.message ?? 'Ошибка при сохранении', 'OK', { duration: 4000 });
      },
    });
  }

  remove() {
    if (!this.product) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Удалить продукт',
        message: `Удалить "${this.product.name}"? Это действие необратимо.`,
        icon: 'delete', warn: true, confirmLabel: 'Удалить',
      } as ConfirmDialogData,
    });
    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(ok => {
      if (!ok || !this.product) return;
      this.saving.set(true);
      this.api.deleteProduct(this.product.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.saving.set(false);
          this.snackBar.open('Продукт удалён', 'OK', { duration: 3000 });
          this.dialogRef.close(true);
        },
        error: err => {
          this.saving.set(false);
          this.snackBar.open(err?.error?.message ?? 'Не удалось удалить продукт', 'OK', { duration: 4000 });
        },
      });
    });
  }
}
