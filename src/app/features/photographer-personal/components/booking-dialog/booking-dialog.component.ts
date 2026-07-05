import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { FormsModule } from '@angular/forms';

import { PhotographerPersonalProfile } from '../../models/photographer.interfaces';
import { LoggerService } from '../../../../core/services/logger.service';

@Component({
  selector: 'app-booking-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    FormsModule
  ],
  template: `
    <div class="booking-dialog">
      <h2 mat-dialog-title>
        <mat-icon>event_available</mat-icon>
        Бронирование съемки - {{ data.photographer.name }}
      </h2>
      
      <mat-dialog-content>
        <form class="booking-form">
          <mat-form-field appearance="outline">
            <mat-label>Ваше имя</mat-label>
            <input matInput [(ngModel)]="formData().name" name="name" required>
          </mat-form-field>
          
          <mat-form-field appearance="outline">
            <mat-label>Телефон</mat-label>
            <input matInput [(ngModel)]="formData().phone" name="phone" required>
          </mat-form-field>
          
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput type="email" [(ngModel)]="formData().email" name="email">
          </mat-form-field>
          
          <mat-form-field appearance="outline">
            <mat-label>Дата съемки</mat-label>
            <input matInput [matDatepicker]="picker" [(ngModel)]="formData().date" name="date" required>
            <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
            <mat-datepicker #picker></mat-datepicker>
          </mat-form-field>
          
          <mat-form-field appearance="outline">
            <mat-label>Тип съемки</mat-label>
            <mat-select [(ngModel)]="formData().packageType" name="packageType">
              @for (package of data.photographer.desire.packages; track package.id) {
                <mat-option [value]="package.id">{{ package.name }} - {{ package.price }}₽</mat-option>
              }
            </mat-select>
          </mat-form-field>
          
          <mat-form-field appearance="outline">
            <mat-label>Комментарий к заказу</mat-label>
            <textarea matInput rows="3" [(ngModel)]="formData().comment" name="comment"
                      placeholder="Расскажите подробнее о ваших пожеланиях..."></textarea>
          </mat-form-field>
        </form>
        
        <div class="pricing-info">
          <h3>Специальное предложение!</h3>
          <p class="discount-info">
            <mat-icon>local_offer</mat-icon>
            При оплате онлайн скидка {{ data.photographer.action.onlineDiscount }}%
          </p>
          <p class="bonus-info">
            <mat-icon>card_giftcard</mat-icon>
            {{ data.photographer.action.bonusOffer }}
          </p>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions>
        <button mat-button (click)="onCancel()">Отмена</button>
        <button mat-raised-button color="primary" (click)="onSubmit()" [disabled]="!isFormValid()">
          <mat-icon>send</mat-icon>
          Отправить заявку
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .booking-dialog {
      max-width: 500px;
      
      h2 {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--primary-color, #1976d2);
        margin-bottom: 20px;
      }
      
      .booking-form {
        display: flex;
        flex-direction: column;
        gap: 15px;
        margin-bottom: 20px;
        
        mat-form-field {
          width: 100%;
        }
      }
      
      .pricing-info {
        background: #f8f9fa;
        padding: 15px;
        border-radius: 10px;
        border-left: 4px solid var(--primary-color, #1976d2);
        
        h3 {
          margin: 0 0 10px;
          color: var(--primary-color, #1976d2);
          font-size: 1.1rem;
        }
        
        .discount-info,
        .bonus-info {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 8px 0;
          font-size: 0.9rem;
          
          mat-icon {
            color: #4caf50;
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }
      }
      
      mat-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 20px 0 0;
      }
    }
  `]
})
export class BookingDialogComponent {
  readonly data = inject<{photographer: PhotographerPersonalProfile}>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<BookingDialogComponent>);
  private log = inject(LoggerService);
  
  readonly formData = signal({
    name: '',
    phone: '',
    email: '',
    date: null,
    packageType: '',
    comment: ''
  });
  
  isFormValid(): boolean {
    const form = this.formData();
    return !!(form.name && form.phone && form.date && form.packageType);
  }
  
  onSubmit(): void {
    if (this.isFormValid()) {
      this.log.debug('Отправка заявки на бронирование:', this.formData());
      this.dialogRef.close({ success: true, data: this.formData() });
    }
  }
  
  onCancel(): void {
    this.dialogRef.close({ success: false });
  }
}
