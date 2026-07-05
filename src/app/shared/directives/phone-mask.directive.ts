import { Directive, ElementRef, inject } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Директива автоформатирования телефона: +7 (___) ___-__-__
 * Использование: <input matInput appPhoneMask formControlName="phone">
 */
@Directive({
  selector: '[appPhoneMask]',
  host: {
    '(input)': 'onInput()',
    '(focus)': 'onFocus()',
    '(blur)': 'onBlur()',
  },
})
export class PhoneMaskDirective {
  private el = inject(ElementRef<HTMLInputElement>);
  private control = inject(NgControl, { optional: true });

  onInput(): void {
    const input = this.el.nativeElement;
    const raw = input.value.replace(/\D/g, '');

    // Нормализуем: 8xxx → 7xxx
    let digits = raw;
    if (digits.startsWith('8') && digits.length > 1) {
      digits = '7' + digits.slice(1);
    }
    if (!digits.startsWith('7') && digits.length > 0) {
      digits = '7' + digits;
    }

    const formatted = this.format(digits);
    input.value = formatted;
    this.control?.control?.setValue(formatted, { emitEvent: false });
  }

  onFocus(): void {
    const input = this.el.nativeElement;
    if (!input.value) {
      input.value = '+7 (';
      this.control?.control?.setValue('+7 (', { emitEvent: false });
    }
  }

  onBlur(): void {
    const input = this.el.nativeElement;
    if (input.value === '+7 (' || input.value === '+7') {
      input.value = '';
      this.control?.control?.setValue('', { emitEvent: false });
    }
  }

  private format(digits: string): string {
    if (digits.length === 0) return '';
    if (digits.length <= 1) return '+7';
    if (digits.length <= 4) return `+7 (${digits.slice(1)}`;
    if (digits.length <= 7) return `+7 (${digits.slice(1, 4)}) ${digits.slice(4)}`;
    if (digits.length <= 9) return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
}
