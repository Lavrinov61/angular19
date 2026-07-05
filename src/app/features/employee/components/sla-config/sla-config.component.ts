import { Component, inject, signal, computed, ChangeDetectionStrategy, afterNextRender, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SlaConfigApiService, SlaCategory, SlaOption } from '../../services/sla-config-api.service';
import { ToastService } from '../../../../core/services/toast.service';

interface FlatOption {
  option: SlaOption;
  groupName: string;
  groupType: string;
  categoryName: string;
  categoryId: string;
}

@Component({
  selector: 'app-sla-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="sla-page">
      <!-- Header bar -->
      <header class="sla-header">
        <div class="sla-header-text">
          <h2>
            <mat-icon class="sla-header-icon">timer</mat-icon>
            Настройка SLA
          </h2>
          <p class="sla-subtitle">Время выполнения услуг. Влияет на дедлайны и эскалацию заказов.</p>
        </div>
        <div class="sla-stats">
          <div class="stat-chip">
            <span class="stat-value">{{ totalOptions() }}</span>
            <span class="stat-label">опций</span>
          </div>
          <div class="stat-chip">
            <span class="stat-value">{{ configuredCount() }}</span>
            <span class="stat-label">настроено</span>
          </div>
          <div class="stat-chip stat-warn" [class.stat-ok]="unconfiguredCount() === 0">
            <span class="stat-value">{{ unconfiguredCount() }}</span>
            <span class="stat-label">без SLA</span>
          </div>
        </div>
      </header>

      <!-- Search + category filter -->
      <div class="sla-toolbar">
        <div class="search-box">
          <mat-icon>search</mat-icon>
          <input class="search-input"
                 placeholder="Поиск опции..."
                 [value]="searchQuery()"
                 (input)="searchQuery.set(asInputValue($event))" />
          @if (searchQuery()) {
            <button class="search-clear" (click)="searchQuery.set('')">
              <mat-icon>close</mat-icon>
            </button>
          }
        </div>
        <div class="cat-filters">
          <button class="cat-chip"
                  [class.active]="!activeCategory()"
                  (click)="activeCategory.set(null)">
            Все
          </button>
          @for (cat of categories(); track cat.id) {
            <button class="cat-chip"
                    [class.active]="activeCategory() === cat.id"
                    (click)="activeCategory.set(cat.id)">
              {{ cat.name }}
              <span class="cat-chip-count">{{ countOptions(cat) }}</span>
            </button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="28"></mat-spinner>
          <span>Загрузка конфигурации...</span>
        </div>
      } @else if (!categories().length) {
        <div class="empty-state">
          <mat-icon>tune</mat-icon>
          <span>Нет активных опций</span>
        </div>
      } @else if (!filteredFlat().length) {
        <div class="empty-state">
          <mat-icon>search_off</mat-icon>
          <span>Ничего не найдено</span>
          <button class="reset-btn" (click)="searchQuery.set(''); activeCategory.set(null)">Сбросить фильтры</button>
        </div>
      } @else {
        <!-- Table -->
        <div class="sla-table-wrap">
          <table class="sla-table">
            <thead>
              <tr>
                <th class="th-name">Опция</th>
                <th class="th-group">Группа</th>
                <th class="th-price">Цена</th>
                <th class="th-minutes">Время (мин)</th>
                <th class="th-bar">SLA</th>
              </tr>
            </thead>
            <tbody>
              @for (row of filteredFlat(); track row.option.id) {
                <tr class="sla-row" [class.row-unconfigured]="row.option.estimated_minutes === null">
                  <td class="td-name">
                    <span class="opt-name">{{ row.option.name }}</span>
                    <span class="opt-cat">{{ row.categoryName }}</span>
                  </td>
                  <td class="td-group">
                    <span class="group-badge">{{ row.groupName }}</span>
                    <span class="type-tag">{{ row.groupType }}</span>
                  </td>
                  <td class="td-price">{{ row.option.base_price }}&thinsp;&#8381;</td>
                  <td class="td-minutes">
                    <input type="number"
                           class="minutes-input"
                           [value]="row.option.estimated_minutes ?? 30"
                           min="1"
                           step="5"
                           (blur)="onMinutesBlur(row.option, $event)"
                           (keydown.enter)="blurTarget($event)" />
                    <span class="min-label">мин</span>
                  </td>
                  <td class="td-bar">
                    <div class="sla-bar-track">
                      <div class="sla-bar-fill"
                           [class.sla-fast]="(row.option.estimated_minutes ?? 30) <= 15"
                           [class.sla-normal]="(row.option.estimated_minutes ?? 30) > 15 && (row.option.estimated_minutes ?? 30) <= 60"
                           [class.sla-slow]="(row.option.estimated_minutes ?? 30) > 60"
                           [style.width.%]="barWidth(row.option.estimated_minutes ?? 30)">
                      </div>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="sla-footer">
          <span class="footer-count">{{ filteredFlat().length }} из {{ totalOptions() }} опций</span>
          <div class="sla-legend">
            <span class="legend-item"><span class="legend-dot sla-fast"></span> &le; 15 мин</span>
            <span class="legend-item"><span class="legend-dot sla-normal"></span> 16-60 мин</span>
            <span class="legend-item"><span class="legend-dot sla-slow"></span> > 60 мин</span>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .sla-page {
      max-width: 1060px;
      margin: 0 auto;
      padding: 20px 16px 32px;
    }

    /* ── Header ── */
    .sla-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        color: var(--crm-text-primary);
        display: flex;
        align-items: center;
        gap: 8px;
        letter-spacing: -0.01em;
      }
    }

    .sla-header-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: var(--crm-accent);
    }

    .sla-subtitle {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--crm-text-muted);
      line-height: 1.4;
    }

    .sla-stats {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .stat-chip {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 6px 14px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-glass-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--crm-glass-border);
      min-width: 56px;
    }

    .stat-value {
      font-size: 16px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--crm-text-primary);
    }

    .stat-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--crm-text-muted);
      margin-top: 1px;
    }

    .stat-warn .stat-value { color: var(--crm-status-error, #ef4444); }
    .stat-ok .stat-value { color: var(--crm-status-success, #22c55e); }

    /* ── Toolbar ── */
    .sla-toolbar {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 16px;
    }

    .search-box {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-glass-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--crm-glass-border);
      transition: border-color 0.2s;

      &:focus-within { border-color: var(--crm-accent); }

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-text-muted);
        flex-shrink: 0;
      }
    }

    .search-input {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--crm-text-primary);
      font-size: 13px;
      outline: none;
      min-width: 0;

      &::placeholder { color: var(--crm-text-muted); }
    }

    .search-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 2px;
      border-radius: 50%;
      color: var(--crm-text-muted);
      transition: color 0.15s;

      &:hover { color: var(--crm-text-primary); }
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .cat-filters {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .cat-chip {
      padding: 4px 12px;
      border-radius: 20px;
      border: 1px solid var(--crm-glass-border);
      background: transparent;
      color: var(--crm-text-secondary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;

      &:hover { background: rgba(255,255,255,0.04); color: var(--crm-text-primary); }

      &.active {
        background: var(--crm-accent-muted);
        color: var(--crm-accent);
        border-color: color-mix(in srgb, var(--crm-accent) 30%, transparent);
      }
    }

    .cat-chip-count {
      font-size: 10px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      opacity: 0.7;
    }

    /* ── Loading / Empty ── */
    .loading-state, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 48px 16px;
      color: var(--crm-text-muted);
      font-size: 13px;

      mat-icon { font-size: 36px; width: 36px; height: 36px; opacity: 0.3; }
    }

    .reset-btn {
      margin-top: 4px;
      border: none;
      background: var(--crm-accent-muted);
      color: var(--crm-accent);
      padding: 5px 14px;
      border-radius: 16px;
      font-size: 12px;
      cursor: pointer;
      transition: opacity 0.15s;

      &:hover { opacity: 0.8; }
    }

    /* ── Table ── */
    .sla-table-wrap {
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      overflow: hidden;
      background: var(--crm-glass-bg, rgba(255,255,255,0.02));
    }

    .sla-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .sla-table thead {
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .sla-table th {
      padding: 10px 12px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--crm-text-muted);
      text-align: left;
      border-bottom: 1px solid var(--crm-glass-border);
      background: rgba(0,0,0,0.15);
    }

    .th-name   { width: 30%; }
    .th-group  { width: 24%; }
    .th-price  { width: 12%; text-align: right; }
    .th-minutes { width: 14%; text-align: center; }
    .th-bar    { width: 20%; }

    .sla-row {
      transition: background 0.12s;

      &:hover { background: rgba(255,255,255,0.02); }
      &:not(:last-child) td { border-bottom: 1px solid rgba(255,255,255,0.04); }
    }

    .sla-row td {
      padding: 8px 12px;
      font-size: 13px;
      color: var(--crm-text-primary);
      vertical-align: middle;
    }

    .row-unconfigured {
      .opt-name { opacity: 0.6; }
    }

    /* Name column */
    .td-name {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .opt-name {
      font-weight: 500;
      font-size: 13px;
      line-height: 1.3;
      color: var(--crm-text-primary);
    }

    .opt-cat {
      font-size: 10px;
      color: var(--crm-text-muted);
      letter-spacing: 0.02em;
    }

    /* Group column */
    .td-group {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .group-badge {
      font-size: 12px;
      font-weight: 500;
      color: var(--crm-text-secondary);
    }

    .type-tag {
      font-size: 10px;
      color: var(--crm-text-muted);
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    /* Price column */
    .td-price {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      color: var(--crm-text-secondary);
      white-space: nowrap;
    }

    /* Minutes column */
    .td-minutes {
      text-align: center;
      white-space: nowrap;
    }

    .minutes-input {
      width: 56px;
      padding: 4px 4px;
      border: 1px solid var(--crm-glass-border);
      border-radius: var(--crm-radius-sm);
      background: rgba(255,255,255,0.03);
      color: var(--crm-text-primary);
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: center;
      transition: border-color 0.2s, box-shadow 0.2s;

      &:focus {
        outline: none;
        border-color: var(--crm-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--crm-accent) 20%, transparent);
      }

      /* hide spinner arrows */
      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      -moz-appearance: textfield;
    }

    .min-label {
      font-size: 10px;
      color: var(--crm-text-muted);
      margin-left: 3px;
    }

    /* SLA bar column */
    .td-bar { padding-right: 16px; }

    .sla-bar-track {
      width: 100%;
      height: 6px;
      border-radius: 3px;
      background: rgba(255,255,255,0.06);
      overflow: hidden;
    }

    .sla-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease, background 0.3s;
    }

    .sla-fast { background: var(--crm-status-success, #22c55e); }
    .sla-normal { background: var(--crm-accent, #f59e0b); }
    .sla-slow { background: var(--crm-status-error, #ef4444); }

    /* ── Footer ── */
    .sla-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 4px 0;
    }

    .footer-count {
      font-size: 11px;
      color: var(--crm-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .sla-legend {
      display: flex;
      gap: 14px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      color: var(--crm-text-muted);
      letter-spacing: 0.02em;
    }

    .legend-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;

      &.sla-fast { background: var(--crm-status-success, #22c55e); }
      &.sla-normal { background: var(--crm-accent, #f59e0b); }
      &.sla-slow { background: var(--crm-status-error, #ef4444); }
    }
  `],
})
export class SlaConfigComponent {
  private readonly api = inject(SlaConfigApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly categories = signal<SlaCategory[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly activeCategory = signal<string | null>(null);

  /** Flat list of all options with parent metadata */
  private readonly allFlat = computed<FlatOption[]>(() =>
    this.categories().flatMap(cat =>
      cat.groups.flatMap(group =>
        group.options.map(option => ({
          option,
          groupName: group.name,
          groupType: group.selection_type,
          categoryName: cat.name,
          categoryId: cat.id,
        }))
      )
    )
  );

  readonly filteredFlat = computed<FlatOption[]>(() => {
    let items = this.allFlat();
    const catId = this.activeCategory();
    if (catId) {
      items = items.filter(r => r.categoryId === catId);
    }
    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      items = items.filter(r =>
        r.option.name.toLowerCase().includes(q) ||
        r.groupName.toLowerCase().includes(q) ||
        r.categoryName.toLowerCase().includes(q)
      );
    }
    return items;
  });

  readonly totalOptions = computed(() => this.allFlat().length);
  readonly configuredCount = computed(() => this.allFlat().filter(r => r.option.estimated_minutes !== null).length);
  readonly unconfiguredCount = computed(() => this.totalOptions() - this.configuredCount());

  constructor() {
    afterNextRender(() => this.loadConfig());
  }

  countOptions(cat: SlaCategory): number {
    return cat.groups.reduce((sum, g) => sum + g.options.length, 0);
  }

  barWidth(minutes: number): number {
    // Scale: 0-120 min maps to 0-100%, capped at 100%
    return Math.min(100, (minutes / 120) * 100);
  }

  asInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  blurTarget(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  onMinutesBlur(opt: SlaOption, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = parseInt(input.value, 10);

    if (!value || value <= 0) {
      input.value = String(opt.estimated_minutes ?? 30);
      return;
    }

    if (value === opt.estimated_minutes) return;

    this.api.updateOptionMinutes(opt.id, value).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.categories.update(cats => cats.map(cat => ({
          ...cat,
          groups: cat.groups.map(group => ({
            ...group,
            options: group.options.map(o =>
              o.id === opt.id ? { ...o, estimated_minutes: value } : o
            ),
          })),
        })));
        this.toast.success(`${opt.name}: ${value} мин`);
      },
      error: () => {
        input.value = String(opt.estimated_minutes ?? 30);
        this.toast.error('Ошибка сохранения');
      },
    });
  }

  private loadConfig(): void {
    this.api.getSlaConfig().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.categories.set(res.data.categories);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
