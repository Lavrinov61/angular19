import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { ConversionDashboardComponent } from '../conversion-dashboard/conversion-dashboard.component';
import { AnalyticsDashboardComponent } from '../analytics-dashboard/analytics-dashboard.component';
import { AttributionDashboardComponent } from '../attribution-dashboard/attribution-dashboard.component';

@Component({
  selector: 'app-marketing-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTabsModule, MatIconModule,
    ConversionDashboardComponent, AnalyticsDashboardComponent, AttributionDashboardComponent,
  ],
  host: { class: 'marketing-dashboard-host' },
  template: `
    <div class="marketing-dashboard">
      <div class="marketing-header">
        <mat-icon>campaign</mat-icon>
        <h2>Маркетинг</h2>
      </div>

      <mat-tab-group animationDuration="200ms" dynamicHeight>
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">trending_up</mat-icon>
            Конверсии
          </ng-template>
          @defer {
            <app-conversion-dashboard />
          } @placeholder {
            <div class="tab-placeholder">Загрузка...</div>
          }
        </mat-tab>

        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">waterfall_chart</mat-icon>
            Воронки
          </ng-template>
          @defer {
            <app-analytics-dashboard />
          } @placeholder {
            <div class="tab-placeholder">Загрузка...</div>
          }
        </mat-tab>

        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">ads_click</mat-icon>
            Реклама
          </ng-template>
          @defer {
            <app-attribution-dashboard />
          } @placeholder {
            <div class="tab-placeholder">Загрузка...</div>
          }
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .marketing-dashboard {
      min-height: 100vh;
      background: var(--ed-bg, var(--crm-bg, #111));
      color: var(--ed-text, var(--crm-text-primary, #e5e5e5));
      padding: 16px;
    }

    .marketing-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 20px;

      mat-icon {
        font-size: 26px;
        width: 26px;
        height: 26px;
        color: var(--ed-accent, var(--crm-accent, #6366f1));
      }

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--ed-text, var(--crm-text-primary, #e5e5e5));
      }
    }

    .tab-icon {
      margin-right: 6px;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .tab-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: var(--ed-text-secondary, var(--crm-text-secondary, #999));
      font-size: 14px;
    }
  `],
})
export class MarketingDashboardComponent {}
