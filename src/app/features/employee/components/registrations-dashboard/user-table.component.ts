import {
  Component, ChangeDetectionStrategy, input, output, computed,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { RecentRegistration, AuthProvider } from '../../services/registrations-api.service';
import {
  displayName, roleLabel, providerLabel, providerIcon, formatDateTime,
} from './reg-helpers';

@Component({
  selector: 'app-reg-user-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="tbl" role="table" aria-label="Последние регистрации">
      <div class="tbl-head" role="row">
        <div class="th" role="columnheader">Дата</div>
        <div class="th" role="columnheader">Имя</div>
        <div class="th" role="columnheader">Email</div>
        <div class="th" role="columnheader">Роль</div>
        <div class="th" role="columnheader">Провайдер</div>
        <div class="th" role="columnheader" aria-label="Действия"></div>
      </div>

      @if (loading()) {
        @for (i of skeletonRows; track i) {
          <div class="tbl-row tbl-row-skeleton" role="row" aria-hidden="true">
            <div class="td"><span class="sk sk-w80"></span></div>
            <div class="td"><span class="sk sk-w60"></span></div>
            <div class="td"><span class="sk sk-w90"></span></div>
            <div class="td"><span class="sk sk-w50"></span></div>
            <div class="td"><span class="sk sk-w70"></span></div>
            <div class="td"></div>
          </div>
        }
      } @else if (rows().length === 0) {
        <div class="tbl-empty">Нет регистраций по текущему фильтру.</div>
      } @else {
        @for (row of rows(); track row.id) {
          <button
            class="tbl-row"
            type="button"
            role="row"
            (click)="rowClick.emit(row)"
            [attr.aria-label]="'Открыть детали: ' + (displayNameFor(row) || row.email || 'пользователь')"
          >
            <div class="td" role="cell">{{ formatDate(row.created_at) }}</div>
            <div class="td name" role="cell">
              <span class="name-text">{{ displayNameFor(row) || '—' }}</span>
              @if (row.phone) {
                <mat-icon
                  class="phone-badge"
                  [class.verified]="row.phone_verified"
                  [attr.title]="row.phone"
                >phone</mat-icon>
              }
              @if (row.has_order) {
                <span class="order-badge" title="Есть заказ" aria-label="Есть заказ">●</span>
              }
            </div>
            <div class="td email" role="cell">
              <span class="email-text" [title]="row.email || ''">{{ row.email || '—' }}</span>
              @if (row.email_verified) {
                <mat-icon class="verified" title="Email подтверждён">verified</mat-icon>
              }
            </div>
            <div class="td role" role="cell">
              <span class="chip chip-role" [attr.data-role]="row.role">{{ roleLabelFor(row.role) }}</span>
            </div>
            <div class="td provider" role="cell">
              <mat-icon class="prov-icon">{{ providerIconFor(row.auth_provider) }}</mat-icon>
              <span class="provider-text">{{ providerLabelFor(row.auth_provider) }}</span>
            </div>
            <div class="td arrow" role="cell" aria-hidden="true">
              <mat-icon>chevron_right</mat-icon>
            </div>
          </button>
        }
      }
    </div>

    <div class="pagination">
      <span class="page-info">
        Стр {{ page() }} из {{ totalPages() }} · {{ total() }} всего
      </span>
      <button
        mat-stroked-button
        type="button"
        [disabled]="page() <= 1 || loading()"
        (click)="pageChange.emit(page() - 1)"
      >
        <mat-icon>chevron_left</mat-icon> Назад
      </button>
      <button
        mat-stroked-button
        type="button"
        [disabled]="page() >= totalPages() || loading()"
        (click)="pageChange.emit(page() + 1)"
      >
        Вперёд <mat-icon>chevron_right</mat-icon>
      </button>
      <select
        class="page-size"
        [value]="pageSize()"
        (change)="onPageSizeChange($event)"
        aria-label="Размер страницы"
      >
        <option [value]="50">50 / стр</option>
        <option [value]="100">100 / стр</option>
        <option [value]="200">200 / стр</option>
      </select>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .tbl {
      display: grid;
      grid-template-columns: 160px minmax(180px, 1.4fr) minmax(200px, 1.8fr) 110px 140px 40px;
      background: var(--crm-surface, var(--mat-sys-surface-container-low));
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      overflow: hidden;
    }
    .tbl-head, .tbl-row { display: contents; }

    .th, .td {
      padding: 12px 16px;
      display: flex;
      align-items: center;
      min-height: 56px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      background: transparent;
      min-width: 0;
      box-sizing: border-box;
    }
    .th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--crm-surface-raised, var(--mat-sys-surface-container));
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .tbl-row {
      /* row is a <button>, but we use display: contents to let children join the grid */
      cursor: pointer;
      background: none;
      border: 0;
      padding: 0;
      margin: 0;
      font: inherit;
      color: inherit;
      text-align: left;
    }
    .tbl-row:hover .td {
      background: var(--crm-surface-raised, var(--mat-sys-surface-container));
    }
    .tbl-row:focus-visible .td {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: -2px;
    }

    .tbl-row-skeleton { cursor: default; }
    .tbl-row-skeleton:hover .td { background: transparent; }

    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 22px;
      min-width: 72px;
      padding: 0 10px;
      border-radius: 11px;
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
    }
    .chip-role[data-role="client"]       { background: rgba(245, 158, 11, 0.12); color: #F59E0B; }
    .chip-role[data-role="employee"]     { background: rgba(59, 130, 246, 0.12); color: #3B82F6; }
    .chip-role[data-role="admin"]        { background: rgba(239, 68, 68, 0.12);  color: #EF4444; }
    .chip-role[data-role="photographer"] { background: rgba(16, 185, 129, 0.12); color: #10B981; }

    .name, .email, .provider { min-width: 0; gap: 6px; }
    .name-text, .email-text, .provider-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .phone-badge {
      font-size: 14px !important;
      width: 14px !important;
      height: 14px !important;
      flex-shrink: 0;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }
    .phone-badge.verified { color: #10B981; }
    .order-badge {
      color: #10B981;
      font-size: 14px;
      flex-shrink: 0;
      margin-left: 2px;
    }
    .verified {
      font-size: 14px !important;
      width: 14px !important;
      height: 14px !important;
      color: var(--mat-sys-primary);
      flex-shrink: 0;
      margin-left: 4px;
    }
    .prov-icon {
      font-size: 16px !important;
      width: 16px !important;
      height: 16px !important;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      flex-shrink: 0;
    }
    .arrow mat-icon {
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      font-size: 16px !important;
      width: 16px !important;
      height: 16px !important;
    }

    .tbl-empty {
      grid-column: 1 / -1;
      padding: 48px 16px;
      text-align: center;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      font-size: 14px;
    }

    /* Skeleton */
    .sk {
      display: inline-block;
      height: 12px;
      border-radius: 4px;
      background: linear-gradient(90deg,
        var(--mat-sys-surface-variant) 0%,
        var(--mat-sys-surface-container) 50%,
        var(--mat-sys-surface-variant) 100%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.4s ease-in-out infinite;
    }
    .sk-w50 { width: 50%; }
    .sk-w60 { width: 60%; }
    .sk-w70 { width: 70%; }
    .sk-w80 { width: 80%; }
    .sk-w90 { width: 90%; }
    @keyframes skeleton-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Pagination */
    .pagination {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 0 4px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .page-info {
      font-size: 12px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
      margin-right: auto;
    }
    .page-size {
      background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 6px;
      color: var(--mat-sys-on-surface);
      padding: 6px 8px;
      font-size: 12px;
    }
    .pagination button mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
  `],
})
export class UserTableComponent {
  readonly rows = input.required<RecentRegistration[]>();
  readonly loading = input<boolean>(false);
  readonly page = input<number>(1);
  readonly pageSize = input<number>(50);
  readonly total = input<number>(0);

  readonly rowClick = output<RecentRegistration>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  readonly skeletonRows = [1, 2, 3, 4, 5];

  readonly totalPages = computed(() => {
    const size = this.pageSize();
    const tot = this.total();
    if (!size || !tot) return 1;
    return Math.max(1, Math.ceil(tot / size));
  });

  displayNameFor(row: RecentRegistration): string {
    return displayName(row);
  }

  roleLabelFor(role: string): string {
    return roleLabel(role);
  }

  providerLabelFor(p: AuthProvider): string {
    return providerLabel(p);
  }

  providerIconFor(p: AuthProvider): string {
    return providerIcon(p);
  }

  formatDate(iso: string): string {
    return formatDateTime(iso);
  }

  onPageSizeChange(ev: Event): void {
    const target = ev.target as HTMLSelectElement;
    const next = Number(target.value);
    if (!Number.isNaN(next) && next > 0) {
      this.pageSizeChange.emit(next);
    }
  }
}
