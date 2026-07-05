import { Component, inject, input, signal, effect, computed, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CrmClientsApiService, TimelineEvent } from '../../services/crm-clients-api.service';
import { formatRelativeTime } from '../../utils/crm-helpers';

const ICON_MAP: Record<string, string> = {
  order: 'receipt_long',
  loyalty: 'stars',
  pos_receipt: 'point_of_sale',
  message: 'chat',
  booking: 'event',
  call: 'phone',
  note: 'sticky_note_2',
  subscription: 'card_membership',
};

const COLOR_CLASS_MAP: Record<string, string> = {
  order: 'tl-order',
  loyalty: 'tl-loyalty',
  pos_receipt: 'tl-pos',
  message: 'tl-message',
  booking: 'tl-booking',
  call: 'tl-call',
  note: 'tl-note',
  subscription: 'tl-subscription',
};

@Component({
  selector: 'app-client-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatProgressSpinnerModule],
  template: `
    @if (loading()) {
      <div class="tl-loading"><mat-spinner diameter="24" /></div>
    } @else if (events().length) {
      <div class="timeline">
        @for (evt of events(); track evt.id) {
          <div class="tl-item">
            <div class="tl-icon-wrap" [class]="colorClass(evt.type)">
              <mat-icon>{{ icon(evt.type) }}</mat-icon>
            </div>
            <div class="tl-body">
              <div class="tl-row-top">
                <span class="tl-title">{{ evt.title }}</span>
                @if (evt.amount) {
                  <span class="tl-amount">{{ evt.amount }}₽</span>
                }
              </div>
              @if (evt.detail) {
                <div class="tl-detail">{{ evt.detail }}</div>
              }
              <div class="tl-time">{{ formatRelativeTime(evt.ts) }}</div>
            </div>
          </div>
        }
      </div>
    } @else {
      <div class="tl-empty">Нет событий</div>
    }
  `,
  styles: [`
    :host { display: block; }

    .tl-loading, .tl-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px 0;
      color: var(--crm-text-muted);
      font-size: 12px;
    }

    .timeline { padding: 4px 0 4px 4px; }

    .tl-item {
      display: flex;
      gap: 10px;
      padding: 6px 0;
      position: relative;

      &:not(:last-child)::before {
        content: '';
        position: absolute;
        left: 13px;
        top: 30px;
        bottom: -6px;
        width: 1px;
        background: var(--crm-border);
      }
    }

    .tl-icon-wrap {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }

    .tl-order {
      background: color-mix(in srgb, #f5a623 15%, transparent);
      mat-icon { color: #f5a623; }
    }

    .tl-loyalty {
      background: color-mix(in srgb, #ffd700 15%, transparent);
      mat-icon { color: #d4a800; }
    }

    .tl-pos {
      background: color-mix(in srgb, var(--crm-status-success) 15%, transparent);
      mat-icon { color: var(--crm-status-success); }
    }

    .tl-message {
      background: color-mix(in srgb, var(--crm-status-info) 15%, transparent);
      mat-icon { color: var(--crm-status-info); }
    }

    .tl-booking {
      background: color-mix(in srgb, var(--crm-accent) 15%, transparent);
      mat-icon { color: var(--crm-accent); }
    }

    .tl-call {
      background: color-mix(in srgb, var(--crm-status-warning) 15%, transparent);
      mat-icon { color: var(--crm-status-warning); }
    }

    .tl-note {
      background: var(--crm-surface-hover);
      mat-icon { color: var(--crm-text-muted); }
    }

    .tl-subscription {
      background: color-mix(in srgb, #9c6ade 15%, transparent);
      mat-icon { color: #9c6ade; }
    }

    .tl-body {
      flex: 1;
      min-width: 0;
    }

    .tl-row-top {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .tl-title {
      font-size: 12px;
      font-weight: 500;
      color: var(--crm-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .tl-amount {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-primary);
      white-space: nowrap;
    }

    .tl-detail {
      font-size: 11px;
      color: var(--crm-text-muted);
      margin-top: 1px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tl-time {
      font-size: 10px;
      color: var(--crm-text-muted);
      margin-top: 1px;
    }
  `],
})
export class ClientTimelineComponent {
  private readonly clientsApi = inject(CrmClientsApiService);

  readonly phone = input<string | null>(null);
  readonly userId = input<string | null>(null);

  readonly events = signal<TimelineEvent[]>([]);
  readonly loading = signal(false);
  private loaded = false;

  readonly count = computed(() => this.events().length);
  readonly formatRelativeTime = formatRelativeTime;

  private readonly loadEffect = effect(() => {
    const phone = this.phone();
    const userId = this.userId();

    // Reset on input change
    this.events.set([]);
    this.loaded = false;

    if (userId) {
      this.fetchByUserId(userId);
    } else if (phone) {
      this.fetchByPhone(phone);
    }
  });

  icon(type: string): string {
    return ICON_MAP[type] ?? 'circle';
  }

  colorClass(type: string): string {
    return COLOR_CLASS_MAP[type] ?? 'tl-note';
  }

  private fetchByPhone(phone: string): void {
    if (this.loaded) return;
    this.loading.set(true);
    this.clientsApi.getTimeline(phone).subscribe({
      next: (data) => {
        this.events.set(data);
        this.loaded = true;
        this.loading.set(false);
      },
      error: () => {
        this.events.set([]);
        this.loading.set(false);
      },
    });
  }

  private fetchByUserId(userId: string): void {
    if (this.loaded) return;
    this.loading.set(true);
    this.clientsApi.getTimelineByUserId(userId).subscribe({
      next: (data) => {
        this.events.set(data);
        this.loaded = true;
        this.loading.set(false);
      },
      error: () => {
        this.events.set([]);
        this.loading.set(false);
      },
    });
  }
}
