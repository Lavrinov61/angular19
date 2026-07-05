import {
  Component, inject, signal, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_price: number;
  is_customizable: boolean;
  billing_period: string;
  subscriber_discount_percent: number;
  is_active: boolean;
  features: string[];
  items: { product_name: string; included_quantity: number }[];
}

interface UserSubscription {
  id: string;
  phone: string;
  customer_name: string | null;
  plan_name: string;
  monthly_price: number;
  status: string;
  current_period_start: string;
  current_period_end: string;
  credits: { product_name: string; total: number; used: number; remaining: number }[];
}

@Component({
  selector: 'app-subscription-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatChipsModule, MatDividerModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatMenuModule,
    MatTabsModule, MatTooltipModule,
  ],
  template: `
    <div class="sub-page">
      <div class="page-header">
        <h1>Управление подписками</h1>
      </div>

      <mat-tab-group>

        <!-- Активные подписки -->
        <mat-tab label="Активные подписки">
          <div class="tab-content">
            <!-- Поиск по телефону -->
            <div class="search-row">
              <mat-form-field appearance="outline" class="search-field">
                <mat-icon matPrefix>search</mat-icon>
                <input matInput [(ngModel)]="phoneSearch" placeholder="Поиск по телефону..."
                       (keyup.enter)="searchSubscriptions()">
              </mat-form-field>
              <button mat-flat-button (click)="searchSubscriptions()">Найти</button>
            </div>

            @if (subsLoading()) {
              <div class="loading-center">
                <mat-spinner diameter="36" />
              </div>
            } @else {
              @for (sub of subscriptions(); track sub.id) {
                <mat-card appearance="outlined" class="sub-card">
                  <mat-card-content>
                    <div class="sub-header">
                      <div class="sub-info">
                        <div class="sub-name">{{ sub.customer_name || sub.phone }}</div>
                        <div class="sub-meta">
                          <span class="sub-plan">{{ sub.plan_name }}</span>
                          <span class="sub-price">{{ sub.monthly_price }}₽/мес</span>
                        </div>
                        <div class="sub-phone">{{ sub.phone }}</div>
                      </div>
                      <div class="sub-status" [class]="'status-' + sub.status">
                        {{ statusLabel(sub.status) }}
                      </div>
                    </div>

                    @if (sub.credits.length > 0) {
                      <mat-divider />
                      <div class="credits-section">
                        <div class="credits-title">Остатки старой модели</div>
                        @for (c of sub.credits; track c.product_name) {
                          <div class="credit-row">
                            <span class="credit-name">{{ c.product_name }}</span>
                            <div class="credit-bar-wrapper">
                              <div class="credit-bar"
                                   [style.width.%]="c.total > 0 ? (c.remaining / c.total * 100) : 0">
                              </div>
                            </div>
                            <span class="credit-nums">{{ c.remaining }}/{{ c.total }}</span>
                          </div>
                        }
                      </div>
                    }

                    <div class="sub-actions">
                      @if (sub.status === 'active') {
                        <button mat-button (click)="pauseSubscription(sub.id)">
                          <mat-icon>pause</mat-icon> Пауза
                        </button>
                        <button mat-button color="warn" (click)="cancelSubscription(sub.id)">
                          <mat-icon>cancel</mat-icon> Отмена
                        </button>
                      }
                      @if (sub.status === 'paused') {
                        <button mat-flat-button (click)="resumeSubscription(sub.id)">
                          <mat-icon>play_arrow</mat-icon> Возобновить
                        </button>
                      }
                    </div>
                  </mat-card-content>
                </mat-card>
              } @empty {
                <div class="empty-state">
                  <mat-icon>card_membership</mat-icon>
                  <span>Нет подписок</span>
                  <span class="empty-hint">Используйте поиск по телефону клиента</span>
                </div>
              }
            }
          </div>
        </mat-tab>

        <!-- Планы подписок -->
        <mat-tab label="Тарифные планы">
          <div class="tab-content">
            @if (plansLoading()) {
              <div class="loading-center">
                <mat-spinner diameter="36" />
              </div>
            } @else {
              <div class="plans-grid">
                @for (plan of plans(); track plan.id) {
                  <mat-card appearance="outlined" class="plan-card">
                    <mat-card-content>
                      <div class="plan-name">{{ plan.name }}</div>
                      <div class="plan-price">{{ plan.base_price }}₽<span>/мес</span></div>
                      @if (plan.description) {
                        <div class="plan-desc">{{ plan.description }}</div>
                      }
                      @if (plan.items.length > 0) {
                        <div class="plan-items">
                          @for (item of plan.items; track item.product_name) {
                            <div class="plan-item">
                              <mat-icon>check</mat-icon>
                              {{ item.product_name }} дешевле по подписке
                            </div>
                          }
                        </div>
                      }
                      @if (plan.features.length > 0) {
                        <div class="plan-features">
                          @for (f of plan.features; track f) {
                            <div class="plan-feature">
                              <mat-icon>star</mat-icon> {{ f }}
                            </div>
                          }
                        </div>
                      }
                      @if (plan.subscriber_discount_percent > 0) {
                        <div class="plan-discount">
                          Скидка на объём: {{ plan.subscriber_discount_percent }}%
                        </div>
                      }
                    </mat-card-content>
                  </mat-card>
                } @empty {
                  <div class="empty-state">
                    <mat-icon>playlist_add</mat-icon>
                    <span>Нет тарифных планов</span>
                  </div>
                }
              </div>
            }
          </div>
        </mat-tab>

      </mat-tab-group>
    </div>
  `,
  styles: [`
    .sub-page { padding: 0 4px; }

    .page-header {
      margin-bottom: 16px;
      h1 { margin: 0; font-size: 22px; font-weight: 600; }
    }

    .tab-content { padding: 12px 0; }

    .search-row {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .search-field { flex: 1; }

    .loading-center {
      display: flex;
      justify-content: center;
      padding: 40px;
    }

    .sub-card { margin-bottom: 12px; }

    .sub-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .sub-name {
      font-size: 16px;
      font-weight: 600;
    }
    .sub-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 4px;
    }
    .sub-plan {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .sub-price {
      font-weight: 600;
      color: var(--mat-sys-primary);
    }
    .sub-phone {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 2px;
    }

    .sub-status {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    .status-active { background: var(--crm-status-success-container); color: var(--crm-status-success); }
    .status-paused { background: var(--crm-status-warning-container); color: var(--crm-status-warning); }
    .status-cancelled { background: var(--crm-status-error-container); color: var(--crm-status-error); }
    .status-expired { background: var(--mat-sys-surface-container); color: var(--mat-sys-on-surface-variant); }

    .credits-section {
      padding: 12px 0 8px;
    }
    .credits-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 8px;
    }
    .credit-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .credit-name {
      min-width: 120px;
      flex-shrink: 0;
    }
    .credit-bar-wrapper {
      flex: 1;
      height: 6px;
      background: var(--mat-sys-surface-container);
      border-radius: 3px;
      overflow: hidden;
    }
    .credit-bar {
      height: 100%;
      background: var(--mat-sys-primary);
      border-radius: 3px;
      transition: width 0.3s;
    }
    .credit-nums {
      font-weight: 600;
      min-width: 48px;
      text-align: right;
    }

    .sub-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }

    .plans-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .plan-card { height: fit-content; }
    .plan-name {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .plan-price {
      font-size: 24px;
      font-weight: 700;
      color: var(--mat-sys-primary);
      margin-bottom: 8px;
      span { font-size: 14px; font-weight: 400; color: var(--mat-sys-on-surface-variant); }
    }
    .plan-desc {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 12px;
    }
    .plan-items, .plan-features {
      margin-bottom: 8px;
    }
    .plan-item, .plan-feature {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      padding: 2px 0;
      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    }
    .plan-discount {
      margin-top: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--mat-sys-tertiary);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px;
      color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
    }
    .empty-hint { font-size: 13px; }
  `],
})
export class SubscriptionManagerComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);

  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly subscriptions = signal<UserSubscription[]>([]);
  readonly plansLoading = signal(false);
  readonly subsLoading = signal(false);

  phoneSearch = '';

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadPlans();
  }

  loadPlans(): void {
    this.plansLoading.set(true);
    this.http.get<{ success: boolean; plans: SubscriptionPlan[] }>('/api/subscriptions/plans').subscribe({
      next: (res) => {
        this.plans.set(res.plans || []);
        this.plansLoading.set(false);
      },
      error: () => this.plansLoading.set(false),
    });
  }

  searchSubscriptions(): void {
    const phone = this.phoneSearch.replace(/\D/g, '');
    if (phone.length < 10) {
      this.snackBar.open('Введите номер телефона', 'OK', { duration: 3000 });
      return;
    }

    this.subsLoading.set(true);
    this.http.get<{ success: boolean; subscription: UserSubscription | null; credits: UserSubscription['credits'] }>(
      `/api/subscriptions/check/${phone}`,
    ).subscribe({
      next: (res) => {
        if (res.subscription) {
          const sub: UserSubscription = {
            ...res.subscription,
            credits: res.credits || [],
          };
          this.subscriptions.set([sub]);
        } else {
          this.subscriptions.set([]);
        }
        this.subsLoading.set(false);
      },
      error: () => {
        this.subsLoading.set(false);
        this.snackBar.open('Ошибка поиска', 'OK', { duration: 3000 });
      },
    });
  }

  pauseSubscription(id: string): void {
    this.http.post(`/api/subscriptions/${id}/pause`, {}).subscribe({
      next: () => {
        this.snackBar.open('Подписка приостановлена', 'OK', { duration: 3000 });
        this.searchSubscriptions();
      },
      error: () => this.snackBar.open('Ошибка', 'OK', { duration: 3000 }),
    });
  }

  resumeSubscription(id: string): void {
    this.http.post(`/api/subscriptions/${id}/resume`, {}).subscribe({
      next: () => {
        this.snackBar.open('Подписка возобновлена', 'OK', { duration: 3000 });
        this.searchSubscriptions();
      },
      error: () => this.snackBar.open('Ошибка', 'OK', { duration: 3000 }),
    });
  }

  cancelSubscription(id: string): void {
    this.http.post(`/api/subscriptions/${id}/cancel`, { reason: 'Отмена оператором' }).subscribe({
      next: () => {
        this.snackBar.open('Подписка отменена', 'OK', { duration: 3000 });
        this.searchSubscriptions();
      },
      error: () => this.snackBar.open('Ошибка', 'OK', { duration: 3000 }),
    });
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Активна', paused: 'Пауза', cancelled: 'Отменена', expired: 'Истекла',
    };
    return labels[status] || status;
  }
}
