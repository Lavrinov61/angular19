/**
 * PrintQueueComponent — print queue monitoring UI.
 * Pure template controller: all state lives in PrintQueueStateService.
 * Supports 14 job statuses, pause/resume, hold/release, bulk ops.
 */
import {
  Component, ChangeDetectionStrategy, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { PrintQueueStateService } from '../../services/print-queue-state.service';
import { PrintJob, Printer } from '../../services/print-api.service';
import { ReassignPrinterDialogComponent } from './reassign-printer-dialog.component';
import { CreateGroupDialogComponent } from './create-group-dialog.component';
import { JobTransitionsDialogComponent } from './job-transitions-dialog.component';

interface PrinterProblem {
  label: string;
  icon: string;
  severity: 'warning' | 'error';
}

@Component({
  selector: 'app-print-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
    'tabindex': '0',
  },
  imports: [
    MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatProgressSpinnerModule, MatChipsModule, MatTooltipModule, MatDividerModule, DatePipe,
    MatSelectModule, MatFormFieldModule, MatInputModule, FormsModule, MatSlideToggleModule,
    MatCheckboxModule, MatBadgeModule, MatButtonToggleModule, MatMenuModule, NgTemplateOutlet,
  ],
  template: `
    <div class="print-queue-page">

      <!-- Offline banner -->
      @if (!state.wsConnected()) {
        <div class="offline-banner" role="status" aria-live="polite">
          <mat-icon>cloud_off</mat-icon>
          @if (state.reconnectAttempt() > 0) {
            <span>Переподключение через {{ state.reconnectSeconds() }} сек (попытка {{ state.reconnectAttempt() }})</span>
          } @else {
            <span>Работа в offline-режиме. Данные обновляются каждые 10 сек</span>
          }
        </div>
      }

      <!-- Page header -->
      <div class="page-header">
        <h2>
          <mat-icon>print</mat-icon>
          Очередь печати
        </h2>
        <div class="header-controls">
          <mat-slide-toggle [checked]="state.soundEnabled()" (change)="state.toggleSound($event.checked)"
            matTooltip="Звуковые оповещения" aria-label="Звуковые уведомления">
            <mat-icon>{{ state.soundEnabled() ? 'volume_up' : 'volume_off' }}</mat-icon>
          </mat-slide-toggle>
          <button mat-icon-button (click)="openCreateGroupDialog()" matTooltip="Создать группу">
            <mat-icon>create_new_folder</mat-icon>
          </button>
          <button mat-stroked-button (click)="state.refresh()" [disabled]="state.loading()">
            <mat-icon>refresh</mat-icon>
            Обновить
          </button>
          <button mat-icon-button matTooltip="Space — Пауза &#10;Delete — Отмена &#10;R — Повтор &#10;Ctrl+A — Выбрать все &#10;Esc — Снять выбор &#10;F5 — Обновить">
            <mat-icon>keyboard</mat-icon>
          </button>
        </div>
      </div>

      <!-- Queue Health Dashboard -->
      <div class="health-dashboard">
        <div class="health-card">
          <div class="health-value">{{ state.queueHealth().total }}</div>
          <div class="health-label">В очереди</div>
        </div>
        <div class="health-card" [class.health-error]="state.queueHealth().failed > 0">
          <div class="health-value">{{ state.queueHealth().failed }}</div>
          <div class="health-label">Ошибки</div>
        </div>
        @if (state.queueHealth().paused > 0) {
          <div class="health-card health-paused">
            <div class="health-value">{{ state.queueHealth().paused }}</div>
            <div class="health-label">На паузе</div>
          </div>
        }
        @if (state.queueHealth().held > 0) {
          <div class="health-card health-held">
            <div class="health-value">{{ state.queueHealth().held }}</div>
            <div class="health-label">Удержано</div>
          </div>
        }
        <div class="health-card" [class.health-warn]="state.queueHealth().avgWait > 5">
          <div class="health-value">~{{ state.queueHealth().avgWait }} мин</div>
          <div class="health-label">Ожидание</div>
        </div>
        <div class="health-card">
          <div class="health-value">{{ state.queueHealth().printersOnline }}/{{ state.queueHealth().printersTotal }}</div>
          <div class="health-label">Принтеров</div>
        </div>
      </div>

      <!-- Supply alerts banner -->
      @if (state.supplyAlerts().length) {
        <div class="supply-alerts-banner">
          <mat-icon>warning_amber</mat-icon>
          <span>Расходники заканчиваются:</span>
          @for (a of state.supplyAlerts(); track a.printer_id + a.supply) {
            <span class="supply-alert-item">
              {{ getPrinterName(a.printer_id) }} — {{ a.supply }}: {{ a.level }}%
            </span>
          }
        </div>
      }

      <!-- Filters -->
      <div class="filters-bar">
        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Принтер</mat-label>
          <mat-select [ngModel]="state.filterPrinter()" (ngModelChange)="state.filterPrinter.set($event)">
            <mat-option value="">Все</mat-option>
            @for (p of state.printers(); track p.id) {
              <mat-option [value]="p.id">{{ p.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field search-field">
          <mat-label>Поиск</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input matInput [ngModel]="state.searchQuery()" (ngModelChange)="state.searchSubject.next($event)" placeholder="Имя файла или ID" />
          @if (state.searchQuery()) {
            <button matSuffix mat-icon-button (click)="state.searchQuery.set('')"><mat-icon>close</mat-icon></button>
          }
        </mat-form-field>

        <!-- Status Filter Chips -->
        <mat-chip-listbox [value]="state.filterStatus()" (change)="state.filterStatus.set($event.value)" multiple class="status-filter-chips">
          <mat-chip-option value="queued">Ожидание</mat-chip-option>
          <mat-chip-option value="paused">Пауза</mat-chip-option>
          <mat-chip-option value="held">Удержано</mat-chip-option>
          <mat-chip-option value="converting">Конвертация</mat-chip-option>
          <mat-chip-option value="sending">Отправка</mat-chip-option>
          <mat-chip-option value="processing">Обработка</mat-chip-option>
          <mat-chip-option value="printing">Печать</mat-chip-option>
          <mat-chip-option value="finishing">Финализация</mat-chip-option>
          <mat-chip-option value="failed">Ошибки</mat-chip-option>
          <mat-chip-option value="cancelled">Отменено</mat-chip-option>
        </mat-chip-listbox>
      </div>

      <!-- Extended filters -->
      <div class="filters-bar">
        <mat-button-toggle-group [value]="state.filterDateRange()"
          (change)="state.filterDateRange.set($event.value)" hideSingleSelectionIndicator>
          <mat-button-toggle value="">Все</mat-button-toggle>
          <mat-button-toggle value="today">Сегодня</mat-button-toggle>
          <mat-button-toggle value="week">Неделя</mat-button-toggle>
          <mat-button-toggle value="month">Месяц</mat-button-toggle>
        </mat-button-toggle-group>

        <mat-slide-toggle [checked]="state.filterMyJobs()" (change)="state.filterMyJobs.set($event.checked)"
          aria-label="Показать только мои задания">
          Мои задания
        </mat-slide-toggle>

        <mat-slide-toggle [checked]="state.groupByEnabled()" (change)="state.toggleGroupBy($event.checked)"
          aria-label="Группировка заданий">
          Группы
        </mat-slide-toggle>

        <mat-form-field appearance="outline" class="search-field">
          <mat-label>Поиск по ID или файлу</mat-label>
          <input matInput [value]="state.filterSearch()" (input)="onSearchInput($event)">
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>
      </div>

      <!-- Printer status cards -->
      <div class="printers-status">
        @for (printer of state.printers(); track printer.id) {
          <mat-card class="printer-card" [class.offline]="!getPrinterOnline(printer)" [class.queue-paused]="printer.queue_paused">
            <mat-card-content>
              <div class="printer-row">
                <mat-icon>{{ printer.printer_type === 'photo' ? 'photo_camera' : 'scanner' }}</mat-icon>
                <span class="printer-name">{{ printer.name }}</span>
                @if (printer.queue_paused) {
                  <span class="printer-paused-badge">Пауза</span>
                }
                <span class="status-dot" [class.online]="getPrinterOnline(printer)"
                  [attr.aria-label]="getPrinterOnline(printer) ? 'Принтер онлайн' : 'Принтер недоступен'"></span>
                <span class="status-text">{{ getPrinterOnline(printer) ? 'Онлайн' : 'Недоступен' }}</span>
                @if (getActiveJobsCount(printer.id) > 0) {
                  <span class="jobs-badge">{{ getActiveJobsCount(printer.id) }} зад.</span>
                }
                @if (state.printerQueueBusy(printer.id)) {
                  <mat-spinner class="printer-queue-spinner" diameter="18" />
                } @else if (printer.queue_paused) {
                  <button mat-icon-button
                    class="printer-queue-action"
                    (click)="state.resumePrinterQueue(printer)"
                    matTooltip="Возобновить очередь принтера"
                    aria-label="Возобновить очередь принтера">
                    <mat-icon>play_arrow</mat-icon>
                  </button>
                } @else {
                  <button mat-icon-button
                    class="printer-queue-action"
                    (click)="state.pausePrinterQueue(printer)"
                    matTooltip="Поставить очередь принтера на паузу"
                    aria-label="Поставить очередь принтера на паузу">
                    <mat-icon>pause</mat-icon>
                  </button>
                }
              </div>
              @if (printer.queue_paused) {
                <div class="printer-queue-note">
                  <mat-icon>pause_circle</mat-icon>
                  <span>
                    Очередь принтера на паузе
                    @if (printer.queue_paused_reason) {
                      <span>· {{ printer.queue_paused_reason }}</span>
                    }
                  </span>
                </div>
              }
              @if (getPrinterProblem(printer); as problem) {
                <div class="printer-problem" [class.problem-error]="problem.severity === 'error'">
                  <mat-icon>{{ problem.icon }}</mat-icon>
                  <span>{{ problem.label }}</span>
                  @if (getLatestRetryableJob(printer); as retryJob) {
                    <button mat-stroked-button class="printer-retry-btn"
                      (click)="state.retryJob(retryJob.id)"
                      matTooltip="Повторить последнее неудачное задание на этом принтере">
                      <mat-icon>replay</mat-icon>
                      Повторить
                    </button>
                  }
                </div>
              }
              @if (getSupplies(printer.id); as supplies) {
                <div class="supply-levels">
                  @for (s of supplies; track s.key) {
                    <div class="supply-row">
                      <span class="supply-label">{{ s.label }}</span>
                      <mat-progress-bar mode="determinate" [value]="s.value"
                        [class]="'supply-bar supply-' + s.level"
                        [style.--supply-color]="s.color">
                      </mat-progress-bar>
                      <span class="supply-pct">{{ s.value }}%</span>
                      @if (getSupplyForecast(printer.id, s.label); as fc) {
                        @if (fc.days !== null) {
                          <span class="forecast-badge" [class]="'forecast-' + fc.status">
                            @if (fc.status === 'critical') { <span class="pulse-dot"></span> }
                            ~{{ fc.days }} дн.
                          </span>
                        }
                      }
                    </div>
                  }
                </div>
              }
            </mat-card-content>
          </mat-card>
        }
        @if (!state.printers().length && !state.loading()) {
          <div class="no-printers">
            <mat-icon>print_disabled</mat-icon>
            Принтеры не настроены
          </div>
        }
      </div>

      <mat-divider></mat-divider>

      <!-- Bulk actions bar -->
      @if (state.selectedJobs().size > 0) {
        <div class="bulk-bar">
          <span class="bulk-count">Выбрано: {{ state.selectedJobs().size }}</span>
          @if (state.hasPausableSelected()) {
            <button mat-stroked-button (click)="state.bulkPause()">
              <mat-icon>pause</mat-icon> Пауза
            </button>
          }
          <button mat-stroked-button (click)="state.bulkCancel()" color="warn">
            <mat-icon>cancel</mat-icon> Отменить
          </button>
          @if (state.hasRetryableSelected()) {
            <button mat-stroked-button (click)="state.bulkRetry()">
              <mat-icon>replay</mat-icon> Повторить
            </button>
          }
          @if (state.hasHoldableSelected()) {
            <button mat-stroked-button (click)="state.bulkHold()">
              <mat-icon>back_hand</mat-icon> Удержать
            </button>
          }
          @if (state.hasReleasableSelected()) {
            <button mat-stroked-button (click)="state.bulkRelease()">
              <mat-icon>lock_open</mat-icon> Отпустить
            </button>
          }
          @if (state.hasResumableSelected()) {
            <button mat-stroked-button (click)="state.bulkResume()">
              <mat-icon>play_arrow</mat-icon> Продолжить
            </button>
          }
          <button mat-stroked-button (click)="state.bulkRaisePriority()">
            <mat-icon>priority_high</mat-icon> Приоритет
          </button>
          <button mat-icon-button (click)="state.deselectAll()" matTooltip="Снять выбор"
            aria-label="Снять выбор">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      <!-- Active jobs section -->
      <section class="queue-section">
        <h3 class="section-title">
          <mat-icon>pending_actions</mat-icon>
          Активные задания
          @if (state.activeJobs().length) {
            <mat-checkbox class="select-all-cb"
              [checked]="state.allActiveSelected()"
              [indeterminate]="state.someActiveSelected() && !state.allActiveSelected()"
              (change)="$event.checked ? state.selectAllActive() : state.deselectAll()">
              Все
            </mat-checkbox>
          }
        </h3>

        @if (state.loading() && !state.activeJobs().length) {
          <div class="loading-row">
            <mat-progress-bar mode="indeterminate"></mat-progress-bar>
          </div>
        }

        @if (!state.activeJobs().length && !state.loading()) {
          <div class="empty-state">
            <mat-icon>check_circle_outline</mat-icon>
            <p>Нет активных заданий</p>
          </div>
        }

        <!-- Grouped view (S15) -->
        @if (state.groupByEnabled() && state.groupedActiveJobs().groups.length > 0) {
          @for (group of state.groupedActiveJobs().groups; track group.id) {
            <div class="group-header" (click)="state.toggleGroupCollapse(group.id)" role="button" tabindex="0"
              (keydown.enter)="state.toggleGroupCollapse(group.id)" (keydown.space)="state.toggleGroupCollapse(group.id)">
              <mat-icon>{{ state.collapsedGroups().has(group.id) ? 'expand_more' : 'expand_less' }}</mat-icon>
              <mat-icon class="group-icon">folder</mat-icon>
              <span class="group-title">{{ getGroupName(group.id) }}</span>
              <span class="group-progress">{{ group.completedCount }}/{{ group.totalCount }}</span>
              <mat-progress-bar mode="determinate"
                [value]="group.totalCount ? (group.completedCount / group.totalCount * 100) : 0"
                class="group-progress-bar">
              </mat-progress-bar>
              <span class="group-count">{{ group.totalCount }} заданий</span>
              <div class="group-actions" role="toolbar" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="-1">
                <button mat-icon-button (click)="state.pauseGroup(group.id)" matTooltip="Пауза группы">
                  <mat-icon>pause</mat-icon>
                </button>
                <button mat-icon-button (click)="state.raiseGroupPriority(group.id)" matTooltip="Приоритет группы">
                  <mat-icon>priority_high</mat-icon>
                </button>
                <button mat-icon-button (click)="state.cancelGroup(group.id)" matTooltip="Отменить группу">
                  <mat-icon>cancel</mat-icon>
                </button>
                <button mat-icon-button (click)="state.selectGroup(group.id)"
                  matTooltip="Выбрать всю группу" aria-label="Выбрать группу">
                  <mat-icon>select_all</mat-icon>
                </button>
              </div>
            </div>
            @if (!state.collapsedGroups().has(group.id)) {
              @for (job of group.jobs; track job.id) {
                <ng-container *ngTemplateOutlet="jobCardTpl; context: { $implicit: job }"></ng-container>
              }
            }
          }

          @if (state.groupedActiveJobs().ungrouped.length) {
            <h4 class="ungrouped-title">Без группы</h4>
            @for (job of state.groupedActiveJobs().ungrouped; track job.id) {
              <ng-container *ngTemplateOutlet="jobCardTpl; context: { $implicit: job }"></ng-container>
            }
          }
        } @else {
          @for (job of state.activeJobs(); track job.id) {
            <ng-container *ngTemplateOutlet="jobCardTpl; context: { $implicit: job }"></ng-container>
          }
        }

        <!-- Job card template (shared between grouped and ungrouped views) -->
        <ng-template #jobCardTpl let-job>
          <mat-card class="job-card" [class.job-expanded]="state.expandedJobId() === job.id"
            [class.job-selected]="state.selectedJobs().has(job.id)">
            <mat-card-content>
              <div class="job-row">
                <mat-checkbox [checked]="state.selectedJobs().has(job.id)"
                  (change)="state.toggleSelection(job.id)"
                  (click)="$event.stopPropagation()">
                </mat-checkbox>
                <mat-icon class="job-icon" (click)="state.toggleExpanded(job.id)" style="cursor:pointer">
                  {{ jobStatusIcon(job.status) }}
                </mat-icon>
                <div class="job-info" role="button" tabindex="0" (click)="state.toggleExpanded(job.id)" (keydown.enter)="state.toggleExpanded(job.id)" (keydown.space)="state.toggleExpanded(job.id)" style="cursor:pointer">
                  <div class="job-file">
                    {{ job.file_name || shortenUrl(job.file_url) }}
                    @if ((job.priority ?? 0) >= 7) {
                      <span class="priority-badge priority-urgent">Срочно</span>
                    } @else if ((job.priority ?? 0) >= 4) {
                      <span class="priority-badge priority-elevated">Повышенный</span>
                    }
                    @if (job.group_id) {
                      <span class="group-badge" matTooltip="Группа {{ job.group_id.slice(0, 8) }}">
                        <mat-icon>folder</mat-icon>{{ job.group_sequence ?? '' }}
                      </span>
                    }
                  </div>
                  <div class="job-meta">
                    <span class="printer-badge">{{ job.printer_name }}</span>
                    <span class="paper-badge">{{ job.paper_size }}</span>
                    @if (job.copies > 1) { <span class="copies-badge">x{{ job.copies }}</span> }
                    @if (job.color_mode === 'bw') { <span class="bw-badge">Ч/Б</span> }
                    @if (job.duplex) { <span class="duplex-badge">Двустор.</span> }
                    @if (job.parent_job_id && job.page_number) { <span class="page-badge">стр. {{ job.page_number }}</span> }
                    @if (job.child_count && job.child_count > 0) {
                      <span class="split-badge" matTooltip="Разделено на {{ job.child_count }} принтеров">
                        <mat-icon>call_split</mat-icon>{{ job.child_count }}
                      </span>
                    }
                    @if (job.auto_balanced) {
                      <mat-icon class="auto-icon" matTooltip="Авто-баланс">auto_awesome</mat-icon>
                    }
                  </div>
                </div>

                <!-- Copy progress -->
                @if (job.progress_current_copy && job.progress_total_copies && job.progress_total_copies > 1) {
                  <span class="copy-progress-badge" matTooltip="Прогресс копий">
                    {{ job.progress_current_copy }}/{{ job.progress_total_copies }}
                  </span>
                }

                <!-- SLA age badge -->
                <span class="age-badge" [class]="'age-' + getJobAge(job).level">
                  {{ getJobAge(job).minutes }} мин
                </span>

                <!-- Estimated wait -->
                @if (getEstimatedWait(job); as wait) {
                  @if (wait > 0) {
                    <span class="wait-badge" matTooltip="Ожидание до начала">~{{ wait }} мин</span>
                  }
                }

                <span class="status-chip" [class]="'status-' + job.status">
                  {{ statusLabel(job.status) }}
                </span>

                <!-- Per-job action buttons -->
                @switch (job.status) {
                  @case ('queued') {
                    <button mat-icon-button (click)="state.pauseJob(job.id)"
                      matTooltip="Пауза" aria-label="Поставить на паузу">
                      <mat-icon>pause</mat-icon>
                    </button>
                    <button mat-icon-button (click)="state.holdJob(job.id)"
                      matTooltip="Удержать" aria-label="Удержать задание">
                      <mat-icon>back_hand</mat-icon>
                    </button>
                    <button mat-icon-button (click)="openReassignDialog(job)"
                      matTooltip="Переназначить" aria-label="Переназначить задание">
                      <mat-icon>swap_horiz</mat-icon>
                    </button>
                    <button mat-icon-button [matMenuTriggerFor]="pMenuQueued"
                      matTooltip="Приоритет: {{ job.priority ?? 0 }}" aria-label="Изменить приоритет">
                      <mat-icon>priority_high</mat-icon>
                    </button>
                    <mat-menu #pMenuQueued="matMenu">
                      <button mat-menu-item (click)="state.setExactPriority(job, 10)">
                        <mat-icon color="warn">emergency</mat-icon> Критический (10)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 7)">
                        <mat-icon>priority_high</mat-icon> Срочный (7)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 4)">
                        <mat-icon>arrow_upward</mat-icon> Повышенный (4)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 1)">
                        <mat-icon>remove</mat-icon> Обычный (1)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 0)">
                        <mat-icon>arrow_downward</mat-icon> Низкий (0)
                      </button>
                    </mat-menu>
                    <button mat-icon-button color="warn" (click)="state.cancelJob(job.id)"
                      matTooltip="Отменить" aria-label="Отменить задание">
                      <mat-icon>cancel</mat-icon>
                    </button>
                  }
                  @case ('sending') {
                    <button mat-icon-button (click)="state.pauseJob(job.id)"
                      matTooltip="Пауза" aria-label="Поставить на паузу">
                      <mat-icon>pause</mat-icon>
                    </button>
                    <button mat-icon-button (click)="openReassignDialog(job)"
                      matTooltip="Переназначить" aria-label="Переназначить задание">
                      <mat-icon>swap_horiz</mat-icon>
                    </button>
                    <button mat-icon-button [matMenuTriggerFor]="pMenuSending"
                      matTooltip="Приоритет: {{ job.priority ?? 0 }}" aria-label="Изменить приоритет">
                      <mat-icon>priority_high</mat-icon>
                    </button>
                    <mat-menu #pMenuSending="matMenu">
                      <button mat-menu-item (click)="state.setExactPriority(job, 10)">
                        <mat-icon color="warn">emergency</mat-icon> Критический (10)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 7)">
                        <mat-icon>priority_high</mat-icon> Срочный (7)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 4)">
                        <mat-icon>arrow_upward</mat-icon> Повышенный (4)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 1)">
                        <mat-icon>remove</mat-icon> Обычный (1)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 0)">
                        <mat-icon>arrow_downward</mat-icon> Низкий (0)
                      </button>
                    </mat-menu>
                    <button mat-icon-button color="warn" (click)="state.cancelJob(job.id)"
                      matTooltip="Отменить" aria-label="Отменить задание">
                      <mat-icon>cancel</mat-icon>
                    </button>
                  }
                  @case ('converting') {
                    <button mat-icon-button [matMenuTriggerFor]="pMenuConverting"
                      matTooltip="Приоритет: {{ job.priority ?? 0 }}" aria-label="Изменить приоритет">
                      <mat-icon>priority_high</mat-icon>
                    </button>
                    <mat-menu #pMenuConverting="matMenu">
                      <button mat-menu-item (click)="state.setExactPriority(job, 10)">
                        <mat-icon color="warn">emergency</mat-icon> Критический (10)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 7)">
                        <mat-icon>priority_high</mat-icon> Срочный (7)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 4)">
                        <mat-icon>arrow_upward</mat-icon> Повышенный (4)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 1)">
                        <mat-icon>remove</mat-icon> Обычный (1)
                      </button>
                      <button mat-menu-item (click)="state.setExactPriority(job, 0)">
                        <mat-icon>arrow_downward</mat-icon> Низкий (0)
                      </button>
                    </mat-menu>
                    <button mat-icon-button color="warn" (click)="state.cancelJob(job.id)"
                      matTooltip="Отменить" aria-label="Отменить задание">
                      <mat-icon>cancel</mat-icon>
                    </button>
                  }
                  @case ('paused') {
                    <button mat-icon-button (click)="state.resumeJob(job.id)"
                      matTooltip="Продолжить" aria-label="Продолжить печать">
                      <mat-icon>play_arrow</mat-icon>
                    </button>
                    <button mat-icon-button color="warn" (click)="state.cancelJob(job.id)"
                      matTooltip="Отменить" aria-label="Отменить задание">
                      <mat-icon>cancel</mat-icon>
                    </button>
                  }
                  @case ('held') {
                    <button mat-icon-button (click)="state.releaseJob(job.id)"
                      matTooltip="Отпустить" aria-label="Отпустить задание">
                      <mat-icon>lock_open</mat-icon>
                    </button>
                    <button mat-icon-button color="warn" (click)="state.cancelJob(job.id)"
                      matTooltip="Отменить" aria-label="Отменить задание">
                      <mat-icon>cancel</mat-icon>
                    </button>
                  }
                  @case ('failed') {
                    <button mat-icon-button (click)="state.retryJob(job.id)" matTooltip="Повторить"
                      aria-label="Повторить задание">
                      <mat-icon>replay</mat-icon>
                    </button>
                    <button mat-icon-button (click)="openReassignDialog(job)"
                      matTooltip="Переназначить" aria-label="Переназначить задание">
                      <mat-icon>swap_horiz</mat-icon>
                    </button>
                    <button mat-icon-button color="warn" (click)="state.cancelJob(job.id)"
                      matTooltip="Отменить" aria-label="Отменить задание">
                      <mat-icon>cancel</mat-icon>
                    </button>
                  }
                  @case ('cancelled') {
                    <button mat-icon-button (click)="state.retryJob(job.id)" matTooltip="Повторить"
                      aria-label="Повторить задание">
                      <mat-icon>replay</mat-icon>
                    </button>
                  }
                }

                <!-- Assign to group -->
                <button mat-icon-button [matMenuTriggerFor]="groupAssignMenu"
                  matTooltip="{{ job.group_id ? 'Сменить группу' : 'В группу' }}">
                  <mat-icon>{{ job.group_id ? 'folder' : 'folder_open' }}</mat-icon>
                </button>
                <mat-menu #groupAssignMenu="matMenu">
                  @for (g of state.groups(); track g.id) {
                    <button mat-menu-item (click)="state.assignToGroup(job.id, g.id)" [disabled]="job.group_id === g.id">
                      <mat-icon>folder</mat-icon> {{ state.groupMap().get(g.id)?.name || g.id.slice(0, 8) }}
                    </button>
                  }
                  @if (job.group_id) {
                    <mat-divider></mat-divider>
                    <button mat-menu-item (click)="state.removeFromGroup(job.id)">
                      <mat-icon color="warn">folder_off</mat-icon> Убрать из группы
                    </button>
                  }
                </mat-menu>

                <!-- State transitions history -->
                <button mat-icon-button (click)="openTransitionsDialog(job)" matTooltip="История">
                  <mat-icon>history</mat-icon>
                </button>
              </div>

              <!-- Finishing ops chips -->
              @if (getAvailableFinishing(job).length) {
                <div class="finishing-chips">
                  @for (op of getAvailableFinishing(job); track op.id) {
                    <mat-chip-option [selected]="isFinishingOpActive(job, op.id)"
                      (selectionChange)="toggleFinishingOp(job, op.id)">
                      {{ op.label }}
                    </mat-chip-option>
                  }
                </div>
              }

              <!-- Expandable job details -->
              @if (state.expandedJobId() === job.id) {
                <div class="job-details">
                  <div class="detail-grid">
                    <div class="detail-item"><span class="detail-label">ID</span><span class="detail-value">{{ job.id }}</span></div>
                    <div class="detail-item"><span class="detail-label">Создал</span><span class="detail-value">{{ job.creator_name || job.created_by }}</span></div>
                    <div class="detail-item"><span class="detail-label">Создано</span><span class="detail-value">{{ job.created_at | date:'dd.MM.yyyy HH:mm:ss' }}</span></div>
                    <div class="detail-item"><span class="detail-label">Бумага</span><span class="detail-value">{{ job.paper_size }}</span></div>
                    <div class="detail-item"><span class="detail-label">Режим</span><span class="detail-value">{{ fitModeLabel(job.fit_mode) }}</span></div>
                    <div class="detail-item"><span class="detail-label">Копий</span><span class="detail-value">{{ job.copies }}</span></div>
                    <div class="detail-item"><span class="detail-label">Цвет</span><span class="detail-value">{{ job.color_mode === 'bw' ? 'Ч/Б' : 'Цветная' }}</span></div>
                    @if (job.media_type) {
                      <div class="detail-item"><span class="detail-label">Тип бумаги</span><span class="detail-value">{{ job.media_type }}</span></div>
                    }
                    @if (job.conversion_dpi) {
                      <div class="detail-item"><span class="detail-label">DPI</span><span class="detail-value">{{ job.conversion_dpi }}</span></div>
                    }
                    @if (job.held_by) {
                      <div class="detail-item"><span class="detail-label">Удержал</span><span class="detail-value">{{ job.held_by }}</span></div>
                    }
                    @if (job.held_at) {
                      <div class="detail-item"><span class="detail-label">Удержано</span><span class="detail-value">{{ job.held_at | date:'dd.MM.yyyy HH:mm:ss' }}</span></div>
                    }
                    @if (job.scheduled_at) {
                      <div class="detail-item"><span class="detail-label">Запланировано</span><span class="detail-value">{{ job.scheduled_at | date:'dd.MM.yyyy HH:mm:ss' }}</span></div>
                    }
                    @if (job.finishing_ops?.length) {
                      <div class="detail-item"><span class="detail-label">Финишная обр.</span><span class="detail-value">{{ job.finishing_ops!.join(', ') }}</span></div>
                    }
                    @if (job.completed_at) {
                      <div class="detail-item"><span class="detail-label">Завершено</span><span class="detail-value">{{ job.completed_at | date:'dd.MM.yyyy HH:mm:ss' }}</span></div>
                    }
                  </div>
                  @if (job.error_message && ['failed','cancelled'].includes(job.status)) {
                    <div class="error-msg detail-error">
                      {{ job.error_message }}
                      <button mat-stroked-button class="retry-detail-btn" (click)="state.retryJob(job.id)">
                        <mat-icon>replay</mat-icon> Повторить
                      </button>
                    </div>
                  }
                </div>
              }

              @if (job.status === 'converting' || job.status === 'processing' || job.status === 'splitting') {
                <mat-progress-bar mode="indeterminate" class="job-progress converting-progress"></mat-progress-bar>
              }
              @if (job.status === 'sending' || job.status === 'printing') {
                <mat-progress-bar
                  [mode]="job.progress_percent !== null && job.progress_percent !== undefined ? 'determinate' : 'indeterminate'"
                  [value]="job.progress_percent ?? 0"
                  class="job-progress">
                </mat-progress-bar>
                @if (job.progress_percent !== null && job.progress_percent !== undefined) {
                  <span class="progress-label">{{ job.progress_percent }}%</span>
                }
              }
              @if (job.status === 'finishing') {
                <mat-progress-bar mode="indeterminate" class="job-progress finishing-progress"></mat-progress-bar>
              }
              @if (job.error_message && state.expandedJobId() !== job.id) {
                <div class="error-msg">{{ job.error_message }}</div>
              }
            </mat-card-content>
          </mat-card>
        </ng-template>
      </section>

      <!-- Scheduled jobs section -->
      @if (state.scheduledJobs().length) {
        <mat-divider></mat-divider>
        <section class="queue-section">
          <h3 class="section-title">
            <mat-icon>schedule</mat-icon>
            Запланированные
            <span class="count-badge">{{ state.scheduledJobs().length }}</span>
          </h3>

          @for (job of state.scheduledJobs(); track job.id) {
            <mat-card class="job-card" [class.job-expanded]="state.expandedJobId() === job.id"
              [class.job-selected]="state.selectedJobs().has(job.id)">
              <mat-card-content>
                <div class="job-row">
                  <mat-checkbox [checked]="state.selectedJobs().has(job.id)"
                    (change)="state.toggleSelection(job.id)"
                    (click)="$event.stopPropagation()">
                  </mat-checkbox>
                  <mat-icon class="job-icon" (click)="state.toggleExpanded(job.id)" style="cursor:pointer">schedule</mat-icon>
                  <div class="job-info" role="button" tabindex="0" (click)="state.toggleExpanded(job.id)" (keydown.enter)="state.toggleExpanded(job.id)" (keydown.space)="state.toggleExpanded(job.id)" style="cursor:pointer">
                    <div class="job-file">
                      {{ job.file_name || shortenUrl(job.file_url) }}
                    </div>
                    <div class="job-meta">
                      <span class="printer-badge">{{ job.printer_name }}</span>
                      <span class="paper-badge">{{ job.paper_size }}</span>
                      @if (job.copies > 1) { <span class="copies-badge">x{{ job.copies }}</span> }
                      @if (job.scheduled_at) {
                        <span class="scheduled-badge">
                          <mat-icon class="scheduled-icon">event</mat-icon>
                          {{ job.scheduled_at | date:'dd.MM HH:mm' }}
                        </span>
                      }
                    </div>
                  </div>

                  <span class="status-chip status-scheduled">Запланировано</span>

                  <button mat-icon-button (click)="state.holdJob(job.id)"
                    matTooltip="Удержать" aria-label="Удержать задание">
                    <mat-icon>back_hand</mat-icon>
                  </button>
                  <button mat-icon-button (click)="openReassignDialog(job)"
                    matTooltip="Переназначить" aria-label="Переназначить задание">
                    <mat-icon>swap_horiz</mat-icon>
                  </button>
                  <button mat-icon-button color="warn" (click)="state.cancelJob(job.id)"
                    matTooltip="Отменить" aria-label="Отменить задание">
                    <mat-icon>cancel</mat-icon>
                  </button>
                </div>

                @if (state.expandedJobId() === job.id) {
                  <div class="job-details">
                    <div class="detail-grid">
                      <div class="detail-item"><span class="detail-label">ID</span><span class="detail-value">{{ job.id }}</span></div>
                      <div class="detail-item"><span class="detail-label">Создал</span><span class="detail-value">{{ job.creator_name || job.created_by }}</span></div>
                      <div class="detail-item"><span class="detail-label">Создано</span><span class="detail-value">{{ job.created_at | date:'dd.MM.yyyy HH:mm:ss' }}</span></div>
                      @if (job.scheduled_at) {
                        <div class="detail-item"><span class="detail-label">Запланировано</span><span class="detail-value">{{ job.scheduled_at | date:'dd.MM.yyyy HH:mm:ss' }}</span></div>
                      }
                      <div class="detail-item"><span class="detail-label">Бумага</span><span class="detail-value">{{ job.paper_size }}</span></div>
                      <div class="detail-item"><span class="detail-label">Копий</span><span class="detail-value">{{ job.copies }}</span></div>
                      <div class="detail-item"><span class="detail-label">Цвет</span><span class="detail-value">{{ job.color_mode === 'bw' ? 'Ч/Б' : 'Цветная' }}</span></div>
                    </div>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          }
        </section>
      }

      <mat-divider></mat-divider>

      <!-- Completed jobs section -->
      <section class="queue-section">
        <h3 class="section-title">
          <mat-icon>done_all</mat-icon>
          Завершено
          @if (state.completedJobs().length) {
            <span class="count-badge">{{ state.completedJobs().length }}</span>
          }
        </h3>

        <div class="date-presets">
          <mat-button-toggle-group [value]="state.activeDatePreset()" (change)="state.onDatePreset($event.value)" hideSingleSelectionIndicator>
            <mat-button-toggle value="today">Сегодня</mat-button-toggle>
            <mat-button-toggle value="yesterday">Вчера</mat-button-toggle>
            <mat-button-toggle value="week">Неделя</mat-button-toggle>
          </mat-button-toggle-group>
        </div>

        @for (job of state.completedJobs(); track job.id) {
          <div class="completed-row" role="button" tabindex="0" (click)="state.toggleExpanded(job.id)" (keydown.enter)="state.toggleExpanded(job.id)" (keydown.space)="state.toggleExpanded(job.id)" style="cursor:pointer">
            <mat-icon class="done-icon">check_circle</mat-icon>
            <span class="comp-file">{{ job.file_name || shortenUrl(job.file_url) }}</span>
            <span class="comp-printer">{{ job.printer_name }}</span>
            <span class="comp-time">{{ job.completed_at | date:'HH:mm' }}</span>
            <button mat-icon-button class="reprint-btn" (click)="state.reprintJob(job.id); $event.stopPropagation()"
              matTooltip="Перепечатать" aria-label="Перепечатать задание">
              <mat-icon>refresh</mat-icon>
            </button>
          </div>
          @if (state.expandedJobId() === job.id) {
            <div class="job-details completed-details">
              <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">ID</span><span class="detail-value">{{ job.id }}</span></div>
                <div class="detail-item"><span class="detail-label">Создал</span><span class="detail-value">{{ job.creator_name || job.created_by }}</span></div>
                <div class="detail-item"><span class="detail-label">Создано</span><span class="detail-value">{{ job.created_at | date:'dd.MM.yyyy HH:mm:ss' }}</span></div>
                <div class="detail-item"><span class="detail-label">Завершено</span><span class="detail-value">{{ job.completed_at | date:'dd.MM.yyyy HH:mm:ss' }}</span></div>
                <div class="detail-item"><span class="detail-label">Бумага</span><span class="detail-value">{{ job.paper_size }}</span></div>
                <div class="detail-item"><span class="detail-label">Копий</span><span class="detail-value">{{ job.copies }}</span></div>
              </div>
            </div>
          }
        }
        @if (!state.completedJobs().length && !state.loading()) {
          <div class="empty-small">Нет завершённых заданий</div>
        }
      </section>

      <!-- Load more pagination -->
      @if (state.hasMore()) {
        <div class="load-more-section">
          <button mat-stroked-button (click)="state.loadMore()" [disabled]="state.loadingMore()"
            aria-label="Загрузить ещё задания">
            @if (state.loadingMore()) {
              <mat-spinner diameter="20"></mat-spinner>
            }
            Загрузить ещё ({{ state.allJobs().length }} из {{ state.totalJobs() }})
          </button>
        </div>
      }

    </div>
  `,
  styles: [`
    :host { display: block; }
    .print-queue-page { padding: 20px 24px; max-width: 1200px; margin: 0 auto; }
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .page-header h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 20px; }
    .header-controls { display: flex; align-items: center; gap: 12px; }

    /* Offline banner */
    .offline-banner {
      display: flex; align-items: center; gap: 8px; padding: 10px 16px; margin-bottom: 16px;
      background: var(--crm-status-warning-container); color: var(--crm-status-warning);
      border-radius: 8px; font-size: 13px; font-weight: 500;
    }

    /* Health dashboard */
    .health-dashboard {
      display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
    }
    .health-card {
      flex: 1; min-width: 120px; padding: 12px 16px; border-radius: 12px;
      background: var(--mat-sys-surface-variant); text-align: center;
    }
    .health-card.health-error { background: var(--mat-sys-error-container); }
    .health-card.health-error .health-value { color: var(--mat-sys-on-error-container); }
    .health-card.health-warn { background: var(--crm-status-warning-container); }
    .health-card.health-warn .health-value { color: var(--crm-status-warning); }
    .health-card.health-paused { background: var(--crm-print-paused-bg, rgba(245, 158, 11, 0.12)); }
    .health-card.health-paused .health-value { color: var(--crm-print-paused, #f59e0b); }
    .health-card.health-held { background: var(--crm-print-held-bg, rgba(167, 139, 250, 0.12)); }
    .health-card.health-held .health-value { color: var(--crm-print-held, #a78bfa); }
    .health-value { font-size: 22px; font-weight: 700; color: var(--mat-sys-on-surface); }
    .health-label { font-size: 12px; color: var(--mat-sys-on-surface-variant); margin-top: 2px; }

    /* Filters */
    .filters-bar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
    }
    .filter-field { width: 180px; }
    .status-filter-chips { flex: 1; }

    /* Bulk actions bar */
    .bulk-bar {
      display: flex; align-items: center; gap: 10px; padding: 10px 16px;
      background: var(--mat-sys-primary-container); border-radius: 8px; margin-bottom: 12px;
    }
    .bulk-count { font-weight: 600; color: var(--mat-sys-on-primary-container); margin-right: auto; }

    /* Printer status */
    .printers-status { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .printer-card { flex: 1; min-width: 200px; }
    .printer-card.offline { opacity: .6; }
    .printer-card.queue-paused { border-left: 3px solid var(--crm-print-paused, #f59e0b); }
    .printer-row { display: flex; align-items: center; gap: 8px; }
    .printer-name { font-weight: 500; flex: 1; }
    .printer-paused-badge {
      font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;
      background: var(--crm-print-paused-bg, rgba(245, 158, 11, 0.12));
      color: var(--crm-print-paused, #f59e0b);
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mat-sys-error); }
    .status-dot.online { background: var(--crm-status-success); }
    .status-text { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .jobs-badge { font-size: 11px; background: var(--mat-sys-primary); color: var(--mat-sys-on-primary);
      border-radius: 10px; padding: 1px 6px; }
    .printer-queue-action {
      width: 30px !important;
      height: 30px !important;
      padding: 0 !important;
      flex-shrink: 0;
    }
    .printer-queue-action mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .printer-queue-spinner {
      flex: 0 0 18px;
      margin-left: 4px;
    }
    .printer-queue-note {
      display: flex; align-items: center; gap: 6px; margin-top: 8px;
      padding: 6px 8px; border-radius: 6px;
      background: var(--crm-print-paused-bg, rgba(245, 158, 11, 0.12));
      color: var(--crm-print-paused, #f59e0b);
      font-size: 12px; line-height: 1.3;
    }
    .printer-queue-note mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; }
    .printer-queue-note span { min-width: 0; }
    .printer-problem {
      display: flex; align-items: center; gap: 6px; margin-top: 8px;
      padding: 6px 8px; border-radius: 6px;
      background: var(--crm-status-warning-container); color: var(--crm-status-warning);
      font-size: 12px; line-height: 1.3;
    }
    .printer-problem.problem-error {
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
    }
    .printer-problem mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; }
    .printer-problem span { flex: 1; min-width: 0; }
    .printer-retry-btn {
      min-height: 28px; padding: 0 8px; flex-shrink: 0;
      --mdc-outlined-button-label-text-size: 12px;
    }
    .printer-retry-btn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .no-printers { display: flex; align-items: center; gap: 8px; color: var(--mat-sys-outline); padding: 16px 0; }

    /* Supply levels */
    .supply-levels { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
    .supply-row { display: flex; align-items: center; gap: 6px; }
    .supply-label { font-size: 11px; min-width: 56px; color: var(--mat-sys-on-surface-variant); }
    .supply-bar { flex: 1; height: 6px; border-radius: 3px; }
    .supply-pct { font-size: 10px; min-width: 28px; text-align: right; font-weight: 500; }
    .supply-ok .mdc-linear-progress__bar-inner { border-color: var(--crm-supply-ok); }
    .supply-warn .mdc-linear-progress__bar-inner { border-color: var(--crm-supply-low); }
    .supply-low .mdc-linear-progress__bar-inner { border-color: var(--crm-supply-critical); }

    /* Forecast badges */
    .forecast-badge {
      font-size: 10px; font-weight: 600; min-width: 42px; text-align: center;
      padding: 1px 4px; border-radius: 4px; white-space: nowrap;
      display: inline-flex; align-items: center; gap: 3px;
    }
    .forecast-ok { color: var(--crm-status-success); }
    .forecast-warning { color: var(--crm-status-warning); background: var(--crm-status-warning-container); }
    .forecast-critical { color: var(--crm-status-error); background: var(--crm-status-error-container); }
    .pulse-dot {
      width: 6px; height: 6px; border-radius: 50%; background: var(--crm-status-error);
      animation: pulse-critical 1s ease-in-out infinite;
    }
    @keyframes pulse-critical {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* Reprint button */
    .reprint-btn { width: 24px; height: 24px; line-height: 24px; flex-shrink: 0; }
    .reprint-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }

    /* Select all checkbox */
    .select-all-cb { margin-left: auto; font-size: 12px; }

    /* Sections */
    .queue-section { padding: 16px 0; }
    .section-title { display: flex; align-items: center; gap: 8px; font-size: 15px;
      color: var(--mat-sys-on-surface-variant); margin: 0 0 12px; }
    .count-badge { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container);
      border-radius: 10px; padding: 1px 8px; font-size: 12px; }

    /* Job cards */
    .job-card { margin-bottom: 8px; transition: box-shadow 0.15s; }
    .job-card.job-selected { box-shadow: inset 0 0 0 2px var(--mat-sys-primary); }
    .job-card.job-expanded { box-shadow: 0 2px 8px color-mix(in srgb, var(--mat-sys-shadow) 15%, transparent); }
    .job-row { display: flex; align-items: flex-start; gap: 12px; }
    .job-icon { color: var(--mat-sys-on-surface-variant); margin-top: 2px; }
    .job-info { flex: 1; min-width: 0; }
    .job-file { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      display: flex; align-items: center; gap: 6px; }
    .job-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .printer-badge, .paper-badge, .copies-badge, .bw-badge, .duplex-badge {
      font-size: 11px; padding: 1px 6px; border-radius: 4px;
      background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant); }
    .scheduled-badge {
      display: inline-flex; align-items: center; gap: 2px;
      font-size: 11px; padding: 1px 6px; border-radius: 4px;
      background: var(--crm-print-scheduled-bg, rgba(99, 102, 241, 0.12));
      color: var(--crm-print-scheduled, #6366f1);
    }
    .scheduled-icon { font-size: 14px; width: 14px; height: 14px; }

    /* Copy progress badge */
    .copy-progress-badge {
      font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
      background: var(--crm-print-printing-bg, rgba(56, 189, 248, 0.12));
      color: var(--crm-print-printing, #38bdf8);
      white-space: nowrap; align-self: center;
    }

    /* SLA age badges */
    .age-badge {
      font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
      white-space: nowrap; align-self: center;
    }
    .age-ok { background: var(--crm-status-success-container); color: var(--crm-status-success); }
    .age-warn { background: var(--crm-status-warning-container); color: var(--crm-status-warning); }
    .age-critical {
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
      animation: pulse-age 1s ease-in-out infinite;
    }
    @keyframes pulse-age {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    /* Estimated wait */
    .wait-badge {
      font-size: 11px; padding: 2px 8px; border-radius: 10px;
      background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant);
      white-space: nowrap; align-self: center;
    }

    /* Priority badges */
    .priority-badge {
      font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px;
      white-space: nowrap; flex-shrink: 0;
    }
    .priority-urgent { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .priority-elevated { background: var(--crm-status-warning-container); color: var(--crm-status-warning); }

    /* Status chips — all 14 statuses via CSS custom properties */
    .status-chip { font-size: 12px; padding: 3px 10px; border-radius: 12px; font-weight: 500;
      align-self: center; white-space: nowrap; }
    .status-queued     { background: var(--crm-print-queued-bg); color: var(--crm-print-queued); }
    .status-paused     { background: var(--crm-print-paused-bg); color: var(--crm-print-paused); }
    .status-held       { background: var(--crm-print-held-bg); color: var(--crm-print-held); }
    .status-scheduled  { background: var(--crm-print-scheduled-bg); color: var(--crm-print-scheduled); }
    .status-converting { background: var(--crm-print-converting-bg); color: var(--crm-print-converting); }
    .status-splitting  { background: var(--crm-print-splitting-bg); color: var(--crm-print-splitting); }
    .status-rendering  { background: var(--crm-print-rendering-bg); color: var(--crm-print-rendering); }
    .status-icc        { background: var(--crm-print-icc-bg); color: var(--crm-print-icc); }
    .status-sending    { background: var(--crm-print-sending-bg); color: var(--crm-print-sending); }
    .status-processing { background: var(--crm-status-info-container); color: var(--crm-status-info); }
    .status-printing   { background: var(--crm-print-printing-bg); color: var(--crm-print-printing); }
    .status-finishing   { background: var(--crm-print-finishing-bg); color: var(--crm-print-finishing); }
    .status-completed  { background: var(--crm-print-completed-bg); color: var(--crm-print-completed); }
    .status-failed     { background: var(--crm-print-failed-bg); color: var(--crm-print-failed); }
    .status-cancelled  { background: var(--crm-print-cancelled-bg); color: var(--crm-print-cancelled); }

    .converting-progress .mdc-linear-progress__bar-inner { border-color: var(--crm-print-converting); }
    .finishing-progress .mdc-linear-progress__bar-inner { border-color: var(--crm-print-finishing); }

    .page-badge {
      font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 500;
      background: var(--crm-status-info-container); color: var(--crm-status-info);
    }
    .split-badge {
      display: inline-flex; align-items: center; gap: 2px; font-size: 11px;
      padding: 1px 6px; border-radius: 10px;
      background: rgba(156,39,176,.15); color: #9c27b0;
    }
    .split-badge mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .auto-icon { font-size: 14px !important; width: 14px !important; height: 14px !important; color: #ff9800; }

    .job-progress { margin-top: 8px; border-radius: 2px; }
    .progress-label {
      font-size: 11px; color: var(--mat-sys-on-surface-variant);
      margin-top: 2px; text-align: right; display: block;
    }
    .error-msg { margin-top: 6px; font-size: 12px; color: var(--mat-sys-error);
      background: var(--mat-sys-error-container); padding: 4px 8px; border-radius: 4px; }

    /* Job details (expandable) */
    .job-details {
      margin-top: 10px; padding: 10px 12px; border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
    }
    .detail-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px 16px;
    }
    .detail-item { display: flex; gap: 6px; font-size: 12px; }
    .detail-label { color: var(--mat-sys-on-surface-variant); min-width: 72px; flex-shrink: 0; }
    .detail-value { color: var(--mat-sys-on-surface); word-break: break-all; }
    .detail-error { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .retry-detail-btn { margin-left: auto; }
    .completed-details { margin: 0 0 8px; }

    /* Pulse animations */
    .status-sending {
      animation: pulse-sending 2s ease-in-out infinite;
    }
    .status-printing {
      animation: pulse-printing 1.5s ease-in-out infinite;
    }
    .status-converting {
      animation: pulse-converting 2s ease-in-out infinite;
    }
    .status-paused {
      animation: pulse-paused 3s ease-in-out infinite;
    }
    @keyframes pulse-converting {
      0%, 100% { box-shadow: none; }
      50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--crm-print-converting) 25%, transparent); }
    }
    @keyframes pulse-sending {
      0%, 100% { box-shadow: none; }
      50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--crm-print-sending) 25%, transparent); }
    }
    @keyframes pulse-printing {
      0%, 100% { box-shadow: none; }
      50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--crm-print-printing) 25%, transparent); }
    }
    @keyframes pulse-paused {
      0%, 100% { box-shadow: none; }
      50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--crm-print-paused) 25%, transparent); }
    }

    /* Completed */
    .completed-row { display: flex; align-items: center; gap: 8px; padding: 6px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant); font-size: 13px; }
    .done-icon { font-size: 16px; height: 16px; width: 16px; color: var(--crm-status-success); }
    .comp-file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .comp-printer { color: var(--mat-sys-on-surface-variant); font-size: 12px; }
    .comp-time { color: var(--mat-sys-outline); font-size: 12px; }

    .loading-row { padding: 8px 0; }
    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 32px; color: var(--mat-sys-outline); }
    .empty-state mat-icon { font-size: 40px; height: 40px; width: 40px; }
    .empty-small { font-size: 13px; color: var(--mat-sys-outline); padding: 8px 0; }

    /* Supply alerts banner */
    .supply-alerts-banner {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 10px 16px; margin-bottom: 12px;
      background: rgba(251, 191, 36, 0.1); border-radius: 8px;
      font-size: 13px; color: #b45309;
    }
    .supply-alert-item {
      padding: 2px 8px; border-radius: 4px;
      background: rgba(251, 191, 36, 0.15); font-weight: 500;
    }

    /* Load more */
    .load-more-section { text-align: center; padding: 16px 0; }

    /* Group headers (S15) */
    .group-header {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 4px;
      background: var(--mat-sys-surface-variant); border-radius: 8px; cursor: pointer;
      user-select: none; transition: background 0.15s;
    }
    .group-header:hover { background: var(--mat-sys-surface-container-high); }
    .group-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-primary); }
    .group-title { font-weight: 600; font-size: 14px; flex: 1; }
    .group-count {
      font-size: 12px; padding: 2px 8px; border-radius: 10px;
      background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container);
    }
    .ungrouped-title {
      font-size: 13px; color: var(--mat-sys-on-surface-variant); margin: 12px 0 8px;
      display: flex; align-items: center; gap: 6px;
    }
    .group-badge {
      display: inline-flex; align-items: center; gap: 2px; font-size: 10px;
      padding: 1px 6px; border-radius: 4px; font-weight: 500;
      background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container);
    }
    .group-badge mat-icon { font-size: 12px; width: 12px; height: 12px; }

    /* Group progress & actions */
    .group-progress { font-size: 12px; font-weight: 600; color: var(--mat-sys-on-surface-variant); }
    .group-progress-bar { width: 60px; height: 4px; border-radius: 2px; }
    .group-actions { display: flex; gap: 2px; margin-left: 4px; }
    .group-actions button { width: 28px; height: 28px; }
    .group-actions mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* Finishing chips */
    .finishing-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }

    /* Search field */
    .search-field { width: 220px; }
    .search-field mat-icon[matPrefix] { margin-right: 4px; }

    /* Date presets */
    .date-presets { margin-bottom: 12px; }
    .date-presets mat-button-toggle-group { font-size: 13px; }
  `],
})
export class PrintQueueComponent {
  readonly state = inject(PrintQueueStateService);
  private readonly dialog = inject(MatDialog);

  private searchTimeout: ReturnType<typeof setTimeout> | undefined;

  private static readonly PRINTER_REASON_LABELS: Record<string, string> = {
    'media-empty': 'нет бумаги',
    'media-needed': 'нужна бумага',
    'media-jam': 'замятие бумаги',
    'media-low': 'бумага заканчивается',
    'input-tray-missing': 'лоток не установлен',
    'media-feed-error': 'ошибка захвата листа',
    'media-path-failure': 'ошибка тракта бумаги',
    'paper-out': 'нет бумаги',
    'paper-jam': 'замятие бумаги',
    'out-of-paper': 'нет бумаги',
    'no-paper': 'нет бумаги',
    'cover-open': 'крышка открыта',
    'door-open': 'крышка открыта',
    'marker-supply-empty': 'закончились чернила/тонер',
    'marker-supply-low': 'низкий уровень чернил/тонера',
    'paused': 'принтер на паузе',
    'offline': 'нет связи с принтером',
    'connecting-to-device': 'подключение к принтеру',
    'spool-area-full': 'очередь переполнена',
  };

  private static readonly PAPER_REASONS: ReadonlySet<string> = new Set([
    'media-empty',
    'media-needed',
    'media-jam',
    'media-low',
    'input-tray-missing',
    'media-feed-error',
    'media-path-failure',
    'paper-out',
    'paper-jam',
    'out-of-paper',
    'no-paper',
  ]);

  // ─── Keyboard shortcuts ───────────────────────────────

  onKeydown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const selected = this.state.selectedJobs();
    const hasSelection = selected.size > 0;

    switch (event.key) {
      case ' ':
        if (!hasSelection) return;
        event.preventDefault();
        if (this.state.hasPausableSelected()) {
          this.state.bulkPause();
        } else if (this.state.hasResumableSelected()) {
          this.state.bulkResume();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (!hasSelection) return;
        event.preventDefault();
        this.state.bulkCancel();
        break;
      case 'r': case 'R':
        if (!hasSelection || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        if (this.state.hasRetryableSelected()) {
          this.state.bulkRetry();
        }
        break;
      case 'a':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.state.selectAllActive();
        }
        break;
      case 'Escape':
        if (hasSelection) {
          event.preventDefault();
          this.state.deselectAll();
        }
        break;
      case 'F5':
        event.preventDefault();
        this.state.refresh();
        break;
    }
  }

  // ─── View helpers ─────────────────────────────────────

  getPrinterName(printerId: string): string {
    return this.state.printers().find(p => p.id === printerId)?.name ?? printerId;
  }

  onSearchInput(event: Event): void {
    clearTimeout(this.searchTimeout);
    const value = (event.target as HTMLInputElement).value;
    this.searchTimeout = setTimeout(() => this.state.filterSearch.set(value), 300);
  }

  openCreateGroupDialog(): void {
    const ref = this.dialog.open(CreateGroupDialogComponent, { width: '400px' });
    ref.afterClosed().subscribe(r => { if (r) this.state.createGroup(r.name, r.customerName); });
  }

  openTransitionsDialog(job: PrintJob): void {
    this.dialog.open(JobTransitionsDialogComponent, {
      width: '500px',
      data: { jobId: job.id, fileName: job.file_name || job.file_url },
    });
  }

  getGroupName(groupId: string): string {
    return this.state.groupMap().get(groupId)?.name || `Группа ${groupId.slice(0, 8)}`;
  }

  getAvailableFinishing(job: PrintJob): { id: string; label: string }[] {
    const printer = this.state.printers().find(p => p.id === job.printer_id);
    return (printer?.capabilities?.finishing ?? []).map(f => ({ id: f.id, label: f.name || f.id }));
  }

  isFinishingOpActive(job: PrintJob, opId: string): boolean {
    return job.finishing_ops?.includes(opId) ?? false;
  }

  toggleFinishingOp(job: PrintJob, opId: string): void {
    const current = job.finishing_ops ?? [];
    const ops = current.includes(opId) ? current.filter(o => o !== opId) : [...current, opId];
    this.state.updateFinishingOps(job.id, ops);
  }

  openReassignDialog(job: PrintJob): void {
    const printers = this.state.printers().filter(p =>
      p.printer_type === job.printer_type && p.id !== job.printer_id && p.is_active
    );
    if (!printers.length) {
      this.state.toast.warning('Нет доступных принтеров');
      return;
    }
    const dialogRef = this.dialog.open(ReassignPrinterDialogComponent, {
      width: '400px',
      data: {
        currentPrinterId: job.printer_id,
        printerType: job.printer_type,
        printers: printers.map(p => ({ id: p.id, name: p.name })),
        statuses: this.state.statuses(),
      },
    });
    dialogRef.afterClosed().subscribe(selectedId => {
      if (selectedId) this.state.reassignJob(job.id, selectedId);
    });
  }

  getPrinterOnline(printer: Printer): boolean {
    const s = this.state.statuses().find(st => st.printer_name === printer.cups_printer_name);
    return s?.online ?? printer.is_active;
  }

  getPrinterProblem(printer: Printer): PrinterProblem | null {
    const status = this.state.statuses().find(st => st.printer_name === printer.cups_printer_name);
    const telemetry = this.state.telemetry().find(t => t.printer_id === printer.id);
    const rawReasons = status?.state_reasons?.length ? status.state_reasons : telemetry?.state_reasons ?? [];
    const reasons = rawReasons
      .map(reason => reason.trim())
      .filter(reason => reason.length > 0 && this.normalizePrinterReason(reason) !== 'none');
    const state = status?.state ?? telemetry?.state ?? '';

    if (!reasons.length) {
      if (state === 'stopped') {
        return { label: 'Принтер остановлен', icon: 'error', severity: 'error' };
      }
      if (!this.getPrinterOnline(printer)) {
        return { label: 'Нет связи с принтером', icon: 'cloud_off', severity: 'warning' };
      }
      return null;
    }

    const hasPaperProblem = reasons.some(reason =>
      PrintQueueComponent.PAPER_REASONS.has(this.normalizePrinterReason(reason))
    );
    const labels = reasons.map(reason => this.formatPrinterReason(reason));
    const hasErrorReason = state === 'stopped' || reasons.some(reason => reason.endsWith('-error'));
    const severity: PrinterProblem['severity'] = hasPaperProblem || hasErrorReason ? 'error' : 'warning';

    return {
      label: `${hasPaperProblem ? 'Проблема подачи бумаги: ' : ''}${labels.join(', ')}`,
      icon: hasPaperProblem ? 'article' : severity === 'error' ? 'error' : 'warning_amber',
      severity,
    };
  }

  getLatestRetryableJob(printer: Printer): PrintJob | null {
    if (!this.getPrinterOnline(printer)) return null;
    return this.state.allJobs()
      .filter(job => job.printer_id === printer.id && ['failed', 'cancelled'].includes(job.status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
  }

  getActiveJobsCount(printerId: string): number {
    return this.state.allJobs().filter(j =>
      j.printer_id === printerId &&
      ['queued', 'converting', 'sending', 'processing', 'printing', 'splitting', 'finishing'].includes(j.status)
    ).length;
  }

  getJobAge(job: PrintJob): { minutes: number; level: string } {
    const m = Math.round((Date.now() - new Date(job.created_at).getTime()) / 60000);
    return { minutes: m, level: m > 15 ? 'critical' : m > 5 ? 'warn' : 'ok' };
  }

  getEstimatedWait(job: PrintJob): number {
    const position = this.state.activeJobs().filter(j =>
      j.printer_id === job.printer_id &&
      j.id !== job.id &&
      ['queued', 'converting'].includes(j.status) &&
      ((j.priority ?? 0) > (job.priority ?? 0) ||
       ((j.priority ?? 0) === (job.priority ?? 0) && j.created_at < job.created_at))
    ).length;

    const completed = this.state.allJobs()
      .filter(j => j.printer_id === job.printer_id && j.status === 'completed' && j.completed_at)
      .slice(0, 20);

    if (!completed.length) return position * 2;

    const avgMinutes = completed.reduce((sum, j) => {
      const dur = new Date(j.completed_at!).getTime() - new Date(j.created_at).getTime();
      return sum + dur;
    }, 0) / completed.length / 60000;

    return Math.round(position * avgMinutes);
  }

  jobStatusIcon(status: string): string {
    switch (status) {
      case 'queued':     return 'hourglass_empty';
      case 'converting': return 'transform';
      case 'splitting':  return 'call_split';
      case 'rendering':  return 'auto_fix_high';
      case 'icc':        return 'palette';
      case 'sending':    return 'upload';
      case 'processing': return 'hourglass_top';
      case 'printing':   return 'print';
      case 'finishing':  return 'content_cut';
      case 'paused':     return 'pause_circle';
      case 'held':       return 'back_hand';
      case 'scheduled':  return 'schedule';
      case 'completed':  return 'check_circle';
      case 'failed':     return 'error';
      case 'cancelled':  return 'cancel';
      default:           return 'help';
    }
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'queued':     return 'Ожидание';
      case 'converting': return 'Конвертация';
      case 'splitting':  return 'Разделение';
      case 'rendering':  return 'Рендеринг';
      case 'icc':        return 'ICC';
      case 'sending':    return 'Отправка';
      case 'processing': return 'Обработка';
      case 'printing':   return 'Печать';
      case 'finishing':  return 'Финализация';
      case 'paused':     return 'Пауза';
      case 'held':       return 'Удержано';
      case 'scheduled':  return 'Запланировано';
      case 'completed':  return 'Готово';
      case 'failed':     return 'Ошибка';
      case 'cancelled':  return 'Отменено';
      default:           return status;
    }
  }

  private normalizePrinterReason(reason: string): string {
    return reason.replace(/-(report|warning|error)$/u, '');
  }

  private formatPrinterReason(reason: string): string {
    const normalized = this.normalizePrinterReason(reason);
    return PrintQueueComponent.PRINTER_REASON_LABELS[normalized]
      ?? PrintQueueComponent.PRINTER_REASON_LABELS[reason]
      ?? reason.replace(/-/g, ' ');
  }

  fitModeLabel(mode?: string): string {
    return mode === 'fill' ? 'Заполнение'
      : mode === 'fit' ? 'Вписать'
      : mode === 'stretch' ? 'Растянуть'
      : mode === 'crop' ? 'Обрезка'
      : mode ?? 'Авто';
  }

  shortenUrl(url: string): string {
    try {
      return decodeURIComponent(url).split('/').pop() ?? url;
    } catch {
      return url.split('/').pop() ?? url;
    }
  }

  // ─── Supply helpers (pure view logic, kept in component) ──

  private static readonly SUPPLY_LABELS: Record<string, string> = {
    ink_cyan: 'Cyan', ink_magenta: 'Magenta', ink_yellow: 'Yellow',
    ink_black: 'Black', ink_light_cyan: 'Lt Cyan', ink_light_magenta: 'Lt Magenta',
    toner_black: 'Тонер', toner_cyan: 'Cyan', toner_magenta: 'Magenta',
    toner_yellow: 'Yellow', drum: 'Барабан', waste_toner: 'Отработка',
  };

  private static readonly SUPPLY_COLORS: Record<string, string> = {
    ink_cyan: '#00bcd4', ink_magenta: '#e91e63', ink_yellow: '#ffeb3b',
    ink_black: '#424242', ink_light_cyan: '#80deea', ink_light_magenta: '#f48fb1',
    toner_black: '#424242', toner_cyan: '#00bcd4', toner_magenta: '#e91e63',
    toner_yellow: '#ffeb3b',
  };

  getSupplies(printerId: string): { key: string; label: string; value: number; level: string; color: string }[] | null {
    const t = this.state.telemetry().find(x => x.printer_id === printerId);
    if (!t?.supplies || typeof t.supplies !== 'object') return null;
    const entries = Object.entries(t.supplies)
      .filter(([, v]) => typeof v === 'number')
      .map(([key, value]) => ({
        key,
        label: PrintQueueComponent.SUPPLY_LABELS[key] ?? key.replace(/_/g, ' '),
        value: value as number,
        level: (value as number) > 50 ? 'ok' : (value as number) >= 20 ? 'warn' : 'low',
        color: PrintQueueComponent.SUPPLY_COLORS[key] ?? '#9e9e9e',
      }));
    return entries.length ? entries : null;
  }

  getSupplyForecast(printerId: string, supplyLabel: string): { days: number | null; status: string } | null {
    const pf = this.state.forecastData().find(f => f.printer_id === printerId);
    if (!pf) return null;
    const s = pf.supplies.find(sf => sf.name === supplyLabel);
    if (!s) return null;
    return { days: s.days_remaining, status: s.status };
  }
}
