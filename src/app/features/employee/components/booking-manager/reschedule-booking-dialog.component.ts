import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDividerModule } from '@angular/material/divider';

interface Studio {
  id: string;
  name: string;
}

interface BookingSlot {
  time: string;
  endTime: string;
  available: boolean;
}

interface BookingRecord {
  id: string;
  studio_id: string;
  studio_name: string;
  client_name: string;
  client_phone: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface RescheduleDialogData {
  booking: BookingRecord;
  studios: Studio[];
}

@Component({
  selector: 'app-reschedule-booking-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatIconModule,
    MatProgressSpinnerModule, MatDatepickerModule,
    MatNativeDateModule, MatDividerModule,
  ],
  template: `
    <h2 mat-dialog-title>Перенести запись</h2>
    <mat-dialog-content>
      <!-- Текущая запись -->
      <div class="current-info">
        <mat-icon>person</mat-icon>
        <div>
          <div class="current-client">{{ data.booking.client_name }}</div>
          <div class="current-details">
            {{ data.booking.studio_name }} &middot;
            {{ formatDateTime(data.booking.start_time) }}
          </div>
        </div>
      </div>

      <mat-divider class="section-divider" />

      <!-- Новая студия -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Студия</mat-label>
        <mat-select [value]="newStudioId()" (selectionChange)="onStudioChange($event.value)">
          @for (studio of data.studios; track studio.id) {
            <mat-option [value]="studio.id">{{ studio.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <!-- Новая дата -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Новая дата</mat-label>
        <input matInput [matDatepicker]="picker"
          [value]="dateObj()"
          (dateChange)="onDatePicked($event.value)">
        <mat-datepicker-toggle matIconSuffix [for]="picker" />
        <mat-datepicker #picker />
      </mat-form-field>

      <!-- Новое время -->
      @if (loadingSlots()) {
        <div class="slots-loading">
          <mat-progress-spinner mode="indeterminate" diameter="24" />
          <span>Загрузка слотов...</span>
        </div>
      } @else if (availableSlots().length > 0) {
        <div class="slots-section">
          <span class="slots-label" aria-label="Новое время">Новое время</span>
          <div class="slots-grid">
            @for (slot of availableSlots(); track slot.time) {
              <button mat-stroked-button
                [class.selected]="newTime() === slot.time"
                [disabled]="!slot.available"
                (click)="selectTime(slot.time)">
                {{ slot.time }}
              </button>
            }
          </div>
        </div>
      } @else if (newDate()) {
        <div class="no-slots">Нет доступных слотов на эту дату</div>
      }

      @if (error()) {
        <div class="error-message">{{ error() }}</div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary"
        [disabled]="!canSubmit() || submitting()"
        (click)="submit()">
        @if (submitting()) {
          <mat-progress-spinner mode="indeterminate" diameter="20" />
        } @else {
          Перенести
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { display: flex; flex-direction: column; gap: 4px; min-width: 400px; }
    .full-width { width: 100%; }

    .current-info {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
    }
    .current-info mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--mat-sys-on-surface-variant);
    }
    .current-client { font-weight: 500; }
    .current-details {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    .section-divider { margin: 8px 0 12px; }

    .slots-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .slots-section { margin-bottom: 8px; }
    .slots-label {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 8px;
      display: block;
    }
    .slots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 6px;
    }
    .slots-grid button.selected {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    .no-slots {
      padding: 12px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
      font-size: 13px;
    }
    .error-message {
      color: var(--mat-sys-error);
      font-size: 13px;
      padding: 4px 0;
    }
    @media (max-width: 600px) {
      mat-dialog-content { min-width: unset; }
    }
  `],
})
export class RescheduleBookingDialogComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly dialogRef = inject(MatDialogRef<RescheduleBookingDialogComponent>);
  readonly data: RescheduleDialogData = inject(MAT_DIALOG_DATA);

  newStudioId = signal<string>('');
  newDate = signal<string>('');
  newTime = signal<string>('');

  availableSlots = signal<BookingSlot[]>([]);
  loadingSlots = signal(false);
  submitting = signal(false);
  error = signal('');

  dateObj = computed(() => {
    const d = this.newDate();
    return d ? new Date(d + 'T12:00:00') : null;
  });

  canSubmit = computed(() => {
    return this.newDate() && this.newTime();
  });

  ngOnInit(): void {
    this.newStudioId.set(this.data.booking.studio_id);
  }

  onStudioChange(studioId: string): void {
    this.newStudioId.set(studioId);
    if (this.newDate()) {
      this.newTime.set('');
      this.loadSlots();
    }
  }

  onDatePicked(value: Date | null): void {
    if (!value) return;
    const d = `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}`;
    this.newDate.set(d);
    this.newTime.set('');
    this.loadSlots();
  }

  selectTime(time: string): void {
    this.newTime.set(time);
  }

  loadSlots(): void {
    const studioId = this.newStudioId();
    const date = this.newDate();
    if (!studioId || !date) return;

    this.loadingSlots.set(true);
    this.availableSlots.set([]);

    this.http.get<{ slots: BookingSlot[] }>('/api/crm-booking/slots', {
      params: { studioId, date },
    }).subscribe({
      next: (res) => {
        this.availableSlots.set(res.slots || []);
        this.loadingSlots.set(false);
      },
      error: () => {
        this.loadingSlots.set(false);
      },
    });
  }

  submit(): void {
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.error.set('');

    const body: Record<string, string> = {
      date: this.newDate(),
      time: this.newTime(),
    };

    // Если студия изменена — передаём
    if (this.newStudioId() !== this.data.booking.studio_id) {
      body['studioId'] = this.newStudioId();
    }

    this.http.put<{ success: boolean; error?: string }>(
      `/api/crm-booking/${this.data.booking.id}/reschedule`, body,
    ).subscribe({
      next: (res) => {
        this.submitting.set(false);
        if (res.success) {
          this.dialogRef.close(true);
        } else {
          this.error.set(res.error || 'Ошибка переноса записи');
        }
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err.error?.error || 'Ошибка сервера');
      },
    });
  }

  formatDateTime(iso: string): string {
    const d = new Date(iso);
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${d.getDate()} ${months[d.getMonth()]}, ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
}
