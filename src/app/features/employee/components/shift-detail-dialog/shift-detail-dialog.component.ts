import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { ShiftsApiService, EmployeeShift } from '../../services/shifts-api.service';
import { ToastService } from '../../../../core/services/toast.service';
import {
  WorkdayCashCountDialogComponent,
  type WorkdayCashCountDialogData,
  type WorkdayCashCountDialogResult,
} from '../workday-cash-count-dialog/workday-cash-count-dialog.component';

export interface ShiftDetailDialogData {
  shift: EmployeeShift;
}

const STATUS_CONFIG: Record<EmployeeShift['status'], { label: string; icon: string; color: string }> = {
  scheduled: { label: 'Запланирована', icon: 'event', color: 'var(--crm-status-warning, #f59e0b)' },
  active: { label: 'Активна', icon: 'play_circle', color: 'var(--crm-status-success, #22c55e)' },
  completed: { label: 'Завершена', icon: 'check_circle', color: 'var(--crm-text-muted, #9ca3af)' },
  cancelled: { label: 'Отменена', icon: 'cancel', color: 'var(--crm-status-error, #ef4444)' },
};

@Component({
  selector: 'app-shift-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, MatDialogModule, MatButtonModule,
    MatIconModule, MatChipsModule, MatDividerModule,
  ],
  template: `
    <div class="shift-detail-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <div class="header-title">
          <mat-icon [style.color]="statusConfig().color">{{ statusConfig().icon }}</mat-icon>
          <h2>Смена {{ shiftDate() }}</h2>
        </div>
        <mat-chip-set>
          <mat-chip [style.--mdc-chip-label-text-color]="statusConfig().color"
                    [style.--mdc-chip-elevated-container-color]="statusConfig().color + '1a'">
            {{ statusConfig().label }}
          </mat-chip>
        </mat-chip-set>
      </div>

      <mat-divider />

      <!-- Основная информация -->
      <div class="info-section">
        <h3 class="section-title">Основная информация</h3>

        <div class="info-grid">
          <div class="info-item">
            <mat-icon>store</mat-icon>
            <div>
              <span class="info-label">Студия</span>
              <span class="info-value">
                {{ shift.studio_name ?? 'Не указана' }}
                @if (shift.location_code) {
                  <span class="location-code">{{ shift.location_code }}</span>
                }
              </span>
            </div>
          </div>

          <div class="info-item">
            <mat-icon>schedule</mat-icon>
            <div>
              <span class="info-label">Время</span>
              <span class="info-value">{{ shift.start_time | date:'HH:mm' }} — {{ shift.end_time | date:'HH:mm' }}</span>
            </div>
          </div>

          <div class="info-item">
            <mat-icon>hourglass_top</mat-icon>
            <div>
              <span class="info-label">Продолжительность</span>
              <span class="info-value">{{ duration() }}</span>
            </div>
          </div>

          <div class="info-item">
            <mat-icon>calendar_today</mat-icon>
            <div>
              <span class="info-label">Дата создания</span>
              <span class="info-value">{{ shift.created_at | date:'dd.MM.yyyy HH:mm' }}</span>
            </div>
          </div>
        </div>
      </div>

      <mat-divider />

      <!-- Timeline -->
      <div class="info-section">
        <h3 class="section-title">Хронология</h3>

        <div class="timeline">
          <div class="timeline-item" [class.active]="true">
            <div class="timeline-marker done"></div>
            <div class="timeline-content">
              <span class="timeline-label">Запланирована</span>
              <span class="timeline-date">{{ shift.created_at | date:'dd.MM.yyyy HH:mm' }}</span>
            </div>
          </div>

          <div class="timeline-item" [class.active]="!!shift.checked_in_at">
            <div class="timeline-marker" [class.done]="!!shift.checked_in_at"></div>
            <div class="timeline-content">
              <span class="timeline-label">Начало смены</span>
              <span class="timeline-date">
                @if (shift.checked_in_at) {
                  {{ shift.checked_in_at | date:'dd.MM.yyyy HH:mm' }}
                } @else {
                  —
                }
              </span>
            </div>
          </div>

          <div class="timeline-item" [class.active]="!!shift.checked_out_at" [class.last]="true">
            <div class="timeline-marker" [class.done]="!!shift.checked_out_at" [class.highlight]="!!shift.checked_out_at"></div>
            <div class="timeline-content">
              <span class="timeline-label">Конец смены</span>
              <span class="timeline-date">
                @if (shift.checked_out_at) {
                  {{ shift.checked_out_at | date:'dd.MM.yyyy HH:mm' }}
                } @else {
                  —
                }
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Онлайн-выручка -->
      @if (shift.online_count > 0) {
        <mat-divider />

        <div class="info-section">
          <h3 class="section-title">Онлайн-выручка за смену</h3>

          <div class="earnings-grid">
            <div class="earnings-card">
              <mat-icon>receipt_long</mat-icon>
              <div>
                <span class="earnings-value">{{ shift.online_count }}</span>
                <span class="earnings-label">оплат</span>
              </div>
            </div>
            <div class="earnings-card">
              <mat-icon>payments</mat-icon>
              <div>
                <span class="earnings-value">{{ shift.online_earnings | number:'1.0-0' }} \u20BD</span>
                <span class="earnings-label">сумма</span>
              </div>
            </div>
          </div>
        </div>
      }

      <mat-divider />

      <!-- Actions -->
      <div class="dialog-actions">
        @switch (shift.status) {
          @case ('scheduled') {
            <button mat-button (click)="dialogRef.close()">Закрыть</button>
            <button mat-flat-button color="primary" [disabled]="loading()" (click)="checkIn()">
              <mat-icon>login</mat-icon>
              Начать смену
            </button>
          }
          @case ('active') {
            <button mat-button (click)="dialogRef.close()">Закрыть</button>
            <button mat-flat-button color="warn" [disabled]="loading()" (click)="checkOut()">
              <mat-icon>logout</mat-icon>
              Завершить смену
            </button>
          }
          @default {
            <button mat-flat-button (click)="dialogRef.close()">Закрыть</button>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .shift-detail-dialog {
      width: 480px;
      max-width: 90vw;
      background: var(--crm-gradient-card, linear-gradient(135deg, rgba(30,30,40,0.95), rgba(20,20,30,0.98)));
      backdrop-filter: var(--crm-glass-blur, blur(20px));
      border-radius: var(--crm-radius-lg, 16px);
      padding: 24px;
      color: var(--crm-text-primary, #f5f5f5);
    }

    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 10px;

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
      }
    }

    mat-divider {
      border-color: var(--crm-border, rgba(255,255,255,0.08));
      margin: 16px 0;
    }

    .info-section {
      padding: 4px 0;
    }

    .section-title {
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--crm-text-muted, #9ca3af);
      margin: 0 0 12px 0;
    }

    .info-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .info-item {
      display: flex;
      align-items: center;
      gap: 12px;

      mat-icon {
        color: var(--crm-text-muted, #9ca3af);
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      div {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
    }

    .info-label {
      font-size: 12px;
      color: var(--crm-text-muted, #9ca3af);
    }

    .info-value {
      font-size: 14px;
      color: var(--crm-text-primary, #f5f5f5);
    }

    .location-code {
      font-size: 12px;
      color: var(--crm-accent, #818cf8);
      margin-left: 6px;
    }

    /* Timeline */
    .timeline {
      position: relative;
      padding-left: 24px;
    }

    .timeline-item {
      position: relative;
      padding-bottom: 20px;

      &.last { padding-bottom: 0; }

      &::before {
        content: '';
        position: absolute;
        left: -18px;
        top: 12px;
        bottom: 0;
        width: 2px;
        background: var(--crm-border, rgba(255,255,255,0.1));
      }

      &.last::before { display: none; }
    }

    .timeline-marker {
      position: absolute;
      left: -22px;
      top: 4px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid var(--crm-border, rgba(255,255,255,0.2));
      background: transparent;

      &.done {
        background: var(--crm-status-success, #22c55e);
        border-color: var(--crm-status-success, #22c55e);
      }

      &.highlight {
        box-shadow: 0 0 8px var(--crm-status-success, #22c55e);
      }
    }

    .timeline-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .timeline-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--crm-text-primary, #f5f5f5);
    }

    .timeline-date {
      font-size: 12px;
      color: var(--crm-text-muted, #9ca3af);
    }

    .timeline-item:not(.active) .timeline-label {
      color: var(--crm-text-muted, #9ca3af);
    }

    /* Earnings */
    .earnings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .earnings-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border-radius: var(--crm-radius-sm, 8px);
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--crm-border, rgba(255,255,255,0.08));

      mat-icon {
        color: var(--crm-status-success, #22c55e);
      }

      div {
        display: flex;
        flex-direction: column;
      }
    }

    .earnings-value {
      font-size: 18px;
      font-weight: 600;
      color: var(--crm-text-primary, #f5f5f5);
    }

    .earnings-label {
      font-size: 12px;
      color: var(--crm-text-muted, #9ca3af);
    }

    /* Actions */
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 8px;
    }
  `],
})
export class ShiftDetailDialogComponent {
  readonly dialogRef = inject<MatDialogRef<ShiftDetailDialogComponent>>(MatDialogRef);
  private readonly data = inject<ShiftDetailDialogData>(MAT_DIALOG_DATA);
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly shift = this.data.shift;
  readonly loading = signal(false);

  readonly statusConfig = computed(() => STATUS_CONFIG[this.shift.status]);

  readonly shiftDate = computed(() => {
    const d = new Date(this.shift.shift_date);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  });

  readonly duration = computed(() => {
    const start = new Date(this.shift.start_time);
    const end = new Date(this.shift.end_time);
    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) return '—';
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  });

  checkIn(): void {
    this.requestCashCount('open', (cashAtOpen) => {
      this.loading.set(true);
      this.shiftsApi.checkIn(this.shift.id, cashAtOpen).subscribe({
        next: (res) => {
          this.loading.set(false);
          if (res.success && res.data) {
            this.toast.success('Смена начата');
            this.dialogRef.close(res.data);
          }
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('Не удалось начать смену');
        },
      });
    });
  }

  checkOut(): void {
    this.requestCashCount('close', (cashAtClose) => {
      this.loading.set(true);
      this.shiftsApi.checkOut(this.shift.id, cashAtClose).subscribe({
        next: (res) => {
          this.loading.set(false);
          if (res.success && res.data) {
            this.toast.success('Смена завершена');
            this.dialogRef.close(res.data);
          }
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('Не удалось завершить смену');
        },
      });
    });
  }

  private requestCashCount(mode: WorkdayCashCountDialogData['mode'], onAmount: (amount: number) => void): void {
    const dialogRef = this.dialog.open<
      WorkdayCashCountDialogComponent,
      WorkdayCashCountDialogData,
      WorkdayCashCountDialogResult
    >(WorkdayCashCountDialogComponent, {
      data: {
        mode,
        studioName: this.shift.studio_name ?? null,
        initialAmount: mode === 'open' ? this.shift.cash_at_open : this.shift.cash_at_close,
      },
      width: '440px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: false,
      restoreFocus: false,
      panelClass: ['crm-dialog', 'workday-cash-count-dialog-panel'],
    });

    dialogRef.afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) return;
        onAmount(result.amount);
      });
  }
}
