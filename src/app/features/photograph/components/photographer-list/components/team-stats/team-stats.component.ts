import { Component, ChangeDetectionStrategy, signal } from '@angular/core';

interface StatItem {
  value: string;
  label: string;
}

@Component({
  selector: 'app-team-stats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stats-bar">
      <div class="stats-inner">
        @for (stat of displayStats(); track stat.label; let last = $last) {
          <div class="stat-item">
            <span class="stat-value">{{ stat.value }}</span>
            <span class="stat-label">{{ stat.label }}</span>
          </div>
          @if (!last) {
            <div class="stat-divider" aria-hidden="true"></div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .stats-bar {
      background: #f4f4f4;
      margin-top: -54px;
      position: relative;
      z-index: 2;
    }

    .stats-inner {
      max-width: 1320px;
      margin: 0 auto;
      padding: 26px 32px;
      display: flex;
      align-items: center;
      background: #ffffff;
      border-radius: 36px 36px 0 0;
      box-shadow: 0 -18px 70px rgba(0, 0, 0, 0.18);
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 22px 26px;
      min-height: 116px;
      flex: 1 1 0;
    }

    .stat-value {
      font-family: var(--ed-font-body);
      font-size: 36px;
      font-weight: 900;
      color: #111111;
      line-height: 1;
      letter-spacing: 0;
    }

    .stat-label {
      font-family: var(--ed-font-body);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0;
      color: #6d6d6d;
      text-align: left;
      line-height: 1.35;
    }

    .stat-divider {
      width: 1px;
      height: 62px;
      background: #e2e2e2;
      opacity: 1;
      flex-shrink: 0;
    }

    @media (max-width: 860px) {
      .stats-inner {
        display: grid;
        grid-template-columns: 1fr 1fr;
        padding: 18px;
      }

      .stat-divider {
        display: none;
      }

      .stat-item {
        border: 1px solid #ededed;
        border-radius: 22px;
        padding: 18px;
        min-height: 104px;
      }
    }

    @media (max-width: 520px) {
      .stats-bar {
        margin-top: -34px;
      }

      .stats-inner {
        grid-template-columns: 1fr;
        border-radius: 28px 28px 0 0;
      }

      .stat-value {
        font-size: 32px;
      }
    }
  `],
})
export class TeamStatsComponent {
  private readonly rawStats: StatItem[] = [
    { value: 'с 1999', label: 'Работаем для вас' },
    { value: 'ручная', label: 'Ретушь без конвейера' },
    { value: 'онлайн', label: 'Запись без звонков' },
    { value: '5.0', label: 'Рейтинг на картах' },
  ];

  readonly displayStats = signal<StatItem[]>(this.rawStats);
}
