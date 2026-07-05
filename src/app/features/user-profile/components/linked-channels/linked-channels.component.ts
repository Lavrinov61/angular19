import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

interface LinkedChannel {
  channel: string;
  display_name: string | null;
  username: string | null;
  verified_at: string;
  linked_by: string;
}

interface ChannelsResponse {
  channels: LinkedChannel[];
}

interface ChannelLinkResponse {
  linked?: boolean;
  channel?: LinkedChannel;
  message?: string;
  deepLink?: string;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function readErrorMessage(error: unknown, fallback: string): string {
  const record = readObject(error);
  const responseError = record?.['error'];
  if (typeof responseError === 'string' && responseError.trim()) return responseError;
  const body = readObject(responseError);
  const apiError = body?.['error'] ?? body?.['message'] ?? record?.['message'];
  return typeof apiError === 'string' && apiError.trim() ? apiError : fallback;
}

interface ChannelDef {
  id: string;
  name: string;
  icon: string;
  color: string;
}

const CHANNEL_DEFS: ChannelDef[] = [
  { id: 'telegram', name: 'Telegram', icon: 'channel-telegram', color: '#29B6F6' },
  { id: 'vk', name: 'ВКонтакте', icon: 'channel-vk', color: '#4C75A3' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'channel-whatsapp', color: '#25D366' },
  { id: 'max', name: 'МАКС', icon: 'channel-max', color: '#168DE2' },
];

@Component({
  selector: 'app-linked-channels',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="channels-container">
      <div class="page-header">
        <h2 class="page-title">
          <mat-icon>link</mat-icon>
          Привязанные мессенджеры
        </h2>
        <p class="page-subtitle">
          Привяжите аккаунты, чтобы мы узнавали вас при обращении
        </p>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="36" />
          <p>Загружаем каналы...</p>
        </div>
      }

      @if (!loading()) {
        <div class="channels-list">
          @for (ch of channelDefs; track ch.id) {
            <div class="channel-card">
              <div class="channel-info">
                <div class="channel-icon" [style.background]="ch.color + '1a'" [style.color]="ch.color">
                  <mat-icon [svgIcon]="ch.icon"></mat-icon>
                </div>
                <div class="channel-text">
                  <span class="channel-name">{{ ch.name }}</span>
                  @if (getLinked(ch.id); as linked) {
                    <span class="channel-detail">
                      {{ linked.username ? '@' + linked.username : linked.display_name || 'Привязано' }}
                    </span>
                  }
                </div>
              </div>

              <div class="channel-actions">
                @if (getLinked(ch.id)) {
                  <span class="linked-badge">Привязано</span>
                  <button
                    mat-button
                    class="unlink-btn"
                    [disabled]="linking() === ch.id"
                    (click)="unlink(ch.id)"
                  >
                    @if (linking() === ch.id) {
                      <mat-spinner diameter="16" />
                    } @else {
                      Отвязать
                    }
                  </button>
                } @else {
                  <button
                    mat-flat-button
                    class="link-btn"
                    [disabled]="linking() !== null"
                    (click)="link(ch.id)"
                  >
                    @if (linking() === ch.id) {
                      <mat-spinner diameter="16" />
                    } @else {
                      Привязать
                    }
                  </button>
                }
              </div>
            </div>
          }
        </div>

        <!-- Telegram deep link panel -->
        @if (deepLink()) {
          <div class="deep-link-panel">
            <div class="deep-link-header">
              <mat-icon class="deep-link-icon">send</mat-icon>
              <span>Привязка Telegram</span>
              <button mat-icon-button class="close-deep-link" (click)="deepLink.set(null)">
                <mat-icon>close</mat-icon>
              </button>
            </div>
            <p class="deep-link-text">
              Откройте бота в Telegram и нажмите <strong>Start</strong>.
              После этого вернитесь сюда и нажмите "Проверить привязку".
            </p>
            <div class="deep-link-actions">
              <a
                mat-flat-button
                class="open-telegram-btn"
                [href]="deepLink()"
                target="_blank"
                rel="noopener"
              >
                <mat-icon>open_in_new</mat-icon>
                Открыть Telegram
              </a>
              <button
                mat-stroked-button
                class="check-btn"
                [disabled]="linking() === 'telegram'"
                (click)="refreshChannels()"
              >
                @if (linking() === 'telegram') {
                  <mat-spinner diameter="16" />
                } @else {
                  <ng-container><mat-icon>refresh</mat-icon> Проверить привязку</ng-container>
                }
              </button>
            </div>
          </div>
        }

        <div class="info-hint">
          <mat-icon>info_outline</mat-icon>
          <span>
            После привязки мы автоматически найдём вас при обращении
            через любой мессенджер
          </span>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .channels-container {
      max-width: 640px;
      margin: 0 auto;
      padding: 24px 16px 48px;
    }

    /* ---- Header ---- */
    .page-header {
      margin-bottom: 24px;
    }

    .page-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 20px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0 0 6px;
    }

    .page-title mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--ed-accent, #f59e0b);
    }

    .page-subtitle {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #999);
      margin: 0;
    }

    /* ---- Loading ---- */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 48px 0;
      color: var(--ed-on-surface-variant, #999);
      font-size: 13px;
    }

    /* ---- Channel list ---- */
    .channels-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--ed-outline-variant, #2a2a2a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 12px;
      overflow: hidden;
    }

    .channel-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      background: var(--ed-surface, #111);
    }

    .channel-info {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .channel-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      flex-shrink: 0;
    }

    .channel-icon mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .channel-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .channel-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .channel-detail {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #999);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ---- Actions ---- */
    .channel-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .linked-badge {
      font-size: 11px;
      font-weight: 600;
      color: #22c55e;
      background: rgba(34, 197, 94, 0.12);
      padding: 3px 8px;
      border-radius: 6px;
      white-space: nowrap;
    }

    .link-btn {
      background: var(--ed-accent, #f59e0b) !important;
      color: #000 !important;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      min-width: 100px;
      height: 34px;
    }

    .unlink-btn {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #999) !important;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 8px;
      min-width: 80px;
      height: 34px;
    }

    .unlink-btn:hover {
      color: #ef4444 !important;
      border-color: #ef4444;
    }

    /* ---- Deep link panel ---- */
    .deep-link-panel {
      margin-top: 16px;
      padding: 16px;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.2);
      border-radius: 12px;
    }

    .deep-link-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 8px;
    }

    .deep-link-header mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .deep-link-icon {
      color: var(--ed-accent, #f59e0b);
    }

    .close-deep-link {
      margin-left: auto;
      width: 28px !important;
      height: 28px !important;
      line-height: 28px !important;
    }

    .close-deep-link mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .deep-link-text {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #bbb);
      margin: 0 0 12px;
      line-height: 1.5;
    }

    .deep-link-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .open-telegram-btn {
      background: var(--ed-accent, #f59e0b) !important;
      color: #000 !important;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      text-decoration: none;
      height: 36px;
    }

    .open-telegram-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }

    .check-btn {
      font-size: 13px;
      border-radius: 8px;
      color: var(--ed-on-surface-variant, #bbb) !important;
      height: 36px;
    }

    .check-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }

    /* ---- Info hint ---- */
    .info-hint {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 20px;
      padding: 12px 14px;
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 10px;
      font-size: 12px;
      color: var(--ed-on-surface-variant, #999);
      line-height: 1.5;
    }

    .info-hint mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    /* ---- Mobile ---- */
    @media (max-width: 480px) {
      .channels-container {
        padding: 16px 12px 40px;
      }

      .channel-card {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        padding: 12px;
      }

      .channel-actions {
        justify-content: flex-end;
      }

      .deep-link-actions {
        flex-direction: column;
      }

      .open-telegram-btn,
      .check-btn {
        width: 100%;
        justify-content: center;
      }
    }
  `],
})
export class LinkedChannelsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);

  readonly channelDefs = CHANNEL_DEFS;

  readonly channels = signal<LinkedChannel[]>([]);
  readonly loading = signal(true);
  readonly linking = signal<string | null>(null);
  readonly deepLink = signal<string | null>(null);

  readonly linkedMap = computed(() => {
    const map = new Map<string, LinkedChannel>();
    for (const ch of this.channels()) {
      map.set(ch.channel, ch);
    }
    return map;
  });

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadChannels();
    }
  }

  getLinked(channelId: string): LinkedChannel | undefined {
    return this.linkedMap().get(channelId);
  }

  link(channelId: string): void {
    if (channelId === 'max') {
      this.snackBar.open(
        'Напишите в наш чат @magnus_photo для привязки МАКС',
        'OK',
        { duration: 5000 },
      );
      return;
    }

    this.linking.set(channelId);

    if (channelId === 'telegram') {
      this.linkTelegram();
    } else {
      this.http.post<ChannelLinkResponse>(`/api/account/channels/link/${channelId}`, {}).subscribe({
        next: (res) => {
          this.linking.set(null);
          if (res.linked || res.channel) {
            if (res.channel) this.upsertLinkedChannel(res.channel);
            this.loadChannels();
            this.snackBar.open('Канал привязан', '', { duration: 3000 });
          } else {
            this.snackBar.open(
              res.message || 'Не удалось привязать. Проверьте настройки профиля.',
              'OK',
              { duration: 5000 },
            );
          }
        },
        error: (err) => {
          this.linking.set(null);
          this.snackBar.open(readErrorMessage(err, 'Ошибка привязки'), '', { duration: 5000 });
        },
      });
    }
  }

  unlink(channelId: string): void {
    this.linking.set(channelId);
    this.http.delete(`/api/account/channels/${channelId}`).subscribe({
      next: () => {
        this.linking.set(null);
        this.channels.update(list => list.filter(c => c.channel !== channelId));
        if (channelId === 'telegram') {
          this.deepLink.set(null);
        }
        this.snackBar.open('Канал отвязан', '', { duration: 3000 });
      },
      error: () => {
        this.linking.set(null);
        this.snackBar.open('Ошибка при отвязке', '', { duration: 3000 });
      },
    });
  }

  refreshChannels(): void {
    this.linking.set('telegram');
    this.loadChannels(() => {
      this.linking.set(null);
      const tg = this.linkedMap().get('telegram');
      if (tg) {
        this.deepLink.set(null);
        this.snackBar.open('Telegram привязан!', '', { duration: 3000 });
      } else {
        this.snackBar.open('Пока не привязано. Нажмите Start в боте и попробуйте снова.', 'OK', { duration: 5000 });
      }
    });
  }

  private loadChannels(onDone?: () => void): void {
    this.http.get<ChannelsResponse>('/api/account/channels').subscribe({
      next: (res) => {
        this.channels.set(res.channels);
        this.loading.set(false);
        onDone?.();
      },
      error: () => {
        this.loading.set(false);
        onDone?.();
      },
    });
  }

  private upsertLinkedChannel(channel: LinkedChannel): void {
    this.channels.update(list => [
      ...list.filter(item => item.channel !== channel.channel),
      channel,
    ]);
  }

  private linkTelegram(): void {
    this.http.post<ChannelLinkResponse>('/api/account/channels/link/telegram', {}).subscribe({
      next: (res) => {
        this.linking.set(null);
        if (res.linked || res.channel) {
          this.deepLink.set(null);
          if (res.channel) this.upsertLinkedChannel(res.channel);
          this.loadChannels();
          this.snackBar.open('Telegram привязан!', '', { duration: 3000 });
        } else if (res.deepLink) {
          this.deepLink.set(res.deepLink);
        }
      },
      error: (err) => {
        this.linking.set(null);
        this.snackBar.open(readErrorMessage(err, 'Ошибка привязки Telegram'), '', { duration: 5000 });
      },
    });
  }
}
