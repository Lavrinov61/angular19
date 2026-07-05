import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { AuthService } from '../../../../core/services/auth.service';
import { OrderHistory, OrderStatus, OrderType } from '../../../../core/models/order-history.model';
import { OrdersHistoryApiResponse, mapRawOrders } from '../../../../core/utils/order-mapping.utils';

type HistoryState = 'loading' | 'loaded' | 'empty' | 'error';
type HistoryFilter = 'all' | 'ready' | 'inProgress' | 'completed';

interface FilterChip {
  id: HistoryFilter;
  label: string;
}

@Component({
  selector: 'app-cabinet-history',
  imports: [CurrencyPipe, DatePipe, RouterLink, MatIconModule, MatProgressBarModule],
  templateUrl: './cabinet-history.component.html',
  styleUrl: './cabinet-history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CabinetHistoryComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  protected readonly orders = signal<OrderHistory[]>([]);
  protected readonly state = signal<HistoryState>('loading');
  protected readonly searchQuery = signal('');
  protected readonly activeFilter = signal<HistoryFilter>('all');

  protected readonly filters: FilterChip[] = [
    { id: 'all', label: 'Все' },
    { id: 'ready', label: 'Готовые' },
    { id: 'inProgress', label: 'В работе' },
    { id: 'completed', label: 'Завершённые' },
  ];

  protected readonly filteredOrders = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.orders().filter(order => {
      const title = this.getOrderTitle(order).toLowerCase();
      const status = this.getStatusLabel(order.status).toLowerCase();
      const id = order.id.toLowerCase();
      const matchesSearch =
        !query || title.includes(query) || status.includes(query) || id.includes(query);
      if (!matchesSearch) {
        return false;
      }

      if (filter === 'ready') {
        return order.status === OrderStatus.READY;
      }
      if (filter === 'inProgress') {
        return (
          order.status === OrderStatus.NEW ||
          order.status === OrderStatus.PROCESSING ||
          order.status === OrderStatus.WAITING_APPROVAL
        );
      }
      if (filter === 'completed') {
        return order.status === OrderStatus.COMPLETED;
      }
      return true;
    });
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.fetchOrders();
  }

  protected setFilter(filter: HistoryFilter): void {
    this.activeFilter.set(filter);
  }

  protected onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected getOrderTitle(order: OrderHistory): string {
    switch (order.orderType) {
      case OrderType.PHOTO_SESSION:
        return order.photoSession?.title || 'Фотосессия';
      case OrderType.DOCUMENT_PHOTO:
        return `Фото на ${order.documentPhoto?.documentType || 'документы'}`;
      case OrderType.PHOTO_RESTORATION:
        return 'Реставрация фотографии';
      case OrderType.PHOTO_PRINTING:
        return `Печать фотографий ${order.photoPrinting?.format || ''}`.trim();
      case OrderType.PHOTO_EDITING:
        return 'Ретушь и обработка';
      case OrderType.PHOTO_PRODUCTS:
        return 'Фотопродукция';
      case OrderType.FRAMING:
        return 'Багетные работы';
      default:
        return 'Заказ';
    }
  }

  protected getOrderTypeIcon(type: OrderType): string {
    const icons: Record<OrderType, string> = {
      [OrderType.DOCUMENT_PHOTO]: 'badge',
      [OrderType.PHOTO_SESSION]: 'photo_camera',
      [OrderType.PHOTO_RESTORATION]: 'auto_fix_high',
      [OrderType.PHOTO_PRINTING]: 'print',
      [OrderType.PHOTO_EDITING]: 'tune',
      [OrderType.PHOTO_PRODUCTS]: 'inventory_2',
      [OrderType.FRAMING]: 'crop_square',
    };
    return icons[type] ?? 'receipt_long';
  }

  protected getStatusLabel(status: OrderStatus | string): string {
    const labels: Record<string, string> = {
      new: 'Новый',
      processing: 'В работе',
      waiting: 'На согласовании',
      ready: 'Готов',
      completed: 'Завершён',
      cancelled: 'Отменён',
      refunded: 'Возврат',
    };
    return labels[status] ?? String(status);
  }

  private fetchOrders(): void {
    const userId = this.authService.getCurrentUser()?.id ?? '';
    this.state.set('loading');
    this.http.get<OrdersHistoryApiResponse>('/api/orders/my-history?limit=50').subscribe({
      next: response => {
        const mapped = mapRawOrders(response.data ?? [], userId);
        this.orders.set(mapped);
        this.state.set(mapped.length > 0 ? 'loaded' : 'empty');
      },
      error: () => {
        this.state.set('error');
      },
    });
  }
}
