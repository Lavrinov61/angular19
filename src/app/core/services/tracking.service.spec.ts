import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FingerprintService } from './fingerprint.service';
import { LoggerService } from './logger.service';
import { TrackingService } from './tracking.service';

const VISITOR_COOKIE = 'visitor_id';
const FIRST_VISIT_COOKIE = 'first_visit_id';
const LEGACY_VISITOR_ID = '11111111-1111-4111-8111-111111111111';
const LEGACY_FIRST_VISIT_ID = '22222222-2222-4222-8222-222222222222';
const SAFE_VISITOR_ID = 'sfv_11111111111141118111111111111111';
const SAFE_FIRST_VISIT_ID = 'sfv_22222222222242228222222222222222';

function setUrl(url: string): void {
  window.history.pushState({}, '', url);
}

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value};path=/;SameSite=Lax`;
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
}

function hasCookie(name: string): boolean {
  return document.cookie.split('; ').some(cookie => cookie.startsWith(`${name}=`));
}

function getCookieValue(name: string): string | null {
  const cookie = document.cookie.split('; ').find(entry => entry.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1) ?? null;
}

describe('TrackingService', () => {
  let service: TrackingService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    deleteCookie(VISITOR_COOKIE);
    deleteCookie(FIRST_VISIT_COOKIE);
    setUrl('/?utm_source=cdnvideo-test&utm_campaign=uuid-cookie');
    sessionStorage.setItem('sf_replay_session_id', 'session-test');

    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ));

    TestBed.configureTestingModule({
      providers: [
        TrackingService,
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: FingerprintService,
          useValue: {
            ready: Promise.resolve(),
            visitorId: () => 'fingerprint-test',
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: vi.fn(),
            info: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(TrackingService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    deleteCookie(VISITOR_COOKIE);
    deleteCookie(FIRST_VISIT_COOKIE);
    setUrl('/');
    TestBed.resetTestingModule();
  });

  it('migrates legacy UUID cookies to localStorage and rewrites CDN-safe cookies', async () => {
    setCookie(VISITOR_COOKIE, LEGACY_VISITOR_ID);
    setCookie(FIRST_VISIT_COOKIE, LEGACY_FIRST_VISIT_ID);

    await service.initTracking();

    expect(localStorage.getItem(VISITOR_COOKIE)).toBe(LEGACY_VISITOR_ID);
    expect(localStorage.getItem(FIRST_VISIT_COOKIE)).toBe(LEGACY_FIRST_VISIT_ID);
    expect(getCookieValue(VISITOR_COOKIE)).toBe(SAFE_VISITOR_ID);
    expect(getCookieValue(FIRST_VISIT_COOKIE)).toBe(SAFE_FIRST_VISIT_ID);
  });

  it('creates tracking identifiers in localStorage and CDN-safe request cookies', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('33333333-3333-4333-8333-333333333333')
      .mockReturnValueOnce('44444444-4444-4444-8444-444444444444');

    await service.initTracking();

    expect(localStorage.getItem(VISITOR_COOKIE)).toBe('33333333-3333-4333-8333-333333333333');
    expect(localStorage.getItem(FIRST_VISIT_COOKIE)).toBe('44444444-4444-4444-8444-444444444444');
    expect(getCookieValue(VISITOR_COOKIE)).toBe('sfv_33333333333343338333333333333333');
    expect(getCookieValue(FIRST_VISIT_COOKIE)).toBe('sfv_44444444444444448444444444444444');
  });

  it('restores tracking identifiers from CDN-safe cookies', async () => {
    setCookie(VISITOR_COOKIE, 'sfv_55555555555545558555555555555555');
    setCookie(FIRST_VISIT_COOKIE, 'sfv_66666666666646668666666666666666');

    await service.initTracking();

    expect(localStorage.getItem(VISITOR_COOKIE)).toBe('55555555-5555-4555-8555-555555555555');
    expect(localStorage.getItem(FIRST_VISIT_COOKIE)).toBe('66666666-6666-4666-8666-666666666666');
    expect(getCookieValue(VISITOR_COOKIE)).toBe('sfv_55555555555545558555555555555555');
    expect(getCookieValue(FIRST_VISIT_COOKIE)).toBe('sfv_66666666666646668666666666666666');
    expect(hasCookie(VISITOR_COOKIE)).toBe(true);
    expect(hasCookie(FIRST_VISIT_COOKIE)).toBe(true);
  });
});
