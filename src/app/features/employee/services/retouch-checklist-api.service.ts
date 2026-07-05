import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Каталог чек-листа «Супер обработки» — справочник опций ретуши,
 * который оператор отмечает в кассе при оформлении заказа.
 *
 * Источник: GET /api/pricing/retouch-checklist (публичный, без Redis-кэша).
 * Это ОТДЕЛЬНЫЙ контракт от RetouchApiService (очередь задач ретуши) —
 * не путать с типами retouch-api.service.ts.
 */

export type RetouchSelectionType = 'single' | 'multi' | 'notes';
export type RetouchGender = 'male' | 'female' | 'any';

export interface RetouchChecklistItem {
  slug: string;
  name: string;
  hint: string | null;
  gender: RetouchGender;
  icon: string | null;
  is_default: boolean;
  addon_price: number;
}

export interface RetouchChecklistGroup {
  group_slug: string;
  group_name: string;
  selection_type: RetouchSelectionType;
  sort_order: number;
  items: RetouchChecklistItem[];
}

@Injectable({ providedIn: 'root' })
export class RetouchChecklistApiService {
  private readonly http = inject(HttpClient);

  /** Загрузить активный каталог чек-листа «Супер обработки», сгруппированный по группам. */
  getRetouchChecklist(): Observable<RetouchChecklistGroup[]> {
    return this.http
      .get<{ success: boolean; checklist: RetouchChecklistGroup[] }>('/api/pricing/retouch-checklist')
      .pipe(map(r => r.checklist ?? []));
  }
}
