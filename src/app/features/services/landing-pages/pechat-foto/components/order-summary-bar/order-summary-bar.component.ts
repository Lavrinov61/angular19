import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, PLATFORM_ID
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { PhotoPrintStoreService } from '../../services/photo-print-store.service';
import {
  PaperPriceTier, PRINT_FORMATS, PRINT_TIER_ORDER, printTierDescription, printTierLabel,
  CUSTOM_CROP_FEE
} from '../../models/format-config';
import { SubscriptionService } from '../../../../../../core/services/subscription.service';
import { AddressAutocompleteComponent } from '../../../../../../shared/components/address-autocomplete/address-autocomplete.component';
import type { DeliveryQuoteUnavailable } from '../../../../../../core/services/delivery.service';

interface PrintTierChoice {
  id: PaperPriceTier;
  label: string;
  description: string;
}

interface ContactDraft {
  name: string;
  phone: string;
  email: string;
  comments: string;
}

const CONTACT_DRAFT_STORAGE_KEY = 'sf_photo_print_contact_draft';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function draftString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

@Component({
  selector: 'app-order-summary-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
    ReactiveFormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatInputModule,
    MatFormFieldModule,
    AddressAutocompleteComponent,
  ],
  templateUrl: './order-summary-bar.component.html',
  styleUrl: './order-summary-bar.component.scss',
})
export class OrderSummaryBarComponent implements OnInit {
  readonly store = inject(PhotoPrintStoreService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly fb = inject(FormBuilder);
  private readonly platformId = inject(PLATFORM_ID);

  readonly isExpanded = signal(false);
  readonly submitAttempted = signal(false);
  readonly customCropFee = CUSTOM_CROP_FEE;
  readonly printTierChoices: readonly PrintTierChoice[] = PRINT_TIER_ORDER.map(tier => ({
    id: tier,
    label: printTierLabel(tier),
    description: printTierDescription(tier),
  }));

  readonly contactForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, Validators.minLength(10)]],
    email: [''],
    comments: [''],
  });

  readonly formatsWithItems = computed(() =>
    PRINT_FORMATS.filter(f => this.store.countByFormat(f.id) > 0)
  );

  readonly printTierLabel = computed(() => {
    const selected = this.store.selectedPrintTier();
    if (selected === 'mixed') return 'Смешанный тип';
    return selected ? printTierLabel(selected) : 'Премиум';
  });

  readonly printTierSummary = computed(() => {
    const selected = this.store.selectedPrintTier();
    if (selected === 'mixed') return 'В заказе разные типы';
    return selected ? printTierDescription(selected) : '';
  });

  readonly activeSubscription = computed(() => {
    const subscription = this.subscriptionService.currentSubscription();
    return subscription?.status === 'active' ? subscription : null;
  });

  readonly canPayWithSubscription = computed(() =>
    !!this.activeSubscription()
    && this.subscriptionService.totalRemainingCredits() > 0
    && !this.store.isPaidWithSubscription()
  );

  readonly paymentLink = computed(() => {
    const orderId = this.store.orderId();
    return orderId ? ['/pay', orderId] : ['/pay'];
  });

  readonly loginQueryParams = computed(() => ({ returnUrl: '/user-profile/orders' }));
  readonly becomeClientQueryParams = computed(() => ({ returnUrl: '/user-profile/orders' }));

  ngOnInit(): void {
    this.subscriptionService.ensureLoaded();
    void this.store.ensurePickupLocationsLoaded();
    this.restoreContactDraft();
  }

  toggle(): void {
    this.isExpanded.update(v => !v);
  }

  onNameChange(event: Event): void {
    const name = this.readFieldValue(event);
    this.store.updateContact({ name });
    this.saveContactDraft({ name });
  }

  onPhoneChange(event: Event): void {
    const phone = this.readFieldValue(event);
    this.store.updateContact({ phone });
    this.saveContactDraft({ phone });
  }

  onEmailChange(event: Event): void {
    const email = this.readFieldValue(event);
    this.store.updateContact({ email });
    this.saveContactDraft({ email });
  }

  onCommentsChange(event: Event): void {
    const comments = this.readFieldValue(event);
    this.store.updateContact({ comments });
    this.saveContactDraft({ comments });
  }

  setPrintTier(tier: PaperPriceTier): void {
    this.store.applyPrintTierToAll(tier);
  }

  submitOrder(): void {
    this.submitAttempted.set(true);

    if (this.contactForm.invalid) return;
    if (!this.store.allUploaded()) return;
    if (!this.store.canSubmit()) return;

    // Обновляем контакт из формы
    const v = this.contactForm.value;
    this.store.updateContact({
      name: v.name || '',
      phone: v.phone || '',
      email: v.email || undefined,
      comments: v.comments || undefined,
    });
    this.saveContactDraft();

    this.store.submitOrder().subscribe();
  }

  /** Человекочитаемое сообщение о недоступности курьерской доставки */
  deliveryUnavailableMessage(quote: DeliveryQuoteUnavailable): string {
    switch (quote.reason) {
      case 'out_of_zone':
        return 'Адрес вне зоны курьерской доставки. Доступен самовывоз в студии.';
      case 'address_required':
        return 'Уточните адрес до дома, без него не рассчитать доставку.';
      case 'address_imprecise':
        return 'Адрес распознан неточно. Выберите вариант из подсказок до дома.';
      case 'provider_unavailable':
        return 'Сервис доставки временно недоступен. Попробуйте позже или выберите самовывоз.';
      case 'rate_limited':
        return 'Слишком много запросов расчёта. Подождите немного и попробуйте снова.';
      case 'feature_disabled':
        return 'Курьерская доставка временно недоступна.';
      default:
        return 'Доставка по этому адресу недоступна. Выберите самовывоз.';
    }
  }

  payWithSubscription(): void {
    const subscription = this.activeSubscription();
    if (!subscription || this.store.isPayingWithSubscription()) return;

    this.store.payOrderWithSubscription(subscription.id).subscribe(result => {
      if (result.success) {
        this.subscriptionService.loadMySubscription();
      }
    });
  }

  newOrder(): void {
    this.store.clearOrder();
    this.contactForm.reset();
    this.restoreContactDraft();
    this.isExpanded.set(false);
    this.submitAttempted.set(false);
  }

  get nameError(): string {
    const c = this.contactForm.get('name');
    if (this.submitAttempted() && c?.errors?.['required']) return 'Введите имя';
    if (this.submitAttempted() && c?.errors?.['minlength']) return 'Минимум 2 символа';
    return '';
  }

  get phoneError(): string {
    const c = this.contactForm.get('phone');
    if (this.submitAttempted() && c?.errors?.['required']) return 'Введите телефон';
    if (this.submitAttempted() && c?.errors?.['minlength']) return 'Введите корректный номер';
    return '';
  }

  private readFieldValue(event: Event): string {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value;
    }
    return '';
  }

  private restoreContactDraft(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const draft = this.readContactDraft();
    if (!draft) return;

    this.contactForm.patchValue(draft, { emitEvent: false });
    this.store.updateContact({
      name: draft.name,
      phone: draft.phone,
      ...(draft.email ? { email: draft.email } : {}),
      ...(draft.comments ? { comments: draft.comments } : {}),
    });
  }

  private readContactDraft(): ContactDraft | null {
    try {
      const raw = window.localStorage.getItem(CONTACT_DRAFT_STORAGE_KEY);
      if (!raw) return null;

      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return null;

      const draft: ContactDraft = {
        name: draftString(parsed['name']),
        phone: draftString(parsed['phone']),
        email: draftString(parsed['email']),
        comments: draftString(parsed['comments']),
      };

      return draft.name || draft.phone || draft.email || draft.comments ? draft : null;
    } catch {
      return null;
    }
  }

  private saveContactDraft(updates: Partial<ContactDraft> = {}): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const value = this.contactForm.getRawValue();
    const draft: ContactDraft = {
      name: draftString(updates.name ?? value.name),
      phone: draftString(updates.phone ?? value.phone),
      email: draftString(updates.email ?? value.email),
      comments: draftString(updates.comments ?? value.comments),
    };

    if (!draft.name && !draft.phone && !draft.email && !draft.comments) {
      window.localStorage.removeItem(CONTACT_DRAFT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(CONTACT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }
}
