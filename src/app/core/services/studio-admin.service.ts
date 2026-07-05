import { Injectable, inject, signal, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { WebSocketService } from './websocket.service';
import { StudioStatus } from './studio-alert.service';

export type StudioStatusValue = 'open' | 'closed' | 'maintenance';

export interface StudioStatusUpdate {
  status: StudioStatusValue;
  status_message?: string | null;
  status_until?: string | null;
}

@Injectable({ providedIn: 'root' })
export class StudioAdminService {
  private readonly http = inject(HttpClient);
  private readonly ws = inject(WebSocketService);

  readonly studios = signal<StudioStatus[]>([]);
  readonly loading = signal(false);

  constructor() {
    effect(() => {
      const ev = this.ws.studioStatusChanged();
      if (ev) this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; data: StudioStatus[] }>('/api/studios/admin')
      .subscribe({
        next: (res) => {
          if (res.success) this.studios.set(res.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  updateStatus(id: string, payload: StudioStatusUpdate): Observable<StudioStatus> {
    return this.http.put<{ success: boolean; data: StudioStatus }>(`/api/studios/${id}`, payload)
      .pipe(
        tap((res) => {
          if (res.success) {
            this.studios.update(list => list.map(s => s.id === id ? { ...s, ...res.data } : s));
          }
        }),
        map(res => res.data),
      );
  }

  reopen(id: string): Observable<StudioStatus> {
    return this.updateStatus(id, { status: 'open', status_message: null, status_until: null });
  }
}
