import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-pos-loyalty-spend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'pos-loyalty-spend' },
  template: `
    <div class="loyalty-row">
      <div class="loyalty-info">
        <mat-icon>stars</mat-icon>
        <span>Бонусы: {{ points() }} бонусов</span>
        <span class="loyalty-hint">
          @if (disabledReason()) {
            {{ disabledReason() }}
          } @else {
            1 бонус = 1&#8381; · до {{ maxPointsToUse() }}&#8381;
          }
        </span>
      </div>
      <div class="loyalty-action">
        <button (click)="toggleRequested.emit()" class="loyalty-toggle"
          [class.active]="pointsToUse() > 0"
          [disabled]="pointsToUse() <= 0 && maxPointsToUse() <= 0">
          @if (pointsToUse() > 0) {
            Списать {{ pointsToUse() }} бонусов (-{{ discount() }}&#8381;)
          } @else {
            Использовать бонусы
          }
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      padding: 8px 12px;
      margin: 0 12px 4px;
      background: color-mix(in srgb, var(--crm-status-warning) 10%, var(--mat-sys-surface));
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .loyalty-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .loyalty-info {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-status-warning); }
    }
    .loyalty-hint {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      font-weight: 400;
    }
    .loyalty-toggle {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      background: transparent;
      color: var(--mat-sys-on-surface);
      transition: all 0.15s ease;
      &:hover { background: var(--mat-sys-surface-container); }
      &:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      &.active {
        background: var(--crm-status-warning);
        color: #fff;
        border-color: var(--crm-status-warning);
      }
    }
  `],
})
export class PosLoyaltySpendComponent {
  readonly points = input.required<number>();
  readonly pointsToUse = input(0);
  readonly discount = input(0);
  readonly maxPointsToUse = input(0);
  readonly disabledReason = input<string | null>(null);

  readonly toggleRequested = output();
}
