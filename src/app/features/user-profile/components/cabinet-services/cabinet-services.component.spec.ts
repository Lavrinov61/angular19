/// <reference types="node" />

import { ɵresolveComponentResources as resolveComponentResources, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFile } from 'node:fs/promises';

import { CabinetCatalogService, type CabinetCatalogGroup, type CabinetCatalogItem } from '../../services/cabinet-catalog.service';
import { CabinetServicesComponent } from './cabinet-services.component';

describe('CabinetServicesComponent', () => {
  let fixture: ComponentFixture<CabinetServicesComponent>;

  const featuredItem: CabinetCatalogItem = {
    id: 'foto-na-document',
    title: 'Фото на документы',
    description: 'от 700 ₽',
    icon: 'badge',
    route: '/foto-na-document',
    imageUrl: null,
    categoryId: 'documents',
    categoryName: 'Документы',
    badge: 'популярно',
    favorite: true,
    sortOrder: 0,
  };

  const groups = signal<CabinetCatalogGroup[]>([
    { title: 'Документы', items: [featuredItem] },
  ]);

  const catalogStub = {
    loading: signal(false),
    error: signal<string | null>(null),
    items: signal([featuredItem]),
    featuredItems: signal([featuredItem]),
    groups,
  } satisfies Pick<CabinetCatalogService, 'loading' | 'error' | 'items' | 'featuredItems' | 'groups'>;

  beforeAll(async () => {
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CabinetServicesComponent],
      providers: [
        provideRouter([]),
        { provide: CabinetCatalogService, useValue: catalogStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CabinetServicesComponent);
    fixture.detectChanges();
  });

  it('uses a client-facing title and removes the fake category dropdown', () => {
    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent ?? '';

    expect(text).toContain('Услуги и печать');
    expect(text).not.toContain('Все услуги Своё Фото');
    expect(text).not.toContain('Категории');
  });
});
