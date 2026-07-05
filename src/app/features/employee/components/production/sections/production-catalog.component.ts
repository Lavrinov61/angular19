import {
  Component, inject, signal, computed, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { ProductionApiService, PrintingHouseProduct, PrintingHouse } from '../../../services/production-api.service';
import { ProductionProductFormComponent } from './production-product-form.component';
import { CATEGORY_LABELS, catLabel, unitLabel } from '../production.constants';

@Component({
  selector: 'app-production-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatCardModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatSelectModule, MatFormFieldModule, MatExpansionModule, MatTooltipModule, FormsModule,
  ],
  template: `
    <div class="catalog-page">
      <div class="page-toolbar">
        <h2>Каталог продукции</h2>
        <div class="toolbar-actions">
          <mat-form-field subscriptSizing="dynamic" style="width:160px">
            <mat-label>Режим просмотра</mat-label>
            <mat-select [(ngModel)]="viewMode">
              <mat-option value="by-house">По типографиям</mat-option>
              <mat-option value="compare">Сравнение цен</mat-option>
            </mat-select>
          </mat-form-field>
          @if (viewMode === 'compare') {
            <mat-form-field subscriptSizing="dynamic" style="width:180px">
              <mat-label>Категория</mat-label>
              <mat-select [(ngModel)]="compareCategory" (ngModelChange)="loadCompare()">
                @for (cat of categories; track cat) {
                  <mat-option [value]="cat">{{ catLabel(cat) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state"><mat-spinner diameter="40" /></div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
          <button mat-flat-button (click)="loadAll()">Повторить</button>
        </div>
      } @else if (viewMode === 'by-house') {
        <!-- By house accordion -->
        <mat-accordion multi>
          @for (group of groupedByHouse(); track group.house_id) {
            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>{{ group.house_name }}</mat-panel-title>
                <mat-panel-description>{{ group.products.length }} продуктов</mat-panel-description>
              </mat-expansion-panel-header>

              @if (group.products.length === 0) {
                <div class="empty-products-state">
                  <mat-icon>inventory_2</mat-icon>
                  <span>Нет продуктов. Добавьте первый.</span>
                </div>
              } @else {
                <div class="product-header-row">
                  <span>Название</span>
                  <span>Цена</span>
                  <span>Срок (дн.)</span>
                  <span>Экспресс</span>
                  <span></span>
                </div>
                @for (catGroup of groupByCategory(group.products); track catGroup.category) {
                  <div class="cat-group-header">
                    <mat-icon>category</mat-icon>
                    {{ catLabel(catGroup.category) }}
                    <span class="cat-count">{{ catGroup.products.length }}</span>
                  </div>
                  @for (product of catGroup.products; track product.id) {
                    <div class="product-row" [class.inactive]="!product.is_active">
                      <div>
                        <div class="product-name">{{ product.name }}</div>
                        @if (product.sku) { <div class="product-sku">SKU: {{ product.sku }}</div> }
                      </div>
                      <span class="price">{{ product.base_price }}₽ / {{ unitLabel(product.price_unit) }}</span>
                      <span>{{ product.lead_time_days }}</span>
                      <span>
                        @if (product.express_available) {
                          <span class="express-badge">+{{ product.express_surcharge_pct }}%</span>
                        } @else { — }
                      </span>
                      <button mat-icon-button (click)="openProductForm(product, undefined, group.house_name)" aria-label="Редактировать продукт">
                        <mat-icon>edit</mat-icon>
                      </button>
                    </div>
                  }
                }
              }

              <div class="add-product-row">
                <button mat-button (click)="openProductForm(undefined, group.house_id, group.house_name)">
                  <mat-icon>add</mat-icon>
                  Добавить продукт
                </button>
              </div>
            </mat-expansion-panel>
          }
        </mat-accordion>
      } @else {
        <!-- Comparison table -->
        @if (!compareCategory) {
          <div class="empty-state">
            <mat-icon>compare_arrows</mat-icon>
            <p>Выберите категорию для сравнения</p>
          </div>
        } @else if (compareProducts().length === 0) {
          <div class="empty-state">
            <mat-icon>search_off</mat-icon>
            <p>Нет продуктов в этой категории</p>
          </div>
        } @else {
          <div class="compare-table">
            <div class="compare-header">
              <span class="compare-cell product-cell">Продукт</span>
              @for (house of compareHouses(); track house.id) {
                <span class="compare-cell">{{ house.name }}</span>
              }
            </div>
            @for (row of compareRows(); track row.name) {
              <div class="compare-row">
                <span class="compare-cell product-cell">{{ row.name }}</span>
                @for (house of compareHouses(); track house.id) {
                  <span class="compare-cell">
                    @if (row.prices[house.id]; as p) {
                      <span class="price" [class.best]="p.isBest">
                        {{ p.price }}₽
                        @if (p.isBest) { <mat-icon class="best-icon">star</mat-icon> }
                      </span>
                    } @else {
                      <span class="no-price">—</span>
                    }
                  </span>
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    .catalog-page { padding: 16px; max-width: 1000px; margin: 0 auto; }

    .page-toolbar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
      h2 { margin: 0; flex: 1; font-size: 18px; font-weight: 600; color: var(--crm-text-primary); }
    }
    .toolbar-actions { display: flex; gap: 12px; align-items: center; }

    .cat-group-header {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 4px 4px;
      font-size: 12px; font-weight: 600; color: var(--crm-accent);
      text-transform: uppercase; letter-spacing: .5px;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .cat-count {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--crm-accent); color: #fff;
      font-size: 10px; font-weight: 700; letter-spacing: 0;
    }

    .product-header-row {
      display: grid; grid-template-columns: 1fr 120px 80px 90px 40px;
      padding: 6px 0; font-size: 11px; font-weight: 600;
      color: var(--crm-text-secondary); text-transform: uppercase; letter-spacing: .5px;
      border-bottom: 1px solid var(--crm-border);
    }
    .product-row {
      display: grid; grid-template-columns: 1fr 120px 80px 90px 40px;
      padding: 8px 0; align-items: center; font-size: 13px;
      border-bottom: 1px solid var(--crm-border);

      &.inactive { opacity: .5; }
    }
    .product-name { font-weight: 500; }
    .product-sku { font-size: 11px; color: var(--crm-text-secondary); font-family: monospace; }
    .price { font-weight: 600; color: var(--crm-text-primary); }
    .express-badge { color: #fbbf24; font-size: 12px; font-weight: 600; }

    .empty-products-state {
      display: flex; align-items: center; gap: 8px;
      padding: 20px 4px; color: var(--crm-text-secondary);
      font-size: 13px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; opacity: .5; }
    }

    .add-product-row { padding: 8px 0; }

    .compare-table {
      border: 1px solid var(--crm-border); border-radius: 8px; overflow-x: auto;
    }
    .compare-header {
      display: flex; background: var(--crm-surface-hover);
      font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--crm-border);
    }
    .compare-row {
      display: flex; border-bottom: 1px solid var(--crm-border);
      &:last-child { border-bottom: none; }
    }
    .compare-cell {
      flex: 1; padding: 10px 12px; font-size: 13px; min-width: 100px;
    }
    .product-cell { flex: 1.5; font-weight: 500; }
    .price { display: flex; align-items: center; gap: 4px; }
    .price.best { color: #22c55e; font-weight: 700; }
    .best-icon { font-size: 14px; width: 14px; height: 14px; color: #fbbf24; }
    .no-price { color: var(--crm-text-secondary); }

    .loading-state, .empty-state, .error-state {
      text-align: center; padding: 60px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
      p { margin: 12px 0; font-size: 16px; }
    }
    .error-state mat-icon { color: var(--crm-danger, #f87171); }
  `,
})
export class ProductionCatalogComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly allProducts = signal<PrintingHouseProduct[]>([]);
  readonly compareProducts = signal<PrintingHouseProduct[]>([]);
  readonly houses = signal<PrintingHouse[]>([]);

  viewMode = 'by-house';
  compareCategory = '';

  readonly categories = Object.keys(CATEGORY_LABELS);

  readonly groupedByHouse = computed(() => {
    const productMap = new Map<string, PrintingHouseProduct[]>();
    for (const p of this.allProducts()) {
      const key = p.printing_house_id;
      if (!productMap.has(key)) productMap.set(key, []);
      productMap.get(key)!.push(p);
    }
    return this.houses().map(h => ({
      house_id: h.id,
      house_name: h.name,
      products: productMap.get(h.id) ?? [],
    }));
  });

  readonly compareHouses = computed(() => {
    const ids = new Set(this.compareProducts().map(p => p.printing_house_id));
    return this.houses().filter(h => ids.has(h.id));
  });

  readonly compareRows = computed(() => {
    const names = [...new Set(this.compareProducts().map(p => p.name))];
    return names.map(name => {
      const products = this.compareProducts().filter(p => p.name === name);
      const minPrice = Math.min(...products.map(p => p.base_price));
      const prices: Record<string, { price: number; isBest: boolean }> = {};
      for (const p of products) {
        prices[p.printing_house_id] = { price: p.base_price, isBest: p.base_price === minPrice };
      }
      return { name, prices };
    });
  });

  ngOnInit() {
    this.loadAll();
    this.api.getHouses().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(h => this.houses.set(h));
  }

  loadAll() {
    this.loading.set(true);
    this.error.set(null);
    this.api.getAllProducts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => { this.allProducts.set(p); this.loading.set(false); },
      error: () => {
        this.error.set('Не удалось загрузить каталог продукции');
        this.loading.set(false);
      },
    });
  }

  loadCompare() {
    if (!this.compareCategory) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.compareProducts(this.compareCategory).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => { this.compareProducts.set(p); this.loading.set(false); },
      error: () => {
        this.error.set('Не удалось загрузить сравнение цен');
        this.loading.set(false);
      },
    });
  }

  openProductForm(product?: PrintingHouseProduct, houseId?: string, houseName?: string) {
    const effectiveHouseId = product?.printing_house_id ?? houseId;
    const effectiveHouseName = product?.printing_house_name ?? houseName;
    this.dialog.open(ProductionProductFormComponent, {
      width: '720px',
      maxWidth: '98vw',
      data: { product, houseId: effectiveHouseId, houseName: effectiveHouseName },
    }).afterClosed().subscribe(saved => { if (saved) this.loadAll(); });
  }

  readonly catLabel = catLabel;
  readonly unitLabel = unitLabel;

  groupByCategory(products: PrintingHouseProduct[]): { category: string; products: PrintingHouseProduct[] }[] {
    const map = new Map<string, PrintingHouseProduct[]>();
    for (const p of products) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    return [...map.entries()].map(([category, prods]) => ({ category, products: prods }));
  }
}
