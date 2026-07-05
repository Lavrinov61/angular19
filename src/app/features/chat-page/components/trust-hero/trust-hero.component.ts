import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RatingService } from '../../../../core/services/rating.service';

interface TrustBadge {
  icon: string;
  label: string;
  highlighted: boolean;
}

@Component({
  selector: 'app-trust-hero',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="trust-hero">
      <div class="hero-main">
        <div class="hero-text">
          <h1 class="hero-headline">
            Ручная художественная обработка каждого фото
          </h1>
          <p class="hero-subtitle">
            Каждое фото обрабатывается вручную профессиональным ретушёром
          </p>
        </div>

        <div class="badges-grid">
          @for (badge of badges(); track badge.icon) {
            <div class="badge" [class.badge--accent]="badge.highlighted">
              <mat-icon class="badge__icon">{{ badge.icon }}</mat-icon>
              <span class="badge__label">{{ badge.label }}</span>
            </div>
          }
        </div>
      </div>

      <div class="status-strip">
        <mat-icon class="status-strip__icon">schedule</mat-icon>
        <span>Пн-Вс 09:00-19:30</span>
        <span class="status-strip__sep">·</span>
        <mat-icon class="status-strip__icon">chat_bubble_outline</mat-icon>
        <span>Отвечаем за 5 мин</span>
        <span class="status-strip__sep">·</span>
        <mat-icon class="status-strip__icon">public</mat-icon>
        <span>Работаем по всей России</span>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }

    .trust-hero {
      background: var(--ed-surface-container, #1e1e1e);
      border-bottom: 1px solid var(--ed-outline-variant, #333);
    }

    /* ── Main block ─────────────────────────────────────────── */
    .hero-main {
      padding: 20px 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* ── Text ───────────────────────────────────────────────── */
    .hero-text {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .hero-headline {
      font-family: 'Oswald', sans-serif;
      font-size: clamp(1.1rem, 2.5vw, 1.5rem);
      font-weight: 600;
      line-height: 1.25;
      color: var(--ed-on-surface, #f0f0f0);
      margin: 0;
      letter-spacing: 0.01em;
    }

    .hero-subtitle {
      font-size: 0.875rem;
      color: var(--ed-on-surface-variant, #aaa);
      margin: 0;
      line-height: 1.5;
    }

    /* ── Badges ─────────────────────────────────────────────── */
    .badges-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }

    .badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 12px 8px;
      background: var(--ed-surface, #141414);
      border: 1px solid var(--ed-outline-variant, #333);
      border-radius: 10px;
      text-align: center;
      transition: border-color 0.2s ease;
    }

    .badge:hover {
      border-color: var(--ed-accent, #f59e0b);
    }

    .badge--accent {
      border-color: var(--ed-accent, #f59e0b);
      background: var(--ed-accent-container, rgba(245, 158, 11, 0.08));
    }

    .badge__icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: var(--ed-on-surface-variant, #aaa);
    }

    .badge--accent .badge__icon {
      color: var(--ed-accent, #f59e0b);
    }

    .badge__label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f0f0f0);
      line-height: 1.3;
    }

    /* ── Status strip ───────────────────────────────────────── */
    .status-strip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 24px;
      background: var(--ed-surface, #141414);
      border-top: 1px solid var(--ed-outline-variant, #333);
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #aaa);
      flex-wrap: wrap;
    }

    .status-strip__icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
      color: var(--ed-accent, #f59e0b);
    }

    .status-strip__sep {
      color: var(--ed-outline-variant, #555);
      margin: 0 2px;
    }

    /* ── Mobile ─────────────────────────────────────────────── */
    @media (max-width: 599px) {
      .hero-main {
        padding: 16px 16px 12px;
      }

      .badges-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .status-strip {
        padding: 8px 16px;
        font-size: 0.75rem;
        gap: 5px;
      }
    }
  `],
})
export class TrustHeroComponent implements OnInit {
  private readonly ratingService = inject(RatingService);

  readonly yearsOfWork = new Date().getFullYear() - 1999;

  private readonly clientCount = signal<number | null>(null); // не используется напрямую, нужен только для бейджа

  readonly badges = signal<TrustBadge[]>([
    { icon: 'groups',             label: '...',              highlighted: false },
    { icon: 'workspace_premium',  label: `С 1999 года`,      highlighted: false },
    { icon: 'brush',              label: 'Ручная обработка', highlighted: true  },
    { icon: 'verified',           label: 'Гарантия качества', highlighted: false },
  ]);

  ngOnInit(): void {
    this.ratingService.getClientCount().subscribe(stats => {
      this.clientCount.set(stats.clientCount);
      this.badges.update(current => current.map((b, i) =>
        i === 0 ? { ...b, label: `${this.formatCount(stats.clientCount)}+ клиентов` } : b,
      ));
    });
  }

  private formatCount(n: number): string {
    return n.toLocaleString('ru-RU');
  }
}
