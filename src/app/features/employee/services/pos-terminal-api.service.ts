import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

// ─── Types ────────────────────────────────────────────────

export type PosTransactionType = 'payment' | 'refund' | 'sbp_payment' | 'sbp_refund' | 'fiscal_sale' | 'fiscal_refund' | 'fiscal_correction' | 'bank_settlement';
export type PosTransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'timeout' | 'cancelled';

export interface PosTransaction {
  id: string;
  studio_id: string;
  agent_id: string | null;
  transaction_type: PosTransactionType;
  amount: number;
  currency: string;
  order_id: string | null;
  receipt_id: string | null;
  status: PosTransactionStatus;
  error_message: string | null;
  approval_code: string | null;
  rrn: string | null;
  card_mask: string | null;
  sbp_qr_data: string | null;
  sbp_paid: boolean;
  fiscal_number: string | null;
  fiscal_sign: string | null;
  fiscal_receipt_url: string | null;
  terminal_response: Record<string, unknown>;
  fiscal_receipt: Record<string, unknown>;
  initiated_by: string | null;
  initiated_at: string;
  completed_at: string | null;
}

export interface CreatePosTransactionDto {
  studio_id: string;
  transaction_type: PosTransactionType;
  amount: number;
  order_id?: string;
  receipt_id?: string;
}

export interface PosTerminalStatus {
  studio_id: string;
  terminal_online: boolean;
  fiscal_online: boolean;
  shift_status: string;
}

export interface PosTransactionFilter {
  studio_id?: string;
  status?: PosTransactionStatus;
  transaction_type?: PosTransactionType;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ─── Service ──────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PosTerminalApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/infra/pos';

  /** List POS transactions with filters. */
  getTransactions(filter: PosTransactionFilter = {}): Observable<PosTransaction[]> {
    let params = new HttpParams();
    if (filter.studio_id) params = params.set('studio_id', filter.studio_id);
    if (filter.status) params = params.set('status', filter.status);
    if (filter.transaction_type) params = params.set('transaction_type', filter.transaction_type);
    if (filter.from) params = params.set('from', filter.from);
    if (filter.to) params = params.set('to', filter.to);
    if (filter.limit) params = params.set('limit', filter.limit.toString());
    if (filter.offset) params = params.set('offset', filter.offset.toString());
    return this.http.get<PosTransaction[]>(`${this.baseUrl}/transactions`, { params });
  }

  /** Get single transaction by ID. */
  getTransaction(id: string): Observable<PosTransaction> {
    return this.http.get<PosTransaction>(`${this.baseUrl}/transactions/${id}`);
  }

  /** Initiate card payment via POS Agent. */
  initiatePayment(dto: CreatePosTransactionDto): Observable<PosTransaction> {
    return this.http.post<PosTransaction>(`${this.baseUrl}/pay`, dto);
  }

  /** Initiate card refund via POS Agent. */
  initiateRefund(dto: CreatePosTransactionDto): Observable<PosTransaction> {
    return this.http.post<PosTransaction>(`${this.baseUrl}/refund`, dto);
  }

  /** Initiate SBP payment — returns transaction with QR data after agent generates it. */
  initiateSbpPayment(dto: CreatePosTransactionDto): Observable<PosTransaction> {
    return this.http.post<PosTransaction>(`${this.baseUrl}/sbp/pay`, dto);
  }

  /** Get SBP QR code data from Redis (after agent generates it). */
  getSbpQr(transactionId: string): Observable<{ qr_data: string; qr_image: string }> {
    return this.http.get<{ qr_data: string; qr_image: string }>(`${this.baseUrl}/sbp/qr/${transactionId}`);
  }

  /** Open fiscal shift (АТОЛ). */
  openShift(studioId: string, cashier: string): Observable<{ success: boolean; error?: string }> {
    return this.http.post<{ success: boolean; error?: string }>(`${this.baseUrl}/shift/open`, {
      studio_id: studioId,
      cashier,
    });
  }

  /** Close fiscal shift (АТОЛ Z-report). */
  closeShift(studioId: string, cashier: string): Observable<{ success: boolean; error?: string }> {
    return this.http.post<{ success: boolean; error?: string }>(`${this.baseUrl}/shift/close`, {
      studio_id: studioId,
      cashier,
    });
  }

  /** Get POS terminal status for a studio (from Redis cache). */
  getTerminalStatus(studioId: string): Observable<PosTerminalStatus> {
    return this.http.get<PosTerminalStatus>(`${this.baseUrl}/status/${studioId}`);
  }
}
