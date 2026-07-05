import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PrintingHouse {
  id: string;
  name: string;
  code: string;
  status: 'active' | 'inactive' | 'testing';
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  api_type: 'manual' | 'api' | 'email';
  capabilities: string[];
  delivery_zones: string[];
  min_order_amount: number;
  quality_score: number;
  on_time_rate: number;
  defect_rate: number;
  total_orders: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
}

export interface PrintingHouseProduct {
  id: string;
  printing_house_id: string;
  printing_house_name?: string;
  name: string;
  category: string;
  sku: string | null;
  description: string | null;
  base_price: number;
  price_unit: string;
  min_quantity: number;
  available_formats: string[];
  available_materials: string[];
  options: Record<string, unknown>;
  lead_time_days: number;
  express_available: boolean;
  express_surcharge_pct: number;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ProductionOrderStatus =
  | 'draft' | 'pending' | 'sent' | 'confirmed' | 'in_production'
  | 'quality_check' | 'shipped' | 'delivered' | 'completed'
  | 'cancelled' | 'returned';

export interface ProductionOrderItem {
  product_id: string;
  product_name: string;
  category?: string;
  specs: Record<string, unknown>;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface ProductionOrder {
  id: string;
  order_number: string;
  printing_house_id: string;
  printing_house_name?: string;
  photo_print_order_id: string | null;
  photo_print_order_number?: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  created_by: string;
  created_by_name?: string;
  status: ProductionOrderStatus;
  items: ProductionOrderItem[];
  total_cost: number;
  deadline_at: string | null;
  estimated_delivery_at: string | null;
  actual_delivery_at: string | null;
  delivery_method: 'pickup' | 'courier' | 'post';
  tracking_number: string | null;
  quality_rating: number | null;
  quality_notes: string | null;
  has_defects: boolean;
  internal_notes: string | null;
  printing_house_notes: string | null;
  sent_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionOrderEvent {
  id: string;
  production_order_id: string;
  event_type: 'created' | 'status_change' | 'note_added' | 'quality_review' | 'deadline_changed';
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface ProductionAnalytics {
  spending_by_house: { house_id: string; house_name: string; total: number; order_count: number }[];
  spending_by_category: { category: string; total: number; order_count: number }[];
  delivery_performance: { on_time_pct: number; avg_delay_days: number; total_orders: number };
  quality_metrics: { avg_rating: number; defect_rate: number; reprint_count: number };
  monthly_trends: { month: string; total_cost: number; order_count: number }[];
  status_distribution: { status: string; count: number }[];
}

export interface HousePerformance {
  house: PrintingHouse;
  orders_last_30d: number;
  orders_last_90d: number;
  avg_lead_time_days: number;
  on_time_pct: number;
  defect_rate: number;
  avg_quality_rating: number;
  total_spent: number;
  monthly_trend: { month: string; total: number; count: number }[];
}

export interface HouseRecommendation {
  house_id: string;
  house_name: string;
  category: string;
  reason: string;
  confidence: number;
  avg_price: number;
  avg_lead_days: number;
  quality_score: number;
}

export interface CostOptimization {
  type: 'switch_house' | 'batch_orders' | 'negotiate' | 'seasonal';
  title: string;
  description: string;
  potential_savings: number;
  priority: 'high' | 'medium' | 'low';
}

export interface DemandForecastItem {
  category: string;
  week_label: string;
  predicted_orders: number;
  confidence: number;
}

export interface QualityAlert {
  house_id: string;
  house_name: string;
  alert_type: 'defect_spike' | 'delay_increase' | 'rating_drop';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  metric_value: number;
  threshold: number;
}

export interface ProductionAiInsights {
  recommendations: HouseRecommendation[];
  cost_optimizations: CostOptimization[];
  demand_forecast: DemandForecastItem[];
  quality_alerts: QualityAlert[];
  generated_at: string;
}

// ─── Reference Data ───────────────────────────────────────────────────────────

export interface ProductReferenceData {
  id: string;
  ref_type: string;
  ref_key: string;
  display_name: string;
  category_scope: string[];
  metadata: Record<string, unknown>;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface PriceModifierItem {
  type: 'absolute' | 'percent' | 'multiplier';
  value: number;
  lead_time_delta?: number;
}

export interface PriceCalculation {
  base_price: number;
  modifiers: { key: string; label: string; modifier: PriceModifierItem; delta: number }[];
  final_price: number;
  base_lead_time: number;
  final_lead_time: number;
}

/** Конфигурация атрибута для категории продукта */
export interface CategoryAttributeConfig {
  /** Ключ в options JSONB (sizes, bindings, papers, ...) */
  key: string;
  /** Тип атрибута */
  type: 'multiselect' | 'range' | 'boolean';
  /** ref_type в product_reference_data (null для range и boolean) */
  refType: string | null;
  /** Отображаемое название */
  label: string;
  /** Обязателен ли */
  required?: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ProductionApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/production';

  // Houses
  getHouses(status?: string): Observable<PrintingHouse[]> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    return this.http.get<{ success: boolean; data: PrintingHouse[] }>(`${this.base}/houses`, { params })
      .pipe(map(r => r.data));
  }

  getHouse(id: string): Observable<PrintingHouse> {
    return this.http.get<{ success: boolean; data: PrintingHouse }>(`${this.base}/houses/${id}`)
      .pipe(map(r => r.data));
  }

  createHouse(data: Partial<PrintingHouse>): Observable<PrintingHouse> {
    return this.http.post<{ success: boolean; data: PrintingHouse }>(`${this.base}/houses`, data)
      .pipe(map(r => r.data));
  }

  updateHouse(id: string, data: Partial<PrintingHouse>): Observable<PrintingHouse> {
    return this.http.patch<{ success: boolean; data: PrintingHouse }>(`${this.base}/houses/${id}`, data)
      .pipe(map(r => r.data));
  }

  deleteHouse(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/houses/${id}`);
  }

  // Products
  getProducts(houseId: string): Observable<PrintingHouseProduct[]> {
    return this.http.get<{ success: boolean; data: PrintingHouseProduct[] }>(`${this.base}/houses/${houseId}/products`)
      .pipe(map(r => r.data));
  }

  getAllProducts(): Observable<PrintingHouseProduct[]> {
    return this.http.get<{ success: boolean; data: PrintingHouseProduct[] }>(`${this.base}/products`)
      .pipe(map(r => r.data));
  }

  compareProducts(category: string): Observable<PrintingHouseProduct[]> {
    return this.http.get<{ success: boolean; data: PrintingHouseProduct[] }>(`${this.base}/products/compare/${category}`)
      .pipe(map(r => r.data));
  }

  createProduct(houseId: string, data: Partial<PrintingHouseProduct>): Observable<PrintingHouseProduct> {
    return this.http.post<{ success: boolean; data: PrintingHouseProduct }>(`${this.base}/houses/${houseId}/products`, data)
      .pipe(map(r => r.data));
  }

  updateProduct(id: string, data: Partial<PrintingHouseProduct>): Observable<PrintingHouseProduct> {
    return this.http.patch<{ success: boolean; data: PrintingHouseProduct }>(`${this.base}/products/${id}`, data)
      .pipe(map(r => r.data));
  }

  deleteProduct(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/products/${id}`);
  }

  // Orders
  getOrders(params: {
    status?: string;
    printing_house_id?: string;
    from?: string;
    to?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Observable<{ data: ProductionOrder[]; total: number }> {
    const q: Record<string, string> = {};
    if (params.status) q['status'] = params.status;
    if (params.printing_house_id) q['printing_house_id'] = params.printing_house_id;
    if (params.from) q['from'] = params.from;
    if (params.to) q['to'] = params.to;
    if (params.search) q['search'] = params.search;
    if (params.limit != null) q['limit'] = String(params.limit);
    if (params.offset != null) q['offset'] = String(params.offset);
    return this.http.get<{ success: boolean; data: { orders: ProductionOrder[]; total: number } }>(`${this.base}/orders`, { params: q })
      .pipe(map(r => ({ data: r.data.orders, total: r.data.total })));
  }

  getOrder(id: string): Observable<ProductionOrder> {
    return this.http.get<{ success: boolean; data: ProductionOrder }>(`${this.base}/orders/${id}`)
      .pipe(map(r => r.data));
  }

  createOrder(data: {
    printing_house_id: string;
    items: ProductionOrderItem[];
    deadline_at?: string;
    delivery_method?: string;
    internal_notes?: string;
    photo_print_order_id?: string;
  }): Observable<ProductionOrder> {
    return this.http.post<{ success: boolean; data: ProductionOrder }>(`${this.base}/orders`, data)
      .pipe(map(r => r.data));
  }

  updateOrderStatus(id: string, status: ProductionOrderStatus, comment?: string): Observable<ProductionOrder> {
    return this.http.patch<{ success: boolean; data: ProductionOrder }>(`${this.base}/orders/${id}/status`, { status, comment })
      .pipe(map(r => r.data));
  }

  updateOrder(id: string, data: Partial<ProductionOrder>): Observable<ProductionOrder> {
    return this.http.patch<{ success: boolean; data: ProductionOrder }>(`${this.base}/orders/${id}`, data)
      .pipe(map(r => r.data));
  }

  batchUpdateStatus(ids: string[], status: ProductionOrderStatus): Observable<{ updated: number }> {
    return this.http.post<{ success: boolean; data: { updated: number } }>(`${this.base}/orders/batch-status`, { ids, status })
      .pipe(map(r => r.data));
  }

  cancelOrder(id: string, reason?: string): Observable<ProductionOrder> {
    return this.http.post<{ success: boolean; data: ProductionOrder }>(`${this.base}/orders/${id}/cancel`, { reason })
      .pipe(map(r => r.data));
  }

  rateQuality(id: string, rating: number, notes?: string, has_defects?: boolean): Observable<ProductionOrder> {
    return this.http.post<{ success: boolean; data: ProductionOrder }>(`${this.base}/orders/${id}/quality`, { rating, notes, has_defects })
      .pipe(map(r => r.data));
  }

  getTimeline(id: string): Observable<ProductionOrderEvent[]> {
    return this.http.get<{ success: boolean; data: ProductionOrderEvent[] }>(`${this.base}/orders/${id}/timeline`)
      .pipe(map(r => r.data));
  }

  getOrdersByPhotoOrder(photoOrderId: string): Observable<ProductionOrder[]> {
    return this.http.get<{ success: boolean; data: ProductionOrder[] }>(`${this.base}/orders/by-photo-order/${photoOrderId}`)
      .pipe(map(r => r.data));
  }

  // Analytics
  getAnalytics(params: { from?: string; to?: string } = {}): Observable<ProductionAnalytics> {
    return this.http.get<{ success: boolean; data: ProductionAnalytics }>(`${this.base}/analytics`, { params })
      .pipe(map(r => r.data));
  }

  getHousePerformance(houseId: string): Observable<HousePerformance> {
    return this.http.get<{ success: boolean; data: HousePerformance }>(`${this.base}/analytics/house/${houseId}`)
      .pipe(map(r => r.data));
  }

  // AI
  getAiInsights(): Observable<ProductionAiInsights> {
    return this.http.get<{ success: boolean; data: ProductionAiInsights }>(`${this.base}/ai/insights`)
      .pipe(map(r => r.data));
  }

  // Reference Data
  getReferenceData(refType?: string, category?: string): Observable<ProductReferenceData[]> {
    const params: Record<string, string> = {};
    if (refType) params['type'] = refType;
    if (category) params['category'] = category;
    return this.http.get<{ success: boolean; data: ProductReferenceData[] }>(`${this.base}/reference-data`, { params })
      .pipe(map(r => r.data));
  }

  createReferenceDataItem(data: Omit<ProductReferenceData, 'id' | 'created_at'>): Observable<ProductReferenceData> {
    return this.http.post<{ success: boolean; data: ProductReferenceData }>(`${this.base}/reference-data`, data)
      .pipe(map(r => r.data));
  }

  updateReferenceDataItem(id: string, data: Partial<ProductReferenceData>): Observable<ProductReferenceData> {
    return this.http.patch<{ success: boolean; data: ProductReferenceData }>(`${this.base}/reference-data/${id}`, data)
      .pipe(map(r => r.data));
  }

  deleteReferenceDataItem(id: string): Observable<void> {
    return this.http.delete<{ success: boolean }>(`${this.base}/reference-data/${id}`)
      .pipe(map(() => void 0));
  }

  calculatePrice(productId: string, specs: Record<string, unknown>): Observable<PriceCalculation> {
    return this.http.post<{ success: boolean; data: PriceCalculation }>(`${this.base}/products/${productId}/calculate-price`, { specs })
      .pipe(map(r => r.data));
  }

  // Send email
  sendOrderEmail(orderId: string, data: {
    printing_house_notes?: string;
    file_uuids?: string[];
  }): Observable<{ emailId: number; orderStatus: string }> {
    return this.http.post<{ success: boolean; data: { emailId: number; orderStatus: string } }>(
      `${this.base}/orders/${orderId}/send-email`, data,
    ).pipe(map(r => r.data));
  }

  // Create from POS receipt
  createOrderFromReceipt(data: {
    receipt_id: string;
    printing_house_id?: string;
  }): Observable<ProductionOrder> {
    return this.http.post<{ success: boolean; data: ProductionOrder }>(
      `${this.base}/orders/from-receipt`, data,
    ).pipe(map(r => r.data));
  }
}

export interface CrmFile {
  id: number;
  uuid: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
}
