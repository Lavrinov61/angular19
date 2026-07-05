import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export type PaymentLinkStatus = 'pending' | 'paid' | 'expired' | 'cancelled';

export type ChannelType =
  | 'telegram' | 'whatsapp' | 'vk' | 'max'
  | 'web' | 'email' | 'sms' | 'instagram';

export interface PaymentLinkService {
  id?: string | null;
  name: string;
  price: number;
  quantity: number;
  slug?: string | null;
  pricingGroupKey?: string | null;
  printFillPercent?: number | null;
  optionSlugs?: readonly string[];
}

export interface PaymentLink {
  id: string;
  order_ref: string;
  amount: number | string;
  currency?: string;
  status: PaymentLinkStatus;
  services: PaymentLinkService[];
  description: string | null;
  conversation_id?: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  studio_id?: string | null;
  studio_name?: string | null;
  payment_method?: string | null;
  payment_card_info?: string | null;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
  order_ref_linked: string | null;
  availableChannels?: ChannelType[];
}

interface PaymentLinkDto extends Omit<PaymentLink, 'availableChannels'> {
  available_channels?: ChannelType[];
}

interface LinksResponse {
  success: boolean;
  links: PaymentLinkDto[];
}

export interface PaymentLinksQuery {
  contactId?: string;
  conversationId?: string;
  createdBy?: string;
  salesScope?: 'mine';
  status?: PaymentLinkStatus;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

interface CreateOrderBody {
  comment?: string;
  uniform_description?: string;
  wishes?: string;
  priority?: 'normal' | 'urgent' | 'vip';
}

interface CreateOrderResponse {
  success: boolean;
  data: {
    orderId: string;
    idempotent?: boolean;
  };
}

interface ResendResponse {
  success: boolean;
  mode?: string;
}

interface PaymentLinkCartLine {
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly total: number;
  readonly priceNote?: string | null;
  readonly discountLabel?: string | null;
  readonly discountAmount?: number;
}

interface PaymentLinkCartDetailsBody {
  readonly lines: readonly PaymentLinkCartLine[];
  readonly subtotal?: number;
  readonly savings?: number;
}

export interface UpdatePaymentLinkBody {
  readonly amount: number;
  readonly description?: string;
  readonly phone?: string;
  readonly clientName?: string;
  readonly clientUserId?: string;
  readonly clientContactId?: string;
  readonly services?: readonly PaymentLinkService[];
  readonly cartDetails?: PaymentLinkCartDetailsBody;
  readonly autoSend?: boolean;
  readonly promo_code?: string;
}

export interface PaymentLinkSubmitResponse {
  readonly success: boolean;
  readonly data?: {
    readonly paymentUrl: string;
    readonly orderId?: string;
    readonly amount?: number;
    readonly sent?: boolean;
    readonly link?: PaymentLinkDto;
  };
}

interface CancelPaymentLinkResponse {
  success: boolean;
  link: PaymentLinkDto;
}

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private http = inject(HttpClient);

  getLinks(query: PaymentLinksQuery = {}): Observable<PaymentLink[]> {
    return this.http
      .get<LinksResponse>('/api/payments/links', { params: this.buildLinkParams(query) })
      .pipe(map(r => this.mapLinks(r.links || [])));
  }

  getLinksForContact(contactId: string, status?: PaymentLinkStatus): Observable<PaymentLink[]> {
    return this.getLinks({ contactId, status });
  }

  getLinksForConversation(conversationId: string, status?: PaymentLinkStatus): Observable<PaymentLink[]> {
    return this.getLinks({ conversationId, status });
  }

  createOrderFromLink(
    linkId: string,
    body: CreateOrderBody,
  ): Observable<{ orderId: string; idempotent: boolean }> {
    return this.http
      .post<CreateOrderResponse>(`/api/payments/link/${linkId}/create-order`, body)
      .pipe(map(r => ({ orderId: r.data.orderId, idempotent: r.data.idempotent ?? false })));
  }

  resendLink(orderRef: string, channel?: ChannelType): Observable<ResendResponse> {
    const body = channel ? { channel } : {};
    return this.http.post<ResendResponse>(`/api/payments/resend/${orderRef}`, body);
  }

  updateLink(linkId: string, body: UpdatePaymentLinkBody): Observable<PaymentLinkSubmitResponse> {
    return this.http.patch<PaymentLinkSubmitResponse>(`/api/payments/link/${linkId}`, body);
  }

  cancelLink(linkId: string, reason?: string): Observable<PaymentLink> {
    const body = reason ? { reason } : {};
    return this.http
      .post<CancelPaymentLinkResponse>(`/api/payments/link/${linkId}/cancel`, body)
      .pipe(map(r => this.mapLinks([r.link])[0]));
  }

  private buildLinkParams(query: PaymentLinksQuery): HttpParams {
    let params = new HttpParams();
    if (query.contactId) params = params.set('contact_id', query.contactId);
    if (query.conversationId) params = params.set('conversation_id', query.conversationId);
    if (query.createdBy) params = params.set('created_by', query.createdBy);
    if (query.salesScope) params = params.set('sales_scope', query.salesScope);
    if (query.status) params = params.set('status', query.status);
    if (query.dateFrom) params = params.set('date_from', query.dateFrom);
    if (query.dateTo) params = params.set('date_to', query.dateTo);
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query.offset !== undefined) params = params.set('offset', String(query.offset));
    return params;
  }

  private mapLinks(links: PaymentLinkDto[]): PaymentLink[] {
    return links.map(l => {
      const { available_channels, ...rest } = l;
      return { ...rest, availableChannels: available_channels ?? [] };
    });
  }
}
