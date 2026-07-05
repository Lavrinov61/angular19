import { Component, ChangeDetectionStrategy, inject, input, output, signal, computed, effect, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { forkJoin, map, Observable } from 'rxjs';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { SyncCartItem } from '../../../../shared/interfaces/cart-sync.interface';
import { PosApiService, PosShift, PosReceiptItem, PosReceiptPayment } from '../../services/pos-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';
import { StudioService } from '../../services/studio.service';
import { PrintApiService, type CreateLayoutBatchParams, type CreatePrintJobParams } from '../../services/print-api.service';
import { employeeApiErrorMessage } from '../../utils/api-error-message';
import { startAndWaitForBridgePayment } from '../../utils/pos-bridge-payment.util';
import {
  createdReceiptMessage,
  receiptPaymentsRequireFiscal,
} from '../pos/utils/pos-fiscal-feedback.util';

interface PaymentLinkResult {
  paymentUrl: string | null;
  orderId: string;
  amount: number;
}

type PrintCartRequest =
  | { mode: 'normal'; payload: CreatePrintJobParams }
  | { mode: 'layout-batch'; payload: CreateLayoutBatchParams };

interface PrintQueueEntry {
  readonly item: SyncCartItem;
  readonly request: PrintCartRequest;
}

interface PrintQueueSendResult {
  readonly jobs: number;
}

interface CartPaymentResult {
  readonly title: string;
  readonly total: number;
}

export interface OperatorCartCheckoutRequest {
  readonly items: readonly SyncCartItem[];
  readonly total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function isCreatePrintJobParams(value: unknown): value is CreatePrintJobParams {
  if (!isRecord(value)) return false;
  if (typeof value['printer_id'] !== 'string' || typeof value['file_url'] !== 'string') return false;
  if (value['copies'] !== undefined && typeof value['copies'] !== 'number') return false;
  if (value['pages'] !== undefined && !isNumberArray(value['pages'])) return false;
  if (value['price_total'] !== undefined && typeof value['price_total'] !== 'number') return false;
  return true;
}

function isLayoutBatchImageParams(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value['file_url'] === 'string';
}

function isCreateLayoutBatchParams(value: unknown): value is CreateLayoutBatchParams {
  if (!isRecord(value)) return false;
  if (typeof value['printer_id'] !== 'string') return false;
  if (!Array.isArray(value['images']) || !value['images'].every(isLayoutBatchImageParams)) return false;
  return typeof value['paper_width_mm'] === 'number'
    && typeof value['paper_height_mm'] === 'number'
    && typeof value['photo_width_mm'] === 'number'
    && typeof value['photo_height_mm'] === 'number';
}

function extractPrintCartRequest(item: SyncCartItem): PrintCartRequest | null {
  const metadata = item.metadata;
  if (!isRecord(metadata) || metadata['kind'] !== 'print-job') return null;
  const request = metadata['printRequest'];
  if (!isRecord(request)) return null;
  const mode = request['mode'];
  const payload = request['payload'];
  if (mode === 'normal' && isCreatePrintJobParams(payload)) {
    return { mode, payload };
  }
  if (mode === 'layout-batch' && isCreateLayoutBatchParams(payload)) {
    return { mode, payload };
  }
  return null;
}

/** Ответ POST /admin/sessions/:id/cart/recalculate */
interface WaterfallRecalcResponse {
  success: boolean;
  total: number;
  waterfallTotal?: number;
  manualTotal?: number;
  savings: number;
  waterfallApplied: boolean;
  items?: {
    slug: string;
    name: string;
    unitPrice: number;
    quantity: number;
    subtotal: number;
    discountApplied: string;
    discountAmount: number;
    discountLabel: string | null;
    volumeHint: string | null;
  }[];
  isReturning?: boolean;
  discounts?: {
    subscriber: { percent: number; amount: number } | null;
    account?: { accountType: 'personal' | 'education' | 'business'; label: string; percent: number; amount: number } | null;
    loyalty: { points_used: number; amount: number } | null;
    promo: { code: string; title: string; amount: number } | null;
    partner: { percent: number; amount: number } | null;
  };
  detectedCombos?: { name: string; combo_price: number; savings_label: string | null }[];
}

@Component({
  selector: 'app-operator-cart-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule, MatProgressSpinnerModule, MatTooltipModule, FormsModule,
  ],
  templateUrl: './operator-cart-panel.component.html',
  styleUrl: './operator-cart-panel.component.scss',
})
export class OperatorCartPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly wsService = inject(WebSocketService);
  private readonly posApi = inject(PosApiService);
  private readonly authService = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(MatDialog);
  private readonly printApi = inject(PrintApiService);
  readonly studioService = inject(StudioService);

  readonly sessionId = input.required<string>();
  readonly checkoutRequested = output<OperatorCartCheckoutRequest>();

  // State
  readonly items = signal<SyncCartItem[]>([]);
  readonly isExpanded = signal(true);
  readonly loading = signal(false);
  readonly generatingLink = signal(false);
  readonly paymentResult = signal<PaymentLinkResult | null>(null);
  readonly onlinePaymentPaid = signal(false);
  readonly posMode = signal(false);
  readonly posLoading = signal(false);
  readonly currentShift = signal<PosShift | null>(null);
  readonly posProcessing = signal(false);
  readonly posResult = signal<CartPaymentResult | null>(null);
  readonly shiftOpenMode = signal(false);
  readonly shiftOpening = signal(false);
  readonly sendingQueuedPrint = signal(false);
  readonly queuedPrintResult = signal<{ jobs: number } | null>(null);

  // Waterfall v2
  readonly waterfallResult = signal<WaterfallRecalcResponse | null>(null);
  readonly waterfallLoading = signal(false);

  // New item form
  newItemName = '';
  newItemPrice: number | null = null;
  newItemQuantity: number | null = 1;

  // Inline shift opening form
  selectedStudioId = '';
  cashAtOpen: number | null = null;

  // Computed
  readonly naiveTotal = computed(() =>
    this.items().reduce((sum, item) => sum + this.itemTotal(item), 0),
  );

  /** Итого: waterfall total (если пересчитано) или наивная сумма */
  readonly total = computed(() => this.waterfallResult()?.total ?? this.naiveTotal());

  /** Экономия от waterfall скидок */
  readonly savings = computed(() => this.waterfallResult()?.savings ?? 0);

  /** Есть ли items с serviceOptionId (waterfall-eligible) */
  readonly hasWaterfallItems = computed(() =>
    this.items().some(i => !!i.serviceOptionId),
  );

  readonly itemCount = computed(() =>
    this.items().reduce((sum, item) => sum + item.quantity, 0),
  );

  readonly isEmpty = computed(() => this.items().length === 0);

  readonly printQueueEntries = computed<PrintQueueEntry[]>(() =>
    this.items()
      .map(item => {
        const request = extractPrintCartRequest(item);
        return request ? { item, request } : null;
      })
      .filter((entry): entry is PrintQueueEntry => entry !== null),
  );

  readonly printQueueCount = computed(() => this.printQueueEntries().length);
  readonly printQueueCanSend = computed(() =>
    this.printQueueCount() > 0
    && !this.sendingQueuedPrint()
    && (!!this.posResult() || this.onlinePaymentPaid()),
  );
  readonly printQueueDisabledReason = computed(() => {
    if (this.sendingQueuedPrint()) return 'Задания уже отправляются';
    if (this.printQueueCount() === 0) return 'Нет заданий печати';
    if (this.paymentResult() && !this.onlinePaymentPaid()) return 'Ждём подтверждение оплаты по ссылке';
    if (!this.posResult() && !this.onlinePaymentPaid()) return 'Сначала примите оплату';
    return '';
  });

  constructor() {
    // React to visitor cart updates from WebSocket
    effect(() => {
      const update = this.wsService.visitorCartUpdate();
      if (!update) return;
      if (update.sessionId === this.sessionId()) {
        this.items.set(update.items as SyncCartItem[]);
      }
    });

    effect(() => {
      const event = this.wsService.paymentLinkEvent();
      if (!event || event.event !== 'payment-link:paid') return;
      const result = this.paymentResult();
      if (!result || event.data.orderRef !== result.orderId) return;
      this.markOnlinePaymentPaid();
    });

    effect(() => {
      const event = this.wsService.orderEvent();
      if (!event || event.event !== 'order:paid') return;
      const result = this.paymentResult();
      const orderId = isRecord(event.data) && typeof event.data['orderId'] === 'string'
        ? event.data['orderId']
        : '';
      if (!result || orderId !== result.orderId) return;
      this.markOnlinePaymentPaid();
    });
  }

  ngOnInit(): void {
    this.loadCart();
  }

  loadCart(): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; data: { items: SyncCartItem[]; updatedAt: string; updatedBy: string } }>(
      `/api/visitor-chat/admin/sessions/${this.sessionId()}/cart`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data?.items) {
          this.items.set(res.data.items);
          this.recalculateWaterfall();
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggleExpanded(): void {
    this.isExpanded.update(v => !v);
  }

  isPrintQueueItem(item: SyncCartItem): boolean {
    return extractPrintCartRequest(item) !== null;
  }

  updateQuantity(serviceId: string, delta: number): void {
    this.items.update(items => {
      const updated = items.map(item => {
        if (item.serviceId === serviceId) {
          if (this.isPrintQueueItem(item)) return item;
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : item;
        }
        return item;
      }).filter(item => item.quantity > 0);
      return updated;
    });
    this.resetPaymentState();
    this.syncCartToServer();
  }

  removeItem(serviceId: string): void {
    this.items.update(items => items.filter(i => i.serviceId !== serviceId));
    this.resetPaymentState();
    this.syncCartToServer();
  }

  addItem(): void {
    const quantity = this.sanitizedNewItemQuantity();
    if (!this.newItemName.trim() || !this.newItemPrice || this.newItemPrice <= 0 || quantity < 1) return;

    const serviceId = `op-${this.newItemName.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '-')}-${Date.now()}`;
    const newItem: SyncCartItem = {
      serviceId,
      name: this.newItemName.trim(),
      price: this.newItemPrice,
      quantity,
      icon: 'add_shopping_cart',
    };

    this.items.update(items => [...items, newItem]);
    this.newItemName = '';
    this.newItemPrice = null;
    this.newItemQuantity = 1;
    this.resetPaymentState();
    this.syncCartToServer();
  }

  openCheckout(): void {
    if (this.isEmpty()) return;
    this.checkoutRequested.emit({
      items: this.items().map(item => ({ ...item })),
      total: this.total(),
    });
  }

  generatePaymentLink(): void {
    this.generatingLink.set(true);
    this.paymentResult.set(null);
    this.onlinePaymentPaid.set(false);

    this.http.post<{ success: boolean; data: PaymentLinkResult }>(
      `/api/visitor-chat/admin/sessions/${this.sessionId()}/payment-link`,
      {}
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.paymentResult.set(res.data);
        }
        this.generatingLink.set(false);
      },
      error: (err: unknown) => {
        this.generatingLink.set(false);
        this.toast.error(employeeApiErrorMessage(err, 'Не удалось создать ссылку'));
      },
    });
  }

  private resetPaymentState(): void {
    this.paymentResult.set(null);
    this.onlinePaymentPaid.set(false);
    this.posResult.set(null);
    this.queuedPrintResult.set(null);
  }

  private markOnlinePaymentPaid(): void {
    if (this.onlinePaymentPaid()) return;
    this.onlinePaymentPaid.set(true);
    this.toast.success('Оплата по ссылке подтверждена');
  }

  registerExternalPaymentLink(orderId: string, amount: number): void {
    if (!orderId || amount < 1) return;
    this.paymentResult.set({ paymentUrl: null, orderId, amount });
    this.onlinePaymentPaid.set(false);
    this.posResult.set(null);
    this.queuedPrintResult.set(null);
    this.toast.info('Ждём подтверждение оплаты по ссылке');
  }

  markExternalPaymentAccepted(title: string, total = this.total()): void {
    if (!title || total < 1) return;
    this.paymentResult.set(null);
    this.onlinePaymentPaid.set(false);
    this.posResult.set({ title, total });
    this.queuedPrintResult.set(null);
    if (this.printQueueCount() > 0) {
      this.toast.info('Печатные задания готовы к отправке');
    }
  }

  enterPosMode(): void {
    const user = this.authService.currentUser();
    if (!user) return;
    this.posMode.set(true);
    this.posLoading.set(true);
    this.posResult.set(null);
    this.shiftOpenMode.set(false);

    this.posApi.getCurrentShift(user.id).subscribe({
      next: (shift) => {
        this.currentShift.set(shift);
        this.posLoading.set(false);
        if (!shift) {
          this.shiftOpenMode.set(true);
        }
      },
      error: () => {
        this.posLoading.set(false);
        this.toast.error('Ошибка проверки смены');
        this.posMode.set(false);
      },
    });
  }

  cancelPosMode(): void {
    this.posMode.set(false);
    this.shiftOpenMode.set(false);
  }

  openShiftInline(): void {
    const user = this.authService.currentUser();
    if (!user?.id) return;
    if (!this.selectedStudioId) {
      this.toast.error('Выберите адрес');
      return;
    }
    if (this.cashAtOpen == null || !Number.isFinite(this.cashAtOpen) || this.cashAtOpen < 0) {
      this.toast.error('Укажите наличные в кассе');
      return;
    }
    this.shiftOpening.set(true);
    this.posApi.openShift({
      employee_id: user.id,
      studio_id: this.selectedStudioId,
      cash_at_open: this.cashAtOpen,
    }).subscribe({
      next: (shift) => {
        this.currentShift.set(shift);
        this.shiftOpenMode.set(false);
        this.shiftOpening.set(false);
        this.toast.success(`Смена #${shift.shift_number} открыта`);
      },
      error: (err) => {
        this.shiftOpening.set(false);
        this.toast.error(err.error?.error || 'Не удалось открыть смену');
      },
    });
  }

  addItems(newItems: SyncCartItem[]): void {
    this.items.update(items => {
      const merged = [...items];
      for (const item of newItems) {
        const isPrintItem = extractPrintCartRequest(item) !== null;
        const idx = isPrintItem
          ? -1
          : merged.findIndex(i =>
            extractPrintCartRequest(i) === null
            && i.name === item.name
            && i.price === item.price
          );
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], quantity: merged[idx].quantity + item.quantity };
        } else {
          merged.push(item);
        }
      }
      return merged;
    });
    this.resetPaymentState();
    this.syncCartToServer();
  }

  async processPayment(method: 'cash' | 'card' | 'sbp'): Promise<void> {
    const shift = this.currentShift();
    const user = this.authService.currentUser();
    if (!shift || !user) return;

    this.posProcessing.set(true);
    const totalAmount = this.total();

    const receiptItems: PosReceiptItem[] = this.items().map(item => {
      const itemTotal = this.itemTotal(item);
      return {
        product_id: null,
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        discount_amount: 0,
        discount_percent: 0,
        points_used: 0,
        subscription_credits_used: 0,
        total: itemTotal,
        print_fill_percent: this.itemMetadataNumber(item, 'coveragePercent'),
      };
    });

    if (method === 'card') {
      try {
        const res = await startAndWaitForBridgePayment(this.posApi, {
          amount: totalAmount,
          orderId: `chat-${this.sessionId()}-${Date.now()}`,
          studioId: shift.studio_id,
        });
        this.createPosReceipt(shift, user.id, receiptItems, [{
          payment_type: 'card',
          amount: totalAmount,
          card_info: res.cardInfo,
          transaction_id: res.transactionId,
        }]);
      } catch (error) {
        this.posProcessing.set(false);
        this.toast.error(error instanceof Error ? error.message : 'Ошибка связи с терминалом');
      }
    } else {
      this.createPosReceipt(shift, user.id, receiptItems, [{ payment_type: method, amount: totalAmount }]);
    }
  }

  private receiptRequiresFiscal(payments: readonly PosReceiptPayment[]): boolean {
    return receiptPaymentsRequireFiscal(payments);
  }

  private createPosReceipt(shift: PosShift, employeeId: string, items: PosReceiptItem[], payments: PosReceiptPayment[]): void {
    this.posApi.createReceipt({
      shift_id: shift.id,
      employee_id: employeeId,
      studio_id: shift.studio_id,
      items,
      payments,
      subtotal: this.total(),
      total: this.total(),
      fiscal_required: this.receiptRequiresFiscal(payments),
    }).subscribe({
      next: (receipt) => {
        this.posProcessing.set(false);
        this.posResult.set({ title: `Чек ${receipt.receipt_number}`, total: receipt.total });
        const fiscalRequired = this.receiptRequiresFiscal(payments);
        if (fiscalRequired) {
          this.toast.info(createdReceiptMessage({
            receiptNumber: receipt.receipt_number,
            total: receipt.total,
            fiscalRequired: true,
          }));
        } else {
          this.toast.success(`Чек ${receipt.receipt_number} создан`);
        }
        if (this.printQueueCount() > 0) {
          this.toast.info('Печатные задания готовы к отправке');
          return;
        }
        this.items.set([]);
        this.syncCartToServer();
      },
      error: () => {
        this.posProcessing.set(false);
        this.toast.error('Не удалось создать чек');
      },
    });
  }

  syncCartToServer(): void {
    const items = this.items();
    // Save via REST
    this.http.put(
      `/api/visitor-chat/admin/sessions/${this.sessionId()}/cart`,
      { items }
    ).subscribe();
    // Also push via WebSocket for real-time
    this.wsService.sendCartUpdate(this.sessionId(), items);
    // Пересчитать waterfall если есть items из каталога
    this.recalculateWaterfall();
  }

  /** Пересчёт цен через waterfall v2 pricing engine */
  recalculateWaterfall(): void {
    const items = this.items();
    if (items.length === 0 || !items.some(i => !!i.serviceOptionId)) {
      this.waterfallResult.set(null);
      return;
    }
    this.waterfallLoading.set(true);
    this.http.post<WaterfallRecalcResponse>(
      `/api/visitor-chat/admin/sessions/${this.sessionId()}/cart/recalculate`,
      { items },
    ).subscribe({
      next: (res) => {
        if (res.success) this.waterfallResult.set(res);
        this.waterfallLoading.set(false);
      },
      error: () => {
        this.waterfallResult.set(null);
        this.waterfallLoading.set(false);
      },
    });
  }

  sendQueuedPrintJobs(): void {
    const disabledReason = this.printQueueDisabledReason();
    if (disabledReason) {
      this.toast.info(disabledReason);
      return;
    }

    const entries = this.printQueueEntries();
    if (!entries.length) return;

    this.sendingQueuedPrint.set(true);
    this.queuedPrintResult.set(null);
    forkJoin(entries.map(entry => this.sendPrintQueueEntry(entry))).subscribe({
      next: results => {
        const jobs = results.reduce((sum, result) => sum + result.jobs, 0);
        this.sendingQueuedPrint.set(false);
        this.queuedPrintResult.set({ jobs });
        this.toast.success(`Отправлено на печать: ${jobs}`);
        this.items.set([]);
        this.paymentResult.set(null);
        this.onlinePaymentPaid.set(false);
        this.posResult.set(null);
        this.syncCartToServer();
      },
      error: () => {
        this.sendingQueuedPrint.set(false);
        this.toast.error('Не удалось отправить задания на печать');
      },
    });
  }

  private sendPrintQueueEntry(entry: PrintQueueEntry): Observable<PrintQueueSendResult> {
    if (entry.request.mode === 'layout-batch') {
      return this.printApi.createLayoutBatchJobs(entry.request.payload).pipe(
        map(result => ({ jobs: Math.max(result.jobs.length, result.total_sheets || 0) })),
      );
    }

    return this.printApi.createPrintJob(entry.request.payload).pipe(
      map(result => ({ jobs: result.success ? 1 : 0 })),
    );
  }

  sendToProduction(): void {
    const cartItems = this.items().map(i => ({
      name: i.name,
      price: i.price,
      quantity: i.quantity,
    }));
    import('../production/send-to-production-dialog.component').then(m => {
      this.dialog.open(m.SendToProductionDialogComponent, {
        width: '700px',
        data: { source: 'cart' as const, cartItems },
      });
    });
  }

  private itemTotal(item: SyncCartItem): number {
    const metadataTotal = this.itemMetadataNumber(item, 'priceTotal');
    if (metadataTotal !== null) return metadataTotal;
    if (item.nextPrice != null && item.nextPrice !== item.price && item.quantity > 1) {
      return item.price + item.nextPrice * (item.quantity - 1);
    }
    return item.price * item.quantity;
  }

  private itemMetadataNumber(item: SyncCartItem, key: string): number | null {
    const metadata = item.metadata;
    if (!isRecord(metadata)) return null;
    const value = metadata[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private sanitizedNewItemQuantity(): number {
    const value = Number(this.newItemQuantity);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }
}
