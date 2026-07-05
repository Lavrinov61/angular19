import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StudioAlertService, type ClosureInfo, type StudioStatus } from '../../services/studio-alert.service';
import { StudioClosureBannerComponent } from './studio-closure-banner.component';

type StudioAlertServiceStub = Pick<StudioAlertService, 'activeClosures' | 'openStudios' | 'hasActiveClosures'>;

describe('StudioClosureBannerComponent', () => {
  let fixture: ComponentFixture<StudioClosureBannerComponent>;
  let closures = signal<ClosureInfo[]>([]);

  beforeEach(async () => {
    closures = signal<ClosureInfo[]>([
      {
        location_code: 'barrikadnaya-4',
        studio_name: 'Своё Фото — Баррикадная',
        address: 'ул. 2-ая Баррикадная 4, Ростов-на-Дону',
        reason: 'Работает ежедневно на Соборном 21',
        closure_dates: ['2026-05-26', '2026-05-27'],
        reopen_date: '2026-05-28',
        status_until: '2026-05-27',
      },
    ]);
    const openStudios = signal<StudioStatus[]>([
      {
        id: 'online',
        name: 'Онлайн смена',
        location_code: 'online',
        address: '',
        status: 'open',
        status_message: null,
        status_until: null,
      },
      {
        id: 'soborny',
        name: 'Своё Фото — Соборный',
        location_code: 'soborny',
        address: 'ул. Соборный 21, Ростов-на-Дону',
        status: 'open',
        status_message: null,
        status_until: null,
      },
    ]);
    const alertService: StudioAlertServiceStub = {
      activeClosures: closures,
      openStudios,
      hasActiveClosures: computed(() => closures().length > 0),
    };

    await TestBed.configureTestingModule({
      imports: [StudioClosureBannerComponent],
      providers: [
        { provide: StudioAlertService, useValue: alertService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudioClosureBannerComponent);
  });

  it('shows the physical open studio address when an online studio is first', () => {
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';

    expect(text).toContain('Работаем ежедневно на Соборном 21');
  });

  it('shows the closure reason for a one-day future closure', () => {
    closures.set([
      {
        location_code: 'soborny',
        studio_name: 'Своё Фото — Соборный',
        address: 'ул. Соборный 21, Ростов-на-Дону',
        reason: '7 июля закрыты по техническим причинам',
        closure_dates: ['2099-07-07'],
        reopen_date: '2099-07-08',
        status_until: null,
      },
    ]);

    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';

    expect(text).toContain('7 июля закрыты по техническим причинам');
  });
});
