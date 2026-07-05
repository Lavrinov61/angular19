import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

type Status = 'online' | 'offline' | 'stale' | 'unknown';

@Component({
  selector: 'app-fleet-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [attr.data-status]="status()">
      <span class="badge-dot"></span>
      <span class="badge-text">{{ label() }}</span>
    </span>
  `,
  styles: [`
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      line-height: 1;
      white-space: nowrap;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .badge[data-status='online']  { background: rgba(34, 197, 94, 0.14);  color: #15803d; }
    .badge[data-status='online']  .badge-dot { background: #22c55e; box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.22); }
    .badge[data-status='offline'] { background: rgba(239, 68, 68, 0.14);  color: #b91c1c; }
    .badge[data-status='offline'] .badge-dot { background: #ef4444; }
    .badge[data-status='stale']   { background: rgba(234, 179, 8, 0.16);  color: #a16207; }
    .badge[data-status='stale']   .badge-dot { background: #eab308; }
    .badge[data-status='unknown'] { background: rgba(107, 114, 128, 0.14); color: #4b5563; }
    .badge[data-status='unknown'] .badge-dot { background: #9ca3af; }
  `]
})
export class FleetStatusBadgeComponent {
  readonly isOnline = input<boolean | null | undefined>(null);
  readonly collectedAt = input<string | null | undefined>(null);
  readonly staleMinutes = input<number>(15);

  readonly status = computed<Status>(() => {
    const online = this.isOnline();
    const at = this.collectedAt();
    if (online === null || online === undefined || !at) return 'unknown';
    const ageMs = Date.now() - new Date(at).getTime();
    const staleThresholdMs = this.staleMinutes() * 60_000;
    if (ageMs > staleThresholdMs) return 'stale';
    return online ? 'online' : 'offline';
  });

  readonly label = computed(() => {
    switch (this.status()) {
      case 'online':  return 'В сети';
      case 'offline': return 'Не в сети';
      case 'stale':   return 'Устарело';
      default:        return 'Нет данных';
    }
  });
}
