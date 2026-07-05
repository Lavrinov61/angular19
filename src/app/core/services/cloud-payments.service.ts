import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';
import { CartItem, calcItemSubtotal } from '../../features/chat-page/services/cart.service';
import { PricingApiService } from './pricing-api.service';
import { AuthService } from './auth.service';

/**
 * Результат оплаты CloudPayments
 */
export interface PaymentResult {
  success: boolean;
  transactionId?: number;
  error?: string;
}

export type SubscriptionPaymentConfirmationStatus =
  | 'confirmed'
  | 'already_processed'
  | 'pending_payment'
  | 'failed'
  | (string & {});

export interface SubscriptionPaymentConfirmationResult {
  success: boolean;
  status: SubscriptionPaymentConfirmationStatus;
  subscription_id?: string;
  error?: string;
}

/**
 * Позиция чека CloudKassir (ФФД 1.05/1.2)
 */
interface ReceiptItem {
  label: string;
  price: number;
  quantity: number;
  amount: number;
  vat: number | null;
  method: number;
  object: number;
  measurementUnit: string;
}

/**
 * Объект чека для CloudKassir
 */
interface Receipt {
  items: ReceiptItem[];
  taxationSystem: number;
  email?: string;
  phone?: string;
  amounts: {
    electronic: number;
    advancePayment: number;
    credit: number;
    provision: number;
  };
}

// Типизация CloudPayments Widget
declare const cp: {
  CloudPayments: new () => {
    start(params: Record<string, unknown>): Promise<{
      type?: string;
      status?: string;
      data?: { transactionId?: number };
      transactionId?: number;
    }>;
  };
};

/**
 * Сервис для интеграции с CloudPayments Widget
 *
 * Подход: Widget (iframe popup) — не требует PCI DSS сертификации,
 * карточные данные не касаются нашего сервера.
 */
@Injectable({ providedIn: 'root' })
export class CloudPaymentsService {
  private platformId = inject(PLATFORM_ID);
  private pricingApi = inject(PricingApiService);
  private auth = inject(AuthService);
  private scriptLoaded = false;

  readonly isLoading = signal(false);

  async loadScript(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.scriptLoaded) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      if (typeof cp !== 'undefined' && cp.CloudPayments) {
        this.scriptLoaded = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://widget.cloudpayments.ru/bundles/cloudpayments.js';
      script.async = true;
      script.onload = () => {
        this.scriptLoaded = true;
        resolve();
      };
      script.onerror = () =>
        reject(new Error('Не удалось загрузить CloudPayments'));
      document.head.appendChild(script);
    });
  }

  async pay(
    orderId: string,
    items: CartItem[],
    email?: string,
    phone?: string,
    discount?: number,
    /** Если передан — используется вместо пересчёта из items (source of truth: бэкенд) */
    serverTotal?: number,
  ): Promise<PaymentResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return { success: false, error: 'Оплата недоступна на сервере' };
    }

    this.isLoading.set(true);

    try {
      await this.loadScript();

      let total: number;
      if (serverTotal != null && serverTotal > 0) {
        // Checkout page: total от бэкенда, items только для receipt
        total = serverTotal;
      } else {
        // Cart flow: total считается из items
        total = items.reduce(
          (sum, item) => sum + calcItemSubtotal(item),
          0,
        );
      }
      if (discount && discount > 0) {
        total = Math.max(0, total - discount);
      }

      await this.validatePricingItems(items);

      const receipt = this.buildReceipt(items, total, email, phone);
      const widgetItems = this.buildWidgetItems(items);

      const config = environment.cloudPayments;

      const isAuth = this.auth.isAuthenticated();

      const intentParams: Record<string, unknown> = {
        publicTerminalId: config.publicTerminalId,
        description: `Заказ ${orderId} — Своё Фото`,
        paymentSchema: 'Single',
        currency: config.currency,
        amount: total,
        skin: config.skin,
        autoClose: 3,
        externalId: orderId,
        items: widgetItems,
        receipt,
        retryPayment: true,
        tokenize: isAuth,
        emailBehavior: email ? 'Hidden' : 'Optional',
        metadata: {
          orderId,
          source: 'online_services',
        },
      };

      if (email || phone) {
        const userInfo: Record<string, string> = {
          accountId: orderId,
        };
        if (email) userInfo['email'] = email;
        if (phone) userInfo['phone'] = phone;
        intentParams['userInfo'] = userInfo;
      }

      if (email) {
        intentParams['receiptEmail'] = email;
      }

      const widget = new cp.CloudPayments();
      const result = await widget.start(intentParams);

      this.isLoading.set(false);

      const txId = result?.data?.transactionId ?? result?.transactionId;

      if (txId) {
        return { success: true, transactionId: txId };
      }
      return { success: false, error: 'Оплата отменена' };
    } catch (error) {
      this.isLoading.set(false);

      const errorMsg =
        error instanceof Error ? error.message : 'Оплата отменена';

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async subscribe(data: {
    subscriptionId: string;
    planName: string;
    amount: number;
    billingPeriod?: string;
    email?: string;
    phone?: string;
    trialDays?: number;
    oneTime?: boolean;
  }): Promise<PaymentResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return { success: false, error: 'Оплата недоступна на сервере' };
    }

    this.isLoading.set(true);

    try {
      await this.loadScript();

      const config = environment.cloudPayments;

      const interval = 'Month';
      const period =
        data.billingPeriod === 'yearly'
          ? 12
          : data.billingPeriod === 'quarterly'
            ? 3
            : 1;
      const descriptionPrefix = data.oneTime
        ? 'Пакет'
        : 'Подписка с автопродлением';

      const receiptLabel = data.oneTime
        ? `Пакет: ${data.planName}`
        : `Подписка с автопродлением: ${data.planName}`;
      const paymentType = data.oneTime ? 'print_package' : 'subscription';
      const source = data.oneTime ? 'print_package' : 'online_services';
      const recurrentReceipt = {
        items: [
          {
            label: receiptLabel,
            price: data.amount,
            quantity: 1,
            amount: data.amount,
            vat: null,
            method: 4,
            object: 4,
          },
        ],
        taxationSystem: config.taxationSystem,
        email: data.email || undefined,
        phone: data.phone || undefined,
        amounts: {
          electronic: data.amount,
          advancePayment: 0,
          credit: 0,
          provision: 0,
        },
      };

      const startDate = new Date();
      if (data.trialDays && data.trialDays > 0) {
        startDate.setDate(startDate.getDate() + data.trialDays);
      } else {
        startDate.setMonth(startDate.getMonth() + period);
      }

      const intentParams: Record<string, unknown> = {
        publicTerminalId: config.publicTerminalId,
        description: `${descriptionPrefix} «${data.planName}» — Своё Фото`,
        paymentSchema: 'Single',
        currency: config.currency,
        amount: data.amount,
        skin: config.skin,
        autoClose: 3,
        externalId: 'SUB-' + data.subscriptionId,
        receipt: recurrentReceipt,
        retryPayment: !data.oneTime,
        tokenize: !data.oneTime,
        emailBehavior: data.email ? 'Hidden' : 'Required',
        metadata: {
          subscriptionId: data.subscriptionId,
          planName: data.planName,
          source,
          type: paymentType,
        },
      };

      if (!data.oneTime) {
        intentParams['recurrent'] = {
          period,
          interval,
          amount: data.amount,
          startDate: startDate.toISOString(),
          receipt: recurrentReceipt,
        };
      }

      const userInfo: Record<string, string> = {
        accountId: data.subscriptionId,
      };
      if (data.email) userInfo['email'] = data.email;
      if (data.phone) userInfo['phone'] = data.phone;
      intentParams['userInfo'] = userInfo;

      if (data.email) {
        intentParams['receiptEmail'] = data.email;
      }

      const widget = new cp.CloudPayments();
      const result = await widget.start(intentParams);

      this.isLoading.set(false);

      const txId = result?.data?.transactionId ?? result?.transactionId;
      if (txId) {
        return { success: true, transactionId: txId };
      }
      return { success: false, error: 'Оплата отменена' };
    } catch (error) {
      this.isLoading.set(false);
      const errorMsg =
        error instanceof Error ? error.message : 'Оплата отменена';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Верификация новой карты для смены способа списания на существующей подписке.
   *
   * Открывает виджет CloudPayments разовым платежом на 1₽ (`paymentSchema: 'Single'`)
   * с `tokenize: true`, но БЕЗ `recurrent`: новый рекуррент создаёт бэкенд через
   * `/subscriptions/create` по токену из вебхука `/pay`, а 1₽ возвращается. Сама
   * подписка переключается на новую карту на бэкенде (см. confirm-флоу).
   */
  async verifyCardForChange(data: {
    subscriptionId: string;
    externalId: string;
    amount: number;
    planName?: string;
    email?: string;
    phone?: string;
  }): Promise<PaymentResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return { success: false, error: 'Оплата недоступна на сервере' };
    }

    this.isLoading.set(true);

    try {
      await this.loadScript();

      const config = environment.cloudPayments;
      const planLabel = data.planName || 'подписка';
      const receiptLabel = `Проверка карты: ${planLabel}`;

      const verifyReceipt = {
        items: [
          {
            label: receiptLabel,
            price: data.amount,
            quantity: 1,
            amount: data.amount,
            vat: null,
            method: 4,
            object: 4,
          },
        ],
        taxationSystem: config.taxationSystem,
        email: data.email || undefined,
        phone: data.phone || undefined,
        amounts: {
          electronic: data.amount,
          advancePayment: 0,
          credit: 0,
          provision: 0,
        },
      };

      const intentParams: Record<string, unknown> = {
        publicTerminalId: config.publicTerminalId,
        description: `Проверка карты для подписки «${planLabel}» — Своё Фото`,
        paymentSchema: 'Single',
        currency: config.currency,
        amount: data.amount,
        skin: config.skin,
        autoClose: 3,
        externalId: data.externalId,
        receipt: verifyReceipt,
        retryPayment: true,
        tokenize: true,
        emailBehavior: data.email ? 'Hidden' : 'Required',
        metadata: {
          subscriptionId: data.subscriptionId,
          type: 'card_change',
          source: 'card_change',
        },
      };

      const userInfo: Record<string, string> = {
        accountId: data.subscriptionId,
      };
      if (data.email) userInfo['email'] = data.email;
      if (data.phone) userInfo['phone'] = data.phone;
      intentParams['userInfo'] = userInfo;

      if (data.email) {
        intentParams['receiptEmail'] = data.email;
      }

      const widget = new cp.CloudPayments();
      const result = await widget.start(intentParams);

      this.isLoading.set(false);

      const txId = result?.data?.transactionId ?? result?.transactionId;
      if (txId) {
        return { success: true, transactionId: txId };
      }
      return { success: false, error: 'Проверка карты отменена' };
    } catch (error) {
      this.isLoading.set(false);
      const errorMsg =
        error instanceof Error ? error.message : 'Проверка карты отменена';
      return { success: false, error: errorMsg };
    }
  }

  private buildReceipt(
    items: CartItem[],
    total: number,
    email?: string,
    phone?: string,
  ): Receipt {
    const receiptItems: ReceiptItem[] = [];

    for (const item of items) {
      const { nextPrice } = item.service;
      if (nextPrice && nextPrice !== item.service.price && item.quantity > 1) {
        receiptItems.push({
          label: `${item.service.name} (акция)`,
          price: item.service.price,
          quantity: 1,
          amount: item.service.price,
          vat: null,
          method: 4,
          object: 4,
          measurementUnit: 'шт',
        });
        const restQty = item.quantity - 1;
        receiptItems.push({
          label: item.service.name,
          price: nextPrice,
          quantity: restQty,
          amount: nextPrice * restQty,
          vat: null,
          method: 4,
          object: 4,
          measurementUnit: 'шт',
        });
      } else {
        receiptItems.push({
          label: item.service.name,
          price: item.service.price,
          quantity: item.quantity,
          amount: item.service.price * item.quantity,
          vat: null,
          method: 4,
          object: 4,
          measurementUnit: 'шт',
        });
      }
    }

    return {
      items: receiptItems,
      taxationSystem: environment.cloudPayments.taxationSystem,
      email: email || undefined,
      phone: phone || undefined,
      amounts: {
        electronic: total,
        advancePayment: 0,
        credit: 0,
        provision: 0,
      },
    };
  }

  private buildWidgetItems(
    items: CartItem[],
  ): { id: string; name: string; count: number; price: number }[] {
    const widgetItems: { id: string; name: string; count: number; price: number }[] = [];

    for (const item of items) {
      const { nextPrice } = item.service;
      if (nextPrice && nextPrice !== item.service.price && item.quantity > 1) {
        widgetItems.push({
          id: `${item.service.id}-promo`,
          name: `${item.service.name} (акция)`,
          count: 1,
          price: item.service.price,
        });
        widgetItems.push({
          id: item.service.id,
          name: item.service.name,
          count: item.quantity - 1,
          price: nextPrice,
        });
      } else {
        widgetItems.push({
          id: item.service.id,
          name: item.service.name,
          count: item.quantity,
          price: item.service.price,
        });
      }
    }

    return widgetItems;
  }

  async paySbp(
    orderId: string,
    items: CartItem[],
    email?: string,
    phone?: string,
    discount?: number,
  ): Promise<PaymentResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return { success: false, error: 'Оплата недоступна на сервере' };
    }

    this.isLoading.set(true);

    try {
      let total = items.reduce(
        (sum, item) => sum + calcItemSubtotal(item),
        0,
      );
      if (discount && discount > 0) {
        total = Math.max(0, total - discount);
      }

      const receipt = this.buildReceipt(items, total, email, phone);
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      const apiUrl = isMobile ? '/api/payments/sbp' : '/api/payments/sbp/qr';

      const payload: Record<string, unknown> = {
        amount: total,
        orderId,
        description: `Заказ ${orderId} — Своё Фото`,
        receipt,
      };
      if (email) payload['email'] = email;
      if (phone) payload['phone'] = phone;
      if (isMobile) {
        payload['successUrl'] = `${this.getBaseUrl()}/pay/${encodeURIComponent(orderId)}`;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!data.success) {
        this.isLoading.set(false);
        return { success: false, error: data.error || 'Ошибка СБП' };
      }

      if (isMobile && data.qrUrl) {
        window.location.href = data.qrUrl;
        return { success: false };
      }

      if (!isMobile && data.qrImage) {
        this.isLoading.set(false);
        return this.showSbpQrDialog(data.qrImage, data.qrUrl, total, orderId);
      }

      this.isLoading.set(false);
      return { success: false, error: 'Некорректный ответ сервера' };
    } catch (error) {
      this.isLoading.set(false);
      const errorMsg = error instanceof Error ? error.message : 'Ошибка СБП';
      return { success: false, error: errorMsg };
    }
  }

  private showSbpQrDialog(qrImage: string, _qrUrl: string, total: number, orderId: string): Promise<PaymentResult> {
    return new Promise<PaymentResult>((resolve) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        overlay.remove();
      };

      const finish = (result: PaymentResult) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '10000',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      });

      const dialog = document.createElement('div');
      Object.assign(dialog.style, {
        background: '#1e1e2e', color: '#fff', borderRadius: '20px',
        padding: '32px', textAlign: 'center', maxWidth: '360px', width: '90%',
        boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
      });

      const title = document.createElement('h3');
      title.textContent = 'Оплата через СБП';
      Object.assign(title.style, { margin: '0 0 8px', fontSize: '1.25rem', fontWeight: '700' });

      const subtitle = document.createElement('p');
      subtitle.textContent = 'Отсканируйте QR-код в приложении вашего банка';
      Object.assign(subtitle.style, { margin: '0 0 20px', opacity: '0.7', fontSize: '0.9rem' });

      const qrWrap = document.createElement('div');
      Object.assign(qrWrap.style, {
        background: '#fff', borderRadius: '12px', padding: '16px',
        display: 'inline-block', marginBottom: '16px',
      });

      const qrImg = document.createElement('img');
      qrImg.src = `data:image/png;base64,${qrImage}`;
      qrImg.alt = 'QR СБП';
      Object.assign(qrImg.style, { width: '200px', height: '200px' });
      qrWrap.appendChild(qrImg);

      const totalEl = document.createElement('p');
      totalEl.textContent = `${total.toLocaleString('ru-RU')} ₽`;
      Object.assign(totalEl.style, { fontSize: '1.5rem', fontWeight: '800', margin: '12px 0' });

      const statusEl = document.createElement('p');
      statusEl.textContent = 'Ожидаем оплату...';
      Object.assign(statusEl.style, { fontSize: '0.85rem', opacity: '0.6', margin: '0 0 12px' });

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Отмена';
      Object.assign(closeBtn.style, {
        marginTop: '4px', padding: '12px 32px', border: 'none', borderRadius: '12px',
        background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: '1rem',
        cursor: 'pointer',
      });

      dialog.append(title, subtitle, qrWrap, totalEl, statusEl, closeBtn);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finish({ success: false, error: 'Оплата отменена' });
      });
      closeBtn.addEventListener('click', () => finish({ success: false, error: 'Оплата отменена' }));

      const POLL_INTERVAL = 3000;
      const MAX_POLLS = 200;
      let pollCount = 0;

      const checkPaymentStatus = async () => {
        if (resolved) return;
        pollCount++;
        if (pollCount > MAX_POLLS) {
          finish({ success: false, error: 'Время ожидания оплаты истекло' });
          return;
        }

        try {
          const res = await fetch(`/api/payments/status/${encodeURIComponent(orderId)}`);
          const json = await res.json();
          if (json.success && json.order?.paymentStatus === 'paid') {
            statusEl.textContent = 'Оплата подтверждена!';
            statusEl.style.color = '#4ade80';
            statusEl.style.opacity = '1';
            finish({ success: true, transactionId: json.order.transactionId });
          }
        } catch {
          // Network error — continue polling
        }
      };

      pollTimer = setInterval(checkPaymentStatus, POLL_INTERVAL);
    });
  }

  /**
   * Server-side subscription payment verification through CloudPayments API.
   * Polls because the widget can close before CloudPayments search/webhooks settle.
   */
  async confirmSubscriptionPayment(
    subscriptionId: string,
    transactionId?: number | string,
    maxAttempts = 5,
    intervalMs = 3000,
  ): Promise<SubscriptionPaymentConfirmationResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return {
        success: false,
        status: 'failed',
        error: 'Оплата недоступна на сервере',
      };
    }

    let lastResult: SubscriptionPaymentConfirmationResult = {
      success: false,
      status: 'pending_payment',
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch('/api/payments/confirm-subscription-from-widget', {
          method: 'POST',
          credentials: 'include',
          headers: await this.buildAuthenticatedJsonHeaders(),
          body: JSON.stringify({
            subscriptionId,
            ...(transactionId != null ? { transactionId } : {}),
          }),
        });
        const data: unknown = await res.json();
        const parsed = this.toSubscriptionConfirmationResult(data, res.ok);
        lastResult = parsed;

        if (
          parsed.status === 'confirmed' ||
          parsed.status === 'already_processed'
        ) {
          return parsed;
        }

        if (attempt < maxAttempts - 1) {
          await this.delay(intervalMs);
          continue;
        }

        return parsed;
      } catch (error: unknown) {
        lastResult = {
          success: false,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Не удалось подтвердить оплату',
        };
        if (attempt < maxAttempts - 1) {
          await this.delay(intervalMs);
          continue;
        }
      }
    }

    return lastResult;
  }

  /**
   * Серверная верификация оплаты через CloudPayments API.
   * Поллит POST /api/payments/confirm-from-widget до подтверждения.
   * Возвращает true только если сервер подтвердил оплату.
   */
  async verifyPayment(orderId: string, maxAttempts = 5, intervalMs = 3000): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch('/api/payments/confirm-from-widget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json();

        if (data.status === 'confirmed' || data.status === 'already_processed') {
          return true;
        }

        if (data.status === 'pending_payment' && attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, intervalMs));
          continue;
        }

        return false;
      } catch {
        if (attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, intervalMs));
          continue;
        }
        return false;
      }
    }

    return false;
  }

  private toSubscriptionConfirmationResult(
    data: unknown,
    responseOk: boolean,
  ): SubscriptionPaymentConfirmationResult {
    if (!this.isRecord(data)) {
      return {
        success: false,
        status: 'failed',
        error: 'Некорректный ответ сервера',
      };
    }

    const statusValue = data['status'];
    const errorValue = data['error'];
    const subscriptionIdValue = data['subscription_id'];
    const success = data['success'] === true && responseOk;

    return {
      success,
      status: typeof statusValue === 'string'
        ? statusValue
        : success ? 'confirmed' : 'failed',
      subscription_id: typeof subscriptionIdValue === 'string'
        ? subscriptionIdValue
        : undefined,
      error: typeof errorValue === 'string' ? errorValue : undefined,
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async buildAuthenticatedJsonHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await this.auth.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private getBaseUrl(): string {
    if (isPlatformBrowser(this.platformId)) {
      return window.location.origin;
    }
    return 'https://svoefoto.ru';
  }

  private async validatePricingItems(items: CartItem[]): Promise<void> {
    const pricingItems = items.filter(i => i.pricingData);
    if (pricingItems.length === 0) return;

    for (const item of pricingItems) {
      const pd = item.pricingData!;
      try {
        const result = await this.pricingApi.calculate({
          categorySlug: pd.categorySlug,
          selectedOptions: pd.selectedOptions,
          deliveryMethod: pd.deliveryMethod,
        });

        const serverTotal = result.breakdown?.total ?? 0;
        const clientTotal = calcItemSubtotal(item);

        if (Math.abs(serverTotal - clientTotal) > 1) {
          throw new Error(
            `Цена изменилась: ${clientTotal}₽ → ${serverTotal}₽. Обновите корзину и попробуйте снова.`
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Цена изменилась')) {
          throw err;
        }
        // Price validation skipped due to API error — proceed with original price
      }
    }
  }
}
