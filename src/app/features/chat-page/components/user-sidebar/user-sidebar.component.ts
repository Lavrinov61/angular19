import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AuthService } from '../../../../core/services/auth.service';
import { SubscriptionService } from '../../../../core/services/subscription.service';
import { LoyaltyProfile, LoyaltyMiniProfile } from '../../../../shared/interfaces/loyalty.interfaces';
import { buildMiniProfile } from '../../../../shared/utils/loyalty.utils';

interface LoyaltyApiResponse {
  success: boolean;
  data: { profile: LoyaltyProfile; achievements: unknown[] };
}

interface DailyClaimResponse {
  success: boolean;
  points_awarded?: number;
  xp_awarded?: number;
  new_balance?: number;
}

@Component({
  selector: 'app-user-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="user-sidebar">
      @if (!isAuthenticated()) {
        <!-- ─── STATE 1: GUEST ─── -->
        <div class="sidebar-guest">
          <div class="guest-header">
            <mat-icon class="avatar-placeholder">account_circle</mat-icon>
            <h3>Войдите для бонусов</h3>
            <p>Копите баллы, получайте скидки и доступ к подпискам</p>
          </div>

          <div class="oauth-buttons">
            <button class="oauth-btn yandex" (click)="loginYandex()">
              <svg class="oauth-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.04 12c0-5.523 4.476-10 10-10 5.522 0 10 4.477 10 10s-4.478 10-10 10c-5.524 0-10-4.477-10-10z" fill="#FC3F1D"/>
                <path d="M13.32 7.666h-.924c-1.694 0-2.585.858-2.585 2.123 0 1.43.616 2.1 1.881 2.959l1.045.704-3.003 4.548H7.49l2.695-4.08c-1.55-1.111-2.42-2.19-2.42-4.025 0-2.289 1.585-3.895 3.918-3.895h3.004V18h-1.367V7.666z" fill="#fff"/>
              </svg>
              <span>Войти через Яндекс</span>
            </button>

            <button class="oauth-btn google" (click)="loginGoogle()">
              <svg class="oauth-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>Войти через Google</span>
            </button>

            <button class="oauth-btn vk" (click)="loginVk()">
              <svg class="oauth-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.391 0 15.684 0z" fill="#2787F5"/>
                <path d="M12.619 17.028h1.321s.399-.044.602-.263c.187-.202.181-.582.181-.582s-.025-1.779.8-2.04c.813-.256 1.857 1.719 2.963 2.479.836.573 1.471.448 1.471.448l2.956-.041s1.546-.095.813-1.31c-.06-.099-.427-.9-2.198-2.544-1.854-1.718-1.606-1.441.627-4.41 1.357-1.812 1.899-2.917 1.73-3.389-.162-.45-1.154-.332-1.154-.332l-3.327.021s-.247-.033-.431.075c-.181.107-.298.354-.298.354s-.525 1.397-1.225 2.585c-1.477 2.508-2.067 2.641-2.308 2.487-.562-.362-.421-1.461-.421-2.241 0-2.436.369-3.451-.721-3.71-.362-.088-.628-.146-1.553-.156-1.187-.012-2.191.004-2.76.282-.379.184-.671.594-.492.618.22.029.717.134 1.15.491.341.286.452.903.452.903s.268 2.866-.627 3.222c-.614.237-1.457-.247-3.268-2.463-.927-1.128-1.628-2.377-1.628-2.377s-.135-.231-.314-.355c-.215-.149-.516-.196-.516-.196l-3.163.021s-.475.013-.649.22c-.156.187-.012.573-.012.573s2.474 5.789 5.273 8.708c2.567 2.678 5.48 2.502 5.48 2.502z" fill="#fff"/>
              </svg>
              <span>Войти через ВКонтакте</span>
            </button>

          </div>

          <div class="guest-reasons">
            <h4>5 причин зарегистрироваться</h4>
            <ul>
              <li>
                <mat-icon>star</mat-icon>
                <span>Бонусные баллы за каждый заказ</span>
              </li>
              <li>
                <mat-icon>local_offer</mat-icon>
                <span>Скидки по уровню лояльности</span>
              </li>
              <li>
                <mat-icon>card_membership</mat-icon>
                <span>Подписки со скидкой до 30%</span>
              </li>
              <li>
                <mat-icon>history</mat-icon>
                <span>История заказов и фото</span>
              </li>
              <li>
                <mat-icon>group</mat-icon>
                <span>Реферальная программа</span>
              </li>
            </ul>
          </div>
        </div>
      } @else {
        <!-- ─── STATES 2 & 3: AUTHENTICATED ─── -->
        <div class="sidebar-auth">
          <!-- Avatar + name -->
          <div class="user-header">
            <div class="avatar">
              @if (currentUser()?.photo_url) {
                <img [src]="currentUser()!.photo_url" alt="Аватар пользователя" />
              } @else {
                <mat-icon>account_circle</mat-icon>
              }
            </div>
            <div class="user-info">
              <span class="user-name">{{ displayName() }}</span>
              @if (mini()) {
                <span class="level-badge">
                  <mat-icon class="lvl-icon" [svgIcon]="mini()!.levelIcon" />
                  {{ mini()!.levelName }}
                </span>
              }
            </div>
          </div>

          <!-- XP progress bar -->
          @if (mini()) {
            <div class="xp-section">
              <div class="xp-labels">
                <span>{{ mini()!.currentXp }} XP</span>
                <span>{{ mini()!.nextLevelXp }} XP</span>
              </div>
              <mat-progress-bar
                mode="determinate"
                [value]="mini()!.xpProgress"
                class="xp-bar"
              />
            </div>
          }

          <!-- Points balance -->
          <div class="points-balance">
            <mat-icon>toll</mat-icon>
            <span>{{ mini()?.points ?? 0 }} баллов</span>
          </div>

          <!-- Daily reward button -->
          @if (mini()?.canClaimDaily && !dailyClaimed()) {
            <button
              class="daily-btn pulse"
              (click)="claimDaily()"
              [disabled]="claimingDaily()"
            >
              <mat-icon>celebration</mat-icon>
              Получить ежедневный бонус
            </button>
          } @else if (dailyClaimed()) {
            <div class="daily-claimed">
              <mat-icon>check_circle</mat-icon>
              Бонус получен!
            </div>
          }

          <!-- Streak -->
          @if (mini()?.currentStreak) {
            <div class="streak">
              <mat-icon>local_fire_department</mat-icon>
              {{ mini()!.currentStreak }} дней подряд
            </div>
          }

          <!-- ─── STATE 3: Subscription card ─── -->
          @if (hasSub()) {
            <div class="sub-card">
              <div class="sub-header">
                <mat-icon>workspace_premium</mat-icon>
                <span class="sub-plan-name">{{ currentSubscription()?.plan_name }}</span>
                <span class="sub-status active">Активна</span>
              </div>
              <div class="sub-discount">
                -{{ currentSubscription()?.subscriber_discount_percent }}% скидка
              </div>
              @if (credits().length > 0) {
                <div class="sub-credits">
                  @for (credit of credits(); track credit.product_name) {
                    <div class="credit-item">
                      <span class="credit-name">{{ credit.product_name }}</span>
                      <span class="credit-count">
                        {{ credit.remaining }}/{{ credit.total_credits }}
                      </span>
                    </div>
                  }
                </div>
              }
              <div class="sub-renewal">
                Следующая оплата: {{ formatDate(currentSubscription()?.next_payment_date ?? null) }}
              </div>
            </div>
          } @else {
            <!-- CTA for non-subscriber -->
            <a routerLink="/user-profile/subscription" class="sub-cta-btn">
              <mat-icon>card_membership</mat-icon>
              Оформить подписку
            </a>
          }

          <a routerLink="/user-profile" class="profile-link">Личный кабинет →</a>
        </div>
      }
    </div>
  `,
  styles: [`
    .user-sidebar {
      width: 100%;
      color: var(--ed-on-surface);
      font-family: inherit;
    }

    /* ─── GUEST ─── */
    .sidebar-guest {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .guest-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 8px;
      padding: 16px 0 8px;

      .avatar-placeholder {
        font-size: 56px;
        width: 56px;
        height: 56px;
        color: var(--ed-on-surface-variant);
        opacity: 0.6;
      }

      h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--ed-on-surface);
      }

      p {
        margin: 0;
        font-size: 13px;
        color: var(--ed-on-surface-variant);
        line-height: 1.4;
      }
    }

    .oauth-buttons {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .oauth-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--ed-outline-variant);
      border-radius: 10px;
      background: var(--ed-surface-container);
      color: var(--ed-on-surface);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;

      &:hover {
        background: var(--ed-surface-container-high);
        border-color: var(--ed-accent);
      }

      .oauth-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

    }

    .guest-reasons {
      padding: 14px;
      background: var(--ed-surface-container);
      border-radius: 12px;
      border: 1px solid var(--ed-outline-variant);

      h4 {
        margin: 0 0 12px;
        font-size: 13px;
        font-weight: 600;
        color: var(--ed-on-surface-variant);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      li {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        color: var(--ed-on-surface);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--ed-accent);
          flex-shrink: 0;
        }
      }
    }

    /* ─── AUTHENTICATED ─── */
    .sidebar-auth {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .user-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      overflow: hidden;
      background: var(--ed-surface-container-high);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 2px solid var(--ed-accent);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      mat-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
        color: var(--ed-on-surface-variant);
      }
    }

    .user-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .user-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--ed-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .level-badge {
      font-size: 12px;
      color: var(--ed-accent);
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .lvl-icon {
      width: 14px;
      height: 14px;
      font-size: 14px;
      flex-shrink: 0;
    }

    ::ng-deep .lvl-icon svg {
      width: 14px;
      height: 14px;
    }

    /* XP */
    .xp-section {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .xp-labels {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--ed-on-surface-variant);
    }

    .xp-bar {
      border-radius: 4px;
      height: 6px;
      --mdc-linear-progress-active-indicator-color: var(--ed-accent);
      --mdc-linear-progress-track-color: var(--ed-surface-container-high);
    }

    /* Points */
    .points-balance {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--ed-accent-container);
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      color: var(--ed-on-accent);

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    /* Daily */
    .daily-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 12px;
      background: var(--ed-accent);
      color: #000;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &.pulse {
        animation: pulse-glow 2s infinite;
      }
    }

    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
      50% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
    }

    .daily-claimed {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--ed-surface-container);
      border-radius: 10px;
      font-size: 13px;
      color: var(--ed-on-surface-variant);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #22c55e;
      }
    }

    /* Streak */
    .streak {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--ed-on-surface-variant);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #f97316;
      }
    }

    /* Subscription card */
    .sub-card {
      padding: 14px;
      background: var(--ed-surface-container);
      border: 1px solid var(--ed-accent);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sub-header {
      display: flex;
      align-items: center;
      gap: 8px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-accent);
      }

      .sub-plan-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--ed-on-surface);
        flex: 1;
      }

      .sub-status.active {
        font-size: 11px;
        padding: 2px 8px;
        background: rgba(34, 197, 94, 0.15);
        color: #22c55e;
        border-radius: 20px;
        font-weight: 600;
      }
    }

    .sub-discount {
      font-size: 22px;
      font-weight: 700;
      color: var(--ed-accent);
    }

    .sub-credits {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .credit-item {
      display: flex;
      justify-content: space-between;
      font-size: 12px;

      .credit-name {
        color: var(--ed-on-surface-variant);
      }

      .credit-count {
        font-weight: 600;
        color: var(--ed-on-surface);
      }
    }

    .sub-renewal {
      font-size: 11px;
      color: var(--ed-on-surface-variant);
    }

    /* CTA */
    .sub-cta-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 11px 14px;
      background: var(--ed-surface-container);
      border: 1px dashed var(--ed-accent);
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      color: var(--ed-accent);
      text-decoration: none;
      transition: background 0.15s;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        background: var(--ed-accent-container);
      }
    }

    .profile-link {
      text-align: center;
      font-size: 13px;
      color: var(--ed-on-surface-variant);
      text-decoration: none;
      transition: color 0.15s;

      &:hover {
        color: var(--ed-accent);
      }
    }

    /* ─── Responsive: compact at 240px sidebar (viewport ≤ 1200px) ─── */
    @media (max-width: 1200px) {
      .oauth-btn {
        padding: 8px 10px;
        font-size: 13px;
        gap: 8px;
      }

      .guest-header h3 {
        font-size: 15px;
      }

      .sub-discount {
        font-size: 18px;
      }

      .user-name {
        font-size: 14px;
      }
    }

    /* ─── Compact: 260px sidebar (viewport 1201-1400px) ─── */
    @media (max-width: 1400px) {
      .guest-reasons li {
        font-size: 12px;
      }

      .oauth-btn span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  `],
})
export class UserSidebarComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  protected readonly authService = inject(AuthService);
  private readonly subscriptionService = inject(SubscriptionService);

  // Auth state
  readonly isAuthenticated = this.authService.isAuthenticated;
  readonly currentUser = this.authService.currentUser;

  // Subscription state
  readonly hasSub = this.subscriptionService.hasActiveSubscription;
  readonly currentSubscription = this.subscriptionService.currentSubscription;
  readonly credits = this.subscriptionService.credits;

  // Loyalty state
  private readonly loyaltyProfile = signal<LoyaltyProfile | null>(null);
  readonly dailyClaimed = signal(false);
  readonly claimingDaily = signal(false);

  readonly mini = computed<LoyaltyMiniProfile | null>(() => {
    const profile = this.loyaltyProfile();
    return profile ? buildMiniProfile(profile) : null;
  });

  readonly displayName = computed<string>(() => {
    const user = this.currentUser();
    if (!user) return 'Пользователь';
    return (
      user.display_name ||
      user.first_name ||
      user.email?.split('@')[0] ||
      'Пользователь'
    );
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.isAuthenticated()) {
      this.loadLoyaltyProfile();
      this.subscriptionService.ensureLoaded();
    }
  }

  private loadLoyaltyProfile(): void {
    this.http.get<LoyaltyApiResponse>('/api/loyalty/profile').subscribe({
      next: (res) => {
        if (res.success && res.data?.profile) {
          this.loyaltyProfile.set(res.data.profile);
        }
      },
      error: () => {
        // Non-critical, sidebar remains functional without loyalty data
      },
    });
  }

  claimDaily(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.claimingDaily()) return;

    this.claimingDaily.set(true);
    this.http.post<DailyClaimResponse>('/api/loyalty/daily-claim', {}).subscribe({
      next: (res) => {
        if (res.success) {
          this.dailyClaimed.set(true);
          // Reload profile to update streak & points
          this.loadLoyaltyProfile();
        }
        this.claimingDaily.set(false);
      },
      error: () => {
        this.claimingDaily.set(false);
      },
    });
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  loginYandex(): void {
    this.authService.signInWithYandex().subscribe();
  }

  loginGoogle(): void {
    this.authService.signInWithGoogle().subscribe();
  }

  loginVk(): void {
    this.authService.signInWithVk().subscribe();
  }

}
