import { Injectable, signal, inject, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class DeadlineTimerService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  readonly now = signal(Date.now());

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const timer = setInterval(() => this.now.set(Date.now()), 10_000);
      this.destroyRef.onDestroy(() => clearInterval(timer));
    }
  }

  remaining(deadline: string | null | undefined): number {
    if (!deadline) return 0;
    return new Date(deadline).getTime() - this.now();
  }

  isOverdue(deadline: string | null | undefined): boolean {
    if (!deadline) return false;
    return new Date(deadline).getTime() < this.now();
  }

  isWarning(deadline: string | null | undefined): boolean {
    const r = this.remaining(deadline);
    return r > 0 && r < 30 * 60 * 1000;
  }

  deadlineClass(deadline: string | null | undefined): string {
    if (this.isOverdue(deadline)) return 'overdue';
    if (this.isWarning(deadline)) return 'warning';
    return '';
  }

  formatCompact(deadline: string | null | undefined): string {
    if (!deadline) return '\u2014';
    const diff = this.remaining(deadline);
    const abs = Math.abs(diff);
    const prefix = diff < 0 ? '-' : '';
    const d = Math.floor(abs / 86400000);
    const h = Math.floor((abs % 86400000) / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    // \u041E\u0442 \u0441\u0443\u0442\u043E\u043A \u0438 \u0431\u043E\u043B\u044C\u0448\u0435 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u043C \u0434\u043D\u0438+\u0447\u0430\u0441\u044B (\u0438\u043D\u0430\u0447\u0435 \u0432\u044B\u0445\u043E\u0434\u0438\u0442 \u0430\u0431\u0441\u0443\u0440\u0434 \u0432\u0440\u043E\u0434\u0435 \u00AB-483\u044716\u043C\u00BB).
    if (d > 0) return `${prefix}${d}\u0434${h}\u0447`;
    if (h > 0) return `${prefix}${h}\u0447${String(m).padStart(2, '0')}\u043C`;
    return `${prefix}${m}\u043C`;
  }

  formatDetailed(deadline: string | null | undefined): string {
    if (!deadline) return '\u2014';
    const diff = this.remaining(deadline);
    const abs = Math.abs(diff);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    const s = Math.floor((abs % 60000) / 1000);
    if (h > 0) return `${h}\u0447 ${String(m).padStart(2, '0')}\u043C`;
    if (m > 0) return `${m}\u043C ${String(s).padStart(2, '0')}\u0441`;
    return `${s}\u0441`;
  }

  formatHuman(deadline: string | null | undefined): string {
    if (!deadline) return '\u2014';
    const diff = this.remaining(deadline);
    const abs = Math.abs(diff);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);

    if (diff < 0) {
      if (h > 0) return `\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E ${h} \u0447 ${m} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`;
      return `\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E ${m} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`;
    }
    if (h > 0) return `${h} \u0447 ${m} \u043C\u0438\u043D`;
    return `${m} \u043C\u0438\u043D`;
  }
}
