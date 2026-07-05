import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { SubscriptionOfferApiService } from './services/subscription-offer-api.service';
import { OfferCategoryChipsComponent } from './components/offer-category-chips.component';
import { OfferPlanCardComponent } from './components/offer-plan-card.component';
import { OfferMessagePreviewComponent } from './components/offer-message-preview.component';
import {
  ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY,
  SUBSCRIPTION_CATEGORIES,
  type SubscriptionPlan,
  type SubscriptionOfferDialogData,
  type SubscriptionOfferDialogResult,
} from './models/subscription-offer.models';
import {
  buildSubscriptionOfferPlanList,
  getAccountSubscriptionKind,
  getSubscriptionOfferCategoryKey,
  isAccountSubscriptionInfoOnly,
} from './subscription-offer-display.util';

@Component({
  selector: 'app-subscription-offer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    OfferCategoryChipsComponent,
    OfferPlanCardComponent,
    OfferMessagePreviewComponent,
  ],
  templateUrl: './subscription-offer-dialog.component.html',
  styleUrl: './subscription-offer-dialog.component.scss',
})
export class SubscriptionOfferDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<SubscriptionOfferDialogComponent>);
  private readonly api = inject(SubscriptionOfferApiService);
  readonly data: SubscriptionOfferDialogData = inject(MAT_DIALOG_DATA);

  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly loading = signal(true);
  readonly selectedCategory = signal(ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY);
  readonly selectedPlan = signal<SubscriptionPlan | null>(null);
  readonly step = signal<'select' | 'preview'>('select');
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly mode = computed(() => this.data.mode ?? 'offer');
  readonly title = computed(() => this.mode() === 'gift' ? 'ПОДАРИТЬ 1 МЕСЯЦ' : 'ПРЕДЛОЖИТЬ ПОДПИСКУ');
  readonly headerIcon = computed(() => this.mode() === 'gift' ? 'redeem' : 'card_membership');
  readonly sendLabel = computed(() => {
    const plan = this.selectedPlan();
    if (plan && isAccountSubscriptionInfoOnly(plan)) {
      return 'Отправить информацию';
    }

    return this.mode() === 'gift' ? 'Отправить подарок' : 'Отправить предложение';
  });

  readonly availableCategories = computed(() => {
    const planCats = new Set(this.plans().map(p => getSubscriptionOfferCategoryKey(p)));
    return SUBSCRIPTION_CATEGORIES.filter(c => planCats.has(c.key));
  });

  readonly filteredPlans = computed(() =>
    this.plans().filter(p => getSubscriptionOfferCategoryKey(p) === this.selectedCategory()),
  );

  ngOnInit(): void {
    this.loadPlans();
  }

  loadPlans(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getPlans().subscribe({
      next: (res) => {
        const plans = buildSubscriptionOfferPlanList(res.plans ?? []);
        this.plans.set(plans);
        if (plans.length > 0 && !plans.some(p => getSubscriptionOfferCategoryKey(p) === this.selectedCategory())) {
          this.selectedCategory.set(getSubscriptionOfferCategoryKey(plans[0]));
        }
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Не удалось загрузить планы подписок');
        this.loading.set(false);
      },
    });
  }

  selectCategory(categoryKey: string): void {
    this.selectedCategory.set(categoryKey);
    const currentPlan = this.selectedPlan();
    if (currentPlan && getSubscriptionOfferCategoryKey(currentPlan) !== categoryKey) {
      this.selectedPlan.set(null);
    }
  }

  selectPlan(plan: SubscriptionPlan): void {
    this.selectedPlan.set(plan);
  }

  sendOffer(): void {
    const plan = this.selectedPlan();
    if (!plan || this.sending()) return;

    this.sending.set(true);
    const accountKind = getAccountSubscriptionKind(plan);
    if (accountKind && isAccountSubscriptionInfoOnly(plan)) {
      this.api.sendAccountAccessInfo(accountKind, this.data.sessionId).subscribe({
        next: (res) => {
          this.sending.set(false);
          const result: SubscriptionOfferDialogResult = {
            type: 'account-info-sent',
            accountType: res.account_type,
          };
          this.dialogRef.close(result);
        },
        error: () => {
          this.sending.set(false);
          this.error.set('Не удалось отправить информацию о подписке');
        },
      });
      return;
    }

    if (this.mode() === 'gift') {
      this.api.sendGift(plan.id, this.data.sessionId).subscribe({
        next: (res) => {
          this.sending.set(false);
          const result: SubscriptionOfferDialogResult = {
            type: 'gifted',
            promoCode: res.promo_code,
          };
          this.dialogRef.close(result);
        },
        error: () => {
          this.sending.set(false);
          this.error.set('Не удалось отправить подарок');
        },
      });
      return;
    }

    this.api.sendOffer(plan.id, this.data.sessionId).subscribe({
      next: (res) => {
        this.sending.set(false);
        const result: SubscriptionOfferDialogResult = {
          type: 'sent',
          offerId: res.offer_id,
        };
        this.dialogRef.close(result);
      },
      error: () => {
        this.sending.set(false);
        this.error.set('Не удалось отправить предложение');
      },
    });
  }

  cancel(): void {
    const result: SubscriptionOfferDialogResult = { type: 'cancelled' };
    this.dialogRef.close(result);
  }
}
