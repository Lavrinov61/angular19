import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map } from 'rxjs';

export interface QuickReply {
  id: string;
  category: string;
  trigger_keywords: string[];
  title: string;
  content: string;
  sort_order: number;
  created_by?: string;
}

interface QuickReplyGroup {
  category: string;
  label: string;
  replies: QuickReply[];
}

@Injectable({ providedIn: 'root' })
export class QuickRepliesService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _replies = signal<QuickReply[]>([]);
  private _loaded = false;

  readonly replies = this._replies.asReadonly();

  private readonly categoryLabels: Record<string, string> = {
    greeting: 'Приветствие',
    order: 'Заказ',
    price: 'Цены',
    time: 'Сроки',
    payment: 'Оплата',
    delivery: 'Доставка',
  };

  readonly groups = computed<QuickReplyGroup[]>(() => {
    const byCategory = new Map<string, QuickReply[]>();
    for (const r of this._replies()) {
      const list = byCategory.get(r.category) ?? [];
      list.push(r);
      byCategory.set(r.category, list);
    }
    return Array.from(byCategory.entries()).map(([category, replies]) => ({
      category,
      label: this.categoryLabels[category] || category,
      replies,
    }));
  });

  load(): void {
    if (this._loaded || !isPlatformBrowser(this.platformId)) return;
    this._loaded = true;
    this.reload();
  }

  reload(): void {
    this.http.get<{ success: boolean; data: QuickReply[] }>('/api/visitor-chat/quick-replies').subscribe({
      next: (res) => {
        if (res.success) this._replies.set(res.data);
      },
    });
  }

  create(data: { title: string; content: string; category?: string }): Observable<QuickReply> {
    return this.http.post<{ success: boolean; data: QuickReply }>(
      '/api/visitor-chat/admin/quick-replies', data
    ).pipe(
      map(res => res.data),
      tap(() => this.reload()),
    );
  }

  update(id: string, data: Partial<{ title: string; content: string; category: string; sort_order: number }>): Observable<QuickReply> {
    return this.http.put<{ success: boolean; data: QuickReply }>(
      `/api/visitor-chat/admin/quick-replies/${id}`, data
    ).pipe(
      map(res => res.data),
      tap(() => this.reload()),
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<{ success: boolean }>(
      `/api/visitor-chat/admin/quick-replies/${id}`
    ).pipe(
      map(() => undefined),
      tap(() => this.reload()),
    );
  }
}
