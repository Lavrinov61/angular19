import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

interface SchedulePreset {
  label: string;
  getDate: () => Date;
}

@Component({
  selector: 'app-schedule-message-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>schedule_send</mat-icon>
      Отложить отправку
    </h2>
    <mat-dialog-content>
      <div class="presets">
        @for (preset of presets; track preset.label) {
          <button mat-stroked-button (click)="selectPreset(preset)" class="preset-btn"
                  [class.selected]="selectedLabel() === preset.label">
            {{ preset.label }}
          </button>
        }
      </div>

      <div class="custom-section">
        <label class="custom-label" for="schedule-datetime">Или выберите дату и время:</label>
        <input id="schedule-datetime" type="datetime-local" [min]="minDatetime" [value]="customValue()"
               (input)="onCustomInput($event)" class="datetime-input" />
      </div>

      @if (selectedDate()) {
        <div class="preview">
          Сообщение будет отправлено: <strong>{{ formatDate(selectedDate()!) }}</strong>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary" [disabled]="!selectedDate()"
              (click)="confirm()">
        Запланировать
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      mat-icon { color: var(--mat-sys-primary); }
    }
    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }
    .preset-btn {
      flex: 1 1 auto;
      min-width: 120px;
      &.selected {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
      }
    }
    .custom-section {
      margin-bottom: 16px;
    }
    .custom-label {
      display: block;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 6px;
    }
    .datetime-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      font-size: 14px;
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      &:focus {
        outline: none;
        border-color: var(--mat-sys-primary);
      }
    }
    .preview {
      padding: 10px 12px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      border-radius: 8px;
      font-size: 13px;
    }
  `],
})
export class ScheduleMessageDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ScheduleMessageDialogComponent>);

  readonly selectedDate = signal<Date | null>(null);
  readonly selectedLabel = signal<string | null>(null);
  readonly customValue = signal('');

  readonly minDatetime: string;

  readonly presets: readonly SchedulePreset[] = [
    {
      label: 'Через 1 час',
      getDate: () => new Date(Date.now() + 60 * 60 * 1000),
    },
    {
      label: 'Через 3 часа',
      getDate: () => new Date(Date.now() + 3 * 60 * 60 * 1000),
    },
    {
      label: 'Завтра в 10:00',
      getDate: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(10, 0, 0, 0);
        return d;
      },
    },
    {
      label: 'Через 3 дня',
      getDate: () => {
        const d = new Date();
        d.setDate(d.getDate() + 3);
        d.setHours(10, 0, 0, 0);
        return d;
      },
    },
  ];

  constructor() {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    this.minDatetime = this.toLocalISO(now);
  }

  selectPreset(preset: SchedulePreset): void {
    const date = preset.getDate();
    this.selectedDate.set(date);
    this.selectedLabel.set(preset.label);
    this.customValue.set(this.toLocalISO(date));
  }

  onCustomInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const val = target.value;
    this.customValue.set(val);
    if (val) {
      this.selectedDate.set(new Date(val));
      this.selectedLabel.set(null);
    } else {
      this.selectedDate.set(null);
    }
  }

  confirm(): void {
    const date = this.selectedDate();
    if (date) {
      this.dialogRef.close(date.toISOString());
    }
  }

  formatDate(date: Date): string {
    return date.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private toLocalISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}
