import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-retouch-status-badge',
  standalone: true,
  imports: [MatChipsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (config(); as c) {
      <mat-chip [class]="'retouch-badge retouch-badge--' + status()">
        <mat-icon matChipAvatar>{{ c.icon }}</mat-icon>
        {{ c.label }}
        @if (retoucherName() && status() === 'in_progress') {
          — {{ retoucherName() }}
        }
      </mat-chip>
    }
  `,
  styles: [`
    .retouch-badge { font-size: 12px; height: 24px; }
    .retouch-badge--open { background: rgba(251,191,36,.15); color: #fbbf24; }
    .retouch-badge--assigned { background: rgba(96,165,250,.15); color: #60a5fa; }
    .retouch-badge--in_progress { background: rgba(139,92,246,.15); color: #a78bfa; }
    .retouch-badge--waiting { background: rgba(251,146,60,.15); color: #fb923c; }
    .retouch-badge--completed { background: rgba(52,211,153,.15); color: #34d399; }
    .retouch-badge--revision { background: rgba(248,113,113,.15); color: #f87171; }
  `],
})
export class RetouchStatusBadgeComponent {
  readonly status = input<string>('');
  readonly retoucherName = input<string | null>(null);
  readonly revisionCount = input(0);

  readonly config = computed(() => {
    const s = this.status();
    const rev = this.revisionCount();
    if (rev > 0 && s === 'in_progress') return { icon: 'replay', label: `Доработка #${rev}` };
    switch (s) {
      case 'open': return { icon: 'hourglass_empty', label: 'Ожидает ретушёра' };
      case 'assigned': return { icon: 'person_add', label: 'Назначен' };
      case 'in_progress': return { icon: 'brush', label: 'В работе' };
      case 'waiting': return { icon: 'send', label: 'На согласовании' };
      case 'completed': return { icon: 'check_circle', label: 'Завершено' };
      default: return null;
    }
  });
}
