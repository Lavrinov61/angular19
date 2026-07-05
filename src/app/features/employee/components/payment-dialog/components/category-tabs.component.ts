import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { UiCategory } from '../models/payment-dialog.models';

@Component({
  selector: 'app-category-tabs',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {},
  template: `
    <div class="ct-scroll">
      <button
        class="ct-tab"
        [class.active]="activeSlug() === null"
        (click)="categorySelected.emit(null)"
      >
        <span class="ct-label">Все</span>
        <span class="ct-badge">{{ totalCount() }}</span>
      </button>
      @for (cat of categories(); track cat.slug) {
        <button
          class="ct-tab"
          [class.active]="activeSlug() === cat.slug"
          (click)="categorySelected.emit(cat.slug)"
        >
          <mat-icon class="ct-icon">{{ cat.icon }}</mat-icon>
          <span class="ct-label">{{ cat.name }}</span>
          <span class="ct-badge">{{ cat.allOptions.length }}</span>
        </button>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      position: relative;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
    }

    .ct-scroll {
      display: flex;
      gap: 2px;
      overflow-x: auto;
      scrollbar-width: none;
      padding: 0 20px;
      mask-image: linear-gradient(to right, black calc(100% - 32px), transparent 100%);
      -webkit-mask-image: linear-gradient(to right, black calc(100% - 32px), transparent 100%);

      &::-webkit-scrollbar { display: none; }
    }

    .ct-tab {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 7px 12px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #a0a0a0;
      font-size: 11px;
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 150ms ease;

      &:hover {
        color: #ececec;
        background: rgba(255, 255, 255, 0.03);
      }

      &.active {
        color: #f59e0b;
        border-bottom-color: #f59e0b;
        background: rgba(245, 158, 11, 0.08);
      }
    }

    .ct-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;

      .ct-tab.active & { color: #f59e0b; }
    }

    .ct-label {
      line-height: 1;
    }

    .ct-badge {
      font-size: 9px;
      font-weight: 700;
      color: #7a7a7a;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      padding: 2px 5px;
      line-height: 1;
      min-width: 14px;
      text-align: center;

      .ct-tab.active & {
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.12);
      }
    }
  `],
})
export class CategoryTabsComponent {
  readonly categories = input.required<readonly UiCategory[]>();
  readonly activeSlug = input.required<string | null>();

  readonly categorySelected = output<string | null>();

  readonly totalCount = computed(() =>
    this.categories().reduce((sum, c) => sum + c.allOptions.length, 0),
  );
}
