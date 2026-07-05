import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../../core/services/auth.service';

export interface DocumentOrderDialogData {
  photoUrl: string;
  thumbnailUrl: string;
  sessionId: string;
}

const DOCUMENT_TYPES = [
  'Паспорт РФ',
  'Загранпаспорт',
  'Водительские права',
  'Виза',
  'Медицинская книжка',
  'Студенческий билет',
  'Военный билет',
  'Пропуск',
] as const;

@Component({
  selector: 'app-document-order-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="order-dialog">
      <div class="dialog-header">
        <h2>Заказ на другой документ</h2>
        <button class="close-btn" (click)="dialogRef.close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      @if (step() === 'form') {
        <div class="dialog-body">
          <!-- Photo preview -->
          <div class="photo-preview">
            <img [src]="data.thumbnailUrl || data.photoUrl" alt="Ваше фото" />
            <span class="preview-label">Ваше фото будет переделано под выбранный документ</span>
          </div>

          <!-- Document type -->
          <div class="form-section">
            <span class="section-label">Тип документа</span>
            <div class="doc-chips">
              @for (doc of documentTypes; track doc) {
                <button
                  class="doc-chip"
                  [class.selected]="selectedDoc() === doc"
                  (click)="selectedDoc.set(doc)"
                >{{ doc }}</button>
              }
              <button
                class="doc-chip"
                [class.selected]="selectedDoc() === 'other'"
                (click)="selectedDoc.set('other')"
              >Другой</button>
            </div>
            @if (selectedDoc() === 'other') {
              <input
                class="text-input"
                [(ngModel)]="customDocType"
                placeholder="Укажите тип документа"
              />
            }
          </div>

          <!-- Quantity -->
          <div class="form-section">
            <span class="section-label">Количество комплектов</span>
            <div class="qty-row">
              <button class="qty-btn" (click)="decrementQty()" [disabled]="quantity() <= 1">
                <mat-icon>remove</mat-icon>
              </button>
              <span class="qty-value">{{ quantity() }}</span>
              <button class="qty-btn" (click)="quantity.set(quantity() + 1)" [disabled]="quantity() >= 10">
                <mat-icon>add</mat-icon>
              </button>
            </div>
          </div>

          <!-- Delivery -->
          <div class="form-section">
            <span class="section-label">Получение</span>
            <div class="delivery-options">
              <label class="delivery-option" [class.selected]="delivery() === 'pickup'">
                <input type="radio" name="delivery" value="pickup"
                  [checked]="delivery() === 'pickup'"
                  (change)="delivery.set('pickup')" />
                <mat-icon>storefront</mat-icon>
                <div>
                  <span class="delivery-title">Заберу сам</span>
                  <span class="delivery-sub">Бесплатно</span>
                </div>
              </label>
              <label class="delivery-option" [class.selected]="delivery() === 'courier'">
                <input type="radio" name="delivery" value="courier"
                  [checked]="delivery() === 'courier'"
                  (change)="delivery.set('courier')" />
                <mat-icon>local_shipping</mat-icon>
                <div>
                  <span class="delivery-title">Доставка</span>
                  <span class="delivery-sub">Рассчитаем стоимость</span>
                </div>
              </label>
            </div>
            @if (delivery() === 'courier') {
              <input
                class="text-input"
                [(ngModel)]="deliveryAddress"
                placeholder="Адрес доставки"
              />
            }
          </div>

          <!-- Contact -->
          <div class="form-section">
            <span class="section-label">Контактные данные</span>
            <input class="text-input" [(ngModel)]="contactName" placeholder="Ваше имя" aria-label="Ваше имя" />
            <input class="text-input" [(ngModel)]="contactPhone" placeholder="Телефон" type="tel" aria-label="Телефон" />
          </div>

          <!-- Comment -->
          <div class="form-section">
            <span class="section-label">Комментарий</span>
            <textarea
              class="text-input text-area"
              [(ngModel)]="comment"
              placeholder="Особые пожелания (необязательно)"
              rows="2"
            ></textarea>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="submit-btn" [disabled]="!canSubmit() || submitting()" (click)="submit()">
            @if (submitting()) {
              <mat-spinner diameter="20" />
            } @else {
              <mat-icon>shopping_cart</mat-icon>
              Оформить заказ
            }
          </button>
        </div>
      }

      @if (step() === 'success') {
        <div class="success-state">
          <div class="success-icon"><mat-icon>check_circle</mat-icon></div>
          <h3>Заказ оформлен!</h3>
          <p class="success-order-id">{{ orderId() }}</p>
          <p class="success-hint">Мы свяжемся с вами для подтверждения и оплаты</p>
          <button class="submit-btn" (click)="dialogRef.close('success')">Закрыть</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .order-dialog { color: #f0f0f0; max-width: 480px; }

    .dialog-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 20px 24px 12px;
      h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    }

    .close-btn {
      background: none; border: none; color: #888; cursor: pointer;
      padding: 4px; border-radius: 50%;
      &:hover { color: #f5f5f5; background: rgba(255,255,255,0.08); }
    }

    .dialog-body {
      padding: 0 24px 16px;
      display: flex; flex-direction: column; gap: 20px;
      max-height: 65vh; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
    }

    .photo-preview {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      img {
        width: 120px; height: 160px; object-fit: cover;
        border-radius: 12px; border: 2px solid rgba(245,158,11,0.3);
      }
    }
    .preview-label { font-size: 0.78rem; color: #888; text-align: center; }

    .form-section { display: flex; flex-direction: column; gap: 8px; }
    .section-label { font-size: 0.82rem; font-weight: 600; color: #ccc; }

    .doc-chips {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .doc-chip {
      padding: 6px 14px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.04);
      color: #ccc; font-size: 0.8rem; font-family: inherit;
      cursor: pointer; transition: all 0.15s;
      &:hover { border-color: rgba(245,158,11,0.4); color: #f5f5f5; }
      &.selected {
        background: rgba(245,158,11,0.15); border-color: #f59e0b; color: #f59e0b;
        font-weight: 600;
      }
    }

    .text-input {
      padding: 10px 14px; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.04);
      color: #f0f0f0; font-size: 0.88rem; font-family: inherit;
      outline: none; transition: border-color 0.2s;
      &::placeholder { color: #666; }
      &:focus { border-color: rgba(245,158,11,0.5); }
    }
    .text-area { resize: vertical; min-height: 48px; }

    .qty-row {
      display: flex; align-items: center; gap: 16px;
    }
    .qty-btn {
      width: 36px; height: 36px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.04);
      color: #ccc; cursor: pointer; display: flex;
      align-items: center; justify-content: center;
      &:hover:not(:disabled) { border-color: #f59e0b; color: #f59e0b; }
      &:disabled { opacity: 0.3; cursor: not-allowed; }
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }
    .qty-value { font-size: 1.2rem; font-weight: 600; min-width: 24px; text-align: center; }

    .delivery-options { display: flex; gap: 10px; }
    .delivery-option {
      flex: 1; display: flex; align-items: center; gap: 10px;
      padding: 12px 14px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.03);
      cursor: pointer; transition: all 0.15s;
      input { display: none; }
      mat-icon { font-size: 24px; width: 24px; height: 24px; color: #888; }
      &:hover { border-color: rgba(245,158,11,0.3); }
      &.selected {
        border-color: #f59e0b; background: rgba(245,158,11,0.08);
        mat-icon { color: #f59e0b; }
      }
    }
    .delivery-title { font-size: 0.88rem; font-weight: 600; display: block; }
    .delivery-sub { font-size: 0.75rem; color: #888; }

    .dialog-footer { padding: 12px 24px 20px; }

    .submit-btn {
      width: 100%; padding: 14px;
      background: #f59e0b; color: #000;
      border: none; border-radius: 12px;
      font-size: 0.95rem; font-weight: 600; font-family: inherit;
      cursor: pointer; display: flex; align-items: center;
      justify-content: center; gap: 8px;
      transition: background 0.15s;
      &:hover:not(:disabled) { background: #d97706; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }

    .success-state {
      padding: 40px 24px; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 12px;
    }
    .success-icon mat-icon {
      font-size: 3rem; width: 3rem; height: 3rem; color: #22c55e;
    }
    .success-state h3 { margin: 0; font-size: 1.2rem; }
    .success-order-id {
      font-size: 0.9rem; color: #f59e0b; font-weight: 600;
      background: rgba(245,158,11,0.1); padding: 6px 16px; border-radius: 8px;
    }
    .success-hint { font-size: 0.82rem; color: #888; margin: 0; }

    @media (max-width: 500px) {
      .delivery-options { flex-direction: column; }
    }
  `]
})
export class DocumentOrderDialogComponent {
  readonly dialogRef = inject(MatDialogRef<DocumentOrderDialogComponent>);
  readonly data: DocumentOrderDialogData = inject(MAT_DIALOG_DATA);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly authService = inject(AuthService);

  readonly documentTypes = DOCUMENT_TYPES;

  readonly step = signal<'form' | 'success'>('form');
  readonly selectedDoc = signal<string | null>(null);
  readonly quantity = signal(1);
  readonly delivery = signal<'pickup' | 'courier'>('pickup');
  readonly submitting = signal(false);
  readonly orderId = signal('');

  customDocType = '';
  deliveryAddress = '';
  contactName = this.authService.profile()?.display_name || '';
  contactPhone = this.authService.profile()?.phone || '';
  comment = '';

  readonly canSubmit = computed(() => {
    const doc = this.selectedDoc();
    if (!doc) return false;
    if (doc === 'other' && !this.customDocType.trim()) return false;
    if (!this.contactName.trim() || !this.contactPhone.trim()) return false;
    if (this.delivery() === 'courier' && !this.deliveryAddress.trim()) return false;
    return true;
  });

  decrementQty(): void {
    if (this.quantity() > 1) this.quantity.set(this.quantity() - 1);
  }

  submit(): void {
    if (!this.canSubmit() || this.submitting()) return;
    this.submitting.set(true);

    const docType = this.selectedDoc() === 'other' ? this.customDocType.trim() : this.selectedDoc();
    const deliveryNote = this.delivery() === 'courier'
      ? `Доставка: ${this.deliveryAddress.trim()}`
      : 'Самовывоз';

    const body = {
      mode: 'simple' as const,
      items: [{
        uploadedUrl: this.data.photoUrl,
        document: docType,
        quantity: this.quantity(),
      }],
      contact: {
        name: this.contactName.trim(),
        phone: this.contactPhone.trim(),
        comments: [
          `Заказ на другой документ (${docType})`,
          `Кол-во: ${this.quantity()} комплект(ов)`,
          deliveryNote,
          this.comment.trim() ? `Комментарий: ${this.comment.trim()}` : '',
        ].filter(Boolean).join('\n'),
      },
      totalPrice: 0, // Price calculated by operator
    };

    this.http.post<{ success: boolean; data: { orderId: string } }>('/api/actions/photo-print-orders', body)
      .subscribe({
        next: (res) => {
          this.orderId.set(res.data.orderId);
          this.step.set('success');
          this.submitting.set(false);
        },
        error: () => {
          this.snackBar.open('Не удалось оформить заказ', 'OK', { duration: 4000 });
          this.submitting.set(false);
        },
      });
  }
}
