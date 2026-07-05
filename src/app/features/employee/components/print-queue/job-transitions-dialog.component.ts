import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DatePipe } from '@angular/common';
import { PrintApiService, StateTransition } from '../../services/print-api.service';

@Component({
  selector: 'app-job-transitions-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, DatePipe],
  template: `
    <h2 mat-dialog-title>История: {{ data.fileName }}</h2>
    <mat-dialog-content>
      @if (loading()) {
        <div class="loading-center">
          <mat-spinner diameter="32"></mat-spinner>
        </div>
      } @else if (!transitions().length) {
        <div class="empty">Нет переходов</div>
      } @else {
        <div class="timeline">
          @for (t of transitions(); track t.id) {
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div class="timeline-line"></div>
              <div class="timeline-content">
                <div class="transition-row">
                  <span class="status-from">{{ t.from_status || 'new' }}</span>
                  <mat-icon class="arrow-icon">arrow_forward</mat-icon>
                  <span class="status-to">{{ t.to_status }}</span>
                  <mat-icon class="actor-icon">{{ actorIcon(t.actor_type) }}</mat-icon>
                  <span class="transition-time">{{ t.created_at | date:'dd.MM HH:mm' }}</span>
                </div>
                @if (t.reason) {
                  <div class="transition-reason">{{ t.reason }}</div>
                }
              </div>
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Закрыть</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .loading-center { display: flex; justify-content: center; padding: 24px; }
    .empty { text-align: center; color: var(--mat-sys-outline); padding: 24px; font-size: 14px; }
    .timeline { padding: 4px 0; }
    .timeline-item {
      position: relative; padding-left: 28px; padding-bottom: 16px;
    }
    .timeline-item:last-child { padding-bottom: 0; }
    .timeline-item:last-child .timeline-line { display: none; }
    .timeline-dot {
      position: absolute; left: 0; top: 4px; width: 12px; height: 12px;
      border-radius: 50%; background: var(--mat-sys-primary);
    }
    .timeline-line {
      position: absolute; left: 5px; top: 18px; bottom: 0; width: 2px;
      background: var(--mat-sys-outline-variant);
    }
    .timeline-content { min-width: 0; }
    .transition-row {
      display: flex; align-items: center; gap: 6px; font-size: 13px; flex-wrap: wrap;
    }
    .status-from { color: var(--mat-sys-on-surface-variant); }
    .status-to { font-weight: 600; color: var(--mat-sys-on-surface); }
    .arrow-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-outline); }
    .actor-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-on-surface-variant); margin-left: auto; }
    .transition-time { font-size: 12px; color: var(--mat-sys-outline); }
    .transition-reason { font-size: 12px; color: var(--mat-sys-on-surface-variant); margin-top: 2px; }
  `],
})
export class JobTransitionsDialogComponent {
  readonly data = inject<{ jobId: string; fileName: string }>(MAT_DIALOG_DATA);
  private readonly printApi = inject(PrintApiService);

  readonly transitions = signal<StateTransition[]>([]);
  readonly loading = signal(true);

  constructor() {
    this.printApi.getJobTransitions(this.data.jobId).subscribe({
      next: t => { this.transitions.set(t); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  actorIcon(actorType: string): string {
    switch (actorType) {
      case 'user': return 'person';
      case 'agent': return 'smart_toy';
      case 'scheduler': return 'schedule';
      case 'system': return 'settings';
      default: return 'help';
    }
  }
}
