import { Component, input, inject, ChangeDetectionStrategy } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { LoggerService } from '../../../core/services/logger.service';

export interface PriceItem {
  title: string;
  price: string;
  originalPrice?: string;
  discount?: number;
  features?: string[];
  popular?: boolean;
  note?: string;
}

@Component({
  selector: 'app-service-pricing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule
],
  template: `
    <section class="pricing-section">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">{{ title() }}</h2>
          @if (subtitle()) {
            <p class="section-subtitle">{{ subtitle() }}</p>
          }
        </div>

        <div class="pricing-grid">
          @for (item of prices(); track item.title || $index) {
            <mat-card 
              class="price-card"
              [class.popular]="item.popular"
            >
              <mat-card-content>
                <div class="price-header">
                  @if (item.popular || item.discount) {
                    <mat-chip-set>
                      @if (item.popular) {
                        <mat-chip color="primary">Популярно</mat-chip>
                      }
                      @if (item.discount) {
                        <mat-chip color="accent">-{{ item.discount }}%</mat-chip>
                      }
                    </mat-chip-set>
                  }
                  <h3 class="price-title">{{ item.title }}</h3>
                  <div class="price-amount">
                    <span class="current-price">{{ item.price }}</span>
                    @if (item.originalPrice) {
                      <span class="original-price">{{ item.originalPrice }}</span>
                    }
                  </div>
                  @if (item.note) {
                    <p class="price-note">{{ item.note }}</p>
                  }
                </div>

                @if (item.features) {
                  <div class="price-features">
                    @for (feature of item.features; track feature || $index) {
                      <div class="feature-item">
                        <mat-icon>check</mat-icon>
                        <span>{{ feature }}</span>
                      </div>
                    }
                  </div>
                }

                <div class="price-cta">
                  <button 
                    mat-raised-button 
                    [color]="item.popular ? 'primary' : 'accent'"
                    class="order-button"
                    (click)="onOrderClick(item)"
                  >
                    <mat-icon>shopping_cart</mat-icon>
                    Заказать
                  </button>
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>

        @if (showFooter()) {
          <div class="pricing-footer">
            <p class="footer-text">
              <mat-icon>info</mat-icon>
              Все цены указаны с учетом НДС. Возможна оплата картой или наличными.
            </p>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .pricing-section {
      padding: 3rem 0;
      background: var(--ed-surface, #0a0a0a);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1rem;
    }

    .section-header {
      text-align: center;
      margin-bottom: 3rem;
    }

    .section-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: clamp(1.75rem, 4vw, 2.5rem);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 1rem;
    }

    .section-subtitle {
      font-size: 1.05rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      max-width: 600px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .pricing-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .price-card {
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 8px;
      transition: transform 300ms, box-shadow 300ms;
      height: 100%;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: visible;
    }

    .price-card.popular {
      border-top: 3px solid var(--ed-accent, #f59e0b);
      box-shadow: var(--ed-shadow-accent, 0 4px 24px rgba(245, 158, 11, 0.15));
    }

    .price-card:hover {
      transform: translateY(-4px);
      box-shadow: var(--ed-shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
    }

    .price-header {
      text-align: center;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    mat-chip-set {
      margin-bottom: 1rem;
      justify-content: center;
    }

    :host ::ng-deep .mat-mdc-chip {
      background: var(--ed-accent, #f59e0b) !important;
      color: var(--ed-on-accent, #0a0a0a) !important;
      font-weight: 600;
      border-radius: 4px;
    }

    .price-title {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 1.35rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 1rem;
    }

    .price-amount {
      margin-bottom: 0.5rem;
    }

    .current-price {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 2.5rem;
      font-weight: 800;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .original-price {
      font-size: 1.1rem;
      color: var(--ed-on-surface-muted, #666);
      text-decoration: line-through;
      margin-left: 0.5rem;
    }

    .price-note {
      font-size: 0.85rem;
      color: var(--ed-on-surface-muted, #666);
    }

    .price-features {
      flex: 1;
      padding: 1.5rem 0;
    }

    .feature-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.85rem;
    }

    .feature-item mat-icon {
      color: var(--ed-accent, #f59e0b);
      font-size: 1.1rem;
      width: 1.1rem;
      height: 1.1rem;
    }

    .feature-item span {
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.4;
      font-size: 0.95rem;
    }

    .price-cta {
      text-align: center;
      padding-top: 1.5rem;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .order-button {
      width: 100%;
      height: 48px;
      border-radius: 24px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .pricing-footer {
      text-align: center;
      margin-top: 2rem;
    }

    .footer-text {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--ed-on-surface-muted, #666);
      font-size: 0.9rem;
    }

    @media (min-width: 840px) {
      .pricing-grid {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }

      .pricing-section {
        padding: 5rem 0;
      }
    }
  `]
})
export class ServicePricingComponent {
  private log = inject(LoggerService);

  title = input<string>('Цены на услуги');
  subtitle = input<string | undefined>(undefined);
  prices = input<PriceItem[]>([]);
  showFooter = input<boolean>(true);

  onOrderClick(item: PriceItem): void {
    // Эмитим событие или вызываем сервис для заказа
    this.log.debug('Order clicked for:', item);
  }
}

