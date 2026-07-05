import { Injectable, inject, signal, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WebSocketService } from '../../../../../core/services/websocket.service';

const DEDUP_WINDOW_MS = 30_000;
const DEDUP_CLEANUP_MS = 60_000;

/**
 * Счётчик активных алертов для бейджа в меню + toast policy по severity.
 * Toast policy:
 *   critical — всегда: toast error + «Открыть» → навигация к деталям.
 *   warn     — только если пользователь на /employee/fleet: toast warning.
 *   info     — silent.
 * Dedup: alertId в окне 30s; очистка ключей старше 60s перед каждой проверкой.
 */
@Injectable({ providedIn: 'root' })
export class FleetAlertsService {
  private readonly ws = inject(WebSocketService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  readonly activeAlertsDelta = signal(0);

  private readonly dedupMap = new Map<string, number>();

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    effect(() => {
      const ev = this.ws.printerAlertRaised();
      if (!ev) return;
      this.activeAlertsDelta.update(n => n + 1);
      if (this.isDuplicate(ev.alertId)) return;
      this.applyPolicy(ev);
    });

    effect(() => {
      const ev = this.ws.printerAlertResolved();
      if (!ev) return;
      this.activeAlertsDelta.update(n => Math.max(0, n - 1));
    });
  }

  private isDuplicate(alertId: string): boolean {
    const now = Date.now();
    for (const [k, ts] of this.dedupMap) {
      if (now - ts > DEDUP_CLEANUP_MS) this.dedupMap.delete(k);
    }
    const last = this.dedupMap.get(alertId);
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) return true;
    this.dedupMap.set(alertId, now);
    return false;
  }

  private applyPolicy(ev: { alertId: string; printerId: string; printerName: string; alertType: string; severity: 'critical' | 'warn' | 'info'; message: string | null }): void {
    if (ev.severity === 'info') return;

    const summary = ev.message ? `${ev.printerName}: ${ev.alertType} (${ev.message})` : `${ev.printerName}: ${ev.alertType}`;

    if (ev.severity === 'critical') {
      const ref = this.snackBar.open(`❌ ${summary}`, 'Открыть', {
        duration: 6000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['toast-error'],
      });
      ref.onAction().subscribe(() => {
        this.router.navigate(['/employee/fleet', ev.printerId, 'alerts']);
      });
      return;
    }

    // warn: только если пользователь уже на /employee/fleet
    if (this.router.url.startsWith('/employee/fleet')) {
      this.snackBar.open(`⚠️ ${summary}`, 'OK', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['toast-warning'],
      });
    }
  }
}
