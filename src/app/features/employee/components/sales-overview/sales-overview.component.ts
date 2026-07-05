import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EMPTY, Observable, expand, forkJoin, map, reduce } from 'rxjs';
import {
  OrdersApiService,
  PaginatedOrdersResponse,
  PhotoPrintOrder,
  PhotoPrintOrderItem,
} from '../../services/orders-api.service';
import {
  PosApiService,
  PosReceipt,
  PosReceiptItem,
  PosReceiptListResponse,
  PosReceiptPayment,
} from '../../services/pos-api.service';
import {
  PaymentLink,
  PaymentLinkService,
  PaymentsService,
} from '../../services/payments.service';
import { EmployeeSalesApiService } from '../../services/employee-sales-api.service';
import { AuthService } from '../../../../core/services/auth.service';

type PeriodFilter = 'today' | 'yesterday' | '7d' | '30d';
type SourceFilter = 'all' | 'pos' | 'links';
type StatusFilter = 'all' | 'paid' | 'pending' | 'refund' | 'problem';
type SaleSource = 'pos' | 'links';
type SaleStatus = 'paid' | 'pending' | 'refund' | 'voided' | 'expired' | 'cancelled' | 'failed';
type PaymentBreakdownKey =
  | 'cash'
  | 'card'
  | 'sbp'
  | 'transfer'
  | 'online'
  | 'subscription'
  | 'other';
const PAGE_SIZE = 500;
const PRINT_ORDER_PAGE_SIZE = 100;

const PAYMENT_METHODS: readonly {
  key: PaymentBreakdownKey;
  label: string;
  icon: string;
}[] = [
  { key: 'cash', label: 'Наличные', icon: 'payments' },
  { key: 'card', label: 'Карта', icon: 'credit_card' },
  { key: 'sbp', label: 'СБП', icon: 'qr_code_2' },
  { key: 'transfer', label: 'Перевод', icon: 'account_balance' },
  { key: 'online', label: 'Онлайн', icon: 'language' },
  { key: 'subscription', label: 'Подписка', icon: 'card_membership' },
  { key: 'other', label: 'Прочее', icon: 'more_horiz' },
];

interface DateRange {
  from: string;
  to: string;
}

interface SaleLine {
  name: string;
  quantity: number;
  unitPrice: number | null;
  total: number;
}

interface SalePaymentPart {
  key: PaymentBreakdownKey;
  amount: number;
}

interface PaymentBreakdownItem {
  key: PaymentBreakdownKey;
  label: string;
  icon: string;
  amount: number;
  count: number;
}

interface SaleRow {
  id: string;
  source: SaleSource;
  sourceLabel: string;
  sourceIcon: string;
  number: string;
  createdAt: string;
  studioId: string | null;
  employeeName: string;
  studioName: string | null;
  customerName: string;
  customerPhone: string | null;
  amount: number;
  status: SaleStatus;
  statusLabel: string;
  paymentText: string;
  payments: SalePaymentPart[];
  description: string | null;
  lines: SaleLine[];
}

interface SalesSummary {
  revenue: number;
  posNet: number;
  issuedPaid: number;
  issuedTotal: number;
  pendingAmount: number;
  receiptsCount: number;
  issuedCount: number;
  paidCount: number;
}

interface ReceiptPageState extends PosReceiptListResponse {
  offset: number;
}

interface PaymentLinkPageState {
  links: PaymentLink[];
  offset: number;
}

interface PrintOrderPageState extends PaginatedOrdersResponse {
  page: number;
}

interface SalesLoadData {
  receipts: PosReceipt[];
  links: PaymentLink[];
  orders: PhotoPrintOrder[];
}

interface SalesStudio {
  id: string;
  name: string;
  address: string | null;
  location_code: string | null;
}

interface SalesStudiosResponse {
  data?: SalesStudio[];
  studios?: SalesStudio[];
}

interface StudioFilterOption extends SalesStudio {
  label: string;
}

function money(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function rangeForPeriod(period: PeriodFilter): DateRange {
  const now = new Date();
  const to = endOfDay(now);
  const from = startOfDay(now);

  if (period === 'yesterday') {
    from.setDate(from.getDate() - 1);
    const yesterdayTo = endOfDay(from);
    return { from: from.toISOString(), to: yesterdayTo.toISOString() };
  }

  if (period === '7d') {
    from.setDate(from.getDate() - 6);
  }

  if (period === '30d') {
    from.setDate(from.getDate() - 29);
  }

  return { from: from.toISOString(), to: to.toISOString() };
}

function parsePeriod(value: unknown): PeriodFilter | null {
  switch (value) {
    case 'today':
    case 'yesterday':
    case '7d':
    case '30d':
      return value;
    default:
      return null;
  }
}

function parseSource(value: unknown): SourceFilter | null {
  switch (value) {
    case 'all':
    case 'pos':
    case 'links':
      return value;
    default:
      return null;
  }
}

function parseStatus(value: unknown): StatusFilter | null {
  switch (value) {
    case 'all':
    case 'paid':
    case 'pending':
    case 'refund':
    case 'problem':
      return value;
    default:
      return null;
  }
}

@Component({
  selector: 'app-sales-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './sales-overview.component.html',
  styleUrl: './sales-overview.component.scss',
})
export class SalesOverviewComponent implements OnInit {
  private readonly posApi = inject(PosApiService);
  private readonly paymentsApi = inject(PaymentsService);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly employeeSalesApi = inject(EmployeeSalesApiService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly period = signal<PeriodFilter>('today');
  protected readonly selectedStudioId = signal('all');
  protected readonly sourceFilter = signal<SourceFilter>('all');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly searchQuery = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly studios = signal<SalesStudio[]>([]);
  protected readonly receipts = signal<PosReceipt[]>([]);
  protected readonly paymentLinks = signal<PaymentLink[]>([]);
  protected readonly printOrders = signal<PhotoPrintOrder[]>([]);
  protected readonly ownSalesOnly = computed(() => !this.auth.hasPermission('reports:view'));
  protected readonly canUseStudioFilter = computed(() => !this.ownSalesOnly());
  protected readonly pageTitle = computed(() => this.ownSalesOnly() ? 'Мои продажи' : 'Продажи');
  protected readonly pageSubtitle = computed(() => this.ownSalesOnly()
    ? 'Ваши кассовые чеки, заказы и выставленные счета за период'
    : 'Кассовые чеки, заказы и выставленные счета за период');
  protected readonly studioOptions = computed<StudioFilterOption[]>(() =>
    this.studios().map((studio) => ({
      ...studio,
      label: this.studioFilterLabel(studio),
    })),
  );

  protected readonly rows = computed(() => {
    const paymentLinks = this.paymentLinks();
    const linkedOrderRefs = new Set(
      paymentLinks
        .map((link) => link.order_ref_linked)
        .filter((orderRef): orderRef is string => typeof orderRef === 'string' && orderRef.length > 0),
    );
    const posRows = this.receipts().map((receipt) => this.mapReceiptRow(receipt));
    const linkRows = paymentLinks.map((link) => this.mapPaymentLinkRow(link));
    const printRows = this.printOrders()
      .filter((order) => this.shouldIncludePrintOrderRow(order, linkedOrderRefs))
      .map((order) => this.mapPrintOrderRow(order));
    return [...posRows, ...linkRows, ...printRows].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  });

  protected readonly filteredRows = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const selectedStudioId = this.selectedStudioId();
    return this.rows().filter((row) => {
      if (selectedStudioId !== 'all' && row.studioId !== selectedStudioId) return false;
      if (this.sourceFilter() !== 'all' && row.source !== this.sourceFilter()) return false;
      if (!this.matchesStatus(row, this.statusFilter())) return false;
      if (!query) return true;
      const haystack = [
        row.number,
        row.employeeName,
        row.studioName ?? '',
        row.customerName,
        row.customerPhone ?? '',
        row.paymentText,
        row.description ?? '',
        row.lines.map((line) => line.name).join(' '),
      ].join(' ').toLowerCase();
      return query.split(/\s+/).every((term) => haystack.includes(term));
    });
  });

  protected readonly summary = computed<SalesSummary>(() => {
    const rows = this.filteredRows();
    const revenue = rows
      .filter((row) => row.status === 'paid' || row.status === 'refund')
      .reduce((sum, row) => sum + row.amount, 0);
    const posNet = rows
      .filter((row) => row.source === 'pos' && (row.status === 'paid' || row.status === 'refund'))
      .reduce((sum, row) => sum + row.amount, 0);
    const issuedPaid = rows
      .filter((row) => row.source === 'links' && row.status === 'paid')
      .reduce((sum, row) => sum + row.amount, 0);
    const issuedTotal = rows
      .filter((row) => row.source === 'links')
      .reduce((sum, row) => sum + Math.max(row.amount, 0), 0);
    const pendingAmount = rows
      .filter((row) => row.source === 'links' && row.status === 'pending')
      .reduce((sum, row) => sum + row.amount, 0);

    return {
      revenue,
      posNet,
      issuedPaid,
      issuedTotal,
      pendingAmount,
      receiptsCount: rows.filter((row) => row.source === 'pos').length,
      issuedCount: rows.filter((row) => row.source === 'links').length,
      paidCount: rows.filter((row) => row.status === 'paid').length,
    };
  });

  protected readonly paymentBreakdown = computed<PaymentBreakdownItem[]>(() => {
    const totals = new Map<PaymentBreakdownKey, { amount: number; count: number }>();

    for (const row of this.filteredRows()) {
      for (const payment of row.payments) {
        const current = totals.get(payment.key) ?? { amount: 0, count: 0 };
        totals.set(payment.key, {
          amount: current.amount + payment.amount,
          count: current.count + 1,
        });
      }
    }

    return PAYMENT_METHODS.map((method) => {
      const total = totals.get(method.key) ?? { amount: 0, count: 0 };
      return {
        ...method,
        amount: total.amount,
        count: total.count,
      };
    });
  });

  ngOnInit(): void {
    if (this.canUseStudioFilter()) {
      this.loadStudios();
    }
    this.load();
  }

  protected reload(): void {
    this.load();
  }

  protected onPeriodChange(value: unknown): void {
    const period = parsePeriod(value);
    if (!period) return;
    this.period.set(period);
    this.expandedId.set(null);
    this.load();
  }

  protected onStudioChange(value: unknown): void {
    if (typeof value !== 'string') return;
    this.selectedStudioId.set(value);
    this.expandedId.set(null);
  }

  protected onSourceChange(value: unknown): void {
    const source = parseSource(value);
    if (source) this.sourceFilter.set(source);
  }

  protected onStatusChange(value: unknown): void {
    const status = parseStatus(value);
    if (status) this.statusFilter.set(status);
  }

  protected onSearchInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.searchQuery.set(target.value);
    }
  }

  protected toggleRow(rowId: string): void {
    this.expandedId.update((current) => current === rowId ? null : rowId);
  }

  protected isExpanded(rowId: string): boolean {
    return this.expandedId() === rowId;
  }

  protected selectedStudioLabel(): string {
    if (this.selectedStudioId() === 'all') return 'Все точки';
    return this.studioOptions().find((studio) => studio.id === this.selectedStudioId())?.label ?? 'Точка';
  }

  protected summaryNote(): string {
    const studioPart = this.canUseStudioFilter() ? ` · ${this.selectedStudioLabel()}` : '';
    return `${this.periodLabel()}${studioPart} · ${this.summary().paidCount} оплат`;
  }

  protected periodLabel(): string {
    switch (this.period()) {
      case 'today': return 'Сегодня';
      case 'yesterday': return 'Вчера';
      case '7d': return '7 дней';
      case '30d': return '30 дней';
    }
  }

  private loadStudios(): void {
    this.http.get<SalesStudiosResponse>('/api/studios', { params: { limit: '50' } })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const studios = response.data ?? response.studios ?? [];
          this.studios.set(studios.filter((studio) => !!studio.id));
        },
        error: () => {
          this.studios.set([]);
        },
      });
  }

  private load(): void {
    const range = rangeForPeriod(this.period());
    const ownOnly = this.ownSalesOnly();

    this.loading.set(true);
    this.error.set(null);

    const request$ = ownOnly
      ? this.loadOwnSalesHistory(range)
      : this.loadAllSalesData(range);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ receipts, links, orders }) => {
        this.receipts.set(receipts);
        this.paymentLinks.set(links);
        this.printOrders.set(orders);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(ownOnly
          ? 'Не удалось загрузить личную историю продаж. Обновите страницу или обратитесь к администратору.'
          : 'Не удалось загрузить продажи. Проверьте доступ к заказам и API кассы.');
      },
    });
  }

  private loadOwnSalesHistory(range: DateRange): Observable<SalesLoadData> {
    return this.employeeSalesApi.getHistory({
      dateFrom: range.from,
      dateTo: range.to,
      limit: PAGE_SIZE,
    });
  }

  private loadAllSalesData(range: DateRange): Observable<SalesLoadData> {
    return forkJoin({
      receipts: this.loadReceiptPages(range),
      links: this.loadPaymentLinkPages(range),
      orders: this.loadPrintOrderPages(range),
    }).pipe(
      map(({ receipts, links, orders }) => ({
        receipts: receipts.items,
        links,
        orders,
      })),
    );
  }

  private loadReceiptPages(range: DateRange): Observable<PosReceiptListResponse> {
    const loadPage = (offset: number): Observable<ReceiptPageState> => this.posApi.getReceiptsPage({
      date_from: range.from,
      date_to: range.to,
      limit: PAGE_SIZE,
      offset,
    }).pipe(map((page) => ({ ...page, offset })));

    return loadPage(0).pipe(
      expand((page) => page.offset + page.items.length < page.total
        ? loadPage(page.offset + PAGE_SIZE)
        : EMPTY),
      reduce(
        (acc, page) => ({
          items: [...acc.items, ...page.items],
          total: page.total,
        }),
        { items: [] as PosReceipt[], total: 0 },
      ),
    );
  }

  private loadPaymentLinkPages(range: DateRange): Observable<PaymentLink[]> {
    const loadPage = (offset: number): Observable<PaymentLinkPageState> => this.paymentsApi.getLinks({
      dateFrom: range.from,
      dateTo: range.to,
      limit: PAGE_SIZE,
      offset,
    }).pipe(map((links) => ({ links, offset })));

    return loadPage(0).pipe(
      expand((page) => page.links.length === PAGE_SIZE
        ? loadPage(page.offset + PAGE_SIZE)
        : EMPTY),
      reduce((links, page) => [...links, ...page.links], [] as PaymentLink[]),
    );
  }

  private loadPrintOrderPages(range: DateRange): Observable<PhotoPrintOrder[]> {
    const rangeFrom = Date.parse(range.from);
    const rangeTo = Date.parse(range.to);
    const inRange = (order: PhotoPrintOrder): boolean => {
      const createdAt = Date.parse(order.created_at);
      return Number.isFinite(createdAt) && createdAt >= rangeFrom && createdAt <= rangeTo;
    };
    const loadPage = (page: number): Observable<PrintOrderPageState> => this.ordersApi.getOrders({
      date_from: range.from,
      date_to: range.to,
      page,
      limit: PRINT_ORDER_PAGE_SIZE,
      sort: 'created_at',
      order: 'desc',
    }).pipe(map((response) => ({ ...response, page })));

    return loadPage(1).pipe(
      expand((page) => page.page * page.limit < page.total
        ? loadPage(page.page + 1)
        : EMPTY),
      reduce(
        (orders, page) => [...orders, ...page.data.filter(inRange)],
        [] as PhotoPrintOrder[],
      ),
    );
  }

  private mapReceiptRow(receipt: PosReceipt): SaleRow {
    const isVoided = !!receipt.voided_at;
    const status: SaleStatus = isVoided ? 'voided' : receipt.is_refund ? 'refund' : 'paid';
    const total = money(receipt.total);

    return {
      id: `pos:${receipt.id}`,
      source: 'pos',
      sourceLabel: 'Касса',
      sourceIcon: 'point_of_sale',
      number: receipt.receipt_number,
      createdAt: receipt.created_at,
      studioId: receipt.studio_id ?? null,
      employeeName: receipt.employee_name || 'Сотрудник не указан',
      studioName: receipt.studio_name ?? null,
      customerName: receipt.customer_name || 'Клиент не указан',
      customerPhone: receipt.customer_phone,
      amount: status === 'refund' ? -Math.abs(total) : total,
      status,
      statusLabel: this.statusLabel(status),
      paymentText: this.paymentText(receipt.payments ?? []),
      payments: this.mapReceiptPayments(receipt.payments ?? [], status),
      description: receipt.void_reason ?? null,
      lines: (receipt.items ?? []).map((item) => this.mapReceiptLine(item)),
    };
  }

  private mapPaymentLinkRow(link: PaymentLink): SaleRow {
    const status = this.mapPaymentLinkStatus(link.status);
    return {
      id: `link:${link.id}`,
      source: 'links',
      sourceLabel: 'Счёт',
      sourceIcon: 'link',
      number: link.order_ref,
      createdAt: link.created_at,
      studioId: link.studio_id ?? null,
      employeeName: link.created_by_name || 'Сотрудник не указан',
      studioName: link.studio_name ?? null,
      customerName: link.contact_name || 'Клиент не указан',
      customerPhone: link.contact_phone,
      amount: money(link.amount),
      status,
      statusLabel: this.statusLabel(status),
      paymentText: link.status === 'paid'
        ? this.onlinePaymentText(link.payment_method)
        : 'Ссылка на оплату',
      payments: status === 'paid'
        ? [{ key: 'online', amount: money(link.amount) }]
        : [],
      description: link.description,
      lines: this.mapPaymentLinkLines(link.services, link.description, money(link.amount)),
    };
  }

  private mapPrintOrderRow(order: PhotoPrintOrder): SaleRow {
    const status = this.mapPrintOrderStatus(order);
    const total = money(order.total_price);
    const amount = status === 'refund' ? -Math.abs(total) : total;

    return {
      id: `order:${order.id}`,
      source: 'links',
      sourceLabel: 'Заказ',
      sourceIcon: 'receipt_long',
      number: order.order_id,
      createdAt: order.created_at,
      studioId: order.order_studio_id ?? null,
      employeeName: this.printOrderEmployeeName(order),
      studioName: order.order_studio_name ?? null,
      customerName: order.contact_name || 'Клиент не указан',
      customerPhone: order.contact_phone,
      amount,
      status,
      statusLabel: this.statusLabel(status),
      paymentText: this.printOrderPaymentText(order, status),
      payments: status === 'paid'
        ? [{ key: this.printOrderPaymentKey(order), amount }]
        : [],
      description: order.comments ?? order.description ?? null,
      lines: this.mapPrintOrderLines(order.items, order.description, amount),
    };
  }

  private mapReceiptLine(item: PosReceiptItem): SaleLine {
    return {
      name: item.product_name,
      quantity: money(item.quantity),
      unitPrice: money(item.unit_price),
      total: money(item.total),
    };
  }

  private mapPaymentLinkLines(
    services: PaymentLinkService[] | null | undefined,
    description: string | null,
    amount: number,
  ): SaleLine[] {
    const safeServices = Array.isArray(services) ? services : [];
    if (safeServices.length > 0) {
      return safeServices.map((service) => ({
        name: service.name,
        quantity: money(service.quantity) || 1,
        unitPrice: money(service.price),
        total: money(service.price) * (money(service.quantity) || 1),
      }));
    }

    return [{
      name: description || 'Счёт без состава услуг',
      quantity: 1,
      unitPrice: amount,
      total: amount,
    }];
  }

  private mapPrintOrderLines(
    items: PhotoPrintOrderItem[] | null | undefined,
    description: string | null | undefined,
    amount: number,
  ): SaleLine[] {
    const safeItems = Array.isArray(items) ? items : [];
    if (safeItems.length > 0) {
      return safeItems.map((item) => {
        const quantity = money(item.quantity) || 1;
        const unitPrice = item.price === undefined ? null : money(item.price);
        return {
          name: this.printOrderItemName(item),
          quantity,
          unitPrice,
          total: unitPrice === null ? 0 : unitPrice * quantity,
        };
      });
    }

    return [{
      name: description || 'Заказ без состава услуг',
      quantity: 1,
      unitPrice: amount,
      total: amount,
    }];
  }

  private printOrderItemName(item: PhotoPrintOrderItem): string {
    return item.name
      ?? item.service
      ?? item.document
      ?? item.description
      ?? item.format
      ?? item.slug
      ?? 'Позиция заказа';
  }

  private printOrderEmployeeName(order: PhotoPrintOrder): string {
    if (order.payment_channel !== 'online' && order.payment_recorded_by_name) {
      return order.payment_recorded_by_name;
    }
    return order.assigned_employee_name || 'Сотрудник не указан';
  }

  private shouldIncludePrintOrderRow(
    order: PhotoPrintOrder,
    linkedOrderRefs: ReadonlySet<string>,
  ): boolean {
    if (linkedOrderRefs.has(order.order_id)) return false;
    if (order.payment_event_type === 'pos_auto_mark_paid') return false;
    if (order.receipt_url?.startsWith('/pos/receipts/')) return false;
    return true;
  }

  private mapPaymentLinkStatus(status: PaymentLink['status']): SaleStatus {
    switch (status) {
      case 'paid': return 'paid';
      case 'expired': return 'expired';
      case 'cancelled': return 'cancelled';
      case 'pending': return 'pending';
    }
  }

  private mapPrintOrderStatus(order: PhotoPrintOrder): SaleStatus {
    const paymentStatus = order.payment_status?.toLowerCase() ?? '';
    const orderStatus = order.status?.toLowerCase() ?? '';

    if (paymentStatus === 'paid' || paymentStatus === 'confirmed') return 'paid';
    if (paymentStatus === 'refunded' || orderStatus === 'refunded') return 'refund';
    if (paymentStatus === 'cancelled' || orderStatus === 'cancelled') return 'cancelled';
    if (paymentStatus === 'failed' || orderStatus === 'payment_failed') return 'failed';
    return 'pending';
  }

  private statusLabel(status: SaleStatus): string {
    switch (status) {
      case 'paid': return 'Оплачено';
      case 'pending': return 'Ожидает';
      case 'refund': return 'Возврат';
      case 'voided': return 'Аннулирован';
      case 'expired': return 'Истёк';
      case 'cancelled': return 'Отменён';
      case 'failed': return 'Ошибка';
    }
  }

  private matchesStatus(row: SaleRow, filter: StatusFilter): boolean {
    switch (filter) {
      case 'all':
        return true;
      case 'paid':
        return row.status === 'paid';
      case 'pending':
        return row.status === 'pending';
      case 'refund':
        return row.status === 'refund';
      case 'problem':
        return row.status === 'voided'
          || row.status === 'expired'
          || row.status === 'cancelled'
          || row.status === 'failed';
    }
  }

  private mapReceiptPayments(
    payments: PosReceiptPayment[],
    status: SaleStatus,
  ): SalePaymentPart[] {
    if (status === 'voided') return [];
    const sign = status === 'refund' ? -1 : 1;
    return payments.map((payment) => ({
      key: this.paymentMethodKey(payment.payment_type, 'other'),
      amount: sign * money(payment.amount),
    }));
  }

  private paymentText(payments: PosReceiptPayment[]): string {
    if (payments.length === 0) return 'Оплата не указана';
    return payments
      .map((payment) => `${this.paymentLabel(payment.payment_type)} ${money(payment.amount).toLocaleString('ru-RU')} ₽`)
      .join(' · ');
  }

  private paymentLabel(type: PosReceiptPayment['payment_type']): string {
    switch (type) {
      case 'cash': return 'Нал';
      case 'card': return 'Карта';
      case 'sbp': return 'СБП';
      case 'online': return 'Онлайн';
      case 'subscription': return 'Подписка';
      case 'transfer': return 'Перевод';
    }
  }

  private paymentMethodKey(
    method: string | null | undefined,
    fallback: PaymentBreakdownKey,
  ): PaymentBreakdownKey {
    switch (method?.toLowerCase()) {
      case 'cash':
      case 'наличные':
        return 'cash';
      case 'card':
      case 'bank_card':
      case 'terminal':
      case 'карта':
        return 'card';
      case 'sbp':
      case 'сбп':
        return 'sbp';
      case 'transfer':
      case 'bank_transfer':
      case 'перевод':
        return 'transfer';
      case 'online':
      case 'cloudpayments':
      case 'cloudpayments_card':
      case 'cloudpayments_sbp':
        return 'online';
      case 'subscription':
      case 'credits':
        return 'subscription';
      default:
        return fallback;
    }
  }

  private paymentMethodLabel(key: PaymentBreakdownKey): string {
    return PAYMENT_METHODS.find((method) => method.key === key)?.label ?? 'Прочее';
  }

  private printOrderPaymentKey(order: PhotoPrintOrder): PaymentBreakdownKey {
    const method = order.payment_method
      ?? (order.payment_channel === 'online' ? 'online' : null);
    const source = order.source?.toLowerCase() ?? '';
    const onlineFallback = source === 'website' || source === 'miniapp' || source === 'bot';
    const fallback = onlineFallback ? 'online' : order.payment_card_info ? 'card' : 'other';
    return this.paymentMethodKey(method, fallback);
  }

  private printOrderPaymentText(order: PhotoPrintOrder, status: SaleStatus): string {
    if (status === 'pending') return 'Ожидает оплаты';
    if (status === 'cancelled') return 'Отменён';
    if (status === 'failed') return 'Ошибка оплаты';
    if (status === 'refund') return 'Возврат';
    return this.paymentMethodLabel(this.printOrderPaymentKey(order));
  }

  private onlinePaymentText(method: string | null | undefined): string {
    if (!method) return 'Онлайн-оплата';
    if (method === 'card') return 'Онлайн · карта';
    if (method === 'sbp') return 'Онлайн · СБП';
    return `Онлайн · ${method}`;
  }

  private studioFilterLabel(studio: SalesStudio): string {
    switch (studio.location_code) {
      case 'soborny':
        return 'Соборный 21';
      case 'barrikadnaya':
      case 'barrikadnaya-4':
        return 'Баррикадная 4';
      default:
        return studio.name || studio.address || 'Точка';
    }
  }
}
