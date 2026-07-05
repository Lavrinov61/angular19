import {
  Component, ChangeDetectionStrategy, input, signal, computed,
  viewChild, ElementRef, OnDestroy, inject, PLATFORM_ID
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MediaDownloadService } from '../../../features/chat-page/services/media-download.service';

@Component({
  selector: 'app-media-video-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: {
    'class': 'media-video-player',
    '[style.max-width.px]': 'maxWidth()',
  },
  template: `
    <div class="player-wrapper"
         (mouseenter)="onMouseEnter()"
         (mouseleave)="onMouseLeave()"
         (mousemove)="onMouseMove()">

      <video #videoEl
             [src]="src()"
             preload="metadata"
             (loadedmetadata)="onMetadata()"
             (timeupdate)="onTimeUpdate()"
             (ended)="onEnded()"
             (click)="togglePlay()"
             (keydown.space)="togglePlay(); $event.preventDefault()"
             (dblclick)="toggleFullscreen()"
             (waiting)="buffering.set(true)"
             (canplay)="buffering.set(false)"
             tabindex="0"
             playsinline>
      </video>

      <!-- Play overlay (shown when paused and controls hidden) -->
      @if (!playing() && !controlsVisible()) {
        <div class="play-overlay" (click)="togglePlay()" (keydown.enter)="togglePlay()" tabindex="0" role="button">
          <div class="play-overlay-circle">
            <mat-icon>play_arrow</mat-icon>
          </div>
        </div>
      }

      <!-- Buffering spinner -->
      @if (buffering()) {
        <div class="buffering-overlay">
          <mat-icon class="spin">sync</mat-icon>
        </div>
      }

      <!-- Controls bar -->
      @if (controlsVisible()) {
        <div class="controls-bar" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="-1">
          <button class="ctrl-btn" (click)="togglePlay()">
            <mat-icon>{{ playing() ? 'pause' : 'play_arrow' }}</mat-icon>
          </button>

          <div class="progress-track" #progressTrack
               (click)="seekFromClick($event)"
               (keydown.enter)="seekFromEnter($event)"
               (mousedown)="startDrag($event)"
               tabindex="0"
               role="slider"
               [attr.aria-valuenow]="progressPct()"
               aria-valuemin="0"
               aria-valuemax="100">
            <div class="progress-fill" [style.width.%]="progressPct()"></div>
            <div class="progress-thumb" [style.left.%]="progressPct()"></div>
          </div>

          <span class="time-display">{{ formatTime(currentTime()) }} / {{ formatTime(duration()) }}</span>

          <button class="ctrl-btn" (click)="toggleMute()">
            <mat-icon>{{ muted() ? 'volume_off' : 'volume_up' }}</mat-icon>
          </button>

          <button class="ctrl-btn" (click)="toggleFullscreen()">
            <mat-icon>{{ isFullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
          </button>

          <button class="ctrl-btn" (click)="download()">
            <mat-icon>download</mat-icon>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    .player-wrapper {
      position: relative;
      border-radius: var(--crm-radius-md);
      overflow: hidden;
      background: #000;
      cursor: pointer;
    }

    video {
      display: block;
      width: 100%;
      height: auto;
    }

    /* ── Play overlay ── */
    .play-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.25);
    }

    .play-overlay-circle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--crm-glass-bg);
      border: 1px solid var(--crm-glass-border);
      backdrop-filter: blur(var(--crm-glass-blur));
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform var(--crm-transition-fast), background var(--crm-transition-fast);

      mat-icon {
        color: var(--crm-accent);
        font-size: 32px;
        width: 32px;
        height: 32px;
      }

      &:hover {
        transform: scale(1.08);
        background: var(--crm-glass-bg-hover);
      }
    }

    /* ── Buffering ── */
    .buffering-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;

      .spin {
        color: var(--crm-accent);
        animation: spin-anim 1s linear infinite;
      }
    }

    @keyframes spin-anim {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* ── Controls bar ── */
    .controls-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--crm-surface-overlay);
      border-top: 1px solid var(--crm-glass-border);
      backdrop-filter: blur(var(--crm-glass-blur));
      cursor: default;
    }

    .ctrl-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      color: var(--crm-text-muted);
      cursor: pointer;
      padding: 2px;
      border-radius: 4px;
      transition: color var(--crm-transition-fast), background var(--crm-transition-fast);
      text-decoration: none;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover {
        color: var(--crm-accent);
        background: var(--crm-accent-muted);
      }
    }

    /* ── Progress bar ── */
    .progress-track {
      flex: 1;
      height: 4px;
      background: var(--crm-glass-border);
      border-radius: 2px;
      position: relative;
      cursor: pointer;
      min-width: 40px;
    }

    .progress-fill {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      background: var(--crm-accent);
      border-radius: 2px;
      pointer-events: none;
    }

    .progress-thumb {
      position: absolute;
      top: 50%;
      width: 10px;
      height: 10px;
      background: var(--crm-accent);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      opacity: 0;
      transition: opacity var(--crm-transition-fast);
    }

    .progress-track:hover .progress-thumb {
      opacity: 1;
    }

    /* ── Time display ── */
    .time-display {
      font-family: var(--crm-font-mono);
      font-size: 11px;
      color: var(--crm-text-muted);
      white-space: nowrap;
      user-select: none;
    }
  `],
})
export class MediaVideoPlayerComponent implements OnDestroy {
  readonly src = input.required<string>();
  readonly maxWidth = input(320);

  private readonly platformId = inject(PLATFORM_ID);
  private readonly downloadService = inject(MediaDownloadService);
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoEl');
  private readonly progressTrackRef = viewChild<ElementRef<HTMLDivElement>>('progressTrack');

  readonly playing = signal(false);
  readonly muted = signal(false);
  readonly buffering = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly isFullscreen = signal(false);
  readonly controlsVisible = signal(false);

  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private dragging = false;
  private readonly boundDragMove = this.onDragMove.bind(this);
  private readonly boundDragEnd = this.onDragEnd.bind(this);

  readonly progressPct = computed(() => {
    const d = this.duration();
    return d > 0 ? (this.currentTime() / d) * 100 : 0;
  });

  private get video(): HTMLVideoElement | undefined {
    return this.videoRef()?.nativeElement;
  }

  onMetadata(): void {
    const v = this.video;
    if (v) this.duration.set(v.duration);
  }

  onTimeUpdate(): void {
    const v = this.video;
    if (v) this.currentTime.set(v.currentTime);
  }

  onEnded(): void {
    this.playing.set(false);
  }

  togglePlay(): void {
    const v = this.video;
    if (!v) return;
    if (v.paused) {
      v.play();
      this.playing.set(true);
      this.showControlsTemporarily();
    } else {
      v.pause();
      this.playing.set(false);
      this.controlsVisible.set(true);
      this.clearHideTimer();
    }
  }

  toggleMute(): void {
    const v = this.video;
    if (!v) return;
    v.muted = !v.muted;
    this.muted.set(v.muted);
  }

  toggleFullscreen(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const wrapper = this.video?.parentElement;
    if (!wrapper) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
      this.isFullscreen.set(false);
    } else {
      wrapper.requestFullscreen();
      this.isFullscreen.set(true);
    }
  }

  seekFromEnter(_e: Event): void {
    this.togglePlay();
  }

  seekFromClick(e: MouseEvent): void {
    const track = this.progressTrackRef()?.nativeElement;
    const v = this.video;
    if (!track || !v) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    this.currentTime.set(v.currentTime);
  }

  startDrag(e: MouseEvent): void {
    e.preventDefault();
    this.dragging = true;
    document.addEventListener('mousemove', this.boundDragMove);
    document.addEventListener('mouseup', this.boundDragEnd);
  }

  private onDragMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const track = this.progressTrackRef()?.nativeElement;
    const v = this.video;
    if (!track || !v) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    this.currentTime.set(v.currentTime);
  }

  private onDragEnd(): void {
    this.dragging = false;
    document.removeEventListener('mousemove', this.boundDragMove);
    document.removeEventListener('mouseup', this.boundDragEnd);
  }

  onMouseEnter(): void {
    this.controlsVisible.set(true);
    this.clearHideTimer();
  }

  onMouseLeave(): void {
    if (this.playing()) {
      this.scheduleHide();
    }
  }

  onMouseMove(): void {
    this.controlsVisible.set(true);
    if (this.playing()) {
      this.clearHideTimer();
      this.scheduleHide();
    }
  }

  private showControlsTemporarily(): void {
    this.controlsVisible.set(true);
    this.scheduleHide();
  }

  private scheduleHide(): void {
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      if (this.playing()) {
        this.controlsVisible.set(false);
      }
    }, 3000);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  download(): void {
    void this.downloadService.downloadSingle(this.src(), 'video.mp4');
  }

  formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  ngOnDestroy(): void {
    this.clearHideTimer();
    this.onDragEnd();
  }
}
