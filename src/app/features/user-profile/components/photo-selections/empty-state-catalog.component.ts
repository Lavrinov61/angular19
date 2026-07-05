import {
  Component, OnInit, inject, output, ChangeDetectionStrategy, PLATFORM_ID
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { PricingApiService, PricingCategory } from '../../../../core/services/pricing-api.service';

@Component({
  selector: 'app-empty-state-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinnerModule, MatIconModule],
  template: `
    <div class="darkroom-stage">

      <!-- Film grain overlay -->
      <div class="grain" aria-hidden="true"></div>

      <!-- Hero Section -->
      <div class="hero">
        <div class="hero-icon" aria-hidden="true">
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
            <rect x="8" y="20" width="56" height="36" rx="5" stroke="#f59e0b" stroke-width="2"/>
            <circle cx="36" cy="38" r="10" stroke="#f59e0b" stroke-width="2"/>
            <circle cx="36" cy="38" r="4" fill="#f59e0b" fill-opacity="0.3"/>
            <rect x="4" y="26" width="6" height="8" rx="2" fill="#f59e0b" fill-opacity="0.4"/>
            <rect x="62" y="26" width="6" height="8" rx="2" fill="#f59e0b" fill-opacity="0.4"/>
            <rect x="20" y="14" width="12" height="8" rx="2" stroke="#f59e0b" stroke-width="1.5"/>
            <circle cx="54" cy="26" r="3" fill="#f59e0b"/>
          </svg>
        </div>
        <h1 class="hero-title">Мастерская обработки фотографий</h1>
        <p class="hero-desc">
          Здесь вы будете согласовывать результаты работы наших специалистов.
          Закажите услугу, и когда фото будет готово, оно появится прямо здесь для просмотра и одобрения.
        </p>
        <div class="hero-badge">
          <span class="badge-dot"></span>
          Первыми в городе, согласование прямо в личном кабинете
        </div>
      </div>

      <!-- How it works -->
      <div class="how-section">
        <h2 class="section-title">Как это работает</h2>
        <div class="steps-row">
          <div class="step">
            <div class="step-num">01</div>
            <div class="step-icon"><mat-icon>cloud_upload</mat-icon></div>
            <div class="step-text">Заказываете услугу и загружаете фотографию</div>
          </div>
          <div class="step-line" aria-hidden="true"></div>
          <div class="step">
            <div class="step-num">02</div>
            <div class="step-icon"><mat-icon>brush</mat-icon></div>
            <div class="step-text">Наш специалист профессионально обрабатывает фото</div>
          </div>
          <div class="step-line" aria-hidden="true"></div>
          <div class="step">
            <div class="step-num">03</div>
            <div class="step-icon"><mat-icon>check_circle</mat-icon></div>
            <div class="step-text">Вы одобряете результат или запрашиваете правки</div>
          </div>
        </div>
      </div>

      <!-- Services Catalog -->
      <div class="catalog-section">
        <div class="catalog-header">
          <h2 class="section-title">Доступные услуги</h2>
          <p class="catalog-sub">Выберите услугу, чтобы начать</p>
        </div>

        @if (pricing.loading()) {
          <div class="services-loading">
            <mat-spinner diameter="32" />
            <span>Загрузка услуг...</span>
          </div>
        } @else if (pricing.onlineCategories().length === 0) {
          <div class="services-empty">
            <p>Онлайн-услуги временно недоступны. Свяжитесь с нами напрямую.</p>
          </div>
        } @else {
          <div class="services-grid">
            @for (cat of pricing.onlineCategories(); track cat.id) {
              <div class="service-card" (click)="onOrder(cat)" (keydown.enter)="onOrder(cat)" tabindex="0" role="button" [attr.aria-label]="'Заказать: ' + cat.name">
                <div class="sc-glow" aria-hidden="true" [style.background]="cat.gradient || 'radial-gradient(ellipse at top left, #451a0330, transparent)'"></div>
                <div class="sc-accent-line"></div>
                <div class="sc-body">
                  <div class="sc-icon-wrap">
                    <mat-icon>{{ cat.icon || 'photo' }}</mat-icon>
                  </div>
                  <h3 class="sc-name">{{ cat.name }}</h3>
                  @if (cat.description) {
                    <p class="sc-desc">{{ cat.description }}</p>
                  }
                  @if (cat.price_range) {
                    <div class="sc-price">{{ cat.price_range }}</div>
                  }
                </div>
                <button class="sc-cta" (click)="$event.stopPropagation(); onOrder(cat)">
                  Заказать <span class="sc-cta-arrow">→</span>
                </button>
              </div>
            }
          </div>
        }
      </div>

      <!-- Bottom trust block -->
      <div class="trust-row">
        <div class="trust-item">
          <span class="trust-icon"><mat-icon>verified_user</mat-icon></span>
          <span>Ручная обработка, не AI-автоматика</span>
        </div>
        <div class="trust-item">
          <span class="trust-icon"><mat-icon>bolt</mat-icon></span>
          <span>Срочное выполнение, от 1 часа</span>
        </div>
        <div class="trust-item">
          <span class="trust-icon"><mat-icon>sync</mat-icon></span>
          <span>Правки до полного согласования</span>
        </div>
      </div>

    </div>
  `,
  styles: `
    :host { display: block; }

    .darkroom-stage {
      position: relative;
      padding: 32px 24px 48px;
      max-width: 860px;
      margin: 0 auto;
      overflow: hidden;
    }

    /* Subtle film grain overlay */
    .grain {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      opacity: 0.025;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
      background-repeat: repeat;
    }

    /* ── Hero ── */
    .hero {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 40px 0 48px;
      animation: fade-up 0.6s var(--ed-ease-out, cubic-bezier(0.16,1,0.3,1)) both;
    }

    .hero-icon {
      display: flex;
      justify-content: center;
      margin-bottom: 24px;
      filter: drop-shadow(0 0 24px rgba(245,158,11,0.4));
      animation: amber-pulse 3s ease-in-out infinite;
    }

    @keyframes amber-pulse {
      0%, 100% { filter: drop-shadow(0 0 16px rgba(245,158,11,0.3)); }
      50%       { filter: drop-shadow(0 0 32px rgba(245,158,11,0.6)); }
    }

    .hero-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: clamp(1.6rem, 4vw, 2.4rem);
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0 0 16px;
      line-height: 1.2;
    }

    .hero-desc {
      font-size: 0.95rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      max-width: 520px;
      margin: 0 auto 24px;
      line-height: 1.65;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #f59e0b;
      background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.25);
      border-radius: 999px;
      padding: 6px 16px;
      letter-spacing: 0.03em;
    }

    .badge-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #f59e0b;
      box-shadow: 0 0 6px #f59e0b;
      flex-shrink: 0;
      animation: blink 2s ease-in-out infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }

    /* ── Section titles ── */
    .section-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.1rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 24px;
    }

    /* ── How it works ── */
    .how-section {
      position: relative;
      z-index: 1;
      margin-bottom: 48px;
      animation: fade-up 0.6s 0.1s var(--ed-ease-out, cubic-bezier(0.16,1,0.3,1)) both;
    }

    .steps-row {
      display: flex;
      align-items: flex-start;
      gap: 0;
    }

    .step {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 10px;
      padding: 20px 16px;
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 12px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      transition: border-color 0.2s;
    }

    .step:hover {
      border-color: rgba(245,158,11,0.3);
    }

    .step-line {
      width: 24px;
      height: 1px;
      background: linear-gradient(90deg, rgba(245,158,11,0.4) 0%, rgba(245,158,11,0.1) 100%);
      flex-shrink: 0;
      align-self: center;
      margin-top: -24px;
    }

    .step-num {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #f59e0b;
      opacity: 0.8;
    }

    .step-icon { display: flex; justify-content: center; }
    .step-icon mat-icon { font-size: 28px; width: 28px; height: 28px; color: #f59e0b; }

    .step-text {
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.5;
    }

    /* ── Catalog ── */
    .catalog-section {
      position: relative;
      z-index: 1;
      margin-bottom: 40px;
      animation: fade-up 0.6s 0.18s var(--ed-ease-out, cubic-bezier(0.16,1,0.3,1)) both;
    }

    .catalog-header {
      margin-bottom: 20px;
    }

    .catalog-sub {
      font-size: 0.85rem;
      color: var(--ed-on-surface-muted, #666);
      margin: -16px 0 0;
    }

    .services-loading {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.9rem;
      padding: 32px 0;
    }

    .services-empty {
      color: var(--ed-on-surface-muted, #666);
      font-size: 0.9rem;
      padding: 24px 0;
    }

    .services-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }

    /* ── Service Card ── */
    .service-card {
      position: relative;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 14px;
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.25s, transform 0.2s, box-shadow 0.25s;
      display: flex;
      flex-direction: column;
    }

    .service-card:hover {
      border-color: rgba(245,158,11,0.45);
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(245,158,11,0.1);
    }

    .sc-glow {
      position: absolute;
      inset: 0;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }

    .service-card:hover .sc-glow {
      opacity: 0.4;
    }

    .sc-accent-line {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: linear-gradient(180deg, #f59e0b 0%, rgba(245,158,11,0.3) 100%);
      opacity: 0.6;
      transition: opacity 0.25s;
    }

    .service-card:hover .sc-accent-line {
      opacity: 1;
    }

    .sc-body {
      position: relative;
      z-index: 1;
      padding: 20px 20px 12px 24px;
      flex: 1;
    }

    .sc-icon-wrap {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: rgba(245,158,11,0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
      transition: background 0.25s, box-shadow 0.25s;
    }

    .sc-icon-wrap mat-icon {
      color: #f59e0b;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .service-card:hover .sc-icon-wrap {
      background: #f59e0b;
      box-shadow: 0 4px 16px rgba(245,158,11,0.35);
    }

    .service-card:hover .sc-icon-wrap mat-icon {
      color: #0a0a0a;
    }


    .sc-name {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.05rem;
      font-weight: 500;
      letter-spacing: 0.03em;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0 0 8px;
      text-transform: uppercase;
    }

    .sc-desc {
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 10px;
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .sc-price {
      font-size: 0.78rem;
      font-weight: 700;
      color: #f59e0b;
      letter-spacing: 0.03em;
    }

    .sc-cta {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 12px 24px;
      background: rgba(245,158,11,0.07);
      border: none;
      border-top: 1px solid rgba(245,158,11,0.12);
      color: #f59e0b;
      font-size: 0.83rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s;
    }

    .sc-cta:hover {
      background: rgba(245,158,11,0.14);
    }

    .sc-cta-arrow {
      transition: transform 0.2s;
    }

    .service-card:hover .sc-cta-arrow {
      transform: translateX(3px);
    }

    /* ── Trust row ── */
    .trust-row {
      position: relative;
      z-index: 1;
      display: flex;
      gap: 24px;
      padding: 20px 24px;
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 12px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      animation: fade-up 0.6s 0.25s var(--ed-ease-out, cubic-bezier(0.16,1,0.3,1)) both;
    }

    .trust-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      flex: 1;
    }

    .trust-icon { display: flex; align-items: center; flex-shrink: 0; }
    .trust-icon mat-icon { font-size: 18px; width: 18px; height: 18px; color: #f59e0b; }

    /* ── Animation ── */
    @keyframes fade-up {
      from { opacity: 0; transform: translateY(20px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Responsive ── */
    @media (max-width: 700px) {
      .darkroom-stage { padding: 20px 16px 36px; }
      .hero { padding: 24px 0 32px; }
      .hero-title { font-size: 1.4rem; }
      .steps-row { flex-direction: column; gap: 8px; }
      .step-line { display: none; }
      .services-grid { grid-template-columns: 1fr; }
      .trust-row { flex-direction: column; gap: 12px; }
    }
  `
})
export class EmptyStateCatalogComponent implements OnInit {
  protected readonly pricing = inject(PricingApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly serviceSelected = output<PricingCategory>();

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      void this.pricing.loadCategories();
    }
  }

  onOrder(cat: PricingCategory) {
    this.serviceSelected.emit(cat);
  }

}

