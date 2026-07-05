import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit,
} from '@angular/core';
import { isPlatformBrowser, DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { interval } from 'rxjs';
import {
  BroadcastApiService,
  BroadcastListItem, BroadcastStats, BroadcastRecipient,
  BroadcastStatus, RecipientStatus, AudienceFilter,
} from '../../services/broadcast-api.service';
import { CreateBroadcastDialogComponent } from './create-broadcast-dialog.component';
import {
  ConfirmDialogComponent, ConfirmDialogData,
} from '../../../../shared/components/confirm-dialog/confirm-dialog.component';

const STATS_REFRESH_MS = 5000;
const RECIPIENTS_PAGE_SIZE = 25;

/** Каналы, готовые к реальной отправке: Telegram, MAX и ВКонтакте */
const DISPATCHABLE_CHANNELS = ['telegram', 'max', 'vk'];

/** Человеческие подписи каналов (fallback — сам идентификатор) */
const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  max: 'МАКС',
  vk: 'ВКонтакте',
  whatsapp: 'WhatsApp',
};

/** Запись канала в левом рейле. `id='all'` — псевдо-канал «все». */
interface ChannelRailItem {
  id: string;
  label: string;
  /** Короткий код для цветного бейджа (пусто у «все»). */
  short: string;
}

/** Каналы левого рейла — показываются ВСЕГДА (даже с 0 кампаний), порядок фиксирован. */
const CHANNEL_RAIL: ReadonlyArray<ChannelRailItem> = [
  { id: 'all', label: 'Все каналы', short: '' },
  { id: 'telegram', label: 'Telegram', short: 'TG' },
  { id: 'max', label: 'МАКС', short: 'MAX' },
  { id: 'vk', label: 'ВКонтакте', short: 'VK' },
  { id: 'whatsapp', label: 'WhatsApp', short: 'WA' },
];

@Component({
  selector: 'app-broadcasts-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DatePipe,
    MatCardModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule,
    MatTableModule, MatPaginatorModule, MatDividerModule, MatDialogModule,
    CreateBroadcastDialogComponent,
  ],
  templateUrl: './broadcasts-manager.component.html',
  styleUrl: './broadcasts-manager.component.scss',
  host: {
    class: 'broadcasts-manager-host',
  },
})
export class BroadcastsManagerComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly api = inject(BroadcastApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  // ── State ──
  readonly broadcasts = signal<BroadcastListItem[]>([]);
  readonly loading = signal(false);

  readonly selectedId = signal<string | null>(null);
  readonly stats = signal<BroadcastStats | null>(null);
  readonly statsLoading = signal(false);

  readonly recipients = signal<BroadcastRecipient[]>([]);
  readonly recipientsTotal = signal(0);
  readonly recipientsLoading = signal(false);
  readonly pageIndex = signal(0);
  readonly pageSize = signal(RECIPIENTS_PAGE_SIZE);

  readonly dispatching = signal(false);

  /** Режим инлайн-создания/редактирования: центральная панель показывает форму. */
  readonly creating = signal(false);

  /** Если задан — композер открыт на РЕДАКТИРОВАНИЕ этого черновика (иначе создание). */
  readonly editingId = signal<string | null>(null);

  /** Записи левого рейла каналов (статичный порядок). */
  readonly channelRail = CHANNEL_RAIL;

  /** Выбранный канал в рейле: 'all' = все, иначе id канала. */
  readonly selectedChannel = signal<string>('all');

  /** Вид списка получателей: все vs только кликнувшие по ссылке («Интересовались»). */
  readonly recipientView = signal<'all' | 'interested'>('all');

  readonly recipientColumns = ['contact', 'status', 'error', 'clicked', 'sent_at'];

  // ── Computed ──
  readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? this.broadcasts().find(b => b.id === id) ?? null : null;
  });

  /** ETA (секунды) → человекочитаемая строка */
  readonly etaLabel = computed(() => {
    const s = this.stats();
    if (!s || !s.etaSeconds || s.etaSeconds <= 0) return '—';
    return this.formatDuration(s.etaSeconds);
  });

  /** Сколько контактов кликнули по ссылке («Интересовались») */
  readonly clicksCount = computed(() => this.stats()?.clicks ?? 0);

  /** Кампании, отфильтрованные по выбранному в рейле каналу. */
  readonly filteredBroadcasts = computed(() => {
    const ch = this.selectedChannel();
    const all = this.broadcasts();
    if (ch === 'all') return all;
    return all.filter(b => this.channelOf(b) === ch);
  });

  /** Счётчик кампаний по каждому каналу рейла (id канала → число). */
  readonly channelCounts = computed(() => {
    const counts: Record<string, number> = { all: 0 };
    for (const b of this.broadcasts()) {
      counts['all']++;
      const ch = this.channelOf(b);
      counts[ch] = (counts[ch] ?? 0) + 1;
    }
    return counts;
  });

  constructor() {
    // Авто-refresh воронки + таблицы получателей выбранной рассылки (live-прогресс).
    // Таблица обновляется «тихо» (без спиннера) на текущей странице — клики «прорастают»
    // в реальном времени, не сбивая выбор/листание оператора.
    interval(STATS_REFRESH_MS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        const id = this.selectedId();
        if (id && isPlatformBrowser(this.platformId)) {
          this.refreshStats(id);
          this.loadRecipients(id, { silent: true });
        }
      });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadBroadcasts();
    }
  }

  loadBroadcasts(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: data => {
        this.broadcasts.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.snack.open('Ошибка загрузки рассылок', 'OK', { duration: 3000 });
        this.loading.set(false);
      },
    });
  }

  selectBroadcast(item: BroadcastListItem): void {
    // Toggle: повторный клик по выбранной — закрыть
    if (this.selectedId() === item.id) {
      this.closeDetail();
      return;
    }
    this.selectedId.set(item.id);
    this.pageIndex.set(0);
    this.recipientView.set('all');
    this.stats.set(null);
    this.recipients.set([]);
    this.recipientsTotal.set(0);
    this.refreshStats(item.id);
    this.loadRecipients(item.id);
  }

  closeDetail(): void {
    this.selectedId.set(null);
    this.stats.set(null);
    this.recipients.set([]);
    this.recipientsTotal.set(0);
    this.pageIndex.set(0);
    this.recipientView.set('all');
  }

  refreshStats(id: string): void {
    if (!this.stats()) this.statsLoading.set(true);
    this.api.stats(id).subscribe({
      next: data => {
        this.stats.set(data);
        this.statsLoading.set(false);
      },
      error: () => {
        this.statsLoading.set(false);
      },
    });
  }

  loadRecipients(id: string, opts: { silent?: boolean } = {}): void {
    const silent = opts.silent === true;
    if (!silent) this.recipientsLoading.set(true);
    const offset = this.pageIndex() * this.pageSize();
    const clicked = this.recipientView() === 'interested';
    this.api.recipients(id, { limit: this.pageSize(), offset, clicked }).subscribe({
      next: page => {
        this.recipients.set(page.items);
        this.recipientsTotal.set(page.total);
        if (!silent) this.recipientsLoading.set(false);
      },
      error: () => {
        // Тихий авто-refresh не шумит тостами и не сбрасывает текущие данные
        if (!silent) {
          this.snack.open('Ошибка загрузки получателей', 'OK', { duration: 3000 });
          this.recipientsLoading.set(false);
        }
      },
    });
  }

  /** Переключить вид списка: все получатели ↔ только кликнувшие («Интересовались»). */
  setRecipientView(view: 'all' | 'interested'): void {
    if (this.recipientView() === view) return;
    this.recipientView.set(view);
    this.pageIndex.set(0);
    const id = this.selectedId();
    if (id) this.loadRecipients(id);
  }

  onPage(event: PageEvent): void {
    const id = this.selectedId();
    if (!id) return;
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.loadRecipients(id);
  }

  /** Открыть инлайн-форму создания в центральной панели (вместо модалки). */
  startCreate(): void {
    this.closeDetail();
    this.editingId.set(null);
    this.creating.set(true);
  }

  /** Открыть композер на редактирование черновика (только status='draft'). */
  startEdit(item: BroadcastListItem): void {
    this.closeDetail();
    this.editingId.set(item.id);
    this.creating.set(true);
  }

  /** Форма сообщила об успешном создании/обновлении — закрыть панель, обновить список. */
  onCreated(): void {
    this.creating.set(false);
    this.editingId.set(null);
    this.loadBroadcasts();
  }

  /** Отмена/закрытие инлайн-формы. */
  onCancelCreate(): void {
    this.creating.set(false);
    this.editingId.set(null);
  }

  /** Запустить рассылку (диспетчер обработает материализованных queued) */
  dispatch(item: BroadcastListItem): void {
    this.runDispatch(item.id, item.test_mode);
  }

  /** «Запустить на всех» — go-live (test_mode=false) под жёстким подтверждением, затем dispatch */
  goLiveAndDispatch(item: BroadcastListItem): void {
    const filter = item.audience_filter;
    // Не-telegram сегмент: реальная отправка в v1 недоступна — блокируем go-live
    if (filter && !this.isDispatchableChannel(filter.channel)) {
      this.snack.open(
        `Отправка в канал «${this.channelLabel(filter.channel)}» скоро. Сейчас доступны Telegram, МАКС и ВКонтакте.`,
        'OK', { duration: 4000 },
      );
      return;
    }
    if (filter) {
      // Сегментированная рассылка — показываем реальное число получателей в confirm
      this.dispatching.set(true);
      this.api.audiencePreview(filter).subscribe({
        next: ({ count }) => {
          this.dispatching.set(false);
          this.confirmGoLive(item, count);
        },
        error: () => {
          this.dispatching.set(false);
          // Не смогли посчитать — показываем confirm без точного числа
          this.confirmGoLive(item, null);
        },
      });
      return;
    }
    // Без сегмента — рассылка на всех подписчиков канала (как было)
    this.confirmGoLive(item, null);
  }

  /** Danger-confirm go-live; count !== null → подставляем реальное число получателей */
  private confirmGoLive(item: BroadcastListItem, count: number | null): void {
    const audience = count === null
      ? '<b>всем</b> подходящим подписчикам'
      : `<b>${count}</b> подписчикам сегмента`;
    const data: ConfirmDialogData = {
      title: 'Разослать всем подписчикам?',
      message:
        `Рассылка «<b>${this.escapeHtml(item.name)}</b>» будет переведена из тест-режима в боевой ` +
        `и отправлена ${audience}. Действие необратимо.`,
      confirmButtonText: 'Разослать всем',
      cancelButtonText: 'Отмена',
      type: 'danger',
    };
    this.dialog.open(ConfirmDialogComponent, { data, width: '440px' })
      .afterClosed().subscribe(confirmed => {
        if (!confirmed) return;
        this.dispatching.set(true);
        this.api.goLive(item.id).subscribe({
          next: () => {
            // После flip test_mode=false — запускаем диспетчер на всех
            this.runDispatch(item.id, false);
          },
          error: () => {
            this.snack.open('Ошибка перевода в боевой режим', 'OK', { duration: 3000 });
            this.dispatching.set(false);
          },
        });
      });
  }

  private runDispatch(id: string, testMode: boolean): void {
    this.dispatching.set(true);
    this.api.dispatch(id).subscribe({
      next: () => {
        this.snack.open(
          testMode ? 'Тестовая рассылка запущена' : 'Рассылка запущена на всех',
          'OK', { duration: 2500 },
        );
        this.dispatching.set(false);
        this.loadBroadcasts();
        if (this.selectedId() === id) {
          this.refreshStats(id);
          this.loadRecipients(id);
        }
      },
      error: (err: unknown) => {
        const conflict = err instanceof HttpErrorResponse && err.status === 409;
        this.snack.open(
          conflict ? 'Рассылка уже запущена' : 'Ошибка запуска рассылки',
          'OK', { duration: 3000 },
        );
        this.dispatching.set(false);
      },
    });
  }

  /** Выбрать канал в рейле: фильтрует список, закрывает открытую деталь. */
  selectChannel(id: string): void {
    if (this.selectedChannel() === id) return;
    this.selectedChannel.set(id);
    this.closeDetail();
  }

  // ── Helpers ──

  /** Канал кампании: явный столбец → канал сегмента → telegram (legacy). */
  channelOf(b: BroadcastListItem): string {
    return b.channel ?? b.audience_filter?.channel ?? 'telegram';
  }

  /** Число кампаний в канале рейла. */
  channelCount(id: string): number {
    return this.channelCounts()[id] ?? 0;
  }

  /** Человеческая подпись канала сегмента */
  channelLabel(channel: string): string {
    return CHANNEL_LABELS[channel] ?? channel;
  }

  /** Канал готов к реальной отправке (Telegram, MAX или ВКонтакте) */
  isDispatchableChannel(channel: string): boolean {
    return DISPATCHABLE_CHANNELS.includes(channel);
  }

  /** Подпись давности сегмента для деталей */
  recencyLabel(days: number | null | undefined): string {
    if (days === null || days === undefined) return 'Любая давность';
    return `До ${days} дн.`;
  }

  /** Краткое описание сегмента для карточки/деталей */
  audienceSummary(filter: AudienceFilter): string {
    const parts: string[] = [this.channelLabel(filter.channel)];
    const slugs = filter.serviceSlugs;
    if (slugs && slugs.length > 0) parts.push(`${slugs.length} услуг`);
    if (filter.recencyDays !== null && filter.recencyDays !== undefined) {
      parts.push(`до ${filter.recencyDays} дн.`);
    }
    return parts.join(' · ');
  }

  statusLabel(status: BroadcastStatus | string): string {
    const map: Record<string, string> = {
      draft: 'Черновик',
      active: 'Активна',
      paused: 'Пауза',
      completed: 'Завершена',
      cancelled: 'Отменена',
    };
    return map[status] ?? status;
  }

  statusClass(status: string): string {
    return `status-${status}`;
  }

  recipientStatusLabel(status: RecipientStatus | string): string {
    const map: Record<string, string> = {
      queued: 'В очереди',
      sent: 'Отправлено',
      failed: 'Ошибка',
      blocked: 'Заблокирован',
      skipped: 'Пропущен',
      suppressed: 'Отписан',
    };
    return map[status] ?? status;
  }

  recipientStatusClass(status: string): string {
    return `rstatus-${status}`;
  }

  formatRate(rate: number | null | undefined): string {
    if (rate === null || rate === undefined) return '—';
    return Math.round(rate * 100) + '%';
  }

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m <= 0) return `${s} с`;
    return `${m} мин ${s} с`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
