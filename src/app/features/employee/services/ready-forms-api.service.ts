import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ReadyForm {
  id: string;
  title: string;
  description: string | null;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  extension: string;
  uploadedBy: string | null;
  uploaderName: string | null;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string;
}

export interface ReadyFormsQuery {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ReadyFormsListResult {
  forms: ReadyForm[];
  total: number;
}

interface ReadyFormsListResponse {
  success: boolean;
  data: ReadyForm[];
  total: number;
}

interface ReadyFormResponse {
  success: boolean;
  data: ReadyForm;
}

@Injectable({ providedIn: 'root' })
export class ReadyFormsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/admin/ready-forms';

  list(query: ReadyFormsQuery = {}): Observable<ReadyFormsListResult> {
    let params = new HttpParams();
    if (query.q) params = params.set('q', query.q);
    if (query.limit !== undefined) params = params.set('limit', query.limit);
    if (query.offset !== undefined) params = params.set('offset', query.offset);

    return this.http.get<ReadyFormsListResponse>(this.baseUrl, { params }).pipe(
      map(response => ({
        forms: response.data.map(form => ({ ...form, fileSize: Number(form.fileSize) })),
        total: Number(response.total),
      })),
    );
  }

  upload(file: File, title?: string, description?: string): Observable<ReadyForm> {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    if (description) formData.append('description', description);

    return this.http.post<ReadyFormResponse>(this.baseUrl, formData).pipe(
      map(response => ({ ...response.data, fileSize: Number(response.data.fileSize) })),
    );
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/${id}`);
  }

  downloadUrl(id: string): string {
    return `${this.baseUrl}/${id}/download`;
  }
}
