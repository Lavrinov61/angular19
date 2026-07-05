import {
  Component, ChangeDetectionStrategy, input, output,
  signal, computed, effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import {
  RegFilters, RegFilterRole, RegFilterProvider,
} from '../../services/registrations-api.service';

interface ChipItem<T extends string> {
  value: T | null;
  label: string;
  icon?: string;
}

@Component({
  selector: 'app-reg-filter-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DecimalPipe,
    MatButtonModule, MatChipsModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSlideToggleModule,
  ],
  template: `
    <div class="filter-strip">
      <div class="row row-top">
        <mat-form-field appearance="outline" class="search-field" subscriptSizing="dynamic">
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            type="text"
            [(ngModel)]="searchText"
            (ngModelChange)="onSearchInput($event)"
            placeholder="Поиск по имени, email, телефону…"
            aria-label="Поиск"
          />
          @if (searchText()) {
            <button mat-icon-button matSuffix type="button" (click)="clearSearch()" aria-label="Очистить поиск">
              <mat-icon>close</mat-icon>
            </button>
          }
        </mat-form-field>

        <span class="count">Найдено: <strong>{{ totalCount() | number }}</strong></span>

        @if (hasActiveFilters()) {
          <button mat-stroked-button type="button" (click)="reset()" class="reset-btn">
            <mat-icon>restart_alt</mat-icon> Сбросить
          </button>
        }
      </div>

      <div class="row">
        <span class="chip-group-label">Роль:</span>
        <mat-chip-listbox
          [value]="filters().role ?? null"
          (change)="onRoleChange($event.value)"
          aria-label="Фильтр по роли"
        >
          @for (c of roleChips; track c.value) {
            <mat-chip-option [value]="c.value" [selected]="filters().role === c.value || (!filters().role && c.value === null)">
              {{ c.label }}
            </mat-chip-option>
          }
        </mat-chip-listbox>
      </div>

      <div class="row">
        <span class="chip-group-label">Провайдер:</span>
        <mat-chip-listbox
          [value]="filters().provider ?? null"
          (change)="onProviderChange($event.value)"
          aria-label="Фильтр по провайдеру"
        >
          @for (c of providerChips; track c.value) {
            <mat-chip-option [value]="c.value" [selected]="filters().provider === c.value || (!filters().provider && c.value === null)">
              @if (c.icon) { <mat-icon>{{ c.icon }}</mat-icon> }
              {{ c.label }}
            </mat-chip-option>
          }
        </mat-chip-listbox>
      </div>

      <div class="row row-toggles">
        <mat-slide-toggle
          [checked]="filters().verified === true"
          (change)="onVerifiedChange($event.checked)"
        >
          Только подтв. email
        </mat-slide-toggle>

        <mat-slide-toggle
          [checked]="filters().hasOrder === true"
          (change)="onHasOrderChange($event.checked)"
        >
          Только с заказом
        </mat-slide-toggle>
      </div>
    </div>
  `,
  styles: [`
    .filter-strip {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 16px;
      background: var(--crm-surface, var(--mat-sys-surface-container-low));
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .row-top {
      gap: 14px;
    }
    .search-field {
      flex: 1;
      min-width: 220px;
      max-width: 440px;
    }
    .search-field mat-icon[matPrefix] {
      color: var(--mat-sys-on-surface-variant);
      margin-right: 6px;
    }
    .count {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      margin-left: auto;
    }
    .count strong {
      color: var(--mat-sys-on-surface);
      font-weight: 600;
    }
    .reset-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-right: 4px;
    }
    .chip-group-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--mat-sys-on-surface-variant);
      flex-shrink: 0;
      min-width: 86px;
    }
    .row-toggles {
      gap: 24px;
      padding-top: 4px;
    }
    mat-chip-option mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      margin-right: 2px;
    }
  `],
})
export class FilterStripComponent {
  readonly filters = input.required<RegFilters>();
  readonly totalCount = input<number>(0);
  readonly filtersChange = output<RegFilters>();

  readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly roleChips: ChipItem<RegFilterRole>[] = [
    { value: null,           label: 'Все' },
    { value: 'client',       label: 'Клиент' },
    { value: 'employee',     label: 'Сотрудник' },
    { value: 'photographer', label: 'Фотограф' },
    { value: 'admin',        label: 'Админ' },
  ];

  readonly providerChips: ChipItem<RegFilterProvider>[] = [
    { value: null,       label: 'Все' },
    { value: 'phone',    label: 'Телефон', icon: 'phone' },
    { value: 'email',    label: 'Email',    icon: 'mail' },
    { value: 'vk',       label: 'VK',       icon: 'group' },
    { value: 'telegram', label: 'TG',       icon: 'send' },
    { value: 'yandex',   label: 'Яндекс',   icon: 'account_circle' },
    { value: 'google',   label: 'Google',   icon: 'public' },
    { value: 'apple',    label: 'Apple',    icon: 'phone_iphone' },
    { value: 'sber',     label: 'Сбер',     icon: 'account_balance' },
    { value: 'mts',      label: 'МТС',      icon: 'sim_card' },
  ];

  readonly hasActiveFilters = computed(() => {
    const f = this.filters();
    return !!(f.role || f.provider || f.search || f.verified === true || f.hasOrder === true);
  });

  constructor() {
    effect(() => {
      const f = this.filters();
      const incoming = f.search ?? '';
      if (incoming !== this.searchText()) {
        this.searchText.set(incoming);
      }
    });
  }

  onSearchInput(value: string): void {
    this.searchText.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      const next = value.trim();
      const current = this.filters().search ?? '';
      if (next !== current) {
        this.emit({ ...this.filters(), search: next || null });
      }
    }, 300);
  }

  clearSearch(): void {
    this.searchText.set('');
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (this.filters().search) {
      this.emit({ ...this.filters(), search: null });
    }
  }

  onRoleChange(value: RegFilterRole | null): void {
    this.emit({ ...this.filters(), role: value ?? null });
  }

  onProviderChange(value: RegFilterProvider | null): void {
    this.emit({ ...this.filters(), provider: value ?? null });
  }

  onVerifiedChange(checked: boolean): void {
    this.emit({ ...this.filters(), verified: checked ? true : null });
  }

  onHasOrderChange(checked: boolean): void {
    this.emit({ ...this.filters(), hasOrder: checked ? true : null });
  }

  reset(): void {
    this.searchText.set('');
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.emit({
      role: null,
      provider: null,
      search: null,
      verified: null,
      hasOrder: null,
    });
  }

  private emit(next: RegFilters): void {
    this.filtersChange.emit(next);
  }
}
