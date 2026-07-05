import { Component, inject, signal, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuditApiService, AuditEntry } from '../../services/audit-api.service';

const ACTION_LABELS: Record<string, string> = {
  // Chat
  chat_reply: 'Ответ в чате',
  chat_assign: 'Назначение чата',
  chat_transfer: 'Передача чата',
  chat_auto_close: 'Авто-закрытие чата',
  chat_auto_resolve: 'Авто-решение чата',
  chat_link_client: 'Привязка клиента',
  chat_link_booking: 'Привязка записи',
  chat_update_phone: 'Обновление телефона',
  // Auth
  login_email: 'Вход (email)',
  login_employee: 'Вход (сотрудник)',
  login_failed: 'Неудачный вход',
  // Webhooks
  webhook_received: 'Webhook получен',
  webhook_auth_failed: 'Webhook: ошибка авторизации',
  webhook_error: 'Webhook: ошибка',
  // POS
  'pos:shift_opened': 'Открытие смены',
  'pos:shift_closed': 'Закрытие смены',
  'pos:shift_fiscal_opened': 'Открытие ФР',
  'pos:shift_fiscal_closed': 'Закрытие ФР',
  'pos:receipt_created': 'Создание чека',
  'pos:receipt_refunded': 'Возврат чека',
  'pos:receipt_voided': 'Аннулирование чека',
  'pos:partial_refund': 'Частичный возврат',
  'pos:receipt_from_pricing': 'Чек из прайса',
  'pos:fiscal_retry': 'Повтор фискализации',
  // Channels
  channel_enabled: 'Канал включён',
  channel_disabled: 'Канал отключён',
  // Users
  user_deactivate: 'Деактивация пользователя',
  // Production
  production_house_create: 'Создание типографии',
  production_house_update: 'Обновление типографии',
  production_house_delete: 'Удаление типографии',
  production_order_create: 'Заказ в производство',
  production_status_change: 'Статус производства',
  production_batch_status: 'Пакетный статус',
  production_order_cancel: 'Отмена заказа производства',
  // Outbound
  outbound_dead_letter: 'Недоставленное сообщение',
  // Contacts
  contact_merge: 'Объединение контактов',
  contact_update: 'Обновление контакта',
  contact_create: 'Создание контакта',
  // OAuth
  oauth_link: 'OAuth привязка',
  oauth_unlink: 'OAuth отвязка',
  // Tasks
  task_deadline_warning: 'Предупреждение о дедлайне',
  task_deadline_escalation: 'Эскалация дедлайна',
  // Follow-up
  followup_scheduled: 'Follow-up запланирован',
};

const ENTITY_LABELS: Record<string, string> = {
  chat: 'Чат',
  chat_session: 'Сессия чата',
  conversation: 'Диалог',
  user: 'Пользователь',
  webhook: 'Webhook',
  channel: 'Канал',
  pos_shift: 'Смена POS',
  pos_receipt: 'Чек POS',
  printing_house: 'Типография',
  printing_house_product: 'Продукт типографии',
  production_order: 'Заказ производства',
  product_reference_data: 'Справочник продуктов',
  contact: 'Контакт',
  task: 'Задача',
  booking: 'Запись',
  order: 'Заказ',
};

@Component({
  selector: 'app-audit-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatTableModule, MatPaginatorModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatButtonModule,
    MatIconModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="audit-page">
      <div class="audit-header">
        <h2>Аудит-лог</h2>
        <div class="filters">
          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Действие</mat-label>
            <mat-select [(ngModel)]="filterAction" (selectionChange)="loadPage(0)">
              <mat-option value="">Все</mat-option>
              @for (a of actionOptions; track a.value) {
                <mat-option [value]="a.value">{{ a.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Сущность</mat-label>
            <mat-select [(ngModel)]="filterEntity" (selectionChange)="loadPage(0)">
              <mat-option value="">Все</mat-option>
              @for (e of entityOptions; track e.value) {
                <mat-option [value]="e.value">{{ e.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Дата от</mat-label>
            <input matInput type="date" [(ngModel)]="filterDateFrom" (change)="loadPage(0)">
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Дата до</mat-label>
            <input matInput type="date" [(ngModel)]="filterDateTo" (change)="loadPage(0)">
          </mat-form-field>
        </div>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      }

      <div class="audit-table-wrap">
        <table mat-table [dataSource]="items()">
          <ng-container matColumnDef="time">
            <th mat-header-cell *matHeaderCellDef>Время</th>
            <td mat-cell *matCellDef="let row">{{ formatTime(row.created_at) }}</td>
          </ng-container>

          <ng-container matColumnDef="user">
            <th mat-header-cell *matHeaderCellDef>Пользователь</th>
            <td mat-cell *matCellDef="let row">{{ row.user_name || '—' }}</td>
          </ng-container>

          <ng-container matColumnDef="action">
            <th mat-header-cell *matHeaderCellDef>Действие</th>
            <td mat-cell *matCellDef="let row">{{ actionLabel(row.action) }}</td>
          </ng-container>

          <ng-container matColumnDef="entity">
            <th mat-header-cell *matHeaderCellDef>Сущность</th>
            <td mat-cell *matCellDef="let row">{{ entityLabel(row.entity_type) }}</td>
          </ng-container>

          <ng-container matColumnDef="details">
            <th mat-header-cell *matHeaderCellDef>Детали</th>
            <td mat-cell *matCellDef="let row" class="details-cell">{{ formatDetails(row.details) }}</td>
          </ng-container>

          <ng-container matColumnDef="ip">
            <th mat-header-cell *matHeaderCellDef>IP</th>
            <td mat-cell *matCellDef="let row">{{ row.ip || '—' }}</td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
        </table>
      </div>

      <mat-paginator [length]="total()"
                     [pageSize]="50"
                     [pageIndex]="pageIndex()"
                     (page)="onPage($event)"
                     showFirstLastButtons />
    </div>
  `,
  styles: [`
    .audit-page { padding: 16px; height: 100%; display: flex; flex-direction: column; }

    .audit-header {
      flex-shrink: 0;
      h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }
    }

    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }

    .filter-field {
      width: 160px;
      ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    }

    .audit-table-wrap { flex: 1; overflow: auto; }

    table { width: 100%; }

    .details-cell {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .loading { display: flex; justify-content: center; padding: 24px; }
  `],
})
export class AuditLogComponent {
  private readonly auditApi = inject(AuditApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly items = signal<AuditEntry[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly pageIndex = signal(0);

  filterAction = '';
  filterEntity = '';
  filterDateFrom = '';
  filterDateTo = '';

  readonly displayedColumns = ['time', 'user', 'action', 'entity', 'details', 'ip'];

  readonly actionOptions = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }));
  readonly entityOptions = Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }));

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadPage(0);
    }
  }

  loadPage(page: number): void {
    this.pageIndex.set(page);
    this.loading.set(true);
    this.auditApi.getAuditLog({
      action: this.filterAction || undefined,
      entityType: this.filterEntity || undefined,
      dateFrom: this.filterDateFrom || undefined,
      dateTo: this.filterDateTo || undefined,
      limit: 50,
      offset: page * 50,
    }).subscribe({
      next: (res) => {
        this.items.set(res.items);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onPage(event: PageEvent): void {
    this.loadPage(event.pageIndex);
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  actionLabel(action: string): string {
    return ACTION_LABELS[action] || action;
  }

  entityLabel(entity: string): string {
    return ENTITY_LABELS[entity] || entity;
  }

  formatDetails(details: Record<string, unknown>): string {
    if (!details || !Object.keys(details).length) return '—';
    return JSON.stringify(details).slice(0, 100);
  }
}
