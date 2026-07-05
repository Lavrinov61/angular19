import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs/operators';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

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

type PhoneMode = 'phone' | 'unknown';

@Component({
  selector: 'app-new-booking-inline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  template: `
    <section class="booking-form" aria-label="Новая запись">
      <header class="form-head">
        <div class="form-title">
          <span>Новая запись</span>
          <strong>{{ dateLabel() }}</strong>
        </div>
        <button mat-icon-button type="button" matTooltip="Закрыть" (click)="cancelled.emit()">
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <div class="form-steps">
        <span [class.done]="selectedTime()">1. Время</span>
        <span [class.done]="clientName.trim()">2. Клиент</span>
        <span [class.done]="canSubmit()">3. Записать</span>
      </div>

      <section class="slots-section">
        <div class="section-head">
          <span>Свободное время</span>
          <button mat-icon-button type="button" matTooltip="Обновить слоты" (click)="reloadSlots()">
            <mat-icon>refresh</mat-icon>
          </button>
        </div>

        @if (loadingSlots()) {
          <div class="slots-loading">
            <mat-progress-spinner mode="indeterminate" diameter="22" />
            <span>Загрузка слотов</span>
          </div>
        } @else if (availableSlots().length > 0) {
          <div class="slots-grid">
            @for (slot of availableSlots(); track slot.time) {
              <button
                mat-stroked-button
                type="button"
                [class.selected]="selectedTime() === slot.time"
                [disabled]="!slot.available"
                (click)="selectTime(slot.time)">
                {{ slot.time }}
              </button>
            }
          </div>
        } @else {
          <div class="slots-empty">
            <mat-icon>event_busy</mat-icon>
            <span>Нет доступных слотов на выбранный день</span>
          </div>
        }
      </section>

      <section class="client-section">
        <mat-form-field appearance="outline" class="wide" subscriptSizing="dynamic">
          <mat-label>Имя клиента</mat-label>
          <input matInput [(ngModel)]="clientName" required>
        </mat-form-field>

        <div class="phone-row">
          <span>Телефон</span>
          <mat-button-toggle-group
            [value]="phoneMode()"
            (change)="setPhoneMode($event.value)"
            hideSingleSelectionIndicator>
            <mat-button-toggle value="phone">
              <mat-icon>call</mat-icon>
              Есть
            </mat-button-toggle>
            <mat-button-toggle value="unknown">
              <mat-icon>chat</mat-icon>
              Чат без дозвона
            </mat-button-toggle>
          </mat-button-toggle-group>
        </div>

        @if (phoneMode() === 'unknown') {
          <div class="unknown-phone">
            <mat-icon>help_outline</mat-icon>
          <div>
            <strong>Телефон неизвестен</strong>
            <span>Телефон: ?</span>
          </div>
          </div>
        } @else {
          <mat-form-field appearance="outline" class="wide" subscriptSizing="dynamic">
            <mat-label>Телефон</mat-label>
            <input
              matInput
              [(ngModel)]="clientPhone"
              required
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

        <div class="form-grid">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Email</mat-label>
            <input matInput [(ngModel)]="clientEmail" type="email">
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Источник</mat-label>
            <mat-select [(value)]="source">
              <mat-option value="crm">CRM</mat-option>
              <mat-option value="phone">Телефон</mat-option>
              <mat-option value="walk_in">Визит</mat-option>
              <mat-option value="telegram">Telegram</mat-option>
              <mat-option value="website">Сайт</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="wide" subscriptSizing="dynamic">
          <mat-label>Услуга</mat-label>
          <input matInput [(ngModel)]="serviceName">
        </mat-form-field>

        <mat-form-field appearance="outline" class="wide" subscriptSizing="dynamic">
          <mat-label>Заметка</mat-label>
          <textarea matInput [(ngModel)]="notes" rows="2"></textarea>
        </mat-form-field>
      </section>

      @if (error()) {
        <div class="error-message">{{ error() }}</div>
      }

      <footer class="form-actions">
        <div class="summary">
          @if (selectedTime()) {
            <span>{{ selectedTime() }}</span>
          } @else {
            <span>Выберите время</span>
          }
          <span>{{ phoneMode() === 'unknown' ? 'телефон ?' : (clientPhone.trim() || 'телефон не указан') }}</span>
        </div>
        <div class="action-buttons">
          <button mat-button type="button" (click)="cancelled.emit()">Отмена</button>
          <button
            mat-flat-button
            type="button"
            class="submit-button"
            [disabled]="!canSubmit() || submitting()"
            (click)="submit()">
            @if (submitting()) {
              <mat-progress-spinner mode="indeterminate" diameter="18" />
            } @else {
              Записать
            }
          </button>
        </div>
      </footer>
    </section>
  `,
  styles: [`
    .booking-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low, #151515);
      padding: 14px;
    }

    .form-head,
    .section-head,
    .form-actions,
    .phone-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .form-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .form-title span {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }

    .form-title strong {
      color: var(--mat-sys-on-surface);
      font-size: 18px;
      line-height: 22px;
    }

    .form-steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .form-steps span {
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 6px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      padding: 7px 8px;
      text-align: center;
    }

    .form-steps span.done {
      border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 45%, var(--mat-sys-outline-variant, #2d2d2d));
      color: var(--ed-accent, #f59e0b);
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 12%, transparent);
    }

    .section-head span {
      color: var(--mat-sys-on-surface);
      font-size: 14px;
      font-weight: 600;
    }

    .slots-section,
    .client-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .slots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 6px;
    }

    .slots-grid button {
      min-width: 0;
      border-radius: 6px;
      font-variant-numeric: tabular-nums;
    }

    .slots-grid button.selected {
      background: var(--ed-accent, #f59e0b);
      color: #111;
      border-color: var(--ed-accent, #f59e0b);
    }

    .slots-loading,
    .slots-empty,
    .unknown-phone {
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 8px;
      color: var(--mat-sys-on-surface-variant);
      min-height: 48px;
      padding: 10px 12px;
    }

    .slots-empty mat-icon,
    .unknown-phone mat-icon {
      color: var(--mat-sys-on-surface-variant);
    }

    .wide {
      width: 100%;
    }

    .phone-row > span {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      flex: 0 0 auto;
    }

    .phone-row mat-button-toggle-group {
      display: grid;
      flex: 1;
      grid-template-columns: minmax(86px, 0.8fr) minmax(132px, 1.2fr);
    }

    .phone-row mat-button-toggle {
      min-width: 0;
    }

    .phone-row mat-button-toggle ::ng-deep .mat-button-toggle-label-content {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      line-height: 34px;
      padding: 0 8px;
      width: 100%;
    }

    .phone-row mat-icon {
      font-size: 18px;
      height: 18px;
      width: 18px;
    }

    .unknown-phone {
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 14%, transparent);
      border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 32%, var(--mat-sys-outline-variant, #2d2d2d));
    }

    .unknown-phone div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .unknown-phone strong {
      color: var(--mat-sys-on-surface);
      font-size: 13px;
      line-height: 18px;
    }

    .unknown-phone span {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      line-height: 16px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 150px;
      gap: 10px;
    }

    .client-option {
      display: flex;
      flex-direction: column;
      line-height: 1.3;
    }

    .client-option-name {
      font-size: 14px;
      font-weight: 500;
    }

    .client-option-phone {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }

    .client-option-visits {
      color: var(--mat-sys-primary);
      font-size: 11px;
    }

    .error-message {
      color: var(--mat-sys-error, #ef4444);
      font-size: 13px;
    }

    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }

    .summary span {
      border: 1px solid var(--mat-sys-outline-variant, #2d2d2d);
      border-radius: 999px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      padding: 4px 8px;
    }

    .action-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }

    .submit-button {
      background: var(--ed-accent, #f59e0b);
      color: #111;
      border-radius: 6px;
      min-width: 104px;
    }

    .spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      100% { transform: rotate(360deg); }
    }

    @media (max-width: 760px) {
      .form-actions,
      .phone-row {
        align-items: stretch;
        flex-direction: column;
      }

      .phone-row mat-button-toggle-group,
      .form-grid {
        grid-template-columns: 1fr;
        width: 100%;
      }

      .action-buttons {
        justify-content: flex-end;
      }
    }
  `],
})
export class NewBookingInlineComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly studios = input<Studio[]>([]);
  readonly selectedStudioId = input<string>('');
  readonly selectedDate = input<string>('');
  readonly bookingCreated = output<void>();
  readonly cancelled = output<void>();

  readonly studioId = signal('');
  readonly date = signal('');
  readonly selectedTime = signal('');
  readonly phoneMode = signal<PhoneMode>('phone');
  readonly availableSlots = signal<BookingSlot[]>([]);
  readonly loadingSlots = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly clientSuggestions = signal<ClientSuggestion[]>([]);
  readonly searchingClients = signal(false);

  clientName = '';
  clientPhone = '';
  clientEmail = '';
  serviceName = '';
  source = 'crm';
  notes = '';

  private readonly phoneSearch$ = new Subject<string>();
  private lastSelectionKey = '';

  readonly dateLabel = computed(() => {
    const value = this.date();
    if (!value) return 'Выберите день';
    const date = new Date(`${value}T12:00:00`);
    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
  });

  private readonly syncSelectionEffect = effect(() => {
    const studioId = this.selectedStudioId() || this.studios()[0]?.id || '';
    const date = this.selectedDate();
    const key = `${studioId}|${date}`;

    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;
    this.studioId.set(studioId);
    this.date.set(date);
    this.selectedTime.set('');

    if (studioId && date) {
      this.loadSlots(studioId, date);
    }
  });

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

  canSubmit(): boolean {
    return Boolean(
      this.studioId()
      && this.date()
      && this.selectedTime()
      && this.clientName.trim()
      && this.normalizedClientPhone(),
    );
  }

  reloadSlots(): void {
    const studioId = this.studioId();
    const date = this.date();
    if (studioId && date) {
      this.loadSlots(studioId, date);
    }
  }

  selectTime(time: string): void {
    this.selectedTime.set(time);
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
      if (this.source === 'crm' || this.source === 'phone') {
        this.source = 'telegram';
      }
      return;
    }

    if (this.clientPhone.trim() === '?') {
      this.clientPhone = '';
    }
  }

  submit(): void {
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.error.set('');

    this.http.post<{ success: boolean; bookingId?: string; error?: string }>('/api/crm-booking/book', {
      studioId: this.studioId(),
      date: this.date(),
      time: this.selectedTime(),
      clientName: this.clientName.trim(),
      clientPhone: this.normalizedClientPhone(),
      clientEmail: this.clientEmail.trim() || undefined,
      serviceName: this.serviceName.trim() || undefined,
      source: this.source,
      notes: this.notes.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        if (res.success) {
          this.resetFormAfterSubmit();
          this.bookingCreated.emit();
        } else {
          this.error.set(res.error || 'Ошибка создания записи');
        }
      },
      error: (err: { error?: { error?: string } }) => {
        this.submitting.set(false);
        this.error.set(err.error?.error || 'Ошибка сервера');
      },
    });
  }

  private loadSlots(studioId: string, date: string): void {
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

  private normalizedClientPhone(): string {
    return this.phoneMode() === 'unknown' ? '?' : this.clientPhone.trim();
  }

  private resetFormAfterSubmit(): void {
    this.selectedTime.set('');
    this.phoneMode.set('phone');
    this.clientSuggestions.set([]);
    this.clientName = '';
    this.clientPhone = '';
    this.clientEmail = '';
    this.serviceName = '';
    this.source = 'crm';
    this.notes = '';
  }
}
