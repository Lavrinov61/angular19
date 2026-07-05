import { Component, inject, signal, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConversionStatsApiService, ConversionStatsData } from '../../services/conversion-stats-api.service';

@Component({
  selector: 'app-conversion-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    MatButtonToggleModule, MatCardModule, MatIconModule,
    MatTableModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="conv-dash">
      <div class="conv-header">
        <h2>Конверсии</h2>
        <mat-button-toggle-group [value]="period()" (change)="changePeriod($event.value)">
          <mat-button-toggle value="week">Неделя</mat-button-toggle>
          <mat-button-toggle value="month">Месяц</mat-button-toggle>
          <mat-button-toggle value="quarter">Квартал</mat-button-toggle>
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
            <mat-icon>shopping_cart</mat-icon>
            <span class="kpi-value">{{ data()!.summary.totalOrders }}</span>
            <span class="kpi-label">Заказов</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon>trending_up</mat-icon>
            <span class="kpi-value conv-rate">{{ data()!.summary.conversionRate }}%</span>
            <span class="kpi-label">Конверсия</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon>payments</mat-icon>
            <span class="kpi-value">{{ data()!.summary.avgCheck | number:'1.0-0' }} ₽</span>
            <span class="kpi-label">Средний чек</span>
          </mat-card>
        </div>

        <!-- By Channel -->
        @if (data()!.byChannel.length) {
          <h3 class="section-title">По каналам</h3>
          <div class="channel-row">
            @for (ch of data()!.byChannel; track ch.channel) {
              <mat-card appearance="outlined" class="channel-card">
                <mat-icon>{{ channelIcon(ch.channel) }}</mat-icon>
                <div class="channel-info">
                  <span class="ch-name">{{ channelLabel(ch.channel) }}</span>
                  <span class="ch-stats">{{ ch.chats }} чатов · {{ ch.orders }} заказов</span>
                </div>
              </mat-card>
            }
          </div>
        }

        <!-- Daily Table -->
        @if (data()!.daily.length) {
          <h3 class="section-title">По дням</h3>
          <table mat-table [dataSource]="data()!.daily" class="daily-table">
            <ng-container matColumnDef="day">
              <th mat-header-cell *matHeaderCellDef>Дата</th>
              <td mat-cell *matCellDef="let row">{{ formatDay(row.day) }}</td>
            </ng-container>
            <ng-container matColumnDef="chats">
              <th mat-header-cell *matHeaderCellDef>Чатов</th>
              <td mat-cell *matCellDef="let row">{{ row.chats }}</td>
            </ng-container>
            <ng-container matColumnDef="orders">
              <th mat-header-cell *matHeaderCellDef>Заказов</th>
              <td mat-cell *matCellDef="let row">{{ row.orders }}</td>
            </ng-container>
            <ng-container matColumnDef="bookings">
              <th mat-header-cell *matHeaderCellDef>Записей</th>
              <td mat-cell *matCellDef="let row">{{ row.bookings }}</td>
            </ng-container>
            <ng-container matColumnDef="revenue">
              <th mat-header-cell *matHeaderCellDef>Выручка</th>
              <td mat-cell *matCellDef="let row">{{ row.revenue | number:'1.0-0' }} ₽</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="dailyColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: dailyColumns;"></tr>
          </table>
        }
      }
    </div>
  `,
  styles: [`
    .conv-dash { max-width: 900px; margin: 0 auto; padding: 16px; }
    .conv-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
    .conv-header h2 { font-size: 20px; font-weight: 600; margin: 0; color: var(--mat-sys-on-surface); }
    .loading { display: flex; justify-content: center; padding: 40px; }

    .kpi-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 24px;
      @media (min-width: 600px) { grid-template-columns: repeat(4, 1fr); }
    }
    .kpi-card {
      padding: 16px; text-align: center;
      mat-icon { font-size: 24px; width: 24px; height: 24px; color: var(--mat-sys-primary); margin-bottom: 4px; }
    }
    .kpi-value { display: block; font-size: 24px; font-weight: 700; color: var(--mat-sys-on-surface); }
    .kpi-label { display: block; font-size: 12px; color: var(--mat-sys-on-surface-variant); margin-top: 2px; }
    .conv-rate { color: var(--mat-sys-primary); }

    .section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; color: var(--mat-sys-on-surface); }

    .channel-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
    .channel-card {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px; min-width: 180px;
      mat-icon { font-size: 20px; color: var(--mat-sys-primary); }
    }
    .channel-info { display: flex; flex-direction: column; }
    .ch-name { font-size: 14px; font-weight: 500; color: var(--mat-sys-on-surface); }
    .ch-stats { font-size: 12px; color: var(--mat-sys-on-surface-variant); }

    .daily-table { width: 100%; }
  `],
})
export class ConversionDashboardComponent {
  private readonly api = inject(ConversionStatsApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly period = signal('month');
  readonly loading = signal(false);
  readonly data = signal<ConversionStatsData | null>(null);
  readonly dailyColumns = ['day', 'chats', 'orders', 'bookings', 'revenue'];

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
    this.api.getStats(this.period()).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  formatDay(day: string): string {
    const d = new Date(day);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  channelIcon(ch: string): string {
    return ({ online: 'language', studio: 'store', telegram: 'send' })[ch] || 'chat';
  }

  channelLabel(ch: string): string {
    return ({ online: 'Сайт', studio: 'Студия', telegram: 'Telegram' })[ch] || ch;
  }
}
