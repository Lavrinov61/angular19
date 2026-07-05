/// <reference types="node" />
import { ɵresolveComponentResources as resolveComponentResources, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { readFile } from 'node:fs/promises';
import { CONTACTS } from '../../../core/data/contacts.data';
import { DeepLinkService } from '../../../core/services/deep-link.service';
import { GoalTrackingService } from '../../../core/services/goal-tracking.service';
import { LoggerService } from '../../../core/services/logger.service';
import { ChannelStatusService } from '../../../core/services/channel-status.service';
import { ContactsSectionComponent } from './contacts-section.component';

describe('ContactsSectionComponent', () => {
  let component: ContactsSectionComponent;
  let fixture: ComponentFixture<ContactsSectionComponent>;
  const whatsappNotice = signal<string | undefined>(undefined);

  beforeAll(async () => {
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    whatsappNotice.set(undefined);
    await TestBed.configureTestingModule({
      imports: [ContactsSectionComponent],
      providers: [
        {
          provide: DeepLinkService,
          useValue: {
            isReady: () => true,
            getMaxLink: () => 'https://max.ru/id262603741214_bot',
            getTelegramLink: () => 'https://t.me/FmagnusBot',
            getVkLink: () => 'https://vk.com/im?sel=-68371131',
          },
        },
        { provide: GoalTrackingService, useValue: {} },
        { provide: LoggerService, useValue: { debug: () => undefined, warn: () => undefined } },
        {
          provide: ChannelStatusService,
          useValue: { whatsappNotice, whatsappAvailable: signal(true), refresh: () => undefined },
        },
      ],
    }).compileComponents();

    const iconRegistry = TestBed.inject(MatIconRegistry);
    const sanitizer = TestBed.inject(DomSanitizer);
    const iconLiteral = sanitizer.bypassSecurityTrustHtml('<svg viewBox="0 0 24 24"></svg>');
    iconRegistry.addSvgIconLiteral('channel-max', iconLiteral);
    iconRegistry.addSvgIconLiteral('channel-telegram', iconLiteral);
    iconRegistry.addSvgIconLiteral('channel-whatsapp', iconLiteral);
    iconRegistry.addSvgIconLiteral('channel-vk', iconLiteral);

    fixture = TestBed.createComponent(ContactsSectionComponent);
    component = fixture.componentInstance;
    Object.defineProperty(component, 'contacts', { value: () => CONTACTS });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('hides the WhatsApp outage notice when the channel is available', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const whatsappCard = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.contact-card-link'))
      .find((link) => link.textContent?.includes('WhatsApp'));

    expect(whatsappCard).toBeTruthy();
    expect(whatsappCard?.textContent).not.toContain('Временно не работает');
  });

  it('shows WhatsApp outage information in shared contact cards when unavailable', () => {
    whatsappNotice.set('Временно не работает');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const whatsappCard = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.contact-card-link'))
      .find((link) => link.textContent?.includes('WhatsApp'));

    expect(whatsappCard).toBeTruthy();
    expect(whatsappCard?.getAttribute('aria-label')).toBe('WhatsApp: Временно не работает');
    expect(whatsappCard?.textContent).toContain('Временно не работает');
  });
});
