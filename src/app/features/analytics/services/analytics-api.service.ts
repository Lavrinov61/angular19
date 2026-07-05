import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, tap } from 'rxjs';

export interface FunnelData {
  ad_clicks?: number;
  unique_visitors?: number;
  conversions?: number;
  purchases?: number;
  // deprecated
  visitors?: number;
  leads?: number;
  clients?: number;
}

export interface ConversionItem {
  type: string;
  channel: string;
  count: number;
}

export interface ConversionsData {
  total: number;
  by_channel: ConversionItem[];
}

export interface CampaignData {
  source: string;
  campaign: string;
  ad_content?: string;
  clicks: number;
  unique_visitors: number;
  conversions?: number;
  purchases?: number;
  revenue?: number;
}

export interface RevenueData {
  total: number;
  avg_check: number;
}

export interface LocationStats {
  purchases: number;
  revenue: number;
}

export interface ConversionRates {
  visitor_to_lead: number;
  lead_to_client: number;
  visitor_to_client: number;
}

export interface AlertItem {
  level: 'error' | 'warning';
  message: string;
  metric: string;
  value: number;
}

export interface TrendData {
  clicks: number | null;
  visitors: number | null;
  purchases: number | null;
  revenue: number | null;
}

export interface TopSource {
  source: string;
  campaign?: string;
  clicks: number;
  visitors: number;
  conversions?: number;
  purchases?: number;
  revenue?: number;
  cost?: number;
  roi?: number | null;
}

export interface PeriodInfo {
  start: string;
  end: string;
  days: number;
}

export interface PurchasesByTiming {
  no_ads: { count: number; revenue: number };
  before_ads: { count: number; revenue: number };
  after_ads: { count: number; revenue: number };
}

export interface DashboardMetrics {
  success: boolean;
  period?: PeriodInfo;
  period_days?: number;  // deprecated
  trends?: TrendData;
  alerts?: AlertItem[];
  funnel: FunnelData;
  revenue: RevenueData;
  purchases: {
    count: number;
    attributed: number;
    attribution_rate: number;
    linked: number;
    linking_rate: number;
    by_timing?: PurchasesByTiming;
  };
  conversions?: ConversionsData;
  campaigns?: CampaignData[];
  conversion_rates: ConversionRates;
  top_sources: TopSource[];
  locations: Record<string, LocationStats>;
}

export type PeriodPreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export interface DateRange {
  startDate?: string;  // YYYY-MM-DD
  endDate?: string;    // YYYY-MM-DD
  preset?: PeriodPreset;
  days?: number;
}

export interface RoiReportItem {
  source?: string;
  campaign?: string;
  platform?: string;
  clicks: number;
  unique_visitors: number;
  purchases: number;
  customers: number;
  revenue: number;
  avg_check: number;
  cr_purchase: number;
  cost: number;
  roi: number | null;
  cpa: number;
}

export interface RoiReport {
  success: boolean;
  period_days: number;
  group_by: string;
  platform_filter: string | null;
  report: RoiReportItem[];
  totals: {
    clicks: number;
    unique_visitors: number;
    purchases: number;
    customers: number;
    revenue: number;
    avg_check: number;
    cr_purchase: number;
    cost?: number;
    roi?: number | null;
    cpa?: number;
  };
}

export interface LtvItem {
  source: string;
  customers: number;
  total_revenue: number;
  avg_ltv: number;
  avg_purchases: number;
  max_ltv: number;
}

export interface LtvReport {
  success: boolean;
  period_days: number;
  group_by: string;
  data: LtvItem[];
  totals: {
    customers: number;
    total_revenue: number;
    avg_ltv: number;
  };
}

// === Мультиканальная аналитика ===
export interface ChannelAttribution {
  source: string;
  source_name: string;
  total_touches: number;
  first_touch: number;
  last_touch: number;
  assist_touch: number;
  unique_customers: number;
  attribution: {
    first_click: number;
    last_click: number;
    linear: number;
    position_based: number;
  };
}

export interface CustomerJourney {
  customer_id: number;
  purchase_amount: number;
  purchase_date: string;
  touches_count: number;
  journey: {
    source: string;
    campaign: string | null;
    time: string;
  }[];
}

export interface MultichannelReport {
  success: boolean;
  period_days: number;
  channels: ChannelAttribution[];
  sample_journeys: CustomerJourney[];
  insights: {
    channels_count: number;
    multi_touch_customers: number;
    tip: string;
  };
}

// === Смены ===
export interface ShiftData {
  date: string;
  weekday: string;
  weekday_ru: string;
  location_id: string;
  location_name: string;
  cheques: number;
  revenue: number;
  work_start: string | null;
  work_end: string | null;
  work_hours: number | null;
}

export interface ShiftsReport {
  success: boolean;
  period: {
    month: string;
    month_name: string;
    year: number;
    start: string;
    end: string;
  };
  location_filter: string | null;
  shifts: ShiftData[];
  totals: {
    total_shifts: number;
    total_cheques: number;
    total_revenue: number;
    avg_cheques_per_shift: number;
    avg_revenue_per_shift: number;
  };
}

// === Антифрод ===
export interface FraudFingerprintData {
  analyzed: number;
  bots: number;
  vpns: number;
  tors: number;
  tampering: number;
  high_risk: number;
  avg_suspect_score: number;
  bot_rate: number;
  vpn_rate: number;
  high_risk_rate: number;
}

export interface FraudItem {
  ad_id: string;
  campaign_id: string;
  platform: string;
  clicks: number;
  unique_visitors: number;
  unique_ips: number;
  conversions: number;
  conversion_rate: number;
  fraud_score: number;
  reasons: string[];
  fingerprint?: FraudFingerprintData;
}

export interface FraudReport {
  success: boolean;
  period_days: number;
  min_clicks: number;
  items: FraudItem[];
  summary: {
    total_suspicious_ads: number;
    high_risk_ads: number;
    total_suspicious_clicks: number;
  };
}

// === Когортный анализ ===
export interface CohortItem {
  cohort_date: string;
  cohort_label: string;
  size: number;
  retention: number[];
}

export interface CohortReport {
  success: boolean;
  cohort_period: string;
  months: number;
  max_periods: number;
  cohorts: CohortItem[];
  avg_retention: number[];
}

// === Воронка продаж ===
export interface FunnelStep {
  step: string;
  label: string;
  count: number;
  unique?: number;
  value?: number;
  rate?: number;
}

export interface FunnelAbandonment {
  abandoned: number;
  abandoned_value: number;
  payment_failures: number;
  abandonment_rate: number;
}

export interface FunnelReport {
  success: boolean;
  period_days: number;
  funnel: FunnelStep[];
  abandonment: FunnelAbandonment;
}

// === Drill-down по кампании ===
export interface CampaignDailyData {
  date: string;
  clicks: number;
  unique_visitors: number;
  purchases: number;
  revenue: number;
  cost: number;
}

export interface CampaignAdVariant {
  utm_content: string;
  clicks: number;
  unique_visitors: number;
}

export interface CampaignDetail {
  success: boolean;
  campaign: { source: string; campaign: string };
  period_days: number;
  totals: {
    clicks: number;
    unique_visitors: number;
    purchases: number;
    revenue: number;
    cost: number;
    roi: number | null;
  };
  daily: CampaignDailyData[];
  ad_variants: CampaignAdVariant[];
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApiService {
  private http = inject(HttpClient);
  
  // Состояние загрузки
  private _loading = signal(false);
  loading = this._loading.asReadonly();
  
  // Кэш данных
  private _dashboardMetrics = signal<DashboardMetrics | null>(null);
  private _roiReport = signal<RoiReport | null>(null);
  private _ltvReport = signal<LtvReport | null>(null);
  private _shiftsReport = signal<ShiftsReport | null>(null);
  private _multichannelReport = signal<MultichannelReport | null>(null);
  private _fraudReport = signal<FraudReport | null>(null);
  private _cohortReport = signal<CohortReport | null>(null);
  private _funnelReport = signal<FunnelReport | null>(null);

  dashboardMetrics = this._dashboardMetrics.asReadonly();
  roiReport = this._roiReport.asReadonly();
  ltvReport = this._ltvReport.asReadonly();
  shiftsReport = this._shiftsReport.asReadonly();
  multichannelReport = this._multichannelReport.asReadonly();
  fraudReport = this._fraudReport.asReadonly();
  cohortReport = this._cohortReport.asReadonly();
  funnelReport = this._funnelReport.asReadonly();

  // Computed для воронки продаж
  funnelSteps = computed(() => this._funnelReport()?.funnel ?? []);
  funnelAbandonment = computed(() => this._funnelReport()?.abandonment ?? null);

  // Computed значения для быстрого доступа
  funnel = computed(() => this._dashboardMetrics()?.funnel ?? { ad_clicks: 0, unique_visitors: 0, conversions: 0, purchases: 0 });
  revenue = computed(() => this._dashboardMetrics()?.revenue ?? { total: 0, avg_check: 0 });
  topSources = computed(() => this._dashboardMetrics()?.top_sources ?? []);
  locations = computed(() => this._dashboardMetrics()?.locations ?? {});
  trends = computed(() => this._dashboardMetrics()?.trends ?? { clicks: null, visitors: null, purchases: null, revenue: null });
  alerts = computed(() => this._dashboardMetrics()?.alerts ?? []);
  
  // Покупки
  purchasesCount = computed(() => this._dashboardMetrics()?.purchases?.count ?? 0);
  purchasesAttributed = computed(() => this._dashboardMetrics()?.purchases?.attributed ?? 0);
  purchasesByTiming = computed(() => this._dashboardMetrics()?.purchases?.by_timing ?? null);
  
  // Конверсии
  conversions = computed(() => this._dashboardMetrics()?.conversions ?? { total: 0, by_channel: [] });
  totalConversions = computed(() => this._dashboardMetrics()?.conversions?.total ?? 0);
  
  // Кампании
  campaigns = computed(() => this._dashboardMetrics()?.campaigns ?? []);
  
  // Смены
  shifts = computed(() => this._shiftsReport()?.shifts ?? []);
  shiftsTotals = computed(() => this._shiftsReport()?.totals ?? null);
  shiftsPeriod = computed(() => this._shiftsReport()?.period ?? null);
  
  // Мультиканальная аналитика
  multichannelChannels = computed(() => this._multichannelReport()?.channels ?? []);
  customerJourneys = computed(() => this._multichannelReport()?.sample_journeys ?? []);
  multichannelInsights = computed(() => this._multichannelReport()?.insights ?? null);

  // Антифрод
  fraudItems = computed(() => this._fraudReport()?.items ?? []);
  fraudSummary = computed(() => this._fraudReport()?.summary ?? { total_suspicious_ads: 0, high_risk_ads: 0, total_suspicious_clicks: 0 });

  // Когорты
  cohorts = computed(() => this._cohortReport()?.cohorts ?? []);
  avgRetention = computed(() => this._cohortReport()?.avg_retention ?? []);
  cohortMaxPeriods = computed(() => this._cohortReport()?.max_periods ?? 12);
  
  // Текущий выбранный период
  private _selectedPeriod = signal<DateRange>({ preset: 'month', days: 30 });
  selectedPeriod = this._selectedPeriod.asReadonly();
  
  /**
   * Установить период
   */
  setPeriod(period: DateRange): void {
    this._selectedPeriod.set(period);
  }
  
  /**
   * Получить метрики дашборда
   */
  fetchDashboardMetrics(range?: DateRange): Observable<DashboardMetrics> {
    this._loading.set(true);
    
    const r = range ?? this._selectedPeriod();
    let url = '/api/bridge/dashboard-metrics';
    const params: string[] = [];
    
    if (r.preset && r.preset !== 'custom') {
      params.push(`period=${r.preset}`);
    } else if (r.startDate && r.endDate) {
      params.push(`start_date=${r.startDate}`);
      params.push(`end_date=${r.endDate}`);
    } else if (r.days) {
      params.push(`days=${r.days}`);
    } else {
      params.push('days=30');
    }
    
    if (params.length) {
      url += '?' + params.join('&');
    }
    
    return this.http.get<DashboardMetrics>(url).pipe(
      tap(data => {
        this._dashboardMetrics.set(data);
        this._loading.set(false);
      }),
      catchError(() => {
        this._loading.set(false);
        return of({
          success: false,
          funnel: { visitors: 0, leads: 0, clients: 0 },
          revenue: { total: 0, avg_check: 0 },
          purchases: { count: 0, attributed: 0, attribution_rate: 0, linked: 0, linking_rate: 0 },
          conversion_rates: { visitor_to_lead: 0, lead_to_client: 0, visitor_to_client: 0 },
          top_sources: [],
          locations: {}
        } as DashboardMetrics);
      })
    );
  }
  
  /**
   * Получить ROI отчёт
   */
  fetchRoiReport(days = 30, groupBy = 'source', platform?: string): Observable<RoiReport> {
    this._loading.set(true);
    
    let url = `/api/bridge/roi-report?days=${days}&group_by=${groupBy}`;
    if (platform) {
      url += `&platform=${platform}`;
    }
    
    return this.http.get<RoiReport>(url).pipe(
      tap(data => {
        this._roiReport.set(data);
        this._loading.set(false);
      }),
      catchError(() => {
        this._loading.set(false);
        return of({
          success: false,
          period_days: days,
          group_by: groupBy,
          platform_filter: platform ?? null,
          report: [],
          totals: { clicks: 0, unique_visitors: 0, purchases: 0, customers: 0, revenue: 0, avg_check: 0, cr_purchase: 0 }
        } as RoiReport);
      })
    );
  }
  
  /**
   * Получить LTV отчёт
   */
  fetchLtvReport(days = 90, groupBy = 'source'): Observable<LtvReport> {
    this._loading.set(true);
    
    return this.http.get<LtvReport>(`/api/bridge/customer-ltv?days=${days}&group_by=${groupBy}`).pipe(
      tap(data => {
        this._ltvReport.set(data);
        this._loading.set(false);
      }),
      catchError(() => {
        this._loading.set(false);
        return of({
          success: false,
          period_days: days,
          group_by: groupBy,
          data: [],
          totals: { customers: 0, total_revenue: 0, avg_ltv: 0 }
        } as LtvReport);
      })
    );
  }
  
  /**
   * Получить статистику по сменам
   */
  fetchShiftsReport(month?: string, locationId?: string): Observable<ShiftsReport> {
    this._loading.set(true);
    
    const params: string[] = [];
    if (month) {
      params.push(`month=${month}`);
    }
    if (locationId) {
      params.push(`location_id=${locationId}`);
    }
    
    let url = '/api/bridge/shifts-stats';
    if (params.length) {
      url += '?' + params.join('&');
    }
    
    return this.http.get<ShiftsReport>(url).pipe(
      tap(data => {
        this._shiftsReport.set(data);
        this._loading.set(false);
      }),
      catchError(() => {
        this._loading.set(false);
        return of({
          success: false,
          period: { month: '', month_name: '', year: 0, start: '', end: '' },
          location_filter: null,
          shifts: [],
          totals: { total_shifts: 0, total_cheques: 0, total_revenue: 0, avg_cheques_per_shift: 0, avg_revenue_per_shift: 0 }
        } as ShiftsReport);
      })
    );
  }
  
  /**
   * Получить мультиканальную аналитику
   */
  fetchMultichannelReport(days = 30): Observable<MultichannelReport> {
    this._loading.set(true);
    
    return this.http.get<MultichannelReport>(`/api/bridge/multichannel-attribution?days=${days}`).pipe(
      tap(data => {
        this._multichannelReport.set(data);
        this._loading.set(false);
      }),
      catchError(() => {
        this._loading.set(false);
        return of({
          success: false,
          period_days: days,
          channels: [],
          sample_journeys: [],
          insights: { channels_count: 0, multi_touch_customers: 0, tip: '' }
        } as MultichannelReport);
      })
    );
  }
  
  /**
   * Получить отчёт по антифроду
   */
  fetchFraudReport(days = 30, minClicks = 5): Observable<FraudReport> {
    return this.http.get<FraudReport>(`/api/bridge/fraud-report?days=${days}&min_clicks=${minClicks}`).pipe(
      tap(data => this._fraudReport.set(data)),
      catchError(() => {
        return of({
          success: false,
          period_days: days,
          min_clicks: minClicks,
          items: [],
          summary: { total_suspicious_ads: 0, high_risk_ads: 0, total_suspicious_clicks: 0 }
        } as FraudReport);
      })
    );
  }

  /**
   * Получить когортный анализ
   */
  fetchCohortReport(months = 3, cohortPeriod = 'week'): Observable<CohortReport> {
    return this.http.get<CohortReport>(
      `/api/bridge/cohort-analysis?months=${months}&cohort_period=${cohortPeriod}`
    ).pipe(
      tap(data => this._cohortReport.set(data)),
      catchError(() => {
        return of({
          success: false,
          cohort_period: cohortPeriod,
          months,
          max_periods: 12,
          cohorts: [],
          avg_retention: [],
        } as CohortReport);
      })
    );
  }

  /**
   * Воронка продаж
   */
  fetchFunnelReport(days = 30): Observable<FunnelReport> {
    return this.http.get<FunnelReport>(`/api/bridge/funnel-report?days=${days}`).pipe(
      tap(data => this._funnelReport.set(data)),
      catchError(() => {
        return of({
          success: false,
          period_days: days,
          funnel: [],
          abandonment: { abandoned: 0, abandoned_value: 0, payment_failures: 0, abandonment_rate: 0 },
        } as FunnelReport);
      })
    );
  }

  /**
   * Получить детали кампании (drill-down)
   */
  fetchCampaignDetails(source: string, campaign: string, days = 30): Observable<CampaignDetail> {
    return this.http.get<CampaignDetail>(
      `/api/bridge/campaign-details?source=${encodeURIComponent(source)}&campaign=${encodeURIComponent(campaign)}&days=${days}`
    ).pipe(
      catchError(() => {
        return of({
          success: false,
          campaign: { source, campaign },
          period_days: days,
          totals: { clicks: 0, unique_visitors: 0, purchases: 0, revenue: 0, cost: 0, roi: null },
          daily: [],
          ad_variants: [],
        } as CampaignDetail);
      })
    );
  }

  /**
   * Обновить все данные
   */
  refreshAll(days = 30): void {
    this.fetchDashboardMetrics({ days }).subscribe();
    this.fetchRoiReport(days).subscribe();
    this.fetchLtvReport(days * 3).subscribe(); // LTV за более длительный период
    this.fetchShiftsReport().subscribe(); // Текущий месяц
    this.fetchMultichannelReport(days).subscribe();
  }
}

