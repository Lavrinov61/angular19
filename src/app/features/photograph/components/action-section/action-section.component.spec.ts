/// <reference types="node" />
import { ɵresolveComponentResources as resolveComponentResources, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { readFile } from 'node:fs/promises';
import { Photographer } from '../../models/photographer.model';
import { ChannelStatusService } from '../../../../core/services/channel-status.service';
import { ActionSectionComponent } from './action-section.component';

describe('ActionSectionComponent', () => {
  let component: ActionSectionComponent;
  let fixture: ComponentFixture<ActionSectionComponent>;
  const whatsappNotice = signal<string | undefined>(undefined);

  const photographer: Photographer = {
    id: 'test',
    slug: 'test',
    name: 'Тест',
    title: 'Фотограф',
    profileImage: '/assets/images/default-avatar.svg',
    specialization: [],
    portfolioImages: [],
    heroTitle: 'Тест',
    heroSubtitle: 'Тест',
    heroImage: '/assets/images/default-avatar.svg',
    experience: '1 год',
    achievments: [],
    uniqueApproach: 'Тест',
    clientTestimonials: [],
    servicesOffered: [],
    priceRange: 'от 1 руб',
    ctaTitle: 'Записаться',
    ctaSubtitle: 'Выберите время',
    bookingLink: '/booking',
    contactInfo: {
      phone: '+7 863 322-65-75',
      email: 'info@svoefoto.ru',
      whatsapp: '+79014178668',
    },
    metaTitle: 'Тест',
    metaDescription: 'Тест',
    keywords: [],
    isActive: true,
    rating: 0,
    reviewsCount: 0,
    languages: [],
    workingHours: '09:00-19:30',
    location: 'Ростов-на-Дону',
    studioAvailable: true,
    locationAvailable: true,
    status: 'active',
  };

  beforeAll(async () => {
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    whatsappNotice.set(undefined);
    await TestBed.configureTestingModule({
      imports: [ActionSectionComponent],
      providers: [
        {
          provide: ChannelStatusService,
          useValue: { whatsappNotice, whatsappAvailable: signal(true), refresh: () => undefined },
        },
      ],
    }).compileComponents();

    const iconRegistry = TestBed.inject(MatIconRegistry);
    const sanitizer = TestBed.inject(DomSanitizer);
    iconRegistry.addSvgIconLiteral(
      'channel-whatsapp',
      sanitizer.bypassSecurityTrustHtml('<svg viewBox="0 0 24 24"></svg>'),
    );

    fixture = TestBed.createComponent(ActionSectionComponent);
    component = fixture.componentInstance;
    Object.defineProperty(component, 'photographer', { value: () => photographer });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('omits the WhatsApp warning when the channel is available', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const whatsappLink = compiled.querySelector<HTMLAnchorElement>('.social-link--whatsapp');

    expect(whatsappLink?.getAttribute('aria-label')).toBe('WhatsApp');
    expect(compiled.querySelector('.social-warning')).toBeNull();
  });

  it('shows WhatsApp outage information when the channel is unavailable', () => {
    whatsappNotice.set('Временно не работает');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const whatsappLink = compiled.querySelector<HTMLAnchorElement>('.social-link--whatsapp');
    const warning = compiled.querySelector<HTMLElement>('.social-warning');

    expect(whatsappLink?.getAttribute('aria-label')).toBe('WhatsApp: Временно не работает');
    expect(warning?.textContent).toContain('WhatsApp временно не работает');
  });
});
