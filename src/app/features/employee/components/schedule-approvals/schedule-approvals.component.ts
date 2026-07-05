import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, map } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ShiftsApiService, ScheduleRequest, ScheduleRequestedShift, EmployeeShift, ShiftStudio } from '../../services/shifts-api.service';
import { UsersApiService, StaffUser } from '../../services/users-api.service';
import { ApiResponse } from '../../../../core/services/api.service';

type StatusFilter = 'all' | 'pending' | 'proposed' | 'approved' | 'rejected' | 'revision_requested';
type ActiveTab = 'requests' | 'assign';
type AssignMode = 'proposal' | 'direct';
type ScheduleRequestAction = NonNullable<ScheduleRequestedShift['action']>;

interface RequestLocationGroup {
  key: string;
  label: string;
  datesLabel: string;
  count: number;
}

interface CoverageDay {
  date: string;
  shifts: EmployeeShift[];
  requestedCount: number;
}

const PATTERN_LABELS: Record<string, string> = {
  '2/2': 'Два через два',
  '1/1': 'День через день',
  '3/3': 'Три через три',
  '5/2': 'Пятидневка',
  'custom': 'Произвольный',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'На рассмотрении',
  approved: 'Утверждён',
  rejected: 'Отклонён',
  revision_requested: 'Нужна доработка',
};

const STATUS_ICONS: Record<string, string> = {
  pending: 'hourglass_empty',
  approved: 'check_circle',
  rejected: 'cancel',
  revision_requested: 'edit_note',
};

const REQUEST_ACTION_LABELS: Record<ScheduleRequestAction, string> = {
  work: 'Новые смены',
  change_address: 'Смена адреса',
  cancel_shift: 'Отмена смен',
};

const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function formatDateShort(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-schedule-approvals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  host: { class: 'schedule-approvals-host' },
  template: `
<div class="sa-page">

  <!-- Header -->
  <header class="sa-header glass-card">
    <div class="sa-header-left">
      <mat-icon class="sa-header-icon">event_available</mat-icon>
      <h1 class="sa-title">Согласование графиков</h1>
      @if (pendingCount() > 0) {
        <span class="sa-badge">{{ pendingCount() }}</span>
      }
    </div>

    <!-- Top tabs -->
    <div class="sa-top-tabs">
      <button class="sa-top-tab" [class.sa-top-tab--active]="activeTab() === 'requests'"
              (click)="activeTab.set('requests')">
        <mat-icon>inbox</mat-icon> Заявки
      </button>
      <button class="sa-top-tab" [class.sa-top-tab--active]="activeTab() === 'assign'"
              (click)="activeTab.set('assign')">
        <mat-icon>add_task</mat-icon> Назначить смену
      </button>
    </div>
  </header>

  <!-- TAB 1: Requests -->
  @if (activeTab() === 'requests') {

    <!-- Status filter tabs -->
    <div class="sa-filters glass-card">
      @for (f of statusFilters; track f.value) {
        <button class="sa-filter-tab" [class.sa-filter-tab--active]="statusFilter() === f.value"
                (click)="statusFilter.set(f.value)">
          {{ f.label }}
          <span class="sa-filter-count">{{ f.count() }}</span>
        </button>
      }
    </div>

    @if (requestCoverageDays().length > 0) {
      <section class="sa-coverage glass-card">
        <div class="sa-coverage-head">
          <div>
            <span class="sa-section-kicker">Занятость</span>
            <strong>Кто уже работает в датах заявок</strong>
          </div>
          @if (coverageLoading()) {
            <mat-spinner diameter="18"></mat-spinner>
          }
        </div>
        <div class="sa-coverage-days">
          @for (day of requestCoverageDays().slice(0, 14); track day.date) {
            <div class="sa-coverage-day" [class.sa-coverage-day--empty]="day.shifts.length === 0">
              <span class="sa-coverage-date">{{ formatDateShort(day.date) }}</span>
              <span class="sa-coverage-count">{{ day.requestedCount }} в заявках</span>
              @if (day.shifts.length > 0) {
                <div class="sa-coverage-staff">
                  @for (shift of day.shifts.slice(0, 3); track shift.id) {
                    <span>{{ shiftEmployeeLabel(shift) }} · {{ studioName(shift.studio_id) }}</span>
                  }
                  @if (day.shifts.length > 3) {
                    <span>+{{ day.shifts.length - 3 }} ещё</span>
                  }
                </div>
              } @else {
                <span class="sa-coverage-empty">Смен нет</span>
              }
            </div>
          }
          @if (requestCoverageDays().length > 14) {
            <div class="sa-coverage-more">+{{ requestCoverageDays().length - 14 }} дат</div>
          }
        </div>
      </section>
    }

    <!-- Loading -->
    @if (loading()) {
      <div class="sa-loading glass-card">
        <mat-spinner diameter="32"></mat-spinner>
        <span>Загрузка заявок...</span>
      </div>
    } @else if (filteredRequests().length === 0) {
      <div class="sa-empty glass-card">
        <mat-icon>event_busy</mat-icon>
        <span>
          @if (statusFilter() === 'all') { Заявок пока нет }
          @else { Нет заявок с таким статусом }
        </span>
      </div>
    } @else {
      <!-- Bulk action bar -->
      @if (selectedIds().size > 0) {
        <div class="sa-bulk-bar glass-card">
          <span class="sa-bulk-count">Выбрано: {{ selectedIds().size }}</span>
          <button mat-flat-button class="sa-btn--bulk-approve" (click)="bulkApprove()" [disabled]="bulkLoading()">
            <mat-icon>check_circle</mat-icon> Утвердить все
          </button>
          <button mat-stroked-button (click)="clearSelection()">Сбросить</button>
        </div>
      }

      <div class="sa-cards-grid">
        @for (req of filteredRequests(); track req.id) {
          <div class="sa-card glass-card" [class.sa-card--pending]="req.status === 'pending' && !isAdminProposal(req)"
               [class.sa-card--proposed]="isAdminProposal(req)"
               [class.sa-card--approved]="req.status === 'approved'"
               [class.sa-card--rejected]="req.status === 'rejected'"
               [class.sa-card--revision]="req.status === 'revision_requested'">

            <!-- Bulk select checkbox -->
            @if ((req.status === 'pending' && !isAdminProposal(req)) || req.status === 'revision_requested') {
              <div class="sa-checkbox">
                <input type="checkbox" [checked]="selectedIds().has(req.id)"
                       (change)="toggleSelection(req.id)"
                       (click)="$event.stopPropagation()">
              </div>
            }

            <!-- Card header -->
            <div class="sa-card-header">
              <div class="sa-card-employee">
                <div class="sa-avatar">{{ initials(req.employee_name) }}</div>
                <div class="sa-employee-info">
                  <span class="sa-employee-name">{{ req.employee_name || 'Сотрудник' }}</span>
                  @if (req.employee_phone) {
                    <span class="sa-employee-phone">{{ req.employee_phone }}</span>
                  }
                </div>
              </div>
              <div class="sa-card-status" [class]="requestStatusClass(req)">
                <mat-icon>{{ requestStatusIcon(req) }}</mat-icon>
                {{ requestStatusLabel(req) }}
              </div>
            </div>

            <!-- Pattern & dates -->
            <div class="sa-card-meta">
              <span class="sa-pattern-badge">{{ patternLabel(req.shift_pattern) }}</span>
              <span class="sa-action-badge" [class.sa-action-badge--cancel]="requestAction(req) === 'cancel_shift'"
                    [class.sa-action-badge--change]="requestAction(req) === 'change_address'">
                {{ requestActionLabel(requestAction(req)) }}
              </span>
              <span class="sa-date-range">
                {{ formatDateShort(req.pattern_start_date) }}
                @if (req.end_date) { &mdash; {{ formatDateShort(req.end_date) }} }
              </span>
              <span class="sa-shifts-count">{{ req.requested_shifts.length || 0 }} смен</span>
              @if (isAdminProposal(req)) {
                <span class="sa-proposal-badge">Предложено {{ req.admin_name || 'администратором' }}</span>
              }
            </div>

            @if (requestLocationGroups(req).length > 0) {
              <div class="sa-location-list">
                @for (group of requestLocationGroups(req); track group.key) {
                  <div class="sa-location-row">
                    <mat-icon>place</mat-icon>
                    <strong>{{ group.label }}</strong>
                    <span>{{ group.datesLabel }}</span>
                    <em>{{ group.count }} {{ shiftWord(group.count) }}</em>
                  </div>
                }
              </div>
            }

            <!-- Mini calendar -->
            @if (req.requested_shifts && req.requested_shifts.length > 0) {
              <div class="sa-mini-calendar">
                @for (shift of req.requested_shifts.slice(0, 21); track shift.date) {
                  <div
                    class="sa-cal-day"
                    [class.sa-cal-day--cancel]="shift.action === 'cancel_shift'"
                    [class.sa-cal-day--change]="shift.action === 'change_address'"
                    [class.sa-cal-day--occupied]="sameAddressOccupancyCount(req, shift) > 0"
                    [matTooltip]="shiftTooltip(req, shift)"
                  >
                    <span class="sa-cal-weekday">{{ weekday(shift.date) }}</span>
                    <span class="sa-cal-date">{{ dayNum(shift.date) }}</span>
                    <span class="sa-cal-address">{{ shiftStudioShortLabel(shift) }}</span>
                    @if (sameAddressOccupancyCount(req, shift) > 0) {
                      <span class="sa-cal-occupancy">
                        <mat-icon>person</mat-icon>{{ sameAddressOccupancyCount(req, shift) }}
                      </span>
                    }
                  </div>
                }
                @if (req.requested_shifts.length > 21) {
                  <div class="sa-cal-more">+{{ req.requested_shifts.length - 21 }}</div>
                }
              </div>
            }

            <!-- Admin comment (if any) -->
            @if (req.admin_comment) {
              <div class="sa-admin-comment">
                <mat-icon>comment</mat-icon>
                <div>
                  @if (req.admin_name) { <span class="sa-comment-author">{{ req.admin_name }}:</span> }
                  {{ req.admin_comment }}
                </div>
              </div>
            }

            <!-- Created date -->
            <div class="sa-card-footer">
              <span class="sa-created">Создан {{ formatDateTime(req.created_at) }}</span>
            </div>

            <!-- Actions (only for pending/revision_requested) -->
            @if ((req.status === 'pending' && !isAdminProposal(req)) || req.status === 'revision_requested') {
              <div class="sa-card-actions">
                @if (actionRequestId() === req.id) {
                  <!-- Inline action form -->
                  <div class="sa-action-form">
                    @switch (actionMode()) {
                      @case ('approve') {
                        <div class="sa-action-title">
                          {{ requestAction(req) === 'cancel_shift' ? 'Подтвердите отмену смен' : (requestHasEveryShiftStudio(req) ? 'Адреса выбраны по дням' : 'Выберите студию') }}
                        </div>
                        @if (requestAction(req) !== 'cancel_shift' || !requestHasEveryShiftStudio(req)) {
                          <mat-form-field appearance="outline" class="sa-action-field">
                            <mat-label>{{ requestHasEveryShiftStudio(req) ? 'Единый адрес, если нужно заполнить' : 'Студия' }}</mat-label>
                            <mat-select [(ngModel)]="actionStudioId">
                              @for (s of studios(); track s.id) {
                                <mat-option [value]="s.id">{{ s.name }}</mat-option>
                              }
                            </mat-select>
                          </mat-form-field>
                        }
                        <div class="sa-action-btns">
                          <button class="btn-confirm btn-confirm--approve" [disabled]="!canConfirmApprove(req) || actionSaving()"
                                  (click)="confirmApprove(req)">
                            @if (actionSaving()) { <mat-spinner diameter="16"></mat-spinner> }
                            @else { <mat-icon>check</mat-icon> }
                            Утвердить
                          </button>
                          <button class="btn-cancel" (click)="cancelAction()">Отмена</button>
                        </div>
                      }
                      @case ('reject') {
                        <div class="sa-action-title">Причина отклонения</div>
                        <mat-form-field appearance="outline" class="sa-action-field">
                          <mat-label>Комментарий</mat-label>
                          <textarea matInput [(ngModel)]="actionComment" rows="2"
                                    placeholder="Укажите причину отклонения"></textarea>
                        </mat-form-field>
                        <div class="sa-action-btns">
                          <button class="btn-confirm btn-confirm--reject" [disabled]="!actionComment() || actionSaving()"
                                  (click)="confirmReject(req.id)">
                            @if (actionSaving()) { <mat-spinner diameter="16"></mat-spinner> }
                            @else { <mat-icon>close</mat-icon> }
                            Отклонить
                          </button>
                          <button class="btn-cancel" (click)="cancelAction()">Отмена</button>
                        </div>
                      }
                      @case ('revision') {
                        <div class="sa-action-title">Что нужно исправить?</div>
                        <mat-form-field appearance="outline" class="sa-action-field">
                          <mat-label>Комментарий (обязательно)</mat-label>
                          <textarea matInput [(ngModel)]="actionComment" rows="2"
                                    placeholder="Опишите, что нужно доработать"></textarea>
                        </mat-form-field>
                        <div class="sa-action-btns">
                          <button class="btn-confirm btn-confirm--revision" [disabled]="!actionComment() || actionSaving()"
                                  (click)="confirmRevision(req.id)">
                            @if (actionSaving()) { <mat-spinner diameter="16"></mat-spinner> }
                            @else { <mat-icon>edit_note</mat-icon> }
                            На доработку
                          </button>
                          <button class="btn-cancel" (click)="cancelAction()">Отмена</button>
                        </div>
                      }
                    }
                  </div>
                } @else {
                  <!-- Action buttons row -->
                  <button class="sa-btn sa-btn--approve" (click)="startAction(req.id, 'approve')"
                          matTooltip="Утвердить запрос">
                    <mat-icon>check_circle</mat-icon> Утвердить
                  </button>
                  <button class="sa-btn sa-btn--reject" (click)="startAction(req.id, 'reject')"
                          matTooltip="Отклонить запрос">
                    <mat-icon>cancel</mat-icon> Отклонить
                  </button>
                  <button class="sa-btn sa-btn--revision" (click)="startAction(req.id, 'revision')"
                          matTooltip="Запросить доработку">
                    <mat-icon>edit_note</mat-icon> Доработка
                  </button>
                }
              </div>
            } @else if (isAdminProposal(req) && req.status === 'pending') {
              <div class="sa-proposal-waiting">
                <mat-icon>schedule_send</mat-icon>
                Ждём, когда сотрудник согласится или откажется
              </div>
            }
          </div>
        }
      </div>
    }
  }

  <!-- TAB 2: Assign shift -->
  @if (activeTab() === 'assign') {
    <div class="sa-assign glass-card">
      <div class="sa-assign-title">
        <mat-icon>add_task</mat-icon>
        <h2>{{ assignMode() === 'proposal' ? 'Предложить смены сотруднику' : 'Назначить смену вручную' }}</h2>
      </div>
      <p class="sa-assign-subtitle">
        {{ assignMode() === 'proposal' ? 'Сотрудник увидит предложение и сможет согласиться или отказаться' : 'Создание смен напрямую без подтверждения сотрудника' }}
      </p>

      <div class="sa-mode-toggle">
        <button type="button" [class.sa-mode-toggle__btn--active]="assignMode() === 'proposal'"
                class="sa-mode-toggle__btn" (click)="assignMode.set('proposal')">
          <mat-icon>outgoing_mail</mat-icon>
          Предложить
        </button>
        <button type="button" [class.sa-mode-toggle__btn--active]="assignMode() === 'direct'"
                class="sa-mode-toggle__btn" (click)="assignMode.set('direct')">
          <mat-icon>event_available</mat-icon>
          Назначить сразу
        </button>
      </div>

      <div class="sa-form-grid">
        <!-- Employee -->
        <mat-form-field appearance="outline" class="sa-form-full">
          <mat-label>Сотрудник</mat-label>
          <mat-select [(ngModel)]="assignEmployeeId">
            @for (emp of activeEmployees(); track emp.id) {
              <mat-option [value]="emp.id">{{ emp.display_name }}
                @if (emp.phone) { ({{ emp.phone }}) }
              </mat-option>
            }
          </mat-select>
        </mat-form-field>

        <!-- Studio -->
        <mat-form-field appearance="outline" class="sa-form-full">
          <mat-label>Студия</mat-label>
          <mat-select [(ngModel)]="assignStudioId">
            @for (s of studios(); track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <!-- Dates -->
        <div class="sa-dates-section">
          <span class="sa-field-label">Даты смен</span>
          <div class="sa-dates-input-row">
            <mat-form-field appearance="outline">
              <mat-label>Добавить дату</mat-label>
              <input matInput type="date" [(ngModel)]="assignDateInput" [min]="todayStr()">
            </mat-form-field>
            <button class="btn-primary btn-sm" [disabled]="!assignDateInput()"
                    (click)="addAssignDate()">
              <mat-icon>add</mat-icon> Добавить
            </button>
          </div>
          @if (assignDates().length > 0) {
            <div class="sa-selected-dates">
              @for (d of assignDates(); track d) {
                <span class="sa-date-chip">
                  {{ formatDateShort(d) }}
                  <button class="sa-chip-remove" (click)="removeAssignDate(d)">
                    <mat-icon>close</mat-icon>
                  </button>
                </span>
              }
            </div>
          }
        </div>

        @if (assignCoverageDays().length > 0) {
          <div class="sa-assign-coverage">
            <div class="sa-field-label">Кто уже работает в выбранные дни</div>
            @for (day of assignCoverageDays(); track day.date) {
              <div class="sa-assign-coverage-row" [class.sa-assign-coverage-row--busy]="day.shifts.length > 0">
                <span>{{ formatDateShort(day.date) }}</span>
                @if (day.shifts.length > 0) {
                  <div>
                    @for (shift of day.shifts; track shift.id) {
                      <strong>{{ shiftEmployeeLabel(shift) }} · {{ studioName(shift.studio_id) }}</strong>
                    }
                  </div>
                } @else {
                  <em>Смен нет</em>
                }
              </div>
            }
          </div>
        }

        <!-- Time -->
        <div class="sa-time-row">
          <mat-form-field appearance="outline">
            <mat-label>Начало</mat-label>
            <input matInput type="time" [(ngModel)]="assignStartTime">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Конец</mat-label>
            <input matInput type="time" [(ngModel)]="assignEndTime">
          </mat-form-field>
        </div>

        @if (assignMode() === 'proposal') {
          <mat-form-field appearance="outline" class="sa-form-full">
            <mat-label>Комментарий для сотрудника</mat-label>
            <textarea matInput [(ngModel)]="assignComment" rows="2"
                      placeholder="Например: нужны эти дни на Баррикадной"></textarea>
          </mat-form-field>
        }
      </div>

      <div class="sa-assign-actions">
        <button class="btn-primary btn-lg" [disabled]="!canAssign() || assignSaving()"
                (click)="submitAssign()">
          @if (assignSaving()) {
            <mat-spinner diameter="18"></mat-spinner>
          } @else {
            <mat-icon>event_available</mat-icon>
          }
          {{ assignMode() === 'proposal' ? 'Предложить' : 'Назначить' }} {{ assignDates().length }} {{ shiftWord(assignDates().length) }}
        </button>
      </div>
    </div>
  }

</div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
    }

    .sa-page {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 960px;
    }

    /* ── Glass card base ── */
    .glass-card {
      background: var(--crm-gradient-card, rgba(30, 30, 36, 0.85));
      backdrop-filter: blur(var(--crm-glass-blur, 16px));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur, 16px));
      border-radius: var(--crm-radius-lg, 12px);
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.06));
      box-shadow: var(--crm-shadow-card, 0 2px 12px rgba(0, 0, 0, 0.3));
    }

    /* ── Header ── */
    .sa-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .sa-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .sa-header-icon {
      color: var(--crm-accent, #f59e0b);
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .sa-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
      margin: 0;
      font-family: var(--crm-font-sans, inherit);
    }

    .sa-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      border-radius: 11px;
      background: var(--crm-status-warning, #f59e0b);
      color: #000;
      font-size: 12px;
      font-weight: 700;
      font-family: var(--crm-font-mono, monospace);
    }

    /* ── Top tabs ── */
    .sa-top-tabs {
      display: flex;
      gap: 4px;
    }

    .sa-top-tab {
      display: flex;
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

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        background: rgba(255, 255, 255, 0.04);
        color: var(--crm-text-primary, #f0f0f0);
      }

      &--active {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05));
        border-color: rgba(245, 158, 11, 0.3);
        color: var(--crm-accent, #f59e0b);

        mat-icon { color: var(--crm-accent, #f59e0b); }
      }
    }

    /* ── Status filter tabs ── */
    .sa-filters {
      display: flex;
      gap: 2px;
      padding: 6px;
      overflow-x: auto;
    }

    .sa-filter-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: none;
      border-radius: var(--crm-radius-sm, 6px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;

      &:hover { background: rgba(255, 255, 255, 0.04); }

      &--active {
        background: rgba(255, 255, 255, 0.08);
        color: var(--crm-text-primary, #f0f0f0);
      }
    }

    .sa-filter-count {
      font-size: 11px;
      font-weight: 600;
      color: var(--crm-text-muted, #707070);
      font-family: var(--crm-font-mono, monospace);
    }

    .sa-filter-tab--active .sa-filter-count {
      color: var(--crm-accent, #f59e0b);
    }

    .sa-section-kicker {
      display: block;
      margin-bottom: 2px;
      color: var(--crm-text-muted, #707070);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .sa-coverage {
      padding: 12px 14px;
    }

    .sa-coverage-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      color: var(--crm-text-primary, #f0f0f0);
      font-size: 13px;
    }

    .sa-coverage-days {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
    }

    .sa-coverage-day {
      display: grid;
      gap: 4px;
      min-height: 74px;
      padding: 9px 10px;
      border: 1px solid rgba(245, 158, 11, 0.2);
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(245, 158, 11, 0.06);
    }

    .sa-coverage-day--empty {
      border-color: var(--crm-border, rgba(255, 255, 255, 0.08));
      background: rgba(255, 255, 255, 0.025);
    }

    .sa-coverage-date {
      color: var(--crm-text-primary, #f0f0f0);
      font-size: 13px;
      font-weight: 700;
    }

    .sa-coverage-count,
    .sa-coverage-empty,
    .sa-coverage-more {
      color: var(--crm-text-muted, #707070);
      font-size: 11px;
    }

    .sa-coverage-staff {
      display: grid;
      gap: 2px;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 11px;
      line-height: 1.25;
    }

    .sa-coverage-staff span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sa-coverage-more {
      align-self: center;
      justify-self: start;
      padding: 6px 10px;
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(255, 255, 255, 0.04);
    }

    /* ── Loading & empty ── */
    .sa-loading, .sa-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 40px 20px;
      color: var(--crm-text-muted, #707070);
      font-size: 14px;
    }

    .sa-empty mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      opacity: 0.5;
    }

    /* ── Cards grid ── */
    .sa-cards-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ── Request card ── */
    .sa-card {
      padding: 16px;
      transition: border-color 0.2s;
    }

    .sa-card--pending { border-left: 3px solid var(--crm-status-warning, #f59e0b); }
    .sa-card--proposed { border-left: 3px solid var(--crm-status-info, #3b82f6); }
    .sa-card--approved { border-left: 3px solid var(--crm-status-success, #22c55e); }
    .sa-card--rejected { border-left: 3px solid var(--crm-status-error, #ef4444); }
    .sa-card--revision { border-left: 3px solid var(--crm-status-info, #3b82f6); }

    .sa-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      gap: 8px;
      flex-wrap: wrap;
    }

    .sa-card-employee {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .sa-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(245, 158, 11, 0.1));
      color: var(--crm-accent, #f59e0b);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .sa-employee-info {
      display: flex;
      flex-direction: column;
    }

    .sa-employee-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
    }

    .sa-employee-phone {
      font-size: 12px;
      color: var(--crm-text-muted, #707070);
      font-family: var(--crm-font-mono, monospace);
    }

    .sa-card-status {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--crm-radius-sm, 6px);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;

      mat-icon {
        font-size: 15px;
        width: 15px;
        height: 15px;
      }
    }

    .sa-status--pending {
      background: var(--crm-status-warning-container, rgba(245, 158, 11, 0.12));
      color: var(--crm-status-warning, #f59e0b);
    }
    .sa-status--approved {
      background: var(--crm-status-success-container, rgba(34, 197, 94, 0.12));
      color: var(--crm-status-success, #22c55e);
    }
    .sa-status--rejected {
      background: var(--crm-status-error-container, rgba(239, 68, 68, 0.12));
      color: var(--crm-status-error, #ef4444);
    }
    .sa-status--revision_requested {
      background: var(--crm-status-info-container, rgba(59, 130, 246, 0.12));
      color: var(--crm-status-info, #3b82f6);
    }
    .sa-status--proposed {
      background: var(--crm-status-info-container, rgba(59, 130, 246, 0.12));
      color: var(--crm-status-info, #3b82f6);
    }

    /* ── Card meta ── */
    .sa-card-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    .sa-pattern-badge {
      padding: 3px 10px;
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(245, 158, 11, 0.1);
      color: var(--crm-accent, #f59e0b);
      font-size: 12px;
      font-weight: 600;
    }

    .sa-action-badge {
      padding: 3px 10px;
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(34, 197, 94, 0.1);
      color: var(--crm-status-success, #22c55e);
      font-size: 12px;
      font-weight: 600;
    }

    .sa-action-badge--change {
      background: rgba(59, 130, 246, 0.12);
      color: var(--crm-status-info, #3b82f6);
    }

    .sa-action-badge--cancel {
      background: rgba(239, 68, 68, 0.12);
      color: var(--crm-status-error, #ef4444);
    }

    .sa-date-range {
      font-size: 13px;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    .sa-shifts-count {
      font-size: 12px;
      color: var(--crm-text-muted, #707070);
      background: rgba(255, 255, 255, 0.04);
      padding: 2px 8px;
      border-radius: 10px;
      font-family: var(--crm-font-mono, monospace);
    }

    .sa-proposal-badge {
      font-size: 12px;
      color: var(--crm-status-info, #3b82f6);
      background: rgba(59, 130, 246, 0.1);
      padding: 2px 8px;
      border-radius: 10px;
    }

    .sa-location-list {
      display: grid;
      gap: 6px;
      margin-bottom: 10px;
    }

    .sa-location-row {
      display: grid;
      grid-template-columns: 18px minmax(130px, 1fr) minmax(120px, 1.4fr) auto;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(255, 255, 255, 0.025);
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 12px;
    }

    .sa-location-row mat-icon {
      color: var(--crm-accent, #f59e0b);
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .sa-location-row strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-primary, #f0f0f0);
      font-size: 13px;
    }

    .sa-location-row span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sa-location-row em {
      color: var(--crm-text-muted, #707070);
      font-style: normal;
      white-space: nowrap;
    }

    /* ── Mini calendar ── */
    .sa-mini-calendar {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      margin-bottom: 10px;
    }

    .sa-cal-day {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 3px 6px;
      border-radius: 4px;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.2);
      min-width: 58px;
      min-height: 50px;
      cursor: default;
      position: relative;
    }

    .sa-cal-day--change {
      background: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.28);
    }

    .sa-cal-day--cancel {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.28);
    }

    .sa-cal-day--occupied {
      border-color: rgba(245, 158, 11, 0.75);
      box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.18);
    }

    .sa-cal-weekday {
      font-size: 9px;
      font-weight: 600;
      color: var(--crm-text-muted, #707070);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .sa-cal-date {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
      font-family: var(--crm-font-mono, monospace);
    }

    .sa-cal-address {
      width: 100%;
      max-width: 64px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-muted, #707070);
      font-size: 9px;
      text-align: center;
    }

    .sa-cal-occupancy {
      position: absolute;
      right: 2px;
      top: 2px;
      display: inline-flex;
      align-items: center;
      gap: 1px;
      padding: 1px 3px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.18);
      color: var(--crm-status-warning, #f59e0b);
      font-size: 9px;
      font-weight: 700;
      line-height: 1;
    }

    .sa-cal-occupancy mat-icon {
      font-size: 10px;
      width: 10px;
      height: 10px;
    }

    .sa-cal-more {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.04);
      font-size: 11px;
      font-weight: 600;
      color: var(--crm-text-muted, #707070);
    }

    /* ── Admin comment ── */
    .sa-admin-comment {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      font-size: 13px;
      color: var(--crm-text-secondary, #a0a0a0);
      margin-bottom: 8px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-text-muted, #707070);
        flex-shrink: 0;
        margin-top: 1px;
      }
    }

    .sa-comment-author {
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
      margin-right: 4px;
    }

    /* ── Card footer ── */
    .sa-card-footer {
      margin-bottom: 8px;
    }

    .sa-created {
      font-size: 11px;
      color: var(--crm-text-muted, #707070);
    }

    /* ── Card actions ── */
    .sa-card-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      flex-wrap: wrap;
    }

    .sa-proposal-waiting {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(59, 130, 246, 0.1);
      color: var(--crm-status-info, #3b82f6);
      font-size: 12px;
      font-weight: 600;
    }

    .sa-proposal-waiting mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .sa-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 14px;
      border: 1px solid transparent;
      border-radius: var(--crm-radius-sm, 6px);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      background: transparent;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .sa-btn--approve {
      color: var(--crm-status-success, #22c55e);
      border-color: rgba(34, 197, 94, 0.25);
      &:hover { background: rgba(34, 197, 94, 0.1); }
    }

    .sa-btn--reject {
      color: var(--crm-status-error, #ef4444);
      border-color: rgba(239, 68, 68, 0.25);
      &:hover { background: rgba(239, 68, 68, 0.1); }
    }

    .sa-btn--revision {
      color: var(--crm-status-warning, #f59e0b);
      border-color: rgba(245, 158, 11, 0.25);
      &:hover { background: rgba(245, 158, 11, 0.1); }
    }

    /* ── Action form (inline) ── */
    .sa-action-form {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sa-action-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary, #a0a0a0);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .sa-action-field {
      width: 100%;
    }

    .sa-action-btns {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .btn-confirm {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 16px;
      border: none;
      border-radius: var(--crm-radius-sm, 6px);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      transition: opacity 0.15s;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }

    .btn-confirm--approve { background: var(--crm-status-success, #22c55e); }
    .btn-confirm--reject { background: var(--crm-status-error, #ef4444); }
    .btn-confirm--revision { background: var(--crm-status-info, #3b82f6); }

    .btn-cancel {
      padding: 7px 14px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.1));
      border-radius: var(--crm-radius-sm, 6px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;

      &:hover { background: rgba(255, 255, 255, 0.04); }
    }

    /* ── TAB 2: Assign ── */
    .sa-assign {
      padding: 20px;
    }

    .sa-assign-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 4px;

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
        color: var(--crm-accent, #f59e0b);
      }

      h2 {
        font-size: 16px;
        font-weight: 600;
        color: var(--crm-text-primary, #f0f0f0);
        margin: 0;
      }
    }

    .sa-assign-subtitle {
      font-size: 13px;
      color: var(--crm-text-muted, #707070);
      margin: 0 0 20px;
    }

    .sa-mode-toggle {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      margin-bottom: 16px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--crm-radius-md, 8px);
      background: rgba(255, 255, 255, 0.03);
    }

    .sa-mode-toggle__btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 6px 12px;
      border: 1px solid transparent;
      border-radius: var(--crm-radius-sm, 6px);
      background: transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    .sa-mode-toggle__btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .sa-mode-toggle__btn--active {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.28);
      color: var(--crm-accent, #f59e0b);
    }

    .sa-form-grid {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .sa-form-full { width: 100%; }

    .sa-field-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary, #a0a0a0);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 8px;
    }

    .sa-dates-section {
      margin-bottom: 12px;
    }

    .sa-dates-input-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .sa-dates-input-row mat-form-field {
      flex: 1;
    }

    .sa-selected-dates {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .sa-date-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.2);
      color: var(--crm-accent, #f59e0b);
      font-size: 12px;
      font-weight: 600;
      font-family: var(--crm-font-mono, monospace);
    }

    .sa-chip-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      color: var(--crm-accent, #f59e0b);
      cursor: pointer;
      padding: 0;
      opacity: 0.6;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }

      &:hover { opacity: 1; }
    }

    .sa-time-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .sa-assign-coverage {
      display: grid;
      gap: 6px;
      margin-bottom: 12px;
    }

    .sa-assign-coverage-row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 8px 10px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(255, 255, 255, 0.025);
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 12px;
    }

    .sa-assign-coverage-row--busy {
      border-color: rgba(245, 158, 11, 0.25);
      background: rgba(245, 158, 11, 0.06);
    }

    .sa-assign-coverage-row > span {
      color: var(--crm-text-primary, #f0f0f0);
      font-weight: 700;
    }

    .sa-assign-coverage-row div {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .sa-assign-coverage-row strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 600;
    }

    .sa-assign-coverage-row em {
      color: var(--crm-text-muted, #707070);
      font-style: normal;
    }

    .sa-assign-actions {
      margin-top: 16px;
      display: flex;
      justify-content: flex-end;
    }

    /* ── Shared buttons ── */
    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      border: none;
      border-radius: var(--crm-radius-sm, 6px);
      background: var(--crm-accent, #f59e0b);
      color: #000;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      &:not(:disabled):hover { opacity: 0.85; }
    }

    .btn-sm { padding: 6px 12px; font-size: 12px; }

    .btn-lg { padding: 10px 24px; font-size: 14px; }

    /* ── Bulk operations ── */
    .sa-bulk-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border: 1px solid var(--crm-accent, #f59e0b);
    }

    .sa-bulk-count {
      font-weight: 600;
      font-size: 13px;
      color: var(--crm-text-primary, #f0f0f0);
    }

    .sa-btn--bulk-approve {
      background: var(--crm-status-success, #22c55e) !important;
      color: #fff !important;
    }

    .sa-checkbox {
      cursor: pointer;
      display: flex;
      align-items: center;
      margin-bottom: 8px;

      input {
        width: 16px;
        height: 16px;
        cursor: pointer;
        accent-color: var(--crm-accent, #f59e0b);
      }
    }

    /* ── Responsive ── */
    @media (max-width: 600px) {
      .sa-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .sa-top-tabs { width: 100%; }

      .sa-top-tab { flex: 1; justify-content: center; }

      .sa-card-header { flex-direction: column; align-items: flex-start; }

      .sa-time-row { grid-template-columns: 1fr; }

      .sa-location-row {
        grid-template-columns: 18px minmax(0, 1fr);
      }

      .sa-location-row span,
      .sa-location-row em {
        grid-column: 2;
      }

      .sa-mode-toggle {
        width: 100%;
      }

      .sa-mode-toggle__btn {
        flex: 1;
        justify-content: center;
      }

      .sa-assign-coverage-row {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class ScheduleApprovalsComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly usersApi = inject(UsersApiService);
  private readonly snackBar = inject(MatSnackBar);

  // Data
  readonly requests = signal<ScheduleRequest[]>([]);
  readonly studios = signal<ShiftStudio[]>([]);
  readonly employees = signal<StaffUser[]>([]);
  readonly coverageShifts = signal<EmployeeShift[]>([]);
  readonly loading = signal(false);
  readonly coverageLoading = signal(false);

  // UI state
  readonly activeTab = signal<ActiveTab>('requests');
  readonly statusFilter = signal<StatusFilter>('all');

  // Action state (approve / reject / revision)
  readonly actionRequestId = signal<string | null>(null);
  readonly actionMode = signal<'approve' | 'reject' | 'revision' | null>(null);
  readonly actionStudioId = signal<string>('');
  readonly actionComment = signal<string>('');
  readonly actionSaving = signal(false);

  // Bulk selection state
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly bulkLoading = signal(false);

  // Assign form state
  readonly assignMode = signal<AssignMode>('proposal');
  readonly assignEmployeeId = signal<string>('');
  readonly assignStudioId = signal<string>('');
  readonly assignDates = signal<string[]>([]);
  readonly assignDateInput = signal<string>('');
  readonly assignStartTime = signal<string>('09:00');
  readonly assignEndTime = signal<string>('19:30');
  readonly assignComment = signal<string>('');
  readonly assignSaving = signal(false);

  // Computed
  readonly pendingCount = computed(() =>
    this.requests().filter(r => r.status === 'pending' && !this.isAdminProposal(r)).length,
  );

  readonly filteredRequests = computed(() => {
    const filter = this.statusFilter();
    const all = this.requests();
    if (filter === 'all') return all;
    if (filter === 'proposed') return all.filter(r => this.isAdminProposal(r));
    if (filter === 'pending') return all.filter(r => r.status === 'pending' && !this.isAdminProposal(r));
    return all.filter(r => r.status === filter);
  });

  readonly activeEmployees = computed(() =>
    this.employees().filter(e => e.is_active && e.role !== 'client'),
  );

  readonly todayStr = computed(() => toYMD(new Date()));

  readonly studioMap = computed(() => new Map(this.studios().map(studio => [studio.id, studio])));

  readonly coverageByDate = computed(() => {
    const map = new Map<string, EmployeeShift[]>();
    for (const shift of this.coverageShifts()) {
      if (shift.status === 'cancelled') continue;
      const date = this.shiftDateKey(shift);
      map.set(date, [...(map.get(date) ?? []), shift]);
    }
    for (const [date, shifts] of map) {
      map.set(date, shifts.sort((a, b) =>
        this.studioName(a.studio_id).localeCompare(this.studioName(b.studio_id), 'ru')
        || this.shiftEmployeeLabel(a).localeCompare(this.shiftEmployeeLabel(b), 'ru'),
      ));
    }
    return map;
  });

  readonly requestCoverageDays = computed((): CoverageDay[] => {
    const counts = new Map<string, number>();
    for (const request of this.filteredRequests()) {
      for (const shift of request.requested_shifts) {
        counts.set(shift.date, (counts.get(shift.date) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, requestedCount]) => ({
        date,
        requestedCount,
        shifts: this.coverageByDate().get(date) ?? [],
      }));
  });

  readonly assignCoverageDays = computed((): CoverageDay[] =>
    this.assignDates().map(date => ({
      date,
      requestedCount: 0,
      shifts: (this.coverageByDate().get(date) ?? [])
        .filter(shift => !this.assignStudioId() || shift.studio_id === this.assignStudioId()),
    })),
  );

  readonly canAssign = computed(() =>
    !!this.assignEmployeeId()
    && !!this.assignStudioId()
    && this.assignDates().length > 0
    && !!this.assignStartTime()
    && !!this.assignEndTime(),
  );

  // Filter tabs config
  readonly statusFilters = [
    { value: 'all' as StatusFilter, label: 'Все', count: computed(() => this.requests().length) },
    { value: 'pending' as StatusFilter, label: 'На рассмотрении', count: computed(() => this.requests().filter(r => r.status === 'pending' && !this.isAdminProposal(r)).length) },
    { value: 'proposed' as StatusFilter, label: 'Предложено', count: computed(() => this.requests().filter(r => this.isAdminProposal(r)).length) },
    { value: 'approved' as StatusFilter, label: 'Утверждённые', count: computed(() => this.requests().filter(r => r.status === 'approved').length) },
    { value: 'rejected' as StatusFilter, label: 'Отклонённые', count: computed(() => this.requests().filter(r => r.status === 'rejected').length) },
    { value: 'revision_requested' as StatusFilter, label: 'Доработка', count: computed(() => this.requests().filter(r => r.status === 'revision_requested').length) },
  ];

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadRequests();
      this.loadStudios();
      this.loadEmployees();
    }
  }

  // ===== Data loading =====

  loadRequests(): void {
    this.loading.set(true);
    this.shiftsApi.getScheduleRequests().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.requests.set(res.data);
          this.refreshCoverage();
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Не удалось загрузить заявки', 'OK', { duration: 4000 });
      },
    });
  }

  private loadStudios(): void {
    this.shiftsApi.getShiftStudios().subscribe({
      next: res => this.studios.set(res.data ?? []),
    });
  }

  private loadEmployees(): void {
    this.usersApi.getUsers({ is_active: true }).subscribe({
      next: (users) => this.employees.set(users.filter(u => u.role !== 'client')),
    });
  }

  // ===== Actions =====

  startAction(requestId: string, mode: 'approve' | 'reject' | 'revision'): void {
    this.actionRequestId.set(requestId);
    this.actionMode.set(mode);
    this.actionStudioId.set('');
    this.actionComment.set('');
  }

  cancelAction(): void {
    this.actionRequestId.set(null);
    this.actionMode.set(null);
    this.actionStudioId.set('');
    this.actionComment.set('');
  }

  requestHasEveryShiftStudio(request: ScheduleRequest): boolean {
    return request.requested_shifts.length > 0
      && request.requested_shifts.every(shift =>
        shift.action === 'cancel_shift' || (typeof shift.studio_id === 'string' && shift.studio_id.length > 0),
      );
  }

  canConfirmApprove(request: ScheduleRequest): boolean {
    return this.requestHasEveryShiftStudio(request) || this.actionStudioId().length > 0;
  }

  confirmApprove(request: ScheduleRequest): void {
    const studioId = this.actionStudioId();
    if (!studioId && !this.requestHasEveryShiftStudio(request)) return;
    this.actionSaving.set(true);

    this.shiftsApi.approveScheduleRequest(request.id, studioId || undefined).subscribe({
      next: (res) => {
        this.actionSaving.set(false);
        if (res.success) {
          this.snackBar.open('Запрос утверждён', 'OK', { duration: 3000 });
          this.cancelAction();
          this.loadRequests();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.actionSaving.set(false);
        this.snackBar.open(err?.error?.message || 'Ошибка при утверждении', 'OK', { duration: 5000 });
      },
    });
  }

  confirmReject(requestId: string): void {
    const comment = this.actionComment();
    if (!comment) return;
    this.actionSaving.set(true);

    this.shiftsApi.rejectScheduleRequest(requestId, comment).subscribe({
      next: (res) => {
        this.actionSaving.set(false);
        if (res.success) {
          this.snackBar.open('Запрос отклонён', 'OK', { duration: 3000 });
          this.cancelAction();
          this.loadRequests();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.actionSaving.set(false);
        this.snackBar.open(err?.error?.message || 'Ошибка при отклонении', 'OK', { duration: 5000 });
      },
    });
  }

  confirmRevision(requestId: string): void {
    const comment = this.actionComment();
    if (!comment) return;
    this.actionSaving.set(true);

    this.shiftsApi.requestRevision(requestId, comment).subscribe({
      next: (res) => {
        this.actionSaving.set(false);
        if (res.success) {
          this.snackBar.open('Отправлено на доработку', 'OK', { duration: 3000 });
          this.cancelAction();
          this.loadRequests();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.actionSaving.set(false);
        this.snackBar.open(err?.error?.message || 'Ошибка', 'OK', { duration: 5000 });
      },
    });
  }

  // ===== Assign shift =====

  addAssignDate(): void {
    const dateVal = this.assignDateInput();
    if (!dateVal) return;
    const current = this.assignDates();
    if (current.includes(dateVal)) return;
    this.assignDates.set([...current, dateVal].sort());
    this.assignDateInput.set('');
    this.refreshCoverage();
  }

  removeAssignDate(date: string): void {
    this.assignDates.set(this.assignDates().filter(d => d !== date));
    this.refreshCoverage();
  }

  submitAssign(): void {
    if (!this.canAssign()) return;
    this.assignSaving.set(true);

    const shifts: Partial<EmployeeShift>[] = this.assignDates().map(date => ({
      employee_id: this.assignEmployeeId(),
      studio_id: this.assignStudioId(),
      shift_date: date,
      start_time: this.assignStartTime(),
      end_time: this.assignEndTime(),
    }));

    if (this.assignMode() === 'proposal') {
      this.shiftsApi.proposeScheduleRequest({
        employee_id: this.assignEmployeeId(),
        comment: this.assignComment() || undefined,
        requested_shifts: shifts.map(shift => ({
          date: shift.shift_date ?? '',
          start_time: shift.start_time ?? '',
          end_time: shift.end_time ?? '',
          studio_id: shift.studio_id,
          action: 'work',
        })),
      }).subscribe({
        next: (res) => {
          this.assignSaving.set(false);
          if (res.success) {
            this.snackBar.open(
              `${shifts.length} ${this.shiftWord(shifts.length)} предложено сотруднику`,
              'OK',
              { duration: 3500 },
            );
            this.assignDates.set([]);
            this.assignComment.set('');
            this.loadRequests();
          }
        },
        error: (err: { error?: { message?: string } }) => {
          this.assignSaving.set(false);
          this.snackBar.open(err?.error?.message || 'Ошибка при отправке предложения', 'OK', { duration: 5000 });
        },
      });
      return;
    }

    const obs: Observable<ApiResponse<unknown>> = shifts.length === 1
      ? this.shiftsApi.createShift(shifts[0]).pipe(map(r => ({ ...r, data: r.data as unknown })))
      : this.shiftsApi.createBulk(shifts).pipe(map(r => ({ ...r, data: r.data as unknown })));

    obs.subscribe({
      next: (res) => {
        this.assignSaving.set(false);
        if (res.success) {
          this.snackBar.open(
            `${shifts.length} ${this.shiftWord(shifts.length)} назначено`,
            'OK',
            { duration: 3000 },
          );
          this.assignDates.set([]);
          this.refreshCoverage();
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.assignSaving.set(false);
        this.snackBar.open(err?.error?.message || 'Ошибка при создании смен', 'OK', { duration: 5000 });
      },
    });
  }

  // ===== Bulk operations =====

  toggleSelection(id: string): void {
    this.selectedIds.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  bulkApprove(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;

    const studioId = this.studios()[0]?.id;
    if (!studioId) {
      this.snackBar.open('Нет доступных студий', 'OK', { duration: 3000 });
      return;
    }

    this.bulkLoading.set(true);
    this.shiftsApi.bulkApproveRequests(ids, studioId).subscribe({
      next: (res) => {
        this.bulkLoading.set(false);
        if (res.success && res.data) {
          this.snackBar.open(
            `Утверждено: ${res.data.approved}, применено ${res.data.total_shifts_created} действий`,
            'OK', { duration: 5000 },
          );
          this.clearSelection();
          this.loadRequests();
        }
      },
      error: () => {
        this.bulkLoading.set(false);
        this.snackBar.open('Ошибка массового утверждения', 'OK', { duration: 3000 });
      },
    });
  }

  // ===== Helpers =====

  initials(name: string | undefined): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  patternLabel(pattern: string): string {
    return PATTERN_LABELS[pattern] || pattern;
  }

  isAdminProposal(request: ScheduleRequest): boolean {
    return request.admin_id != null && request.admin_id !== '';
  }

  requestStatusLabel(request: ScheduleRequest): string {
    if (!this.isAdminProposal(request)) return STATUS_LABELS[request.status] || request.status;
    if (request.status === 'pending') return 'Ожидает сотрудника';
    if (request.status === 'approved') return 'Сотрудник согласился';
    if (request.status === 'rejected') return 'Сотрудник отказался';
    return STATUS_LABELS[request.status] || request.status;
  }

  requestStatusIcon(request: ScheduleRequest): string {
    if (this.isAdminProposal(request) && request.status === 'pending') return 'schedule_send';
    return STATUS_ICONS[request.status] || 'help_outline';
  }

  requestStatusClass(request: ScheduleRequest): string {
    const status = this.isAdminProposal(request) && request.status === 'pending' ? 'proposed' : request.status;
    return `sa-status--${status}`;
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

  shiftTooltip(request: ScheduleRequest, shift: ScheduleRequestedShift): string {
    const action = shift.action ?? 'work';
    const label = this.requestActionLabel(action);
    const studioId = this.requestedShiftStudioId(shift);
    const occupancy = this.sameAddressOccupants(request, shift);
    const occupiedText = occupancy.length > 0
      ? `\nУже работают: ${occupancy.map(s => this.shiftEmployeeLabel(s)).join(', ')}`
      : '\nНа этом адресе смен нет';
    return `${label}: ${shift.date} ${shift.start_time}-${shift.end_time}\n${studioId ? this.studioLabel(studioId) : 'Адрес не выбран'}${occupiedText}`;
  }

  shiftStudioShortLabel(shift: ScheduleRequestedShift): string {
    const studioId = this.requestedShiftStudioId(shift);
    if (!studioId) return 'Адрес?';
    const studio = this.studioMap().get(studioId);
    return studio?.location_code || studio?.name || 'Адрес';
  }

  sameAddressOccupancyCount(request: ScheduleRequest, shift: ScheduleRequestedShift): number {
    return this.sameAddressOccupants(request, shift).length;
  }

  sameAddressOccupants(_request: ScheduleRequest, shift: ScheduleRequestedShift): EmployeeShift[] {
    const studioId = this.requestedShiftStudioId(shift);
    if (!studioId) return [];
    return (this.coverageByDate().get(shift.date) ?? []).filter(coverageShift => coverageShift.studio_id === studioId);
  }

  shiftEmployeeLabel(shift: EmployeeShift): string {
    return shift.employee_name || shift.employee_phone || 'Сотрудник';
  }

  studioName(studioId: string): string {
    const studio = this.studioMap().get(studioId);
    return studio?.name || studioId;
  }

  studioLabel(studioId: string): string {
    const studio = this.studioMap().get(studioId);
    if (!studio) return studioId;
    if (studio.address) return `${studio.name} · ${studio.address}`;
    return studio.name;
  }

  shiftDateKey(shift: EmployeeShift): string {
    if (shift.shift_date.length >= 10) return shift.shift_date.slice(0, 10);
    return toYMD(new Date(shift.shift_date));
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

  private refreshCoverage(): void {
    const dates = new Set<string>();
    for (const request of this.requests()) {
      for (const shift of request.requested_shifts) dates.add(shift.date);
    }
    for (const date of this.assignDates()) dates.add(date);

    const sortedDates = [...dates].sort();
    if (sortedDates.length === 0) {
      this.coverageShifts.set([]);
      return;
    }

    this.coverageLoading.set(true);
    this.shiftsApi.getShifts({
      date_from: sortedDates[0],
      date_to: sortedDates[sortedDates.length - 1],
    }).subscribe({
      next: (res) => {
        this.coverageLoading.set(false);
        this.coverageShifts.set(res.data ?? []);
      },
      error: () => {
        this.coverageLoading.set(false);
        this.coverageShifts.set([]);
      },
    });
  }

  formatDateShort(dateStr: string): string {
    return formatDateShort(dateStr);
  }

  formatDateTime(dateStr: string): string {
    return formatDateTime(dateStr);
  }

  weekday(dateStr: string): string {
    const d = new Date(dateStr);
    return DAY_NAMES[d.getDay()];
  }

  dayNum(dateStr: string): string {
    return String(new Date(dateStr).getDate());
  }

  shiftWord(count: number): string {
    if (count === 1) return 'смена';
    if (count >= 2 && count <= 4) return 'смены';
    return 'смен';
  }
}
