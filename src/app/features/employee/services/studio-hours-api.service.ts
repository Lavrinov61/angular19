import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export interface StudioWorkingHour {
  id?: string;
  day_of_week: number; // 0=Пн, 1=Вт, 2=Ср, 3=Чт, 4=Пт, 5=Сб, 6=Вс
  start_time: string;  // "09:00"
  end_time: string;    // "19:30"
  is_open: boolean;
}

export interface StudioWithHours {
  id: string;
  name: string;
  location_code: string;
  hours: StudioWorkingHour[];
}

@Injectable({ providedIn: 'root' })
export class StudioHoursApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/studio-hours`;

  getAllStudios(): Observable<StudioWithHours[]> {
    return this.http.get<{ success: boolean; data: StudioWithHours[] }>(this.base).pipe(
      map(r => r.data),
    );
  }

  getStudioHours(studioId: string): Observable<StudioWithHours> {
    return this.http.get<{ success: boolean; data: StudioWithHours }>(`${this.base}/${studioId}`).pipe(
      map(r => r.data),
    );
  }

  updateHours(studioId: string, hours: StudioWorkingHour[]): Observable<StudioWorkingHour[]> {
    return this.http.put<{ success: boolean; data: StudioWorkingHour[] }>(
      `${this.base}/${studioId}`,
      { hours },
    ).pipe(map(r => r.data));
  }
}
