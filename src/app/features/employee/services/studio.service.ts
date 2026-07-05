import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WebSocketService } from '../../../core/services/websocket.service';

export interface Studio {
  readonly id: string;
  readonly name: string;
  readonly address: string;
}

@Injectable({ providedIn: 'root' })
export class StudioService {
  private readonly http = inject(HttpClient);
  private readonly ws = inject(WebSocketService);

  readonly studios = signal<readonly Studio[]>([]);
  readonly loading = signal(false);
  private loaded = false;

  /** First studio as default selection */
  readonly defaultStudioId = computed(() => this.studios()[0]?.id ?? '');

  constructor() {
    effect(() => {
      if (this.ws.studioStatusChanged()) {
        this.loaded = false;
        this.load();
      }
    });
  }

  load(): void {
    if (this.loaded || this.loading()) return;
    this.loading.set(true);

    this.http.get<{ studios: Studio[] }>('/api/crm-booking/studios').subscribe({
      next: (res) => {
        if (Array.isArray(res.studios)) {
          this.studios.set(res.studios);
        }
        this.loading.set(false);
        this.loaded = true;
      },
      error: () => {
        this.loading.set(false);
        this.loaded = true;
      },
    });
  }

  studioName(id: string): string {
    return this.studios().find(s => s.id === id)?.name ?? id;
  }
}
