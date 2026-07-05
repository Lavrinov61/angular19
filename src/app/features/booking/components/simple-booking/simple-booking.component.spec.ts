import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE, NativeDateAdapter } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { readFileSync } from 'node:fs';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { Bitrix24BookingService } from '../../../../core/services/bitrix24-booking.service';
import { ReferralTrackingService } from '../../../../core/services/referral-tracking.service';
import { SeoService } from '../../../../core/services/seo.service';
import { StudioAlertService } from '../../../../core/services/studio-alert.service';
import { SimpleBookingComponent } from './simple-booking.component';

const TEST_DATE_FORMATS = {
  parse: {
    dateInput: 'DD.MM.YYYY',
  },
  display: {
    dateInput: 'DD.MM.YYYY',
    monthYearLabel: 'MMM YYYY',
    dateA11yLabel: 'DD.MM.YYYY',
    monthYearA11yLabel: 'MMMM YYYY',
  },
};

const componentSource = (): string =>
  readFileSync('src/app/features/booking/components/simple-booking/simple-booking.component.ts', 'utf8');

describe('SimpleBookingComponent', () => {
  let fixture: ComponentFixture<SimpleBookingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SimpleBookingComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: MAT_DATE_LOCALE, useValue: 'ru-RU' },
        { provide: DateAdapter, useClass: NativeDateAdapter },
        { provide: MAT_DATE_FORMATS, useValue: TEST_DATE_FORMATS },
        {
          provide: SeoService,
          useValue: {
            setAllMetaData: () => undefined,
          },
        },
        {
          provide: Bitrix24BookingService,
          useValue: {
            getSlots: () => of([]),
            requestPhoneCode: () => of({ success: true, expiresIn: 120 }),
            createBooking: () => of({ success: true }),
          },
        },
        {
          provide: ReferralTrackingService,
          useValue: {
            getPartnerCode: () => null,
            clear: () => undefined,
          },
        },
        {
          provide: StudioAlertService,
          useValue: {
            getClosureForStudio: () => null,
            isStudioClosedOnDate: () => false,
          },
        },
      ],
    });

    fixture = TestBed.createComponent(SimpleBookingComponent);
    fixture.detectChanges();
  });

  it('keeps the choose-studio CTA on the booking route anchor', () => {
    const cta = fixture.nativeElement.querySelector<HTMLAnchorElement>('.booking-primary-link');

    expect(cta).not.toBeNull();
    expect(cta?.textContent).toContain('Выбрать студию');
    expect(cta?.getAttribute('href')).toBe('/booking#booking-step-studio');
  });

  it('uses real document photo samples in the booking hero', () => {
    const heroImages = Array.from(
      fixture.nativeElement.querySelectorAll<HTMLImageElement>('.booking-hero__visual img')
    ).map(img => img.getAttribute('src'));

    expect(heroImages).toEqual([
      '/assets/images/document-sample-passport-rf.webp',
      '/assets/images/document-sample-zagranpassport.webp',
      '/assets/images/document-sample-driving-license.webp',
    ]);
    expect(heroImages).not.toContain('/assets/static/services/passport-photo-new.webp');
  });

  it('uses the contacts studio block pattern for choosing a booking studio', () => {
    const studioStep = fixture.nativeElement.querySelector<HTMLElement>('#booking-step-studio');

    expect(studioStep).not.toBeNull();
    expect(studioStep?.querySelector('.studios-layout')).not.toBeNull();
    expect(studioStep?.querySelector('.map-wrapper .map-frame #booking-map')).not.toBeNull();

    const studioCards = studioStep?.querySelectorAll('.studio-card') ?? [];
    expect(studioCards).toHaveLength(2);
    expect(studioCards[0]?.querySelector('.studio-header .studio-icon-wrap mat-icon')?.textContent).toContain('storefront');
    expect(studioCards[0]?.querySelectorAll('.studio-nav .studio-map-link')).toHaveLength(3);
  });

  it('keeps the selected studio card readable over the active background', () => {
    const source = componentSource();

    expect(source).toContain('.studio-card.active,\n    .studio-card.selected');
    expect(source).toMatch(/\.studio-card\.active,[\s\S]*?background:\s*#ffffff;/);
    expect(source).toMatch(/\.studio-title h3[\s\S]*?color:\s*var\(--booking-ink\);/);
    expect(source).toMatch(/\.studio-detail span[\s\S]*?color:\s*#22252d;/);
    expect(source).not.toContain('class="studio-card studio-option"');
  });

  it('keeps the confirmation form fields readable in the light booking theme', () => {
    const source = componentSource();

    expect(source).toContain('--mat-form-field-outlined-input-text-color: var(--booking-ink);');
    expect(source).toContain('--mat-form-field-outlined-input-text-placeholder-color: var(--booking-muted);');
    expect(source).toContain('--mat-form-field-outlined-label-text-color: var(--booking-muted);');
    expect(source).toContain('--mat-form-field-outlined-focus-label-text-color: var(--booking-red);');
    expect(source).toContain('--mat-form-field-outlined-outline-color: var(--booking-line);');
  });
});
