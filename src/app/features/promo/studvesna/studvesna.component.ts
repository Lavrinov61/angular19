import { Component, ChangeDetectionStrategy, computed, inject, signal, DestroyRef, afterNextRender, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

interface PlanCard {
  id: string;
  slug: string;
  title: string;
  description: string;
  volume: string;
  price: string;
}

type TimerState = 'before' | 'active' | 'expired';

interface CountdownTime {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

// Даты мероприятия (UTC+3 Moscow)
const EVENT_START = new Date('2026-04-15T00:00:00+03:00');
const GENERAL_END = new Date('2026-04-17T00:00:00+03:00');
const PERSONAL_END = new Date('2026-05-15T23:59:59+03:00');

@Component({
  selector: 'app-studvesna',
  imports: [RouterLink, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'class': 'studvesna-page'
  },
  template: `
    <!-- HERO -->
    <section class="hero">
      <div class="hero-inner">
        <div class="hero-logos">
          <img src="/assets/images/svoefoto-logo-white.png" alt="Своё Фото" class="hero-sf-logo">
          <span class="hero-x">&times;</span>
          <img src="/assets/images/dsm-logo.jpg" alt="ДСМ" class="hero-dsm-logo">
        </div>
        <h1 class="hero-title">1 МЕСЯЦ БЕСПЛАТНОЙ ПЕЧАТИ</h1>
        <p class="hero-subtitle">документов или фотографий на выбор</p>
        <div class="promo-badge">
          <span class="promo-label">Промокод</span>
          @if (showPromoInput()) {
            <input class="promo-input"
                   type="text"
                   placeholder="STUDVESNA26"
                   [value]="manualCode()"
                   (input)="onPromoInput($event)" />
          } @else {
            <span class="promo-code">{{ promoCode() }}</span>
          }
        </div>
      </div>
    </section>

    <!-- TIMER -->
    <section class="timer-section">
      <div class="timer-inner">
        @if (timerState() === 'before') {
          <p class="timer-label">Мероприятие начнётся через</p>
          <div class="countdown">
            <div class="countdown-unit">
              <span class="countdown-value">{{ countdown().days }}</span>
              <span class="countdown-caption">дней</span>
            </div>
            <div class="countdown-separator">:</div>
            <div class="countdown-unit">
              <span class="countdown-value">{{ countdown().hours | number:'2.0-0' }}</span>
              <span class="countdown-caption">часов</span>
            </div>
            <div class="countdown-separator">:</div>
            <div class="countdown-unit">
              <span class="countdown-value">{{ countdown().minutes | number:'2.0-0' }}</span>
              <span class="countdown-caption">минут</span>
            </div>
            <div class="countdown-separator">:</div>
            <div class="countdown-unit">
              <span class="countdown-value">{{ countdown().seconds | number:'2.0-0' }}</span>
              <span class="countdown-caption">секунд</span>
            </div>
          </div>
        } @else if (timerState() === 'active') {
          <p class="timer-label timer-active">
            @if (isPersonalCode()) {
              Персональный код, осталось для активации
            } @else {
              Осталось для активации
            }
          </p>
          <div class="countdown active">
            @if (isPersonalCode()) {
              <div class="countdown-unit">
                <span class="countdown-value">{{ countdown().days }}</span>
                <span class="countdown-caption">дней</span>
              </div>
              <div class="countdown-separator">:</div>
            }
            <div class="countdown-unit">
              <span class="countdown-value">{{ countdown().hours | number:'2.0-0' }}</span>
              <span class="countdown-caption">часов</span>
            </div>
            <div class="countdown-separator">:</div>
            <div class="countdown-unit">
              <span class="countdown-value">{{ countdown().minutes | number:'2.0-0' }}</span>
              <span class="countdown-caption">минут</span>
            </div>
            <div class="countdown-separator">:</div>
            <div class="countdown-unit">
              <span class="countdown-value">{{ countdown().seconds | number:'2.0-0' }}</span>
              <span class="countdown-caption">секунд</span>
            </div>
          </div>
        } @else {
          <p class="timer-label timer-expired">Срок активации истёк</p>
        }
      </div>
    </section>

    <!-- PLANS -->
    <section class="plans">
      <div class="plans-inner">
        <h2 class="section-title">Выберите подписку</h2>
        <div class="plans-grid">
          @for (plan of plans; track plan.id) {
            <div class="plan-card" [class.disabled]="!isActive()">
              <div class="plan-icon">{{ plan.id === 'docs' ? '📄' : '📸' }}</div>
              <h3 class="plan-name">{{ plan.title }}</h3>
              <p class="plan-volume">{{ plan.volume }}</p>
              <p class="plan-description">{{ plan.description }}</p>
              <p class="plan-price">{{ plan.price }}</p>
              @if (isActive()) {
                <a class="plan-btn"
                   [routerLink]="['/subscriptions']"
                   [queryParams]="{ promo: promoCode(), plan: plan.slug }">
                  Активировать бесплатно
                </a>
              } @else {
                <span class="plan-btn plan-btn-disabled">Активировать бесплатно</span>
              }
            </div>
          }
        </div>
      </div>
    </section>

    <!-- HOW IT WORKS -->
    <section class="how">
      <div class="how-inner">
        <h2 class="section-title">Как это работает</h2>
        <div class="steps">
          @for (step of steps; track step.num) {
            <div class="step">
              <span class="step-num">{{ step.num }}</span>
              <p class="step-text">{{ step.text }}</p>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="page-footer">
      <div class="footer-inner">
        <div class="footer-addresses">
          <p>Соборный пер., 21</p>
        </div>
        <div class="footer-contacts">
          <p>+7 (863) 322-65-75</p>
          <p>Пн, Вс, 09:00-19:30</p>
        </div>
        <div class="footer-brand">
          <a routerLink="/">svoefoto.ru</a>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    :host {
      display: block;
      background: #0f0f0f;
      color: #fff;
      min-height: 100vh;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }

    /* ---- HERO ---- */
    .hero {
      background: linear-gradient(135deg, #1a1a1a 0%, #0f0f0f 100%);
      padding: 80px 24px 64px;
      text-align: center;
      border-bottom: 1px solid #262626;
    }

    .hero-inner {
      max-width: 720px;
      margin: 0 auto;
    }

    .hero-logos {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin: 0 0 24px;
    }
    .hero-sf-logo {
      height: 48px;
    }
    .hero-x {
      font-family: 'Oswald', sans-serif;
      font-size: 18px;
      color: #f59e0b;
    }
    .hero-dsm-logo {
      height: 48px;
      border-radius: 6px;
    }

    .hero-title {
      font-family: 'Oswald', sans-serif;
      font-size: clamp(32px, 7vw, 56px);
      font-weight: 700;
      line-height: 1.1;
      margin: 0 0 16px;
      color: #fff;
    }

    .hero-subtitle {
      font-size: clamp(16px, 3vw, 20px);
      color: #a3a3a3;
      margin: 0 0 40px;
    }

    .promo-badge {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      background: #1a1a1a;
      border: 2px dashed #f59e0b;
      border-radius: 12px;
      padding: 16px 32px;
    }

    .promo-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #a3a3a3;
    }

    .promo-code {
      font-family: 'Oswald', sans-serif;
      font-size: 28px;
      font-weight: 700;
      color: #f59e0b;
      letter-spacing: 2px;
    }

    .promo-input {
      font-family: 'Oswald', sans-serif;
      font-size: 24px;
      font-weight: 700;
      color: #f59e0b;
      letter-spacing: 2px;
      text-align: center;
      text-transform: uppercase;
      background: transparent;
      border: none;
      border-bottom: 2px solid #f59e0b;
      outline: none;
      padding: 4px 8px;
      width: 240px;
    }

    .promo-input::placeholder {
      color: #52525b;
      font-weight: 400;
    }

    /* ---- TIMER ---- */
    .timer-section {
      padding: 48px 24px;
      text-align: center;
      border-bottom: 1px solid #262626;
    }

    .timer-inner {
      max-width: 720px;
      margin: 0 auto;
    }

    .timer-label {
      font-size: 16px;
      color: #a3a3a3;
      margin: 0 0 24px;
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    .timer-active {
      color: #22c55e;
    }

    .timer-expired {
      color: #ef4444;
      font-size: 20px;
      font-weight: 600;
    }

    .countdown {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .countdown.active .countdown-value {
      color: #22c55e;
      border-color: #166534;
    }

    .countdown-unit {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .countdown-value {
      font-family: 'Oswald', sans-serif;
      font-size: clamp(36px, 8vw, 56px);
      font-weight: 700;
      color: #f59e0b;
      background: #1a1a1a;
      border: 1px solid #262626;
      border-radius: 12px;
      padding: 12px 16px;
      min-width: 72px;
      line-height: 1;
    }

    .countdown-caption {
      font-size: 12px;
      color: #737373;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .countdown-separator {
      font-family: 'Oswald', sans-serif;
      font-size: clamp(28px, 6vw, 40px);
      font-weight: 700;
      color: #525252;
      padding-bottom: 28px;
    }

    @media (max-width: 480px) {
      .countdown {
        gap: 4px;
      }

      .countdown-value {
        min-width: 56px;
        padding: 8px 6px;
        font-size: 32px;
      }

      .countdown-separator {
        font-size: 24px;
      }
    }

    /* ---- PLANS ---- */
    .plans {
      padding: 64px 24px;
    }

    .plans-inner {
      max-width: 720px;
      margin: 0 auto;
    }

    .section-title {
      font-family: 'Oswald', sans-serif;
      font-size: 28px;
      font-weight: 600;
      text-align: center;
      margin: 0 0 40px;
    }

    .plans-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }

    @media (min-width: 600px) {
      .plans-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    .plan-card {
      background: #1a1a1a;
      border: 1px solid #262626;
      border-radius: 16px;
      padding: 32px 24px;
      text-align: center;
      transition: border-color 0.2s, opacity 0.2s;
    }

    .plan-card:hover {
      border-color: #f59e0b;
    }

    .plan-card.disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    .plan-icon {
      font-size: 40px;
      margin-bottom: 16px;
    }

    .plan-name {
      font-family: 'Oswald', sans-serif;
      font-size: 22px;
      font-weight: 600;
      margin: 0 0 8px;
    }

    .plan-volume {
      font-size: 16px;
      color: #f59e0b;
      font-weight: 600;
      margin: 0 0 12px;
    }

    .plan-description {
      font-size: 14px;
      color: #a3a3a3;
      margin: 0 0 24px;
      line-height: 1.5;
    }

    .plan-price {
      font-size: 14px;
      color: #737373;
      margin: 0 0 24px;
    }

    .plan-btn {
      display: inline-block;
      background: #f59e0b;
      color: #0f0f0f;
      font-weight: 700;
      font-size: 15px;
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      transition: background 0.2s;
    }

    .plan-btn:hover {
      background: #d97706;
    }

    .plan-btn-disabled {
      background: #525252;
      cursor: not-allowed;
    }

    /* ---- HOW IT WORKS ---- */
    .how {
      padding: 64px 24px;
      border-top: 1px solid #262626;
    }

    .how-inner {
      max-width: 720px;
      margin: 0 auto;
    }

    .steps {
      display: grid;
      grid-template-columns: 1fr;
      gap: 32px;
    }

    @media (min-width: 600px) {
      .steps {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    .step {
      text-align: center;
    }

    .step-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #f59e0b;
      color: #0f0f0f;
      font-family: 'Oswald', sans-serif;
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 16px;
    }

    .step-text {
      font-size: 16px;
      color: #d4d4d4;
      line-height: 1.5;
      margin: 0;
    }

    /* ---- FOOTER ---- */
    .page-footer {
      padding: 40px 24px;
      border-top: 1px solid #262626;
    }

    .footer-inner {
      max-width: 720px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      text-align: center;
    }

    @media (min-width: 600px) {
      .footer-inner {
        grid-template-columns: 1fr 1fr 1fr;
        text-align: left;
      }
    }

    .footer-inner p {
      margin: 0 0 4px;
      font-size: 14px;
      color: #737373;
    }

    .footer-brand a {
      font-family: 'Oswald', sans-serif;
      font-size: 18px;
      color: #f59e0b;
      text-decoration: none;
    }

    .footer-brand a:hover {
      text-decoration: underline;
    }
  `]
})
export class StudvesnaComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly queryPromo = toSignal(
    this.route.queryParamMap.pipe(map(p => p.get('promo'))),
    { initialValue: null }
  );

  readonly manualCode = signal('');
  readonly now = signal(new Date());

  readonly showPromoInput = computed(() => !this.queryPromo());

  readonly promoCode = computed(() => {
    const fromUrl = this.queryPromo();
    if (fromUrl) return fromUrl;
    const manual = this.manualCode().trim().toUpperCase();
    return manual || 'STUDVESNA26';
  });

  readonly isPersonalCode = computed(() => this.promoCode().startsWith('SVV-'));

  readonly deadline = computed(() => this.isPersonalCode() ? PERSONAL_END : GENERAL_END);

  readonly timerState = computed<TimerState>(() => {
    const current = this.now();
    if (current < EVENT_START) return 'before';
    if (current < this.deadline()) return 'active';
    return 'expired';
  });

  readonly isActive = computed(() => this.timerState() === 'active');

  readonly countdown = computed<CountdownTime>(() => {
    const current = this.now();
    const target = this.timerState() === 'before' ? EVENT_START : this.deadline();
    const diff = Math.max(0, target.getTime() - current.getTime());

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return { days, hours, minutes, seconds };
  });

  readonly plans: PlanCard[] = [
    {
      id: 'docs',
      slug: 'launch-printscan-lite',
      title: 'Печать документов',
      volume: '50 страниц А4 в месяц',
      description: 'Рефераты, курсовые, дипломы, печатай бесплатно целый месяц',
      price: '199 ₽/мес после бесплатного периода'
    },
    {
      id: 'photo',
      slug: 'launch-photoprint-lite',
      title: 'Фотопечать',
      volume: '15 фото 10×15 в месяц',
      description: 'Любимые снимки на бумаге, качественная печать в студии',
      price: '199 ₽/мес после бесплатного периода'
    }
  ];

  readonly steps = [
    { num: '1', text: 'Выбери подписку' },
    { num: '2', text: 'Привяжи карту (первое списание через 30 дней)' },
    { num: '3', text: 'Печатай бесплатно!' }
  ];

  constructor() {
    afterNextRender(() => {
      const interval = setInterval(() => this.now.set(new Date()), 1000);
      this.destroyRef.onDestroy(() => clearInterval(interval));
    });
  }

  onPromoInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.manualCode.set(value);
    this.tryLoadTrialInfo(value.trim().toUpperCase());
  }

  private tryLoadTrialInfo(code: string): void {
    if (!code || !isPlatformBrowser(this.platformId)) return;
    this.http.get<{ trial_days?: number; starts_at?: string; ends_at?: string }>(
      `/api/subscriptions/trial-info/${encodeURIComponent(code)}`
    ).subscribe({ error: () => void 0 });
  }
}
