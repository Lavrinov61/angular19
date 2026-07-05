import { Injectable, inject, signal, computed, effect, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { WebSocketService } from './websocket.service';

export interface StudioAlert {
  studio_id: string;
  location_code: string;
  studio_name: string;
  exception_date: string;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
  reason: string | null;
}

export interface StudioStatus {
  id: string;
  name: string;
  location_code: string;
  address: string | null;
  status: 'open' | 'closed' | 'maintenance';
  status_message: string | null;
  status_until: string | null;
}

export interface ClosureInfo {
  location_code: string;
  studio_name: string;
  address: string | null;
  reason: string | null;
  closure_dates: string[];
  reopen_date: string | null;
  status_until: string | null;
}

@Injectable({ providedIn: 'root' })
export class StudioAlertService {
  private http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ws = inject(WebSocketService);
  private lastFetchAt = 0;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private readonly REFRESH_MS = 10 * 60 * 1000;
  private readonly WAKE_THRESHOLD_MS = 5 * 60 * 1000;

  /** Per-date schedule exceptions (holidays, one-off closures) */
  readonly alerts = signal<StudioAlert[]>([]);

  /** Studio-level statuses from backend */
  readonly studios = signal<StudioStatus[]>([]);

  /** Active closures: from studio status OR per-date exceptions (deduplicated by location_code) */
  readonly activeClosures = computed<ClosureInfo[]>(() => {
    const map = new Map<string, ClosureInfo>();
    const today = this.formatDate(new Date());

    const closureDatesFor = (locationCode: string): string[] =>
      this.alerts()
        .filter(a => a.location_code === locationCode && a.is_closed && a.exception_date >= today)
        .map(a => a.exception_date)
        .sort();

    // 1. Studios with status != 'open'
    for (const s of this.studios()) {
      if (s.status !== 'open' && !this.isStatusUntilExpired(s.status_until)) {
        const dates = closureDatesFor(s.location_code);
        const reopenDate = s.status_until
          ? this.addDays(s.status_until, 1)
          : dates.length ? this.addDays(dates[dates.length - 1], 1) : null;
        map.set(s.location_code, {
          location_code: s.location_code,
          studio_name: s.name,
          address: s.address,
          reason: s.status_message,
          closure_dates: dates,
          reopen_date: reopenDate,
          status_until: s.status_until,
        });
      }
    }

    // 2. Per-date exceptions (today or future) — only if studio not already in map
    for (const a of this.alerts()) {
      if (a.is_closed && a.exception_date >= today && !map.has(a.location_code)) {
        const dates = closureDatesFor(a.location_code);
        const studio = this.studios().find(s => s.location_code === a.location_code);
        map.set(a.location_code, {
          location_code: a.location_code,
          studio_name: a.studio_name,
          address: studio?.address ?? '',
          reason: a.reason,
          closure_dates: dates,
          reopen_date: dates.length ? this.addDays(dates[dates.length - 1], 1) : null,
          status_until: null,
        });
      }
    }

    return [...map.values()];
  });

  readonly openStudios = computed<StudioStatus[]>(() => {
    const closedCodes = new Set(this.activeClosures().map(c => c.location_code));
    return this.studios().filter(s => !closedCodes.has(s.location_code));
  });

  readonly hasActiveClosures = computed(() => this.activeClosures().length > 0);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.refreshAll();

    effect(() => {
      const ev = this.ws.studioStatusChanged();
      if (ev) this.loadStudios();
    });

    this.refreshInterval = setInterval(() => this.refreshAll(), this.REFRESH_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' &&
          Date.now() - this.lastFetchAt > this.WAKE_THRESHOLD_MS) {
        this.refreshAll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    this.destroyRef.onDestroy(() => {
      if (this.refreshInterval) clearInterval(this.refreshInterval);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  private refreshAll(): void {
    this.lastFetchAt = Date.now();
    this.loadStudios();
    this.loadAlerts();
  }

  private loadStudios(): void {
    this.http.get<{ success: boolean; data: StudioStatus[] }>('/api/booking/studios')
      .pipe(catchError(() => of({ success: true, data: [] as StudioStatus[] })))
      .subscribe(res => {
        if (res.success) this.studios.set(res.data);
      });
  }

  private loadAlerts(): void {
    this.http.get<{ success: boolean; data: StudioAlert[] }>('/api/booking/alerts')
      .pipe(catchError(() => of({ success: true, data: [] as StudioAlert[] })))
      .subscribe(res => {
        if (res.success) this.alerts.set(res.data);
      });
  }

  /** Check if studio is globally closed (status != 'open') */
  isStudioClosed(locationCode: string): boolean {
    const studio = this.studios().find(s => s.location_code === locationCode);
    if (!studio || studio.status === 'open') return false;
    return !this.isStatusUntilExpired(studio.status_until);
  }

  /** Check if studio is closed on a specific date (either globally or per-date exception) */
  isStudioClosedOnDate(locationCode: string, date: Date): boolean {
    const studio = this.studios().find(s => s.location_code === locationCode);
    const dateStr = this.formatDate(date);
    if (studio && studio.status !== 'open') {
      const statusUntilDate = studio.status_until
        ? (studio.status_until.includes('T') ? this.formatDate(new Date(studio.status_until)) : studio.status_until)
        : null;
      if (!statusUntilDate || dateStr <= statusUntilDate) return true;
    }
    return this.alerts().some(a =>
      a.location_code === locationCode &&
      a.is_closed &&
      a.exception_date === dateStr
    );
  }

  /** Get closure info for a studio (global status or upcoming exception) */
  getClosureForStudio(locationCode: string): ClosureInfo | null {
    const today = this.formatDate(new Date());
    const closureDates = this.alerts()
      .filter(a => a.location_code === locationCode && a.is_closed && a.exception_date >= today)
      .map(a => a.exception_date)
      .sort();
    const reopenDate = closureDates.length ? this.addDays(closureDates[closureDates.length - 1], 1) : null;

    const studio = this.studios().find(s => s.location_code === locationCode);
    if (studio && studio.status !== 'open' && !this.isStatusUntilExpired(studio.status_until)) {
      const studioReopen = studio.status_until
        ? this.addDays(studio.status_until, 1)
        : reopenDate;
      return {
        location_code: studio.location_code,
        studio_name: studio.name,
        address: studio.address,
        reason: studio.status_message,
        closure_dates: closureDates,
        reopen_date: studioReopen,
        status_until: studio.status_until,
      };
    }
    const alert = this.alerts().find(a =>
      a.location_code === locationCode &&
      a.is_closed &&
      a.exception_date >= today
    );
    if (!alert) return null;
    return {
      location_code: alert.location_code,
      studio_name: alert.studio_name,
      address: studio?.address ?? '',
      reason: alert.reason,
      closure_dates: closureDates,
      reopen_date: reopenDate,
      status_until: null,
    };
  }

  getStudioStatus(locationCode: string): StudioStatus | null {
    return this.studios().find(s => s.location_code === locationCode) ?? null;
  }

  private isStatusUntilExpired(statusUntil: string | null): boolean {
    if (!statusUntil) return false;
    const dateOnly = statusUntil.includes('T') ? this.formatDate(new Date(statusUntil)) : statusUntil;
    return dateOnly < this.formatDate(new Date());
  }

  private addDays(dateStr: string | Date, days: number): string {
    let d: Date;
    if (dateStr instanceof Date) {
      d = new Date(dateStr.getTime());
    } else {
      d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
    }
    d.setDate(d.getDate() + days);
    return this.formatDate(d);
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
