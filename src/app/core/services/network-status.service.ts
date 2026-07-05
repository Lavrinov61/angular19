import { Injectable, inject, PLATFORM_ID, signal, computed, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { OfflineQueueService } from './offline-queue.service';
import { WebSocketService } from './websocket.service';
import { AuthChatService } from './auth-chat.service';

export type BannerType = 'offline' | 'reconnecting' | 'back-online' | 'syncing' | 'slow' | 'update';

interface NetworkInfoConnection {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly wsService = inject(WebSocketService);
  private readonly visitorChat = inject(AuthChatService);

  private readonly _backOnline = signal(false);
  private readonly _isSlowConnection = signal(false);
  private readonly _slowDismissed = signal(false);
  private _wasOffline = false;
  private _backOnlineTimer: ReturnType<typeof setTimeout> | null = null;

  // Exposed queue stats for banner/indicator
  readonly pendingCount = this.offlineQueue.pendingCount;
  readonly failedCount = this.offlineQueue.failedCount;
  readonly syncStatus = this.offlineQueue.syncStatus;
  readonly updateAvailable = computed(() =>
    this.visitorChat.updateAvailable() ?? this.wsService.updateAvailable()
  );

  /**
   * Priority: offline > reconnecting > back-online > syncing > slow > update
   */
  readonly activeBanner = computed<BannerType | null>(() => {
    if (this.offlineQueue.isNetworkOffline()) return 'offline';
    if (this.wsService.isReconnecting()) return 'reconnecting';
    if (this._backOnline()) return 'back-online';
    if (this.offlineQueue.syncStatus() === 'syncing') return 'syncing';
    if (this._isSlowConnection() && !this._slowDismissed()) return 'slow';
    if (this.updateAvailable() !== null) return 'update';
    return null;
  });

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    // Track offline→online transitions for "back-online" banner (auto-dismiss 3s)
    effect(() => {
      const offline = this.offlineQueue.isNetworkOffline();
      if (offline) {
        this._wasOffline = true;
        this._backOnline.set(false);
        if (this._backOnlineTimer) {
          clearTimeout(this._backOnlineTimer);
          this._backOnlineTimer = null;
        }
      } else if (this._wasOffline) {
        this._wasOffline = false;
        this._backOnline.set(true);
        this._backOnlineTimer = setTimeout(() => {
          this._backOnline.set(false);
          this._backOnlineTimer = null;
        }, 3000);
      }
    });

    this.initConnectionQuality();
  }

  dismissSlowBanner(): void {
    this._slowDismissed.set(true);
  }

  dismissUpdate(): void {
    this.visitorChat.clearUpdate();
    this.wsService.updateAvailable.set(null);
  }

  reloadForUpdate(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const latestVersion = this.updateAvailable()?.latestVersion;
    if (latestVersion) {
      try { sessionStorage.setItem(`update-dismissed-${latestVersion}`, '1'); } catch { /* noop */ }
    }
    window.location.reload();
  }

  private initConnectionQuality(): void {
    const nav = navigator as Navigator & { connection?: NetworkInfoConnection };
    const conn = nav.connection;
    if (!conn) return;

    const checkSlow = () => {
      const slow =
        conn.effectiveType === '2g' ||
        conn.effectiveType === 'slow-2g' ||
        (conn.rtt != null && conn.rtt > 2000);
      this._isSlowConnection.set(slow);
    };
    checkSlow();
    conn.addEventListener('change', checkSlow);
  }
}
