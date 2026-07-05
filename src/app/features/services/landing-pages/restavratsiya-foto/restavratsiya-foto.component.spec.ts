import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SeoService } from '../../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../../core/services/responsive-layout.service';
import { RestavratsiyaFotoComponent } from './restavratsiya-foto.component';

class MockSeoService {
  clearJsonLd(): void {}
  setAllMetaData(): void {}
  addJsonLd(): void {}
  setBreadcrumbJsonLd(): void {}
  setFAQPageJsonLd(): void {}
}

class MockResponsiveLayoutService {
  readonly isMobile$ = of(false);
  readonly isTablet$ = of(false);
  readonly isDesktop$ = of(true);
}

interface WritableSignalLike<T> {
  (): T;
  set(value: T): void;
}

interface CompleteFilePayload {
  readonly s3Key: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly fileSize: number;
  readonly width?: number;
  readonly height?: number;
}

describe('RestavratsiyaFotoComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: SeoService, useClass: MockSeoService },
        { provide: ResponsiveLayoutService, useClass: MockResponsiveLayoutService },
      ],
    });
  });

  it('makes studio arrival and messenger sending obvious in the first screen data', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());

    const handoffOptions = Reflect.get(component, 'handoffOptions') as readonly {
      readonly title: string;
      readonly description: string;
    }[];
    const heroStats = Reflect.get(component, 'heroStats') as () => readonly {
      readonly value: string;
      readonly label: string;
    }[];

    expect(handoffOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Принесите фото в студию',
        description: expect.stringContaining('старыми фотографиями'),
      }),
      expect.objectContaining({
        title: 'Пришлите через мессенджер',
        description: expect.stringContaining('любой мессенджер'),
      }),
    ]));
    expect(heroStats().map(stat => `${stat.value} ${stat.label}`).join(' ')).toContain('приехать');
    expect(heroStats().map(stat => `${stat.value} ${stat.label}`).join(' ')).toContain('мессенджер');
  });

  it('summarizes uploaded restoration files like the photo print uploader', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const uploadRows = Reflect.get(component, 'uploadRows');
    const uploadState = Reflect.get(component, 'uploadState');
    const uploadProgressPercent = Reflect.get(component, 'uploadProgressPercent');
    const uploadStatusTitle = Reflect.get(component, 'uploadStatusTitle');
    const uploadStatusHint = Reflect.get(component, 'uploadStatusHint');
    const uploadStatusIcon = Reflect.get(component, 'uploadStatusIcon');

    uploadRows.set([
      { id: '1', name: 'old-photo-1.jpg', sizeLabel: '2 МБ', status: 'done' },
      { id: '2', name: 'old-photo-2.jpg', sizeLabel: '3 МБ', status: 'uploading' },
    ]);
    uploadState.set('uploading');

    expect(uploadProgressPercent()).toBe(75);
    expect(uploadStatusTitle()).toBe('Загрузка 1 из 2');
    expect(uploadStatusHint()).toContain('оценка продолжится');
    expect(uploadStatusIcon()).toBe('cloud_sync');
  });

  it('shows a separate AI analysis state after files finish uploading', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const uploadRows = Reflect.get(component, 'uploadRows');
    const uploadState = Reflect.get(component, 'uploadState');
    const isAnalyzingUpload = Reflect.get(component, 'isAnalyzingUpload') as () => boolean;
    const uploadStatusTitle = Reflect.get(component, 'uploadStatusTitle');
    const uploadStatusHint = Reflect.get(component, 'uploadStatusHint');
    const uploadStatusIcon = Reflect.get(component, 'uploadStatusIcon');
    const uploadProgressLabel = Reflect.get(component, 'uploadProgressLabel');

    uploadRows.set([
      { id: '1', name: 'old-photo-1.jpg', sizeLabel: '2 МБ', status: 'done' },
    ]);
    uploadState.set('uploading');

    expect(isAnalyzingUpload()).toBe(true);
    expect(uploadStatusTitle()).toBe('AI анализирует фото');
    expect(uploadStatusHint()).toContain('сложность реставрации');
    expect(uploadStatusIcon()).toBe('psychology');
    expect(uploadProgressLabel()).toBe('анализ');
  });

  it('uses in-page restoration tabs instead of plain hash navigation', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const pageTabs = Reflect.get(component, 'pageTabs') as readonly {
      readonly id: string;
      readonly label: string;
    }[];
    const activeSection = Reflect.get(component, 'activeSection') as () => string;
    const scrollToSection = Reflect.get(component, 'scrollToSection') as (event: Event, id: string) => void;
    const event = new Event('click');
    const preventDefault = vi.spyOn(event, 'preventDefault');

    expect(pageTabs.map(tab => tab.id)).toEqual([
      'restoration-order',
      'complexity',
      'process',
      'result',
      'faq',
      'contacts',
    ]);
    expect(activeSection()).toBe('restoration-order');

    scrollToSection.call(component, event, 'faq');

    expect(preventDefault).toHaveBeenCalled();
    expect(activeSection()).toBe('faq');
  });

  it('sends only the desired output size with upload completion', async () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const http = TestBed.inject(HttpTestingController);
    const selectedOutputTargetId = Reflect.get(component, 'selectedOutputTargetId') as WritableSignalLike<string>;
    const completeUpload = Reflect.get(component, 'completeUpload') as (
      files: readonly CompleteFilePayload[],
    ) => Promise<{
      readonly orderId: string;
      readonly paymentUrl: string | null;
    }>;

    selectedOutputTargetId.set('20x30');
    const promise = completeUpload.call(component, [
      {
        s3Key: 'restoration/old-photo.png',
        fileName: 'old-photo.png',
        contentType: 'image/png',
        fileSize: 1_900_000,
        width: 1800,
        height: 1400,
      },
    ]);

    const req = http.expectOne('/api/restoration-orders/upload/complete');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      outputTarget: {
        kind: 'print',
        widthCm: 20,
        heightCm: 30,
        dpi: 300,
        label: '20x30 см',
      },
      files: [
        {
          s3Key: 'restoration/old-photo.png',
          width: 1800,
          height: 1400,
        },
      ],
    });

    req.flush({
      success: true,
      data: {
        orderId: 'REST-TEST-001',
        paymentUrl: '/pay/REST-TEST-001',
        estimate: {
          tier: 'complex',
          title: 'Сложная реставрация',
          price: 2800,
          priceLabel: '2 800₽',
          leadTime: '1-2 дня',
          reason: 'Есть заломы и выцветание.',
          clientReason: 'Есть заломы и выцветание.',
          confidence: 0.84,
          humanReviewRequired: false,
          automaticPaymentAllowed: true,
          scores: {
            scratches: 1,
            tears: 2,
            missingAreas: 1,
            fadingContrast: 2,
            stains: 1,
            blurDetail: 1,
            faceDamage: 1,
            reconstruction: 0,
            outputScale: 2,
          },
          outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
          sourceMetrics: {
            sourceWidthPx: 1800,
            sourceHeightPx: 1400,
            targetWidthPx: 2362,
            targetHeightPx: 3543,
            scaleFactor: 1.97,
            score: 2,
          },
        },
      },
    });

    await expect(promise).resolves.toMatchObject({ orderId: 'REST-TEST-001' });
    http.verify();
  });

  it('hides payment actions when the analysis requires retoucher review', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const estimate = Reflect.get(component, 'estimate') as WritableSignalLike<unknown>;
    const paymentUrl = Reflect.get(component, 'paymentUrl') as WritableSignalLike<string | null>;
    const canPayEstimate = Reflect.get(component, 'canPayEstimate') as () => boolean;
    const estimateActionHint = Reflect.get(component, 'estimateActionHint') as () => string;

    estimate.set({
      tier: 'pro',
      title: 'Реставрация профи',
      price: null,
      priceLabel: 'после оценки ретушёром',
      leadTime: 'после оценки',
      reason: 'Лицо повреждено, стоимость подтвердит ретушёр.',
      clientReason: 'Лицо повреждено, стоимость подтвердит ретушёр.',
      confidence: 0.91,
      humanReviewRequired: true,
      automaticPaymentAllowed: false,
      scores: {
        scratches: 2,
        tears: 2,
        missingAreas: 2,
        fadingContrast: 2,
        stains: 1,
        blurDetail: 2,
        faceDamage: 3,
        reconstruction: 2,
        outputScale: 2,
      },
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      sourceMetrics: {
        sourceWidthPx: 1500,
        sourceHeightPx: 2100,
        targetWidthPx: 2362,
        targetHeightPx: 3543,
        scaleFactor: 1.69,
        score: 1,
      },
    });
    paymentUrl.set(null);

    expect(canPayEstimate()).toBe(false);
    expect(estimateActionHint()).toContain('подтвердит ретушёр');
  });

  it('validates custom output size without asking for source dimensions', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const selectedOutputTargetId = Reflect.get(component, 'selectedOutputTargetId') as WritableSignalLike<string>;
    const customOutputWidthCm = Reflect.get(component, 'customOutputWidthCm') as WritableSignalLike<number>;
    const customOutputHeightCm = Reflect.get(component, 'customOutputHeightCm') as WritableSignalLike<number>;
    const buildOutputTargetPayload = Reflect.get(component, 'buildOutputTargetPayload') as () => unknown;

    selectedOutputTargetId.set('custom');
    customOutputWidthCm.set(18);
    customOutputHeightCm.set(24);

    expect(buildOutputTargetPayload.call(component)).toEqual({
      kind: 'print',
      widthCm: 18,
      heightCm: 24,
      dpi: 300,
      label: '18x24 см',
    });

    customOutputWidthCm.set(0);
    expect(() => buildOutputTargetPayload.call(component)).toThrow('Укажите нужный размер результата');
  });

  it('never surfaces a raw HTML 50x body as the upload error message', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const messageFromError = Reflect.get(component, 'messageFromError') as (error: unknown) => string;

    const htmlBodyError = new HttpErrorResponse({
      status: 502,
      error: '<html>\n<head><title>502 Bad Gateway</title></head>\n<body>...</body>\n</html>',
    });
    const message = messageFromError.call(component, htmlBodyError);

    expect(message).not.toContain('<html');
    expect(message).not.toContain('<title>');
    expect(message).toBe(
      'Сервис перегружен, попробуйте ещё раз через минуту или напишите нам в мессенджер.',
    );

    const htmlInErrorField = new HttpErrorResponse({
      status: 500,
      error: { error: '<!doctype html><html><body>Internal Server Error</body></html>' },
    });
    expect(messageFromError.call(component, htmlInErrorField)).not.toContain('<html');
  });

  it('keeps a short and valid server-side error message intact', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const messageFromError = Reflect.get(component, 'messageFromError') as (error: unknown) => string;

    const validationError = new HttpErrorResponse({
      status: 400,
      error: { error: 'Ключ загрузки не совпадает с подписанным' },
    });

    expect(messageFromError.call(component, validationError)).toBe(
      'Ключ загрузки не совпадает с подписанным',
    );
  });

  it('keeps the "what we can do next" block purely informational without actions', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const mayFormats = Reflect.get(component, 'mayFormats') as readonly {
      readonly icon: string;
      readonly title: string;
      readonly description: string;
    }[];

    expect(mayFormats.length).toBeGreaterThan(0);
    for (const format of mayFormats) {
      expect(typeof format.icon).toBe('string');
      expect(format.icon.length).toBeGreaterThan(0);
      expect(typeof format.title).toBe('string');
      expect(typeof format.description).toBe('string');
      // Чисто информационный набор: ни одного поля-действия (action/onClick/href/cta).
      expect(Object.keys(format)).toEqual(['icon', 'title', 'description']);
      expect(format.title).not.toContain('—');
      expect(format.description).not.toContain('—');
      expect(format.description).not.toContain('**');
    }
  });

  it('scrolls the "compare levels" button to the tier comparison table', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const scrollToComplexity = Reflect.get(component, 'scrollToComplexity') as () => void;
    const scrollToElement = vi.fn();
    Reflect.set(component, 'scrollToElement', scrollToElement);

    scrollToComplexity.call(component);

    expect(scrollToElement).toHaveBeenCalledWith('complexity-tiers');
  });

  it('falls back to the friendly text when the error body is not a usable string', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const messageFromError = Reflect.get(component, 'messageFromError') as (error: unknown) => string;
    const friendly = 'Сервис перегружен, попробуйте ещё раз через минуту или напишите нам в мессенджер.';

    const objectErrorField = new HttpErrorResponse({
      status: 500,
      error: { error: { code: 'BOOM', details: ['nope'] } },
    });
    expect(messageFromError.call(component, objectErrorField)).toBe(friendly);

    const numericBody = new HttpErrorResponse({ status: 500, error: 500 });
    expect(messageFromError.call(component, numericBody)).toBe(friendly);

    const nullBody = new HttpErrorResponse({ status: 504, error: null });
    expect(messageFromError.call(component, nullBody)).toBe(friendly);
  });

  it('drops an overlong plain-text error body but keeps a short valid one', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const messageFromError = Reflect.get(component, 'messageFromError') as (error: unknown) => string;
    const friendly = 'Сервис перегружен, попробуйте ещё раз через минуту или напишите нам в мессенджер.';

    const longBody = 'я'.repeat(301);
    const longError = new HttpErrorResponse({ status: 400, error: longBody });
    expect(messageFromError.call(component, longError)).toBe(friendly);

    const shortValid = new HttpErrorResponse({ status: 400, error: 'Файл повреждён, загрузите другой' });
    expect(messageFromError.call(component, shortValid)).toBe('Файл повреждён, загрузите другой');
  });

  it('hides a raw English network failure behind the friendly text', () => {
    const component = TestBed.runInInjectionContext(() => new RestavratsiyaFotoComponent());
    const messageFromError = Reflect.get(component, 'messageFromError') as (error: unknown) => string;
    const friendly = 'Сервис перегружен, попробуйте ещё раз через минуту или напишите нам в мессенджер.';

    // fetch() при обрыве сети бросает raw TypeError — клиенту не показываем английский текст.
    const networkError = new TypeError('Failed to fetch');
    expect(messageFromError.call(component, networkError)).toBe(friendly);

    // А наши собственные русские ошибки валидации остаются как есть.
    const ownValidation = new Error('Выберите фото для оценки');
    expect(messageFromError.call(component, ownValidation)).toBe('Выберите фото для оценки');
  });
});
