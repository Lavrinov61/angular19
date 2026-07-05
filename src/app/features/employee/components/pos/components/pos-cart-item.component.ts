import { Component, ChangeDetectionStrategy, input, output, computed, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { CartItem } from '../../../services/pos.service';
import { isNewBadgeVisible, markBadgeSeen } from '../../../../../shared/utils/new-badge.util';

@Component({
  selector: 'app-pos-cart-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatMenuModule],
  host: { class: 'pos-cart-item' },
  template: `
    <div class="item-top">
      <span class="item-name">{{ item().product.name }}</span>
      <button mat-icon-button class="item-remove" (click)="removed.emit()">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <div class="item-bottom">
      <div class="qty-controls">
        <button mat-icon-button class="qty-btn" (click)="quantityChanged.emit(item().quantity - 1)">
          <mat-icon>remove</mat-icon>
        </button>
        <span class="qty-value">{{ item().quantity }}</span>
        <button mat-icon-button class="qty-btn" (click)="quantityChanged.emit(item().quantity + 1)">
          <mat-icon>add</mat-icon>
        </button>
      </div>
      <div class="item-prices">
        <span class="item-unit-price">{{ item().unit_price }}\u20BD</span>
        @if (item().discount_amount > 0) {
          <span class="item-discount">-{{ item().discount_amount }}\u20BD</span>
        }
        <span class="item-total">{{ item().total }}\u20BD</span>
      </div>
    </div>
    @if (discountLabel()) {
      <div class="wf-discount-label">
        @for (part of labelParts(); track $index) {
          @if (part.type === 'discount') {
            <span class="wf-discount">{{ part.text }}</span>
          } @else {
            <span class="wf-volume-hint">{{ part.text }} @if (showVolumeHintBadge()) { <button class="new-badge" (click)="dismissVolumeHintBadge()">NEW</button> }</span>
          }
        }
      </div>
    }
    @if (item().product.is_discount_allowed) {
      <div class="item-actions">
        <button mat-button class="discount-btn" [matMenuTriggerFor]="discountMenu">
          @if (item().discount_percent > 0) {
            Скидка {{ item().discount_percent }}%
          } @else {
            Скидка
          }
        </button>
        <mat-menu #discountMenu="matMenu">
          <button mat-menu-item (click)="discountApplied.emit(0)">Без скидки</button>
          <button mat-menu-item (click)="discountApplied.emit(5)">5%</button>
          <button mat-menu-item (click)="discountApplied.emit(10)">10%</button>
          <button mat-menu-item (click)="discountApplied.emit(15)">15%</button>
          <button mat-menu-item (click)="discountApplied.emit(20)">20%</button>
          <button mat-menu-item (click)="discountApplied.emit(50)">50%</button>
        </mat-menu>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      &:last-child { border-bottom: none; }
    }
    .item-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .item-name {
      font-size: 14px;
      font-weight: 500;
      line-height: 1.3;
      flex: 1;
    }
    .item-remove {
      width: 28px; height: 28px;
      line-height: 28px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .item-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
    }
    .qty-controls {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .qty-btn {
      width: 48px; height: 48px;
      mat-icon { font-size: 18px; }
    }
    .qty-value {
      min-width: 24px;
      text-align: center;
      font-weight: 600;
      font-size: 15px;
    }
    .item-prices {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 13px;
    }
    .item-unit-price { color: var(--mat-sys-on-surface-variant); }
    .item-discount { color: var(--crm-status-error); font-size: 12px; }
    .item-total { font-weight: 700; font-size: 15px; }
    .wf-discount-label {
      font-size: 11px;
      margin-top: 2px;
      padding-left: 2px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .wf-discount { color: var(--crm-status-success); }
    .wf-volume-hint {
      color: var(--mat-sys-primary);
      font-weight: 500;
    }
    .new-badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      background: #ff6b35;
      color: white;
      margin-left: 4px;
      cursor: pointer;
      vertical-align: middle;
      animation: newBadgePulse 2s ease-in-out infinite;
    }
    @keyframes newBadgePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .item-actions { margin-top: 2px; }
    .discount-btn {
      font-size: 12px;
      height: 28px;
      line-height: 28px;
      color: var(--mat-sys-primary);
    }
  `],
})
export class PosCartItemComponent {
  readonly item = input.required<CartItem>();
  readonly discountLabel = input<string | null>(null);
  readonly removed = output();
  readonly quantityChanged = output<number>();
  readonly discountApplied = output<number>();
  readonly showVolumeHintBadge = signal(isNewBadgeVisible('volume-hints'));

  dismissVolumeHintBadge(): void {
    markBadgeSeen('volume-hints');
    this.showVolumeHintBadge.set(false);
  }

  /** Split "discount | volumeHint" into typed parts for separate styling */
  readonly labelParts = computed(() => {
    const label = this.discountLabel();
    if (!label) return [];
    return label.split(' | ').map((text, i) => ({
      text,
      type: i === 0 && !text.includes('ещё') ? 'discount' as const : 'hint' as const,
    }));
  });
}
