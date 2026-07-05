import {
  Component, ChangeDetectionStrategy, input, output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

export interface CatalogCategory {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly itemCount: number;
}

/** Predefined color palette for category tiles (Контур.Маркет–style) */
const CATEGORY_COLORS: readonly string[] = [
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#e11d48', // rose
  '#84cc16', // lime
  '#a855f7', // purple
] as const;

@Component({
  selector: 'app-catalog-tile-grid',
  imports: [MatIconModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'catalog-tile-grid' },
  template: `
    @if (loading()) {
      <div class="ctg-loading">
        <mat-spinner diameter="32" />
        <span>Загрузка каталога...</span>
      </div>
    } @else {
      <div class="ctg-grid">
        @for (cat of categories(); track cat.slug; let idx = $index) {
          <button class="ctg-tile"
                  [style.--tile-color]="tileColor(idx)"
                  (click)="categorySelected.emit(cat.slug)">
            <mat-icon class="ctg-icon">{{ cat.icon }}</mat-icon>
            <span class="ctg-name">{{ cat.name }}</span>
            @if (cat.itemCount > 0) {
              <span class="ctg-count">{{ cat.itemCount }} {{ itemWord(cat.itemCount) }}</span>
            }
          </button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    .ctg-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 48px 24px;
      color: var(--mat-sys-on-surface-variant, #7a7a7a);
      font-size: 13px;
    }

    .ctg-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 10px;
      padding: 12px;
    }

    .ctg-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      aspect-ratio: 1;
      min-height: 110px;
      padding: 12px 8px;
      border-radius: 16px;
      border: none;
      cursor: pointer;
      background: color-mix(in srgb, var(--tile-color) 15%, var(--mat-sys-surface, #1e1d1a));
      border: 2px solid color-mix(in srgb, var(--tile-color) 30%, transparent);
      transition: all 150ms ease;
      text-align: center;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      gap: 6px;
      outline: none;

      &:hover {
        background: color-mix(in srgb, var(--tile-color) 25%, var(--mat-sys-surface, #1e1d1a));
        border-color: color-mix(in srgb, var(--tile-color) 50%, transparent);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px color-mix(in srgb, var(--tile-color) 20%, transparent);
      }

      &:active {
        transform: scale(0.96);
      }

      &:focus-visible {
        outline: 2px solid var(--tile-color);
        outline-offset: 2px;
      }
    }

    .ctg-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--tile-color);
    }

    .ctg-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--mat-sys-on-surface, #ececec);
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .ctg-count {
      font-size: 10px;
      color: var(--mat-sys-on-surface-variant, #7a7a7a);
      line-height: 1;
    }
  `],
})
export class CatalogTileGridComponent {
  readonly categories = input.required<readonly CatalogCategory[]>();
  readonly loading = input(false);

  readonly categorySelected = output<string>();

  tileColor(index: number): string {
    return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
  }

  itemWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'товар';
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'товара';
    return 'товаров';
  }
}
