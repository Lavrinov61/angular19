import { Pipe, type PipeTransform } from '@angular/core';

/**
 * Formats a number as a price string with thin space grouping and rouble sign.
 * Example: 1500 → "1 500 ₽", 0 → "0 ₽"
 */
@Pipe({ name: 'priceFormat' })
export class PriceFormatPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null) return '0\u202F₽';
    const rounded = Math.round(value);
    const formatted = rounded.toLocaleString('ru-RU', {
      maximumFractionDigits: 0,
      useGrouping: true,
    });
    // Replace non-breaking space with thin space for consistent display
    return formatted.replace(/\s/g, '\u202F') + '\u202F₽';
  }
}
