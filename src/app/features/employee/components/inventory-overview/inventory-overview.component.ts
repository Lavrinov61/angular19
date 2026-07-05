import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { InventoryApiService, InventoryReceipt, StockItem } from '../../services/inventory-api.service';
import { PosApiService, MaterialUsageReport } from '../../services/pos-api.service';
import { CatalogApiService } from '../../services/catalog-api.service';
import { StudioService } from '../../services/studio.service';

interface StockItemWithStatus extends StockItem {
  status: 'ok' | 'low' | 'critical';
}

@Component({
  selector: 'app-inventory-overview',
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
    MatTabsModule,
    MatSnackBarModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatBadgeModule,
    DecimalPipe,
  ],
  template: `
    <div class="inventory-page">

      <!-- ===== ЗАГОЛОВОК ===== -->
      <div class="page-header">
        <h1>Склад</h1>
        <span class="studio-label">{{ selectedStudioName() }}</span>
      </div>

      <!-- ===== ТАБЫ ===== -->
      <mat-tab-group [(selectedIndex)]="activeTabIndex" animationDuration="150ms">

        <!-- ──────────────────────────────── TAB 0: ОСТАТКИ ──────────────────────────────── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <span
              [matBadge]="lowStockCount() > 0 ? lowStockCount() : null"
              matBadgeColor="warn"
              matBadgeSize="small"
              matBadgeOverlap="false">
              Остатки
            </span>
          </ng-template>

          <div class="filters-row">
            <mat-form-field appearance="outline" class="studio-select">
              <mat-label>Студия</mat-label>
              <mat-select [value]="selectedStudioId()" (selectionChange)="onStudioChange($event.value)">
                @for (s of studioService.studios(); track s.id) {
                  <mat-option [value]="s.id">{{ s.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <div class="filters-spacer"></div>

            <a mat-flat-button [routerLink]="['/employee/inventory/receive']">
              <mat-icon>add_box</mat-icon> Приёмка
            </a>
          </div>

          @if (loadingStock()) {
            <div class="loading-center">
              <mat-spinner diameter="36" />
            </div>
          } @else if (stockWithStatus().length === 0) {
            <div class="empty-state">
              <mat-icon>inventory_2</mat-icon>
              <span>Нет данных об остатках для выбранной студии</span>
            </div>
          } @else {
            <div class="stock-list">
              @for (item of stockWithStatus(); track item.id) {
                <mat-card appearance="outlined" class="stock-card">
                  <div class="stock-strip"
                    [class.strip-ok]="item.status === 'ok'"
                    [class.strip-low]="item.status === 'low'"
                    [class.strip-critical]="item.status === 'critical'">
                  </div>
                  <mat-card-content>
                    <div class="stock-row">
                      <div class="stock-info">
                        <div class="stock-name">{{ item.product_name }}</div>
                        <div class="stock-meta">
                          @if (item.status === 'critical') {
                            <span class="status-chip chip-critical">Нет в наличии</span>
                          } @else if (item.status === 'low') {
                            <span class="status-chip chip-low">Низкий остаток</span>
                          }
                          @if (item.last_refill_at) {
                            <span class="meta-secondary">Пополнение: {{ formatDate(item.last_refill_at) }}</span>
                          }
                          @if (item.estimated_ink_ml !== null) {
                            <span class="meta-secondary">Чернила: ~{{ item.estimated_ink_ml | number: '1.0-0' }} мл</span>
                          }
                        </div>
                      </div>
                      <div class="stock-qty-block">
                        <span class="stock-qty"
                          [class.qty-critical]="item.status === 'critical'"
                          [class.qty-low]="item.status === 'low'">
                          {{ item.quantity }}
                        </span>
                        <span class="stock-min">/ мин. {{ item.min_quantity }}</span>
                      </div>
                      <button mat-icon-button [matMenuTriggerFor]="stockMenu" matTooltip="Действия">
                        <mat-icon>more_vert</mat-icon>
                      </button>
                      <mat-menu #stockMenu="matMenu">
                        <button mat-menu-item (click)="startEditMin(item)">
                          <mat-icon>tune</mat-icon> Установить минимум
                        </button>
                      </mat-menu>
                    </div>
                  </mat-card-content>
                </mat-card>
              }
            </div>
          }
        </mat-tab>

        <!-- ──────────────────────────────── TAB 1: ПРИЁМКИ ──────────────────────────────── -->
        <mat-tab label="Приёмки">
          <div class="filters-row">
            <mat-form-field appearance="outline" class="studio-select">
              <mat-label>Студия</mat-label>
              <mat-select [value]="selectedStudioId()" (selectionChange)="onStudioChange($event.value)">
                @for (s of studioService.studios(); track s.id) {
                  <mat-option [value]="s.id">{{ s.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="date-field">
              <mat-label>С даты</mat-label>
              <input matInput type="date" [value]="dateFrom()" (change)="dateFrom.set(getInputValue($event))">
            </mat-form-field>

            <mat-form-field appearance="outline" class="date-field">
              <mat-label>По дату</mat-label>
              <input matInput type="date" [value]="dateTo()" (change)="dateTo.set(getInputValue($event))">
            </mat-form-field>

            <button mat-stroked-button (click)="loadReceipts()">
              <mat-icon>search</mat-icon> Поиск
            </button>
          </div>

          @if (loadingReceipts()) {
            <div class="loading-center">
              <mat-spinner diameter="36" />
            </div>
          } @else if (receipts().length === 0) {
            <div class="empty-state">
              <mat-icon>receipt_long</mat-icon>
              <span>Нет приёмок за выбранный период</span>
            </div>
          } @else {
            <div class="receipts-list">
              @for (receipt of receipts(); track receipt.id) {
                <mat-card appearance="outlined" class="receipt-card">
                  <mat-card-content>
                    <div class="receipt-header" (click)="toggleReceipt(receipt.id)" role="button" tabindex="0"
                      (keydown.enter)="toggleReceipt(receipt.id)" (keydown.space)="toggleReceipt(receipt.id)">
                      <div class="receipt-info">
                        <div class="receipt-date">{{ formatDate(receipt.received_at) }}</div>
                        <div class="receipt-meta">
                          <span class="meta-employee">{{ receipt.employee_name }}</span>
                          @if (receipt.supplier) {
                            <span class="meta-sep">·</span>
                            <span>{{ receipt.supplier }}</span>
                          }
                          @if (receipt.invoice_number) {
                            <span class="meta-sep">·</span>
                            <span class="meta-invoice">накл. {{ receipt.invoice_number }}</span>
                          }
                        </div>
                      </div>
                      <div class="receipt-count">
                        <mat-icon class="count-icon">inventory</mat-icon>
                        <span>{{ receipt.total_items }} поз.</span>
                      </div>
                      <button mat-icon-button class="expand-btn"
                        [matTooltip]="expandedReceiptId() === receipt.id ? 'Свернуть' : 'Развернуть'">
                        <mat-icon>{{ expandedReceiptId() === receipt.id ? 'expand_less' : 'expand_more' }}</mat-icon>
                      </button>
                    </div>

                    @if (expandedReceiptId() === receipt.id) {
                      <div class="receipt-items">
                        @if (receipt.notes) {
                          <div class="receipt-notes">
                            <mat-icon class="note-icon">note</mat-icon>
                            {{ receipt.notes }}
                          </div>
                        }
                        <table class="items-table">
                          <thead>
                            <tr>
                              <th>Товар</th>
                              <th class="col-qty">Кол-во</th>
                              <th class="col-cond">Состояние</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (lineItem of receipt.items; track lineItem.product_id) {
                              <tr>
                                <td>{{ getItemName(lineItem.product_id) }}</td>
                                <td class="col-qty">{{ lineItem.quantity }}</td>
                                <td class="col-cond">
                                  @if (lineItem.condition === 'good') {
                                    <span class="cond-badge cond-good">Годен</span>
                                  } @else {
                                    <span class="cond-badge cond-damaged">Брак</span>
                                  }
                                </td>
                              </tr>
                              @if (lineItem.notes) {
                                <tr class="notes-row">
                                  <td colspan="3" class="item-note">{{ lineItem.notes }}</td>
                                </tr>
                              }
                            }
                          </tbody>
                        </table>
                      </div>
                    }
                  </mat-card-content>
                </mat-card>
              }

              @if (receiptsTotal() > receipts().length) {
                <div class="load-more-hint">
                  Показано {{ receipts().length }} из {{ receiptsTotal() }}. Уточните период для сужения выборки.
                </div>
              }
            </div>
          }
        </mat-tab>

        <!-- ──────────────────────────────── TAB 2: РАСХОД МАТЕРИАЛОВ ──────────────────────────────── -->
        <mat-tab label="Расход материалов">
          <div class="filters-row">
            <mat-form-field appearance="outline" class="studio-select">
              <mat-label>Студия</mat-label>
              <mat-select [value]="selectedStudioId()" (selectionChange)="onStudioChange($event.value)">
                @for (s of studioService.studios(); track s.id) {
                  <mat-option [value]="s.id">{{ s.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="date-field">
              <mat-label>С даты</mat-label>
              <input matInput type="date" [value]="reportDateFrom()" (change)="reportDateFrom.set(getInputValue($event))">
            </mat-form-field>

            <mat-form-field appearance="outline" class="date-field">
              <mat-label>По дату</mat-label>
              <input matInput type="date" [value]="reportDateTo()" (change)="reportDateTo.set(getInputValue($event))">
            </mat-form-field>

            <button mat-stroked-button (click)="loadReport()">
              <mat-icon>refresh</mat-icon> Обновить
            </button>
          </div>

          @if (loadingReport()) {
            <div class="loading-center">
              <mat-spinner diameter="36" />
            </div>
          } @else if (materialReport().length === 0) {
            <div class="empty-state">
              <mat-icon>bar_chart</mat-icon>
              <span>Нет данных о расходе материалов за выбранный период</span>
            </div>
          } @else {
            <div class="report-wrapper">
              <table class="report-table">
                <thead>
                  <tr>
                    <th>Материал</th>
                    <th>Ед.</th>
                    <th class="col-num">Использовано</th>
                    <th class="col-num">Остаток</th>
                    <th class="col-num">Мин. порог</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of materialReport(); track row.product_id) {
                    <tr [class.row-low]="row.is_low_stock">
                      <td class="cell-name">{{ row.product_name }}</td>
                      <td class="cell-unit">{{ row.unit }}</td>
                      <td class="col-num">{{ row.total_used }}</td>
                      <td class="col-num"
                        [class.val-critical]="row.current_stock !== null && row.current_stock <= 0"
                        [class.val-low]="row.is_low_stock && row.current_stock !== null && row.current_stock > 0">
                        {{ row.current_stock ?? '—' }}
                      </td>
                      <td class="col-num">{{ row.min_quantity ?? '—' }}</td>
                      <td>
                        @if (row.is_low_stock) {
                          <span class="badge-low">Низкий остаток</span>
                        } @else {
                          <span class="badge-ok">В норме</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </mat-tab>

      </mat-tab-group>
    </div>

    <!-- ===== INLINE ДИАЛОГ: УСТАНОВИТЬ МИНИМУМ ===== -->
    @if (editingMinStock()) {
      <div class="overlay-backdrop" (click)="editingMinStock.set(null)" (keydown.enter)="editingMinStock.set(null)" tabindex="0">
        <mat-card appearance="outlined" class="dialog-card" (click)="$event.stopPropagation()">
          <mat-card-content>
            <h3 class="dialog-title">Минимальный остаток</h3>
            <p class="dialog-product-name">{{ editingMinStock()!.item.product_name }}</p>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Минимальное количество</mat-label>
              <input matInput type="number" min="0"
                [value]="editingMinStock()!.value"
                (input)="updateEditingMinValue(getInputValueNum($event))">
              <mat-hint>При достижении этого значения — предупреждение о низком остатке</mat-hint>
            </mat-form-field>

            <div class="dialog-actions">
              <button mat-button (click)="editingMinStock.set(null)" [disabled]="savingMin()">
                Отмена
              </button>
              <button mat-flat-button (click)="saveMinStock()" [disabled]="savingMin()">
                @if (savingMin()) {
                  <mat-icon class="spin">sync</mat-icon>
                }
                Сохранить
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }

    .inventory-page {
      padding: 24px;
      max-width: 900px;
      margin: 0 auto;
    }

    /* ── Header ── */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      gap: 16px;
      flex-wrap: wrap;

      h1 {
        font-size: 20px;
        font-weight: 600;
        margin: 0;
      }
    }

    .studio-label {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    /* ── Filters row ── */
    .filters-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 0;
      flex-wrap: wrap;
    }

    .filters-spacer {
      flex: 1;
    }

    .studio-select {
      min-width: 200px;
    }

    .date-field {
      min-width: 150px;
    }

    /* ── Stock list ── */
    .stock-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .stock-card {
      position: relative;
      padding-left: 6px;
      overflow: hidden;
      cursor: default;
    }

    .stock-strip {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      border-radius: 2px 0 0 2px;
    }

    .strip-ok { background: var(--crm-status-success, #4caf50); }
    .strip-low { background: var(--crm-status-warning, #ff9800); }
    .strip-critical { background: var(--crm-status-error, #f44336); }

    .stock-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .stock-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .stock-name {
      font-size: 14px;
      font-weight: 500;
    }

    .stock-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .status-chip {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 500;
    }

    .chip-low {
      background: rgba(255, 152, 0, 0.15);
      color: var(--crm-status-warning, #ff9800);
    }

    .chip-critical {
      background: rgba(244, 67, 54, 0.15);
      color: var(--crm-status-error, #f44336);
    }

    .meta-secondary {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .stock-qty-block {
      display: flex;
      align-items: baseline;
      gap: 4px;
      white-space: nowrap;
    }

    .stock-qty {
      font-size: 20px;
      font-weight: 700;
      color: var(--mat-sys-on-surface);
    }

    .qty-low { color: var(--crm-status-warning, #ff9800); }
    .qty-critical { color: var(--crm-status-error, #f44336); }

    .stock-min {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    /* ── Receipts list ── */
    .receipts-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .receipt-card {
      cursor: default;
    }

    .receipt-header {
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      user-select: none;
      outline: none;

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        border-radius: 4px;
      }
    }

    .receipt-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .receipt-date {
      font-size: 14px;
      font-weight: 500;
    }

    .receipt-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      flex-wrap: wrap;
    }

    .meta-employee {
      font-weight: 500;
      color: var(--mat-sys-on-surface);
    }

    .meta-sep { opacity: 0.4; }

    .meta-invoice {
      font-style: italic;
    }

    .receipt-count {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }

    .count-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .expand-btn {
      flex-shrink: 0;
    }

    /* ── Receipt items (expanded) ── */
    .receipt-items {
      margin-top: 12px;
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.1));
      padding-top: 12px;
    }

    .receipt-notes {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 12px;
      font-style: italic;
    }

    .note-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;

      th, td {
        padding: 6px 10px;
        text-align: left;
        font-size: 13px;
        border-bottom: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      }

      th {
        font-weight: 600;
        color: var(--mat-sys-on-surface-variant);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      tbody tr:last-child td {
        border-bottom: none;
      }
    }

    .col-qty, .col-cond { width: 90px; }

    .cond-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 500;
    }

    .cond-good {
      background: rgba(76, 175, 80, 0.15);
      color: var(--crm-status-success, #4caf50);
    }

    .cond-damaged {
      background: rgba(244, 67, 54, 0.15);
      color: var(--crm-status-error, #f44336);
    }

    .notes-row .item-note {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
      padding-top: 0;
    }

    .load-more-hint {
      text-align: center;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      padding: 12px;
    }

    /* ── Report table ── */
    .report-wrapper {
      overflow-x: auto;
    }

    .report-table {
      width: 100%;
      border-collapse: collapse;

      th, td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid var(--crm-border, rgba(255, 255, 255, 0.1));
        font-size: 13px;
      }

      th {
        font-weight: 600;
        color: var(--mat-sys-on-surface-variant);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        white-space: nowrap;
      }

      .col-num {
        text-align: right;
        width: 110px;
      }

      .cell-unit {
        color: var(--mat-sys-on-surface-variant);
        font-size: 12px;
        width: 60px;
      }

      .cell-name {
        font-weight: 500;
      }

      tr.row-low {
        background: rgba(255, 152, 0, 0.04);
      }

      .val-low { color: var(--crm-status-warning, #ff9800); font-weight: 600; }
      .val-critical { color: var(--crm-status-error, #f44336); font-weight: 600; }
    }

    .badge-low {
      background: var(--crm-status-warning, #ff9800);
      color: #000;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
    }

    .badge-ok {
      background: rgba(76, 175, 80, 0.15);
      color: var(--crm-status-success, #4caf50);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
    }

    /* ── Shared ── */
    .loading-center {
      display: flex;
      justify-content: center;
      padding: 48px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 48px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        opacity: 0.3;
      }
    }

    /* ── Inline min-stock dialog ── */
    .overlay-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dialog-card {
      min-width: 300px;
      max-width: 420px;
      width: 100%;
      margin: 16px;
    }

    .dialog-title {
      font-size: 17px;
      font-weight: 600;
      margin: 0 0 4px;
    }

    .dialog-product-name {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 16px;
    }

    .full-width { width: 100%; }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    /* ── Spinner animation ── */
    .spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class InventoryOverviewComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly inventoryApi = inject(InventoryApiService);
  private readonly posApi = inject(PosApiService);
  private readonly catalogApi = inject(CatalogApiService);
  private readonly snackBar = inject(MatSnackBar);

  readonly studioService = inject(StudioService);

  // ── State signals ──
  readonly selectedStudioId = signal<string>('');
  activeTabIndex = 0;

  readonly loadingStock = signal(false);
  readonly loadingReceipts = signal(false);
  readonly loadingReport = signal(false);

  readonly stock = signal<StockItem[]>([]);
  readonly receipts = signal<InventoryReceipt[]>([]);
  readonly receiptsTotal = signal(0);
  readonly materialReport = signal<MaterialUsageReport[]>([]);

  /** productId -> name (for enriching receipt items that lack product_name) */
  readonly products = signal<Map<string, string>>(new Map());

  /** Inline min-stock dialog state */
  readonly editingMinStock = signal<{ item: StockItem; value: number } | null>(null);
  readonly savingMin = signal(false);

  /** Expanded receipt accordion */
  readonly expandedReceiptId = signal<string | null>(null);

  /** Receipts tab filters */
  readonly dateFrom = signal('');
  readonly dateTo = signal('');

  /** Report tab filters */
  readonly reportDateFrom = signal('');
  readonly reportDateTo = signal('');

  // ── Computed ──
  readonly stockWithStatus = computed<StockItemWithStatus[]>(() =>
    this.stock().map(item => ({
      ...item,
      status: item.min_quantity <= 0
        ? 'ok'
        : item.quantity <= 0
          ? 'critical'
          : item.quantity <= item.min_quantity
            ? 'low'
            : 'ok',
    }))
  );

  readonly lowStockCount = computed(() =>
    this.stockWithStatus().filter(s => s.status !== 'ok').length
  );

  readonly selectedStudioName = computed(() =>
    this.studioService.studioName(this.selectedStudioId())
  );

  // ────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadProductsMap();
    this.loadAll();
  }

  // ────────────────────────────────────────────────────────────
  // Load helpers
  // ────────────────────────────────────────────────────────────

  /** Preload product name lookup map for enriching receipt items */
  private loadProductsMap(): void {
    this.catalogApi.getProducts({ limit: 1000 }).subscribe({
      next: (res) => {
        const map = new Map<string, string>();
        for (const p of res.items) {
          map.set(p.id, p.name);
        }
        this.products.set(map);
      },
      error: () => {
        // Non-critical: fallback to product_id display
      },
    });
  }

  /** Load stock + receipts in parallel for the selected studio */
  loadAll(): void {
    forkJoin({
      stock: this.inventoryApi.getStock(this.selectedStudioId()),
      receipts: this.inventoryApi.getReceipts({ studio_id: this.selectedStudioId(), limit: 50 }),
    }).subscribe({
      next: ({ stock, receipts }) => {
        this.stock.set(stock);
        this.receipts.set(receipts.receipts);
        this.receiptsTotal.set(receipts.total);
        this.loadingStock.set(false);
        this.loadingReceipts.set(false);
      },
      error: (err) => {
        this.loadingStock.set(false);
        this.loadingReceipts.set(false);
        this.snackBar.open(
          `Ошибка загрузки данных: ${err?.error?.error ?? 'Нет соединения'}`,
          'OK',
          { duration: 5000 },
        );
      },
    });

    this.loadingStock.set(true);
    this.loadingReceipts.set(true);
  }

  loadStock(): void {
    this.loadingStock.set(true);
    this.inventoryApi.getStock(this.selectedStudioId()).subscribe({
      next: (items) => {
        this.stock.set(items);
        this.loadingStock.set(false);
      },
      error: (err) => {
        this.loadingStock.set(false);
        this.snackBar.open(
          `Ошибка загрузки остатков: ${err?.error?.error ?? 'Нет соединения'}`,
          'OK',
          { duration: 4000 },
        );
      },
    });
  }

  loadReceipts(): void {
    this.loadingReceipts.set(true);
    this.expandedReceiptId.set(null);
    this.inventoryApi.getReceipts({
      studio_id: this.selectedStudioId(),
      date_from: this.dateFrom() || undefined,
      date_to: this.dateTo() || undefined,
      limit: 50,
    }).subscribe({
      next: (res) => {
        this.receipts.set(res.receipts);
        this.receiptsTotal.set(res.total);
        this.loadingReceipts.set(false);
      },
      error: (err) => {
        this.loadingReceipts.set(false);
        this.snackBar.open(
          `Ошибка загрузки приёмок: ${err?.error?.error ?? 'Нет соединения'}`,
          'OK',
          { duration: 4000 },
        );
      },
    });
  }

  loadReport(): void {
    this.loadingReport.set(true);
    this.posApi.getMaterialReport(
      this.selectedStudioId(),
      this.reportDateFrom() || undefined,
      this.reportDateTo() || undefined,
    ).subscribe({
      next: (report) => {
        this.materialReport.set(report);
        this.loadingReport.set(false);
      },
      error: (err) => {
        this.loadingReport.set(false);
        this.snackBar.open(
          `Ошибка загрузки отчёта: ${err?.error?.error ?? 'Нет соединения'}`,
          'OK',
          { duration: 4000 },
        );
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // Event handlers
  // ────────────────────────────────────────────────────────────

  onStudioChange(studioId: string): void {
    this.selectedStudioId.set(studioId);
    // Reset data
    this.stock.set([]);
    this.receipts.set([]);
    this.receiptsTotal.set(0);
    this.materialReport.set([]);
    this.expandedReceiptId.set(null);
    this.editingMinStock.set(null);
    this.loadAll();
    // Also reload report if it was already loaded
    if (this.materialReport().length > 0) {
      this.loadReport();
    }
  }

  toggleReceipt(id: string): void {
    this.expandedReceiptId.set(this.expandedReceiptId() === id ? null : id);
  }

  startEditMin(item: StockItem): void {
    this.editingMinStock.set({ item, value: item.min_quantity });
  }

  updateEditingMinValue(value: number): void {
    const current = this.editingMinStock();
    if (current) {
      this.editingMinStock.set({ ...current, value });
    }
  }

  saveMinStock(): void {
    const editing = this.editingMinStock();
    if (!editing) return;

    const minQty = Math.max(0, Math.floor(editing.value));
    this.savingMin.set(true);

    this.inventoryApi.setMinStock(editing.item.product_id, this.selectedStudioId(), minQty).subscribe({
      next: () => {
        this.savingMin.set(false);
        this.editingMinStock.set(null);
        this.snackBar.open('Минимальный остаток обновлён', 'OK', { duration: 3000 });
        this.loadStock();
      },
      error: (err) => {
        this.savingMin.set(false);
        this.snackBar.open(
          `Ошибка сохранения: ${err?.error?.error ?? 'Попробуйте снова'}`,
          'OK',
          { duration: 4000 },
        );
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // Utility
  // ────────────────────────────────────────────────────────────

  /** Returns product name from catalog map; falls back to product_name on the item, then to ID */
  getItemName(productId: string): string {
    return this.products().get(productId) ?? productId;
  }

  formatDate(isoString: string): string {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  }

  /** Helper to extract string value from input event */
  getInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Helper to extract numeric value from input event */
  getInputValueNum(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }
}
