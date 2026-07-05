import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { InventoryApiService } from '../../services/inventory-api.service';
import { CatalogApiService, Product } from '../../services/catalog-api.service';
import { StudioService } from '../../services/studio.service';

interface ReceiveRow {
  product_id: string;
  quantity: number;
  condition: 'good' | 'damaged';
  notes: string;
}

@Component({
  selector: 'app-inventory-receive',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="receive-page">

      <!-- Хедер с кнопкой назад -->
      <div class="page-header">
        <a mat-icon-button [routerLink]="['/employee/inventory']" matTooltip="Назад к складу">
          <mat-icon>arrow_back</mat-icon>
        </a>
        <h1>Приёмка товара</h1>
      </div>

      <!-- Мета-поля -->
      <mat-card appearance="outlined" class="form-card">
        <mat-card-content>
          <h3 class="section-title">Данные поставки</h3>
          <div class="fields-row">
            <!-- Студия (обязательно) -->
            <mat-form-field appearance="outline" class="studio-select">
              <mat-label>Студия *</mat-label>
              <mat-select [value]="selectedStudioId()" (selectionChange)="selectedStudioId.set($event.value)">
                @for (s of studios(); track s.id) {
                  <mat-option [value]="s.id">{{ s.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <!-- Поставщик -->
            <mat-form-field appearance="outline" class="flex-field">
              <mat-label>Поставщик</mat-label>
              <input matInput [value]="supplier()" (input)="supplier.set(getVal($event))" placeholder="Название компании">
            </mat-form-field>

            <!-- Номер накладной -->
            <mat-form-field appearance="outline" class="flex-field">
              <mat-label>Накладная №</mat-label>
              <input matInput [value]="invoiceNumber()" (input)="invoiceNumber.set(getVal($event))">
            </mat-form-field>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Список товаров -->
      <mat-card appearance="outlined" class="form-card">
        <mat-card-content>
          <div class="items-header">
            <h3 class="section-title">Товары</h3>
            <button mat-stroked-button (click)="addRow()">
              <mat-icon>add</mat-icon> Добавить строку
            </button>
          </div>

          @if (loadingProducts()) {
            <div class="loading-center"><mat-spinner diameter="28" /></div>
          } @else {
            <div class="rows-list">
              @for (row of rows(); track $index; let i = $index) {
                <div class="item-row">
                  <span class="row-num">{{ i + 1 }}</span>

                  <!-- Товар -->
                  <mat-form-field appearance="outline" class="row-product">
                    <mat-label>Товар</mat-label>
                    <mat-select [value]="row.product_id"
                      (selectionChange)="updateRow(i, { product_id: $event.value })">
                      <mat-option value="" disabled>— выберите —</mat-option>
                      @for (p of products(); track p.id) {
                        <mat-option [value]="p.id">{{ p.name }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  <!-- Количество -->
                  <mat-form-field appearance="outline" class="row-qty">
                    <mat-label>Кол-во</mat-label>
                    <input matInput type="number" min="1" [value]="row.quantity"
                      (input)="updateRow(i, { quantity: +getVal($event) || 1 })">
                  </mat-form-field>

                  <!-- Состояние -->
                  <mat-form-field appearance="outline" class="row-cond">
                    <mat-label>Состояние</mat-label>
                    <mat-select [value]="row.condition"
                      (selectionChange)="updateRow(i, { condition: $event.value })">
                      <mat-option value="good">Годен</mat-option>
                      <mat-option value="damaged">Брак</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <!-- Примечание к строке (опционально) -->
                  <mat-form-field appearance="outline" class="row-note">
                    <mat-label>Примечание</mat-label>
                    <input matInput [value]="row.notes"
                      (input)="updateRow(i, { notes: getVal($event) })">
                  </mat-form-field>

                  <button mat-icon-button color="warn" (click)="removeRow(i)"
                    [disabled]="rows().length === 1" matTooltip="Удалить строку">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              }
            </div>

            <!-- Итого -->
            <div class="totals-row">
              <span class="total-label">Итого:</span>
              <span class="total-item">{{ rows().length }} поз.</span>
              <span class="total-sep">·</span>
              <span class="total-item">{{ totalItems() }} шт.</span>
              @if (totalGood() > 0) {
                <span class="total-sep">·</span>
                <span class="total-good">{{ totalGood() }} годных</span>
              }
              @if (totalDamaged() > 0) {
                <span class="total-sep">·</span>
                <span class="total-damaged">{{ totalDamaged() }} бракованных</span>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>

      <!-- Общее примечание -->
      <mat-card appearance="outlined" class="form-card">
        <mat-card-content>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Примечания к приёмке</mat-label>
            <textarea matInput rows="3" [value]="notes()" (input)="notes.set(getVal($event))"></textarea>
          </mat-form-field>
        </mat-card-content>
      </mat-card>

      <!-- Кнопка отправки -->
      <div class="submit-row">
        <button mat-button [routerLink]="['/employee/inventory']">Отмена</button>
        <button mat-flat-button (click)="submit()" [disabled]="!canSubmit() || saving()">
          @if (saving()) {
            <mat-icon class="spin">sync</mat-icon>
          } @else {
            <mat-icon>done</mat-icon>
          }
          Принять товар
        </button>
      </div>

    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }

    .receive-page {
      padding: 24px;
      max-width: 900px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;

      h1 {
        font-size: 20px;
        font-weight: 600;
        margin: 0;
      }
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: .5px;
    }

    .fields-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .studio-select {
      min-width: 200px;
    }

    .flex-field {
      flex: 1;
      min-width: 160px;
    }

    .items-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .rows-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .item-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px;
      border-radius: 8px;
      background: var(--mat-sys-surface-variant, rgba(255, 255, 255, .04));
    }

    .row-num {
      width: 24px;
      text-align: center;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      flex-shrink: 0;
    }

    .row-product {
      flex: 2;
      min-width: 180px;
    }

    .row-qty {
      width: 90px;
      flex-shrink: 0;
    }

    .row-cond {
      width: 110px;
      flex-shrink: 0;
    }

    .row-note {
      flex: 1;
      min-width: 140px;
    }

    .totals-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px 0 4px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      flex-wrap: wrap;
    }

    .total-label {
      font-weight: 600;
    }

    .total-sep {
      opacity: .4;
    }

    .total-good {
      color: var(--crm-status-success, #4caf50);
    }

    .total-damaged {
      color: var(--crm-status-error, #f44336);
    }

    .loading-center {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    .full-width {
      width: 100%;
    }

    .submit-row {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding-top: 8px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .spin {
      animation: spin 1s linear infinite;
      display: inline-block;
    }
  `],
})
export class InventoryReceiveComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly inventoryApi = inject(InventoryApiService);
  private readonly catalogApi = inject(CatalogApiService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  readonly studios = computed(() => this.studioService.studios());

  // ── State signals ──
  readonly studioService = inject(StudioService);
  readonly selectedStudioId = signal('');
  readonly supplier = signal('');
  readonly invoiceNumber = signal('');
  readonly notes = signal('');
  readonly rows = signal<ReceiveRow[]>([{ product_id: '', quantity: 1, condition: 'good', notes: '' }]);
  readonly products = signal<Product[]>([]);
  readonly loadingProducts = signal(false);
  readonly saving = signal(false);

  // ── Computed ──
  readonly canSubmit = computed(() =>
    this.selectedStudioId() !== '' &&
    this.rows().length > 0 &&
    this.rows().every(r => r.product_id !== '' && r.quantity > 0)
  );

  readonly totalItems = computed(() =>
    this.rows().reduce((s, r) => s + r.quantity, 0)
  );

  readonly totalGood = computed(() =>
    this.rows().filter(r => r.condition === 'good').reduce((s, r) => s + r.quantity, 0)
  );

  readonly totalDamaged = computed(() =>
    this.rows().filter(r => r.condition === 'damaged').reduce((s, r) => s + r.quantity, 0)
  );

  // ────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadingProducts.set(true);
    this.catalogApi.getProducts({ type: 'product', limit: 200 }).subscribe({
      next: r => {
        this.products.set(r.items);
        this.loadingProducts.set(false);
      },
      error: () => this.loadingProducts.set(false),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Row management
  // ────────────────────────────────────────────────────────────

  addRow(): void {
    this.rows.update(rows => [...rows, { product_id: '', quantity: 1, condition: 'good', notes: '' }]);
  }

  removeRow(index: number): void {
    this.rows.update(rows => rows.filter((_, i) => i !== index));
  }

  updateRow(index: number, patch: Partial<ReceiveRow>): void {
    this.rows.update(rows => rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  }

  // ────────────────────────────────────────────────────────────
  // Submit
  // ────────────────────────────────────────────────────────────

  submit(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.inventoryApi.receiveItems({
      studio_id: this.selectedStudioId(),
      supplier: this.supplier() || undefined,
      invoice_number: this.invoiceNumber() || undefined,
      notes: this.notes() || undefined,
      items: this.rows().map(r => ({
        product_id: r.product_id,
        quantity: r.quantity,
        condition: r.condition,
        notes: r.notes || undefined,
      })),
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open('Товар принят', 'OK', { duration: 3000 });
        this.router.navigate(['/employee/inventory']);
      },
      error: (err: { error?: { error?: string } }) => {
        this.saving.set(false);
        this.snackBar.open(`Ошибка: ${err.error?.error ?? 'Неизвестная ошибка'}`, 'OK', { duration: 5000 });
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // Utility
  // ────────────────────────────────────────────────────────────

  getVal(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
