import {
  Component, inject, signal, computed, effect, OnInit, OnDestroy, PLATFORM_ID,
  ChangeDetectionStrategy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { NewBookingInlineComponent } from './new-booking-inline.component';
import { RescheduleBookingDialogComponent } from './reschedule-booking-dialog.component';
import { ClientCardComponent } from '../task-detail/sections/client-card.component';
import { WebSocketService } from '../../../../core/services/websocket.service';

// ===== Interfaces =====

interface Studio {
  id: string;
  name: string;
  location_code: string;
  address: string;
}


interface BookingRecord {
  id: string;
  studio_id: string;
  studio_name: string;
  client_name: string;
  client_phone: string;
  service_name: string | null;
  start_time: string;
  end_time: string;
  status: string;
  source: string;
  notes: string | null;
  created_at: string;
}

interface ScheduleDay {
  date: string;
  hasShift: boolean;
  shiftEmployeeName?: string;
  shiftStart?: string;
  shiftEnd?: string;
  totalSlots: number;
  bookedSlots: number;
  bookings: BookingRecord[];
}

interface OnlineBookingListItem {
  date: string;
  booking: BookingRecord;
}

@Component({
  selector: 'app-booking-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule, MatIconModule,
    MatFormFieldModule, MatSelectModule,
    MatProgressSpinnerModule, MatTooltipModule,
    MatDialogModule, MatSnackBarModule,
    ClientCardComponent, NewBookingInlineComponent,
  ],
  template: `
    <div class="bm">
      <header class="bm-toolbar">
        <div class="bm-toolbar-main">
          <mat-form-field appearance="outline" class="bm-studio-select" subscriptSizing="dynamic">
            <mat-label>Студия</mat-label>
            <mat-select [value]="selectedStudioId()" (selectionChange)="selectStudio($event.value)">
              @for (studio of studios(); track studio.id) {
                <mat-option [value]="studio.id">{{ studio.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <nav class="bm-week-nav" aria-label="Навигация по неделям">
            <button mat-icon-button type="button" matTooltip="Предыдущая неделя" (click)="prevWeek()">
              <mat-icon>chevron_left</mat-icon>
            </button>
            <div class="bm-week-title">
              <strong>{{ weekLabel() }}</strong>
              <span>{{ weekBookingCount() }} записей, {{ weekFreeSlotCount() }} свободно</span>
            </div>
            <button mat-icon-button type="button" matTooltip="Следующая неделя" (click)="nextWeek()">
              <mat-icon>chevron_right</mat-icon>
            </button>
            <button mat-stroked-button type="button" class="bm-today-btn" (click)="goToday()">Сегодня</button>
          </nav>
        </div>

        <div class="bm-toolbar-actions">
          <span class="bm-stat bm-stat--online">
            <mat-icon>language</mat-icon>
            <strong>{{ weekOnlineCount() }}</strong>
            <span>онлайн</span>
          </span>
          <button mat-flat-button type="button" class="bm-new-btn" (click)="openBookingPanel()">
            <mat-icon>add</mat-icon>
            Новая запись
          </button>
        </div>
      </header>

      @if (loading()) {
        <div class="bm-loading"><mat-progress-spinner mode="indeterminate" diameter="36" /></div>
      } @else {
        <section class="bm-week-board" aria-label="Расписание недели">
          @for (day of scheduleDays(); track day.date) {
            <button type="button" class="bm-day"
              [class.selected]="day.date === selectedDate()"
              [class.closed]="!day.hasShift && day.bookedSlots === 0"
              [class.today]="day.date === todayStr()"
              [class.has-bookings]="day.bookedSlots > 0"
              [class.has-online]="onlineCount(day) > 0"
              (click)="selectDay(day.date)">
              <div class="bm-day-top">
                <span>{{ dayName(day.date) }}</span>
                <strong>{{ dayNumber(day.date) }}</strong>
                @if (day.date === todayStr()) {
                  <em>Сегодня</em>
                }
              </div>

              <div class="bm-day-shift">
                @if (day.hasShift) {
                  <mat-icon>badge</mat-icon>
                  <span>{{ day.shiftEmployeeName || 'Смена' }}</span>
                } @else if (day.bookedSlots > 0) {
                  <mat-icon>event_note</mat-icon>
                  <span>Есть записи</span>
                } @else {
                  <mat-icon>event_busy</mat-icon>
                  <span>Закрыто</span>
                }
              </div>

              <div class="bm-day-progress" aria-hidden="true">
                <span [style.width.%]="occupancyPercent(day)"></span>
              </div>

              <div class="bm-day-counters">
                @if (day.hasShift) {
                  <span>{{ day.bookedSlots }} / {{ day.totalSlots }}</span>
                  <span>{{ dayFreeSlots(day) }} свободно</span>
                } @else {
                  <span>{{ day.bookedSlots }} записей</span>
                }
                @if (onlineCount(day); as onlineCount) {
                  <strong>
                    <mat-icon>language</mat-icon>
                    {{ onlineCount }}
                  </strong>
                }
              </div>

              <div class="bm-day-preview">
                @for (booking of visibleDayBookings(day); track booking.id) {
                  <span [class.online]="isOnlineBooking(booking.source)">
                    <b>{{ formatTime(booking.start_time) }}</b>
                    {{ booking.client_name }}
                  </span>
                }
                @if (remainingDayBookings(day) > 0) {
                  <span class="more">+{{ remainingDayBookings(day) }}</span>
                }
                @if (day.bookedSlots === 0) {
                  <span class="muted">{{ day.hasShift ? 'записей нет' : 'нет записей' }}</span>
                }
              </div>
            </button>
          }
        </section>

        <section class="bm-workspace">
          <main class="bm-panel bm-day-panel">
            @if (selectedDayData(); as day) {
              <div class="bm-panel-head">
                <div class="bm-panel-title">
                  <span>Выбранный день</span>
                  <h3>{{ selectedDateLabel() }}</h3>
                </div>
                <button mat-stroked-button type="button" class="bm-inline-new" (click)="openBookingPanel(day.date)">
                  <mat-icon>add</mat-icon>
                  Запись на день
                </button>
              </div>

              <div class="bm-day-metrics">
                <div>
                  <span>Смена</span>
                  @if (day.hasShift) {
                    <strong>{{ day.shiftStart }} - {{ day.shiftEnd }}</strong>
                    <small>{{ day.shiftEmployeeName || 'Сотрудник не указан' }}</small>
                  } @else {
                    <strong>Закрыто</strong>
                    <small>{{ day.bookedSlots > 0 ? 'есть записи без смены' : 'записей нет' }}</small>
                  }
                </div>
                <div>
                  <span>Записи</span>
                  <strong>{{ day.bookedSlots }}</strong>
                  <small>{{ day.totalSlots ? 'из ' + day.totalSlots + ' слотов' : 'без слотов' }}</small>
                </div>
                <div>
                  <span>Свободно</span>
                  <strong>{{ dayFreeSlots(day) }}</strong>
                  <small>{{ occupancyPercent(day) }}% занято</small>
                </div>
                <div>
                  <span>Онлайн</span>
                  <strong>{{ onlineCount(day) }}</strong>
                  <small>{{ onlineCount(day) ? 'от клиентов' : 'нет' }}</small>
                </div>
              </div>

              @if (day.bookings.length) {
                <div class="bm-bookings">
                  @for (booking of day.bookings; track booking.id) {
                    <article class="bm-booking" [attr.data-status]="booking.status"
                    [class.bm-booking--online]="isOnlineBooking(booking.source)">
                      <div class="bm-b-time">{{ formatTime(booking.start_time) }}</div>
                      <div class="bm-b-body">
                        <div class="bm-b-top">
                          <span class="bm-b-name">{{ booking.client_name }}</span>
                          <span class="bm-b-status" [attr.data-status]="booking.status">
                            {{ statusLabel(booking.status) }}
                          </span>
                        </div>
                        <div class="bm-b-meta">
                          @if (canDial(booking.client_phone)) {
                            <a class="bm-b-phone" [href]="'tel:' + booking.client_phone">{{ booking.client_phone }}</a>
                          } @else {
                            <span class="bm-b-phone bm-b-phone--unknown">{{ booking.client_phone || '?' }}</span>
                          }
                          @if (booking.service_name) {
                            <span class="bm-b-service">{{ booking.service_name }}</span>
                          }
                          <span class="bm-b-source"
                            [class.bm-b-source--online]="isOnlineBooking(booking.source)"
                            [matTooltip]="sourceLabel(booking.source)">
                            <mat-icon>{{ sourceIcon(booking.source) }}</mat-icon>
                            {{ sourceLabel(booking.source) }}
                          </span>
                        </div>
                      </div>
                      <div class="bm-b-actions">
                        @if (canDial(booking.client_phone)) {
                          <button mat-icon-button matTooltip="Клиент"
                            (click)="toggleClientCard(booking)">
                            <mat-icon>person</mat-icon>
                          </button>
                        }
                        @if (booking.status === 'pending') {
                          <button mat-icon-button matTooltip="Подтвердить" class="act-confirm"
                            (click)="updateStatus(booking.id, 'confirmed')">
                            <mat-icon>check_circle</mat-icon>
                          </button>
                        }
                        @if (booking.status !== 'cancelled' && booking.status !== 'completed' && booking.status !== 'no-show') {
                          <button mat-icon-button matTooltip="Перенести"
                            (click)="openRescheduleDialog(booking)">
                            <mat-icon>schedule_send</mat-icon>
                          </button>
                          <button mat-icon-button matTooltip="Отменить" class="act-cancel"
                            (click)="updateStatus(booking.id, 'cancelled')">
                            <mat-icon>cancel</mat-icon>
                          </button>
                        }
                        @if (booking.status === 'confirmed') {
                          <button mat-icon-button matTooltip="Завершить" class="act-complete"
                            (click)="updateStatus(booking.id, 'completed')">
                            <mat-icon>task_alt</mat-icon>
                          </button>
                          <button mat-icon-button matTooltip="Не явился" class="act-noshow"
                            (click)="updateStatus(booking.id, 'no-show')">
                            <mat-icon>person_off</mat-icon>
                          </button>
                        }
                      </div>
                    </article>
                  }
                </div>
              } @else {
                <div class="bm-empty">
                  <mat-icon>{{ day.hasShift ? 'event_available' : 'event_busy' }}</mat-icon>
                  <div>
                    <strong>{{ day.hasShift ? 'День свободен' : 'Студия закрыта' }}</strong>
                    <span>{{ day.hasShift ? 'Записей нет' : 'Смена не назначена' }}</span>
                  </div>
                  <button mat-stroked-button type="button" (click)="openBookingPanel(day.date)">
                    <mat-icon>add</mat-icon>
                    Создать запись
                  </button>
                </div>
              }
            }
          </main>

          <aside class="bm-side">
            @if (bookingFormOpen()) {
              <app-new-booking-inline
                [studios]="studios()"
                [selectedStudioId]="selectedStudioId()"
                [selectedDate]="selectedDate()"
                (bookingCreated)="handleBookingCreated()"
                (cancelled)="closeBookingPanel()" />
            }

            <section class="bm-panel bm-online-panel" aria-label="Онлайн-записи недели">
              <div class="bm-panel-head">
                <div class="bm-panel-title">
                  <span>Онлайн-записи</span>
                  <h3>Очередь недели</h3>
                </div>
                <span class="bm-count-badge">{{ weekOnlineCount() }}</span>
              </div>

              @if (weekOnlineBookings().length > 0) {
                <div class="bm-online-list">
                  @for (item of weekOnlineBookings(); track item.booking.id) {
                    <button type="button" class="bm-online-item"
                      [class.selected]="item.date === selectedDate()"
                      (click)="selectDay(item.date)">
                      <span class="bm-online-date">{{ shortDateLabel(item.date) }}</span>
                      <span class="bm-online-time">{{ formatTime(item.booking.start_time) }}</span>
                      <span class="bm-online-name">{{ item.booking.client_name }}</span>
                      <span class="bm-online-status">{{ statusLabel(item.booking.status) }}</span>
                      @if (item.booking.service_name) {
                        <span class="bm-online-service">{{ item.booking.service_name }}</span>
                      }
                    </button>
                  }
                </div>
              } @else {
                <div class="bm-online-empty">
                  <mat-icon>language</mat-icon>
                  <span>Онлайн-записей на этой неделе нет</span>
                </div>
              }
            </section>
          </aside>
        </section>
      }

      @if (selectedBooking()) {
        <section class="bm-client-card">
          <div class="bm-client-header">
            <span>Карточка клиента</span>
            <button mat-icon-button type="button" (click)="selectedBooking.set(null)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <app-client-card [clientPhone]="selectedBooking()!.client_phone" />
        </section>
      }
    </div>
  `,
  styles: [`
    .bm {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 14px 16px 22px;
    }

    .bm-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .bm-toolbar-main,
    .bm-toolbar-actions,
    .bm-week-nav,
    .bm-stat {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .bm-toolbar-main {
      flex: 1 1 680px;
      min-width: 0;
    }

    .bm-studio-select {
      width: 250px;
      flex: 0 0 auto;
    }

    .bm-week-nav {
      min-width: 0;
      flex: 1;
    }

    .bm-week-title {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 210px;
      text-align: center;
    }

    .bm-week-title strong {
      color: var(--mat-sys-on-surface);
      font-size: 15px;
      line-height: 20px;
    }

    .bm-week-title span {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      line-height: 16px;
    }

    .bm-today-btn,
    .bm-inline-new,
    .bm-new-btn {
      border-radius: 6px;
    }

    .bm-new-btn {
      background: var(--ed-accent, #f59e0b);
      color: #111;
      font-weight: 600;
    }

    .bm-stat {
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 999px;
      color: var(--mat-sys-on-surface-variant);
      min-height: 36px;
      padding: 0 12px;
    }

    .bm-stat mat-icon {
      color: var(--ed-accent, #f59e0b);
      font-size: 18px;
      height: 18px;
      width: 18px;
    }

    .bm-stat strong {
      color: var(--mat-sys-on-surface);
      font-size: 16px;
    }

    .bm-stat span {
      font-size: 12px;
    }

    .bm-loading {
      display: flex;
      justify-content: center;
      padding: 44px;
    }

    .bm-week-board {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 8px;
    }

    .bm-day {
      appearance: none;
      background: var(--mat-sys-surface-container-low, #151515);
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 8px;
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 9px;
      min-height: 148px;
      min-width: 0;
      padding: 10px;
      text-align: left;
      transition: border-color 0.15s, background 0.15s, transform 0.15s;
    }

    .bm-day:hover {
      border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 70%, var(--mat-sys-outline-variant, #2d2d2d));
      transform: translateY(-1px);
    }

    .bm-day.selected {
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 10%, var(--mat-sys-surface-container-low, #151515));
      border-color: var(--ed-accent, #f59e0b);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ed-accent, #f59e0b) 45%, transparent);
    }

    .bm-day.closed {
      opacity: 0.62;
    }

    .bm-day.has-online {
      border-bottom-color: var(--ed-accent, #f59e0b);
    }

    .bm-day-top,
    .bm-day-shift,
    .bm-day-counters,
    .bm-day-preview span,
    .bm-count-badge {
      display: flex;
      align-items: center;
    }

    .bm-day-top {
      justify-content: space-between;
      gap: 8px;
    }

    .bm-day-top span {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .bm-day-top strong {
      font-size: 24px;
      line-height: 28px;
      font-variant-numeric: tabular-nums;
    }

    .bm-day-top em {
      border-radius: 999px;
      background: var(--ed-accent, #f59e0b);
      color: #111;
      font-size: 10px;
      font-style: normal;
      font-weight: 700;
      line-height: 18px;
      padding: 0 7px;
    }

    .bm-day-shift {
      color: var(--mat-sys-on-surface-variant);
      gap: 5px;
      min-width: 0;
    }

    .bm-day-shift mat-icon {
      flex: 0 0 auto;
      font-size: 16px;
      height: 16px;
      width: 16px;
    }

    .bm-day-shift span {
      font-size: 12px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bm-day-progress {
      background: var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 999px;
      height: 5px;
      overflow: hidden;
    }

    .bm-day-progress span {
      background: linear-gradient(90deg, #22c55e, var(--ed-accent, #f59e0b));
      display: block;
      height: 100%;
    }

    .bm-day-counters {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      justify-content: space-between;
      gap: 6px;
    }

    .bm-day-counters strong {
      align-items: center;
      color: var(--ed-accent, #f59e0b);
      display: inline-flex;
      gap: 3px;
      margin-left: auto;
    }

    .bm-day-counters mat-icon {
      font-size: 14px;
      height: 14px;
      width: 14px;
    }

    .bm-day-preview {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 42px;
    }

    .bm-day-preview span {
      border-radius: 5px;
      background: var(--mat-sys-surface-container, #1d1d1d);
      color: var(--mat-sys-on-surface);
      font-size: 12px;
      gap: 6px;
      line-height: 18px;
      min-width: 0;
      overflow: hidden;
      padding: 2px 6px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bm-day-preview span.online {
      color: var(--ed-accent, #f59e0b);
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 13%, transparent);
    }

    .bm-day-preview .more,
    .bm-day-preview .muted {
      color: var(--mat-sys-on-surface-variant);
      background: transparent;
      padding-left: 0;
    }

    .bm-workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(340px, 410px);
      gap: 12px;
      align-items: start;
    }

    .bm-side {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }

    .bm-panel {
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low, #151515);
      padding: 14px;
    }

    .bm-panel-head {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .bm-panel-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .bm-panel-title span {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }

    .bm-panel-title h3 {
      color: var(--mat-sys-on-surface);
      font-size: 18px;
      line-height: 23px;
      margin: 0;
    }

    .bm-day-metrics {
      display: grid;
      grid-template-columns: 1.2fr repeat(3, minmax(90px, 0.6fr));
      gap: 8px;
      margin-bottom: 12px;
    }

    .bm-day-metrics div {
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      padding: 10px;
    }

    .bm-day-metrics span,
    .bm-day-metrics small {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bm-day-metrics strong {
      color: var(--mat-sys-on-surface);
      font-size: 18px;
      line-height: 22px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bm-bookings {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .bm-booking {
      align-items: center;
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-left-width: 4px;
      border-radius: 8px;
      display: grid;
      gap: 12px;
      grid-template-columns: 64px minmax(0, 1fr) auto;
      padding: 11px 10px;
    }

    .bm-booking:hover {
      background: var(--mat-sys-surface-container, #1d1d1d);
    }

    .bm-booking[data-status="confirmed"] { border-left-color: #22c55e; }
    .bm-booking[data-status="pending"] { border-left-color: var(--ed-accent, #f59e0b); }
    .bm-booking[data-status="completed"] { border-left-color: #94a3b8; }
    .bm-booking[data-status="cancelled"] { border-left-color: var(--mat-sys-error, #ef4444); opacity: 0.62; }
    .bm-booking[data-status="no-show"] { border-left-color: #f97316; opacity: 0.78; }

    .bm-booking--online {
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 8%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ed-accent, #f59e0b) 24%, transparent);
    }

    .bm-b-time {
      color: var(--ed-accent, #f59e0b);
      font-size: 18px;
      font-variant-numeric: tabular-nums;
      font-weight: 800;
    }

    .bm-b-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .bm-b-top,
    .bm-b-meta,
    .bm-b-source,
    .bm-b-actions {
      align-items: center;
      display: flex;
    }

    .bm-b-top {
      gap: 8px;
      min-width: 0;
    }

    .bm-b-name {
      color: var(--mat-sys-on-surface);
      font-size: 15px;
      font-weight: 600;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bm-b-status {
      border-radius: 999px;
      flex: 0 0 auto;
      font-size: 10px;
      font-weight: 800;
      line-height: 18px;
      padding: 0 8px;
      text-transform: uppercase;
    }

    .bm-b-status[data-status="confirmed"] { background: #22c55e24; color: #22c55e; }
    .bm-b-status[data-status="pending"] { background: #f59e0b24; color: #f59e0b; }
    .bm-b-status[data-status="completed"] { background: #94a3b824; color: #cbd5e1; }
    .bm-b-status[data-status="cancelled"] { background: #ef444424; color: #ef4444; }
    .bm-b-status[data-status="no-show"] { background: #f9731624; color: #f97316; }

    .bm-b-meta {
      color: var(--mat-sys-on-surface-variant);
      flex-wrap: wrap;
      gap: 10px;
      font-size: 13px;
    }

    .bm-b-phone {
      color: inherit;
      text-decoration: none;
    }

    .bm-b-phone:hover {
      color: var(--ed-accent, #f59e0b);
      text-decoration: underline;
    }

    .bm-b-phone--unknown,
    .bm-b-phone--unknown:hover {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: none;
    }

    .bm-b-service {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bm-b-source {
      gap: 4px;
    }

    .bm-b-source--online {
      color: var(--ed-accent, #f59e0b);
      font-weight: 700;
    }

    .bm-b-source mat-icon {
      font-size: 14px;
      height: 14px;
      width: 14px;
    }

    .bm-b-actions {
      gap: 2px;
      justify-content: flex-end;
    }

    .act-confirm { color: #22c55e !important; }
    .act-cancel { color: var(--mat-sys-error, #ef4444) !important; }
    .act-complete { color: #94a3b8 !important; }
    .act-noshow { color: #f97316 !important; }

    .bm-empty,
    .bm-online-empty {
      align-items: center;
      border: 1px dashed var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 8px;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      gap: 12px;
      padding: 18px;
    }

    .bm-empty mat-icon,
    .bm-online-empty mat-icon {
      flex: 0 0 auto;
      font-size: 30px;
      height: 30px;
      opacity: 0.72;
      width: 30px;
    }

    .bm-empty div {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .bm-empty strong {
      color: var(--mat-sys-on-surface);
      font-size: 15px;
    }

    .bm-empty span,
    .bm-online-empty span {
      font-size: 13px;
    }

    .bm-count-badge {
      background: var(--ed-accent, #f59e0b);
      border-radius: 999px;
      color: #111;
      font-size: 13px;
      font-weight: 800;
      justify-content: center;
      min-width: 30px;
      padding: 4px 8px;
    }

    .bm-online-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .bm-online-item {
      appearance: none;
      background: var(--mat-sys-surface-container, #1d1d1d);
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 8px;
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      display: grid;
      gap: 4px 8px;
      grid-template-columns: auto auto minmax(0, 1fr);
      padding: 9px 10px;
      text-align: left;
    }

    .bm-online-item:hover,
    .bm-online-item.selected {
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 10%, var(--mat-sys-surface-container, #1d1d1d));
      border-color: var(--ed-accent, #f59e0b);
    }

    .bm-online-date,
    .bm-online-time {
      color: var(--ed-accent, #f59e0b);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      font-weight: 800;
    }

    .bm-online-name,
    .bm-online-service {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bm-online-name {
      font-size: 13px;
      font-weight: 700;
    }

    .bm-online-status {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      grid-column: 1 / 3;
    }

    .bm-online-service {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      grid-column: 3;
      text-align: right;
    }

    .bm-client-card {
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 8px;
      padding: 12px;
    }

    .bm-client-header {
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      font-weight: 600;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    @media (max-width: 1180px) {
      .bm-week-board {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .bm-workspace {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .bm-toolbar,
      .bm-toolbar-main,
      .bm-toolbar-actions {
        align-items: stretch;
        flex-direction: column;
      }

      .bm-studio-select,
      .bm-toolbar-actions,
      .bm-new-btn {
        width: 100%;
      }

      .bm-week-nav {
        justify-content: center;
      }

      .bm-week-title {
        min-width: 150px;
      }

      .bm-week-board {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .bm-day-metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .bm-booking {
        grid-template-columns: 54px minmax(0, 1fr);
      }

      .bm-b-actions {
        grid-column: 1 / -1;
      }
    }

    @media (max-width: 520px) {
      .bm {
        padding: 10px;
      }

      .bm-week-board,
      .bm-day-metrics {
        grid-template-columns: 1fr;
      }

      .bm-panel-head,
      .bm-empty {
        align-items: stretch;
        flex-direction: column;
      }

      .bm-online-service {
        grid-column: 1 / -1;
        text-align: left;
      }
    }
  `],
})
export class BookingManagerComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly ws = inject(WebSocketService);

  studios = signal<Studio[]>([]);
  selectedStudioId = signal<string>('');
  weekStart = signal<string>('');
  scheduleDays = signal<ScheduleDay[]>([]);
  selectedDate = signal<string>('');
  loading = signal(false);
  selectedBooking = signal<BookingRecord | null>(null);
  bookingFormOpen = signal(false);

  todayStr = computed(() => {
    const d = new Date();
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  });

  weekLabel = computed(() => {
    const ws = this.weekStart();
    if (!ws) return '';
    const start = new Date(ws);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${start.getDate()} ${months[start.getMonth()]} — ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`;
  });

  selectedDayData = computed(() => {
    const date = this.selectedDate();
    return this.scheduleDays().find(d => d.date === date);
  });

  selectedOnlineBookings = computed(() => {
    return this.selectedDayData()?.bookings.filter(booking => this.isOnlineBooking(booking.source)) ?? [];
  });

  weekOnlineBookings = computed<OnlineBookingListItem[]>(() => {
    return this.scheduleDays().flatMap(day =>
      day.bookings
        .filter(booking => this.isOnlineBooking(booking.source))
        .map(booking => ({ date: day.date, booking })),
    );
  });

  weekBookingCount = computed(() => {
    return this.scheduleDays().reduce((total, day) => total + day.bookedSlots, 0);
  });

  weekFreeSlotCount = computed(() => {
    return this.scheduleDays().reduce((total, day) => total + this.dayFreeSlots(day), 0);
  });

  weekOnlineCount = computed(() => this.weekOnlineBookings().length);

  selectedDateLabel = computed(() => {
    const d = this.selectedDate();
    if (!d) return '';
    const date = new Date(d);
    const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${dayNames[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
  });

  private readonly bookingEventEffect = effect(() => {
    const event = this.ws.taskEvent();
    if (event && event.event.startsWith('booking:')) {
      // Перезагружаем расписание при любом booking-событии
      this.loadSchedule();
    }
  });

  ngOnDestroy(): void {
    this.ws.unsubscribeFromTasks();
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Установить текущую неделю (понедельник)
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    this.weekStart.set(this.formatDate(monday));
    this.selectedDate.set(this.formatDate(today));

    this.loadStudios();
  }

  loadStudios(): void {
    this.http.get<{ studios: Studio[] }>('/api/crm-booking/studios').subscribe({
      next: (res) => {
        this.studios.set(res.studios);
        if (res.studios.length > 0) {
          this.selectedStudioId.set(res.studios[0].id);
          this.loadSchedule();
          // Подписываемся на WebSocket-события для этой студии
          this.ws.subscribeToTasks(res.studios[0].id);
        }
      },
      error: () => { /* studios load failed */ },
    });
  }

  loadSchedule(): void {
    const studioId = this.selectedStudioId();
    const weekStart = this.weekStart();
    if (!studioId || !weekStart) return;

    this.loading.set(true);
    this.http.get<{ days: ScheduleDay[] }>('/api/crm-booking/schedule/overview', {
      params: { studioId, weekStart },
    }).subscribe({
      next: (res) => {
        this.scheduleDays.set(res.days);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  selectStudio(studioId: string): void {
    this.selectedStudioId.set(studioId);
    this.ws.unsubscribeFromTasks();
    this.ws.subscribeToTasks(studioId);
    this.loadSchedule();
  }

  selectDay(date: string): void {
    this.selectedDate.set(date);
  }

  prevWeek(): void {
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() - 7);
    this.weekStart.set(this.formatDate(d));
    this.loadSchedule();
  }

  nextWeek(): void {
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() + 7);
    this.weekStart.set(this.formatDate(d));
    this.loadSchedule();
  }

  goToday(): void {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    this.weekStart.set(this.formatDate(monday));
    this.selectedDate.set(this.formatDate(today));
    this.loadSchedule();
  }

  updateStatus(bookingId: string, status: string): void {
    this.http.put(`/api/crm-booking/${bookingId}/status`, { status }).subscribe({
      next: () => {
        this.snackBar.open(
          status === 'confirmed' ? 'Запись подтверждена' :
          status === 'cancelled' ? 'Запись отменена' :
          status === 'no-show' ? 'Помечено: не явился' : 'Запись завершена',
          '', { duration: 3000 },
        );
        this.loadSchedule();
      },
      error: (err) => {
        this.snackBar.open('Ошибка: ' + (err.error?.error || 'Неизвестная ошибка'), '', { duration: 3000 });
      },
    });
  }

  toggleClientCard(booking: BookingRecord): void {
    if (this.selectedBooking()?.id === booking.id) {
      this.selectedBooking.set(null);
    } else {
      this.selectedBooking.set(booking);
    }
  }

  openRescheduleDialog(booking: BookingRecord): void {
    const dialogRef = this.dialog.open(RescheduleBookingDialogComponent, {
      width: '480px',
      data: {
        booking,
        studios: this.studios(),
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.loadSchedule();
        this.snackBar.open('Запись перенесена', '', { duration: 3000 });
      }
    });
  }

  openBookingPanel(date = this.selectedDate()): void {
    if (date) {
      this.selectedDate.set(date);
    }
    this.bookingFormOpen.set(true);
  }

  closeBookingPanel(): void {
    this.bookingFormOpen.set(false);
  }

  handleBookingCreated(): void {
    this.bookingFormOpen.set(false);
    this.loadSchedule();
    this.snackBar.open('Запись создана', '', { duration: 3000 });
  }

  // ===== Helpers =====

  dayName(dateStr: string): string {
    const names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return names[new Date(dateStr).getDay()];
  }

  dayNumber(dateStr: string): string {
    return new Date(dateStr).getDate().toString();
  }

  formatTime(dateTimeStr: string): string {
    const d = new Date(dateTimeStr);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  canDial(phone: string | null | undefined): boolean {
    return Boolean(phone && phone.replace(/\D/g, '').length >= 10);
  }

  isOnlineBooking(source: string | null | undefined): boolean {
    return source === 'website' || source === 'online';
  }

  onlineCount(day: ScheduleDay): number {
    return day.bookings.filter(booking => this.isOnlineBooking(booking.source)).length;
  }

  dayFreeSlots(day: ScheduleDay): number {
    return Math.max(day.totalSlots - day.bookedSlots, 0);
  }

  occupancyPercent(day: ScheduleDay): number {
    if (!day.totalSlots) return 0;
    return Math.min(100, Math.round((day.bookedSlots / day.totalSlots) * 100));
  }

  visibleDayBookings(day: ScheduleDay): BookingRecord[] {
    return day.bookings.slice(0, 2);
  }

  remainingDayBookings(day: ScheduleDay): number {
    return Math.max(day.bookings.length - 2, 0);
  }

  shortDateLabel(dateStr: string): string {
    const date = new Date(dateStr);
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return `${days[date.getDay()]} ${date.getDate().toString().padStart(2, '0')}`;
  }

  statusLabel(status: string): string {
    return { pending: 'Ожидает', confirmed: 'Подтверждена', completed: 'Завершена', cancelled: 'Отменена', 'no-show': 'Не явился' }[status] || status;
  }

  sourceLabel(source: string): string {
    return { crm: 'CRM', website: 'Онлайн-запись', online: 'Онлайн-запись', telegram: 'Telegram', phone: 'Телефон', walk_in: 'Визит' }[source] || source;
  }

  sourceIcon(source: string): string {
    return { crm: 'computer', website: 'language', online: 'language', telegram: 'send', phone: 'phone', walk_in: 'directions_walk' }[source] || 'event';
  }

  private formatDate(d: Date): string {
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  }
}
