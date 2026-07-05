import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

export interface AboutData {
  textParts: {
    highlight: string;
    main: string[];
    keywords: string[];
  };
  features: {
    icon: string;
    title: string;
    description: string;
  }[];
  buttons: {
    label: string;
    href: string;
    variant: 'primary' | 'outlined';
    icon?: string;
  }[];
}

export interface TrustIndicator {
  icon: string;
  text: string;
}

export interface HeroBadge {
  text: string;
  icon: string;
}

@Component({
  selector: 'app-about-preview',
  
  imports: [
    MatButtonModule,
    MatIconModule,
    RouterLink
],
  templateUrl: './about-preview.component.html',
  styleUrl: './about-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AboutPreviewComponent {
  readonly aboutData = input.required<AboutData>();
  readonly trustIndicators = input<TrustIndicator[]>([]);
  readonly badge = input<HeroBadge>();
  readonly isMobile = input<boolean>(false);
  readonly isTablet = input<boolean>(false);
  readonly isDesktop = input<boolean>(false);
  readonly contactClick = output<void>();

  onContactButtonClick(label: string): void {
    if (label === 'Связаться') {
      this.contactClick.emit();
    }
  }
}
