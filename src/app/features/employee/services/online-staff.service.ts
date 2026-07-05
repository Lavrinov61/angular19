import { Injectable, inject, signal, effect, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { WebSocketService } from '../../../core/services/websocket.service';

export interface OnlineStaffMember {
  id: string;
  display_name: string;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class OnlineStaffService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ws = inject(WebSocketService);

  private readonly _staff = signal<OnlineStaffMember[]>([]);
  readonly staff = this._staff.asReadonly();

  private initialized = false;
  // Failsafe polling — каждые 10 мин (вместо 2 мин, primary = WS events)
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private loadDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  init(): void {
    if (this.initialized || !isPlatformBrowser(this.platformId)) return;
    this.initialized = true;

    // Initial load
    this.load();

    // Обновляем список при изменении online/offline через WebSocket (с debounce 300ms)
    effect(() => {
      const onlineUsers = this.ws.onlineUsers();
      if (onlineUsers.size > 0) {
        if (this.loadDebounceTimer) clearTimeout(this.loadDebounceTimer);
        this.loadDebounceTimer = setTimeout(() => {
          this.loadDebounceTimer = null;
          this.load();
        }, 300);
      }
    });

    // Failsafe: редкое polling как страховка
    this.intervalId = setInterval(() => this.load(), 10 * 60_000); // 10 min

    this.destroyRef.onDestroy(() => {
      if (this.intervalId) clearInterval(this.intervalId);
      if (this.loadDebounceTimer) clearTimeout(this.loadDebounceTimer);
      this.initialized = false;
    });
  }

  private load(): void {
    this.http.get<{ success: boolean; data: OnlineStaffMember[] }>('/api/crm/staff/online').subscribe({
      next: (res) => {
        if (res.success) this._staff.set(res.data);
      },
    });
  }
}
