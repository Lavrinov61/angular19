import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  PLATFORM_ID,
  OnInit,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SubscriptionService } from '../../../../core/services/subscription.service';
import { AuthService } from '../../../../core/services/auth.service';

interface SubscriptionPlanItem {
  product_id: string;
  product_name: string;
  product_price: number;
  included_quantity: number;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  base_price: number;
  billing_period: string;
  description: string;
  features: string[];
  is_popular: boolean;
  icon: string;
  savings_label: string | null;
  subscriber_discount_percent: number;
  category: string;
  credits_rollover_months: number;
  items: SubscriptionPlanItem[];
}

interface PlansApiResponse {
  success: boolean;
  plans: SubscriptionPlan[];
}

interface CategoryMeta {
  key: string;
  label: string;
  icon: string;
}

const CATEGORIES: CategoryMeta[] = [
  { key: 'doc-print', label: 'Печать документов A4', icon: 'print' },
  { key: 'photo-print', label: 'Печать фотографий', icon: 'photo_library' },
];

@Component({
  selector: 'app-subscription-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DecimalPipe,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="sb-root">

      <!-- Active subscription -->
      @if (hasActiveSubscription()) {
        @if (currentSubscription(); as sub) {
          <div class="sb-active">
            <div class="sb-active__icon">
              <mat-icon>verified</mat-icon>
            </div>
            <div class="sb-active__info">
              <p class="sb-active__plan">{{ sub.plan_name }}</p>
              <div class="sb-active__badges">
                <span class="sb-badge sb-badge--status">{{ statusLabel(sub.status) }}</span>
                @if (sub.subscriber_discount_percent > 0) {
                  <span class="sb-badge sb-badge--discount">
                    −{{ sub.subscriber_discount_percent }}% на объём
                  </span>
                }
              </div>
            </div>
            <a
              mat-stroked-button
              class="sb-manage-btn"
              routerLink="/user-profile/subscription"
            >
              Управление
            </a>
          </div>
        }
      }

      <!-- No subscription, category picker + plans -->
      @if (!hasActiveSubscription()) {
        <div class="sb-promo-header">
          <mat-icon class="sb-promo-header__icon">workspace_premium</mat-icon>
          <div>
            <h3 class="sb-promo-header__title">Подписка на печать</h3>
            <p class="sb-promo-header__sub">Объёмная печать дешевле по подписке</p>
          </div>
        </div>

        @if (loading()) {
          <div class="sb-loading">
            <mat-spinner diameter="32" />
          </div>
        }

        @if (!loading() && plans().length > 0) {
          <!-- Category chips -->
          <div class="sb-categories">
            @for (cat of availableCategories(); track cat.key) {
              <button
                class="sb-cat-chip"
                [class.sb-cat-chip--active]="selectedCategory() === cat.key"
                (click)="selectedCategory.set(cat.key)"
              >
                <mat-icon class="sb-cat-chip__icon">{{ cat.icon }}</mat-icon>
                <span>{{ cat.label }}</span>
              </button>
            }
          </div>

          <!-- Plans for selected category -->
          <div class="sb-plans">
            @for (plan of filteredPlans(); track plan.id) {
              <div class="sb-plan" [class.sb-plan--popular]="plan.is_popular">
                @if (plan.is_popular) {
                  <div class="sb-plan__badge">Популярный</div>
                }

                <h4 class="sb-plan__name">{{ plan.name }}</h4>

                <div class="sb-plan__price">
                  <span class="sb-plan__amount">{{ plan.base_price | number:'1.0-0' }}₽</span>
                  <span class="sb-plan__period">/ мес</span>
                </div>

                @if (plan.items.length > 0) {
                  <ul class="sb-plan__features">
                    @for (item of plan.items.slice(0, 3); track item.product_id) {
                      <li>
                        <mat-icon class="sb-plan__check">check_circle</mat-icon>
                        {{ item.product_name }} дешевле по подписке
                      </li>
                    }
                  </ul>
                }

                <button
                  mat-flat-button
                  class="sb-plan__btn"
                  [class.sb-plan__btn--popular]="plan.is_popular"
                  (click)="selectPlan(plan)"
                >
                  Выбрать
                </button>
              </div>
            }
          </div>
        }

        @if (!loading() && plans().length === 0) {
          <div class="sb-empty">
            <mat-icon>subscriptions</mat-icon>
            <p>Подписки временно недоступны</p>
          </div>
        }

        <a
          routerLink="/user-profile/subscription"
          class="sb-more-link"
        >
          Все подписки
          <mat-icon>arrow_forward</mat-icon>
        </a>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      color: #20242a;
    }

    .sb-root {
      padding: 0;
    }

    /* Active subscriber card */
    .sb-active {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      background: #ffffff;
      border: 1px solid #ef3124;
      border-radius: 8px;
    }
    .sb-active__icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      background: #fff4f2;
      border-radius: 8px;
      flex-shrink: 0;
    }
    .sb-active__icon mat-icon {
      color: #ef3124;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .sb-active__info {
      flex: 1;
      min-width: 0;
    }
    .sb-active__plan {
      margin: 0 0 4px;
      font-size: 13px;
      font-weight: 600;
      color: #20242a;
    }
    .sb-active__badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .sb-badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0;
    }
    .sb-badge--status {
      background: rgba(34, 197, 94, 0.18);
      color: #22c55e;
    }
    .sb-badge--discount {
      background: #fff4f2;
      color: #ef3124;
    }
    .sb-manage-btn {
      flex-shrink: 0;
      font-size: 12px;
      border-color: #dfe3e8 !important;
      color: #20242a !important;
      border-radius: 8px;
    }

    /* Promo header */
    .sb-promo-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .sb-promo-header__icon {
      color: #ef3124;
      font-size: 28px;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }
    .sb-promo-header__title {
      margin: 0 0 2px;
      font-size: 15px;
      font-weight: 700;
      color: #20242a;
    }
    .sb-promo-header__sub {
      margin: 0;
      font-size: 12px;
      color: #737985;
    }

    /* Loading */
    .sb-loading {
      display: flex;
      justify-content: center;
      padding: 16px 0;
    }

    /* Category chips */
    .sb-categories {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 10px;
      margin-bottom: 10px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .sb-categories::-webkit-scrollbar {
      display: none;
    }
    .sb-cat-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 10px;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      background: #ffffff;
      color: #737985;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.15s;
    }
    .sb-cat-chip:hover {
      border-color: #ef3124;
      color: #20242a;
    }
    .sb-cat-chip--active {
      background: #fff4f2;
      border-color: #ef3124;
      color: #ef3124;
      font-weight: 600;
    }
    .sb-cat-chip__icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    /* Plans horizontal scroll */
    .sb-plans {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 6px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .sb-plans::-webkit-scrollbar {
      display: none;
    }

    /* Plan card */
    .sb-plan {
      position: relative;
      flex: 0 0 180px;
      padding: 14px 12px;
      background: #ffffff;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .sb-plan--popular {
      border-color: #ef3124;
      box-shadow: 0 8px 18px rgba(239, 49, 36, 0.12);
    }
    .sb-plan__badge {
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      background: #ef3124;
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 10px;
      border-radius: 10px;
      white-space: nowrap;
    }
    .sb-plan__name {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: #20242a;
    }
    .sb-plan--popular .sb-plan__name {
      margin-top: 4px;
    }
    .sb-plan__price {
      display: flex;
      align-items: baseline;
      gap: 3px;
    }
    .sb-plan__amount {
      font-size: 20px;
      font-weight: 800;
      color: #20242a;
    }
    .sb-plan__period {
      font-size: 11px;
      color: #737985;
    }
    .sb-plan__features {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }
    .sb-plan__features li {
      display: flex;
      align-items: flex-start;
      gap: 4px;
      font-size: 11px;
      color: #20242a;
      line-height: 1.4;
    }
    .sb-plan__check {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #22c55e;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .sb-plan__btn {
      width: 100%;
      font-size: 12px;
      font-weight: 600;
      border-radius: 8px;
      background: #f1f2f4 !important;
      color: #20242a !important;
      border: 1px solid #dfe3e8;
    }
    .sb-plan__btn--popular {
      background: #ef3124 !important;
      color: #ffffff !important;
      border-color: transparent;
    }

    /* Empty fallback */
    .sb-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 20px 0;
      color: #737985;
      font-size: 13px;
    }
    .sb-empty mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
    }
    .sb-empty p {
      margin: 0;
    }

    /* More link */
    .sb-more-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 10px;
      font-size: 12px;
      color: #ef3124;
      text-decoration: none;
      transition: opacity 0.15s;
    }
    .sb-more-link:hover {
      opacity: 0.8;
      text-decoration: underline;
    }
    .sb-more-link mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
  `],
})
export class SubscriptionBuilderComponent implements OnInit {
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly loading = signal(false);
  readonly selectedCategory = signal<string>('doc-print');

  readonly hasActiveSubscription = this.subscriptionService.hasActiveSubscription;
  readonly currentSubscription = this.subscriptionService.currentSubscription;

  readonly availableCategories = computed(() => {
    const planCategories = new Set(this.plans().map(p => p.category));
    return CATEGORIES.filter(c => planCategories.has(c.key));
  });

  readonly filteredPlans = computed(() =>
    this.plans().filter(p => p.category === this.selectedCategory()),
  );

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.subscriptionService.ensureLoaded();
    this.loadPlans();
  }

  selectPlan(plan: SubscriptionPlan): void {
    void this.router.navigate(['/user-profile/subscription'], {
      queryParams: { plan: plan.id },
    });
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Активна',
      paused: 'Приостановлена',
      cancelled: 'Отменена',
      expired: 'Истекла',
    };
    return labels[status] ?? status;
  }

  private loadPlans(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.loading.set(true);
    this.http.get<PlansApiResponse>('/api/subscriptions/plans').subscribe({
      next: (res) => {
        const plans = res.plans ?? [];
        this.plans.set(plans);
        if (plans.length > 0 && !plans.some(p => p.category === this.selectedCategory())) {
          this.selectedCategory.set(plans[0].category);
        }
        this.loading.set(false);
      },
      error: () => {
        this.plans.set([]);
        this.loading.set(false);
      },
    });
  }
}
