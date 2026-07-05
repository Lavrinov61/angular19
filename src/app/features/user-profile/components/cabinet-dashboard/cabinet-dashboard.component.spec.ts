/// <reference types="node" />

import { ɵresolveComponentResources as resolveComponentResources, signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeRu from '@angular/common/locales/ru';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { readFile } from 'node:fs/promises';

import { AuthService, type UserProfile } from '../../../../core/services/auth.service';
import { PhotoApiService, type ClientPhotoSession } from '../../../../core/services/photo-api.service';
import { ProfileDashboardService, type DashboardData } from '../../../../core/services/profile-dashboard.service';
import { SubscriptionService } from '../../../../core/services/subscription.service';
import {
  CabinetCatalogService,
  type CabinetCatalogGroup,
  type CabinetCatalogItem,
} from '../../services/cabinet-catalog.service';
import { CabinetDashboardComponent } from './cabinet-dashboard.component';

registerLocaleData(localeRu);

describe('CabinetDashboardComponent', () => {
  let fixture: ComponentFixture<CabinetDashboardComponent>;

  const currentUser = signal<UserProfile | null>({
    id: 'user-1',
    email: 'client@example.com',
    display_name: 'Клиент',
    role: 'client',
  });

  const dashboardData = signal<DashboardData | null>({
    loyaltyProfile: null,
    achievements: [],
    recentOrders: [],
    upcomingBookings: [],
  });

  const catalogItem: CabinetCatalogItem = {
    id: 'pechat-foto',
    title: 'Печать фото',
    description: 'Фотографии на бумаге',
    icon: 'print',
    route: '/pechat-foto',
    imageUrl: null,
    categoryId: 'print',
    categoryName: 'Печать',
    badge: null,
    favorite: true,
    sortOrder: 0,
  };

  const authServiceStub = {
    currentUser,
    getCurrentUser: () => currentUser(),
  } satisfies Pick<AuthService, 'currentUser' | 'getCurrentUser'>;

  const dashboardServiceStub = {
    loading: signal(false),
    dashboardData,
    loyaltySummary: signal(null),
    loadDashboard: () => undefined,
  } satisfies Pick<ProfileDashboardService, 'loading' | 'dashboardData' | 'loyaltySummary' | 'loadDashboard'>;

  const subscriptionServiceStub = {
    ensureLoaded: () => undefined,
  } satisfies Pick<SubscriptionService, 'ensureLoaded'>;

  const photoApiServiceStub = {
    photoSessions: signal<ClientPhotoSession[]>([]),
    getClientPhotoSessions: (_clientId: string) => of({ success: true, data: [] }),
  } satisfies Pick<PhotoApiService, 'photoSessions' | 'getClientPhotoSessions'>;

  const catalogServiceStub = {
    items: signal([catalogItem]),
    featuredItems: signal([catalogItem]),
    groups: signal<CabinetCatalogGroup[]>([
      { title: 'Печать', items: [catalogItem] },
    ]),
  } satisfies Pick<CabinetCatalogService, 'items' | 'featuredItems' | 'groups'>;

  beforeAll(async () => {
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CabinetDashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceStub },
        { provide: ProfileDashboardService, useValue: dashboardServiceStub },
        { provide: SubscriptionService, useValue: subscriptionServiceStub },
        { provide: PhotoApiService, useValue: photoApiServiceStub },
        { provide: CabinetCatalogService, useValue: catalogServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CabinetDashboardComponent);
    fixture.detectChanges();
  });

  it('does not render the duplicate mobile support card inside the dashboard', () => {
    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent ?? '';

    expect(element.querySelector('.mobile-support-widget')).toBeNull();
    expect(text).not.toContain('Связь со студией');
    expect(text).not.toContain('Чат с поддержкой');
  });
});
