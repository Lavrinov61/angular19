import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import {
  EmployeeShift,
  ScheduleRequest,
  ScheduleRequestedShift,
  ShiftStudio,
  ShiftsApiService,
} from '../../services/shifts-api.service';
import { DashboardDataService } from '../../services/dashboard-data.service';

export interface WorkdayWelcomeDialogData {
  name: string;
  userId?: string | null;
}

export type WorkdayWelcomeDialogResult =
  | { action: 'started'; studioId: string }
  | { action: 'skipped' };
type ScheduleRequestAction = NonNullable<ScheduleRequestedShift['action']>;

interface StartWarning {
  key: string;
  icon: string;
  message: string;
  fineApplies: boolean;
}

interface ScheduleDayFormControls {
  date: FormControl<string>;
  studio_id: FormControl<string>;
  start_time: FormControl<string>;
  end_time: FormControl<string>;
  action: FormControl<ScheduleRequestAction>;
  shift_id: FormControl<string>;
  current_studio_id: FormControl<string>;
  reason: FormControl<string>;
}

interface ScheduleDayValue {
  date: string;
  studio_id: string;
  start_time: string;
  end_time: string;
  action: ScheduleRequestAction;
  shift_id: string;
  current_studio_id: string;
  reason: string;
}

interface ScheduleRequestCalendarEntry {
  request: ScheduleRequest;
  shift: ScheduleRequestedShift;
}

interface ScheduleRequestFormControls {
  studio_id: FormControl<string>;
  days: FormArray<FormGroup<ScheduleDayFormControls>>;
}

interface DayOption {
  date: string;
  day: string;
  weekday: string;
  weekend: boolean;
}

const SCHEDULE_ACTION_LABELS: Record<ScheduleRequestAction, string> = {
  work: 'Новая смена',
  change_address: 'Сменить точку',
  cancel_shift: 'Отменить смену',
};

const SCHEDULE_ACTION_ICONS: Record<ScheduleRequestAction, string> = {
  work: 'event_available',
  change_address: 'edit_location_alt',
  cancel_shift: 'event_busy',
};

const REQUEST_STATUS_LABELS: Record<ScheduleRequest['status'], string> = {
  pending: 'На рассмотрении',
  approved: 'Утверждена',
  rejected: 'Отклонена',
  revision_requested: 'Нужна правка',
};

const REQUEST_STATUS_ICONS: Record<ScheduleRequest['status'], string> = {
  pending: 'hourglass_empty',
  approved: 'check_circle',
  rejected: 'cancel',
  revision_requested: 'edit_note',
};

const SHIFT_STATUS_LABELS: Record<EmployeeShift['status'], string> = {
  scheduled: 'Ожидает старта',
  active: 'Идёт рабочий день',
  completed: 'Завершена',
  cancelled: 'Отменена',
};

const WORKDAY_START_TIME = '08:45';
const WORKDAY_END_TIME = '19:45';
const WORKDAY_TIME_RANGE = `${WORKDAY_START_TIME}-${WORKDAY_END_TIME}`;

@Component({
  selector: 'app-workday-welcome-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  template: `
    <section class="workday-shell" aria-labelledby="workday-title">
      <header class="workday-header">
        <div class="brand-lockup">
          <span class="brand-mark">
            <mat-icon>photo_camera</mat-icon>
          </span>
          <div>
            <div class="brand-name">Своё Фото</div>
            <div class="brand-context">Рабочий день</div>
          </div>
        </div>

        <div class="header-actions">
          <span class="lock-note">
            {{ activeWorkday() ? 'График меняется через заявку' : canSkipWorkdayStart() ? 'Админ-доступ' : 'Пульт откроется после старта' }}
          </span>
          <button
            mat-stroked-button
            type="button"
            class="logout-btn"
            [disabled]="loggingOut()"
            matTooltip="Выйти из текущего аккаунта"
            (click)="logout()"
          >
            @if (loggingOut()) {
              <mat-spinner diameter="16" />
            } @else {
              <mat-icon>logout</mat-icon>
            }
            Выйти из аккаунта
          </button>
          @if (canSkipWorkdayStart()) {
            <button
              mat-stroked-button
              type="button"
              class="skip-btn"
              matTooltip="Открыть пульт без начала рабочего дня"
              (click)="skipWorkdayStart()"
            >
              <mat-icon>login</mat-icon>
              Пропустить
            </button>
          }
          @if (activeWorkday()) {
            <button
              mat-stroked-button
              type="button"
              class="close-btn"
              matTooltip="Закрыть график и вернуться в пульт"
              (click)="closeSchedule()"
            >
              <mat-icon>arrow_back</mat-icon>
              Вернуться в пульт
            </button>
          }
        </div>
      </header>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="40" />
          <span>Загружаем смены и точки</span>
        </div>
      } @else {
        <div class="workday-body">
          <section class="hero-panel">
            <div class="hero-intro">
              <p class="eyebrow">Добрый день, {{ data.name }}</p>
              <h2 id="workday-title">{{ activeWorkday() ? 'График работы' : 'Начать рабочий день' }}</h2>
              <p class="hero-copy">
                @if (activeWorkday()) {
                  Текущая смена уже открыта. Ниже можно отправить заявку на новые смены, смену точки или отмену.
                } @else {
                  Заказы, ссылки на оплату и действия в пульте будут закрепляться за вашей рабочей сменой.
                  Хорошего дня.
                }
              </p>

              @if (activeWorkday()) {
                <div class="active-workday-card">
                  <mat-icon>task_alt</mat-icon>
                  <div>
                    <span>Рабочий день активен</span>
                    <strong>{{ activeWorkdayStudio() }}</strong>
                    @if (activeWorkdayCashAtOpen() !== null) {
                      <small>Наличка на старте: {{ formatRubles(activeWorkdayCashAtOpen()) }}</small>
                    }
                  </div>
                </div>
              } @else if (!confirmingStart()) {
                <div class="hero-actions">
                  <button
                    mat-flat-button
                    type="button"
                    class="start-btn start-btn-main"
                    [disabled]="!startStudioId()"
                    (click)="openStartConfirmation()"
                  >
                    <mat-icon>play_arrow</mat-icon>
                    Начать рабочий день
                  </button>
                </div>
              } @else {
                <div class="start-confirm">
                  <div class="start-confirm-header">
                    <mat-icon>{{ startStudioIsVirtual() ? 'desktop_windows' : 'location_on' }}</mat-icon>
                    <div>
                      <span>Подтвердите смену</span>
                      <strong>Точно начинаете в этом формате?</strong>
                    </div>
                  </div>

                  <div class="start-confirm-grid">
                    @if (studios().length > 1) {
                      <mat-form-field appearance="outline" class="start-studio-field">
                        <mat-label>Смена сегодня</mat-label>
                        <mat-select [value]="startStudioId()" (selectionChange)="selectStartStudio($event.value)">
                          <mat-select-trigger>
                            {{ startStudioLabel() }}
                          </mat-select-trigger>
                          @for (studio of studios(); track studio.id) {
                            <mat-option [value]="studio.id">
                              {{ studioDisplayName(studio) }}
                            </mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    }

                    <div class="start-address-card">
                      <span>Точка/формат</span>
                      <strong>{{ startStudioFullAddress() }}</strong>
                    </div>
                  </div>

                  @if (!startStudioIsVirtual()) {
                    <mat-form-field appearance="outline" class="start-cash-field">
                      <mat-label>Фактически наличных в кассе на старт</mat-label>
                      <input
                        matInput
                        type="number"
                        inputmode="decimal"
                        min="0"
                        step="1"
                        autocomplete="off"
                        [formControl]="startCashAtOpenControl"
                      >
                      <span matSuffix class="cash-suffix">₽</span>
                      @if (startCashAtOpenControl.hasError('required')) {
                        <mat-error>Обязательное поле</mat-error>
                      } @else if (startCashAtOpenControl.hasError('min')) {
                        <mat-error>Сумма не может быть отрицательной</mat-error>
                      }
                    </mat-form-field>

                    <mat-checkbox
                      class="start-fiscal-checkbox"
                      [checked]="startFiscalEnabled()"
                      [disabled]="dashData.startingWorkday() || checkingStudioOccupancy()"
                      (change)="startFiscalEnabled.set($event.checked)"
                    >
                      Фискальный регистратор
                    </mat-checkbox>
                  }

                  @if (startWarnings().length) {
                    <div class="start-warning-stack">
                      @for (warning of startWarnings(); track warning.key) {
                        <div class="start-address-warning" [class.acknowledged]="startAddressWarningAcknowledged()">
                          <mat-icon>{{ startAddressWarningAcknowledged() ? 'task_alt' : warning.icon }}</mat-icon>
                          <span>{{ warning.message }}</span>
                        </div>
                      }

                      @if (startFineWarningVisible()) {
                        <div class="start-fine-warning" [class.acknowledged]="startAddressWarningAcknowledged()">
                          <mat-icon>gpp_maybe</mat-icon>
                          <div>
                            <span>Штраф за неверную точку</span>
                            <strong>500 ₽</strong>
                          </div>
                        </div>
                      }
                    </div>
                  }

                  <div class="start-confirm-actions">
                    <button
                      mat-flat-button
                      type="button"
                      class="start-btn"
                      [disabled]="!startStudioId() || dashData.startingWorkday() || checkingStudioOccupancy()"
                      (click)="startWorkday()"
                    >
                      @if (dashData.startingWorkday() || checkingStudioOccupancy()) {
                        <mat-spinner diameter="18" />
                      } @else {
                        <mat-icon>task_alt</mat-icon>
                      }
                      {{ startConfirmButtonLabel() }}
                    </button>
                  </div>
                </div>
              }
            </div>
          </section>

          <div class="summary-grid">
            <div class="summary-tile">
              <mat-icon>{{ todayStateIcon() }}</mat-icon>
              <span class="summary-label">Сегодня</span>
              <strong>{{ todayStateLabel() }}</strong>
            </div>
            <div class="summary-tile">
              <mat-icon>event_available</mat-icon>
              <span class="summary-label">Ближайшие смены</span>
              <strong>{{ upcomingShiftCount() }}</strong>
            </div>
            <div class="summary-tile">
              <mat-icon>pending_actions</mat-icon>
              <span class="summary-label">Заявки ждут ответа</span>
              <strong>{{ pendingRequestCount() }}</strong>
            </div>
            <div class="summary-tile">
              <mat-icon>storefront</mat-icon>
              <span class="summary-label">Точки</span>
              <strong>{{ studios().length }}</strong>
            </div>
          </div>

          <div class="content-grid">
            <section class="panel panel-today">
              <div class="panel-heading">
                <div>
                  <span class="panel-kicker">Сегодня</span>
                  <h3>Смена и старт</h3>
                </div>
                <mat-icon>today</mat-icon>
              </div>

              @if (todayShift(); as shift) {
                <div class="today-shift">
                  <div>
                    <span class="muted">Точка</span>
                    <strong>{{ studioName(shift.studio_id) }}</strong>
                  </div>
                  <div>
                    <span class="muted">Время</span>
                    <strong>{{ timeRange(shift) }}</strong>
                  </div>
                  <span class="status-pill" [class.active]="shift.status === 'active'">
                    {{ shiftStatusLabel(shift.status) }}
                  </span>
                </div>
              } @else {
                <div class="empty-state">
                  <mat-icon>bolt</mat-icon>
                  <span>Рабочий день можно открыть сразу. Точка или онлайн-формат для новых дней выбирается ниже.</span>
                </div>
              }

              <mat-divider />

              <div class="mini-list">
                <div class="mini-list-title">Ближайшие смены</div>
                @if (upcomingShifts().length) {
                  @for (shift of upcomingShifts(); track shift.id) {
                    <div class="mini-row">
                      <span>{{ formatDate(shift.shift_date) }}</span>
                      <strong>{{ studioName(shift.studio_id) }}</strong>
                      <small>{{ timeRange(shift) }}</small>
                    </div>
                  }
                } @else {
                  <div class="muted-line">Пока нет ближайших смен.</div>
                }
              </div>
            </section>

            <section class="panel panel-request">
              <div class="panel-heading">
                <div>
                  <span class="panel-kicker">Заявка</span>
                  <h3>Календарь смен</h3>
                </div>
                <mat-icon>event_note</mat-icon>
              </div>

              <form [formGroup]="scheduleForm" (ngSubmit)="submitScheduleRequest()">
                <div class="request-mode-tabs" role="tablist" aria-label="Тип заявки">
                  @for (action of scheduleActions; track action) {
                    <button
                      type="button"
                      class="request-mode-btn"
                      [class.selected]="selectedRequestAction() === action"
                      (click)="setRequestAction(action)"
                    >
                      <mat-icon>{{ requestActionIcon(action) }}</mat-icon>
                      <span>{{ requestActionLabel(action) }}</span>
                    </button>
                  }
                </div>
                <div class="request-mode-hint">{{ requestActionHint() }}</div>

                <div class="day-picker">
                  @for (day of dayOptions; track day.date) {
                    <button
                      type="button"
                      class="day-chip"
                      [class.selected]="selectedDates().has(day.date)"
                      [class.weekend]="day.weekend"
                      [class.past]="isPastDate(day.date)"
                      [class.has-shift]="hasShiftOnDate(day.date)"
                      [class.active-shift]="dayShiftStatus(day.date) === 'active'"
                      [class.has-proposal]="hasProposalOnDate(day.date)"
                      [class.disabled]="!canSelectDateForAction(day.date, selectedRequestAction()) && !selectedDates().has(day.date)"
                      [class.change-mode]="selectedRequestAction() === 'change_address'"
                      [class.cancel-mode]="selectedRequestAction() === 'cancel_shift'"
                      [attr.aria-disabled]="!canSelectDateForAction(day.date, selectedRequestAction()) && !selectedDates().has(day.date)"
                      [matTooltip]="dayChipTooltip(day.date)"
                      (click)="toggleRequestDate(day.date)"
                    >
                      <span>{{ day.weekday }}</span>
                      <strong>{{ day.day }}</strong>
                      @if (selectedDates().has(day.date)) {
                        <small>{{ selectedRequestActionLabel() }}</small>
                      } @else if (proposalForDate(day.date); as proposal) {
                        <small>{{ dayProposalChipLabel(proposal, proposalCountForDate(day.date)) }}</small>
                      } @else if (shiftForDate(day.date); as shift) {
                        <small>{{ dayShiftChipLabel(shift) }}</small>
                      }
                    </button>
                  }
                </div>

                @if (selectedRequestAction() !== 'cancel_shift') {
                  <div class="request-address-control">
                    <mat-form-field appearance="outline">
                      <mat-label>{{ selectedRequestAction() === 'work' ? 'Точка на все дни' : 'Новая точка' }}</mat-label>
                      <mat-select formControlName="studio_id" (selectionChange)="applyRequestStudio($event.value)">
                        <mat-select-trigger>
                          {{ studioName(scheduleForm.controls.studio_id.value) }}
                        </mat-select-trigger>
                        @for (studio of studios(); track studio.id) {
                          <mat-option [value]="studio.id">
                            {{ studioDisplayName(studio) }} · {{ formatMoney(studio.shift_rate) }}
                          </mat-option>
                        }
                      </mat-select>
                    </mat-form-field>

                    <div class="selected-address">
                      <span>{{ studioAddress(scheduleForm.controls.studio_id.value) }}</span>
                      <strong>{{ studioRateLabel(scheduleForm.controls.studio_id.value) }}</strong>
                    </div>
                  </div>
                } @else {
                  <div class="request-action-note">
                    <mat-icon>info</mat-icon>
                    <span>Выберите согласованные будущие смены, которые нужно отменить. Решение уйдёт администратору.</span>
                  </div>
                }

                <div class="request-rows" formArrayName="days">
                  @if (requestDays.length) {
                    @for (group of requestDays.controls; track group.controls.date.value; let i = $index) {
                      <div class="request-row" [formGroupName]="i">
                        <div class="request-date">
                          <strong>{{ formatDate(group.controls.date.value) }}</strong>
                          <span>{{ requestRowSubtitle(group) }}</span>
                          @if (requestRowDetail(group); as detail) {
                            <small>{{ detail }}</small>
                          }
                        </div>

                        <button mat-icon-button type="button" matTooltip="Убрать день" (click)="toggleRequestDate(group.controls.date.value)">
                          <mat-icon>close</mat-icon>
                        </button>
                      </div>
                    }
                  } @else {
                    <div class="empty-state compact">
                      <mat-icon>touch_app</mat-icon>
                      <span>Выберите дни выше.</span>
                    </div>
                  }
                </div>

                <div class="form-footer request-footer">
                  <span class="rate-note">{{ requestFooterNote() }}</span>
                  <button mat-flat-button type="submit" class="save-btn" [disabled]="!requestDays.length || scheduleForm.invalid || creatingRequest()">
                    @if (creatingRequest()) {
                      <mat-spinner diameter="18" />
                    } @else {
                      <mat-icon>send</mat-icon>
                    }
                    Отправить заявку
                  </button>
                </div>
              </form>
            </section>

            <section class="panel panel-rates">
              <div class="panel-heading">
                <div>
                  <span class="panel-kicker">Точки</span>
                  <h3>Ставка за выход</h3>
                </div>
                <mat-icon>payments</mat-icon>
              </div>

              <div class="rate-list">
                @for (studio of studios(); track studio.id) {
                  <div class="rate-row">
                    <div>
                      <strong>{{ studioLabel(studio) }}</strong>
                    </div>
                    <b>{{ formatMoney(studio.shift_rate) }}</b>
                  </div>
                }
              </div>

              <mat-divider />

              <div class="requests-mini">
                <div class="mini-list-title">Последние заявки</div>
                @if (recentRequests().length) {
                  @for (request of recentRequests(); track request.id) {
                    <div class="request-status-row">
                      <mat-icon>{{ requestStatusIcon(request) }}</mat-icon>
                      <span>{{ formatDate(request.pattern_start_date) }}</span>
                      <strong>{{ request.requested_shifts.length }} {{ shiftsWord(request.requested_shifts.length) }}</strong>
                      <small>{{ requestStatusLabel(request) }} · {{ requestActionSummary(request) }}</small>
                      @if (isAdminProposal(request) && request.status === 'pending') {
                        <div class="request-proposal-actions">
                          <button
                            mat-flat-button
                            type="button"
                            [disabled]="respondingProposalId() === request.id"
                            (click)="acceptProposal(request)"
                          >
                            @if (respondingProposalId() === request.id) {
                              <mat-spinner diameter="16" />
                            } @else {
                              <mat-icon>check_circle</mat-icon>
                            }
                            Согласиться
                          </button>
                          <button
                            mat-stroked-button
                            type="button"
                            [disabled]="respondingProposalId() === request.id"
                            (click)="declineProposal(request)"
                          >
                            <mat-icon>cancel</mat-icon>
                            Отказаться
                          </button>
                        </div>
                      }
                    </div>
                  }
                } @else {
                  <div class="muted-line">Заявок пока нет.</div>
                }
              </div>
            </section>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      color: var(--crm-text-primary, #f8fafc);
    }

    .workday-shell {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      background: var(--crm-page-bg, #0f172a);
      overflow: hidden;
    }

    .workday-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--crm-border-subtle, rgba(148, 163, 184, 0.18));
      background: var(--crm-surface, #111827);
    }

    .brand-lockup {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.16);
      color: var(--crm-accent, #f59e0b);
      flex: 0 0 auto;
    }

    .brand-mark mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .brand-name {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 24px;
      font-weight: 500;
      line-height: 1;
      color: var(--crm-accent, #f59e0b);
    }

    .brand-context {
      margin-top: 3px;
      font-size: 12px;
      color: var(--crm-text-muted, #94a3b8);
    }

    .lock-note {
      color: var(--crm-text-muted, #94a3b8);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .header-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      min-width: 0;
    }

    .close-btn {
      height: 40px;
      border-color: rgba(148, 163, 184, 0.38);
      color: var(--crm-text-secondary, #cbd5e1);
      font-weight: 700;
      white-space: nowrap;
    }

    .logout-btn {
      height: 40px;
      border-color: rgba(248, 113, 113, 0.42);
      color: #fecaca;
      font-weight: 700;
      white-space: nowrap;
    }

    .skip-btn {
      height: 40px;
      border-color: rgba(96, 165, 250, 0.42);
      background: rgba(59, 130, 246, 0.12);
      color: #dbeafe;
      font-weight: 700;
      white-space: nowrap;
    }

    .logout-btn:hover {
      border-color: rgba(248, 113, 113, 0.68);
      background: rgba(127, 29, 29, 0.16);
    }

    .skip-btn:hover {
      border-color: rgba(96, 165, 250, 0.68);
      background: rgba(30, 64, 175, 0.22);
    }

    .close-btn mat-icon,
    .skip-btn mat-icon,
    .logout-btn mat-icon,
    .logout-btn mat-spinner {
      margin-right: 6px;
    }

    .close-btn mat-icon,
    .skip-btn mat-icon,
    .logout-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .loading-state {
      display: flex;
      flex: 1;
      min-height: 0;
      align-items: center;
      justify-content: center;
      gap: 14px;
      color: var(--crm-text-secondary, #cbd5e1);
    }

    .workday-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 18px;
    }

    .hero-panel {
      display: block;
      padding: 20px;
      border: 1px solid var(--crm-border-subtle, rgba(148, 163, 184, 0.18));
      border-radius: 8px;
      background: var(--crm-surface-overlay, #111827);
    }

    .hero-intro {
      max-width: 820px;
    }

    .eyebrow,
    .panel-kicker {
      margin: 0 0 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      color: var(--crm-accent, #f59e0b);
      text-transform: uppercase;
    }

    h2,
    h3 {
      margin: 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-weight: 500;
      letter-spacing: 0;
      color: var(--crm-text-primary, #f8fafc);
    }

    h2 {
      font-size: 34px;
      line-height: 1.12;
    }

    h3 {
      font-size: 20px;
      line-height: 1.15;
    }

    .hero-copy {
      max-width: 760px;
      margin: 10px 0 0;
      font-size: 14px;
      line-height: 1.55;
      color: var(--crm-text-secondary, #cbd5e1);
    }

    .hero-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 18px;
    }

    .active-workday-card {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 520px;
      margin-top: 18px;
      padding: 12px 14px;
      border: 1px solid rgba(34, 197, 94, 0.26);
      border-radius: 8px;
      background: rgba(34, 197, 94, 0.08);
    }

    .active-workday-card mat-icon {
      color: var(--crm-status-success, #22c55e);
    }

    .active-workday-card span {
      display: block;
      color: var(--crm-text-muted, #94a3b8);
      font-size: 12px;
    }

    .active-workday-card strong {
      display: block;
      margin-top: 2px;
      color: var(--crm-text-primary, #f8fafc);
      font-size: 15px;
    }

    .active-workday-card small {
      display: block;
      margin-top: 4px;
      color: #bbf7d0;
      font-size: 12px;
      font-weight: 700;
    }

    .start-confirm {
      display: grid;
      gap: 12px;
      max-width: 760px;
      margin-top: 18px;
      padding: 14px;
      border: 1px solid rgba(34, 197, 94, 0.22);
      border-radius: 8px;
      background: rgba(34, 197, 94, 0.07);
    }

    .start-confirm-header {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .start-confirm-header mat-icon {
      color: var(--crm-accent, #f59e0b);
    }

    .start-confirm-header span {
      display: block;
      font-size: 12px;
      color: var(--crm-text-muted, #94a3b8);
    }

    .start-confirm-header strong {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      color: var(--crm-text-primary, #f8fafc);
      font-size: 16px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .start-confirm-grid {
      display: grid;
      grid-template-columns: minmax(260px, 420px) minmax(260px, 1fr);
      gap: 12px;
      align-items: stretch;
    }

    .start-studio-field {
      min-width: 0;
    }

    .start-address-card {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      min-height: 56px;
      padding: 8px 12px;
      border: 1px solid rgba(34, 197, 94, 0.26);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.32);
    }

    .start-address-card span {
      color: var(--crm-text-muted, #94a3b8);
      font-size: 12px;
    }

    .start-address-card strong {
      margin-top: 4px;
      overflow: hidden;
      color: #bbf7d0;
      font-size: 15px;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .start-cash-field {
      max-width: 420px;
    }

    .start-fiscal-checkbox {
      width: max-content;
      max-width: 100%;
      color: var(--crm-text-primary, #f8fafc);
      font-weight: 700;
    }

    .cash-suffix {
      padding-right: 2px;
      color: var(--crm-text-muted, #94a3b8);
      font-weight: 800;
    }

    .start-warning-stack {
      display: grid;
      gap: 10px;
    }

    .start-address-warning {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid rgba(248, 113, 113, 0.34);
      border-radius: 8px;
      background: rgba(127, 29, 29, 0.2);
      color: #fecaca;
      font-size: 13px;
      line-height: 1.4;
    }

    .start-address-warning.acknowledged {
      border-color: rgba(34, 197, 94, 0.34);
      background: rgba(20, 83, 45, 0.2);
      color: #bbf7d0;
    }

    .start-address-warning mat-icon {
      color: #f87171;
      flex: 0 0 auto;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .start-address-warning.acknowledged mat-icon {
      color: var(--crm-status-success, #22c55e);
    }

    .start-fine-warning {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid rgba(248, 113, 113, 0.58);
      border-radius: 8px;
      background: rgba(127, 29, 29, 0.34);
      box-shadow: inset 4px 0 0 rgba(248, 113, 113, 0.92);
      color: #fee2e2;
    }

    .start-fine-warning.acknowledged {
      border-color: rgba(245, 158, 11, 0.52);
      background: rgba(120, 53, 15, 0.32);
      color: #fed7aa;
    }

    .start-fine-warning mat-icon {
      color: #f87171;
      flex: 0 0 auto;
    }

    .start-fine-warning span,
    .start-fine-warning strong {
      display: block;
    }

    .start-fine-warning span {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: #fecaca;
    }

    .start-fine-warning strong {
      margin-top: 2px;
      font-size: 24px;
      line-height: 1;
      color: #fff;
    }

    .start-confirm-actions {
      display: flex;
      justify-content: flex-start;
      padding-top: 2px;
    }

    .start-btn,
    .save-btn {
      min-height: 40px;
      border-radius: 8px;
      font-weight: 700;
      white-space: nowrap;
    }

    .start-btn {
      background: var(--crm-status-success, #22c55e);
      color: #fff;
    }

    .start-btn-main {
      min-height: 48px;
      padding-inline: 20px;
      font-size: 15px;
      box-shadow: 0 14px 28px rgba(34, 197, 94, 0.18);
    }

    .save-btn {
      background: var(--crm-accent, #f59e0b);
      color: #111827;
    }

    .start-btn mat-icon,
    .save-btn mat-icon {
      margin-right: 6px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .summary-tile {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr);
      grid-template-rows: auto auto;
      column-gap: 10px;
      align-items: center;
      min-height: 76px;
      padding: 14px;
      border: 1px solid var(--crm-border-subtle, rgba(148, 163, 184, 0.18));
      border-radius: 8px;
      background: var(--crm-surface, #111827);
    }

    .summary-tile mat-icon {
      grid-row: 1 / span 2;
      color: var(--crm-accent, #f59e0b);
    }

    .summary-label {
      font-size: 12px;
      color: var(--crm-text-muted, #94a3b8);
    }

    .summary-tile strong {
      min-width: 0;
      overflow: hidden;
      color: var(--crm-text-primary, #f8fafc);
      font-size: 18px;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .content-grid {
      display: grid;
      grid-template-columns: minmax(300px, 0.85fr) minmax(520px, 1.35fr);
      gap: 14px;
      align-items: start;
      margin-top: 14px;
    }

    .panel {
      min-width: 0;
      padding: 16px;
      border: 1px solid var(--crm-border-subtle, rgba(148, 163, 184, 0.18));
      border-radius: 8px;
      background: var(--crm-surface, #111827);
    }

    .panel-request {
      grid-row: span 2;
    }

    .panel-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .panel-heading > mat-icon {
      color: var(--crm-text-muted, #94a3b8);
    }

    .today-shift {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(110px, auto);
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
    }

    .today-shift > div {
      min-width: 0;
    }

    .today-shift strong,
    .mini-row strong,
    .rate-row strong {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .muted {
      display: block;
      margin-bottom: 3px;
      font-size: 12px;
      color: var(--crm-text-muted, #94a3b8);
    }

    .status-pill {
      justify-self: end;
      padding: 5px 9px;
      border-radius: 999px;
      background: rgba(245, 158, 11, 0.16);
      color: var(--crm-accent, #f59e0b);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .status-pill.active {
      background: rgba(34, 197, 94, 0.14);
      color: var(--crm-status-success, #22c55e);
    }

    .empty-state {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 74px;
      padding: 12px;
      border: 1px dashed rgba(148, 163, 184, 0.28);
      border-radius: 8px;
      color: var(--crm-text-secondary, #cbd5e1);
      background: rgba(15, 23, 42, 0.35);
    }

    .empty-state.compact {
      min-height: 52px;
    }

    .empty-state mat-icon {
      color: var(--crm-text-muted, #94a3b8);
      flex: 0 0 auto;
    }

    .mini-list {
      margin-top: 14px;
    }

    .mini-list-title {
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 700;
      color: var(--crm-text-muted, #94a3b8);
      text-transform: uppercase;
    }

    .mini-row,
    .rate-row,
    .request-status-row {
      display: grid;
      align-items: center;
      gap: 10px;
      min-height: 40px;
      padding: 8px 0;
      border-top: 1px solid rgba(148, 163, 184, 0.12);
    }

    .mini-row {
      grid-template-columns: 78px minmax(0, 1fr) auto;
    }

    .mini-row span,
    .mini-row small,
    .muted-line,
    .rate-row span,
    .request-status-row small {
      color: var(--crm-text-muted, #94a3b8);
      font-size: 12px;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .form-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .rate-note {
      color: var(--crm-text-secondary, #cbd5e1);
      font-size: 13px;
      line-height: 1.35;
    }

    .request-mode-tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .request-mode-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 40px;
      padding: 8px 10px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.42);
      color: var(--crm-text-secondary, #cbd5e1);
      font-weight: 700;
      cursor: pointer;
    }

    .request-mode-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .request-mode-btn.selected {
      border-color: rgba(245, 158, 11, 0.72);
      background: rgba(245, 158, 11, 0.16);
      color: var(--crm-accent, #f59e0b);
    }

    .request-mode-hint {
      min-height: 18px;
      color: var(--crm-text-muted, #94a3b8);
      font-size: 12px;
      line-height: 1.4;
    }

    .day-picker {
      display: grid;
      grid-template-columns: repeat(7, minmax(44px, 1fr));
      gap: 8px;
    }

    .day-chip {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 58px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.42);
      color: var(--crm-text-secondary, #cbd5e1);
      cursor: pointer;
    }

    .day-chip span {
      font-size: 11px;
      color: var(--crm-text-muted, #94a3b8);
    }

    .day-chip strong {
      margin-top: 4px;
      font-size: 17px;
      color: var(--crm-text-primary, #f8fafc);
    }

    .day-chip small {
      max-width: 100%;
      margin-top: 3px;
      overflow: hidden;
      color: var(--crm-text-muted, #94a3b8);
      font-size: 10px;
      font-weight: 700;
      line-height: 1.1;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .day-chip.weekend strong {
      color: #fca5a5;
    }

    .day-chip.selected {
      border-color: rgba(34, 197, 94, 0.72);
      background: rgba(34, 197, 94, 0.14);
    }

    .day-chip.has-shift {
      border-color: rgba(245, 158, 11, 0.72);
      background: rgba(245, 158, 11, 0.13);
    }

    .day-chip.has-shift strong,
    .day-chip.has-shift small {
      color: var(--crm-accent, #f59e0b);
    }

    .day-chip.active-shift {
      border-color: rgba(34, 197, 94, 0.82);
      background: rgba(34, 197, 94, 0.17);
    }

    .day-chip.active-shift strong,
    .day-chip.active-shift small {
      color: var(--crm-status-success, #22c55e);
    }

    .day-chip.has-proposal {
      border-color: rgba(59, 130, 246, 0.76);
      background: rgba(59, 130, 246, 0.14);
    }

    .day-chip.has-proposal span {
      color: #93c5fd;
    }

    .day-chip.has-proposal strong,
    .day-chip.has-proposal small {
      color: var(--crm-status-info, #3b82f6);
    }

    .day-chip.change-mode.selected {
      border-color: rgba(96, 165, 250, 0.76);
      background: rgba(37, 99, 235, 0.18);
    }

    .day-chip.change-mode.selected strong,
    .day-chip.change-mode.selected small {
      color: #93c5fd;
    }

    .day-chip.cancel-mode.selected {
      border-color: rgba(248, 113, 113, 0.78);
      background: rgba(127, 29, 29, 0.22);
    }

    .day-chip.cancel-mode.selected strong,
    .day-chip.cancel-mode.selected small {
      color: #fca5a5;
    }

    .day-chip.past,
    .day-chip.disabled {
      opacity: 0.52;
      cursor: not-allowed;
    }

    .request-rows {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 12px;
    }

    .request-address-control {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(190px, 0.85fr);
      gap: 10px;
      align-items: stretch;
      margin-top: 12px;
    }

    .request-action-note {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 56px;
      padding: 10px 12px;
      border: 1px solid rgba(248, 113, 113, 0.24);
      border-radius: 8px;
      background: rgba(127, 29, 29, 0.16);
      color: #fecaca;
      font-size: 13px;
      line-height: 1.35;
    }

    .request-action-note mat-icon {
      flex: 0 0 auto;
      color: #f87171;
    }

    .selected-address {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      min-height: 56px;
      padding: 8px 12px;
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.26);
    }

    .selected-address span,
    .selected-address strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .selected-address span {
      color: var(--crm-text-muted, #94a3b8);
      font-size: 12px;
    }

    .selected-address strong {
      margin-top: 3px;
      color: var(--crm-text-primary, #f8fafc);
      font-size: 13px;
    }

    .fixed-time-note {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 8px;
      color: var(--crm-text-secondary, #cbd5e1);
      background: rgba(15, 23, 42, 0.26);
    }

    .fixed-time-note mat-icon {
      color: var(--crm-text-muted, #94a3b8);
      font-size: 20px;
      width: 20px;
      height: 20px;
      flex: 0 0 auto;
    }

    .request-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 40px;
      gap: 10px;
      align-items: center;
      padding: 10px;
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.34);
    }

    .request-date {
      min-width: 0;
    }

    .request-date strong,
    .request-date span {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .request-date span {
      margin-top: 3px;
      color: var(--crm-text-muted, #94a3b8);
      font-size: 12px;
    }

    .request-date small {
      display: block;
      margin-top: 3px;
      overflow: hidden;
      color: var(--crm-text-secondary, #cbd5e1);
      font-size: 11px;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .request-footer {
      margin-top: 4px;
    }

    .rate-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 14px;
    }

    .rate-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .rate-row b {
      color: var(--crm-status-success, #22c55e);
      white-space: nowrap;
    }

    .requests-mini {
      margin-top: 14px;
    }

    .request-status-row {
      grid-template-columns: 24px 80px minmax(0, 1fr) auto;
    }

    .request-status-row mat-icon {
      color: var(--crm-text-muted, #94a3b8);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .request-status-row strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .request-proposal-actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 2px;
    }

    .request-proposal-actions button {
      min-height: 32px;
      font-size: 12px;
      font-weight: 700;
    }

    .request-proposal-actions mat-icon,
    .request-proposal-actions mat-spinner {
      margin-right: 4px;
    }

    .request-proposal-actions mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    mat-form-field {
      width: 100%;
    }

    @media (max-width: 1180px) {
      .summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .content-grid {
        grid-template-columns: 1fr 1fr;
      }

      .panel-request {
        grid-column: 1 / -1;
        grid-row: auto;
      }
    }

    @media (max-width: 760px) {
      .workday-header,
      .workday-body {
        padding: 14px;
      }

      .workday-header {
        align-items: stretch;
        flex-direction: column;
      }

      .header-actions {
        align-items: stretch;
        flex-direction: column;
      }

      .lock-note {
        white-space: normal;
      }

      .close-btn {
        width: 100%;
      }

      .skip-btn {
        width: 100%;
      }

      .form-footer {
        align-items: stretch;
        flex-direction: column;
      }

      h2 {
        font-size: 28px;
      }

      .summary-grid,
      .content-grid,
      .request-address-control,
      .start-confirm-grid {
        grid-template-columns: 1fr;
      }

      .day-picker {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .request-mode-tabs {
        grid-template-columns: 1fr;
      }

      .request-row {
        grid-template-columns: 1fr 40px;
      }

      .start-btn,
      .save-btn {
        width: 100%;
      }
    }
  `],
})
export class WorkdayWelcomeDialogComponent implements OnInit {
  protected readonly data = inject<WorkdayWelcomeDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<WorkdayWelcomeDialogComponent, WorkdayWelcomeDialogResult>>(MatDialogRef);
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly dashData = inject(DashboardDataService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly creatingRequest = signal(false);
  protected readonly confirmingStart = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly startAddressWarningAcknowledged = signal(false);
  protected readonly checkingStudioOccupancy = signal(false);
  protected readonly occupancyCheckFailed = signal(false);
  protected readonly respondingProposalId = signal('');
  protected readonly selectedRequestAction = signal<ScheduleRequestAction>('work');
  protected readonly studios = signal<ShiftStudio[]>([]);
  protected readonly shifts = signal<EmployeeShift[]>([]);
  protected readonly teamTodayShifts = signal<EmployeeShift[]>([]);
  protected readonly requests = signal<ScheduleRequest[]>([]);
  protected readonly startStudioId = signal('');
  protected readonly requestRowsVersion = signal(0);
  protected readonly workdayTimeRange = WORKDAY_TIME_RANGE;
  protected readonly scheduleActions: readonly ScheduleRequestAction[] = ['work', 'change_address', 'cancel_shift'];

  protected readonly today = this.toYMD(new Date());
  private readonly rangeEnd = this.toYMD(this.addDays(new Date(), 45));
  protected readonly dayOptions = this.buildDayOptions();

  protected readonly scheduleForm = new FormGroup<ScheduleRequestFormControls>({
    studio_id: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    days: new FormArray<FormGroup<ScheduleDayFormControls>>([]),
  });
  protected readonly startCashAtOpenControl = new FormControl<number | null>(null, {
    validators: [Validators.required, Validators.min(0)],
  });
  protected readonly startFiscalEnabled = signal(true);

  protected readonly studioMap = computed(() => new Map(this.studios().map(studio => [studio.id, studio])));
  protected readonly activeWorkday = computed(() => this.dashData.workday()?.shift?.status === 'active');
  protected readonly canSkipWorkdayStart = computed(() => this.authService.isAdmin() && !this.activeWorkday());
  protected readonly startStudioIsVirtual = computed(() => this.isVirtualStudioId(this.startStudioId()));
  protected readonly activeWorkdayStudio = computed(() => {
    const shift = this.dashData.workday()?.shift;
    if (!shift) return 'Точка смены';
    if (shift.is_virtual || shift.shift_kind === 'virtual' || shift.location_code === 'online') return 'Онлайн смена';
    return this.compactAddress(shift.studio_address ?? null)
      || this.locationAddress(shift.location_code ?? null)
      || this.stripStudioBrand(shift.studio_name ?? '')
      || 'Точка смены';
  });
  protected readonly activeWorkdayCashAtOpen = computed(() => this.dashData.workday()?.shift?.cash_at_open ?? null);

  protected readonly shiftsByDate = computed(() => {
    const map = new Map<string, EmployeeShift>();
    for (const shift of this.shifts()) {
      const date = this.shiftDateKey(shift);
      if (date >= this.today && shift.status !== 'cancelled') {
        const current = map.get(date);
        if (!current || this.shiftStatusPriority(shift.status) < this.shiftStatusPriority(current.status)) {
          map.set(date, shift);
        }
      }
    }
    return map;
  });

  protected readonly todayShift = computed(() =>
    this.shifts()
      .filter(shift => this.shiftDateKey(shift) === this.today && shift.status !== 'cancelled')
      .sort((a, b) => this.shiftStatusPriority(a.status) - this.shiftStatusPriority(b.status))
      .at(0) ?? null,
  );

  protected readonly todayStateLabel = computed(() => {
    const shift = this.todayShift();
    if (shift?.status === 'active') return 'Идёт рабочий день';
    if (shift?.status === 'scheduled') return 'Можно начать';
    return 'Готово к старту';
  });

  protected readonly todayStateIcon = computed(() => {
    const shift = this.todayShift();
    if (shift?.status === 'active') return 'task_alt';
    if (shift?.status === 'scheduled') return 'play_circle';
    return 'bolt';
  });

  protected readonly selectedStudioActiveOtherShift = computed(() => {
    const studioId = this.startStudioId();
    if (!studioId) return null;
    if (this.isVirtualStudioId(studioId)) return null;
    const currentUserId = this.data.userId ?? '';
    return this.teamTodayShifts().find(shift => {
      if (shift.studio_id !== studioId || shift.status !== 'active') return false;
      return !currentUserId || shift.employee_id !== currentUserId;
    }) ?? null;
  });

  protected readonly startWarnings = computed((): StartWarning[] => {
    const warnings: StartWarning[] = [];
    const studioId = this.startStudioId();
    if (!studioId) return warnings;
    const todayShift = this.todayShift();
    if (!todayShift) {
      warnings.push({
        key: 'no-scheduled-shift',
        icon: 'warning',
        message: 'На сегодня нет согласованной смены в календаре. Открывайте рабочий день только на согласованной точке.',
        fineApplies: true,
      });
    } else if (todayShift.studio_id !== studioId) {
      warnings.push({
        key: 'scheduled-address-mismatch',
        icon: 'warning',
        message: `В календаре на сегодня согласована точка ${this.studioName(todayShift.studio_id)}, выбрана ${this.studioName(studioId)}.`,
        fineApplies: true,
      });
    }

    const occupiedShift = this.selectedStudioActiveOtherShift();
    if (occupiedShift) {
      const employee = occupiedShift.employee_name?.trim() || 'Другой сотрудник';
      warnings.push({
        key: `occupied-${occupiedShift.id}`,
        icon: 'person_alert',
        message: `${employee}: рабочий день уже открыт на этой точке. Проверьте, кто должен работать на точке перед стартом.`,
        fineApplies: true,
      });
    }

    if (this.occupancyCheckFailed()) {
      warnings.push({
        key: 'occupancy-check-failed',
        icon: 'sync_problem',
        message: 'Не удалось проверить, открыта ли эта точка другим сотрудником. Проверьте её перед стартом.',
        fineApplies: false,
      });
    }

    return warnings;
  });

  protected readonly startFineWarningVisible = computed(() =>
    this.startWarnings().some(warning => warning.fineApplies),
  );

  protected readonly hasStartWarnings = computed(() => this.startWarnings().length > 0);

  protected readonly startConfirmButtonLabel = computed(() => {
    if (this.dashData.startingWorkday()) return 'Начинаем...';
    if (this.checkingStudioOccupancy()) return 'Проверяем точку...';
    if (this.hasStartWarnings() && !this.startAddressWarningAcknowledged()) {
      return 'Подтвердить предупреждение';
    }
    return this.startStudioIsVirtual() ? 'Да, начать онлайн' : 'Да, начать на этой точке';
  });

  protected readonly upcomingShifts = computed(() =>
    this.shifts()
      .filter(shift => this.shiftDateKey(shift) >= this.today && shift.status !== 'cancelled')
      .sort((a, b) => this.shiftDateKey(a).localeCompare(this.shiftDateKey(b)))
      .slice(0, 5),
  );

  protected readonly upcomingShiftCount = computed(() =>
    this.shifts().filter(shift => this.shiftDateKey(shift) >= this.today && shift.status !== 'cancelled').length,
  );

  protected readonly pendingRequestCount = computed(() =>
    this.requests().filter(request => request.status === 'pending').length,
  );

  protected readonly recentRequests = computed(() => this.requests().slice(0, 4));

  protected readonly proposalEntriesByDate = computed(() => {
    const map = new Map<string, ScheduleRequestCalendarEntry[]>();
    for (const request of this.requests()) {
      if (!this.isAdminProposal(request) || request.status !== 'pending') continue;
      for (const shift of request.requested_shifts) {
        const date = this.requestShiftDateKey(shift);
        if (date < this.today) continue;
        map.set(date, [...(map.get(date) ?? []), { request, shift }]);
      }
    }
    return map;
  });

  protected readonly selectedDates = computed(() => {
    this.requestRowsVersion();
    return new Set(this.requestDays.controls.map(group => group.controls.date.value));
  });

  protected get requestDays(): FormArray<FormGroup<ScheduleDayFormControls>> {
    return this.scheduleForm.controls.days;
  }

  ngOnInit(): void {
    this.loadDialogData();
  }

  protected openStartConfirmation(): void {
    if (!this.startStudioId()) {
      this.snackBar.open('Выберите точку или онлайн-смену', 'OK', { duration: 3000 });
      return;
    }
    this.applyStartStudioModeDefaults();
    this.startAddressWarningAcknowledged.set(false);
    this.confirmingStart.set(true);
    this.reloadTeamTodayShifts();
  }

  protected closeSchedule(): void {
    if (!this.activeWorkday()) return;
    this.dialogRef.close();
  }

  protected skipWorkdayStart(): void {
    if (!this.canSkipWorkdayStart()) return;
    this.dialogRef.close({ action: 'skipped' });
  }

  protected logout(): void {
    if (this.loggingOut()) return;

    this.loggingOut.set(true);
    this.authService.logout()
      .pipe(
        finalize(() => this.loggingOut.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        complete: () => this.finishLogout(),
        error: () => this.finishLogout(),
      });
  }

  private finishLogout(): void {
    this.dialogRef.close();
    void this.router.navigate(['/auth/employee-login'], { replaceUrl: true });
  }

  protected startWorkday(): void {
    const studioId = this.startStudioId();
    if (!studioId) {
      this.snackBar.open('Выберите точку или онлайн-смену', 'OK', { duration: 3000 });
      return;
    }
    if (this.dashData.startingWorkday()) return;
    if (this.checkingStudioOccupancy()) {
      this.snackBar.open('Проверяем, не открыта ли точка другим сотрудником', 'OK', { duration: 3000 });
      return;
    }
    const isVirtualStart = this.startStudioIsVirtual();
    const cashAtOpen = isVirtualStart ? 0 : this.cashAmountFromControl(this.startCashAtOpenControl);
    if (cashAtOpen === null) {
      this.startCashAtOpenControl.markAsTouched();
      this.snackBar.open('Введите фактическую наличку в кассе на старт', 'OK', { duration: 3500 });
      return;
    }
    if (this.hasStartWarnings() && !this.startAddressWarningAcknowledged()) {
      this.startAddressWarningAcknowledged.set(true);
      const message = this.startFineWarningVisible()
        ? 'Проверьте точку. Штраф за неверную точку 500 ₽'
        : 'Проверьте предупреждение перед стартом';
      this.snackBar.open(message, 'OK', { duration: 5000 });
      return;
    }

    this.dashData.startWorkday(
      studioId,
      this.startAddressWarningAcknowledged(),
      cashAtOpen,
      !isVirtualStart && this.startFiscalEnabled(),
      !isVirtualStart,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.dialogRef.close({ action: 'started', studioId }),
        error: () => undefined,
      });
  }

  protected formatRubles(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ₽`;
  }

  private cashAmountFromControl(control: FormControl<number | null>): number | null {
    if (control.invalid) return null;
    const amount = Number(control.value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100) / 100;
  }

  private applyStartStudioModeDefaults(): void {
    if (this.startStudioIsVirtual()) {
      this.startCashAtOpenControl.reset(0);
      this.startFiscalEnabled.set(false);
      return;
    }
    this.startCashAtOpenControl.reset(null);
    this.startFiscalEnabled.set(true);
  }

  protected toggleRequestDate(date: string): void {
    const action = this.selectedRequestAction();
    const selected = new Set(this.requestDays.controls.map(group => group.controls.date.value));
    if (!selected.has(date) && !this.canSelectDateForAction(date, action)) {
      this.snackBar.open(this.selectionBlockedMessage(date, action), 'OK', { duration: 3500 });
      return;
    }

    if (selected.has(date)) {
      selected.delete(date);
    } else {
      selected.add(date);
    }
    this.rebuildRequestDays([...selected].sort());
  }

  protected setRequestAction(action: ScheduleRequestAction): void {
    if (this.selectedRequestAction() === action) return;
    this.selectedRequestAction.set(action);
    this.rebuildRequestDays([]);
  }

  protected applyRequestStudio(studioId: string): void {
    this.scheduleForm.controls.studio_id.setValue(studioId, { emitEvent: false });
    for (const group of this.requestDays.controls) {
      if (group.controls.action.value === 'cancel_shift') continue;
      group.controls.studio_id.setValue(studioId, { emitEvent: false });
    }
    this.requestRowsVersion.update(version => version + 1);
  }

  protected submitScheduleRequest(): void {
    if (!this.requestDays.length || this.scheduleForm.invalid || this.creatingRequest()) {
      this.scheduleForm.markAllAsTouched();
      return;
    }

    const rows = this.requestDays.controls
      .map(group => group.getRawValue())
      .sort((a, b) => a.date.localeCompare(b.date));
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last) return;
    const unchangedAddress = rows.some(row =>
      row.action === 'change_address' && row.current_studio_id && row.current_studio_id === row.studio_id,
    );
    if (unchangedAddress) {
      this.snackBar.open('Для смены точки выберите новую точку, отличную от текущей', 'OK', { duration: 4500 });
      return;
    }

    const requestedShifts: ScheduleRequestedShift[] = rows.map(row => {
      const studioId = row.action === 'cancel_shift'
        ? row.current_studio_id || row.studio_id
        : row.studio_id;
      return {
        date: row.date,
        studio_id: studioId,
        start_time: WORKDAY_START_TIME,
        end_time: WORKDAY_END_TIME,
        action: row.action,
        ...(row.shift_id ? { shift_id: row.shift_id } : {}),
        ...(row.current_studio_id ? { current_studio_id: row.current_studio_id } : {}),
        ...(row.reason ? { reason: row.reason } : {}),
      };
    });

    this.creatingRequest.set(true);
    this.shiftsApi.createScheduleRequest({
      shift_pattern: 'custom',
      pattern_start_date: first.date,
      end_date: last.date,
      requested_shifts: requestedShifts,
    }).pipe(
      finalize(() => this.creatingRequest.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.snackBar.open(`${this.selectedRequestActionLabel()}: заявка отправлена`, 'OK', { duration: 3000 });
        this.rebuildRequestDays([]);
        this.reloadRequests();
      },
      error: (error: unknown) => {
        this.snackBar.open(this.errorMessage(error, 'Не удалось отправить заявку'), 'OK', { duration: 5000 });
      },
    });
  }

  protected studioName(studioId: string): string {
    const studio = this.studioMap().get(studioId);
    return studio ? this.studioLabel(studio) : 'Точка';
  }

  protected studioDisplayName(studio: ShiftStudio): string {
    return this.studioLabel(studio);
  }

  protected studioLabel(studio: ShiftStudio): string {
    if (this.isVirtualStudio(studio)) return 'Онлайн смена';

    const address = this.compactAddress(studio.address);
    if (address) return address;

    const name = this.stripStudioBrand(studio.name);
    if (name) return name;
    if (studio.location_code) return this.formatLocationCode(studio.location_code);
    return studio.name;
  }

  protected studioAddress(studioId: string): string {
    const studio = this.studioMap().get(studioId);
    return studio ? this.studioLabel(studio) : this.studioName(studioId);
  }

  protected startStudioLabel(): string {
    const studioId = this.startStudioId();
    return studioId ? this.studioName(studioId) : 'Выберите смену';
  }

  protected startStudioFullAddress(): string {
    const studio = this.studioMap().get(this.startStudioId());
    if (studio && this.isVirtualStudio(studio)) return 'Онлайн-заказы и ссылки на оплату';
    return studio?.address?.trim() || this.startStudioLabel();
  }

  protected selectStartStudio(studioId: string): void {
    this.startStudioId.set(studioId);
    if (this.confirmingStart()) {
      this.applyStartStudioModeDefaults();
    }
    this.startAddressWarningAcknowledged.set(false);
    this.reloadTeamTodayShifts();
  }

  protected studioRateLabel(studioId: string): string {
    const rate = this.studioMap().get(studioId)?.shift_rate;
    return typeof rate === 'number' ? `Выход: ${this.formatMoney(rate)}` : 'Выход по точке';
  }

  protected formatMoney(value: number): string {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₽`;
  }

  protected formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = this.parseLocalDate(dateStr);
    if (Number.isNaN(date.getTime())) return 'Дата не указана';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  protected timeRange(_shift: EmployeeShift): string {
    return WORKDAY_TIME_RANGE;
  }

  protected shiftStatusLabel(status: EmployeeShift['status']): string {
    return SHIFT_STATUS_LABELS[status];
  }

  protected requestStatusLabel(request: ScheduleRequest): string {
    if (this.isAdminProposal(request)) {
      if (request.status === 'pending') return 'Предложено вам';
      if (request.status === 'approved') return 'Вы согласились';
      if (request.status === 'rejected') return 'Вы отказались';
    }
    return REQUEST_STATUS_LABELS[request.status];
  }

  protected requestStatusIcon(request: ScheduleRequest): string {
    if (this.isAdminProposal(request) && request.status === 'pending') return 'schedule_send';
    return REQUEST_STATUS_ICONS[request.status];
  }

  protected requestActionLabel(action: ScheduleRequestAction | undefined): string {
    return SCHEDULE_ACTION_LABELS[action ?? 'work'];
  }

  protected requestActionIcon(action: ScheduleRequestAction): string {
    return SCHEDULE_ACTION_ICONS[action];
  }

  protected selectedRequestActionLabel(): string {
    return this.requestActionLabel(this.selectedRequestAction());
  }

  protected requestActionHint(): string {
    switch (this.selectedRequestAction()) {
      case 'change_address':
        return 'Выберите согласованные будущие смены и новую точку. Изменение применится после утверждения.';
      case 'cancel_shift':
        return 'Выберите согласованные будущие смены для отмены. Отмена применится после утверждения.';
      default:
        return 'Выберите свободные дни, когда хотите выйти на смену.';
    }
  }

  protected requestFooterNote(): string {
    if (this.selectedRequestAction() === 'cancel_shift') {
      return 'Отмена смены вступит в силу только после утверждения заявки.';
    }
    if (this.selectedRequestAction() === 'change_address') {
      return `Рабочий день ${this.workdayTimeRange}. Точка изменится только после утверждения заявки.`;
    }
    return `Рабочий день ${this.workdayTimeRange}. Процент с продаж одинаковый для всех точек.`;
  }

  protected requestActionSummary(request: ScheduleRequest): string {
    if (this.isAdminProposal(request)) return 'Предложение смен';
    const actions = new Set(request.requested_shifts.map(shift => shift.action ?? 'work'));
    if (actions.size !== 1) return 'Смешанная заявка';
    return this.requestActionLabel(actions.values().next().value);
  }

  protected isAdminProposal(request: ScheduleRequest): boolean {
    return request.admin_id != null && request.admin_id !== '';
  }

  protected acceptProposal(request: ScheduleRequest): void {
    if (!this.isAdminProposal(request) || request.status !== 'pending' || this.respondingProposalId()) return;

    this.respondingProposalId.set(request.id);
    this.shiftsApi.acceptScheduleProposal(request.id)
      .pipe(
        finalize(() => this.respondingProposalId.set('')),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          if (!res.success) return;
          this.snackBar.open('Смены добавлены в график', 'OK', { duration: 4000 });
          this.reloadRequests();
          this.reloadMyShifts();
        },
        error: (error: unknown) => {
          this.snackBar.open(this.errorMessage(error, 'Не удалось принять предложение'), 'OK', { duration: 5000 });
        },
      });
  }

  protected declineProposal(request: ScheduleRequest): void {
    if (!this.isAdminProposal(request) || request.status !== 'pending' || this.respondingProposalId()) return;
    if (!confirm('Отказаться от предложенных смен?')) return;

    this.respondingProposalId.set(request.id);
    this.shiftsApi.declineScheduleProposal(request.id)
      .pipe(
        finalize(() => this.respondingProposalId.set('')),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          if (!res.success) return;
          this.snackBar.open('Предложение отклонено', 'OK', { duration: 4000 });
          this.reloadRequests();
        },
        error: (error: unknown) => {
          this.snackBar.open(this.errorMessage(error, 'Не удалось отклонить предложение'), 'OK', { duration: 5000 });
        },
      });
  }

  protected shiftsWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'смена';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'смены';
    return 'смен';
  }

  protected shiftForDate(date: string): EmployeeShift | null {
    return this.shiftsByDate().get(date) ?? null;
  }

  protected hasShiftOnDate(date: string): boolean {
    return this.shiftsByDate().has(date);
  }

  protected hasProposalOnDate(date: string): boolean {
    return this.proposalEntriesByDate().has(date);
  }

  protected proposalForDate(date: string): ScheduleRequestCalendarEntry | null {
    return this.proposalEntriesByDate().get(date)?.at(0) ?? null;
  }

  protected proposalCountForDate(date: string): number {
    return this.proposalEntriesByDate().get(date)?.length ?? 0;
  }

  protected isPastDate(date: string): boolean {
    return date < this.today;
  }

  protected canSelectDateForAction(date: string, action: ScheduleRequestAction): boolean {
    if (this.isPastDate(date)) return false;
    const shift = this.shiftForDate(date);
    if (action === 'work') return !shift;
    return shift?.status === 'scheduled';
  }

  protected dayShiftStatus(date: string): EmployeeShift['status'] | null {
    return this.shiftForDate(date)?.status ?? null;
  }

  protected dayShiftChipLabel(shift: EmployeeShift): string {
    if (shift.status === 'active') return 'Идёт';
    if (shift.status === 'completed') return 'Была';
    return 'Смена';
  }

  protected dayProposalChipLabel(entry: ScheduleRequestCalendarEntry, count: number): string {
    if (count > 1) return `Предложено +${count - 1}`;
    const action = entry.shift.action ?? 'work';
    if (action === 'change_address') return 'Предл. точка';
    if (action === 'cancel_shift') return 'Предл. отмена';
    return 'Предложено';
  }

  protected dayChipTooltip(date: string): string {
    if (this.selectedDates().has(date)) {
      return `${this.selectedRequestActionLabel()}: день добавлен в заявку`;
    }
    const proposal = this.proposalForDate(date);
    if (proposal) {
      return this.dayProposalTooltip(proposal, this.proposalCountForDate(date));
    }
    const blocked = this.selectionBlockedMessage(date, this.selectedRequestAction());
    if (blocked) return blocked;
    const shift = this.shiftForDate(date);
    if (shift) {
      return `${this.formatDate(date)}: ${this.studioName(shift.studio_id)} · ${this.shiftStatusLabel(shift.status)}`;
    }
    return `${this.selectedRequestActionLabel()}: добавить день в заявку`;
  }

  protected dayProposalTooltip(entry: ScheduleRequestCalendarEntry, count: number): string {
    const action = this.requestActionLabel(entry.shift.action ?? 'work');
    const date = this.formatDate(this.requestShiftDateKey(entry.shift));
    const studio = this.requestedShiftStudioLabel(entry.shift);
    const author = entry.request.admin_name ? `администратором ${entry.request.admin_name}` : 'администратором';
    const extra = count > 1 ? `, ещё ${count - 1}` : '';
    return `${date}: ${action} предложено ${author}${extra}. ${studio}. Ответьте в последних заявках.`;
  }

  protected requestRowSubtitle(group: FormGroup<ScheduleDayFormControls>): string {
    const value = group.getRawValue();
    if (value.action === 'cancel_shift') {
      return `Отменить: ${this.studioName(value.current_studio_id || value.studio_id)}`;
    }
    if (value.action === 'change_address') {
      return `Новая точка: ${this.studioName(value.studio_id)}`;
    }
    return this.studioName(value.studio_id);
  }

  protected requestRowDetail(group: FormGroup<ScheduleDayFormControls>): string {
    const value = group.getRawValue();
    if (value.action === 'change_address' && value.current_studio_id) {
      return `Было: ${this.studioName(value.current_studio_id)}`;
    }
    if (value.action === 'cancel_shift') {
      return 'После утверждения смена будет отменена';
    }
    return '';
  }

  protected selectionBlockedMessage(date: string, action: ScheduleRequestAction): string {
    if (this.isPastDate(date)) return 'Прошедший день недоступен для заявки';
    const shift = this.shiftForDate(date);
    if (action === 'work' && shift) {
      return 'На этот день уже есть смена. Выберите режим смены точки или отмены.';
    }
    if (action !== 'work' && !shift) {
      return 'На этот день нет согласованной смены';
    }
    if (action !== 'work' && shift?.status !== 'scheduled') {
      return 'Изменить или отменить можно только смену, которая ещё не начата';
    }
    return '';
  }

  private loadDialogData(): void {
    this.loading.set(true);
    forkJoin({
      studios: this.shiftsApi.getShiftStudios(),
      shifts: this.shiftsApi.getMyShifts(this.today, this.rangeEnd),
      requests: this.shiftsApi.getMyScheduleRequests(),
    }).pipe(
      finalize(() => this.loading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ studios, shifts, requests }) => {
        this.studios.set(studios.data ?? []);
        this.shifts.set(shifts.data ?? []);
        this.requests.set(requests.data ?? []);
        this.syncStartStudio();
        this.syncRequestStudio();
        this.reloadTeamTodayShifts();
      },
      error: (error: unknown) => {
        this.snackBar.open(this.errorMessage(error, 'Не удалось загрузить рабочий день'), 'OK', { duration: 5000 });
      },
    });
  }

  private reloadRequests(): void {
    this.shiftsApi.getMyScheduleRequests()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.requests.set(res.data ?? []),
        error: (error: unknown) => {
          this.snackBar.open(this.errorMessage(error, 'Не удалось обновить заявки'), 'OK', { duration: 4000 });
        },
      });
  }

  private reloadMyShifts(): void {
    this.shiftsApi.getMyShifts(this.today, this.rangeEnd)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.shifts.set(res.data ?? []);
          this.syncStartStudio();
          this.syncRequestStudio();
          this.reloadTeamTodayShifts();
        },
        error: (error: unknown) => {
          this.snackBar.open(this.errorMessage(error, 'Не удалось обновить смены'), 'OK', { duration: 4000 });
        },
      });
  }

  private reloadTeamTodayShifts(): void {
    this.checkingStudioOccupancy.set(true);
    this.occupancyCheckFailed.set(false);
    this.shiftsApi.getToday()
      .pipe(
        finalize(() => this.checkingStudioOccupancy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => this.teamTodayShifts.set(res.data ?? []),
        error: (error: unknown) => {
          this.teamTodayShifts.set([]);
          this.occupancyCheckFailed.set(true);
          this.snackBar.open(this.errorMessage(error, 'Не удалось проверить открытые смены по точкам'), 'OK', { duration: 4500 });
        },
      });
  }

  private rebuildRequestDays(dates: readonly string[]): void {
    const selectedStudioId = this.scheduleForm.controls.studio_id.value || this.defaultStudioId();
    const current = new Map<string, ScheduleDayValue>(
      this.requestDays.controls.map(group => [group.controls.date.value, group.getRawValue()]),
    );

    this.requestDays.clear();
    for (const date of dates) {
      this.requestDays.push(this.createRequestDayForm(date, current.get(date), selectedStudioId));
    }
    this.requestRowsVersion.update(version => version + 1);
  }

  private createRequestDayForm(date: string, existing?: ScheduleDayValue, studioId?: string): FormGroup<ScheduleDayFormControls> {
    const action = existing?.action ?? this.selectedRequestAction();
    const shift = this.shiftForDate(date);
    const currentStudioId = existing?.current_studio_id ?? shift?.studio_id ?? '';
    const selectedStudioId = existing?.studio_id
      ?? (action === 'cancel_shift' ? currentStudioId : studioId)
      ?? this.defaultStudioId();
    return new FormGroup<ScheduleDayFormControls>({
      date: new FormControl(date, { nonNullable: true, validators: [Validators.required] }),
      studio_id: new FormControl(selectedStudioId, { nonNullable: true, validators: [Validators.required] }),
      start_time: new FormControl(existing?.start_time ?? WORKDAY_START_TIME, { nonNullable: true, validators: [Validators.required] }),
      end_time: new FormControl(existing?.end_time ?? WORKDAY_END_TIME, { nonNullable: true, validators: [Validators.required] }),
      action: new FormControl(action, { nonNullable: true, validators: [Validators.required] }),
      shift_id: new FormControl(existing?.shift_id ?? shift?.id ?? '', { nonNullable: true }),
      current_studio_id: new FormControl(currentStudioId, { nonNullable: true }),
      reason: new FormControl(existing?.reason ?? this.defaultRequestReason(action), { nonNullable: true }),
    });
  }

  private syncRequestStudio(): void {
    const studioId = this.scheduleForm.controls.studio_id.value || this.defaultStudioId();
    this.applyRequestStudio(studioId);
  }

  private syncStartStudio(): void {
    const current = this.startStudioId();
    if (current && this.studioMap().has(current)) return;
    this.startStudioId.set(this.todayShift()?.studio_id ?? this.defaultStudioId());
    this.startAddressWarningAcknowledged.set(false);
  }

  private defaultRequestReason(action: ScheduleRequestAction): string {
    if (action === 'change_address') return 'Заявка на смену точки';
    if (action === 'cancel_shift') return 'Заявка на отмену смены';
    return '';
  }

  private defaultStudioId(): string {
    return this.studios()[0]?.id ?? '';
  }

  private requestedShiftStudioLabel(shift: ScheduleRequestedShift): string {
    const studioId = this.requestedShiftStudioId(shift);
    return studioId ? this.studioName(studioId) : 'Точка не указана';
  }

  private requestedShiftStudioId(shift: ScheduleRequestedShift): string | undefined {
    if (shift.action === 'cancel_shift') return shift.current_studio_id || shift.studio_id;
    return shift.studio_id || shift.current_studio_id;
  }

  private requestShiftDateKey(shift: ScheduleRequestedShift): string {
    return shift.date.split('T')[0];
  }

  private shiftStatusPriority(status: EmployeeShift['status']): number {
    switch (status) {
      case 'active':
        return 0;
      case 'scheduled':
        return 1;
      case 'completed':
        return 2;
      case 'cancelled':
        return 3;
    }
  }

  private formatLocationCode(locationCode: string): string {
    return locationCode
      .split(/[-_]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toLocaleUpperCase('ru-RU') + part.slice(1))
      .join(' ');
  }

  private isVirtualStudio(studio: Pick<ShiftStudio, 'is_virtual' | 'location_code'>): boolean {
    return studio.is_virtual === true || studio.location_code === 'online';
  }

  private isVirtualStudioId(studioId: string | null | undefined): boolean {
    if (!studioId) return false;
    const studio = this.studioMap().get(studioId);
    return studio ? this.isVirtualStudio(studio) : false;
  }

  private locationAddress(locationCode: string | null): string {
    switch (locationCode) {
      case 'online':
        return 'Онлайн смена';
      case 'barrikadnaya-4':
        return '2-ая Баррикадная 4';
      case 'soborny':
      case 'soborny-21':
        return 'Соборный 21';
      default:
        return '';
    }
  }

  private compactAddress(address: string | null): string {
    if (!address) return '';
    return address
      .split(',')[0]
      ?.trim()
      .replace(/^(ул\.?|улица|пер\.?|переулок)\s+/i, '')
      .trim() ?? '';
  }

  private stripStudioBrand(name: string): string {
    return name
      .replace(/^\s*сво[ёе]\s*фото\s*[—–-]?\s*/i, '')
      .trim();
  }

  private buildDayOptions(): DayOption[] {
    const start = this.startOfWeekMonday(new Date());
    return Array.from({ length: 21 }, (_, index) => {
      const date = this.addDays(start, index);
      return {
        date: this.toYMD(date),
        day: String(date.getDate()),
        weekday: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
        weekend: date.getDay() === 0 || date.getDay() === 6,
      };
    });
  }

  private startOfWeekMonday(date: Date): Date {
    const start = new Date(date);
    const offset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offset);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private toYMD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseLocalDate(dateStr: string): Date {
    return new Date(`${dateStr.split('T')[0]}T00:00:00`);
  }

  private shiftDateKey(shift: EmployeeShift): string {
    return shift.shift_date.split('T')[0];
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const payload: unknown = error.error;
      if (typeof payload === 'object' && payload !== null && 'message' in payload) {
        const message = Reflect.get(payload, 'message');
        if (typeof message === 'string' && message.trim()) return message;
      }
    }
    return fallback;
  }
}
