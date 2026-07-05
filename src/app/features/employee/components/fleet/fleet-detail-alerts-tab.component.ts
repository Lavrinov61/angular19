import { Component, ChangeDetectionStrategy, inject, computed, signal, effect, DestroyRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FleetDetailStateService } from './services/fleet-detail-state.service';
import { FleetApiService } from './services/fleet-api.service';
import { FleetAlert } from './models/fleet.models';

@Component({
  selector: 'app-fleet-detail-alerts-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <section class="card">
      <header class="card-head">
        <h3>Активные алерты</h3>
        <span class="count">{{ alerts().length }}</span>
      </header>
      @if (alerts().length === 0) {
        <p class="empty">Алертов нет.</p>
      } @else {
        <ul class="alert-list">
          @for (a of alerts(); track a.id) {
            <li class="alert" [attr.data-severity]="a.severity">
              <div class="alert-dot"></div>
              <div class="alert-body">
                <div class="alert-head">
                  <span class="alert-type">{{ a.alert_type }}</span>
                  <span class="alert-sev">{{ severityLabel(a.severity) }}</span>
                </div>
                @if (a.message) {
                  <div class="alert-msg">{{ a.message }}</div>
                }
                <div class="alert-time">С {{ a.first_seen_at | date:'dd MMM HH:mm' }}</div>
              </div>
            </li>
          }
        </ul>
      }
    </section>

    <section class="card card--muted">
      <header class="card-head">
        <h3>История разрешённых</h3>
        <div class="head-actions">
          <span class="count">{{ resolvedAlerts().length }}</span>
          <button type="button" class="refresh-btn" (click)="reloadResolvedAlerts()" [disabled]="resolvedLoading()">
            Обновить
          </button>
        </div>
      </header>
      @if (resolvedLoading()) {
        <p class="empty">Загружаем историю...</p>
      } @else if (resolvedError()) {
        <p class="empty empty--error">{{ resolvedError() }}</p>
      } @else if (resolvedAlerts().length === 0) {
        <p class="empty">За последние 90 дней разрешённых алертов нет.</p>
      } @else {
        <ul class="alert-list">
          @for (a of resolvedAlerts(); track a.id) {
            <li class="alert alert--resolved" [attr.data-severity]="a.severity">
              <div class="alert-dot"></div>
              <div class="alert-body">
                <div class="alert-head">
                  <span class="alert-type">{{ a.alert_type }}</span>
                  <span class="alert-sev">{{ severityLabel(a.severity) }}</span>
                </div>
                @if (a.message) {
                  <div class="alert-msg">{{ a.message }}</div>
                }
                <div class="alert-time">
                  С {{ a.first_seen_at | date:'dd MMM HH:mm' }}
                  @if (a.resolved_at) {
                    <span> · решён {{ a.resolved_at | date:'dd MMM HH:mm' }}</span>
                  }
                  @if (a.resolve_reason) {
                    <span> · {{ resolveReasonLabel(a.resolve_reason) }}</span>
                  }
                </div>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    :host { display: block; display: grid; gap: 16px; }
    .card { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 16px 20px; }
    .card--muted { background: #fafafa; }
    .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .card-head h3 {
      margin: 0;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      font-weight: 700;
    }
    .count {
      font-size: 12px; font-weight: 700; padding: 2px 8px;
      background: rgba(0,0,0,0.06); border-radius: 999px;
    }
    .head-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .refresh-btn {
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 6px;
      background: #fff;
      color: #374151;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .refresh-btn:hover:not(:disabled) {
      border-color: rgba(0,0,0,0.24);
      background: #f9fafb;
    }
    .refresh-btn:disabled {
      opacity: 0.5;
      cursor: wait;
    }

    .alert-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .alert { display: flex; gap: 12px; padding: 12px; border-radius: 8px; background: #fafafa; }
    .alert[data-severity='critical'] { background: rgba(239, 68, 68, 0.06); }
    .alert[data-severity='warn']     { background: rgba(234, 179, 8, 0.06); }
    .alert[data-severity='info']     { background: rgba(59, 130, 246, 0.05); }
    .alert-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
    .alert[data-severity='critical'] .alert-dot { background: #ef4444; }
    .alert[data-severity='warn']     .alert-dot { background: #eab308; }
    .alert[data-severity='info']     .alert-dot { background: #3b82f6; }
    .alert-body { flex: 1; min-width: 0; }
    .alert-head { display: flex; gap: 8px; align-items: baseline; }
    .alert-type { font-weight: 700; font-size: 13px; }
    .alert-sev {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
    }
    .alert[data-severity='critical'] .alert-sev { color: #b91c1c; }
    .alert[data-severity='warn']     .alert-sev { color: #a16207; }
    .alert[data-severity='info']     .alert-sev { color: #1d4ed8; }
    .alert-msg { font-size: 13px; color: #374151; margin-top: 2px; }
    .alert-time { font-size: 11px; color: #9ca3af; margin-top: 4px; }
    .alert--resolved { opacity: 0.86; }
    .alert--resolved .alert-dot { background: #9ca3af !important; }
    .empty { margin: 0; padding: 8px 0; color: #9ca3af; font-style: italic; font-size: 13px; }
    .empty--error { color: #b91c1c; }
  `]
})
export class FleetDetailAlertsTabComponent {
  private readonly state = inject(FleetDetailStateService);
  private readonly api = inject(FleetApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly alerts = computed(() => this.state.detail()?.active_alerts ?? []);
  readonly resolvedAlerts = signal<FleetAlert[]>([]);
  readonly resolvedLoading = signal(false);
  readonly resolvedError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const printerId = this.state.printerId();
      if (!printerId) return;
      this.loadResolvedAlerts(printerId);
    });
  }

  severityLabel(s: string): string {
    switch (s) {
      case 'critical': return 'критич.';
      case 'warn':     return 'внимание';
      case 'info':     return 'инфо';
      default:         return s;
    }
  }

  resolveReasonLabel(reason: string): string {
    switch (reason) {
      case 'supply_replaced': return 'замена расходника';
      case 'auto_resolved': return 'авто';
      case 'manual': return 'вручную';
      default: return reason;
    }
  }

  reloadResolvedAlerts(): void {
    const printerId = this.state.printerId();
    if (!printerId) return;
    this.loadResolvedAlerts(printerId);
  }

  private loadResolvedAlerts(printerId: string): void {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    this.resolvedLoading.set(true);
    this.resolvedError.set(null);

    this.api.getAlerts(printerId, { active: 'false', since })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (alerts) => {
          this.resolvedAlerts.set(alerts);
          this.resolvedLoading.set(false);
        },
        error: (err) => {
          this.resolvedError.set(err?.error?.message ?? err?.message ?? 'Не удалось загрузить историю.');
          this.resolvedLoading.set(false);
        },
      });
  }
}
