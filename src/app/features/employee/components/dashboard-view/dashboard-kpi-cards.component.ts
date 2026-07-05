import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DashboardDataService } from '../../services/dashboard-data.service';

@Component({
  selector: 'app-dashboard-kpi-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="kpi-strip">
      <div class="kpi-item">
        <span class="kpi-value" [class.good]="kpi().retouchConversion >= 60" [class.low]="kpi().retouchConversion < 40">
          {{ kpi().retouchConversion }}%
        </span>
        <div class="kpi-progress">
          <div class="kpi-progress-fill" [class.good]="kpi().retouchConversion >= 60" [class.low]="kpi().retouchConversion < 40"
               [style.width.%]="kpi().retouchConversion"></div>
        </div>
        <span class="kpi-label">Конверсия ретуши</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-value">{{ kpi().reviewsCollected }}/{{ kpi().reviewsTarget }}</span>
        <div class="kpi-progress">
          <div class="kpi-progress-fill" [class.good]="kpi().reviewsCollected >= kpi().reviewsTarget"
               [style.width.%]="reviewsPercent()"></div>
        </div>
        <span class="kpi-label">Отзывы собрано</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-value accent">{{ kpi().portraitUpsells }}</span>
        <span class="kpi-label">Портрет апселл</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-value" [class.good]="kpi().satisfactionScore >= 4.5">
          {{ kpi().satisfactionScore }}
        </span>
        <span class="kpi-label">Оценка клиентов</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-value accent">{{ monthlyCommission() | number:'1.0-0' }}</span>
        <span class="kpi-label">Комиссия / мес</span>
      </div>
    </div>
  `,
  styles: [`
    .kpi-strip {
      display: flex;
      align-items: center;
      gap: 0;
    }

    .kpi-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      padding: 2px 0;
    }

    .kpi-divider {
      width: 1px;
      height: 32px;
      background: var(--crm-border);
      flex-shrink: 0;
    }

    .kpi-value {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 28px;
      font-weight: 500;
      line-height: 1;
      color: var(--crm-text-primary);
      letter-spacing: -0.02em;

      &.good { color: var(--crm-status-success); }
      &.low { color: var(--crm-status-error); }
      &.accent { color: var(--crm-accent); }
    }

    .kpi-label {
      font-family: var(--crm-font-sans);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.02em;
      color: var(--crm-text-muted);
      margin-top: 2px;
      text-align: center;
      line-height: 1.2;
    }

    .kpi-progress {
      max-width: 80px;
      width: 100%;
      height: 3px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 4px;
    }

    .kpi-progress-fill {
      height: 100%;
      border-radius: 2px;
      background: var(--crm-accent);
      transition: width 0.4s ease;

      &.good { background: var(--crm-status-success); }
      &.low { background: var(--crm-status-error); }
    }

    @media (max-width: 480px) {
      .kpi-value { font-size: 24px; }
    }
  `],
})
export class DashboardKpiCardsComponent {
  private readonly dashData = inject(DashboardDataService);
  readonly kpi = this.dashData.employeeKpi;
  readonly monthlyCommission = this.dashData.monthlyCommission;

  readonly reviewsPercent = computed(() => {
    const k = this.kpi();
    return k.reviewsTarget > 0 ? Math.min(100, Math.round((k.reviewsCollected / k.reviewsTarget) * 100)) : 0;
  });
}
