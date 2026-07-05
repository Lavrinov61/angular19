import {
  Component, ChangeDetectionStrategy, inject, signal, output, input,
  PLATFORM_ID, OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, Subscription, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, map, catchError } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { LonLat } from '../../../core/services/delivery.service';

/** Одна подсказка адреса от DaData (контракт /api/address/suggest). */
interface AddressSuggestion {
  value: string;
  fullAddress: string;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  street: string | null;
  house: string | null;
  flat: string | null;
  geo_lat: string | null;
  geo_lon: string | null;
}

interface AddressSuggestResponse {
  success: boolean;
  data?: AddressSuggestion[];
}

/** Выбранный пользователем адрес с координатами для расчёта доставки. */
export interface SelectedAddress {
  /** Полный адрес (unrestricted_value) */
  address: string;
  /** Координаты [долгота, широта] для Яндекс.Доставки */
  coordinates: LonLat;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

/**
 * Виджет автодополнения адреса (DaData через `/api/address/suggest`).
 *
 * Эмитит `addressSelected` с полным адресом и координатами `[lon,lat]`
 * только когда у подсказки есть валидные координаты, без них дом не найти
 * для расчёта доставки. Без координат эмитит `addressCleared`.
 */
@Component({
  selector: 'app-address-autocomplete',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatProgressSpinnerModule],
  host: { class: 'address-autocomplete' },
  template: `
    <div class="aac-field" [class.aac-field--focused]="isFocused()">
      <mat-icon class="aac-leading">location_on</mat-icon>
      <input
        type="text"
        class="aac-input"
        autocomplete="off"
        [attr.placeholder]="placeholder()"
        [value]="queryText()"
        (input)="onInput($event)"
        (focus)="isFocused.set(true)"
        (blur)="onBlur()"
      />
      @if (loading()) {
        <mat-spinner class="aac-spinner" diameter="18" />
      } @else if (queryText()) {
        <button type="button" class="aac-clear" aria-label="Очистить" (mousedown)="clear($event)">
          <mat-icon>close</mat-icon>
        </button>
      }
    </div>

    @if (isFocused() && suggestions().length > 0) {
      <ul class="aac-list" role="listbox">
        @for (s of suggestions(); track s.fullAddress) {
          <li
            class="aac-item"
            role="option"
            [attr.aria-selected]="false"
            (mousedown)="select(s, $event)"
          >
            <mat-icon class="aac-item-icon">place</mat-icon>
            <span class="aac-item-text">{{ s.value }}</span>
          </li>
        }
      </ul>
    }

    @if (noCoordinatesHint()) {
      <p class="aac-hint">Уточните адрес до дома, без него не рассчитать доставку.</p>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }

    .aac-field {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px 0 12px;
      border: 1.5px solid var(--ed-outline, #3a3a3a);
      border-radius: 14px;
      background: var(--ed-surface-container, #1a1a1a);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .aac-field--focused {
      border-color: var(--ed-accent, #f59e0b);
      box-shadow: 0 0 0 1px var(--ed-accent, #f59e0b);
    }

    .aac-leading {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--ed-accent, #f59e0b);
      flex-shrink: 0;
    }

    .aac-input {
      flex: 1;
      min-width: 0;
      padding: 13px 0;
      border: none;
      outline: none;
      background: transparent;
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.95rem;
    }

    .aac-input::placeholder {
      color: var(--ed-on-surface-muted, #666666);
    }

    .aac-spinner {
      flex-shrink: 0;
    }

    .aac-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--ed-on-surface-muted, #666666);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .aac-clear:hover {
      background: var(--ed-surface-container-high, #222222);
      color: var(--ed-on-surface, #f5f5f5);
    }

    .aac-clear mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .aac-list {
      list-style: none;
      margin: 6px 0 0;
      padding: 6px;
      position: absolute;
      z-index: 20;
      left: 0;
      right: 0;
      max-height: 264px;
      overflow-y: auto;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 14px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    }

    .aac-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      cursor: pointer;
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.9rem;
      line-height: 1.35;
      transition: background 0.15s ease;
    }

    .aac-item:hover {
      background: var(--ed-surface-container-high, #222222);
    }

    .aac-item-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      flex-shrink: 0;
    }

    .aac-item-text {
      flex: 1;
      min-width: 0;
    }

    .aac-hint {
      margin: 8px 2px 0;
      font-size: 0.8rem;
      color: var(--ed-accent, #f59e0b);
    }
  `,
})
export class AddressAutocompleteComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  /** Плейсхолдер поля ввода */
  readonly placeholder = input('Город, улица, дом, квартира');

  /** Эмитит выбранный адрес с координатами [lon,lat] */
  readonly addressSelected = output<SelectedAddress>();
  /** Эмитит, когда поле очищено или адрес стал невалидным (нет координат) */
  readonly addressCleared = output<void>();

  readonly queryText = signal('');
  readonly suggestions = signal<AddressSuggestion[]>([]);
  readonly loading = signal(false);
  readonly isFocused = signal(false);
  readonly noCoordinatesHint = signal(false);

  private readonly queryInput$ = new Subject<string>();
  private readonly subscription: Subscription;
  /** Был ли уже эмитнут валидный адрес, чтобы не слать лишние addressCleared */
  private hasSelection = false;

  constructor() {
    this.subscription = this.queryInput$
      .pipe(
        debounceTime(280),
        distinctUntilChanged(),
        switchMap((query) => this.fetchSuggestions(query)),
      )
      .subscribe((suggestions) => {
        this.suggestions.set(suggestions);
        this.loading.set(false);
      });
  }

  onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const value = target.value;
    this.queryText.set(value);
    this.noCoordinatesHint.set(false);

    // Любая правка инвалидирует прежний выбор
    if (this.hasSelection) {
      this.hasSelection = false;
      this.addressCleared.emit();
    }

    const trimmed = value.trim();
    if (trimmed.length < 3) {
      this.suggestions.set([]);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.queryInput$.next(trimmed);
  }

  select(suggestion: AddressSuggestion, event: Event): void {
    // mousedown до blur, гасим, чтобы input не потерял выбор
    event.preventDefault();

    this.queryText.set(suggestion.fullAddress);
    this.suggestions.set([]);
    this.isFocused.set(false);

    const coordinates = this.parseCoordinates(suggestion);
    if (!coordinates) {
      // Подсказка без координат (город/улица без дома), нельзя считать доставку
      this.noCoordinatesHint.set(true);
      this.hasSelection = false;
      this.addressCleared.emit();
      return;
    }

    this.noCoordinatesHint.set(false);
    this.hasSelection = true;
    this.addressSelected.emit({
      address: suggestion.fullAddress,
      coordinates,
      city: this.normalizeString(suggestion.city),
      region: this.normalizeString(suggestion.region),
      postalCode: this.normalizeString(suggestion.postalCode),
    });
  }

  clear(event: Event): void {
    event.preventDefault();
    this.queryText.set('');
    this.suggestions.set([]);
    this.noCoordinatesHint.set(false);
    if (this.hasSelection) {
      this.hasSelection = false;
      this.addressCleared.emit();
    }
  }

  onBlur(): void {
    // Закрываем список с задержкой, mousedown по пункту успевает отработать
    setTimeout(() => this.isFocused.set(false), 120);
  }

  private fetchSuggestions(query: string): Observable<AddressSuggestion[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return of<AddressSuggestion[]>([]);
    }

    return this.http
      .post<AddressSuggestResponse>('/api/address/suggest', { query, count: 7 })
      .pipe(
        map((response) =>
          response.success && Array.isArray(response.data) ? response.data : [],
        ),
        // ошибки сети не должны валить поток, отдаём пусто
        catchError(() => of<AddressSuggestion[]>([])),
      );
  }

  private parseCoordinates(suggestion: AddressSuggestion): LonLat | null {
    const lat = this.parseNumber(suggestion.geo_lat);
    const lon = this.parseNumber(suggestion.geo_lon);
    if (lat === null || lon === null) return null;
    return [lon, lat];
  }

  private parseNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
