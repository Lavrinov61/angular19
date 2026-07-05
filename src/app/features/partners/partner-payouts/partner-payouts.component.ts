import {
  Component, inject, signal, OnInit, ChangeDetectionStrategy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PartnerApiService, PartnerProfile, PartnerPayout } from '../services/partner-api.service';

@Component({
  selector: 'app-partner-payouts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe],
  template: `
<div class="pp-page">
  <h1 class="pp-title">Выплаты</h1>

  @if (partner()) {
    <!-- Request form -->
    <div class="pp-card">
      <div class="pp-card-title">Запросить выплату</div>
      <div class="pp-balance">
        Доступно: <strong>{{ +partner()!.balance | number:'1.0-0' }} ₽</strong>
      </div>

      @if (+partner()!.balance >= 10000) {
        <div class="pp-form">
          <div class="pp-field">
            <span class="pp-label" aria-label="Сумма">Сумма (₽)</span>
            <input type="number" class="pp-input"
              [max]="+partner()!.balance"
              min="10000" step="1000"
              [(ngModel)]="amount"
              placeholder="Введите сумму (мин. 10 000 ₽)" />
            <div class="pp-field-hint">Минимум: 10 000 ₽</div>
          </div>
          <div class="pp-field">
            <span class="pp-label" aria-label="Метод выплаты">Метод выплаты</span>
            <select class="pp-input" [(ngModel)]="method">
              <option value="card">Карта</option>
              <option value="phone">СБП по номеру телефона</option>
              <option value="bank_transfer">Банковский перевод</option>
            </select>
          </div>
          <button class="pp-btn-submit"
            [disabled]="submitting() || !amount || +amount < 10000 || +amount > +partner()!.balance"
            (click)="submitPayout()">
            @if (submitting()) { Отправляем... } @else { Запросить выплату }
          </button>
          @if (formError()) {
            <div class="pp-error">{{ formError() }}</div>
          }
          @if (formSuccess()) {
            <div class="pp-success">✅ Заявка отправлена! Выплата поступит в течение 24 часов.</div>
          }
        </div>
      } @else {
        <div class="pp-zero">
          @if (+partner()!.balance > 0) {
            Для вывода нужен минимальный баланс 10 000 ₽.
            Сейчас у вас <strong>{{ +partner()!.balance | number:'1.0-0' }} ₽</strong>.
          } @else {
            Баланс пуст, нет доступных средств для вывода.
          }
        </div>
      }
    </div>
  }

  <!-- History -->
  <div class="pp-history">
    <div class="pp-history-title">История выплат</div>
    @if (loading()) {
      <div class="pp-loading">Загрузка...</div>
    } @else if (payouts().length === 0) {
      <div class="pp-empty">Выплат пока не было</div>
    } @else {
      <div class="pp-table">
        <div class="pp-table-head">
          <span>Дата заявки</span>
          <span>Сумма</span>
          <span>Метод</span>
          <span>Статус</span>
          <span>Обработано</span>
        </div>
        @for (p of payouts(); track p.id) {
          <div class="pp-table-row">
            <span class="pp-date">{{ formatDate(p.created_at) }}</span>
            <span class="pp-amount">{{ +p.amount | number:'1.0-0' }} ₽</span>
            <span class="pp-method">{{ methodLabel(p.method) }}</span>
            <span class="pp-status" [class]="'pp-status--' + p.status">{{ statusLabel(p.status) }}</span>
            <span class="pp-processed">{{ p.processed_at ? formatDate(p.processed_at) : '-' }}</span>
          </div>
        }
      </div>
    }
  </div>
</div>
  `,
  styles: [`
    .pp-page { max-width: 800px; }
    .pp-title { font-size: 28px; font-weight: 700; color: #f5f5f5; margin: 0 0 28px; }
    .pp-card {
      padding: 28px; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; background: rgba(255,255,255,0.02);
      margin-bottom: 32px;
    }
    .pp-card-title { font-size: 17px; font-weight: 700; color: #f5f5f5; margin-bottom: 12px; }
    .pp-balance { font-size: 15px; color: #9ca3af; margin-bottom: 20px; strong { color: #f59e0b; font-size: 18px; } }
    .pp-form { display: flex; flex-direction: column; gap: 16px; max-width: 400px; }
    .pp-field { display: flex; flex-direction: column; gap: 6px; }
    .pp-label { font-size: 13px; color: #9ca3af; }
    .pp-input {
      padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05); color: #f5f5f5; font-size: 15px; outline: none;
      &:focus { border-color: #f59e0b; }
      option { background: #1a1a1a; }
    }
    .pp-btn-submit {
      padding: 12px 24px; border-radius: 8px; border: none;
      background: #f59e0b; color: #0a0a0a; font-weight: 700; font-size: 15px; cursor: pointer;
      &:hover:not(:disabled) { background: #fbbf24; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .pp-error { padding: 10px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; font-size: 13px; }
    .pp-success { padding: 10px 14px; border-radius: 8px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); color: #10b981; font-size: 13px; }
    .pp-zero { font-size: 14px; color: #9ca3af; }
    .pp-history { }
    .pp-history-title { font-size: 17px; font-weight: 700; color: #f5f5f5; margin-bottom: 16px; }
    .pp-loading { color: #9ca3af; }
    .pp-empty { color: #9ca3af; font-size: 14px; padding: 24px; text-align: center; }
    .pp-table { display: flex; flex-direction: column; gap: 2px; }
    .pp-table-head {
      display: grid; grid-template-columns: 90px 80px 1fr 100px 90px;
      padding: 8px 16px; font-size: 11px; color: #6b7280;
      text-transform: uppercase; letter-spacing: 1px;
    }
    .pp-table-row {
      display: grid; grid-template-columns: 90px 80px 1fr 100px 90px;
      padding: 14px 16px; border-radius: 8px; font-size: 14px;
      border: 1px solid rgba(255,255,255,0.06);
      &:hover { background: rgba(255,255,255,0.03); }
    }
    .pp-date { color: #9ca3af; font-size: 13px; }
    .pp-amount { font-weight: 700; color: #f5f5f5; }
    .pp-method { color: #d1d5db; }
    .pp-status { font-size: 12px; font-weight: 600; }
    .pp-status--pending { color: #f59e0b; }
    .pp-status--completed { color: #10b981; }
    .pp-status--failed, .pp-status--cancelled { color: #ef4444; }
    .pp-processed { color: #9ca3af; font-size: 13px; }

    @media (max-width: 600px) {
      .pp-table-head, .pp-table-row { grid-template-columns: 1fr 1fr; gap: 4px; }
    }
  `],
})
export class PartnerPayoutsComponent implements OnInit {
  private readonly partnerApi = inject(PartnerApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly partner = signal<PartnerProfile | null>(null);
  readonly payouts = signal<PartnerPayout[]>([]);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);
  readonly formSuccess = signal(false);
  amount = '';
  method = 'card';

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) { this.loading.set(false); return; }
    this.partnerApi.getProfile().subscribe(p => this.partner.set(p));
    this.loadPayouts();
  }

  private loadPayouts(): void {
    this.loading.set(true);
    this.partnerApi.getPayouts().subscribe({
      next: (p) => { this.payouts.set(p); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  submitPayout(): void {
    const amt = parseFloat(this.amount);
    if (!amt || amt <= 0) { this.formError.set('Введите корректную сумму'); return; }
    if (amt > +(this.partner()?.balance || 0)) {
      this.formError.set('Сумма превышает баланс'); return;
    }
    this.formError.set(null);
    this.submitting.set(true);
    this.partnerApi.requestPayout(amt, this.method).subscribe({
      next: () => {
        this.submitting.set(false);
        this.formSuccess.set(true);
        this.amount = '';
        this.partnerApi.getProfile().subscribe(p => this.partner.set(p));
        this.loadPayouts();
        setTimeout(() => this.formSuccess.set(false), 5000);
      },
      error: (err) => {
        this.submitting.set(false);
        this.formError.set(err?.error?.error || 'Ошибка при запросе выплаты');
      },
    });
  }

  methodLabel(m: string): string {
    const l: Record<string, string> = { card: 'Карта', phone: 'СБП', bank_transfer: 'Банк' };
    return l[m] || m;
  }

  statusLabel(s: string): string {
    const l: Record<string, string> = { pending: 'Ожидает', completed: 'Выплачено', failed: 'Ошибка', cancelled: 'Отменено' };
    return l[s] || s;
  }

  formatDate(s: string): string {
    return new Date(s).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
}
