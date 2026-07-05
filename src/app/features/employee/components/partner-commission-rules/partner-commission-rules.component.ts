import {
  Component, inject, signal, computed, input, effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DecimalPipe } from '@angular/common';
import {
  PartnersApiService,
  CommissionRule,
  CommissionRulePayload,
} from '../../services/partners-api.service';
import { HttpClient } from '@angular/common/http';

interface CategoryOption {
  slug: string;
  name: string;
}

const ORDER_TYPES = [
  { value: null, label: 'Все типы' },
  { value: 'pos', label: 'POS (касса)' },
  { value: 'print', label: 'Печать' },
  { value: 'booking', label: 'Запись' },
] as const;

interface RuleForm {
  service_category_slug: string | null;
  order_type: string | null;
  commission_percent: number | null;
  commission_fixed: number | null;
  min_order_amount: number;
  is_active: boolean;
  priority: number;
}

function emptyRuleForm(): RuleForm {
  return {
    service_category_slug: null,
    order_type: null,
    commission_percent: null,
    commission_fixed: null,
    min_order_amount: 0,
    is_active: true,
    priority: 0,
  };
}

@Component({
  selector: 'app-partner-commission-rules',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatTooltipModule, DecimalPipe],
  template: `
<div class="cr-wrap">
  <div class="cr-toolbar">
    <h3 class="cr-title">Правила комиссий</h3>
    @if (!showForm()) {
      <button class="btn-primary" (click)="openAdd()">
        <mat-icon>add</mat-icon> Добавить правило
      </button>
    }
  </div>

  @if (error()) {
    <div class="cr-error">
      <mat-icon>error</mat-icon> {{ error() }}
      <button class="btn-icon btn-close" (click)="error.set(null)"><mat-icon>close</mat-icon></button>
    </div>
  }

  <!-- Inline Add/Edit Form -->
  @if (showForm()) {
    <div class="cr-form">
      <div class="cr-form-title">{{ editingRuleId() ? 'Редактировать правило' : 'Новое правило' }}</div>
      <div class="cr-form-grid">
        <div class="form-field">
          <span class="form-label">Категория</span>
          <select class="form-select" [(ngModel)]="form.service_category_slug">
            <option [ngValue]="null">Все категории (по умолчанию)</option>
            @for (cat of categories(); track cat.slug) {
              <option [ngValue]="cat.slug">{{ cat.name }}</option>
            }
          </select>
        </div>

        <div class="form-field">
          <span class="form-label">Тип заказа</span>
          <select class="form-select" [(ngModel)]="form.order_type">
            @for (t of orderTypes; track t.value) {
              <option [ngValue]="t.value">{{ t.label }}</option>
            }
          </select>
        </div>

        <div class="form-field">
          <span class="form-label">Комиссия (%)</span>
          <div class="input-suffix">
            <input class="form-input" type="number" [(ngModel)]="form.commission_percent"
                   min="0" max="100" step="0.5" placeholder="—" />
            <span class="suffix">%</span>
          </div>
        </div>

        <div class="form-field">
          <span class="form-label">Фикс. сумма</span>
          <div class="input-suffix">
            <input class="form-input" type="number" [(ngModel)]="form.commission_fixed"
                   min="0" step="10" placeholder="—" />
            <span class="suffix">&#8381;</span>
          </div>
        </div>

        <div class="form-field">
          <span class="form-label">Мин. сумма заказа</span>
          <div class="input-suffix">
            <input class="form-input" type="number" [(ngModel)]="form.min_order_amount"
                   min="0" step="100" />
            <span class="suffix">&#8381;</span>
          </div>
        </div>

        <div class="form-field">
          <span class="form-label">Приоритет</span>
          <input class="form-input" type="number" [(ngModel)]="form.priority"
                 min="0" max="100" />
        </div>
      </div>

      <div class="cr-form-check">
        <label class="checkbox-label">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          Активно
        </label>
      </div>

      <div class="cr-form-actions">
        <button class="btn-primary" [disabled]="saving()" (click)="saveRule()">
          <mat-icon>{{ saving() ? 'hourglass_empty' : 'save' }}</mat-icon>
          {{ saving() ? 'Сохранение...' : 'Сохранить' }}
        </button>
        <button class="btn-secondary" (click)="cancelForm()">Отмена</button>
      </div>
    </div>
  }

  <!-- Rules Table -->
  @if (loading()) {
    <div class="cr-loading"><mat-icon class="spin">sync</mat-icon> Загрузка...</div>
  } @else if (rules().length === 0 && !showForm()) {
    <div class="cr-empty">
      <mat-icon>tune</mat-icon>
      <p>Нет индивидуальных правил комиссий</p>
      <p class="cr-empty-hint">Используется общая ставка партнёра</p>
    </div>
  } @else if (rules().length > 0) {
    <div class="cr-table">
      <div class="cr-row cr-header-row">
        <span class="cr-col cr-col-cat">Категория</span>
        <span class="cr-col cr-col-type">Тип заказа</span>
        <span class="cr-col cr-col-pct">Комиссия %</span>
        <span class="cr-col cr-col-fix">Фикс. &#8381;</span>
        <span class="cr-col cr-col-min">Мин. сумма</span>
        <span class="cr-col cr-col-active">Активно</span>
        <span class="cr-col cr-col-actions"></span>
      </div>
      @for (rule of sortedRules(); track rule.id) {
        <div class="cr-row" [class.cr-row--inactive]="!rule.is_active">
          <span class="cr-col cr-col-cat">
            {{ getCategoryName(rule.service_category_slug) }}
          </span>
          <span class="cr-col cr-col-type">
            {{ getOrderTypeLabel(rule.order_type) }}
          </span>
          <span class="cr-col cr-col-pct">
            @if (rule.commission_percent !== null) {
              {{ rule.commission_percent }}%
            } @else {
              <span class="cr-dash">—</span>
            }
          </span>
          <span class="cr-col cr-col-fix">
            @if (rule.commission_fixed !== null) {
              {{ rule.commission_fixed | number:'1.0-0' }} &#8381;
            } @else {
              <span class="cr-dash">—</span>
            }
          </span>
          <span class="cr-col cr-col-min">
            @if (+rule.min_order_amount > 0) {
              {{ rule.min_order_amount | number:'1.0-0' }} &#8381;
            } @else {
              <span class="cr-dash">—</span>
            }
          </span>
          <span class="cr-col cr-col-active">
            @if (rule.is_active) {
              <mat-icon class="icon-active">check_circle</mat-icon>
            } @else {
              <mat-icon class="icon-inactive">cancel</mat-icon>
            }
          </span>
          <span class="cr-col cr-col-actions">
            <button class="btn-sm" (click)="editRule(rule)" matTooltip="Редактировать">
              <mat-icon>edit</mat-icon>
            </button>
            <button class="btn-sm btn-sm--danger" (click)="deleteRule(rule)" matTooltip="Удалить">
              <mat-icon>delete</mat-icon>
            </button>
          </span>
        </div>
      }
    </div>
  }
</div>
  `,
  styles: [`
    .cr-wrap { margin-top: 8px; }

    .cr-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px;
    }
    .cr-title { font-size: 15px; font-weight: 600; color: var(--crm-text-primary); margin: 0; }

    .btn-primary {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 14px; border-radius: 8px; border: none; cursor: pointer;
      background: var(--crm-accent); color: #fff; font-size: 13px; font-weight: 500;
      &:hover { opacity: 0.85; } &:disabled { opacity: 0.5; cursor: default; }
    }
    .btn-secondary {
      padding: 7px 14px; border-radius: 8px; border: 1px solid var(--crm-border);
      background: var(--crm-surface-hover); color: var(--crm-text-primary);
      cursor: pointer; font-size: 13px;
    }
    .btn-sm {
      display: inline-flex; align-items: center; padding: 4px 8px;
      border-radius: 6px; border: 1px solid var(--crm-border);
      background: var(--crm-surface-hover); color: var(--crm-text-secondary);
      cursor: pointer;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .btn-sm--danger { border-color: #ef4444; color: #ef4444; }
    .btn-icon {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border: none; background: transparent;
      cursor: pointer; color: var(--crm-text-secondary);
    }
    .btn-close { width: 20px; height: 20px; }

    .cr-error {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-radius: 8px; margin-bottom: 12px;
      background: rgba(239,68,68,0.1); color: #ef4444; font-size: 13px;
    }

    /* Form */
    .cr-form {
      padding: 14px; border-radius: 10px; border: 1px solid var(--crm-accent);
      background: var(--crm-surface); margin-bottom: 12px;
    }
    .cr-form-title {
      font-size: 14px; font-weight: 600; color: var(--crm-text-primary); margin-bottom: 12px;
    }
    .cr-form-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;
    }
    .form-field { display: flex; flex-direction: column; gap: 4px; }
    .form-label { font-size: 12px; color: var(--crm-text-secondary); font-weight: 500; }
    .form-input, .form-select {
      padding: 7px 8px; border-radius: 6px; border: 1px solid var(--crm-border);
      background: var(--crm-bg); color: var(--crm-text-primary); font-size: 13px; outline: none;
      &:focus { border-color: var(--crm-accent); }
    }
    .input-suffix { display: flex; align-items: center; gap: 4px; }
    .suffix { font-size: 13px; color: var(--crm-text-secondary); }

    .cr-form-check {
      margin-top: 10px;
      .checkbox-label {
        display: flex; align-items: center; gap: 6px;
        font-size: 13px; color: var(--crm-text-primary); cursor: pointer;
      }
    }
    .cr-form-actions { display: flex; gap: 8px; margin-top: 12px; }

    /* Table */
    .cr-table {
      border-radius: 8px; border: 1px solid var(--crm-border); overflow: hidden;
    }
    .cr-row {
      display: grid;
      grid-template-columns: 1fr 100px 90px 90px 100px 70px 80px;
      padding: 8px 12px; align-items: center;
      font-size: 13px; color: var(--crm-text-primary);
    }
    .cr-header-row {
      background: var(--crm-surface-hover);
      font-size: 12px; font-weight: 500; color: var(--crm-text-secondary);
    }
    .cr-row:not(.cr-header-row) {
      border-top: 1px solid var(--crm-border);
    }
    .cr-row--inactive {
      opacity: 0.5;
    }
    .cr-col-actions { display: flex; gap: 4px; justify-content: flex-end; }
    .cr-dash { color: var(--crm-text-secondary); }

    .icon-active { font-size: 18px; width: 18px; height: 18px; color: #10b981; }
    .icon-inactive { font-size: 18px; width: 18px; height: 18px; color: #6b7280; }

    /* Loading / Empty */
    .cr-loading {
      display: flex; align-items: center; gap: 8px; justify-content: center;
      padding: 32px; color: var(--crm-text-secondary); font-size: 13px;
    }
    .cr-empty {
      text-align: center; padding: 32px 16px; color: var(--crm-text-secondary);
      mat-icon { font-size: 36px; width: 36px; height: 36px; margin-bottom: 8px; }
      p { margin: 0 0 4px; }
    }
    .cr-empty-hint { font-size: 12px; }

    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class PartnerCommissionRulesComponent {
  private readonly api = inject(PartnersApiService);
  private readonly http = inject(HttpClient);

  readonly partnerId = input.required<number>();

  readonly orderTypes = ORDER_TYPES;

  // State
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly rules = signal<CommissionRule[]>([]);
  readonly categories = signal<CategoryOption[]>([]);
  readonly showForm = signal(false);
  readonly editingRuleId = signal<number | null>(null);

  form: RuleForm = emptyRuleForm();

  readonly sortedRules = computed(() =>
    [...this.rules()].sort((a, b) => b.priority - a.priority),
  );

  constructor() {
    this.loadCategories();
    effect(() => {
      const id = this.partnerId();
      if (id) this.loadRules(id);
    });
  }

  private loadCategories(): void {
    this.http.get<{ data: { slug: string; name: string }[] }>('/api/pricing/categories').subscribe({
      next: (res) => this.categories.set(res.data.map(c => ({ slug: c.slug, name: c.name }))),
    });
  }

  loadRules(partnerId: number): void {
    this.loading.set(true);
    this.api.getCommissionRules(partnerId).subscribe({
      next: (data) => { this.rules.set(data); this.loading.set(false); },
      error: (e) => {
        this.error.set(e?.error?.error || 'Ошибка загрузки правил');
        this.loading.set(false);
      },
    });
  }

  getCategoryName(slug: string | null): string {
    if (!slug) return 'Все категории (по умолчанию)';
    return this.categories().find(c => c.slug === slug)?.name || slug;
  }

  getOrderTypeLabel(type: string | null): string {
    if (!type) return 'Все типы';
    return ORDER_TYPES.find(t => t.value === type)?.label || type;
  }

  openAdd(): void {
    this.form = emptyRuleForm();
    this.editingRuleId.set(null);
    this.showForm.set(true);
    this.error.set(null);
  }

  editRule(rule: CommissionRule): void {
    this.editingRuleId.set(rule.id);
    this.form = {
      service_category_slug: rule.service_category_slug,
      order_type: rule.order_type,
      commission_percent: rule.commission_percent !== null ? parseFloat(rule.commission_percent) : null,
      commission_fixed: rule.commission_fixed !== null ? parseFloat(rule.commission_fixed) : null,
      min_order_amount: parseFloat(rule.min_order_amount) || 0,
      is_active: rule.is_active,
      priority: rule.priority,
    };
    this.showForm.set(true);
    this.error.set(null);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingRuleId.set(null);
    this.error.set(null);
  }

  saveRule(): void {
    if (this.form.commission_percent === null && this.form.commission_fixed === null) {
      this.error.set('Укажите комиссию (% или фиксированную сумму)');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const payload: CommissionRulePayload = {
      service_category_slug: this.form.service_category_slug,
      order_type: this.form.order_type,
      commission_percent: this.form.commission_percent,
      commission_fixed: this.form.commission_fixed,
      min_order_amount: this.form.min_order_amount,
      is_active: this.form.is_active,
      priority: this.form.priority,
    };

    const id = this.partnerId();
    const ruleId = this.editingRuleId();

    const req$ = ruleId
      ? this.api.updateCommissionRule(id, ruleId, payload)
      : this.api.createCommissionRule(id, payload);

    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.editingRuleId.set(null);
        this.loadRules(id);
      },
      error: (e) => {
        this.error.set(e?.error?.error || 'Ошибка сохранения');
        this.saving.set(false);
      },
    });
  }

  deleteRule(rule: CommissionRule): void {
    const catName = this.getCategoryName(rule.service_category_slug);
    if (!confirm(`Удалить правило "${catName}"?`)) return;

    this.api.deleteCommissionRule(this.partnerId(), rule.id).subscribe({
      next: () => this.loadRules(this.partnerId()),
      error: (e) => this.error.set(e?.error?.error || 'Ошибка удаления'),
    });
  }
}
