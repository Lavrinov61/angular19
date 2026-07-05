import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Clipboard } from '@angular/cdk/clipboard';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PosApiService,
  PosInDoubtPayment,
  PosOrphanPayment,
  PosReceipt,
  PosReceiptListParams,
  PosReceiptListResponse,
  PosShift,
  ShiftReport,
} from '../../../services/pos-api.service';
import { PosReceiptJournalDialogComponent } from './pos-receipt-journal-dialog.component';

const makeShift = (overrides: Partial<PosShift> = {}): PosShift => ({
  id: 'shift-1',
  employee_id: 'employee-1',
  studio_id: 'studio-1',
  shift_number: 25,
  opened_at: '2026-05-24T08:15:00+03:00',
  closed_at: null,
  cash_at_open: 1000,
  cash_at_close: null,
  expected_cash: 1150,
  fiscal_enabled: true,
  status: 'open',
  total_sales: 150,
  total_refunds: 0,
  receipt_count: 1,
  ...overrides,
});

const makeReceipt = (overrides: Partial<PosReceipt> = {}): PosReceipt => ({
  id: 'receipt-4773',
  receipt_number: '4773',
  shift_id: 'shift-1',
  employee_id: 'employee-1',
  employee_name: 'Оператор',
  studio_id: 'studio-1',
  studio_name: 'Соборный',
  customer_phone: null,
  customer_name: 'Ольга',
  is_refund: false,
  subtotal: 150,
  discount_total: 0,
  points_discount: 0,
  subscription_credit_used: 0,
  total: 150,
  items: [
    {
      product_id: 'photo-20x30',
      product_name: 'Фото 20x30 супер',
      quantity: 1,
      unit_price: 140,
      discount_amount: 0,
      discount_percent: 0,
      points_used: 0,
      subscription_credits_used: 0,
      total: 140,
      vat_rate: 'none',
    },
    {
      product_id: 'file',
      product_name: 'Файлик',
      quantity: 1,
      unit_price: 10,
      discount_amount: 0,
      discount_percent: 0,
      points_used: 0,
      subscription_credits_used: 0,
      total: 10,
      vat_rate: 'none',
    },
  ],
  payments: [{ payment_type: 'card', amount: 150 }],
  created_at: '2026-05-24T17:13:00+03:00',
  fiscal_status: 'failed',
  fiscal_attempts: 2,
  fiscal_last_error: 'DLL error: ATOL error 44: Нет бумаги',
  ...overrides,
});

const makeReport = (overrides: Partial<ShiftReport> = {}): ShiftReport => ({
  shift: makeShift(),
  receipts_count: 1,
  refunds_count: 0,
  voided_count: 0,
  total_sales: 150,
  total_refunds: 0,
  net_sales: 150,
  avg_receipt: 150,
  cash_payments: 0,
  cash_withdrawals: 0,
  cash_withdrawal_count: 0,
  cash_movements: [],
  card_payments: 150,
  sbp_payments: 0,
  employee_name: 'Оператор',
  studio_name: 'Соборный',
  top_services: [],
  ...overrides,
});

class PosApiServiceStub {
  readonly receipt = makeReceipt();
  readonly inDoubtPayment: PosInDoubtPayment = {
    id: 'e50e3662-f6d9-439b-a9b1-eed3a89dacb9',
    amount: 1400,
    orderId: null,
    terminalOrderId: 'POS-1780495705511',
    initiatedAt: '2026-06-03T14:08:26+03:00',
    initiatedByName: 'Юлия',
    status: 'in_doubt',
    errorMessage: 'Connection error',
    snapshot: null,
  };
  readonly orphanPayment: PosOrphanPayment = {
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
  readonly report = makeReport();
  readonly shifts = [
    makeShift(),
    makeShift({
      id: 'shift-previous',
      shift_number: 24,
      opened_at: '2026-05-23T08:10:00+03:00',
      closed_at: '2026-05-23T18:05:00+03:00',
      status: 'closed',
    }),
  ];

  readonly getReceipts = vi.fn((): Observable<PosReceipt[]> => of([this.receipt]));
  readonly getReceiptsPage = vi.fn((_params?: PosReceiptListParams): Observable<PosReceiptListResponse> => (
    of({ items: [this.receipt], total: 1 })
  ));
  readonly getShifts = vi.fn((): Observable<{ items: PosShift[]; total: number }> => (
    of({ items: this.shifts, total: this.shifts.length })
  ));
  readonly getShiftReport = vi.fn((_shiftId: string): Observable<ShiftReport> => of(this.report));
  readonly getInDoubtPayments = vi.fn((_studioId: string): Observable<PosInDoubtPayment[]> => (
    of([this.inDoubtPayment])
  ));
  readonly getOrphanPayments = vi.fn((_studioId: string): Observable<PosOrphanPayment[]> => (
    of([this.orphanPayment])
  ));
  readonly retryFiscal = vi.fn((_receiptId: string): Observable<{ success: boolean }> => of({ success: true }));
  readonly createFiscalCorrection = vi.fn((_receiptId: string): Observable<{ success: boolean; transactionId?: string }> => (
    of({ success: true, transactionId: 'correction-tx' })
  ));
}

describe('PosReceiptJournalDialogComponent', () => {
  let fixture: ComponentFixture<PosReceiptJournalDialogComponent>;
  let posApi: PosApiServiceStub;

  beforeEach(async () => {
    posApi = new PosApiServiceStub();

    await TestBed.configureTestingModule({
      imports: [PosReceiptJournalDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { shiftId: 'shift-1', studioId: 'studio-1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: PosApiService, useValue: posApi },
        { provide: Clipboard, useValue: { copy: vi.fn(() => true) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PosReceiptJournalDialogComponent);
    fixture.detectChanges();
  });

  it('renders the shift summary and selected receipt workspace', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(posApi.getShiftReport).toHaveBeenCalledWith('shift-1');
    expect(posApi.getReceiptsPage).toHaveBeenCalledWith({ shift_id: 'shift-1', limit: 100 });
    expect(posApi.getShifts).toHaveBeenCalledWith({ studio_id: 'studio-1', limit: 30 });
    expect(posApi.getInDoubtPayments).toHaveBeenCalledWith('studio-1');
    expect(text).toContain('Смена #25');
    expect(text).toContain('Смена #24');
    expect(text).toContain('Нетто');
    expect(text).toContain('Фото 20x30 супер');
    expect(text).toContain('Нет бумаги в ККТ');
    expect(text).toContain('DLL error: ATOL error 44: Нет бумаги');
    expect(text).toContain('Чек коррекции');
  });

  it('shows unresolved terminal payment details directly when the journal opens', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('1 оплата с неизвестным статусом');
    expect(text).toMatch(/1(?:\s|,)400 ₽/);
    expect(text).toContain('POS-1780495705511');
    expect(text).toContain('e50e3662');
    expect(text).toContain('Юлия');
  });

  it('queues a correction receipt from a failed receipt', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const correctionButton = buttons.find(button => button.textContent?.includes('Чек коррекции'));

    expect(correctionButton).toBeTruthy();
    expect(correctionButton?.disabled).toBe(false);

    correctionButton?.click();

    expect(posApi.createFiscalCorrection).toHaveBeenCalledWith('receipt-4773');
  });

  it('loads orphan payments for the studio', () => {
    expect(posApi.getOrphanPayments).toHaveBeenCalledWith('studio-1');
  });

  it('shows the orphan tab with its count and renders the list when selected', () => {
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('button[role="tab"]')) as HTMLButtonElement[];
    const orphanTab = tabs.find(tab => tab.textContent?.includes('Оплата без чека'));
    expect(orphanTab).toBeTruthy();
    expect(orphanTab?.textContent).toContain('1');

    orphanTab?.click();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('525 ₽');
    expect(text).toContain('960e3b4b');
    expect(text).toContain('Оформить чек');
    expect(text).toContain('Позиции не сохранены');
  });

  it('shows the fiscalize button for a failed receipt', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const retryButton = buttons.find(button => button.textContent?.includes('Повторить ФНС'));
    expect(retryButton).toBeTruthy();
  });

  it('shows the fiscalize button for a pending receipt', async () => {
    posApi.getReceiptsPage.mockReturnValue(
      of({ items: [makeReceipt({ fiscal_status: 'pending', fiscal_last_error: null, fiscal_attempts: 0 })], total: 1 }),
    );

    const f = TestBed.createComponent(PosReceiptJournalDialogComponent);
    f.detectChanges();

    const buttons = Array.from(f.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const fiscalizeButton = buttons.find(button => button.textContent?.includes('Фискализировать'));
    expect(fiscalizeButton).toBeTruthy();
  });

  it('shows the fiscalize button for a queued receipt', async () => {
    posApi.getReceiptsPage.mockReturnValue(
      of({ items: [makeReceipt({ fiscal_status: 'queued', fiscal_last_error: null, fiscal_attempts: 0 })], total: 1 }),
    );

    const f = TestBed.createComponent(PosReceiptJournalDialogComponent);
    f.detectChanges();

    const buttons = Array.from(f.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const fiscalizeButton = buttons.find(button => button.textContent?.includes('Фискализировать'));
    expect(fiscalizeButton).toBeTruthy();
  });
});
