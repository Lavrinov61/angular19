import { Component, ChangeDetectionStrategy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatRippleModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpClient } from '@angular/common/http';
import { LoggerService } from '../../../../core/services/logger.service';

export interface MaterialDeliveryDialogData {
  service: {
    title: string;
    id: string;
  };
  materialType: 'physical' | 'digital';
}

export interface Studio {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  timezone: string;
  is_active: boolean;
  default_working_hours: {
    start: string;
    end: string;
  };
  schedule_settings?: Record<string, unknown>;
  booking_settings?: Record<string, unknown>;
  yandex_maps_url?: string;
  google_maps_url?: string;
  gis_2_url?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface DeliveryOption {
  id: 'personal' | 'courier' | 'online';
  title: string;
  subtitle: string;
  icon: string;
  description: string;
  recommended?: boolean;
  studios?: Studio[];
}

@Component({
  selector: 'app-material-delivery-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatRippleModule,
    MatTooltipModule
  ],
  template: `
    <div class="delivery-dialog">
      <div class="dialog-header">
        <div class="service-info">
          <mat-icon class="service-icon">build</mat-icon>
          <div>
            <h2 mat-dialog-title>{{ data.service.title }}</h2>
            <p class="service-subtitle">Выберите способ передачи материалов</p>
          </div>
        </div>
        <button mat-icon-button mat-dialog-close class="close-btn">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div mat-dialog-content class="dialog-content">
        <div class="delivery-options">
          @for (option of deliveryOptions; track option.id || $index) {
            <mat-card 
              class="delivery-option"
              [class.recommended]="option.recommended"
              matRipple
              (click)="selectOption(option)">
              <div class="option-header">
                <mat-icon class="option-icon">{{ option.icon }}</mat-icon>
                <div class="option-info">
                  <h3>{{ option.title }}</h3>
                  <p class="option-subtitle">{{ option.subtitle }}</p>
                </div>
                @if (option.recommended) {
                  <div class="option-badge">
                    <span>Рекомендуем</span>
                  </div>
                }
              </div>
              <p class="option-description">{{ option.description }}</p>
              
              <!-- Studios list for personal delivery -->
              @if (option.id === 'personal' && option.studios?.length) {
                <div class="studios-list">
                  <h4>Наши студии:</h4>
                  @for (studio of option.studios; track studio.id || studio.name || $index) {
                    <div class="studio-item" (click)="selectStudioAndClose(option, studio); $event.stopPropagation()" (keydown.enter)="selectStudioAndClose(option, studio); $event.stopPropagation()" tabindex="0">
                      <div class="studio-info">
                        <div class="studio-name">{{ studio.name }}</div>
                        <div class="studio-address">{{ studio.address }}</div>
                        @if (studio.default_working_hours) {
                          <div class="studio-hours">{{ getWorkingHours(studio) }}</div>
                        }
                        @if (studio.phone) {
                          <div class="studio-phone">{{ studio.phone }}</div>
                        }
                      </div>
                      <div class="studio-maps">
                        @if (studio.yandex_maps_url) {
                          <button mat-icon-button 
                                  (click)="openMap($event, studio.yandex_maps_url)" 
                                  matTooltip="Яндекс.Карты">
                            <mat-icon>map</mat-icon>
                          </button>
                        }
                        @if (studio.google_maps_url) {
                          <button mat-icon-button 
                                  (click)="openMap($event, studio.google_maps_url)" 
                                  matTooltip="Google Maps">
                            <mat-icon>place</mat-icon>
                          </button>
                        }
                        @if (studio.gis_2_url) {
                          <button mat-icon-button 
                                  (click)="openMap($event, studio.gis_2_url)" 
                                  matTooltip="2ГИС">
                            <mat-icon>location_on</mat-icon>
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </mat-card>
          }
        </div>
      </div>      <div mat-dialog-actions class="dialog-actions">
        <button mat-button mat-dialog-close color="primary">
          Отмена
        </button>
        <div class="contact-buttons">
          <button mat-flat-button color="primary" (click)="contactManager('vk')">
            <mat-icon>chat</mat-icon>
            ВКонтакте
          </button>
          <button mat-flat-button color="accent" (click)="contactManager('telegram')">
            <mat-icon>send</mat-icon>
            Telegram
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .delivery-dialog {
      max-width: 600px;
      width: 100%;
    }

    .dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 24px 24px 16px;
      border-bottom: 1px solid var(--mat-divider-color);
    }

    .service-info {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      flex: 1;
    }

    .service-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--mat-primary-color);
      margin-top: 4px;
    }

    h2 {
      margin: 0 0 4px 0;
      font-size: 20px;
      font-weight: 500;
      color: var(--mat-on-surface-color);
    }

    .service-subtitle {
      margin: 0;
      color: var(--mat-on-surface-variant-color);
      font-size: 14px;
    }

    .close-btn {
      margin-top: -8px;
      margin-right: -8px;
    }

    .dialog-content {
      padding: 24px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .delivery-options {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .delivery-option {
      cursor: pointer;
      transition: all 0.2s ease;
      border: 2px solid transparent;
      padding: 20px;
    }

    .delivery-option:hover {
      border-color: var(--mat-primary-color);
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }

    .delivery-option.recommended {
      border-color: var(--mat-primary-color);
      background: rgba(var(--mat-primary-rgb), 0.04);
    }

    .option-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 12px;
    }

    .option-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--mat-primary-color);
      margin-top: 2px;
    }

    .option-info {
      flex: 1;
    }

    .option-info h3 {
      margin: 0 0 4px 0;
      font-size: 16px;
      font-weight: 500;
      color: var(--mat-on-surface-color);
    }

    .option-subtitle {
      margin: 0;
      font-size: 14px;
      color: var(--mat-on-surface-variant-color);
    }

    .option-badge {
      background: var(--mat-primary-color);
      color: var(--mat-on-primary-color);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }    .option-description {
      margin: 0;
      font-size: 14px;
      color: var(--mat-on-surface-variant-color);
      line-height: 1.4;
    }

    .studios-list {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--mat-divider-color);
    }

    .studios-list h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 500;
      color: var(--mat-on-surface-color);
    }

    .studio-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      margin: 8px 0;
      border: 1px solid var(--mat-divider-color);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .studio-item:hover {
      background: rgba(var(--mat-primary-rgb), 0.04);
      border-color: var(--mat-primary-color);
    }

    .studio-info {
      flex: 1;
    }

    .studio-name {
      font-weight: 500;
      color: var(--mat-on-surface-color);
      margin-bottom: 4px;
    }

    .studio-address {
      font-size: 13px;
      color: var(--mat-on-surface-variant-color);
      margin-bottom: 2px;
    }

    .studio-hours, .studio-phone {
      font-size: 12px;
      color: var(--mat-on-surface-variant-color);
      margin-bottom: 2px;
    }

    .studio-maps {
      display: flex;
      gap: 4px;
    }

    .studio-maps button {
      width: 32px;
      height: 32px;
      line-height: 32px;
    }

    .studio-maps mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }    .dialog-actions {
      padding: 16px 24px 24px;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid var(--mat-divider-color);
    }

    .contact-buttons {
      display: flex;
      gap: 8px;
    }

    .dialog-actions button {
      min-width: 100px;
    }

    .contact-buttons button {
      min-width: 120px;
    }

    .dialog-actions mat-icon {
      margin-right: 8px;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }    @media (max-width: 600px) {
      .delivery-dialog {
        margin: 8px;
        max-width: calc(100vw - 16px);
      }
      
      .dialog-header,
      .dialog-content,
      .dialog-actions {
        padding-left: 16px;
        padding-right: 16px;
      }
      
      .option-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      
      .option-badge {
        align-self: flex-start;
      }

      .contact-buttons {
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }

      .contact-buttons button {
        width: 100%;
        min-width: unset;
      }

      .dialog-actions {
        flex-direction: column;
        align-items: stretch;
      }

      .dialog-actions > button[mat-button] {
        order: 2;
        margin-top: 8px;
      }

      .contact-buttons {
        order: 1;
      }
    }
  `]
})
export class MaterialDeliveryDialogComponent implements OnInit {
  private readonly log = inject(LoggerService);
  private readonly dialogRef = inject(MatDialogRef<MaterialDeliveryDialogComponent>);
  readonly data = inject<MaterialDeliveryDialogData>(MAT_DIALOG_DATA);
  private readonly http = inject(HttpClient);
  deliveryOptions: DeliveryOption[] = [];

  ngOnInit(): void {
    this.loadStudios();
  }  private loadStudios(): void {
    this.log.debug('Загружаем студии...');
    this.http.get<{success: boolean, data: Studio[]} | {success: boolean, studios: Studio[]}>(`/api/schedule/studios`)
      .subscribe({
        next: (response) => {
          this.log.debug('Ответ API студий:', response);
          // Поддерживаем оба формата ответа: data и studios
          const studios = response.success ?
            ('data' in response ? response.data : 'studios' in response ? response.studios : []) :
            [];
          this.log.debug('Студии для диалога:', studios);
          this.setupDeliveryOptions(studios);
        },
        error: (error) => {
          this.log.error('Ошибка загрузки студий:', error);
          this.setupDeliveryOptions([]);
        }
      });
  }

  private setupDeliveryOptions(studios: Studio[]): void {
    const activeStudios = studios?.filter(s => s.is_active) || [];
    
    if (this.data.materialType === 'physical') {
      this.deliveryOptions = [
        {
          id: 'personal',
          title: 'Прийти лично',
          subtitle: 'В одну из наших студий',
          icon: 'store',
          description: 'Принесите материалы в удобную студию. Мы работаем в 3 точках Ростова-на-Дону.',
          recommended: true,
          studios: activeStudios
        },
        {
          id: 'courier',
          title: 'Доставка курьером',
          subtitle: 'Яндекс.Доставка',
          icon: 'delivery_dining',
          description: 'Заберём материалы у вас и доставим готовый результат обратно. Стоимость доставки рассчитывается отдельно.'
        }
      ];
    } else {
      this.deliveryOptions = [
        {
          id: 'online',
          title: 'Отправить онлайн',
          subtitle: 'Email, облако, мессенджеры',
          icon: 'cloud_upload',
          description: 'Загрузите файлы через облачные сервисы или отправьте по email. Быстро и удобно.',
          recommended: true
        },
        {
          id: 'personal',
          title: 'Прийти лично',
          subtitle: 'USB, диск, флешка',
          icon: 'store',
          description: 'Принесите файлы на носителе в нашу студию. Подходит для больших объёмов данных.',
          studios: activeStudios
        },
        {
          id: 'courier',
          title: 'Доставка курьером',
          subtitle: 'Для больших объёмов',
          icon: 'delivery_dining',
          description: 'Если нужно передать много материалов на физических носителях.'
        }
      ];
    }
  }

  selectOption(option: DeliveryOption): void {
    // If it's personal delivery and has studios, don't close immediately
    if (option.id === 'personal' && option.studios?.length) {
      return; // User should click on specific studio
    }
    
    this.dialogRef.close({
      selectedOption: option,
      action: 'select'
    });
  }

  selectStudioAndClose(option: DeliveryOption, studio: Studio): void {
    this.dialogRef.close({
      selectedOption: option,
      selectedStudio: studio,
      action: 'select'
    });
  }

  openMap(event: Event, url?: string): void {
    event.stopPropagation();
    if (url) {
      window.open(url, '_blank');
    }
  }
  contactManager(messenger: 'vk' | 'telegram' = 'vk'): void {
    this.dialogRef.close({
      action: 'contact',
      messenger: messenger,
      selectedOption: null
    });
  }

  getWorkingHours(studio: Studio): string {
    if (studio.default_working_hours) {
      return `${studio.default_working_hours.start} - ${studio.default_working_hours.end}`;
    }
    return 'Уточните время работы';
  }
}
