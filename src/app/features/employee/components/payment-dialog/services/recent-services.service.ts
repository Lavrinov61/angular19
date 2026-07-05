import { Injectable, signal, computed } from '@angular/core';
import type { RecentService, UiServiceOption } from '../models/payment-dialog.models';

const STORAGE_KEY = 'pd_recent_services';
const MAX_RECENT = 5;

/**
 * Tracks recently used services in localStorage (LRU, max 5).
 * NOT providedIn: 'root' — scoped to the dialog.
 */
@Injectable()
export class RecentServicesService {

  readonly items = signal<readonly RecentService[]>(this.load());
  readonly hasRecent = computed(() => this.items().length > 0);
  readonly topRecent = computed(() => this.items().slice(0, MAX_RECENT));

  /** Add a service to recent history (LRU — moves to front, deduplicates) */
  track(service: UiServiceOption, categoryName: string): void {
    const entry: RecentService = {
      id: service.id,
      slug: service.slug,
      name: service.name,
      icon: service.icon,
      price: service.price,
      categoryName,
    };

    const current = this.items().filter(r => r.id !== service.id);
    const updated = [entry, ...current].slice(0, MAX_RECENT);
    this.items.set(updated);
    this.save(updated);
  }

  private load(): readonly RecentService[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return (parsed as RecentService[]).slice(0, MAX_RECENT);
    } catch {
      return [];
    }
  }

  private save(items: readonly RecentService[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // localStorage might be full or disabled — silently ignore
    }
  }
}
