import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { OrderHistory, OrderType, OrderStatus, PaymentStatus } from '../models/order-history.model';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class OrderHistoryService {
  private readonly apiService = inject(ApiService);
  private readonly authService = inject(AuthService);
  private log = inject(LoggerService);
  
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  
  constructor() {
    this.log.debug('OrderHistoryService: Initialized with REST API');
  }
  
  getUserOrderHistory(userId?: string): Observable<OrderHistory[]> {
    this.isLoading.set(true);
    this.error.set(null);

    const targetUserId = userId || this.authService.getCurrentUser()?.id;
    if (!targetUserId) {
      this.isLoading.set(false);
      return of([]);
    }

    return this.apiService.getPaginated<OrderHistory>('/orders', {
      clientId: targetUserId,
      page: 1,
      limit: 100
    }).pipe(
      map(response => response.data || []),
      map((orders: OrderHistory[]) => orders.sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt));
        const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(String(b.createdAt));
        return dateB.getTime() - dateA.getTime();
      })),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка загрузки истории заказов:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка загрузки истории заказов');
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  getPhotographerOrders(photographerId?: string): Observable<OrderHistory[]> {
    this.isLoading.set(true);
    this.error.set(null);

    const targetPhotographerId = photographerId || this.authService.getCurrentUser()?.id;
    if (!targetPhotographerId) {
      this.isLoading.set(false);
      return of([]);
    }

    return this.apiService.getPaginated<OrderHistory>('/orders', {
      photographerId: targetPhotographerId,
      page: 1,
      limit: 100
    }).pipe(
      map(response => response.data || []),
      map((orders: OrderHistory[]) => orders.sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt));
        const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(String(b.createdAt));
        return dateB.getTime() - dateA.getTime();
      })),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка загрузки заказов фотографа:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка загрузки заказов фотографа');
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  getOrderDetails(orderId: string): Observable<OrderHistory | null> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.apiService.get<OrderHistory>(`/orders/${orderId}`).pipe(
      map(response => response.data || null),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка загрузки деталей заказа:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка загрузки деталей заказа');
        this.isLoading.set(false);
        return of(null);
      })
    );
  }

  getRecentOrders(limit = 10): Observable<OrderHistory[]> {
    this.isLoading.set(true);
    this.error.set(null);

    const userId = this.authService.getCurrentUser()?.id;
    if (!userId) {
      this.isLoading.set(false);
      return of([]);
    }

    return this.apiService.getPaginated<OrderHistory>('/orders', {
      clientId: userId,
      page: 1,
      limit
    }).pipe(
      map(response => response.data || []),
      map((orders: OrderHistory[]) => orders.sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt));
        const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(String(b.createdAt));
        return dateB.getTime() - dateA.getTime();
      })),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка загрузки последних заказов:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка загрузки последних заказов');
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  getOrdersByStatus(status: OrderStatus, userId?: string): Observable<OrderHistory[]> {
    this.isLoading.set(true);
    this.error.set(null);

    const targetUserId = userId || this.authService.getCurrentUser()?.id;
    if (!targetUserId) {
      this.isLoading.set(false);
      return of([]);
    }

    return this.apiService.getPaginated<OrderHistory>('/orders', {
      clientId: targetUserId,
      status,
      page: 1,
      limit: 100
    }).pipe(
      map(response => response.data || []),
      map((orders: OrderHistory[]) => orders.sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt));
        const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(String(b.createdAt));
        return dateB.getTime() - dateA.getTime();
      })),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка загрузки заказов по статусу:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка загрузки заказов по статусу');
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  getOrdersByType(type: OrderType, userId?: string): Observable<OrderHistory[]> {
    this.isLoading.set(true);
    this.error.set(null);

    const targetUserId = userId || this.authService.getCurrentUser()?.id;
    if (!targetUserId) {
      this.isLoading.set(false);
      return of([]);
    }

    return this.apiService.getPaginated<OrderHistory>('/orders', {
      clientId: targetUserId,
      type,
      page: 1,
      limit: 100
    }).pipe(
      map(response => response.data || []),
      map((orders: OrderHistory[]) => orders.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка загрузки заказов по типу:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка загрузки заказов по типу');
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  getOrderStats(userId?: string): Observable<unknown> {
    const targetUserId = userId || this.authService.getCurrentUser()?.id;
    if (!targetUserId) {
      return of({});
    }

    // Calculate stats from orders
    return this.getUserOrderHistory(targetUserId).pipe(
      map(orders => {
        const stats = {
          total: orders.length,
          byStatus: {} as Record<OrderStatus, number>,
          byType: {} as Record<OrderType, number>,
          totalAmount: 0
        };

        orders.forEach(order => {
          // Count by status
          if (order.status) {
            stats.byStatus[order.status] = (stats.byStatus[order.status] || 0) + 1;
          }
          // Count by type
          if (order.orderType) {
            stats.byType[order.orderType] = (stats.byType[order.orderType] || 0) + 1;
          }
          // Sum total amount
          if (order.totalPrice) {
            stats.totalAmount += order.totalPrice;
          }
        });

        return stats;
      }),
      catchError(error => {
        this.log.error('Ошибка загрузки статистики заказов:', error);
        return of({});
      })
    );
  }

  updateOrderStatus(orderId: string, status: OrderStatus): Observable<OrderHistory> {
    this.isLoading.set(true);
    this.error.set(null);
    
    return this.apiService.put<OrderHistory>(`/orders/${orderId}/status`, { status }).pipe(
      map(response => response.data as OrderHistory),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка обновления статуса заказа:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка обновления статуса заказа');
        this.isLoading.set(false);
        throw error;
      })
    );
  }

  updatePaymentStatus(orderId: string, paymentStatus: PaymentStatus): Observable<OrderHistory> {
    this.isLoading.set(true);
    this.error.set(null);

    // Backend might not have separate endpoint for payment status
    // Using PUT /orders/:id/status as fallback, but ideally should be PUT /orders/:id/payment-status
    return this.apiService.put<OrderHistory>(`/orders/${orderId}/status`, { paymentStatus }).pipe(
      map(response => response.data as OrderHistory),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка обновления статуса оплаты:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка обновления статуса оплаты');
        this.isLoading.set(false);
        throw error;
      })
    );
  }

  addOrderComment(orderId: string, comment: string): Observable<OrderHistory> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.apiService.post<OrderHistory>(`/orders/${orderId}/comments`, { comment }).pipe(
      map(response => {
        // Return updated order with comment
        return response.data as OrderHistory;
      }),
      tap(() => this.isLoading.set(false)),
      catchError(error => {
        this.log.error('Ошибка добавления комментария к заказу:', error);
        this.error.set(error.error?.message || error.message || 'Ошибка добавления комментария к заказу');
        this.isLoading.set(false);
        throw error;
      })
    );
  }

  clearError(): void {
    this.error.set(null);
  }

  reset(): void {
    this.isLoading.set(false);
    this.error.set(null);
  }
}
