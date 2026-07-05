import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PosApiService, PosOrphanPayment, PosPaymentResolveResult, PosReceiptItem,
} from '../../../services/pos-api.service';
import {
  OrphanReceiptDialogResult, PosOrphanReceiptDialogComponent,
} from './pos-orphan-receipt-dialog.component';

const orphanPayment: PosOrphanPayment = {
  id: '960e3b4b-d235-40f9-b3de-8311cef2120f',
  amount: 525,
  orderId: null,
  terminalOrderId: null,
  initiatedAt: '2026-06-06T15:14:45+03:00',
  initiatedByName: 'Ольга Яковлева',
  status: 'completed',
  errorMessage: null,
  snapshot: null,
  kind: 'orphan',
};

class PosApiServiceStub {
  readonly createOrphanReceipt = vi.fn(
    (_id: string, _data?: { items?: PosReceiptItem[] }): Observable<PosPaymentResolveResult> => (
      of({ success: true, payment_resolution: 'resolved_paid', receipt: { id: 'receipt-new' } as never })
    ),
  );
}

describe('PosOrphanReceiptDialogComponent', () => {
  let fixture: ComponentFixture<PosOrphanReceiptDialogComponent>;
  let component: PosOrphanReceiptDialogComponent;
  let posApi: PosApiServiceStub;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    posApi = new PosApiServiceStub();
    dialogRef = { close: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [PosOrphanReceiptDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { payment: orphanPayment, studioId: 'studio-1' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: PosApiService, useValue: posApi },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PosOrphanReceiptDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('seeds one manual row with the full payment amount', () => {
    expect(component.rows().length).toBe(1);
    expect(component.rows()[0].unit_price).toBe(525);
    expect(component.itemsTotal()).toBe(525);
    expect(component.totalsMatch()).toBe(true);
  });

  it('blocks submit until a named, positive-total row exists', () => {
    component.updateRow(0, 'product_name', '');
    expect(component.canSubmit()).toBe(false);

    component.updateRow(0, 'product_name', 'Печать A4');
    expect(component.canSubmit()).toBe(true);
  });

  it('posts manual items (no snapshot) and closes with the new receipt id', () => {
    component.updateRow(0, 'product_name', 'Печать A4');
    component.createReceipt();

    expect(posApi.createOrphanReceipt).toHaveBeenCalledTimes(1);
    const [paymentId, payload] = posApi.createOrphanReceipt.mock.calls[0];
    expect(paymentId).toBe('960e3b4b-d235-40f9-b3de-8311cef2120f');
    expect(payload?.items?.length).toBe(1);
    expect(payload?.items?.[0]).toMatchObject({ product_name: 'Печать A4', total: 525 });

    const result = dialogRef.close.mock.calls[0][0] as OrphanReceiptDialogResult;
    expect(result).toEqual({ resolved: true, receiptId: 'receipt-new' });
  });

  it('flags a totals mismatch when item sum differs from the paid amount', () => {
    component.updateRow(0, 'unit_price', 400);
    expect(component.totalsMatch()).toBe(false);
  });

  it('disables submit and skips the request when the item total differs from the paid amount', () => {
    component.updateRow(0, 'product_name', 'Печать A4');
    expect(component.canSubmit()).toBe(true);

    // Сумма позиций (400) расходится с оплатой (525) → submit заблокирован.
    component.updateRow(0, 'unit_price', 400);
    expect(component.totalsMatch()).toBe(false);
    expect(component.canSubmit()).toBe(false);

    component.createReceipt();
    expect(posApi.createOrphanReceipt).not.toHaveBeenCalled();
  });
});
