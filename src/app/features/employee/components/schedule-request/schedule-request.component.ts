import {
  Component, inject, signal, computed, OnInit, PLATFORM_ID, ChangeDetectionStrategy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { ShiftsApiService, ScheduleRequest, ScheduleRequestedShift, ShiftStudio } from '../../services/shifts-api.service';

type ShiftPattern = '2/2' | '1/1' | '3/3' | '5/2' | 'custom';

interface DayCell {
  date: string;    // YYYY-MM-DD
  label: string;   // 'пн 2', 'вт 3', …
  isWork: boolean;
  isInRange: boolean;
}

interface RequestLocationGroup {
  key: string;
  label: string;
  datesLabel: string;
  count: number;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function generatePreview(pattern: ShiftPattern, startDate: string, endDate: string): DayCell[] {
  if (!startDate || !endDate) return [];
  const patterns: Record<string, { work: number; rest: number }> = {
    '2/2': { work: 2, rest: 2 },
    '1/1': { work: 1, rest: 1 },
    '3/3': { work: 3, rest: 3 },
  };

  // 5/2 — calendar-aware: Mon-Fri work, Sat-Sun rest
  if (pattern === '5/2') {
    const cells: DayCell[] = [];
    const cursor = new Date(startDate);
    const end = new Date(endDate);
    const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const mo = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      const dateStr = `${y}-${mo}-${d}`;
      const dow = cursor.getDay();
      cells.push({
        date: dateStr,
        label: `${DAY_NAMES[dow]} ${cursor.getDate()}`,
        isWork: dow >= 1 && dow <= 5,
        isInRange: true,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return cells;
  }

  const p = patterns[pattern];
  const cells: DayCell[] = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);

  const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  let dayOffset = 0;

  while (cursor <= end) {
    const y = cursor.getFullYear();
    const mo = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const dateStr = `${y}-${mo}-${d}`;
    let isWork = false;
    if (pattern === 'custom') {
      isWork = true;
    } else if (p) {
      const cycle = p.work + p.rest;
      isWork = (dayOffset % cycle) < p.work;
    }
    cells.push({
      date: dateStr,
      label: `${DAY_NAMES[cursor.getDay()]} ${cursor.getDate()}`,
      isWork,
      isInRange: true,
    });
    cursor.setDate(cursor.getDate() + 1);
    dayOffset++;
  }
  return cells;
}

@Component({
  selector: 'app-schedule-request',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatSelectModule,
  ],
  template: `
    <div class="schedule-request-page">

      <!-- Форма создания запроса -->
      <mat-card class="request-form-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon>event_repeat</mat-icon>
            Запрос на график
          </mat-card-title>
          <mat-card-subtitle>Выберите паттерн и период — смены сгенерируются автоматически</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <!-- Паттерн -->
          <div class="field-section">
            <span class="field-label" aria-label="Тип графика">Тип графика</span>
            <mat-button-toggle-group [(ngModel)]="selectedPattern" [hideSingleSelectionIndicator]="true">
              <mat-button-toggle value="2/2">2/2</mat-button-toggle>
              <mat-button-toggle value="1/1">1/1</mat-button-toggle>
              <mat-button-toggle value="3/3">3/3</mat-button-toggle>
              <mat-button-toggle value="5/2">5/2</mat-button-toggle>
            </mat-button-toggle-group>
            <div class="pattern-hint">
              @switch (selectedPattern()) {
                @case ('2/2') { <span>2 рабочих → 2 выходных → повтор</span> }
                @case ('1/1') { <span>1 рабочий → 1 выходной → повтор</span> }
                @case ('3/3') { <span>3 рабочих → 3 выходных → повтор</span> }
                @case ('5/2') { <span>Пн-Пт работа → Сб-Вс выходные (пятидневка)</span> }
              }
            </div>
          </div>

          <!-- Даты -->
          <div class="dates-row">
            <mat-form-field appearance="outline">
              <mat-label>Начало паттерна</mat-label>
              <input matInput type="date" [(ngModel)]="startDate" [min]="minDate()">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Конец периода</mat-label>
              <input matInput type="date" [(ngModel)]="endDate" [min]="startDate()">
            </mat-form-field>
          </div>

          <!-- Время смены -->
          <div class="times-row">
            <mat-form-field appearance="outline">
              <mat-label>Начало смены</mat-label>
              <input matInput type="time" [(ngModel)]="startTime">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Конец смены</mat-label>
              <input matInput type="time" [(ngModel)]="endTime">
            </mat-form-field>
          </div>

          <!-- Превью календаря -->
          @if (previewDays().length > 0) {
            <div class="preview-section">
              <div class="preview-header">
                <span class="preview-title">Предварительный просмотр</span>
                <div class="preview-legend">
                  <span class="legend-item work"><span class="dot"></span>Рабочий</span>
                  <span class="legend-item rest"><span class="dot"></span>Выходной</span>
                </div>
              </div>
              <div class="days-grid">
                @for (day of previewDays(); track day.date) {
                  <div class="day-cell" [class.work]="day.isWork" [class.rest]="!day.isWork">
                    <span class="day-label">{{ day.label }}</span>
                  </div>
                }
              </div>
              <div class="preview-summary">
                Итого: <strong>{{ workDaysCount() }}</strong> рабочих из {{ previewDays().length }} дней
              </div>
            </div>
          }

          <!-- Комментарий -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Комментарий (необязательно)</mat-label>
            <textarea matInput [(ngModel)]="comment" rows="2" placeholder="Пожелания, уточнения..."></textarea>
          </mat-form-field>
        </mat-card-content>

        <mat-card-actions align="end">
          <button mat-flat-button color="primary"
            [disabled]="!canSubmit() || submitting()"
            (click)="submitRequest()">
            @if (submitting()) {
              <mat-spinner diameter="18" style="display:inline-block;vertical-align:middle;margin-right:8px"></mat-spinner>
            } @else {
              <mat-icon>send</mat-icon>
            }
            Отправить на утверждение
          </button>
        </mat-card-actions>
      </mat-card>

      <!-- Мои запросы -->
      <mat-card class="my-requests-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon>history</mat-icon>
            Мои запросы
          </mat-card-title>
        </mat-card-header>

        <mat-card-content>
          @if (loading()) {
            <div class="loading-center"><mat-spinner diameter="36"></mat-spinner></div>
          } @else if (myRequests().length === 0) {
            <p class="empty-state">Запросов ещё не было</p>
          } @else {
            <div class="requests-list">
              @for (req of myRequests(); track req.id) {
                <div class="request-item">
                  <div class="request-header">
                    <div class="request-meta">
                      <mat-chip [color]="statusColor(req)" highlighted>{{ statusLabel(req) }}</mat-chip>
                      <strong>{{ requestTitle(req) }}</strong>
                      <span class="request-date">{{ formatDate(req.pattern_start_date) }}</span>
                      <span class="request-shifts-count">{{ req.requested_shifts.length || 0 }} смен</span>
                    </div>
                    <span class="request-created">{{ formatDate(req.created_at, true) }}</span>
                  </div>

                  @if (requestLocationGroups(req).length > 0) {
                    <div class="request-details">
                      @for (group of requestLocationGroups(req); track group.key) {
                        <div class="request-location">
                          <mat-icon>place</mat-icon>
                          <span>{{ group.label }}</span>
                          <em>{{ group.datesLabel }} · {{ group.count }} смен</em>
                        </div>
                      }
                    </div>
                  }

                  @if (req.admin_comment) {
                    <div class="admin-comment">
                      <mat-icon>comment</mat-icon>
                      <span>{{ req.admin_comment }}</span>
                    </div>
                  }

                  @if (isAdminProposal(req) && req.status === 'pending') {
                    <div class="proposal-actions">
                      <button mat-flat-button color="primary"
                        [disabled]="proposalSavingId() === req.id"
                        (click)="acceptProposal(req)">
                        @if (proposalSavingId() === req.id) {
                          <mat-spinner diameter="18"></mat-spinner>
                        } @else {
                          <mat-icon>check_circle</mat-icon>
                        }
                        Согласиться
                      </button>
                      <button mat-stroked-button color="warn"
                        [disabled]="proposalSavingId() === req.id"
                        (click)="declineProposal(req)">
                        <mat-icon>cancel</mat-icon>
                        Отказаться
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>

    </div>
  `,
  styles: [`
    .schedule-request-page {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 720px;
    }

    .request-form-card mat-card-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
    }

    .field-section {
      margin-bottom: 20px;
    }

    .field-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: .5px;
    }

    .pattern-hint {
      margin-top: 8px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    .dates-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }

    .times-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }

    .preview-section {
      background: var(--mat-sys-surface-container-low);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .preview-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
    }

    .preview-legend {
      display: flex;
      gap: 12px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
    }

    .legend-item .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .legend-item.work .dot { background: #4caf50; }
    .legend-item.rest .dot { background: #e0e0e0; }

    .days-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .day-cell {
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      min-width: 44px;
      text-align: center;
    }

    .day-cell.work {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .day-cell.rest {
      background: #f5f5f5;
      color: #9e9e9e;
    }

    @media (prefers-color-scheme: dark) {
      .day-cell.work { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
      .day-cell.rest { background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant); }
    }

    .preview-summary {
      margin-top: 10px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    .full-width { width: 100%; }

    .loading-center {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
      padding: 16px;
    }

    .requests-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .request-item {
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
    }

    .request-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }

    .request-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .request-date {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    .request-shifts-count {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      background: var(--mat-sys-surface-container);
      padding: 2px 8px;
      border-radius: 12px;
    }

    .request-created {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .admin-comment {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin-top: 8px;
      padding: 8px;
      background: var(--mat-sys-surface-container-low);
      border-radius: 6px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    .admin-comment mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-top: 1px;
    }

    .request-details {
      display: grid;
      gap: 6px;
      margin-top: 10px;
    }

    .request-location {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      gap: 6px;
      align-items: center;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    .request-location mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .request-location span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mat-sys-on-surface);
      font-weight: 500;
    }

    .request-location em {
      font-style: normal;
      white-space: nowrap;
    }

    .proposal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
    }

    .proposal-actions button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .proposal-actions mat-spinner {
      display: inline-block;
    }

    @media (max-width: 600px) {
      .dates-row,
      .times-row {
        grid-template-columns: 1fr;
      }

      .request-location {
        grid-template-columns: 18px minmax(0, 1fr);
      }

      .request-location em {
        grid-column: 2;
      }

      .proposal-actions {
        justify-content: stretch;
      }

      .proposal-actions button {
        flex: 1;
        justify-content: center;
      }
    }
  `],
})
export class ScheduleRequestComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly snackBar = inject(MatSnackBar);

  // Form
  selectedPattern = signal<ShiftPattern>('2/2');
  startDate = signal<string>(addDays(new Date().toISOString().split('T')[0], 1));
  endDate = signal<string>(addDays(new Date().toISOString().split('T')[0], 31));
  startTime = signal<string>('09:00');
  endTime = signal<string>('19:30');
  comment = signal<string>('');

  // UI
  submitting = signal(false);
  loading = signal(false);
  proposalSavingId = signal<string>('');
  myRequests = signal<ScheduleRequest[]>([]);
  studios = signal<ShiftStudio[]>([]);

  // Computed
  previewDays = computed(() =>
    generatePreview(this.selectedPattern(), this.startDate(), this.endDate()),
  );

  workDaysCount = computed(() => this.previewDays().filter(d => d.isWork).length);

  minDate = computed(() => addDays(new Date().toISOString().split('T')[0], 1));

  canSubmit = computed(() =>
    !!this.startDate() && !!this.endDate() && this.startDate() <= this.endDate() && !this.submitting(),
  );

  studioMap = computed(() => new Map(this.studios().map(studio => [studio.id, studio])));

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadMyRequests();
      this.loadStudios();
    }
  }

  loadMyRequests() {
    this.loading.set(true);
    this.shiftsApi.getMyScheduleRequests().subscribe({
      next: (res) => {
        if (res.success && res.data) this.myRequests.set(res.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadStudios() {
    this.shiftsApi.getShiftStudios().subscribe({
      next: res => this.studios.set(res.data ?? []),
    });
  }

  submitRequest() {
    if (!this.canSubmit()) return;
    this.submitting.set(true);

    this.shiftsApi.createScheduleRequest({
      shift_pattern: this.selectedPattern(),
      pattern_start_date: this.startDate(),
      end_date: this.endDate(),
      start_time: this.startTime(),
      end_time: this.endTime(),
    }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        if (res.success) {
          this.snackBar.open('Запрос отправлен администратору', 'OK', { duration: 4000 });
          this.loadMyRequests();
        }
      },
      error: (err) => {
        this.submitting.set(false);
        const msg = err?.error?.message || 'Ошибка при отправке запроса';
        this.snackBar.open(msg, 'OK', { duration: 5000 });
      },
    });
  }

  acceptProposal(request: ScheduleRequest) {
    if (!this.isAdminProposal(request) || request.status !== 'pending') return;
    this.proposalSavingId.set(request.id);
    this.shiftsApi.acceptScheduleProposal(request.id).subscribe({
      next: (res) => {
        this.proposalSavingId.set('');
        if (res.success) {
          this.snackBar.open('Смены добавлены в график', 'OK', { duration: 4000 });
          this.loadMyRequests();
        }
      },
      error: (err) => {
        this.proposalSavingId.set('');
        const msg = err?.error?.message || 'Не удалось принять предложение';
        this.snackBar.open(msg, 'OK', { duration: 5000 });
      },
    });
  }

  declineProposal(request: ScheduleRequest) {
    if (!this.isAdminProposal(request) || request.status !== 'pending') return;
    const confirmed = confirm('Отказаться от предложенных смен?');
    if (!confirmed) return;

    this.proposalSavingId.set(request.id);
    this.shiftsApi.declineScheduleProposal(request.id).subscribe({
      next: (res) => {
        this.proposalSavingId.set('');
        if (res.success) {
          this.snackBar.open('Предложение отклонено', 'OK', { duration: 4000 });
          this.loadMyRequests();
        }
      },
      error: (err) => {
        this.proposalSavingId.set('');
        const msg = err?.error?.message || 'Не удалось отклонить предложение';
        this.snackBar.open(msg, 'OK', { duration: 5000 });
      },
    });
  }

  isAdminProposal(request: ScheduleRequest): boolean {
    return request.admin_id != null && request.admin_id !== '';
  }

  requestTitle(request: ScheduleRequest): string {
    return this.isAdminProposal(request) ? 'Предложение смен' : request.shift_pattern;
  }

  statusLabel(request: ScheduleRequest): string {
    if (this.isAdminProposal(request)) {
      if (request.status === 'pending') return 'Предложено вам';
      if (request.status === 'approved') return 'Вы согласились';
      if (request.status === 'rejected') return 'Вы отказались';
    }
    const labels: Record<string, string> = {
      pending: 'На рассмотрении',
      approved: 'Утверждён',
      rejected: 'Отклонён',
      revision_requested: 'Нужна доработка',
    };
    return labels[request.status] || request.status;
  }

  statusColor(request: ScheduleRequest): 'primary' | 'accent' | 'warn' {
    if (request.status === 'approved') return 'primary';
    if (request.status === 'rejected') return 'warn';
    if (request.status === 'revision_requested') return 'accent';
    return 'accent';
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

  private requestedShiftStudioId(shift: ScheduleRequestedShift): string | undefined {
    if (shift.action === 'cancel_shift') return shift.current_studio_id || shift.studio_id;
    return shift.studio_id || shift.current_studio_id;
  }

  private studioLabel(studioId: string): string {
    const studio = this.studioMap().get(studioId);
    if (!studio) return studioId;
    if (studio.address) return `${studio.name} · ${studio.address}`;
    return studio.name;
  }

  private dateListLabel(dates: string[]): string {
    if (dates.length === 0) return '';
    if (dates.length <= 3) return dates.map(date => this.formatDate(date)).join(', ');
    return `${this.formatDate(dates[0])} - ${this.formatDate(dates[dates.length - 1])}`;
  }

  formatDate(dateStr: string, withTime = false): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (withTime) {
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
}
