import {
  Component, inject, signal, computed, OnInit,
  PLATFORM_ID, ChangeDetectionStrategy,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  AnalyticsApiService,
  RevenueAttributionData,
} from '../../services/analytics-api.service';

const CHANNEL_META: Record<string, { icon: string; label: string }> = {
  telegram:  { icon: 'send',       label: 'Telegram' },
  vk:        { icon: 'group',      label: 'VK' },
  whatsapp:  { icon: 'whatshot',    label: 'WhatsApp' },
  web:       { icon: 'language',    label: 'Web' },
  'walk-in': { icon: 'store',      label: 'Walk-in' },
  email:     { icon: 'email',      label: 'Email' },
  instagram: { icon: 'photo_camera', label: 'Instagram' },
  max:       { icon: 'chat',       label: 'МАКС' },
};

@Component({
  selector: 'app-revenue-attribution',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatIconModule, MatChipsModule, MatProgressBarModule, DecimalPipe],
  template: `
    <div class="ra-container">
      <header class="ra-header">
        <h2 class="ra-title">
          <mat-icon class="ra-title-icon">pie_chart</mat-icon>
          Revenue Attribution
        </h2>
        <mat-chip-set class="ra-periods">
          @for (p of periods; track p.value) {
            <mat-chip [highlighted]="period() === p.value"
                      (click)="setPeriod(p.value)">
              {{ p.label }}
            </mat-chip>
          }
        </mat-chip-set>
      </header>

      @if (loading()) {
        <div class="ra-loading">
          <mat-progress-bar mode="indeterminate" />
        </div>
      } @else if (data()) {
        <!-- Summary cards -->
        <div class="ra-summary">
          <mat-card class="ra-summary-card">
            <mat-icon>payments</mat-icon>
            <div class="ra-summary-value">{{ data()!.totalRevenue | number:'1.0-0' }} &#8381;</div>
            <div class="ra-summary-label">Общая выручка</div>
          </mat-card>
          <mat-card class="ra-summary-card">
            <mat-icon>receipt_long</mat-icon>
            <div class="ra-summary-value">{{ totalOrders() }}</div>
            <div class="ra-summary-label">Заказов</div>
          </mat-card>
          <mat-card class="ra-summary-card">
            <mat-icon>shopping_bag</mat-icon>
            <div class="ra-summary-value">{{ data()!.channels.length }}</div>
            <div class="ra-summary-label">Каналов</div>
          </mat-card>
        </div>

        <!-- Channel table -->
        <mat-card class="ra-table-card">
          <h3 class="ra-section-title">
            <mat-icon>hub</mat-icon>
            По каналам
          </h3>
          <div class="ra-table-wrap">
            <table class="ra-table">
              <thead>
                <tr>
                  <th class="ra-th-channel">Канал</th>
                  <th class="ra-th-num">Заказы</th>
                  <th class="ra-th-num">Выручка</th>
                  <th class="ra-th-num">Ср. чек</th>
                  <th class="ra-th-share">Доля</th>
                </tr>
              </thead>
              <tbody>
                @for (ch of data()!.channels; track ch.channel) {
                  <tr class="ra-row">
                    <td class="ra-td-channel">
                      <mat-icon class="ra-channel-icon">{{ channelIcon(ch.channel) }}</mat-icon>
                      <span>{{ channelLabel(ch.channel) }}</span>
                    </td>
                    <td class="ra-td-num">{{ ch.orders }}</td>
                    <td class="ra-td-num ra-revenue">{{ ch.revenue | number:'1.0-0' }} &#8381;</td>
                    <td class="ra-td-num">{{ ch.avgCheck | number:'1.0-0' }} &#8381;</td>
                    <td class="ra-td-share">
                      <div class="ra-share-bar-wrap">
                        <div class="ra-share-bar" [style.width.%]="ch.share"></div>
                      </div>
                      <span class="ra-share-text">{{ ch.share }}%</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </mat-card>

        <!-- POS by studio -->
        @if (data()!.posStudios.length > 0) {
          <mat-card class="ra-table-card">
            <h3 class="ra-section-title">
              <mat-icon>storefront</mat-icon>
              POS по студиям
            </h3>
            <div class="ra-table-wrap">
              <table class="ra-table">
                <thead>
                  <tr>
                    <th class="ra-th-channel">Студия</th>
                    <th class="ra-th-num">Чеков</th>
                    <th class="ra-th-num">Выручка</th>
                  </tr>
                </thead>
                <tbody>
                  @for (st of data()!.posStudios; track st.studio) {
                    <tr class="ra-row">
                      <td class="ra-td-channel">
                        <mat-icon class="ra-channel-icon">store</mat-icon>
                        <span>{{ st.studio }}</span>
                      </td>
                      <td class="ra-td-num">{{ st.count }}</td>
                      <td class="ra-td-num ra-revenue">{{ st.revenue | number:'1.0-0' }} &#8381;</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-card>
        }
      } @else {
        <mat-card class="ra-empty">
          <mat-icon>info</mat-icon>
          <p>Нет данных за выбранный период</p>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }

    .ra-container {
      padding: 20px;
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .ra-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .ra-title {
      font-size: 20px;
      font-weight: 600;
      color: var(--crm-text-primary);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ra-title-icon {
      color: var(--crm-accent);
    }

    .ra-loading {
      padding: 40px 0;
    }

    /* Summary */
    .ra-summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .ra-summary-card {
      padding: 20px;
      text-align: center;

      mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        color: var(--crm-accent);
        margin-bottom: 8px;
      }
    }

    .ra-summary-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--crm-text-primary);
    }

    .ra-summary-label {
      font-size: 12px;
      color: var(--crm-text-secondary);
      margin-top: 4px;
    }

    /* Table card */
    .ra-table-card {
      padding: 20px;
    }

    .ra-section-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--crm-text-primary);
      margin: 0 0 16px;
      display: flex;
      align-items: center;
      gap: 8px;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--crm-accent);
      }
    }

    .ra-table-wrap {
      overflow-x: auto;
    }

    .ra-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .ra-table thead {
      border-bottom: 1px solid var(--crm-glass-border);
    }

    .ra-table th {
      padding: 8px 12px;
      text-align: left;
      font-weight: 600;
      color: var(--crm-text-secondary);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .ra-th-num, .ra-td-num {
      text-align: right;
    }

    .ra-th-share {
      width: 180px;
    }

    .ra-row {
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      transition: background 0.15s;

      &:hover {
        background: rgba(255, 255, 255, 0.03);
      }
    }

    .ra-table td {
      padding: 10px 12px;
      color: var(--crm-text-primary);
    }

    .ra-td-channel {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ra-channel-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-accent);
    }

    .ra-revenue {
      font-weight: 600;
      color: #4ade80;
    }

    .ra-td-share {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ra-share-bar-wrap {
      flex: 1;
      height: 6px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.06);
      overflow: hidden;
    }

    .ra-share-bar {
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, var(--crm-accent), #f59e0b);
      transition: width 0.4s ease;
    }

    .ra-share-text {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary);
      min-width: 42px;
      text-align: right;
    }

    /* Empty */
    .ra-empty {
      padding: 40px;
      text-align: center;
      color: var(--crm-text-secondary);

      mat-icon {
        font-size: 36px;
        width: 36px;
        height: 36px;
        margin-bottom: 12px;
      }
    }

    /* Period chips */
    .ra-periods {
      mat-chip {
        cursor: pointer;
      }
    }
  `],
})
export class RevenueAttributionComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly analyticsApi = inject(AnalyticsApiService);

  readonly loading = signal(true);
  readonly data = signal<RevenueAttributionData | null>(null);
  readonly period = signal('30d');

  readonly periods = [
    { value: '7d',  label: '7 дней' },
    { value: '30d', label: '30 дней' },
    { value: '90d', label: '90 дней' },
  ];

  readonly totalOrders = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return d.channels.reduce((sum, ch) => sum + ch.orders, 0);
  });

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.load();
    }
  }

  setPeriod(p: string): void {
    this.period.set(p);
    this.load();
  }

  channelIcon(channel: string): string {
    return CHANNEL_META[channel]?.icon ?? 'help_outline';
  }

  channelLabel(channel: string): string {
    return CHANNEL_META[channel]?.label ?? channel;
  }

  private load(): void {
    this.loading.set(true);
    this.analyticsApi.getRevenueAttribution(this.period()).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
