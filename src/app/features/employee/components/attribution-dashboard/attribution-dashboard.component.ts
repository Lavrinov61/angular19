import { Component, inject, signal, OnInit, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

interface AttributionStats {
  period_days: number;
  overview: {
    total_purchases: number;
    attributed: number;
    attribution_rate: number;
    total_revenue: number;
    attributed_revenue: number;
    unique_customers: number;
    unique_fingerprints: number;
    total_ad_spend: number;
    romi: number | null;
  };
  by_platform: {
    platform: string;
    purchases: number;
    revenue: number;
    customers: number;
    cost: number;
    romi: number | null;
  }[];
  by_campaign: {
    campaign_id: string;
    utm_source: string;
    platform: string;
    purchases: number;
    revenue: number;
  }[];
  by_source: {
    source: string;
    purchases: number;
    revenue: number;
    attributed: number;
    attributed_revenue: number;
  }[];
  daily: {
    date: string;
    total: number;
    attributed: number;
    revenue: number;
    attributed_revenue: number;
  }[];
}

@Component({
  selector: 'app-attribution-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButtonModule, MatIconModule],
  templateUrl: './attribution-dashboard.component.html',
  styleUrl: './attribution-dashboard.component.scss',
})
export class AttributionDashboardComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);

  stats = signal<AttributionStats | null>(null);
  loading = signal(false);
  selectedDays = signal(30);

  periods = [
    { days: 7, label: '7 дней' },
    { days: 30, label: '30 дней' },
    { days: 90, label: '90 дней' },
    { days: 365, label: 'Год' },
  ];

  private maxDaily = 0;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadStats(30);
    }
  }

  loadStats(days: number): void {
    this.selectedDays.set(days);
    this.loading.set(true);
    this.http.get<{ success: boolean } & AttributionStats>(
      `/api/bridge/attribution-stats?days=${days}`
    ).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.success) {
          this.stats.set(res as unknown as AttributionStats);
          this.maxDaily = Math.max(...(res.daily || []).map(d => d.total), 1);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  barHeight(value: number): number {
    return Math.max(2, (value / this.maxDaily) * 100);
  }

  calcPercent(part: number, total: number): number {
    return total > 0 ? Math.round(part * 100 / total) : 0;
  }

  formatMoney(amount: number): string {
    if (amount >= 1000000) return Math.round(amount / 1000000) + 'M\u20BD';
    if (amount >= 1000) return Math.round(amount / 1000) + 'K\u20BD';
    return Math.round(amount) + '\u20BD';
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  platformLabel(p: string): string {
    const labels: Record<string, string> = {
      yandex_direct: 'Яндекс.Директ',
      vk_ads: 'VK Реклама',
      google_ads: 'Google Ads',
      qr: 'QR-код',
    };
    return labels[p] || p;
  }

  sourceLabel(s: string): string {
    const labels: Record<string, string> = {
      kontur_market: 'Контур Маркет',
      chat_detection: 'Чат / мессенджер',
      ai_detection: 'AI-детекция',
      quick_sale: 'Быстрая касса',
    };
    return labels[s] || s;
  }
}
