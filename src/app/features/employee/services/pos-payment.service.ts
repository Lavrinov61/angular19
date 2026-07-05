import { Injectable, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, EMPTY, from } from 'rxjs';
import { tap, filter } from 'rxjs/operators';
import {
  PosPaymentOverlayComponent,
  PosPaymentOverlayData,
  PosPaymentOverlayResult,
} from '../components/pos/dialogs/pos-payment-overlay.component';
import { PosApiService, PosReceiptItem, PosReceipt, PosShift, PosBridgePayResponse } from './pos-api.service';
import { PosService, CartItem, CustomerInfo } from './pos.service';
import { PaymentMethod } from '../components/pos/models/pos.models';
import { CardPaymentStatus } from '../components/pos/dialogs/pos-card-progress.component';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { AuthService } from '../../../core/services/auth.service';

export interface PaymentDialogInput {
  method: PaymentMethod | null;
  shift: PosShift;
  items: CartItem[];
  customer: CustomerInfo | null;
  subscriptionSavings: number;
  remainderAfterSubscription: number;
  subscriptionCoverage: { productId: string; savedAmount: number }[];
  receiptItems: PosReceiptItem[];
  canPaySubscription: boolean;
}

@Injectable({ providedIn: 'root' })
export class PosPaymentService {
  private readonly dialog = inject(MatDialog);
  private readonly posApi = inject(PosApiService);
  private readonly posService = inject(PosService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly authService = inject(AuthService);

  readonly processing = signal(false);
  readonly cardStatus = signal<CardPaymentStatus>('waiting');

  private isDialogOpen = false;

  openPaymentDialog(input: PaymentDialogInput): Observable<PosPaymentOverlayResult> {
    // Double-click guard
    if (this.isDialogOpen) return EMPTY;
    this.isDialogOpen = true;
    this.processing.set(true);

    const data: PosPaymentOverlayData = {
      total: this.posService.total(),
      method: input.method,
      items: input.items,
      customerPhone: input.customer?.phone,
      customerName: input.customer?.name,
      loyaltyProfileId: input.customer?.loyalty?.id,
      subscriptionId: input.customer?.subscription?.id,
      shiftId: input.shift.id,
      employeeId: input.shift.employee_id,
      studioId: input.shift.studio_id,
      canPaySubscription: input.canPaySubscription,
      subscriptionSavings: input.subscriptionSavings,
      remainderAfterSubscription: input.remainderAfterSubscription,
      subscriptionCoverage: input.subscriptionCoverage,
      receiptItems: input.receiptItems,
    };

    const dialogRef = this.dialog.open(PosPaymentOverlayComponent, {
      data,
      panelClass: 'pos-payment-overlay-panel',
      disableClose: true,
      width: '500px',
      maxWidth: '100vw',
    });

    return dialogRef.afterClosed().pipe(
      tap(() => {
        this.isDialogOpen = false;
        this.processing.set(false);
      }),
      filter((result): result is PosPaymentOverlayResult => result != null),
    );
  }

  createReceipt(data: Parameters<PosApiService['createReceipt']>[0]): Observable<PosReceipt> {
    if (this.processing()) return EMPTY;
    this.processing.set(true);

    return this.posApi.createReceipt(data).pipe(
      tap({
        next: () => this.processing.set(false),
        error: () => this.processing.set(false),
      }),
    );
  }

  createFromPricing(data: Parameters<PosApiService['createFromPricing']>[0]): Observable<PosReceipt> {
    if (this.processing()) return EMPTY;
    this.processing.set(true);

    return this.posApi.createFromPricing(data).pipe(
      tap({
        next: () => this.processing.set(false),
        error: () => this.processing.set(false),
      }),
    );
  }

  handleBridgePay(amount: number, studioId: string, orderId?: string): Observable<PosBridgePayResponse> {
    this.cardStatus.set('processing');

    return this.posApi.bridgePay({
      amount,
      orderId: orderId ?? `POS-${Date.now()}`,
      studioId,
    }).pipe(
      tap({
        next: (result) => {
          this.cardStatus.set(result.success ? 'success' : 'error');
        },
        error: () => {
          this.cardStatus.set('error');
        },
      }),
    );
  }

  handleOffline(receiptData: Parameters<PosApiService['createReceipt']>[0]): Observable<void> {
    const token = this.authService.token() ?? '';
    const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    const label = `${receiptData.total}₽ · ${time}`;

    return from(this.offlineQueue.enqueuePosReceipt(receiptData, token, label));
  }
}
