import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// ── Интерфейсы ────────────────────────────────────────────────────────────

export interface AdminServiceOption {
  id: string;
  option_group_id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  base_price: number;
  price_online: number | null;
  price_studio: number | null;
  price_next_unit: number | null;
  price_max: number | null;
  promo_first_price: number | null;
  promo_description: string | null;
  features: string[];
  popular: boolean;
  original_price: number | null;
  discount_percent: number | null;
  satisfies_requires: boolean;
  sort_order: number;
  is_active: boolean;
  product_id: string | null;
}

export interface AdminOptionGroup {
  id: string;
  service_category_id: string;
  slug: string;
  name: string;
  description: string | null;
  selection_type: 'single' | 'multi' | 'quantity';
  is_required: boolean;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  is_active: boolean;
  options: AdminServiceOption[];
}

export interface AdminPricingCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  gradient: string | null;
  image_url: string | null;
  price_range: string | null;
  display_channels: string[];
  valid_delivery_methods: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  option_groups: AdminOptionGroup[];
}

export interface AdminOptionRule {
  id: string;
  service_category_id: string;
  rule_type: 'requires' | 'excludes' | 'includes' | 'price_override';
  source_option_id: string;
  source_option_slug: string;
  source_option_name: string;
  target_option_id: string;
  target_option_slug: string;
  target_option_name: string;
  override_price: number | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PricingSnapshot {
  id: string;
  entity_type: string;
  entity_id: string;
  changed_by: string | null;
  changed_by_email: string | null;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  reason: string | null;
  created_at: string;
}

interface DynamicConfigResponse {
  success: boolean;
  config?: Record<string, unknown>;
  configs?: Record<string, unknown>;
}

// ── Сервис ────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PricingAdminApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/pricing/admin';

  // ── Категории ──────────────────────────────────────────────────────────

  /** Полное дерево: категории → группы → опции, включая неактивные */
  getCategoriesFull(): Observable<AdminPricingCategory[]> {
    return this.http
      .get<{ success: boolean; categories: AdminPricingCategory[] }>(`${this.base}/categories/full`)
      .pipe(map(r => r.categories));
  }

  createCategory(data: Partial<AdminPricingCategory>): Observable<AdminPricingCategory> {
    return this.http
      .post<{ success: boolean; category: AdminPricingCategory }>(`${this.base}/categories`, data)
      .pipe(map(r => r.category));
  }

  updateCategory(id: string, data: Partial<AdminPricingCategory>): Observable<AdminPricingCategory> {
    return this.http
      .patch<{ success: boolean; category: AdminPricingCategory }>(`${this.base}/categories/${id}`, data)
      .pipe(map(r => r.category));
  }

  deleteCategory(id: string): Observable<void> {
    return this.http.delete<{ success: boolean }>(`${this.base}/categories/${id}`).pipe(map(() => undefined));
  }

  // ── Группы опций ───────────────────────────────────────────────────────

  createOptionGroup(data: Partial<AdminOptionGroup>): Observable<AdminOptionGroup> {
    return this.http
      .post<{ success: boolean; optionGroup: AdminOptionGroup }>(`${this.base}/option-groups`, data)
      .pipe(map(r => r.optionGroup));
  }

  updateOptionGroup(id: string, data: Partial<AdminOptionGroup>): Observable<AdminOptionGroup> {
    return this.http
      .patch<{ success: boolean; optionGroup: AdminOptionGroup }>(`${this.base}/option-groups/${id}`, data)
      .pipe(map(r => r.optionGroup));
  }

  deleteOptionGroup(id: string): Observable<void> {
    return this.http.delete<{ success: boolean }>(`${this.base}/option-groups/${id}`).pipe(map(() => undefined));
  }

  // ── Опции ──────────────────────────────────────────────────────────────

  createOption(data: Partial<AdminServiceOption>): Observable<AdminServiceOption> {
    return this.http
      .post<{ success: boolean; option: AdminServiceOption }>(`${this.base}/options`, data)
      .pipe(map(r => r.option));
  }

  updateOption(id: string, data: Partial<AdminServiceOption>): Observable<AdminServiceOption> {
    return this.http
      .patch<{ success: boolean; option: AdminServiceOption }>(`${this.base}/options/${id}`, data)
      .pipe(map(r => r.option));
  }

  deleteOption(id: string): Observable<void> {
    return this.http.delete<{ success: boolean }>(`${this.base}/options/${id}`).pipe(map(() => undefined));
  }

  // ── Правила ────────────────────────────────────────────────────────────

  getRules(categoryId: string): Observable<AdminOptionRule[]> {
    const params = new HttpParams().set('category_id', categoryId);
    return this.http
      .get<{ success: boolean; rules: AdminOptionRule[] }>(`${this.base}/rules`, { params })
      .pipe(map(r => r.rules));
  }

  createRule(data: Partial<AdminOptionRule>): Observable<AdminOptionRule> {
    return this.http
      .post<{ success: boolean; rule: AdminOptionRule }>(`${this.base}/rules`, data)
      .pipe(map(r => r.rule));
  }

  deleteRule(id: string): Observable<void> {
    return this.http.delete<{ success: boolean }>(`${this.base}/rules/${id}`).pipe(map(() => undefined));
  }

  // ── Dynamic Config (себестоимость) ─────────────────────────────────────

  getDynamicConfigs(): Observable<Record<string, unknown>> {
    return this.http
      .get<DynamicConfigResponse>(`${this.base}/dynamic-config`)
      .pipe(map(r => r.config ?? r.configs ?? {}));
  }

  updateDynamicConfig(key: string, configValue: Record<string, unknown>): Observable<unknown> {
    return this.http.patch(`${this.base}/dynamic-config/${key}`, { config_value: configValue });
  }

  // ── Аудит ──────────────────────────────────────────────────────────────

  getAudit(params?: { entity_type?: string; limit?: number; offset?: number }): Observable<PricingSnapshot[]> {
    let httpParams = new HttpParams();
    if (params?.entity_type) httpParams = httpParams.set('entity_type', params.entity_type);
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));
    return this.http
      .get<{ success: boolean; snapshots: PricingSnapshot[] }>(`${this.base}/audit`, { params: httpParams })
      .pipe(map(r => r.snapshots));
  }
}
