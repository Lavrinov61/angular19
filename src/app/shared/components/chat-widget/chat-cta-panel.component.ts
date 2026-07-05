import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  afterNextRender,
  output,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

interface PhoneLoginQueryParams {
  returnUrl: string;
}

@Component({
  selector: 'app-chat-cta-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatButtonModule,
  ],
  templateUrl: './chat-cta-panel.component.html',
  styleUrls: ['./chat-cta-panel.component.scss'],
})
export class ChatCtaPanelComponent {
  readonly closed = output<void>();

  private readonly platformId = inject(PLATFORM_ID);
  protected readonly phoneLoginQueryParams = signal<PhoneLoginQueryParams>({ returnUrl: '/?chat=1' });

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) {
        return;
      }

      const url = new URL(location.href);
      url.searchParams.set('chat', '1');
      this.phoneLoginQueryParams.set({ returnUrl: `${url.pathname}${url.search}${url.hash}` });
    });
  }

  onCloseClick(): void {
    this.closed.emit();
  }
}
