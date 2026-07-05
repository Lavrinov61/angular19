import {
  Component, ChangeDetectionStrategy, input, output,
  signal, computed, ElementRef, viewChild, AfterViewInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-pos-cash-tendered',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule, DecimalPipe],
  host: {
    '(keydown.enter)': 'onEnter()',
  },
  template: `
    <div class="cash-tendered">
      <div class="total-display">
        <span class="total-label">ИТОГО</span>
        <span class="total-amount">{{ total() | number:'1.0-0' }} ₽</span>
      </div>

      <div class="quick-buttons">
        <button mat-flat-button class="quick-btn" (click)="setTendered(total())">
          Без сдачи
        </button>
        @if (roundUp500() > total()) {
          <button mat-stroked-button class="quick-btn" (click)="setTendered(roundUp500())">
            {{ roundUp500() }} ₽
          </button>
        }
        @if (roundUp1000() > total()) {
          <button mat-stroked-button class="quick-btn" (click)="setTendered(roundUp1000())">
            {{ roundUp1000() }} ₽
          </button>
        }
        <button mat-stroked-button class="quick-btn" (click)="setTendered(2000)">
          2 000 ₽
        </button>
        <button mat-stroked-button class="quick-btn" (click)="setTendered(5000)">
          5 000 ₽
        </button>
      </div>

      <div class="custom-input">
        <input #tenderedInput
               type="number"
               [ngModel]="tenderedValue()"
               (ngModelChange)="tenderedValue.set($event)"
               placeholder="Сумма от клиента"
               min="0"
               step="100" />
      </div>

      <div class="change-display" [class.negative]="change() < 0">
        <span class="change-label">{{ change() >= 0 ? 'Сдача' : 'Недостаточно' }}</span>
        <span class="change-amount">{{ change() | number:'1.0-0' }} ₽</span>
      </div>

      <button mat-flat-button class="confirm-btn"
              [disabled]="change() < 0 || !tenderedValue()"
              (click)="onConfirm()">
        <mat-icon>check</mat-icon>
        Подтвердить
      </button>
    </div>
  `,
  styles: [`
    .cash-tendered {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 8px 0;
    }

    .total-display {
      text-align: center;
      .total-label {
        display: block;
        font-size: 14px;
        color: var(--mat-sys-on-surface-variant);
        margin-bottom: 4px;
      }
      .total-amount {
        display: block;
        font-size: 36px;
        font-weight: 700;
        color: var(--mat-sys-on-surface);
      }
    }

    .quick-buttons {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      button.quick-btn {
        height: 60px;
        font-size: 16px;
        font-weight: 500;
      }
    }

    .custom-input {
      input {
        width: 100%;
        box-sizing: border-box;
        font-size: 32px;
        text-align: center;
        padding: 12px;
        border: 2px solid var(--mat-sys-outline-variant);
        border-radius: 12px;
        background: var(--mat-sys-surface-container);
        color: var(--mat-sys-on-surface);
        outline: none;
        transition: border-color 0.2s;
        &:focus {
          border-color: var(--mat-sys-primary);
        }
        /* Hide number spinners */
        &::-webkit-outer-spin-button,
        &::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        -moz-appearance: textfield;
      }
    }

    .change-display {
      text-align: center;
      padding: 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);

      .change-label {
        display: block;
        font-size: 14px;
        color: var(--mat-sys-on-surface-variant);
        margin-bottom: 4px;
      }
      .change-amount {
        display: block;
        font-size: 48px;
        font-weight: 700;
        color: var(--mat-sys-primary);
      }

      &.negative {
        background: color-mix(in srgb, var(--mat-sys-error) 10%, transparent);
        .change-amount { color: var(--mat-sys-error); }
      }
    }

    .confirm-btn {
      height: 56px;
      font-size: 18px;
      font-weight: 500;
    }
  `],
})
export class PosCashTenderedComponent implements AfterViewInit {
  readonly total = input.required<number>();
  readonly confirmed = output<number>();

  readonly tenderedInput = viewChild<ElementRef<HTMLInputElement>>('tenderedInput');
  readonly tenderedValue = signal<number | null>(null);

  readonly roundUp500 = computed(() => Math.ceil(this.total() / 500) * 500);
  readonly roundUp1000 = computed(() => Math.ceil(this.total() / 1000) * 1000);

  readonly change = computed(() => {
    const tendered = this.tenderedValue();
    if (tendered === null || tendered === 0) return 0;
    return Math.round((tendered - this.total()) * 100) / 100;
  });

  ngAfterViewInit(): void {
    setTimeout(() => this.tenderedInput()?.nativeElement.focus(), 100);
  }

  setTendered(amount: number): void {
    this.tenderedValue.set(amount);
  }

  onEnter(): void {
    if (this.tenderedValue() && this.change() >= 0) {
      this.onConfirm();
    }
  }

  onConfirm(): void {
    const v = this.tenderedValue();
    if (v && v >= this.total()) {
      this.confirmed.emit(v);
    }
  }
}
