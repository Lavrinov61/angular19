import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { GamificationApiService, EmployeeProfile, XpLogEntry, GamificationStats } from '../../services/gamification-api.service';
import { ShiftsApiService, EmployeeShift, EmployeeEarnings } from '../../services/shifts-api.service';
import { UpsellApiService, UpsellStats } from '../../services/upsell-api.service';
import { EmployeeSalesApiService, SalesDashboard } from '../../services/employee-sales-api.service';
import { AuthService } from '../../../../core/services/auth.service';

const XP_PER_LEVEL = 500;

const ACTION_ICONS: Record<string, string> = {
  shift_completed: 'event_available',
  task_completed: 'task_alt',
  task_urgent: 'priority_high',
  order_processed: 'receipt_long',
  chat_resolved: 'chat',
  review_collected: 'star',
  streak_bonus: 'local_fire_department',
  quest_completed: 'flag',
  achievement_unlocked: 'emoji_events',
};

const ACHIEVEMENT_LABELS: Record<string, string> = {
  shift_first: 'Первый рабочий день',
  shift_10: '10 рабочих дней',
  shift_50: '50 рабочих дней',
  shift_100: '100 рабочих дней',
  review_1: 'Первый отзыв',
  review_5: '5 отзывов',
  review_10: '10 отзывов',
  xp_100: '100 XP',
  xp_500: '500 XP',
  xp_1000: '1000 XP',
  xp_5000: '5000 XP',
  streak_3: 'Серия 3 дня',
  streak_7: 'Серия 7 дней',
  streak_14: 'Серия 14 дней',
  streak_30: 'Серия 30 дней',
  revenue_10k: 'Выручка 10 000 ₽',
  revenue_50k: 'Выручка 50 000 ₽',
  revenue_100k: 'Выручка 100 000 ₽',
  orders_10: '10 заказов',
  orders_50: '50 заказов',
  orders_100: '100 заказов',
  quest_completed: 'Квест выполнен',
  chat_resolved: 'Чат закрыт',
  task_completed: 'Задача выполнена',
  task_urgent: 'Срочная задача',
  order_processed: 'Заказ обработан',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  shift_completed: 'Рабочий день завершён',
  task_completed: 'Задача выполнена',
  task_urgent: 'Срочная задача',
  order_processed: 'Заказ обработан',
  chat_resolved: 'Чат закрыт',
  review_collected: 'Отзыв собран',
  streak_bonus: 'Серия дней',
  quest_completed: 'Квест выполнен',
  achievement_unlocked: 'Ачивка получена',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  employee: 'Сотрудник',
  photographer: 'Фотограф',
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

interface CalendarDay {
  date: string;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  shift: EmployeeShift | null;
}

@Component({
  selector: 'app-employee-personal-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, MatProgressBarModule, MatButtonModule, MatTooltipModule, RouterLink],
  template: `
    @if (loading()) {
      <div class="epd-loading">
        <mat-icon>hourglass_empty</mat-icon>
        Загрузка профиля...
      </div>
    } @else if (error()) {
      <div class="epd-error">
        <mat-icon>error_outline</mat-icon>
        {{ error() }}
        <button mat-button color="primary" (click)="loadData()">Повторить</button>
      </div>
    } @else {
      @let p = profile();
      @if (p) {
      <div class="epd-dashboard">

        <!-- ═══════════ PROFILE HEADER (spans all 3 columns) ═══════════ -->
        <section class="epd-header glass-card">
          <div class="epd-avatar-wrap">
            @if (avatarUrl()) {
              <img [src]="avatarUrl()" alt="" class="epd-avatar" />
            } @else {
              <div class="epd-avatar epd-avatar--initials">{{ initials() }}</div>
            }
            <div class="epd-level-ring" [matTooltip]="'Уровень ' + p.level">{{ p.level }}</div>
          </div>

          <div class="epd-identity">
            <h2 class="epd-name">{{ userName() }}</h2>
            <div class="epd-role-row">
              <span class="epd-role">{{ roleLabel() }}</span>
              @if (studioLabel()) {
                <span class="epd-studio-badge">
                  <mat-icon>store</mat-icon>
                  {{ studioLabel() }}
                </span>
              }
            </div>
          </div>

          <div class="epd-xp-section">
            <div class="epd-xp-row">
              <span class="epd-xp-val">{{ p.total_xp }} XP</span>
              <span class="epd-xp-next">{{ xpToNext() }} XP до ур. {{ p.level + 1 }}</span>
            </div>
            <mat-progress-bar mode="determinate" [value]="p.level_progress" />
          </div>

          <div class="epd-badges">
            @if (p.current_streak > 0) {
              <div class="epd-streak" matTooltip="Рабочих дней подряд">
                <mat-icon>local_fire_department</mat-icon>
                {{ p.current_streak }}
              </div>
            }
            @if (p.leaderboard_rank > 0) {
              <div class="epd-rank" matTooltip="Место в рейтинге">
                <mat-icon>leaderboard</mat-icon>
                #{{ p.leaderboard_rank }}
              </div>
            }
          </div>
        </section>

        <!-- ═══════════ LEFT COLUMN: Calendar ═══════════ -->
        <div class="epd-col-left">
          <section class="epd-calendar glass-card">
            <div class="epd-cal-header">
              <h3 class="epd-section-title">
                <mat-icon>calendar_month</mat-icon>
                Календарь рабочих дней
              </h3>
              <div class="epd-cal-nav">
                <button mat-icon-button (click)="prevMonth()">
                  <mat-icon>chevron_left</mat-icon>
                </button>
                <span class="epd-cal-month">{{ monthLabel() }}</span>
                <button mat-icon-button (click)="nextMonth()">
                  <mat-icon>chevron_right</mat-icon>
                </button>
              </div>
            </div>

            <div class="epd-cal-grid">
              @for (wd of weekdays; track wd) {
                <div class="epd-cal-weekday">{{ wd }}</div>
              }
              @for (cell of calendarDays(); track cell.date) {
                <div class="epd-cal-cell"
                     [class.other-month]="!cell.isCurrentMonth"
                     [class.today]="cell.isToday"
                     [class.has-shift]="!!cell.shift"
                     [class.selected]="pendingDays().includes(cell.date)"
                     [matTooltip]="cellTooltip(cell)"
                     role="button" tabindex="0"
                     (click)="toggleDay(cell)"
                     (keydown.enter)="toggleDay(cell)"
                     (keydown.space)="toggleDay(cell)">
                  <span class="epd-cal-day">{{ cell.day }}</span>
                  @if (cell.shift; as s) {
                    <div class="epd-cal-dot" [attr.data-status]="s.status"></div>
                    <span class="epd-cal-studio-mini">{{ studioInitial(s) }}</span>
                  }
                  @if (pendingDays().includes(cell.date)) {
                    <div class="epd-cal-pending-mark">
                      <mat-icon>add</mat-icon>
                    </div>
                  }
                </div>
              }
            </div>

            <div class="epd-cal-legend">
              <span class="epd-legend-item"><span class="epd-legend-dot" data-status="completed"></span> Завершена</span>
              <span class="epd-legend-item"><span class="epd-legend-dot" data-status="scheduled"></span> Запланирована</span>
              <span class="epd-legend-item"><span class="epd-legend-dot" data-status="active"></span> Активна</span>
              <span class="epd-legend-item"><span class="epd-legend-dot" data-status="cancelled"></span> Отменена</span>
            </div>

            @if (pendingDays().length > 0) {
              <div class="epd-cal-request">
                <span>Выбрано дней: {{ pendingDays().length }}</span>
                <button mat-flat-button color="primary" (click)="submitShiftRequest()" [disabled]="submitting()">
                  <mat-icon>send</mat-icon>
                  Запросить
                </button>
                <button mat-button (click)="clearPending()">Сбросить</button>
              </div>
            }
            @if (requestSent()) {
              <div class="epd-cal-success">
                <mat-icon>check_circle</mat-icon>
                Запрос отправлен администратору
              </div>
            }

            <div class="epd-work-hours">
              <mat-icon>access_time</mat-icon>
              <span>Рабочий день: <strong>8:45 – 19:45</strong> (для клиентов 9:00 – 19:30)</span>
            </div>
          </section>
        </div>

        <!-- ═══════════ CENTER COLUMN: Schedule + Stats ═══════════ -->
        <div class="epd-col-center">
          <!-- Morning Briefing -->
          @if (showMorningBriefing()) {
            <section class="epd-briefing glass-card">
              <button class="epd-briefing-close" (click)="dismissBriefing()">
                <mat-icon>close</mat-icon>
              </button>
              <div class="epd-briefing-greeting">
                <mat-icon>wb_sunny</mat-icon>
                Доброе утро, {{ firstName() }}!
              </div>
              <div class="epd-briefing-items">
                @if (upsellStats(); as us) {
                  @if (conversionRemaining() > 0) {
                    <div class="epd-briefing-item">
                      <mat-icon>emoji_events</mat-icon>
                      До цели допродаж: {{ conversionRemaining() }} {{ upsellWord(conversionRemaining()) }}
                    </div>
                  }
                  <div class="epd-briefing-item">
                    <mat-icon>groups</mat-icon>
                    @if (us.bonus_progress.team.revenue >= us.bonus_progress.team.target) {
                      Командная цель: {{ us.bonus_progress.team.revenue | number:'1.0-0' }} из {{ us.bonus_progress.team.target | number:'1.0-0' }} ₽ — выполнена
                    } @else {
                      Командная цель: {{ us.bonus_progress.team.revenue | number:'1.0-0' }} из {{ us.bonus_progress.team.target | number:'1.0-0' }} ₽
                    }
                  </div>
                }
                @if (gamStats(); as g) {
                  @if (g.streak > 0) {
                    <div class="epd-briefing-item">
                      <mat-icon>local_fire_department</mat-icon>
                      Серия: {{ g.streak }} {{ daysWord(g.streak) }} — не теряй!
                    </div>
                  }
                }
                <div class="epd-briefing-item epd-briefing-tip">
                  <mat-icon>lightbulb</mat-icon>
                  {{ dailyTip() }}
                </div>
              </div>
              <div class="epd-briefing-footer">Удачного рабочего дня!</div>
            </section>
          }

          <!-- Evening Summary -->
          @if (showEveningSummary()) {
            <section class="epd-briefing epd-briefing--evening glass-card">
              <button class="epd-briefing-close" (click)="dismissEveningSummary()">
                <mat-icon>close</mat-icon>
              </button>
              <div class="epd-briefing-greeting">
                <mat-icon>nightlight</mat-icon>
                Итоги рабочего дня
              </div>
              <div class="epd-briefing-items">
                @if (upsellStats(); as usEv) {
                  <div class="epd-briefing-item">
                    <mat-icon>trending_up</mat-icon>
                    Допродажи: {{ usEv.accepted }} из {{ usEv.total_offers }} клиентов
                  </div>
                  <div class="epd-briefing-item">
                    <mat-icon>percent</mat-icon>
                    Конверсия за месяц: {{ usEv.conversion_pct }}%
                    @if (usEv.conversion_pct >= usEv.bonus_progress.conversion.threshold) {
                      — цель выполнена
                    }
                  </div>
                  <div class="epd-briefing-item">
                    <mat-icon>groups</mat-icon>
                    Командная цель: {{ usEv.bonus_progress.team.revenue | number:'1.0-0' }} из {{ usEv.bonus_progress.team.target | number:'1.0-0' }} ₽
                  </div>
                }
                @if (earnings(); as ev) {
                  <div class="epd-briefing-item">
                    <mat-icon>event_available</mat-icon>
                    Рабочих дней за месяц: {{ workedDaysThisMonth() }} из {{ ev.total_shifts }}
                  </div>
                }
                @if (gamStats(); as gs) {
                  @if (gs.streak > 0) {
                    <div class="epd-briefing-item">
                      <mat-icon>local_fire_department</mat-icon>
                      Серия: {{ gs.streak }} {{ daysWord(gs.streak) }}
                    </div>
                  }
                }
              </div>
              <div class="epd-briefing-footer">Отличная работа! Отдыхай.</div>
            </section>
          }

          <!-- Today command center -->
          @if (salesDashboard(); as sd) {
            <section class="epd-today glass-card">
              <div class="epd-today-main">
                <div class="epd-today-copy">
                  <div class="epd-eyebrow">
                    <mat-icon>bolt</mat-icon>
                    Сегодня · {{ todayDateLabel() }}
                  </div>
                  <div class="epd-today-value">{{ sd.total_sales | number:'1.0-0' }} ₽</div>
                  <div class="epd-today-caption">Вся оплаченная выручка за день</div>
                </div>
                <a
                  mat-flat-button
                  class="epd-primary-action"
                  routerLink="/employee/sales"
                  matTooltip="Открыть детальную выручку">
                  <mat-icon>query_stats</mat-icon>
                  Детальная выручка
                </a>
              </div>
              <div class="epd-today-metrics">
                <div class="epd-metric-line">
                  <span class="epd-metric-name">
                    <mat-icon>receipt_long</mat-icon>
                    Оплачено
                  </span>
                  <strong>{{ sd.receipts_count }} {{ paymentsWord(sd.receipts_count) }}</strong>
                </div>
                <div class="epd-metric-line">
                  <span class="epd-metric-name">
                    <mat-icon>shopping_cart</mat-icon>
                    Средний чек
                  </span>
                  <strong>{{ sd.avg_receipt | number:'1.0-0' }} ₽</strong>
                </div>
                <div class="epd-metric-line">
                  <span class="epd-metric-name">
                    <mat-icon>link</mat-icon>
                    Выставлено
                  </span>
                  <strong>{{ sd.issued_invoices_total | number:'1.0-0' }} ₽</strong>
                  <small>{{ sd.issued_invoices_count }} {{ invoicesWord(sd.issued_invoices_count) }}</small>
                </div>
              </div>
            </section>
          }

          <!-- Month plan -->
          @if (earnings(); as e) {
            <section class="epd-month glass-card">
              <div class="epd-month-top">
                <div>
                  <div class="epd-eyebrow">
                    <mat-icon>event_available</mat-icon>
                    Рабочий месяц
                  </div>
                  <h3 class="epd-month-title">{{ earningsMonthLabel() }}</h3>
                </div>
                <div class="epd-month-score">
                  <strong>{{ workedDaysThisMonth() }}</strong>
                  <span>из {{ e.total_shifts }} {{ shiftsWord(e.total_shifts) }}</span>
                </div>
              </div>

              <div class="epd-plan-track" [matTooltip]="shiftPlanPct() + '% плана смен закрыто'">
                <div class="epd-plan-fill" [style.width.%]="shiftPlanPct()"></div>
              </div>
              <div class="epd-plan-meta">
                <span>{{ shiftPlanPct() }}% плана смен закрыто</span>
                @if (plannedDaysLeft() > 0) {
                  <span>ещё {{ plannedDaysLeft() }} {{ shiftsWord(plannedDaysLeft()) }}</span>
                } @else {
                  <span>план закрыт</span>
                }
              </div>

              <div class="epd-month-tiles">
                <div class="epd-month-tile">
                  <mat-icon>today</mat-icon>
                  <span>Сегодня</span>
                  <strong>{{ todayShiftLabel() }}</strong>
                  <small>{{ todayShiftTime() }}</small>
                </div>
                <div class="epd-month-tile">
                  <mat-icon>payments</mat-icon>
                  <span>Ставка смены</span>
                  <strong>{{ e.daily_rate | number:'1.0-0' }} ₽</strong>
                  <small>по текущей студии</small>
                </div>
                <div class="epd-month-tile">
                  <mat-icon>event_repeat</mat-icon>
                  <span>Осталось по плану</span>
                  <strong>{{ plannedDaysLeft() }} {{ shiftsWord(plannedDaysLeft()) }}</strong>
                  <small>{{ e.total_shifts }} {{ shiftsWord(e.total_shifts) }} всего</small>
                </div>
              </div>
            </section>
          }

        </div>

        <!-- ═══════════ RIGHT COLUMN: Gamification + Quests + Achievements + XP Feed ═══════════ -->
        <div class="epd-col-right">
          <!-- Gamification stats -->
          @if (gamStats(); as g) {
            <section class="epd-gam glass-card">
              <div class="epd-gam-header">
                <div class="epd-gam-level">{{ p.level }}</div>
                <div class="epd-gam-xp-info">
                  <div class="epd-gam-xp-row">
                    <span class="epd-gam-xp-val">{{ p.total_xp }} XP</span>
                    <span class="epd-gam-xp-next">ур. {{ p.level + 1 }}</span>
                  </div>
                  <mat-progress-bar mode="determinate" [value]="g.levelProgress" />
                </div>
                @if (g.streak > 0) {
                  <div class="epd-gam-streak" matTooltip="Дней подряд">
                    <mat-icon>local_fire_department</mat-icon>
                    {{ g.streak }}
                  </div>
                }
              </div>

              <!-- Daily Quests -->
              @if (g.dailyQuests.length) {
                <div class="epd-quests">
                  <div class="epd-section-title-sm">
                    <mat-icon>flag</mat-icon>
                    Квесты дня
                  </div>
                  @for (q of g.dailyQuests; track q.id) {
                    <div class="epd-quest" [class.completed]="q.completed">
                      <div class="epd-quest-row">
                        <mat-icon class="epd-quest-icon">{{ q.completed ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
                        <span class="epd-quest-title">{{ q.title }}</span>
                        <span class="epd-quest-xp">+{{ q.xp_reward }}</span>
                      </div>
                      <div class="epd-quest-bar">
                        <div class="epd-quest-fill" [style.width.%]="questProgress(q)"></div>
                      </div>
                      <div class="epd-quest-nums">{{ q.progress }}/{{ q.target }}</div>
                    </div>
                  }
                </div>
              }

              <!-- Recent Achievements -->
              @if (g.recentAchievements.length) {
                <div class="epd-achievements">
                  <div class="epd-section-title-sm">Последние ачивки</div>
                  <div class="epd-ach-row">
                    @for (a of g.recentAchievements; track a.id) {
                      <div class="epd-ach-badge" [matTooltip]="a.title + ' — ' + a.description">
                        <mat-icon>{{ a.icon }}</mat-icon>
                      </div>
                    }
                  </div>
                </div>
              }

              <button class="epd-ach-toggle" (click)="showAllAchievements.set(!showAllAchievements())">
                <mat-icon>{{ showAllAchievements() ? 'expand_less' : 'emoji_events' }}</mat-icon>
                {{ showAllAchievements() ? 'Свернуть' : 'Все ачивки' }}
              </button>
              @if (showAllAchievements()) {
                <div class="epd-all-ach">
                  @for (a of allAchievements(); track a.id) {
                    <div class="epd-ach-item" [class.unlocked]="a.unlocked">
                      <mat-icon class="epd-ach-icon">{{ a.icon }}</mat-icon>
                      <div class="epd-ach-info">
                        <span class="epd-ach-name">{{ a.title }}</span>
                        <span class="epd-ach-desc">{{ a.description }}</span>
                      </div>
                      @if (a.unlocked) {
                        <mat-icon class="epd-ach-check">check_circle</mat-icon>
                      }
                    </div>
                  }
                </div>
              }
            </section>
          }

          <!-- XP Activity Feed -->
          @if (xpLog().length) {
            <section class="epd-xp-feed glass-card">
              <h3 class="epd-section-title">
                <mat-icon>bolt</mat-icon>
                Активность XP
              </h3>
              <div class="epd-feed-list">
                @for (entry of xpLog(); track $index) {
                  <div class="epd-feed-item">
                    <mat-icon class="epd-feed-icon">{{ actionIcon(entry.action_type) }}</mat-icon>
                    <div class="epd-feed-body">
                      <span class="epd-feed-desc">{{ feedDescription(entry) }}</span>
                      <span class="epd-feed-time">{{ relativeTime(entry.created_at) }}</span>
                    </div>
                    <span class="epd-feed-xp">+{{ entry.xp_amount }}</span>
                  </div>
                }
              </div>
            </section>
          }
        </div>

      </div>
      }
    }
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .epd-loading, .epd-error {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 48px 16px;
      color: var(--crm-text-muted);
      font-size: 14px;
    }

    /* ═══════ 3-COLUMN DASHBOARD GRID ═══════ */
    .epd-dashboard {
      display: grid;
      grid-template-columns: minmax(300px, 340px) 1fr minmax(280px, 320px);
      grid-template-rows: auto 1fr;
      gap: 16px;
      padding: 16px;
      height: 100%;
      overflow: hidden;
    }

    .epd-header { grid-column: 1 / -1; }

    .epd-col-left,
    .epd-col-center,
    .epd-col-right {
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-bottom: 16px;
    }

    .glass-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
      padding: 16px;
    }

    /* ── Center: Today + Month ── */
    .epd-today,
    .epd-month {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .epd-today {
      padding: 18px;
      border-color: rgba(245, 158, 11, 0.2);
      background:
        linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(34, 197, 94, 0.04)),
        var(--crm-gradient-card);
    }

    .epd-today-main,
    .epd-month-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .epd-today-copy {
      min-width: 0;
    }

    .epd-eyebrow {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0;
      text-transform: uppercase;
      color: var(--crm-text-muted);
    }

    .epd-eyebrow mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
      color: var(--crm-accent, #f59e0b);
    }

    .epd-today-value {
      margin-top: 10px;
      font-size: 38px;
      font-weight: 850;
      line-height: 1;
      color: var(--crm-accent, #f59e0b);
      white-space: nowrap;
    }

    .epd-today-caption {
      margin-top: 7px;
      font-size: 13px;
      color: var(--crm-text-secondary);
    }

    .epd-primary-action {
      min-height: 40px;
      padding: 0 14px;
      border-radius: 8px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .epd-primary-action mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 6px;
    }

    .epd-today-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .epd-metric-line {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .epd-metric-name {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--crm-text-muted);
    }

    .epd-metric-name mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .epd-metric-line strong {
      font-size: 18px;
      line-height: 1.1;
      white-space: nowrap;
    }

    .epd-metric-line small {
      font-size: 11px;
      color: var(--crm-text-muted);
    }

    .epd-month {
      padding: 18px;
    }

    .epd-month-title {
      margin: 6px 0 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 25px;
      font-weight: 600;
      letter-spacing: 0;
      text-transform: uppercase;
      line-height: 1;
    }

    .epd-month-score {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(96, 165, 250, 0.1);
      color: var(--crm-status-info, #60a5fa);
      white-space: nowrap;
    }

    .epd-month-score strong {
      font-size: 24px;
      line-height: 1;
    }

    .epd-month-score span {
      font-size: 12px;
      color: var(--crm-text-secondary);
    }

    .epd-plan-track {
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.08);
    }

    .epd-plan-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--crm-status-success, #22c55e), var(--crm-accent, #f59e0b));
      transition: width 0.25s ease;
    }

    .epd-plan-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: -8px;
      font-size: 12px;
      color: var(--crm-text-muted);
    }

    .epd-month-tiles {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0;
      padding-top: 4px;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
    }

    .epd-month-tile {
      min-width: 0;
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      column-gap: 8px;
      row-gap: 2px;
      padding: 8px 12px;
    }

    .epd-month-tile:not(:last-child) {
      border-right: 1px solid rgba(255, 255, 255, 0.07);
    }

    .epd-month-tile mat-icon {
      grid-row: 1 / 4;
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--crm-accent, #f59e0b);
    }

    .epd-month-tile span {
      font-size: 11px;
      color: var(--crm-text-muted);
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .epd-month-tile strong {
      font-size: 17px;
      line-height: 1.15;
      white-space: nowrap;
    }

    .epd-month-tile small {
      min-width: 0;
      font-size: 11px;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Profile Header ── */
    .epd-header {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .epd-avatar-wrap { position: relative; flex-shrink: 0; }

    .epd-avatar {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      object-fit: cover;
    }

    .epd-avatar--initials {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--crm-gradient-accent);
      color: #fff;
      font-weight: 700;
      font-size: 20px;
    }

    .epd-level-ring {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--crm-gradient-accent);
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--crm-bg-primary, #1a1a2e);
    }

    .epd-identity { flex: 1; min-width: 120px; }
    .epd-name { margin: 0; font-size: 18px; font-weight: 700; }

    .epd-role-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
    }

    .epd-role { font-size: 12px; color: var(--crm-text-muted); }

    .epd-studio-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.06));
      color: #a78bfa;

      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }

    .epd-xp-section { flex: 1; min-width: 180px; max-width: 300px; }

    .epd-xp-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .epd-xp-val { font-weight: 700; font-size: 14px; }
    .epd-xp-next { font-size: 11px; color: var(--crm-text-muted); }

    .epd-badges {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .epd-streak, .epd-rank {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--crm-radius-md);
      font-weight: 700;
      font-size: 14px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .epd-streak {
      background: linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.08));
      color: var(--crm-status-warning);
      mat-icon { color: var(--crm-status-warning); }
    }

    .epd-rank {
      background: linear-gradient(135deg, rgba(96, 165, 250, 0.15), rgba(96, 165, 250, 0.08));
      color: var(--crm-status-info, #60a5fa);
      mat-icon { color: var(--crm-status-info, #60a5fa); }
    }

    /* ── Calendar ── */
    .epd-cal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;

      .epd-section-title { margin-bottom: 0; }
    }

    .epd-cal-nav {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .epd-cal-month {
      font-size: 13px;
      font-weight: 600;
      min-width: 110px;
      text-align: center;
      text-transform: capitalize;
    }

    .epd-cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 3px;
    }

    .epd-cal-weekday {
      text-align: center;
      font-size: 10px;
      font-weight: 600;
      color: var(--crm-text-muted);
      padding: 3px 0;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .epd-cal-cell {
      position: relative;
      aspect-ratio: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: var(--crm-radius-sm, 6px);
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      min-height: 36px;

      &:hover:not(.other-month) {
        background: rgba(255, 255, 255, 0.06);
        transform: scale(1.05);
      }

      &.other-month {
        opacity: 0.25;
        pointer-events: none;
      }

      &.today {
        border: 2px solid var(--crm-accent);
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.2);
      }

      &.has-shift { background: rgba(255, 255, 255, 0.04); }

      &.selected {
        background: rgba(96, 165, 250, 0.15);
        border: 2px dashed var(--crm-status-info, #60a5fa);
      }
    }

    .epd-cal-day { font-size: 12px; font-weight: 600; line-height: 1; }

    .epd-cal-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-top: 2px;

      &[data-status="completed"] { background: var(--crm-status-success); }
      &[data-status="scheduled"] { background: var(--crm-status-warning); }
      &[data-status="active"] {
        background: var(--crm-status-info, #60a5fa);
        animation: pulse-dot 1.5s infinite;
      }
      &[data-status="cancelled"] { background: var(--crm-status-error); }
    }

    .epd-cal-studio-mini {
      position: absolute;
      top: 2px;
      right: 3px;
      font-size: 8px;
      font-weight: 700;
      color: var(--crm-text-muted);
      opacity: 0.7;
    }

    .epd-cal-pending-mark {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-status-info, #60a5fa); }
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.4); }
    }

    .epd-cal-legend {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    .epd-legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: var(--crm-text-muted);
    }

    .epd-legend-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;

      &[data-status="completed"] { background: var(--crm-status-success); }
      &[data-status="scheduled"] { background: var(--crm-status-warning); }
      &[data-status="active"] { background: var(--crm-status-info, #60a5fa); }
      &[data-status="cancelled"] { background: var(--crm-status-error); }
    }

    .epd-cal-request {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: var(--crm-radius-md);
      background: linear-gradient(135deg, rgba(96, 165, 250, 0.08), rgba(96, 165, 250, 0.03));
      font-size: 12px;

      span { flex: 1; font-weight: 500; }
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .epd-cal-success {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding: 8px 12px;
      border-radius: var(--crm-radius-md);
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.04));
      color: var(--crm-status-success);
      font-size: 12px;
      font-weight: 500;
      animation: fadeIn 0.3s ease;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .epd-work-hours {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      font-size: 11px;
      color: var(--crm-text-muted);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    @keyframes fadeSlide {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Morning Briefing / Evening Summary ── */
    .epd-briefing {
      position: relative;
      border: 1px solid rgba(251, 191, 36, 0.15);
      background: linear-gradient(135deg, rgba(251, 191, 36, 0.06), rgba(251, 191, 36, 0.02));
      animation: fadeSlide 0.3s ease;
    }

    .epd-briefing--evening {
      border-color: rgba(139, 92, 246, 0.15);
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.06), rgba(139, 92, 246, 0.02));
    }

    .epd-briefing-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      border: none;
      background: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--crm-text-muted);
      border-radius: 50%;
      transition: background 0.15s;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { background: rgba(255, 255, 255, 0.06); }
    }

    .epd-briefing-greeting {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 10px;

      mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--crm-accent); }
    }

    .epd-briefing--evening .epd-briefing-greeting mat-icon {
      color: #a78bfa;
    }

    .epd-briefing-items {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 10px;
    }

    .epd-briefing-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--crm-text-secondary);

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-accent); flex-shrink: 0; }
    }

    .epd-briefing--evening .epd-briefing-item mat-icon {
      color: #a78bfa;
    }

    .epd-briefing-tip {
      padding: 6px 8px;
      border-radius: var(--crm-radius-md);
      background: rgba(255, 255, 255, 0.03);
      font-style: italic;

      mat-icon { color: var(--crm-status-warning) !important; }
    }

    .epd-briefing-footer {
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-accent);
    }

    .epd-briefing--evening .epd-briefing-footer {
      color: #a78bfa;
    }

    /* ── Section Title ── */
    .epd-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 10px;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 12px;
      font-weight: 400;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--crm-text-muted);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .epd-section-title-sm {
      display: flex;
      align-items: center;
      gap: 4px;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 11px;
      font-weight: 400;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--crm-text-muted);
      margin-bottom: 6px;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    /* ── Right Column: Gamification ── */
    .epd-gam-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }

    .epd-gam-level {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--crm-gradient-accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 16px;
      flex-shrink: 0;
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.3);
    }

    .epd-gam-xp-info { flex: 1; min-width: 0; }

    .epd-gam-xp-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .epd-gam-xp-val { font-weight: 700; font-size: 14px; }
    .epd-gam-xp-next { font-size: 11px; color: var(--crm-text-muted); }

    .epd-gam-streak {
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

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-status-warning); }
    }

    /* ── Quests ── */
    .epd-quests { margin-bottom: 10px; }

    .epd-quest {
      padding: 4px 0;

      &.completed {
        opacity: 0.6;
        .epd-quest-fill { background: var(--crm-status-success); }
        .epd-quest-icon { color: var(--crm-status-success); }
      }
    }

    .epd-quest-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 3px;
    }

    .epd-quest-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-accent); }
    .epd-quest-title { flex: 1; font-size: 12px; font-weight: 500; }
    .epd-quest-xp { font-size: 11px; color: var(--crm-accent); font-weight: 600; }

    .epd-quest-bar {
      height: 4px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 2px;
    }

    .epd-quest-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--crm-accent-dim), var(--crm-accent));
      border-radius: 2px;
      transition: width 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .epd-quest-nums { font-size: 10px; color: var(--crm-text-muted); text-align: right; }

    /* ── Achievements ── */
    .epd-achievements { margin-bottom: 8px; }

    .epd-ach-row { display: flex; gap: 6px; flex-wrap: wrap; }

    .epd-ach-badge {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05));
      border: 1px solid rgba(245, 158, 11, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: default;
      transition: transform 0.2s, box-shadow 0.2s;

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-accent); }

      &:hover {
        transform: scale(1.1);
        box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
      }
    }

    .epd-ach-toggle {
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

    .epd-all-ach {
      max-height: 200px;
      overflow-y: auto;
    }

    .epd-ach-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 4px;
      border-radius: 6px;
      opacity: 0.4;

      &.unlocked { opacity: 1; }
    }

    .epd-ach-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-muted);

      .unlocked & { color: var(--crm-accent); }
    }

    .epd-ach-info { flex: 1; min-width: 0; }
    .epd-ach-name { display: block; font-size: 12px; font-weight: 500; }
    .epd-ach-desc { display: block; font-size: 10px; color: var(--crm-text-muted); }

    .epd-ach-check {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-status-success);
    }

    /* ── XP Feed ── */
    .epd-feed-list {
      max-height: 400px;
      overflow-y: auto;
    }

    .epd-feed-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 2px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);

      &:last-child { border-bottom: none; }
    }

    .epd-feed-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }

    .epd-feed-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .epd-feed-desc {
      font-size: 12px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .epd-feed-time { font-size: 10px; color: var(--crm-text-muted); }

    .epd-feed-xp {
      font-size: 12px;
      font-weight: 700;
      color: var(--crm-accent);
      flex-shrink: 0;
      padding: 2px 6px;
      border-radius: var(--crm-radius-sm, 4px);
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.04));
    }

    @media (max-width: 1180px) {
      .epd-dashboard {
        grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
      }

      .epd-col-right {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 860px) {
      .epd-dashboard {
        grid-template-columns: minmax(0, 1fr);
        height: auto;
        overflow: auto;
      }

      .epd-col-left,
      .epd-col-center,
      .epd-col-right {
        overflow: visible;
      }

      .epd-today-main,
      .epd-month-top {
        flex-direction: column;
        align-items: stretch;
      }

      .epd-primary-action {
        width: 100%;
      }

      .epd-today-metrics,
      .epd-month-tiles,
      .epd-col-right {
        grid-template-columns: minmax(0, 1fr);
      }

      .epd-month-tile {
        padding: 10px 0;
      }

      .epd-month-tile:not(:last-child) {
        border-right: 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
    }

  `],
})
export class EmployeePersonalDashboardComponent implements OnInit {
  private readonly gamApi = inject(GamificationApiService);
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly upsellApi = inject(UpsellApiService);
  private readonly salesApi = inject(EmployeeSalesApiService);
  private readonly auth = inject(AuthService);

  readonly profile = signal<EmployeeProfile | null>(null);
  readonly xpLog = signal<XpLogEntry[]>([]);
  readonly calendarShifts = signal<EmployeeShift[]>([]);
  readonly earnings = signal<EmployeeEarnings | null>(null);
  readonly gamStats = signal<GamificationStats | null>(null);
  readonly selectedMonth = signal(new Date());
  readonly pendingDays = signal<string[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly requestSent = signal(false);
  readonly showAllAchievements = signal(false);
  readonly allAchievements = signal<{ id: string; code: string; title: string; description: string; icon: string; category: string; unlocked: boolean }[]>([]);
  private achievementsLoaded = false;

  // POS Sales dashboard (today)
  readonly salesDashboard = signal<SalesDashboard | null>(null);

  // Upsell goals
  readonly upsellStats = signal<UpsellStats | null>(null);

  // Briefing / evening summary
  readonly briefingDismissed = signal(false);
  readonly eveningDismissed = signal(false);

  readonly dailyTips = [
    'Покажите клиенту до/после ретуши на экране — конверсия растёт в 3 раза',
    'Предложите комплект — экономия 810₽ для клиента, а вам шаг к цели',
    'Для молодых клиентов: "Портрет для соцсетей — профессиональное фото выделяется среди селфи"',
    'При съёмке: "Вы отлично получаетесь! Хотите пару кадров в портретном стиле?"',
    'Покажите рамку с образцом — тактильный аргумент работает лучше слов',
    'Если свободное окно: "Сейчас как раз есть время для портрета"',
    '"Большинство клиентов берут комплект — документы с обработкой выглядят свежее"',
  ] as const;

  readonly weekdays = WEEKDAYS;

  readonly userName = computed(() => {
    const u = this.auth.currentUser();
    return u?.display_name || u?.displayName || 'Сотрудник';
  });

  readonly roleLabel = computed(() => {
    const role = this.auth.currentUser()?.role;
    return role ? (ROLE_LABELS[role] || role) : '';
  });

  readonly avatarUrl = computed(() => {
    const u = this.auth.currentUser();
    return u?.photo_url || u?.photoURL || null;
  });

  readonly initials = computed(() => {
    const name = this.userName();
    const parts = name.split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  });

  readonly xpToNext = computed(() => {
    const p = this.profile();
    if (!p) return 0;
    const nextLevelXp = p.level * XP_PER_LEVEL;
    return Math.max(0, nextLevelXp - p.total_xp);
  });

  readonly studioLabel = computed(() => {
    const e = this.earnings();
    if (!e?.studio_name) return null;
    return e.studio_name;
  });

  readonly earningsMonthLabel = computed(() => {
    return this.selectedMonth().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).toUpperCase();
  });

  readonly todayDateLabel = computed(() => {
    return new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  });

  readonly todayShift = computed(() => {
    const today = this.localDateKey(new Date());
    return this.calendarShifts().find(shift => shift.shift_date.split('T')[0] === today) ?? null;
  });

  readonly todayShiftLabel = computed(() => {
    const shift = this.todayShift();
    return shift ? this.shiftStatusLabel(shift.status) : 'Свободный день';
  });

  readonly todayShiftTime = computed(() => {
    const shift = this.todayShift();
    if (!shift) return 'смены нет';
    const time = `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`;
    return shift.studio_name ? `${time} · ${shift.studio_name}` : time;
  });

  readonly workedDaysThisMonth = computed(() => {
    const opened = this.calendarShifts()
      .filter(shift => shift.status === 'active' || shift.status === 'completed')
      .length;
    return opened || this.earnings()?.completed_shifts || 0;
  });

  readonly plannedDaysLeft = computed(() => {
    const total = this.earnings()?.total_shifts ?? 0;
    return Math.max(0, total - this.workedDaysThisMonth());
  });

  readonly shiftPlanPct = computed(() => {
    const total = this.earnings()?.total_shifts ?? 0;
    const worked = this.workedDaysThisMonth();
    if (total <= 0) return worked > 0 ? 100 : 0;
    return Math.min(100, Math.round((worked / total) * 100));
  });

  readonly firstName = computed(() => {
    const name = this.userName();
    return name.split(' ')[0];
  });

  readonly dailyTip = computed(() => {
    const today = new Date();
    const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86_400_000);
    return this.dailyTips[dayOfYear % this.dailyTips.length];
  });

  readonly showMorningBriefing = computed(() => {
    if (this.briefingDismissed()) return false;
    const now = new Date();
    if (now.getHours() >= 12) return false;
    const key = `epd-briefing-${now.toISOString().split('T')[0]}`;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key)) return false;
    return !!this.profile();
  });

  readonly showEveningSummary = computed(() => {
    if (this.eveningDismissed()) return false;
    const now = new Date();
    if (now.getHours() < 19) return false;
    const key = `epd-evening-${now.toISOString().split('T')[0]}`;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key)) return false;
    const e = this.earnings();
    return !!e && e.completed_shifts > 0;
  });

  readonly conversionRemaining = computed(() => {
    const us = this.upsellStats();
    if (!us) return 0;
    const { pct, threshold } = us.bonus_progress.conversion;
    if (pct >= threshold) return 0;
    const gap = threshold - pct;
    // Estimate: each upsell roughly moves conversion ~2-3% (based on total_offers)
    const totalOffers = us.total_offers || 1;
    return Math.max(1, Math.ceil((gap / 100) * totalOffers));
  });

  readonly calendarDays = computed(() => {
    const d = this.selectedMonth();
    const year = d.getFullYear();
    const month = d.getMonth();
    const shifts = this.calendarShifts();
    const shiftMap = new Map<string, EmployeeShift>();
    for (const s of shifts) {
      shiftMap.set(s.shift_date.split('T')[0], s);
    }

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const startPad = (firstDay.getDay() + 6) % 7;
    const cells: CalendarDay[] = [];

    for (let i = startPad - 1; i >= 0; i--) {
      const dd = new Date(year, month, -i);
      const ds = dd.toISOString().split('T')[0];
      cells.push({
        date: ds, day: dd.getDate(), isCurrentMonth: false,
        isToday: false, isPast: dd < today, shift: shiftMap.get(ds) || null,
      });
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dd = new Date(year, month, day);
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push({
        date: ds, day, isCurrentMonth: true,
        isToday: ds === todayStr, isPast: dd < today, shift: shiftMap.get(ds) || null,
      });
    }

    const remainder = cells.length % 7;
    if (remainder > 0) {
      for (let i = 1; i <= 7 - remainder; i++) {
        const dd = new Date(year, month + 1, i);
        const ds = dd.toISOString().split('T')[0];
        cells.push({
          date: ds, day: dd.getDate(), isCurrentMonth: false,
          isToday: false, isPast: dd < today, shift: shiftMap.get(ds) || null,
        });
      }
    }

    return cells;
  });

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      profile: this.gamApi.getMyProfile(),
      xpLog: this.gamApi.getMyXpLog(30),
      gamStats: this.gamApi.getMyStats(),
    }).subscribe({
      next: ({ profile, xpLog, gamStats }) => {
        if (profile.success) this.profile.set(profile.data);
        if (xpLog.success) this.xpLog.set(xpLog.data);
        if (gamStats.success) this.gamStats.set(gamStats.data);
        this.loading.set(false);
        this.loadCalendarData();
        this.loadSalesDashboard();
      },
      error: () => {
        this.error.set('Не удалось загрузить данные');
        this.loading.set(false);
      },
    });
  }

  monthLabel(): string {
    return this.selectedMonth().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }

  prevMonth(): void {
    const d = new Date(this.selectedMonth());
    d.setMonth(d.getMonth() - 1);
    this.selectedMonth.set(d);
    this.pendingDays.set([]);
    this.loadCalendarData();
  }

  nextMonth(): void {
    const d = new Date(this.selectedMonth());
    d.setMonth(d.getMonth() + 1);
    this.selectedMonth.set(d);
    this.pendingDays.set([]);
    this.loadCalendarData();
  }

  toggleDay(cell: CalendarDay): void {
    if (!cell.isCurrentMonth || cell.shift || cell.isPast) return;
    const days = [...this.pendingDays()];
    const idx = days.indexOf(cell.date);
    if (idx >= 0) {
      days.splice(idx, 1);
    } else {
      days.push(cell.date);
    }
    this.pendingDays.set(days);
  }

  clearPending(): void {
    this.pendingDays.set([]);
  }

  submitShiftRequest(): void {
    const days = this.pendingDays();
    if (days.length === 0) return;
    this.submitting.set(true);

    const requestedShifts = days.sort().map(date => ({
      date,
      start_time: '08:45',
      end_time: '19:45',
    }));

    this.shiftsApi.createScheduleRequest({
      shift_pattern: 'custom',
      pattern_start_date: requestedShifts[0].date,
      requested_shifts: requestedShifts,
    }).subscribe({
      next: () => {
        this.pendingDays.set([]);
        this.submitting.set(false);
        this.requestSent.set(true);
        setTimeout(() => this.requestSent.set(false), 3000);
      },
      error: () => {
        this.submitting.set(false);
      },
    });
  }

  upsellWord(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'допродаж';
    if (mod10 === 1) return 'допродажа';
    if (mod10 >= 2 && mod10 <= 4) return 'допродажи';
    return 'допродаж';
  }

  paymentsWord(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'оплат';
    if (mod10 === 1) return 'оплата';
    if (mod10 >= 2 && mod10 <= 4) return 'оплаты';
    return 'оплат';
  }

  invoicesWord(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'счетов';
    if (mod10 === 1) return 'счет';
    if (mod10 >= 2 && mod10 <= 4) return 'счета';
    return 'счетов';
  }

  shiftsWord(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'смен';
    if (mod10 === 1) return 'смена';
    if (mod10 >= 2 && mod10 <= 4) return 'смены';
    return 'смен';
  }

  cellTooltip(cell: CalendarDay): string {
    if (!cell.shift) return '';
    const s = cell.shift;
    const time = `${s.start_time?.slice(0, 5)}–${s.end_time?.slice(0, 5)}`;
    const studio = s.studio_name || '';
    return `${time} · ${studio} · ${this.shiftStatusLabel(s.status)}`;
  }

  studioInitial(s: EmployeeShift): string {
    if (s.location_code === 'barrikadnaya' || s.location_code === 'barrikadnaya-4') return 'Б';
    if (s.location_code === 'soborny') return 'С';
    return '';
  }

  actionIcon(actionType: string): string {
    return ACTION_ICONS[actionType] || 'star_half';
  }

  feedDescription(entry: XpLogEntry): string {
    if (entry.description) {
      const achMatch = entry.description.match(/^Ачивка:\s*(\S+)$/);
      if (achMatch) {
        const label = ACHIEVEMENT_LABELS[achMatch[1]];
        return label ? `Ачивка: ${label}` : entry.description;
      }
      return entry.description;
    }
    return ACTION_TYPE_LABELS[entry.action_type] || entry.action_type;
  }

  relativeTime(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'вчера';
    if (days < 7) return `${days} дн назад`;
    return new Date(isoDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  questProgress(q: { progress: number; target: number }): number {
    return Math.min(100, Math.round((q.progress / q.target) * 100));
  }

  daysWord(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'дней';
    if (mod10 === 1) return 'день';
    if (mod10 >= 2 && mod10 <= 4) return 'дня';
    return 'дней';
  }

  dismissBriefing(): void {
    this.briefingDismissed.set(true);
    const key = `epd-briefing-${new Date().toISOString().split('T')[0]}`;
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, '1');
  }

  dismissEveningSummary(): void {
    this.eveningDismissed.set(true);
    const key = `epd-evening-${new Date().toISOString().split('T')[0]}`;
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, '1');
  }

  private shiftStatusLabel(status: string): string {
    switch (status) {
      case 'completed': return 'Завершена';
      case 'active': return 'Активна';
      case 'scheduled': return 'Запланирована';
      case 'cancelled': return 'Отменена';
      default: return status;
    }
  }

  private localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private loadCalendarData(): void {
    const d = this.selectedMonth();
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0);
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    this.shiftsApi.getMyShifts(firstDay, lastDayStr).subscribe({
      next: (res) => {
        if (res.success && res.data) this.calendarShifts.set(res.data);
      },
    });

    this.shiftsApi.getMyEarnings(monthStr).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.earnings.set(res.data);
        }
      },
    });

    this.upsellApi.getMyStats(monthStr).subscribe({
      next: (res) => {
        if (res.success && res.data) this.upsellStats.set(res.data);
      },
    });
  }

  private loadSalesDashboard(): void {
    this.salesApi.getDashboard().subscribe({
      next: (dashboard) => {
        if (dashboard) {
          this.salesDashboard.set(dashboard);
        }
      },
    });
  }
}
