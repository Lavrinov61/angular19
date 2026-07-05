import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface CustomerTag {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  created_at: string;
}

export interface ContactTagAssignment {
  tag_id: string;
  name: string;
  color: string;
  icon: string | null;
  assigned_at: string;
  assigned_by_name: string | null;
}

@Injectable({ providedIn: 'root' })
export class CrmCustomerTagsApiService {
  private readonly http = inject(HttpClient);

  getAllTags(): Observable<CustomerTag[]> {
    return this.http.get<{ success: boolean; data: CustomerTag[] }>(
      '/api/crm/customer-tags',
    ).pipe(map(r => r.data));
  }

  createTag(tag: { name: string; color: string; icon?: string }): Observable<CustomerTag> {
    return this.http.post<{ success: boolean; data: CustomerTag }>(
      '/api/crm/customer-tags',
      tag,
    ).pipe(map(r => r.data));
  }

  deleteTag(tagId: string): Observable<void> {
    return this.http.delete<void>(`/api/crm/customer-tags/${tagId}`);
  }

  getContactTags(contactId: string): Observable<ContactTagAssignment[]> {
    return this.http.get<{ success: boolean; data: ContactTagAssignment[] }>(
      `/api/crm/customer-tags/contacts/${contactId}`,
    ).pipe(map(r => r.data));
  }

  assignTag(contactId: string, tagId: string): Observable<void> {
    return this.http.post<void>(
      `/api/crm/customer-tags/contacts/${contactId}/tags/${tagId}`,
      {},
    );
  }

  removeTag(contactId: string, tagId: string): Observable<void> {
    return this.http.delete<void>(
      `/api/crm/customer-tags/contacts/${contactId}/tags/${tagId}`,
    );
  }
}
