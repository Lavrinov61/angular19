import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { WHATSAPP_UNAVAILABLE_NOTICE } from '../data/contacts.data';

interface ChannelStatusResponse {
  whatsapp?: { available?: boolean; checkedAt?: string };
}

/**
 * Live availability of external messenger channels (currently WhatsApp/Gupshup).
 *
 * Drives the public "WhatsApp временно не работает" banner. Optimistic by default
 * (available = true → no banner): if the status endpoint is slow, errors, or we
 * are rendering on the server, we never show a false alarm. The banner appears
 * only once the backend confirms the channel is actually down.
 *
 * Backend probe is cached (Redis 5 min), so this single fetch on app start is cheap.
 */
@Injectable({ providedIn: 'root' })
export class ChannelStatusService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _whatsappAvailable = signal(true);
  readonly whatsappAvailable = this._whatsappAvailable.asReadonly();

  /** Notice text to show, or undefined when WhatsApp is available. */
  readonly whatsappNotice = computed(() =>
    this._whatsappAvailable() ? undefined : WHATSAPP_UNAVAILABLE_NOTICE,
  );

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.refresh();
    }
  }

  /** Fetch current channel availability from the backend. */
  refresh(): void {
    this.http.get<ChannelStatusResponse>('/api/channel-status').subscribe({
      next: (res) => this._whatsappAvailable.set(res?.whatsapp?.available ?? true),
      error: () => {
        // Fail-open: keep the optimistic default, do not surface a false banner.
      },
    });
  }
}
