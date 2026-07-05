import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { DashboardDataService } from '../../services/dashboard-data.service';

@Component({
  selector: 'app-dashboard-satisfaction',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sat-card">
      <div class="sat-header">
        <span class="sat-accent-bar"></span>
        <h4 class="sat-title">ДОВОЛЬСТВО КЛИЕНТОВ</h4>
      </div>

      <div class="sat-list">
        @for (entry of dashData.satisfactionFeed(); track entry.id) {
          <div class="sat-item">
            <div class="sat-stars">
              @for (s of starsArray(entry.rating); track $index) {
                <span class="star filled">&#9733;</span>
              }
              @for (s of starsArray(5 - entry.rating); track $index) {
                <span class="star empty">&#9733;</span>
              }
            </div>
            <div class="sat-info">
              <span class="sat-name">{{ entry.clientName }}</span>
              <span class="sat-service">{{ entry.service }}</span>
            </div>
            <span class="sat-time">{{ entry.time }}</span>
          </div>
        }
      </div>

      @if (!dashData.satisfactionFeed().length) {
        <div class="sat-empty">Пока нет оценок за сегодня</div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .sat-card {
      background: var(--crm-surface-raised);
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-border);
      overflow: hidden;
    }

    .sat-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px 8px;
    }

    .sat-accent-bar {
      width: 3px;
      height: 14px;
      border-radius: 2px;
      background: var(--crm-accent);
      flex-shrink: 0;
    }

    .sat-title {
      margin: 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 12px;
      font-weight: 400;
      letter-spacing: 0.1em;
      color: var(--crm-text-secondary);
    }

    .sat-list {
      padding: 4px 10px 10px;
      max-height: 320px;
      overflow-y: auto;
    }

    .sat-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 4px;
      border-radius: var(--crm-radius-sm);
      transition: background var(--crm-transition-fast);

      &:hover { background: var(--crm-surface-hover); }
    }

    .sat-stars {
      display: flex;
      gap: 1px;
      flex-shrink: 0;
    }

    .star {
      font-size: 13px;
      line-height: 1;

      &.filled { color: var(--crm-accent); }
      &.empty { color: var(--crm-border); opacity: 0.5; }
    }

    .sat-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    .sat-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--crm-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sat-service {
      font-size: 11px;
      color: var(--crm-text-muted);
    }

    .sat-time {
      font-size: 11px;
      color: var(--crm-text-muted);
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    .sat-empty {
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: var(--crm-text-muted);
    }
  `],
})
export class DashboardSatisfactionComponent {
  readonly dashData = inject(DashboardDataService);

  starsArray(count: number): number[] {
    return Array.from({ length: Math.max(0, count) }, (_, i) => i);
  }
}
