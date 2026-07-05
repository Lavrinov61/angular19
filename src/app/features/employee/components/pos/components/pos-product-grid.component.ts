import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Product } from '../../../services/catalog-api.service';
import { EmployeeFavorite } from '../../../services/pos-api.service';
import {
  PricingConfiguratorComponent,
  OrderSelectedEvent,
} from '../../../../../shared/components/pricing-configurator/pricing-configurator.component';
import { PosProductTileComponent } from './pos-product-tile.component';

interface PricingCategory {
  slug: string;
  name: string;
  icon: string | null;
}

@Component({
  selector: 'app-pos-product-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressBarModule, MatIconModule, MatButtonModule, MatTooltipModule,
    PricingConfiguratorComponent, PosProductTileComponent,
  ],
  host: { class: 'pos-product-grid' },
  template: `
    @if (loading()) {
      <div class="products-loading">
        <mat-progress-bar mode="indeterminate" />
      </div>
    }

    @if (pricingMode()) {
      <div class="pricing-mode-panel">
        <div class="pricing-cats">
          @for (pc of pricingCategories(); track pc.slug) {
            <button mat-stroked-button
                    [class.active-cat]="selectedPricingSlug() === pc.slug"
                    (click)="pricingSlugChanged.emit(pc.slug)">
              @if (pc.icon) { <mat-icon>{{ pc.icon }}</mat-icon> }
              {{ pc.name }}
            </button>
          }
        </div>
        @if (selectedPricingSlug()) {
          <div class="pricing-configurator-wrap">
            <app-pricing-configurator
              [categorySlug]="selectedPricingSlug()!"
              deliveryMethod="pickup"
              [showHeader]="true"
              (orderSelected)="pricingOrderSelected.emit($event)"
            />
          </div>
        }
      </div>
    }

    <div class="products-grid" [class.hidden-in-pricing]="pricingMode()">
      @for (product of products(); track product.id) {
        <app-pos-product-tile
          [product]="product"
          (tileClicked)="productAdded.emit(product)"
        />
      } @empty {
        @if (!loading() && !showFavorites()) {
          <div class="empty-products">
            <mat-icon>inventory_2</mat-icon>
            <span>Товары не найдены</span>
          </div>
        }
      }
      @if (showFavorites() && employeeFavorites().length > 0) {
        <div class="fav-section-header">Избранные услуги</div>
        @for (fav of employeeFavorites(); track fav.id) {
          <div class="fav-tile" role="button" tabindex="0">
            <div class="fav-tile-top">
              <button class="fav-remove-btn" matTooltip="Убрать из избранного"
                      (click)="favoriteToggled.emit(fav.service_option_id); $event.stopPropagation()">
                <mat-icon>star</mat-icon>
              </button>
            </div>
            @if (fav.icon) {
              <mat-icon class="fav-tile-icon">{{ fav.icon }}</mat-icon>
            } @else {
              <mat-icon class="fav-tile-icon">design_services</mat-icon>
            }
            <div class="fav-tile-name">{{ fav.name }}</div>
            <div class="fav-tile-price">{{ fav.base_price }}\u20BD</div>
            @if (fav.category_name) {
              <div class="fav-tile-cat">{{ fav.category_name }}</div>
            }
          </div>
        }
      }
      @if (showFavorites() && products().length === 0 && employeeFavorites().length === 0 && !loading()) {
        <div class="empty-products">
          <mat-icon>star_border</mat-icon>
          <span>Нет избранных</span>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }
    .products-loading { padding: 0 12px; }

    .products-grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      padding: 8px 12px;
      overflow-y: auto;
      align-content: start;
    }
    @media (min-width: 600px) {
      .products-grid { grid-template-columns: repeat(3, 1fr); }
    }
    @media (min-width: 1100px) {
      .products-grid { grid-template-columns: repeat(4, 1fr); }
    }

    .empty-products {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px;
      color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; }
    }

    .pricing-mode-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pricing-cats {
      display: flex;
      gap: 6px;
      padding: 0 12px 8px;
      overflow-x: auto;
      scrollbar-width: none;
      &::-webkit-scrollbar { display: none; }
      button {
        white-space: nowrap;
        flex-shrink: 0;
        font-size: 13px;
        height: 36px;
        mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
      }
    }
    .active-cat {
      background: var(--mat-sys-primary) !important;
      color: var(--mat-sys-on-primary) !important;
    }
    .pricing-configurator-wrap {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px 80px;
    }
    .hidden-in-pricing {
      display: none !important;
    }

    /* F62: Favorite tiles */
    .fav-section-header {
      grid-column: 1 / -1;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--mat-sys-on-surface-variant);
      padding: 8px 0 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
      margin-top: 4px;
    }
    .fav-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 12px 8px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-primary-container);
      background: color-mix(in srgb, var(--mat-sys-primary-container) 15%, var(--mat-sys-surface));
      cursor: pointer;
      min-height: 80px;
      transition: background 0.15s, transform 0.1s;
      position: relative;
      text-align: center;
      &:hover {
        background: var(--mat-sys-surface-container);
        transform: scale(1.02);
      }
    }
    .fav-tile-top {
      position: absolute;
      top: 4px;
      right: 4px;
    }
    .fav-remove-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        color: var(--crm-status-warning);
      }
    }
    .fav-tile-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 4px;
    }
    .fav-tile-name {
      font-size: 13px;
      font-weight: 500;
      line-height: 1.2;
      margin-bottom: 4px;
      color: var(--mat-sys-on-surface);
    }
    .fav-tile-price {
      font-size: 15px;
      font-weight: 700;
      color: var(--mat-sys-primary);
    }
    .fav-tile-cat {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class PosProductGridComponent {
  readonly products = input.required<Product[]>();
  readonly loading = input.required<boolean>();
  readonly pricingMode = input.required<boolean>();
  readonly pricingCategories = input.required<PricingCategory[]>();
  readonly selectedPricingSlug = input.required<string | null>();
  readonly employeeFavorites = input<EmployeeFavorite[]>([]);
  readonly favoriteOptionIds = input<Set<string>>(new Set());
  readonly showFavorites = input(false);

  readonly productAdded = output<Product>();
  readonly pricingOrderSelected = output<OrderSelectedEvent>();
  readonly pricingSlugChanged = output<string>();
  readonly favoriteToggled = output<string>();
}
