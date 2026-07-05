import { Injectable, PLATFORM_ID, NgZone, inject } from '@angular/core';
import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import { LoggerService } from './logger.service';

interface WindowWithFbq extends Window {
  fbq?: (action: string, event: string, params?: Record<string, unknown>) => void;
}

export interface GoalEvent {
  name: string;
  category: string;
  action: string;
  label?: string;
  value?: number;
  customParameters?: Record<string, unknown>;
}

export interface AnalyticsConfig {
  gtag?: boolean;
  facebookPixel?: boolean;
  debug?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class GoalTrackingService {
  private platformId = inject(PLATFORM_ID);
  private document = inject<Document>(DOCUMENT);
  private ngZone = inject(NgZone);
  private config: AnalyticsConfig = {
    gtag: true,
    facebookPixel: false,
    debug: false
  };private isGtagLoaded = false;  private log = inject(LoggerService);

  /**
   * Get current page URL safely (works with SSR)
   */
  private getCurrentUrl(): string {
    if (isPlatformBrowser(this.platformId) && typeof window !== 'undefined') {
      return window.location.href;
    }
    return '';
  }

  /**
   * Configure analytics services
   */
  configure(config: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (this.config.debug) {
      this.log.debug('Goal Tracking Service configured:', this.config);
    }
  }  /**
   * Track a goal/event across configured analytics services
   */  trackGoal(event: GoalEvent): void {
    // Lazy initialization
    if (!this.isGtagLoaded) {
      this.initializeGtag();
    }

    if (this.config.debug) {
      this.log.debug('Tracking goal:', event);
    }

    // Google Analytics 4 (gtag)
    if (this.config.gtag && this.isGtagAvailable()) {
      this.trackGtagEvent(event);
    }

    // Facebook Pixel
    if (this.config.facebookPixel && this.isFacebookPixelAvailable()) {
      this.trackFacebookPixelEvent(event);
    }
  }

  /**
   * Track specific business goals
   */
  trackContactButtonClick(buttonType: 'vk' | 'telegram' | 'phone' | 'contact_form'): void {
    this.trackGoal({
      name: 'contact_click',
      category: 'engagement',
      action: 'click',
      label: buttonType,      customParameters: {
        contact_method: buttonType,
        page_location: this.getCurrentUrl(),
        timestamp: new Date().toISOString()
      }
    });
  }

  trackBookingClick(platform: 'bitrix24' | 'other'): void {
    this.trackGoal({
      name: 'booking_click',
      category: 'conversion',
      action: 'click',
      label: platform,
      value: 1,      customParameters: {
        booking_platform: platform,
        page_location: this.getCurrentUrl(),
        timestamp: new Date().toISOString()
      }
    });
  }

  trackRouteRequest(hasLocation: boolean): void {
    this.trackGoal({
      name: 'route_request',
      category: 'navigation',
      action: hasLocation ? 'with_location' : 'without_location',
      label: 'google_maps',      customParameters: {
        has_user_location: hasLocation,
        page_location: this.getCurrentUrl(),
        timestamp: new Date().toISOString()
      }
    });
  }

  trackLocationPermission(granted: boolean): void {
    this.trackGoal({
      name: 'location_permission',
      category: 'privacy',
      action: granted ? 'granted' : 'denied',
      label: 'geolocation',      customParameters: {
        permission_granted: granted,
        page_location: this.getCurrentUrl(),
        timestamp: new Date().toISOString()
      }
    });
  }

  trackPageView(pageName: string): void {
    this.trackGoal({
      name: 'page_view',
      category: 'navigation',
      action: 'view',
      label: pageName,      customParameters: {
        page_name: pageName,
        page_location: this.getCurrentUrl(),
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Track custom business events
   */
  trackCustomEvent(eventName: string, parameters?: Record<string, unknown>): void {
    this.trackGoal({
      name: eventName,
      category: 'custom',
      action: 'custom_event',
      label: eventName,      customParameters: {
        ...parameters,
        page_location: this.getCurrentUrl(),
        timestamp: new Date().toISOString()
      }
    });
  }
  private initializeGtag(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Not in browser
    }    // Check if gtag is already loaded
    if (typeof gtag !== 'undefined') {
      this.isGtagLoaded = true;
      return;
    }

    // Check if gtag script exists
    const gtagScript = this.document.querySelector('script[src*="gtag"]');
    if (gtagScript) {      // Wait for gtag to load
      const checkGtag = () => {
        if (typeof gtag !== 'undefined') {
          this.isGtagLoaded = true;
        } else {
          this.ngZone.runOutsideAngular(() => setTimeout(checkGtag, 100));
        }
      };
      checkGtag();
    }
  }

  private trackGtagEvent(event: GoalEvent): void {
    try {
      gtag('event', event.action, {
        event_category: event.category,
        event_label: event.label,
        value: event.value,
        custom_map: event.customParameters,
        ...event.customParameters
      });
    } catch (error) {
      if (this.config.debug) {
        this.log.error('Error tracking gtag event:', error);
      }
    }
  }

  private trackFacebookPixelEvent(event: GoalEvent): void {
    try {
      if ((window as WindowWithFbq).fbq) {
        (window as WindowWithFbq).fbq!('track', event.name, event.customParameters);
      }
    } catch (error) {
      if (this.config.debug) {
        this.log.error('Error tracking Facebook Pixel event:', error);
      }
    }
  }

  private isGtagAvailable(): boolean {
    return this.isGtagLoaded && typeof gtag !== 'undefined';
  }

  private isFacebookPixelAvailable(): boolean {
    return typeof (window as WindowWithFbq).fbq !== 'undefined';
  }
}

// Global gtag function declaration for TypeScript
declare function gtag(...args: unknown[]): void;
