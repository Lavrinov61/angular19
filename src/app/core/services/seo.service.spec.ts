import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SeoService } from './seo.service';

type JsonObject = Record<string, unknown>;

function readJsonLd(): unknown {
  const script = document.head.querySelector('script[type="application/ld+json"]');
  expect(script).toBeTruthy();
  return JSON.parse(script?.textContent ?? 'null');
}

function expectJsonObject(value: unknown): asserts value is JsonObject {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
}

describe('SeoService', () => {
  let service: SeoService;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    service = TestBed.inject(SeoService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('removes review snippet fields from unsupported Service JSON-LD parents', () => {
    service.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Фото на документы',
      description: 'Профессиональное фото на документы',
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '5.0',
        reviewCount: '482',
      },
      review: [
        {
          '@type': 'Review',
          author: { '@type': 'Person', name: 'Клиент' },
          reviewBody: 'Отлично',
        },
      ],
    });

    const jsonLd = readJsonLd();
    expectJsonObject(jsonLd);

    expect(jsonLd['@type']).toBe('Service');
    expect(jsonLd['name']).toBe('Фото на документы');
    expect(jsonLd['aggregateRating']).toBeUndefined();
    expect(jsonLd['review']).toBeUndefined();
  });

  it('removes self-serving LocalBusiness review fields from the home page JSON-LD', () => {
    service.setHomePageJsonLd();

    const jsonLd = readJsonLd();
    expectJsonObject(jsonLd);

    expect(jsonLd['@type']).toBe('LocalBusiness');
    expect(jsonLd['name']).toBe('Своё Фото');
    expect(jsonLd['aggregateRating']).toBeUndefined();
    expect(jsonLd['review']).toBeUndefined();
  });

  it('keeps review snippet fields on Product JSON-LD parents', () => {
    service.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Печать фото 10x15',
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '5.0',
        reviewCount: '482',
      },
    });

    const jsonLd = readJsonLd();
    expectJsonObject(jsonLd);

    expect(jsonLd['@type']).toBe('Product');
    expect(jsonLd['aggregateRating']).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '5.0',
      reviewCount: '482',
    });
  });
});
