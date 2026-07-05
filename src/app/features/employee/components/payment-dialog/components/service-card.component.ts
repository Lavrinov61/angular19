import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import type { UiServiceOption } from '../models/payment-dialog.models';

@Component({
  selector: 'app-service-card',
  imports: [DecimalPipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'tabindex': '0',
    '[class.selected]': 'selected()',
    '(click)': 'toggled.emit()',
    '(keydown.enter)': 'toggled.emit()',
    '(keydown.space)': '$event.preventDefault(); toggled.emit()',
  },
  template: `
    <div class="sc-top">
      <mat-icon class="sc-icon">{{ service().icon }}</mat-icon>
      @if (service().popular) {
        <span class="sc-hit">HIT</span>
      }
    </div>
    <div class="sc-name">{{ service().name }}</div>
    @if (showCategory()) {
      <div class="sc-cat">{{ categoryName() }}</div>
    }
    <div class="sc-price">
      {{ service().price | number:'1.0-0' }}&#8239;&#8381;
      @if (service().priceMax) {
        <span class="sc-price-max">&ndash;{{ service().priceMax | number:'1.0-0' }}&#8239;&#8381;</span>
      }
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 68px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 10px;
      cursor: pointer;
      position: relative;
      transition: all 150ms ease;
      outline: none;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      box-sizing: border-box;

      &:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.12);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      &:focus-visible {
        outline: 2px solid rgba(245, 158, 11, 0.6);
        outline-offset: 2px;
      }

      &.selected {
        background: rgba(245, 158, 11, 0.08);
        border-color: rgba(245, 158, 11, 0.4);

        &::after {
          content: '\\2713';
          position: absolute;
          top: 6px;
          right: 6px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #f59e0b;
          color: #0a0a0a;
          font-size: 11px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
      }
    }

    .sc-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .sc-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #f59e0b;
      opacity: 0.8;
    }

    .sc-hit {
      font-size: 9px;
      font-weight: 700;
      color: #f59e0b;
      letter-spacing: 0.04em;
      line-height: 1;
    }

    .sc-name {
      font-size: 12px;
      font-weight: 600;
      color: #ececec;
      line-height: 1.3;
      margin-bottom: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .sc-cat {
      font-size: 10px;
      color: #7a7a7a;
      margin-bottom: 2px;
      line-height: 1.2;
    }

    .sc-price {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 12px;
      font-weight: 600;
      color: #fbbf24;
      line-height: 1;
      margin-top: auto;
    }

    .sc-price-max {
      font-size: 10px;
      color: #a0a0a0;
      font-weight: 400;
    }

  `],
})
export class ServiceCardComponent {
  readonly service = input.required<UiServiceOption>();
  readonly selected = input(false);
  readonly showCategory = input(false);
  readonly categoryName = input('');

  readonly toggled = output<void>();
}
