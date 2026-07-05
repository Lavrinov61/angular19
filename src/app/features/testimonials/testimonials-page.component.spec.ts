/// <reference types="node" />

import { ɵresolveComponentResources as resolveComponentResources, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFile } from 'node:fs/promises';
import { SeoService } from '../../core/services/seo.service';
import { TestimonialSection } from '../../shared/components/testimonials/testimonial.model';
import { TestimonialService } from '../../shared/components/testimonials/testimonial.service';
import { TestimonialsPageComponent } from './testimonials-page.component';

const TESTIMONIAL_DATA: TestimonialSection = {
  title: 'Нам доверяют',
  description: 'Все отзывы настоящие',
  overallRating: 5,
  reviewCount: 515,
  testimonials: [
    {
      id: 'review-1',
      author: 'Виктория',
      content: 'Очень внимательные сотрудники, фото на паспорт получилось быстро и красиво.',
      rating: 5,
      location: 'Ростов-на-Дону',
      service: 'Фото на документы',
      source: {
        name: 'Яндекс Карты',
        url: 'https://example.test/yandex',
      },
    },
    {
      id: 'review-2',
      author: 'Мария',
      content: 'Печатала фотографии, помогли с форматом и качеством бумаги.',
      rating: 5,
      location: 'Ростов-на-Дону',
      service: 'Фотопечать',
      source: {
        name: '2ГИС',
        url: 'https://example.test/2gis',
      },
    },
  ],
  reviewPlatforms: [
    { name: 'Яндекс — Соборный', url: 'https://example.test/yandex', icon: 'explore' },
    { name: '2ГИС — Соборный', url: 'https://example.test/2gis', icon: 'location_on' },
  ],
};

class MockTestimonialService {
  readonly testimonialSection = signal(TESTIMONIAL_DATA);

  getTestimonialsSync(): TestimonialSection {
    return TESTIMONIAL_DATA;
  }
}

class MockSeoService {
  setAllMetaData(): void {}
  setLocalSeoMeta(): void {}
  addJsonLd(): void {}
  setBreadcrumbJsonLd(): void {}
}

describe('TestimonialsPageComponent', () => {
  let fixture: ComponentFixture<TestimonialsPageComponent>;
  let testimonialService: MockTestimonialService;

  beforeAll(async () => {
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    testimonialService = new MockTestimonialService();

    await TestBed.configureTestingModule({
      imports: [TestimonialsPageComponent],
      providers: [
        provideRouter([]),
        { provide: TestimonialService, useValue: testimonialService },
        { provide: SeoService, useClass: MockSeoService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestimonialsPageComponent);
    fixture.detectChanges();
  });

  it('renders the Alfa-like testimonials structure', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.alfa-testimonials-page')).toBeTruthy();
    expect(element.querySelector('.reviews-stage')).toBeTruthy();
    expect(element.querySelector('.proof-panel')).toBeTruthy();
    expect(element.querySelectorAll('.source-card').length).toBe(2);
    expect(element.querySelector('.review-card--spotlight')).toBeTruthy();
    expect(element.textContent).toContain('515');
    expect(element.textContent).toContain('Проверить отзывы');
  });

  it('updates hero metrics when testimonial stats change after API load', () => {
    testimonialService.testimonialSection.set({
      ...TESTIMONIAL_DATA,
      overallRating: 4.9,
      reviewCount: 540,
    });

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('540');
    expect(element.textContent).toContain('4.9');
  });
});
