import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';

/**
 * Переиспользуемый ввод кода ячейками (вынесен из pin-auth.component.ts).
 *
 * Скрытый numeric-input поверх .cells @for(0..length-1). Цифры вводятся в input,
 * визуально раскладываются по ячейкам. Используется дважды на экране активации
 * подарка, voice-код и email-код.
 *
 * value, двусторонний model-signal (строка цифр). (completed) эмитится когда
 * длина достигла `length`. Состояния error (красная рамка) / blocked (поле выключено).
 */
@Component({
  selector: 'app-code-cells-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="cc-field" [class.is-error]="error()" [class.is-blocked]="blocked()">
      <span class="cc-entry">
        <input
          #cellInput
          class="cc-native-input"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          autocomplete="one-time-code"
          [attr.maxlength]="length()"
          [attr.aria-label]="ariaLabel()"
          [disabled]="disabled() || blocked()"
          [value]="value()"
          (input)="onInput($event)"
          (keydown.enter)="enter.emit()"
        />
        <span class="cc-cells" aria-hidden="true">
          @for (digit of cells(); track $index) {
            <span class="cc-cell" [class.is-filled]="digit.length > 0">
              @if (digit) {
                <span class="cc-char">{{ digit }}</span>
              }
            </span>
          }
        </span>
      </span>
    </label>
  `,
  styles: [`
    :host {
      display: block;
      --cc-red: #ef3124;
      --cc-field: #e6e7eb;
      --cc-text: #2b2d33;
    }

    .cc-field {
      display: block;
    }

    .cc-entry {
      position: relative;
      display: block;
      min-height: 64px;
    }

    .cc-native-input {
      position: absolute;
      inset: 0;
      z-index: 2;
      width: 100%;
      height: 100%;
      border: 0;
      padding: 0;
      color: transparent;
      caret-color: transparent;
      background: transparent;
      opacity: 0.01;
      outline: none;
      cursor: text;
    }

    .cc-cells {
      display: grid;
      grid-template-columns: repeat(var(--cc-count, 4), minmax(0, 1fr));
      gap: 10px;
    }

    .cc-cell {
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 1;
      min-height: 60px;
      box-sizing: border-box;
      border: 0;
      border-radius: 12px;
      color: var(--cc-text);
      background: var(--cc-field);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 26px;
      font-weight: 700;
      transition: box-shadow 0.16s ease, background 0.16s ease;
    }

    .cc-entry:focus-within .cc-cell {
      box-shadow: 0 0 0 3px rgba(239, 49, 36, 0.12);
    }

    .cc-cell.is-filled {
      background: #dedfe4;
    }

    .cc-char {
      line-height: 1;
    }

    .cc-field.is-error .cc-cell {
      box-shadow: inset 0 0 0 1.5px var(--cc-red);
      background: #fff1f0;
      color: var(--cc-red);
    }

    .cc-field.is-blocked {
      opacity: 0.6;
    }

    .cc-field.is-blocked .cc-native-input {
      cursor: not-allowed;
    }

    @media (max-width: 480px) {
      .cc-cells {
        gap: 8px;
      }

      .cc-cell {
        min-height: 56px;
        font-size: 23px;
      }
    }
  `],
})
export class CodeCellsInputComponent {
  private readonly cellInputRef = viewChild<ElementRef<HTMLInputElement>>('cellInput');

  /** Количество ячеек (длина кода). */
  readonly length = input(4);
  /** Введённое значение, двусторонний model. */
  readonly value = model('');
  /** Поле временно недоступно (loading и т.п.). */
  readonly disabled = input(false);
  /** Красная рамка ячеек при неверном коде. */
  readonly error = input(false);
  /** Блокировка ввода (423 ACTIVATION_CODE_LOCKED). */
  readonly blocked = input(false);
  /** Подпись для скринридеров. */
  readonly ariaLabel = input('Код');

  /** Эмитится при достижении полной длины кода. */
  readonly completed = output<string>();
  /** Эмитится на Enter в поле. */
  readonly enter = output<void>();

  readonly cells = computed(() => {
    const len = this.length();
    const v = this.value();
    return Array.from({ length: len }, (_, i) => v[i] ?? '');
  });

  constructor() {
    // Прокидываем количество ячеек в CSS grid-template-columns.
    effect(() => {
      const host = this.cellInputRef()?.nativeElement?.closest('.cc-field') as HTMLElement | undefined;
      if (host) host.style.setProperty('--cc-count', String(this.length()));
    });
  }

  onInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    const digits = input.value.replace(/\D/g, '').slice(0, this.length());
    input.value = digits;
    this.value.set(digits);
    if (digits.length === this.length()) {
      this.completed.emit(digits);
    }
  }

  /** Программный фокус (вызывается родителем при переходе на verify). */
  focus(): void {
    this.cellInputRef()?.nativeElement?.focus();
  }
}
