import { Component, inject, signal, computed, effect, OnInit, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { OrdersApiService, PhotoPrintOrder, OrdersListParams } from '../../services/orders-api.service';
import {
  orderStatusLabel, paymentStatusLabel, paymentStatusIcon,
  priorityLabel, formatRelativeTime,
} from '../../utils/crm-helpers';

@Component({
  selector: 'app-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTableModule, MatPaginatorModule, MatChipsModule,
    MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatMenuModule, MatCardModule,
    MatDividerModule, MatProgressSpinnerModule,
  ],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.scss',
})
export class OrdersComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly dialog = inject(MatDialog);

  orders = signal<PhotoPrintOrder[]>([]);
  totalOrders = signal(0);
  loading = signal(false);
  isDesktop = signal(false);

  searchQuery = signal('');
  statusFilter = signal('');
  priorityFilter = signal('');
  currentPage = signal(1);
  pageSize = signal(25);
  expandedOrder = signal<string | null>(null);

  readonly orderStatusLabel = orderStatusLabel;
  readonly paymentStatusLabel = paymentStatusLabel;
  readonly paymentStatusIcon = paymentStatusIcon;
  readonly priorityLabel = priorityLabel;
  readonly formatRelativeTime = formatRelativeTime;

  readonly displayedColumns = ['order_id', 'client', 'total_price', 'priority', 'status', 'payment_status', 'created_at', 'actions'];

  expandedOrderData = computed(() => {
    const id = this.expandedOrder();
    if (!id) return null;
    return this.orders().find(o => o.order_id === id) || null;
  });

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  private filterEffect = effect(() => {
    const _status = this.statusFilter();
    const _priority = this.priorityFilter();
    const _search = this.searchQuery();
    const _page = this.currentPage();
    const _pageSize = this.pageSize();
    this.loadOrders();
  });

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.breakpointObserver.observe('(min-width: 600px)').subscribe(result => {
        this.isDesktop.set(result.matches);
      });
    }
  }

  loadOrders() {
    this.loading.set(true);
    const params: OrdersListParams = {
      page: this.currentPage(),
      limit: this.pageSize(),
    };
    if (this.statusFilter()) params.status = this.statusFilter();
    if (this.priorityFilter()) params.priority = this.priorityFilter();
    if (this.searchQuery()) params.search = this.searchQuery();

    this.ordersApi.getOrders(params).subscribe({
      next: (res) => {
        this.orders.set(res.data || []);
        this.totalOrders.set(res.total || 0);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  onSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.currentPage.set(1);
      this.searchQuery.set(value);
    }, 300);
  }

  onStatusFilter(value: string) {
    this.currentPage.set(1);
    this.statusFilter.set(value || '');
  }

  onPriorityFilter(value: string) {
    this.currentPage.set(1);
    this.priorityFilter.set(value || '');
  }

  onPageChange(event: PageEvent) {
    this.currentPage.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
  }

  toggleExpand(order: PhotoPrintOrder) {
    this.expandedOrder.set(
      this.expandedOrder() === order.order_id ? null : order.order_id
    );
  }

  changeStatus(order: PhotoPrintOrder, status: string) {
    this.ordersApi.updateStatus(order.order_id, status).subscribe({
      next: () => this.loadOrders(),
      error: () => { /* status update failed */ },
    });
  }

  openDelayDialog(order: PhotoPrintOrder): void {
    import('../order-delay-dialog/order-delay-dialog.component').then(m => {
      this.dialog.open(m.OrderDelayDialogComponent, {
        width: '480px',
        data: {
          orderId: order.order_id,
          contactName: order.contact_name,
        } satisfies import('../order-delay-dialog/order-delay-dialog.component').OrderDelayDialogData,
      }).afterClosed().subscribe(result => {
        if (result?.success) this.loadOrders();
      });
    });
  }

  formatItem(item: unknown): string {
    if (typeof item === 'object' && item !== null) {
      const i = item as Record<string, unknown>;
      const parts: string[] = [];
      if (i['service'] || i['description'] || i['tariff']) {
        parts.push(String(i['service'] || i['description'] || i['tariff']));
      }
      if (i['format']) parts.push(String(i['format']));
      if (i['quantity']) parts.push(`${i['quantity']} шт`);
      if (i['price']) parts.push(`${i['price']}₽`);
      return parts.join(' — ') || JSON.stringify(item);
    }
    return String(item);
  }
}
