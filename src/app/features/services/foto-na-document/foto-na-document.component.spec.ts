import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFileSync } from 'node:fs';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach } from 'vitest';

import { PricingApiService } from '../../../core/services/pricing-api.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { SeoService } from '../../../core/services/seo.service';
import { FotoNaDocumentComponent } from './foto-na-document.component';

interface PhotoSample {
  readonly src: string;
  readonly alt: string;
  readonly label: string;
}

interface FeatureCard {
  readonly image: string;
  readonly alt: string;
}

interface StudioChoice {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly landmark: string;
  readonly workHours: string;
  readonly routeUrl: string | null;
}

const isPhotoSample = (value: unknown): value is PhotoSample => {
  if (typeof value !== 'object' || value === null) return false;

  return typeof Reflect.get(value, 'src') === 'string'
    && typeof Reflect.get(value, 'alt') === 'string'
    && typeof Reflect.get(value, 'label') === 'string';
};

const isFeatureCard = (value: unknown): value is FeatureCard => {
  if (typeof value !== 'object' || value === null) return false;

  return typeof Reflect.get(value, 'image') === 'string'
    && typeof Reflect.get(value, 'alt') === 'string';
};

const isStudioChoice = (value: unknown): value is StudioChoice => {
  if (typeof value !== 'object' || value === null) return false;

  return typeof Reflect.get(value, 'id') === 'string'
    && typeof Reflect.get(value, 'name') === 'string'
    && typeof Reflect.get(value, 'address') === 'string'
    && typeof Reflect.get(value, 'landmark') === 'string'
    && typeof Reflect.get(value, 'workHours') === 'string'
    && (
      typeof Reflect.get(value, 'routeUrl') === 'string'
      || Reflect.get(value, 'routeUrl') === null
    );
};

const getPhotoSamples = (component: FotoNaDocumentComponent): readonly PhotoSample[] => {
  const samples = Reflect.get(component, 'photoSamples');

  if (!Array.isArray(samples)) {
    throw new Error('photoSamples must be an array');
  }

  if (!samples.every(isPhotoSample)) {
    throw new Error('photoSamples must contain photo sample objects');
  }

  return samples;
};

const getPhotoSample = (component: FotoNaDocumentComponent, propertyName: string): PhotoSample => {
  const sample = Reflect.get(component, propertyName);

  if (!isPhotoSample(sample)) {
    throw new Error(`${propertyName} must be a photo sample`);
  }

  return sample;
};

const getFeatureCards = (component: FotoNaDocumentComponent): readonly FeatureCard[] => {
  const cards = Reflect.get(component, 'featureCards');

  if (!Array.isArray(cards)) {
    throw new Error('featureCards must be an array');
  }

  if (!cards.every(isFeatureCard)) {
    throw new Error('featureCards must contain feature card objects');
  }

  return cards;
};

const getStudioChoices = (component: FotoNaDocumentComponent): readonly StudioChoice[] => {
  const choices = Reflect.get(component, 'studioChoices');

  if (!Array.isArray(choices)) {
    throw new Error('studioChoices must be an array');
  }

  if (!choices.every(isStudioChoice)) {
    throw new Error('studioChoices must contain studio choice objects');
  }

  return choices;
};

const componentStyles = (): string =>
  readFileSync('src/app/features/services/foto-na-document/foto-na-document.component.scss', 'utf8');

const componentTemplate = (): string =>
  readFileSync('src/app/features/services/foto-na-document/foto-na-document.component.html', 'utf8');

const getTopLevelRuleBody = (styles: string, selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(styles);

  if (!match?.[1]) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }

  return match[1];
};

describe('FotoNaDocumentComponent photo samples', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: SeoService,
          useValue: {
            updateCanonicalUrl: () => undefined,
          },
        },
        {
          provide: ResponsiveLayoutService,
          useValue: {
            isMobile$: of(false),
            isTablet$: of(false),
            isDesktop$: of(true),
          },
        },
        {
          provide: PricingApiService,
          useValue: {
            getMinStudioPrice: () => 700,
            loadCategories: () => undefined,
          },
        },
      ],
    });
  });

  it('uses the real document photo examples from the provided set', () => {
    const component = TestBed.runInInjectionContext(() => new FotoNaDocumentComponent());
    const samples = getPhotoSamples(component);

    expect(samples.map(sample => sample.src)).toEqual([
      '/assets/images/document-sample-passport-rf.webp',
      '/assets/images/document-sample-zagranpassport.webp',
      '/assets/images/document-sample-driving-license.webp',
      '/assets/images/document-sample-visa.webp',
      '/assets/images/document-sample-student-card.webp',
    ]);
    expect(samples.every(sample => !sample.src.includes('passport-photo'))).toBe(true);
  });

  it('uses the provided examples for prominent document photo visuals', () => {
    const component = TestBed.runInInjectionContext(() => new FotoNaDocumentComponent());
    const heroSample = getPhotoSample(component, 'heroPhotoSample');
    const formatSample = getPhotoSample(component, 'formatPreviewSample');
    const darkCtaSample = getPhotoSample(component, 'darkCtaPhotoSample');
    const featureImages = getFeatureCards(component).map(card => card.image);

    expect(heroSample.src).toBe('/assets/images/document-sample-passport-rf.webp');
    expect(formatSample.src).toBe('/assets/images/document-sample-passport-rf.webp');
    expect(darkCtaSample.src).toBe('/assets/images/document-sample-zagranpassport.webp');
    expect(featureImages).toContain('/assets/images/document-sample-passport-rf.webp');
    expect(featureImages).toContain('/assets/images/document-sample-visa.webp');
    expect(featureImages.every(src => !src.includes('/assets/static/services/foto-na-document.webp'))).toBe(true);
    expect(featureImages.every(src => !src.includes('/assets/static/services/foto-na-passport.webp'))).toBe(true);
  });

  it('keeps responsive sample images from using HTML height attributes as layout height', () => {
    const styles = componentStyles();

    expect(getTopLevelRuleBody(styles, 'img')).toContain('height: auto;');
    expect(styles).toMatch(/\.hero-product__portrait\s*\{[\s\S]*?height:\s*clamp\(/);
    expect(styles).toMatch(/\.hero-product__portrait\s*\{[\s\S]*?img\s*\{[\s\S]*?height:\s*100%;/);
    expect(styles).toMatch(/\.dark-cta__visual\s*\{[\s\S]*?img\s*\{[\s\S]*?height:\s*clamp\(/);
  });

  it('uses studio choice cards instead of placeholder photographer portraits in the final CTA', () => {
    const component = TestBed.runInInjectionContext(() => new FotoNaDocumentComponent());
    const studioChoices = getStudioChoices(component);
    const template = componentTemplate();

    expect(studioChoices.map(choice => choice.id)).toEqual(['soborny']);
    expect(studioChoices.every(choice => choice.routeUrl !== null)).toBe(true);
    expect(template).toContain('studio-choice-grid');
    expect(template).toContain('@for (studio of studioChoices; track studio.id)');
    expect(template).toContain('Можно без записи');
    expect(template).toContain('Маршрут');
    expect(template).not.toContain('teamPhotographers()');
    expect(template).not.toContain('team-portrait');
  });
});
