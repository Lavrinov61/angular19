import { Component, inject, signal, ChangeDetectionStrategy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
import {
  RefundManagerApiService,
  RefundRequest,
  RefundStats,
} from '../../services/refund-manager-api.service';

@Component({
  selector: 'app-refund-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, DecimalPipe, FormsModule,
    MatButtonModule, MatButtonToggleModule, MatCardModule,
    MatIconModule, MatProgressSpinnerModule, MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="rf-dash">
      <div class="rf-header">
        <h2>
          <mat-icon>currency_exchange</mat-icon>
          Возвраты
        </h2>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      }

      @if (stats()) {
        <div class="stats-row">
          <mat-card appearance="outlined" class="stat-card pending"
                    [class.active]="filter() === 'pending'" (click)="setFilter('pending')">
            <mat-icon>schedule</mat-icon>
            <span class="stat-value">{{ stats()!.pending }}</span>
            <span class="stat-label">Ожидают</span>
          </mat-card>
          <mat-card appearance="outlined" class="stat-card approved"
                    [class.active]="filter() === 'approved'" (click)="setFilter('approved')">
            <mat-icon>check_circle</mat-icon>
            <span class="stat-value">{{ stats()!.approved }}</span>
            <span class="stat-label">Одобрено</span>
          </mat-card>
          <mat-card appearance="outlined" class="stat-card rejected"
                    [class.active]="filter() === 'rejected'" (click)="setFilter('rejected')">
            <mat-icon>cancel</mat-icon>
            <span class="stat-value">{{ stats()!.rejected }}</span>
            <span class="stat-label">Отклонено</span>
          </mat-card>
          <mat-card appearance="outlined" class="stat-card total"
                    [class.active]="filter() === 'all'" (click)="setFilter('all')">
            <mat-icon>list_alt</mat-icon>
            <span class="stat-value">{{ stats()!.total }}</span>
            <span class="stat-label">Всего</span>
          </mat-card>
        </div>
      }

      @if (!loading()) {
        @if (requests().length === 0) {
          <div class="empty-state">
            <mat-icon>inbox</mat-icon>
            <span>Нет запросов на возврат</span>
          </div>
        } @else {
          <div class="requests-list">
            @for (req of requests(); track req.id) {
              <div class="request-card" [class]="'status-' + req.status">
                <div class="req-header">
                  <div class="req-order">
                    <mat-icon class="req-icon">receipt</mat-icon>
                    <span class="req-order-id">{{ req.order_id }}</span>
                    <span class="req-amount">{{ req.order_amount | number:'1.0-0' }} &#8381;</span>
                  </div>
                  <span class="status-chip" [class]="'chip-' + req.status">
                    @if (req.status === 'pending') { Ожидает }
                    @if (req.status === 'approved') { Одобрен }
                    @if (req.status === 'rejected') { Отклонён }
                  </span>
                </div>

                <div class="req-body">
                  <div class="req-customer">
                    <mat-icon>person</mat-icon>
                    <span>{{ req.customer_name || 'Без имени' }}</span>
                    @if (req.customer_phone) {
                      <span class="req-phone">{{ req.customer_phone }}</span>
                    }
                  </div>
                  <div class="req-reason">
                    <mat-icon>comment</mat-icon>
                    <span>{{ req.reason }}</span>
                  </div>
                  <div class="req-date">
                    <mat-icon>event</mat-icon>
                    <span>{{ req.created_at | date:'dd.MM.yyyy HH:mm' }}</span>
                  </div>
                </div>

                @if (req.status === 'pending') {
                  <div class="req-actions">
                    @if (rejectingId() === req.id) {
                      <div class="reject-form">
                        <textarea class="reject-textarea" placeholder="Причина отклонения..."
                                  [(ngModel)]="rejectComment" rows="2"></textarea>
                        <div class="reject-form-actions">
                          <button mat-flat-button class="reject-confirm-btn" (click)="confirmReject(req)">
                            Отклонить
                          </button>
                          <button mat-button class="reject-cancel-btn" (click)="rejectingId.set(null)">
                            Отмена
                          </button>
                        </div>
                      </div>
                    } @else {
                      <button mat-flat-button class="approve-btn" (click)="approve(req)"
                              [disabled]="resolving()">
                        <mat-icon>check</mat-icon> Одобрить
                      </button>
                      <button mat-stroked-button class="reject-btn" (click)="startReject(req)"
                              [disabled]="resolving()">
                        <mat-icon>close</mat-icon> Отклонить
                      </button>
                    }
                  </div>
                } @else {
                  @if (req.admin_comment) {
                    <div class="req-resolution">
                      <mat-icon>admin_panel_settings</mat-icon>
                      <span>{{ req.admin_comment }}</span>
                    </div>
                  }
                  @if (req.resolved_by_name) {
                    <div class="req-resolved-by">
                      {{ req.resolved_by_name }} &middot; {{ req.resolved_at | date:'dd.MM HH:mm' }}
                    </div>
                  }
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    :host { display: block; }

    .rf-dash {
      padding: 0 0 32px;
      max-width: 800px;
      margin: 0 auto;
    }

    .rf-header {
      display: flex;
      align-items: center;
      margin-bottom: 24px;
    }
    .rf-header h2 {
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .rf-header h2 mat-icon {
      color: #a855f7;
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
      margin-bottom: 24px;
    }
    .stat-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 14px 8px;
      gap: 4px;
      background: var(--ed-surface-variant, #1e1e1e) !important;
      border-color: var(--ed-outline, #333) !important;
      cursor: pointer;
      transition: border-color 0.15s ease;
    }
    .stat-card:hover { border-color: rgba(255,255,255,0.2) !important; }
    .stat-card.active { border-color: #a855f7 !important; }
    .stat-card mat-icon {
      font-size: 22px; width: 22px; height: 22px;
      color: var(--ed-on-surface-variant, #999);
    }
    .stat-card.pending mat-icon { color: #f59e0b; }
    .stat-card.approved mat-icon { color: #22c55e; }
    .stat-card.rejected mat-icon { color: #ef4444; }
    .stat-card.total mat-icon { color: #a855f7; }
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

    /* List */
    .requests-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .request-card {
      padding: 16px;
      border-radius: 12px;
      background: var(--ed-surface-variant, #1e1e1e);
      border: 1px solid var(--ed-outline, #333);
    }
    .request-card.status-pending { border-left: 3px solid #f59e0b; }
    .request-card.status-approved { border-left: 3px solid #22c55e; }
    .request-card.status-rejected { border-left: 3px solid #ef4444; }

    .req-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .req-order {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .req-icon {
      font-size: 18px; width: 18px; height: 18px;
      color: var(--ed-on-surface-variant, #999);
    }
    .req-order-id {
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.9rem;
    }
    .req-amount {
      font-weight: 700;
      color: #f59e0b;
      font-size: 0.95rem;
    }

    .status-chip {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .chip-pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .chip-approved { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .chip-rejected { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

    .req-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }
    .req-body > div {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--ed-on-surface-variant, #aaa);
    }
    .req-body mat-icon {
      font-size: 16px; width: 16px; height: 16px;
      color: var(--ed-on-surface-variant, #777);
      flex-shrink: 0;
    }
    .req-reason span {
      color: var(--ed-on-surface, #ddd);
    }
    .req-phone {
      color: var(--ed-on-surface-variant, #999);
      font-size: 0.8rem;
    }

    /* Actions */
    .req-actions {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    .approve-btn {
      background: #22c55e !important;
      color: #fff !important;
      font-size: 0.85rem;
    }
    .approve-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .reject-btn {
      color: #ef4444 !important;
      border-color: rgba(239, 68, 68, 0.3) !important;
      font-size: 0.85rem;
    }
    .reject-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .reject-form {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .reject-textarea {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--ed-outline, #444);
      background: var(--ed-surface, #161616);
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.85rem;
      resize: vertical;
      font-family: inherit;
    }
    .reject-textarea:focus {
      outline: none;
      border-color: #ef4444;
    }
    .reject-form-actions {
      display: flex;
      gap: 8px;
    }
    .reject-confirm-btn {
      background: #ef4444 !important;
      color: #fff !important;
      font-size: 0.82rem;
    }
    .reject-cancel-btn {
      color: var(--ed-on-surface-variant, #999) !important;
      font-size: 0.82rem;
    }

    /* Resolution */
    .req-resolution {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #aaa);
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255,255,255,0.03);
    }
    .req-resolution mat-icon {
      font-size: 16px; width: 16px; height: 16px;
      color: var(--ed-on-surface-variant, #777);
      flex-shrink: 0;
      margin-top: 1px;
    }
    .req-resolved-by {
      font-size: 0.75rem;
      color: var(--ed-on-surface-variant, #777);
      margin-top: 4px;
      text-align: right;
    }

    @media (max-width: 600px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
    }
  `,
})
export class RefundManagerComponent implements OnInit {
  private readonly api = inject(RefundManagerApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);

  readonly loading = signal(true);
  readonly resolving = signal(false);
  readonly filter = signal<string>('pending');
  readonly stats = signal<RefundStats | null>(null);
  readonly requests = signal<RefundRequest[]>([]);
  readonly rejectingId = signal<string | null>(null);
  rejectComment = '';

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadData();
    }
  }

  setFilter(status: string): void {
    this.filter.set(status);
    this.loadRequests();
  }

  approve(req: RefundRequest): void {
    this.resolving.set(true);
    this.api.resolve(req.id, 'approve').subscribe({
      next: () => {
        this.snackBar.open(`Возврат по заказу ${req.order_id} одобрен`, 'OK', { duration: 4000 });
        this.resolving.set(false);
        this.loadData();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Ошибка', 'Закрыть', { duration: 5000 });
        this.resolving.set(false);
      },
    });
  }

  startReject(req: RefundRequest): void {
    this.rejectingId.set(req.id);
    this.rejectComment = '';
  }

  confirmReject(req: RefundRequest): void {
    this.resolving.set(true);
    this.api.resolve(req.id, 'reject', this.rejectComment || undefined).subscribe({
      next: () => {
        this.snackBar.open(`Возврат по заказу ${req.order_id} отклонён`, 'OK', { duration: 4000 });
        this.resolving.set(false);
        this.rejectingId.set(null);
        this.loadData();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Ошибка', 'Закрыть', { duration: 5000 });
        this.resolving.set(false);
      },
    });
  }

  private loadData(): void {
    this.loading.set(true);
    forkJoin({
      stats: this.api.getStats(),
      requests: this.api.getRefunds(this.filter()),
    }).subscribe({
      next: ({ stats, requests }) => {
        this.stats.set(stats.data);
        this.requests.set(requests.data || []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadRequests(): void {
    this.api.getRefunds(this.filter()).subscribe({
      next: (res) => this.requests.set(res.data || []),
    });
  }
}
