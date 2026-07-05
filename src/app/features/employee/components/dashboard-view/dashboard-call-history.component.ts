import { Component, ChangeDetectionStrategy, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TelephonyApiService, type CallLog } from '../../services/telephony-api.service';
import { TelephonyService } from '../../services/telephony.service';
import { maskPhone } from '../../utils/phone-mask';

const CALL_HISTORY_FETCH_LIMIT = 200;
const CALL_HISTORY_VISIBLE_GROUPS = 16;

interface CallHistoryGroup {
  id: string;
  phone: string | null;
  call: CallLog;
  count: number;
}

@Component({
  selector: 'app-dashboard-call-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <section class="call-history">
      <header class="section-head">
        <div class="title">
          <mat-icon>phone_in_talk</mat-icon>
          <h4>Звонки</h4>
        </div>
        <button mat-icon-button type="button" (click)="load()" aria-label="Обновить звонки">
          <mat-icon>refresh</mat-icon>
        </button>
      </header>

      @if (loading()) {
        <div class="empty">Загрузка...</div>
      } @else if (error()) {
        <div class="empty error">{{ error() }}</div>
      } @else if (callGroups().length) {
        <div class="call-list">
          @for (group of callGroups(); track group.id) {
            <article class="call-row"
                     [class.status-active]="group.call.status === 'active'"
                     [class.status-completed]="group.call.status === 'completed'"
                     [class.status-connecting]="group.call.status === 'connecting'"
                     [class.status-missed]="group.call.status === 'missed'"
                     [class.status-failed]="group.call.status === 'failed'">
              <mat-icon class="direction-icon">
                {{ group.call.direction === 'inbound' ? 'phone_callback' : 'phone_forwarded' }}
              </mat-icon>
              <div class="call-main">
                <div class="call-line">
                  <span class="phone">{{ displayPhone(group) }}</span>
                  <span class="call-badges">
                    @if (group.count > 1) {
                      <span class="repeat-count">x{{ group.count }}</span>
                    }
                    <span class="status">{{ callStatusLabel(group.call) }}</span>
                  </span>
                </div>
                <div class="meta">
                  <span>{{ formatStartedAt(group.call.started_at) }}</span>
                  @if (group.call.duration_seconds !== null) {
                    <span>{{ formatDuration(group.call.duration_seconds) }}</span>
                  }
                  @if (group.call.client_name) {
                    <span class="client-name">{{ group.call.client_name }}</span>
                  }
                </div>
                @if (callStatusHint(group.call); as hint) {
                  <div class="status-hint" [attr.title]="hint">
                    <mat-icon>info</mat-icon>
                    <span>{{ hint }}</span>
                  </div>
                }
              </div>
              @if (group.phone; as phone) {
                <button mat-icon-button
                        class="callback-btn"
                        type="button"
                        [disabled]="telephony.outboundRequesting()"
                        [attr.aria-label]="'Перезвонить ' + displayPhone(group)"
                        matTooltip="Перезвонить"
                        (click)="callBack(phone)">
                  <mat-icon>call</mat-icon>
                </button>
              }
            </article>
          }
        </div>
      } @else {
        <div class="empty">Звонков пока нет</div>
      }
    </section>
  `,
  styles: [`
    .call-history {
      border: 1px solid var(--crm-glass-border);
      border-radius: var(--crm-radius-lg);
      background: var(--crm-gradient-card);
      box-shadow: var(--crm-shadow-card);
      padding: 12px;
      min-width: 0;
    }

    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }

    .title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .title mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
      color: var(--crm-accent);
    }

    h4 {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--crm-text-primary);
    }

    .section-head button,
    .callback-btn {
      width: 30px;
      height: 30px;
      color: var(--crm-text-secondary) !important;
    }

    .section-head button mat-icon,
    .callback-btn mat-icon {
      width: 17px;
      height: 17px;
      font-size: 17px;
    }

    .call-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 360px;
      overflow-y: auto;
      padding-right: 2px;
      scrollbar-width: thin;
    }

    .call-row {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) 30px;
      gap: 8px;
      align-items: center;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      background: color-mix(in srgb, var(--crm-surface) 78%, transparent);
    }

    .callback-btn {
      justify-self: end;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);
      color: var(--crm-accent) !important;

      &:disabled {
        opacity: 0.55;
      }
    }

    .direction-icon {
      width: 28px;
      height: 28px;
      font-size: 17px;
      border-radius: var(--crm-radius-md);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--crm-accent);
      background: var(--crm-accent-muted);
    }

    .call-main {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .call-line,
    .meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .phone {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 700;
      color: var(--crm-text-primary);
      letter-spacing: 0;
    }

    .call-badges {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
      min-width: 0;
    }

    .status {
      flex-shrink: 0;
      font-size: 11px;
      color: var(--status-color, var(--crm-text-secondary));
    }

    .repeat-count {
      flex-shrink: 0;
      min-width: 24px;
      padding: 2px 6px;
      border-radius: 999px;
      background: var(--crm-accent-muted);
      color: var(--crm-accent);
      font-size: 10px;
      font-weight: 800;
      line-height: 1.2;
      text-align: center;
    }

    .meta {
      font-size: 11px;
      color: var(--crm-text-muted);
    }

    .status-hint {
      min-width: 0;
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr);
      align-items: start;
      gap: 5px;
      color: var(--crm-status-error);
      font-size: 11px;
      line-height: 1.25;

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
        line-height: 14px;
      }

      span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .client-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-completed { --status-color: var(--crm-status-success); }
    .status-active,
    .status-connecting { --status-color: var(--crm-accent); }
    .status-missed,
    .status-failed { --status-color: var(--crm-status-error); }

    .empty {
      min-height: 38px;
      display: flex;
      align-items: center;
      color: var(--crm-text-muted);
      font-size: 12px;
    }

    .empty.error {
      color: var(--crm-status-error);
    }
  `],
})
export class DashboardCallHistoryComponent {
  private readonly telephonyApi = inject(TelephonyApiService);
  protected readonly telephony = inject(TelephonyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly callGroups = signal<CallHistoryGroup[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.telephony.callHistoryRefreshTick();
      untracked(() => this.load());
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.telephonyApi.getCallHistory({ limit: CALL_HISTORY_FETCH_LIMIT }).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (res) => {
        this.callGroups.set(res.success ? this.groupCalls(res.data) : []);
        this.loading.set(false);
      },
      error: () => {
        this.callGroups.set([]);
        this.error.set('Не удалось загрузить');
        this.loading.set(false);
      },
    });
  }

  protected displayPhone(group: CallHistoryGroup): string {
    return maskPhone(group.phone) || 'Номер скрыт';
  }

  private groupCalls(calls: CallLog[]): CallHistoryGroup[] {
    const groups = new Map<string, CallHistoryGroup>();

    for (const call of calls) {
      const phone = this.callbackPhone(call);
      const key = phone ? this.normalizePhoneKey(phone) : `call:${call.id}`;
      const existing = groups.get(key);

      if (existing) {
        existing.count += 1;
        continue;
      }

      groups.set(key, {
        id: key,
        phone,
        call,
        count: 1,
      });
    }

    return Array.from(groups.values()).slice(0, CALL_HISTORY_VISIBLE_GROUPS);
  }

  private callbackPhone(call: CallLog): string | null {
    const raw = call.direction === 'inbound'
      ? call.caller_number
      : (call.called_number || call.caller_number);

    return raw.trim() || null;
  }

  private normalizePhoneKey(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 10) return `7${digits.slice(-10)}`;
    return digits || phone.trim().toLowerCase();
  }

  protected callBack(phone: string): void {
    void this.telephony.makeCall(phone);
  }

  protected statusLabel(status: string): string {
    switch (status) {
      case 'active':
        return 'идёт';
      case 'completed':
        return 'завершён';
      case 'connecting':
        return 'соединение';
      case 'missed':
        return 'пропущен';
      case 'failed':
        return 'ошибка';
      default:
        return status;
    }
  }

  protected callStatusLabel(call: CallLog): string {
    if (call.status !== 'failed') return this.statusLabel(call.status);

    switch (this.callFailureReason(call)) {
      case 'operator_answer_timeout':
        return 'нет ответа';
      case 'operator_failed':
      case 'operator_disconnected_before_answer':
      case 'operator_disconnected_before_pstn_answer':
        return 'телефон недоступен';
      case 'pstn_failed_before_answer':
      case 'pstn_disconnected_before_answer':
      case 'pstn_setup_timeout':
        return 'клиент не ответил';
      case 'invalid_destination':
        return 'плохой номер';
      case 'start_failed':
        return 'сбой телефонии';
      default:
        return this.statusLabel(call.status);
    }
  }

  protected callStatusHint(call: CallLog): string | null {
    if (call.status !== 'failed') return null;

    switch (this.callFailureReason(call)) {
      case 'operator_answer_timeout':
        return 'Телефон студии не ответил. Проверьте трубку/SIP и перезвоните.';
      case 'operator_failed':
      case 'operator_disconnected_before_answer':
      case 'operator_disconnected_before_pstn_answer':
        return 'Телефон студии отклонил звонок или недоступен. Проверьте SIP, питание и режим DND.';
      case 'pstn_failed_before_answer':
      case 'pstn_disconnected_before_answer':
      case 'pstn_setup_timeout':
        return 'Студия ответила, но клиентская линия не соединилась. Проверьте номер или попробуйте позже.';
      case 'invalid_destination':
        return 'Номер не распознан. Проверьте формат +7 и попробуйте снова.';
      case 'start_failed':
        return 'Сценарий звонка не запустился. Сообщите администратору.';
      default:
        return 'Звонок не состоялся. Проверьте телефон студии, номер клиента и попробуйте снова.';
    }
  }

  private callFailureReason(call: CallLog): string | null {
    const notes = call.notes || '';
    if (notes.includes('Voximplant click-to-call start failed')) return 'start_failed';

    const reason = notes.match(/\breason=([^,\]\s]+)/)?.[1]
      || notes.match(/\bfailure=([^,\]\s]+)/)?.[1]
      || null;

    return reason;
  }

  protected formatStartedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const dateKey = date.toLocaleDateString('ru-RU');
    const todayKey = now.toLocaleDateString('ru-RU');
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayKey = yesterday.toLocaleDateString('ru-RU');
    const time = date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    if (dateKey === todayKey) return time;
    if (dateKey === yesterdayKey) return `Вчера ${time}`;

    return `${date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
    })} ${time}`;
  }

  protected formatDuration(seconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const rest = safeSeconds % 60;
    return `${minutes}:${rest.toString().padStart(2, '0')}`;
  }
}
