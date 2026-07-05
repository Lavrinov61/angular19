import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import {
  StudioHoursApiService,
  StudioWithHours,
  StudioWorkingHour,
} from '../../services/studio-hours-api.service';

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

interface DayRow extends StudioWorkingHour {
  dayName: string;
}

@Component({
  selector: 'app-studio-hours',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTabsModule,
  ],
  template: `
    <div class="studio-hours-page">
      <div class="page-header">
        <mat-icon class="page-icon">schedule</mat-icon>
        <div>
          <h2 class="page-title">Часы работы студий</h2>
          <p class="page-subtitle">Расписание доступности слотов для онлайн-записи</p>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-center">
          <mat-spinner diameter="48"></mat-spinner>
        </div>
      } @else if (studios().length === 0) {
        <mat-card class="empty-card">
          <mat-icon>store_mall_directory</mat-icon>
          <p>Студии не найдены</p>
        </mat-card>
      } @else {
        <mat-tab-group [selectedIndex]="selectedTab()" (selectedIndexChange)="selectedTab.set($event)">
          @for (studio of studios(); track studio.id) {
            <mat-tab [label]="studio.name">
              <div class="studio-panel">
                <div class="address-hint">
                  <mat-icon>location_on</mat-icon>{{ studio.location_code }}
                </div>

                <div class="days-list">
                  @for (day of getRows(studio); track day.day_of_week) {
                    <mat-card class="day-card" [class.closed]="!day.is_open">
                      <div class="day-row">
                        <mat-slide-toggle
                          [checked]="day.is_open"
                          (change)="toggleDay(studio, day, $event.checked)"
                          color="primary">
                        </mat-slide-toggle>
                        <span class="day-name">{{ day.dayName }}</span>

                        @if (day.is_open) {
                          <div class="time-fields">
                            <mat-form-field appearance="outline" class="time-field">
                              <mat-label>Открытие</mat-label>
                              <input matInput type="time"
                                     [value]="day.start_time"
                                     (change)="onTimeChange(studio, day, 'start_time', $any($event.target).value)">
                            </mat-form-field>
                            <span class="dash">—</span>
                            <mat-form-field appearance="outline" class="time-field">
                              <mat-label>Закрытие</mat-label>
                              <input matInput type="time"
                                     [value]="day.end_time"
                                     (change)="onTimeChange(studio, day, 'end_time', $any($event.target).value)">
                            </mat-form-field>
                          </div>
                        } @else {
                          <span class="closed-label">Выходной</span>
                        }
                      </div>
                    </mat-card>
                  }
                </div>

                <div class="actions">
                  <button mat-raised-button color="primary"
                          [disabled]="saving()"
                          (click)="save(studio)">
                    @if (saving()) {
                      <mat-spinner diameter="20" style="display:inline-block"></mat-spinner>
                    } @else {
                      <mat-icon>save</mat-icon>
                    }
                    Сохранить расписание
                  </button>
                  <button mat-button (click)="resetToDefault(studio)">
                    <mat-icon>restart_alt</mat-icon>
                    По умолчанию (Пн–Вс 09:00–19:30)
                  </button>
                </div>
              </div>
            </mat-tab>
          }
        </mat-tab-group>
      }
    </div>
  `,
  styles: [`
    .studio-hours-page {
      max-width: 700px;
      margin: 0 auto;
      padding: 16px;
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }

    .page-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: var(--crm-accent);
    }

    .page-title {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: var(--crm-text-primary);
    }

    .page-subtitle {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--crm-text-secondary);
    }

    .loading-center {
      display: flex;
      justify-content: center;
      padding: 64px 0;
    }

    .empty-card {
      text-align: center;
      padding: 32px;
      color: var(--crm-text-secondary);
    }

    .studio-panel {
      padding: 16px 0;
    }

    .address-hint {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--crm-text-secondary);
      font-size: 13px;
      margin-bottom: 16px;
    }

    .days-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .day-card {
      padding: 12px 16px;
      transition: opacity 0.2s;

      &.closed {
        opacity: 0.6;
      }
    }

    .day-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .day-name {
      min-width: 120px;
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .time-fields {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .time-field {
      width: 120px;
    }

    .dash {
      color: var(--crm-text-secondary);
    }

    .closed-label {
      color: var(--crm-text-secondary);
      font-size: 13px;
    }

    .actions {
      display: flex;
      gap: 12px;
      margin-top: 20px;
      flex-wrap: wrap;
    }
  `],
})
export class StudioHoursComponent implements OnInit {
  private readonly api = inject(StudioHoursApiService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly studios = signal<StudioWithHours[]>([]);
  readonly selectedTab = signal(0);

  /** Локальные изменения расписания: studioId → DayRow[] */
  private readonly localHours = new Map<string, DayRow[]>();

  ngOnInit(): void {
    this.api.getAllStudios().subscribe({
      next: (studios) => {
        this.studios.set(studios);
        // Инициализируем локальный стейт
        for (const s of studios) {
          this.localHours.set(s.id, this.buildRows(s.hours));
        }
        this.loading.set(false);
      },
      error: () => {
        this.snackBar.open('Ошибка загрузки расписания', 'OK', { duration: 3000 });
        this.loading.set(false);
      },
    });
  }

  getRows(studio: StudioWithHours): DayRow[] {
    return this.localHours.get(studio.id) ?? this.buildRows(studio.hours);
  }

  toggleDay(studio: StudioWithHours, day: DayRow, isOpen: boolean): void {
    const rows = this.localHours.get(studio.id);
    if (!rows) return;
    const row = rows.find(r => r.day_of_week === day.day_of_week);
    if (row) {
      row.is_open = isOpen;
      this.localHours.set(studio.id, [...rows]);
      this.studios.set([...this.studios()]); // trigger CD
    }
  }

  onTimeChange(studio: StudioWithHours, day: DayRow, field: 'start_time' | 'end_time', value: string): void {
    const rows = this.localHours.get(studio.id);
    if (!rows) return;
    const row = rows.find(r => r.day_of_week === day.day_of_week);
    if (row) {
      row[field] = value;
    }
  }

  resetToDefault(studio: StudioWithHours): void {
    const rows: DayRow[] = Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i,
      dayName: DAY_NAMES[i],
      start_time: '09:00',
      end_time: '19:30',
      is_open: true,
    }));
    this.localHours.set(studio.id, rows);
    this.studios.set([...this.studios()]);
  }

  save(studio: StudioWithHours): void {
    const rows = this.localHours.get(studio.id);
    if (!rows) return;
    this.saving.set(true);
    this.api.updateHours(studio.id, rows).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open('Расписание сохранено', 'OK', { duration: 3000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Ошибка сохранения', 'OK', { duration: 3000 });
      },
    });
  }

  private buildRows(hours: StudioWorkingHour[]): DayRow[] {
    return Array.from({ length: 7 }, (_, i) => {
      const found = hours?.find(h => h.day_of_week === i);
      return {
        day_of_week: i,
        dayName: DAY_NAMES[i],
        start_time: found?.start_time ?? '09:00',
        end_time: found?.end_time ?? '19:30',
        is_open: found?.is_open ?? true,
      };
    });
  }
}
