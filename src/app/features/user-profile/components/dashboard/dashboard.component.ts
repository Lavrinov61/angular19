import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DatePipe, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { AuthService } from '../../../../core/services/auth.service';
import { SubscriptionService } from '../../../../core/services/subscription.service';
import { ProfileDashboardService } from '../../../../core/services/profile-dashboard.service';
import { PhotoApiService } from '../../../../core/services/photo-api.service';
import {
  StudentVerificationService,
  StudentVerificationStatusPayload,
} from '../../../../core/services/student-verification.service';
import { AchievementBadge } from '../../../../shared/interfaces/loyalty.interfaces';
import { buildAchievementBadges } from '../../../../shared/utils/loyalty.utils';
import { OrderType, OrderStatus } from '../../../../core/models/order-history.model';

type DashboardStudentStatusKind = 'verified' | 'pending' | 'rejected' | 'revoked' | 'expired' | 'none';

@Component({
  selector: 'app-user-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CurrencyPipe,
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <!-- Loading State -->
    @if (dashboardService.loading()) {
      <div class="dashboard-loading">
        <mat-spinner diameter="48" />
        <p>Загружаем ваш кабинет...</p>
      </div>
    } @else {
      <div class="dashboard">

        <!-- ===== HERO BANNER ===== -->
        <section class="hero-banner">
          <div class="hero-content">
            <div class="hero-left">
              <h1 class="hero-title">
                @if (loyaltySummary(); as ls) {
                  <mat-icon class="hero-level-icon" [svgIcon]="ls.levelIcon" />
                }
                {{ greetingText() }}, {{ displayName() }}!
              </h1>
              <p class="hero-subtitle">
                @if (loyaltySummary(); as ls) {
                  Уровень {{ ls.level }} &mdash; {{ ls.levelName }}
                  @if (ls.currentStreak > 0) {
                    <span class="streak-badge">
                      <mat-icon class="streak-icon">local_fire_department</mat-icon>
                      {{ ls.currentStreak }} {{ streakDaysLabel(ls.currentStreak) }} подряд
                    </span>
                  }
                } @else {
                  Добро пожаловать в личный кабинет фотостудии
                }
              </p>

              <!-- Bonus Progress Bar -->
              @if (loyaltySummary(); as ls) {
                <div class="xp-bar-container">
                  <div class="xp-bar-label">
                    <span>{{ ls.currentXp }} бонусов</span>
                    @if (ls.level < 5) {
                      <span>{{ ls.nextLevelXp }} бонусов</span>
                    } @else {
                      <span>MAX</span>
                    }
                  </div>
                  <mat-progress-bar
                    mode="determinate"
                    [value]="ls.xpProgress"
                    class="xp-progress-bar"
                  />
                </div>
              }
            </div>

            <div class="hero-right">
              @if (loyaltySummary(); as ls) {
                <button
                  mat-raised-button
                  class="daily-reward-btn"
                  [class.pulse]="ls.canClaimDaily && !dailyClaimed()"
                  [disabled]="claimingDaily() || dailyClaimed() || !ls.canClaimDaily"
                  (click)="claimDaily()"
                >
                  <ng-container>
                    @if (claimingDaily()) {
                      <mat-spinner diameter="20" />
                    } @else {
                      <mat-icon>{{ dailyClaimed() || !ls.canClaimDaily ? 'check_circle' : 'redeem' }}</mat-icon>
                      {{ dailyClaimed() || !ls.canClaimDaily ? 'Получено' : 'Ежедневная награда' }}
                    }
                  </ng-container>
                </button>
                <div class="points-display">
                  <span class="points-value">{{ ls.points }}</span>
                  <span class="points-label">бонусов</span>
                </div>
              }
            </div>
          </div>
        </section>

        <!-- ===== PHOTOS PREVIEW ===== -->
        <section class="photos-preview">
          <div class="section-header">
            <h2><mat-icon>photo_library</mat-icon> Мои фотографии</h2>
            <a routerLink="/user-profile/my-photos" class="see-all-link">Смотреть все <mat-icon>arrow_forward</mat-icon></a>
          </div>

          @if (hasPhotos()) {
            <div class="photos-strip">
              @for (session of recentSessions(); track session.id) {
                <a class="photo-session-card" routerLink="/user-profile/my-photos">
                  <div class="photo-session-thumb">
                    @if (session.thumbnailUrl) {
                      <img [src]="session.thumbnailUrl" [alt]="session.title" loading="lazy">
                    } @else {
                      <mat-icon class="photo-placeholder-icon">camera_alt</mat-icon>
                    }
                    <span class="photo-count-badge">
                      <mat-icon>photo</mat-icon>
                      {{ session.photoCount }}
                    </span>
                    @if (session.status === 'processing') {
                      <span class="photo-status-badge processing">Обработка</span>
                    } @else if (session.status === 'ready') {
                      <span class="photo-status-badge ready">Готовы!</span>
                    }
                  </div>
                  <span class="photo-session-title">{{ session.title || 'Фотосессия' }}</span>
                  <span class="photo-session-date">{{ formatSessionDate(session.date) }}</span>
                </a>
              }
            </div>
          } @else {
            <div class="photos-empty-cta">
              <div class="photos-empty-visual">
                <mat-icon>add_a_photo</mat-icon>
              </div>
              <div class="photos-empty-text">
                <h3>Здесь появятся ваши фотографии</h3>
                <p>После фотосессии все снимки будут доступны для просмотра и скачивания</p>
              </div>
              <a mat-raised-button routerLink="/booking" class="photos-empty-btn">Записаться</a>
            </div>
          }
        </section>

        <!-- ===== SUBSCRIPTION HERO ===== -->
        <section class="subscription-hero">
          @if (subscriptionService.hasActiveSubscription()) {
            @if (subscriptionService.currentSubscription(); as sub) {
              <div class="sub-hero-active">
                <div class="sub-hero-active-left">
                    <mat-icon class="sub-hero-plan-icon">workspace_premium</mat-icon>
                    <div class="sub-hero-active-info">
                      <div class="sub-hero-plan-name">{{ sub.plan_name }}</div>
                      @if (sub.subscriber_discount_percent > 0) {
                        <div class="sub-hero-discount">Скидка {{ sub.subscriber_discount_percent }}% на объёмную печать</div>
                      } @else {
                        <div class="sub-hero-discount">Скидки аккаунта активны по выбранному типу</div>
                      }
                    </div>
                  </div>
                @if (subscriptionService.credits().length > 0) {
                  <div class="sub-hero-credits">
                    @for (credit of subscriptionService.credits(); track credit.product_name) {
                      <div class="sub-hero-credit-item">
                        <div class="credit-label">
                          <span>{{ credit.product_name }}</span>
                          <span>{{ credit.remaining }}/{{ credit.total_credits }}</span>
                        </div>
                        <mat-progress-bar
                          mode="determinate"
                          [value]="creditPercent(credit)"
                          class="credit-bar"
                        />
                      </div>
                    }
                  </div>
                }
                <a mat-stroked-button routerLink="/user-profile/subscription" class="sub-hero-manage-btn">
                  Управление
                </a>
              </div>
            }
          } @else {
            <div class="sub-promo-card">
              <div class="sub-promo-left">
                <mat-icon class="sub-promo-icon">workspace_premium</mat-icon>
                <div class="sub-promo-text">
                  <h3>Пакеты печати, экономьте на объёме</h3>
                  <ul class="sub-promo-features">
                    <li><mat-icon>check_circle</mat-icon> Без фиксированных кредитов</li>
                    <li><mat-icon>check_circle</mat-icon> Скидка на фактический объём</li>
                    <li><mat-icon>check_circle</mat-icon> Отмена без штрафов</li>
                  </ul>
                </div>
              </div>
              <a mat-raised-button routerLink="/user-profile/subscription" class="sub-promo-btn">Выбрать пакет</a>
            </div>
          }
        </section>

        <!-- ===== EDUCATION ACCESS CTA ===== -->
        <section
          class="student-cta"
          [class.student-cta--active]="studentStatusKind() === 'verified'"
          [class.student-cta--pending]="studentStatusKind() === 'pending'"
          [class.student-cta--blocked]="
            studentStatusKind() === 'rejected' ||
            studentStatusKind() === 'revoked' ||
            studentStatusKind() === 'expired'
          "
        >
          <div class="student-cta__main">
            <div class="student-cta__icon">
              <mat-icon>{{ studentCtaIcon() }}</mat-icon>
            </div>
            <div class="student-cta__copy">
              <span class="student-cta__eyebrow">{{ studentCtaEyebrow() }}</span>
              <h3>Выгодно</h3>
              <div class="student-cta__status">
                <mat-icon>{{ studentCtaIcon() }}</mat-icon>
                @if (studentStatusKind() === 'verified') {
                  @if (studentExpiresAt(); as expiresAt) {
                    <span>Активен до {{ expiresAt | date: 'dd.MM.yyyy' }}</span>
                  } @else {
                    <span>Активен</span>
                  }
                } @else {
                  <span>{{ studentStatusLabel() }}</span>
                }
              </div>
              <p>
                {{ studentCtaDescription() }}
              </p>
            </div>
          </div>

          <div class="student-cta__benefits" aria-label="Условия аккаунтов и образовательные скидки">
            @if (activeStudentDiscount()) {
              @if (isVerifiedOnlyTier()) {
                <span><strong>50%</strong> документы А4</span>
                <span><strong>{{ studentSheetPrice() }} ₽</strong> ч/б А4 10→5</span>
                <span><strong>14 ₽</strong> фото 10x15 20→14</span>
              } @else {
                <span><strong>70%</strong> документы А4</span>
                <span><strong>{{ studentSheetPrice() }} ₽</strong> ч/б А4 10→3</span>
                <span><strong>10 ₽</strong> фото 10x15 20→10</span>
              }
            } @else {
              <span><strong>199 ₽</strong> в месяц</span>
              <span><strong>3 ₽</strong> ч/б А4 10→3</span>
              <span><strong>10 ₽</strong> фото 10x15 20→10</span>
            }
          </div>

          <a mat-raised-button routerLink="/user-profile/education" class="student-cta__button">
            <span>{{ studentCtaButtonLabel() }}</span>
            <mat-icon>arrow_forward</mat-icon>
          </a>
        </section>

        <!-- ===== QUICK STATS ===== -->
        <section class="quick-stats">
          <div class="stat-card">
            <div class="stat-icon-wrap">
              <mat-icon>local_offer</mat-icon>
            </div>
            <div class="stat-body">
              <span class="stat-title">Скидки аккаунта</span>
              @if (subscriptionService.currentSubscription(); as sub) {
                @if (sub.subscriber_discount_percent > 0) {
                  <span class="stat-value">{{ sub.subscriber_discount_percent }}%</span>
                  <span class="stat-meta">по пакету</span>
                } @else {
                  <span class="stat-value">активны</span>
                  <span class="stat-meta">по типу аккаунта</span>
                }
              } @else {
                <span class="stat-value">до 70%</span>
                <span class="stat-meta">после подключения доступа</span>
              }
            </div>
          </div>

          <!-- Total Orders -->
          <div class="stat-card">
            <div class="stat-icon-wrap">
              <mat-icon>receipt_long</mat-icon>
            </div>
            <div class="stat-body">
              <span class="stat-title">Заказов</span>
              <span class="stat-value">{{ totalOrders() }}</span>
              <span class="stat-meta">всего оформлено</span>
            </div>
          </div>

          <!-- Savings -->
          <div class="stat-card">
            <div class="stat-icon-wrap">
              <mat-icon>savings</mat-icon>
            </div>
            <div class="stat-body">
              <span class="stat-title">Экономия</span>
              <span class="stat-value">{{ totalSpent() | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
              <span class="stat-meta">потрачено всего</span>
            </div>
          </div>
        </section>

        <!-- ===== TWO-COLUMN SECTION ===== -->
        <section class="two-column">
          <div class="col-left">
            <!-- Recent Orders (from photo_print_orders) -->
            <div class="section-block">
              <div class="section-header">
                <h2>
                  <mat-icon>shopping_bag</mat-icon>
                  Последние заказы
                </h2>
                <a routerLink="/orders" class="see-all-link">
                  Все заказы
                  <mat-icon>arrow_forward</mat-icon>
                </a>
              </div>
              @if (recentOrders().length > 0) {
                <div class="orders-list">
                  @for (order of recentOrders(); track order.id) {
                    <mat-card class="order-card" appearance="outlined">
                      <div class="order-card-body">
                        <div class="order-icon-block">
                          <mat-icon>{{ getOrderTypeIcon(order.orderType) }}</mat-icon>
                        </div>
                        <div class="order-info">
                          <span class="order-type">{{ getOrderTypeLabel(order.orderType) }}</span>
                          <span class="order-date">{{ order.createdAt | date:'d MMM yyyy, HH:mm' }}</span>
                        </div>
                        <div class="order-right">
                          <span class="order-price">{{ order.totalPrice | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                          <span class="order-status-badge" [class]="'status-' + order.status">{{ getOrderStatusLabel(order.status) }}</span>
                        </div>
                      </div>
                    </mat-card>
                  }
                </div>
              } @else {
                <div class="empty-state">
                  <mat-icon>receipt_long</mat-icon>
                  <p>Пока нет заказов</p>
                </div>
              }
            </div>
          </div>

          <div class="col-right">
            <!-- Achievements -->
            <div class="section-block">
              <div class="section-header">
                <h2>
                  <mat-icon>emoji_events</mat-icon>
                  Достижения
                </h2>
              </div>
              <div class="achievements-grid">
                @for (badge of achievementBadges(); track badge.id) {
                  <div class="achievement-badge" [class.locked]="!badge.unlocked" [title]="badge.description">
                    <mat-icon class="achievement-icon" [svgIcon]="badge.icon" />
                    <span class="achievement-name">{{ badge.name }}</span>
                  </div>
                }
              </div>
            </div>
          </div>
        </section>

        <!-- ===== COMPACT BOOKINGS (conditional) ===== -->
        @if (upcomingBookings().length > 0) {
          <section class="compact-bookings">
            <div class="section-header">
              <h2><mat-icon>event</mat-icon> Ближайшие записи</h2>
              <a routerLink="/orders/bookings" class="see-all-link">Все записи <mat-icon>arrow_forward</mat-icon></a>
            </div>
            <div class="bookings-compact-list">
              @for (booking of upcomingBookings(); track booking.id) {
                <div class="booking-compact-row">
                  <div class="booking-compact-date">
                    <span class="booking-day">{{ formatBookingDay(booking) }}</span>
                    <span class="booking-month">{{ formatBookingMonth(booking) }}</span>
                  </div>
                  <span class="booking-compact-service">{{ booking.service?.name || 'Фотосессия' }}</span>
                  <span class="booking-compact-time">
                    <mat-icon class="inline-icon">schedule</mat-icon>
                    {{ booking.startTime }}
                    @if (booking.endTime) {
                      &ndash; {{ booking.endTime }}
                    }
                  </span>
                  <div class="booking-status" [class]="'status-' + booking.status">
                    {{ getBookingStatusLabel(booking.status) }}
                  </div>
                </div>
              }
            </div>
          </section>
        }

        <!-- ===== SAVINGS MOTIVATOR (deferred until in viewport) ===== -->
        @defer (on viewport) {
        @if (!subscriptionService.hasActiveSubscription() && totalSpent() > 0) {
          <section class="savings-motivator reveal">
            <div class="savings-content">
              <mat-icon class="savings-icon">trending_up</mat-icon>
              <div class="savings-text">
                <h3>Вы уже потратили {{ totalSpent() | currency:'RUB':'symbol-narrow':'1.0-0' }}</h3>
                <p>
                  С пакетом печати вы бы сэкономили
                  <strong>{{ savingsAmount() | currency:'RUB':'symbol-narrow':'1.0-0' }}</strong>
                  на этих заказах. Пакет окупается с первого заказа!
                </p>
              </div>
              <a mat-raised-button routerLink="/user-profile/subscription" class="savings-cta">
                Выбрать пакет
              </a>
            </div>
          </section>
        }
        } @placeholder {
          <div class="savings-placeholder"></div>
        }

      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      --amber: #f59e0b;
      --amber-dim: #92610a;
      --amber-glow: rgba(245, 158, 11, 0.15);
      --surface: var(--ed-surface, #121212);
      --surface-container: var(--ed-surface-container, #1a1a1a);
      --surface-variant: var(--ed-surface-variant, #1e1e1e);
      --on-surface: var(--ed-on-surface, #f5f5f5);
      --on-surface-variant: var(--ed-on-surface-variant, #999);
      --border: var(--ed-outline, #333);
    }

    /* ===== LOADING ===== */
    .dashboard-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      gap: 16px;
      color: var(--on-surface-variant);
    }

    /* ===== DASHBOARD ===== */
    .dashboard {
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding: 0 0 32px;
      max-width: 1200px;
      margin: 0 auto;
    }

    /* ===== HERO BANNER ===== */
    .hero-banner {
      background: linear-gradient(135deg, rgba(12, 11, 9, 0.85), rgba(26, 16, 0, 0.7));
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-radius: var(--m3e-corner-xl, 28px);
      padding: 28px 24px;
      border: 1px solid rgba(245, 158, 11, 0.15);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .hero-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }

    .hero-left {
      flex: 1;
      min-width: 0;
    }

    .hero-title {
      font-size: 1.875rem;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: var(--on-surface);
      margin: 0 0 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .hero-level-icon {
      width: 36px;
      height: 36px;
      font-size: 36px;
      flex-shrink: 0;
      filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.4));
    }

    ::ng-deep .hero-level-icon svg {
      width: 36px;
      height: 36px;
    }

    .hero-subtitle {
      font-size: 0.95rem;
      color: var(--on-surface-variant);
      margin: 0 0 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .streak-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(245, 158, 11, 0.15);
      color: var(--amber);
      padding: 2px 10px;
      border-radius: var(--m3e-corner-full, 9999px);
      font-size: 0.85rem;
      font-weight: 600;
    }

    .streak-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #ef4444;
    }

    .xp-bar-container {
      max-width: 400px;
    }

    .xp-bar-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--on-surface-variant);
      margin-bottom: 6px;
    }

    .xp-progress-bar {
      border-radius: 6px;
      height: 8px;
    }

    ::ng-deep .xp-progress-bar .mdc-linear-progress__bar-inner {
      border-color: var(--amber) !important;
    }

    ::ng-deep .xp-progress-bar .mdc-linear-progress__buffer-bar {
      background-color: rgba(245, 158, 11, 0.15) !important;
    }

    .hero-right {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .daily-reward-btn {
      background: var(--amber) !important;
      color: #000 !important;
      font-weight: 600;
      border-radius: var(--m3e-corner-md, 12px);
      padding: 8px 24px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.3s ease;
    }

    .daily-reward-btn:disabled {
      background: var(--amber-dim) !important;
      opacity: 0.6;
    }

    .daily-reward-btn.pulse {
      animation: pulse-amber 2s ease-in-out infinite;
    }

    @keyframes pulse-amber {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5); }
      50% { box-shadow: 0 0 20px 6px rgba(245, 158, 11, 0.3); }
    }

    .points-display {
      text-align: center;
    }

    .points-value {
      display: block;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--amber);
    }

    .points-label {
      font-size: 0.8rem;
      color: var(--on-surface-variant);
    }

    /* ===== QUICK STATS ===== */
    .quick-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .stat-card {
      background: var(--surface-container);
      border-radius: var(--m3e-corner-lg, 16px);
      padding: 20px;
      display: flex;
      align-items: flex-start;
      gap: 14px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
      transition: all 0.2s ease;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: var(--amber);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }

    .stat-card.active {
      border-color: rgba(245, 158, 11, 0.4);
    }

    .stat-icon-wrap {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* Semantic icon colors per stat card */
    .stat-card:nth-child(1) .stat-icon-wrap {
      background: rgba(59, 130, 246, 0.12);
    }
    .stat-card:nth-child(1) .stat-icon-wrap mat-icon {
      color: #3b82f6;
    }
    .stat-card:nth-child(2) .stat-icon-wrap {
      background: rgba(34, 197, 94, 0.12);
    }
    .stat-card:nth-child(2) .stat-icon-wrap mat-icon {
      color: #22c55e;
    }
    .stat-card:nth-child(3) .stat-icon-wrap {
      background: rgba(245, 158, 11, 0.12);
    }
    .stat-card:nth-child(3) .stat-icon-wrap mat-icon {
      color: #f59e0b;
    }

    .stat-icon-wrap mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .stat-body {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .stat-title {
      font-size: 0.8rem;
      color: var(--on-surface-variant);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stat-value {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .stat-meta {
      font-size: 0.75rem;
      color: var(--on-surface-variant);
      margin-top: 2px;
    }

    /* ===== TWO-COLUMN LAYOUT ===== */
    .two-column {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 20px;
    }

    .col-left, .col-right {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .section-block {
      background: var(--surface-container);
      border-radius: var(--m3e-corner-lg, 16px);
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .section-header h2 {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--on-surface);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-header h2 mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--amber);
    }

    .see-all-link {
      font-size: 0.85rem;
      color: var(--amber);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: transform 250ms var(--m3e-spring-fast, cubic-bezier(0.34, 1.56, 0.64, 1)), opacity 200ms ease;
    }

    .see-all-link:hover {
      opacity: 0.8;
      transform: translateX(2px);
    }

    .see-all-link mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    /* ===== BOOKING CARDS ===== */
    .bookings-list, .orders-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .booking-card, .order-card {
      background: var(--surface) !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
      border-radius: var(--m3e-corner-md, 12px) !important;
      transition: all 250ms var(--m3e-spring-fast, cubic-bezier(0.34, 1.56, 0.64, 1));
    }

    .booking-card:hover, .order-card:hover {
      transform: translateY(-2px);
      border-color: rgba(245, 158, 11, 0.3) !important;
      box-shadow: 0 4px 16px rgba(245, 158, 11, 0.1);
    }

    .booking-card-body {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 14px 16px;
    }

    .booking-date-block {
      width: 52px;
      height: 52px;
      border-radius: var(--m3e-corner-md, 12px);
      background: var(--amber-glow);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .booking-day {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--amber);
      line-height: 1.1;
    }

    .booking-month {
      font-size: 0.7rem;
      color: var(--on-surface-variant);
      text-transform: uppercase;
    }

    .booking-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      min-width: 0;
    }

    .booking-service {
      font-weight: 600;
      color: var(--on-surface);
      font-size: 0.95rem;
    }

    .booking-time, .booking-photographer {
      font-size: 0.82rem;
      color: var(--on-surface-variant);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .inline-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .booking-status, .order-status {
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: var(--m3e-corner-full, 9999px);
      white-space: nowrap;
      flex-shrink: 0;
      min-height: 28px;
      display: inline-flex;
      align-items: center;
    }

    .status-pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .status-confirmed { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .status-completed { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .status-cancelled, .status-refunded { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .status-processing, .status-in_progress { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
    .status-new { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .status-waiting { background: rgba(234, 179, 8, 0.15); color: #eab308; }
    .status-ready { background: rgba(34, 197, 94, 0.15); color: #22c55e; }

    /* ===== ORDER CARDS ===== */
    .order-card-body {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 16px;
    }

    .order-icon-block {
      width: 42px;
      height: 42px;
      border-radius: var(--m3e-corner-md, 12px);
      background: var(--amber-glow);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .order-icon-block mat-icon {
      color: var(--amber);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .order-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }

    .order-type {
      font-weight: 600;
      color: var(--on-surface);
      font-size: 0.9rem;
    }

    .order-date {
      font-size: 0.8rem;
      color: var(--on-surface-variant);
    }

    .order-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      flex-shrink: 0;
    }

    .xp-badge {
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--amber);
      background: var(--amber-glow);
      padding: 3px 10px;
      border-radius: var(--m3e-corner-full, 9999px);
      white-space: nowrap;
    }

    .order-price {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--amber);
      white-space: nowrap;
    }

    .order-status-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: var(--m3e-corner-full, 9999px);
      white-space: nowrap;
      min-height: 28px;
      display: inline-flex;
      align-items: center;
    }

    /* ===== EMPTY STATE ===== */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px;
      gap: 8px;
      color: var(--on-surface-variant);
    }

    .empty-state mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      opacity: 0.4;
    }

    .empty-state p {
      margin: 0;
      font-size: 0.9rem;
    }

    .empty-action-btn {
      margin-top: 8px;
      border-color: var(--amber) !important;
      color: var(--amber) !important;
    }

    /* ===== CREDIT BAR (shared) ===== */
    .credit-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--on-surface-variant);
      margin-bottom: 4px;
    }

    .credit-bar {
      border-radius: 4px;
    }

    ::ng-deep .credit-bar .mdc-linear-progress__bar-inner {
      border-color: #22c55e !important;
    }

    ::ng-deep .credit-bar .mdc-linear-progress__buffer-bar {
      background-color: rgba(34, 197, 94, 0.1) !important;
    }

    /* ===== ACHIEVEMENTS ===== */
    .achievements-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .achievement-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 14px 8px;
      border-radius: var(--m3e-corner-lg, 16px);
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: all 200ms var(--m3e-spring-fast, cubic-bezier(0.34, 1.56, 0.64, 1));
    }

    .achievement-badge:hover {
      transform: scale(1.05);
      border-color: var(--amber);
    }

    .achievement-badge.locked {
      opacity: 0.35;
      filter: grayscale(100%) blur(1px);
    }

    .achievement-icon {
      width: 40px;
      height: 40px;
      font-size: 40px;
    }

    ::ng-deep .achievement-icon svg {
      width: 40px;
      height: 40px;
    }

    .achievement-name {
      font-size: 0.75rem;
      color: var(--on-surface-variant);
      text-align: center;
      line-height: 1.2;
    }

    /* ===== SAVINGS MOTIVATOR ===== */
    .savings-motivator {
      background: linear-gradient(135deg, rgba(12, 11, 9, 0.85), rgba(26, 16, 0, 0.7));
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-radius: var(--m3e-corner-xl, 28px);
      padding: 24px 32px;
      border: 1px solid rgba(245, 158, 11, 0.15);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .savings-content {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .savings-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: var(--amber);
      flex-shrink: 0;
    }

    .savings-text {
      flex: 1;
      min-width: 0;
    }

    .savings-text h3 {
      margin: 0 0 4px;
      font-size: 1rem;
      color: var(--on-surface);
    }

    .savings-text p {
      margin: 0;
      font-size: 0.9rem;
      color: var(--on-surface-variant);
    }

    .savings-text strong {
      color: var(--amber);
    }

    .savings-cta {
      background: var(--amber) !important;
      color: #000 !important;
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ===== STAGGERED LOAD ANIMATION (M3E) ===== */
    @keyframes m3eFadeUp {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .hero-banner        { animation: m3eFadeUp 0.5s ease-out 0.05s both; }
    .photos-preview     { animation: m3eFadeUp 0.5s ease-out 0.10s both; }
    .subscription-hero  { animation: m3eFadeUp 0.5s ease-out 0.16s both; }
    .student-cta        { animation: m3eFadeUp 0.5s ease-out 0.20s both; }
    .quick-stats        { animation: m3eFadeUp 0.5s ease-out 0.24s both; }
    .two-column         { animation: m3eFadeUp 0.5s ease-out 0.30s both; }
    .compact-bookings   { animation: m3eFadeUp 0.5s ease-out 0.36s both; }
    .savings-motivator  { animation: m3eFadeUp 0.5s ease-out 0.42s both; }

    /* Stagger stat cards */
    .stat-card:nth-child(1) { animation: m3eFadeUp 0.4s ease-out 0.25s both; }
    .stat-card:nth-child(2) { animation: m3eFadeUp 0.4s ease-out 0.30s both; }
    .stat-card:nth-child(3) { animation: m3eFadeUp 0.4s ease-out 0.35s both; }

    /* Section blocks stagger */
    .section-block { animation: m3eFadeUp 0.4s ease-out both; }
    .col-left .section-block:nth-child(1)  { animation-delay: 0.30s; }
    .col-right .section-block:nth-child(1) { animation-delay: 0.34s; }

    .savings-placeholder { height: 0; }

    /* ===== PHOTOS PREVIEW ===== */
    .photos-preview {
      background: var(--surface-container);
      border-radius: var(--m3e-corner-lg, 16px);
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    .photos-empty-cta {
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 16px 0;
    }

    .photos-empty-visual {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--amber-glow);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .photos-empty-visual mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--amber);
    }

    .photos-empty-text h3 {
      margin: 0;
      font-size: 0.95rem;
      color: var(--on-surface);
    }

    .photos-empty-text p {
      margin: 4px 0 0;
      font-size: 0.85rem;
      color: var(--on-surface-variant);
    }

    .photos-empty-btn {
      background: var(--amber) !important;
      color: #000 !important;
      font-weight: 600;
      flex-shrink: 0;
      margin-left: auto;
    }

    .photos-strip {
      display: flex;
      gap: 16px;
      overflow-x: auto;
      padding-bottom: 8px;
      scrollbar-width: thin;
    }

    .photo-session-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 160px;
      max-width: 180px;
      text-decoration: none;
      color: inherit;
      flex-shrink: 0;
      transition: transform 0.2s ease;
    }
    .photo-session-card:hover { transform: translateY(-4px); }

    .photo-session-thumb {
      position: relative;
      width: 100%;
      aspect-ratio: 4/3;
      border-radius: 12px;
      overflow: hidden;
      background: var(--surface, #111);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .photo-session-thumb img { width: 100%; height: 100%; object-fit: cover; }

    .photo-placeholder-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: var(--on-surface-variant, #a0a0a0);
    }

    .photo-count-badge {
      position: absolute;
      bottom: 6px;
      right: 6px;
      display: flex;
      align-items: center;
      gap: 3px;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 100px;
    }
    .photo-count-badge mat-icon { font-size: 12px; width: 12px; height: 12px; }

    .photo-status-badge {
      position: absolute;
      top: 6px;
      left: 6px;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 100px;
      text-transform: uppercase;
    }
    .photo-status-badge.processing { background: rgba(245,158,11,0.9); color: #000; }
    .photo-status-badge.ready { background: rgba(34,197,94,0.9); color: #000; }

    .photo-session-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--on-surface, #f5f5f5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .photo-session-date {
      font-size: 11px;
      color: var(--on-surface-variant, #a0a0a0);
    }

    /* ===== SUBSCRIPTION HERO ===== */
    .sub-promo-card {
      display: flex;
      align-items: center;
      gap: 24px;
      background: linear-gradient(135deg, rgba(20, 15, 5, 0.95), rgba(40, 25, 0, 0.85));
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: var(--m3e-corner-xl, 28px);
      padding: 28px 32px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    .sub-promo-left {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      flex: 1;
      min-width: 0;
    }

    .sub-promo-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: var(--amber);
      flex-shrink: 0;
      filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.4));
    }

    .sub-promo-text h3 {
      margin: 0 0 12px;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--on-surface);
    }

    .sub-promo-features {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .sub-promo-features li {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--on-surface-variant);
    }

    .sub-promo-features li mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #22c55e;
    }

    .sub-promo-btn {
      background: var(--amber) !important;
      color: #000 !important;
      font-weight: 700;
      padding: 12px 32px !important;
      flex-shrink: 0;
    }

    /* Subscription Hero, active state */
    .sub-hero-active {
      display: flex;
      align-items: center;
      gap: 24px;
      background: linear-gradient(135deg, rgba(12, 11, 9, 0.85), rgba(26, 16, 0, 0.7));
      border: 1px solid rgba(245, 158, 11, 0.3);
      border-radius: var(--m3e-corner-xl, 28px);
      padding: 24px 32px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    .sub-hero-active-left {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-shrink: 0;
    }

    .sub-hero-plan-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: var(--amber);
      filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.4));
    }

    .sub-hero-plan-name {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--amber);
    }

    .sub-hero-discount {
      font-size: 0.85rem;
      color: #22c55e;
    }

    .sub-hero-credits {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sub-hero-credit-item {
      min-width: 120px;
    }

    .sub-hero-manage-btn {
      border-color: var(--amber) !important;
      color: var(--amber) !important;
      flex-shrink: 0;
    }

    /* ===== STUDENT ACCOUNT CTA ===== */
    .student-cta {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 20px;
      padding: 22px 24px;
      border-radius: var(--m3e-corner-lg, 16px);
      background: linear-gradient(135deg, rgba(17, 24, 39, 0.92), rgba(22, 18, 10, 0.92));
      border: 1px solid rgba(245, 158, 11, 0.2);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    .student-cta--active {
      background: linear-gradient(135deg, rgba(7, 27, 22, 0.92), rgba(22, 18, 10, 0.92));
      border-color: rgba(34, 197, 94, 0.28);
    }

    .student-cta--pending {
      border-color: rgba(245, 158, 11, 0.32);
    }

    .student-cta--blocked {
      border-color: rgba(239, 68, 68, 0.28);
    }

    .student-cta__main {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
    }

    .student-cta__icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.22);
    }

    .student-cta--active .student-cta__icon {
      color: #22c55e;
      background: rgba(34, 197, 94, 0.12);
      border-color: rgba(34, 197, 94, 0.24);
    }

    .student-cta--pending .student-cta__icon {
      color: var(--amber);
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.24);
    }

    .student-cta--blocked .student-cta__icon {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.24);
    }

    .student-cta__icon mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .student-cta__copy {
      min-width: 0;
    }

    .student-cta__eyebrow {
      display: block;
      margin-bottom: 4px;
      color: var(--amber);
      font-size: 0.75rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .student-cta h3 {
      margin: 0;
      color: var(--on-surface);
      font-size: 1.05rem;
      font-weight: 800;
    }

    .student-cta__status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      margin-top: 8px;
      padding: 4px 10px;
      border-radius: var(--m3e-corner-full, 9999px);
      background: rgba(56, 189, 248, 0.1);
      color: #7dd3fc;
      font-size: 0.78rem;
      font-weight: 800;
    }

    .student-cta__status mat-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
    }

    .student-cta--active .student-cta__status {
      background: rgba(34, 197, 94, 0.12);
      color: #86efac;
    }

    .student-cta--pending .student-cta__status {
      background: rgba(245, 158, 11, 0.12);
      color: #fbbf24;
    }

    .student-cta--blocked .student-cta__status {
      background: rgba(239, 68, 68, 0.12);
      color: #fca5a5;
    }

    .student-cta p {
      margin: 6px 0 0;
      color: var(--on-surface-variant);
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .student-cta__benefits {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
      max-width: 380px;
    }

    .student-cta__benefits span {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      min-height: 34px;
      padding: 6px 10px;
      border-radius: var(--m3e-corner-full, 9999px);
      background: rgba(255, 255, 255, 0.06);
      color: var(--on-surface-variant);
      font-size: 0.78rem;
      white-space: nowrap;
    }

    .student-cta__benefits strong {
      color: var(--on-surface);
      font-size: 0.95rem;
      font-weight: 900;
    }

    .student-cta__button {
      background: var(--amber) !important;
      color: #000 !important;
      font-weight: 800;
      flex-shrink: 0;
    }

    /* ===== COMPACT BOOKINGS ===== */
    .compact-bookings {
      background: var(--surface-container);
      border-radius: var(--m3e-corner-lg, 16px);
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    .bookings-compact-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .booking-compact-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 14px;
      background: var(--surface);
      border-radius: var(--m3e-corner-md, 12px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: all 250ms ease;
    }

    .booking-compact-row:hover {
      border-color: rgba(245, 158, 11, 0.3);
    }

    .booking-compact-date {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 42px;
      flex-shrink: 0;
    }

    .booking-compact-service {
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--on-surface);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .booking-compact-time {
      font-size: 0.82rem;
      color: var(--on-surface-variant);
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    /* ===== RESPONSIVE ===== */
    @media (max-width: 1200px) {
      .two-column {
        grid-template-columns: 1fr;
      }

      .quick-stats {
        grid-template-columns: repeat(2, 1fr);
      }

      .photos-empty-cta {
        flex-direction: column;
        text-align: center;
      }

      .photos-empty-btn {
        margin-left: 0;
      }

      .sub-promo-card {
        flex-direction: column;
        text-align: center;
      }

      .sub-promo-left {
        flex-direction: column;
        align-items: center;
      }

      .sub-hero-active {
        flex-direction: column;
        text-align: center;
      }

      .sub-hero-active-left {
        flex-direction: column;
        align-items: center;
      }

      .student-cta {
        grid-template-columns: 1fr;
        align-items: stretch;
      }

      .student-cta__benefits {
        justify-content: flex-start;
        max-width: none;
      }

      .student-cta__button {
        justify-content: center;
      }
    }

    @media (max-width: 640px) {
      .hero-banner {
        padding: 20px;
        border-radius: var(--m3e-corner-lg, 16px);
      }

      .hero-content {
        flex-direction: column;
        align-items: flex-start;
      }

      .hero-title {
        font-size: 1.3rem;
      }

      .hero-right {
        flex-direction: row;
        flex-wrap: wrap;
        width: 100%;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }

      .quick-stats {
        grid-template-columns: 1fr 1fr;
      }

      .stat-card {
        padding: 14px;
      }

      .savings-content {
        flex-direction: column;
        text-align: center;
      }

      .achievements-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .booking-compact-row {
        flex-wrap: wrap;
      }

      .savings-motivator {
        border-radius: var(--m3e-corner-lg, 16px);
      }

      .student-cta {
        padding: 20px;
      }

      .student-cta__main {
        align-items: flex-start;
      }

      .student-cta__benefits {
        display: grid;
        grid-template-columns: 1fr;
      }

      .student-cta__benefits span {
        justify-content: space-between;
      }

      .section-block {
        padding: 20px;
      }

      .photos-preview,
      .compact-bookings {
        padding: 20px;
      }
    }
  `,
})
export class DashboardComponent implements OnInit {
  readonly dashboardService = inject(ProfileDashboardService);
  readonly subscriptionService = inject(SubscriptionService);
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly snackBar = inject(MatSnackBar);
  private readonly photoApiService = inject(PhotoApiService);
  private readonly studentVerificationService = inject(StudentVerificationService);

  readonly claimingDaily = signal(false);
  readonly dailyClaimed = signal(false);
  readonly studentStatus = signal<StudentVerificationStatusPayload | null>(null);

  // ---------- Computed ----------

  readonly displayName = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return 'Пользователь';
    return user.displayName || user.display_name || user.first_name || 'Пользователь';
  });

  readonly loyaltySummary = computed(() => this.dashboardService.loyaltySummary());

  readonly dashboardData = computed(() => this.dashboardService.dashboardData());

  readonly upcomingBookings = computed(() => {
    const data = this.dashboardData();
    return data?.upcomingBookings?.slice(0, 3) ?? [];
  });

  readonly recentOrders = computed(() => {
    const data = this.dashboardData();
    return data?.recentOrders?.slice(0, 3) ?? [];
  });

  readonly totalOrders = computed(() => {
    const profile = this.dashboardData()?.loyaltyProfile;
    return profile?.totalOrders ?? 0;
  });

  readonly totalSpent = computed(() => {
    const profile = this.dashboardData()?.loyaltyProfile;
    return profile?.totalSpent ?? 0;
  });

  readonly savingsAmount = computed(() => {
    return Math.round(this.totalSpent() * 0.15);
  });

  readonly achievementBadges = computed((): AchievementBadge[] => {
    const data = this.dashboardData();
    if (!data?.achievements) return [];
    return buildAchievementBadges(data.achievements);
  });

  readonly greetingText = computed(() => {
    if (!isPlatformBrowser(this.platformId)) return 'Добро пожаловать';
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Доброе утро';
    if (hour >= 12 && hour < 18) return 'Добрый день';
    if (hour >= 18 && hour < 23) return 'Добрый вечер';
    return 'Доброй ночи';
  });

  readonly recentSessions = computed(() =>
    this.photoApiService.photoSessions().slice(0, 5)
  );
  readonly hasPhotos = computed(() =>
    this.photoApiService.photoSessions().length > 0
  );

  readonly studentDiscount = computed(() =>
    this.studentStatus()?.discount ??
    this.studentStatus()?.student_discount ??
    this.authService.currentUser()?.studentDiscount ??
    this.authService.currentUser()?.student_discount ??
    null
  );

  readonly activeStudentDiscount = computed(() => {
    const discount = this.studentDiscount();
    return discount?.status === 'active' ? discount : null;
  });

  // Tier discriminator: verified-only (education_verified) vs subscribed (default/else).
  // Any unknown/legacy token falls through to the subscribed copy.
  readonly isVerifiedOnlyTier = computed(() =>
    this.studentDiscount()?.source_token === 'education_verified'
  );

  // ч/б А4 headline price: prefer the literal from print_sheet_price so docs self-heal (3 vs 5).
  readonly studentSheetPrice = computed(() =>
    this.studentDiscount()?.print_sheet_price ?? (this.isVerifiedOnlyTier() ? 5 : 3)
  );

  readonly studentStatusKind = computed<DashboardStudentStatusKind>(() => {
    const status = this.studentStatus();
    switch (status?.account?.status) {
      case 'verified':
        return 'verified';
    }

    switch (this.studentDiscount()?.status) {
      case 'active':
        return 'verified';
    }

    if (status?.latest_verification?.status === 'pending') {
      return 'pending';
    }

    switch (status?.account?.status) {
      case 'rejected':
        return 'rejected';
      case 'revoked':
        return 'revoked';
      case 'expired':
        return 'expired';
    }

    switch (this.studentDiscount()?.status) {
      case 'expired':
        return 'expired';
      case 'revoked':
        return 'revoked';
    }

    return 'none';
  });

  readonly studentExpiresAt = computed(() =>
    this.studentStatus()?.account?.expires_at ??
    this.activeStudentDiscount()?.expires_at ??
    this.studentDiscount()?.expires_at ??
    null
  );

  readonly studentCtaIcon = computed(() => {
    switch (this.studentStatusKind()) {
      case 'verified':
        return 'verified';
      case 'pending':
        return 'hourglass_top';
      case 'rejected':
      case 'revoked':
      case 'expired':
        return 'report_problem';
      default:
        return 'school';
    }
  });

  readonly studentCtaEyebrow = computed(() =>
    this.studentStatusKind() === 'verified' ? 'Статус подтверждён' : 'Для образования'
  );

  readonly studentStatusLabel = computed(() => {
    switch (this.studentStatusKind()) {
      case 'verified':
        return 'Активен';
      case 'pending':
        return 'На проверке';
      case 'rejected':
        return 'Отклонён';
      case 'revoked':
        return 'Отключён';
      case 'expired':
        return 'Истёк';
      default:
        return 'Не подключён';
    }
  });

  readonly studentCtaDescription = computed(() => {
    switch (this.studentStatusKind()) {
      case 'verified':
        if (this.isVerifiedOnlyTier()) {
          return 'Образовательный статус подтверждён: документы А4 дешевле на 50%, премиум-фотопечать от 10×15 до А4 на 30%. С подпиской скидки выше: оформите её в разделе и сравните типы аккаунтов.';
        }
        return 'Образовательный доступ активен: документы А4 дешевле на 70%, премиум-фотопечать от 10×15 до А4 на 50%. В разделе можно сравнить все типы аккаунтов.';
      case 'pending':
        return 'Документ отправлен на проверку. После подтверждения здесь появится дата действия статуса.';
      case 'rejected':
        return 'Не получилось подтвердить документ. Откройте раздел, чтобы посмотреть причину и отправить новое фото.';
      case 'revoked':
        return 'Образовательные условия сейчас отключены. В разделе можно посмотреть детали и отправить актуальный документ.';
      case 'expired':
        return 'Срок действия документа закончился. Обновите подтверждение, чтобы снова пользоваться условиями.';
      default:
        return 'Сравните личный, образовательный и бизнес-аккаунт. Для образовательной цены А4 10→3 ₽ нужна проверка и доступ 199 ₽ в месяц, бизнес подключается через B2B-контур.';
    }
  });

  readonly studentCtaButtonLabel = computed(() =>
    this.studentStatusKind() === 'none' ? 'Подключить' : 'Подробнее'
  );

  // ---------- Lifecycle ----------

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.dashboardService.loadDashboard();
      this.loadStudentStatus();

      // Load photo sessions for dashboard
      const userId = this.authService.currentUser()?.uid;
      if (userId) {
        this.photoApiService.getClientPhotoSessions(userId).subscribe();
      }
    }
  }

  // ---------- Actions ----------

  claimDaily(): void {
    if (this.claimingDaily() || this.dailyClaimed()) return;
    this.claimingDaily.set(true);

    this.http
      .post<{ success: boolean; points?: number; message?: string }>(
        '/api/loyalty/daily-claim',
        {}
      )
      .subscribe({
        next: (res) => {
          this.claimingDaily.set(false);
          this.dailyClaimed.set(true);
          const pts = res.points ?? 0;
          this.snackBar.open(
            `+${pts} бонусов! Заходите завтра за новой наградой`,
            'OK',
            { duration: 4000, panelClass: 'snack-success' }
          );
          this.dashboardService.loadDashboard();
        },
        error: () => {
          this.claimingDaily.set(false);
          this.snackBar.open(
            'Не удалось получить награду. Попробуйте позже.',
            'OK',
            { duration: 3000 }
          );
        },
      });
  }

  // ---------- Helpers ----------

  creditPercent(credit: { remaining: number; total_credits: number }): number {
    if (!credit.total_credits) return 0;
    return Math.round((credit.remaining / credit.total_credits) * 100);
  }

  streakDaysLabel(n: number): string {
    if (n % 10 === 1 && n % 100 !== 11) return 'день';
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дня';
    return 'дней';
  }

  formatSessionDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  formatBookingDay(booking: { bookingDate?: string; date?: string }): string {
    const dateStr = booking.bookingDate || booking.date;
    if (!dateStr) return '--';
    return new Date(dateStr).getDate().toString();
  }

  formatBookingMonth(booking: { bookingDate?: string; date?: string }): string {
    const dateStr = booking.bookingDate || booking.date;
    if (!dateStr) return '';
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return months[new Date(dateStr).getMonth()] ?? '';
  }

  getBookingStatusLabel(status: string): string {
    const map: Record<string, string> = {
      pending: 'Ожидает',
      confirmed: 'Подтверждена',
      completed: 'Завершена',
      cancelled: 'Отменена',
      in_progress: 'В процессе',
    };
    return map[status] ?? status;
  }

  getOrderTypeLabel(type: OrderType): string {
    const map: Record<OrderType, string> = {
      [OrderType.DOCUMENT_PHOTO]: 'Фото на документы',
      [OrderType.PHOTO_SESSION]: 'Фотосессия',
      [OrderType.PHOTO_RESTORATION]: 'Реставрация фото',
      [OrderType.PHOTO_PRINTING]: 'Печать фотографий',
      [OrderType.PHOTO_EDITING]: 'Ретушь и обработка',
      [OrderType.PHOTO_PRODUCTS]: 'Фотопродукция',
      [OrderType.FRAMING]: 'Багетные работы',
    };
    return map[type] ?? 'Заказ';
  }

  getOrderTypeIcon(type: OrderType): string {
    const map: Record<OrderType, string> = {
      [OrderType.DOCUMENT_PHOTO]: 'badge',
      [OrderType.PHOTO_SESSION]: 'photo_camera',
      [OrderType.PHOTO_RESTORATION]: 'auto_fix_high',
      [OrderType.PHOTO_PRINTING]: 'print',
      [OrderType.PHOTO_EDITING]: 'tune',
      [OrderType.PHOTO_PRODUCTS]: 'inventory_2',
      [OrderType.FRAMING]: 'crop_square',
    };
    return map[type] ?? 'receipt_long';
  }

  getOrderStatusLabel(status: OrderStatus | string): string {
    const map: Record<string, string> = {
      [OrderStatus.NEW]: 'Новый',
      [OrderStatus.PROCESSING]: 'В обработке',
      [OrderStatus.WAITING_APPROVAL]: 'Ожидает',
      [OrderStatus.READY]: 'Готов',
      [OrderStatus.COMPLETED]: 'Завершён',
      [OrderStatus.CANCELLED]: 'Отменён',
      [OrderStatus.REFUNDED]: 'Возврат',
      pending_payment: 'Ожидает оплаты',
      expired: 'Истёк',
    };
    return map[status] ?? status;
  }

  private loadStudentStatus(): void {
    this.studentVerificationService.loadMine().subscribe({
      next: status => this.studentStatus.set(status),
      error: () => this.studentStatus.set(null),
    });
  }

}
