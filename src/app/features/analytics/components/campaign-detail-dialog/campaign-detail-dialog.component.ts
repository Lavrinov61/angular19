import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DecimalPipe, CurrencyPipe } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AnalyticsApiService, CampaignDetail } from '../../services/analytics-api.service';

export interface CampaignDetailDialogData {
  source: string;
  campaign: string;
  days: number;
}

@Component({
  selector: 'app-campaign-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    DecimalPipe,
    CurrencyPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>campaign</mat-icon>
      {{ formatSourceName(data.source) }} / {{ data.campaign }}
    </h2>

    <mat-dialog-content>
      @if (loading()) {
        <div class="loading">
          <mat-spinner diameter="40" />
        </div>
      } @else if (detail()) {
        <!-- KPI блок -->
        <div class="kpi-row">
          <div class="kpi-item">
            <span class="kpi-val">{{ detail()!.totals.clicks | number }}</span>
            <span class="kpi-lbl">Клики</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-val">{{ detail()!.totals.unique_visitors | number }}</span>
            <span class="kpi-lbl">Уникальные</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-val">{{ detail()!.totals.purchases }}</span>
            <span class="kpi-lbl">Покупки</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-val revenue">{{ detail()!.totals.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            <span class="kpi-lbl">Выручка</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-val cost">{{ detail()!.totals.cost | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            <span class="kpi-lbl">Расход</span>
          </div>
          @if (detail()!.totals.roi !== null) {
            <div class="kpi-item">
              <mat-chip [class.positive-roi]="detail()!.totals.roi! > 0" [class.negative-roi]="detail()!.totals.roi! <= 0">
                {{ detail()!.totals.roi | number:'1.0-1' }}%
              </mat-chip>
              <span class="kpi-lbl">ROI</span>
            </div>
          }
        </div>

        <!-- Динамика по дням -->
        @if (detail()!.daily.length > 0) {
          <h3>Динамика по дням</h3>
          <div class="table-scroll">
            <table mat-table [dataSource]="detail()!.daily" class="daily-table">
              <ng-container matColumnDef="date">
                <th mat-header-cell *matHeaderCellDef>Дата</th>
                <td mat-cell *matCellDef="let row">{{ formatDate(row.date) }}</td>
              </ng-container>
              <ng-container matColumnDef="clicks">
                <th mat-header-cell *matHeaderCellDef>Клики</th>
                <td mat-cell *matCellDef="let row">{{ row.clicks }}</td>
              </ng-container>
              <ng-container matColumnDef="unique_visitors">
                <th mat-header-cell *matHeaderCellDef>Уник.</th>
                <td mat-cell *matCellDef="let row">{{ row.unique_visitors }}</td>
              </ng-container>
              <ng-container matColumnDef="purchases">
                <th mat-header-cell *matHeaderCellDef>Покупки</th>
                <td mat-cell *matCellDef="let row">
                  <span [class.has-value]="row.purchases > 0">{{ row.purchases }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="revenue">
                <th mat-header-cell *matHeaderCellDef>Выручка</th>
                <td mat-cell *matCellDef="let row">
                  @if (row.revenue > 0) {
                    <span class="revenue">{{ row.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                  } @else {, }
                </td>
              </ng-container>
              <ng-container matColumnDef="cost">
                <th mat-header-cell *matHeaderCellDef>Расход</th>
                <td mat-cell *matCellDef="let row">
                  @if (row.cost > 0) {
                    <span class="cost">{{ row.cost | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                  } @else {, }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="dailyColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: dailyColumns;"></tr>
            </table>
          </div>
        }

        <!-- Объявления -->
        @if (detail()!.ad_variants.length > 0) {
          <h3>Объявления (utm_content)</h3>
          <div class="table-scroll">
            <table mat-table [dataSource]="detail()!.ad_variants" class="variants-table">
              <ng-container matColumnDef="utm_content">
                <th mat-header-cell *matHeaderCellDef>Вариант</th>
                <td mat-cell *matCellDef="let row">{{ row.utm_content }}</td>
              </ng-container>
              <ng-container matColumnDef="clicks">
                <th mat-header-cell *matHeaderCellDef>Клики</th>
                <td mat-cell *matCellDef="let row">{{ row.clicks | number }}</td>
              </ng-container>
              <ng-container matColumnDef="unique_visitors">
                <th mat-header-cell *matHeaderCellDef>Уник.</th>
                <td mat-cell *matCellDef="let row">{{ row.unique_visitors | number }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="variantColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: variantColumns;"></tr>
            </table>
          </div>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Закрыть</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .loading {
      display: flex;
      justify-content: center;
      padding: 48px;
    }

    .kpi-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding: 16px 0;
      border-bottom: 1px solid #eee;
      margin-bottom: 16px;
    }

    .kpi-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 80px;
    }

    .kpi-val {
      font-size: 22px;
      font-weight: 600;
    }

    .kpi-val.revenue { color: #4caf50; }
    .kpi-val.cost { color: #f44336; }

    .kpi-lbl {
      font-size: 12px;
      color: #666;
      margin-top: 4px;
    }

    .positive-roi {
      background-color: #c8e6c9 !important;
      color: #2e7d32 !important;
    }

    .negative-roi {
      background-color: #ffcdd2 !important;
      color: #c62828 !important;
    }

    h3 {
      font-size: 16px;
      font-weight: 500;
      margin: 16px 0 8px;
    }

    .table-scroll {
      overflow-x: auto;
    }

    .daily-table, .variants-table {
      width: 100%;
    }

    .has-value {
      color: #2e7d32;
      font-weight: 600;
    }

    .revenue { color: #4caf50; }
    .cost { color: #f44336; }

    mat-dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    mat-dialog-content {
      min-width: 300px;
      max-height: 70vh;
    }

    @media (min-width: 840px) {
      mat-dialog-content {
        min-width: 600px;
      }
    }
  `]
})
export class CampaignDetailDialogComponent implements OnInit {
  dialogRef = inject<MatDialogRef<CampaignDetailDialogComponent>>(MatDialogRef);
  data = inject<CampaignDetailDialogData>(MAT_DIALOG_DATA);

  private api = inject(AnalyticsApiService);

  loading = signal(true);
  detail = signal<CampaignDetail | null>(null);

  dailyColumns = ['date', 'clicks', 'unique_visitors', 'purchases', 'revenue', 'cost'];
  variantColumns = ['utm_content', 'clicks', 'unique_visitors'];

  ngOnInit(): void {
    this.api.fetchCampaignDetails(this.data.source, this.data.campaign, this.data.days)
      .subscribe(result => {
        this.detail.set(result);
        this.loading.set(false);
      });
  }

  formatSourceName(source: string): string {
    if (!source) return 'Прямой';
    const s = source.toLowerCase();
    if (s === 'yandex_direct') return 'Яндекс.Директ';
    if (s === 'vk_ads') return 'VK Ads';
    return source;
  }

  formatDate(date: string): string {
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
}
