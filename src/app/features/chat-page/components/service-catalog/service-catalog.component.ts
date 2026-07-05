import {
  Component,
  inject,
  signal,
  computed,
  output,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  PricingApiService,
  PricingCategory,
  PricingServiceOption,
} from '../../../../core/services/pricing-api.service';

// ─────────────────────────────────────────────────────────────────────────────
// Slug → Material icon name
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, string> = {
  'foto-na-documenty': 'badge',
  'pechat-foto': 'print',
  'retush-foto': 'auto_fix_high',
  'foto-na-zakaz': 'photo_camera',
};

function iconForSlug(slug: string, iconField: string | null): string {
  if (iconField) return iconField;
  return CATEGORY_ICONS[slug] ?? 'photo';
}

@Component({
  selector: 'app-service-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  template: `
    <div class="sc-root">

      <!-- ── Loading ── -->
      @if (loading()) {
        <div class="sc-spinner">
          <mat-spinner diameter="40" />
          <p class="sc-hint">Загружаем каталог услуг…</p>
        </div>
      }

      <!-- ── Error ── -->
      @if (!loading() && error()) {
        <div class="sc-error">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
          <button mat-stroked-button (click)="reload()">Повторить</button>
        </div>
      }

      <!-- ── Catalog ── -->
      @if (!loading() && !error()) {
        <div class="sc-grid">
          @for (cat of categories(); track cat.slug) {
            <div
              class="sc-card"
              [class.sc-card--expanded]="expandedSlug() === cat.slug"
              (click)="toggleCategory(cat.slug)"
              (keydown.enter)="toggleCategory(cat.slug)"
              tabindex="0"
            >
              <!-- Card header -->
              <div class="sc-card__header">
                <span class="sc-card__icon">
                  <mat-icon>{{ resolveIcon(cat) }}</mat-icon>
                </span>
                <div class="sc-card__meta">
                  <h3 class="sc-card__name">{{ cat.name }}</h3>
                  <span class="sc-card__price">{{ getMinPrice(cat) }}</span>
                </div>
                <mat-icon class="sc-card__chevron">
                  {{ expandedSlug() === cat.slug ? 'expand_less' : 'expand_more' }}
                </mat-icon>
              </div>

              <!-- Expanded inline configurator -->
              @if (expandedSlug() === cat.slug) {
                <div class="sc-configurator" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">

                  @for (group of cat.optionGroups; track group.id) {
                    <div class="sc-group">
                      <p class="sc-group__label">
                        {{ group.name }}
                        @if (group.is_required) {
                          <span class="sc-required">*</span>
                        }
                      </p>
                      <div class="sc-chips">
                        @for (opt of group.options; track opt.slug) {
                          <button
                            class="sc-chip"
                            [class.sc-chip--active]="isOptionSelected(group.id, opt.slug)"
                            (click)="selectOption(group.id, opt.slug)"
                          >
                            {{ opt.name }}
                            @if (optionPrice(opt) > 0) {
                              <span class="sc-chip__price">{{ optionPrice(opt) }}₽</span>
                            }
                          </button>
                        }
                      </div>
                    </div>
                  }

                  <!-- Computed total -->
                  <div class="sc-total">
                    <span class="sc-total__label">Итого:</span>
                    <span class="sc-total__value">{{ computedTotal() }}₽</span>
                  </div>

                  <!-- Send to chat button -->
                  <button
                    mat-flat-button
                    class="sc-send-btn"
                    (click)="sendToChat(cat)"
                  >
                    <mat-icon>send</mat-icon>
                    Добавить в чат
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      color: #20242a;
    }

    .sc-root {
      padding: 0;
    }

    /* ── Loading / Error ── */
    .sc-spinner,
    .sc-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 32px 16px;
      color: #737985;
    }
    .sc-hint {
      margin: 0;
      font-size: 14px;
    }
    .sc-error mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: #ef4444;
    }
    .sc-error p {
      margin: 0;
      font-size: 14px;
      text-align: center;
    }

    /* ── Grid ── */
    .sc-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    /* ── Card ── */
    .sc-card {
      background: #ffffff;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.2s, box-shadow 0.2s;
      overflow: hidden;
    }
    .sc-card:hover {
      border-color: #ef3124;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
    }
    .sc-card--expanded {
      border-color: #ef3124;
      border-left: 3px solid #ef3124;
      grid-column: 1 / -1;
    }

    /* Card header */
    .sc-card__header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
    }
    .sc-card__icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      background: #fff4f2;
      border-radius: 8px;
      flex-shrink: 0;
      color: #ef3124;
    }
    .sc-card__icon mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .sc-card__meta {
      flex: 1;
      min-width: 0;
    }
    .sc-card__name {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: #20242a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sc-card__price {
      font-size: 11px;
      color: #ef3124;
      font-weight: 500;
    }
    .sc-card__chevron {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #737985;
      transition: transform 0.2s;
      flex-shrink: 0;
    }

    /* ── Configurator ── */
    .sc-configurator {
      padding: 0 14px 14px;
      border-top: 1px solid #dfe3e8;
    }

    /* Option group */
    .sc-group {
      margin-top: 12px;
    }
    .sc-group__label {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 600;
      color: #737985;
      letter-spacing: 0;
    }
    .sc-required {
      color: #ef4444;
      margin-left: 2px;
    }

    /* Chips */
    .sc-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .sc-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      background: #ffffff;
      color: #20242a;
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s, color 0.15s;
    }
    .sc-chip:hover {
      border-color: #ef3124;
      color: #ef3124;
    }
    .sc-chip--active {
      background: #ef3124;
      border-color: #ef3124;
      color: #ffffff;
      font-weight: 600;
    }
    .sc-chip__price {
      opacity: 0.75;
      font-size: 11px;
    }
    .sc-chip--active .sc-chip__price {
      opacity: 0.8;
    }

    /* Total */
    .sc-total {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 14px;
      padding: 8px 12px;
      background: #f7f8fa;
      border-radius: 8px;
    }
    .sc-total__label {
      font-size: 13px;
      color: #737985;
    }
    .sc-total__value {
      font-size: 18px;
      font-weight: 700;
      color: #20242a;
    }

    /* Send button */
    .sc-send-btn {
      width: 100%;
      margin-top: 10px;
      background: #ef3124 !important;
      color: #ffffff !important;
      font-weight: 600;
      border-radius: 8px;
    }
    .sc-send-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 6px;
    }
  `],
})
export class ServiceCatalogComponent implements OnInit {
  // ── Services ──────────────────────────────────────────────────────────────
  private readonly pricingApiService = inject(PricingApiService);

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly serviceSelected = output<{ name: string; price: number }>();
  readonly orderConfigured = output<{ categorySlug: string; message: string }>();

  // ── State ─────────────────────────────────────────────────────────────────
  readonly expandedSlug = signal<string | null>(null);
  /** optionGroupId → optionSlug */
  readonly selectedOptions = signal<ReadonlyMap<string, string>>(new Map<string, string>());

  // ── Computed from service signals ──────────────────────────────────────────
  readonly categories = this.pricingApiService.onlineCategories;
  readonly loading = this.pricingApiService.loading;
  readonly error = this.pricingApiService.error;

  /** Sum of all currently selected option base_prices */
  readonly computedTotal = computed<number>(() => {
    const slug = this.expandedSlug();
    if (!slug) return 0;

    const cat = this.pricingApiService.getCategoryBySlug(slug);
    if (!cat) return 0;

    const opts = this.selectedOptions();
    let total = 0;

    for (const group of cat.optionGroups) {
      const selectedSlug = opts.get(group.id);
      if (!selectedSlug) continue;
      const opt = group.options.find(o => o.slug === selectedSlug);
      if (opt) total += opt.base_price;
    }

    return total;
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.pricingApiService.loadCategories();
  }

  // ── Public helpers ─────────────────────────────────────────────────────────
  reload(): void {
    this.pricingApiService.loadCategories();
  }

  resolveIcon(cat: PricingCategory): string {
    return iconForSlug(cat.slug, cat.icon);
  }

  /**
   * Returns "от X₽" using the cheapest base_price across all option groups,
   * or falls back to price_range string from the API.
   */
  getMinPrice(cat: PricingCategory): string {
    if (cat.price_range) return cat.price_range;

    const prices: number[] = [];
    for (const group of cat.optionGroups) {
      for (const opt of group.options) {
        if (opt.base_price > 0) prices.push(opt.base_price);
      }
    }
    if (!prices.length) return '';
    return `от ${Math.min(...prices).toLocaleString('ru-RU')}₽`;
  }

  optionPrice(opt: PricingServiceOption): number {
    return opt.base_price;
  }

  isOptionSelected(groupId: string, optionSlug: string): boolean {
    return this.selectedOptions().get(groupId) === optionSlug;
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  toggleCategory(slug: string): void {
    if (this.expandedSlug() === slug) {
      this.expandedSlug.set(null);
    } else {
      this.expandedSlug.set(slug);
      // Reset option selections when switching categories
      this.selectedOptions.set(new Map<string, string>());
    }
  }

  selectOption(groupId: string, optionSlug: string): void {
    const current = this.selectedOptions();
    // Toggle: clicking the same chip deselects it
    if (current.get(groupId) === optionSlug) {
      const updated = new Map(current);
      updated.delete(groupId);
      this.selectedOptions.set(updated);
    } else {
      const updated = new Map(current);
      updated.set(groupId, optionSlug);
      this.selectedOptions.set(updated);
    }
  }

  sendToChat(cat: PricingCategory): void {
    const opts = this.selectedOptions();
    const chosenParts: string[] = [];

    for (const group of cat.optionGroups) {
      const selectedSlug = opts.get(group.id);
      if (!selectedSlug) continue;
      const opt = group.options.find(o => o.slug === selectedSlug);
      if (opt) chosenParts.push(opt.name);
    }

    const optionsStr = chosenParts.length
      ? `, ${chosenParts.join(', ')}`
      : '';

    const message = `Хочу заказать: ${cat.name}${optionsStr}`;

    this.orderConfigured.emit({ categorySlug: cat.slug, message });

    // Also emit serviceSelected for simple integrations
    this.serviceSelected.emit({ name: cat.name, price: this.computedTotal() });

    // Collapse after sending
    this.expandedSlug.set(null);
    this.selectedOptions.set(new Map<string, string>());
  }
}
