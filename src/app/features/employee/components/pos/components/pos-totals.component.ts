import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import type { WaterfallV2Response } from '../../../../../core/services/pricing-api.service';

@Component({
  selector: 'app-pos-totals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatProgressBarModule, MatButtonModule],
  host: { class: 'pos-totals' },
  template: `
    <div class="totals-row">
      <span>Подытог</span>
      <span>{{ subtotal() }}\u20BD</span>
    </div>
    @if (discountTotal() > 0) {
      <div class="totals-row discount-row">
        <span>Скидка</span>
        <span>-{{ discountTotal() }}\u20BD</span>
      </div>
    }
    @if (wfSubscriberDiscount(); as sub) {
      <div class="totals-row wf-discount-row">
        <span>Скидка подписчика ({{ sub.percent }}%)</span>
        <span>-{{ sub.amount }}\u20BD</span>
      </div>
    }
    @if (wfAccountDiscount(); as account) {
      <div class="totals-row account-row">
        <span>{{ account.description || account.label + ' (' + account.percent + '%)' }}</span>
        <span>-{{ account.amount }}\u20BD</span>
      </div>
    }
    @if (wfStudentDiscount(); as student) {
      <div class="totals-row student-row">
        <span>Студенческая скидка</span>
        <span>-{{ student.amount }}\u20BD</span>
      </div>
    }
    @if (wfSavings() > 0 && !wfSubscriberDiscount() && !wfStudentDiscount()) {
      <div class="totals-row wf-discount-row">
        <span>Скидка за количество</span>
        <span>-{{ wfSavings() }}\u20BD</span>
      </div>
    }
    @if (wfPromoDiscount(); as promo) {
      <div class="totals-row wf-discount-row">
        <span>{{ promo.title }}</span>
        <span>-{{ promo.amount }}\u20BD</span>
      </div>
    }
    @if (pointsTotal() > 0) {
      <div class="totals-row points-row">
        <span>Бонусы</span>
        <span>-{{ pointsTotal() }}\u20BD</span>
      </div>
    }
    @if (subscriptionTotal() > 0) {
      <div class="totals-row sub-row">
        <span>Подписка</span>
        <span>-{{ subscriptionTotal() }}\u20BD</span>
      </div>
    }
    @if (wfMinimumCheck() > 0) {
      <div class="totals-row minimum-row">
        <span>Минимальный чек</span>
        <span>+{{ wfMinimumCheck() }}\u20BD</span>
      </div>
    }
    @if (bestVolumeHint(); as hint) {
      <div class="volume-hint-badge">
        <mat-icon>trending_up</mat-icon>
        <span>{{ hint }}</span>
      </div>
    }
    @if (hasVolumeEligibleItems()) {
      <button
        mat-stroked-button
        class="volume-discount-btn"
        [class.active]="volumeDiscountActive()"
        (click)="volumeDiscountToggle.emit()">
        <mat-icon>{{ volumeDiscountActive() ? 'discount' : 'percent' }}</mat-icon>
        {{ volumeDiscountActive() ? 'Скидка за объём применена' : 'Применить скидку за объём' }}
      </button>
    }
    <div class="totals-row total-row">
      <span>Итого</span>
      <span class="total-amount">{{ effectiveTotal() }}\u20BD</span>
    </div>
    @if (waterfallLoading()) {
      <mat-progress-bar mode="indeterminate" class="wf-loading" />
    }
  `,
  styles: [`
    :host {
      display: block;
      padding: 8px 12px;
      background: var(--mat-sys-surface-container-low);
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 14px;
    }
    .discount-row { color: var(--crm-status-error); }
    .wf-discount-row { color: var(--crm-status-success); font-size: 13px; }
    .account-row { color: var(--mat-sys-secondary); font-size: 13px; font-weight: 600; }
    .student-row { color: var(--mat-sys-primary); font-size: 13px; font-weight: 600; }
    .points-row { color: var(--crm-status-warning); }
    .sub-row { color: var(--mat-sys-tertiary); }
    .minimum-row { color: var(--mat-sys-tertiary); font-size: 13px; font-weight: 600; }
    .total-row {
      font-size: 18px;
      font-weight: 700;
      padding: 8px 0 4px;
    }
    .total-amount { color: var(--mat-sys-primary); }
    .volume-hint-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      margin: 4px 0;
      border-radius: 6px;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
      color: var(--mat-sys-primary);
      font-size: 12px;
      font-weight: 500;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .wf-loading { margin-top: 4px; }
    .volume-discount-btn {
      width: 100%;
      margin: 6px 0;
      font-size: 13px;
      font-weight: 500;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
      &.active {
        background: color-mix(in srgb, var(--crm-status-success) 12%, transparent);
        color: var(--crm-status-success);
        border-color: var(--crm-status-success);
      }
    }
  `],
})
export class PosTotalsComponent {
  readonly subtotal = input.required<number>();
  readonly discountTotal = input.required<number>();
  readonly pointsTotal = input.required<number>();
  readonly subscriptionTotal = input.required<number>();
  readonly total = input.required<number>();
  readonly minimumCheckSurcharge = input(0);
  readonly waterfallResult = input<WaterfallV2Response | null>(null);
  readonly waterfallLoading = input(false);
  readonly volumeDiscountActive = input(false);
  readonly volumeDiscountToggle = output<void>();

  readonly effectiveTotal = computed(() => {
    const wf = this.waterfallResult();
    return wf ? wf.total : this.total();
  });

  readonly wfSavings = computed(() => this.waterfallResult()?.savings ?? 0);

  readonly wfSubscriberDiscount = computed(() =>
    this.waterfallResult()?.discounts?.subscriber ?? null,
  );

  readonly wfAccountDiscount = computed(() =>
    this.waterfallResult()?.discounts?.account ?? null,
  );

  readonly wfStudentDiscount = computed(() =>
    this.waterfallResult()?.discounts?.student ?? null,
  );

  readonly wfPromoDiscount = computed(() =>
    this.waterfallResult()?.discounts?.promo ?? null,
  );

  readonly wfMinimumCheck = computed(() => {
    if (!this.waterfallResult()) return this.minimumCheckSurcharge();
    const step = this.waterfallResult()?.waterfall?.find(s => s.step === 'minimum_check' && s.amount > 0);
    return step?.amount ?? 0;
  });

  /** Показывать кнопку скидки за объём, если есть позиции с qty >= 10 или скидка уже активна */
  readonly hasVolumeEligibleItems = computed(() => {
    if (this.volumeDiscountActive()) return true;
    const wf = this.waterfallResult();
    if (!wf?.items) return false;
    return wf.items.some(i => i.quantity >= 10);
  });

  /** Лучшая подсказка volume-скидки — ближайший порог, если до него <= 30% от текущего кол-ва */
  readonly bestVolumeHint = computed<string | null>(() => {
    const wf = this.waterfallResult();
    if (!wf?.items) return null;
    let best: { hint: string; remaining: number } | null = null;
    for (const item of wf.items) {
      if (!item.nextThreshold) continue;
      const { remainingToNext, nextDiscountPercent } = item.nextThreshold;
      // Показываем только если до порога <= 30% от текущего кол-ва
      if (item.quantity > 0 && remainingToNext > item.quantity * 0.3) continue;
      if (!best || remainingToNext < best.remaining) {
        best = {
          hint: `ещё ${remainingToNext} шт = скидка ${nextDiscountPercent}%`,
          remaining: remainingToNext,
        };
      }
    }
    return best?.hint ?? null;
  });
}
