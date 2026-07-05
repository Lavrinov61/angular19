import { Component, signal, computed, ChangeDetectionStrategy, inject, afterNextRender, DestroyRef, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ADDRESSES, STUDIO_PHONE, STUDIO_PHONE_HREF } from '../../../core/data/address.data';
import { SafeResourceUrlPipe } from '../pipes/safe-resource-url.pipe';
import { StudioAlertService } from '../../../core/services/studio-alert.service';
import { ChannelStatusService } from '../../../core/services/channel-status.service';

interface MessengerChannel {
  id: string;
  label: string;
  href: string;
  color: string;
  warning?: string;
  iconType: 'mat' | 'svg';
  matIcon?: string;
  svgPath?: string;
  svgViewBox?: string;
}

interface ContactAvailabilityStatus {
  readonly online: boolean;
  readonly label: string;
  readonly ariaLabel: string;
}

const CONTACT_TIME_ZONE = 'Europe/Moscow';
const CONTACT_OPEN_MINUTES = 9 * 60;
const CONTACT_CLOSE_MINUTES = 19 * 60 + 30;
const CONTACT_STATUS_REFRESH_MS = 60_000;
const CONTACT_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: CONTACT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

@Component({
  selector: 'app-contacts',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    RouterLink,
    SafeResourceUrlPipe,
  ],
  templateUrl: './contacts.component.html',
  styleUrl: './contacts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly studioAlertService = inject(StudioAlertService);
  private readonly channelStatus = inject(ChannelStatusService);

  readonly addresses = ADDRESSES;
  readonly email = 'info@svoefoto.ru';
  readonly studioPhone = STUDIO_PHONE;
  readonly studioPhoneHref = STUDIO_PHONE_HREF;

  readonly selectedAddressIndex = signal(0);
  readonly selectedAddress = computed(() => this.addresses[this.selectedAddressIndex()] ?? this.addresses[0]);
  readonly pageReady = signal(false);
  private readonly currentTime = signal(new Date());
  readonly contactAvailabilityStatus = computed(() => this.resolveContactAvailabilityStatus(this.currentTime()));

  readonly yandexMapUrl = computed(() => {
    const addr = this.selectedAddress();
    if (addr?.coordinates) {
      const { lat, lng } = addr.coordinates;
      return `https://yandex.ru/map-widget/v1/?ll=${lng},${lat}&pt=${lng},${lat},pm2rdm&z=16`;
    }
    return 'https://yandex.ru/map-widget/v1/?ll=39.7107641,47.219706&pt=39.7107641,47.219706,pm2rdm&z=16';
  });

  private readonly baseChannels: MessengerChannel[] = [
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      href: 'https://wa.me/+79014178668',
      color: '#25D366',
      iconType: 'svg',
      svgViewBox: '0 0 24 24',
      svgPath: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z',
    },
    {
      id: 'telegram',
      label: 'Telegram',
      href: 'https://t.me/FmagnusBot',
      color: '#0088cc',
      iconType: 'svg',
      svgViewBox: '0 0 24 24',
      svgPath: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
    },
    {
      id: 'max',
      label: 'МАКС',
      href: 'https://max.ru/id262603741214_bot',
      color: '#0057FF',
      iconType: 'svg',
      svgViewBox: '0 0 1000 1000',
      svgPath: 'M508.172,871.04c-74.648,0-109.338-10.897-169.638-54.487c-38.141,49.039-158.922,87.362-164.189,21.795c0-49.22-10.898-90.812-23.248-136.219c-14.712-55.94-31.421-118.238-31.421-208.505c0-215.589,176.903-377.78,386.498-377.78c209.777,0,374.147,170.183,374.147,379.778C881.026,701.975,714.524,869.939,508.172,871.04z M511.26,302.19c-102.073-5.267-181.625,65.385-199.243,176.176c-14.53,91.721,11.261,203.42,33.237,209.232c10.534,2.543,37.051-18.889,53.579-35.417c27.33,18.88,59.155,30.219,92.265,32.874c105.765,5.087,196.137-75.432,203.238-181.08c4.134-105.872-77.299-195.545-183.078-201.604L511.26,302.19z',
    },
    {
      id: 'vk',
      label: 'ВКонтакте',
      href: 'https://vk.com/im?sel=-68371131',
      color: '#4c75a3',
      iconType: 'svg',
      svgViewBox: '0 0 24 24',
      svgPath: 'M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.408 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.864-.525-2.05-1.727-1.033-1.02-1.494-.92-1.747-.92-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.118-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.441 0 .61.203.78.678.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.204.169-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.169.508.271.508.22 0 .407-.136.813-.542 1.254-1.406 2.151-3.574 2.151-3.574.119-.254.322-.491.763-.491h1.744c.525 0 .644.271.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .78.186.254.796.779 1.203 1.254.745.847 1.32 1.558 1.473 2.05.17.49-.085.744-.576.744z',
    },
  ];

  /** Channels with a live WhatsApp warning applied (undefined when WhatsApp is up). */
  readonly channels = computed<MessengerChannel[]>(() => {
    const notice = this.channelStatus.whatsappNotice();
    return this.baseChannels.map(ch =>
      ch.id === 'whatsapp' ? { ...ch, warning: notice } : ch,
    );
  });

  constructor() {
    afterNextRender(() => {
      this.pageReady.set(true);
      this.refreshContactAvailabilityStatus();

      const timerId = setInterval(() => {
        this.refreshContactAvailabilityStatus();
      }, CONTACT_STATUS_REFRESH_MS);

      this.destroyRef.onDestroy(() => {
        clearInterval(timerId);
      });
    });
  }

  selectAddress(index: number): void {
    if (index >= 0 && index < this.addresses.length) {
      this.selectedAddressIndex.set(index);
    }
  }

  scrollToChannels(event: Event): void {
    event.preventDefault();
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    document.getElementById('contact-methods')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private refreshContactAvailabilityStatus(): void {
    this.currentTime.set(new Date());
  }

  private resolveContactAvailabilityStatus(date: Date): ContactAvailabilityStatus {
    const moscowMinutes = this.getMoscowMinutes(date);
    const isOnline = moscowMinutes >= CONTACT_OPEN_MINUTES && moscowMinutes < CONTACT_CLOSE_MINUTES;

    if (isOnline) {
      return {
        online: true,
        label: 'На линии · до 19:30 МСК',
        ariaLabel: 'Сейчас на линии. Отвечаем до 19:30 по московскому времени',
      };
    }

    const isBeforeOpening = moscowMinutes < CONTACT_OPEN_MINUTES;
    const label = isBeforeOpening
      ? 'Не на линии · ответим с 09:00 МСК'
      : 'Не на линии · ответим завтра с 09:00 МСК';
    const ariaLabel = isBeforeOpening
      ? 'Сейчас не на линии. Ответим с 09:00 по московскому времени'
      : 'Сейчас не на линии. Ответим завтра с 09:00 по московскому времени';

    return {
      online: false,
      label,
      ariaLabel,
    };
  }

  private getMoscowMinutes(date: Date): number {
    const parts = CONTACT_TIME_FORMATTER.formatToParts(date);
    const hourPart = parts.find(part => part.type === 'hour')?.value ?? '0';
    const minutePart = parts.find(part => part.type === 'minute')?.value ?? '0';
    const hour = Number.parseInt(hourPart, 10) % 24;
    const minute = Number.parseInt(minutePart, 10);

    return hour * 60 + minute;
  }
}
