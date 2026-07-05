import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  LoyaltyProfile,
  Achievement,
  LoyaltyTransaction,
  AchievementBadge,
  LevelInfo,
} from '../../../../shared/interfaces/loyalty.interfaces';
import {
  LEVELS,
  getLevelInfo,
  getLevelProgress,
  getNextLevelXp,
  canClaimDaily,
  buildAchievementBadges,
} from '../../../../shared/utils/loyalty.utils';
import { ReferralTrackingService } from '../../../../core/services/referral-tracking.service';

interface ApplyReferralResponse {
  success: boolean;
  data?: {
    pointsAwarded?: number;
  };
  error?: string;
}

@Component({
  selector: 'app-loyalty-redesign',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, MatProgressSpinnerModule, MatIconModule, MatTooltipModule],
  template: `
    <!-- ═══════════════ CONFETTI OVERLAY ═══════════════ -->
    @if (showConfetti()) {
      <div class="confetti-overlay" aria-hidden="true">
        <div class="cp cp-1"></div>
        <div class="cp cp-2"></div>
        <div class="cp cp-3"></div>
        <div class="cp cp-4"></div>
        <div class="cp cp-5"></div>
        <div class="cp cp-6"></div>
        <div class="cp cp-7"></div>
        <div class="cp cp-8"></div>
        <div class="cp cp-9"></div>
        <div class="cp cp-10"></div>
        <div class="cp cp-11"></div>
        <div class="cp cp-12"></div>
      </div>
    }

    @if (loading()) {
      <div class="lr-loading">
        <mat-spinner diameter="40" />
        <p>Загрузка бонусной программы...</p>
      </div>
    } @else if (error()) {
      <div class="lr-error">
        <span class="lr-error-icon">!</span>
        <p>{{ error() }}</p>
        <button class="lr-btn lr-btn--primary" (click)="loadProfile()">Повторить</button>
      </div>
    } @else {
      @let p = profile();
      @if (p) {
      <div class="lr-page">

        <!-- ═══════════════ LEVEL CARD (Hero) ═══════════════ -->
        <section class="lr-hero">
          <a routerLink="/user-profile" class="lr-hero__back" aria-label="Назад в профиль">
            <span class="lr-hero__back-arrow">&larr;</span>
          </a>

          <div class="lr-hero__top">
            <div class="lr-hero__badge">
              <mat-icon class="lr-hero__badge-icon" [svgIcon]="levelInfo().icon" />
              <span class="lr-hero__badge-num">{{ p.level }}</span>
            </div>
            <div class="lr-hero__info">
              <h1 class="lr-hero__name">{{ levelInfo().name }}</h1>
              <span class="lr-hero__xp">{{ displayedXp() }} бонусов <mat-icon class="hint-icon" matTooltip="Бонусы начисляются за заказы, ежедневные визиты и активность. Копите бонусы, чтобы повышать уровень и оплачивать ими заказы.">help_outline</mat-icon></span>
            </div>
            <div class="lr-hero__points">
              <span class="lr-hero__points-value">{{ displayedPoints() }}</span>
              <span class="lr-hero__points-label">бонусов</span>
            </div>
          </div>

          @if (levelInfo().maxXp !== maxInfinity) {
            <div class="lr-hero__progress">
              <div class="lr-hero__progress-labels">
                <span>Уровень {{ p.level }}</span>
                <span>Уровень {{ p.level + 1 }}</span>
              </div>
              <div class="lr-xp-bar">
                <div
                  class="lr-xp-bar__inner"
                  [style.--xp-progress]="levelProgress() + '%'"
                ></div>
              </div>
              <span class="lr-hero__progress-hint">
                Ещё {{ xpRemaining() }} бонусов до следующего уровня
              </span>
            </div>
          } @else {
            <p class="lr-hero__max">Максимальный уровень достигнут!</p>
          }

          @if (p.level === 1 && p.totalPointsEarned < 100) {
            <div class="lr-onboarding">
              <h3>Как работает бонусная программа?</h3>
              <div class="lr-onboarding__steps">
                <div class="lr-onboarding__step">
                  <mat-icon>shopping_cart</mat-icon>
                  <span>Делайте заказы</span>
                  <small>+5 бонусов за заказ</small>
                </div>
                <div class="lr-onboarding__step">
                  <mat-icon>calendar_today</mat-icon>
                  <span>Заходите каждый день</span>
                  <small>+10 бонусов в день</small>
                </div>
                <div class="lr-onboarding__step">
                  <mat-icon>trending_up</mat-icon>
                  <span>Повышайте уровень</span>
                  <small>Скидки и привилегии</small>
                </div>
              </div>
            </div>
          }
        </section>

        <div class="lr-two-column">
        <div class="lr-column-main">

        <!-- ═══════════════ DAILY STREAK CALENDAR ═══════════════ -->
        <section class="lr-streak">
          <h2 class="lr-section-title">Ежедневный бонус</h2>
          <p class="lr-streak__intro-hint">Получайте +10 бонусов каждый день. За 7 дней подряд, ещё +50 бонусов!</p>
          <div class="lr-streak__calendar">
            @for (day of streakDays(); track day.label) {
              <div
                class="lr-streak__day"
                [class.lr-streak__day--checked]="day.checked"
                [class.lr-streak__day--today]="day.isToday"
              >
                <span class="lr-streak__day-label">{{ day.label }}</span>
                <span class="lr-streak__day-circle">
                  @if (day.checked) {
                    <span class="lr-streak__check">&#10003;</span>
                  }
                </span>
              </div>
            }
          </div>

          <div class="lr-streak__footer">
            <span class="lr-streak__hint">
              @if (streakBonusDaysLeft() > 0) {
                Ещё {{ streakBonusDaysLeft() }} {{ dayWord(streakBonusDaysLeft()) }} до +50 бонусов
              } @else {
                Сегодня бонус за серию!
              }
            </span>
            <button
              class="lr-btn lr-btn--accent lr-daily-btn"
              [class.lr-daily-btn--disabled]="dailyClaimed() || claimingDaily()"
              [disabled]="dailyClaimed() || claimingDaily()"
              (click)="claimDaily()"
            >
              @if (claimingDaily()) {
                <mat-spinner diameter="18" />
              } @else if (dailyClaimed()) {
                Получено
              } @else {
                +10 бонусов
              }
            </button>
          </div>
          <p class="streak-explanation">Заходите каждый день, за серию из 7 дней получите +50 бонусов</p>
        </section>

        <!-- ═══════════════ LEVEL ROADMAP ═══════════════ -->
        <section class="lr-roadmap">
          <h2 class="lr-section-title">Уровни</h2>
          <div class="lr-roadmap__track">
            @for (lvl of allLevels; track lvl.level; let i = $index; let last = $last) {
              <div
                class="lr-roadmap__node"
                [class.lr-roadmap__node--current]="lvl.level === p.level"
                [class.lr-roadmap__node--passed]="lvl.level < p.level"
                [class.lr-roadmap__node--future]="lvl.level > p.level"
                [matTooltip]="'Уровень ' + lvl.level + ': ' + lvl.name + (lvl.bonus ? ', ' + lvl.bonus : '')"
              >
                <div class="lr-roadmap__circle">
                  <mat-icon class="lr-roadmap__icon" [svgIcon]="lvl.icon" />
                </div>
                <span class="lr-roadmap__label">{{ lvl.name }}</span>
                @if (lvl.bonus) {
                  <span class="lr-roadmap__bonus">{{ lvl.bonus }}</span>
                }
              </div>
              @if (!last) {
                <div
                  class="lr-roadmap__line"
                  [class.lr-roadmap__line--filled]="lvl.level < p.level"
                ></div>
              }
            }
          </div>
        </section>

        <section class="lr-conversion">
          <h2 class="lr-section-title">Бонусы &rarr; скидка</h2>
          @if (p.points > 0) {
            <p class="lr-conversion__text">
              У вас <strong>{{ displayedPoints() }} бонусов</strong> = <strong>{{ pointsAsRubles() }}&thinsp;&#8381;</strong> на следующий заказ
            </p>
            <a routerLink="/chat" class="lr-btn lr-btn--primary lr-conversion__use">
              Использовать при заказе
            </a>
          } @else {
            <p class="lr-conversion__empty">
              Копите бонусы и оплачивайте ими заказы (1 бонус = 1 &#8381;)
            </p>
          }
        </section>

        </div>
        <div class="lr-column-side">

        <!-- ═══════════════ ACHIEVEMENTS GRID ═══════════════ -->
        <section class="lr-achievements">
          <h2 class="lr-section-title">Достижения</h2>
          <div class="lr-achievements__grid">
            @for (badge of achievementBadges(); track badge.id) {
              <div
                class="lr-ach"
                [class.lr-ach--unlocked]="badge.unlocked"
                [class.lr-ach--locked]="!badge.unlocked"
              >
                <mat-icon class="lr-ach__icon" [svgIcon]="badge.icon" />
                <span class="lr-ach__name">{{ badge.name }}</span>
                <span class="lr-ach__desc">{{ badge.description }}</span>
                @if (badge.xpReward) {
                  <span class="lr-ach__xp">+{{ badge.xpReward }} бонусов</span>
                }
              </div>
            }
          </div>
        </section>

        <!-- ═══════════════ REFERRAL + BONUS CONVERSION ═══════════════ -->
        <section class="lr-referral">
          <h2 class="lr-section-title">Пригласите друга</h2>

          <div class="lr-referral__reward-banner">
            <mat-icon class="lr-referral__gift-icon">redeem</mat-icon>
            <div class="lr-referral__reward-text">
              <span>За друга: <strong>до 5 000 бонусов</strong></span>
              <span>Другу нужно активировать подписку</span>
              <span>Бонусами можно оплатить до 15% заказа</span>
            </div>
          </div>

          @if (p.invitedCount > 0) {
            <div class="lr-referral__stats">
              <mat-icon>group</mat-icon>
              <span>Вы пригласили: <strong>{{ p.invitedCount }}</strong></span>
            </div>
          }

          <div class="lr-referral__link-block">
            <span class="lr-referral__link-label">Ваша ссылка</span>
            <div class="lr-referral__link-row">
              <code class="lr-referral__link-text">{{ referralLink() }}</code>
              <button
                class="lr-referral__copy-btn"
                [class.lr-referral__copy-btn--copied]="linkCopied()"
                (click)="copyReferralLink()"
              >
                <mat-icon>{{ linkCopied() ? 'check' : 'content_copy' }}</mat-icon>
              </button>
            </div>
          </div>

          <div class="lr-referral__code-block">
            <span class="lr-referral__code-label">Код:</span>
            <span class="lr-referral__code">{{ p.referralCode }}</span>
          </div>

          <div class="lr-referral__share-buttons">
            <a class="lr-share-btn lr-share-btn--tg"
               [href]="shareTelegramUrl()"
               target="_blank" rel="noopener noreferrer">
              <span class="lr-share-btn__icon" aria-hidden="true">
                <mat-icon svgIcon="channel-telegram" />
              </span>
              <span>Telegram</span>
            </a>
            <a class="lr-share-btn lr-share-btn--max"
               [href]="shareMaxUrl()"
               target="_blank" rel="noopener noreferrer">
              <span class="lr-share-btn__icon" aria-hidden="true">
                <mat-icon svgIcon="channel-max" />
              </span>
              <span>МАКС</span>
            </a>
            <a class="lr-share-btn lr-share-btn--vk"
               [href]="shareVkUrl()"
               target="_blank" rel="noopener noreferrer">
              <span class="lr-share-btn__icon" aria-hidden="true">
                <mat-icon svgIcon="channel-vk" />
              </span>
              <span>VK</span>
            </a>
            @if (canShare()) {
              <button class="lr-share-btn lr-share-btn--more" (click)="shareReferral()">
                <mat-icon>share</mat-icon>
              </button>
            }
          </div>
        </section>

        <!-- ═══════════════ TRANSACTIONS ═══════════════ -->
        <section class="lr-transactions">
          <button
            class="lr-transactions__toggle"
            (click)="toggleTransactions()"
          >
            {{ showTransactions() ? 'Скрыть историю' : 'Показать историю' }}
            <span
              class="lr-transactions__chevron"
              [class.lr-transactions__chevron--open]="showTransactions()"
            >&#9660;</span>
          </button>

          @if (showTransactions()) {
            @if (transactions().length === 0) {
              <p class="lr-transactions__empty">История пока пуста</p>
            } @else {
              <div class="lr-transactions__list">
                @for (tx of transactions(); track $index) {
                  <div class="lr-tx">
                    <div class="lr-tx__info">
                      <span class="lr-tx__desc">{{ tx.description }}</span>
                      <span class="lr-tx__date">{{ tx.created_at | date:'dd.MM.yyyy HH:mm' }}</span>
                    </div>
                    <span
                      class="lr-tx__amount"
                      [class.lr-tx__amount--pos]="tx.amount > 0"
                      [class.lr-tx__amount--neg]="tx.amount < 0"
                    >
                      {{ tx.amount > 0 ? '+' : '' }}{{ tx.amount }} бонусов
                    </span>
                  </div>
                }
              </div>
            }
          }
        </section>

        </div>
        </div>

      </div>
    }
    }
  `,
  styles: `
    /* ───────────── Reset / Page ───────────── */
    :host {
      display: block;
      --amber: #f59e0b;
      --surface-container: #ffffff;
      --ed-surface: #f1f2f4;
      --ed-surface-container: #ffffff;
      --ed-surface-container-high: #f5f6f8;
      --ed-outline: #cfd5dd;
      --ed-outline-variant: #dfe3e8;
      --ed-on-surface: #20242a;
      --ed-on-surface-variant: #6f7782;
      --ed-on-surface-muted: #8a929d;
      --ed-accent: #f59e0b;
      --ed-accent-container: #fff4df;
      --ed-on-accent: #111111;
      --ed-on-accent-container: #8a4b00;
    }

    .lr-page {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px 28px 48px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      color: var(--ed-on-surface, #20242a);
    }

    /* ───────────── Loading / Error ───────────── */
    .lr-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 64px 16px;
      color: var(--ed-on-surface-variant, #999);
    }

    .lr-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 48px 16px;
      text-align: center;
      color: var(--ed-on-surface-variant, #999);
    }

    .lr-error-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(239,68,68,.15);
      color: #ef4444;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 700;
    }

    /* ───────────── Two-column layout ───────────── */
    .lr-two-column {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 24px;
      align-items: start;
    }

    .lr-column-main,
    .lr-column-side {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    @media (max-width: 1200px) {
      .lr-two-column {
        grid-template-columns: 1fr;
      }
    }

    /* ───────────── Buttons ───────────── */
    .lr-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 20px;
      border-radius: 10px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
                  opacity 200ms,
                  transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
                  box-shadow 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
      font-family: inherit;
      color: var(--ed-on-surface, #20242a);
    }

    .lr-btn:active {
      transform: scale(0.97);
    }

    .lr-btn--primary {
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
    }

    .lr-btn--primary:hover {
      background: #d97706;
      transform: scale(1.03);
      box-shadow: 0 4px 16px rgba(245,158,11,0.25);
    }

    .lr-btn--accent {
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
    }

    .lr-btn--accent:hover {
      background: #d97706;
      transform: scale(1.03);
      box-shadow: 0 4px 16px rgba(245,158,11,0.25);
    }

    .lr-btn--outline {
      background: transparent;
      border: 1px solid var(--ed-outline, #cfd5dd);
      color: var(--ed-on-surface, #20242a);
    }

    .lr-btn--outline:hover {
      border-color: var(--ed-accent, #f59e0b);
      color: var(--ed-accent, #f59e0b);
      transform: scale(1.03);
    }

    .lr-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ───────────── Section title ───────────── */
    .lr-section-title {
      margin: 0 0 14px;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    /* ═══════════════════════════════════
       LEVEL CARD (Hero), M3 Expressive
    ═══════════════════════════════════ */
    .lr-hero {
      position: relative;
      background: linear-gradient(135deg, #fff7e8 0%, #ffffff 58%, #f2f4f7 100%);
      backdrop-filter: blur(16px) saturate(150%);
      -webkit-backdrop-filter: blur(16px) saturate(150%);
      border-radius: var(--m3e-corner-xl, 28px);
      padding: 28px 24px 24px;
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      box-shadow: 0 14px 36px rgba(31, 41, 55, 0.08);
    }

    .lr-hero__back {
      position: absolute;
      top: 16px;
      left: 16px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f2f3f5;
      color: var(--ed-on-surface-variant, #999);
      text-decoration: none;
      font-size: 16px;
      transition: background 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
                  transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .lr-hero__back:hover {
      background: #e7e9ed;
      transform: scale(1.08);
    }

    .lr-hero__back-arrow {
      line-height: 1;
    }

    .lr-hero__top {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .lr-hero__badge {
      position: relative;
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: var(--ed-accent-container, #451a03);
      border: 2px solid var(--ed-accent, #f59e0b);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .lr-hero__badge-icon {
      width: 44px;
      height: 44px;
      font-size: 44px;
      filter: drop-shadow(0 0 20px rgba(245, 158, 11, 0.35));
    }

    ::ng-deep .lr-hero__badge-icon svg {
      width: 44px;
      height: 44px;
    }

    .lr-hero__badge-num {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 12px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .lr-hero__info {
      flex: 1;
      min-width: 0;
    }

    .lr-hero__name {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
    }

    .lr-hero__xp {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .hint-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: help;
    }

    .lr-hero__points {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 10px 18px;
      background: var(--ed-accent-container, #451a03);
      border-radius: 14px;
      flex-shrink: 0;
    }

    .lr-hero__points-value {
      font-size: 2rem;
      font-weight: 800;
      color: #f59e0b;
    }

    .lr-hero__points-label {
      font-size: 11px;
      color: var(--ed-on-accent-container, #fef3c7);
      opacity: 0.7;
    }

    /* Bonus Bar */
    .lr-hero__progress {
      margin-top: 20px;
    }

    .lr-hero__progress-labels {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 6px;
    }

    .lr-xp-bar {
      height: 8px;
      border-radius: var(--m3e-corner-full, 9999px);
      background: #e7e9ed;
      overflow: hidden;
    }

    .lr-xp-bar__inner {
      height: 100%;
      border-radius: var(--m3e-corner-full, 9999px);
      background: linear-gradient(90deg, #f59e0b, #fbbf24);
      width: 0;
      animation: xp-fill 800ms ease-out forwards;
    }

    @keyframes xp-fill {
      from { width: 0; }
      to   { width: var(--xp-progress); }
    }

    .lr-hero__progress-hint {
      display: block;
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-top: 6px;
    }

    .lr-hero__max {
      margin: 16px 0 0;
      font-size: 14px;
      color: var(--ed-accent, #f59e0b);
      font-weight: 600;
    }

    /* Onboarding hint for new users */
    .lr-onboarding {
      background: linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03));
      border: 1px solid rgba(245,158,11,0.15);
      border-radius: 16px;
      padding: 20px 24px;
      margin-top: 16px;
      text-align: center;
    }
    .lr-onboarding h3 {
      margin: 0 0 16px;
      font-size: 1rem;
      color: var(--ed-on-surface, #20242a);
    }
    .lr-onboarding__steps {
      display: flex;
      gap: 24px;
      justify-content: center;
    }
    .lr-onboarding__step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .lr-onboarding__step mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--amber, #f59e0b);
    }
    .lr-onboarding__step span {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--ed-on-surface, #20242a);
    }
    .lr-onboarding__step small {
      font-size: 0.75rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    @media (max-width: 600px) {
      .lr-onboarding__steps { flex-direction: column; gap: 12px; }
    }

    /* ═══════════════════════════════════
       DAILY STREAK CALENDAR, M3 Expressive
    ═══════════════════════════════════ */
    .lr-streak {
      background: var(--surface-container, #ffffff);
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08);
    }

    .lr-streak__intro-hint {
      font-size: 0.85rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 12px;
      text-align: center;
    }

    .lr-streak__calendar {
      display: flex;
      justify-content: space-between;
      gap: 6px;
    }

    .lr-streak__day {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      flex: 1;
    }

    .lr-streak__day-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-transform: uppercase;
    }

    .lr-streak__day-circle {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      background: #f2f3f5;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: all 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .lr-streak__day--checked .lr-streak__day-circle {
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      border-color: transparent;
    }

    .lr-streak__check {
      color: var(--ed-on-accent, #0a0a0a);
      font-weight: 700;
      font-size: 16px;
    }

    .lr-streak__day--today.lr-streak__day--checked .lr-streak__day-circle {
      border: 1.5px solid #f59e0b;
      box-shadow: 0 0 12px rgba(245,158,11,0.3);
      animation: none;
    }

    .lr-streak__day--today:not(.lr-streak__day--checked) .lr-streak__day-circle {
      border-color: rgba(245,158,11,0.5);
      animation: daily-pulse 2s infinite;
    }

    @keyframes daily-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.4); }
      50%      { box-shadow: 0 0 0 10px rgba(245,158,11,0); }
    }

    .lr-streak__footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
      gap: 12px;
    }

    .lr-streak__hint {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .streak-explanation {
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-align: center;
      margin-top: 8px;
    }

    .lr-daily-btn {
      flex-shrink: 0;
      min-width: 100px;
      min-height: 44px;
      padding: 10px 20px;
    }

    .lr-daily-btn:not(:disabled) {
      animation: daily-pulse 2s infinite;
    }

    .lr-daily-btn--disabled {
      animation: none !important;
    }

    /* ═══════════════════════════════════
       LEVEL ROADMAP
    ═══════════════════════════════════ */
    .lr-roadmap {
      background: var(--surface-container, #ffffff);
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      border-radius: 16px;
      padding: 24px;
      overflow-x: auto;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08);
    }

    .lr-roadmap__track {
      display: flex;
      align-items: flex-start;
      min-width: max-content;
    }

    .lr-roadmap__node {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      min-width: 72px;
      position: relative;
    }

    .lr-roadmap__circle {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 2px solid var(--ed-outline, #cfd5dd);
      background: var(--ed-surface, #f1f2f4);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .lr-roadmap__icon {
      width: 26px;
      height: 26px;
      font-size: 26px;
    }

    ::ng-deep .lr-roadmap__icon svg {
      width: 26px;
      height: 26px;
    }

    .lr-roadmap__label {
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .lr-roadmap__bonus {
      font-size: 0.7rem;
      color: var(--ed-on-surface-muted, #888);
      white-space: normal;
      max-width: 80px;
      text-align: center;
      line-height: 1.2;
    }

    /* Node states */
    .lr-roadmap__node--current .lr-roadmap__circle {
      border-color: var(--ed-accent, #f59e0b);
      background: var(--ed-accent-container, #451a03);
      box-shadow: 0 0 12px rgba(245,158,11,.35);
      transform: scale(1.2);
    }

    .lr-roadmap__node--current .lr-roadmap__label {
      color: var(--ed-accent, #f59e0b);
      font-weight: 700;
    }

    .lr-roadmap__node--passed .lr-roadmap__circle {
      border-color: var(--ed-accent, #f59e0b);
      background: var(--ed-accent-container, #451a03);
    }

    .lr-roadmap__node--passed .lr-roadmap__label {
      color: var(--ed-on-surface, #20242a);
    }

    .lr-roadmap__node--future {
      opacity: 0.45;
    }

    /* Connecting lines */
    .lr-roadmap__line {
      flex: 1;
      height: 2px;
      background: var(--ed-outline, #cfd5dd);
      min-width: 24px;
      margin-top: 23px; /* vertically center with circle */
    }

    .lr-roadmap__line--filled {
      background: var(--ed-accent, #f59e0b);
    }

    /* ═══════════════════════════════════
       ACHIEVEMENTS GRID, M3 Expressive
    ═══════════════════════════════════ */
    .lr-achievements {
      background: var(--surface-container, #ffffff);
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08);
    }

    .lr-achievements__grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .lr-ach {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 16px 10px 14px;
      border-radius: 16px;
      background: rgba(245,158,11,0.06);
      text-align: center;
      border: 1px solid rgba(245,158,11,0.15);
      position: relative;
      transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
                  border-color 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
                  box-shadow 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
      min-height: 140px;
      min-width: 0;
      justify-content: center;
    }

    .lr-ach--unlocked {
      border-color: rgba(245,158,11,0.35);
    }

    .lr-ach--unlocked:hover {
      transform: scale(1.05);
      border-color: #f59e0b;
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.3);
    }

    .lr-ach--locked {
      opacity: 0.5;
      filter: grayscale(100%) blur(1.5px);
      border-style: dashed;
    }

    .lr-ach__icon {
      width: 44px;
      height: 44px;
      font-size: 44px;
      color: #f59e0b;
    }

    ::ng-deep .lr-ach__icon svg {
      width: 44px;
      height: 44px;
    }

    .lr-ach__name {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
    }

    .lr-ach__desc {
      font-size: 10px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.2;
    }

    .lr-ach__xp {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      background: rgba(245,158,11,0.15);
      color: #f59e0b;
    }

    /* ═══════════════════════════════════
       REFERRAL
    ═══════════════════════════════════ */
    .lr-referral,
    .lr-conversion {
      background: var(--surface-container, #ffffff);
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08);
    }

    .lr-referral__reward-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: linear-gradient(135deg, rgba(245,158,11,.12) 0%, rgba(251,191,36,.08) 100%);
      border: 1px solid rgba(245,158,11,.25);
      border-radius: 12px;
      margin-bottom: 14px;
    }

    .lr-referral__gift-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--ed-accent, #f59e0b);
      flex-shrink: 0;
    }

    .lr-referral__reward-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 13px;
      color: var(--ed-on-surface, #20242a);
      line-height: 1.4;
    }

    .lr-referral__reward-text strong {
      color: var(--ed-accent, #f59e0b);
      font-weight: 700;
    }

    .lr-referral__stats {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 14px;
      padding: 8px 12px;
      background: #f7f8fa;
      border-radius: 8px;
    }

    .lr-referral__stats mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--ed-accent, #f59e0b);
    }

    .lr-referral__stats strong {
      color: var(--ed-accent, #f59e0b);
      font-weight: 700;
    }

    .lr-referral__link-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 10px;
    }

    .lr-referral__link-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .lr-referral__link-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .lr-referral__link-text {
      flex: 1;
      font-size: 12px;
      font-family: monospace;
      color: var(--ed-on-surface, #20242a);
      background: #f7f8fa;
      padding: 8px 12px;
      border-radius: 8px;
      word-break: break-all;
      line-height: 1.4;
    }

    .lr-referral__copy-btn {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      background: #f7f8fa;
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 200ms;
    }

    .lr-referral__copy-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .lr-referral__copy-btn:hover {
      border-color: var(--ed-accent, #f59e0b);
      color: var(--ed-accent, #f59e0b);
    }

    .lr-referral__copy-btn--copied {
      border-color: #22c55e;
      color: #22c55e;
    }

    .lr-referral__code-block {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 10px;
      background: rgba(245,158,11,.07);
      border: 1px dashed var(--ed-accent, #f59e0b);
      margin-bottom: 14px;
    }

    .lr-referral__code-label {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .lr-referral__code {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 4px;
      color: var(--ed-accent, #f59e0b);
      font-family: monospace;
    }

    .lr-referral__share-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .lr-share-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      border: none;
      cursor: pointer;
      transition: opacity 200ms, transform 200ms;
      font-family: inherit;
      flex: 1;
      min-width: 80px;
    }

    .lr-share-btn:hover {
      opacity: 0.88;
      transform: scale(1.02);
    }

    .lr-share-btn__icon {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: #fff;
    }

    .lr-share-btn__icon mat-icon {
      width: 16px;
      height: 16px;
    }

    .lr-share-btn--tg {
      background: #2AABEE;
      color: #fff;
    }

    .lr-share-btn--max {
      background: #0057FF;
      color: #fff;
    }

    .lr-share-btn--vk {
      background: #0077FF;
      color: #fff;
    }

    .lr-share-btn--more {
      background: #f7f8fa;
      color: var(--ed-on-surface-variant, #a0a0a0);
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      flex: 0;
      min-width: 40px;
      padding: 8px;
    }

    .lr-share-btn--more mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* ═══════════════════════════════════
       BONUS CONVERSION
    ═══════════════════════════════════ */
    .lr-conversion__text {
      font-size: 14px;
      margin: 0 0 14px;
      line-height: 1.5;
    }

    .lr-conversion__text strong {
      color: var(--ed-accent, #f59e0b);
    }

    .lr-conversion__empty {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0;
    }

    .lr-conversion__use {
      text-decoration: none;
      display: inline-flex;
    }

    /* ═══════════════════════════════════
       TRANSACTIONS, Timeline style
    ═══════════════════════════════════ */
    .lr-transactions {
      background: var(--surface-container, #ffffff);
      border: 1px solid var(--ed-outline-variant, #dfe3e8);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08);
    }

    .lr-transactions__toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      background: none;
      border: none;
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      padding: 4px 0;
      font-family: inherit;
      transition: color 200ms;
    }

    .lr-transactions__toggle:hover {
      color: var(--ed-on-surface, #20242a);
    }

    .lr-transactions__chevron {
      font-size: 10px;
      transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .lr-transactions__chevron--open {
      transform: rotate(180deg);
    }

    .lr-transactions__empty {
      text-align: center;
      font-size: 13px;
      color: var(--ed-on-surface-variant, #999);
      padding: 16px 0 4px;
      margin: 0;
    }

    .lr-transactions__list {
      margin-top: 12px;
      position: relative;
      padding-left: 20px;
    }

    /* Timeline vertical line */
    .lr-transactions__list::before {
      content: '';
      position: absolute;
      left: 3px;
      top: 8px;
      bottom: 8px;
      width: 1px;
      background: var(--ed-outline-variant, #dfe3e8);
    }

    .lr-tx {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      position: relative;
      animation: m3eTxFadeIn 350ms ease-out both;
    }

    /* Timeline dot */
    .lr-tx::before {
      content: '';
      position: absolute;
      left: -20px;
      top: 50%;
      transform: translateY(-50%);
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ed-on-surface-variant, #666);
      z-index: 1;
    }

    .lr-tx:has(.lr-tx__amount--pos)::before {
      background: #4ade80;
      box-shadow: 0 0 6px rgba(74,222,128,0.3);
    }

    .lr-tx:has(.lr-tx__amount--neg)::before {
      background: #f87171;
      box-shadow: 0 0 6px rgba(248,113,113,0.3);
    }

    /* Staggered fade-in for timeline items */
    .lr-tx:nth-child(1)  { animation-delay: 0ms; }
    .lr-tx:nth-child(2)  { animation-delay: 50ms; }
    .lr-tx:nth-child(3)  { animation-delay: 100ms; }
    .lr-tx:nth-child(4)  { animation-delay: 150ms; }
    .lr-tx:nth-child(5)  { animation-delay: 200ms; }
    .lr-tx:nth-child(6)  { animation-delay: 250ms; }
    .lr-tx:nth-child(7)  { animation-delay: 300ms; }
    .lr-tx:nth-child(8)  { animation-delay: 350ms; }
    .lr-tx:nth-child(9)  { animation-delay: 400ms; }
    .lr-tx:nth-child(10) { animation-delay: 450ms; }
    .lr-tx:nth-child(n+11) { animation-delay: 500ms; }

    @keyframes m3eTxFadeIn {
      from { opacity: 0; transform: translateX(-8px); }
      to   { opacity: 1; transform: translateX(0); }
    }

    .lr-tx__info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .lr-tx__desc {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .lr-tx__date {
      font-size: 11px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .lr-tx__amount {
      font-size: 14px;
      font-weight: 700;
      flex-shrink: 0;
      margin-left: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .lr-tx__amount--pos {
      color: #4ade80;
    }

    .lr-tx__amount--neg {
      color: #f87171;
    }

    /* ═══════════════════════════════════
       CONFETTI, НЕ ТРОГАТЬ
    ═══════════════════════════════════ */
    .confetti-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 9999;
      overflow: hidden;
    }

    @keyframes cp-fall {
      0%   { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
      80%  { opacity: 1; }
      100% { transform: translateY(110vh) rotate(720deg) scale(0.5); opacity: 0; }
    }

    @keyframes cp-sway {
      0%, 100% { margin-left: 0; }
      25%       { margin-left: 30px; }
      75%       { margin-left: -30px; }
    }

    .cp {
      position: absolute;
      top: -20px;
      border-radius: 2px;
    }

    .cp-1  { width: 10px; height: 10px; left: 8%;   background: #f59e0b; animation: cp-fall 2.0s ease-in 0.0s forwards, cp-sway 0.9s ease-in-out 0s infinite; }
    .cp-2  { width: 8px;  height: 14px; left: 16%;  background: #fbbf24; animation: cp-fall 2.2s ease-in 0.1s forwards, cp-sway 1.1s ease-in-out 0.1s infinite; }
    .cp-3  { width: 12px; height: 8px;  left: 24%;  background: #ef4444; animation: cp-fall 1.8s ease-in 0.05s forwards, cp-sway 0.8s ease-in-out 0.05s infinite; }
    .cp-4  { width: 8px;  height: 8px;  left: 33%;  background: #22c55e; animation: cp-fall 2.3s ease-in 0.2s forwards, cp-sway 1.0s ease-in-out 0.2s infinite; }
    .cp-5  { width: 10px; height: 12px; left: 42%;  background: #3b82f6; animation: cp-fall 1.9s ease-in 0.15s forwards, cp-sway 0.9s ease-in-out 0.15s infinite; }
    .cp-6  { width: 6px;  height: 6px;  left: 51%;  background: #a855f7; animation: cp-fall 2.1s ease-in 0.3s forwards, cp-sway 1.2s ease-in-out 0.3s infinite; }
    .cp-7  { width: 14px; height: 8px;  left: 60%;  background: #f59e0b; animation: cp-fall 2.0s ease-in 0.08s forwards, cp-sway 0.8s ease-in-out 0.08s infinite; }
    .cp-8  { width: 8px;  height: 10px; left: 68%;  background: #ec4899; animation: cp-fall 2.4s ease-in 0.25s forwards, cp-sway 1.1s ease-in-out 0.25s infinite; }
    .cp-9  { width: 10px; height: 10px; left: 77%;  background: #fbbf24; animation: cp-fall 1.7s ease-in 0.12s forwards, cp-sway 0.9s ease-in-out 0.12s infinite; }
    .cp-10 { width: 8px;  height: 16px; left: 85%;  background: #34d399; animation: cp-fall 2.2s ease-in 0.18s forwards, cp-sway 1.0s ease-in-out 0.18s infinite; }
    .cp-11 { width: 12px; height: 6px;  left: 20%;  background: #60a5fa; animation: cp-fall 2.6s ease-in 0.35s forwards, cp-sway 1.3s ease-in-out 0.35s infinite; }
    .cp-12 { width: 6px;  height: 12px; left: 72%;  background: #f97316; animation: cp-fall 1.9s ease-in 0.22s forwards, cp-sway 0.7s ease-in-out 0.22s infinite; }

    /* ═══════════════════════════════════
       STAGGERED LOAD, M3 Expressive
    ═══════════════════════════════════ */
    @keyframes m3eFadeUp {
      from { opacity: 0; transform: translateY(20px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .lr-hero         { animation: m3eFadeUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0ms both; }
    .lr-streak       { animation: m3eFadeUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 80ms both; }
    .lr-roadmap      { animation: m3eFadeUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 160ms both; }
    .lr-achievements { animation: m3eFadeUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 240ms both; }
    .lr-referral     { animation: m3eFadeUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 320ms both; }
    .lr-conversion   { animation: m3eFadeUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 400ms both; }
    .lr-transactions { animation: m3eFadeUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 480ms both; }

    /* ═══════════════════════════════════
       RESPONSIVE
    ═══════════════════════════════════ */
    @media (max-width: 520px) {
      .lr-page {
        padding: 18px 12px 104px;
      }

      .lr-achievements__grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .lr-hero__top {
        flex-wrap: wrap;
      }

      .lr-hero__points {
        margin-left: auto;
      }

      .lr-referral__code {
        font-size: 16px;
        letter-spacing: 3px;
      }

      .lr-referral__share-buttons {
        flex-direction: column;
      }

      .lr-share-btn--more {
        flex: 1;
      }

      .lr-roadmap__node {
        min-width: 60px;
      }

      .lr-roadmap__circle {
        width: 40px;
        height: 40px;
      }

      .lr-roadmap__icon {
        width: 20px;
        height: 20px;
        font-size: 20px;
      }

      ::ng-deep .lr-roadmap__icon svg {
        width: 20px;
        height: 20px;
      }

      .lr-roadmap__line {
        margin-top: 19px;
        min-width: 16px;
      }
    }
  `,
})
export class LoyaltyRedesignComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly referralTracking = inject(ReferralTrackingService);
  private applyingStoredReferral = false;

  /** Expose LEVELS for template iteration */
  protected readonly allLevels: readonly LevelInfo[] = LEVELS;

  /** Used for Infinity comparison in template */
  protected readonly maxInfinity = Infinity;

  // ── State signals ──
  protected readonly profile = signal<LoyaltyProfile | null>(null);
  protected readonly achievements = signal<Achievement[]>([]);
  protected readonly transactions = signal<LoyaltyTransaction[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly dailyClaimed = signal(false);
  protected readonly claimingDaily = signal(false);
  protected readonly showTransactions = signal(true);
  protected readonly showConfetti = signal(false);

  // ── Animated counters ──
  protected readonly displayedPoints = signal(0);
  protected readonly displayedXp = signal(0);

  // ── Computed values ──

  protected readonly levelInfo = computed<LevelInfo>(() => {
    const p = this.profile();
    return getLevelInfo(p?.level ?? 1);
  });

  protected readonly levelProgress = computed(() => {
    const p = this.profile();
    if (!p) return 0;
    return getLevelProgress(p.totalPointsEarned, p.level);
  });

  protected readonly xpRemaining = computed(() => {
    const p = this.profile();
    if (!p) return 0;
    const nextXp = getNextLevelXp(p.level);
    return Math.max(0, nextXp - p.totalPointsEarned);
  });

  protected readonly pointsAsRubles = computed(() => {
    const p = this.profile();
    if (!p) return 0;
    const rate = p.conversionRate ?? 1;
    return p.pointsAsRubles ?? Math.floor(p.points * rate);
  });

  protected readonly achievementBadges = computed<AchievementBadge[]>(() => {
    return buildAchievementBadges(this.achievements());
  });

  /** 7-day streak calendar: last 6 days + today */
  protected readonly streakDays = computed(() => {
    const p = this.profile();
    const streak = p?.currentStreak ?? 0;
    const dayLabels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const today = new Date();
    const days: { label: string; checked: boolean; isToday: boolean }[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const isToday = i === 0;
      // Days from (today - streak + 1) to today are checked
      // But the daily claim for today is only checked if dailyClaimed
      const dayOffset = i;
      let checked = false;
      if (isToday) {
        checked = this.dailyClaimed();
      } else {
        // past day is checked if it's within the current streak
        // streak=3 means today + 2 previous days
        const dailyClaimedToday = this.dailyClaimed();
        const effectiveStreak = dailyClaimedToday ? streak : Math.max(0, streak);
        checked = dayOffset < effectiveStreak;
      }
      days.push({
        label: dayLabels[d.getDay()],
        checked,
        isToday,
      });
    }

    return days;
  });

  /** Days left until next 7-day streak bonus */
  protected readonly streakBonusDaysLeft = computed(() => {
    const p = this.profile();
    if (!p) return 7;
    const remainder = p.currentStreak % 7;
    return remainder === 0 && p.currentStreak > 0 ? 0 : 7 - remainder;
  });

  protected readonly linkCopied = signal(false);

  protected readonly canShare = computed(() => {
    if (!isPlatformBrowser(this.platformId)) return false;
    return typeof navigator !== 'undefined' && !!navigator.share;
  });

  protected readonly referralLink = computed(() => {
    const code = this.profile()?.referralCode;
    if (!code) return '';
    return `https://svoefoto.ru/priglasi-druga?loyaltyRef=${encodeURIComponent(code)}`;
  });

  private readonly referralShareText = computed(() => {
    return `Рекомендую "Своё Фото": активируйте подписку по моей ссылке, а мне начислят бонусы. ${this.referralLink()}`;
  });

  protected readonly shareTelegramUrl = computed(() => {
    return `https://t.me/share/url?url=${encodeURIComponent(this.referralLink())}&text=${encodeURIComponent('Рекомендую "Своё Фото": активируйте подписку по моей ссылке.')}`;
  });

  protected readonly shareMaxUrl = computed(() => {
    return `https://max.ru/id262603741214_bot?text=${encodeURIComponent(this.referralShareText())}`;
  });

  protected readonly shareVkUrl = computed(() => {
    return `https://vk.com/share.php?url=${encodeURIComponent(this.referralLink())}&title=${encodeURIComponent('Своё Фото, бонусы за приглашение')}`;
  });

  // ── Lifecycle ──

  ngOnInit(): void {
    this.loadProfile();
  }

  // ── Data loading ──

  loadProfile(): void {
    this.loading.set(true);
    this.error.set('');

    this.http
      .get<{
        success: boolean;
        data?: { profile: LoyaltyProfile; achievements: Achievement[] };
        error?: string;
      }>('/api/loyalty/profile')
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.profile.set(res.data.profile);
            this.achievements.set(res.data.achievements);
            this.dailyClaimed.set(!canClaimDaily(res.data.profile.lastDailyClaim));
            this.loadTransactions();
            this.applyStoredLoyaltyReferral(res.data.profile.referralCode);
            // Animate bonus counters
            this.animateCounter(v => this.displayedPoints.set(v), res.data.profile.points, 800);
            this.animateCounter(v => this.displayedXp.set(v), res.data.profile.totalPointsEarned, 900);
          } else {
            this.error.set(res.error || 'Не удалось загрузить профиль');
          }
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Ошибка загрузки');
          this.loading.set(false);
        },
      });
  }

  private animateCounter(setter: (v: number) => void, target: number, duration: number): void {
    if (!isPlatformBrowser(this.platformId) || target === 0) {
      setter(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setter(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private loadTransactions(): void {
    this.http
      .get<{
        success: boolean;
        data?: { transactions: LoyaltyTransaction[] };
      }>('/api/loyalty/transactions?limit=20')
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.transactions.set(res.data.transactions);
          }
        },
      });
  }

  private applyStoredLoyaltyReferral(ownReferralCode: string | null): void {
    if (this.applyingStoredReferral) return;

    const storedCode = this.referralTracking.getLoyaltyReferralCode();
    if (!storedCode) return;

    if (ownReferralCode && storedCode.toUpperCase() === ownReferralCode.toUpperCase()) {
      this.clearStoredLoyaltyReferral(storedCode);
      return;
    }

    this.applyingStoredReferral = true;
    this.http
      .post<ApplyReferralResponse>('/api/loyalty/referral/apply', { code: storedCode })
      .subscribe({
        next: (res) => {
          this.applyingStoredReferral = false;
          if (res.success) {
            this.clearStoredLoyaltyReferral(storedCode);
            this.snackBar.open('Реферальная ссылка применена', '', { duration: 3000 });
            this.loadProfile();
            return;
          }

          if (
            res.error === 'invalid_code'
            || res.error === 'self_referral'
            || res.error === 'already_referred'
          ) {
            this.referralTracking.clearLoyaltyReferralCode();
          }
        },
        error: () => {
          this.applyingStoredReferral = false;
        },
      });
  }

  private clearStoredLoyaltyReferral(code: string): void {
    this.referralTracking.clearLoyaltyReferralCode();
    if (this.referralTracking.getPartnerCode() === code) {
      this.referralTracking.clear();
    }
  }

  // ── Actions ──

  claimDaily(): void {
    this.claimingDaily.set(true);
    this.http
      .post<{
        success: boolean;
        data?: { points: number; streak: number; bonusPoints: number };
      }>('/api/loyalty/daily-claim', {})
      .subscribe({
        next: (res) => {
          this.claimingDaily.set(false);
          if (res.success && res.data) {
            this.dailyClaimed.set(true);
            // 🎉 Confetti!
            if (isPlatformBrowser(this.platformId)) {
              this.showConfetti.set(true);
              setTimeout(() => this.showConfetti.set(false), 3200);
            }
            const bonus =
              res.data.bonusPoints > 0 ? ` + ${res.data.bonusPoints} бонусов` : '';
            this.snackBar.open(
              `+${res.data.points} бонусов${bonus}! Серия: ${res.data.streak} дней`,
              '',
              { duration: 3000 },
            );
            this.loadProfile();
          } else {
            this.snackBar.open('Бонус уже получен сегодня', '', { duration: 2000 });
            this.dailyClaimed.set(true);
          }
        },
        error: () => {
          this.claimingDaily.set(false);
          this.snackBar.open('Ошибка', '', { duration: 2000 });
        },
      });
  }

  copyReferralLink(): void {
    const link = this.referralLink();
    if (!link || !isPlatformBrowser(this.platformId)) return;
    navigator.clipboard.writeText(link).then(() => {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
      this.snackBar.open('Ссылка скопирована!', '', { duration: 2000 });
    });
  }

  copyReferralCode(): void {
    const code = this.profile()?.referralCode;
    if (!code || !isPlatformBrowser(this.platformId)) return;
    navigator.clipboard.writeText(code).then(() => {
      this.snackBar.open('Код скопирован!', '', { duration: 2000 });
    });
  }

  shareReferral(): void {
    const link = this.referralLink();
    if (!link || !isPlatformBrowser(this.platformId)) return;
    navigator
      .share({
        title: 'Своё Фото, Бонусная программа',
        text: 'Рекомендую "Своё Фото": активируйте подписку по моей ссылке.',
        url: link,
      })
      .catch(() => {
        /* user cancelled share dialog */
      });
  }

  toggleTransactions(): void {
    this.showTransactions.update((v) => !v);
  }

  /** Pluralize Russian "день" */
  dayWord(n: number): string {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return 'дней';
    if (last === 1) return 'день';
    if (last >= 2 && last <= 4) return 'дня';
    return 'дней';
  }
}
