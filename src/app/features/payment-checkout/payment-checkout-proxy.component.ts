import { Component, ChangeDetectionStrategy, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/**
 * Proxy компонент для платёжных ссылок от Actions API.
 *
 * Backend (/api/actions/pay/:token) уже возвращает готовый HTML с платёжной формой.
 * Компонент просто редиректит на API endpoint, где пользователь видит форму оплаты.
 */
@Component({
  selector: 'app-payment-checkout-proxy',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinnerModule],
  template: `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 16px;">
      <mat-spinner diameter="40" />
      <p style="color: var(--ed-on-surface-variant, #a0a0a0); font-size: 14px;">Загрузка платёжной формы...</p>
    </div>
  `,
})
export class PaymentCheckoutProxyComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  ngOnInit(): void {
    const code = this.route.snapshot.paramMap.get('code');
    if (code) {
      // Редирект на backend endpoint, где возвращается готовая HTML-форма оплаты
      window.location.href = `/api/actions/pay/${encodeURIComponent(code)}`;
    }
  }
}
