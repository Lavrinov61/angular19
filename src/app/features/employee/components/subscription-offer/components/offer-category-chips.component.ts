import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { CategoryMeta } from '../models/subscription-offer.models';

@Component({
  selector: 'app-offer-category-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="chips-row">
      @for (cat of categories(); track cat.key) {
        <button
          class="cat-chip"
          [class.cat-chip--active]="selectedCategory() === cat.key"
          (click)="categorySelected.emit(cat.key)"
        >
          <mat-icon class="cat-chip__icon">{{ cat.icon }}</mat-icon>
          <span>{{ cat.label }}</span>
        </button>
      }
    </div>
  `,
  styles: [`
    .chips-row {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: none;
    }
    .chips-row::-webkit-scrollbar { display: none; }

    .cat-chip {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 7px 12px;
      border: 1px solid var(--ed-outline-variant, #3a3a4a);
      border-radius: 18px;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0b0);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.15s;
    }
    .cat-chip:hover {
      border-color: var(--ed-accent, #f59e0b);
      color: var(--ed-on-surface, #e0e0e0);
    }
    .cat-chip--active {
      background: var(--ed-accent-container, rgba(245,158,11,0.15));
      border-color: var(--ed-accent, #f59e0b);
      color: var(--ed-accent, #f59e0b);
      font-weight: 600;
    }
    .cat-chip__icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
  `],
})
export class OfferCategoryChipsComponent {
  readonly categories = input.required<readonly CategoryMeta[]>();
  readonly selectedCategory = input.required<string>();
  readonly categorySelected = output<string>();
}
