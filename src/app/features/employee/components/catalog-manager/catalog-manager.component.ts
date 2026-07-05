import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit, viewChild, ElementRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CatalogApiService, Product, ProductCategory } from '../../services/catalog-api.service';

interface EditingProduct {
  id?: string;
  name: string;
  product_type: 'product' | 'service';
  category_id: string | null;
  sell_price: number;
  cost_price: number | null;
  code: string | null;
  barcode: string | null;
  unit: string;
  vat_rate: string;
  is_discount_allowed: boolean;
  is_bonus_allowed: boolean;
  is_subscription_eligible: boolean;
  subscription_credit_value: number | null;
  is_favorite: boolean;
  sort_order: number;
}

interface EditingCategory {
  id?: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  sort_order: number;
}

@Component({
  selector: 'app-catalog-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule,
    MatDividerModule, MatProgressSpinnerModule, MatSnackBarModule,
    MatMenuModule, MatSlideToggleModule, MatTabsModule, MatTooltipModule,
  ],
  template: `
    <div class="catalog-page">
      <div class="page-header">
        <h1>Каталог товаров и услуг</h1>
        <div class="header-actions">
          <button mat-stroked-button (click)="triggerImport()">
            <mat-icon>upload_file</mat-icon> Импорт
          </button>
          <input #fileInput type="file" accept=".csv,.json" hidden (change)="handleImportFile($event)">
          <button mat-stroked-button (click)="startNewCategory()">
            <mat-icon>create_new_folder</mat-icon> Категория
          </button>
          <button mat-flat-button (click)="startNewProduct()">
            <mat-icon>add</mat-icon> Товар / Услуга
          </button>
        </div>
      </div>

      <!-- Табы: товары / категории -->
      <mat-tab-group [(selectedIndex)]="activeTab">
        <mat-tab label="Товары и услуги">
          <!-- Фильтры -->
          <div class="filters-row">
            <mat-form-field appearance="outline" class="search-field">
              <mat-icon matPrefix>search</mat-icon>
              <input matInput [(ngModel)]="searchQuery" placeholder="Поиск по названию...">
            </mat-form-field>
            <mat-form-field appearance="outline" class="filter-field">
              <mat-label>Категория</mat-label>
              <mat-select [(value)]="filterCategory" (selectionChange)="loadProducts()">
                <mat-option [value]="null">Все</mat-option>
                @for (cat of categories(); track cat.id) {
                  <mat-option [value]="cat.id">{{ cat.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="filter-field">
              <mat-label>Тип</mat-label>
              <mat-select [(value)]="filterType" (selectionChange)="loadProducts()">
                <mat-option [value]="null">Все</mat-option>
                <mat-option value="product">Товар</mat-option>
                <mat-option value="service">Услуга</mat-option>
              </mat-select>
            </mat-form-field>
          </div>

          <!-- Список товаров -->
          @if (loading()) {
            <div class="loading-center">
              <mat-spinner diameter="36" />
            </div>
          } @else {
            <div class="products-list">
              @for (product of displayedProducts(); track product.id) {
                <mat-card appearance="outlined" class="product-card">
                  <mat-card-content>
                    <div class="pc-row">
                      <div class="pc-info">
                        <div class="pc-name">
                          {{ product.name }}
                          @if (product.is_favorite) {
                            <mat-icon class="fav-icon">star</mat-icon>
                          }
                        </div>
                        <div class="pc-meta">
                          <span class="pc-type">{{ product.product_type === 'service' ? 'Услуга' : 'Товар' }}</span>
                          @if (product.category_name) {
                            <span class="pc-divider">·</span>
                            <span>{{ product.category_name }}</span>
                          }
                          @if (product.code) {
                            <span class="pc-divider">·</span>
                            <span>{{ product.code }}</span>
                          }
                        </div>
                      </div>
                      <div class="pc-price">{{ product.sell_price }}₽</div>
                      <button mat-icon-button [matMenuTriggerFor]="productMenu">
                        <mat-icon>more_vert</mat-icon>
                      </button>
                      <mat-menu #productMenu="matMenu">
                        <button mat-menu-item (click)="editProduct(product)">
                          <mat-icon>edit</mat-icon> Редактировать
                        </button>
                        <button mat-menu-item (click)="toggleFavorite(product)">
                          <mat-icon>{{ product.is_favorite ? 'star_border' : 'star' }}</mat-icon>
                          {{ product.is_favorite ? 'Убрать из избранного' : 'В избранное' }}
                        </button>
                        <button mat-menu-item (click)="deleteProduct(product)">
                          <mat-icon>delete</mat-icon> Удалить
                        </button>
                      </mat-menu>
                    </div>
                  </mat-card-content>
                </mat-card>
              } @empty {
                <div class="empty-state">
                  <mat-icon>inventory_2</mat-icon>
                  <span>Нет товаров</span>
                </div>
              }
            </div>
          }
        </mat-tab>

        <mat-tab label="Категории">
          <div class="categories-list">
            @for (cat of categories(); track cat.id) {
              <mat-card appearance="outlined" class="cat-card">
                <mat-card-content>
                  <div class="pc-row">
                    <div class="pc-info">
                      @if (cat.icon) { <mat-icon>{{ cat.icon }}</mat-icon> }
                      <span class="pc-name">{{ cat.name }}</span>
                    </div>
                    <button mat-icon-button [matMenuTriggerFor]="catMenu">
                      <mat-icon>more_vert</mat-icon>
                    </button>
                    <mat-menu #catMenu="matMenu">
                      <button mat-menu-item (click)="editCategory(cat)">
                        <mat-icon>edit</mat-icon> Редактировать
                      </button>
                      <button mat-menu-item (click)="deleteCategory(cat)">
                        <mat-icon>delete</mat-icon> Удалить
                      </button>
                    </mat-menu>
                  </div>
                </mat-card-content>
              </mat-card>
            } @empty {
              <div class="empty-state">
                <mat-icon>folder_off</mat-icon>
                <span>Нет категорий</span>
              </div>
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>

    <!-- ===== ДИАЛОГ ТОВАРА ===== -->
    @if (editingProduct()) {
      <div class="dialog-overlay" (click)="editingProduct.set(null)" (keydown.enter)="editingProduct.set(null)" tabindex="0">
        <mat-card appearance="outlined" class="dialog-card product-dialog" (click)="$event.stopPropagation()">
          <mat-card-content>
            <h3>{{ editingProduct()!.id ? 'Редактирование' : 'Новый товар / услуга' }}</h3>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Название</mat-label>
              <input matInput [(ngModel)]="editingProduct()!.name" required>
            </mat-form-field>

            <div class="form-row">
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Тип</mat-label>
                <mat-select [(value)]="editingProduct()!.product_type">
                  <mat-option value="service">Услуга</mat-option>
                  <mat-option value="product">Товар</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Категория</mat-label>
                <mat-select [(value)]="editingProduct()!.category_id">
                  <mat-option [value]="null">Без категории</mat-option>
                  @for (cat of categories(); track cat.id) {
                    <mat-option [value]="cat.id">{{ cat.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Цена продажи, ₽</mat-label>
                <input matInput [(ngModel)]="editingProduct()!.sell_price" type="number" min="0" required>
              </mat-form-field>
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Себестоимость, ₽</mat-label>
                <input matInput [(ngModel)]="editingProduct()!.cost_price" type="number" min="0">
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Код</mat-label>
                <input matInput [(ngModel)]="editingProduct()!.code">
              </mat-form-field>
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Штрихкод</mat-label>
                <input matInput [(ngModel)]="editingProduct()!.barcode">
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Единица</mat-label>
                <mat-select [(value)]="editingProduct()!.unit">
                  <mat-option value="piece">Штука</mat-option>
                  <mat-option value="sheet">Лист</mat-option>
                  <mat-option value="copy">Копия</mat-option>
                  <mat-option value="set">Комплект</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>НДС</mat-label>
                <mat-select [(value)]="editingProduct()!.vat_rate">
                  <mat-option value="NoVat">Без НДС</mat-option>
                  <mat-option value="Zero">0%</mat-option>
                  <mat-option value="Main">20%</mat-option>
                  <mat-option value="Preferential">10%</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <div class="toggles-row">
              <mat-slide-toggle [(ngModel)]="editingProduct()!.is_discount_allowed">Скидки</mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="editingProduct()!.is_bonus_allowed">Бонусы</mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="editingProduct()!.is_favorite">Избранное</mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="editingProduct()!.is_subscription_eligible">Подписка</mat-slide-toggle>
            </div>

            <div class="dialog-actions">
              <button mat-button (click)="editingProduct.set(null)">Отмена</button>
              <button mat-flat-button (click)="saveProduct()" [disabled]="saving()">
                @if (saving()) { <mat-icon class="spin">sync</mat-icon> }
                Сохранить
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    }

    <!-- ===== ДИАЛОГ КАТЕГОРИИ ===== -->
    @if (editingCategory()) {
      <div class="dialog-overlay" (click)="editingCategory.set(null)" (keydown.enter)="editingCategory.set(null)" tabindex="0">
        <mat-card appearance="outlined" class="dialog-card" (click)="$event.stopPropagation()">
          <mat-card-content>
            <h3>{{ editingCategory()!.id ? 'Редактирование категории' : 'Новая категория' }}</h3>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Название</mat-label>
              <input matInput [(ngModel)]="editingCategory()!.name" required>
            </mat-form-field>

            <div class="form-row">
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Иконка (mat-icon)</mat-label>
                <input matInput [(ngModel)]="editingCategory()!.icon" placeholder="photo_camera">
              </mat-form-field>
              <mat-form-field appearance="outline" class="half-width">
                <mat-label>Порядок</mat-label>
                <input matInput [(ngModel)]="editingCategory()!.sort_order" type="number">
              </mat-form-field>
            </div>

            <div class="dialog-actions">
              <button mat-button (click)="editingCategory.set(null)">Отмена</button>
              <button mat-flat-button (click)="saveCategory()" [disabled]="saving()">
                @if (saving()) { <mat-icon class="spin">sync</mat-icon> }
                Сохранить
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    }
  `,
  styles: [`
    .catalog-page { padding: 0 4px; }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
      h1 { margin: 0; font-size: 22px; font-weight: 600; }
    }
    .header-actions {
      display: flex;
      gap: 8px;
    }

    .filters-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 12px 0 0;
    }
    .search-field { flex: 2; min-width: 200px; }
    .filter-field { flex: 1; min-width: 140px; }

    .loading-center {
      display: flex;
      justify-content: center;
      padding: 40px;
    }

    .products-list, .categories-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 0;
    }

    .product-card, .cat-card {
      cursor: default;
    }

    .pc-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .pc-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pc-name {
      font-weight: 500;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .fav-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-status-warning);
    }
    .pc-meta {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .pc-type {
      background: var(--mat-sys-surface-container);
      padding: 0 6px;
      border-radius: 4px;
      font-size: 11px;
    }
    .pc-divider { opacity: 0.4; }
    .pc-price {
      font-size: 16px;
      font-weight: 700;
      color: var(--mat-sys-primary);
      white-space: nowrap;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px;
      color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
    }

    /* Диалоги */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .dialog-card {
      width: 100%;
      max-width: 520px;
      margin: 16px;
      max-height: 90vh;
      overflow-y: auto;
      h3 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
    }
    .product-dialog { max-width: 600px; }
    .full-width { width: 100%; }
    .form-row {
      display: flex;
      gap: 12px;
    }
    .half-width { flex: 1; }
    .toggles-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin: 8px 0 16px;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    .spin { animation: spin 1s linear infinite; }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class CatalogManagerComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly catalogApi = inject(CatalogApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly categories = signal<ProductCategory[]>([]);
  readonly products = signal<Product[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);

  readonly editingProduct = signal<EditingProduct | null>(null);
  readonly editingCategory = signal<EditingCategory | null>(null);

  activeTab = 0;
  searchQuery = '';
  filterCategory: string | null = null;
  filterType: string | null = null;

  readonly displayedProducts = computed(() => {
    let items = this.products();
    const q = this.searchQuery?.toLowerCase().trim();
    if (q) {
      items = items.filter(p => p.name.toLowerCase().includes(q));
    }
    return items;
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadCategories();
    this.loadProducts();
  }

  loadCategories(): void {
    this.catalogApi.getCategories().subscribe({
      next: (cats) => this.categories.set(cats),
      error: () => this.snackBar.open('Ошибка загрузки категорий', 'OK', { duration: 3000 }),
    });
  }

  loadProducts(): void {
    this.loading.set(true);
    const params: Record<string, string | number | boolean> = { limit: 500 };
    if (this.filterCategory) params['category_id'] = this.filterCategory;
    if (this.filterType) params['type'] = this.filterType;

    this.catalogApi.getProducts(params as Parameters<CatalogApiService['getProducts']>[0]).subscribe({
      next: (res) => {
        this.products.set(res.items);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Ошибка загрузки товаров', 'OK', { duration: 3000 });
      },
    });
  }

  // === Товары ===

  startNewProduct(): void {
    this.editingProduct.set({
      name: '', product_type: 'service', category_id: null,
      sell_price: 0, cost_price: null, code: null, barcode: null,
      unit: 'piece', vat_rate: 'NoVat', is_discount_allowed: true,
      is_bonus_allowed: true, is_subscription_eligible: false,
      subscription_credit_value: null, is_favorite: false, sort_order: 0,
    });
  }

  editProduct(p: Product): void {
    this.editingProduct.set({
      id: p.id, name: p.name, product_type: p.product_type,
      category_id: p.category_id, sell_price: p.sell_price,
      cost_price: p.cost_price, code: p.code, barcode: p.barcode,
      unit: p.unit, vat_rate: p.vat_rate, is_discount_allowed: p.is_discount_allowed,
      is_bonus_allowed: p.is_bonus_allowed, is_subscription_eligible: p.is_subscription_eligible,
      subscription_credit_value: p.subscription_credit_value, is_favorite: p.is_favorite,
      sort_order: p.sort_order,
    });
  }

  saveProduct(): void {
    const ep = this.editingProduct();
    if (!ep || !ep.name.trim()) return;

    this.saving.set(true);
    const data = { ...ep };
    const id = data.id;
    delete (data as Partial<EditingProduct>).id;

    const obs = id
      ? this.catalogApi.updateProduct(id, data)
      : this.catalogApi.createProduct(data);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.editingProduct.set(null);
        this.loadProducts();
        this.snackBar.open(id ? 'Товар обновлён' : 'Товар создан', 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.saving.set(false);
        this.snackBar.open(`Ошибка: ${err.error?.error || 'Не удалось сохранить'}`, 'OK', { duration: 5000 });
      },
    });
  }

  toggleFavorite(p: Product): void {
    this.catalogApi.updateProduct(p.id, { is_favorite: !p.is_favorite }).subscribe({
      next: () => this.loadProducts(),
      error: () => this.snackBar.open('Ошибка', 'OK', { duration: 3000 }),
    });
  }

  deleteProduct(p: Product): void {
    this.catalogApi.deleteProduct(p.id).subscribe({
      next: () => {
        this.loadProducts();
        this.snackBar.open('Товар удалён', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Ошибка удаления', 'OK', { duration: 3000 }),
    });
  }

  // === Категории ===

  startNewCategory(): void {
    this.editingCategory.set({ name: '', parent_id: null, icon: null, sort_order: 0 });
  }

  editCategory(cat: ProductCategory): void {
    this.editingCategory.set({
      id: cat.id, name: cat.name, parent_id: cat.parent_id,
      icon: cat.icon, sort_order: cat.sort_order,
    });
  }

  saveCategory(): void {
    const ec = this.editingCategory();
    if (!ec || !ec.name.trim()) return;

    this.saving.set(true);
    const data = { ...ec };
    const id = data.id;
    delete (data as Partial<EditingCategory>).id;

    const obs = id
      ? this.catalogApi.updateCategory(id, data)
      : this.catalogApi.createCategory(data);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.editingCategory.set(null);
        this.loadCategories();
        this.snackBar.open(id ? 'Категория обновлена' : 'Категория создана', 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.saving.set(false);
        this.snackBar.open(`Ошибка: ${err.error?.error || 'Не удалось сохранить'}`, 'OK', { duration: 5000 });
      },
    });
  }

  deleteCategory(cat: ProductCategory): void {
    this.catalogApi.deleteCategory(cat.id).subscribe({
      next: () => {
        this.loadCategories();
        this.snackBar.open('Категория удалена', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Ошибка удаления', 'OK', { duration: 3000 }),
    });
  }

  // === Импорт ===

  triggerImport(): void {
    this.fileInput()?.nativeElement.click();
  }

  handleImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      try {
        const items = file.name.endsWith('.json')
          ? this.parseJsonImport(text)
          : this.parseCsvImport(text);

        if (items.length === 0) {
          this.snackBar.open('Файл пуст или неверный формат', 'OK', { duration: 5000 });
          return;
        }

        this.saving.set(true);
        this.catalogApi.importProducts(items).subscribe({
          next: (res) => {
            this.saving.set(false);
            this.snackBar.open(
              `Создано: ${res.created}, обновлено: ${res.updated}` +
              (res.errors.length ? `, ошибок: ${res.errors.length}` : ''),
              'OK', { duration: 5000 },
            );
            this.loadProducts();
          },
          error: () => {
            this.saving.set(false);
            this.snackBar.open('Ошибка импорта', 'OK', { duration: 5000 });
          },
        });
      } catch {
        this.snackBar.open('Не удалось разобрать файл', 'OK', { duration: 5000 });
      }
    };
    reader.readAsText(file);
  }

  private parseJsonImport(text: string): Record<string, unknown>[] {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  }

  private parseCsvImport(text: string): Record<string, unknown>[] {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(';').map(h => h.trim().toLowerCase());
    const items: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';').map(c => c.trim());
      const item: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        const val = cols[idx] ?? '';
        if (h === 'sell_price' || h === 'cost_price' || h === 'sort_order') {
          item[h] = val ? parseFloat(val) : null;
        } else {
          item[h] = val || null;
        }
      });
      if (item['name'] && item['sell_price'] != null) {
        items.push(item);
      }
    }
    return items;
  }
}
