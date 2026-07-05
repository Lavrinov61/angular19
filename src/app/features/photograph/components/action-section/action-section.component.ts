import { Component, ChangeDetectionStrategy, input, inject, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChannelStatusService } from '../../../../core/services/channel-status.service';
import { Photographer } from '../../models/photographer.model';

@Component({
  selector: 'app-action-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatTooltipModule
],
  templateUrl: './action-section.component.html',
  styleUrl: './action-section.component.scss',
  
})
export class ActionSectionComponent {
  photographer = input.required<Photographer>();
  private readonly channelStatus = inject(ChannelStatusService);
  /** undefined when WhatsApp is available (banner hidden). */
  readonly whatsappNotice = this.channelStatus.whatsappNotice;
  readonly whatsappAriaLabel = computed(() => {
    const notice = this.whatsappNotice();
    return notice ? `WhatsApp: ${notice}` : 'WhatsApp';
  });
  readonly whatsappUnavailableText = computed(() => {
    const notice = this.whatsappNotice();
    return notice ? `WhatsApp ${notice.toLowerCase()}` : '';
  });

  private platformId = inject(PLATFORM_ID);
  
  /**
   * Opens the booking link in a new tab
   */
  bookNow(): void {
    if (this.photographer().bookingLink && isPlatformBrowser(this.platformId)) {
      window.open(this.photographer().bookingLink, '_blank');
    }
  }
  
  /**
   * Returns a formatted social media link with proper protocol
   */
  getSocialLink(type: string, value: string | undefined): string {
    if (!value) return '';
    switch(type) {
      case 'telegram':
        return `https://t.me/${value.replace('@', '')}`;
      case 'whatsapp':
        return `https://wa.me/${value.replace('+', '')}`;
      case 'instagram':
        return `https://instagram.com/${value.replace('@', '')}`;
      default:
        return '';
    }
  }
}






