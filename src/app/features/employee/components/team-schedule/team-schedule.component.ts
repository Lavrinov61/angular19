import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  OnInit, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  ShiftsApiService,
  EmployeeShift,
  ScheduleRequest,
  ScheduleRequestedShift,
  ShiftStudio,
} from '../../services/shifts-api.service';
import { UsersApiService, StaffUser, UserRole } from '../../services/users-api.service';
import { forkJoin } from 'rxjs';
import {
  ScheduleLayout,
  filterShiftsByStudio,
  groupShiftsByStudioDate,
  isRequestedWorkShiftCovered,
  scheduleRequestShiftAction,
  visibleStudioRows,
} from './team-schedule.utils';

// ─── Local interfaces ───────────────────────────────────────

interface DayColumn {
  day: number;
  dateStr: string;        // YYYY-MM-DD
  dayOfWeek: string;      // пн, вт, ср...
  isWeekend: boolean;
  isToday: boolean;
}

type ShiftStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';
type PatternType = '2/2' | '1/1' | '3/3' | '5/2';
type PatternSubmitMode = 'direct' | 'proposal';
type RequestActionMode = 'approve' | 'reject' | 'revision';
type ScheduleRequestAction = NonNullable<ScheduleRequestedShift['action']>;

interface PatternFormData {
  employee_id: string;
  pattern: PatternType;
  start_date: string;
  end_date: string;
  studio_id: string;
  start_time: string;
  end_time: string;
}

interface RequestCellEntry {
  request: ScheduleRequest;
  shift: ScheduleRequestedShift;
}

interface RequestLocationGroup {
  key: string;
  label: string;
  datesLabel: string;
  count: number;
}

// ─── Date helpers (no external libs) ────────────────────────

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const;

function getDayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES[d.getDay()];
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function isToday(dateStr: string): boolean {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Pattern generation ─────────────────────────────────────

function generateShiftsFromPattern(
  pattern: PatternType,
  startDate: string,
  endDate: string,
  employeeId: string,
  studioId: string,
  startTime: string,
  endTime: string,
): Partial<EmployeeShift>[] {
  // 5/2: weekdays only (Mon-Fri)
  if (pattern === '5/2') {
    const shifts: Partial<EmployeeShift>[] = [];
    const cursor = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (cursor <= end) {
      const dow = cursor.getDay();
      if (dow >= 1 && dow <= 5) {
        shifts.push({
          employee_id: employeeId,
          studio_id: studioId,
          shift_date: toYMD(cursor),
          start_time: startTime,
          end_time: endTime,
          status: 'scheduled',
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return shifts;
  }

  const patterns: Record<string, { work: number; rest: number }> = {
    '2/2': { work: 2, rest: 2 },
    '1/1': { work: 1, rest: 1 },
    '3/3': { work: 3, rest: 3 },
  };
  const p = patterns[pattern];
  const cycle = p.work + p.rest;
  const shifts: Partial<EmployeeShift>[] = [];
  const cursor = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  let dayOffset = 0;

  while (cursor <= end) {
    if ((dayOffset % cycle) < p.work) {
      shifts.push({
        employee_id: employeeId,
        studio_id: studioId,
        shift_date: toYMD(cursor),
        start_time: startTime,
        end_time: endTime,
        status: 'scheduled',
      });
    }
    cursor.setDate(cursor.getDate() + 1);
    dayOffset++;
  }
  return shifts;
}

// ─── Role helpers ───────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  admin: 'Адм',
  manager: 'Мен',
  employee: 'Сотр',
  photographer: 'Фот',
  client: 'Кл',
};

const ROLE_COLORS: Record<string, string> = {
  admin: '#7c3aed',
  manager: '#0ea5e9',
  employee: '#10b981',
  photographer: '#f59e0b',
  client: '#6b7280',
};

const SCHEDULE_USER_ROLES: readonly UserRole[] = ['admin', 'manager', 'employee', 'photographer'];

function canAppearInSchedule(user: StaffUser): boolean {
  return SCHEDULE_USER_ROLES.includes(user.role);
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;

const STATUS_LABELS: Record<ShiftStatus, string> = {
  scheduled: 'Запланирована',
  active: 'Активна',
  completed: 'Завершена',
  cancelled: 'Отменена',
};

const REQUEST_STATUS_LABELS: Record<ScheduleRequest['status'], string> = {
  pending: 'На рассмотрении',
  approved: 'Утверждён',
  rejected: 'Отклонён',
  revision_requested: 'Доработка',
};

const REQUEST_STATUS_ICONS: Record<ScheduleRequest['status'], string> = {
  pending: 'hourglass_empty',
  approved: 'check_circle',
  rejected: 'cancel',
  revision_requested: 'edit_note',
};

const REQUEST_ACTION_LABELS: Record<ScheduleRequestAction, string> = {
  work: 'Новая смена',
  change_address: 'Смена адреса',
  cancel_shift: 'Отмена смены',
};

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

// ─── Component ──────────────────────────────────────────────

@Component({
  selector: 'app-team-schedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  host: { class: 'team-schedule-host' },
  template: `
<div class="ts-page">

  <!-- ═══ HEADER ════════════════════════════════════════════ -->
  <header class="ts-header glass-card">
    <div class="ts-header-left">
      <mat-icon class="ts-header-icon">calendar_month</mat-icon>
      <h1 class="ts-title">Расписание команды</h1>
    </div>

    <div class="ts-header-controls">
      <!-- View mode toggle -->
      <div class="ts-view-toggle">
        <button mat-icon-button [class.active]="viewMode() === 'month'" (click)="viewMode.set('month')" matTooltip="Месяц">
          <mat-icon>calendar_month</mat-icon>
        </button>
        <button mat-icon-button [class.active]="viewMode() === 'week'" (click)="viewMode.set('week')" matTooltip="Неделя">
          <mat-icon>view_week</mat-icon>
        </button>
      </div>

      <!-- Schedule layout toggle -->
      <div class="ts-layout-toggle" role="group" aria-label="Группировка расписания">
        <button type="button"
                class="ts-layout-toggle__btn"
                [class.ts-layout-toggle__btn--active]="scheduleLayout() === 'employees'"
                (click)="setScheduleLayout('employees')"
                matTooltip="Строки сотрудников">
          <mat-icon>groups</mat-icon>
          <span>Сотрудники</span>
        </button>
        <button type="button"
                class="ts-layout-toggle__btn"
                [class.ts-layout-toggle__btn--active]="scheduleLayout() === 'studios'"
                (click)="setScheduleLayout('studios')"
                matTooltip="Строки студий">
          <mat-icon>storefront</mat-icon>
          <span>Студии</span>
        </button>
      </div>

      <!-- Studio filter -->
      <mat-form-field appearance="outline" class="ts-studio-filter" subscriptSizing="dynamic">
        <mat-label>Студия</mat-label>
        <mat-select [(ngModel)]="studioFilter" (ngModelChange)="onStudioFilterChange()">
          <mat-option value="all">Все студии</mat-option>
          @for (s of studios(); track s.id) {
            <mat-option [value]="s.id">{{ s.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <button class="ts-btn" [class.ts-btn--active]="showRequests()" (click)="toggleRequests()">
        <mat-icon>event_available</mat-icon>
        Заявки
        @if (openRequestsCount() > 0) {
          <span class="ts-btn-badge">{{ openRequestsCount() }}</span>
        }
      </button>
      <button class="ts-btn" (click)="togglePatternForm('proposal')">
        <mat-icon>outgoing_mail</mat-icon>
        Предложить
      </button>
      <button class="ts-btn ts-btn--accent" (click)="togglePatternForm('direct')">
        <mat-icon>date_range</mat-icon>
        Назначить паттерн
      </button>
    </div>
  </header>

  <!-- ═══ MONTH NAVIGATOR ═══════════════════════════════════ -->
  @if (viewMode() === 'month') {
    <div class="ts-month-nav glass-card">
      <button class="ts-nav-btn" (click)="prevMonth()" matTooltip="Предыдущий месяц">
        <mat-icon>chevron_left</mat-icon>
      </button>
      <span class="ts-month-label">{{ monthLabel() }}</span>
      <button class="ts-nav-btn" (click)="nextMonth()" matTooltip="Следующий месяц">
        <mat-icon>chevron_right</mat-icon>
      </button>
      <button class="ts-nav-today" (click)="goToToday()" matTooltip="Вернуться к текущему месяцу">
        <mat-icon>today</mat-icon>
        Сегодня
      </button>
    </div>
  }

  <!-- ═══ WEEK NAVIGATOR ═══════════════════════════════════ -->
  @if (viewMode() === 'week') {
    <div class="ts-month-nav glass-card">
      <button class="ts-nav-btn" (click)="prevWeek()" matTooltip="Предыдущая неделя">
        <mat-icon>chevron_left</mat-icon>
      </button>
      <span class="ts-month-label">{{ weekLabel() }}</span>
      <button class="ts-nav-btn" (click)="nextWeek()" matTooltip="Следующая неделя">
        <mat-icon>chevron_right</mat-icon>
      </button>
      <button class="ts-nav-today" (click)="goToCurrentWeek()" matTooltip="Текущая неделя">
        <mat-icon>today</mat-icon>
        Эта неделя
      </button>
    </div>
  }

  <!-- ═══ PATTERN FORM ══════════════════════════════════════ -->
  @if (showPatternForm()) {
    <div class="ts-pattern-form glass-card">
      <div class="ts-pattern-header">
        <div class="ts-pattern-title">
          <mat-icon>{{ patternSubmitMode() === 'proposal' ? 'outgoing_mail' : 'event_repeat' }}</mat-icon>
          <h2>{{ patternSubmitMode() === 'proposal' ? 'Предложить смены' : 'Назначить паттерн' }}</h2>
        </div>
        <button class="ts-close-btn" (click)="showPatternForm.set(false)">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="ts-mode-toggle">
        <button type="button" class="ts-mode-toggle__btn"
                [class.ts-mode-toggle__btn--active]="patternSubmitMode() === 'proposal'"
                (click)="patternSubmitMode.set('proposal')">
          <mat-icon>outgoing_mail</mat-icon>
          Предложить
        </button>
        <button type="button" class="ts-mode-toggle__btn"
                [class.ts-mode-toggle__btn--active]="patternSubmitMode() === 'direct'"
                (click)="patternSubmitMode.set('direct')">
          <mat-icon>event_available</mat-icon>
          Назначить сразу
        </button>
      </div>

      <div class="ts-pattern-grid">
        <!-- Employee -->
        <mat-form-field appearance="outline">
          <mat-label>Сотрудник</mat-label>
          <mat-select [(ngModel)]="patternForm.employee_id">
            @for (emp of employees(); track emp.id) {
              <mat-option [value]="emp.id">{{ emp.display_name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <!-- Pattern -->
        <mat-form-field appearance="outline">
          <mat-label>Паттерн</mat-label>
          <mat-select [(ngModel)]="patternForm.pattern">
            <mat-option value="2/2">2/2 — два через два</mat-option>
            <mat-option value="1/1">1/1 — день через день</mat-option>
            <mat-option value="3/3">3/3 — три через три</mat-option>
            <mat-option value="5/2">5/2 — пн–пт (пятидневка)</mat-option>
          </mat-select>
        </mat-form-field>

        <!-- Studio -->
        <mat-form-field appearance="outline">
          <mat-label>Студия</mat-label>
          <mat-select [(ngModel)]="patternForm.studio_id">
            @for (s of studios(); track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <!-- Start date -->
        <mat-form-field appearance="outline">
          <mat-label>Начало</mat-label>
          <input matInput type="date" [(ngModel)]="patternForm.start_date">
        </mat-form-field>

        <!-- End date -->
        <mat-form-field appearance="outline">
          <mat-label>Конец</mat-label>
          <input matInput type="date" [(ngModel)]="patternForm.end_date" [min]="patternForm.start_date">
        </mat-form-field>

        <!-- Times -->
        <div class="ts-time-row">
          <mat-form-field appearance="outline">
            <mat-label>Начало смены</mat-label>
            <input matInput type="time" [(ngModel)]="patternForm.start_time">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Конец смены</mat-label>
            <input matInput type="time" [(ngModel)]="patternForm.end_time">
          </mat-form-field>
        </div>

        @if (patternSubmitMode() === 'proposal') {
          <mat-form-field appearance="outline" class="ts-form-full">
            <mat-label>Комментарий для сотрудника</mat-label>
            <textarea matInput [(ngModel)]="patternComment" rows="2"
                      placeholder="Например: нужны эти дни на выбранном адресе"></textarea>
          </mat-form-field>
        }
      </div>

      <!-- Pattern preview -->
      @if (patternPreview().length > 0) {
        <div class="ts-pattern-preview">
          <div class="ts-preview-header">
            <span class="ts-preview-label">Предпросмотр: {{ patternPreview().length }} смен</span>
          </div>
          <div class="ts-preview-days">
            @for (shift of patternPreview(); track shift.shift_date) {
              <span class="ts-preview-chip">
                {{ shift.shift_date!.slice(8) }}.{{ shift.shift_date!.slice(5, 7) }}
              </span>
            }
          </div>
        </div>
      }

      <div class="ts-pattern-actions">
        <button class="ts-btn" (click)="showPatternForm.set(false)">Отмена</button>
        <button class="ts-btn ts-btn--accent"
                [disabled]="!canSubmitPattern() || patternSaving()"
                (click)="submitPattern()">
          @if (patternSaving()) {
            <mat-spinner diameter="16"></mat-spinner>
          } @else {
            <mat-icon>check</mat-icon>
          }
          {{ patternSubmitMode() === 'proposal' ? 'Отправить предложение' : 'Создать смены' }}
        </button>
      </div>
    </div>
  }

  <!-- ═══ LOADING ═══════════════════════════════════════════ -->
  @if (loading()) {
    <div class="ts-loading glass-card">
      <mat-spinner diameter="32"></mat-spinner>
      <span>Загрузка расписания...</span>
    </div>
  }

  <!-- ═══ CALENDAR GRID ═════════════════════════════════════ -->
  @if (!loading()) {
    <div class="ts-grid-wrapper glass-card">
      <div class="ts-grid-scroll">
        <table class="ts-grid">
          <thead>
            <tr>
              <th class="ts-col-employee">{{ scheduleLayout() === 'studios' ? 'Студия' : 'Сотрудник' }}</th>
              @for (col of days(); track col.dateStr) {
                <th class="ts-col-day"
                    [class.ts-weekend]="col.isWeekend"
                    [class.ts-today]="col.isToday">
                  <span class="ts-day-num">{{ col.day }}</span>
                  <span class="ts-day-name">{{ col.dayOfWeek }}</span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @if (scheduleLayout() === 'employees') {
              @for (emp of filteredEmployees(); track emp.id) {
                <tr class="ts-row">
                  <td class="ts-col-employee">
                    <div class="ts-emp-cell">
                      <div class="ts-avatar" [style.background]="getRoleColor(emp.role)">
                        {{ getInitials(emp.display_name) }}
                      </div>
                      <div class="ts-emp-info">
                        <span class="ts-emp-name">{{ emp.display_name }}</span>
                        <span class="ts-emp-role" [style.color]="getRoleColor(emp.role)">{{ getRoleLabel(emp.role) }}</span>
                      </div>
                    </div>
                  </td>
                  @for (col of days(); track col.dateStr) {
                    @let shift = getShift(emp.id, col.dateStr);
                    @let requestEntries = getRequestEntries(emp.id, col.dateStr);
                    <td class="ts-cell"
                        [class.ts-weekend]="col.isWeekend"
                        [class.ts-today]="col.isToday"
                        (click)="onCellClick(emp, col, shift)">
                      <div class="ts-cell-stack">
                        @if (shift) {
                          <div class="ts-shift-chip"
                               [class.ts-shift--scheduled]="shift.status === 'scheduled'"
                               [class.ts-shift--active]="shift.status === 'active'"
                               [class.ts-shift--completed]="shift.status === 'completed'"
                               [class.ts-shift--cancelled]="shift.status === 'cancelled'"
                               [class.ts-shift--checked-in]="!!shift.checked_in_at"
                               [matTooltip]="shiftTooltip(shift)">
                            @if (shift.status === 'cancelled') {
                              <span class="ts-chip-text ts-chip-strikethrough">{{ shift.location_code || studioCode(shift.studio_id) }}</span>
                            } @else {
                              <span class="ts-chip-text">{{ shift.location_code || studioCode(shift.studio_id) }}</span>
                            }
                            @if (shift.status === 'active') {
                              <span class="ts-chip-pulse"></span>
                            }
                            @if (shift.online_count > 0) {
                              <span class="ts-chip-earnings" [matTooltip]="shift.online_earnings + ' ₽ онлайн'">₽</span>
                            }
                          </div>
                        }

                        @if (showRequests() && requestEntries.length > 0) {
                          <div class="ts-request-stack">
                            @for (entry of requestEntries.slice(0, 2); track entry.request.id + entry.shift.date) {
                              <button type="button"
                                      class="ts-request-chip"
                                      [class.ts-request-chip--proposal]="isAdminProposal(entry.request)"
                                      [class.ts-request-chip--revision]="entry.request.status === 'revision_requested'"
                                      [class.ts-request-chip--cancel]="requestShiftAction(entry.shift) === 'cancel_shift'"
                                      [class.ts-request-chip--change]="requestShiftAction(entry.shift) === 'change_address'"
                                      [matTooltip]="requestCellTooltip(entry)"
                                      (click)="openRequestPanel(entry.request, $event)">
                                {{ requestCellLabel(entry) }}
                              </button>
                            }
                            @if (requestEntries.length > 2) {
                              <button type="button"
                                      class="ts-request-chip ts-request-chip--more"
                                      (click)="openRequestPanel(requestEntries[0]!.request, $event)">
                                +{{ requestEntries.length - 2 }}
                              </button>
                            }
                          </div>
                        } @else if (!shift) {
                          <div class="ts-cell-empty">
                            <mat-icon class="ts-add-hint">add</mat-icon>
                          </div>
                        }
                      </div>
                    </td>
                  }
                </tr>
              }
            } @else {
              @for (studio of studioRows(); track studio.id) {
                <tr class="ts-row">
                  <td class="ts-col-employee">
                    <div class="ts-studio-cell" [matTooltip]="studioTooltip(studio)">
                      <div class="ts-studio-code">{{ studioAvatarLabel(studio) }}</div>
                      <div class="ts-emp-info">
                        <span class="ts-emp-name">{{ studio.name }}</span>
                        @if (studio.address) {
                          <span class="ts-emp-role ts-studio-address">{{ studio.address }}</span>
                        } @else {
                          <span class="ts-emp-role ts-studio-address">{{ studio.location_code || 'СТУДИЯ' }}</span>
                        }
                      </div>
                    </div>
                  </td>
                  @for (col of days(); track col.dateStr) {
                    @let studioShifts = getStudioShifts(studio.id, col.dateStr);
                    @let requestEntries = getStudioRequestEntries(studio.id, col.dateStr);
                    <td class="ts-cell ts-cell--studio"
                        [class.ts-weekend]="col.isWeekend"
                        [class.ts-today]="col.isToday">
                      <div class="ts-cell-stack">
                        @if (studioShifts.length > 0) {
                          <div class="ts-studio-shift-stack">
                            @for (shift of studioShifts.slice(0, 3); track shift.id) {
                              <button type="button"
                                      class="ts-shift-chip ts-shift-chip--studio"
                                      [class.ts-shift--scheduled]="shift.status === 'scheduled'"
                                      [class.ts-shift--active]="shift.status === 'active'"
                                      [class.ts-shift--completed]="shift.status === 'completed'"
                                      [class.ts-shift--cancelled]="shift.status === 'cancelled'"
                                      [class.ts-shift--checked-in]="!!shift.checked_in_at"
                                      [matTooltip]="shiftTooltip(shift)"
                                      (click)="onStudioShiftClick(shift, $event)">
                                <span class="ts-chip-text" [class.ts-chip-strikethrough]="shift.status === 'cancelled'">
                                  {{ studioShiftLabel(shift) }}
                                </span>
                                @if (shift.status === 'active') {
                                  <span class="ts-chip-pulse"></span>
                                }
                              </button>
                            }
                            @if (studioShifts.length > 3) {
                              <button type="button"
                                      class="ts-shift-chip ts-shift-chip--studio ts-shift-chip--more"
                                      [matTooltip]="studioExtraShiftsTooltip(studioShifts)">
                                +{{ studioShifts.length - 3 }}
                              </button>
                            }
                          </div>
                        }

                        @if (showRequests() && requestEntries.length > 0) {
                          <div class="ts-request-stack">
                            @for (entry of requestEntries.slice(0, 2); track entry.request.id + entry.shift.date) {
                              <button type="button"
                                      class="ts-request-chip"
                                      [class.ts-request-chip--proposal]="isAdminProposal(entry.request)"
                                      [class.ts-request-chip--revision]="entry.request.status === 'revision_requested'"
                                      [class.ts-request-chip--cancel]="requestShiftAction(entry.shift) === 'cancel_shift'"
                                      [class.ts-request-chip--change]="requestShiftAction(entry.shift) === 'change_address'"
                                      [matTooltip]="requestCellTooltip(entry)"
                                      (click)="openRequestPanel(entry.request, $event)">
                                {{ requestCellLabel(entry) }}
                              </button>
                            }
                            @if (requestEntries.length > 2) {
                              <button type="button"
                                      class="ts-request-chip ts-request-chip--more"
                                      (click)="openRequestPanel(requestEntries[0]!.request, $event)">
                                +{{ requestEntries.length - 2 }}
                              </button>
                            }
                          </div>
                        } @else if (studioShifts.length === 0) {
                          <div class="ts-cell-empty ts-cell-empty--readonly"></div>
                        }
                      </div>
                    </td>
                  }
                </tr>
              }
            }
          </tbody>
          <tfoot>
            <tr class="ts-footer-row">
              <td class="ts-col-employee ts-footer-label">Итого</td>
              @for (col of days(); track col.dateStr) {
                <td class="ts-col-day ts-footer-cell"
                    [class.ts-weekend]="col.isWeekend"
                    [class.ts-today]="col.isToday">
                  <span class="ts-footer-count" [class.ts-footer-count--zero]="getDayTotal(col.dateStr) === 0">
                    {{ getDayTotal(col.dateStr) }}
                  </span>
                </td>
              }
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Empty state -->
    @if (scheduleLayout() === 'employees' && filteredEmployees().length === 0 && !loading()) {
      <div class="ts-empty glass-card">
        <mat-icon>group_off</mat-icon>
        <span>Нет активных сотрудников</span>
      </div>
    }
    @if (scheduleLayout() === 'studios' && studioRows().length === 0 && !loading()) {
      <div class="ts-empty glass-card">
        <mat-icon>storefront</mat-icon>
        <span>Нет доступных студий</span>
      </div>
    }
  }

  <!-- ═══ ADD SHIFT PANEL ═══════════════════════════════════ -->
  @if (showAddPanel()) {
    <div class="ts-overlay" (click)="closeAllPanels()" (keydown.escape)="closeAllPanels()" tabindex="-1" role="presentation"></div>
    <div class="ts-panel glass-card" [style.top.px]="panelTop()" [style.left.px]="panelLeft()" [style.max-height.px]="panelMaxHeight()">
      <div class="ts-panel-header">
        <span class="ts-panel-title">
          <mat-icon>{{ addMode() === 'proposal' ? 'outgoing_mail' : 'add_circle' }}</mat-icon>
          {{ addMode() === 'proposal' ? 'Предложить смену' : 'Добавить смену' }}
        </span>
        <button class="ts-close-btn" (click)="closeAllPanels()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      <div class="ts-panel-body">
        <div class="ts-panel-meta">
          <span class="ts-panel-emp">{{ addForm.employeeName }}</span>
          <span class="ts-panel-date">{{ formatDisplayDate(addForm.shift_date) }}</span>
        </div>

        <div class="ts-mode-toggle ts-mode-toggle--panel">
          <button type="button" class="ts-mode-toggle__btn"
                  [class.ts-mode-toggle__btn--active]="addMode() === 'proposal'"
                  (click)="addMode.set('proposal')">
            <mat-icon>outgoing_mail</mat-icon>
            Предложить
          </button>
          <button type="button" class="ts-mode-toggle__btn"
                  [class.ts-mode-toggle__btn--active]="addMode() === 'direct'"
                  (click)="addMode.set('direct')">
            <mat-icon>event_available</mat-icon>
            Назначить
          </button>
        </div>

        <mat-form-field appearance="outline" class="ts-panel-field">
          <mat-label>Студия</mat-label>
          <mat-select [(ngModel)]="addForm.studio_id">
            @for (s of studios(); track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div class="ts-panel-time-row">
          <mat-form-field appearance="outline">
            <mat-label>Начало</mat-label>
            <input matInput type="time" [(ngModel)]="addForm.start_time">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Конец</mat-label>
            <input matInput type="time" [(ngModel)]="addForm.end_time">
          </mat-form-field>
        </div>

        @if (addMode() === 'proposal') {
          <mat-form-field appearance="outline" class="ts-panel-field">
            <mat-label>Комментарий для сотрудника</mat-label>
            <textarea matInput [(ngModel)]="addComment" rows="2"
                      placeholder="Комментарий к предложению"></textarea>
          </mat-form-field>
        }
      </div>
      <div class="ts-panel-actions">
        <button class="ts-btn" (click)="closeAllPanels()">Отмена</button>
        <button class="ts-btn ts-btn--accent" [disabled]="!addForm.studio_id || saving()"
                (click)="saveNewShift()">
          @if (saving()) { <mat-spinner diameter="16"></mat-spinner> }
          @else { <mat-icon>check</mat-icon> }
          {{ addMode() === 'proposal' ? 'Предложить' : 'Сохранить' }}
        </button>
      </div>
    </div>
  }

  <!-- ═══ EDIT SHIFT POPOVER ════════════════════════════════ -->
  @if (showEditPanel()) {
    <div class="ts-overlay" (click)="closeAllPanels()" (keydown.escape)="closeAllPanels()" tabindex="-1" role="presentation"></div>
    <div class="ts-panel glass-card" [style.top.px]="panelTop()" [style.left.px]="panelLeft()" [style.max-height.px]="panelMaxHeight()">
      <div class="ts-panel-header">
        <span class="ts-panel-title">
          <mat-icon>edit_calendar</mat-icon>
          Детали смены
        </span>
        <button class="ts-close-btn" (click)="closeAllPanels()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      <div class="ts-panel-body">
        <div class="ts-panel-meta">
          <span class="ts-panel-emp">{{ editShift()?.employee_name }}</span>
          <span class="ts-panel-date">{{ formatDisplayDate(editShift()?.shift_date ?? '') }}</span>
          <span class="ts-panel-status" [class]="'ts-status--' + editShift()?.status">
            {{ statusLabel(editShift()?.status ?? 'scheduled') }}
          </span>
        </div>

        <mat-form-field appearance="outline" class="ts-panel-field">
          <mat-label>Студия</mat-label>
          <mat-select [(ngModel)]="editForm.studio_id">
            @for (s of studios(); track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div class="ts-panel-time-row">
          <mat-form-field appearance="outline">
            <mat-label>Начало</mat-label>
            <input matInput type="time" [(ngModel)]="editForm.start_time">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Конец</mat-label>
            <input matInput type="time" [(ngModel)]="editForm.end_time">
          </mat-form-field>
        </div>
      </div>
      <div class="ts-panel-actions ts-panel-actions--edit">
        <button class="ts-btn ts-btn--danger" (click)="confirmDelete()" [disabled]="saving()">
          @if (confirmingDelete()) {
            Точно удалить?
          } @else {
            <mat-icon>delete</mat-icon> Удалить
          }
        </button>
        <div class="ts-panel-actions-right">
          <button class="ts-btn" (click)="closeAllPanels()">Отмена</button>
          <button class="ts-btn ts-btn--accent" [disabled]="saving()"
                  (click)="saveEditShift()">
            @if (saving()) { <mat-spinner diameter="16"></mat-spinner> }
            @else { <mat-icon>check</mat-icon> }
            Сохранить
          </button>
        </div>
      </div>
    </div>
  }

  <!-- ═══ REQUEST DETAILS PANEL ═════════════════════════════ -->
  @if (showRequestPanel()) {
    <div class="ts-overlay" (click)="closeAllPanels()" (keydown.escape)="closeAllPanels()" tabindex="-1" role="presentation"></div>
    @if (selectedRequest(); as req) {
      <div class="ts-panel ts-request-panel glass-card" [style.top.px]="panelTop()" [style.left.px]="panelLeft()" [style.max-height.px]="panelMaxHeight()">
        <div class="ts-panel-header">
          <span class="ts-panel-title">
            <mat-icon>{{ requestStatusIcon(req) }}</mat-icon>
            {{ isAdminProposal(req) ? 'Предложение смен' : 'Заявка сотрудника' }}
          </span>
          <button class="ts-close-btn" (click)="closeAllPanels()">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <div class="ts-panel-body">
          <div class="ts-request-head">
            <div class="ts-request-employee">
              <div class="ts-avatar ts-avatar--small">{{ getInitials(req.employee_name || 'С') }}</div>
              <div>
                <strong>{{ req.employee_name || 'Сотрудник' }}</strong>
                @if (req.employee_phone) {
                  <span>{{ req.employee_phone }}</span>
                }
              </div>
            </div>
            <span class="ts-request-status"
                  [class.ts-request-status--pending]="requestStatusClass(req) === 'pending'"
                  [class.ts-request-status--approved]="requestStatusClass(req) === 'approved'"
                  [class.ts-request-status--rejected]="requestStatusClass(req) === 'rejected'"
                  [class.ts-request-status--revision_requested]="requestStatusClass(req) === 'revision_requested'"
                  [class.ts-request-status--proposed]="requestStatusClass(req) === 'proposed'">
              {{ requestStatusLabel(req) }}
            </span>
          </div>

          <div class="ts-request-meta">
            <span>{{ requestActionLabel(requestAction(req)) }}</span>
            <span>{{ formatDateShort(req.pattern_start_date) }}@if (req.end_date) { — {{ formatDateShort(req.end_date) }} }</span>
            <span>{{ req.requested_shifts.length }} {{ shiftWord(req.requested_shifts.length) }}</span>
            <span>Создан {{ formatDateTime(req.created_at) }}</span>
          </div>

          @if (requestLocationGroups(req).length > 0) {
            <div class="ts-request-locations">
              @for (group of requestLocationGroups(req); track group.key) {
                <div class="ts-request-location">
                  <mat-icon>place</mat-icon>
                  <strong>{{ group.label }}</strong>
                  <span>{{ group.datesLabel }}</span>
                  <em>{{ group.count }} {{ shiftWord(group.count) }}</em>
                </div>
              }
            </div>
          }

          <div class="ts-request-days">
            @for (shift of req.requested_shifts; track shift.date + (shift.shift_id || '')) {
              <div class="ts-request-day"
                   [class.ts-request-day--occupied]="requestShiftOccupants(shift).length > 0">
                <div>
                  <strong>{{ formatDateShort(shift.date) }}</strong>
                  <span>{{ shift.start_time }}–{{ shift.end_time }}</span>
                </div>
                <div>
                  <span>{{ requestShiftStudioLabel(shift) }}</span>
                  @if (requestShiftOccupants(shift).length > 0) {
                    <em>{{ requestShiftOccupants(shift).length }} уже работает</em>
                  }
                </div>
              </div>
            }
          </div>

          @if (req.admin_comment) {
            <div class="ts-request-comment">
              <mat-icon>comment</mat-icon>
              <span>{{ req.admin_comment }}</span>
            </div>
          }
        </div>

        @if ((req.status === 'pending' && !isAdminProposal(req)) || req.status === 'revision_requested') {
          <div class="ts-request-footer">
            @if (requestActionMode()) {
              <div class="ts-request-action-form">
                @switch (requestActionMode()) {
                  @case ('approve') {
                    <span class="ts-request-action-title">
                      {{ requestAction(req) === 'cancel_shift' ? 'Подтвердите отмену смен' : (requestHasEveryShiftStudio(req) ? 'Адреса уже выбраны' : 'Выберите студию') }}
                    </span>
                    @if (requestAction(req) !== 'cancel_shift' || !requestHasEveryShiftStudio(req)) {
                      <mat-form-field appearance="outline" class="ts-panel-field">
                        <mat-label>{{ requestHasEveryShiftStudio(req) ? 'Единый адрес, если нужно заполнить' : 'Студия' }}</mat-label>
                        <mat-select [(ngModel)]="requestActionStudioId">
                          @for (s of studios(); track s.id) {
                            <mat-option [value]="s.id">{{ s.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    }
                    <div class="ts-request-action-buttons">
                      <button class="ts-btn ts-btn--success"
                              [disabled]="!canConfirmApprove(req) || requestActionSaving()"
                              (click)="confirmApproveRequest(req)">
                        @if (requestActionSaving()) { <mat-spinner diameter="16"></mat-spinner> }
                        @else { <mat-icon>check</mat-icon> }
                        Утвердить
                      </button>
                      <button class="ts-btn" (click)="cancelRequestAction()">Отмена</button>
                    </div>
                  }
                  @case ('reject') {
                    <span class="ts-request-action-title">Причина отклонения</span>
                    <mat-form-field appearance="outline" class="ts-panel-field">
                      <mat-label>Комментарий</mat-label>
                      <textarea matInput [(ngModel)]="requestActionComment" rows="2"></textarea>
                    </mat-form-field>
                    <div class="ts-request-action-buttons">
                      <button class="ts-btn ts-btn--danger"
                              [disabled]="!requestActionComment() || requestActionSaving()"
                              (click)="confirmRejectRequest(req.id)">
                        @if (requestActionSaving()) { <mat-spinner diameter="16"></mat-spinner> }
                        @else { <mat-icon>close</mat-icon> }
                        Отклонить
                      </button>
                      <button class="ts-btn" (click)="cancelRequestAction()">Отмена</button>
                    </div>
                  }
                  @case ('revision') {
                    <span class="ts-request-action-title">Что нужно исправить?</span>
                    <mat-form-field appearance="outline" class="ts-panel-field">
                      <mat-label>Комментарий</mat-label>
                      <textarea matInput [(ngModel)]="requestActionComment" rows="2"></textarea>
                    </mat-form-field>
                    <div class="ts-request-action-buttons">
                      <button class="ts-btn ts-btn--warning"
                              [disabled]="!requestActionComment() || requestActionSaving()"
                              (click)="confirmRevisionRequest(req.id)">
                        @if (requestActionSaving()) { <mat-spinner diameter="16"></mat-spinner> }
                        @else { <mat-icon>edit_note</mat-icon> }
                        На доработку
                      </button>
                      <button class="ts-btn" (click)="cancelRequestAction()">Отмена</button>
                    </div>
                  }
                }
              </div>
            } @else {
              <div class="ts-request-actions">
                <button class="ts-btn ts-btn--success" (click)="startRequestAction('approve')">
                  <mat-icon>check_circle</mat-icon>
                  Утвердить
                </button>
                <button class="ts-btn ts-btn--danger" (click)="startRequestAction('reject')">
                  <mat-icon>cancel</mat-icon>
                  Отклонить
                </button>
                <button class="ts-btn ts-btn--warning" (click)="startRequestAction('revision')">
                  <mat-icon>edit_note</mat-icon>
                  Доработка
                </button>
              </div>
            }
          </div>
        } @else if (isAdminProposal(req) && req.status === 'pending') {
          <div class="ts-request-footer">
            <div class="ts-request-waiting">
              <mat-icon>schedule_send</mat-icon>
              Ждём ответ сотрудника
            </div>
          </div>
        }
      </div>
    }
  }

</div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
    }

    .ts-page {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ── Glass card base ───────────────────────────────── */
    .glass-card {
      background: var(--crm-gradient-card, rgba(30, 30, 36, 0.85));
      backdrop-filter: blur(var(--crm-glass-blur, 16px));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur, 16px));
      border-radius: var(--crm-radius-lg, 12px);
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.06));
      box-shadow: var(--crm-shadow-card, 0 2px 12px rgba(0, 0, 0, 0.3));
    }

    /* ── Header ────────────────────────────────────────── */
    .ts-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .ts-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ts-header-icon {
      color: var(--crm-accent, #f59e0b);
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .ts-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
      margin: 0;
      font-family: var(--crm-font-sans, inherit);
    }

    .ts-header-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .ts-view-toggle {
      display: flex;
      gap: 4px;
      margin-right: 4px;

      button {
        width: 36px;
        height: 36px;

        &.active {
          background: rgba(245, 158, 11, 0.12);
          color: var(--crm-accent, #f59e0b);
        }
      }
    }

    .ts-layout-toggle {
      display: inline-flex;
      gap: 4px;
      padding: 3px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--crm-radius-md, 8px);
      background: rgba(255, 255, 255, 0.03);
    }

    .ts-layout-toggle__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 30px;
      padding: 5px 9px;
      border: 1px solid transparent;
      border-radius: var(--crm-radius-sm, 6px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      font-family: var(--crm-font-sans, inherit);
      white-space: nowrap;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      &:hover {
        color: var(--crm-text-primary, #f0f0f0);
      }
    }

    .ts-layout-toggle__btn--active {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.28);
      color: var(--crm-accent, #f59e0b);
    }

    .ts-studio-filter {
      min-width: 160px;
      font-size: 13px;
    }

    /* ── Buttons ───────────────────────────────────────── */
    .ts-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--crm-radius-md, 8px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      font-family: var(--crm-font-sans, inherit);
      white-space: nowrap;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.04);
        color: var(--crm-text-primary, #f0f0f0);
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }

    .ts-btn--accent {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05));
      border-color: rgba(245, 158, 11, 0.3);
      color: var(--crm-accent, #f59e0b);

      &:hover:not(:disabled) {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(245, 158, 11, 0.1));
        color: var(--crm-accent, #f59e0b);
      }
    }

    .ts-btn--active {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.3);
      color: var(--crm-accent, #f59e0b);
    }

    .ts-btn--success {
      border-color: rgba(34, 197, 94, 0.3);
      color: var(--crm-status-success, #22c55e);

      &:hover:not(:disabled) {
        background: rgba(34, 197, 94, 0.1);
      }
    }

    .ts-btn--danger {
      border-color: rgba(239, 68, 68, 0.3);
      color: var(--crm-status-error, #ef4444);

      &:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.1);
      }
    }

    .ts-btn--warning {
      border-color: rgba(245, 158, 11, 0.3);
      color: var(--crm-status-warning, #f59e0b);

      &:hover:not(:disabled) {
        background: rgba(245, 158, 11, 0.1);
      }
    }

    .ts-btn-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: var(--crm-status-warning, #f59e0b);
      color: #000;
      font-size: 11px;
      font-weight: 800;
      font-family: var(--crm-font-mono, monospace);
    }

    /* ── Month navigator ───────────────────────────────── */
    .ts-month-nav {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
    }

    .ts-nav-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--crm-radius-sm, 6px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        background: rgba(255, 255, 255, 0.06);
        color: var(--crm-text-primary, #f0f0f0);
      }
    }

    .ts-month-label {
      font-size: 16px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
      min-width: 180px;
      text-align: center;
      text-transform: capitalize;
      font-family: var(--crm-font-sans, inherit);
    }

    .ts-nav-today {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      padding: 5px 12px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--crm-radius-sm, 6px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      font-family: var(--crm-font-sans, inherit);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      &:hover {
        background: rgba(255, 255, 255, 0.04);
        color: var(--crm-text-primary, #f0f0f0);
      }
    }

    /* ── Pattern form ──────────────────────────────────── */
    .ts-pattern-form {
      padding: 20px;
    }

    .ts-pattern-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .ts-pattern-title {
      display: flex;
      align-items: center;
      gap: 8px;

      h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--crm-text-primary, #f0f0f0);
      }

      mat-icon {
        color: var(--crm-accent, #f59e0b);
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .ts-close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: var(--crm-radius-sm, 6px);
      background: transparent;
      color: var(--crm-text-muted, #707070);
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        background: rgba(255, 255, 255, 0.06);
        color: var(--crm-text-primary, #f0f0f0);
      }

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .ts-pattern-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;

      & > mat-form-field {
        width: 100%;
      }
    }

    .ts-time-row {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .ts-form-full {
      grid-column: 1 / -1;
      width: 100%;
    }

    .ts-mode-toggle {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      margin-bottom: 16px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--crm-radius-md, 8px);
      background: rgba(255, 255, 255, 0.03);
    }

    .ts-mode-toggle--panel {
      width: 100%;
      margin-bottom: 4px;
    }

    .ts-mode-toggle__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 30px;
      padding: 5px 10px;
      border: 1px solid transparent;
      border-radius: var(--crm-radius-sm, 6px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      flex: 1;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .ts-mode-toggle__btn--active {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.28);
      color: var(--crm-accent, #f59e0b);
    }

    .ts-pattern-preview {
      margin-top: 12px;
      padding: 12px;
      border-radius: var(--crm-radius-md, 8px);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
    }

    .ts-preview-header {
      margin-bottom: 8px;
    }

    .ts-preview-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary, #a0a0a0);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .ts-preview-days {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .ts-preview-chip {
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.2);
      color: var(--crm-status-success, #22c55e);
      font-size: 11px;
      font-weight: 600;
      font-family: var(--crm-font-mono, monospace);
    }

    .ts-pattern-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    /* ── Loading & empty ───────────────────────────────── */
    .ts-loading, .ts-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 40px 20px;
      color: var(--crm-text-muted, #707070);
      font-size: 14px;
    }

    .ts-empty mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
    }

    /* ── Calendar grid ─────────────────────────────────── */
    .ts-grid-wrapper {
      padding: 0;
      overflow: hidden;
    }

    .ts-grid-scroll {
      overflow-x: auto;
      overflow-y: visible;
      -webkit-overflow-scrolling: touch;
    }

    .ts-grid {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 12px;
      font-family: var(--crm-font-sans, inherit);
    }

    /* Header */
    .ts-grid thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: 8px 2px;
      text-align: center;
      font-weight: 600;
      color: var(--crm-text-secondary, #a0a0a0);
      background: var(--crm-surface-raised, rgba(38, 38, 44, 0.95));
      border-bottom: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      white-space: nowrap;
    }

    .ts-grid thead th.ts-col-employee {
      position: sticky;
      left: 0;
      z-index: 3;
      text-align: left;
      padding-left: 12px;
      min-width: 180px;
      background: var(--crm-surface-raised, rgba(38, 38, 44, 0.95));
    }

    .ts-col-day {
      min-width: 40px;
      max-width: 52px;
    }

    .ts-day-num {
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: var(--crm-text-primary, #f0f0f0);
      font-family: var(--crm-font-mono, monospace);
      line-height: 1.2;
    }

    .ts-day-name {
      display: block;
      font-size: 10px;
      font-weight: 500;
      color: var(--crm-text-muted, #707070);
      text-transform: lowercase;
    }

    /* Weekend & today highlight */
    .ts-weekend {
      background: rgba(255, 255, 255, 0.02);
    }

    .ts-weekend .ts-day-num,
    .ts-weekend .ts-day-name {
      color: var(--crm-status-error, #ef4444);
      opacity: 0.7;
    }

    .ts-today {
      border-left: 2px solid var(--crm-accent, #f59e0b) !important;
      background: rgba(245, 158, 11, 0.04);
    }

    .ts-today .ts-day-num {
      color: var(--crm-accent, #f59e0b);
    }

    /* Body rows */
    .ts-row {
      transition: background 0.1s;

      &:hover {
        background: rgba(255, 255, 255, 0.02);
      }
    }

    .ts-row td {
      padding: 0;
      border-bottom: 1px solid var(--crm-border, rgba(255, 255, 255, 0.04));
      height: 44px;
      vertical-align: middle;
    }

    .ts-row td.ts-col-employee {
      position: sticky;
      left: 0;
      z-index: 1;
      background: var(--crm-gradient-card, rgba(30, 30, 36, 0.95));
      padding: 4px 8px 4px 12px;
      border-right: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
    }

    .ts-row:hover td.ts-col-employee {
      background: rgba(35, 35, 42, 0.98);
    }

    /* Employee cell */
    .ts-emp-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 160px;
    }

    .ts-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
    }

    .ts-emp-info {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .ts-emp-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 140px;
    }

    .ts-emp-role {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .ts-studio-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 160px;
    }

    .ts-studio-code {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.28);
      color: var(--crm-accent, #f59e0b);
      font-size: 10px;
      font-weight: 800;
      flex-shrink: 0;
      font-family: var(--crm-font-mono, monospace);
      text-transform: uppercase;
    }

    .ts-studio-address {
      color: var(--crm-text-muted, #707070) !important;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Grid cells */
    .ts-cell {
      text-align: center;
      cursor: pointer;
      position: relative;
      padding: 2px !important;
      transition: background 0.1s;

      &:hover {
        background: rgba(255, 255, 255, 0.04);
      }
    }

    .ts-cell--studio {
      cursor: default;
    }

    .ts-cell-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 36px;
    }

    .ts-cell-empty--readonly {
      opacity: 0.35;
    }

    .ts-cell-stack {
      display: flex;
      min-height: 38px;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 2px;
    }

    .ts-add-hint {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--crm-text-muted, #707070);
      opacity: 0;
      transition: opacity 0.15s;
    }

    .ts-cell:hover .ts-add-hint {
      opacity: 0.5;
    }

    /* Shift chips */
    .ts-shift-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3px 6px;
      border: 1px solid transparent;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.2px;
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.1s;
      max-width: 100%;
      font-family: var(--crm-font-mono, monospace);

      &:hover {
        transform: scale(1.08);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }
    }

    .ts-chip-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 36px;
      font-family: var(--crm-font-mono, monospace);
    }

    .ts-chip-strikethrough {
      text-decoration: line-through;
      opacity: 0.6;
    }

    .ts-shift--scheduled {
      background: var(--crm-status-info-container, rgba(59, 130, 246, 0.15));
      color: var(--crm-status-info, #3b82f6);
      border: 1px solid rgba(59, 130, 246, 0.25);
    }

    .ts-shift--active {
      background: var(--crm-status-success-container, rgba(34, 197, 94, 0.15));
      color: var(--crm-status-success, #22c55e);
      border: 1px solid rgba(34, 197, 94, 0.25);
    }

    .ts-shift--completed {
      background: rgba(255, 255, 255, 0.06);
      color: var(--crm-text-muted, #707070);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .ts-shift--cancelled {
      background: var(--crm-status-error-container, rgba(239, 68, 68, 0.1));
      color: var(--crm-status-error, #ef4444);
      border: 1px solid rgba(239, 68, 68, 0.15);
    }

    .ts-chip-pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--crm-status-success, #22c55e);
      margin-left: 2px;
      flex-shrink: 0;
      animation: tsPulse 2s ease-in-out infinite;
    }

    @keyframes tsPulse {
      0%, 100% { box-shadow: 0 0 3px rgba(34, 197, 94, 0.4); }
      50% { box-shadow: 0 0 8px rgba(34, 197, 94, 0.8); }
    }

    .ts-chip-earnings {
      font-size: 8px;
      font-weight: 800;
      color: var(--crm-status-success, #22c55e);
      margin-left: 2px;
      flex-shrink: 0;
    }

    .ts-studio-shift-stack {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      width: 100%;
    }

    .ts-shift-chip--studio {
      min-width: 30px;
      max-width: 44px;
      padding: 2px 5px;
    }

    .ts-shift-chip--studio .ts-chip-text {
      max-width: 32px;
    }

    .ts-shift-chip--more {
      background: rgba(255, 255, 255, 0.04);
      color: var(--crm-text-secondary, #a0a0a0);
      border-color: var(--crm-border, rgba(255, 255, 255, 0.08));
    }

    .ts-request-stack {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      width: 100%;
    }

    .ts-request-chip {
      width: min(58px, 100%);
      min-height: 16px;
      padding: 1px 4px;
      border: 1px solid rgba(245, 158, 11, 0.42);
      border-radius: 4px;
      background: rgba(245, 158, 11, 0.12);
      color: var(--crm-status-warning, #f59e0b);
      font-size: 9px;
      font-weight: 800;
      line-height: 1.2;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--crm-font-sans, inherit);

      &:hover {
        background: rgba(245, 158, 11, 0.2);
      }
    }

    .ts-request-chip--proposal {
      border-color: rgba(59, 130, 246, 0.45);
      background: rgba(59, 130, 246, 0.12);
      color: var(--crm-status-info, #3b82f6);
    }

    .ts-request-chip--revision,
    .ts-request-chip--change {
      border-color: rgba(59, 130, 246, 0.45);
      background: rgba(59, 130, 246, 0.12);
      color: var(--crm-status-info, #3b82f6);
    }

    .ts-request-chip--cancel {
      border-color: rgba(239, 68, 68, 0.45);
      background: rgba(239, 68, 68, 0.12);
      color: var(--crm-status-error, #ef4444);
    }

    .ts-request-chip--more {
      border-color: var(--crm-border, rgba(255, 255, 255, 0.08));
      background: rgba(255, 255, 255, 0.04);
      color: var(--crm-text-secondary, #a0a0a0);
    }

    /* Footer row */
    .ts-footer-row td {
      padding: 8px 2px;
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.08));
      background: var(--crm-surface-raised, rgba(38, 38, 44, 0.95));
      text-align: center;
    }

    .ts-footer-row td.ts-col-employee {
      position: sticky;
      left: 0;
      z-index: 1;
      text-align: left;
      padding-left: 12px;
    }

    .ts-footer-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--crm-text-secondary, #a0a0a0);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .ts-footer-count {
      font-size: 12px;
      font-weight: 700;
      color: var(--crm-text-primary, #f0f0f0);
      font-family: var(--crm-font-mono, monospace);
    }

    .ts-footer-count--zero {
      color: var(--crm-text-muted, #707070);
      opacity: 0.4;
    }

    .ts-footer-cell {
      font-family: var(--crm-font-mono, monospace);
    }

    /* ── Overlay + panels ──────────────────────────────── */
    .ts-overlay {
      position: fixed;
      inset: 0;
      z-index: 100;
      background: rgba(0, 0, 0, 0.4);
    }

    .ts-panel {
      position: fixed;
      z-index: 101;
      width: 320px;
      max-width: calc(100vw - 32px);
      padding: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: ts-panel-in 0.15s ease-out;
    }

    @keyframes ts-panel-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ts-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .ts-panel-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-accent, #f59e0b);
      }
    }

    .ts-panel-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
      overflow-y: auto;
      padding-right: 2px;
    }

    .ts-panel-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }

    .ts-panel-emp {
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
    }

    .ts-panel-date {
      font-size: 12px;
      color: var(--crm-text-secondary, #a0a0a0);
      font-family: var(--crm-font-mono, monospace);
    }

    .ts-panel-status {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }

    .ts-status--scheduled {
      background: var(--crm-status-info-container, rgba(59, 130, 246, 0.12));
      color: var(--crm-status-info, #3b82f6);
    }
    .ts-status--active {
      background: var(--crm-status-success-container, rgba(34, 197, 94, 0.12));
      color: var(--crm-status-success, #22c55e);
    }
    .ts-status--completed {
      background: rgba(255, 255, 255, 0.06);
      color: var(--crm-text-muted, #707070);
    }
    .ts-status--cancelled {
      background: var(--crm-status-error-container, rgba(239, 68, 68, 0.1));
      color: var(--crm-status-error, #ef4444);
    }

    .ts-panel-field {
      width: 100%;
    }

    .ts-panel-time-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .ts-panel-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      flex-shrink: 0;
    }

    .ts-panel-actions--edit {
      justify-content: space-between;
    }

    .ts-panel-actions-right {
      display: flex;
      gap: 8px;
    }

    .ts-request-panel {
      width: 440px;
    }

    .ts-request-footer {
      flex-shrink: 0;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
    }

    .ts-request-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .ts-request-employee {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .ts-avatar--small {
      width: 30px;
      height: 30px;
      font-size: 10px;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(245, 158, 11, 0.1)) !important;
      color: var(--crm-accent, #f59e0b);
    }

    .ts-request-employee div:last-child {
      display: grid;
      min-width: 0;
    }

    .ts-request-employee strong {
      color: var(--crm-text-primary, #f0f0f0);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ts-request-employee span {
      color: var(--crm-text-muted, #707070);
      font-size: 11px;
      font-family: var(--crm-font-mono, monospace);
    }

    .ts-request-status {
      padding: 4px 9px;
      border-radius: var(--crm-radius-sm, 6px);
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }

    .ts-request-status--pending {
      background: rgba(245, 158, 11, 0.12);
      color: var(--crm-status-warning, #f59e0b);
    }

    .ts-request-status--proposed,
    .ts-request-status--revision_requested {
      background: rgba(59, 130, 246, 0.12);
      color: var(--crm-status-info, #3b82f6);
    }

    .ts-request-status--approved {
      background: rgba(34, 197, 94, 0.12);
      color: var(--crm-status-success, #22c55e);
    }

    .ts-request-status--rejected {
      background: rgba(239, 68, 68, 0.12);
      color: var(--crm-status-error, #ef4444);
    }

    .ts-request-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 2px;
    }

    .ts-request-meta span {
      padding: 2px 7px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.04);
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 11px;
    }

    .ts-request-locations,
    .ts-request-days {
      display: grid;
      gap: 6px;
    }

    .ts-request-location {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      gap: 6px;
      align-items: center;
      padding: 7px 9px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(255, 255, 255, 0.025);
    }

    .ts-request-location mat-icon {
      color: var(--crm-accent, #f59e0b);
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .ts-request-location strong {
      color: var(--crm-text-primary, #f0f0f0);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ts-request-location span {
      grid-column: 2 / 4;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ts-request-location em {
      color: var(--crm-text-muted, #707070);
      font-size: 11px;
      font-style: normal;
      white-space: nowrap;
    }

    .ts-request-day {
      display: grid;
      grid-template-columns: minmax(86px, 0.7fr) minmax(0, 1fr);
      gap: 8px;
      padding: 7px 9px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(255, 255, 255, 0.025);
    }

    .ts-request-day--occupied {
      border-color: rgba(245, 158, 11, 0.25);
      background: rgba(245, 158, 11, 0.06);
    }

    .ts-request-day div {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .ts-request-day strong {
      color: var(--crm-text-primary, #f0f0f0);
      font-size: 12px;
    }

    .ts-request-day span {
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ts-request-day em {
      color: var(--crm-status-warning, #f59e0b);
      font-size: 11px;
      font-style: normal;
    }

    .ts-request-comment,
    .ts-request-waiting {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 9px 10px;
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 12px;
    }

    .ts-request-comment mat-icon,
    .ts-request-waiting mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-text-muted, #707070);
    }

    .ts-request-action-form {
      display: grid;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
    }

    .ts-request-action-title {
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .ts-request-actions,
    .ts-request-action-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
    }

    .ts-request-footer .ts-request-actions,
    .ts-request-footer .ts-request-action-buttons {
      padding-top: 0;
      border-top: 0;
    }

    .ts-request-footer .ts-request-action-form {
      padding-top: 0;
      border-top: 0;
    }

    /* ── Responsive ────────────────────────────────────── */
    @media (max-width: 640px) {
      .ts-header {
        flex-direction: column;
        align-items: stretch;
      }

      .ts-header-controls {
        flex-direction: column;
      }

      .ts-layout-toggle,
      .ts-studio-filter,
      .ts-header-controls .ts-btn {
        width: 100%;
      }

      .ts-pattern-grid {
        grid-template-columns: 1fr;
      }

      .ts-time-row {
        grid-column: 1;
      }

      .ts-panel {
        left: 16px !important;
        right: 16px;
        width: auto;
      }

      .ts-request-day {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class TeamScheduleComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly usersApi = inject(UsersApiService);
  private readonly snackBar = inject(MatSnackBar);

  // ─── State ──────────────────────────────────────────

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly patternSaving = signal(false);

  readonly viewMode = signal<'month' | 'week'>('month');
  readonly currentWeekStart = signal<Date>(getMonday(new Date()));

  readonly currentYear = signal(new Date().getFullYear());
  readonly currentMonth = signal(new Date().getMonth()); // 0-indexed

  readonly employees = signal<StaffUser[]>([]);
  readonly studios = signal<ShiftStudio[]>([]);
  readonly shifts = signal<EmployeeShift[]>([]);
  readonly requests = signal<ScheduleRequest[]>([]);

  readonly scheduleLayout = signal<ScheduleLayout>('employees');
  readonly studioFilter = signal<string>('all');
  readonly showRequests = signal(true);

  // Panels
  readonly showPatternForm = signal(false);
  readonly showAddPanel = signal(false);
  readonly showEditPanel = signal(false);
  readonly showRequestPanel = signal(false);
  readonly panelTop = signal(200);
  readonly panelLeft = signal(200);
  readonly panelMaxHeight = signal(360);
  readonly editShift = signal<EmployeeShift | null>(null);
  readonly selectedRequest = signal<ScheduleRequest | null>(null);
  readonly confirmingDelete = signal(false);
  readonly addMode = signal<PatternSubmitMode>('direct');
  readonly addComment = signal('');
  readonly patternSubmitMode = signal<PatternSubmitMode>('direct');
  readonly patternComment = signal('');
  readonly requestActionMode = signal<RequestActionMode | null>(null);
  readonly requestActionStudioId = signal('');
  readonly requestActionComment = signal('');
  readonly requestActionSaving = signal(false);

  // ─── Add form ───────────────────────────────────────

  addForm: {
    employee_id: string;
    employeeName: string;
    shift_date: string;
    studio_id: string;
    start_time: string;
    end_time: string;
  } = {
    employee_id: '',
    employeeName: '',
    shift_date: '',
    studio_id: '',
    start_time: '08:45',
    end_time: '19:45',
  };

  // ─── Edit form ──────────────────────────────────────

  editForm: {
    studio_id: string;
    start_time: string;
    end_time: string;
  } = {
    studio_id: '',
    start_time: '',
    end_time: '',
  };

  // ─── Pattern form ──────────────────────────────────

  patternForm: PatternFormData = {
    employee_id: '',
    pattern: '2/2',
    start_date: '',
    end_date: '',
    studio_id: '',
    start_time: '08:45',
    end_time: '19:45',
  };

  // ─── Computed ───────────────────────────────────────

  readonly monthLabel = computed(() => {
    const m = this.currentMonth();
    const y = this.currentYear();
    return `${MONTH_NAMES[m]} ${y} г.`;
  });

  readonly days = computed<DayColumn[]>(() => {
    const y = this.currentYear();
    const m = this.currentMonth();
    const count = getDaysInMonth(y, m);
    const result: DayColumn[] = [];
    for (let d = 1; d <= count; d++) {
      const dateStr = formatDate(y, m, d);
      result.push({
        day: d,
        dateStr,
        dayOfWeek: getDayOfWeek(dateStr),
        isWeekend: isWeekend(dateStr),
        isToday: isToday(dateStr),
      });
    }
    return result;
  });

  /**
   * Map<employeeId, Map<dateString, EmployeeShift>> for O(1) cell lookup
   */
  readonly visibleShifts = computed(() =>
    filterShiftsByStudio(this.shifts(), this.studioFilter()),
  );

  readonly shiftMap = computed(() => {
    const map = new Map<string, Map<string, EmployeeShift>>();
    for (const shift of this.visibleShifts()) {
      if (!map.has(shift.employee_id)) {
        map.set(shift.employee_id, new Map());
      }
      map.get(shift.employee_id)!.set(shift.shift_date, shift);
    }
    return map;
  });

  /**
   * Map<dateString, number> for footer totals.
   * Counts only non-cancelled shifts.
   */
  readonly dayTotals = computed(() => {
    const totals = new Map<string, number>();
    for (const shift of this.visibleShifts()) {
      if (shift.status === 'cancelled') continue;
      const current = totals.get(shift.shift_date) ?? 0;
      totals.set(shift.shift_date, current + 1);
    }
    return totals;
  });

  readonly filteredEmployees = computed(() => {
    const filter = this.studioFilter();
    const emps = this.employees();
    if (filter === 'all') return emps;

    // Include request-only employees so pending work is visible in the studio view.
    const shiftData = this.visibleShifts();
    const employeeIds = new Set(
      shiftData.map(s => s.employee_id),
    );
    for (const request of this.activeRequests()) {
      employeeIds.add(request.employee_id);
    }
    return emps.filter(e => employeeIds.has(e.id));
  });

  readonly studioRows = computed(() =>
    visibleStudioRows(this.studios(), this.studioFilter()),
  );

  readonly studioShiftMap = computed(() =>
    groupShiftsByStudioDate(this.visibleShifts()),
  );

  readonly activeRequests = computed(() => {
    const visibleDates = new Set(this.days().map(day => day.dateStr));
    const studioFilter = this.studioFilter();
    const allShifts = this.shifts();
    return this.requests()
      .filter(request => request.status === 'pending' || request.status === 'revision_requested')
      .filter(request => request.requested_shifts.some(shift => {
        if (!visibleDates.has(shift.date)) return false;
        if (isRequestedWorkShiftCovered(allShifts, request.employee_id, shift)) return false;
        if (studioFilter === 'all') return true;
        return this.requestedShiftStudioId(shift) === studioFilter;
      }))
      .sort((a, b) => {
        const priorityA = a.status === 'pending' ? 0 : 1;
        const priorityB = b.status === 'pending' ? 0 : 1;
        return priorityA - priorityB || a.created_at.localeCompare(b.created_at);
      });
  });

  readonly openRequestsCount = computed(() => {
    const allShifts = this.shifts();
    return this.requests().filter(request =>
      (request.status === 'pending' || request.status === 'revision_requested')
      && request.requested_shifts.some(shift => !isRequestedWorkShiftCovered(allShifts, request.employee_id, shift)),
    ).length;
  });

  readonly requestMap = computed(() => {
    const map = new Map<string, RequestCellEntry[]>();
    const studioFilter = this.studioFilter();
    const allShifts = this.shifts();
    for (const request of this.activeRequests()) {
      for (const shift of request.requested_shifts) {
        if (isRequestedWorkShiftCovered(allShifts, request.employee_id, shift)) continue;
        if (studioFilter !== 'all' && this.requestedShiftStudioId(shift) !== studioFilter) continue;
        const key = this.requestCellKey(request.employee_id, shift.date);
        map.set(key, [...(map.get(key) ?? []), { request, shift }]);
      }
    }
    return map;
  });

  readonly studioRequestMap = computed(() => {
    const map = new Map<string, RequestCellEntry[]>();
    const allShifts = this.shifts();
    for (const request of this.activeRequests()) {
      for (const shift of request.requested_shifts) {
        if (isRequestedWorkShiftCovered(allShifts, request.employee_id, shift)) continue;
        const studioId = this.requestedShiftStudioId(shift);
        if (!studioId) continue;
        const key = this.studioRequestCellKey(studioId, shift.date);
        map.set(key, [...(map.get(key) ?? []), { request, shift }]);
      }
    }
    return map;
  });

  /** Studio code lookup map */
  private readonly studioMap = computed(() => {
    const map = new Map<string, ShiftStudio>();
    for (const s of this.studios()) {
      map.set(s.id, s);
    }
    return map;
  });

  readonly weekLabel = computed(() => {
    const start = this.currentWeekStart();
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = (d: Date) => `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `${fmt(start)} \u2014 ${fmt(end)}`;
  });

  readonly patternPreview = computed<Partial<EmployeeShift>[]>(() => {
    const f = this.patternForm;
    if (!f.employee_id || !f.start_date || !f.end_date || !f.studio_id) return [];
    if (f.start_date > f.end_date) return [];
    return generateShiftsFromPattern(
      f.pattern, f.start_date, f.end_date,
      f.employee_id, f.studio_id, f.start_time, f.end_time,
    );
  });

  // ─── Lifecycle ──────────────────────────────────────

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadData();
    }
  }

  // ─── Data loading ───────────────────────────────────

  loadData(): void {
    this.loading.set(true);
    const { dateFrom, dateTo } = this.visibleDateRange();

    forkJoin({
      shifts: this.shiftsApi.getShifts({ date_from: dateFrom, date_to: dateTo }),
      users: this.usersApi.getUsers({ is_active: true }),
      studios: this.shiftsApi.getShiftStudios(),
      requests: this.shiftsApi.getScheduleRequests(),
    }).subscribe({
      next: (result) => {
        const employees = result.users.filter(canAppearInSchedule);
        const employeeIds = new Set(employees.map(user => user.id));
        if (result.shifts.success && result.shifts.data) {
          this.shifts.set(result.shifts.data.filter(shift => employeeIds.has(shift.employee_id)));
        }
        this.employees.set(employees);
        if (result.studios.success && result.studios.data) {
          this.studios.set(result.studios.data);
        }
        if (result.requests.success && result.requests.data) {
          this.requests.set(result.requests.data);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Ошибка загрузки данных', 'OK', { duration: 4000 });
      },
    });
  }

  private reloadShifts(): void {
    const { dateFrom, dateTo } = this.visibleDateRange();

    this.shiftsApi.getShifts({ date_from: dateFrom, date_to: dateTo }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          const employeeIds = new Set(this.employees().map(user => user.id));
          this.shifts.set(res.data.filter(shift => employeeIds.has(shift.employee_id)));
        }
      },
    });
  }

  private reloadRequests(): void {
    this.shiftsApi.getScheduleRequests().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.requests.set(res.data);
        }
      },
    });
  }

  private visibleDateRange(): { dateFrom: string; dateTo: string } {
    if (this.viewMode() === 'week') {
      const start = this.currentWeekStart();
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { dateFrom: toYMD(start), dateTo: toYMD(end) };
    }

    const y = this.currentYear();
    const m = this.currentMonth();
    return {
      dateFrom: formatDate(y, m, 1),
      dateTo: formatDate(y, m, getDaysInMonth(y, m)),
    };
  }

  // ─── Month navigation ──────────────────────────────

  prevMonth(): void {
    const m = this.currentMonth();
    if (m === 0) {
      this.currentMonth.set(11);
      this.currentYear.set(this.currentYear() - 1);
    } else {
      this.currentMonth.set(m - 1);
    }
    this.loadData();
  }

  nextMonth(): void {
    const m = this.currentMonth();
    if (m === 11) {
      this.currentMonth.set(0);
      this.currentYear.set(this.currentYear() + 1);
    } else {
      this.currentMonth.set(m + 1);
    }
    this.loadData();
  }

  goToToday(): void {
    const now = new Date();
    this.currentYear.set(now.getFullYear());
    this.currentMonth.set(now.getMonth());
    this.loadData();
  }

  prevWeek(): void {
    const d = new Date(this.currentWeekStart());
    d.setDate(d.getDate() - 7);
    this.currentWeekStart.set(d);
    this.loadData();
  }

  nextWeek(): void {
    const d = new Date(this.currentWeekStart());
    d.setDate(d.getDate() + 7);
    this.currentWeekStart.set(d);
    this.loadData();
  }

  goToCurrentWeek(): void {
    this.currentWeekStart.set(getMonday(new Date()));
    this.loadData();
  }

  onStudioFilterChange(): void {
    // Filter is reactive via computed, no additional load needed
  }

  setScheduleLayout(layout: ScheduleLayout): void {
    this.scheduleLayout.set(layout);
    this.closeAllPanels();
  }

  toggleRequests(): void {
    this.showRequests.update(value => !value);
  }

  // ─── Grid helpers ───────────────────────────────────

  getShift(employeeId: string, dateStr: string): EmployeeShift | undefined {
    return this.shiftMap().get(employeeId)?.get(dateStr);
  }

  getDayTotal(dateStr: string): number {
    return this.dayTotals().get(dateStr) ?? 0;
  }

  getRequestEntries(employeeId: string, dateStr: string): RequestCellEntry[] {
    return this.requestMap().get(this.requestCellKey(employeeId, dateStr)) ?? [];
  }

  getStudioShifts(studioId: string, dateStr: string): EmployeeShift[] {
    return this.studioShiftMap().get(studioId)?.get(dateStr) ?? [];
  }

  getStudioRequestEntries(studioId: string, dateStr: string): RequestCellEntry[] {
    return this.studioRequestMap().get(this.studioRequestCellKey(studioId, dateStr)) ?? [];
  }

  requestShiftAction(shift: ScheduleRequestedShift): ScheduleRequestAction {
    return scheduleRequestShiftAction(shift);
  }

  requestCellLabel(entry: RequestCellEntry): string {
    if (this.isAdminProposal(entry.request)) return 'предл.';
    const action = this.requestShiftAction(entry.shift);
    if (entry.request.status === 'revision_requested') return 'дораб.';
    if (action === 'cancel_shift') return 'отмена';
    if (action === 'change_address') return 'адрес';
    return 'заявка';
  }

  requestCellTooltip(entry: RequestCellEntry): string {
    const action = this.requestActionLabel(this.requestShiftAction(entry.shift));
    const studio = this.requestShiftStudioLabel(entry.shift);
    const occupants = this.requestShiftOccupants(entry.shift);
    const occupiedText = occupants.length > 0
      ? `Уже работают: ${occupants.map(shift => this.shiftEmployeeLabel(shift)).join(', ')}`
      : 'На этом адресе смен нет';
    return `${entry.request.employee_name || 'Сотрудник'} | ${action}\n${entry.shift.date} ${entry.shift.start_time}–${entry.shift.end_time}\n${studio}\n${occupiedText}`;
  }

  studioCode(studioId: string): string {
    const s = this.studioMap().get(studioId);
    return s?.location_code ?? s?.name?.slice(0, 3).toUpperCase() ?? '?';
  }

  shiftTooltip(shift: EmployeeShift): string {
    const studio = shift.studio_name ?? this.studioMap().get(shift.studio_id)?.name ?? '';
    let tip = `${studio} | ${shift.start_time}–${shift.end_time} | ${STATUS_LABELS[shift.status]}`;
    if (shift.checked_in_at) {
      tip += ` | Вход: ${new Date(shift.checked_in_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (shift.checked_out_at) {
      tip += ` | Выход: ${new Date(shift.checked_out_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (shift.online_count > 0) {
      tip += ` | Онлайн: ${shift.online_count} оплат, ${shift.online_earnings} ₽`;
    }
    return tip;
  }

  statusLabel(status: ShiftStatus): string {
    return STATUS_LABELS[status] || status;
  }

  getRoleColor(role: string): string {
    return ROLE_COLORS[role] ?? '#6b7280';
  }

  getRoleLabel(role: string): string {
    return ROLE_LABELS[role] ?? role;
  }

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  formatDisplayDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  formatDateShort(dateStr: string): string {
    return formatDateShort(dateStr);
  }

  formatDateTime(dateStr: string): string {
    return formatDateTime(dateStr);
  }

  shiftEmployeeLabel(shift: EmployeeShift): string {
    return shift.employee_name || shift.employee_phone || 'Сотрудник';
  }

  studioShiftLabel(shift: EmployeeShift): string {
    return this.getInitials(this.shiftEmployeeLabel(shift));
  }

  studioExtraShiftsTooltip(shifts: readonly EmployeeShift[]): string {
    return shifts.slice(3).map(shift => this.shiftEmployeeLabel(shift)).join(', ');
  }

  studioAvatarLabel(studio: ShiftStudio): string {
    return (studio.location_code || studio.name.slice(0, 2)).slice(0, 3).toUpperCase();
  }

  studioTooltip(studio: ShiftStudio): string {
    return studio.address ? `${studio.name} | ${studio.address}` : studio.name;
  }

  isAdminProposal(request: ScheduleRequest): boolean {
    return request.admin_id != null && request.admin_id !== '';
  }

  requestStatusLabel(request: ScheduleRequest): string {
    if (!this.isAdminProposal(request)) return REQUEST_STATUS_LABELS[request.status] || request.status;
    if (request.status === 'pending') return 'Ожидает сотрудника';
    if (request.status === 'approved') return 'Сотрудник согласился';
    if (request.status === 'rejected') return 'Сотрудник отказался';
    return REQUEST_STATUS_LABELS[request.status] || request.status;
  }

  requestStatusIcon(request: ScheduleRequest): string {
    if (this.isAdminProposal(request) && request.status === 'pending') return 'schedule_send';
    return REQUEST_STATUS_ICONS[request.status] || 'help_outline';
  }

  requestStatusClass(request: ScheduleRequest): string {
    if (this.isAdminProposal(request) && request.status === 'pending') return 'proposed';
    return request.status;
  }

  requestAction(request: ScheduleRequest): ScheduleRequestAction {
    const actions = new Set(request.requested_shifts.map(shift => shift.action ?? 'work'));
    if (actions.size === 1) {
      return actions.values().next().value ?? 'work';
    }
    return 'work';
  }

  requestActionLabel(action: ScheduleRequestAction): string {
    return REQUEST_ACTION_LABELS[action];
  }

  requestLocationGroups(request: ScheduleRequest): RequestLocationGroup[] {
    const groups = new Map<string, ScheduleRequestedShift[]>();
    for (const shift of request.requested_shifts) {
      const studioId = this.requestedShiftStudioId(shift);
      if (!studioId) continue;
      groups.set(studioId, [...(groups.get(studioId) ?? []), shift]);
    }

    return [...groups.entries()].map(([studioId, shifts]) => {
      const dates = shifts.map(shift => shift.date).sort();
      return {
        key: studioId,
        label: this.studioLabel(studioId),
        datesLabel: this.dateListLabel(dates),
        count: shifts.length,
      };
    });
  }

  requestShiftStudioLabel(shift: ScheduleRequestedShift): string {
    const studioId = this.requestedShiftStudioId(shift);
    if (!studioId) return 'Адрес не выбран';
    return this.studioLabel(studioId);
  }

  requestShiftOccupants(shift: ScheduleRequestedShift): EmployeeShift[] {
    const studioId = this.requestedShiftStudioId(shift);
    if (!studioId) return [];
    return this.shifts().filter(existing =>
      existing.shift_date.slice(0, 10) === shift.date
      && existing.studio_id === studioId
      && existing.status !== 'cancelled',
    );
  }

  shiftWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'смена';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'смены';
    return 'смен';
  }

  studioLabel(studioId: string): string {
    const studio = this.studioMap().get(studioId);
    if (!studio) return studioId;
    if (studio.address) return `${studio.name} · ${studio.address}`;
    return studio.name;
  }

  requestHasEveryShiftStudio(request: ScheduleRequest): boolean {
    return request.requested_shifts.length > 0
      && request.requested_shifts.every(shift =>
        shift.action === 'cancel_shift' || (typeof shift.studio_id === 'string' && shift.studio_id.length > 0),
      );
  }

  canConfirmApprove(request: ScheduleRequest): boolean {
    return this.requestHasEveryShiftStudio(request) || this.requestActionStudioId().length > 0;
  }

  openRequestPanel(request: ScheduleRequest, event?: MouseEvent): void {
    event?.stopPropagation();
    this.closeAllPanels();
    this.selectedRequest.set(request);
    this.cancelRequestAction();
    this.positionPanel(440, this.estimateRequestPanelHeight(request));
    this.showRequestPanel.set(true);
  }

  startRequestAction(mode: RequestActionMode): void {
    this.requestActionMode.set(mode);
    this.requestActionStudioId.set('');
    this.requestActionComment.set('');
  }

  cancelRequestAction(): void {
    this.requestActionMode.set(null);
    this.requestActionStudioId.set('');
    this.requestActionComment.set('');
  }

  confirmApproveRequest(request: ScheduleRequest): void {
    const studioId = this.requestActionStudioId();
    if (!studioId && !this.requestHasEveryShiftStudio(request)) return;
    this.requestActionSaving.set(true);

    this.shiftsApi.approveScheduleRequest(request.id, studioId || undefined).subscribe({
      next: (res) => {
        this.requestActionSaving.set(false);
        if (res.success) {
          this.snackBar.open('Заявка утверждена', 'OK', { duration: 3000 });
          this.closeAllPanels();
          this.loadData();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.requestActionSaving.set(false);
        this.snackBar.open(err.error?.message ?? 'Ошибка при утверждении заявки', 'OK', { duration: 5000 });
      },
    });
  }

  confirmRejectRequest(requestId: string): void {
    const comment = this.requestActionComment();
    if (!comment) return;
    this.requestActionSaving.set(true);

    this.shiftsApi.rejectScheduleRequest(requestId, comment).subscribe({
      next: (res) => {
        this.requestActionSaving.set(false);
        if (res.success) {
          this.snackBar.open('Заявка отклонена', 'OK', { duration: 3000 });
          this.closeAllPanels();
          this.reloadRequests();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.requestActionSaving.set(false);
        this.snackBar.open(err.error?.message ?? 'Ошибка при отклонении заявки', 'OK', { duration: 5000 });
      },
    });
  }

  confirmRevisionRequest(requestId: string): void {
    const comment = this.requestActionComment();
    if (!comment) return;
    this.requestActionSaving.set(true);

    this.shiftsApi.requestRevision(requestId, comment).subscribe({
      next: (res) => {
        this.requestActionSaving.set(false);
        if (res.success) {
          this.snackBar.open('Заявка отправлена на доработку', 'OK', { duration: 3000 });
          this.closeAllPanels();
          this.reloadRequests();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.requestActionSaving.set(false);
        this.snackBar.open(err.error?.message ?? 'Ошибка при отправке на доработку', 'OK', { duration: 5000 });
      },
    });
  }

  // ─── Cell click ─────────────────────────────────────

  onCellClick(emp: StaffUser, col: DayColumn, shift: EmployeeShift | undefined): void {
    if (shift) {
      this.openEditPanel(shift);
    } else {
      this.openAddPanel(emp, col);
    }
  }

  onStudioShiftClick(shift: EmployeeShift, event: MouseEvent): void {
    event.stopPropagation();
    this.openEditPanel(shift);
  }

  // ─── Add shift panel ───────────────────────────────

  private openAddPanel(emp: StaffUser, col: DayColumn): void {
    this.closeAllPanels();
    this.addForm = {
      employee_id: emp.id,
      employeeName: emp.display_name,
      shift_date: col.dateStr,
      studio_id: this.defaultStudioId(),
      start_time: '08:45',
      end_time: '19:45',
    };
    this.addMode.set('direct');
    this.addComment.set('');
    this.positionPanel();
    this.showAddPanel.set(true);
  }

  saveNewShift(): void {
    if (!this.addForm.studio_id) return;
    this.saving.set(true);

    if (this.addMode() === 'proposal') {
      this.shiftsApi.proposeScheduleRequest({
        employee_id: this.addForm.employee_id,
        comment: this.addComment() || undefined,
        requested_shifts: [{
          date: this.addForm.shift_date,
          studio_id: this.addForm.studio_id,
          start_time: this.addForm.start_time,
          end_time: this.addForm.end_time,
          action: 'work',
        }],
      }).subscribe({
        next: (res) => {
          this.saving.set(false);
          if (res.success) {
            this.snackBar.open('Предложение отправлено сотруднику', 'OK', { duration: 3000 });
            this.closeAllPanels();
            this.reloadRequests();
          }
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.snackBar.open(
            err.error?.message ?? 'Ошибка при отправке предложения',
            'OK', { duration: 5000 },
          );
        },
      });
      return;
    }

    this.shiftsApi.createShift({
      employee_id: this.addForm.employee_id,
      shift_date: this.addForm.shift_date,
      studio_id: this.addForm.studio_id,
      start_time: this.addForm.start_time,
      end_time: this.addForm.end_time,
      status: 'scheduled',
    }).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (res.success) {
          this.snackBar.open('Смена создана', 'OK', { duration: 3000 });
          this.closeAllPanels();
          this.reloadShifts();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.snackBar.open(
          err.error?.message ?? 'Ошибка при создании смены',
          'OK', { duration: 5000 },
        );
      },
    });
  }

  // ─── Edit shift panel ──────────────────────────────

  private openEditPanel(shift: EmployeeShift): void {
    this.closeAllPanels();
    this.editShift.set(shift);
    this.editForm = {
      studio_id: shift.studio_id,
      start_time: shift.start_time,
      end_time: shift.end_time,
    };
    this.confirmingDelete.set(false);
    this.positionPanel();
    this.showEditPanel.set(true);
  }

  saveEditShift(): void {
    const shift = this.editShift();
    if (!shift) return;
    this.saving.set(true);

    this.shiftsApi.updateShift(shift.id, {
      studio_id: this.editForm.studio_id,
      start_time: this.editForm.start_time,
      end_time: this.editForm.end_time,
    }).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (res.success) {
          this.snackBar.open('Смена обновлена', 'OK', { duration: 3000 });
          this.closeAllPanels();
          this.reloadShifts();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.snackBar.open(
          err.error?.message ?? 'Ошибка при обновлении смены',
          'OK', { duration: 5000 },
        );
      },
    });
  }

  confirmDelete(): void {
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    const shift = this.editShift();
    if (!shift) return;
    this.saving.set(true);

    this.shiftsApi.deleteShift(shift.id).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (res.success) {
          this.snackBar.open('Смена удалена', 'OK', { duration: 3000 });
          this.closeAllPanels();
          this.reloadShifts();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.snackBar.open(
          err.error?.message ?? 'Ошибка при удалении смены',
          'OK', { duration: 5000 },
        );
      },
    });
  }

  // ─── Pattern form ──────────────────────────────────

  togglePatternForm(mode: PatternSubmitMode): void {
    const current = this.showPatternForm() && this.patternSubmitMode() === mode;
    this.closeAllPanels();
    if (!current) {
      const today = toYMD(new Date());
      this.patternSubmitMode.set(mode);
      this.patternComment.set('');
      this.patternForm = {
        employee_id: '',
        pattern: '2/2',
        start_date: today,
        end_date: '',
        studio_id: this.defaultStudioId(),
        start_time: '08:45',
        end_time: '19:45',
      };
      this.showPatternForm.set(true);
    }
  }

  canSubmitPattern(): boolean {
    const f = this.patternForm;
    return !!f.employee_id && !!f.start_date && !!f.end_date
      && !!f.studio_id && f.start_date <= f.end_date;
  }

  submitPattern(): void {
    const preview = this.patternPreview();
    if (preview.length === 0) return;
    this.patternSaving.set(true);

    if (this.patternSubmitMode() === 'proposal') {
      this.shiftsApi.proposeScheduleRequest({
        employee_id: this.patternForm.employee_id,
        comment: this.patternComment() || undefined,
        requested_shifts: preview.map(shift => ({
          date: shift.shift_date ?? '',
          studio_id: shift.studio_id,
          start_time: shift.start_time ?? '',
          end_time: shift.end_time ?? '',
          action: 'work',
        })),
      }).subscribe({
        next: (res) => {
          this.patternSaving.set(false);
          if (res.success) {
            this.snackBar.open(`Предложено ${preview.length} ${this.shiftWord(preview.length)}`, 'OK', { duration: 4000 });
            this.showPatternForm.set(false);
            this.reloadRequests();
          }
        },
        error: (err: { error?: { message?: string } }) => {
          this.patternSaving.set(false);
          this.snackBar.open(
            err.error?.message ?? 'Ошибка при отправке предложения',
            'OK', { duration: 5000 },
          );
        },
      });
      return;
    }

    this.shiftsApi.createBulk(preview).subscribe({
      next: (res) => {
        this.patternSaving.set(false);
        if (res.success) {
          const count = res.data?.length ?? preview.length;
          this.snackBar.open(`Создано ${count} смен по паттерну`, 'OK', { duration: 4000 });
          this.showPatternForm.set(false);
          this.reloadShifts();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.patternSaving.set(false);
        this.snackBar.open(
          err.error?.message ?? 'Ошибка при создании смен',
          'OK', { duration: 5000 },
        );
      },
    });
  }

  // ─── Panel positioning ─────────────────────────────

  closeAllPanels(): void {
    this.showAddPanel.set(false);
    this.showEditPanel.set(false);
    this.showRequestPanel.set(false);
    this.confirmingDelete.set(false);
    this.selectedRequest.set(null);
    this.cancelRequestAction();
  }

  private requestCellKey(employeeId: string, dateStr: string): string {
    return `${employeeId}::${dateStr}`;
  }

  private studioRequestCellKey(studioId: string, dateStr: string): string {
    return `${studioId}::${dateStr}`;
  }

  private defaultStudioId(): string {
    const filter = this.studioFilter();
    if (filter !== 'all' && this.studioMap().has(filter)) return filter;
    return this.studios()[0]?.id ?? '';
  }

  private requestedShiftStudioId(shift: ScheduleRequestedShift): string | undefined {
    if (shift.action === 'cancel_shift') return shift.current_studio_id || shift.studio_id;
    return shift.studio_id || shift.current_studio_id;
  }

  private dateListLabel(dates: string[]): string {
    if (dates.length === 0) return '';
    if (dates.length <= 3) return dates.map(date => this.formatDateShort(date)).join(', ');
    return `${this.formatDateShort(dates[0])} — ${this.formatDateShort(dates[dates.length - 1])}`;
  }

  private estimateRequestPanelHeight(request: ScheduleRequest): number {
    const baseHeight = 220;
    const requestDaysHeight = request.requested_shifts.length * 48;
    const studioGroupCount = new Set(
      request.requested_shifts
        .map(shift => this.requestedShiftStudioId(shift))
        .filter((studioId): studioId is string => typeof studioId === 'string' && studioId.length > 0),
    ).size;
    const locationsHeight = Math.min(studioGroupCount, 4) * 42;
    const commentHeight = request.admin_comment ? 48 : 0;
    const footerHeight = request.status === 'pending' || request.status === 'revision_requested' ? 76 : 52;
    return baseHeight + requestDaysHeight + locationsHeight + commentHeight + footerHeight;
  }

  private positionPanel(panelW = 320, panelH = 360): void {
    // Center the panel in the viewport
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
    const viewportPadding = 16;
    const availableH = Math.max(240, viewportH - viewportPadding * 2);
    const targetH = Math.min(panelH, availableH);
    const panelTop = Math.max(viewportPadding, (viewportH - targetH) / 2);

    this.panelLeft.set(Math.max(16, (viewportW - panelW) / 2));
    this.panelTop.set(panelTop);
    this.panelMaxHeight.set(Math.max(240, viewportH - panelTop - viewportPadding));
  }
}
