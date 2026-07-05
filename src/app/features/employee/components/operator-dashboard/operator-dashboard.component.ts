import { Component, inject, signal, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { OperatorStatsApiService, OperatorStatsData } from '../../services/operator-stats-api.service';

@Component({
  selector: 'app-operator-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonToggleModule, MatCardModule, MatIconModule,
    MatTableModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="op-dash">
      <div class="op-header">
        <h2>Операторы</h2>
        <mat-button-toggle-group [value]="period()" (change)="changePeriod($event.value)">
          <mat-button-toggle value="today">Сегодня</mat-button-toggle>
          <mat-button-toggle value="week">Неделя</mat-button-toggle>
          <mat-button-toggle value="month">Месяц</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      }

      @if (data()) {
        <div class="kpi-row">
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon>forum</mat-icon>
            <span class="kpi-value">{{ data()!.summary.totalChats }}</span>
            <span class="kpi-label">Чатов</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon>chat_bubble</mat-icon>
            <span class="kpi-value">{{ data()!.summary.totalMessages }}</span>
            <span class="kpi-label">Сообщений</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon [class]="responseColor(data()!.summary.avgFirstResponseSec)">timer</mat-icon>
            <span class="kpi-value" [class]="responseColor(data()!.summary.avgFirstResponseSec)">
              {{ formatDuration(data()!.summary.avgFirstResponseSec) }}
            </span>
            <span class="kpi-label">Ср. время ответа</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon>schedule</mat-icon>
            <span class="kpi-value">{{ formatDuration(data()!.summary.avgResolutionSec) }}</span>
            <span class="kpi-label">Ср. решение</span>
          </mat-card>
        </div>

        @if (data()!.operators.length) {
          <table mat-table [dataSource]="data()!.operators" class="op-table">
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Оператор</th>
              <td mat-cell *matCellDef="let op">{{ op.operator_name }}</td>
            </ng-container>

            <ng-container matColumnDef="chats">
              <th mat-header-cell *matHeaderCellDef>Чатов</th>
              <td mat-cell *matCellDef="let op">{{ op.chats_handled }}</td>
            </ng-container>

            <ng-container matColumnDef="messages">
              <th mat-header-cell *matHeaderCellDef>Сообщений</th>
              <td mat-cell *matCellDef="let op">{{ op.messages_sent }}</td>
            </ng-container>

            <ng-container matColumnDef="firstResponse">
              <th mat-header-cell *matHeaderCellDef>Время ответа</th>
              <td mat-cell *matCellDef="let op" [class]="responseColor(op.avg_first_response_sec)">
                {{ formatDuration(op.avg_first_response_sec) }}
              </td>
            </ng-container>

            <ng-container matColumnDef="resolution">
              <th mat-header-cell *matHeaderCellDef>Решение</th>
              <td mat-cell *matCellDef="let op">{{ formatDuration(op.avg_resolution_sec) }}</td>
            </ng-container>

            <ng-container matColumnDef="active">
              <th mat-header-cell *matHeaderCellDef>Активных</th>
              <td mat-cell *matCellDef="let op">{{ op.active_sessions }}</td>
            </ng-container>

            <ng-container matColumnDef="csat">
              <th mat-header-cell *matHeaderCellDef>CSAT</th>
              <td mat-cell *matCellDef="let op" [class]="csatColor(op.avg_csat)">
                {{ op.avg_csat ? op.avg_csat.toFixed(1) : '—' }}
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns;"></tr>
          </table>
        }
      }
    </div>
  `,
  styles: [`
    .op-dash { padding: 16px; height: 100%; overflow-y: auto; }

    .op-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      h2 { margin: 0; font-size: 18px; font-weight: 600; }
    }

    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .kpi-card {
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      text-align: center;

      mat-icon { font-size: 24px; width: 24px; height: 24px; color: var(--crm-accent); }
    }

    .kpi-value { font-size: 24px; font-weight: 700; }
    .kpi-label { font-size: 12px; color: var(--crm-text-muted); }

    .op-table { width: 100%; }

    .loading { display: flex; justify-content: center; padding: 24px; }

    .sla-good { color: var(--crm-status-success); }
    .sla-warn { color: var(--crm-status-warning); }
    .sla-bad { color: var(--crm-status-error); }
  `],
})
export class OperatorDashboardComponent {
  private readonly statsApi = inject(OperatorStatsApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly period = signal('today');
  readonly data = signal<OperatorStatsData | null>(null);
  readonly loading = signal(false);
  readonly columns = ['name', 'chats', 'messages', 'firstResponse', 'resolution', 'active', 'csat'];

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.load();
    }
  }

  changePeriod(p: string): void {
    this.period.set(p);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.statsApi.getStats(this.period()).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  formatDuration(sec: number | null): string {
    if (sec === null || sec === undefined) return '—';
    if (sec < 60) return `${Math.round(sec)}с`;
    if (sec < 3600) return `${Math.round(sec / 60)}м`;
    return `${Math.round(sec / 3600)}ч ${Math.round((sec % 3600) / 60)}м`;
  }

  responseColor(sec: number | null): string {
    if (sec === null) return '';
    if (sec < 120) return 'sla-good';
    if (sec < 300) return 'sla-warn';
    return 'sla-bad';
  }

  csatColor(score: number | null): string {
    if (score === null) return '';
    if (score >= 4) return 'sla-good';
    if (score >= 3) return 'sla-warn';
    return 'sla-bad';
  }
}
