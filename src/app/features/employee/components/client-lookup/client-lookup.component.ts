import { Component, inject, signal, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { CrmClientsApiService, ClientLookupResult, ClientOrder } from '../../services/crm-clients-api.service';
import { TelephonyService } from '../../services/telephony.service';

@Component({
  selector: 'app-client-lookup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatDividerModule,
    DecimalPipe,
    DatePipe,
  ],
  template: `
    <div class="lookup-page">
      <h2>Поиск клиента</h2>

      <mat-card class="search-card">
        <div class="search-row">
          <mat-form-field class="phone-field">
            <mat-label>Номер телефона</mat-label>
            <input matInput
                   [(ngModel)]="phoneInput"
                   placeholder="+7 (___) ___-__-__"
                   (keydown.enter)="search()"
                   type="tel"
                   autocomplete="off">
            <mat-icon matPrefix>phone</mat-icon>
            @if (phoneInput) {
              <button matSuffix mat-icon-button (click)="clear()">
                <mat-icon>close</mat-icon>
              </button>
            }
          </mat-form-field>
          <button mat-flat-button color="primary" (click)="search()" [disabled]="loading()">
            <ng-container>
              @if (loading()) {
                <mat-spinner diameter="20" />
              } @else {
                <mat-icon>search</mat-icon>
                Найти
              }
            </ng-container>
          </button>
        </div>

        @if (error()) {
          <div class="error-msg">{{ error() }}</div>
        }
      </mat-card>

      <!-- Client Card -->
      @if (client()) {
        <mat-card class="client-card">
          <div class="client-header">
            <mat-icon class="client-avatar">account_circle</mat-icon>
            <div class="client-info">
              <div class="client-name">{{ client()!.name }}</div>
              <div class="client-phone">{{ client()!.phone }}</div>
              @if (client()!.email) {
                <div class="client-email">{{ client()!.email }}</div>
              }
            </div>
            <div class="client-actions">
              <button mat-icon-button (click)="callClient()" title="Позвонить">
                <mat-icon>call</mat-icon>
              </button>
            </div>
          </div>

          <div class="client-stats">
            <div class="stat">
              <div class="stat-value">{{ client()!.total_orders }}</div>
              <div class="stat-label">Заказов</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ client()!.source === 'user' ? 'Да' : 'Нет' }}</div>
              <div class="stat-label">Аккаунт</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ clientSince() }}</div>
              <div class="stat-label">Клиент с</div>
            </div>
          </div>
        </mat-card>

        <!-- Orders History -->
        @if (orders().length) {
          <mat-card class="orders-card">
            <h3>История заказов</h3>
            @for (order of orders(); track order.id) {
              <div class="order-row">
                <div class="order-icon">
                  <mat-icon>{{ getOrderIcon(order.type) }}</mat-icon>
                </div>
                <div class="order-info">
                  <div class="order-desc">{{ order.description }}</div>
                  <div class="order-meta">
                    {{ order.date | date:'dd.MM.yy HH:mm' }} ·
                    <mat-chip class="order-status" [class]="'status-' + order.status">{{ getStatusLabel(order.status) }}</mat-chip>
                  </div>
                </div>
                <div class="order-amount">
                  @if (order.amount) {
                    {{ order.amount | number:'1.0-0' }} ₽
                  }
                </div>
              </div>
            }
          </mat-card>
        } @else if (!loadingOrders()) {
          <mat-card class="no-orders">
            <mat-icon>receipt_long</mat-icon>
            <span>Нет заказов</span>
          </mat-card>
        }

        @if (loadingOrders()) {
          <div class="loading-center">
            <mat-spinner diameter="28" />
          </div>
        }
      }

      @if (searched() && !client() && !loading()) {
        <mat-card class="not-found">
          <mat-icon>person_off</mat-icon>
          <span>Клиент не найден</span>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .lookup-page { max-width: 600px; margin: 0 auto; padding: 16px; }

    h2 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface);
    }

    .search-card { padding: 16px; margin-bottom: 16px; }

    .search-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;

      button { height: 56px; min-width: 100px; }
    }

    .phone-field { flex: 1; }

    .error-msg {
      color: var(--mat-sys-error);
      font-size: 13px;
      margin-top: 8px;
    }

    /* Client Card */
    .client-card { padding: 16px; margin-bottom: 16px; }

    .client-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .client-avatar {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--mat-sys-primary);
    }

    .client-info { flex: 1; }

    .client-name {
      font-size: 18px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }

    .client-phone {
      font-size: 14px;
      color: var(--mat-sys-on-surface-variant);
    }

    .client-email {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    .client-stats {
      display: flex;
      gap: 24px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .stat { text-align: center; }

    .stat-value {
      font-size: 20px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }

    .stat-label {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
    }

    /* Orders */
    .orders-card {
      padding: 16px;
      margin-bottom: 16px;

      h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
    }

    .order-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--mat-sys-surface-container);

      &:last-child { border-bottom: none; }
    }

    .order-icon {
      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .order-info { flex: 1; min-width: 0; }

    .order-desc {
      font-size: 13px;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .order-meta {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 2px;
    }

    .order-status {
      font-size: 10px;
      height: 20px;
      min-height: 20px;
      padding: 0 6px;
    }

    .status-completed, .status-done { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .status-pending, .status-new { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    .status-cancelled, .status-refund { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    .status-in_progress, .status-processing { background: var(--crm-status-info-muted); color: var(--crm-status-info); }

    .order-amount {
      font-size: 14px;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
    }

    .not-found, .no-orders {
      padding: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 14px;

      mat-icon { font-size: 40px; width: 40px; height: 40px; }
    }

    .loading-center { display: flex; justify-content: center; padding: 24px; }
  `],
})
export class ClientLookupComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly api = inject(CrmClientsApiService);
  private readonly telephony = inject(TelephonyService);

  phoneInput = '';
  loading = signal(false);
  loadingOrders = signal(false);
  searched = signal(false);
  error = signal<string | null>(null);
  client = signal<ClientLookupResult | null>(null);
  orders = signal<ClientOrder[]>([]);

  search(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const digits = this.phoneInput.replace(/\D/g, '');
    if (digits.length < 10) {
      this.error.set('Введите полный номер телефона (минимум 10 цифр)');
      return;
    }

    this.error.set(null);
    this.loading.set(true);
    this.searched.set(true);
    this.client.set(null);
    this.orders.set([]);

    this.api.lookupClient(this.phoneInput).subscribe({
      next: (results) => {
        this.loading.set(false);
        if (results.length > 0) {
          this.client.set(results[0]);
          this.loadOrders(this.phoneInput);
        }
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Ошибка поиска');
      },
    });
  }

  private loadOrders(phone: string): void {
    this.loadingOrders.set(true);
    this.api.getClientOrders(phone).subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.loadingOrders.set(false);
      },
      error: () => this.loadingOrders.set(false),
    });
  }

  clear(): void {
    this.phoneInput = '';
    this.client.set(null);
    this.orders.set([]);
    this.searched.set(false);
    this.error.set(null);
  }

  callClient(): void {
    const phone = this.client()?.phone;
    if (phone) {
      this.telephony.makeCall(phone);
    }
  }

  get clientSince(): () => string {
    return () => {
      const c = this.client();
      if (!c?.first_seen) return '—';
      const d = new Date(c.first_seen);
      const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
      return `${months[d.getMonth()]} ${d.getFullYear()}`;
    };
  }

  getOrderIcon(type: string): string {
    switch (type) {
      case 'booking': return 'event';
      case 'print_order': return 'print';
      case 'pos_receipt': return 'receipt';
      default: return 'shopping_bag';
    }
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      completed: 'Выполнен',
      done: 'Готово',
      pending: 'Ожидает',
      new: 'Новый',
      cancelled: 'Отменён',
      refund: 'Возврат',
      in_progress: 'В работе',
      processing: 'Обработка',
      confirmed: 'Подтверждён',
      delivered: 'Доставлен',
    };
    return labels[status] || status;
  }
}
