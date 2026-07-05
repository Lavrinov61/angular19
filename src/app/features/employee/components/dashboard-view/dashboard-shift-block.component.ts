import { Component, DestroyRef, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService, type UserProfile } from '../../../../core/services/auth.service';
import { DashboardDataService } from '../../services/dashboard-data.service';
import type { WorkdayShift } from '../../services/tasks-api.service';
import {
  WorkdayWelcomeDialogComponent,
  type WorkdayWelcomeDialogData,
  type WorkdayWelcomeDialogResult,
} from '../workday-welcome-dialog/workday-welcome-dialog.component';

@Component({
  selector: 'app-dashboard-shift-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    @if (dashData.workday(); as w) {
      @if (w.shift) {
        <div
          class="shift-strip"
          [class.active]="w.shift.status === 'active'"
          [class.virtual]="w.shift.is_virtual || w.shift.shift_kind === 'virtual'"
        >
          <span class="status-dot" [class.active]="w.shift.status === 'active'"></span>
          <span class="strip-label">
            {{ w.shift.status === 'active' ? 'Рабочий день активен' : 'Рабочий день не начат' }}
          </span>
          <span class="strip-studio">
            <mat-icon>{{ w.shift.is_virtual || w.shift.shift_kind === 'virtual' ? 'desktop_windows' : 'store' }}</mat-icon>
            {{ shiftLocationLabel(w.shift) }}
          </span>
          <div class="strip-pills">
            <span class="pill">{{ w.summary.total }} задач</span>
            @if (w.summary.urgent) {
              <span class="pill urgent">{{ w.summary.urgent }} срочных</span>
            }
            @if (w.summary.overdue) {
              <span class="pill overdue">{{ w.summary.overdue }} просрочено</span>
            }
            @if (w.summary.completed_today) {
              <span class="pill done">{{ w.summary.completed_today }} сделано</span>
            }
          </div>
          @if (dashData.shiftCommission(); as comm) {
            <span class="pill commission">
              <mat-icon>payments</mat-icon>
              {{ comm.todayCommission }} \u20BD
            </span>
          }
          @if (w.shift.online_count > 0) {
            <span class="pill online-earnings">
              <mat-icon>language</mat-icon>
              {{ w.shift.online_count }} онлайн · {{ w.shift.online_earnings }} \u20BD
            </span>
          }
          @if (w.ai_briefing) {
            <button class="ai-btn" [matTooltip]="w.ai_briefing">
              <mat-icon>smart_toy</mat-icon>
            </button>
          }
          <button
            mat-stroked-button
            type="button"
            class="shift-btn schedule"
            matTooltip="Открыть график работы"
            [disabled]="workdayDialogOpen()"
            (click)="openWorkdayDialog()"
          >
            <mat-icon>edit_calendar</mat-icon>
            График работы
          </button>
          @if (w.shift.status === 'active') {
            <button mat-flat-button type="button" class="shift-btn end" (click)="endShift(w.shift)">
              <mat-icon>logout</mat-icon>
              Завершить день
            </button>
          } @else {
            <button mat-flat-button type="button" class="shift-btn start" (click)="openWorkdayDialog()">
              <mat-icon>play_arrow</mat-icon>
              Начать рабочий день
            </button>
          }
        </div>
      } @else {
        <div class="shift-strip no-shift">
          <mat-icon>schedule</mat-icon>
          <span>Рабочий день не начат</span>
          <button
            mat-flat-button
            class="shift-btn workday-start"
            type="button"
            (click)="openWorkdayDialog()"
            [disabled]="dashData.startingWorkday() || workdayDialogOpen()"
          >
            <mat-icon>play_arrow</mat-icon>
            Начать рабочий день
          </button>
        </div>
      }
    }
  `,
  styles: [`
    .shift-strip {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
      min-height: 52px;

      &.active {
        border-color: rgba(52, 211, 153, 0.3);
        background: linear-gradient(135deg, rgba(52, 211, 153, 0.06) 0%, var(--crm-gradient-card));
      }

      &.virtual {
        border-color: rgba(96, 165, 250, 0.32);
        background: linear-gradient(135deg, rgba(96, 165, 250, 0.07) 0%, var(--crm-gradient-card));
      }

      &.no-shift {
        color: var(--crm-text-muted);
        font-size: 12px;
        gap: 6px;
        min-height: 40px;
        padding: 8px 14px;

        mat-icon { font-size: 16px; width: 16px; height: 16px; opacity: 0.5; }
      }
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crm-border);
      flex-shrink: 0;

      &.active {
        background: var(--crm-status-success);
        box-shadow: 0 0 6px rgba(52, 211, 153, 0.6);
        animation: statusPulse 2s ease-in-out infinite;
      }
    }

    @keyframes statusPulse {
      0%, 100% { box-shadow: 0 0 6px rgba(52, 211, 153, 0.6); }
      50% { box-shadow: 0 0 10px rgba(52, 211, 153, 0.8); }
    }

    .strip-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary);
      white-space: nowrap;
    }

    .strip-studio {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      color: var(--crm-text-muted);
      white-space: nowrap;

      mat-icon { font-size: 13px; width: 13px; height: 13px; }
    }

    .strip-pills {
      display: flex;
      gap: 6px;
      flex: 1;
      min-width: 0;
      flex-wrap: wrap;
    }

    .pill {
      font-size: 11px;
      font-weight: 500;
      color: var(--crm-text-muted);
      white-space: nowrap;

      &.urgent { color: var(--crm-status-error); }
      &.overdue { color: var(--crm-status-warning); }
      &.done { color: var(--crm-status-success); }
      &.commission {
        display: flex;
        align-items: center;
        gap: 2px;
        color: var(--crm-status-success);
        font-weight: 600;
        mat-icon { font-size: 12px; width: 12px; height: 12px; }
      }
      &.online-earnings {
        display: flex;
        align-items: center;
        gap: 2px;
        color: var(--crm-accent, #f59e0b);
        font-weight: 500;
        mat-icon { font-size: 12px; width: 12px; height: 12px; }
      }
    }

    .ai-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: var(--crm-radius-sm);
      background: rgba(245, 158, 11, 0.08);
      cursor: pointer;
      flex-shrink: 0;
      transition: background var(--crm-transition-fast);

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-accent); }

      &:hover { background: rgba(245, 158, 11, 0.15); }
    }

    .shift-btn {
      font-size: 11px;
      height: 28px;
      padding: 0 10px;
      flex-shrink: 0;

      mat-icon { font-size: 14px; width: 14px; height: 14px; margin-right: 3px; }

      &.start { background: var(--crm-status-success); color: #fff; }
      &.schedule {
        color: var(--crm-text-secondary);
        border-color: rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.22);
      }
      &.end {
        color: #fecaca;
        background: rgba(239, 68, 68, 0.16);
        border: 1px solid rgba(248, 113, 113, 0.42);
        box-shadow: inset 0 0 0 1px rgba(127, 29, 29, 0.18);
      }
      &.workday-start {
        margin-left: auto;
        height: 34px;
        padding: 0 14px;
        background: var(--crm-accent, #f59e0b);
        color: #111827;
        box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.24), 0 10px 28px rgba(245, 158, 11, 0.18);
      }
    }

    @media (max-width: 840px) {
      .shift-strip { flex-wrap: wrap; gap: 6px; }
      .strip-pills { flex-basis: 100%; }
    }
  `],
})
export class DashboardShiftBlockComponent {
  readonly dashData = inject(DashboardDataService);
  private readonly dialog = inject(MatDialog);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  briefingExpanded = false;
  readonly workdayDialogOpen = signal(false);

  endShift(shift: WorkdayShift): void {
    this.dashData.requestCheckOut(shift);
  }

  shiftLocationLabel(shift: WorkdayShift): string {
    if (shift.is_virtual || shift.shift_kind === 'virtual') return 'Пульт';
    return this.compactAddress(shift.studio_address ?? null)
      || this.locationAddress(shift.location_code ?? null)
      || this.stripStudioBrand(shift.studio_name ?? '')
      || 'Адрес смены';
  }

  private locationAddress(locationCode: string | null): string {
    switch (locationCode) {
      case 'barrikadnaya-4':
        return '2-ая Баррикадная 4';
      case 'soborny':
      case 'soborny-21':
        return 'Соборный 21';
      default:
        return '';
    }
  }

  private compactAddress(address: string | null): string {
    if (!address) return '';
    return address
      .split(',')[0]
      ?.trim()
      .replace(/^(ул\.?|улица|пер\.?|переулок)\s+/i, '')
      .trim() ?? '';
  }

  private stripStudioBrand(name: string): string {
    return name
      .replace(/^\s*сво[ёе]\s*фото\s*[—–-]?\s*/i, '')
      .trim();
  }

  openWorkdayDialog(): void {
    if (this.workdayDialogOpen()) return;

    this.workdayDialogOpen.set(true);
    const user = this.authService.currentUser();
    const dialogRef = this.dialog.open<WorkdayWelcomeDialogComponent, WorkdayWelcomeDialogData, WorkdayWelcomeDialogResult>(
      WorkdayWelcomeDialogComponent,
      {
        data: { name: this.getWorkdayWelcomeName(user), userId: user?.id ?? null },
        width: '100vw',
        maxWidth: '100vw',
        height: '100vh',
        maxHeight: '100vh',
        disableClose: true,
        closeOnNavigation: false,
        autoFocus: false,
        restoreFocus: false,
        panelClass: ['crm-dialog', 'print-fullscreen-dialog-panel', 'workday-dialog-panel'],
      },
    );

    dialogRef.afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.workdayDialogOpen.set(false);
      });
  }

  private getWorkdayWelcomeName(user: UserProfile | null): string {
    const raw = user?.first_name || user?.display_name || user?.displayName || user?.email || '';
    const first = raw.trim().split(/\s+/)[0] ?? '';
    return first && !first.includes('@') ? first : 'коллега';
  }

  truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.substring(0, max) + '...';
  }
}
