import { Component, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DashboardDataService } from '../../services/dashboard-data.service';

@Component({
  selector: 'app-dashboard-gamification',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatProgressBarModule, MatTooltipModule],
  template: `
    @if (dashData.gamification(); as g) {
      <div class="gam-card">
        <!-- Level & XP header -->
        <div class="gam-header">
          <div class="level-badge">{{ g.level }}</div>
          <div class="xp-info">
            <div class="xp-label">
              <span class="xp-val">{{ g.totalXP }} XP</span>
              <span class="xp-next">→ Уровень {{ g.level + 1 }}</span>
            </div>
            <mat-progress-bar mode="determinate" [value]="g.levelProgress" />
          </div>
          @if (g.streak > 0) {
            <div class="streak-badge" matTooltip="Дней подряд на смене">
              <mat-icon>local_fire_department</mat-icon>
              <span>{{ g.streak }}</span>
            </div>
          }
        </div>

        <!-- Daily Quests -->
        @if (g.dailyQuests.length) {
          <div class="quests">
            <div class="quests-title">
              <mat-icon>flag</mat-icon>
              Квесты дня
            </div>
            @for (q of g.dailyQuests; track q.id) {
              <div class="quest" [class.completed]="q.completed">
                <div class="quest-header">
                  <mat-icon class="quest-icon">{{ q.completed ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
                  <span class="quest-title">{{ q.title }}</span>
                  <span class="quest-xp">+{{ q.xp_reward }} XP</span>
                </div>
                <div class="quest-bar">
                  <div class="quest-fill" [style.width.%]="questProgress(q)"></div>
                </div>
                <div class="quest-nums">{{ q.progress }}/{{ q.target }}</div>
              </div>
            }
          </div>
        }

        <!-- Recent Achievements -->
        @if (g.recentAchievements.length) {
          <div class="achievements">
            <div class="ach-title">Последние ачивки</div>
            <div class="ach-row">
              @for (a of g.recentAchievements; track a.id) {
                <div class="ach-badge" [matTooltip]="a.title + ' — ' + a.description">
                  <mat-icon>{{ a.icon }}</mat-icon>
                </div>
              }
            </div>
          </div>
        }

        <!-- Toggle all achievements -->
        @if (!showAll()) {
          <button class="show-all-btn" (click)="toggleAll()">
            <mat-icon>emoji_events</mat-icon>
            Все ачивки
          </button>
        } @else {
          <button class="show-all-btn" (click)="toggleAll()">
            <mat-icon>expand_less</mat-icon>
            Свернуть
          </button>
          <div class="all-achievements">
            @for (a of allAchievements(); track a.id) {
              <div class="ach-item" [class.unlocked]="a.unlocked">
                <mat-icon class="ach-icon">{{ a.icon }}</mat-icon>
                <div class="ach-info">
                  <span class="ach-name">{{ a.title }}</span>
                  <span class="ach-desc">{{ a.description }}</span>
                </div>
                @if (a.unlocked) {
                  <mat-icon class="ach-check">check_circle</mat-icon>
                }
              </div>
            }
          </div>
        }
      </div>
    } @else if (dashData.loadingGamification()) {
      <div class="gam-loading">Загрузка...</div>
    }
  `,
  styles: [`
    :host { display: block; }

    .gam-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
      padding: 14px;
    }

    .gam-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }

    .level-badge {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: var(--crm-gradient-accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 17px;
      flex-shrink: 0;
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.3);
    }

    .xp-info { flex: 1; min-width: 0; }

    .xp-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .xp-val { font-weight: 700; font-size: 14px; }
    .xp-next { font-size: 11px; color: var(--crm-text-muted); }

    .streak-badge {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 4px 10px;
      border-radius: var(--crm-radius-md);
      background: linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.08));
      color: var(--crm-status-warning);
      font-weight: 700;
      font-size: 14px;
      flex-shrink: 0;
      box-shadow: 0 0 12px rgba(251, 191, 36, 0.1);

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-status-warning); }
    }

    .quests { margin-bottom: 10px; }

    .quests-title {
      display: flex;
      align-items: center;
      gap: 4px;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 11px;
      font-weight: 400;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 6px;
      color: var(--crm-text-muted);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .quest {
      padding: 6px 0;

      &.completed {
        opacity: 0.6;
        .quest-fill { background: var(--crm-status-success); }
        .quest-icon { color: var(--crm-status-success); }
      }
    }

    .quest-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .quest-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-accent);
    }

    .quest-title {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
    }

    .quest-xp {
      font-size: 11px;
      color: var(--crm-accent);
      font-weight: 600;
    }

    .quest-bar {
      height: 5px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 2px;
    }

    .quest-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--crm-accent-dim), var(--crm-accent));
      border-radius: 3px;
      transition: width 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.2);
    }

    .quest-nums {
      font-size: 10px;
      color: var(--crm-text-muted);
      text-align: right;
    }

    .achievements { margin-bottom: 8px; }

    .ach-title {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 11px;
      font-weight: 400;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--crm-text-muted);
      margin-bottom: 6px;
    }

    .ach-row {
      display: flex;
      gap: 6px;
    }

    .ach-badge {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05));
      border: 1px solid rgba(245, 158, 11, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: default;
      transition: transform var(--crm-transition-spring), box-shadow var(--crm-transition-smooth);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-accent);
      }

      &:hover {
        transform: scale(1.1);
        box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
      }
    }

    .show-all-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      border: none;
      background: none;
      padding: 6px 0;
      cursor: pointer;
      font-size: 12px;
      color: var(--crm-accent);
      font-weight: 500;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .all-achievements {
      max-height: 240px;
      overflow-y: auto;
    }

    .ach-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 4px;
      border-radius: 6px;
      opacity: 0.4;

      &.unlocked { opacity: 1; }
    }

    .ach-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--crm-text-muted);

      .unlocked & { color: var(--crm-accent); }
    }

    .ach-info { flex: 1; min-width: 0; }
    .ach-name { display: block; font-size: 13px; font-weight: 500; }
    .ach-desc { display: block; font-size: 11px; color: var(--crm-text-muted); }

    .ach-check {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-status-success);
    }

    .gam-loading {
      text-align: center;
      padding: 16px;
      font-size: 12px;
      color: var(--crm-text-muted);
    }
  `],
})
export class DashboardGamificationComponent {
  readonly dashData = inject(DashboardDataService);
  private readonly http = inject(HttpClient);
  readonly showAll = signal(false);
  readonly allAchievements = signal<{
    id: string; code: string; title: string; description: string;
    icon: string; category: string; unlocked: boolean;
  }[]>([]);
  private achievementsLoaded = false;

  questProgress(q: { progress: number; target: number }): number {
    return Math.min(100, Math.round((q.progress / q.target) * 100));
  }

  toggleAll(): void {
    const next = !this.showAll();
    this.showAll.set(next);
    if (next && !this.achievementsLoaded) {
      this.achievementsLoaded = true;
      this.http.get<{ success: boolean; data: { id: string; code: string; title: string; description: string; icon: string; category: string; unlocked: boolean }[] }>('/api/gamification/achievements').subscribe({
        next: (res) => {
          if (res.success) this.allAchievements.set(res.data);
        },
      });
    }
  }
}
