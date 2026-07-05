import {
  Component, inject, signal, OnInit, ChangeDetectionStrategy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { PartnerApiService, PartnerReferral } from '../services/partner-api.service';

@Component({
  selector: 'app-partner-referrals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
<div class="pr-page">
  <div class="pr-header">
    <h1 class="pr-title">Рефералы</h1>
    @if (!loading()) {
      <div class="pr-summary">
        <span>Всего: <strong>{{ total() }}</strong></span>
        <span>Общая комиссия: <strong>{{ +totalCommission() | number:'1.0-0' }} ₽</strong></span>
      </div>
    }
  </div>

  <div class="pr-filters">
    <button class="pr-filter-btn" [class.pr-filter-btn--active]="statusFilter() === ''"
      (click)="setFilter('')">Все</button>
    <button class="pr-filter-btn" [class.pr-filter-btn--active]="statusFilter() === 'confirmed'"
      (click)="setFilter('confirmed')">Подтверждённые</button>
    <button class="pr-filter-btn" [class.pr-filter-btn--active]="statusFilter() === 'pending'"
      (click)="setFilter('pending')">Ожидают</button>
  </div>

  @if (loading()) {
    <div class="pr-loading">Загрузка...</div>
  } @else if (referrals().length === 0) {
    <div class="pr-empty">
      <div class="pr-empty-icon">👥</div>
      <div class="pr-empty-title">Рефералов пока нет</div>
      <div class="pr-empty-desc">Поделитесь промокодом и здесь появятся ваши клиенты</div>
    </div>
  } @else {
    <div class="pr-table">
      <div class="pr-table-head">
        <span>Дата</span>
        <span>Тип услуги</span>
        <span>Сумма заказа</span>
        <span>Комиссия</span>
        <span>Статус</span>
      </div>
      @for (r of referrals(); track r.id) {
        <div class="pr-table-row">
          <span class="pr-date">{{ formatDate(r.created_at) }}</span>
          <span class="pr-type">{{ r.order_type }}</span>
          <span class="pr-amount">{{ +r.order_amount | number:'1.0-0' }} ₽</span>
          <span class="pr-commission">+{{ +r.commission_amount | number:'1.0-0' }} ₽</span>
          <span class="pr-status" [class]="'pr-status--' + r.status">{{ statusLabel(r.status) }}</span>
        </div>
      }
    </div>

    @if (total() > pageSize) {
      <div class="pr-pagination">
        <button class="pr-page-btn" [disabled]="offset() === 0" (click)="prevPage()">← Назад</button>
        <span class="pr-page-info">{{ offset() / pageSize + 1 }} / {{ Math.ceil(total() / pageSize) }}</span>
        <button class="pr-page-btn" [disabled]="offset() + pageSize >= total()" (click)="nextPage()">Вперёд →</button>
      </div>
    }
  }
</div>
  `,
  styles: [`
    .pr-page { max-width: 900px; }
    .pr-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
    .pr-title { font-size: 28px; font-weight: 700; color: #f5f5f5; margin: 0; }
    .pr-summary { display: flex; gap: 20px; font-size: 14px; color: #9ca3af; strong { color: #f5f5f5; } }
    .pr-filters { display: flex; gap: 8px; margin-bottom: 20px; }
    .pr-filter-btn {
      padding: 7px 16px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);
      background: transparent; color: #9ca3af; font-size: 13px; cursor: pointer;
      &:hover { border-color: rgba(245,158,11,0.4); color: #f5f5f5; }
    }
    .pr-filter-btn--active { border-color: #f59e0b; color: #f59e0b; background: rgba(245,158,11,0.08); }
    .pr-loading { color: #9ca3af; padding: 40px 0; }
    .pr-empty { text-align: center; padding: 60px 24px; }
    .pr-empty-icon { font-size: 48px; margin-bottom: 16px; }
    .pr-empty-title { font-size: 20px; font-weight: 700; color: #f5f5f5; margin-bottom: 8px; }
    .pr-empty-desc { font-size: 14px; color: #9ca3af; }
    .pr-table { display: flex; flex-direction: column; gap: 2px; }
    .pr-table-head {
      display: grid; grid-template-columns: 90px 1fr 100px 100px 100px;
      padding: 8px 16px; font-size: 11px; color: #6b7280;
      text-transform: uppercase; letter-spacing: 1px;
    }
    .pr-table-row {
      display: grid; grid-template-columns: 90px 1fr 100px 100px 100px;
      padding: 14px 16px; border-radius: 8px; font-size: 14px;
      border: 1px solid rgba(255,255,255,0.06);
      &:hover { background: rgba(255,255,255,0.03); }
    }
    .pr-date { color: #9ca3af; font-size: 13px; }
    .pr-type { color: #d1d5db; }
    .pr-amount { color: #f5f5f5; font-weight: 600; }
    .pr-commission { color: #10b981; font-weight: 700; }
    .pr-status { font-size: 12px; font-weight: 600; }
    .pr-status--confirmed { color: #10b981; }
    .pr-status--pending { color: #f59e0b; }
    .pr-status--cancelled { color: #ef4444; }
    .pr-pagination { display: flex; align-items: center; gap: 16px; margin-top: 20px; justify-content: center; }
    .pr-page-btn {
      padding: 8px 18px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);
      background: transparent; color: #9ca3af; font-size: 14px; cursor: pointer;
      &:disabled { opacity: 0.4; cursor: not-allowed; }
      &:not(:disabled):hover { border-color: #f59e0b; color: #f59e0b; }
    }
    .pr-page-info { font-size: 14px; color: #9ca3af; }

    @media (max-width: 600px) {
      .pr-table-head, .pr-table-row { grid-template-columns: 1fr 1fr; gap: 4px; }
    }
  `],
})
export class PartnerReferralsComponent implements OnInit {
  protected readonly Math = Math;
  private readonly partnerApi = inject(PartnerApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly referrals = signal<PartnerReferral[]>([]);
  readonly total = signal(0);
  readonly totalCommission = signal('0');
  readonly loading = signal(true);
  readonly statusFilter = signal('');
  readonly offset = signal(0);
  readonly pageSize = 20;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) { this.loading.set(false); return; }
    this.loadReferrals();
  }

  setFilter(status: string): void {
    this.statusFilter.set(status);
    this.offset.set(0);
    this.loadReferrals();
  }

  prevPage(): void { this.offset.update(o => Math.max(0, o - this.pageSize)); this.loadReferrals(); }
  nextPage(): void { this.offset.update(o => o + this.pageSize); this.loadReferrals(); }

  private loadReferrals(): void {
    this.loading.set(true);
    this.partnerApi.getReferrals(this.pageSize, this.offset()).subscribe({
      next: (r) => {
        this.referrals.set(r.data);
        this.total.set(r.total);
        this.totalCommission.set(r.total_commission);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  statusLabel(s: string): string {
    const m: Record<string, string> = { confirmed: 'Подтверждён', pending: 'Ожидает', cancelled: 'Отменён' };
    return m[s] || s;
  }

  formatDate(s: string): string {
    return new Date(s).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
}
