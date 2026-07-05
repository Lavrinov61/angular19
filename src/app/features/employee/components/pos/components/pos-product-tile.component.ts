import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Product } from '../../../services/catalog-api.service';

@Component({
  selector: 'app-pos-product-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  host: {
    class: 'pos-product-tile',
    '[class.service-tile]': 'product().product_type === "service"',
    '[class.product-tile-type]': 'product().product_type === "product"',
    '(click)': 'tileClicked.emit()',
    role: 'button',
    tabindex: '0',
  },
  template: `
    <div class="tile-top">
      @if (product().is_favorite) {
        <mat-icon class="fav-star">star</mat-icon>
      }
      @if (product().is_subscription_eligible) {
        <mat-icon class="sub-badge" matTooltip="Доступно по подписке">card_membership</mat-icon>
      }
    </div>
    @if (product().image_url) {
      <img [src]="product().image_url" [alt]="product().name" class="tile-img" loading="lazy">
    } @else {
      <mat-icon class="tile-fallback-icon">{{ product().product_type === 'service' ? 'design_services' : 'inventory_2' }}</mat-icon>
    }
    <div class="tile-name">{{ product().name }}</div>
    <div class="tile-price">{{ product().sell_price }}\u20BD</div>
    @if (product().unit !== 'piece') {
      <div class="tile-unit">/ {{ unitLabel() }}</div>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 12px 8px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
      cursor: pointer;
      min-height: 80px;
      transition: background 0.15s, transform 0.1s;
      position: relative;
      text-align: center;
      &:hover {
        background: var(--mat-sys-surface-container);
        transform: scale(1.02);
      }
      &:active { transform: scale(0.97); }
    }
    :host(.service-tile) {
      border-color: var(--mat-sys-primary-container);
      background: color-mix(in srgb, var(--mat-sys-primary-container) 20%, var(--mat-sys-surface));
    }
    .tile-top {
      position: absolute;
      top: 4px;
      right: 4px;
      display: flex;
      gap: 2px;
    }
    .fav-star {
      font-size: 14px; width: 14px; height: 14px;
      color: var(--crm-status-warning);
    }
    .sub-badge {
      font-size: 14px; width: 14px; height: 14px;
      color: var(--mat-sys-tertiary);
    }
    .tile-img {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 6px;
      margin-bottom: 4px;
    }
    .tile-fallback-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 4px;
    }
    .tile-name {
      font-size: 13px;
      font-weight: 500;
      line-height: 1.2;
      margin-bottom: 4px;
      color: var(--mat-sys-on-surface);
    }
    .tile-price {
      font-size: 15px;
      font-weight: 700;
      color: var(--mat-sys-primary);
    }
    .tile-unit {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class PosProductTileComponent {
  readonly product = input.required<Product>();
  readonly tileClicked = output();

  private static readonly UNIT_LABELS: Record<string, string> = {
    piece: 'шт', sheet: 'лист', copy: 'копия',
    set: 'компл', meter: 'м', kg: 'кг',
  };

  unitLabel(): string {
    return PosProductTileComponent.UNIT_LABELS[this.product().unit] || this.product().unit;
  }
}
