import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface SearchResult {
  type: 'task' | 'booking' | 'order' | 'client';
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  route: string;
}

@Injectable({ providedIn: 'root' })
export class CrmSearchService {
  private readonly http = inject(HttpClient);

  search(query: string): Observable<SearchResult[]> {
    return this.http.get<{ success: boolean; data: SearchResult[] }>(
      `/api/crm/search`, { params: { q: query } },
    ).pipe(map(r => r.data));
  }
}
