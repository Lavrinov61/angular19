import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';

import { OrderHistory, OrderType, OrderStatus, PaymentStatus } from '../../../../core/models/order-history.model';

@Component({
  selector: 'app-order-details-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatCardModule,
    MatChipsModule,
    MatTooltipModule,
    DatePipe
  ],
  template: `
    <div class="order-details-dialog">
      <h2 mat-dialog-title>
        <div class="title-with-icon">
          <div class="type-icon-container" [class]="getOrderTypeClass()">
            <mat-icon>{{ getOrderTypeIcon() }}</mat-icon>
          </div>
          <span>{{ getOrderTitle() }}</span>
        </div>
        <button mat-icon-button mat-dialog-close>
          <mat-icon>close</mat-icon>
        </button>
      </h2>

      <mat-dialog-content>
        <div class="order-header">
          <div class="order-id">
            <span class="label">Номер заказа:</span>
            <span class="value">{{ order.id }}</span>
          </div>
          <div class="order-date">
            <span class="label">Дата заказа:</span>
            <span class="value">{{ order.createdAt | date:'dd.MM.yyyy HH:mm' }}</span>
          </div>
          <div class="order-status">
            <span class="label">Статус:</span>
            <mat-chip [class]="getStatusClass()">
              {{ getStatusText() }}
            </mat-chip>
          </div>
        </div>

        <mat-divider />

        <!-- Детали в зависимости от типа заказа -->
        <div class="order-specific-details">
          <!-- Фотосессия -->
          @if (order.orderType === 'photo_session' && order.photoSession) {
            <ng-container>
              <div class="detail-section">
                <h3>Детали фотосессии</h3>
                
                <div class="detail-row">
                  <span class="detail-label">Название:</span>
                  <span class="detail-value">{{ order.photoSession.title }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Дата и время:</span>
                  <span class="detail-value">{{ order.photoSession.date | date:'dd.MM.yyyy HH:mm' }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Локация:</span>
                  <span class="detail-value">{{ order.photoSession.location }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Фотограф:</span>
                  <span class="detail-value">{{ order.photoSession.photographerName }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Продолжительность:</span>
                  <span class="detail-value">{{ order.photoSession.durationMinutes }} минут</span>
                </div>
                
                @if (order.photoSession.photoCount) {
                  <div class="detail-row">
                    <span class="detail-label">Количество фотографий:</span>
                    <span class="detail-value">{{ order.photoSession.photoCount }}</span>
                  </div>
                }
              </div>
            </ng-container>
          }

          <!-- Фото на документы -->
          @if (order.orderType === 'document_photo' && order.documentPhoto) {
            <ng-container>
              <div class="detail-section">
                <h3>Детали фото на документы</h3>
                
                <div class="detail-row">
                  <span class="detail-label">Тип документа:</span>
                  <span class="detail-value">{{ order.documentPhoto.documentType }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Количество:</span>
                  <span class="detail-value">{{ order.documentPhoto.quantity }} шт.</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Формат:</span>
                  <span class="detail-value">{{ order.documentPhoto.format }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Цифровая копия:</span>
                  <span class="detail-value">{{ order.documentPhoto.withDigital ? 'Да' : 'Нет' }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Ретушь:</span>
                  <span class="detail-value">{{ order.documentPhoto.withRetouching ? 'Да' : 'Нет' }}</span>
                </div>
              </div>
            </ng-container>
          }

          <!-- Реставрация фотографий -->
          @if (order.orderType === 'photo_restoration' && order.photoRestoration) {
            <ng-container>
              <div class="detail-section">
                <h3>Детали реставрации фотографий</h3>
                
                <div class="detail-row">
                  <span class="detail-label">Сложность:</span>
                  <span class="detail-value">{{ getComplexityText(order.photoRestoration.complexity) }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Уровень реставрации:</span>
                  <span class="detail-value">{{ order.photoRestoration.restorationLevel }}</span>
                </div>
                
                @if (order.photoRestoration.comments) {
                  <div class="detail-row">
                    <span class="detail-label">Комментарии:</span>
                    <span class="detail-value">{{ order.photoRestoration.comments }}</span>
                  </div>
                }
                
                @if (order.photoRestoration.originalPhotoUrl || order.photoRestoration.restoredPhotoUrl) {
                  <div class="photos-preview">
                    @if (order.photoRestoration.originalPhotoUrl) {
                      <div class="photo-card">
                        <h4>Исходное фото</h4>
                        <img [src]="order.photoRestoration.originalPhotoUrl" alt="Исходное фото">
                      </div>
                    }
                    
                    @if (order.photoRestoration.restoredPhotoUrl) {
                      <div class="photo-card">
                        <h4>Отреставрированное фото</h4>
                        <img [src]="order.photoRestoration.restoredPhotoUrl" alt="Отреставрированное фото">
                      </div>
                    }
                  </div>
                }
              </div>
            </ng-container>
          }

          <!-- Печать фотографий -->
          @if (order.orderType === 'photo_printing' && order.photoPrinting) {
            <ng-container>
              <div class="detail-section">
                <h3>Детали печати фотографий</h3>
                
                <div class="detail-row">
                  <span class="detail-label">Количество:</span>
                  <span class="detail-value">{{ order.photoPrinting.quantity }} шт.</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Формат:</span>
                  <span class="detail-value">{{ order.photoPrinting.format }}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Тип бумаги:</span>
                  <span class="detail-value">{{ order.photoPrinting.paperType }}</span>
                </div>
                
                @if (order.photoPrinting.withFrame) {
                  <div class="detail-row">
                    <span class="detail-label">Рамка:</span>
                    <span class="detail-value">{{ order.photoPrinting.frameType }}</span>
                  </div>
                }
              </div>
            </ng-container>
          }
        </div>

        <mat-divider />

        <!-- Платежная информация -->
        <div class="payment-info">
          <h3>Платежная информация</h3>
          
          <div class="payment-details">
            <div class="payment-row">
              <span class="payment-label">Статус оплаты:</span>
              <mat-chip [class]="getPaymentStatusClass()">
                {{ getPaymentStatusText() }}
              </mat-chip>
            </div>
            
            <div class="payment-row">
              <span class="payment-label">Сумма:</span>
              <span class="payment-value price">{{ order.totalPrice }} ₽</span>
            </div>
            
            @if (order.paymentMethod) {
              <div class="payment-row">
                <span class="payment-label">Способ оплаты:</span>
                <span class="payment-value">{{ order.paymentMethod }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Дополнительная информация -->
        @if (order.additionalInfo) {
          <ng-container>
            <mat-divider />
            
            <div class="additional-info">
              <h3>Дополнительная информация</h3>
              
              @if (order.additionalInfo.comments) {
                <div class="detail-row">
                  <span class="detail-label">Комментарии:</span>
                  <span class="detail-value">{{ order.additionalInfo.comments }}</span>
                </div>
              }
              
              @if (order.additionalInfo.specialRequirements) {
                <div class="detail-row">
                  <span class="detail-label">Особые требования:</span>
                  <span class="detail-value">{{ order.additionalInfo.specialRequirements }}</span>
                </div>
              }
              
              @if (order.additionalInfo.deliveryInfo) {
                <ng-container>
                  <h4>Информация о доставке</h4>
                  
                  <div class="detail-row">
                    <span class="detail-label">Способ получения:</span>
                    <span class="detail-value">{{ getDeliveryMethodText(order.additionalInfo.deliveryInfo.method) }}</span>
                  </div>
                  
                  @if (order.additionalInfo.deliveryInfo.address) {
                    <div class="detail-row">
                      <span class="detail-label">Адрес доставки:</span>
                      <span class="detail-value">{{ order.additionalInfo.deliveryInfo.address }}</span>
                    </div>
                  }
                  
                  @if (order.additionalInfo.deliveryInfo.trackingNumber) {
                    <div class="detail-row">
                      <span class="detail-label">Номер отслеживания:</span>
                      <span class="detail-value">{{ order.additionalInfo.deliveryInfo.trackingNumber }}</span>
                    </div>
                  }
                </ng-container>
              }
            </div>
          </ng-container>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>Закрыть</button>
        
        @if (order.status === 'waiting') {
          <button 
            mat-raised-button 
            color="accent" 
            (click)="goToApproval()"
          >
            <mat-icon>check_circle</mat-icon>
            Подтвердить заказ
          </button>
        }
        
        @if (canViewPhotos()) {
          <button 
            mat-raised-button 
            color="primary" 
            (click)="viewPhotos()"
          >
            <mat-icon>photo_library</mat-icon>
            Посмотреть фотографии
          </button>
        }
      </mat-dialog-actions>
    </div>
  `,
  styles: `
    .order-details-dialog {
      max-width: 800px;
    }
    
    mat-dialog-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0;
    }
    
    .title-with-icon {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .type-icon-container {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      color: white;
    }
    
    .photo-session-icon {
      background-color: #7b1fa2;
    }
    
    .document-photo-icon {
      background-color: #1976d2;
    }
    
    .restoration-icon {
      background-color: #c2185b;
    }
    
    .printing-icon {
      background-color: #388e3c;
    }
    
    .editing-icon {
      background-color: #f57c00;
    }
    
    .products-icon {
      background-color: #0097a7;
    }
    
    .framing-icon {
      background-color: #6d4c41;
    }
    
    mat-dialog-content {
      margin-top: 20px;
      max-height: 70vh;
    }
    
    .order-header {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 20px;
    }
    
    .order-header > div {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .label {
      font-weight: 500;
      color: rgba(0, 0, 0, 0.6);
    }
    
    .value {
      font-weight: 400;
    }
    
    mat-divider {
      margin: 20px 0;
    }
    
    .detail-section, .payment-info, .additional-info {
      margin-bottom: 24px;
    }
    
    h3 {
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 16px;
      color: rgba(0, 0, 0, 0.87);
    }
    
    h4 {
      font-size: 16px;
      font-weight: 500;
      margin: 16px 0 8px;
      color: rgba(0, 0, 0, 0.87);
    }
    
    .detail-row, .payment-row {
      display: flex;
      margin-bottom: 8px;
      align-items: baseline;
    }
    
    .detail-label, .payment-label {
      font-weight: 500;
      color: rgba(0, 0, 0, 0.6);
      width: 200px;
      flex-shrink: 0;
    }
    
    .detail-value, .payment-value {
      flex: 1;
    }
    
    .price {
      font-weight: 500;
      color: #1976d2;
    }
    
    .photos-preview {
      display: flex;
      gap: 16px;
      margin-top: 16px;
      flex-wrap: wrap;
    }
    
    .photo-card {
      width: calc(50% - 8px);
      overflow: hidden;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    
    .photo-card h4 {
      padding: 8px;
      margin: 0;
      background-color: #f5f5f5;
      text-align: center;
    }
    
    .photo-card img {
      width: 100%;
      height: auto;
      object-fit: cover;
    }
    
    /* Стили для статусов */
    .status-new {
      background-color: #2196f3;
      color: white;
    }
    
    .status-processing {
      background-color: #ff9800;
      color: white;
    }
    
    .status-waiting {
      background-color: #9c27b0;
      color: white;
    }
    
    .status-ready {
      background-color: #4caf50;
      color: white;
    }
    
    .status-completed {
      background-color: #3f51b5;
      color: white;
    }
    
    .status-cancelled, .payment-cancelled {
      background-color: #f44336;
      color: white;
    }
    
    .status-refunded, .payment-refunded {
      background-color: #9e9e9e;
      color: white;
    }
    
    /* Стили для статусов оплаты */
    .payment-pending {
      background-color: #ff9800;
      color: white;
    }
    
    .payment-partial {
      background-color: #2196f3;
      color: white;
    }
    
    .payment-paid {
      background-color: #4caf50;
      color: white;
    }
    
    @media (max-width: 600px) {
      .detail-row, .payment-row {
        flex-direction: column;
        margin-bottom: 16px;
      }
      
      .detail-label, .payment-label {
        width: 100%;
        margin-bottom: 4px;
      }
      
      .photo-card {
        width: 100%;
      }
    }
  `
})
export class OrderDetailsDialogComponent {
  order = inject<OrderHistory>(MAT_DIALOG_DATA);
  dialogRef = inject<MatDialogRef<OrderDetailsDialogComponent>>(MatDialogRef);

  
  /**
   * Получить заголовок заказа
   */
  getOrderTitle(): string {
    switch (this.order.orderType) {
      case OrderType.PHOTO_SESSION:
        return this.order.photoSession?.title || 'Фотосессия';
      case OrderType.DOCUMENT_PHOTO:
        return `Фото на ${this.order.documentPhoto?.documentType || 'документы'}`;
      case OrderType.PHOTO_RESTORATION:
        return 'Реставрация фотографий';
      case OrderType.PHOTO_PRINTING:
        return 'Печать фотографий';
      case OrderType.PHOTO_EDITING:
        return 'Ретушь и обработка фотографий';
      case OrderType.PHOTO_PRODUCTS:
        return 'Фотопродукция';
      case OrderType.FRAMING:
        return 'Багетные работы';
      default:
        return 'Заказ';
    }
  }
  
  /**
   * Получить класс иконки для типа заказа
   */
  getOrderTypeClass(): string {
    switch (this.order.orderType) {
      case OrderType.PHOTO_SESSION:
        return 'photo-session-icon';
      case OrderType.DOCUMENT_PHOTO:
        return 'document-photo-icon';
      case OrderType.PHOTO_RESTORATION:
        return 'restoration-icon';
      case OrderType.PHOTO_PRINTING:
        return 'printing-icon';
      case OrderType.PHOTO_EDITING:
        return 'editing-icon';
      case OrderType.PHOTO_PRODUCTS:
        return 'products-icon';
      case OrderType.FRAMING:
        return 'framing-icon';
      default:
        return 'photo-session-icon';
    }
  }
  
  /**
   * Получить иконку для типа заказа
   */
  getOrderTypeIcon(): string {
    switch (this.order.orderType) {
      case OrderType.PHOTO_SESSION:
        return 'photo_camera';
      case OrderType.DOCUMENT_PHOTO:
        return 'badge';
      case OrderType.PHOTO_RESTORATION:
        return 'auto_fix_high';
      case OrderType.PHOTO_PRINTING:
        return 'print';
      case OrderType.PHOTO_EDITING:
        return 'tune';
      case OrderType.PHOTO_PRODUCTS:
        return 'card_giftcard';
      case OrderType.FRAMING:
        return 'crop_square';
      default:
        return 'receipt_long';
    }
  }
  
  /**
   * Получить класс для статуса заказа
   */
  getStatusClass(): string {
    switch (this.order.status) {
      case OrderStatus.NEW:
        return 'status-new';
      case OrderStatus.PROCESSING:
        return 'status-processing';
      case OrderStatus.WAITING_APPROVAL:
        return 'status-waiting';
      case OrderStatus.READY:
        return 'status-ready';
      case OrderStatus.COMPLETED:
        return 'status-completed';
      case OrderStatus.CANCELLED:
        return 'status-cancelled';
      case OrderStatus.REFUNDED:
        return 'status-refunded';
      default:
        return '';
    }
  }
  
  /**
   * Получить текст статуса заказа
   */
  getStatusText(): string {
    switch (this.order.status) {
      case OrderStatus.NEW:
        return 'Новый';
      case OrderStatus.PROCESSING:
        return 'В обработке';
      case OrderStatus.WAITING_APPROVAL:
        return 'Ожидает подтверждения';
      case OrderStatus.READY:
        return 'Готов к выдаче';
      case OrderStatus.COMPLETED:
        return 'Завершен';
      case OrderStatus.CANCELLED:
        return 'Отменен';
      case OrderStatus.REFUNDED:
        return 'Возврат средств';
      default:
        return 'Неизвестный статус';
    }
  }
  
  /**
   * Получить класс для статуса оплаты
   */
  getPaymentStatusClass(): string {
    switch (this.order.paymentStatus) {
      case PaymentStatus.PENDING:
        return 'payment-pending';
      case PaymentStatus.PARTIAL:
        return 'payment-partial';
      case PaymentStatus.PAID:
        return 'payment-paid';
      case PaymentStatus.REFUNDED:
        return 'payment-refunded';
      case PaymentStatus.CANCELLED:
        return 'payment-cancelled';
      default:
        return '';
    }
  }
  
  /**
   * Получить текст статуса оплаты
   */
  getPaymentStatusText(): string {
    switch (this.order.paymentStatus) {
      case PaymentStatus.PENDING:
        return 'Ожидает оплаты';
      case PaymentStatus.PARTIAL:
        return 'Частично оплачено';
      case PaymentStatus.PAID:
        return 'Оплачено';
      case PaymentStatus.REFUNDED:
        return 'Возврат средств';
      case PaymentStatus.CANCELLED:
        return 'Платеж отменен';
      default:
        return 'Неизвестный статус';
    }
  }
  
  /**
   * Получить текст для сложности реставрации
   */
  getComplexityText(complexity: 'simple' | 'medium' | 'complex'): string {
    switch (complexity) {
      case 'simple':
        return 'Простая';
      case 'medium':
        return 'Средняя';
      case 'complex':
        return 'Сложная';
      default:
        return 'Неизвестно';
    }
  }
  
  /**
   * Получить текст для способа доставки
   */
  getDeliveryMethodText(method: 'pickup' | 'delivery'): string {
    return method === 'pickup' ? 'Самовывоз' : 'Доставка';
  }
  
  /**
   * Можно ли просмотреть фотографии
   */
  canViewPhotos(): boolean {
    if (this.order.orderType === OrderType.PHOTO_SESSION) {
      return this.order.status === OrderStatus.COMPLETED || 
             this.order.status === OrderStatus.WAITING_APPROVAL ||
             this.order.status === OrderStatus.READY;
    }
    return false;
  }
  
  /**
   * Открыть фотографии
   */
  viewPhotos(): void {
    this.dialogRef.close({ action: 'view_photos', orderId: this.order.id });
  }
  
  /**
   * Перейти к подтверждению заказа
   */
  goToApproval(): void {
    this.dialogRef.close({ action: 'approve', orderId: this.order.id });
  }
}
