import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'app-pd-manual-amount',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {},
  template: `
    <div class="ma-section-label">ВРУЧНУЮ</div>
    <div class="ma-row">
      <input
        class="ma-input ma-amount"
        type="number"
        min="0"
        max="999999"
        [value]="amount()"
        (input)="amountChanged.emit($any($event.target).value)"
        placeholder="0"
        aria-label="Сумма вручную"
      />
      <input
        class="ma-input ma-desc"
        type="text"
        maxlength="200"
        [value]="description()"
        (input)="descriptionChanged.emit($any($event.target).value)"
        placeholder="Описание услуги..."
        aria-label="Описание"
      />
    </div>
  `,
  styles: [`
    :host {
      display: block;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
    }

    .ma-section-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #5c5c5c;
      margin-bottom: 8px;
    }

    .ma-row {
      display: flex;
      gap: 10px;
    }

    .ma-input {
      height: 36px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
      color: #ececec;
      font-size: 13px;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      padding: 0 12px;
      outline: none;
      transition: border-color 150ms ease;
      box-sizing: border-box;

      &::placeholder { color: #5c5c5c; }

      &:focus { border-color: rgba(245, 158, 11, 0.4); }
    }

    .ma-amount {
      width: 100px;
      flex-shrink: 0;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-weight: 600;

      /* Hide number spinners */
      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      -moz-appearance: textfield;
    }

    .ma-desc {
      flex: 1;
      min-width: 0;
    }
  `],
})
export class ManualAmountComponent {
  readonly amount = input.required<number>();
  readonly description = input.required<string>();

  readonly amountChanged = output<string>();
  readonly descriptionChanged = output<string>();
}
