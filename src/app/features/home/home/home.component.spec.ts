/// <reference types="node" />

import { ɵresolveComponentResources as resolveComponentResources } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideHttpClient } from '@angular/common/http';
import { readFile } from 'node:fs/promises';
import { HomeComponent } from './home.component';

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];

  disconnect(): void {}

  observe(_target: Element): void {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(_target: Element): void {}
}

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  beforeAll(async () => {
    globalThis.IntersectionObserver = MockIntersectionObserver;
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps the service tabs while using the calculator offer for subscription pricing', () => {
    expect(component.calculatorTabs.map(({ label }) => label)).toEqual([
      'Документы',
      'Печать',
      'Учёба',
      'Бизнес',
      'Ретушь',
    ]);
    expect(component.calculatorTabs.every(({ offerTitle }) => offerTitle === 'Печатайте дешевле с подпиской')).toBe(true);
    expect(component.calculatorTabs.every(({ cta }) => cta === 'Оформить подписку')).toBe(true);

    const studyOffer = component.calculatorTabs.find((offer) => offer.label === 'Учёба');
    expect(studyOffer?.amount).toBe('A4 от 3 ₽');

    const businessOffer = component.calculatorTabs.find((offer) => offer.label === 'Бизнес');
    expect(businessOffer?.options.some((option) => option.label === 'B2B-аккаунт со счётом')).toBe(true);
  });

  it('uses a task-oriented calculator heading', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Выберите, что нужно сделать');
    expect(text).not.toContain('Подберите заказ');
  });

  it('promotes education print pricing in the main hero card', () => {
    const heroCard = (fixture.nativeElement as HTMLElement).querySelector('.hero-card--primary');
    const heroText = heroCard?.textContent?.replace(/\s+/g, ' ') ?? '';

    expect(heroCard?.getAttribute('href')).toBe('/education');
    expect(heroText).toContain('Печать для учёбы от 3 ₽');
    expect(heroText).toContain('Для учащихся и учителей');
    expect(heroText).toContain('Подключить доступ');
    expect(heroText).not.toContain('Платим до 5 000 ₽');
  });

  it('markets the subscription value as a simple price comparison', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Печатайте дешевле с подпиской');
    expect(text).toContain('Без подписки');
    expect(text).toContain('С подпиской');
    expect(text).toContain('A4');
    expect(text).toContain('10 ₽');
    expect(text).toContain('от 3 ₽');
    expect(text).toContain('Фото 10×15');
    expect(text).toContain('20 ₽');
    expect(text).toContain('от 14 ₽');
    expect(text).toContain('Подписка снижает цену на каждый отпечаток');
    expect(text).not.toContain('личного, учебного или бизнес-доступа');
    expect(text).not.toContain('Что получите');
  });

  it('keeps subscription marketing focused on print prices instead of account types', () => {
    expect(component.accountCards.map(({ title }) => title)).toEqual([
      'A4 документы',
      'Фото 10×15',
      'Регулярная печать',
    ]);
    expect(component.accountCards.every(({ cta }) => cta === 'Оформить подписку')).toBe(true);
    expect(component.accountCards.some(({ title }) => title === 'Образовательный')).toBe(false);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Сравниваем обычную цену и цену с подпиской');
    expect(text).not.toContain('Выберите аккаунт под задачу');
  });
});
