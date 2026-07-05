import {
  Component, ChangeDetectionStrategy, input, signal, computed,
  viewChild, ElementRef, OnDestroy, OnInit, inject, PLATFORM_ID
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface WaveBar {
  height: number;
}

@Component({
  selector: 'app-media-audio-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: {
    'class': 'media-audio-player',
    '[class.compact]': 'compact()',
  },
  template: `
    @if (error()) {
      <div class="player-container player-error">
        <mat-icon class="error-icon">error_outline</mat-icon>
        <span class="error-text">Не удалось загрузить аудио</span>
        <a class="dl-btn" [href]="src()" target="_blank" download>
          <mat-icon>download</mat-icon>
        </a>
      </div>
    } @else {
      <div class="player-container">
        <button class="play-btn" (click)="togglePlay()">
          <mat-icon>{{ playing() ? 'pause' : 'play_arrow' }}</mat-icon>
        </button>

        <div class="waveform-area">
          <svg class="waveform-svg"
               [attr.viewBox]="'0 0 ' + barCount + ' 32'"
               preserveAspectRatio="none"
               (click)="seekFromClick($event)"
               (keydown.enter)="seekFromEnter($event)"
               tabindex="0"
               role="slider"
               [attr.aria-valuenow]="playedBarIndex()"
               aria-valuemin="0"
               [attr.aria-valuemax]="barCount"
               #waveformSvg>
            @for (bar of bars(); track $index) {
              <rect
                [attr.x]="$index"
                [attr.y]="16 - bar.height / 2"
                width="0.6"
                [attr.height]="bar.height"
                [attr.rx]="0.3"
                [attr.fill]="$index < playedBarIndex() ? 'var(--crm-accent)' : 'var(--crm-glass-border)'"
              />
            }
          </svg>
        </div>

        <span class="time-display">{{ formatTime(currentTime()) }} / {{ formatTime(duration()) }}</span>

        @if (!compact()) {
          <a class="dl-btn" [href]="src()" target="_blank" download>
            <mat-icon>download</mat-icon>
          </a>
        }
      </div>
    }

    <audio #audioEl
           [src]="src()"
           preload="metadata"
           (loadedmetadata)="onMetadata()"
           (durationchange)="onMetadata()"
           (timeupdate)="onTimeUpdate()"
           (ended)="onEnded()"
           (error)="onError()">
    </audio>
  `,
  styles: [`
    :host {
      display: block;
      max-width: 280px;
    }

    :host.compact {
      max-width: 220px;

      .player-container {
        padding: 4px 8px;
      }
    }

    .player-container {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--crm-surface-overlay);
      border-radius: var(--crm-radius-md);
      border: 1px solid var(--crm-glass-border);
    }

    /* ── Play button ── */
    .play-btn {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: var(--crm-accent);
      color: var(--crm-on-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform var(--crm-transition-fast), background var(--crm-transition-fast);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        background: var(--crm-accent-hover);
        transform: scale(1.05);
      }

      &:active {
        transform: scale(0.95);
      }
    }

    /* ── Waveform ── */
    .waveform-area {
      flex: 1;
      min-width: 0;
      height: 32px;
      cursor: pointer;
    }

    .waveform-svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    /* ── Time ── */
    .time-display {
      font-family: var(--crm-font-mono);
      font-size: 11px;
      color: var(--crm-text-muted);
      white-space: nowrap;
      user-select: none;
      flex-shrink: 0;
    }

    /* ── Error state ── */
    .player-error {
      gap: 6px;
    }

    .error-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-muted);
    }

    .error-text {
      flex: 1;
      font-size: 12px;
      color: var(--crm-text-muted);
    }

    /* ── Download button ── */
    .dl-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--crm-text-muted);
      text-decoration: none;
      border-radius: 4px;
      padding: 2px;
      transition: color var(--crm-transition-fast), background var(--crm-transition-fast);
      flex-shrink: 0;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        color: var(--crm-accent);
        background: var(--crm-accent-muted);
      }
    }
  `],
})
export class MediaAudioPlayerComponent implements OnInit, OnDestroy {
  readonly src = input.required<string>();
  readonly compact = input(false);

  private readonly platformId = inject(PLATFORM_ID);
  private readonly audioRef = viewChild<ElementRef<HTMLAudioElement>>('audioEl');
  private readonly waveformSvgRef = viewChild<ElementRef<SVGSVGElement>>('waveformSvg');

  readonly barCount = 40;
  readonly playing = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly error = signal(false);
  readonly bars = signal<WaveBar[]>([]);

  readonly playedBarIndex = computed(() => {
    const d = this.duration();
    if (d <= 0) return 0;
    return Math.floor((this.currentTime() / d) * this.barCount);
  });

  private get audio(): HTMLAudioElement | undefined {
    return this.audioRef()?.nativeElement;
  }

  ngOnInit(): void {
    this.generateBars();
  }

  private generateBars(): void {
    const result: WaveBar[] = [];
    for (let i = 0; i < this.barCount; i++) {
      const height = 4 + Math.random() * 24;
      result.push({ height });
    }
    this.bars.set(result);
  }

  onMetadata(): void {
    const a = this.audio;
    if (a && isFinite(a.duration) && a.duration > 0) {
      this.duration.set(a.duration);
    }
  }

  onError(): void {
    this.error.set(true);
    this.playing.set(false);
  }

  onTimeUpdate(): void {
    const a = this.audio;
    if (a) this.currentTime.set(a.currentTime);
  }

  onEnded(): void {
    this.playing.set(false);
  }

  togglePlay(): void {
    const a = this.audio;
    if (!a) return;
    if (a.paused) {
      a.play();
      this.playing.set(true);
    } else {
      a.pause();
      this.playing.set(false);
    }
  }

  seekFromEnter(_e: Event): void {
    this.togglePlay();
  }

  seekFromClick(e: MouseEvent): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const svg = this.waveformSvgRef()?.nativeElement;
    const a = this.audio;
    if (!svg || !a || !isFinite(a.duration)) return;
    const rect = svg.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * a.duration;
    this.currentTime.set(a.currentTime);
  }

  formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  ngOnDestroy(): void {
    const a = this.audio;
    if (a && !a.paused) {
      a.pause();
    }
  }
}
