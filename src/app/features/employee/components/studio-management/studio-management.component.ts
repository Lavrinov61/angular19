import { Component, inject, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';

const RU_DATE_PIPE = new DatePipe('ru-RU');

import { StudioAdminService } from '../../../../core/services/studio-admin.service';
import { StudioStatus } from '../../../../core/services/studio-alert.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../shared/confirm-dialog.component';
import { StudioStatusDialogComponent, StudioStatusDialogData } from './studio-status-dialog.component';

@Component({
  selector: 'app-studio-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatIconModule, MatButtonModule,
    MatProgressSpinnerModule, MatTooltipModule,
  ],
  template: `
    <div class="sm-page">
      <div class="sm-header">
        <div>
          <h2 class="sm-title">Студии</h2>
          <p class="sm-subtitle">Управление статусом точек — открытие, закрытие, тех. перерывы</p>
        </div>
        <button mat-icon-button (click)="svc.load()" matTooltip="Обновить" [disabled]="svc.loading()">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      @if (svc.loading() && svc.studios().length === 0) {
        <div class="sm-loading">
          <mat-progress-spinner mode="indeterminate" diameter="32" />
          <span>Загрузка студий...</span>
        </div>
      } @else if (svc.studios().length === 0) {
        <div class="sm-empty">
          <mat-icon>location_off</mat-icon>
          <span>Нет студий</span>
        </div>
      } @else {
        <div class="sm-grid">
          @for (s of svc.studios(); track s.id) {
            <mat-card class="sm-card">
              <div class="sm-card-head">
                <div class="sm-name">
                  <mat-icon>location_on</mat-icon>
                  <span>{{ s.name }}</span>
                </div>
                <span class="status-chip" [class]="'status-' + s.status">
                  <mat-icon>{{ statusIcon(s.status) }}</mat-icon>
                  {{ statusLabel(s.status) }}
                </span>
              </div>

              <div class="sm-address">{{ s.address || s.location_code }}</div>

              @if (s.status !== 'open') {
                <div class="sm-reason">
                  @if (s.status_message) {
                    <div class="sm-reason-msg">
                      <mat-icon>info</mat-icon>
                      <span>{{ s.status_message }}</span>
                    </div>
                  }
                  @if (s.status_until) {
                    <div class="sm-reason-until">
                      <mat-icon>event</mat-icon>
                      <span>{{ closureScheduleLabel(s.status_until) }}</span>
                    </div>
                  }
                </div>
              }

              <div class="sm-actions">
                <button mat-stroked-button (click)="openDialog(s)">
                  <mat-icon>edit</mat-icon>
                  Изменить
                </button>
                @if (s.status !== 'open') {
                  <button mat-flat-button color="primary" (click)="reopenNow(s)">
                    <mat-icon>play_arrow</mat-icon>
                    Открыть сейчас
                  </button>
                }
              </div>
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    @use '../../../../../styles/status-chips' as chip;

    :host { display: block; height: 100%; }

    .sm-page {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .sm-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .sm-title { font-size: 20px; font-weight: 600; margin: 0; color: var(--crm-text-primary); }
    .sm-subtitle { font-size: 13px; color: var(--crm-text-muted); margin: 4px 0 0; }

    .sm-loading, .sm-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px;
      color: var(--crm-text-muted);

      mat-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
      }
    }

    .sm-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 12px;
    }

    .sm-card {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sm-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .sm-name {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 15px;
      color: var(--crm-text-primary);

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--crm-text-muted);
      }
    }

    .status-chip {
      @include chip.status-chip-base;
      gap: 4px;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }
    .status-chip.status-open { @include chip.status-chip('success'); }
    .status-chip.status-closed { @include chip.status-chip('error'); }
    .status-chip.status-maintenance { @include chip.status-chip('warning'); }

    .sm-address {
      font-size: 13px;
      color: var(--crm-text-muted);
    }

    .sm-reason {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px;
      border-radius: var(--crm-radius-md, 8px);
      background: var(--crm-surface-raised, rgba(255, 255, 255, 0.03));
      font-size: 13px;
    }
    .sm-reason-msg, .sm-reason-until {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      color: var(--crm-text-secondary);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-text-muted);
        margin-top: 2px;
        flex-shrink: 0;
      }
    }

    .sm-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: auto;

      button {
        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          margin-right: 4px;
        }
      }
    }
  `],
})
export class StudioManagementComponent implements OnInit {
  readonly svc = inject(StudioAdminService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);

  ngOnInit(): void {
    this.svc.load();
  }

  openDialog(studio: StudioStatus): void {
    const data: StudioStatusDialogData = { studio };
    this.dialog.open(StudioStatusDialogComponent, { data, width: '500px' })
      .afterClosed()
      .subscribe((ok: unknown) => {
        if (ok === true) this.svc.load();
      });
  }

  reopenNow(s: StudioStatus): void {
    const confirmData: ConfirmDialogData = {
      title: 'Открыть студию?',
      message: `Статус студии «${s.name}» будет сброшен в «Открыта». Клиенты снова смогут бронировать.`,
      confirmLabel: 'Открыть',
      cancelLabel: 'Отмена',
      icon: 'play_arrow',
    };
    this.dialog.open(ConfirmDialogComponent, { data: confirmData, width: '400px' })
      .afterClosed()
      .subscribe((ok: unknown) => {
        if (ok !== true) return;
        this.svc.reopen(s.id).subscribe({
          next: () => this.toast.success(`Студия «${s.name}» открыта`),
          error: (err) => {
            const msg = err?.error?.error || err?.message || 'Не удалось открыть студию';
            this.toast.error(msg);
          },
        });
      });
  }

  statusIcon(status: StudioStatus['status']): string {
    switch (status) {
      case 'open': return 'check_circle';
      case 'closed': return 'block';
      case 'maintenance': return 'build';
    }
  }

  statusLabel(status: StudioStatus['status']): string {
    switch (status) {
      case 'open': return 'Открыта';
      case 'closed': return 'Закрыта';
      case 'maintenance': return 'Тех. перерыв';
    }
  }

  closureScheduleLabel(until: string): string {
    const iso = until.includes('T') ? until : `${until}T00:00:00`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return until;
    const reopen = new Date(d.getTime());
    reopen.setDate(reopen.getDate() + 1);
    const untilLabel = RU_DATE_PIPE.transform(d, 'd MMM y') ?? until;
    const reopenLabel = RU_DATE_PIPE.transform(reopen, 'd MMM y') ?? until;
    return `Закрыто по ${untilLabel} включительно. Откроется ${reopenLabel}`;
  }
}
