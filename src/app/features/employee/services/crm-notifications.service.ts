import { Injectable, inject, signal, computed, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { WebSocketService } from '../../../core/services/websocket.service';
import { AuthService } from '../../../core/services/auth.service';

@Injectable({ providedIn: 'root' })
export class CrmNotificationsService {
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly soundEnabled = signal(true);
  readonly notificationsEnabled = signal(true);

  // DND mode
  readonly dndActive = signal(false);
  readonly dndUntil = signal<Date | null>(null);
  private dndTimer: ReturnType<typeof setTimeout> | null = null;

  readonly dndLabel = computed(() => {
    const until = this.dndUntil();
    if (!until) return '';
    const mins = Math.max(0, Math.round((until.getTime() - Date.now()) / 60000));
    if (mins >= 60) return `${Math.round(mins / 60)} ч`;
    return `${mins} мин`;
  });

  // Throttle: не более 1 звука в 3 сек на тип
  private lastSoundByType = new Map<string, number>();
  private readonly SOUND_THROTTLE_MS = 3000;

  private audioContext: AudioContext | null = null;
  private initialized = false;
  private originalTitle = '';
  private titleFlashInterval: ReturnType<typeof setInterval> | null = null;
  private unreadCount = 0;

  // React to visitor chat messages
  private readonly chatEffect = effect(() => {
    const msg = this.wsService.visitorNewMessage();
    if (msg && this.initialized) {
      this.notify('Новое сообщение', `Посетитель написал в чат`, 'chat');
    }
  });

  // React to task events
  private readonly taskEffect = effect(() => {
    const evt = this.wsService.taskEvent();
    if (!evt || !this.initialized) return;

    if (evt.event === 'task:created') {
      const title = (evt.data as Record<string, string>)['title'] || 'Новая задача';
      this.notify('Новая задача', title, 'task');
    } else if (evt.event?.startsWith('booking:')) {
      const data = evt.data as Record<string, string>;
      const clientName = data['client_name'] || data['clientName'] || '';
      if (evt.event === 'booking:created') {
        this.notify('Новая запись', clientName ? `Клиент: ${clientName}` : 'Поступила новая запись', 'booking');
      } else if (evt.event === 'booking:cancelled') {
        this.notify('Запись отменена', clientName ? `${clientName} отменил запись` : 'Клиент отменил запись', 'booking');
      } else if (evt.event === 'booking:rescheduled') {
        this.notify('Запись перенесена', clientName ? `${clientName} — новое время` : 'Запись перенесена', 'booking');
      }
    }
  });

  // React to order events
  private readonly orderEffect = effect(() => {
    const evt = this.wsService.orderEvent();
    if (evt && this.initialized) {
      if (evt.event === 'order:created') {
        this.notify('Новый заказ', `Поступил новый заказ`, 'order');
      } else if (evt.event === 'order:paid') {
        this.notify('Оплата получена', `Заказ оплачен`, 'order_paid');
      }
    }
  });

  // React to approval events
  private readonly approvalEffect = effect(() => {
    const evt = this.wsService.approvalEvent();
    if (evt && this.initialized) {
      const clientName = (evt.data as Record<string, string>)['clientName'] || 'Клиент';
      if (evt.event === 'approval:photo-reviewed') {
        const action = (evt.data as Record<string, string>)['action'];
        if (action === 'approved' || action === 'all_approved') {
          this.notify('📥 Скачать и распечатать', `${clientName} выбрал финальный вариант`, 'approval');
        } else if (action === 'rejected') {
          this.notify('✏️ Требуется доработка', `${clientName} запросил доработку фото`, 'approval');
        } else {
          this.notify('Согласование фото', `${clientName} прокомментировал фото`, 'approval');
        }
      } else if (evt.event === 'approval:session-completed') {
        const status = (evt.data as Record<string, string>)['status'];
        if (status === 'approved') {
          this.notify('📥 Скачать и распечатать', `${clientName} одобрил все фото`, 'approval');
        } else if (status === 'changes_requested' || status === 'partially_approved') {
          this.notify('✏️ Требуется доработка', `${clientName} — есть фото на доработку`, 'approval');
        } else {
          this.notify('Согласование завершено', `${clientName} завершил проверку`, 'approval');
        }
      } else if (evt.event === 'approval:session-viewed') {
        this.notify('Ссылка открыта', `${clientName} просматривает фото`, 'approval');
      }
    }
  });

  // Staff chat notifications handled entirely by StaffChatService (sound, toast, browser notification)

  init(): void {
    if (this.initialized || !isPlatformBrowser(this.platformId)) return;
    this.initialized = true;
    this.originalTitle = document.title;

    // Load preferences from localStorage
    const soundPref = localStorage.getItem('crm_sound_enabled');
    const notifPref = localStorage.getItem('crm_notif_enabled');
    if (soundPref !== null) this.soundEnabled.set(soundPref !== 'false');
    if (notifPref !== null) this.notificationsEnabled.set(notifPref !== 'false');

    // Restore DND from localStorage
    const dndStr = localStorage.getItem('crm_dnd_until');
    if (dndStr) {
      const until = new Date(dndStr);
      if (until.getTime() > Date.now()) {
        this.dndActive.set(true);
        this.dndUntil.set(until);
        const remaining = until.getTime() - Date.now();
        this.dndTimer = setTimeout(() => this.disableDnd(), remaining);
      } else {
        localStorage.removeItem('crm_dnd_until');
      }
    }

    // Request notification permission
    if (this.notificationsEnabled() && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Reset title flash on focus
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.stopTitleFlash();
      }
    });

    // Resume AudioContext on first user interaction (Chrome policy)
    const resumeAudio = (): void => {
      if (this.audioContext?.state === 'suspended') {
        this.audioContext.resume();
      }
      document.removeEventListener('click', resumeAudio);
      document.removeEventListener('keydown', resumeAudio);
    };
    document.addEventListener('click', resumeAudio);
    document.addEventListener('keydown', resumeAudio);
  }

  toggleSound(): void {
    const next = !this.soundEnabled();
    this.soundEnabled.set(next);
    localStorage.setItem('crm_sound_enabled', String(next));
  }

  toggleNotifications(): void {
    const next = !this.notificationsEnabled();
    this.notificationsEnabled.set(next);
    localStorage.setItem('crm_notif_enabled', String(next));
    if (next && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  enableDnd(minutes: number): void {
    const until = new Date(Date.now() + minutes * 60000);
    this.dndActive.set(true);
    this.dndUntil.set(until);
    localStorage.setItem('crm_dnd_until', until.toISOString());

    // Stop title flash when entering DND
    this.stopTitleFlash();

    if (this.dndTimer) clearTimeout(this.dndTimer);
    this.dndTimer = setTimeout(() => this.disableDnd(), minutes * 60000);
  }

  disableDnd(): void {
    this.dndActive.set(false);
    this.dndUntil.set(null);
    localStorage.removeItem('crm_dnd_until');
    if (this.dndTimer) {
      clearTimeout(this.dndTimer);
      this.dndTimer = null;
    }
  }

  private notify(title: string, body: string, type: 'chat' | 'order' | 'order_paid' | 'task' | 'booking' | 'approval' = 'chat'): void {
    // DND — подавляем звук и browser notification, но считаем unread для title flash
    if (this.dndActive()) {
      if (document.hidden) {
        this.unreadCount++;
        this.startTitleFlash();
      }
      return;
    }

    // Play sound with throttle
    if (this.soundEnabled() && type !== 'chat') {
      const now = Date.now();
      const lastSound = this.lastSoundByType.get(type) ?? 0;
      if (now - lastSound >= this.SOUND_THROTTLE_MS) {
        this.playNotificationSound(type);
        this.lastSoundByType.set(type, now);
      }
    }

    // Browser notification
    if (this.notificationsEnabled() && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const notifOptions: NotificationOptions = {
          body,
          icon: '/web-app-manifest-192x192.png',
          tag: type === 'chat' ? 'staff-chat-message' : `crm-${type}`,
          requireInteraction: false,
        };
        const n = new Notification(title, notifOptions);
        if (type !== 'chat') {
          setTimeout(() => n.close(), 5000);
        }
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch (_e) { /* SW notification fallback not needed here */ }
    }

    // Title flash when tab is hidden
    if (document.hidden) {
      this.unreadCount++;
      this.startTitleFlash();
    }
  }

  // DO NOT CHANGE notification sound parameters (frequencies, duration, ramp type) without explicit approval
  private readonly soundProfiles: Record<string, { freq: [number, number]; duration: number }> = {
    chat:       { freq: [880, 1100], duration: 0.3 },
    task:       { freq: [1100, 1320], duration: 0.25 },
    order:      { freq: [660, 880], duration: 0.35 },
    order_paid: { freq: [880, 1100], duration: 0.15 }, // double beep handled below
    booking:    { freq: [550, 700], duration: 0.4 },
    approval:   { freq: [440, 550], duration: 0.3 },
  };

  private playNotificationSound(type: string): void {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      const ctx = this.audioContext;
      const profile = this.soundProfiles[type] || this.soundProfiles['chat'];

      const playTone = (startTime: number): void => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(profile.freq[0], startTime);
        osc.frequency.setValueAtTime(profile.freq[1], startTime + profile.duration * 0.4);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + profile.duration);
        osc.start(startTime);
        osc.stop(startTime + profile.duration);
      };

      playTone(ctx.currentTime);
      // Double beep for paid orders
      if (type === 'order_paid') {
        playTone(ctx.currentTime + 0.2);
      }
    } catch (_e) { /* AudioContext not available */ }
  }

  private startTitleFlash(): void {
    if (this.titleFlashInterval) return;
    let showOriginal = false;
    this.titleFlashInterval = setInterval(() => {
      showOriginal = !showOriginal;
      document.title = showOriginal
        ? this.originalTitle
        : `(${this.unreadCount}) Новое уведомление!`;
    }, 1500);
  }

  private stopTitleFlash(): void {
    if (this.titleFlashInterval) {
      clearInterval(this.titleFlashInterval);
      this.titleFlashInterval = null;
    }
    this.unreadCount = 0;
    document.title = this.originalTitle;
  }
}
