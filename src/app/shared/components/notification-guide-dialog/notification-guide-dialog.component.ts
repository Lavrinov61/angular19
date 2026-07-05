import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthChatService } from '../../../core/services/auth-chat.service';

export interface NotificationGuideDialogData {
  permission?: NotificationPermission;
}

type DeviceKind = 'android_chrome' | 'android_firefox' | 'android_other' | 'ios_safari' | 'desktop_chrome' | 'desktop_edge' | 'desktop_firefox' | 'desktop_safari' | 'desktop_other';

interface GuideStep {
  icon: string;
  title: string;
  text: string;
}

@Component({
  selector: 'app-notification-guide-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="guide-dialog">
      <div class="guide-header">
        <mat-icon class="header-icon">notifications_off</mat-icon>
        <h2>Уведомления заблокированы</h2>
        <p>Разрешите уведомления, чтобы не пропустить ответ оператора</p>
      </div>

      <div class="guide-device">
        <mat-icon>{{ isMobile() ? 'phone_android' : 'computer' }}</mat-icon>
        <span>{{ deviceLabel() }}</span>
        <span class="permission-badge">{{ permissionLabel() }}</span>
      </div>

      <div class="steps-list">
        @for (step of steps(); let i = $index; track step.title) {
          <div class="step" [class.active]="i === stepIndex()">
            <div class="step-number">{{ i + 1 }}</div>
            <div class="step-content">
              <div class="step-title">
                <mat-icon>{{ step.icon }}</mat-icon>
                {{ step.title }}
              </div>
              <div class="step-text">{{ step.text }}</div>
            </div>
          </div>
        }
      </div>

      @if (deviceKind() === 'ios_safari') {
        <div class="guide-note">
          <mat-icon>info</mat-icon>
          <span>На iOS уведомления работают только из «На экран Домой». Требуется iOS 16.4+.</span>
        </div>
      }

      <div class="guide-note">
        <mat-icon>refresh</mat-icon>
        <span>После изменения настроек обновите страницу.</span>
      </div>

      <div class="guide-actions">
        @if (stepIndex() > 0) {
          <button mat-button (click)="prevStep()">Назад</button>
        }
        @if (stepIndex() < stepCount() - 1) {
          <button mat-flat-button (click)="nextStep()">Далее</button>
        }
        <button mat-stroked-button [disabled]="!supportsNotifications()" (click)="checkPermission()">
          Проверить
        </button>
        <button mat-button (click)="close()">Закрыть</button>
      </div>
    </div>
  `,
  styles: [`
    .guide-dialog {
      padding: 24px;
      max-width: 480px;
    }

    .guide-header {
      text-align: center;
      margin-bottom: 24px;
    }

    .header-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--ed-error, #ef4444);
      margin-bottom: 8px;
    }

    h2 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif); font-weight: 700; font-size: 1.375rem;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0 0 8px;
    }

    .guide-header p {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.875rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0;
      line-height: 1.5;
    }

    .guide-device {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--ed-surface-container, #1a1a1a);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.875rem; font-weight: 500;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 20px;

      mat-icon {
        color: var(--ed-accent, #f59e0b);
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .permission-badge {
      margin-left: auto;
      padding: 2px 10px;
      border-radius: 999px;
      background: rgba(239, 68, 68, 0.15);
      color: var(--ed-error, #ef4444);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.75rem; font-weight: 500;
    }

    .steps-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }

    .step {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px;
      border-radius: 12px;
      background: var(--ed-surface, #0a0a0a);
      border: 2px solid transparent;
      transition: border-color 0.2s, background-color 0.2s;

      &.active {
        border-color: var(--ed-accent, #f59e0b);
        background: var(--ed-accent-container, #451a03);
      }
    }

    .step-number {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.875rem; font-weight: 500;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .step-content {
      flex: 1;
      min-width: 0;
    }

    .step-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.875rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 4px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-accent, #f59e0b);
      }
    }

    .step-text {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.8125rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.5;
    }

    .guide-note {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 12px;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.8125rem;
      color: var(--ed-on-surface-variant, #a0a0a0);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .guide-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
  `],
})
export class NotificationGuideDialogComponent {
  private platformId = inject(PLATFORM_ID);
  private dialogRef = inject(MatDialogRef<NotificationGuideDialogComponent>);
  private data = inject<NotificationGuideDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  private chatService = inject(AuthChatService);

  private readonly isBrowser = isPlatformBrowser(this.platformId);
  readonly deviceKind = signal<DeviceKind>('desktop_chrome');
  readonly isMobile = computed(() => this.deviceKind().startsWith('android') || this.deviceKind() === 'ios_safari');
  readonly deviceLabel = computed(() => {
    const labels: Record<DeviceKind, string> = {
      android_chrome: 'Android · Chrome',
      android_firefox: 'Android · Firefox',
      android_other: 'Android',
      ios_safari: 'iPhone · Safari',
      desktop_chrome: 'Chrome',
      desktop_edge: 'Edge',
      desktop_firefox: 'Firefox',
      desktop_safari: 'Safari',
      desktop_other: 'Браузер',
    };
    return labels[this.deviceKind()];
  });

  readonly supportsNotifications = computed(() =>
    this.isBrowser && typeof window !== 'undefined' && 'Notification' in window,
  );

  readonly steps = computed<GuideStep[]>(() => this.buildSteps(this.deviceKind()));
  readonly stepIndex = signal(0);
  readonly stepCount = computed(() => this.steps().length);

  readonly permissionLabel = computed(() => {
    const permission = this.data?.permission
      ?? (this.supportsNotifications() ? Notification.permission : 'default');
    if (permission === 'granted') return 'разрешено';
    if (permission === 'denied') return 'заблокировано';
    return 'не запрошено';
  });

  constructor() {
    if (this.isBrowser && typeof navigator !== 'undefined') {
      this.deviceKind.set(this.detectDevice(navigator.userAgent || ''));
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  nextStep(): void {
    if (this.stepIndex() < this.stepCount() - 1) {
      this.stepIndex.update(v => v + 1);
    }
  }

  prevStep(): void {
    if (this.stepIndex() > 0) {
      this.stepIndex.update(v => v - 1);
    }
  }

  async checkPermission(): Promise<void> {
    if (!this.supportsNotifications()) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.chatService.requestNotifications();
        this.dialogRef.close();
      }
    } catch {
      // ignore
    }
  }

  private detectDevice(userAgent: string): DeviceKind {
    const ua = userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroid = ua.includes('android');

    if (isIOS) return 'ios_safari';

    if (isAndroid) {
      if (ua.includes('firefox')) return 'android_firefox';
      if (ua.includes('chrome') || ua.includes('chromium')) return 'android_chrome';
      return 'android_other';
    }

    // Desktop
    if (ua.includes('edg/')) return 'desktop_edge';
    if (ua.includes('firefox')) return 'desktop_firefox';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'desktop_safari';
    if (ua.includes('chrome') || ua.includes('chromium')) return 'desktop_chrome';
    return 'desktop_other';
  }

  private buildSteps(kind: DeviceKind): GuideStep[] {
    switch (kind) {
      // ===== Mobile =====
      case 'android_chrome':
        return [
          {
            icon: 'more_vert',
            title: 'Откройте меню браузера',
            text: 'Нажмите ⋮ (три точки) в правом верхнем углу экрана.',
          },
          {
            icon: 'settings',
            title: 'Настройки → Уведомления',
            text: 'Перейдите в «Настройки» → «Настройки сайтов» → «Уведомления».',
          },
          {
            icon: 'check_circle',
            title: 'Разрешите для этого сайта',
            text: 'Найдите svoefoto.ru и переключите на «Разрешить».',
          },
          {
            icon: 'refresh',
            title: 'Обновите страницу',
            text: 'Вернитесь в чат и обновите страницу.',
          },
        ];

      case 'android_firefox':
        return [
          {
            icon: 'lock',
            title: 'Нажмите на замок в адресной строке',
            text: 'Рядом с адресом сайта нажмите на значок замка или щита.',
          },
          {
            icon: 'tune',
            title: 'Изменить разрешения',
            text: 'Нажмите «Изменить настройки» → «Уведомления» → «Разрешить».',
          },
          {
            icon: 'refresh',
            title: 'Обновите страницу',
            text: 'Вернитесь в чат и обновите страницу.',
          },
        ];

      case 'android_other':
        return [
          {
            icon: 'settings',
            title: 'Откройте настройки браузера',
            text: 'Перейдите в настройки браузера и найдите раздел «Уведомления» или «Разрешения сайтов».',
          },
          {
            icon: 'check_circle',
            title: 'Разрешите уведомления',
            text: 'Найдите svoefoto.ru и разрешите уведомления.',
          },
          {
            icon: 'refresh',
            title: 'Обновите страницу',
            text: 'Вернитесь в чат и обновите страницу.',
          },
        ];

      case 'ios_safari':
        return [
          {
            icon: 'ios_share',
            title: 'Нажмите «Поделиться»',
            text: 'Нажмите кнопку «Поделиться» (квадрат со стрелкой) внизу экрана Safari.',
          },
          {
            icon: 'add_to_home_screen',
            title: 'Добавьте на экран «Домой»',
            text: 'Прокрутите вниз и нажмите «На экран «Домой»».',
          },
          {
            icon: 'touch_app',
            title: 'Откройте с главного экрана',
            text: 'Запустите сайт с новой иконки на главном экране, он откроется как приложение.',
          },
          {
            icon: 'notifications_active',
            title: 'Разрешите уведомления',
            text: 'При первом запросе нажмите «Разрешить» в появившемся окне.',
          },
        ];

      // ===== Desktop =====
      case 'desktop_chrome':
      case 'desktop_other':
        return [
          {
            icon: 'lock',
            title: 'Нажмите на замок в адресной строке',
            text: 'Слева от адреса сайта нажмите на значок замка.',
          },
          {
            icon: 'settings',
            title: 'Откройте «Настройки сайта»',
            text: 'В меню нажмите «Настройки сайта» и найдите «Уведомления».',
          },
          {
            icon: 'check_circle',
            title: 'Разрешите уведомления',
            text: 'Переключите «Уведомления» на «Разрешить».',
          },
          {
            icon: 'refresh',
            title: 'Обновите страницу',
            text: 'Нажмите Ctrl+R или кнопку обновления.',
          },
        ];

      case 'desktop_edge':
        return [
          {
            icon: 'lock',
            title: 'Нажмите на замок в адресной строке',
            text: 'Слева от адреса сайта нажмите на значок замка.',
          },
          {
            icon: 'toggle_on',
            title: 'Включите уведомления',
            text: 'В меню разрешений включите «Уведомления» для этого сайта.',
          },
          {
            icon: 'refresh',
            title: 'Обновите страницу',
            text: 'Нажмите Ctrl+R или кнопку обновления.',
          },
        ];

      case 'desktop_firefox':
        return [
          {
            icon: 'lock',
            title: 'Нажмите на замок в адресной строке',
            text: 'Слева от адреса сайта нажмите на значок замка.',
          },
          {
            icon: 'tune',
            title: 'Измените разрешения',
            text: 'Нажмите «Настройки» рядом с «Уведомления» и выберите «Разрешить».',
          },
          {
            icon: 'refresh',
            title: 'Обновите страницу',
            text: 'Нажмите Ctrl+R или кнопку обновления.',
          },
        ];

      case 'desktop_safari':
        return [
          {
            icon: 'menu',
            title: 'Откройте Safari → Настройки',
            text: 'В меню Safari нажмите «Настройки» → «Веб-сайты» → «Уведомления».',
          },
          {
            icon: 'check_circle',
            title: 'Разрешите для сайта',
            text: 'Найдите svoefoto.ru и выберите «Разрешить».',
          },
          {
            icon: 'refresh',
            title: 'Обновите страницу',
            text: 'Нажмите Cmd+R или кнопку обновления.',
          },
        ];
    }
  }
}
