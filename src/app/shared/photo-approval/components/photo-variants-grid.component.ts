import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { ReviewVariant } from '../../../features/photo-review/photo-review.service';

@Component({
  selector: 'app-photo-variants-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'photo-variants-grid' },
  template: `
    <div class="variant-label-row">
      <mat-icon>palette</mat-icon>
      <span>Выберите понравившийся вариант</span>
    </div>
    <div class="variant-list">
      @for (v of variants(); track v.id) {
        <button class="variant-card" [class.selected]="selectedVariantId() === v.id"
                (click)="variantSelected.emit(v)">
          <img [src]="v.thumbnail_url || v.variant_url" [alt]="v.label || 'Вариант'" loading="lazy" />
          @if (selectedVariantId() === v.id) {
            <span class="variant-selected-overlay">
              <mat-icon>check_circle</mat-icon>
            </span>
          }
          <span class="variant-name">{{ v.label || 'Вариант ' + (v.sort_order + 1) }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 12px;
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 14px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .variant-label-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 8px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .variant-list {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 4px;
      -webkit-overflow-scrolling: touch;
      scroll-snap-type: x mandatory;

      &::-webkit-scrollbar { height: 0; }
    }

    .variant-card {
      position: relative;
      flex-shrink: 0;
      width: 96px;
      background: none;
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      padding: 0;
      transition: border-color 0.2s, transform 0.15s, box-shadow 0.2s;
      scroll-snap-align: center;

      &:active { transform: scale(0.95); }

      img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        display: block;
      }

      .variant-name {
        display: block;
        padding: 4px 6px;
        font-size: 10px;
        color: var(--ed-on-surface-variant, #a0a0a0);
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .variant-selected-overlay {
        position: absolute;
        inset: 0;
        bottom: auto;
        aspect-ratio: 1;
        background: rgba(34, 197, 94, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon { font-size: 24px; width: 24px; height: 24px; color: #fff; }
      }

      &.selected {
        border-color: #4ade80;
        transform: scale(1.05);
        box-shadow: 0 0 12px rgba(74, 222, 128, 0.3);

        .variant-name { color: #4ade80; font-weight: 600; }
      }
    }
  `,
})
export class PhotoVariantsGridComponent {
  readonly variants = input.required<ReviewVariant[]>();
  readonly selectedVariantId = input<string | null>(null);

  readonly variantSelected = output<ReviewVariant>();
}
