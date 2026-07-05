import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface GamificationStats {
  totalXP: number;
  level: number;
  levelProgress: number;
  nextLevelXP: number;
  streak: number;
  dailyQuests: DailyQuest[];
  recentAchievements: Achievement[];
}

export interface DailyQuest {
  id: string;
  quest_type: string;
  title: string;
  target: number;
  progress: number;
  xp_reward: number;
  completed: boolean;
}

export interface Achievement {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  xp_reward: number;
  unlocked: boolean;
  unlocked_at: string | null;
}

export interface LeaderboardEntry {
  employee_id: string;
  display_name: string;
  photo_url: string | null;
  total_xp: number;
  level: number;
  rank: number;
}

export interface EmployeeProfile {
  total_shifts: number;
  completed_shifts: number;
  total_hours: number;
  avg_shift_duration: number;
  attendance_pct: number;
  punctuality_pct: number;
  current_streak: number;
  longest_streak: number;
  total_xp: number;
  level: number;
  level_progress: number;
  xp_this_month: number;
  leaderboard_rank: number;
  total_revenue: number;
  orders_count: number;
  quests_completed_total: number;
}

export interface XpLogEntry {
  xp_amount: number;
  action_type: string;
  entity_id: string | null;
  description: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class GamificationApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/gamification';

  getMyStats(): Observable<{ success: boolean; data: GamificationStats }> {
    return this.http.get<{ success: boolean; data: GamificationStats }>(`${this.baseUrl}/my-stats`);
  }

  getMyProfile(): Observable<{ success: boolean; data: EmployeeProfile }> {
    return this.http.get<{ success: boolean; data: EmployeeProfile }>(`${this.baseUrl}/my-profile`);
  }

  getMyXpLog(limit = 30): Observable<{ success: boolean; data: XpLogEntry[] }> {
    return this.http.get<{ success: boolean; data: XpLogEntry[] }>(`${this.baseUrl}/my-xp-log`, {
      params: { limit: limit.toString() },
    });
  }

  getLeaderboard(period = 'month'): Observable<{ success: boolean; data: LeaderboardEntry[] }> {
    return this.http.get<{ success: boolean; data: LeaderboardEntry[] }>(`${this.baseUrl}/leaderboard?period=${period}`);
  }

  getAchievements(): Observable<{ success: boolean; data: Achievement[] }> {
    return this.http.get<{ success: boolean; data: Achievement[] }>(`${this.baseUrl}/achievements`);
  }
}
