import { Component, inject, signal, computed, effect, ChangeDetectionStrategy, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { ShiftsApiService, EmployeeShift } from '../../services/shifts-api.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import {
  WorkdayCashCountDialogComponent,
  type WorkdayCashCountDialogData,
  type WorkdayCashCountDialogResult,
} from '../workday-cash-count-dialog/workday-cash-count-dialog.component';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const DAY_NAMES_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const DAY_NAMES_FULL = [
  'Воскресенье', 'Понедельник', 'Вторник', 'Среда',
  'Четверг', 'Пятница', 'Суббота',
];

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

@Component({
  selector: 'app-my-shifts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <!-- Header: month navigation + stats -->
    <div class="header glass-card">
      <div class="month-nav">
        <button mat-icon-button (click)="prevMonth()" matTooltip="Предыдущий месяц">
          <mat-icon>chevron_left</mat-icon>
        </button>
        <span class="month-title">{{ monthLabel() }}</span>
        <button mat-icon-button (click)="nextMonth()" matTooltip="Следующий месяц">
          <mat-icon>chevron_right</mat-icon>
        </button>
        <button mat-stroked-button class="today-btn" (click)="goToday()">Сегодня</button>
      </div>
      <div class="stats-row">
        <div class="stat-item">
          <mat-icon>event</mat-icon>
          <span class="stat-value">{{ stats().total }}</span>
          <span class="stat-label">смен</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <mat-icon>check_circle</mat-icon>
          <span class="stat-value completed">{{ stats().completed }}</span>
          <span class="stat-label">завершено</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <mat-icon>schedule</mat-icon>
          <span class="stat-value">{{ stats().hours }}</span>
          <span class="stat-label">часов</span>
        </div>
        @if (stats().earnings > 0) {
          <div class="stat-divider"></div>
          <div class="stat-item">
            <mat-icon>payments</mat-icon>
            <span class="stat-value earnings">{{ stats().earnings | number:'1.0-0' }} \u20BD</span>
            <span class="stat-label">выручка</span>
          </div>
        }
      </div>
    </div>

    <!-- Status filter -->
    <div class="status-filter">
      <button class="filter-chip" [class.active]="statusFilter() === 'all'" (click)="statusFilter.set('all')">Все</button>
      <button class="filter-chip" [class.active]="statusFilter() === 'scheduled'" (click)="statusFilter.set('scheduled')">Не начатые</button>
      <button class="filter-chip" [class.active]="statusFilter() === 'active'" (click)="statusFilter.set('active')">В работе</button>
      <button class="filter-chip" [class.active]="statusFilter() === 'completed'" (click)="statusFilter.set('completed')">Завершённые</button>
    </div>

    <!-- Today's shift -->
    @if (todayShift(); as ts) {
      <div
        class="today-card glass-card"
        [class.active]="ts.status === 'active'"
        [class.virtual]="isVirtualShift(ts)"
      >
        <div class="today-header">
          <span class="status-dot" [class.active]="ts.status === 'active'"></span>
          <span class="today-title">
            {{ ts.status === 'active' ? 'Рабочий день активен' : 'Рабочий день не начат' }}
          </span>
          <span class="today-studio">
            <mat-icon>{{ isVirtualShift(ts) ? 'desktop_windows' : 'store' }}</mat-icon>
            {{ isVirtualShift(ts) ? 'Пульт' : (ts.studio_name || 'Студия') }}
          </span>
        </div>
        <div class="today-body">
          <div class="today-time">
            <mat-icon>access_time</mat-icon>
            <span>{{ ts.start_time.slice(0, 5) }} — {{ ts.end_time.slice(0, 5) }}</span>
          </div>
          @if (ts.checked_in_at) {
            <div class="today-checkin">
              <mat-icon>login</mat-icon>
              <span>Начата в {{ formatTime(ts.checked_in_at) }}</span>
            </div>
          }
          @if (ts.checked_out_at) {
            <div class="today-checkin">
              <mat-icon>logout</mat-icon>
              <span>Завершена в {{ formatTime(ts.checked_out_at) }}</span>
            </div>
          }
          @if (onlineEarnings(); as oe) {
            <div class="today-earnings">
              <mat-icon>trending_up</mat-icon>
              <span>{{ oe.count }} заказов / {{ oe.amount | number:'1.0-0' }} \u20BD / {{ oe.commission | number:'1.0-0' }} \u20BD комиссия</span>
            </div>
          }
        </div>
        <div class="today-actions">
          @if (ts.status === 'scheduled' && !ts.checked_in_at) {
            <button mat-flat-button class="action-btn start" (click)="doCheckIn(ts.id)" [disabled]="actionLoading()">
              <mat-icon>play_arrow</mat-icon>
              Начать рабочий день
            </button>
          }
          @if (ts.status === 'active' && !ts.checked_out_at) {
            <button mat-stroked-button class="action-btn end" (click)="doCheckOut(ts.id)" [disabled]="actionLoading()">
              <mat-icon>logout</mat-icon>
              Завершить смену
            </button>
          }
        </div>
      </div>
    } @else if (isCurrentMonth() && !hasAnyTodayShift()) {
      <div class="today-card glass-card virtual-empty">
        <div class="today-header">
          <span class="status-dot"></span>
          <span class="today-title">Рабочий день не начат</span>
          <span class="today-studio">
            <mat-icon>desktop_windows</mat-icon>
            Пульт
          </span>
        </div>
        <div class="today-actions">
          <button mat-stroked-button class="action-btn workday-start" type="button" (click)="startWorkday()" [disabled]="actionLoading()">
            <mat-icon>play_arrow</mat-icon>
            Начать рабочий день
          </button>
        </div>
      </div>
    }

    <!-- Mini calendar -->
    <div class="calendar glass-card">
      <div class="cal-header">
        @for (d of dayNames; track d) {
          <span class="cal-day-name">{{ d }}</span>
        }
      </div>
      <div class="cal-grid">
        @for (cell of calendarCells(); track $index) {
          @if (cell.day === 0) {
            <span class="cal-cell empty"></span>
          } @else {
            <button
              class="cal-cell"
              [class.has-shift]="cell.hasShift"
              [class.today]="cell.isToday"
              [class.active-shift]="cell.isActive"
              (click)="scrollToDate(cell.dateStr)"
              [matTooltip]="cell.tooltip"
            >
              {{ cell.day }}
            </button>
          }
        }
      </div>
    </div>

    <!-- Shift list -->
    <div class="shifts-list">
      @if (loading()) {
        <div class="loading-state glass-card">
          <mat-icon>hourglass_empty</mat-icon>
          <span>Загрузка смен...</span>
        </div>
      } @else if (filteredShifts().length === 0) {
        <div class="empty-state glass-card">
          <mat-icon>event_busy</mat-icon>
          <span>Нет смен за этот месяц</span>
        </div>
      } @else {
        @for (shift of filteredShifts(); track shift.id) {
          <div
            class="shift-row glass-card"
            [attr.data-date]="shift.shift_date"
            [class.active]="shift.status === 'active'"
            [class.virtual]="isVirtualShift(shift)"
          >
            <div class="shift-date-col">
              <span class="shift-day-num">{{ extractDay(shift.shift_date) }}</span>
              <span class="shift-day-name">{{ dayOfWeek(shift.shift_date) }}</span>
            </div>
            <div class="shift-info-col">
              <div class="shift-studio-line">
                <mat-icon>{{ isVirtualShift(shift) ? 'desktop_windows' : 'store' }}</mat-icon>
                <span>{{ isVirtualShift(shift) ? 'Пульт' : (shift.studio_name || 'Студия') }}</span>
              </div>
              <div class="shift-time-line">
                <mat-icon>access_time</mat-icon>
                <span>{{ shift.start_time.slice(0, 5) }} — {{ shift.end_time.slice(0, 5) }}</span>
              </div>
              @if (shift.checked_in_at || shift.checked_out_at) {
                <div class="shift-checks">
                  @if (shift.checked_in_at) {
                    <span class="check-tag in">
                      <mat-icon>login</mat-icon> {{ formatTime(shift.checked_in_at) }}
                    </span>
                  }
                  @if (shift.checked_out_at) {
                    <span class="check-tag out">
                      <mat-icon>logout</mat-icon> {{ formatTime(shift.checked_out_at) }}
                    </span>
                  }
                </div>
              }
            </div>
            <div class="shift-meta-col">
              <span class="status-chip" [class]="shift.status">
                {{ statusLabel(shift.status) }}
              </span>
              @if (shift.online_earnings > 0) {
                <span class="earnings-tag">
                  <mat-icon>payments</mat-icon>
                  {{ shift.online_earnings | number:'1.0-0' }} \u20BD
                </span>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
      box-sizing: border-box;
    }

    .glass-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
    }

    /* === Header === */
    .header {
      padding: 14px 16px;
    }

    .month-nav {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .month-title {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 20px;
      font-weight: 500;
      color: var(--crm-text-primary);
      letter-spacing: -0.01em;
      min-width: 180px;
      text-align: center;
    }

    .today-btn {
      margin-left: auto;
      font-size: 11px;
      height: 28px;
      padding: 0 12px;
    }

    .stats-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--crm-border);
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 6px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-text-muted);
      }
    }

    .stat-value {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 18px;
      font-weight: 500;
      color: var(--crm-text-primary);
      line-height: 1;

      &.completed { color: var(--crm-status-success); }
      &.earnings { color: var(--crm-status-success); }
    }

    .stat-label {
      font-size: 11px;
      color: var(--crm-text-muted);
    }

    .stat-divider {
      width: 1px;
      height: 24px;
      background: var(--crm-border);
      flex-shrink: 0;
    }

    /* === Today's shift === */
    .today-card {
      padding: 14px 16px;

      &.active {
        border-color: rgba(52, 211, 153, 0.3);
        background: linear-gradient(135deg, rgba(52, 211, 153, 0.06) 0%, var(--crm-gradient-card));
      }

      &.virtual,
      &.virtual-empty {
        border-color: rgba(96, 165, 250, 0.3);
        background: linear-gradient(135deg, rgba(96, 165, 250, 0.06) 0%, var(--crm-gradient-card));
      }
    }

    .today-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crm-border);
      flex-shrink: 0;

      &.active {
        background: var(--crm-status-success);
        box-shadow: 0 0 6px rgba(52, 211, 153, 0.6);
        animation: statusPulse 2s ease-in-out infinite;
      }
    }

    @keyframes statusPulse {
      0%, 100% { box-shadow: 0 0 6px rgba(52, 211, 153, 0.6); }
      50% { box-shadow: 0 0 10px rgba(52, 211, 153, 0.8); }
    }

    .today-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-primary);
    }

    .today-studio {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      color: var(--crm-text-muted);
      margin-left: auto;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .today-body {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--crm-border);
    }

    .today-time, .today-checkin, .today-earnings {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--crm-text-muted);

      mat-icon { font-size: 15px; width: 15px; height: 15px; }
    }

    .today-earnings {
      color: var(--crm-status-success);
      font-weight: 500;
    }

    .today-actions {
      margin-top: 12px;
      display: flex;
      gap: 8px;
    }

    .action-btn {
      font-size: 12px;
      height: 32px;
      padding: 0 14px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }

      &.start { background: var(--crm-status-success); color: #fff; }
      &.end { color: var(--crm-status-error); border-color: var(--crm-status-error); }
      &.workday-start { color: rgb(96, 165, 250); border-color: rgba(96, 165, 250, 0.45); }
    }

    /* === Calendar === */
    .calendar {
      padding: 12px 14px;
    }

    .cal-header {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      margin-bottom: 4px;
    }

    .cal-day-name {
      text-align: center;
      font-size: 10px;
      font-weight: 600;
      color: var(--crm-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }

    .cal-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      aspect-ratio: 1;
      font-size: 12px;
      border-radius: var(--crm-radius-sm);
      color: var(--crm-text-muted);
      cursor: default;
      transition: background var(--crm-transition-fast);

      &.empty { visibility: hidden; }

      &.has-shift {
        background: rgba(52, 211, 153, 0.12);
        color: var(--crm-status-success);
        font-weight: 600;
        cursor: pointer;

        &:hover { background: rgba(52, 211, 153, 0.22); }
      }

      &.active-shift {
        background: rgba(52, 211, 153, 0.25);
        box-shadow: inset 0 0 0 1.5px var(--crm-status-success);
      }

      &.today {
        box-shadow: inset 0 0 0 1.5px var(--crm-accent);
        color: var(--crm-accent);
        font-weight: 700;
      }

      &.today.has-shift {
        box-shadow: inset 0 0 0 1.5px var(--crm-status-success);
        color: var(--crm-status-success);
      }
    }

    /* === Shift list === */
    .shifts-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .loading-state, .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px;
      color: var(--crm-text-muted);
      font-size: 13px;

      mat-icon { font-size: 20px; width: 20px; height: 20px; opacity: 0.5; }
    }

    .shift-row {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 10px 14px;
      transition: border-color var(--crm-transition-fast);

      &.active {
        border-color: rgba(52, 211, 153, 0.3);
      }

      &.virtual {
        border-color: rgba(96, 165, 250, 0.25);
      }
    }

    .shift-date-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 42px;
      flex-shrink: 0;
    }

    .shift-day-num {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 22px;
      font-weight: 500;
      color: var(--crm-text-primary);
      line-height: 1;
    }

    .shift-day-name {
      font-size: 10px;
      font-weight: 500;
      color: var(--crm-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .shift-info-col {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      min-width: 0;
    }

    .shift-studio-line, .shift-time-line {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--crm-text-muted);

      mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; }
    }

    .shift-studio-line {
      color: var(--crm-text-primary);
      font-weight: 500;
    }

    .shift-checks {
      display: flex;
      gap: 8px;
      margin-top: 2px;
    }

    .check-tag {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 10px;
      color: var(--crm-text-muted);

      mat-icon { font-size: 12px; width: 12px; height: 12px; }

      &.in { color: var(--crm-status-success); }
      &.out { color: var(--crm-text-muted); }
    }

    .shift-meta-col {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      flex-shrink: 0;
    }

    .status-chip {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 8px;
      border-radius: 10px;
      white-space: nowrap;

      &.scheduled {
        background: rgba(96, 165, 250, 0.12);
        color: rgb(96, 165, 250);
      }
      &.active {
        background: rgba(52, 211, 153, 0.12);
        color: var(--crm-status-success);
      }
      &.completed {
        background: rgba(148, 163, 184, 0.12);
        color: var(--crm-text-muted);
      }
      &.cancelled {
        background: rgba(239, 68, 68, 0.1);
        color: var(--crm-status-error);
      }
    }

    .earnings-tag {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      font-weight: 600;
      color: var(--crm-status-success);

      mat-icon { font-size: 13px; width: 13px; height: 13px; }
    }

    /* === Status filter === */
    .status-filter {
      display: flex;
      gap: 6px;
      padding: 8px 0;
      flex-wrap: wrap;
    }

    .filter-chip {
      font-size: 11px;
      font-weight: 500;
      padding: 4px 12px;
      border-radius: 12px;
      border: 1px solid var(--crm-border);
      background: transparent;
      color: var(--crm-text-muted);
      cursor: pointer;
      transition: all var(--crm-transition-fast);
      font-family: inherit;
    }

    .filter-chip.active {
      background: rgba(245, 158, 11, 0.12);
      color: var(--crm-accent);
      border-color: var(--crm-accent);
    }

    .filter-chip:hover:not(.active) {
      background: rgba(255, 255, 255, 0.04);
    }
  `],
})
export class MyShiftsComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly ws = inject(WebSocketService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private earningsInterval: ReturnType<typeof setInterval> | null = null;

  readonly dayNames = DAY_NAMES_SHORT;

  readonly currentMonth = signal(new Date().getMonth());
  readonly currentYear = signal(new Date().getFullYear());
  readonly shifts = signal<EmployeeShift[]>([]);
  readonly loading = signal(false);
  readonly actionLoading = signal(false);
  readonly onlineEarnings = signal<{ count: number; amount: number; commission: number } | null>(null);
  readonly statusFilter = signal<string>('all');

  readonly monthLabel = computed(() => {
    return `${MONTH_NAMES[this.currentMonth()]} ${this.currentYear()}`;
  });

  readonly todayStr = computed(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  readonly isCurrentMonth = computed(() => {
    const d = new Date();
    return this.currentYear() === d.getFullYear() && this.currentMonth() === d.getMonth();
  });

  readonly hasAnyTodayShift = computed(() => {
    const today = this.todayStr();
    return this.shifts().some(s => s.shift_date === today);
  });

  readonly todayShift = computed(() => {
    const today = this.todayStr();
    return this.shifts().find(s => s.shift_date === today && (s.status === 'scheduled' || s.status === 'active')) ?? null;
  });

  readonly sortedShifts = computed(() => {
    return [...this.shifts()].sort((a, b) => b.shift_date.localeCompare(a.shift_date));
  });

  readonly filteredShifts = computed(() => {
    const filter = this.statusFilter();
    const sorted = this.sortedShifts();
    if (filter === 'all') return sorted;
    return sorted.filter(s => s.status === filter);
  });

  readonly stats = computed(() => {
    const all = this.shifts();
    const completed = all.filter(s => s.status === 'completed').length;
    let hours = 0;
    let earnings = 0;
    for (const s of all) {
      if (s.start_time && s.end_time) {
        const [sh, sm] = s.start_time.split(':').map(Number);
        const [eh, em] = s.end_time.split(':').map(Number);
        hours += (eh * 60 + em - sh * 60 - sm) / 60;
      }
      earnings += s.online_earnings || 0;
    }
    return { total: all.length, completed, hours: Math.round(hours), earnings };
  });

  readonly calendarCells = computed(() => {
    const year = this.currentYear();
    const month = this.currentMonth();
    const firstDay = new Date(year, month, 1);
    // Monday-based: 0=Mon, 6=Sun
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = this.todayStr();
    const shiftDates = new Set(this.shifts().map(s => s.shift_date));
    const activeDates = new Set(this.shifts().filter(s => s.status === 'active').map(s => s.shift_date));

    const cells: { day: number; hasShift: boolean; isToday: boolean; isActive: boolean; dateStr: string; tooltip: string }[] = [];

    for (let i = 0; i < startDow; i++) {
      cells.push({ day: 0, hasShift: false, isToday: false, isActive: false, dateStr: '', tooltip: '' });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hasShift = shiftDates.has(dateStr);
      const shift = hasShift ? this.shifts().find(s => s.shift_date === dateStr) : null;
      const location = shift && this.isVirtualShift(shift) ? 'Пульт' : shift?.studio_name || '';
      const tooltip = shift ? `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)} ${location}` : '';
      cells.push({
        day: d,
        hasShift,
        isToday: dateStr === today,
        isActive: activeDates.has(dateStr),
        dateStr,
        tooltip,
      });
    }

    return cells;
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadShifts();
      this.destroyRef.onDestroy(() => this.stopEarningsPolling());

      effect(() => {
        const evt = this.ws.shiftEvent();
        if (!evt || evt.event !== 'shift:earnings-update') return;
        const activeShift = this.todayShift();
        if (activeShift && evt.data.shiftId === activeShift.id) {
          this.onlineEarnings.set({
            count: evt.data.online_count,
            amount: evt.data.online_earnings,
            commission: evt.data.commission,
          });
          this.shifts.update(list => list.map(s =>
            s.id === activeShift.id
              ? { ...s, online_earnings: evt.data.online_earnings, online_count: evt.data.online_count }
              : s
          ));
        }
      });
    }
  }

  prevMonth(): void {
    if (this.currentMonth() === 0) {
      this.currentMonth.set(11);
      this.currentYear.update(y => y - 1);
    } else {
      this.currentMonth.update(m => m - 1);
    }
    this.loadShifts();
  }

  nextMonth(): void {
    if (this.currentMonth() === 11) {
      this.currentMonth.set(0);
      this.currentYear.update(y => y + 1);
    } else {
      this.currentMonth.update(m => m + 1);
    }
    this.loadShifts();
  }

  goToday(): void {
    const now = new Date();
    this.currentMonth.set(now.getMonth());
    this.currentYear.set(now.getFullYear());
    this.loadShifts();
  }

  scrollToDate(dateStr: string): void {
    const el = document.querySelector(`.shift-row[data-date="${dateStr}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  doCheckIn(shiftId: string): void {
    const shift = this.shiftById(shiftId);
    this.requestCashCount('open', shift, (cashAtOpen) => {
      this.actionLoading.set(true);
      this.shiftsApi.checkIn(shiftId, cashAtOpen).subscribe({
        next: (res) => {
          if (res.data) {
            this.shifts.update(list => list.map(s => s.id === shiftId ? { ...s, ...res.data!, status: 'active' as const } : s));
            this.startEarningsPolling(shiftId);
          }
          this.actionLoading.set(false);
        },
        error: () => this.actionLoading.set(false),
      });
    });
  }

  startWorkday(): void {
    this.requestCashCount('open', null, (cashAtOpen) => {
      this.actionLoading.set(true);
      this.shiftsApi.startWorkday(undefined, false, cashAtOpen).subscribe({
        next: (res) => {
          if (res.data) {
            this.upsertShift(res.data);
            if (res.data.status === 'active') {
              this.startEarningsPolling(res.data.id);
            }
          }
          this.actionLoading.set(false);
        },
        error: () => this.actionLoading.set(false),
      });
    });
  }

  doCheckOut(shiftId: string): void {
    const shift = this.shiftById(shiftId);
    this.requestCashCount('close', shift, (cashAtClose) => {
      this.actionLoading.set(true);
      this.shiftsApi.checkOut(shiftId, cashAtClose).subscribe({
        next: (res) => {
          this.actionLoading.set(false);
          if (res.data) {
            this.shifts.update(list => list.map(s => s.id === shiftId ? { ...s, ...res.data!, status: 'completed' as const } : s));
            this.stopEarningsPolling();
            this.onlineEarnings.set(null);

            this.showCheckoutSummary(res.data);
          }
        },
        error: () => this.actionLoading.set(false),
      });
    });
  }

  formatTime(iso: string | null | undefined): string {
    return formatTime(iso);
  }

  extractDay(dateStr: string): string {
    return String(parseInt(dateStr.split('-')[2], 10));
  }

  dayOfWeek(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return DAY_NAMES_FULL[d.getDay()].slice(0, 2);
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'scheduled': return 'Не начат';
      case 'active': return 'В работе';
      case 'completed': return 'Готово';
      case 'cancelled': return 'Отменена';
      default: return status;
    }
  }

  isVirtualShift(shift: Pick<EmployeeShift, 'shift_kind' | 'is_virtual'>): boolean {
    return shift.is_virtual === true || shift.shift_kind === 'virtual';
  }

  private shiftById(shiftId: string): EmployeeShift | null {
    return this.shifts().find(shift => shift.id === shiftId) ?? null;
  }

  private requestCashCount(
    mode: WorkdayCashCountDialogData['mode'],
    shift: EmployeeShift | null,
    onAmount: (amount: number) => void,
  ): void {
    const dialogRef = this.dialog.open<
      WorkdayCashCountDialogComponent,
      WorkdayCashCountDialogData,
      WorkdayCashCountDialogResult
    >(WorkdayCashCountDialogComponent, {
      data: {
        mode,
        studioName: shift ? this.cashDialogStudioName(shift) : null,
        initialAmount: mode === 'open' ? shift?.cash_at_open ?? null : shift?.cash_at_close ?? null,
      },
      width: '440px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: false,
      restoreFocus: false,
      panelClass: ['crm-dialog', 'workday-cash-count-dialog-panel'],
    });

    dialogRef.afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) return;
        onAmount(result.amount);
      });
  }

  private cashDialogStudioName(shift: EmployeeShift): string {
    return this.isVirtualShift(shift) ? 'Пульт' : shift.studio_name || 'Студия';
  }

  private loadShifts(): void {
    const year = this.currentYear();
    const month = this.currentMonth();
    const dateFrom = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dateTo = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    this.loading.set(true);
    this.shiftsApi.getMyShifts(dateFrom, dateTo).subscribe({
      next: (res) => {
        this.shifts.set(res.data ?? []);
        this.loading.set(false);

        const active = (res.data ?? []).find(s => s.status === 'active');
        if (active) {
          this.startEarningsPolling(active.id);
        } else {
          this.stopEarningsPolling();
          this.onlineEarnings.set(null);
        }
      },
      error: () => {
        this.shifts.set([]);
        this.loading.set(false);
      },
    });
  }

  private startEarningsPolling(shiftId: string): void {
    this.stopEarningsPolling();
    this.loadOnlineEarnings(shiftId);
    this.earningsInterval = setInterval(() => this.loadOnlineEarnings(shiftId), 60_000);
  }

  private stopEarningsPolling(): void {
    if (this.earningsInterval) {
      clearInterval(this.earningsInterval);
      this.earningsInterval = null;
    }
  }

  private loadOnlineEarnings(shiftId: string): void {
    this.shiftsApi.getOnlineEarnings(shiftId).subscribe({
      next: (res) => this.onlineEarnings.set(res.data ?? null),
      error: () => this.onlineEarnings.set(null),
    });
  }

  private upsertShift(shift: EmployeeShift): void {
    this.shifts.update(list => {
      const exists = list.some(s => s.id === shift.id);
      if (exists) {
        return list.map(s => s.id === shift.id ? shift : s);
      }
      return [shift, ...list];
    });
  }

  private showCheckoutSummary(shiftData: EmployeeShift): void {
    const summary = extractCheckoutSummary(shiftData);
    if (!summary) return;
    import('../checkout-summary-dialog/checkout-summary-dialog.component').then(m => {
      this.dialog.open(m.CheckoutSummaryDialogComponent, {
        data: {
          shift: shiftData,
          hours_worked: summary.hours_worked ?? 0,
          pos_sales: summary.pos_sales ?? { count: 0, total: 0 },
          online_sales: summary.online_sales ?? { count: 0, total: 0, commission: 0 },
          total_commission: summary.total_commission ?? 0,
          total_revenue: summary.total_revenue ?? 0,
        },
        width: '480px',
        panelClass: 'crm-dialog',
      });
    });
  }
}

interface CheckoutSummaryPayload {
  hours_worked?: number;
  pos_sales?: { count: number; total: number };
  online_sales?: { count: number; total: number; commission: number };
  total_commission?: number;
  total_revenue?: number;
}

function extractCheckoutSummary(data: object): CheckoutSummaryPayload | null {
  if (!('checkout_summary' in data)) return null;
  const val = Object.getOwnPropertyDescriptor(data, 'checkout_summary')?.value;
  return typeof val === 'object' && val !== null ? val : null;
}
