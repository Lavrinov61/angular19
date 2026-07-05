import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { AuthChatService } from '../../../core/services/auth-chat.service';
import { LandingPricesService } from '../../../core/services/landing-prices.service';
import { SeoService } from '../../../core/services/seo.service';
import { UslugiServicesComponent } from './uslugi-services.component';

describe('UslugiServicesComponent service icons', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        {
          provide: LandingPricesService,
          useValue: {
            enrichServiceCards: <T>(services: T): T => services,
            init: () => undefined,
          },
        },
        {
          provide: SeoService,
          useValue: {
            setAllMetaData: () => undefined,
            setLocalSeoMeta: () => undefined,
            addJsonLd: () => undefined,
            setBreadcrumbJsonLd: () => undefined,
          },
        },
        {
          provide: AuthChatService,
          useValue: {
            openChat: () => undefined,
          },
        },
      ],
    });
  });

  it('uses existing icon tiles instead of photo images for featured cards', () => {
    const component = TestBed.runInInjectionContext(() => new UslugiServicesComponent());
    const cards = component.featuredServices();

    expect(cards.map(card => Reflect.get(card, 'icon'))).toEqual([
      'badge',
      'print',
      'auto_fix_high',
      'camera_alt',
    ]);
    expect(cards.every(card => !Reflect.has(card, 'image'))).toBe(true);
  });

  it('uses icon tiles instead of photo images for the hero art', () => {
    const component = TestBed.runInInjectionContext(() => new UslugiServicesComponent());

    expect(component.heroVisuals.map(visual => Reflect.get(visual, 'icon'))).toEqual([
      'badge',
      'print',
      'auto_fix_high',
    ]);
    expect(component.heroVisuals.every(visual => !Reflect.has(visual, 'image'))).toBe(true);
  });
});
