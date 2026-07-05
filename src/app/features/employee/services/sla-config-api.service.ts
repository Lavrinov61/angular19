import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SlaOption {
  id: string;
  slug: string;
  name: string;
  estimated_minutes: number | null;
  base_price: string;
}

export interface SlaGroup {
  id: string;
  slug: string;
  name: string;
  selection_type: string;
  options: SlaOption[];
}

export interface SlaCategory {
  id: string;
  slug: string;
  name: string;
  groups: SlaGroup[];
}

export interface SlaConfigResponse {
  success: boolean;
  data: { categories: SlaCategory[] };
}

@Injectable({ providedIn: 'root' })
export class SlaConfigApiService {
  private readonly http = inject(HttpClient);

  getSlaConfig(): Observable<SlaConfigResponse> {
    return this.http.get<SlaConfigResponse>('/api/crm/sla-config');
  }

  updateOptionMinutes(optionId: string, minutes: number): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`/api/crm/sla-config/${optionId}`, {
      estimated_minutes: minutes,
    });
  }
}
