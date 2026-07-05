import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { SubscriptionService } from './subscription.service';
import { BookingApiService, Booking } from './booking-api.service';
import { AuthService } from './auth.service';
import { LoyaltyProfile, Achievement } from '../../shared/interfaces/loyalty.interfaces';
import { buildMiniProfile } from '../../shared/utils/loyalty.utils';
import { OrderHistory } from '../../core/models/order-history.model';
import { OrdersHistoryApiResponse, mapRawOrders } from '../utils/order-mapping.utils';

export interface DashboardData {
  loyaltyProfile: LoyaltyProfile | null;
  achievements: Achievement[];
  recentOrders: OrderHistory[];
  upcomingBookings: Booking[];
}

export type CashbackCategoryKey =
  | 'documents'
  | 'photos'
  | 'id-photo'
  | 'restoration'
  | 'photoshoot'
  | 'albums';

export interface CashbackCategoryApiOption {
  key: CashbackCategoryKey;
  title: string;
  ratePercent: number;
  description: string;
}

export interface CashbackSelection {
  categoryKey: CashbackCategoryKey;
  selectedAt: string;
  periodMonth: string;
}

export interface CashbackState {
  ratePercent: number;
  periodMonth: string;
  selection: CashbackSelection | null;
  categories: readonly CashbackCategoryApiOption[];
}

export type LoyaltyBenefitSummaryMode = 'earned' | 'spent';

export type LoyaltyBenefitBreakdownKey =
  | 'cashback'
  | 'referrals'
  | 'orders'
  | 'adjustments'
  | 'other';

export interface LoyaltyBenefitBreakdownItem {
  key: LoyaltyBenefitBreakdownKey;
  label: string;
  amount: number;
  color: string;
}

export interface LoyaltyBenefitMonth {
  periodMonth: string;
  label: string;
  earned: number;
  spent: number;
  cashback: number;
  referrals: number;
  otherEarned: number;
  orderSpent: number;
  adjustmentSpent: number;
  otherSpent: number;
}

export interface LoyaltyBenefitSummary {
  profileId: string;
  currentBalancePoints: number;
  currentBalanceRubles: number;
  conversionRate: number;
  currentMonth: LoyaltyBenefitMonth;
  months: readonly LoyaltyBenefitMonth[];
  earnedBreakdown: readonly LoyaltyBenefitBreakdownItem[];
  spentBreakdown: readonly LoyaltyBenefitBreakdownItem[];
}

interface LoyaltyApiPayload {
  profile: LoyaltyProfile | null;
  achievements: Achievement[];
}

interface LoyaltyApiResponse {
  success: boolean;
  data: LoyaltyApiPayload;
}

interface CashbackApiResponse {
  success: boolean;
  data: CashbackState;
}

interface LoyaltyBenefitSummaryApiResponse {
  success: boolean;
  data: LoyaltyBenefitSummary;
}

@Injectable({ providedIn: 'root' })
export class ProfileDashboardService {
  private readonly http = inject(HttpClient);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly bookingApiService = inject(BookingApiService);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly loading = signal(false);
  readonly dashboardData = signal<DashboardData | null>(null);
  readonly error = signal<string | null>(null);

  readonly loyaltySummary = computed(() => {
    const profile = this.dashboardData()?.loyaltyProfile;
    return profile ? buildMiniProfile(profile) : null;
  });

  readonly hasData = computed(() => this.dashboardData() !== null);

  loadDashboard(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.loading()) return;

    const userId = this.authService.getCurrentUser()?.id;
    if (!userId) return;

    this.loading.set(true);
    this.error.set(null);

    // Инициируем загрузку подписки (idempotent, не блокируем forkJoin)
    this.subscriptionService.ensureLoaded();

    forkJoin({
      loyalty: this.http.get<LoyaltyApiResponse>('/api/loyalty/profile').pipe(
        map(res => res.data ?? ({ profile: null, achievements: [] } as LoyaltyApiPayload)),
        catchError(() => of({ profile: null, achievements: [] } as LoyaltyApiPayload))
      ),
      recentOrders: this.http.get<OrdersHistoryApiResponse>('/api/orders/my-history?limit=3').pipe(
        map(res => mapRawOrders(res.data ?? [], userId)),
        catchError(() => of([] as OrderHistory[]))
      ),
      upcomingBookings: this.bookingApiService.getClientBookings(userId).pipe(
        map(response => {
          const now = new Date();
          return (response.data ?? [])
            .filter(b =>
              (b.status === 'pending' || b.status === 'confirmed') &&
              new Date(b.bookingDate ?? b.date) >= now
            )
            .slice(0, 3);
        }),
        catchError(() => of([] as Booking[]))
      ),
    }).subscribe({
      next: ({ loyalty, recentOrders, upcomingBookings }) => {
        this.dashboardData.set({
          loyaltyProfile: loyalty.profile,
          achievements: loyalty.achievements ?? [],
          recentOrders,
          upcomingBookings,
        });
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Ошибка загрузки данных дашборда');
        this.loading.set(false);
      },
    });
  }

  getCashbackState(): Observable<CashbackState> {
    return this.http.get<CashbackApiResponse>('/api/loyalty/cashback').pipe(
      map(res => res.data),
    );
  }

  selectCashbackCategory(categoryKey: CashbackCategoryKey): Observable<CashbackState> {
    return this.http.post<CashbackApiResponse>('/api/loyalty/cashback/selection', { categoryKey }).pipe(
      map(res => res.data),
    );
  }

  getBenefitSummary(months = 6): Observable<LoyaltyBenefitSummary> {
    return this.http.get<LoyaltyBenefitSummaryApiResponse>('/api/loyalty/benefit-summary', {
      params: { months: String(months) },
    }).pipe(
      map(res => res.data),
    );
  }

  reset(): void {
    this.dashboardData.set(null);
    this.error.set(null);
    this.loading.set(false);
  }
}
