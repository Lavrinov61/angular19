/**
 * DynamicPricingDashboard — CRM-дашборд управления динамическим ценообразованием.
 *
 * Показывает:
 * - Список модификаторов с toggle
 * - Статистику очереди
 * - Количество активных price locks
 */

import {
  Component, ChangeDetectionStrategy, OnInit, signal, inject,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';

interface Modifier {
  id: string;
  name: string;
  modifier_type: string;
  scope: string;
  modifier_action: string;
  modifier_value: number;
  conditions: Record<string, unknown>;
  priority: number;
  is_active: boolean;
}

interface QueueStats {
  inQueue: number;
  avgWaitMinutes: number;
  completedToday: number;
  currentDayLoad: number;
}

interface DashboardData {
  queue: QueueStats;
  active_locks: number;
}

@Component({
  selector: 'app-dynamic-pricing-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dpd-container">
      <h2 class="dpd-title">⚡ Динамическое ценообразование</h2>

      <!-- Статистика -->
      @if (stats()) {
        <div class="dpd-stats">
          <div class="dpd-stat">
            <div class="dpd-stat-value">{{ stats()!.queue.inQueue }}</div>
            <div class="dpd-stat-label">В очереди</div>
          </div>
          <div class="dpd-stat">
            <div class="dpd-stat-value">{{ stats()!.queue.completedToday }}</div>
            <div class="dpd-stat-label">Выполнено сегодня</div>
          </div>
          <div class="dpd-stat">
            <div class="dpd-stat-value">{{ stats()!.queue.avgWaitMinutes }}мин</div>
            <div class="dpd-stat-label">Среднее ожидание</div>
          </div>
          <div class="dpd-stat">
            <div class="dpd-stat-value">{{ stats()!.active_locks }}</div>
            <div class="dpd-stat-label">Активных прайс-локов</div>
          </div>
          <div class="dpd-stat">
            <div class="dpd-stat-value">{{ stats()!.queue.currentDayLoad }}%</div>
            <div class="dpd-stat-label">Загрузка дня</div>
          </div>
        </div>
      }

      <!-- Модификаторы -->
      <div class="dpd-section">
        <div class="dpd-section-header">
          <h3>Модификаторы цен</h3>
          <button class="dpd-btn-refresh" (click)="load()">↻ Обновить</button>
        </div>

        @if (loadingModifiers()) {
          <div class="dpd-loading">Загрузка...</div>
        } @else {
          <div class="dpd-modifiers">
            @for (mod of modifiers(); track mod.id) {
              <div class="dpd-modifier" [class.dpd-modifier-inactive]="!mod.is_active">
                <div class="dpd-mod-main">
                  <div class="dpd-mod-name">{{ mod.name }}</div>
                  <div class="dpd-mod-meta">
                    <span class="dpd-tag">{{ mod.modifier_type }}</span>
                    <span class="dpd-tag">{{ mod.modifier_action }} {{ mod.modifier_value }}</span>
                    <span class="dpd-tag dpd-tag-priority">P{{ mod.priority }}</span>
                  </div>
                </div>
                <label class="dpd-toggle">
                  <input
                    type="checkbox"
                    [checked]="mod.is_active"
                    (change)="toggleModifier(mod)"
                  />
                  <span class="dpd-toggle-slider"></span>
                </label>
              </div>
            }
          </div>
        }
      </div>

      @if (saveMessage()) {
        <div class="dpd-save-msg">{{ saveMessage() }}</div>
      }
    </div>
  `,
  styles: [`
    .dpd-container {
      padding: 20px;
      max-width: 800px;
    }
    .dpd-title {
      font-size: 1.25em;
      font-weight: 700;
      margin-bottom: 20px;
      color: #111827;
    }

    .dpd-stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }
    .dpd-stat {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px 16px;
      min-width: 110px;
      text-align: center;
    }
    .dpd-stat-value {
      font-size: 1.5em;
      font-weight: 700;
      color: #111827;
    }
    .dpd-stat-label {
      font-size: 0.75em;
      color: #6b7280;
      margin-top: 2px;
    }

    .dpd-section {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 16px;
    }
    .dpd-section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .dpd-section-header h3 {
      font-size: 1em;
      font-weight: 600;
      color: #374151;
    }
    .dpd-btn-refresh {
      padding: 6px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #fff;
      font-size: 0.82em;
      cursor: pointer;
    }

    .dpd-modifiers {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .dpd-modifier {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
      transition: opacity 0.2s;
    }
    .dpd-modifier-inactive {
      opacity: 0.5;
    }
    .dpd-mod-main {
      flex: 1;
    }
    .dpd-mod-name {
      font-size: 0.9em;
      font-weight: 500;
      color: #111827;
    }
    .dpd-mod-meta {
      display: flex;
      gap: 6px;
      margin-top: 4px;
      flex-wrap: wrap;
    }
    .dpd-tag {
      font-size: 0.72em;
      background: #f3f4f6;
      color: #6b7280;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .dpd-tag-priority {
      background: #e0e7ff;
      color: #4f46e5;
    }

    .dpd-toggle {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }
    .dpd-toggle input { opacity: 0; width: 0; height: 0; }
    .dpd-toggle-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: #d1d5db;
      border-radius: 22px;
      transition: 0.2s;
    }
    .dpd-toggle-slider::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      left: 3px;
      top: 3px;
      background: #fff;
      border-radius: 50%;
      transition: 0.2s;
    }
    .dpd-toggle input:checked + .dpd-toggle-slider {
      background: #16a34a;
    }
    .dpd-toggle input:checked + .dpd-toggle-slider::before {
      transform: translateX(18px);
    }

    .dpd-loading { color: #9ca3af; font-size: 0.85em; }
    .dpd-save-msg {
      margin-top: 12px;
      padding: 8px 12px;
      background: #dcfce7;
      color: #15803d;
      border-radius: 6px;
      font-size: 0.85em;
    }
  `],
})
export class DynamicPricingDashboardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  readonly modifiers = signal<Modifier[]>([]);
  readonly stats = signal<DashboardData | null>(null);
  readonly loadingModifiers = signal(false);
  readonly saveMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadingModifiers.set(true);

    Promise.all([
      firstValueFrom(this.http.get<{ success: boolean; modifiers: Modifier[] }>('/api/pricing/admin/modifiers')),
      firstValueFrom(this.http.get<{ success: boolean } & DashboardData>('/api/pricing/admin/dynamic-stats')),
    ]).then(([modRes, statsRes]) => {
      this.modifiers.set(modRes.modifiers);
      this.stats.set({ queue: statsRes.queue, active_locks: statsRes.active_locks });
      this.loadingModifiers.set(false);
    }).catch(() => {
      this.loadingModifiers.set(false);
    });
  }

  toggleModifier(mod: Modifier): void {
    const newActive = !mod.is_active;
    firstValueFrom(
      this.http.patch<{ success: boolean }>(`/api/pricing/admin/modifiers/${mod.id}`, {
        is_active: newActive,
      })
    ).then(() => {
      this.modifiers.update(list =>
        list.map(m => m.id === mod.id ? { ...m, is_active: newActive } : m)
      );
      this.showSaveMessage(newActive ? `✓ ${mod.name} включён` : `⊘ ${mod.name} выключен`);
    }).catch(() => {
      this.showSaveMessage('Ошибка сохранения');
    });
  }

  private showSaveMessage(msg: string): void {
    this.saveMessage.set(msg);
    setTimeout(() => this.saveMessage.set(null), 3000);
  }
}
