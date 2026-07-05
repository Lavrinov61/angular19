import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GamificationApiService, GamificationStats } from './gamification-api.service';

const makeStats = (): GamificationStats => ({
  totalXP: 1250, level: 5, levelProgress: 0.6, nextLevelXP: 1500,
  streak: 7, dailyQuests: [], recentAchievements: [],
});

describe('GamificationApiService', () => {
  let service: GamificationApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(GamificationApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getMyStats()', () => {
    it('GETs /api/gamification/my-stats', () => {
      service.getMyStats().subscribe();
      const req = httpMock.expectOne('/api/gamification/my-stats');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeStats() });
    });
  });

  describe('getLeaderboard()', () => {
    it('GETs /api/gamification/leaderboard?period=month by default', () => {
      service.getLeaderboard().subscribe();
      const req = httpMock.expectOne('/api/gamification/leaderboard?period=month');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });

    it('sends custom period', () => {
      service.getLeaderboard('week').subscribe();
      const req = httpMock.expectOne('/api/gamification/leaderboard?period=week');
      req.flush({ success: true, data: [] });
    });
  });

  describe('getAchievements()', () => {
    it('GETs /api/gamification/achievements', () => {
      service.getAchievements().subscribe();
      const req = httpMock.expectOne('/api/gamification/achievements');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });
  });
});
