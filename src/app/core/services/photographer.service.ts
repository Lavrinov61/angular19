import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TeamMember, Photographer } from '../../features/photograph/models/photographer.model';
import { TEAM_MEMBERS, PHOTOGRAPHERS_DATA } from '../data/photographers.data';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class PhotographerService {
  private http = inject(HttpClient);
  private readonly portraitFallback = '/assets/images/default-avatar.svg';

  /** Список активных членов команды для публичной страницы */
  getTeamMembers(): Observable<TeamMember[]> {
    return this.http.get<ApiResponse<TeamMember[]>>('/api/photographers/team-members').pipe(
      map(res => this.normalizeTeamMembers(res.data)),
      catchError(() => of(this.normalizeTeamMembers(TEAM_MEMBERS)))
    );
  }

  /** Один фотограф по slug (полная модель Photographer) */
  getBySlug(slug: string): Observable<Photographer | null> {
    return this.http.get<ApiResponse<Photographer>>(`/api/photographers/by-slug/${slug}`).pipe(
      map(res => res.data ?? null),
      catchError(() => {
        const fallback = PHOTOGRAPHERS_DATA.find(p => p.slug === slug) ?? null;
        return of(fallback);
      })
    );
  }

  /** Все фотографы (для CRM, include_inactive=true) */
  getAll(includeInactive = false): Observable<Photographer[]> {
    const params: Record<string, string> = includeInactive ? { include_inactive: 'true' } : {};
    return this.http.get<ApiResponse<Photographer[]>>('/api/photographers', { params }).pipe(
      map(res => res.data),
      catchError(() => of(PHOTOGRAPHERS_DATA))
    );
  }

  private normalizeTeamMembers(members: TeamMember[]): TeamMember[] {
    return members.map(member => ({
      ...member,
      portraitHero: this.normalizePortrait(member.portraitHero),
      portraitCard: this.normalizePortrait(member.portraitCard),
    }));
  }

  private normalizePortrait(_src: string): string {
    return this.portraitFallback;
  }
}
