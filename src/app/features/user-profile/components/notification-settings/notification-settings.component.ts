import { Component, OnInit, inject, PLATFORM_ID, signal, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';

import { NotificationApiService, NotificationSettings } from '../../../../core/services/notification-api.service';

@Component({
  selector: 'app-notification-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCheckboxModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatDividerModule
  ],
  templateUrl: './notification-settings.component.html',
  styleUrls: ['./notification-settings.component.scss']
})
export class NotificationSettingsComponent implements OnInit {
  private notificationApiService = inject(NotificationApiService);
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private platformId = inject(PLATFORM_ID);
  
  settingsForm!: FormGroup;
  protected isPushSupported = signal(false); // Будет установлено в ngOnInit
  pushPermission = this.notificationApiService.pushPermission;
  loading = this.notificationApiService.isLoading;
  
  ngOnInit(): void {
    // Проверяем поддержку push уведомлений только в браузере
    if (isPlatformBrowser(this.platformId)) {
      this.isPushSupported.set('Notification' in window);
    }
    
    this.initForm();
    this.loadSettings();
  }
  
  /**
   * Инициализация формы
   */
  initForm(): void {
    this.settingsForm = this.formBuilder.group({
      bookingConfirmation: [true],
      bookingReminders: [true],
      specialOffers: [false],
      systemUpdates: [true],
      userPreferences: this.formBuilder.group({
        preferredDeliveryTime: ['09:00'],
        emailNotifications: [true],
        pushNotifications: [this.isPushSupported()],
        smsNotifications: [false]
      })
    });
    
    // Отслеживаем изменения в настройках push-уведомлений
    this.settingsForm.get('userPreferences.pushNotifications')?.valueChanges.subscribe(value => {
      if (value && this.isPushSupported() && !this.pushPermission()) {
        this.requestPushPermission();
      }
    });
  }
  /**
   * Загрузка настроек пользователя
   */
  loadSettings(): void {
    this.notificationApiService.getNotificationSettings().subscribe({
      next: (response) => {
        if (response.data) {
          this.settingsForm.patchValue(response.data);
        }
      },
      error: () => {
        this.snackBar.open('Error loading notification settings', 'Close', { duration: 3000 });
      }
    });
  }
    /**
   * Сохранение настроек
   */
  async saveSettings(): Promise<void> {
    if (this.settingsForm.invalid) {
      return;
    }
    
    const settings = this.settingsForm.value as NotificationSettings;
    
    try {
      this.notificationApiService.updateNotificationSettings(settings).subscribe({
        next: (response) => {
          if (response.success) {
            this.snackBar.open('Настройки уведомлений сохранены', 'ОК', {
              duration: 3000,
              horizontalPosition: 'center',
              verticalPosition: 'bottom'
            });
          } else {
            throw new Error('Не удалось сохранить настройки');
          }
        },
        error: () => {
          this.snackBar.open('Ошибка при сохранении настроек', 'ОК', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom'
          });
        }
      });
    } catch {
      this.snackBar.open('Ошибка при сохранении настроек', 'ОК', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    }
  }
    /**
   * Запрос разрешения на push-уведомления
   */
  async requestPushPermission(): Promise<void> {
    if (!this.isPushSupported()) {
      this.snackBar.open('Push-уведомления не поддерживаются вашим браузером', 'ОК', {
        duration: 3000
      });
      return;
    }
    
    try {
      const granted = await this.notificationApiService.requestPushPermission();
      
      if (granted !== 'granted') {
        this.settingsForm.get('userPreferences.pushNotifications')?.setValue(false, { emitEvent: false });
        this.snackBar.open('Разрешение на push-уведомления не получено', 'ОК', {
          duration: 3000
        });
      }
    } catch {
      this.settingsForm.get('userPreferences.pushNotifications')?.setValue(false, { emitEvent: false });
    }
  }
  /**
   * Отключение push-уведомлений
   */
  async disablePushNotifications(): Promise<void> {
    if (!this.isPushSupported()) {
      return;
    }
    
    try {
      this.notificationApiService.unsubscribeFromPush().subscribe({
        next: (response) => {
          if (response.success) {
            // Обновляем форму
            this.settingsForm.get('userPreferences.pushNotifications')?.setValue(false, { emitEvent: false });
            this.snackBar.open('Push-уведомления отключены', 'ОК', { duration: 3000 });
          }
        },
        error: () => {
          this.snackBar.open('Произошла ошибка при отключении уведомлений', 'ОК', { duration: 3000 });
        }
      });
    } catch {
      this.snackBar.open('Произошла ошибка при отключении уведомлений', 'ОК', { duration: 3000 });
    }
  }
}
