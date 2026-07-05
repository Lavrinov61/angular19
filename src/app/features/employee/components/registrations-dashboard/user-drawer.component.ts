import {
  Component, ChangeDetectionStrategy, input, output, computed,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { RecentRegistration } from '../../services/registrations-api.service';
import {
  displayName, roleLabel, providerLabel, providerIcon,
  formatDateTime, initials,
} from './reg-helpers';

@Component({
  selector: 'app-reg-user-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="drawer">
      <header class="drawer-head">
        <h3>Детали пользователя</h3>
        <button
          mat-icon-button
          type="button"
          (click)="closed.emit()"
          aria-label="Закрыть"
        >
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <div class="drawer-body">
        <div class="identity">
          <div class="avatar" aria-hidden="true">{{ avatarLetter() }}</div>
          <div class="identity-text">
            <div class="name">{{ displayNameText() || '—' }}</div>
            <div class="email" [title]="user().email || ''">{{ user().email || '—' }}</div>
            <div class="badges">
              <span class="chip chip-role" [attr.data-role]="user().role">{{ roleLabelText() }}</span>
              <span class="chip chip-provider">
                <mat-icon>{{ providerIconText() }}</mat-icon>
                {{ providerLabelText() }}
              </span>
            </div>
          </div>
        </div>

        <section class="section">
          <h4>Контакты</h4>
          <dl class="fields">
            <div class="field">
              <dt>Телефон</dt>
              <dd>
                @if (user().phone) {
                  {{ user().phone }}
                  @if (user().phone_verified) {
                    <mat-icon class="check" title="Подтверждён">check_circle</mat-icon>
                  }
                } @else {
                  —
                }
              </dd>
            </div>
            <div class="field">
              <dt>Email подтверждён</dt>
              <dd>
                @if (user().email_verified) {
                  <span class="ok">Да</span>
                } @else {
                  <span class="muted">Нет</span>
                }
              </dd>
            </div>
            <div class="field">
              <dt>Активен</dt>
              <dd>
                @if (user().is_active) {
                  <span class="ok">Да</span>
                } @else {
                  <span class="muted">Нет</span>
                }
              </dd>
            </div>
          </dl>
        </section>

        <section class="section">
          <h4>Регистрация</h4>
          <dl class="fields">
            <div class="field">
              <dt>Создан</dt>
              <dd>{{ formatDt(user().created_at) }}</dd>
            </div>
            <div class="field">
              <dt>Последний вход</dt>
              <dd>{{ formatDt(user().last_login_at ?? null) }}</dd>
            </div>
          </dl>
        </section>

        @if (hasUtm()) {
          <section class="section">
            <h4>UTM</h4>
            <dl class="fields">
              @if (user().utm_source) {
                <div class="field">
                  <dt>source</dt>
                  <dd>{{ user().utm_source }}</dd>
                </div>
              }
              @if (user().utm_medium) {
                <div class="field">
                  <dt>medium</dt>
                  <dd>{{ user().utm_medium }}</dd>
                </div>
              }
              @if (user().utm_campaign) {
                <div class="field">
                  <dt>campaign</dt>
                  <dd>{{ user().utm_campaign }}</dd>
                </div>
              }
            </dl>
          </section>
        }

        <section class="section">
          <h4>Активность</h4>
          <dl class="fields">
            <div class="field">
              <dt>Заказов</dt>
              <dd>{{ user().has_order ? 'есть' : '—' }}</dd>
            </div>
            <div class="field">
              <dt>Бронирований</dt>
              <dd>—</dd>
            </div>
            <div class="field">
              <dt>Сессий чата</dt>
              <dd>—</dd>
            </div>
          </dl>
          <p class="note">Загрузка расширенной активности будет добавлена позже.</p>
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      background: var(--crm-surface, var(--mat-sys-surface-container-low));
    }
    .drawer {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .drawer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      background: var(--crm-surface-raised, var(--mat-sys-surface-container));
    }
    .drawer-head h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }
    .drawer-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .identity {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .avatar {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: var(--mat-sys-primary-container, rgba(103, 80, 164, 0.18));
      color: var(--mat-sys-on-primary-container, var(--mat-sys-primary));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .identity-text { min-width: 0; flex: 1; }
    .name {
      font-size: 16px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .email {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badges {
      display: flex;
      gap: 6px;
      margin-top: 6px;
      flex-wrap: wrap;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 22px;
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
    .chip-provider {
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }
    .chip mat-icon {
      font-size: 12px !important;
      width: 12px !important;
      height: 12px !important;
    }

    .section h4 {
      margin: 0 0 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--mat-sys-on-surface-variant);
    }
    .fields {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
    }
    .field {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 12px;
      font-size: 13px;
    }
    .field dt {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
    .field dd {
      margin: 0;
      color: var(--mat-sys-on-surface);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      word-break: break-word;
    }
    .ok { color: #10B981; font-weight: 500; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .check {
      font-size: 14px !important;
      width: 14px !important;
      height: 14px !important;
      color: #10B981;
    }

    .note {
      margin: 8px 0 0;
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }
  `],
})
export class UserDrawerComponent {
  readonly user = input.required<RecentRegistration>();
  readonly closed = output<void>();

  readonly displayNameText = computed(() => displayName(this.user()));
  readonly roleLabelText   = computed(() => roleLabel(this.user().role));
  readonly providerLabelText = computed(() => providerLabel(this.user().auth_provider));
  readonly providerIconText  = computed(() => providerIcon(this.user().auth_provider));
  readonly avatarLetter = computed(() => initials(this.user()));

  readonly hasUtm = computed(() => {
    const u = this.user();
    return !!(u.utm_source || u.utm_medium || u.utm_campaign);
  });

  formatDt(v: string | null | undefined): string {
    return formatDateTime(v);
  }
}
