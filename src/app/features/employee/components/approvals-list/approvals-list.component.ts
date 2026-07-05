import { Component, inject, signal, computed, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { formatRelativeTime } from '../../utils/crm-helpers';

interface PipelineSession {
  id: string;
  public_token: string;
  client_name: string;
  client_phone: string;
  title: string;
  status: string;
  order_id: string | null;
  order_ref: string | null;
  order_status: string | null;
  payment_status: string | null;
  service_summary: string | null;
  total_photos: number;
  approved_count: number;
  rejected_count: number;
  link_sent_at: string | null;
  link_sent_via: string | null;
  first_viewed_at: string | null;
  created_at: string;
  updated_at: string;
  expired_at: string | null;
  sla_hours: number;
  hours_elapsed: number;
  total_variants: number;
  channel: string | null;
  photographer_name: string | null;
}

interface PipelineStats {
  active: string;
  approved_total: string;
  total: string;
  avg_hours: string | null;
  expired_count: string;
}

type PipelineColumn = 'waiting' | 'in_review' | 'changes' | 'approved' | 'done';
type ServiceFilter = 'all' | 'photo-docs';

const COLUMN_CONFIG: { key: PipelineColumn; label: string; icon: string; statuses: string[]; color: string }[] = [
  { key: 'waiting', label: 'Ожидает', icon: 'hourglass_empty', statuses: ['pending'], color: '#f59e0b' },
  { key: 'in_review', label: 'На проверке', icon: 'visibility', statuses: ['in_review'], color: '#3b82f6' },
  { key: 'changes', label: 'Правки', icon: 'edit', statuses: ['changes_requested', 'partially_approved'], color: '#ef4444' },
  { key: 'approved', label: 'Одобрено', icon: 'check_circle', statuses: ['approved'], color: '#22c55e' },
  { key: 'done', label: 'Завершено', icon: 'done_all', statuses: ['completed'], color: '#6b7280' },
];

@Component({
  selector: 'app-approvals-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="pipeline-page">
      <!-- Header -->
      <div class="page-header">
        <h2>Pipeline согласований</h2>
        <div class="header-actions">
          <button mat-stroked-button [class.quick-active]="isDocumentLinkList()" (click)="showDocumentLinkList()">
            <mat-icon>badge</mat-icon> Документы с ссылкой
          </button>
          <button mat-flat-button (click)="createNew()">
            <mat-icon>add</mat-icon> Новое
          </button>
        </div>
      </div>

      <!-- Stats Bar -->
      @if (stats()) {
        <div class="stats-bar">
          <div class="stat-item">
            <span class="stat-value">{{ stats()!.active }}</span>
            <span class="stat-label">Активных</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ stats()!.avg_hours ? (stats()!.avg_hours | number:'1.0-1') + 'ч' : '—' }}</span>
            <span class="stat-label">Средн. время</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ approvalRate() }}%</span>
            <span class="stat-label">Одобрения</span>
          </div>
          <div class="stat-item" [class.expired-highlight]="+(stats()!.expired_count) > 0">
            <span class="stat-value">{{ stats()!.expired_count }}</span>
            <span class="stat-label">Просрочено</span>
          </div>
        </div>
      }

      <!-- Filters -->
      <div class="filter-bar">
        <input class="search-input" placeholder="Поиск клиента, телефона или заказа..."
               [(ngModel)]="searchQuery" (input)="onSearch()" />
        <select class="filter-select" [(ngModel)]="serviceFilter" (change)="loadSessions()">
          <option value="all">Все услуги</option>
          <option value="photo-docs">Фото на документы</option>
        </select>
        <label class="filter-check">
          <input type="checkbox" [(ngModel)]="sentOnly" (change)="loadSessions()" />
          <span>Ссылка отправлена</span>
        </label>
        <select class="filter-select" [(ngModel)]="viewMode" (change)="loadSessions()">
          <option value="kanban">Kanban</option>
          <option value="list">Список</option>
        </select>
      </div>

      @if (loading()) {
        <div class="center"><mat-spinner diameter="32" /></div>
      } @else if (viewMode === 'kanban') {
        <!-- Kanban View -->
        <div class="kanban-board">
          @for (col of columns; track col.key) {
            <div class="kanban-column">
              <div class="column-header" [style.border-bottom-color]="col.color">
                <mat-icon [style.color]="col.color">{{ col.icon }}</mat-icon>
                <span class="column-title">{{ col.label }}</span>
                <span class="column-count">{{ columnSessions(col.key).length }}</span>
              </div>
              <div class="column-cards">
                @for (s of columnSessions(col.key); track s.id) {
                  <div class="pipeline-card" (click)="openSession(s)" (keydown.enter)="openSession(s)" tabindex="0">
                    <div class="card-row-1">
                      <span class="card-client">{{ s.client_name }}</span>
                      @if (s.channel) {
                        <span class="card-channel">{{ channelLabel(s.channel) }}</span>
                      }
                    </div>
                    <div class="card-title">{{ s.title }}</div>
                    <div class="card-contact">
                      @if (s.client_phone) {
                        <span>{{ s.client_phone }}</span>
                      }
                      @if (s.order_ref || s.order_id) {
                        <span>{{ s.order_ref || s.order_id }}</span>
                      }
                    </div>
                    <div class="card-row-2">
                      <span class="card-photos">{{ s.approved_count }}/{{ s.total_photos }} фото</span>
                      @if (s.link_sent_at) {
                        <span class="link-chip">ссылка</span>
                      }
                      @if (s.payment_status) {
                        <span [class]="'payment-chip pay-' + s.payment_status">
                          {{ paymentStatusLabel(s.payment_status) }}
                        </span>
                      }
                      @if (s.total_variants > 0) {
                        <span class="card-variants">{{ s.total_variants }} вар.</span>
                      }
                      <span class="card-sla" [class.sla-breach]="s.hours_elapsed > s.sla_hours"
                            [class.sla-warning]="s.hours_elapsed > s.sla_hours * 0.7 && s.hours_elapsed <= s.sla_hours">
                        {{ formatElapsed(s.hours_elapsed) }}
                      </span>
                    </div>
                    @if (s.first_viewed_at) {
                      <span class="viewed-badge" matTooltip="Просмотрено клиентом">
                        <mat-icon>visibility</mat-icon>
                      </span>
                    }
                  </div>
                } @empty {
                  <div class="column-empty">Пусто</div>
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <!-- List View -->
        <div class="sessions-list">
          @for (s of filteredSessions(); track s.id) {
            <div class="session-card" (click)="openSession(s)" (keydown.enter)="openSession(s)" tabindex="0">
              <div class="card-top">
                <span class="card-title-list">{{ s.title }}</span>
                <span class="card-time">{{ formatRelativeTime(s.created_at) }}</span>
              </div>
              <div class="card-client-list">
                <span>{{ s.client_name }}</span>
                @if (s.client_phone) {
                  <span>{{ s.client_phone }}</span>
                }
                @if (s.order_ref || s.order_id) {
                  <span>{{ s.order_ref || s.order_id }}</span>
                }
              </div>
              @if (s.service_summary) {
                <div class="card-service">{{ s.service_summary }}</div>
              }
              <div class="card-meta">
                <span [class]="'status-chip st-' + s.status">
                  {{ statusLabel(s.status) }}
                </span>
                @if (s.link_sent_at) {
                  <span class="link-chip">Ссылка {{ linkSentLabel(s) }}</span>
                }
                @if (s.payment_status) {
                  <span [class]="'payment-chip pay-' + s.payment_status">
                    {{ paymentStatusLabel(s.payment_status) }}
                  </span>
                }
                <span class="photo-count">{{ s.approved_count }}/{{ s.total_photos }}</span>
                <span class="card-sla" [class.sla-breach]="s.hours_elapsed > s.sla_hours">
                  {{ formatElapsed(s.hours_elapsed) }}
                </span>
                @if (s.first_viewed_at) {
                  <mat-icon class="viewed-icon">visibility</mat-icon>
                }
              </div>
            </div>
          } @empty {
            <div class="empty">
              <mat-icon>photo_camera</mat-icon>
              <span>Нет согласований</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .pipeline-page {
      padding: 16px;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      h2 { margin: 0; font-size: 18px; font-weight: 600; }
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;

      button {
        min-height: 36px;
      }
    }

    .quick-active {
      border-color: var(--crm-accent-primary);
      color: var(--crm-accent-primary);
      background: var(--crm-status-info-muted);
    }

    .stats-bar {
      display: flex;
      gap: 16px;
      padding: 12px 16px;
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      margin-bottom: 12px;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
    }

    .stat-value { font-size: 20px; font-weight: 700; color: var(--crm-text-primary); }
    .stat-label { font-size: 11px; color: var(--crm-text-muted); }
    .expired-highlight .stat-value { color: var(--crm-status-error); }

    .filter-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .search-input {
      flex: 1;
      min-width: 220px;
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      padding: 8px 12px;
      color: var(--crm-text-primary);
      font-size: 13px;
      outline: none;
      &:focus { border-color: var(--crm-accent-primary); }
    }

    .filter-select {
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      padding: 8px 12px;
      color: var(--crm-text-primary);
      font-size: 13px;
      outline: none;
    }

    .filter-check {
      min-height: 35px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      color: var(--crm-text-secondary);
      font-size: 12px;
      white-space: nowrap;

      input {
        width: 14px;
        height: 14px;
        accent-color: var(--crm-accent-primary);
      }
    }

    .center { display: flex; justify-content: center; padding: 40px; }

    // ─── Kanban ──────────────────────

    .kanban-board {
      display: flex;
      gap: 8px;
      flex: 1;
      overflow-x: auto;
      padding-bottom: 8px;
    }

    .kanban-column {
      flex: 1;
      min-width: 200px;
      max-width: 280px;
      display: flex;
      flex-direction: column;
    }

    .column-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 3px solid;
      margin-bottom: 8px;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      .column-title { font-size: 13px; font-weight: 600; }
      .column-count {
        margin-left: auto;
        background: rgba(255,255,255,0.06);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
      }
    }

    .column-cards {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      overflow-y: auto;
    }

    .pipeline-card {
      padding: 10px;
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      cursor: pointer;
      transition: background 0.15s;
      position: relative;

      &:hover { background: var(--crm-surface-hover); }
    }

    .card-row-1 {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-client { font-size: 13px; font-weight: 600; }
    .card-channel { font-size: 10px; color: var(--crm-text-muted); background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; }
    .card-title { font-size: 11px; color: var(--crm-text-muted); margin: 2px 0 6px; }
    .card-contact {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-bottom: 6px;
      color: var(--crm-text-muted);
      font-size: 10px;
      line-height: 1.3;
    }

    .card-row-2 {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 11px;
      color: var(--crm-text-muted);
    }

    .card-photos { color: var(--crm-text-secondary); }
    .card-variants { color: var(--crm-accent-primary); }

    .card-sla {
      margin-left: auto;
      font-size: 10px;
      font-weight: 600;
      &.sla-warning { color: var(--crm-status-warning); }
      &.sla-breach { color: var(--crm-status-error); }
    }

    .viewed-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-status-success); }
    }

    .column-empty {
      text-align: center;
      padding: 20px;
      color: var(--crm-text-muted);
      font-size: 12px;
    }

    // ─── List View ──────────────────────

    .sessions-list { display: flex; flex-direction: column; gap: 6px; }

    .session-card {
      padding: 10px 14px;
      border-radius: var(--crm-radius-lg);
      cursor: pointer;
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      transition: background 0.15s;
      &:hover { background: var(--crm-surface-hover); }
    }

    .card-top { display: flex; justify-content: space-between; align-items: baseline; }
    .card-title-list { font-size: 14px; font-weight: 500; }
    .card-time { font-size: 11px; color: var(--crm-text-muted); }
    .card-client-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      font-size: 13px;
      color: var(--crm-text-muted);
      margin: 2px 0;
    }
    .card-service {
      margin-bottom: 5px;
      color: var(--crm-text-secondary);
      font-size: 12px;
    }
    .card-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    .status-chip,
    .link-chip,
    .payment-chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: var(--crm-radius-sm);
      white-space: nowrap;
    }

    .st-pending { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    .st-in_review { background: var(--crm-status-info-muted); color: var(--crm-status-info); }
    .st-approved { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .st-partially_approved { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    .st-changes_requested { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    .st-completed { background: var(--crm-surface-raised); color: var(--crm-text-secondary); }
    .link-chip { background: var(--crm-status-info-muted); color: var(--crm-status-info); }
    .pay-paid { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .pay-pending,
    .pay-none { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    .pay-failed,
    .pay-cancelled { background: var(--crm-status-error-muted); color: var(--crm-status-error); }

    .photo-count { font-size: 12px; color: var(--crm-text-muted); }
    .viewed-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-status-success); }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px;
      color: var(--crm-text-muted);
      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; }
    }
  `],
})
export class ApprovalsListComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  readonly columns = COLUMN_CONFIG;
  readonly sessions = signal<PipelineSession[]>([]);
  readonly stats = signal<PipelineStats | null>(null);
  readonly loading = signal(true);

  searchQuery = '';
  viewMode: 'kanban' | 'list' = 'kanban';
  serviceFilter: ServiceFilter = 'all';
  sentOnly = false;

  readonly formatRelativeTime = formatRelativeTime;

  readonly approvalRate = computed(() => {
    const s = this.stats();
    if (!s || +s.total === 0) return 0;
    return Math.round((+s.approved_total / +s.total) * 100);
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadSessions();
    }
  }

  loadSessions(): void {
    this.loading.set(true);
    const params: Record<string, string> = {};
    if (this.searchQuery.trim()) params['search'] = this.searchQuery.trim();
    if (this.serviceFilter !== 'all') params['service'] = this.serviceFilter;
    if (this.sentOnly) params['link_sent'] = 'true';

    this.http.get<{ success: boolean; sessions: PipelineSession[]; stats: PipelineStats }>(
      '/api/photo-approvals/pipeline', { params }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.sessions.set(res.sessions);
          this.stats.set(res.stats);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  filteredSessions(): PipelineSession[] {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) return this.sessions();
    return this.sessions().filter(s =>
      s.client_name.toLowerCase().includes(q)
      || (s.client_phone ?? '').toLowerCase().includes(q)
      || s.title.toLowerCase().includes(q)
      || (s.order_ref ?? s.order_id ?? '').toLowerCase().includes(q)
      || (s.service_summary ?? '').toLowerCase().includes(q)
    );
  }

  columnSessions(colKey: PipelineColumn): PipelineSession[] {
    const col = COLUMN_CONFIG.find(c => c.key === colKey);
    if (!col) return [];
    const filtered = this.filteredSessions();
    return filtered.filter(s => col.statuses.includes(s.status));
  }

  onSearch(): void {
    // Client-side filtering — no API call needed since we have all data
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Ожидает', in_review: 'На проверке', approved: 'Одобрено',
      partially_approved: 'Частично', changes_requested: 'Правки', completed: 'Завершено',
    };
    return labels[status] || status;
  }

  channelLabel(ch: string): string {
    const labels: Record<string, string> = {
      online: 'Сайт', studio: 'Студия', chat: 'чат', telegram: 'TG', vk: 'VK', whatsapp: 'WA', max: 'МАКС',
    };
    return labels[ch] || ch;
  }

  paymentStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      paid: 'Оплачен',
      pending: 'Не оплачен',
      none: 'Не оплачен',
      failed: 'Ошибка оплаты',
      cancelled: 'Отменена',
      refunded: 'Возврат',
    };
    return labels[status] || status;
  }

  linkSentLabel(session: PipelineSession): string {
    if (!session.link_sent_at) return 'не отправлена';
    return session.link_sent_via ? `через ${this.channelLabel(session.link_sent_via)}` : 'отправлена';
  }

  isDocumentLinkList(): boolean {
    return this.serviceFilter === 'photo-docs' && this.sentOnly && this.viewMode === 'list';
  }

  showDocumentLinkList(): void {
    this.serviceFilter = 'photo-docs';
    this.sentOnly = true;
    this.viewMode = 'list';
    this.loadSessions();
  }

  formatElapsed(hours: number): string {
    if (hours < 1) return `${Math.round(hours * 60)}м`;
    if (hours < 24) return `${Math.round(hours)}ч`;
    return `${Math.round(hours / 24)}д`;
  }

  openSession(s: PipelineSession): void {
    this.router.navigate(['/employee'], { queryParams: { approvalId: s.id } });
  }

  createNew(): void {
    this.router.navigate(['/employee'], { queryParams: { newApproval: true } });
  }
}
