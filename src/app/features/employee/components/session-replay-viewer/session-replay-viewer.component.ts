import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  OnInit, OnDestroy, ElementRef, ViewChild, DestroyRef, PLATFORM_ID,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { eventWithTime } from '@rrweb/types';
import { ReplayApiService, ReplaySession, TimelineItem } from '../../services/replay-api.service';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';

export interface SessionReplayDialogData {
  session: ReplaySession;
}

@Component({
  selector: 'app-session-replay-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatChipsModule, MatTooltipModule,
  ],
  template: `
    <div class="replay-dialog">
      <!-- ─── Header ─── -->
      <div class="rd-header">
        <div class="rd-title">
          <mat-icon>videocam</mat-icon>
          <span>Запись сессии</span>
          <span class="rd-meta">{{ formatDate(data.session.started_at) }} · {{ formatDuration(data.session.duration_seconds) }}</span>
        </div>
        <div class="rd-chips">
          <span class="rd-chip" [class.chip-mobile]="data.session.device_type === 'mobile'">
            <mat-icon>{{ deviceIcon() }}</mat-icon>{{ data.session.device_type }}
          </span>
          <span class="rd-chip">
            <mat-icon>article</mat-icon>{{ data.session.total_pages }} стр.
          </span>
          <span class="rd-chip">
            <mat-icon>touch_app</mat-icon>{{ data.session.total_clicks }} кликов
          </span>
          @if (data.session.has_error) {
            <span class="rd-chip chip-error"><mat-icon>error</mat-icon>Ошибки JS</span>
          }
        </div>
        <button mat-icon-button matTooltip="Полный экран (F)" (click)="toggleFullscreen()" class="rd-action">
          <mat-icon>{{ isFullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
        </button>
        <button mat-icon-button mat-dialog-close class="rd-close" matTooltip="Закрыть (Esc)">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <!-- ─── Landing page ─── -->
      @if (data.session.landing_page) {
        <div class="rd-landing">
          <mat-icon>link</mat-icon>
          <span class="landing-url">{{ data.session.landing_page }}</span>
          @if (!showDetails()) {
            <button mat-icon-button class="details-toggle" matTooltip="Подробности" (click)="loadAndShowDetails()">
              <mat-icon>expand_more</mat-icon>
            </button>
          } @else {
            <button mat-icon-button class="details-toggle" matTooltip="Скрыть" (click)="showDetails.set(false)">
              <mat-icon>expand_less</mat-icon>
            </button>
          }
        </div>
      }

      <!-- ─── Session details expansion ─── -->
      @if (showDetails()) {
        <div class="rd-details">
          @if (sessionDetail()) {
            <span class="detail-item"><strong>User Agent:</strong> {{ sessionDetail()!.user_agent || '—' }}</span>
            <span class="detail-item"><strong>Экран:</strong> {{ sessionDetail()!.screen_width || '?' }}×{{ sessionDetail()!.screen_height || '?' }}</span>
          } @else {
            <span class="detail-item loading-text">Загрузка…</span>
          }
        </div>
      }

      <!-- ─── Body ─── -->
      <div class="rd-body">
        <!-- Player -->
        <div class="player-col">
          @if (loading()) {
            <div class="player-loading">
              <mat-spinner diameter="40" />
              <span>Загрузка записи…</span>
            </div>
          } @else if (error()) {
            <div class="player-error">
              <mat-icon>videocam_off</mat-icon>
              <span>{{ error() }}</span>
            </div>
          } @else {
            <div #playerContainer class="player-container"></div>
          }
        </div>

        <!-- Timeline sidebar -->
        <div class="timeline-col" [class.tl-open]="timelineOpen()">
          <div class="tl-title">
            <mat-icon>timeline</mat-icon> События
            <button mat-icon-button class="tl-toggle-close" (click)="timelineOpen.set(false)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          @if (timeline().length === 0 && !loading()) {
            <div class="tl-empty">Нет событий</div>
          }
          <div #timelineList class="tl-list">
            @for (item of timeline(); track $index) {
              <div class="tl-item" [class]="'tl-' + item.event_type"
                   [class.tl-active]="activeTimelineIndex() === $index"
                   (click)="onTimelineClick(item, $index)"
                   (keydown.enter)="onTimelineClick(item, $index)"
                   tabindex="0">
                <mat-icon class="tl-icon">{{ getEventIcon(item.event_type) }}</mat-icon>
                <div class="tl-content">
                  <div class="tl-label">{{ getEventLabel(item.event_type) }}</div>
                  @if (item.page_path) {
                    <div class="tl-path">{{ item.page_path }}</div>
                  }
                  @if (item.element_text) {
                    <div class="tl-detail">{{ item.element_text }}</div>
                  }
                </div>
                <div class="tl-time">{{ formatRelTime(item.timestamp) }}</div>
              </div>
            }
          </div>
        </div>

        <!-- Mobile timeline toggle -->
        <button mat-mini-fab class="tl-toggle-btn" matTooltip="События" (click)="timelineOpen.set(true)">
          <mat-icon>timeline</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .replay-dialog {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--crm-surface);
      color: var(--crm-text-primary);
      overflow: hidden;
    }

    /* ─── Header ─── */
    .rd-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-raised);
      flex-shrink: 0;
    }

    .rd-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 600;

      mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; }
    }

    .rd-meta {
      font-size: 12px;
      font-weight: 400;
      color: var(--crm-text-muted);
    }

    .rd-chips {
      display: flex;
      gap: 6px;
      margin-left: auto;
      flex-wrap: wrap;
    }

    .rd-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      background: var(--crm-surface-hover);
      color: var(--crm-text-secondary);

      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }

    .chip-mobile { color: var(--crm-status-info); }
    .chip-error { color: var(--crm-status-error); background: color-mix(in srgb, var(--crm-status-error) 10%, transparent); }

    .rd-action, .rd-close { flex-shrink: 0; }

    /* ─── Landing ─── */
    .rd-landing {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      font-size: 11px;
      color: var(--crm-text-muted);
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-raised);
      flex-shrink: 0;

      mat-icon { font-size: 13px; width: 13px; height: 13px; color: var(--crm-accent); }
    }

    .landing-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

    .details-toggle {
      width: 24px;
      height: 24px;
      line-height: 24px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    /* ─── Session details ─── */
    .rd-details {
      display: flex;
      gap: 16px;
      padding: 6px 16px;
      font-size: 11px;
      color: var(--crm-text-muted);
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-raised);
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .detail-item {
      strong { color: var(--crm-text-secondary); }
    }

    .loading-text { font-style: italic; }

    /* ─── Body ─── */
    .rd-body {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      position: relative;
    }

    /* ─── Player ─── */
    .player-col {
      flex: 1;
      min-width: 0;
      background: #111;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
    }

    .player-container {
      width: 100%;
      height: 100%;
      overflow: hidden;

      ::ng-deep .rr-player {
        background: #111 !important;
        width: 100% !important;
        height: 100% !important;
      }
    }

    .player-loading, .player-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: rgba(255,255,255,0.7);
      font-size: 13px;

      mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.4; }
    }

    /* ─── Timeline ─── */
    .timeline-col {
      width: 220px;
      flex-shrink: 0;
      border-left: 1px solid var(--crm-border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .tl-list {
      overflow-y: auto;
      flex: 1;
      padding: 0 8px 8px;
    }

    .tl-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary);
      padding: 8px 8px 8px;
      border-bottom: 1px solid var(--crm-border);
      margin-bottom: 6px;
      flex-shrink: 0;

      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-accent); }
    }

    .tl-toggle-close { display: none; margin-left: auto; }

    .tl-empty {
      font-size: 12px;
      color: var(--crm-text-muted);
      text-align: center;
      padding: 16px 0;
    }

    .tl-item {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 4px 4px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.1s;
      border-left: 3px solid transparent;

      &:hover { background: var(--crm-surface-hover); }

      &.tl-active {
        border-left-color: var(--crm-accent);
        background: color-mix(in srgb, var(--crm-accent) 8%, transparent);
      }
    }

    .tl-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--crm-text-muted);
      margin-top: 1px;
      flex-shrink: 0;
    }

    .tl-page_view .tl-icon { color: var(--crm-accent); }
    .tl-click .tl-icon { color: var(--crm-status-info); }
    .tl-rage_click .tl-icon { color: var(--crm-status-warning); }
    .tl-js_error .tl-icon { color: var(--crm-status-error); }
    .tl-chat_open .tl-icon { color: var(--crm-status-success); }

    .tl-content { flex: 1; min-width: 0; }
    .tl-label { font-size: 11px; font-weight: 500; color: var(--crm-text-primary); }
    .tl-path { font-size: 10px; color: var(--crm-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tl-detail { font-size: 10px; color: var(--crm-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: italic; }
    .tl-time { font-size: 10px; color: var(--crm-text-muted); flex-shrink: 0; white-space: nowrap; }

    /* ─── Mobile timeline toggle ─── */
    .tl-toggle-btn {
      display: none;
      position: absolute;
      right: 12px;
      bottom: 12px;
      z-index: 5;
    }

    @media (max-width: 768px) {
      .timeline-col {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 10;
        background: var(--crm-surface);
        transform: translateX(100%);
        transition: transform 0.25s ease;

        &.tl-open { transform: translateX(0); }
      }

      .tl-toggle-btn { display: flex; }
      .tl-toggle-close { display: inline-flex; }
    }
  `],
})
export class SessionReplayViewerComponent implements OnInit, OnDestroy {
  @ViewChild('playerContainer') playerContainerRef!: ElementRef<HTMLElement>;
  @ViewChild('timelineList') timelineListRef!: ElementRef<HTMLElement>;

  protected readonly data = inject<SessionReplayDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? { session: {} as ReplaySession };
  private readonly replayApi = inject(ReplayApiService);
  private readonly dialogRef = inject(MatDialogRef<SessionReplayViewerComponent>, { optional: true });
  private readonly shortcuts = inject(KeyboardShortcutsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly doc = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  loading = signal(true);
  error   = signal<string | null>(null);
  timeline = signal<TimelineItem[]>([]);
  activeTimelineIndex = signal(-1);
  timelineOpen = signal(false);
  isFullscreen = signal(false);
  showDetails = signal(false);
  sessionDetail = signal<{ user_agent?: string; screen_width?: number; screen_height?: number } | null>(null);

  private playerInstance: { pause(): void; play(): void; toggle?(): void; goto?(timeOffset: number): void; $destroy?: () => void } | null = null;
  private sessionStartTime = 0;
  private allEvents: unknown[] = [];
  private unregisterShortcuts: (() => void)[] = [];

  deviceIcon = computed(() =>
    this.data.session.device_type === 'mobile' ? 'smartphone'
    : this.data.session.device_type === 'tablet' ? 'tablet_mac'
    : 'computer'
  );

  ngOnInit(): void {
    this.injectRrwebStyles();
    this.loadReplay();
    this.registerShortcuts();
  }

  /** Динамическая инъекция rrweb-player CSS (убран из глобальных стилей) */
  private injectRrwebStyles(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const id = 'rrweb-player-styles';
    if (this.doc.getElementById(id)) return;
    const link = this.doc.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = '/rrweb-player/style.css';
    this.doc.head.appendChild(link);
  }

  ngOnDestroy(): void {
    this.playerInstance?.pause?.();
    this.playerInstance?.$destroy?.();
    this.unregisterShortcuts.forEach(fn => fn());
  }

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────────

  private registerShortcuts(): void {
    const u1 = this.shortcuts.register({
      key: ' ',
      scope: 'global',
      description: 'Play/Pause',
      handler: () => {
        if (this.playerInstance?.toggle) {
          this.playerInstance.toggle();
        }
      },
    });

    const u2 = this.shortcuts.register({
      key: 'f',
      scope: 'global',
      description: 'Полный экран',
      handler: () => this.toggleFullscreen(),
    });

    this.unregisterShortcuts.push(u1, u2);
    this.destroyRef.onDestroy(() => this.unregisterShortcuts.forEach(fn => fn()));
  }

  // ─── Fullscreen ──────────────────────────────────────────────────────────────

  toggleFullscreen(): void {
    const el = this.dialogRef
      ? (this.doc.querySelector('.replay-dialog-panel') as HTMLElement)
      : this.doc.documentElement;

    if (!el) return;

    if (this.doc.fullscreenElement) {
      this.doc.exitFullscreen().then(() => this.isFullscreen.set(false));
    } else {
      el.requestFullscreen?.().then(() => this.isFullscreen.set(true));
    }
  }

  // ─── Timeline click → seek ───────────────────────────────────────────────────

  onTimelineClick(item: TimelineItem, index: number): void {
    this.activeTimelineIndex.set(index);

    if (this.playerInstance?.goto && this.sessionStartTime > 0) {
      const itemTime = new Date(item.timestamp).getTime();
      const offset = itemTime - this.sessionStartTime;
      if (offset >= 0) {
        this.playerInstance.goto(offset);
      }
    }
  }

  // ─── Session details ─────────────────────────────────────────────────────────

  loadAndShowDetails(): void {
    this.showDetails.set(true);
    if (this.sessionDetail()) return;

    this.replayApi.getSessionDetails(this.data.session.id).subscribe({
      next: detail => this.sessionDetail.set({
        user_agent: detail.user_agent ?? undefined,
        screen_width: detail.screen_width ?? undefined,
        screen_height: detail.screen_height ?? undefined,
      }),
      error: () => this.sessionDetail.set({ user_agent: 'Ошибка загрузки' }),
    });
  }

  // ─── Load replay ─────────────────────────────────────────────────────────────

  private async loadReplay(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    this.replayApi.getSessionChunks(this.data.session.id).subscribe({
      next: async (result) => {
        this.timeline.set(result.timeline);

        // Merge all events from chunks
        this.allEvents = result.chunks
          .sort((a, b) => a.chunk_index - b.chunk_index)
          .flatMap(c => c.events);

        if (this.allEvents.length === 0) {
          this.error.set('Нет данных для воспроизведения');
          this.loading.set(false);
          return;
        }

        // Determine session start time from first rrweb event
        const firstEvent = this.allEvents[0] as { timestamp?: number };
        this.sessionStartTime = firstEvent?.timestamp || 0;

        this.loading.set(false);

        // Let Angular update DOM
        await new Promise(r => setTimeout(r, 50));
        await this.initPlayer(this.allEvents);
      },
      error: () => {
        this.error.set('Ошибка загрузки записи');
        this.loading.set(false);
      },
    });
  }

  private async initPlayer(events: unknown[]): Promise<void> {
    const container = this.playerContainerRef?.nativeElement;
    if (!container) return;

    try {
      const { default: rrwebPlayer } = await import('rrweb-player');
      this.playerInstance = new rrwebPlayer({
        target: container,
        props: {
          events: events as eventWithTime[],
          showController: true,
          autoPlay: false,
          speedOption: [1, 2, 4, 8],
          width: container.clientWidth || 800,
          height: container.clientHeight || 500,
        },
      });

      // Listen to playback time updates for active timeline tracking
      this.setupTimeTracking();
    } catch {
      this.error.set('Не удалось загрузить плеер (rrweb-player)');
    }
  }

  private setupTimeTracking(): void {
    const player = this.playerInstance as unknown as { addEventListener?(event: string, cb: (data: { payload: number }) => void): void };
    if (!player?.addEventListener) return;

    player.addEventListener('ui-update-current-time', (data: { payload: number }) => {
      const currentTime = data.payload; // ms offset from session start
      const tl = this.timeline();
      if (tl.length === 0 || this.sessionStartTime === 0) return;

      // Find the closest timeline event <= currentTime
      let bestIdx = -1;
      for (let i = 0; i < tl.length; i++) {
        const evTime = new Date(tl[i].timestamp).getTime() - this.sessionStartTime;
        if (evTime <= currentTime) {
          bestIdx = i;
        } else {
          break;
        }
      }

      if (bestIdx !== this.activeTimelineIndex()) {
        this.activeTimelineIndex.set(bestIdx);
        // Auto-scroll timeline to active element
        this.scrollTimelineToActive(bestIdx);
      }
    });
  }

  private scrollTimelineToActive(index: number): void {
    const list = this.timelineListRef?.nativeElement;
    if (!list || index < 0) return;
    const items = list.querySelectorAll('.tl-item');
    if (items[index]) {
      (items[index] as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ─── Formatters ───────────────────────────────────────────────────────────────

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(secs: number | null): string {
    if (!secs) return '—';
    if (secs < 60) return `${secs}с`;
    return `${Math.floor(secs / 60)}м ${secs % 60}с`;
  }

  formatRelTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  getEventIcon(type: string): string {
    const map: Record<string, string> = {
      page_view: 'article', click: 'touch_app', rage_click: 'warning',
      js_error: 'bug_report', chat_open: 'chat', form_submit: 'send',
      scroll_depth: 'keyboard_double_arrow_down',
    };
    return map[type] || 'radio_button_unchecked';
  }

  getEventLabel(type: string): string {
    const map: Record<string, string> = {
      page_view: 'Просмотр страницы', click: 'Клик', rage_click: 'Rage-клик',
      js_error: 'Ошибка JS', chat_open: 'Открыл чат', form_submit: 'Отправил форму',
      scroll_depth: 'Прокрутка',
    };
    return map[type] || type;
  }
}
