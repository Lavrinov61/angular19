import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DatePipe, DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
import {
  ReviewsApiService,
  ReviewRequest,
  NpsFeedItem,
  ReviewDashboardStats,
} from '../../services/reviews-api.service';

const CHANNEL_ICONS: Record<string, string> = {
  telegram: 'send',
  vk: 'forum',
  max: 'chat',
  whatsapp: 'chat_bubble',
  instagram: 'photo_camera',
  web: 'language',
  online: 'language',
  studio: 'storefront',
  email: 'email',
};

@Component({
  selector: 'app-reviews-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, DecimalPipe,
    MatButtonModule, MatCardModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule,
    MatTabsModule, MatChipsModule, MatTooltipModule,
  ],
  template: `
    <div class="rv-dash">
      <div class="rv-header">
        <h2>
          <mat-icon>star_rate</mat-icon>
          Отзывы
        </h2>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      }

      @if (stats()) {
        <!-- Stats cards -->
        <div class="stats-row">
          <mat-card appearance="outlined" class="stat-card sent">
            <mat-icon>send</mat-icon>
            <span class="stat-value">{{ stats()!.requests.sent7d }}</span>
            <span class="stat-label">Отправлено (7д)</span>
          </mat-card>
          <mat-card appearance="outlined" class="stat-card clicked">
            <mat-icon>touch_app</mat-icon>
            <span class="stat-value">{{ stats()!.requests.clicked7d }}</span>
            <span class="stat-label">Переходы (7д)</span>
          </mat-card>
          <mat-card appearance="outlined" class="stat-card conversion">
            <mat-icon>percent</mat-icon>
            <span class="stat-value">{{ stats()!.requests.conversionRate }}%</span>
            <span class="stat-label">Конверсия</span>
          </mat-card>
          <mat-card appearance="outlined" class="stat-card nps">
            <mat-icon>sentiment_satisfied</mat-icon>
            <span class="stat-value">{{ stats()!.nps.average | number:'1.1-1' }}</span>
            <span class="stat-label">NPS ср.</span>
          </mat-card>
        </div>

        <!-- Platform cards -->
        @if (platformCards().length > 0) {
          <div class="platform-row">
            @for (p of platformCards(); track p.platform) {
              <mat-card appearance="outlined" class="platform-card">
                <span class="platform-name">{{ platformLabel(p.platform) }}</span>
                <span class="platform-rating">{{ p.rating | number:'1.1-1' }} ★</span>
                <span class="platform-count">{{ p.review_count }} отзывов</span>
              </mat-card>
            }
          </div>
        }
      }

      <!-- Tabs -->
      @if (!loading()) {
        <mat-tab-group animationDuration="0ms" class="rv-tabs">
          <!-- Запросы -->
          <mat-tab label="Запросы">
            <div class="tab-content">
              <div class="filter-chips">
                @for (f of statusFilters; track f.value) {
                  <button mat-stroked-button class="filter-chip"
                          [class.active]="requestFilter() === f.value"
                          (click)="setRequestFilter(f.value)">
                    {{ f.label }}
                    @if (f.value !== 'all' && getStatusCount(f.value)) {
                      <span class="chip-count">{{ getStatusCount(f.value) }}</span>
                    }
                  </button>
                }
              </div>

              @if (requests().length === 0) {
                <div class="empty-state">
                  <mat-icon>inbox</mat-icon>
                  <span>Нет запросов</span>
                </div>
              } @else {
                <div class="requests-list">
                  @for (req of requests(); track req.id) {
                    <div class="request-card" [class]="'status-' + req.status">
                      <div class="req-header">
                        <div class="req-client">
                          <mat-icon class="channel-icon" [matTooltip]="req.channel">
                            {{ getChannelIcon(req.channel) }}
                          </mat-icon>
                          <span class="req-name">{{ req.client_name || 'Без имени' }}</span>
                          @if (req.client_phone) {
                            <span class="req-phone">{{ req.client_phone }}</span>
                          }
                        </div>
                        <span class="status-chip" [class]="'chip-' + req.status">
                          {{ statusLabel(req.status) }}
                        </span>
                      </div>

                      <div class="req-meta">
                        <span>
                          <mat-icon>event</mat-icon>
                          {{ req.created_at | date:'dd.MM.yyyy HH:mm' }}
                        </span>
                        @if (req.employee_name) {
                          <span>
                            <mat-icon>person</mat-icon>
                            {{ req.employee_name }}
                          </span>
                        }
                        @if (req.nps_rating) {
                          <span class="nps-badge" [class.nps-low]="req.nps_rating <= 3">
                            {{ req.nps_rating }}★
                          </span>
                        }
                        @if (req.click_platform) {
                          <span class="platform-badge">{{ req.click_platform }}</span>
                        }
                      </div>

                      @if (req.error_message) {
                        <div class="req-error">
                          <mat-icon>error_outline</mat-icon>
                          {{ req.error_message }}
                        </div>
                      }

                      <div class="req-actions">
                        @if (req.status === 'failed' || req.status === 'sent') {
                          <button mat-stroked-button class="resend-btn" (click)="resend(req)"
                                  [disabled]="actionInProgress()">
                            <mat-icon>refresh</mat-icon> Повторить
                          </button>
                        }
                        @if (req.status === 'pending') {
                          <button mat-stroked-button class="cancel-btn" (click)="cancel(req)"
                                  [disabled]="actionInProgress()">
                            <mat-icon>close</mat-icon> Отменить
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </mat-tab>

          <!-- NPS отзывы -->
          <mat-tab label="NPS отзывы">
            <div class="tab-content">
              @if (npsFeed().length === 0) {
                <div class="empty-state">
                  <mat-icon>sentiment_neutral</mat-icon>
                  <span>Нет NPS-оценок</span>
                </div>
              } @else {
                <div class="nps-list">
                  @for (item of npsFeed(); track item.id) {
                    <div class="nps-card" [class.nps-negative]="item.nps_rating <= 3">
                      <div class="nps-header">
                        <div class="nps-stars">
                          @for (s of [1,2,3,4,5]; track s) {
                            <mat-icon class="star" [class.filled]="s <= item.nps_rating">
                              {{ s <= item.nps_rating ? 'star' : 'star_border' }}
                            </mat-icon>
                          }
                        </div>
                        <span class="nps-date">{{ item.created_at | date:'dd.MM HH:mm' }}</span>
                      </div>
                      <div class="nps-client">
                        <mat-icon class="channel-icon" [matTooltip]="item.channel">
                          {{ getChannelIcon(item.channel) }}
                        </mat-icon>
                        {{ item.client_name || 'Клиент' }}
                        @if (item.employee_name) {
                          <span class="nps-employee">· {{ item.employee_name }}</span>
                        }
                      </div>
                      @if (item.comment) {
                        <div class="nps-comment">« {{ item.comment }} »</div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </mat-tab>
        </mat-tab-group>
      }
    </div>
  `,
  styles: `
    :host { display: block; }

    .rv-dash {
      padding: 0 0 32px;
      max-width: 800px;
      margin: 0 auto;
    }

    .rv-header {
      display: flex;
      align-items: center;
      margin-bottom: 24px;
    }
    .rv-header h2 {
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .rv-header h2 mat-icon {
      color: #f59e0b;
      font-size: 28px; width: 28px; height: 28px;
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 60px;
    }

    /* Stats */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 14px 8px;
      gap: 4px;
      background: var(--ed-surface-variant, #1e1e1e) !important;
      border-color: var(--ed-outline, #333) !important;
    }
    .stat-card mat-icon {
      font-size: 22px; width: 22px; height: 22px;
    }
    .stat-card.sent mat-icon { color: #3b82f6; }
    .stat-card.clicked mat-icon { color: #22c55e; }
    .stat-card.conversion mat-icon { color: #a855f7; }
    .stat-card.nps mat-icon { color: #f59e0b; }
    .stat-value {
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }
    .stat-label {
      font-size: 0.72rem;
      color: var(--ed-on-surface-variant, #999);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }

    /* Platforms */
    .platform-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }
    .platform-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px 8px;
      gap: 2px;
      background: var(--ed-surface-variant, #1e1e1e) !important;
      border-color: var(--ed-outline, #333) !important;
    }
    .platform-name {
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--ed-on-surface, #f5f5f5);
    }
    .platform-rating {
      font-size: 1.1rem;
      font-weight: 700;
      color: #f59e0b;
    }
    .platform-count {
      font-size: 0.72rem;
      color: var(--ed-on-surface-variant, #999);
    }

    /* Tabs */
    .rv-tabs { margin-top: 8px; }
    .tab-content { padding-top: 16px; }

    /* Filters */
    .filter-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .filter-chip {
      font-size: 0.82rem !important;
      border-color: var(--ed-outline, #444) !important;
      color: var(--ed-on-surface-variant, #999) !important;
    }
    .filter-chip.active {
      border-color: #f59e0b !important;
      color: #f59e0b !important;
    }
    .chip-count {
      background: rgba(245, 158, 11, 0.2);
      color: #f59e0b;
      border-radius: 10px;
      padding: 1px 6px;
      font-size: 0.72rem;
      margin-left: 4px;
    }

    /* Empty */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 60px 16px;
      color: var(--ed-on-surface-variant, #999);
    }
    .empty-state mat-icon {
      font-size: 48px; width: 48px; height: 48px; opacity: 0.4;
    }

    /* Request cards */
    .requests-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .request-card {
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--ed-surface-variant, #1e1e1e);
      border: 1px solid var(--ed-outline, #333);
    }
    .request-card.status-pending { border-left: 3px solid #f59e0b; }
    .request-card.status-sent { border-left: 3px solid #3b82f6; }
    .request-card.status-clicked { border-left: 3px solid #22c55e; }
    .request-card.status-failed { border-left: 3px solid #ef4444; }
    .request-card.status-cancelled { border-left: 3px solid #666; opacity: 0.6; }

    .req-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .req-client {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .channel-icon {
      font-size: 18px; width: 18px; height: 18px;
      color: var(--ed-on-surface-variant, #999);
    }
    .req-name {
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.9rem;
    }
    .req-phone {
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #999);
    }

    .status-chip {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .chip-pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .chip-sent { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .chip-clicked { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .chip-failed { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .chip-cancelled { background: rgba(102, 102, 102, 0.15); color: #888; }

    .req-meta {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #aaa);
      margin-bottom: 6px;
    }
    .req-meta > span {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .req-meta mat-icon {
      font-size: 14px; width: 14px; height: 14px;
      color: var(--ed-on-surface-variant, #777);
    }

    .nps-badge {
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.78rem;
    }
    .nps-badge.nps-low {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .platform-badge {
      background: rgba(168, 85, 247, 0.15);
      color: #a855f7;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .req-error {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: #ef4444;
      margin-bottom: 6px;
    }
    .req-error mat-icon {
      font-size: 16px; width: 16px; height: 16px;
    }

    .req-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .resend-btn {
      color: #3b82f6 !important;
      border-color: rgba(59, 130, 246, 0.3) !important;
      font-size: 0.8rem;
    }
    .resend-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .cancel-btn {
      color: #ef4444 !important;
      border-color: rgba(239, 68, 68, 0.3) !important;
      font-size: 0.8rem;
    }
    .cancel-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* NPS cards */
    .nps-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .nps-card {
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--ed-surface-variant, #1e1e1e);
      border: 1px solid var(--ed-outline, #333);
    }
    .nps-card.nps-negative {
      background: rgba(239, 68, 68, 0.06);
      border-color: rgba(239, 68, 68, 0.2);
    }
    .nps-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .nps-stars {
      display: flex;
      gap: 2px;
    }
    .star {
      font-size: 18px; width: 18px; height: 18px;
      color: #444;
    }
    .star.filled { color: #f59e0b; }
    .nps-date {
      font-size: 0.75rem;
      color: var(--ed-on-surface-variant, #999);
    }
    .nps-client {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--ed-on-surface, #ddd);
      margin-bottom: 4px;
    }
    .nps-employee {
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #999);
    }
    .nps-comment {
      font-size: 0.85rem;
      color: var(--ed-on-surface-variant, #bbb);
      font-style: italic;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255,255,255,0.03);
      margin-top: 6px;
    }

    @media (max-width: 600px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      .platform-row { grid-template-columns: repeat(2, 1fr); }
    }
  `,
})
export class ReviewsDashboardComponent implements OnInit {
  private readonly api = inject(ReviewsApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);

  readonly loading = signal(true);
  readonly actionInProgress = signal(false);
  readonly stats = signal<ReviewDashboardStats | null>(null);
  readonly requests = signal<ReviewRequest[]>([]);
  readonly npsFeed = signal<NpsFeedItem[]>([]);
  readonly requestFilter = signal<string>('all');

  readonly statusFilters = [
    { value: 'all', label: 'Все' },
    { value: 'pending', label: 'Ожидают' },
    { value: 'sent', label: 'Отправлены' },
    { value: 'clicked', label: 'Кликнули' },
    { value: 'failed', label: 'Ошибки' },
  ];

  readonly platformCards = computed(() => {
    const s = this.stats();
    if (!s?.platforms) return [];
    const unique = new Map<string, { platform: string; review_count: number; rating: number }>();
    for (const p of s.platforms) {
      if (!unique.has(p.platform) || p.review_count > unique.get(p.platform)!.review_count) {
        unique.set(p.platform, p);
      }
    }
    return Array.from(unique.values());
  });

  private statusCounts: Record<string, number> = {};

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadAll();
    }
  }

  setRequestFilter(status: string): void {
    this.requestFilter.set(status);
    this.loadRequests();
  }

  getStatusCount(status: string): number {
    return this.statusCounts[status] || 0;
  }

  getChannelIcon(channel: string): string {
    return CHANNEL_ICONS[channel] || 'chat';
  }

  statusLabel(s: string): string {
    const labels: Record<string, string> = {
      pending: 'Ожидает',
      sent: 'Отправлен',
      clicked: 'Кликнул',
      failed: 'Ошибка',
      cancelled: 'Отменён',
    };
    return labels[s] || s;
  }

  platformLabel(p: string): string {
    const labels: Record<string, string> = {
      '2gis': '2ГИС',
      google: 'Google',
      yandex: 'Яндекс',
    };
    return labels[p] || p;
  }

  resend(req: ReviewRequest): void {
    this.actionInProgress.set(true);
    this.api.resend(req.id).subscribe({
      next: () => {
        this.snackBar.open('Запрос отправлен повторно', 'OK', { duration: 3000 });
        this.actionInProgress.set(false);
        this.loadRequests();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Ошибка', 'Закрыть', { duration: 5000 });
        this.actionInProgress.set(false);
      },
    });
  }

  cancel(req: ReviewRequest): void {
    this.actionInProgress.set(true);
    this.api.cancel(req.id).subscribe({
      next: () => {
        this.snackBar.open('Запрос отменён', 'OK', { duration: 3000 });
        this.actionInProgress.set(false);
        this.loadRequests();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Ошибка', 'Закрыть', { duration: 5000 });
        this.actionInProgress.set(false);
      },
    });
  }

  private loadAll(): void {
    this.loading.set(true);
    forkJoin({
      stats: this.api.getDashboardStats(),
      requests: this.api.getRequests({ limit: 50 }),
      nps: this.api.getNpsFeed(50),
    }).subscribe({
      next: ({ stats, requests, nps }) => {
        this.stats.set(stats.data);
        this.requests.set(requests.data || []);
        this.npsFeed.set(nps.data || []);
        this.computeStatusCounts(requests.data || []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadRequests(): void {
    const filter = this.requestFilter();
    this.api.getRequests({ status: filter, limit: 50 }).subscribe({
      next: (res) => this.requests.set(res.data || []),
    });
  }

  private computeStatusCounts(list: ReviewRequest[]): void {
    this.statusCounts = {};
    for (const r of list) {
      this.statusCounts[r.status] = (this.statusCounts[r.status] || 0) + 1;
    }
  }
}
