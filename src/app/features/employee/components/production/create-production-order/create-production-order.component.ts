import {
  Component, inject, signal, computed, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatStepperModule } from '@angular/material/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import {
  ProductionApiService, PrintingHouse, PrintingHouseProduct, ProductionOrderItem,
  ProductReferenceData,
} from '../../../services/production-api.service';
import { CAPABILITY_LABELS, CATEGORY_ATTRIBUTE_SCHEMA, unitLabel, deliveryLabel } from '../production.constants';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';

interface CartItem extends ProductionOrderItem {
  express: boolean;
  specsLabel?: string;
}

interface PendingSpec {
  product: PrintingHouseProduct;
  selectedSpecs: Record<string, string | number | boolean>;
  calculatedPrice: number;
  calculatedLeadDays: number;
}

@Component({
  selector: 'app-create-production-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatStepperModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatCardModule,
    MatProgressSpinnerModule, MatCheckboxModule, MatDatepickerModule, MatNativeDateModule,
    MatSnackBarModule, FormsModule, DatePipe,
  ],
  template: `
    <h2 mat-dialog-title>Новый заказ в типографию</h2>

    <mat-dialog-content>
      <mat-stepper #stepper [linear]="true" [selectedIndex]="step()">

        <!-- Шаг 1: Выбор типографии -->
        <mat-step [completed]="!!selectedHouse()">
          <ng-template matStepLabel>Типография</ng-template>
          <div class="step-content">
            <p class="step-hint">Выберите типографию для заказа</p>
            @if (loadingHouses()) {
              <div class="loading-mini"><mat-spinner diameter="24" /></div>
            } @else {
              <div class="houses-list">
                @for (h of activeHouses(); track h.id) {
                  <div class="house-option" [class.selected]="selectedHouse()?.id === h.id"
                       (click)="selectHouse(h)"
                       role="option" [attr.aria-selected]="selectedHouse()?.id === h.id"
                       tabindex="0" (keydown.enter)="selectHouse(h)" (keydown.space)="selectHouse(h)">
                    <div class="house-option-name">{{ h.name }}</div>
                    <div class="house-option-meta">
                      @for (cap of h.capabilities.slice(0, 3); track cap) {
                        <span class="cap-chip">{{ capLabel(cap) }}</span>
                      }
                    </div>
                    @if (selectedHouse()?.id === h.id) {
                      <mat-icon class="check-icon">check_circle</mat-icon>
                    }
                  </div>
                }
              </div>
            }
            <div class="step-actions">
              <button mat-flat-button color="primary" [disabled]="!selectedHouse()" (click)="goStep(1)">
                Далее <mat-icon>arrow_forward</mat-icon>
              </button>
            </div>
          </div>
        </mat-step>

        <!-- Шаг 2: Выбор продуктов -->
        <mat-step [completed]="cart().length > 0">
          <ng-template matStepLabel>Продукты</ng-template>
          <div class="step-content">
            <div class="products-and-cart">
              <!-- Каталог -->
              <div class="products-col">
                <p class="step-hint">Добавьте продукты в заказ</p>
                @if (loadingProducts()) {
                  <div class="loading-mini"><mat-spinner diameter="24" /></div>
                } @else {
                  @for (product of houseProducts(); track product.id) {
                    <div class="product-option" [class.product-expanding]="pendingSpec()?.product?.id === product.id">
                      <div class="product-info">
                        <div class="product-name">{{ product.name }}</div>
                        <div class="product-price">{{ product.base_price }}₽ / {{ unitLabel(product.price_unit) }}</div>
                        <div class="product-lead">Срок: {{ product.lead_time_days }} дн.</div>
                      </div>
                      <button mat-icon-button color="primary" (click)="startAddToCart(product)"
                              [attr.aria-label]="'Добавить ' + product.name">
                        <mat-icon>{{ pendingSpec()?.product?.id === product.id ? 'expand_less' : 'add_circle' }}</mat-icon>
                      </button>
                    </div>
                    <!-- Inline spec selector -->
                    @if (pendingSpec()?.product?.id === product.id) {
                      <div class="spec-panel">
                        @for (attr of productSchema(product); track attr.key) {
                          @if (attr.type === 'multiselect' && productRefOptions(product, attr.refType ?? '').length > 0) {
                            <div class="spec-row">
                              <span class="spec-label" [attr.aria-label]="attr.label">{{ attr.label }}</span>
                              <select class="spec-select"
                                [ngModel]="pendingSpec()!.selectedSpecs[attr.key]"
                                (ngModelChange)="setPendingSpec(attr.key, $event)"
                                [name]="'pspec_' + attr.key">
                                <option value="">— выбрать —</option>
                                @for (opt of productRefOptions(product, attr.refType ?? ''); track opt.ref_key) {
                                  <option [value]="opt.ref_key">{{ opt.display_name }}</option>
                                }
                              </select>
                            </div>
                          }
                          @if (attr.type === 'range') {
                            <div class="spec-row">
                              <span class="spec-label" [attr.aria-label]="attr.label">{{ attr.label }}</span>
                              <div class="spec-range">
                                <input type="number" class="spec-input" placeholder="мин"
                                  [ngModel]="pendingRangeMin(attr.key)"
                                  (ngModelChange)="setPendingRange(attr.key, 'min', $event)"
                                  [name]="'prange_min_' + attr.key" min="1" />
                                <span class="range-sep">–</span>
                                <input type="number" class="spec-input" placeholder="макс"
                                  [ngModel]="pendingRangeMax(attr.key)"
                                  (ngModelChange)="setPendingRange(attr.key, 'max', $event)"
                                  [name]="'prange_max_' + attr.key" min="1" />
                              </div>
                            </div>
                          }
                        }
                        <div class="spec-footer">
                          <span class="spec-price">
                            {{ pendingSpec()!.calculatedPrice }}₽
                            @if (pendingSpec()!.calculatedLeadDays !== product.lead_time_days) {
                              · {{ pendingSpec()!.calculatedLeadDays }} дн.
                            }
                          </span>
                          <button mat-flat-button color="primary" (click)="confirmAddToCart()">
                            <mat-icon>add_shopping_cart</mat-icon> В корзину
                          </button>
                        </div>
                      </div>
                    }
                  }
                }
              </div>

              <!-- Корзина -->
              <div class="cart-col">
                <p class="step-hint">Корзина</p>
                @if (cart().length === 0) {
                  <div class="cart-empty">
                    <mat-icon>shopping_cart</mat-icon>
                    <p>Добавьте продукты</p>
                  </div>
                } @else {
                  @for (item of cart(); track item.product_id; let i = $index) {
                    <div class="cart-item">
                      <div class="cart-item-info">
                        <div class="cart-item-name">{{ item.product_name }}</div>
                        @if (item.specsLabel) {
                          <div class="cart-item-specs">{{ item.specsLabel }}</div>
                        }
                      </div>
                      <div class="cart-item-qty">
                        <button mat-icon-button (click)="changeQty(i, -1)" aria-label="Уменьшить количество">
                          <mat-icon>remove</mat-icon>
                        </button>
                        <span>{{ item.quantity }}</span>
                        <button mat-icon-button (click)="changeQty(i, 1)" aria-label="Увеличить количество">
                          <mat-icon>add</mat-icon>
                        </button>
                      </div>
                      <div class="cart-item-price">{{ item.total_price }}₽</div>
                      <button mat-icon-button color="warn" (click)="removeFromCart(i)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  }
                  <div class="cart-total">Итого: <strong>{{ cartTotal() }}₽</strong></div>
                }
              </div>
            </div>
            <div class="step-actions">
              <button mat-button (click)="goStep(0)"><mat-icon>arrow_back</mat-icon> Назад</button>
              <button mat-flat-button color="primary" [disabled]="cart().length === 0" (click)="goStep(2)">
                Далее <mat-icon>arrow_forward</mat-icon>
              </button>
            </div>
          </div>
        </mat-step>

        <!-- Шаг 3: Параметры -->
        <mat-step [completed]="step() > 2">
          <ng-template matStepLabel>Параметры</ng-template>
          <div class="step-content">
            <div class="params-form">
              <mat-form-field class="full-width" subscriptSizing="dynamic">
                <mat-label>Клиентский заказ (необязательно)</mat-label>
                <input matInput [(ngModel)]="photoPrintOrderId"
                       placeholder="ID или номер заказа клиента" />
                <mat-hint>Привязывает производственный заказ к заказу клиента</mat-hint>
              </mat-form-field>

              <mat-form-field class="full-width" subscriptSizing="dynamic">
                <mat-label>Дедлайн</mat-label>
                <input matInput [matDatepicker]="picker" [(ngModel)]="deadline" />
                <mat-datepicker-toggle matIconSuffix [for]="picker" />
                <mat-datepicker #picker />
              </mat-form-field>

              <mat-form-field class="full-width" subscriptSizing="dynamic">
                <mat-label>Способ доставки</mat-label>
                <mat-select [(ngModel)]="deliveryMethod">
                  <mat-option value="pickup">Самовывоз</mat-option>
                  <mat-option value="courier">Курьер</mat-option>
                  <mat-option value="post">Почта</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field class="full-width" subscriptSizing="dynamic">
                <mat-label>Внутренние заметки</mat-label>
                <textarea matInput [(ngModel)]="internalNotes" rows="3"></textarea>
              </mat-form-field>
            </div>
            <div class="step-actions">
              <button mat-button (click)="goStep(1)"><mat-icon>arrow_back</mat-icon> Назад</button>
              <button mat-flat-button color="primary" (click)="goStep(3)">
                Далее <mat-icon>arrow_forward</mat-icon>
              </button>
            </div>
          </div>
        </mat-step>

        <!-- Шаг 4: Подтверждение -->
        <mat-step>
          <ng-template matStepLabel>Подтверждение</ng-template>
          <div class="step-content">
            <div class="summary">
              <div class="summary-row">
                <span class="summary-label">Типография</span>
                <span class="summary-value">{{ selectedHouse()?.name }}</span>
              </div>
              <div class="summary-row">
                <span class="summary-label">Продуктов</span>
                <span class="summary-value">{{ cart().length }} позиций</span>
              </div>
              <div class="summary-row">
                <span class="summary-label">Итого</span>
                <span class="summary-value total">{{ cartTotal() }}₽</span>
              </div>
              @if (deadline) {
                <div class="summary-row">
                  <span class="summary-label">Дедлайн</span>
                  <span class="summary-value">{{ deadline | date:'d MMM yyyy' }}</span>
                </div>
              }
              <div class="summary-row">
                <span class="summary-label">Доставка</span>
                <span class="summary-value">{{ deliveryLabel(deliveryMethod) }}</span>
              </div>

              <div class="summary-items">
                @for (item of cart(); track item.product_id) {
                  <div class="summary-item">
                    <span>{{ item.product_name }}</span>
                    <span>× {{ item.quantity }}</span>
                    <span>{{ item.total_price }}₽</span>
                  </div>
                }
              </div>
            </div>
            <div class="step-actions">
              <button mat-button (click)="goStep(2)"><mat-icon>arrow_back</mat-icon> Назад</button>
              <button mat-flat-button color="primary" [disabled]="saving()" (click)="submit()">
                @if (saving()) { <mat-spinner diameter="18" /> } @else { <mat-icon>send</mat-icon> }
                Создать заказ
              </button>
            </div>
          </div>
        </mat-step>

      </mat-stepper>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { min-height: unset; }

    .step-content { padding: 16px 0; }
    .step-hint { font-size: 13px; color: var(--crm-text-secondary); margin: 0 0 12px; }
    .loading-mini { display: flex; justify-content: center; padding: 20px; }

    /* Houses list */
    .houses-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .house-option {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px;
      border: 2px solid var(--crm-border); border-radius: 8px; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;

      &:hover { border-color: var(--crm-accent); background: var(--crm-surface-hover); }
      &.selected { border-color: var(--crm-accent); background: color-mix(in srgb, var(--crm-accent) 8%, transparent); }
    }
    .house-option-name { font-weight: 600; font-size: 14px; flex: 1; }
    .house-option-meta { display: flex; flex-wrap: wrap; gap: 4px; }
    .cap-chip {
      font-size: 11px; padding: 2px 6px; border-radius: 8px;
      background: var(--crm-surface-hover); color: var(--crm-text-secondary);
    }
    .check-icon { color: var(--crm-accent); }

    /* Products and cart */
    .products-and-cart { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .products-col, .cart-col { display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }

    .product-option {
      display: flex; align-items: center; gap: 8px; padding: 8px;
      border: 1px solid var(--crm-border); border-radius: 6px;
      transition: border-color 0.15s;
    }
    .product-option.product-expanding { border-color: var(--crm-accent); border-bottom: none; border-radius: 6px 6px 0 0; }
    .product-info { flex: 1; }
    .product-name { font-size: 13px; font-weight: 500; }
    .product-price { font-size: 12px; color: var(--crm-accent); }
    .product-lead { font-size: 11px; color: var(--crm-text-secondary); }

    /* Inline spec selector panel */
    .spec-panel {
      border: 1px solid var(--crm-accent); border-top: none;
      border-radius: 0 0 6px 6px;
      background: color-mix(in srgb, var(--crm-accent) 5%, transparent);
      padding: 10px; margin-bottom: 6px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .spec-row { display: flex; align-items: center; gap: 8px; }
    .spec-label { font-size: 11px; color: var(--crm-text-secondary); min-width: 90px; }
    .spec-select {
      flex: 1; height: 28px;
      background: var(--crm-surface-base, #141414);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px; color: var(--crm-text-primary, #ececec);
      font-size: 12px; padding: 0 6px; outline: none;
    }
    .spec-select:focus { border-color: var(--crm-accent); }
    .spec-range { display: flex; align-items: center; gap: 4px; flex: 1; }
    .spec-input {
      width: 70px; height: 28px;
      background: var(--crm-surface-base, #141414);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px; color: var(--crm-text-primary, #ececec);
      font-size: 12px; padding: 0 6px; outline: none; box-sizing: border-box;
    }
    .spec-input:focus { border-color: var(--crm-accent); }
    .range-sep { font-size: 12px; color: var(--crm-text-secondary); }
    .spec-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 4px; }
    .spec-price { font-size: 13px; font-weight: 700; color: var(--crm-accent); font-family: var(--crm-font-mono, monospace); }

    .cart-empty {
      text-align: center; padding: 30px 10px; color: var(--crm-text-secondary);
      mat-icon { font-size: 36px; width: 36px; height: 36px; }
      p { margin: 8px 0 0; }
    }

    .cart-item {
      display: flex; align-items: center; gap: 6px; padding: 6px 8px;
      border-radius: 6px; background: var(--crm-surface-hover);
    }
    .cart-item-info { flex: 1; min-width: 0; }
    .cart-item-name { font-size: 13px; }
    .cart-item-specs { font-size: 10px; color: var(--crm-text-secondary); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cart-item-qty { display: flex; align-items: center; gap: 2px; font-size: 13px; font-weight: 600; }
    .cart-item-price { font-size: 13px; font-weight: 600; color: var(--crm-accent); }
    .cart-total { text-align: right; font-size: 14px; padding: 8px 0; }

    /* Params */
    .params-form { display: flex; flex-direction: column; gap: 16px; margin-bottom: 16px; }
    .full-width { width: 100%; }

    /* Summary */
    .summary { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .summary-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--crm-border); }
    .summary-label { font-size: 13px; color: var(--crm-text-secondary); }
    .summary-value { font-size: 13px; font-weight: 500; }
    .summary-value.total { font-size: 16px; font-weight: 700; color: var(--crm-accent); }
    .summary-items { border: 1px solid var(--crm-border); border-radius: 6px; overflow: hidden; margin-top: 8px; }
    .summary-item {
      display: flex; justify-content: space-between; gap: 8px;
      padding: 6px 12px; border-bottom: 1px solid var(--crm-border); font-size: 13px;
      &:last-child { border-bottom: none; }
    }

    .step-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  `,
})
export class CreateProductionOrderComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialogRef = inject(MatDialogRef<CreateProductionOrderComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly step = signal(0);
  readonly houses = signal<PrintingHouse[]>([]);
  readonly selectedHouse = signal<PrintingHouse | null>(null);
  readonly houseProducts = signal<PrintingHouseProduct[]>([]);
  readonly cart = signal<CartItem[]>([]);
  readonly loadingHouses = signal(true);
  readonly loadingProducts = signal(false);
  readonly saving = signal(false);

  /** Текущий продукт, для которого идёт выбор спецификаций */
  readonly pendingSpec = signal<PendingSpec | null>(null);

  /** Справочные данные для типографии (загружается при выборе типографии) */
  private _refData = signal<ProductReferenceData[]>([]);

  photoPrintOrderId = '';
  deadline: Date | null = null;
  deliveryMethod = 'pickup';
  internalNotes = '';

  readonly cartTotal = computed(() =>
    this.cart().reduce((sum, item) => sum + item.total_price, 0)
  );

  readonly activeHouses = computed(() =>
    this.houses().filter(h => h.status === 'active' || h.status === 'testing')
  );

  ngOnInit() {
    this.api.getHouses().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: h => { this.houses.set(h); this.loadingHouses.set(false); },
      error: () => this.loadingHouses.set(false),
    });
  }

  /** Получить схему атрибутов для продукта */
  productSchema(product: PrintingHouseProduct) {
    return CATEGORY_ATTRIBUTE_SCHEMA[product.category] ?? [];
  }

  /** Получить варианты из справочника для данного refType, с фильтром по options продукта */
  productRefOptions(product: PrintingHouseProduct, refType: string): ProductReferenceData[] {
    if (!refType) return [];
    const opts = product.options as Record<string, unknown>;
    // Ключ в options — это ключ из схемы, где refType совпадает
    const schema = this.productSchema(product);
    const attr = schema.find(a => a.refType === refType);
    if (!attr) return [];
    const allowedKeys = opts[attr.key] as string[] | undefined;
    const all = this._refData().filter(r => r.ref_type === refType);
    // Если у продукта заданы конкретные значения — фильтруем
    if (allowedKeys && allowedKeys.length > 0) {
      return all.filter(r => allowedKeys.includes(r.ref_key));
    }
    return all;
  }

  /** Вычислить цену с учётом выбранных спецификаций (client-side) */
  private calcPrice(product: PrintingHouseProduct, specs: Record<string, string | number | boolean>): { price: number; lead: number } {
    const mods = (product.options as Record<string, unknown>)['price_modifiers'] as Record<string, { type: string; value: number; lead_time_delta?: number }> | undefined ?? {};
    const leadOverrides = (product.options as Record<string, unknown>)['lead_time_overrides'] as Record<string, number> | undefined ?? {};
    let price = Number(product.base_price);
    let lead = product.lead_time_days;

    for (const [k, v] of Object.entries(specs)) {
      const key = `${k}:${String(v)}`;
      const mod = mods[key];
      if (mod) {
        if (mod.type === 'absolute') price += mod.value;
        else if (mod.type === 'percent') price += Number(product.base_price) * mod.value / 100;
        else if (mod.type === 'multiplier') price = Number(product.base_price) * mod.value;
        lead += leadOverrides[key] ?? mod.lead_time_delta ?? 0;
      }
    }
    return { price: Math.round(price * 100) / 100, lead };
  }

  selectHouse(house: PrintingHouse) {
    if (this.cart().length > 0 && this.selectedHouse()?.id !== house.id) {
      const ref = this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Сменить типографию',
          message: `Смена типографии очистит корзину (${this.cart().length} позиций). Продолжить?`,
          icon: 'warning',
          warn: true,
          confirmLabel: 'Сменить',
        } as ConfirmDialogData,
      });
      ref.afterClosed().subscribe(ok => {
        if (!ok) return;
        this.cart.set([]);
        this.doSelectHouse(house);
      });
      return;
    }
    this.doSelectHouse(house);
  }

  private doSelectHouse(house: PrintingHouse) {
    this.selectedHouse.set(house);
    this.loadingProducts.set(true);
    // Загружаем продукты и справочник параллельно
    this.api.getProducts(house.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => { this.houseProducts.set(p.filter(x => x.is_active)); this.loadingProducts.set(false); },
      error: () => this.loadingProducts.set(false),
    });
    this.api.getReferenceData().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => this._refData.set(data),
    });
  }

  /** Начать добавление продукта — если есть спецификации, показать панель */
  startAddToCart(product: PrintingHouseProduct) {
    // Если уже открыта панель для этого продукта — закрыть
    if (this.pendingSpec()?.product?.id === product.id) {
      this.pendingSpec.set(null);
      return;
    }
    const schema = this.productSchema(product);
    const hasMultiOptions = schema.some(attr =>
      attr.type === 'multiselect' && this.productRefOptions(product, attr.refType ?? '').length > 1,
    );
    const hasRange = schema.some(a => a.type === 'range');

    if (!hasMultiOptions && !hasRange) {
      // Нет выбора — сразу добавить
      this.addProductToCart(product, {}, Number(product.base_price), product.lead_time_days);
    } else {
      this.pendingSpec.set({
        product,
        selectedSpecs: {},
        calculatedPrice: Number(product.base_price),
        calculatedLeadDays: product.lead_time_days,
      });
    }
  }

  setPendingSpec(key: string, value: string) {
    const current = this.pendingSpec();
    if (!current) return;
    const newSpecs = { ...current.selectedSpecs, [key]: value };
    const { price, lead } = this.calcPrice(current.product, newSpecs);
    this.pendingSpec.set({ ...current, selectedSpecs: newSpecs, calculatedPrice: price, calculatedLeadDays: lead });
  }

  pendingRangeMin(key: string): number {
    const specs = this.pendingSpec()?.selectedSpecs ?? {};
    return (specs[`${key}_min`] as number) ?? 0;
  }

  pendingRangeMax(key: string): number {
    const specs = this.pendingSpec()?.selectedSpecs ?? {};
    return (specs[`${key}_max`] as number) ?? 0;
  }

  setPendingRange(key: string, field: 'min' | 'max', val: number) {
    const current = this.pendingSpec();
    if (!current) return;
    const newSpecs = { ...current.selectedSpecs, [`${key}_${field}`]: val };
    this.pendingSpec.set({ ...current, selectedSpecs: newSpecs });
  }

  confirmAddToCart() {
    const p = this.pendingSpec();
    if (!p) return;
    this.addProductToCart(p.product, p.selectedSpecs, p.calculatedPrice, p.calculatedLeadDays);
    this.pendingSpec.set(null);
  }

  private addProductToCart(
    product: PrintingHouseProduct,
    specs: Record<string, string | number | boolean>,
    price: number,
    _leadDays: number,
  ) {
    // Формируем человеко-читаемый ярлык спецификаций
    const specsLabel = Object.entries(specs)
      .filter(([, v]) => v !== '' && v !== 0)
      .map(([k, v]) => {
        const refType = this.productSchema(product).find(a => a.key === k)?.refType;
        if (refType) {
          const item = this._refData().find(r => r.ref_type === refType && r.ref_key === String(v));
          return item ? item.display_name : String(v);
        }
        return `${k}: ${v}`;
      })
      .join(' · ');

    this.cart.update(c => [...c, {
      product_id: product.id,
      product_name: product.name,
      category: product.category,
      specs: specs as Record<string, unknown>,
      quantity: 1,
      unit_price: price,
      total_price: price,
      express: false,
      specsLabel: specsLabel || undefined,
    }]);
  }

  changeQty(index: number, delta: number) {
    this.cart.update(c => {
      const updated = [...c];
      const item = { ...updated[index] };
      item.quantity = Math.max(1, item.quantity + delta);
      item.total_price = Math.round(item.unit_price * item.quantity);
      updated[index] = item;
      return updated;
    });
  }

  removeFromCart(index: number) {
    this.cart.update(c => c.filter((_, i) => i !== index));
  }

  goStep(s: number) { this.step.set(s); }

  submit() {
    const house = this.selectedHouse();
    if (!house) return;

    this.saving.set(true);
    const payload = {
      printing_house_id: house.id,
      items: this.cart().map(({ express: _express, ...item }) => item),
      delivery_method: this.deliveryMethod,
      internal_notes: this.internalNotes || undefined,
      deadline_at: this.deadline ? this.deadline.toISOString() : undefined,
      photo_print_order_id: this.photoPrintOrderId || undefined,
    };

    this.api.createOrder(payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: order => {
        this.saving.set(false);
        this.snackBar.open(`Заказ ${order.order_number ?? ''} создан`, 'OK', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: err => {
        this.saving.set(false);
        this.snackBar.open(err?.error?.message ?? 'Ошибка при создании заказа', 'OK', { duration: 4000 });
      },
    });
  }

  capLabel(cap: string): string {
    return CAPABILITY_LABELS[cap] ?? cap;
  }

  readonly unitLabel = unitLabel;
  readonly deliveryLabel = deliveryLabel;
}

