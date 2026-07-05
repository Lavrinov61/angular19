/**
 * LivePriceWidget, показывает текущую динамическую цену с учётом времени суток.
 * Обновляется каждые 60 секунд. Показывает таймер до смены цены.
 *
 * Использование:
 * <app-live-price-widget [categorySlug]="'photo-docs'" [basePrice]="590" />
 */

import {
  Component, ChangeDetectionStrategy, OnInit, OnDestroy,
  input, signal, computed, PLATFORM_ID, inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PricingApiService, type CurrentPriceResponse } from '../../../core/services/pricing-api.service';

@Component({
  selector: 'app-live-price-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (currentPrice()) {
      <div class="lpw-container" [class.lpw-discount]="hasDiscount()">
        <!-- Цена -->
        <div class="lpw-price-row">
          @if (hasDiscount()) {
            <span class="lpw-base-price">{{ basePrice() }}₽</span>
          }
          <span class="lpw-final-price">{{ currentPrice()!.current_price }}₽</span>
          @if (hasDiscount()) {
            <span class="lpw-badge">-{{ currentPrice()!.discount_percent }}%</span>
          }
        </div>

        <!-- Причины скидки -->
        @if (hasDiscount() && currentPrice()!.reasons.length > 0) {
          <div class="lpw-reason">{{ currentPrice()!.reasons[0] }}</div>
        }

        <!-- Таймер до смены цены -->
        @if (hasDiscount() && timerLabel()) {
          <div class="lpw-timer">
            <span class="lpw-timer-icon">⏳</span>
            Цена вырастет через {{ timerLabel() }}
          </div>
        }

        <!-- Кнопка фиксации цены -->
        @if (showLockButton() && hasDiscount()) {
          <button class="lpw-lock-btn" (click)="lockPrice()" [disabled]="locking()">
            @if (locking()) {
              Фиксируем...
            } @else if (locked()) {
              ✓ Цена зафиксирована на 24ч
            } @else {
              🔒 Зафиксировать цену
            }
          </button>
        }
      </div>
    } @else if (loading()) {
      <div class="lpw-loading">Загрузка цены...</div>
    }
  `,
  styles: [`
    .lpw-container {
      display: inline-flex;
      flex-direction: column;
      gap: 4px;
    }
    .lpw-price-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .lpw-base-price {
      font-size: 0.85em;
      text-decoration: line-through;
      color: #9ca3af;
    }
    .lpw-final-price {
      font-size: 1.25em;
      font-weight: 700;
      color: #1f2937;
    }
    .lpw-discount .lpw-final-price {
      color: #16a34a;
    }
    .lpw-badge {
      background: #dcfce7;
      color: #15803d;
      font-size: 0.75em;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 12px;
    }
    .lpw-reason {
      font-size: 0.8em;
      color: #6b7280;
    }
    .lpw-timer {
      font-size: 0.78em;
      color: #f59e0b;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .lpw-lock-btn {
      margin-top: 4px;
      padding: 6px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #fff;
      font-size: 0.82em;
      cursor: pointer;
      transition: all 0.2s;
    }
    .lpw-lock-btn:hover:not(:disabled) {
      background: #f3f4f6;
      border-color: #9ca3af;
    }
    .lpw-lock-btn:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .lpw-loading {
      font-size: 0.85em;
      color: #9ca3af;
    }
  `],
})
export class LivePriceWidgetComponent implements OnInit, OnDestroy {
  private readonly pricingApi = inject(PricingApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly categorySlug = input.required<string>();
  readonly basePrice = input.required<number>();
  readonly loyaltyLevel = input<number | undefined>(undefined);
  readonly visitorId = input<string | undefined>(undefined);
  /** Показывать кнопку фиксации цены */
  readonly showLockButton = input(true);

  readonly currentPrice = signal<CurrentPriceResponse | null>(null);
  readonly loading = signal(false);
  readonly locking = signal(false);
  readonly locked = signal(false);

  readonly hasDiscount = computed(() => {
    const p = this.currentPrice();
    return p ? p.discount_percent > 0 : false;
  });

  readonly timerLabel = computed(() => {
    const p = this.currentPrice();
    if (!p) return null;
    const mins = p.minutes_to_price_change;
    if (mins <= 0) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}ч ${m}мин`;
    return `${m}мин`;
  });

  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private minutesLeft = 0;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.load();
    // Polling каждые 60 секунд
    this.pollInterval = setInterval(() => this.load(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  private load(): void {
    this.loading.set(true);
    this.pricingApi.getCurrentPrice(this.categorySlug(), this.basePrice(), this.loyaltyLevel())
      .then(res => {
        this.currentPrice.set(res);
        this.loading.set(false);
      })
      .catch(() => this.loading.set(false));
  }

  lockPrice(): void {
    if (this.locking() || this.locked()) return;
    this.locking.set(true);

    this.pricingApi.lockPrice({
      visitorId: this.visitorId(),
      categorySlug: this.categorySlug(),
      currentPrice: this.currentPrice()?.current_price ?? this.basePrice(),
    }).then(() => {
      this.locked.set(true);
      this.locking.set(false);
    }).catch(() => this.locking.set(false));
  }
}
