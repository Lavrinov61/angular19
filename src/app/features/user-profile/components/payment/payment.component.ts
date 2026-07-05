import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatStepperModule } from '@angular/material/stepper';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { CurrencyPipe } from '@angular/common';

import { PhotoApiService } from '../../../../core/services/photo-api.service';
import { PhotoSelection, PaymentStatus } from '../../../../core/models/photo-selection.model';
import { PaymentMethod } from '../../../../core/models/booking.model';

@Component({
  selector: 'app-payment',
  
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatRadioModule,
    MatCheckboxModule,
    MatDividerModule,
    MatStepperModule,
    MatDialogModule,
    CurrencyPipe
  ],
  templateUrl: './payment.component.html',
  styleUrls: ['./payment.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PaymentComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly photoApiService = inject(PhotoApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  // Signals
  readonly selectionId = signal<string>('');
  readonly selection = signal<PhotoSelection | null>(null);
  readonly loading = signal(true);
  readonly processing = signal(false);

  // Forms
  paymentForm: FormGroup;
  deliveryForm: FormGroup;  // Computed
  readonly totalAmount = computed(() => {
    const sel = this.selection();
    return sel ? sel.totalPrice : 0;
  });

  readonly formattedAmount = computed(() => {
    return this.totalAmount().toLocaleString('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0
    });
  });

  // Helper methods for templates
  getSelectedDeliveryOption() {
    const method = this.deliveryForm.get('deliveryMethod')?.value;
    return this.deliveryOptions.find(opt => opt.value === method);
  }

  getSelectedPaymentMethod() {
    const method = this.paymentForm.get('paymentMethod')?.value;
    return this.paymentMethods.find(m => m.value === method);
  }

  getRecipientName() {
    return this.deliveryForm.get('recipientName')?.value || '';
  }

  getRecipientPhone() {
    return this.deliveryForm.get('recipientPhone')?.value || '';
  }

  getRecipientEmail() {
    return this.deliveryForm.get('recipientEmail')?.value || '';
  }

  getDeliveryAddress() {
    return this.deliveryForm.get('deliveryAddress')?.value || '';
  }

  shouldShowDeliveryAddress() {
    const method = this.deliveryForm.get('deliveryMethod')?.value;
    return method === 'courier' || method === 'post';
  }

  // Constants
  readonly paymentMethods = [
    { value: PaymentMethod.CARD, label: 'Банковская карта', icon: 'credit_card' },
    { value: PaymentMethod.SBP, label: 'СБП (Система быстрых платежей)', icon: 'qr_code' },
    { value: PaymentMethod.YANDEX_MONEY, label: 'ЮMoney', icon: 'account_balance_wallet' },
    { value: PaymentMethod.SBERBANK, label: 'Сбербанк Онлайн', icon: 'account_balance' }
  ];

  readonly deliveryOptions = [
    { value: 'pickup', label: 'Самовывоз из студии', price: 0, description: 'Бесплатно. Забрать можно в течение 30 дней.' },
    { value: 'courier', label: 'Курьер по Ростову-на-Дону', price: 300, description: 'Доставка в течение 1-2 рабочих дней.' },
    { value: 'post', label: 'Почта России', price: 250, description: 'Доставка в течение 5-10 рабочих дней.' },
    { value: 'email', label: 'Электронная доставка', price: 0, description: 'Только для цифровых форматов. Мгновенно.' }
  ];

  constructor() {
    this.paymentForm = this.fb.group({
      paymentMethod: [PaymentMethod.CARD, Validators.required],
      cardNumber: [''],
      cardExpiry: [''],
      cardCvc: [''],
      cardHolder: [''],
      agreementAccepted: [false, Validators.requiredTrue]
    });

    this.deliveryForm = this.fb.group({
      deliveryMethod: ['pickup', Validators.required],
      recipientName: ['', Validators.required],
      recipientPhone: ['', Validators.required],
      recipientEmail: ['', [Validators.required, Validators.email]],
      deliveryAddress: [''],
      deliveryComment: ['']
    });
    
    const selectionId = this.route.snapshot.paramMap.get('id');
    if (selectionId) {
      this.selectionId.set(selectionId);
      this.loadSelection(selectionId);
    } else {
      this.router.navigate(['/user-profile/photo-selections']);
    }

    // Watch payment method changes
    this.paymentForm.get('paymentMethod')?.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((method: PaymentMethod) => {
        this.updateCardFieldsValidation(method);
      });

    // Watch delivery method changes
    this.deliveryForm.get('deliveryMethod')?.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((method: string) => {
        this.updateDeliveryFieldsValidation(method);
      });
  }
  private async loadSelection(selectionId: string) {
    try {
      this.loading.set(true);
      const response = await this.photoApiService.getPhotoSelectionById(selectionId).toPromise();
      
      if (response?.success && response.data) {
        this.selection.set(response.data);
        
        if (response.data.paymentInfo?.status === PaymentStatus.COMPLETED) {
          this.snackBar.open('Этот заказ уже оплачен', 'Закрыть', { duration: 3000 });
          this.router.navigate(['/user-profile/photo-selections']);
        }
      } else {
        throw new Error('Заказ не найден');
      }
    } catch {
      this.snackBar.open('Ошибка загрузки заказа', 'Закрыть', { duration: 3000 });
      this.router.navigate(['/user-profile/photo-selections']);
    } finally {
      this.loading.set(false);
    }
  }

  private updateCardFieldsValidation(paymentMethod: PaymentMethod) {
    const cardFields = ['cardNumber', 'cardExpiry', 'cardCvc', 'cardHolder'];
    
    if (paymentMethod === PaymentMethod.CARD) {
      cardFields.forEach(field => {
        this.paymentForm.get(field)?.setValidators([Validators.required]);
      });
    } else {
      cardFields.forEach(field => {
        this.paymentForm.get(field)?.clearValidators();
      });
    }
    
    cardFields.forEach(field => {
      this.paymentForm.get(field)?.updateValueAndValidity();
    });
  }

  private updateDeliveryFieldsValidation(deliveryMethod: string) {
    const addressField = this.deliveryForm.get('deliveryAddress');
    
    if (deliveryMethod === 'courier' || deliveryMethod === 'post') {
      addressField?.setValidators([Validators.required]);
    } else {
      addressField?.clearValidators();
    }
    
    addressField?.updateValueAndValidity();
  }

  getDeliveryPrice(): number {
    const method = this.deliveryForm.get('deliveryMethod')?.value;
    const option = this.deliveryOptions.find(opt => opt.value === method);
    return option ? option.price : 0;
  }

  getFinalAmount(): number {
    return this.totalAmount() + this.getDeliveryPrice();
  }

  async processPayment() {
    if (!this.paymentForm.valid || !this.deliveryForm.valid) {
      this.snackBar.open('Пожалуйста, заполните все обязательные поля', 'Закрыть', { duration: 3000 });
      return;
    }

    const selection = this.selection();
    if (!selection) return;

    try {
      this.processing.set(true);

      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // В реальном приложении здесь будет вызов API для обработки платежа
      // const result = await this.photoApiService.processPayment(selection.id, paymentData);
      
      // Пока что просто показываем успешный результат
      this.snackBar.open('Оплата прошла успешно!', 'Закрыть', { duration: 5000 });
      this.router.navigate(['/user-profile/photo-selections'], {
        queryParams: { paymentSuccess: 'true' }
      });

    } catch {
      this.snackBar.open('Ошибка при обработке платежа. Попробуйте еще раз.', 'Закрыть', { duration: 5000 });
    } finally {
      this.processing.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/user-profile/photo-selections']);
  }

  openPaymentHelp() {
    // TODO: Implement payment help dialog
    this.snackBar.open('Справка по оплате будет доступна позже', 'Закрыть', { duration: 3000 });
  }

  formatCardNumber(event: Event) {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, '');
    value = value.replace(/(\d{4})(?=\d)/g, '$1 ');
    input.value = value;
    this.paymentForm.get('cardNumber')?.setValue(value);
  }

  formatCardExpiry(event: Event) {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, '');
    if (value.length >= 2) {
      value = value.substring(0, 2) + '/' + value.substring(2, 4);
    }
    input.value = value;
    this.paymentForm.get('cardExpiry')?.setValue(value);
  }

  formatCardCvc(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '');
    input.value = value.substring(0, 3);
    this.paymentForm.get('cardCvc')?.setValue(value);
  }

  getFormatsSummary(): string {
    const selection = this.selection();
    if (!selection || !selection.selectedPhotos || selection.selectedPhotos.length === 0) {
      return 'Не выбрано';
    }
    const formats = new Set(selection.selectedPhotos.map(photo => photo.format));
    return Array.from(formats).join(', ');
  }

  getRetouchingSummary(): string {
    const selection = this.selection();
    if (!selection || !selection.selectedPhotos || selection.selectedPhotos.length === 0) {
      return 'Нет';
    }
    const retouchedCount = selection.selectedPhotos.filter(photo => photo.isRetouched).length;
    return retouchedCount > 0 ? `${retouchedCount} фото` : 'Нет';
  }

  calculateTotal(): number {
    return this.totalAmount();
  }

  getPaymentMethodLabel(): string {
    const method = this.paymentForm.get('paymentMethod')?.value;
    const paymentMethod = this.paymentMethods.find(m => m.value === method);
    return paymentMethod ? paymentMethod.label : 'Не выбран';
  }
}
