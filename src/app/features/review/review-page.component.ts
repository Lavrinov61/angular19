import { Component, inject, signal, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';

interface PlatformCard {
  id: string;
  name: string;
  icon: string;
  color: string;
  bgColor: string;
  description: string;
}

const PLATFORMS: PlatformCard[] = [
  {
    id: 'yandex',
    name: 'Яндекс Карты',
    icon: 'location_on',
    color: '#c62828',
    bgColor: 'rgba(198, 40, 40, 0.12)',
    description: 'Самая популярная площадка',
  },
  {
    id: '2gis',
    name: '2ГИС',
    icon: 'map',
    color: '#2e7d32',
    bgColor: 'rgba(46, 125, 50, 0.12)',
    description: 'Подробные отзывы',
  },
  {
    id: 'google',
    name: 'Google Maps',
    icon: 'public',
    color: '#1565c0',
    bgColor: 'rgba(21, 101, 192, 0.12)',
    description: 'Международная площадка',
  },
];

@Component({
  selector: 'app-review-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatRippleModule],
  template: `
    <div class="review-page">
      <div class="review-card">
        <!-- Logo -->
        <div class="logo-block">
          <div class="logo">Своё Фото</div>
        </div>

        <!-- Header -->
        <div class="header">
          <div class="star-icon">⭐</div>
          <h1>Спасибо за визит!</h1>
          <p>Нам важно ваше мнение, оставьте отзыв на любой удобной площадке</p>
        </div>

        <!-- Platform cards -->
        <div class="platforms">
          @for (p of platforms; track p.id) {
            <a class="platform-card"
               [href]="getPlatformUrl(p.id)"
               [style.--card-color]="p.color"
               [style.--card-bg]="p.bgColor"
               matRipple
               target="_blank"
               rel="noopener">
              <div class="platform-icon">
                <mat-icon>{{ p.icon }}</mat-icon>
              </div>
              <div class="platform-info">
                <span class="platform-name">{{ p.name }}</span>
                <span class="platform-desc">{{ p.description }}</span>
              </div>
              <mat-icon class="arrow">chevron_right</mat-icon>
            </a>
          }
        </div>

        <!-- Footer text -->
        <p class="footer-text">
          Ваш отзыв помогает нам становиться лучше<br>
          и помогает другим клиентам сделать выбор
        </p>

        <!-- Studio info -->
        <div class="studio-info">
          <a href="https://svoefoto.ru" class="studio-link">svoefoto.ru</a>
          <span>Пер. Соборный 21, Ростов-на-Дону</span>
          <span>Пн-Вс 09:00-19:30</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }

    .review-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: var(--ed-surface, #0a0a0a);
    }

    .review-card {
      width: 100%;
      max-width: 420px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }

    .logo-block {
      padding: 20px;
      text-align: center;
    }

    .logo {
      display: inline-block;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      padding: 8px 20px;
      border-radius: 8px;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .header {
      text-align: center;
      padding: 0 24px 24px;
    }

    .star-icon {
      font-size: 48px;
      line-height: 1;
      margin-bottom: 8px;
    }

    h1 {
      margin: 0;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 24px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .header p {
      margin: 8px 0 0;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.4;
    }

    .platforms {
      padding: 0 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .platform-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px;
      border-radius: 14px;
      background: var(--card-bg);
      border: 1px solid rgba(255, 255, 255, 0.06);
      text-decoration: none;
      color: inherit;
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      }
      &:active { transform: scale(0.98); }
    }

    .platform-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--card-color);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon { color: #fff; font-size: 22px; width: 22px; height: 22px; }
    }

    .platform-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    .platform-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .platform-desc {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-top: 2px;
    }

    .arrow {
      color: var(--ed-on-surface-muted, #666666);
      flex-shrink: 0;
    }

    .footer-text {
      text-align: center;
      padding: 24px 24px 0;
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.5;
    }

    .studio-info {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 16px 24px 20px;
      font-size: 11px;
      color: var(--ed-on-surface-muted, #666666);
    }

    .studio-link {
      color: var(--ed-accent, #f59e0b);
      text-decoration: none;
      font-weight: 500;
    }
  `],
})
export class ReviewPageComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);

  readonly platforms = PLATFORMS;
  private token = signal<string | null>(null);
  private location = signal<string>('soborny');

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const params = this.route.snapshot.queryParamMap;
      this.token.set(params.get('t'));
      this.location.set(params.get('location') || 'soborny');
    }
  }

  getPlatformUrl(platformId: string): string {
    const t = this.token();
    if (t) {
      return `/api/reviews/go?t=${t}&p=${platformId}`;
    }
    // Прямые ссылки без трекинга (QR без токена)
    const urls: Record<string, string> = {
      yandex: 'https://yandex.ru/maps/org/magnusfoto/50414539463/reviews/',
      '2gis': 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews',
      google: 'https://g.page/r/CdLAfLUuNAGrEBM/review',
    };
    return urls[platformId] || urls['yandex'];
  }
}
