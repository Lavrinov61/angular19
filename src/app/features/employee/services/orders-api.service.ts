import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from '../../../core/services/api.service';
import type { RetouchConfigEvent } from '../../../shared/components/retouch-configurator/retouch-configurator.component';

export interface OrderItemFeatureBreakdown {
  name: string;
  price: number;
  is_disabled: boolean;
  is_inherited: boolean;
  origin_tier_index: number;
}

export interface PhotoPrintOrderItem {
  // Заказы с лендинга /pechat-foto
  uploadedUrl?: string;
  format?: string;       // '10x15', '10x15_super', '15x20', '20x30', etc.
  paperType?: string;    // 'premium' | 'super'
  quantity?: number;
  margins?: string;      // 'none' | '3mm'
  border?: string;
  // Заказы из чата / PaymentDialog
  slug?: string;         // service_option slug for repeat order (F58)
  service?: string;
  tariff?: string;
  price?: number;
  document?: string;
  description?: string;
  name?: string;
  // Inline edit (P2 deferred): order_items.id + service_option_id для PATCH
  id?: string;
  service_option_id?: string | null;
  // Feature-Level Pricing
  disabled_features?: string[];
  features_breakdown?: OrderItemFeatureBreakdown[];
}

export interface OrderItemDetail {
  id: string;
  service_option_id: string | null;
  features_breakdown?: OrderItemFeatureBreakdown[];
  disabled_features?: string[];
  unit_price?: number;
  subtotal?: number;
  quantity?: number;
  name?: string;
}

export interface WalkInOrderItem {
  name: string;
  slug?: string;
  service_option_id?: string;
  uploadedUrl?: string;
  quantity: number;
  sla_quantity?: number;
  price: number;
  options?: string[];
}

export interface CreateWalkInOrderRequest {
  items: WalkInOrderItem[];
  client_name?: string;
  client_phone?: string;
  client_email?: string;
  total_price: number;
  payment_method?: 'cash' | 'card' | 'sbp';
  comment?: string;
  studio_id?: string;
  document_template_id?: string;
  photo_size?: string;
  medals_required?: boolean;
  medals_description?: string;
  uniform_description?: string;
  wishes?: string;
}

export interface PhotoPrintOrder {
  id: string;
  order_id: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  total_price: number;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  payment_channel?: string | null;
  payment_event_type?: string | null;
  payment_recorded_at?: string | null;
  payment_recorded_by?: string | null;
  payment_recorded_by_name?: string | null;
  priority: string;
  items: PhotoPrintOrderItem[];
  comments: string | null;
  delivery_address: string | null;
  delivery_cost: number | null;
  /** Способ получения заказа: самовывоз или курьерская доставка (staff-list SELECT, см. delivery-доска). */
  delivery_method?: 'pickup' | 'courier' | null;
  /** Провайдер курьерской доставки (напр. 'yandex'); присутствует при delivery_method='courier'. */
  delivery_provider?: string | null;
  tracking_number: string | null;
  receipt_url: string | null;
  payment_card_info: string | null;
  telegram_username: string | null;
  promo_code: string | null;
  promo_discount: number | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  completed_at: string | null;
  processing_started_at?: string | null;
  processing_duration_minutes?: number | null;
  assigned_employee_id: string | null;
  assigned_at: string | null;
  assigned_employee_name?: string;
  chat_session_id: string | null;
  reminder_sent_at: string | null;
  deadline?: string;
  photo_url?: string | null;
  resolved_user_id?: string | null;
  resolved_phone?: string | null;
  escalation_level?: number;
  description?: string | null;
  source?: string | null;
  wishes?: string | null;
  medals_required?: boolean | null;
  medals_description?: string | null;
  uniform_description?: string | null;
  document_template_id?: string | null;
  document_template_name?: string | null;
  photo_size?: string | null;
  order_studio_id?: string | null;
  order_studio_name?: string | null;
  order_studio_address?: string | null;
  order_location_code?: string | null;
}

export interface OrderAttachment {
  id: string;
  s3_url: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  attachment_type: string;
  sort_order: number;
  created_at: string;
}

export interface OrdersListParams {
  scope?: 'active' | 'archive';
  sales_scope?: 'mine';
  status?: string;
  payment_status?: string;
  priority?: string;
  search?: string;
  chat_session_id?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedOrdersResponse {
  success: boolean;
  data: PhotoPrintOrder[];
  total: number;
  /** Сколько «зависших» (неоплаченных старше порога) заказов — для счётчика вкладки. */
  staleTotal?: number;
  page: number;
  limit: number;
}

export type EditPhotoPrintOrderRequest = Partial<Pick<
  PhotoPrintOrder,
  | 'contact_name'
  | 'contact_phone'
  | 'contact_email'
  | 'delivery_address'
  | 'comments'
  | 'tracking_number'
  | 'priority'
  | 'chat_session_id'
  | 'wishes'
  | 'medals_required'
  | 'medals_description'
  | 'uniform_description'
  | 'document_template_id'
  | 'photo_size'
>>;

export interface CrmCreateOrderRequest {
  items: {
    name: string;
    slug?: string;
    service_option_id?: string;
    quantity?: number;
    sla_quantity?: number;
    price: number;
    options?: Record<string, unknown>;
    /** Feature-Level Pricing: имена отключённых неунаследованных фич tier'а */
    disabled_features?: string[];
  }[];
  sla_items?: {
    service_option_id: string;
    quantity?: number;
    sla_quantity?: number;
  }[];
  total_price: number;
  description?: string;
  client_name?: string;
  client_phone?: string;
  client_email?: string;
  contact_id?: string;
  chat_session_id?: string;
  assigned_employee_id?: string;
  studio_id?: string;
  deadline_at?: string;
  priority?: 'normal' | 'urgent' | 'vip';
  comment?: string;
  source?: 'crm' | 'chat' | 'phone' | 'walk_in';
  payment_method?: 'cash' | 'card' | 'sbp' | 'online' | 'later';
  promo_code?: string;
  /** Конфигуратор «Супер обработки»: бесплатные галочки-инструкции ретушёру (только processing-super). */
  retouch_config?: RetouchConfigEvent;
  wishes?: string;
  medals_required?: boolean;
  medals_description?: string;
  uniform_description?: string;
  document_template_id?: string;
  photo_size?: string;
}

export interface CrmCreateOrderResponse {
  orderId: string;
  orderNumber: string;
  taskId?: string;
}

export interface StaffMember {
  id: string;
  display_name: string;
  photo_url: string | null;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/orders/photo-print';

  getOrders(params?: OrdersListParams): Observable<PaginatedOrdersResponse> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          httpParams = httpParams.set(key, String(value));
        }
      });
    }
    return this.http.get<PaginatedOrdersResponse>(`${this.baseUrl}/staff-list`, { params: httpParams });
  }

  updateStatus(
    orderId: string,
    status: string,
    options?: { override_location?: boolean },
  ): Observable<ApiResponse<PhotoPrintOrder>> {
    return this.http.put<ApiResponse<PhotoPrintOrder>>(`${this.baseUrl}/${orderId}/status`, {
      status,
      ...(options?.override_location !== undefined ? { override_location: options.override_location } : {}),
    });
  }

  recordWorkflowAction(orderId: string, action: 'print' | 'download'): Observable<ApiResponse<PhotoPrintOrder>> {
    return this.http.post<ApiResponse<PhotoPrintOrder>>(
      `${this.baseUrl}/${orderId}/workflow-action`,
      { action },
    );
  }

  editOrder(orderId: string, data: EditPhotoPrintOrderRequest): Observable<ApiResponse<PhotoPrintOrder>> {
    return this.http.put<ApiResponse<PhotoPrintOrder>>(`${this.baseUrl}/${orderId}/edit`, data);
  }

  deleteOrder(orderId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/${orderId}`);
  }

  assignOrder(orderId: string, employeeId: string | null): Observable<ApiResponse<PhotoPrintOrder>> {
    return this.http.put<ApiResponse<PhotoPrintOrder>>(`${this.baseUrl}/${orderId}/assign`, { employee_id: employeeId });
  }

  getOrderQueue(bucket: 'active' | 'stale' = 'active'): Observable<PaginatedOrdersResponse> {
    const params = new HttpParams().set('bucket', bucket);
    return this.http.get<PaginatedOrdersResponse>(`${this.baseUrl}/staff-list/queue`, { params });
  }

  getArchivedOrders(limit = 10): Observable<PaginatedOrdersResponse> {
    return this.getOrders({
      scope: 'archive',
      limit,
      sort: 'updated_at',
      order: 'desc',
    });
  }

  createWalkInOrder(data: CreateWalkInOrderRequest): Observable<ApiResponse<{
    orderId: string;
    receiptNumber: string | null;
    taskId: string | null;
    taskNumber: number | null;
    activeTaskCount: number;
  }>> {
    return this.http.post<ApiResponse<{ orderId: string; receiptNumber: string | null; taskId: string | null; taskNumber: number | null; activeTaskCount: number }>>(`${this.baseUrl}/walk-in`, data);
  }

  linkChatSession(orderId: string, chatSessionId: string | null): Observable<ApiResponse<PhotoPrintOrder>> {
    return this.http.put<ApiResponse<PhotoPrintOrder>>(`${this.baseUrl}/${orderId}/edit`, { chat_session_id: chatSessionId });
  }

  recordPayment(orderId: string, data: {
    payment_method: 'cash' | 'card' | 'sbp' | 'subscription' | 'transfer';
    transaction_id?: string;
    card_info?: string;
    pos_receipt_id?: string;
    subscription_id?: string;
  }): Observable<ApiResponse<PhotoPrintOrder>> {
    return this.http.put<ApiResponse<PhotoPrintOrder>>(
      `${this.baseUrl}/${orderId}/record-payment`, data,
    );
  }

  createPaymentLink(data: {
    amount: number;
    description?: string;
    phone?: string;
    clientName?: string;
    orderId?: string;
  }): Observable<{ success: boolean; data: { paymentUrl: string; orderId: string; amount: number } }> {
    return this.http.post<{ success: boolean; data: { paymentUrl: string; orderId: string; amount: number } }>(
      '/api/payments/create-link', data,
    );
  }

  createCrmOrder(data: CrmCreateOrderRequest): Observable<{ success: boolean; data: CrmCreateOrderResponse }> {
    return this.http.post<{ success: boolean; data: CrmCreateOrderResponse }>(`${this.baseUrl}/crm-create`, data);
  }

  getStaffList(): Observable<{ success: boolean; data: StaffMember[] }> {
    return this.http.get<{ success: boolean; data: StaffMember[] }>('/api/users/staff-list');
  }

  sendReminder(orderId: string): Observable<{ success: boolean; message: string; reminder_sent_at: string; cooldownMinutes?: number }> {
    return this.http.post<{ success: boolean; message: string; reminder_sent_at: string; cooldownMinutes?: number }>(
      `${this.baseUrl}/${orderId}/remind`, {},
    );
  }

  markPaid(orderId: string, data: { method: 'cash' | 'transfer' | 'other'; note?: string }): Observable<ApiResponse<PhotoPrintOrder>> {
    return this.http.post<ApiResponse<PhotoPrintOrder>>(
      `${this.baseUrl}/${orderId}/mark-paid`, data,
    );
  }

  cancelPayment(orderId: string, reason?: string): Observable<ApiResponse<PhotoPrintOrder>> {
    return this.http.post<ApiResponse<PhotoPrintOrder>>(
      `${this.baseUrl}/${orderId}/cancel-payment`, { reason },
    );
  }

  getOrderAttachments(orderId: string): Observable<ApiResponse<OrderAttachment[]>> {
    return this.http.get<ApiResponse<OrderAttachment[]>>(`${this.baseUrl}/${orderId}/attachments`);
  }

  downloadPrintPhotosArchive(orderId: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.baseUrl}/${encodeURIComponent(orderId)}/download-photos`, {
      observe: 'response',
      responseType: 'blob',
    });
  }

  /**
   * Inline edit (P2): PATCH order item — пока поддерживаем только disabled_features.
   * Backend возвращает обновлённый item + новый total заказа.
   * 409 при payment_status='paid' или status IN (completed, cancelled).
   */
  updateOrderItem(
    orderId: string,
    itemId: string,
    patch: { disabled_features?: string[] },
  ): Observable<ApiResponse<{ item: OrderItemDetail; orderTotal: number }>> {
    return this.http.patch<ApiResponse<{ item: OrderItemDetail; orderTotal: number }>>(
      `${this.baseUrl}/${orderId}/items/${itemId}`,
      patch,
    );
  }
}
