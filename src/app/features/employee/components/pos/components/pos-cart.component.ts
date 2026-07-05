import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CartItem } from '../../../services/pos.service';
import { PosCartItemComponent } from './pos-cart-item.component';

@Component({
  selector: 'app-pos-cart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, PosCartItemComponent],
  host: { class: 'pos-cart' },
  template: `
    @for (item of items(); track item.product.id) {
      <app-pos-cart-item
        [item]="item"
        [discountLabel]="waterfallLabels()?.get(item.product.id) ?? null"
        (removed)="itemRemoved.emit(item.product.id)"
        (quantityChanged)="quantityChanged.emit({ productId: item.product.id, quantity: $event })"
        (discountApplied)="discountApplied.emit({ productId: item.product.id, percent: $event })"
      />
    } @empty {
      <div class="empty-receipt">
        <mat-icon>receipt_long</mat-icon>
        <span>Добавьте товары из каталога</span>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
    }
    .empty-receipt {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px 16px;
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
      span { font-size: 14px; }
    }
  `],
})
export class PosCartComponent {
  readonly items = input.required<CartItem[]>();
  readonly waterfallLabels = input<Map<string, string> | null>(null);

  readonly itemRemoved = output<string>();
  readonly quantityChanged = output<{ productId: string; quantity: number }>();
  readonly discountApplied = output<{ productId: string; percent: number }>();
}
