import { Component, ElementRef, AfterViewInit, ChangeDetectionStrategy, inject, viewChild } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';

import { PhotoPermission } from '../../../../core/models/photo-permission.model';

export interface SignatureDialogData {
  permission: PhotoPermission;
}

@Component({
  selector: 'app-signature-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule
],
  template: `
    <div class="signature-dialog">
      <h2 mat-dialog-title>Подписать разрешение</h2>
      
      <mat-dialog-content>
        <div class="dialog-content">
          <p class="description">
            Подписывая это разрешение, вы даете согласие на использование ваших фотографий в соответствии с указанными целями.
          </p>
          
          <div class="permissions-summary">
            <h3>Разрешение на использование фотографий для:</h3>
            <ul>
              @for (purpose of data.permission.purposes; track purpose || $index) {
                <li>
                  {{ getPurposeText(purpose) }}
                </li>
              }
            </ul>
          </div>
          
          <mat-divider />
          
          <div class="signature-container">
            <p>Пожалуйста, поставьте вашу подпись ниже:</p>
            
            <div class="signature-pad-container">
              <canvas #signaturePad class="signature-pad"></canvas>
              
              <div class="signature-pad-controls">
                <button 
                  mat-stroked-button 
                  color="primary" 
                  type="button" 
                  (click)="clearSignature()"
                >
                  <mat-icon>refresh</mat-icon>
                  Очистить
                </button>
              </div>
            </div>
          </div>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions align="end">
        <button mat-button [mat-dialog-close]="false">Отмена</button>
        <button 
          mat-raised-button 
          color="primary" 
          [disabled]="isSignatureEmpty" 
          (click)="confirmSignature()"
        >
          Подписать и одобрить
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .signature-dialog {
      max-width: 100%;
    }
    
    .dialog-content {
      padding: 0;
    }
    
    .description {
      margin-bottom: 20px;
      color: var(--ed-on-surface, #f5f5f5);
    }
    
    .permissions-summary {
      margin-bottom: 24px;
      
      h3 {
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 12px;
      }
      
      ul {
        padding-left: 20px;
        
        li {
          margin-bottom: 8px;
        }
      }
    }
    
    .signature-container {
      margin-top: 24px;
      
      p {
        margin-bottom: 16px;
      }
    }
    
    .signature-pad-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    }
    
    .signature-pad {
      width: 100%;
      height: 150px;
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 4px;
      margin-bottom: 16px;
      background-color: var(--ed-surface-container-lowest, #0a0a0a);
      touch-action: none;
    }
    
    .signature-pad-controls {
      align-self: flex-end;
    }
  `]
})
export class SignatureDialogComponent implements AfterViewInit {
  dialogRef = inject<MatDialogRef<SignatureDialogComponent>>(MatDialogRef);
  data = inject<SignatureDialogData>(MAT_DIALOG_DATA);

  readonly signaturePadElement = viewChild.required<ElementRef>('signaturePad');
  
  private signaturePad: HTMLCanvasElement | null = null;
  private ctx!: CanvasRenderingContext2D;
  isSignatureEmpty = true;
  
  ngAfterViewInit() {
    const canvas = this.signaturePadElement().nativeElement;
    this.ctx = canvas.getContext('2d');
    
    // Установка размеров canvas
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    // Настройка стиля линии
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = 'round';
    this.ctx.strokeStyle = '#000000';
    
    this.setupSignaturePad();
  }
  
  /**
   * Настройка обработчиков событий для подписи
   */
  private setupSignaturePad() {
    const canvas = this.signaturePadElement().nativeElement;
    let drawing = false;
    let lastX = 0;
    let lastY = 0;
    
    // Функция начала рисования
    const startDrawing = (e: MouseEvent | TouchEvent) => {
      drawing = true;
      const pos = this.getPosition(e);
      lastX = pos.x;
      lastY = pos.y;
      this.ctx.beginPath();
      this.ctx.moveTo(lastX, lastY);
    };
    
    // Функция продолжения рисования
    const draw = (e: MouseEvent | TouchEvent) => {
      if (!drawing) return;
      
      const pos = this.getPosition(e);
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
      lastX = pos.x;
      lastY = pos.y;
      this.isSignatureEmpty = false;
    };
    
    // Функция окончания рисования
    const stopDrawing = () => {
      drawing = false;
    };
    
    // Регистрация обработчиков событий мыши
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    
    // Регистрация обработчиков событий касания
    canvas.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      startDrawing(e);
    });
    canvas.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      draw(e);
    });
    canvas.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault();
      stopDrawing();
    });
  }
  
  /**
   * Получить координаты курсора/касания относительно canvas
   */
  private getPosition(e: MouseEvent | TouchEvent) {
    const canvas = this.signaturePadElement().nativeElement;
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    
    if (e instanceof MouseEvent) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      // TouchEvent
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }
  
  /**
   * Очистить подпись
   */
  clearSignature() {
    this.ctx.clearRect(
      0, 
      0, 
      this.signaturePadElement().nativeElement.width, 
      this.signaturePadElement().nativeElement.height
    );
    this.isSignatureEmpty = true;
  }
  
  /**
   * Подтвердить подпись
   */
  confirmSignature() {
    if (this.isSignatureEmpty) return;
    
    const signatureImage = this.signaturePadElement().nativeElement.toDataURL('image/png');
    this.dialogRef.close({ signatureImage });
  }
  
  /**
   * Получить текст цели использования
   */
  getPurposeText(purpose: string): string {
    switch (purpose) {
      case 'advertising':
        return 'Реклама студии Своё Фото';
      case 'portfolio':
        return 'Включение в портфолио фотографа';
      case 'social_media':
        return 'Публикация в социальных сетях студии';
      case 'print_media':
        return 'Использование в печатных рекламных материалах';
      case 'website':
        return 'Размещение на веб-сайте студии';
      case 'competitions':
        return 'Участие в фотоконкурсах и выставках';
      case 'educational':
        return 'Использование в обучающих материалах';
      default:
        return purpose;
    }
  }
}
