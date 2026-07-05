import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PriceFormatPipe } from '../pipes/price-format.pipe';
import type { SelectedItem, BreakdownItem } from '../models/payment-dialog.models';

export interface QuantitySetEvent {
  serviceId: string;
  quantity: number;
}

export interface PeopleCountSetEvent {
  serviceId: string;
  peopleCount: number;
}

@Component({
  selector: 'app-pd-selection-summary',
  imports: [MatIconModule, PriceFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {},
  template: `
    <div class="ss-list">
      @for (item of items(); track item.service.id; let idx = $index) {
        <div class="ss-row">
          <div class="ss-title">
            <span class="ss-name">{{ item.service.name }}</span>
          </div>
          <div class="ss-controls">
            <div class="ss-stepper">
              @if (isMultiPersonItem(item)) {
                <span class="ss-stepper-label">компл.</span>
              }
              <div class="ss-qty">
                <button
                  class="ss-qty-btn"
                  (click)="quantityChanged.emit({ serviceId: item.service.id, delta: -1 })"
                  aria-label="Уменьшить количество комплектов"
                >
                  <mat-icon>remove</mat-icon>
                </button>
                <input
                  class="ss-qty-input"
                  type="number"
                  [value]="item.quantity"
                  min="1"
                  (change)="onQtyInput(item.service.id, $event)"
                  (keydown.enter)="$any($event.target).blur()"
                />
                <button
                  class="ss-qty-btn"
                  (click)="quantityChanged.emit({ serviceId: item.service.id, delta: 1 })"
                  aria-label="Увеличить количество комплектов"
                >
                  <mat-icon>add</mat-icon>
                </button>
              </div>
            </div>
            @if (isMultiPersonItem(item)) {
              <div class="ss-stepper">
                <span class="ss-stepper-label">людей</span>
                <div class="ss-qty">
                  <button
                    class="ss-qty-btn"
                    (click)="peopleCountChanged.emit({ serviceId: item.service.id, delta: -1 })"
                    aria-label="Уменьшить количество людей"
                  >
                    <mat-icon>remove</mat-icon>
                  </button>
                  <input
                    class="ss-qty-input"
                    type="number"
                    [value]="personCount(item)"
                    min="1"
                    [max]="item.quantity"
                    (change)="onPeopleInput(item.service.id, $event)"
                    (keydown.enter)="$any($event.target).blur()"
                  />
                  <button
                    class="ss-qty-btn"
                    [disabled]="personCount(item) >= item.quantity"
                    (click)="peopleCountChanged.emit({ serviceId: item.service.id, delta: 1 })"
                    aria-label="Увеличить количество людей"
                  >
                    <mat-icon>add</mat-icon>
                  </button>
                </div>
              </div>
            }
          </div>
          <div class="ss-price-col">
            <span class="ss-price">
              @if (breakdownItem(idx); as bd) {
                {{ bd.total | priceFormat }}
              } @else {
                {{ item.service.price * item.quantity | priceFormat }}
              }
            </span>
            @if (breakdownItem(idx); as bd) {
              @if (bd.priceNote) {
                <span class="ss-price-note">{{ bd.priceNote }}</span>
              }
              @if (bd.discountLabel) {
                <span class="ss-discount">{{ bd.discountLabel }}</span>
              }
            }
          </div>
          <button
            class="ss-remove"
            (click)="itemRemoved.emit(item.service.id)"
            aria-label="Удалить"
          >
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
    }

    .ss-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .ss-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.06);
      border: 1px solid rgba(245, 158, 11, 0.15);
    }

    .ss-title {
      flex: 1;
      min-width: 0;
    }

    .ss-name {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #ececec;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ss-controls {
      display: inline-flex;
      align-items: flex-end;
      gap: 6px;
      flex-shrink: 0;
    }

    .ss-stepper {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .ss-stepper-label {
      font-size: 9px;
      font-weight: 700;
      line-height: 1;
      color: #8a8a8a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .ss-qty {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }

    .ss-qty-btn {
      width: 24px;
      height: 24px;
      background: rgba(255, 255, 255, 0.06);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #a0a0a0;
      transition: all 100ms ease;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #ececec;
      }

      &:disabled {
        cursor: default;
        opacity: 0.35;
      }

      &:disabled:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #a0a0a0;
      }

      &:focus-visible {
        outline: 2px solid rgba(245, 158, 11, 0.6);
        outline-offset: 1px;
      }
    }

    .ss-qty-input {
      font-size: 12px;
      font-weight: 700;
      color: #ececec;
      width: 42px;
      text-align: center;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      padding: 2px 0;
      outline: none;
      -moz-appearance: textfield;

      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      &:focus {
        border-color: rgba(245, 158, 11, 0.5);
        background: rgba(255, 255, 255, 0.1);
      }
    }

    .ss-price-col {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      flex-shrink: 0;
      gap: 1px;
    }

    .ss-price {
      font-size: 12px;
      font-weight: 600;
      color: #fbbf24;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      white-space: nowrap;
    }

    .ss-discount {
      font-size: 10px;
      color: #34d399;
      font-weight: 500;
      white-space: nowrap;
    }

    .ss-price-note {
      font-size: 10px;
      color: #f59e0b;
      font-weight: 600;
      white-space: nowrap;
    }

    .ss-remove {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      color: rgba(245, 158, 11, 0.5);
      flex-shrink: 0;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover { color: #f87171; }

      &:focus-visible {
        outline: 2px solid rgba(245, 158, 11, 0.6);
        outline-offset: 1px;
      }
    }
  `],
})
export class SelectionSummaryComponent {
  readonly items = input.required<readonly SelectedItem[]>();
  readonly breakdown = input<readonly BreakdownItem[]>([]);

  readonly quantityChanged = output<{ serviceId: string; delta: number }>();
  readonly quantitySet = output<QuantitySetEvent>();
  readonly peopleCountChanged = output<{ serviceId: string; delta: number }>();
  readonly peopleCountSet = output<PeopleCountSetEvent>();
  readonly itemRemoved = output<string>();

  breakdownItem(index: number): BreakdownItem | null {
    const bd = this.breakdown();
    return index < bd.length ? bd[index] : null;
  }

  onQtyInput(serviceId: string, event: Event): void {
    const value = this.inputNumber(event);
    if (value != null && value > 0) {
      this.quantitySet.emit({ serviceId, quantity: value });
    }
  }

  onPeopleInput(serviceId: string, event: Event): void {
    const value = this.inputNumber(event);
    if (value != null && value > 0) {
      this.peopleCountSet.emit({ serviceId, peopleCount: value });
    }
  }

  isMultiPersonItem(item: SelectedItem): boolean {
    return item.service.categorySlug === 'photo-docs' && item.service.groupSlug === 'document-type';
  }

  personCount(item: SelectedItem): number {
    const raw = item.peopleCount ?? 1;
    return Math.min(Math.max(1, Math.floor(raw)), item.quantity);
  }

  private inputNumber(event: Event): number | null {
    if (!(event.target instanceof HTMLInputElement)) return null;
    const value = parseInt(event.target.value, 10);
    return Number.isFinite(value) ? value : null;
  }
}
