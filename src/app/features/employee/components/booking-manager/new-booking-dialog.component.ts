import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs/operators';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

interface Studio {
  id: string;
  name: string;
}

interface BookingSlot {
  time: string;
  endTime: string;
  available: boolean;
}

interface ClientSuggestion {
  name: string;
  phone: string;
  email: string | null;
  lastVisit: string | null;
  bookingsCount: number;
}

interface DialogData {
  studios: Studio[];
  selectedStudioId: string;
  selectedDate: string;
}

type PhoneMode = 'phone' | 'unknown';

@Component({
  selector: 'app-new-booking-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatIconModule,
    MatProgressSpinnerModule, MatDatepickerModule,
    MatNativeDateModule, MatChipsModule, MatDividerModule,
    MatAutocompleteModule, MatButtonToggleModule,
  ],
  template: `
    <h2 mat-dialog-title>Новая запись</h2>
    <mat-dialog-content>
      <!-- Студия -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Студия</mat-label>
        <mat-select [(value)]="studioId" (selectionChange)="onStudioOrDateChange()">
          @for (studio of data.studios; track studio.id) {
            <mat-option [value]="studio.id">{{ studio.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <!-- Дата -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Дата</mat-label>
        <input matInput [matDatepicker]="picker"
          [value]="dateObj()"
          (dateChange)="onDatePicked($event.value)">
        <mat-datepicker-toggle matIconSuffix [for]="picker" />
        <mat-datepicker #picker />
      </mat-form-field>

      <!-- Время -->
      @if (loadingSlots()) {
        <div class="slots-loading">
          <mat-progress-spinner mode="indeterminate" diameter="24" />
          <span>Загрузка слотов...</span>
        </div>
      } @else if (availableSlots().length > 0) {
        <div class="slots-section">
          <span class="slots-label" aria-label="Время">Время</span>
          <div class="slots-grid">
            @for (slot of availableSlots(); track slot.time) {
              <button mat-stroked-button
                [class.selected]="selectedTime() === slot.time"
                [disabled]="!slot.available"
                (click)="selectTime(slot.time)">
                {{ slot.time }}
              </button>
            }
          </div>
        </div>
      } @else if (date()) {
        <div class="no-slots">Нет доступных слотов на эту дату</div>
      }

      <mat-divider class="section-divider" />

      <!-- Клиент -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Имя клиента</mat-label>
        <input matInput [(ngModel)]="clientName" required>
      </mat-form-field>

      <div class="phone-mode-row">
        <span class="phone-mode-label">Телефон</span>
        <mat-button-toggle-group
          [value]="phoneMode()"
          (change)="setPhoneMode($event.value)"
          hideSingleSelectionIndicator>
          <mat-button-toggle value="phone">
            <mat-icon>call</mat-icon>
            <span>Есть телефон</span>
          </mat-button-toggle>
          <mat-button-toggle value="unknown">
            <mat-icon>chat</mat-icon>
            <span>Чат без дозвона</span>
          </mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      @if (phoneMode() === 'unknown') {
        <div class="unknown-phone-panel">
          <mat-icon>help_outline</mat-icon>
          <div class="unknown-phone-copy">
            <span class="unknown-phone-title">Заявка из чата без дозвона</span>
            <span class="unknown-phone-value">Телефон: ?</span>
          </div>
        </div>
      } @else {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Телефон</mat-label>
          <input matInput [(ngModel)]="clientPhone" required
            placeholder="+7 (___) ___-__-__"
            (input)="onPhoneInput($event)"
            [matAutocomplete]="phoneAuto">
          <mat-autocomplete #phoneAuto="matAutocomplete" (optionSelected)="selectClient($event.option.value)">
            @for (client of clientSuggestions(); track client.phone) {
              <mat-option [value]="client">
                <div class="client-option">
                  <span class="client-option-name">{{ client.name }}</span>
                  <span class="client-option-phone">{{ client.phone }}</span>
                  @if (client.bookingsCount > 0) {
                    <span class="client-option-visits">{{ client.bookingsCount }} визит(ов)</span>
                  }
                </div>
              </mat-option>
            }
          </mat-autocomplete>
          @if (searchingClients()) {
            <mat-icon matSuffix class="spinning">sync</mat-icon>
          }
        </mat-form-field>
      }

      <!-- Email -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Email (необязательно)</mat-label>
        <input matInput [(ngModel)]="clientEmail" type="email" placeholder="client@example.com">
      </mat-form-field>

      <!-- Услуга -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Услуга (необязательно)</mat-label>
        <input matInput [(ngModel)]="serviceName">
      </mat-form-field>

      <!-- Источник -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Источник</mat-label>
        <mat-select [(value)]="source">
          <mat-option value="crm">CRM</mat-option>
          <mat-option value="phone">Телефон</mat-option>
          <mat-option value="walk_in">Визит</mat-option>
          <mat-option value="telegram">Telegram</mat-option>
          <mat-option value="website">Сайт</mat-option>
        </mat-select>
      </mat-form-field>

      <!-- Заметка -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Заметка (необязательно)</mat-label>
        <textarea matInput [(ngModel)]="notes" rows="2"></textarea>
      </mat-form-field>

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
          Записать
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { display: flex; flex-direction: column; gap: 4px; min-width: 400px; }
    .full-width { width: 100%; }

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
    .section-divider { margin: 8px 0; }
    .error-message {
      color: var(--mat-sys-error);
      font-size: 13px;
      padding: 4px 0;
    }
    .client-option {
      display: flex;
      flex-direction: column;
      line-height: 1.3;
    }
    .client-option-name {
      font-weight: 500;
      font-size: 14px;
    }
    .client-option-phone {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .client-option-visits {
      font-size: 11px;
      color: var(--mat-sys-primary);
    }
    .phone-mode-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 2px 0 8px;
    }
    .phone-mode-label {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      flex: 0 0 auto;
    }
    .phone-mode-row mat-button-toggle-group {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .phone-mode-row mat-button-toggle {
      min-width: 0;
    }
    .phone-mode-row mat-button-toggle ::ng-deep .mat-button-toggle-label-content {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      line-height: 36px;
      padding: 0 10px;
    }
    .phone-mode-row mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .unknown-phone-panel {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 52px;
      padding: 10px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: color-mix(in srgb, var(--mat-sys-surface-container-high) 88%, var(--mat-sys-primary));
      margin-bottom: 8px;
    }
    .unknown-phone-panel mat-icon {
      color: var(--mat-sys-on-surface-variant);
    }
    .unknown-phone-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .unknown-phone-title {
      color: var(--mat-sys-on-surface);
      font-size: 14px;
      line-height: 18px;
    }
    .unknown-phone-value {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      line-height: 16px;
    }
    .spinning {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
    @media (max-width: 600px) {
      mat-dialog-content { min-width: unset; }
      .phone-mode-row {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `],
})
export class NewBookingDialogComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly dialogRef = inject(MatDialogRef<NewBookingDialogComponent>);
  private readonly destroyRef = inject(DestroyRef);
  readonly data: DialogData = inject(MAT_DIALOG_DATA);

  studioId = '';
  date = signal<string>('');
  selectedTime = signal<string>('');
  phoneMode = signal<PhoneMode>('phone');
  clientName = '';
  clientPhone = '';
  clientEmail = '';
  serviceName = '';
  source = 'crm';
  notes = '';

  availableSlots = signal<BookingSlot[]>([]);
  loadingSlots = signal(false);
  submitting = signal(false);
  error = signal('');

  // Client search / autocomplete
  clientSuggestions = signal<ClientSuggestion[]>([]);
  searchingClients = signal(false);
  private readonly phoneSearch$ = new Subject<string>();

  constructor() {
    this.phoneSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      filter(phone => phone.replace(/\D/g, '').length >= 3),
      switchMap(phone => {
        this.searchingClients.set(true);
        return this.http.get<{ clients: ClientSuggestion[] }>('/api/crm-booking/clients/search', {
          params: { phone: phone.replace(/\D/g, '') },
        });
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (res) => {
        this.clientSuggestions.set(res.clients || []);
        this.searchingClients.set(false);
      },
      error: () => {
        this.searchingClients.set(false);
      },
    });
  }

  dateObj = computed(() => {
    const d = this.date();
    return d ? new Date(d + 'T12:00:00') : null;
  });

  canSubmit(): boolean {
    return Boolean(this.studioId && this.date() && this.selectedTime() && this.clientName.trim() && this.clientPhone.trim());
  }

  ngOnInit(): void {
    this.studioId = this.data.selectedStudioId || (this.data.studios[0]?.id ?? '');
    if (this.data.selectedDate) {
      this.date.set(this.data.selectedDate);
      this.loadSlots();
    }
  }

  onDatePicked(value: Date | null): void {
    if (!value) return;
    const d = `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}`;
    this.date.set(d);
    this.selectedTime.set('');
    this.loadSlots();
  }

  onStudioOrDateChange(): void {
    if (this.date()) {
      this.selectedTime.set('');
      this.loadSlots();
    }
  }

  onPhoneInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (/^\?+$/.test(value.trim())) {
      this.setPhoneMode('unknown');
      return;
    }

    if (this.phoneMode() === 'unknown') {
      this.phoneMode.set('phone');
    }

    const digits = value.replace(/\D/g, '');
    if (digits.length >= 3) {
      this.phoneSearch$.next(value);
    } else {
      this.clientSuggestions.set([]);
    }
  }

  selectClient(client: ClientSuggestion): void {
    this.phoneMode.set('phone');
    this.clientName = client.name;
    this.clientPhone = client.phone;
    this.clientEmail = client.email || '';
    this.clientSuggestions.set([]);
  }

  setPhoneMode(mode: PhoneMode): void {
    this.phoneMode.set(mode);
    this.clientSuggestions.set([]);

    if (mode === 'unknown') {
      this.clientPhone = '?';
      return;
    }

    if (this.clientPhone.trim() === '?') {
      this.clientPhone = '';
    }
  }

  selectTime(time: string): void {
    this.selectedTime.set(time);
  }

  loadSlots(): void {
    if (!this.studioId || !this.date()) return;

    this.loadingSlots.set(true);
    this.availableSlots.set([]);

    this.http.get<{ slots: BookingSlot[] }>('/api/crm-booking/slots', {
      params: { studioId: this.studioId, date: this.date() },
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

    this.http.post<{ success: boolean; bookingId?: string; error?: string }>('/api/crm-booking/book', {
      studioId: this.studioId,
      date: this.date(),
      time: this.selectedTime(),
      clientName: this.clientName.trim(),
      clientPhone: this.clientPhone.trim(),
      clientEmail: this.clientEmail.trim() || undefined,
      serviceName: this.serviceName.trim() || undefined,
      source: this.source,
      notes: this.notes.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        if (res.success) {
          this.dialogRef.close(true);
        } else {
          this.error.set(res.error || 'Ошибка создания записи');
        }
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err.error?.error || 'Ошибка сервера');
      },
    });
  }
}
