import { Component, inject, input, signal, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { TasksApiService, ClientContext } from '../../../services/tasks-api.service';

@Component({
  selector: 'app-client-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    @if (loading()) {
      <mat-card class="client-card"><mat-card-content><p class="loading">Загрузка данных клиента...</p></mat-card-content></mat-card>
    }
    @if (ctx(); as c) {
      <mat-card class="client-card">
        <mat-card-header>
          <mat-icon mat-card-avatar>person</mat-icon>
          <mat-card-title>{{ c.profile.name || 'Клиент' }}</mat-card-title>
          <mat-card-subtitle>
            @if (c.profile.phone) {
              <a [href]="'tel:' + c.profile.phone" class="phone-link">{{ c.profile.phone }}</a>
            }
          </mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <!-- Channels -->
          <div class="channels">
            @for (ch of c.profile.channels; track ch) {
              <mat-chip class="channel-chip">
                <mat-icon class="ch-icon">{{ channelIcon(ch) }}</mat-icon> {{ channelLabel(ch) }}
              </mat-chip>
            }
          </div>

          <!-- Stats row -->
          <div class="stats-row">
            <div class="stat">
              <span class="stat-value">{{ c.profile.total_purchases }}</span>
              <span class="stat-label">покупок</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ c.profile.total_revenue | number:'1.0-0' }} &#8381;</span>
              <span class="stat-label">сумма</span>
            </div>
            @if (c.profile.first_visit) {
              <div class="stat">
                <span class="stat-value">{{ formatDate(c.profile.first_visit) }}</span>
                <span class="stat-label">первый визит</span>
              </div>
            }
          </div>

          <!-- Orders -->
          @if (c.orders.length > 0) {
            <div class="sub-section">
              <h4>Заказы ({{ c.orders.length }})</h4>
              @for (o of c.orders.slice(0, showAllOrders() ? 100 : 3); track o.id) {
                <div class="order-item">
                  <mat-icon class="order-icon" [style.color]="paymentColor(o.payment_status)">
                    {{ o.payment_status === 'paid' ? 'check_circle' : o.payment_status === 'pending' || o.payment_status === 'none' ? 'schedule' : 'cancel' }}
                  </mat-icon>
                  <span class="order-type">{{ o.type === 'print' ? 'Печать' : 'Заказ' }}</span>
                  <span class="order-amount">{{ o.total_amount | number:'1.0-0' }} &#8381;</span>
                  <span class="order-status" [class]="'pay-' + o.payment_status">{{ paymentLabel(o.payment_status) }}</span>
                  @if (o.payment_card_info) {
                    <span class="order-card">{{ o.payment_card_info }}</span>
                  }
                  @if (o.paid_at) {
                    <span class="order-date">{{ formatDate(o.paid_at) }}</span>
                  } @else {
                    <span class="order-date">{{ formatDate(o.created_at) }}</span>
                  }
                </div>
              }
              @if (c.orders.length > 3) {
                <button mat-button (click)="showAllOrders.set(!showAllOrders())">
                  {{ showAllOrders() ? 'Свернуть' : 'Показать все (' + c.orders.length + ')' }}
                </button>
              }
            </div>
          }

          <!-- Bookings -->
          @if (c.bookings.length > 0) {
            <div class="sub-section">
              <h4>Бронирования ({{ c.bookings.length }})</h4>
              @for (b of c.bookings.slice(0, 3); track b.id) {
                <div class="booking-item">
                  <mat-icon>event</mat-icon>
                  <span>{{ formatDateTime(b.start_time) }}</span>
                  <mat-chip [class]="'bs-' + b.status">{{ bookingStatus(b.status) }}</mat-chip>
                </div>
              }
            </div>
          }

          <!-- Other tasks -->
          @if (c.other_tasks.length > 0) {
            <div class="sub-section">
              <h4>Другие задачи ({{ c.other_tasks.length }})</h4>
              @for (t of c.other_tasks.slice(0, 5); track t.id) {
                <div class="task-link-item">
                  <a [routerLink]="['/employee/tasks', t.id]" class="task-link">
                    #{{ t.task_number }} {{ t.title }}
                  </a>
                  <mat-chip [class]="'priority-' + t.priority" class="mini-chip">{{ t.priority }}</mat-chip>
                  <span class="task-status">{{ t.status }}</span>
                </div>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: [`
    .client-card { margin-bottom: 12px; }
    .loading { color: var(--mat-sys-on-surface-variant); font-style: italic; }
    .phone-link { color: var(--mat-sys-primary); text-decoration: none; }
    .channels { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
    .channel-chip { font-size: 12px; }
    .ch-icon { font-size: 14px; width: 14px; height: 14px; margin-right: 2px; }
    .stats-row { display: flex; gap: 24px; margin: 12px 0; padding: 8px; background: var(--mat-sys-surface-variant); border-radius: 8px; }
    .stat { display: flex; flex-direction: column; align-items: center; }
    .stat-value { font-weight: 600; font-size: 16px; }
    .stat-label { font-size: 11px; color: var(--mat-sys-on-surface-variant); }
    .sub-section { margin-top: 12px; }
    .sub-section h4 { font-size: 13px; font-weight: 600; margin: 0 0 6px; color: var(--mat-sys-on-surface-variant); }
    .order-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
    .order-icon { font-size: 16px; width: 16px; height: 16px; }
    .order-type { min-width: 50px; }
    .order-amount { font-weight: 500; }
    .order-status { font-size: 11px; }
    .order-card { font-size: 11px; color: var(--mat-sys-on-surface-variant); font-family: monospace; }
    .order-date { font-size: 11px; color: var(--mat-sys-on-surface-variant); margin-left: auto; }
    .pay-paid { color: var(--crm-status-success); } .pay-pending { color: var(--crm-status-warning); } .pay-none { color: var(--crm-text-muted); } .pay-expired { color: var(--crm-text-muted); }
    .booking-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
    .bs-confirmed { background: var(--crm-status-success-container); } .bs-pending { background: var(--crm-status-warning-container); } .bs-cancelled { background: var(--crm-status-error-container); }
    .task-link-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
    .task-link { color: var(--mat-sys-primary); text-decoration: none; }
    .task-link:hover { text-decoration: underline; }
    .mini-chip { font-size: 10px; min-height: 20px; padding: 0 8px; }
    .task-status { font-size: 11px; color: var(--mat-sys-on-surface-variant); margin-left: auto; }
    .priority-urgent { background: var(--crm-status-error); color: white; }
    .priority-high { background: var(--crm-status-warning); color: white; }
  `],
})
export class ClientCardComponent implements OnInit, OnChanges {
  private readonly tasksApi = inject(TasksApiService);
  private readonly http = inject(HttpClient);

  taskId = input<string>();
  clientPhone = input<string>();
  ctx = signal<ClientContext | null>(null);
  loading = signal(false);
  showAllOrders = signal(false);

  ngOnInit(): void {
    this.loadData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['clientPhone'] && !changes['clientPhone'].firstChange) {
      this.loadData();
    }
  }

  private loadData(): void {
    const phone = this.clientPhone();
    const tid = this.taskId();

    if (!phone && !tid) return;

    this.loading.set(true);
    this.ctx.set(null);

    if (phone) {
      this.http.get<{ success: boolean; data: ClientContext }>('/api/crm-booking/client-context', {
        params: { phone },
      }).subscribe({
        next: (res) => { this.ctx.set(res.data || null); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
    } else if (tid) {
      this.tasksApi.getClientContext(tid).subscribe({
        next: (res) => { this.ctx.set(res.data || null); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
    }
  }

  channelIcon(ch: string): string {
    return { website: 'language', whatsapp: 'chat', telegram: 'send', max: 'forum' }[ch] || 'chat';
  }

  channelLabel(ch: string): string {
    return { website: 'Сайт', whatsapp: 'WhatsApp', telegram: 'Telegram', max: 'МАКС' }[ch] || ch;
  }

  paymentColor(s: string): string {
    return { paid: 'var(--crm-status-success)', pending: 'var(--crm-status-warning)', none: 'var(--crm-text-muted)', failed: 'var(--crm-status-error)' }[s] || 'var(--crm-text-muted)';
  }

  paymentLabel(s: string): string {
    return { paid: 'Оплачен', pending: 'Ожидание', none: 'Без оплаты', failed: 'Ошибка' }[s] || s;
  }

  bookingStatus(s: string): string {
    return { pending: 'Ожидание', confirmed: 'Подтверждено', cancelled: 'Отменено', completed: 'Завершено' }[s] || s;
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
