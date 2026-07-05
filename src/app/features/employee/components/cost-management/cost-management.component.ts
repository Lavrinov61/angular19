/**
 * CostManagementComponent — контейнер управления себестоимостью.
 *
 * Загружает все dynamic_config записи через PricingAdminApiService,
 * раздаёт computed-сигналы дочерним редакторам, обрабатывает сохранение.
 */

import {
  Component, ChangeDetectionStrategy, inject, signal, computed,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';

import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';

import { PricingAdminApiService } from '../../services/pricing-admin-api.service';
import { LaserConsumablesEditorComponent } from './editors/laser-consumables-editor.component';
import { PhotoPaperEditorComponent } from './editors/photo-paper-editor.component';
import { PhotoInkEditorComponent } from './editors/photo-ink-editor.component';
import { EquipmentEditorComponent } from './editors/equipment-editor.component';
import { FixedCostsEditorComponent } from './editors/fixed-costs-editor.component';
import { CostSummaryComponent } from './editors/cost-summary.component';

type CostSkuKey = 'a4_bw' | 'a4_color' | 'a3_bw' | 'a3_color';
type DynamicConfigKey = string & { readonly __brand: 'DynamicConfigKey' };
type DynamicConfigMap = Partial<Record<DynamicConfigKey, unknown>>;

interface CostRowView {
  readonly key: CostSkuKey;
  readonly label: string;
  readonly variable: number | null;
  readonly full5k: number | null;
  readonly full50k: number | null;
  readonly full1m: number | null;
  readonly retail: number | null;
  readonly margin50k: number | null;
  readonly margin50kPercent: number | null;
}

interface FixedCostPart {
  readonly label: string;
  readonly value: number | null;
}

const COST_SKUS: readonly { key: CostSkuKey; label: string }[] = [
  { key: 'a4_bw', label: 'A4 ч/б' },
  { key: 'a4_color', label: 'A4 цвет' },
  { key: 'a3_bw', label: 'A3 ч/б' },
  { key: 'a3_color', label: 'A3 цвет' },
];

function dynamicConfigKey(key: string): DynamicConfigKey {
  return key as DynamicConfigKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function numberAt(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

@Component({
  selector: 'app-cost-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe, MatCardModule, MatProgressSpinnerModule, MatSnackBarModule, MatIconModule,
    LaserConsumablesEditorComponent,
    PhotoPaperEditorComponent,
    PhotoInkEditorComponent,
    EquipmentEditorComponent,
    FixedCostsEditorComponent,
    CostSummaryComponent,
  ],
  template: `
    @if (loading()) {
      <div class="cm-loading">
        <mat-spinner diameter="40" />
      </div>
    } @else if (error()) {
      <div class="cm-error">
        <mat-icon>error_outline</mat-icon>
        <p>{{ error() }}</p>
        <button class="cm-retry" (click)="loadConfigs()">Повторить</button>
      </div>
    } @else {
      <div class="cm-shell">
        <section class="cm-hero">
          <div class="cm-hero-copy">
            <span class="cm-kicker">Canon C3226i · одна страница = одна печатная сторона</span>
            <h2>Себестоимость печати</h2>
            <p>
              Две модели рядом: переменная без выхода сотрудника и полная с постоянными расходами.
              Объём сразу показывает, почему малый тираж резко дорожает.
            </p>
          </div>

          <div class="cm-kpi-strip">
            <div class="cm-kpi">
              <span>Переменная A4 цвет</span>
              <strong>{{ (variableA4Color() ?? 0) | number:'1.2-2' }} ₽</strong>
              <small>бумага + тонер + ресурс</small>
            </div>
            <div class="cm-kpi">
              <span>Полная A4 цвет 50k</span>
              <strong>{{ (fullA4Color50k() ?? 0) | number:'1.2-2' }} ₽</strong>
              <small>с постоянными расходами</small>
            </div>
            <div class="cm-kpi">
              <span>Постоянные / мес</span>
              <strong>{{ (fixedMonthlyTotal() ?? 0) | number:'1.0-0' }} ₽</strong>
              <small>аренда, сотрудник, электричество</small>
            </div>
            <div class="cm-kpi">
              <span>Сотрудник</span>
              <strong>{{ (staffDailyRate() ?? 0) | number:'1.0-0' }} ₽</strong>
              <small>за выход в день</small>
            </div>
          </div>
        </section>

        <section class="cm-model-grid">
          <article class="cm-model-card">
            <div>
              <span class="cm-model-label">Модель 1</span>
              <h3>Переменная себестоимость</h3>
            </div>
            <p>Используется, чтобы понять нижнюю границу: сколько стоит напечатанная сторона без аренды и выхода сотрудника.</p>
            <div class="cm-model-formula">бумага + тонер + амортизация</div>
          </article>

          <article class="cm-model-card cm-model-card-strong">
            <div>
              <span class="cm-model-label">Модель 2</span>
              <h3>Полная себестоимость</h3>
            </div>
            <p>Используется для цены бизнеса: постоянные расходы распределяются на месячный объём печатных сторон.</p>
            <div class="cm-model-formula">переменная + {{ (fixedPerPage50k() ?? 0) | number:'1.2-2' }} ₽/стор. при 50k</div>
          </article>
        </section>

        <section class="cm-matrix">
          <div class="cm-section-head">
            <div>
              <span class="cm-kicker">готовые расчёты из БД</span>
              <h3>Стоимость печатной стороны</h3>
            </div>
            <span class="cm-update">Обновлено: {{ summaryUpdated() }}</span>
          </div>

          <div class="cm-table-wrap">
            <table class="cm-cost-table">
              <thead>
                <tr>
                  <th>Формат</th>
                  <th>Переменная</th>
                  <th>Полная 5k</th>
                  <th>Полная 50k</th>
                  <th>Полная 1m</th>
                  <th>Продажа</th>
                  <th>Маржа 50k</th>
                </tr>
              </thead>
              <tbody>
                @for (row of costRows(); track row.key) {
                  <tr>
                    <td class="cm-row-label">{{ row.label }}</td>
                    <td>{{ (row.variable ?? 0) | number:'1.2-2' }} ₽</td>
                    <td [class.cm-danger]="(row.full5k ?? 0) > (row.retail ?? 0) && (row.retail ?? 0) > 0">
                      {{ (row.full5k ?? 0) | number:'1.2-2' }} ₽
                    </td>
                    <td [class.cm-danger]="(row.full50k ?? 0) > (row.retail ?? 0) && (row.retail ?? 0) > 0">
                      {{ (row.full50k ?? 0) | number:'1.2-2' }} ₽
                    </td>
                    <td>{{ (row.full1m ?? 0) | number:'1.2-2' }} ₽</td>
                    <td>{{ (row.retail ?? 0) | number:'1.0-2' }} ₽</td>
                    <td [class.cm-danger]="(row.margin50k ?? 0) < 0">
                      @if (row.margin50k != null) {
                        {{ row.margin50k | number:'1.2-2' }} ₽
                        @if (row.margin50kPercent != null) {
                          <small>{{ row.margin50kPercent | number:'1.0-0' }}%</small>
                        }
                      } @else {
                        —
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="cm-source-layout">
          <div class="cm-source-main">
            <app-cost-summary
              [data]="costSummary()"
              [allConfigs]="editorConfigs()"
              (save)="onSave('cost_per_page_summary', $event)" />
          </div>

          <aside class="cm-fixed-card">
            <div class="cm-section-head">
              <div>
                <span class="cm-kicker">постоянные</span>
                <h3>Почему малый объём дорогой</h3>
              </div>
            </div>
            @for (part of fixedParts(); track part.label) {
              <div class="cm-fixed-row">
                <span>{{ part.label }}</span>
                <strong>{{ (part.value ?? 0) | number:'1.0-0' }} ₽</strong>
              </div>
            }
          </aside>
        </section>

        <section class="cm-editors">
          <app-laser-consumables-editor
            [data]="laserConsumables()"
            (save)="onSave('cost_consumables', $event)" />

          <app-equipment-editor
            [data]="equipment()"
            (save)="onSave('cost_equipment', $event)" />

          <app-fixed-costs-editor
            [data]="fixedCosts()"
            (save)="onSave('cost_fixed_monthly', $event)" />

          <app-photo-paper-editor
            [data]="photoPaper()"
            (save)="onSave('cost_photo_paper', $event)" />

          <app-photo-ink-editor
            [data]="photoInk()"
            (save)="onSave('cost_photo_ink', $event)" />
        </section>
      </div>
    }
  `,
  styles: [`
    .cm-loading {
      display: flex;
      justify-content: center;
      padding: 64px 0;
    }

    .cm-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 64px 0;
      color: var(--mat-sys-error);

      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.6; }
      p { margin: 0; font-size: 14px; }
    }

    .cm-retry {
      padding: 6px 16px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
    }

    .cm-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px 0;
    }

    .cm-hero {
      display: grid;
      grid-template-columns: minmax(280px, 0.95fr) minmax(520px, 1.4fr);
      gap: 16px;
      align-items: stretch;
      padding: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: var(--crm-surface-2, var(--mat-sys-surface-container));
    }

    .cm-hero-copy {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 8px;

      h2 {
        margin: 0;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 24px;
        font-weight: 800;
        letter-spacing: 0;
      }

      p {
        margin: 0;
        color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
        font-size: 13px;
        line-height: 1.45;
        max-width: 680px;
      }
    }

    .cm-kicker,
    .cm-update {
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .cm-kpi-strip,
    .cm-model-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .cm-kpi,
    .cm-model-card,
    .cm-matrix,
    .cm-fixed-card {
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: rgba(255,255,255,0.035);
    }

    .cm-kpi {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      padding: 12px;

      span,
      small {
        color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
        font-size: 11px;
        line-height: 1.25;
      }

      strong {
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 22px;
        font-weight: 800;
        line-height: 1.05;
        font-variant-numeric: tabular-nums;
      }
    }

    .cm-model-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .cm-model-card {
      display: grid;
      grid-template-columns: minmax(180px, 0.55fr) 1fr auto;
      gap: 14px;
      align-items: center;
      padding: 14px;

      h3 {
        margin: 3px 0 0;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 16px;
        font-weight: 800;
      }

      p {
        margin: 0;
        color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
        font-size: 13px;
        line-height: 1.35;
      }
    }

    .cm-model-card-strong {
      border-color: color-mix(in srgb, var(--crm-accent, var(--mat-sys-primary)) 42%, transparent);
    }

    .cm-model-label {
      color: var(--crm-accent, var(--mat-sys-primary));
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .cm-model-formula {
      justify-self: end;
      white-space: nowrap;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255,255,255,0.06);
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
      font-size: 12px;
      font-weight: 700;
    }

    .cm-matrix {
      padding: 14px;
      background: var(--crm-surface-2, var(--mat-sys-surface-container));
    }

    .cm-section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;

      h3 {
        margin: 2px 0 0;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 16px;
        font-weight: 800;
      }
    }

    .cm-table-wrap {
      overflow-x: auto;
    }

    .cm-cost-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;

      th,
      td {
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      th {
        color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
        font-size: 11px;
        font-weight: 800;
      }

      th:first-child,
      td:first-child {
        text-align: left;
      }

      tbody tr:hover {
        background: rgba(255,255,255,0.035);
      }

      small {
        display: inline-block;
        margin-left: 6px;
        color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      }
    }

    .cm-row-label {
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
      font-weight: 800;
    }

    .cm-danger {
      color: var(--crm-status-error, var(--mat-sys-error));
      font-weight: 800;
    }

    .cm-source-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 16px;
      align-items: start;
    }

    .cm-fixed-card {
      position: sticky;
      top: 12px;
      padding: 14px;
      background: var(--crm-surface-2, var(--mat-sys-surface-container));
    }

    .cm-fixed-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 13px;

      strong {
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-variant-numeric: tabular-nums;
      }
    }

    .cm-editors {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      align-items: start;
    }

    @media (max-width: 1180px) {
      .cm-hero,
      .cm-source-layout,
      .cm-editors {
        grid-template-columns: 1fr;
      }

      .cm-kpi-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .cm-fixed-card {
        position: static;
      }
    }

    @media (max-width: 760px) {
      .cm-model-grid,
      .cm-kpi-strip {
        grid-template-columns: 1fr;
      }

      .cm-model-card {
        grid-template-columns: 1fr;
      }

      .cm-model-formula {
        justify-self: stretch;
        white-space: normal;
      }
    }
  `],
})
export class CostManagementComponent {
  private readonly api = inject(PricingAdminApiService);
  private readonly snackBar = inject(MatSnackBar);

  readonly allConfigs = signal<DynamicConfigMap>({});
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly laserConsumables = computed(() => this.configValue('cost_consumables') ?? {});
  readonly photoPaper = computed(() => this.configValue('cost_photo_paper') ?? {});
  readonly photoInk = computed(() => this.configValue('cost_photo_ink') ?? {});
  readonly equipment = computed(() => this.configValue('cost_equipment') ?? {});
  readonly fixedCosts = computed(() => this.configValue('cost_fixed_monthly') ?? {});
  readonly costSummary = computed(() => this.configValue('cost_per_page_summary') ?? {});
  readonly editorConfigs = computed((): Record<string, unknown> => {
    const configs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.allConfigs())) {
      configs[key] = value;
    }
    configs['laser_consumables'] = this.configValue('cost_consumables') ?? {};
    configs['equipment'] = this.configValue('cost_equipment') ?? {};
    configs['fixed_costs'] = this.configValue('cost_fixed_monthly') ?? {};
    return configs;
  });
  readonly variableSummary = computed(() => this.asRecord(this.configValue('cost_variable_per_page_summary')));
  readonly fullSummary = computed(() => this.asRecord(this.costSummary()));
  readonly fixedSummary = computed(() => this.asRecord(this.fixedCosts()));

  readonly variableA4Color = computed(() => this.variableCostFor('a4_color'));
  readonly fullA4Color50k = computed(() => this.fullCostFor('at_50k_pages', 'a4_color'));
  readonly fixedMonthlyTotal = computed(() => numberAt(this.fixedSummary(), 'total_fixed_estimate'));
  readonly fixedPerPage50k = computed(() => numberAt(recordAt(this.fullSummary(), 'fixed_cost_per_page') ?? null, 'at_50k_pages'));
  readonly staffDailyRate = computed(() => numberAt(recordAt(this.fixedSummary(), 'staff') ?? null, 'daily_rate'));
  readonly summaryUpdated = computed(() => {
    const updated = this.fullSummary()?.['updated'] ?? this.variableSummary()?.['updated'];
    return typeof updated === 'string' && updated.length ? updated : '—';
  });

  readonly fixedParts = computed((): FixedCostPart[] => {
    const fixed = this.fixedSummary();
    const rent = recordAt(fixed, 'rent');
    const staff = recordAt(fixed, 'staff');
    const electricity = recordAt(fixed, 'electricity');
    return [
      { label: 'Аренда', value: numberAt(rent, 'amount') },
      { label: 'Сотрудник', value: numberAt(staff, 'monthly_estimate') },
      { label: 'Электричество', value: numberAt(electricity, 'monthly_estimate') },
      { label: 'Итого', value: numberAt(fixed, 'total_fixed_estimate') },
    ];
  });

  readonly costRows = computed((): CostRowView[] => COST_SKUS.map(sku => {
    const variable = this.variableCostFor(sku.key);
    const full50k = this.fullCostFor('at_50k_pages', sku.key);
    const retail = this.fullCostFor('retail_prices', sku.key);
    const margin50k = retail == null || full50k == null ? null : retail - full50k;
    return {
      key: sku.key,
      label: sku.label,
      variable,
      full5k: this.fullCostFor('at_5k_pages', sku.key),
      full50k,
      full1m: this.fullCostFor('at_1m_pages', sku.key),
      retail,
      margin50k,
      margin50kPercent: margin50k == null || retail == null || retail <= 0 ? null : (margin50k / retail) * 100,
    };
  }));

  constructor() {
    this.loadConfigs();
  }

  async loadConfigs(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const configs = await firstValueFrom(this.api.getDynamicConfigs());
      this.allConfigs.set(this.toConfigMap(configs));
    } catch {
      this.error.set('Не удалось загрузить конфигурацию себестоимости');
    } finally {
      this.loading.set(false);
    }
  }

  async onSave(key: string, value: Record<string, unknown>): Promise<void> {
    try {
      await firstValueFrom(this.api.updateDynamicConfig(key, value));
      this.allConfigs.update(prev => ({ ...prev, [dynamicConfigKey(key)]: value }));
      this.snackBar.open('Сохранено', '', { duration: 2000 });
    } catch {
      this.snackBar.open('Ошибка сохранения', '', { duration: 3000 });
    }
  }

  private variableCostFor(key: CostSkuKey): number | null {
    const summary = this.variableSummary();
    const displayTotals = recordAt(summary, 'display_totals');
    return numberAt(displayTotals, key) ?? numberAt(recordAt(summary, key), 'total');
  }

  private fullCostFor(volumeKey: string, skuKey: CostSkuKey): number | null {
    return numberAt(recordAt(this.fullSummary(), volumeKey), skuKey);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
  }

  private configValue(key: string): unknown {
    return this.allConfigs()[dynamicConfigKey(key)];
  }

  private toConfigMap(configs: Record<string, unknown>): DynamicConfigMap {
    return Object.entries(configs).reduce<DynamicConfigMap>((acc, [key, value]) => ({
      ...acc,
      [dynamicConfigKey(key)]: value,
    }), {});
  }
}
