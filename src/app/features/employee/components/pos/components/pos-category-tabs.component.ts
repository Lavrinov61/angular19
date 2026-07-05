import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductCategory } from '../../../services/catalog-api.service';

@Component({
  selector: 'app-pos-category-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  host: { class: 'pos-category-tabs' },
  template: `
    <button mat-stroked-button
            [class.active-cat]="!selectedId()"
            (click)="categorySelected.emit(null)">
      <mat-icon>apps</mat-icon> Все
    </button>
    <button mat-stroked-button
            [class.active-cat]="selectedId() === 'favorites'"
            (click)="categorySelected.emit('favorites')">
      <mat-icon>star</mat-icon> Избранное
    </button>
    <button mat-stroked-button
            [class.active-cat]="!pricingMode()"
            (click)="pricingToggled.emit()">
      <mat-icon>inventory_2</mat-icon> Товары
    </button>
    @for (cat of categories(); track cat.id) {
      <button mat-stroked-button
              [class.active-cat]="selectedId() === cat.id"
              (click)="categorySelected.emit(cat.id)">
        @if (cat.icon) { <mat-icon>{{ cat.icon }}</mat-icon> }
        {{ cat.name }}
      </button>
    }
  `,
  styles: [`
    :host {
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
  `],
})
export class PosCategoryTabsComponent {
  readonly categories = input.required<ProductCategory[]>();
  readonly selectedId = input.required<string | null>();
  readonly pricingMode = input.required<boolean>();
  readonly categorySelected = output<string | null>();
  readonly pricingToggled = output();
}
