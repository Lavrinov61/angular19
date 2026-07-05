import {
  Component, inject, signal, computed, OnInit, ChangeDetectionStrategy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PartnerApiService, PartnerProfile, PartnerReferral, MonthlyStats } from '../services/partner-api.service';

interface LandingLink { title: string; url: string; }

@Component({
  selector: 'app-partner-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe],
  template: `
<div class="po-page">
  <h1 class="po-title">Обзор</h1>

  @if (loading()) {
    <div class="po-loading">Загрузка...</div>
  } @else if (partner()) {
    <!-- KPI cards -->
    <div class="po-kpi">
      <div class="po-kpi-card po-kpi-card--accent">
        <div class="po-kpi-label">Баланс</div>
        <div class="po-kpi-val">{{ +partner()!.balance | number:'1.0-0' }} ₽</div>
        <div class="po-kpi-sub">доступно к выводу</div>
      </div>
      <div class="po-kpi-card">
        <div class="po-kpi-label">Всего заработано</div>
        <div class="po-kpi-val">{{ +partner()!.total_earned | number:'1.0-0' }} ₽</div>
        <div class="po-kpi-sub">за всё время</div>
      </div>
      <div class="po-kpi-card">
        <div class="po-kpi-label">Комиссия</div>
        <div class="po-kpi-val">{{ partner()!.commission_rate }}%</div>
        <div class="po-kpi-sub">от суммы заказа</div>
      </div>
      <div class="po-kpi-card">
        <div class="po-kpi-label">Рефералов</div>
        <div class="po-kpi-val">{{ totalReferrals() }}</div>
        <div class="po-kpi-sub">всего клиентов</div>
      </div>
    </div>

    <!-- Promo block -->
    <div class="po-promo-block">
      <div class="po-promo-section">
        <div class="po-promo-label">Ваш промокод</div>
        <div class="po-promo-code">
          <span class="po-promo-val">{{ partner()!.promo_code || '-' }}</span>
          <button class="po-copy-btn" (click)="copy(partner()!.promo_code || '')">
            {{ copied() === 'code' ? '✓ Скопировано' : 'Копировать' }}
          </button>
        </div>
      </div>
      <div class="po-promo-section">
        <div class="po-promo-label">Реферальная ссылка</div>
        <div class="po-promo-link-row">
          <span class="po-promo-link-text">{{ partner()!.referral_url || '-' }}</span>
          <button class="po-copy-btn" (click)="copy(partner()!.referral_url || '')">
            {{ copied() === 'url' ? '✓ Скопировано' : 'Копировать' }}
          </button>
        </div>
      </div>
      <div class="po-share-row">
        <div class="po-share-label">Поделиться:</div>
        <a [href]="shareMax()" target="_blank" class="po-share-btn po-share-btn--max">
          <img src="/assets/icons/channel-max.svg" alt="">
          <span>МАКС</span>
        </a>
        <a [href]="shareTelegram()" target="_blank" class="po-share-btn po-share-btn--tg">
          <img src="/assets/icons/channel-telegram.svg" alt="">
          <span>Telegram</span>
        </a>
        <a [href]="shareVK()" target="_blank" class="po-share-btn po-share-btn--vk">
          <img src="/assets/icons/channel-vk.svg" alt="">
          <span>VK</span>
        </a>
        <div class="po-share-spacer"></div>
        <button class="po-regen-btn" [disabled]="regenLoading()" (click)="regeneratePromo()">
          {{ regenLoading() ? 'Генерируем...' : '↺ Новый промокод' }}
        </button>
      </div>
    </div>

    <!-- Генератор ссылок -->
    <div class="po-links-block">
      <div class="po-links-header">
        <div class="po-links-title">Ваши реферальные ссылки</div>
        <button class="po-copy-btn" [disabled]="linksLoading()" (click)="loadLandingLinks()">
          {{ landingLinks().length > 0 ? 'Обновить' : 'Показать ссылки' }}
        </button>
      </div>
      @if (linksLoading()) {
        <div class="po-links-loading">Загрузка...</div>
      } @else if (landingLinks().length > 0) {
        <div class="po-links-table">
          @for (link of landingLinks(); track link.url) {
            <div class="po-link-row">
              <span class="po-link-title">{{ link.title }}</span>
              <span class="po-link-url">{{ link.url }}</span>
              <button class="po-copy-btn po-copy-btn--sm" (click)="copyLink(link.url, $index)">
                {{ copiedLinkIdx() === $index ? '✓' : 'Копировать' }}
              </button>
            </div>
          }
        </div>
      }
    </div>

    <!-- Chart -->
    @if (stats().length > 0) {
      <div class="po-chart-block">
        <div class="po-chart-title">Заработок по месяцам</div>
        <div class="po-chart">
          @for (bar of chartBars(); track bar.month) {
            <div class="po-chart-col">
              <div class="po-chart-bar-wrap">
                <div class="po-chart-bar" [style.height.%]="bar.heightPct"
                  [class.po-chart-bar--current]="bar.isCurrent"
                  [title]="bar.label"></div>
              </div>
              <div class="po-chart-mon">{{ bar.monthLabel }}</div>
            </div>
          }
        </div>
      </div>
    }

    <!-- Recent referrals -->
    <div class="po-recent">
      <div class="po-recent-header">
        <div class="po-recent-title">Последние рефералы</div>
        <a routerLink="../referrals" class="po-recent-link">Показать все →</a>
      </div>
      @if (recentReferrals().length === 0) {
        <div class="po-empty">Рефералов пока нет. Поделитесь промокодом!</div>
      } @else {
        <div class="po-referrals-list">
          @for (r of recentReferrals(); track r.id) {
            <div class="po-ref-row">
              <div class="po-ref-date">{{ formatDate(r.created_at) }}</div>
              <div class="po-ref-type">{{ r.order_type }}</div>
              <div class="po-ref-amount">{{ +r.order_amount | number:'1.0-0' }} ₽</div>
              <div class="po-ref-commission">+{{ +r.commission_amount | number:'1.0-0' }} ₽</div>
              <div class="po-ref-status" [class]="'po-status--' + r.status">{{ r.status }}</div>
            </div>
          }
        </div>
      }
    </div>

    <!-- Withdraw CTA -->
    @if (+partner()!.balance > 0) {
      <div class="po-withdraw-cta" [class.po-withdraw-cta--dim]="+partner()!.balance < 10000">
        <div class="po-withdraw-text">
          На балансе <strong>{{ +partner()!.balance | number:'1.0-0' }} ₽</strong>
          @if (+partner()!.balance < 10000) {
            <span class="po-min-hint"> · Минимум для вывода: 10 000 ₽</span>
          }
        </div>
        <a routerLink="../payouts" class="po-btn-amber"
          [class.po-btn-amber--disabled]="+partner()!.balance < 10000">
          Вывести деньги →
        </a>
      </div>
    }
  }
</div>
  `,
  styles: [`
    .po-page { max-width: 900px; }
    .po-title { font-size: 28px; font-weight: 700; color: #f5f5f5; margin: 0 0 28px; }
    .po-loading { color: #9ca3af; padding: 40px 0; }

    .po-kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .po-kpi-card {
      padding: 20px; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; background: rgba(255,255,255,0.03);
    }
    .po-kpi-card--accent { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.05); }
    .po-kpi-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .po-kpi-val { font-size: 26px; font-weight: 700; color: #f5f5f5; line-height: 1; margin-bottom: 4px; }
    .po-kpi-card--accent .po-kpi-val { color: #f59e0b; }
    .po-kpi-sub { font-size: 12px; color: #6b7280; }

    .po-promo-block {
      padding: 24px; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; background: rgba(255,255,255,0.02);
      margin-bottom: 24px; display: flex; flex-direction: column; gap: 16px;
    }
    .po-promo-section {}
    .po-promo-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .po-promo-code { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .po-promo-val {
      font-family: 'Courier New', monospace; font-size: 28px; font-weight: 700;
      color: #f59e0b; letter-spacing: 2px;
    }
    .po-promo-link-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .po-promo-link-text { font-size: 14px; color: #9ca3af; word-break: break-all; }
    .po-copy-btn {
      padding: 8px 16px; border-radius: 6px; border: 1px solid rgba(245,158,11,0.4);
      background: transparent; color: #f59e0b; font-size: 13px; cursor: pointer;
      white-space: nowrap;
      &:hover { background: rgba(245,158,11,0.1); }
    }
    .po-share-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .po-share-label { font-size: 13px; color: #9ca3af; }
    .po-share-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600;
      text-decoration: none; border: none; cursor: pointer;
    }
    .po-share-btn img { width: 16px; height: 16px; display: block; }
    .po-share-btn--max { background: rgba(0,87,255,0.15); color: #0057FF; }
    .po-share-btn--tg { background: rgba(0,136,204,0.15); color: #0088cc; }
    .po-share-btn--vk { background: rgba(45,140,255,0.15); color: #2d8cff; }

    .po-chart-block {
      padding: 24px; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; background: rgba(255,255,255,0.02);
      margin-bottom: 24px;
    }
    .po-chart-title { font-size: 15px; font-weight: 700; color: #f5f5f5; margin-bottom: 20px; }
    .po-chart { display: flex; gap: 8px; align-items: flex-end; height: 120px; }
    .po-chart-col { display: flex; flex-direction: column; align-items: center; flex: 1; }
    .po-chart-bar-wrap { flex: 1; display: flex; align-items: flex-end; width: 100%; }
    .po-chart-bar {
      width: 100%; border-radius: 4px 4px 0 0;
      background: rgba(245,158,11,0.3); min-height: 4px;
      transition: height 0.3s ease;
    }
    .po-chart-bar--current { background: #f59e0b; }
    .po-chart-mon { font-size: 11px; color: #6b7280; margin-top: 4px; }

    .po-recent { margin-bottom: 24px; }
    .po-recent-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .po-recent-title { font-size: 17px; font-weight: 700; color: #f5f5f5; }
    .po-recent-link { font-size: 13px; color: #f59e0b; text-decoration: none; &:hover { text-decoration: underline; } }
    .po-empty { color: #9ca3af; font-size: 14px; padding: 24px; text-align: center; }

    .po-referrals-list { display: flex; flex-direction: column; gap: 2px; }
    .po-ref-row {
      display: grid; grid-template-columns: 100px 1fr 90px 90px 80px;
      padding: 12px 16px; border-radius: 8px; font-size: 14px;
      border: 1px solid rgba(255,255,255,0.06);
      &:hover { background: rgba(255,255,255,0.03); }
    }
    .po-ref-date { color: #9ca3af; font-size: 13px; }
    .po-ref-type { color: #d1d5db; }
    .po-ref-amount { color: #f5f5f5; font-weight: 600; }
    .po-ref-commission { color: #10b981; font-weight: 700; }
    .po-status--confirmed { color: #10b981; font-size: 12px; }
    .po-status--pending { color: #f59e0b; font-size: 12px; }
    .po-status--cancelled { color: #ef4444; font-size: 12px; }

    .po-withdraw-cta {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 24px; border: 1px solid rgba(245,158,11,0.3);
      border-radius: 12px; background: rgba(245,158,11,0.05);
      flex-wrap: wrap; gap: 16px;
    }
    .po-withdraw-cta--dim { border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
    .po-withdraw-text { font-size: 16px; color: #d1d5db; strong { color: #f59e0b; } }
    .po-min-hint { font-size: 13px; color: #9ca3af; }
    .po-btn-amber {
      padding: 12px 24px; border-radius: 6px;
      background: #f59e0b; color: #0a0a0a;
      font-weight: 700; font-size: 14px; text-decoration: none; border: none; cursor: pointer;
      &:hover { background: #fbbf24; }
    }
    .po-btn-amber--disabled {
      opacity: 0.4; pointer-events: none;
    }

    /* Regen promo button */
    .po-share-spacer { flex: 1; }
    .po-regen-btn {
      padding: 6px 12px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.12);
      background: transparent; color: #9ca3af; font-size: 12px; cursor: pointer;
      &:hover:not(:disabled) { border-color: rgba(245,158,11,0.4); color: #f59e0b; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    /* Landing links generator */
    .po-links-block {
      padding: 24px; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; background: rgba(255,255,255,0.02);
      margin-bottom: 24px;
    }
    .po-links-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .po-links-title { font-size: 15px; font-weight: 700; color: #f5f5f5; }
    .po-links-loading { color: #9ca3af; font-size: 14px; }
    .po-links-table { display: flex; flex-direction: column; gap: 4px; }
    .po-link-row {
      display: grid; grid-template-columns: 200px 1fr auto;
      gap: 12px; padding: 10px 12px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.06); align-items: center;
      &:hover { background: rgba(255,255,255,0.02); }
    }
    .po-link-title { font-size: 13px; color: #d1d5db; font-weight: 500; }
    .po-link-url { font-size: 12px; color: #6b7280; word-break: break-all; }
    .po-copy-btn--sm { padding: 6px 10px; font-size: 12px; white-space: nowrap; }

    @media (max-width: 768px) {
      .po-kpi { grid-template-columns: repeat(2, 1fr); }
      .po-ref-row { grid-template-columns: 1fr 1fr; gap: 4px; }
    }
  `],
})
export class PartnerOverviewComponent implements OnInit {
  private readonly partnerApi = inject(PartnerApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly partner = signal<PartnerProfile | null>(null);
  readonly stats = signal<MonthlyStats[]>([]);
  readonly recentReferrals = signal<PartnerReferral[]>([]);
  readonly totalReferrals = signal(0);
  readonly loading = signal(true);
  readonly copied = signal<string | null>(null);
  readonly regenLoading = signal(false);
  readonly landingLinks = signal<LandingLink[]>([]);
  readonly linksLoading = signal(false);
  readonly copiedLinkIdx = signal<number | null>(null);

  readonly chartBars = computed(() => {
    const data = this.stats().slice(0, 6).reverse();
    const maxVal = Math.max(...data.map(s => +s.total_commission), 1);
    const now = new Date();
    return data.map(s => {
      const d = new Date(s.month);
      return {
        month: s.month,
        monthLabel: d.toLocaleDateString('ru', { month: 'short' }),
        heightPct: Math.round((+s.total_commission / maxVal) * 100),
        isCurrent: d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(),
        label: `${d.toLocaleDateString('ru', { month: 'long' })}: ${(+s.total_commission).toLocaleString('ru')} ₽`,
      };
    });
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) { this.loading.set(false); return; }
    this.partnerApi.getProfile().subscribe({
      next: (p) => {
        this.partner.set(p);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.partnerApi.getStats().subscribe(s => this.stats.set(s));
    this.partnerApi.getReferrals(5).subscribe(r => {
      this.recentReferrals.set(r.data);
      this.totalReferrals.set(r.total);
    });
  }

  copy(text: string): void {
    if (!isPlatformBrowser(this.platformId) || !text) return;
    globalThis.navigator?.clipboard?.writeText(text);
    const key = text.startsWith('http') ? 'url' : 'code';
    this.copied.set(key);
    setTimeout(() => this.copied.set(null), 2000);
  }

  shareMax(): string {
    const url = this.partner()?.referral_url || '';
    return `https://max.ru/id262603741214_bot?text=${encodeURIComponent(`Записывайтесь в фотостудию Своё Фото по моей ссылке: ${url}`)}`;
  }

  shareTelegram(): string {
    const url = this.partner()?.referral_url || '';
    return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent('Фотостудия Своё Фото, фото на документы, портреты, печать. Записывайтесь!')}`;
  }

  shareVK(): string {
    const url = this.partner()?.referral_url || '';
    return `https://vk.com/share.php?url=${encodeURIComponent(url)}`;
  }

  regeneratePromo(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const confirmed = window.confirm(
      'Сгенерировать новый промокод?\n\nСтарый промокод перестанет работать для новых клиентов.'
    );
    if (!confirmed) return;

    this.regenLoading.set(true);
    this.partnerApi.regeneratePromo().subscribe({
      next: (data) => {
        const p = this.partner();
        if (p) {
          this.partner.set({ ...p, promo_code: data.promo_code, referral_url: data.referral_url });
          // Обновить ссылки если уже загружены
          if (this.landingLinks().length > 0) {
            this.loadLandingLinks();
          }
        }
      },
      error: (err) => alert(err?.error?.error || 'Ошибка перегенерации промокода'),
      complete: () => this.regenLoading.set(false),
    });
  }

  loadLandingLinks(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.linksLoading.set(true);
    this.partnerApi.getLandingLinks().subscribe({
      next: (links) => this.landingLinks.set(links),
      error: () => this.linksLoading.set(false),
      complete: () => this.linksLoading.set(false),
    });
  }

  copyLink(url: string, idx: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard.writeText(url);
    this.copiedLinkIdx.set(idx);
    setTimeout(() => this.copiedLinkIdx.set(null), 2000);
  }

  formatDate(s: string): string {
    return new Date(s).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
  }
}
