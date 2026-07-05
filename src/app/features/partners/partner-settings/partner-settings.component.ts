import {
  Component, inject, signal, OnInit, ChangeDetectionStrategy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PartnerApiService, PartnerProfile } from '../services/partner-api.service';

@Component({
  selector: 'app-partner-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
<div class="ps-page">
  <h1 class="ps-title">Настройки</h1>

  @if (loading()) {
    <div class="ps-loading">Загрузка...</div>
  } @else if (partner()) {
    <!-- Partner info (read-only) -->
    <div class="ps-card">
      <div class="ps-card-title">Информация о партнёре</div>
      <div class="ps-info-grid">
        <div class="ps-info-row">
          <span class="ps-info-key">Тип партнёра</span>
          <span class="ps-info-val">{{ typeLabel(partner()!.type) }}</span>
        </div>
        <div class="ps-info-row">
          <span class="ps-info-key">Статус</span>
          <span class="ps-info-val ps-status" [class]="'ps-status--' + partner()!.status">{{ statusLabel(partner()!.status) }}</span>
        </div>
        <div class="ps-info-row">
          <span class="ps-info-key">Промокод</span>
          <span class="ps-info-val ps-mono">{{ partner()!.promo_code || '-' }}</span>
        </div>
        <div class="ps-info-row">
          <span class="ps-info-key">Реферальная ссылка</span>
          <span class="ps-info-val ps-link-text">{{ partner()!.referral_url || '-' }}</span>
        </div>
        <div class="ps-info-row">
          <span class="ps-info-key">Ставка комиссии</span>
          <span class="ps-info-val ps-accent">{{ partner()!.commission_rate }}%</span>
        </div>
      </div>
    </div>

    <!-- Payout details -->
    <div class="ps-card">
      <div class="ps-card-title">Реквизиты для выплат</div>
      <div class="ps-form">
        <div class="ps-field">
          <span class="ps-label" aria-label="Номер карты">Номер карты</span>
          <input type="text" class="ps-input" placeholder="0000 0000 0000 0000"
            [(ngModel)]="cardNumber" />
        </div>
        <div class="ps-field">
          <span class="ps-label" aria-label="Номер телефона для СБП">Номер телефона для СБП</span>
          <input type="tel" class="ps-input" placeholder="+7 (000) 000-00-00"
            [(ngModel)]="sbpPhone" />
        </div>
        <div class="ps-field">
          <span class="ps-label" aria-label="Банковские реквизиты">Банковские реквизиты</span>
          <textarea class="ps-input ps-textarea" placeholder="БИК, расчётный счёт, наименование банка..."
            [(ngModel)]="bankDetails" rows="3"></textarea>
        </div>
        <button class="ps-btn-save" [disabled]="saving()" (click)="save()">
          @if (saving()) { Сохраняем... } @else { Сохранить реквизиты }
        </button>
        @if (saveError()) {
          <div class="ps-error">{{ saveError() }}</div>
        }
        @if (saveSuccess()) {
          <div class="ps-success">✅ Реквизиты сохранены</div>
        }
      </div>
    </div>

    <!-- Support -->
    <div class="ps-support">
      <div class="ps-support-title">Нужна помощь?</div>
      <div class="ps-support-desc">По вопросам партнёрской программы: <a href="tel:+78633226575">+7 (863) 322-65-75</a> или <a href="https://t.me/magnus_photo">&#64;magnus_photo</a></div>
    </div>
  }
</div>
  `,
  styles: [`
    .ps-page { max-width: 700px; }
    .ps-title { font-size: 28px; font-weight: 700; color: #f5f5f5; margin: 0 0 28px; }
    .ps-loading { color: #9ca3af; padding: 40px 0; }
    .ps-card {
      padding: 28px; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; background: rgba(255,255,255,0.02);
      margin-bottom: 24px;
    }
    .ps-card-title { font-size: 17px; font-weight: 700; color: #f5f5f5; margin-bottom: 20px; }
    .ps-info-grid { display: flex; flex-direction: column; gap: 12px; }
    .ps-info-row { display: flex; gap: 16px; align-items: flex-start; }
    .ps-info-key { font-size: 13px; color: #9ca3af; min-width: 160px; }
    .ps-info-val { font-size: 14px; color: #f5f5f5; word-break: break-all; }
    .ps-mono { font-family: 'Courier New', monospace; color: #f59e0b; font-size: 16px; letter-spacing: 1px; }
    .ps-link-text { color: #9ca3af; font-size: 13px; }
    .ps-accent { color: #f59e0b; font-weight: 700; }
    .ps-status { font-size: 12px; font-weight: 700; }
    .ps-status--approved { color: #10b981; }
    .ps-status--pending { color: #f59e0b; }
    .ps-status--suspended, .ps-status--rejected { color: #ef4444; }
    .ps-form { display: flex; flex-direction: column; gap: 16px; }
    .ps-field { display: flex; flex-direction: column; gap: 6px; }
    .ps-label { font-size: 13px; color: #9ca3af; }
    .ps-input {
      padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05); color: #f5f5f5; font-size: 15px; outline: none;
      &:focus { border-color: #f59e0b; }
    }
    .ps-textarea { resize: vertical; font-family: inherit; }
    .ps-btn-save {
      padding: 12px 24px; border-radius: 8px; border: none; width: fit-content;
      background: #f59e0b; color: #0a0a0a; font-weight: 700; font-size: 15px; cursor: pointer;
      &:hover:not(:disabled) { background: #fbbf24; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .ps-error { padding: 10px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; font-size: 13px; }
    .ps-success { padding: 10px 14px; border-radius: 8px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); color: #10b981; font-size: 13px; }
    .ps-support { padding: 20px 24px; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; }
    .ps-support-title { font-size: 15px; font-weight: 700; color: #f5f5f5; margin-bottom: 8px; }
    .ps-support-desc { font-size: 14px; color: #9ca3af; a { color: #f59e0b; text-decoration: none; } }
  `],
})
export class PartnerSettingsComponent implements OnInit {
  private readonly partnerApi = inject(PartnerApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly partner = signal<PartnerProfile | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saveSuccess = signal(false);

  cardNumber = '';
  sbpPhone = '';
  bankDetails = '';

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) { this.loading.set(false); return; }
    this.partnerApi.getProfile().subscribe({
      next: (p) => {
        this.partner.set(p);
        const d = p.payout_details as Record<string, string>;
        this.cardNumber = d['card'] || '';
        this.sbpPhone = d['sbp_phone'] || '';
        this.bankDetails = d['bank'] || '';
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  save(): void {
    this.saveError.set(null);
    this.saving.set(true);
    const details: Record<string, unknown> = {};
    if (this.cardNumber.trim()) details['card'] = this.cardNumber.trim();
    if (this.sbpPhone.trim()) details['sbp_phone'] = this.sbpPhone.trim();
    if (this.bankDetails.trim()) details['bank'] = this.bankDetails.trim();

    this.partnerApi.updateProfile(details).subscribe({
      next: (p) => {
        this.partner.set(p);
        this.saving.set(false);
        this.saveSuccess.set(true);
        setTimeout(() => this.saveSuccess.set(false), 3000);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.error || 'Ошибка сохранения');
      },
    });
  }

  typeLabel(t: string): string {
    const l: Record<string, string> = { referral: 'Реферальный', business: 'Бизнес', affiliate: 'Блогер' };
    return l[t] || t;
  }

  statusLabel(s: string): string {
    const l: Record<string, string> = { approved: 'Активен', pending: 'На рассмотрении', suspended: 'Приостановлен', rejected: 'Отклонён' };
    return l[s] || s;
  }
}
