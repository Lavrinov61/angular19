import { Directive, input, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GoalTrackingService } from '../../core/services/goal-tracking.service';

@Directive({
  selector: '[appTrackClick]',
  
  host: {
    '(click)': 'onClick($event)'
  }
})
export class TrackClickDirective {
  readonly eventName = input<string>('');
  readonly trackCategory = input<string>('interaction');
  readonly trackLabel = input<string | undefined>(undefined);
  readonly trackValue = input<number | undefined>(undefined);
  readonly trackCustomParams = input<Record<string, string | number | boolean> | undefined>(undefined);
  private goalTrackingService = inject(GoalTrackingService);
  private platformId = inject(PLATFORM_ID);

  /**
   * Get current page URL safely (works with SSR)
   */
  private getCurrentUrl(): string {
    if (isPlatformBrowser(this.platformId) && typeof window !== 'undefined') {
      return window.location.href;
    }
    return '';
  }
  
  onClick(event: Event): void {
    if (!this.eventName()) {
      return;
    }

    let elementText = '';
    if (isPlatformBrowser(this.platformId) && event.target instanceof HTMLElement) {
      elementText = event.target.textContent?.trim() || '';
    }

    this.goalTrackingService.trackGoal({
      name: this.eventName(),
      category: this.trackCategory(),
      action: 'click',
      label: this.trackLabel(),
      value: this.trackValue(),
      customParameters: {
        ...this.trackCustomParams(),
        element_text: elementText,
        page_location: this.getCurrentUrl(),
        timestamp: new Date().toISOString(),
      },
    });
  }
}
