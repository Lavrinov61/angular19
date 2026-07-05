import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STUDIO_PHONE, STUDIO_PHONE_AVAILABLE, STUDIO_PHONE_HREF, STUDIO_PHONE_UNAVAILABLE_LABEL } from '../../data/address.data';
import { ChannelStatusService } from '../../services/channel-status.service';

@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FooterComponent {
  private readonly channelStatus = inject(ChannelStatusService);
  readonly currentYear = new Date().getFullYear();
  readonly studioPhone = STUDIO_PHONE;
  readonly studioPhoneHref = STUDIO_PHONE_HREF;
  readonly studioPhoneAvailable = STUDIO_PHONE_AVAILABLE;
  readonly studioPhoneUnavailableLabel = STUDIO_PHONE_UNAVAILABLE_LABEL;
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
}
