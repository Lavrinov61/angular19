import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface MySubscription {
  id: string;
  plan_name: string;
  plan_slug?: string | null;
  plan_category?: string | null;
  monthly_price: number;
  status: string;
  current_period_start: string;
  current_period_end: string;
  next_payment_date: string | null;
  subscriber_discount_percent: number;
  card_last_four?: string | null;
  card_type?: string | null;
}

/** Ответ POST /:id/change-card/init — старт смены карты (1₽-верификация) */
export interface ChangeCardInitResult {
  changeId: string;
  externalId: string;
  verifyAmount: number;
  planName: string;
  email: string | null;
  phone: string | null;
}

export type ChangeCardStatusValue =
  | 'card_changed'
  | 'pending_payment'
  | 'processing'
  | 'already_changed'
  | 'failed'
  | (string & {});

/** Ответ POST /:id/change-card/confirm */
export interface ChangeCardConfirmResult {
  status: ChangeCardStatusValue;
  cardLastFour?: string | null;
}

export interface CreditInfo {
  product_name: string;
  total_credits: number;
  used_credits: number;
  remaining: number;
  expires_at: string;
}

export interface SubscriptionPlanItem {
  product_id: string;
  product_name: string;
  product_price: number;
  included_quantity: number;
}

export interface SubscriptionPlanCoverageTier {
  min_percent: number;
  max_percent: number;
  credit_multiplier: number;
  title: string;
  description: string;
}

export interface SubscriptionPlanUsageFaq {
  question: string;
  answer: string;
}

export interface SubscriptionPlanProductMultiplier {
  product_id: string;
  product_name: string;
  base_product_id: string | null;
  credit_multiplier: number;
  description: string;
}

export interface SubscriptionPlanUsagePolicy {
  kind: 'coverage_print_package' | 'photo_print_package';
  unit_label: string;
  base_coverage_percent: number | null;
  max_coverage_percent: number | null;
  coverage_tiers: readonly SubscriptionPlanCoverageTier[];
  product_multipliers?: readonly SubscriptionPlanProductMultiplier[];
  terms: readonly string[];
  steps: readonly string[];
  faq: readonly SubscriptionPlanUsageFaq[];
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
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
  usage_policy?: SubscriptionPlanUsagePolicy | null;
  items: SubscriptionPlanItem[];
}

export interface CreditHistoryEntry {
  id: string;
  product_name: string;
  quantity: number;
  credit_multiplier: number;
  credits_consumed: number;
  receipt_number: string | null;
  employee_name: string | null;
  description: string | null;
  created_at: string;
}

export interface PurchaseResult {
  success: boolean;
  subscription_id: string;
  plan_name: string;
  amount: number;
  billing_period: string;
  phone: string | null;
  email: string | null;
  trial_period_days?: number;
  trial_end?: string;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly subscriptions = signal<MySubscription[]>([]);
  readonly currentSubscription = signal<MySubscription | null>(null);
  readonly credits = signal<CreditInfo[]>([]);
  readonly loading = signal(false);
  private loaded = false;

  readonly hasActiveSubscription = computed(() => {
    const sub = this.currentSubscription();
    return sub !== null && (sub.status === 'active' || sub.status === 'paused');
  });

  readonly totalRemainingCredits = computed(() =>
    this.credits().reduce((sum, c) => sum + c.remaining, 0)
  );

  /** Загрузить подписку текущего пользователя (JWT) */
  loadMySubscription(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.authService.isAuthenticated()) return;

    this.loading.set(true);
    this.http.get<{ success: boolean; subscriptions: MySubscription[] }>('/api/subscriptions/my').subscribe({
      next: (res) => {
        const subscriptions = res.subscriptions || [];
        this.subscriptions.set(subscriptions);
        const active = subscriptions.find(s =>
          this.isManagedPrintSubscription(s) && (s.status === 'active' || s.status === 'paused')
        );
        this.currentSubscription.set(active || null);
        this.loaded = true;

        if (active) {
          this.loadCredits(active.id);
        } else {
          this.credits.set([]);
          this.loading.set(false);
        }
      },
      error: () => {
        this.subscriptions.set([]);
        this.currentSubscription.set(null);
        this.credits.set([]);
        this.loading.set(false);
        this.loaded = true;
      },
    });
  }

  /** Загрузить кредиты для подписки */
  private loadCredits(subscriptionId: string): void {
    this.http.get<{ success: boolean; credits: CreditInfo[] }>(
      `/api/subscriptions/my/credits?subscription_id=${subscriptionId}`
    ).subscribe({
      next: (res) => {
        this.credits.set(res.credits || []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Привязать подписку по телефону */
  linkByPhone(phone: string) {
    return this.http.post<{ success: boolean; subscriptions: MySubscription[] }>(
      '/api/subscriptions/link',
      { phone }
    );
  }

  isManagedPrintSubscription(subscription: MySubscription): boolean {
    return subscription.plan_category !== 'education';
  }

  /** Приостановить подписку */
  pauseSubscription(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`/api/subscriptions/${id}/pause`, {});
  }

  /** Возобновить подписку */
  resumeSubscription(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`/api/subscriptions/${id}/resume`, {});
  }

  /** Отменить подписку */
  cancelSubscription(id: string, reason?: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`/api/subscriptions/${id}/cancel`, {
      reason: reason ?? 'Отмена клиентом',
    });
  }

  /** Старт смены карты — создаёт change и externalId для 1₽-верификации виджетом */
  changeCardInit(id: string): Observable<ChangeCardInitResult> {
    return this.http.post<ChangeCardInitResult>(
      `/api/subscriptions/${id}/change-card/init`,
      {},
    );
  }

  /** Подтвердить смену карты после оплаты 1₽ (поллится фронтом до card_changed/failed) */
  changeCardConfirm(id: string, changeId: string): Observable<ChangeCardConfirmResult> {
    return this.http.post<ChangeCardConfirmResult>(
      `/api/subscriptions/${id}/change-card/confirm`,
      { changeId },
    );
  }

  /** Загрузить планы подписки */
  loadPlans(category?: string): Observable<{ success: boolean; plans: SubscriptionPlan[] }> {
    const url = category
      ? `/api/subscriptions/plans?category=${encodeURIComponent(category)}`
      : '/api/subscriptions/plans';
    return this.http.get<{ success: boolean; plans: SubscriptionPlan[] }>(url);
  }

  /** Инициировать покупку подписки (создаёт pending subscription) */
  purchase(planId: string, promoCode?: string): Observable<PurchaseResult> {
    const body: Record<string, string> = { plan_id: planId };
    if (promoCode) body['promo_code'] = promoCode;
    return this.http.post<PurchaseResult>('/api/subscriptions/purchase', body);
  }

  /** Сохранить телефон в профиль пользователя */
  savePhoneToProfile(phone: string): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>('/api/users/me', { phone });
  }

  /** Загрузить историю списаний кредитов */
  loadCreditHistory(page = 1, limit = 10) {
    return this.http.get<{ success: boolean; items: CreditHistoryEntry[]; total: number; page: number; limit: number }>(
      `/api/subscriptions/my/credit-history?page=${page}&limit=${limit}`
    );
  }

  /** Загрузить если ещё не загружено */
  ensureLoaded(): void {
    if (!this.loaded) {
      this.loadMySubscription();
    }
  }

  /** Сбросить при logout */
  reset(): void {
    this.subscriptions.set([]);
    this.currentSubscription.set(null);
    this.credits.set([]);
    this.loaded = false;
  }
}
