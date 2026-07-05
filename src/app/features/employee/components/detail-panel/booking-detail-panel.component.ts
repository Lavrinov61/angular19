import {
  Component, inject, input, output, effect, signal, computed,
  ChangeDetectionStrategy, OnInit, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { RescheduleBookingDialogComponent } from '../booking-manager/reschedule-booking-dialog.component';
import { formatRelativeTime } from '../../utils/crm-helpers';
import { EntityNotesComponent } from '../shared/entity-notes.component';

interface BookingEvent {
  id: string;
  old_status: string | null;
  new_status: string;
  changed_at: string;
  changed_by_name: string | null;
}

interface BookingDetail {
  id: string;
  client_name: string;
  client_phone: string;
  client_email?: string;
  service_name: string;
  start_time: string;
  end_time: string;
  status: string;
  source: string;
  studio_id: string;
  studio_name: string;
  notes?: string;
  created_at: string;
}

@Component({
  selector: 'app-booking-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, EntityNotesComponent],
  template: `
    @if (loading()) {
      <!-- Skeleton -->
      <div class="skeleton-wrap">
        <div class="sk-status-bar"></div>
        <div class="sk-hero">
          <div class="sk-bar sk-title"></div>
          <div class="sk-bar sk-chip"></div>
        </div>
        <div class="sk-body">
          @for (i of [1,2,3,4]; track i) {
            <div class="sk-row">
              <div class="sk-bar sk-icon"></div>
              <div class="sk-bar sk-line" [style.width]="i === 3 ? '60%' : '100%'"></div>
            </div>
          }
        </div>
      </div>
    } @else if (booking()) {
      <div class="detail-wrap">

        <!-- Status color bar -->
        <div class="status-bar" [class]="'sb-' + booking()!.status"></div>

        <!-- Hero Section -->
        <div class="hero-section">
          <div class="hero-left">
            <div class="hero-icon-wrap" [class]="'icon-' + booking()!.status">
              <mat-icon>event</mat-icon>
            </div>
            <div class="hero-info">
              <h2 class="hero-title">{{ booking()!.service_name || 'Запись' }}</h2>
              <div class="hero-meta">
                <span class="status-chip" [class]="'sc-' + booking()!.status">
                  {{ bookingStatusLabel(booking()!.status) }}
                </span>
                <span class="hero-time">{{ formatDateTime(booking()!.start_time) }}</span>
              </div>
            </div>
          </div>

          <!-- Countdown for upcoming -->
          @if (countdown() && booking()!.status !== 'cancelled' && booking()!.status !== 'completed') {
            <div class="countdown-badge">
              <mat-icon>schedule</mat-icon>
              <span>{{ countdown() }}</span>
            </div>
          }
        </div>

        <!-- Info Grid -->
        <div class="info-grid">
          <div class="info-item">
            <div class="info-icon-wrap">
              <mat-icon>schedule</mat-icon>
            </div>
            <div class="info-content">
              <span class="info-label">Дата и время</span>
              <span class="info-value">
                {{ formatDateTime(booking()!.start_time) }}
                @if (booking()!.end_time) {
                  <span class="time-sep">—</span>
                  {{ formatTime(booking()!.end_time) }}
                }
              </span>
            </div>
          </div>

          <div class="info-item">
            <div class="info-icon-wrap">
              <mat-icon>location_on</mat-icon>
            </div>
            <div class="info-content">
              <span class="info-label">Студия</span>
              <span class="info-value">{{ booking()!.studio_name || '—' }}</span>
            </div>
          </div>

          <div class="info-item">
            <div class="info-icon-wrap">
              <mat-icon>person</mat-icon>
            </div>
            <div class="info-content">
              <span class="info-label">Клиент</span>
              <span class="info-value">{{ booking()!.client_name || 'Клиент' }}</span>
            </div>
          </div>

          @if (booking()!.client_phone) {
            <div class="info-item">
              <div class="info-icon-wrap">
                <mat-icon>phone</mat-icon>
              </div>
              <div class="info-content">
                <span class="info-label">Телефон</span>
                <a class="info-phone" [href]="'tel:' + booking()!.client_phone">
                  {{ booking()!.client_phone }}
                </a>
              </div>
            </div>
          }

          @if (booking()!.source) {
            <div class="info-item">
              <div class="info-icon-wrap">
                <mat-icon>source</mat-icon>
              </div>
              <div class="info-content">
                <span class="info-label">Источник</span>
                <span class="info-value">{{ sourceLabel(booking()!.source) }}</span>
              </div>
            </div>
          }

          @if (booking()!.notes) {
            <div class="info-item info-item--notes">
              <div class="info-icon-wrap">
                <mat-icon>notes</mat-icon>
              </div>
              <div class="info-content">
                <span class="info-label">Заметки</span>
                <span class="info-value notes-text">{{ booking()!.notes }}</span>
              </div>
            </div>
          }
        </div>

        <!-- Action Bar -->
        @if (booking()!.status !== 'cancelled' && booking()!.status !== 'completed' && booking()!.status !== 'no-show') {
          <div class="action-bar">
            @if (booking()!.status === 'pending') {
              <button class="action-btn action-btn--primary" (click)="updateStatus('confirmed')">
                <mat-icon>check</mat-icon>
                <span>Подтвердить</span>
              </button>
            }
            @if (booking()!.status === 'confirmed') {
              <button class="action-btn action-btn--primary" (click)="updateStatus('completed')">
                <mat-icon>done_all</mat-icon>
                <span>Завершить</span>
              </button>
            }
            <button class="action-btn action-btn--secondary" (click)="openReschedule()">
              <mat-icon>event_repeat</mat-icon>
              <span>Перенести</span>
            </button>
            <button class="action-btn action-btn--ghost" (click)="confirmNoShow()">
              <mat-icon>person_off</mat-icon>
              <span>Не пришёл</span>
            </button>
            <button class="action-btn action-btn--danger" (click)="confirmCancel()">
              <mat-icon>cancel</mat-icon>
              <span>Отменить</span>
            </button>
          </div>
        }

        <!-- Notes -->
        <div class="notes-section">
          <app-entity-notes entityType="booking" [entityId]="bookingId()" />
        </div>

        <!-- Timeline -->
        @if (events().length > 0) {
          <div class="timeline-section">
            <div class="timeline-title"><mat-icon>history</mat-icon><span>История</span></div>
            <div class="timeline-list">
              @for (evt of events(); track evt.id) {
                <div class="timeline-event">
                  <div class="tl-dot" [class]="'tl-' + evt.new_status"></div>
                  <div class="tl-content">
                    <span class="tl-label">{{ eventLabel(evt) }}</span>
                    <span class="tl-time">{{ formatRelativeTime(evt.changed_at) }}</span>
                    @if (evt.changed_by_name) {
                      <span class="tl-actor">{{ evt.changed_by_name }}</span>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Footer -->
        <div class="detail-footer">
          <span class="footer-text">Создано {{ formatRelativeTime(booking()!.created_at) }}</span>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes crmShimmer {
      from { background-position: -400px 0; }
      to { background-position: 400px 0; }
    }
    @keyframes panelReveal {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
    }

    /* ─── Skeleton ─── */
    .skeleton-wrap {
      padding: 0;
    }

    .sk-status-bar {
      height: 3px;
      background: linear-gradient(
        90deg,
        var(--crm-surface-raised) 25%,
        rgba(255,255,255,0.06) 50%,
        var(--crm-surface-raised) 75%
      );
      background-size: 400px 100%;
      animation: crmShimmer 1.5s infinite linear;
    }

    .sk-hero {
      padding: 16px 20px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      border-bottom: 1px solid var(--crm-border-subtle);
    }

    .sk-body {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .sk-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .sk-bar {
      background: linear-gradient(
        90deg,
        var(--crm-surface-raised) 25%,
        rgba(255,255,255,0.05) 50%,
        var(--crm-surface-raised) 75%
      );
      background-size: 400px 100%;
      animation: crmShimmer 1.5s infinite linear;
      border-radius: var(--crm-radius-sm);
    }

    .sk-title { width: 55%; height: 22px; }
    .sk-chip { width: 80px; height: 24px; border-radius: 12px; }
    .sk-icon { width: 32px; height: 32px; border-radius: var(--crm-radius-md); flex-shrink: 0; }
    .sk-line { height: 14px; flex: 1; }

    /* ─── Detail wrap ─── */
    .detail-wrap {
      display: flex;
      flex-direction: column;
      animation: panelReveal 250ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    /* ─── Status bar ─── */
    .status-bar {
      height: 3px;
      flex-shrink: 0;

      &.sb-pending { background: linear-gradient(90deg, var(--crm-status-warning), rgba(251,191,36,0.3)); }
      &.sb-confirmed { background: linear-gradient(90deg, var(--crm-status-success), rgba(34,197,94,0.3)); }
      &.sb-completed { background: linear-gradient(90deg, var(--crm-status-info), rgba(99,179,237,0.3)); }
      &.sb-cancelled { background: var(--crm-surface-raised); }
      &.sb-no-show { background: linear-gradient(90deg, var(--crm-status-error), rgba(239,68,68,0.3)); }
    }

    /* ─── Hero ─── */
    .hero-section {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%);
    }

    .hero-left {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      flex: 1;
      min-width: 0;
    }

    .hero-icon-wrap {
      width: 44px;
      height: 44px;
      border-radius: var(--crm-radius-lg);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 1px solid;

      mat-icon { font-size: 22px; width: 22px; height: 22px; }

      &.icon-pending {
        background: var(--crm-status-warning-muted);
        border-color: rgba(251, 191, 36, 0.2);
        mat-icon { color: var(--crm-status-warning); }
      }
      &.icon-confirmed {
        background: var(--crm-status-success-muted);
        border-color: rgba(34, 197, 94, 0.2);
        mat-icon { color: var(--crm-status-success); }
      }
      &.icon-completed {
        background: var(--crm-status-info-muted);
        border-color: rgba(99, 179, 237, 0.2);
        mat-icon { color: var(--crm-status-info); }
      }
      &.icon-cancelled, &.icon-no-show {
        background: var(--crm-surface-raised);
        border-color: var(--crm-glass-border);
        mat-icon { color: var(--crm-text-muted); }
      }
    }

    .hero-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .hero-title {
      margin: 0;
      font-family: var(--crm-font-sans);
      font-size: 18px;
      font-weight: 700;
      color: var(--crm-text-primary);
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hero-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .status-chip {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      flex-shrink: 0;

      &.sc-pending { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
      &.sc-confirmed { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
      &.sc-completed { background: var(--crm-status-info-muted); color: var(--crm-status-info); }
      &.sc-cancelled { background: var(--crm-surface-raised); color: var(--crm-text-secondary); }
      &.sc-no-show { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    }

    .hero-time {
      font-family: var(--crm-font-mono);
      font-size: 12px;
      color: var(--crm-text-muted);
    }

    .time-sep {
      margin: 0 2px;
      color: var(--crm-text-muted);
    }

    .countdown-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border-radius: 14px;
      background: var(--crm-accent-muted);
      border: 1px solid rgba(245, 158, 11, 0.2);
      color: var(--crm-accent);
      font-family: var(--crm-font-mono);
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    /* ─── Info Grid ─── */
    .info-grid {
      padding: 14px 20px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    .info-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 9px 10px;
      border-radius: var(--crm-radius-md);
      transition: background var(--crm-transition-fast);

      &:hover { background: rgba(255, 255, 255, 0.02); }

      &--notes { align-items: flex-start; }
    }

    .info-icon-wrap {
      width: 32px;
      height: 32px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-glass-border);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--crm-text-muted); }
    }

    .info-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
      padding-top: 2px;
    }

    .info-label {
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--crm-text-muted);
      line-height: 1.2;
    }

    .info-value {
      font-size: 14px;
      font-weight: 500;
      color: var(--crm-text-primary);
      line-height: 1.4;

      &.notes-text {
        font-size: 13px;
        color: var(--crm-text-secondary);
        white-space: pre-wrap;
        font-weight: 400;
      }
    }

    .info-phone {
      font-size: 14px;
      font-weight: 500;
      color: var(--crm-accent);
      text-decoration: none;
      transition: opacity var(--crm-transition-fast);

      &:hover { opacity: 0.8; }
    }

    /* ─── Action Bar ─── */
    .action-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      background: linear-gradient(180deg, rgba(255,255,255,0.01) 0%, transparent 100%);
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 14px;
      font-size: 13px;
      font-weight: 600;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      border: 1px solid;
      transition: background var(--crm-transition-fast), border-color var(--crm-transition-fast), color var(--crm-transition-fast);

      mat-icon { font-size: 15px; width: 15px; height: 15px; }

      &--primary {
        background: var(--crm-status-success-muted);
        border-color: rgba(34, 197, 94, 0.3);
        color: var(--crm-status-success);

        &:hover {
          background: rgba(34, 197, 94, 0.18);
          border-color: rgba(34, 197, 94, 0.5);
        }
      }

      &--secondary {
        background: rgba(255, 255, 255, 0.04);
        border-color: var(--crm-glass-border);
        color: var(--crm-text-secondary);

        &:hover {
          background: rgba(255, 255, 255, 0.07);
          color: var(--crm-text-primary);
        }
      }

      &--ghost {
        background: transparent;
        border-color: var(--crm-glass-border);
        color: var(--crm-text-muted);

        &:hover {
          background: var(--crm-surface-raised);
          color: var(--crm-text-secondary);
        }
      }

      &--danger {
        background: var(--crm-status-error-muted);
        border-color: rgba(239, 68, 68, 0.25);
        color: var(--crm-status-error);

        &:hover {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.45);
        }
      }
    }

    /* ─── Notes Section ─── */
    .notes-section {
      padding: 14px 20px 0;
    }

    /* ─── Timeline ─── */
    .timeline-section {
      padding: 14px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    .timeline-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--crm-text-muted);

      mat-icon { font-size: 15px; width: 15px; height: 15px; }
    }

    .timeline-list {
      position: relative;
      padding-left: 16px;
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .timeline-event {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      position: relative;
    }

    .tl-dot {
      position: absolute;
      left: -20px;
      top: 4px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crm-text-muted);
      flex-shrink: 0;

      &.tl-confirmed { background: var(--crm-status-success); }
      &.tl-pending { background: var(--crm-status-warning); }
      &.tl-completed { background: var(--crm-status-info); }
      &.tl-cancelled { background: var(--crm-status-error); }
      &.tl-no-show { background: var(--crm-status-error); }
    }

    .tl-content {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px;
    }

    .tl-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .tl-time {
      font-size: 11px;
      font-family: var(--crm-font-mono);
      color: var(--crm-text-muted);
    }

    .tl-actor {
      font-size: 11px;
      color: var(--crm-text-secondary);
    }

    /* ─── Footer ─── */
    .detail-footer {
      padding: 10px 20px 16px;
    }

    .footer-text {
      font-size: 11px;
      color: var(--crm-text-muted);
    }
  `],
})
export class BookingDetailPanelComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly platformId = inject(PLATFORM_ID);

  bookingId = input.required<string>();
  clientPhoneResolved = output<string>();

  booking = signal<BookingDetail | null>(null);
  events = signal<BookingEvent[]>([]);
  loading = signal(false);

  private readonly now = signal(new Date());
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  readonly formatRelativeTime = formatRelativeTime;

  readonly countdown = computed(() => {
    const b = this.booking();
    if (!b || b.status === 'cancelled' || b.status === 'completed') return '';
    const diff = new Date(b.start_time).getTime() - this.now().getTime();
    if (diff <= 0) return 'Сейчас';
    if (diff > 24 * 60 * 60 * 1000) return ''; // more than 24h - don't show
    const totalMin = Math.floor(diff / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `через ${h}ч ${m}м` : `через ${m} мин`;
  });

  private readonly loadEffect = effect(() => {
    const id = this.bookingId();
    if (id) this.loadBooking(id);
  });

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.tickInterval = setInterval(() => this.now.set(new Date()), 30_000);
    }
  }

  ngOnDestroy(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  private loadBooking(id: string): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; booking: BookingDetail; events?: BookingEvent[] }>(`/api/crm-booking/${id}`).subscribe({
      next: (res) => {
        if (res.success && res.booking) {
          this.booking.set(res.booking);
          this.events.set(res.events ?? []);
          if (res.booking.client_phone) {
            this.clientPhoneResolved.emit(res.booking.client_phone);
          }
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить запись');
      },
    });
  }

  updateStatus(status: string): void {
    this.http.put<{ success: boolean }>(`/api/crm-booking/${this.bookingId()}/status`, { status }).subscribe({
      next: (res) => {
        if (res.success) {
          this.loadBooking(this.bookingId());
          this.toast.success('Статус обновлён');
        }
      },
      error: () => this.toast.error('Не удалось обновить статус'),
    });
  }

  confirmCancel(): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Отменить запись?',
        message: `Запись ${this.booking()?.client_name || 'клиента'} будет отменена.`,
        confirmLabel: 'Отменить запись',
        icon: 'cancel',
        warn: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) this.updateStatus('cancelled');
    });
  }

  confirmNoShow(): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Клиент не пришёл?',
        message: `Пометить запись ${this.booking()?.client_name || 'клиента'} как "не пришёл"?`,
        confirmLabel: 'Подтвердить',
        icon: 'person_off',
        warn: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) this.updateStatus('no-show');
    });
  }

  openReschedule(): void {
    const b = this.booking();
    if (!b) return;

    this.http.get<{ studios: { id: string; name: string }[] }>('/api/crm-booking/studios').subscribe({
      next: (res) => {
        const dialogRef = this.dialog.open(RescheduleBookingDialogComponent, {
          data: {
            booking: {
              id: b.id,
              studio_id: b.studio_id,
              studio_name: b.studio_name,
              client_name: b.client_name,
              client_phone: b.client_phone,
              start_time: b.start_time,
              end_time: b.end_time,
              status: b.status,
            },
            studios: res.studios || [],
          },
          width: '480px',
        });

        dialogRef.afterClosed().subscribe(result => {
          if (result) {
            this.loadBooking(this.bookingId());
            this.toast.success('Запись перенесена');
          }
        });
      },
      error: () => this.toast.error('Не удалось загрузить студии'),
    });
  }

  eventLabel(evt: BookingEvent): string {
    const labels: Record<string, string> = {
      pending: 'Ожидание',
      confirmed: 'Подтверждена',
      completed: 'Завершена',
      cancelled: 'Отменена',
      'no-show': 'Не пришёл',
    };
    if (!evt.old_status) return `Создана — ${labels[evt.new_status] ?? evt.new_status}`;
    return `${labels[evt.old_status] ?? evt.old_status} → ${labels[evt.new_status] ?? evt.new_status}`;
  }

  bookingStatusLabel(status: string): string {
    return ({
      pending: 'Ожидание',
      confirmed: 'Подтверждена',
      completed: 'Завершена',
      cancelled: 'Отменена',
      'no-show': 'Не пришёл',
    } as Record<string, string>)[status] ?? status;
  }

  sourceLabel(source: string): string {
    return ({
      website: 'Сайт',
      bitrix24: 'Bitrix24',
      phone: 'Телефон',
      walk_in: 'Пришёл сам',
      crm: 'CRM',
    } as Record<string, string>)[source] ?? source;
  }

  formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
}
