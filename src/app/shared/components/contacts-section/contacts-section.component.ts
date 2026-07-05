import { Component, input, OnInit, inject, PLATFORM_ID, ChangeDetectionStrategy, computed, signal, afterNextRender } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { GoalTrackingService } from '../../../core/services/goal-tracking.service';
import { DeepLinkService } from '../../../core/services/deep-link.service';
import { LoggerService } from '../../../core/services/logger.service';
import { ChannelStatusService } from '../../../core/services/channel-status.service';
import {
  StudioAddress,
  STUDIO_PHONE,
  STUDIO_PHONE_AVAILABLE,
  STUDIO_PHONE_HREF,
  STUDIO_PHONE_UNAVAILABLE_LABEL,
} from '../../../core/data/address.data';

export interface ContactLink {
  label: string;
  href: string;
  icon: string;
  notice?: string;
}

export interface ContactsData {
  title: string;
  prompt: string;
  links: ContactLink[];
}

export interface AddressInfo {
  address: string;
  workHours: string;
  phone: string;
  mapImage: {
    src: string;
    alt: string;
  };
}

/**
 * Интерфейс для массива адресов (новый формат)
 */
export type AddressesInput = StudioAddress[] | AddressInfo[];

@Component({
  selector: 'app-contacts-section',
  
  imports: [MatIconModule, MatButtonModule, MatCardModule],
  templateUrl: './contacts-section.component.html',
  styleUrls: ['./contacts-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContactsSectionComponent implements OnInit {
  readonly contacts = input.required<ContactsData>();
  readonly addressInfo = input<AddressInfo>(); // Обратная совместимость (опционально)
  readonly addresses = input<AddressesInput>(); // Новый формат - массив адресов
  readonly variant = input<'default' | 'document'>('default');
  readonly isMobile = input<boolean>(false);
  readonly isTablet = input<boolean>(false);
  readonly isDesktop = input<boolean>(false);
  
  private readonly platformId = inject(PLATFORM_ID);
  private readonly goalTrackingService = inject(GoalTrackingService);
  private readonly deepLinkService = inject(DeepLinkService);
  private readonly channelStatus = inject(ChannelStatusService);
  private log = inject(LoggerService);
  
  // Сигнал для отслеживания готовности fingerprint
  private readonly _fingerprintReady = signal(false);
  
  // Computed для получения ссылок с fingerprint + live-статусом WhatsApp
  readonly dynamicLinks = computed<ContactLink[]>(() => {
    const staticLinks = this.contacts().links;
    const whatsappNotice = this.channelStatus.whatsappNotice();
    const isReady = this._fingerprintReady();
    const browser = isPlatformBrowser(this.platformId);

    return staticLinks.map(link => {
      // Live-статус канала перекрывает статичный notice для WhatsApp
      // (undefined → предупреждение скрыто). Работает и в SSR, и до готовности fingerprint.
      const isWhatsapp = link.icon === 'whatsapp' || link.label.toLowerCase().includes('whatsapp');
      const base = isWhatsapp ? { ...link, notice: whatsappNotice } : link;

      // Если fingerprint не готов или SSR - подменяем только notice, href остаётся статичным
      if (!isReady || !browser) {
        return base;
      }

      // Заменяем ссылки МАКС, Telegram и VK на динамические с fingerprint
      if (link.icon === 'max' || link.label.toLowerCase().includes('max')) {
        return { ...base, href: this.deepLinkService.getMaxLink() };
      }
      if (link.icon === 'telegram' || link.label.toLowerCase().includes('telegram')) {
        return { ...base, href: this.deepLinkService.getTelegramLink() };
      }
      if (link.icon === 'vk' || link.label.toLowerCase().includes('вконтакте') || link.label.toLowerCase().includes('vk')) {
        return { ...base, href: this.deepLinkService.getVkLink() };
      }
      return base;
    });
  });
  
  readonly studioPhone = STUDIO_PHONE;
  readonly studioPhoneHref = STUDIO_PHONE_HREF;
  readonly studioPhoneAvailable = STUDIO_PHONE_AVAILABLE;
  readonly studioPhoneUnavailableLabel = STUDIO_PHONE_UNAVAILABLE_LABEL;

  // Computed: StudioAddress[] для шаблона (сохраняет mapLinks, name, id)
  readonly studioAddresses = computed<StudioAddress[]>(() => {
    const addressesValue = this.addresses();
    if (addressesValue && addressesValue.length > 0) {
      return addressesValue.filter((addr): addr is StudioAddress => 'id' in addr);
    }
    return [];
  });

  // Computed для получения массива адресов (обратная совместимость)
  readonly addressesList = computed<AddressInfo[]>(() => {
    const addressesValue = this.addresses();
    const addressInfoValue = this.addressInfo();

    if (addressesValue && addressesValue.length > 0) {
      return addressesValue.map(addr => {
        if ('workHours' in addr) {
          return addr as AddressInfo;
        }
        const studioAddr = addr as StudioAddress;
        return {
          address: studioAddr.address,
          workHours: studioAddr.workHours,
          phone: STUDIO_PHONE,
          mapImage: studioAddr.mapImage
        };
      });
    }
    return addressInfoValue ? [addressInfoValue] : [];
  });

  constructor() {
    // Инициализируем fingerprint после рендеринга (только в браузере)
    afterNextRender(() => {
      this.initDeepLinks();
    });
  }
  
  /**
   * Инициализация deep links с fingerprint
   */
  private async initDeepLinks(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    // Ждём готовности DeepLinkService (до 3 сек)
    for (let i = 0; i < 30; i++) {
      if (this.deepLinkService.isReady()) {
        this._fingerprintReady.set(true);
        this.log.debug('ContactsSection: Deep links ready with fingerprint');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Если не дождались - всё равно помечаем как готовые (fallback ссылки)
    this._fingerprintReady.set(true);
    this.log.debug('ContactsSection: Using fallback links (fingerprint timeout)');
  }
  
  ngOnInit(): void {
    if (!this.contacts()) {
      this.log.warn('ContactsSectionComponent: contacts not provided');
    }

    if (!this.addresses() && !this.addressInfo()) {
      this.log.warn('ContactsSectionComponent: addresses or addressInfo not provided');
    }
  }
  /**
   * Track contact click and handle the action
   */
  onContactClick(link: ContactLink, event: Event): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Получаем актуальную ссылку с fingerprint при клике
    let actualHref = link.href;
    
    if (link.icon === 'max' || link.label.toLowerCase().includes('max')) {
      actualHref = this.deepLinkService.getMaxLink();
    } else if (link.icon === 'telegram' || link.label.toLowerCase().includes('telegram')) {
      actualHref = this.deepLinkService.getTelegramLink();
    } else if (link.icon === 'vk' || link.label.toLowerCase().includes('вконтакте')) {
      actualHref = this.deepLinkService.getVkLink();
    }
    
    // Если ссылка изменилась, предотвращаем стандартный переход и открываем актуальную
    if (actualHref !== link.href) {
      event.preventDefault();
      window.open(actualHref, '_blank');
    }
  }

}
